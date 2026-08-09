// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventRecurrenceError(string Code, string Message, int Status, string? Field = null);
public sealed record EventRecurrenceCreateData(int RootEventId, int OccurrencesCreated);
public sealed record EventRecurrenceResult(object? Data, int Status = 200, EventRecurrenceError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class EventRecurrenceService(
    NexusDbContext db,
    EventRecurrenceTokenService tokens,
    IConfiguration configuration)
{
    public const string Engine = "sabre-vobject";
    public const string EngineVersion = "2";
    private static readonly string[] Frequencies = ["daily", "weekly", "monthly", "yearly"];
    private static readonly HashSet<string> PatchFields = new(StringComparer.Ordinal)
    {
        "title", "description", "location", "latitude", "longitude", "max_attendees", "is_online",
        "online_link", "video_url", "allow_remote_attendance", "category_id", "all_day",
        "accessibility_step_free", "accessibility_toilet", "accessibility_hearing_loop",
        "accessibility_quiet_space", "accessibility_seating", "accessibility_parking",
        "accessibility_parking_details", "accessibility_transit_details", "accessibility_assistance_contact",
        "accessibility_notes", "timezone", "local_start_time", "local_end_time", "recurrence_rrule",
        "recurrence_exdates", "recurrence_rdates", "group_id", "series_id", "poll_ids", "image_url",
        "cover_image", "federated_visibility"
    };
    private static readonly HashSet<string> UnsupportedRevisionFields = new(StringComparer.Ordinal)
    {
        "recurrence_rrule", "recurrence_exdates", "recurrence_rdates", "group_id", "series_id",
        "poll_ids", "image_url", "cover_image"
    };

    public object Capabilities() => new
    {
        contract_version = 1,
        engine = "v2",
        structured_input = true,
        supported_frequencies = Frequencies,
        max_occurrences = MaxOccurrences,
        supported_end_types = new[] { "after_count", "on_date", "never" },
        supports_rolling_never = true,
        supports_effective_revisions = true,
        supports_definition_blueprints = true,
        schema_ready = true,
        rollout_state = "v2_rolling"
    };

    public async Task<EventRecurrenceResult> CreateAsync(int tenantId, int actorId, JsonElement body, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object) return Validation("body");
        var actor = await ActiveActor(tenantId, actorId, ct);
        if (actor is null) return Forbidden();
        var title = Text(body, "title")?.Trim();
        if (title is null || title.Length is < 3 or > 255) return Validation("title");
        var start = Date(body, "start_time") ?? Date(body, "starts_at");
        if (start is null) return Validation("start_time");
        var end = Date(body, "end_time") ?? Date(body, "ends_at");
        if (end is not null && end <= start) return Validation("end_time");
        var timezone = Text(body, "timezone")?.Trim() ?? "UTC";
        RuleSpec ruleSpec;
        var rawRRule = Text(body, "recurrence_rrule")?.Trim();
        if (!string.IsNullOrEmpty(rawRRule))
        {
            if (!TryParseRRule(rawRRule, start.Value, timezone, MaxOccurrences, out ruleSpec)) return Validation("recurrence_rrule");
        }
        else
        {
            var frequency = Text(body, "recurrence_frequency")?.Trim().ToLowerInvariant();
            if (frequency is null || !Frequencies.Contains(frequency)) return Validation("recurrence_frequency");
            var interval = Int(body, "recurrence_interval") ?? 1;
            if (interval is < 1 or > 365) return Validation("recurrence_interval");
            var endsType = Text(body, "recurrence_ends_type")?.Trim().ToLowerInvariant() ?? "after_count";
            if (endsType is not ("after_count" or "on_date" or "never")) return Validation("recurrence_ends_type");
            var requestedCount = Int(body, "recurrence_ends_after_count") ?? 10;
            if (endsType == "after_count" && (requestedCount < 1 || requestedCount > MaxOccurrences)) return Validation("recurrence_ends_after_count");
            var onDate = Date(body, "recurrence_ends_on_date");
            if (endsType == "on_date" && onDate is null) return Validation("recurrence_ends_on_date");
            var rrule = BuildRRule(frequency, interval, endsType, requestedCount, onDate, Text(body, "recurrence_days"));
            if (!TryParseRRule(rrule, start.Value, timezone, MaxOccurrences, out ruleSpec)) return Validation("recurrence_rrule");
        }
        if (!TryDateList(body, ["recurrence_exdates", "exdates"], start.Value, timezone, MaxOccurrences, out var exdates, out var dateField)) return Validation(dateField!);
        if (!TryDateList(body, ["recurrence_rdates", "recurrence_additions", "rdates"], start.Value, timezone, MaxOccurrences, out var rdates, out dateField)) return Validation(dateField!);
        var recurrenceHorizon = start.Value.ToUniversalTime().AddYears(MaxHorizonYears);
        if (rdates.Any(x => x < start.Value.ToUniversalTime() || x > recurrenceHorizon)) return Validation("recurrence_rdates");
        var generated = GenerateRule(start.Value, timezone, ruleSpec, MaxOccurrences, MaxHorizonYears);
        var excluded = exdates.ToHashSet();
        var dates = generated.Where(x => !excluded.Contains(x))
            .Concat(rdates.Where(x => !excluded.Contains(x)))
            .Distinct().OrderBy(x => x).ToList();
        if (dates.Count == 0 || dates.Count > MaxOccurrences) return new(null, Error: new("EVENT_RECURRENCE_LIMIT_EXCEEDED", "Invalid input", 413));
        var duration = end is null ? (TimeSpan?)null : end.Value - start.Value;
        var now = DateTime.UtcNow;

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var root = new Event
        {
            TenantId = tenantId, CreatedById = actorId, Title = title,
            Description = Text(body, "description"), Location = Text(body, "location"),
            StartsAt = start.Value, EndsAt = end, MaxAttendees = Int(body, "max_attendees"),
            ImageUrl = Text(body, "image_url") ?? Text(body, "cover_image"), CategoryId = Int(body, "category_id"),
            IsOnline = Bool(body, "is_online"), AllowRemoteAttendance = Bool(body, "allow_remote_attendance"),
            OnlineLink = Text(body, "online_link"), VideoUrl = Text(body, "video_url"),
            Timezone = timezone, AllDay = Bool(body, "all_day"),
            GroupId = Int(body, "group_id"), SeriesId = Int(body, "series_id"),
            PublicationStatus = "draft", OperationalStatus = "scheduled", Status = "draft",
            IsRecurringTemplate = true, RecurrenceEngine = Engine, RecurrenceEngineVersion = EngineVersion,
            CreatedAt = now, UpdatedAt = now
        };
        if (!await GroupAllowed(tenantId, root.GroupId, actor, ct)) return Forbidden();
        CopyAccessibility(root, body);
        db.Events.Add(root);
        await db.SaveChangesAsync(ct);

        var canonicalExDates = exdates.Select(CanonicalDate).ToArray();
        var canonicalRDates = rdates.Select(CanonicalDate).ToArray();
        var ruleHash = Hash(string.Join('|', Engine, EngineVersion, timezone, start.Value.ToUniversalTime().ToString("O"), ruleSpec.RRule, string.Join(',', canonicalExDates), string.Join(',', canonicalRDates)));
        var rule = new EventRecurrenceRule
        {
            TenantId = tenantId, EventId = root.Id, Frequency = ruleSpec.Frequency, Interval = ruleSpec.Interval,
            DaysOfWeek = ruleSpec.ByDays.Count == 0 ? null : string.Join(',', ruleSpec.ByDays),
            DayOfMonth = ruleSpec.ByMonthDays.Count == 1 ? ruleSpec.ByMonthDays[0] : null,
            EndsType = ruleSpec.EndsType, EndsAfterCount = ruleSpec.Count, EndsOnDate = ruleSpec.UntilUtc,
            RRule = ruleSpec.RRule, ExDates = JsonSerializer.Serialize(canonicalExDates), RDates = JsonSerializer.Serialize(canonicalRDates),
            RuleHash = ruleHash, MaterializedSetVersion = 1,
            MaterializedThroughAt = dates[^1], MaterializationLastAttemptedAt = now,
            MaterializationLastSucceededAt = now, MaterializationTruncated = ruleSpec.EndsType == "never" && dates.Count == MaxOccurrences,
            CreatedAt = now, UpdatedAt = now
        };
        db.EventRecurrenceRules.Add(rule);
        var children = dates.Select(date => CloneOccurrence(root, date, duration, now)).ToList();
        db.Events.AddRange(children);
        await db.SaveChangesAsync(ct);
        db.EventRecurrenceOccurrenceLedger.AddRange(children.Select(child => new EventRecurrenceOccurrenceLedger
        {
            TenantId = tenantId, RootEventId = root.Id, EventId = child.Id, RecurrenceId = child.RecurrenceId!,
            OccurrenceKey = child.OccurrenceKey!, State = "materialized", StateVersion = 1,
            StartTimeUtc = child.StartsAt, EndTimeUtc = child.EndsAt, ActorUserId = actorId,
            Metadata = JsonSerializer.Serialize(new { source = "recurring_create", rule_version = 0 }), CreatedAt = now
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(new EventRecurrenceCreateData(root.Id, children.Count), 201);
    }

    public async Task<EventRecurrenceResult> PreviewRevisionAsync(int tenantId, int eventId, int actorId, JsonElement body, CancellationToken ct)
    {
        if (!TryPatch(body, out var patch, out var field)) return Validation(field ?? "patch");
        var context = await LoadContext(tenantId, eventId, actorId, ct);
        if (context.Error is not null) return new(null, Error: context.Error);
        var impact = await BuildImpact(tenantId, context.Source!, context.Root!, context.Rule!, patch!, ct);
        if (impact.TooLarge) return new(null, Error: new("EVENT_RECURRENCE_REVISION_LIMIT_EXCEEDED", "Invalid input", 413));
        var patchHash = Hash(Canonical(patch!));
        var checksum = await MaterializedChecksum(tenantId, context.Root!.Id, ct);
        var expires = DateTime.UtcNow.AddMinutes(10);
        var token = tokens.Issue(new RevisionToken("revision", tenantId, actorId, eventId, context.Root.Id,
            context.Source!.RecurrenceId!, patchHash, context.Rule!.EffectiveRevisionVersion,
            context.Rule.MaterializedSetVersion, checksum, expires));
        if (token is null) return Unavailable("EVENT_RECURRENCE_REVISION_UNAVAILABLE");
        return new(new
        {
            preview_token = token, preview_expires_at = Iso(expires), scope = "this_and_future",
            selected_event_id = eventId, root_event_id = context.Root.Id, effective_from_utc = Iso(context.Source.StartsAt),
            can_commit = impact.Blocking.Count == 0,
            impact = ImpactResource(impact)
        });
    }

    public async Task<EventRecurrenceResult> CommitRevisionAsync(int tenantId, int eventId, int actorId, JsonElement body, string idempotencyKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Trim().Length > 191)
            return Validation("Idempotency-Key");
        if (!TryPatch(body, out var patch, out var field)) return Validation(field ?? "patch");
        var previewToken = Text(body, "preview_token");
        if (previewToken is null || !tokens.TryRead<RevisionToken>(previewToken, out var token) || token is null)
            return Conflict("EVENT_RECURRENCE_REVISION_PREVIEW_INVALID", "preview_token");
        var patchHash = Hash(Canonical(patch!));
        if (token.Kind != "revision" || token.TenantId != tenantId || token.ActorId != actorId || token.SelectedEventId != eventId || token.PatchHash != patchHash)
            return Conflict("EVENT_RECURRENCE_REVISION_PREVIEW_INVALID", "preview_token");
        var keyHash = Hash($"{tenantId}|{token.RootEventId}|{idempotencyKey.Trim()}");
        var requestHash = Hash($"{eventId}|{patchHash}");
        var replay = await db.EventRecurrenceRevisions.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.RootEventId == token.RootEventId && x.IdempotencyHash == keyHash, ct);
        if (replay is not null) return replay.RequestHash == requestHash ? RevisionReplay(replay) : Conflict("EVENT_RECURRENCE_REVISION_CONFLICT");
        if (token.ExpiresAt <= DateTime.UtcNow) return Conflict("EVENT_RECURRENCE_REVISION_PREVIEW_EXPIRED", "preview_token");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var context = await LoadContext(tenantId, eventId, actorId, ct);
        if (context.Error is not null) return new(null, Error: context.Error);
        var checksumBefore = await MaterializedChecksum(tenantId, context.Root!.Id, ct);
        if (context.Rule!.EffectiveRevisionVersion != token.RuleVersion || context.Rule.MaterializedSetVersion != token.MaterializedSetVersion || checksumBefore != token.Checksum)
            return Conflict("EVENT_RECURRENCE_REVISION_CONFLICT");
        var impact = await BuildImpact(tenantId, context.Source!, context.Root, context.Rule, patch!, ct);
        if (impact.TooLarge) return new(null, Error: new("EVENT_RECURRENCE_REVISION_LIMIT_EXCEEDED", "Invalid input", 413));
        if (impact.Blocking.Count > 0) return Conflict("EVENT_RECURRENCE_REVISION_CONFLICT");
        var now = DateTime.UtcNow;
        var version = context.Rule.EffectiveRevisionVersion + 1;
        foreach (var item in impact.Changed)
        {
            ApplyPatch(item.Event, patch!, item.SkippedFields);
            item.Event.UpdatedAt = now;
            var stateVersion = await db.EventRecurrenceOccurrenceLedger.IgnoreQueryFilters()
                .Where(x => x.TenantId == tenantId && x.RootEventId == context.Root.Id && x.EventId == item.Event.Id)
                .MaxAsync(x => (long?)x.StateVersion, ct) ?? 0;
            db.EventRecurrenceOccurrenceLedger.Add(new()
            {
                TenantId = tenantId, RootEventId = context.Root.Id, EventId = item.Event.Id,
                RecurrenceId = item.Event.RecurrenceId!, OccurrenceKey = item.Event.OccurrenceKey!, State = "materialized",
                StateVersion = stateVersion + 1, RevisionVersion = version, StartTimeUtc = item.Event.StartsAt,
                EndTimeUtc = item.Event.EndsAt, ActorUserId = actorId,
                Metadata = JsonSerializer.Serialize(new { source = "effective_revision", patch_fields = patch!.Keys.OrderBy(x => x) }), CreatedAt = now
            });
        }
        context.Rule.EffectiveRevisionVersion = version;
        context.Rule.MaterializedSetVersion++;
        context.Rule.UpdatedAt = now;
        var checksumAfter = ChecksumEvents(impact.Affected.Select(x => x.Event));
        var revision = new EventRecurrenceRevision
        {
            TenantId = tenantId, RootEventId = context.Root.Id, RevisionVersion = version,
            EffectiveFromRecurrenceId = context.Source!.RecurrenceId!, EffectiveFromUtc = context.Source.StartsAt,
            CanonicalTimezone = context.Root.Timezone, CanonicalRRule = context.Rule.RRule, RuleHash = context.Rule.RuleHash,
            BlueprintPatch = Canonical(patch!), PatchHash = patchHash, ActorUserId = actorId,
            RootCalendarSequence = context.Root.CalendarSequence, RuleVersion = version,
            MaterializedSetVersion = context.Rule.MaterializedSetVersion, MaterializedChecksumBefore = checksumBefore,
            MaterializedChecksumAfter = checksumAfter, IdempotencyHash = keyHash, RequestHash = requestHash,
            ImpactSummary = JsonSerializer.Serialize(ImpactResource(impact)), PreviewedAt = token.ExpiresAt.AddMinutes(-10), CreatedAt = now
        };
        db.EventRecurrenceRevisions.Add(revision);
        EventDomainOutbox? outbox = null;
        if (impact.UniqueRecipientIds.Count > 0 && impact.Changed.Count > 0)
        {
            outbox = new EventDomainOutbox
            {
                TenantId = tenantId, EventId = context.Root.Id, AggregateStream = "recurrence",
                AggregateVersion = version, Action = "recurrence.revised", IdempotencyKey = $"recurrence:{context.Root.Id}:revision:{version}",
                ProductionMode = "durable", Status = "pending", Attempts = 0, AvailableAt = now,
                Payload = JsonSerializer.Serialize(new { root_event_id = context.Root.Id, revision_version = version, changed_event_ids = impact.Changed.Select(x => x.Event.Id), recipient_ids = impact.UniqueRecipientIds }), CreatedAt = now
            };
            db.EventDomainOutbox.Add(outbox);
        }
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            var winner = await db.EventRecurrenceRevisions.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.RootEventId == token.RootEventId && x.IdempotencyHash == keyHash, ct);
            return winner is not null && winner.RequestHash == requestHash ? RevisionReplay(winner) : Conflict("EVENT_RECURRENCE_REVISION_CONFLICT");
        }
        return new(new
        {
            revision_id = revision.Id, root_event_id = context.Root.Id, revision_version = version,
            effective_from_utc = Iso(context.Source.StartsAt), changed_event_ids = impact.Changed.Select(x => x.Event.Id).ToArray(),
            changed_count = impact.Changed.Count, notification_recipient_count = impact.UniqueRecipientIds.Count,
            notification_outbox_id = outbox?.Id, idempotent_replay = false, created_at = Iso(now)
        }, 201);
    }

    private int MaxOccurrences => Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:MaxOccurrences") ?? 366, 1, 5000);
    private int MaxRevisionAffected => Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:MaxRevisionAffected") ?? 500, 1, 5000);
    private int MaxHorizonYears => Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:MaxHorizonYears") ?? 20, 1, 50);

    private async Task<SeriesContext> LoadContext(int tenantId, int eventId, int actorId, CancellationToken ct)
    {
        var source = await db.Events.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (source is null || source.ParentEventId is null || source.RecurrenceId is null || source.RecurrenceEngine != Engine || source.RecurrenceEngineVersion != EngineVersion)
            return new(Error: new("EVENT_RECURRENCE_REVISION_NOT_FOUND", "Event not found", 404));
        var root = await db.Events.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == source.ParentEventId && x.IsRecurringTemplate, ct);
        var actor = await ActiveActor(tenantId, actorId, ct);
        if (root is null) return new(Error: new("EVENT_RECURRENCE_REVISION_NOT_FOUND", "Event not found", 404));
        if (actor is null || !await CanManage(tenantId, root, actor, ct)) return new(Error: new("EVENT_RECURRENCE_REVISION_FORBIDDEN", "Forbidden", 403));
        var rule = await db.EventRecurrenceRules.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == root.Id, ct);
        return rule is null ? new(Error: new("EVENT_RECURRENCE_REVISION_UNAVAILABLE", "Service unavailable", 503)) : new(source, root, rule);
    }

    private async Task<RevisionImpact> BuildImpact(int tenantId, Event source, Event root, EventRecurrenceRule rule, Dictionary<string, JsonElement> patch, CancellationToken ct)
    {
        var affectedEvents = await db.Events.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.ParentEventId == root.Id && x.RecurrenceId != null && string.Compare(x.RecurrenceId, source.RecurrenceId) >= 0)
            .OrderBy(x => x.RecurrenceId).ThenBy(x => x.Id).ToListAsync(ct);
        if (affectedEvents.Count > MaxRevisionAffected) return new([], [], [], [], true);
        var affected = new List<ImpactEvent>(); var changed = new List<ImpactEvent>(); var customized = new List<object>(); var blocking = new List<object>();
        foreach (var eventRow in affectedEvents)
        {
            var overrides = ParseStringSet(eventRow.RecurrenceOverrideFields);
            var skipped = patch.Keys.Where(overrides.Contains).OrderBy(x => x).ToArray();
            var item = new ImpactEvent(eventRow, skipped);
            affected.Add(item);
            if (skipped.Length > 0) customized.Add(new { event_id = eventRow.Id, skipped_fields = skipped });
            if (patch.Keys.Any(UnsupportedRevisionFields.Contains))
                foreach (var unsupported in patch.Keys.Where(UnsupportedRevisionFields.Contains)) blocking.Add(new { code = "field_requires_reconciliation", event_id = eventRow.Id, field = unsupported });
            var scheduleConflicts = ScheduleConflicts(eventRow, patch);
            foreach (var conflict in scheduleConflicts) blocking.Add(conflict);
            if (patch.TryGetValue("max_attendees", out var max) && max.ValueKind == JsonValueKind.Number && max.TryGetInt32(out var capacity))
            {
                var registrations = await db.EventRegistrations.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.EventId == eventRow.Id && x.RegistrationState == "confirmed", ct);
                if (registrations > capacity) blocking.Add(new { code = "capacity_below_confirmed", event_id = eventRow.Id, field = "max_attendees" });
            }
            if (scheduleConflicts.Count == 0 && WouldChange(eventRow, patch, skipped)) changed.Add(item);
        }
        var ids = affectedEvents.Select(x => x.Id).ToArray();
        var registrationsCount = await db.EventRegistrations.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && ids.Contains(x.EventId) && x.RegistrationState == "confirmed", ct);
        var waitlistCount = await db.EventWaitlistEntries.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && ids.Contains(x.EventId) && (x.QueueState == "waiting" || x.QueueState == "offered"), ct);
        var ticketCount = await db.EventTicketEntitlements.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && ids.Contains(x.EventId) && x.Status == "confirmed", ct);
        var reminderCount = await db.EventReminders.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && ids.Contains(x.EventId) && x.Status == "pending", ct);
        var recipientIds = await db.EventRegistrations.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && ids.Contains(x.EventId) && x.RegistrationState == "confirmed")
            .Select(x => x.UserId).Distinct().ToListAsync(ct);
        return new(affected, changed, customized, blocking, false, registrationsCount, waitlistCount, ticketCount, reminderCount, recipientIds);
    }

    private static object ImpactResource(RevisionImpact impact) => new
    {
        affected_event_ids = impact.Affected.Select(x => x.Event.Id).ToArray(), affected_count = impact.Affected.Count,
        changed_event_ids = impact.Changed.Select(x => x.Event.Id).ToArray(), changed_count = impact.Changed.Count,
        moved_occurrences = Array.Empty<object>(), created_occurrences = Array.Empty<object>(), retired_occurrences = Array.Empty<object>(),
        registrations_count = impact.RegistrationsCount, waitlist_count = impact.WaitlistCount, ticket_count = impact.TicketCount,
        reminder_count = impact.ReminderCount, unique_recipient_count = impact.UniqueRecipientIds.Count,
        customized_exception_conflicts = impact.Customized, blocking_conflicts = impact.Blocking
    };

    private static bool WouldChange(Event row, Dictionary<string, JsonElement> patch, string[] skipped)
    {
        var clone = JsonSerializer.Serialize(row);
        ApplyPatch(row, patch, skipped);
        var changed = clone != JsonSerializer.Serialize(row);
        return changed;
    }

    internal static void ApplyPatch(Event row, Dictionary<string, JsonElement> patch, IEnumerable<string> skippedFields)
    {
        var skipped = skippedFields.ToHashSet(StringComparer.Ordinal);
        if (!skipped.Contains("timezone") && patch.TryGetValue("timezone", out var timezone)) row.Timezone = timezone.GetString()!;
        foreach (var (field, value) in patch)
        {
            if (skipped.Contains(field) || UnsupportedRevisionFields.Contains(field)) continue;
            switch (field)
            {
                case "title": row.Title = value.GetString()!; break;
                case "description": row.Description = NullableText(value); break;
                case "location": row.Location = NullableText(value); break;
                case "latitude": row.Latitude = NullableDouble(value); break;
                case "longitude": row.Longitude = NullableDouble(value); break;
                case "max_attendees": row.MaxAttendees = NullableInt(value); break;
                case "is_online": row.IsOnline = value.GetBoolean(); break;
                case "online_link": row.OnlineLink = NullableText(value); break;
                case "video_url": row.VideoUrl = NullableText(value); break;
                case "allow_remote_attendance": row.AllowRemoteAttendance = value.GetBoolean(); break;
                case "category_id": row.CategoryId = NullableInt(value); break;
                case "all_day": row.AllDay = value.GetBoolean(); break;
                case "timezone": break;
                case "local_start_time": MoveClock(row, value.GetString()!, false); break;
                case "local_end_time": if (value.ValueKind == JsonValueKind.Null) row.EndsAt = null; else MoveClock(row, value.GetString()!, true); break;
                case "federated_visibility": row.FederatedVisibility = value.GetString()!; break;
                case "accessibility_step_free": row.AccessibilityStepFree = NullableBool(value); break;
                case "accessibility_toilet": row.AccessibilityToilet = NullableBool(value); break;
                case "accessibility_hearing_loop": row.AccessibilityHearingLoop = NullableBool(value); break;
                case "accessibility_quiet_space": row.AccessibilityQuietSpace = NullableBool(value); break;
                case "accessibility_seating": row.AccessibilitySeating = NullableBool(value); break;
                case "accessibility_parking": row.AccessibilityParking = NullableBool(value); break;
                case "accessibility_parking_details": row.AccessibilityParkingDetails = NullableText(value); break;
                case "accessibility_transit_details": row.AccessibilityTransitDetails = NullableText(value); break;
                case "accessibility_assistance_contact": row.AccessibilityAssistanceContact = NullableText(value); break;
                case "accessibility_notes": row.AccessibilityNotes = NullableText(value); break;
            }
        }
    }

    private static void MoveClock(Event row, string clock, bool end)
    {
        if (!TimeSpan.TryParseExact(clock, ["hh\\:mm", "hh\\:mm\\:ss"], CultureInfo.InvariantCulture, out var time)) return;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(row.Timezone);
        var current = end ? row.EndsAt ?? row.StartsAt : row.StartsAt;
        var localDate = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(current, DateTimeKind.Utc), zone).Date;
        var wall = DateTime.SpecifyKind(localDate.Add(time), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(wall) || zone.IsAmbiguousTime(wall)) throw new InvalidOperationException("event_recurrence_wall_time_invalid");
        var moved = TimeZoneInfo.ConvertTimeToUtc(wall, zone);
        if (end) row.EndsAt = moved; else row.StartsAt = moved;
    }

    private static List<object> ScheduleConflicts(Event row, Dictionary<string, JsonElement> patch)
    {
        var conflicts = new List<object>();
        if (!patch.ContainsKey("timezone") && !patch.ContainsKey("local_start_time") && !patch.ContainsKey("local_end_time")) return conflicts;
        var timezone = patch.TryGetValue("timezone", out var zoneValue) ? zoneValue.GetString()! : row.Timezone;
        TimeZoneInfo? zone = null;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timezone); }
        catch (TimeZoneNotFoundException) { }
        catch (InvalidTimeZoneException) { }
        if (zone is null) { conflicts.Add(new { code = "timezone_invalid", event_id = row.Id, field = "timezone" }); return conflicts; }
        foreach (var (field, instant) in new[] { ("local_start_time", row.StartsAt), ("local_end_time", row.EndsAt ?? row.StartsAt) })
        {
            if (!patch.TryGetValue(field, out var value) || value.ValueKind != JsonValueKind.String || !TimeSpan.TryParse(value.GetString(), out var clock)) continue;
            var localDate = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(instant, DateTimeKind.Utc), zone).Date;
            var wall = DateTime.SpecifyKind(localDate.Add(clock), DateTimeKind.Unspecified);
            if (zone.IsInvalidTime(wall)) conflicts.Add(new { code = "wall_time_nonexistent", event_id = row.Id, field });
            else if (zone.IsAmbiguousTime(wall)) conflicts.Add(new { code = "wall_time_ambiguous", event_id = row.Id, field });
        }
        return conflicts;
    }

    private static bool TryPatch(JsonElement body, out Dictionary<string, JsonElement>? patch, out string? field)
    {
        patch = null; field = null;
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("patch", out var raw) || raw.ValueKind != JsonValueKind.Object) { field = "patch"; return false; }
        var properties = raw.EnumerateObject().ToArray();
        if (properties.Length is < 1 or > 32) { field = "patch"; return false; }
        patch = new(StringComparer.Ordinal);
        foreach (var property in properties)
        {
            if (!PatchFields.Contains(property.Name) || !ValidPatchValue(property.Name, property.Value)) { field = $"patch.{property.Name}"; patch = null; return false; }
            patch[property.Name] = property.Value.Clone();
        }
        return true;
    }

    private static bool ValidPatchValue(string field, JsonElement value) => field switch
    {
        "title" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 3 and <= 255,
        "description" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= 10000,
        "location" or "online_link" or "video_url" or "accessibility_parking_details" or "accessibility_transit_details" or "accessibility_assistance_contact" or "accessibility_notes" or "image_url" or "cover_image" => value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.String,
        "latitude" => value.ValueKind == JsonValueKind.Null || value.TryGetDouble(out var latitude) && latitude is >= -90 and <= 90,
        "longitude" => value.ValueKind == JsonValueKind.Null || value.TryGetDouble(out var longitude) && longitude is >= -180 and <= 180,
        "max_attendees" or "category_id" or "group_id" or "series_id" => value.ValueKind == JsonValueKind.Null || value.TryGetInt32(out var positive) && positive > 0,
        "is_online" or "allow_remote_attendance" or "all_day" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
        var x when x.StartsWith("accessibility_", StringComparison.Ordinal) && x is not ("accessibility_parking_details" or "accessibility_transit_details" or "accessibility_assistance_contact" or "accessibility_notes") => value.ValueKind is JsonValueKind.Null or JsonValueKind.True or JsonValueKind.False,
        "timezone" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 64,
        "local_start_time" => value.ValueKind == JsonValueKind.String && TimeSpan.TryParseExact(value.GetString(), ["hh\\:mm", "hh\\:mm\\:ss"], CultureInfo.InvariantCulture, out _),
        "local_end_time" => value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.String && TimeSpan.TryParseExact(value.GetString(), ["hh\\:mm", "hh\\:mm\\:ss"], CultureInfo.InvariantCulture, out _),
        "recurrence_rrule" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length is >= 1 and <= 2048,
        "recurrence_exdates" or "recurrence_rdates" or "poll_ids" => value.ValueKind == JsonValueKind.Array && value.GetArrayLength() <= 500,
        "federated_visibility" => value.ValueKind == JsonValueKind.String && value.GetString() is "none" or "listed" or "joinable",
        _ => false
    };

    internal static List<DateTime> Generate(DateTime start, string frequency, int interval, int count, DateTime? until, string? days)
    {
        var result = new List<DateTime> { start.ToUniversalTime() };
        if (count == 1) return result;
        var weeklyDays = ParseWeekdays(days);
        var cursor = start.ToUniversalTime();
        var guard = 0;
        while (result.Count < count && guard++ < 20000)
        {
            cursor = frequency switch
            {
                "daily" => cursor.AddDays(interval), "monthly" => cursor.AddMonths(interval), "yearly" => cursor.AddYears(interval),
                _ => cursor.AddDays(1)
            };
            if (frequency == "weekly")
            {
                var weeks = (int)((cursor.Date - start.ToUniversalTime().Date).TotalDays / 7);
                if (weeks % interval != 0 || weeklyDays.Count > 0 && !weeklyDays.Contains(cursor.DayOfWeek)) continue;
            }
            if (until is not null && cursor.Date > until.Value.Date) break;
            result.Add(cursor);
        }
        return result;
    }

    private static HashSet<DayOfWeek> ParseWeekdays(string? value)
    {
        var result = new HashSet<DayOfWeek>();
        foreach (var part in (value ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (int.TryParse(part, out var number) && number is >= 1 and <= 7) result.Add(number == 7 ? DayOfWeek.Sunday : (DayOfWeek)number);
            else if (Enum.TryParse<DayOfWeek>(part, true, out var day)) result.Add(day);
        }
        return result;
    }

    private static string BuildRRule(string frequency, int interval, string endsType, int count, DateTime? until, string? days)
    {
        var parts = new List<string> { $"FREQ={frequency.ToUpperInvariant()}", $"INTERVAL={interval}" };
        if (frequency == "weekly" && !string.IsNullOrWhiteSpace(days)) parts.Add("BYDAY=" + string.Join(',', ParseWeekdays(days).OrderBy(x => x).Select(DayCode)));
        if (endsType == "after_count") parts.Add($"COUNT={count}");
        if (endsType == "on_date" && until is not null) parts.Add($"UNTIL={until.Value:yyyyMMdd}");
        return string.Join(';', parts);
    }

    private bool TryParseRRule(string raw, DateTime startUtc, string timezone, int maxOccurrences, out RuleSpec spec)
        => TryParseRRule(raw, startUtc, timezone, maxOccurrences, MaxHorizonYears, out spec);

    private static bool TryParseRRule(string raw, DateTime startUtc, string timezone, int maxOccurrences, int maxHorizonYears, out RuleSpec spec)
    {
        spec = default!;
        raw = raw.Trim();
        if (raw.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase)) raw = raw[6..];
        if (raw.Length is < 1 or > 2048 || raw.IndexOfAny(['\r', '\n']) >= 0) return false;
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timezone); } catch { return false; }
        var allowed = new HashSet<string>(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"], StringComparer.Ordinal);
        var parts = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var segment in raw.Split(';'))
        {
            var separator = segment.IndexOf('=');
            if (separator <= 0 || separator == segment.Length - 1) return false;
            var name = segment[..separator].Trim().ToUpperInvariant();
            var value = segment[(separator + 1)..].Trim().ToUpperInvariant();
            if (!allowed.Contains(name) || !parts.TryAdd(name, value)) return false;
        }
        if (!parts.TryGetValue("FREQ", out var frequency) || frequency is not ("DAILY" or "WEEKLY" or "MONTHLY" or "YEARLY")) return false;
        var interval = 1;
        if (parts.TryGetValue("INTERVAL", out var rawInterval) && (!int.TryParse(rawInterval, out interval) || interval is < 1 or > 365)) return false;
        int? count = null;
        if (parts.TryGetValue("COUNT", out var rawCount))
        {
            if (!int.TryParse(rawCount, out var parsed) || parsed < 1 || parsed > maxOccurrences) return false;
            count = parsed;
        }
        if (count is not null && parts.ContainsKey("UNTIL")) return false;
        DateTime? untilUtc = null;
        if (parts.TryGetValue("UNTIL", out var rawUntil))
        {
            if (DateTime.TryParseExact(rawUntil, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var exact)) untilUtc = exact;
            else if (DateTime.TryParseExact(rawUntil, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            {
                var wall = DateTime.SpecifyKind(date.Date.AddHours(23).AddMinutes(59).AddSeconds(59), DateTimeKind.Unspecified);
                if (zone.IsInvalidTime(wall) || zone.IsAmbiguousTime(wall)) return false;
                untilUtc = TimeZoneInfo.ConvertTimeToUtc(wall, zone);
            }
            else return false;
            if (untilUtc < startUtc.ToUniversalTime() || untilUtc > startUtc.ToUniversalTime().AddYears(maxHorizonYears)) return false;
        }
        if (!TryDayList(parts.GetValueOrDefault("BYDAY"), out var byDays) || !TryIntegerList(parts.GetValueOrDefault("BYMONTHDAY"), -31, 31, true, out var byMonthDays) || !TryIntegerList(parts.GetValueOrDefault("BYMONTH"), 1, 12, false, out var byMonths)) return false;
        var weekStart = parts.GetValueOrDefault("WKST");
        if (weekStart is not null && !WeekdayCodes.ContainsKey(weekStart)) return false;
        if (frequency == "WEEKLY" && (byMonthDays.Count > 0 || byMonths.Count > 0) ||
            frequency == "MONTHLY" && (byMonths.Count > 0 || weekStart is not null) ||
            frequency == "YEARLY" && (weekStart is not null || (byMonthDays.Count > 0 || byDays.Count > 0) && byMonths.Count == 0) ||
            frequency == "DAILY" && (byMonthDays.Count > 0 || weekStart is not null)) return false;
        var localStart = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc.ToUniversalTime(), DateTimeKind.Utc), zone);
        if (frequency == "WEEKLY" && byDays.Count == 0) byDays.Add(DayCode(localStart.DayOfWeek));
        if (frequency == "MONTHLY" && byDays.Count == 0 && byMonthDays.Count == 0) byMonthDays.Add(localStart.Day);
        if (frequency == "YEARLY")
        {
            if (byMonths.Count == 0) byMonths.Add(localStart.Month);
            if (byDays.Count == 0 && byMonthDays.Count == 0) byMonthDays.Add(localStart.Day);
        }
        var canonical = new List<string> { $"FREQ={frequency}" };
        if (parts.ContainsKey("INTERVAL")) canonical.Add($"INTERVAL={interval}");
        if (byDays.Count > 0) canonical.Add("BYDAY=" + string.Join(',', byDays));
        if (byMonthDays.Count > 0) canonical.Add("BYMONTHDAY=" + string.Join(',', byMonthDays));
        if (byMonths.Count > 0) canonical.Add("BYMONTH=" + string.Join(',', byMonths));
        if (weekStart is not null) canonical.Add($"WKST={weekStart}");
        if (count is int countValue) canonical.Add($"COUNT={countValue}");
        if (untilUtc is DateTime until) canonical.Add($"UNTIL={until:yyyyMMdd'T'HHmmss'Z'}");
        spec = new(string.Join(';', canonical), frequency.ToLowerInvariant(), interval, count, untilUtc,
            count is not null ? "after_count" : untilUtc is not null ? "on_date" : "never", byDays, byMonthDays, byMonths, weekStart ?? "MO");
        return true;
    }

    internal static List<DateTime> GenerateCanonicalRule(DateTime startUtc, string timezone, string rrule, int maxOccurrences, int maxHorizonYears = 50)
    {
        if (!TryParseRRule(rrule, startUtc, timezone, maxOccurrences, maxHorizonYears, out var spec)) throw new InvalidOperationException("event_recurrence_rule_invalid");
        return GenerateRule(startUtc, timezone, spec, maxOccurrences, maxHorizonYears);
    }

    private static List<DateTime> GenerateRule(DateTime startUtc, string timezone, RuleSpec spec, int maxOccurrences, int maxHorizonYears)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(timezone);
        var normalizedStart = DateTime.SpecifyKind(startUtc.ToUniversalTime(), DateTimeKind.Utc);
        var localStart = TimeZoneInfo.ConvertTimeFromUtc(normalizedStart, zone);
        var results = new List<DateTime> { normalizedStart };
        if (spec.Count == 1) return results;
        var horizon = localStart.Date.AddYears(maxHorizonYears);
        for (var date = localStart.Date.AddDays(1); date <= horizon && results.Count < maxOccurrences; date = date.AddDays(1))
        {
            if (!MatchesRuleDate(localStart.Date, date, spec)) continue;
            var wall = DateTime.SpecifyKind(date.Add(localStart.TimeOfDay), DateTimeKind.Unspecified);
            if (zone.IsInvalidTime(wall)) continue;
            var occurrence = TimeZoneInfo.ConvertTimeToUtc(wall, zone);
            if (spec.UntilUtc is DateTime until && occurrence > until) break;
            results.Add(occurrence);
            if (spec.Count is int count && results.Count >= count) break;
        }
        return results;
    }

    private static bool MatchesRuleDate(DateTime anchor, DateTime date, RuleSpec spec)
    {
        var dayMatches = spec.ByDays.Count == 0 || spec.ByDays.Contains(DayCode(date.DayOfWeek));
        return spec.Frequency switch
        {
            "daily" => (date - anchor).Days % spec.Interval == 0 && dayMatches
                && (spec.ByMonths.Count == 0 || spec.ByMonths.Contains(date.Month)),
            "weekly" => WeeksBetween(anchor, date, WeekdayCodes[spec.WeekStart]) % spec.Interval == 0 && dayMatches,
            "monthly" => MonthsBetween(anchor, date) % spec.Interval == 0 &&
                (spec.ByMonthDays.Count > 0 ? spec.ByMonthDays.Any(x => MonthDayMatches(date, x)) : spec.ByDays.Count > 0 ? dayMatches : date.Day == anchor.Day),
            "yearly" => (date.Year - anchor.Year) % spec.Interval == 0 &&
                (spec.ByMonths.Count > 0 ? spec.ByMonths.Contains(date.Month) : date.Month == anchor.Month) &&
                (spec.ByMonthDays.Count > 0 ? spec.ByMonthDays.Any(x => MonthDayMatches(date, x)) : spec.ByDays.Count > 0 ? dayMatches : date.Day == anchor.Day),
            _ => false
        };
    }
    private static int MonthsBetween(DateTime anchor, DateTime date) => (date.Year - anchor.Year) * 12 + date.Month - anchor.Month;
    private static int WeeksBetween(DateTime anchor, DateTime date, DayOfWeek weekStart)
        => (int)((StartOfWeek(date, weekStart) - StartOfWeek(anchor, weekStart)).TotalDays / 7);
    private static DateTime StartOfWeek(DateTime date, DayOfWeek weekStart)
    {
        var offset = ((int)date.DayOfWeek - (int)weekStart + 7) % 7;
        return date.Date.AddDays(-offset);
    }
    private static bool MonthDayMatches(DateTime date, int value) => value > 0 ? date.Day == value : date.Day == DateTime.DaysInMonth(date.Year, date.Month) + value + 1;
    private static readonly Dictionary<string, DayOfWeek> WeekdayCodes = new(StringComparer.Ordinal) { ["MO"] = DayOfWeek.Monday, ["TU"] = DayOfWeek.Tuesday, ["WE"] = DayOfWeek.Wednesday, ["TH"] = DayOfWeek.Thursday, ["FR"] = DayOfWeek.Friday, ["SA"] = DayOfWeek.Saturday, ["SU"] = DayOfWeek.Sunday };
    private static bool TryDayList(string? raw, out List<string> days)
    {
        days = [];
        if (raw is null) return true;
        foreach (var value in raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)) if (!WeekdayCodes.ContainsKey(value)) return false; else if (!days.Contains(value, StringComparer.Ordinal)) days.Add(value);
        days = days.OrderBy(x => (int)WeekdayCodes[x] == 0 ? 7 : (int)WeekdayCodes[x]).ToList();
        return days.Count > 0;
    }
    private static bool TryIntegerList(string? raw, int minimum, int maximum, bool rejectZero, out List<int> values)
    {
        values = [];
        if (raw is null) return true;
        foreach (var item in raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)) if (!int.TryParse(item, out var value) || value < minimum || value > maximum || rejectZero && value == 0) return false; else if (!values.Contains(value)) values.Add(value);
        values.Sort(); return values.Count > 0;
    }

    private static bool TryDateList(JsonElement body, string[] names, DateTime startUtc, string timezone, int maximum, out List<DateTime> values, out string? field)
    {
        values = []; field = null; JsonElement raw = default; string? selected = null;
        foreach (var name in names) if (body.TryGetProperty(name, out raw)) { selected = name; break; }
        if (selected is null || raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined || raw.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(raw.GetString())) return true;
        IEnumerable<string?> inputs;
        if (raw.ValueKind == JsonValueKind.String) inputs = raw.GetString()!.Split(',', StringSplitOptions.TrimEntries);
        else if (raw.ValueKind == JsonValueKind.Array && raw.GetArrayLength() <= maximum) inputs = raw.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : null).ToArray();
        else { field = selected; return false; }
        foreach (var input in inputs)
        {
            if (string.IsNullOrWhiteSpace(input) || !TryDateValue(input.Trim(), startUtc, timezone, out var date)) { field = selected; values = []; return false; }
            if (!values.Contains(date)) values.Add(date);
        }
        values.Sort(); return values.Count <= maximum;
    }
    private static bool TryDateValue(string value, DateTime startUtc, string timezone, out DateTime result)
    {
        result = default;
        if (DateTime.TryParseExact(value.ToUpperInvariant(), "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out result)) return true;
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var offset) && (value.EndsWith("Z", StringComparison.OrdinalIgnoreCase) || System.Text.RegularExpressions.Regex.IsMatch(value, "[+-]\\d{2}:?\\d{2}$"))) { result = offset.UtcDateTime; return true; }
        TimeZoneInfo zone; try { zone = TimeZoneInfo.FindSystemTimeZoneById(timezone); } catch { return false; }
        var localStart = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc.ToUniversalTime(), DateTimeKind.Utc), zone);
        if (DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateOnly)) result = dateOnly.Date.Add(localStart.TimeOfDay);
        else if (!DateTime.TryParseExact(value.Replace('T', ' '), "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out result)) return false;
        result = DateTime.SpecifyKind(result, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(result) || zone.IsAmbiguousTime(result)) return false;
        result = TimeZoneInfo.ConvertTimeToUtc(result, zone); return true;
    }
    private static string CanonicalDate(DateTime value) => value.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");

    private static string DayCode(DayOfWeek day) => day switch { DayOfWeek.Monday => "MO", DayOfWeek.Tuesday => "TU", DayOfWeek.Wednesday => "WE", DayOfWeek.Thursday => "TH", DayOfWeek.Friday => "FR", DayOfWeek.Saturday => "SA", _ => "SU" };

    internal static Event CloneOccurrence(Event root, DateTime start, TimeSpan? duration, DateTime now)
    {
        var id = start.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");
        return new Event
        {
            TenantId = root.TenantId, CreatedById = root.CreatedById, GroupId = root.GroupId, SeriesId = root.SeriesId,
            Title = root.Title, Description = root.Description, Location = root.Location, StartsAt = start,
            EndsAt = duration is null ? null : start.Add(duration.Value), MaxAttendees = root.MaxAttendees, ImageUrl = root.ImageUrl,
            CategoryId = root.CategoryId, Latitude = root.Latitude, Longitude = root.Longitude, IsOnline = root.IsOnline,
            AllowRemoteAttendance = root.AllowRemoteAttendance, OnlineLink = root.OnlineLink, VideoUrl = root.VideoUrl,
            Timezone = root.Timezone, AllDay = root.AllDay, FederatedVisibility = root.FederatedVisibility,
            PublicationStatus = "draft", OperationalStatus = "scheduled", Status = "draft", ParentEventId = root.Id,
            OccurrenceKey = $"recurrence:{root.TenantId}:{root.Id}:{Hash($"{Engine}|{EngineVersion}|{id}")[..32]}",
            RecurrenceEngine = Engine, RecurrenceEngineVersion = EngineVersion, RecurrenceId = id,
            AccessibilityStepFree = root.AccessibilityStepFree, AccessibilityToilet = root.AccessibilityToilet,
            AccessibilityHearingLoop = root.AccessibilityHearingLoop, AccessibilityQuietSpace = root.AccessibilityQuietSpace,
            AccessibilitySeating = root.AccessibilitySeating, AccessibilityParking = root.AccessibilityParking,
            AccessibilityParkingDetails = root.AccessibilityParkingDetails, AccessibilityTransitDetails = root.AccessibilityTransitDetails,
            AccessibilityAssistanceContact = root.AccessibilityAssistanceContact, AccessibilityNotes = root.AccessibilityNotes,
            CreatedAt = now, UpdatedAt = now
        };
    }

    private async Task<User?> ActiveActor(int tenantId, int actorId, CancellationToken ct) => await db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == actorId && x.IsActive, ct);
    private async Task<bool> CanManage(int tenantId, Event root, User actor, CancellationToken ct)
    {
        if (IsAdmin(actor) || root.CreatedById == actor.Id) return await GroupAllowed(tenantId, root.GroupId, actor, ct);
        if (!await GroupAllowed(tenantId, root.GroupId, actor, ct)) return false;
        return await db.EventStaffAssignments.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.EventId == root.Id && x.UserId == actor.Id && x.Role == "co_organizer" && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);
    }
    private async Task<bool> GroupAllowed(int tenantId, int? groupId, User actor, CancellationToken ct)
    {
        if (groupId is null) return true;
        var group = await db.Groups.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId, ct);
        return group is not null && group.IsActive && group.Status == "active" && (IsAdmin(actor) || group.CreatedById == actor.Id || await db.GroupMembers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active", ct));
    }
    private static bool IsAdmin(User user) => user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod || user.Role is "admin" or "super_admin" or "tenant_admin" or "god";

    private async Task<string> MaterializedChecksum(int tenantId, int rootId, CancellationToken ct)
    {
        var rows = await db.Events.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.ParentEventId == rootId)
            .OrderBy(x => x.RecurrenceId).ThenBy(x => x.Id).Select(x => new { x.Id, x.RecurrenceId, x.StartsAt, x.EndsAt, x.UpdatedAt }).ToListAsync(ct);
        return Hash(JsonSerializer.Serialize(rows));
    }
    private static string ChecksumEvents(IEnumerable<Event> rows) => Hash(JsonSerializer.Serialize(rows.OrderBy(x => x.RecurrenceId).ThenBy(x => x.Id).Select(x => new { x.Id, x.RecurrenceId, x.StartsAt, x.EndsAt, x.UpdatedAt })));
    internal static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    internal static string Canonical(Dictionary<string, JsonElement> values)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var (key, value) in values.OrderBy(x => x.Key, StringComparer.Ordinal)) { writer.WritePropertyName(key); value.WriteTo(writer); }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }
    internal static string CanonicalJson(string json)
    {
        using var document = JsonDocument.Parse(json);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream)) WriteCanonical(writer, document.RootElement);
        return Encoding.UTF8.GetString(stream.ToArray());
    }
    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(x => x.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item);
                writer.WriteEndArray();
                break;
            default: value.WriteTo(writer); break;
        }
    }
    private static HashSet<string> ParseStringSet(string? json) { try { return json is null ? [] : (JsonSerializer.Deserialize<string[]>(json) ?? []).ToHashSet(StringComparer.Ordinal); } catch (JsonException) { return []; } }
    private static void CopyAccessibility(Event row, JsonElement body)
    {
        row.AccessibilityStepFree = NullableBool(body, "accessibility_step_free"); row.AccessibilityToilet = NullableBool(body, "accessibility_toilet");
        row.AccessibilityHearingLoop = NullableBool(body, "accessibility_hearing_loop"); row.AccessibilityQuietSpace = NullableBool(body, "accessibility_quiet_space");
        row.AccessibilitySeating = NullableBool(body, "accessibility_seating"); row.AccessibilityParking = NullableBool(body, "accessibility_parking");
        row.AccessibilityParkingDetails = Text(body, "accessibility_parking_details"); row.AccessibilityTransitDetails = Text(body, "accessibility_transit_details");
        row.AccessibilityAssistanceContact = Text(body, "accessibility_assistance_contact"); row.AccessibilityNotes = Text(body, "accessibility_notes");
    }
    private static string? Text(JsonElement x, string name) => x.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static int? Int(JsonElement x, string name) => x.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null && value.TryGetInt32(out var number) ? number : null;
    private static bool Bool(JsonElement x, string name) => x.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
    private static bool? NullableBool(JsonElement x, string name) => !x.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null ? null : value.ValueKind == JsonValueKind.True;
    private static DateTime? Date(JsonElement x, string name) => DateTimeOffset.TryParse(Text(x, name), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date) ? date.UtcDateTime : null;
    private static string? NullableText(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : value.GetString();
    private static int? NullableInt(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : value.GetInt32();
    private static double? NullableDouble(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : value.GetDouble();
    private static bool? NullableBool(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : value.GetBoolean();
    private static string Iso(DateTime value) => value.ToUniversalTime().ToString("O");
    private static EventRecurrenceResult Validation(string field) => new(null, Error: new("EVENT_RECURRENCE_REVISION_VALIDATION_FAILED", "Validation failed", 422, field));
    private static EventRecurrenceResult Forbidden() => new(null, Error: new("EVENT_RECURRENCE_REVISION_FORBIDDEN", "Forbidden", 403));
    private static EventRecurrenceResult Conflict(string code, string? field = null) => new(null, Error: new(code, "Invalid input", 409, field));
    private static EventRecurrenceResult Unavailable(string code) => new(null, Error: new(code, "Service unavailable", 503));
    private static EventRecurrenceResult RevisionReplay(EventRecurrenceRevision row) => new(new { revision_id = row.Id, root_event_id = row.RootEventId, revision_version = row.RevisionVersion, effective_from_utc = Iso(row.EffectiveFromUtc), changed_event_ids = ReadImpactIds(row.ImpactSummary), changed_count = ReadImpactIds(row.ImpactSummary).Length, notification_recipient_count = ReadImpactCount(row.ImpactSummary, "unique_recipient_count"), notification_outbox_id = (long?)null, idempotent_replay = true, created_at = Iso(row.CreatedAt) });
    private static int[] ReadImpactIds(string json) { try { using var doc = JsonDocument.Parse(json); return doc.RootElement.TryGetProperty("changed_event_ids", out var values) ? values.EnumerateArray().Select(x => x.GetInt32()).ToArray() : []; } catch { return []; } }
    private static int ReadImpactCount(string json, string field) { try { using var doc = JsonDocument.Parse(json); return doc.RootElement.TryGetProperty(field, out var value) && value.TryGetInt32(out var count) ? count : 0; } catch { return 0; } }

    private sealed record RevisionToken(string Kind, int TenantId, int ActorId, int SelectedEventId, int RootEventId, string RecurrenceId, string PatchHash, long RuleVersion, long MaterializedSetVersion, string Checksum, DateTime ExpiresAt);
    private sealed record RuleSpec(string RRule, string Frequency, int Interval, int? Count, DateTime? UntilUtc, string EndsType, List<string> ByDays, List<int> ByMonthDays, List<int> ByMonths, string WeekStart);
    private sealed record SeriesContext(Event? Source = null, Event? Root = null, EventRecurrenceRule? Rule = null, EventRecurrenceError? Error = null);
    private sealed record ImpactEvent(Event Event, string[] SkippedFields);
    private sealed record RevisionImpact(List<ImpactEvent> Affected, List<ImpactEvent> Changed, List<object> Customized, List<object> Blocking, bool TooLarge, int RegistrationsCount = 0, int WaitlistCount = 0, int TicketCount = 0, int ReminderCount = 0, List<int>? RecipientIds = null)
    {
        public List<int> UniqueRecipientIds => RecipientIds ?? [];
    }
}
