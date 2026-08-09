// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class EventRecurrenceDefinitionBlueprintService(
    NexusDbContext db,
    EventRecurrenceTokenService tokens)
{
    private static readonly string[] SectionNames = ["agenda", "ticket_types", "registration", "safety", "staff"];

    public async Task<EventRecurrenceResult> HistoryAsync(int tenantId, int eventId, int actorId, int limit, int? beforeVersion, CancellationToken ct)
    {
        if (limit is < 1 or > 100) return Validation("limit");
        if (beforeVersion is <= 0) return Validation("before_version");
        var context = await LoadContext(tenantId, eventId, actorId, ct);
        if (context.Error is not null) return new(null, Error: context.Error);
        var query = db.EventRecurrenceDefinitionBlueprints.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RootEventId == context.Root!.Id);
        if (beforeVersion is int before) query = query.Where(x => x.BlueprintVersion < before);
        var rows = await query.OrderByDescending(x => x.BlueprintVersion).Take(limit + 1).ToListAsync(ct);
        var more = rows.Count > limit;
        if (more) rows.RemoveAt(rows.Count - 1);
        return new(new
        {
            items = rows.Select(x => new
            {
                blueprint_id = x.Id, blueprint_version = x.BlueprintVersion, schema_version = x.SchemaVersion,
                effective_from_recurrence_id = x.EffectiveFromRecurrenceId, source_event_id = x.SourceEventId,
                source_recurrence_id = x.SourceRecurrenceId, selected_sections = SectionsResource(x.SelectedSections),
                counts = CountsFromManifest(x.Manifest), manifest_hash = x.ManifestHash,
                captured_by_user_id = x.CapturedByUserId, created_at = Iso(x.CreatedAt)
            }).ToArray(),
            next_before_version = more && rows.Count > 0 ? rows[^1].BlueprintVersion : (int?)null
        });
    }

    public async Task<EventRecurrenceResult> PreviewAsync(int tenantId, int eventId, int actorId, JsonElement body, CancellationToken ct)
    {
        if (!TryInput(body, out var effective, out var sections, out var field)) return Validation(field!);
        var context = await LoadContext(tenantId, eventId, actorId, ct);
        if (context.Error is not null) return new(null, Error: context.Error);
        if (!await BoundaryExists(tenantId, context.Root!.Id, effective!, ct)) return Validation("effective_from_recurrence_id");
        var snapshot = await Snapshot(tenantId, context.Source!, sections!, ct);
        var manifest = EventRecurrenceService.CanonicalJson(JsonSerializer.Serialize(new { schema_version = 1, source_event_id = context.Source!.Id, source_recurrence_id = context.Source.RecurrenceId, sections, counts = snapshot.Counts, definitions = snapshot.Definitions }));
        var manifestHash = EventRecurrenceService.Hash(manifest);
        var setVersion = await db.EventRecurrenceDefinitionBlueprints.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.RootEventId == context.Root.Id).MaxAsync(x => (int?)x.BlueprintVersion, ct) ?? 0;
        var expires = DateTime.UtcNow.AddMinutes(10);
        var token = tokens.Issue(new BlueprintToken("definition", tenantId, actorId, eventId, context.Root.Id,
            context.Source.RecurrenceId!, effective!, EventRecurrenceService.Hash(JsonSerializer.Serialize(sections)), manifestHash, setVersion, expires));
        if (token is null) return Unavailable();
        return new(new
        {
            preview_token = token, preview_expires_at = Iso(expires), schema_version = 1,
            root_event_id = context.Root.Id, source_event_id = context.Source.Id,
            source_recurrence_id = context.Source.RecurrenceId, effective_from_recurrence_id = effective,
            selected_sections = SectionsResource(sections!), manifest_hash = manifestHash,
            blueprint_set_version = setVersion, counts = snapshot.Counts, conflicts = snapshot.Conflicts,
            can_commit = snapshot.Conflicts.Count == 0
        });
    }

    public async Task<EventRecurrenceResult> CommitAsync(int tenantId, int eventId, int actorId, JsonElement body, string idempotencyKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Trim().Length > 191) return Validation("Idempotency-Key");
        if (!TryInput(body, out var effective, out var sections, out var field)) return Validation(field!);
        var rawToken = Text(body, "preview_token");
        if (rawToken is null || !tokens.TryRead<BlueprintToken>(rawToken, out var token) || token is null)
            return Conflict("EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID", "preview_token");
        var sectionsHash = EventRecurrenceService.Hash(JsonSerializer.Serialize(sections));
        if (token.Kind != "definition" || token.TenantId != tenantId || token.ActorId != actorId || token.SourceEventId != eventId || token.EffectiveFrom != effective || token.SectionsHash != sectionsHash)
            return Conflict("EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID", "preview_token");
        var keyHash = EventRecurrenceService.Hash($"{tenantId}|{token.RootEventId}|{idempotencyKey.Trim()}");
        var requestHash = EventRecurrenceService.Hash($"{eventId}|{effective}|{sectionsHash}|{token.ManifestHash}");
        var replay = await db.EventRecurrenceDefinitionBlueprints.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.RootEventId == token.RootEventId && x.IdempotencyHash == keyHash, ct);
        if (replay is not null) return replay.RequestHash == requestHash ? Replay(replay) : Conflict("EVENT_RECURRENCE_DEFINITION_CONFLICT");
        if (token.ExpiresAt <= DateTime.UtcNow) return Conflict("EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID", "preview_token");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var context = await LoadContext(tenantId, eventId, actorId, ct);
        if (context.Error is not null) return new(null, Error: context.Error);
        if (context.Root!.Id != token.RootEventId || context.Source!.RecurrenceId != token.SourceRecurrenceId || !await BoundaryExists(tenantId, context.Root.Id, effective!, ct))
            return Conflict("EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID", "preview_token");
        var setVersion = await db.EventRecurrenceDefinitionBlueprints.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.RootEventId == context.Root.Id).MaxAsync(x => (int?)x.BlueprintVersion, ct) ?? 0;
        if (setVersion != token.BlueprintSetVersion) return Conflict("EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID", "preview_token");
        var snapshot = await Snapshot(tenantId, context.Source, sections!, ct);
        if (snapshot.Conflicts.Count > 0) return Conflict("EVENT_RECURRENCE_DEFINITION_CONFLICT");
        var manifest = EventRecurrenceService.CanonicalJson(JsonSerializer.Serialize(new { schema_version = 1, source_event_id = context.Source.Id, source_recurrence_id = context.Source.RecurrenceId, sections, counts = snapshot.Counts, definitions = snapshot.Definitions }));
        if (EventRecurrenceService.Hash(manifest) != token.ManifestHash) return Conflict("EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID", "preview_token");
        var now = DateTime.UtcNow;
        var row = new EventRecurrenceDefinitionBlueprint
        {
            TenantId = tenantId, RootEventId = context.Root.Id, SourceEventId = context.Source.Id,
            SourceRecurrenceId = context.Source.RecurrenceId!, SourceOccurrenceKey = context.Source.OccurrenceKey!,
            BlueprintVersion = setVersion + 1, SchemaVersion = 1, EffectiveFromRecurrenceId = effective!,
            SelectedSections = JsonSerializer.Serialize(sections), Manifest = manifest, ManifestHash = token.ManifestHash,
            IdempotencyHash = keyHash, RequestHash = requestHash, CapturedByUserId = actorId, CreatedAt = now
        };
        db.EventRecurrenceDefinitionBlueprints.Add(row);
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            var winner = await db.EventRecurrenceDefinitionBlueprints.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.RootEventId == token.RootEventId && x.IdempotencyHash == keyHash, ct);
            return winner is not null && winner.RequestHash == requestHash ? Replay(winner) : Conflict("EVENT_RECURRENCE_DEFINITION_CONFLICT");
        }
        return new(new
        {
            blueprint_id = row.Id, blueprint_version = row.BlueprintVersion, schema_version = row.SchemaVersion,
            root_event_id = row.RootEventId, source_event_id = row.SourceEventId, source_recurrence_id = row.SourceRecurrenceId,
            effective_from_recurrence_id = row.EffectiveFromRecurrenceId, selected_sections = SectionsResource(row.SelectedSections),
            manifest_hash = row.ManifestHash, counts = snapshot.Counts, idempotent_replay = false, created_at = Iso(row.CreatedAt)
        }, 201);
    }

    private async Task<BlueprintSnapshot> Snapshot(int tenantId, Event source, Dictionary<string, bool> sections, CancellationToken ct)
    {
        var sessionRows = sections["agenda"] ? await db.EventSessions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == source.Id && x.Status == "scheduled").OrderBy(x => x.StartsAtUtc).ThenBy(x => x.Position).ThenBy(x => x.Id).ToListAsync(ct) : [];
        var sessions = new List<object>(); var speakerCount = 0; var resourceCount = 0;
        foreach (var session in sessionRows)
        {
            var speakers = await db.EventSessionSpeakers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == source.Id && x.SessionId == session.Id).OrderBy(x => x.Position).ThenBy(x => x.Id).Select(x => new { user_id = x.UserId, display_name = x.DisplayName, role_label = x.RoleLabel, position = x.Position }).ToListAsync(ct);
            var resources = await db.EventSessionResources.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == source.Id && x.SessionId == session.Id).OrderBy(x => x.Position).ThenBy(x => x.Id).Select(x => new { resource_type = x.ResourceType, visibility = x.Visibility, title = x.Title, url_ciphertext = x.UrlCiphertext, position = x.Position }).ToListAsync(ct);
            speakerCount += speakers.Count; resourceCount += resources.Count;
            sessions.Add(new { title = session.Title, description = session.Description, session_type = session.SessionType, visibility = session.Visibility, capacity = session.Capacity, start_offset_seconds = (long)(session.StartsAtUtc - source.StartsAt).TotalSeconds, duration_seconds = (long)(session.EndsAtUtc - session.StartsAtUtc).TotalSeconds, timezone = session.Timezone == source.Timezone ? null : session.Timezone, track_name = session.TrackName, room_name = session.RoomName, room_key = session.RoomKey, position = session.Position, speakers, resources });
        }
        var ticketRows = sections["ticket_types"] ? await db.EventTicketTypes.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == source.Id && x.Status != "archived").OrderBy(x => x.Id).ToListAsync(ct) : [];
        var tickets = ticketRows.Select(x => new { name = x.Name, description = x.Description, kind = x.Kind, unit_price_credits = x.UnitPriceCredits, allocation_limit = x.AllocationLimit, sales_open_offset_seconds = (long)(x.SalesOpensAt - source.StartsAt).TotalSeconds, sales_close_offset_seconds = (long)(x.SalesClosesAt - source.StartsAt).TotalSeconds, per_member_limit = x.PerMemberLimit, eligibility_policy = ParseJson(x.EligibilityPolicy), refund_cutoff_offset_seconds = x.RefundCutoffAt is null ? (long?)null : (long)(x.RefundCutoffAt.Value - source.StartsAt).TotalSeconds, organizer_cancel_refundable = x.OrganizerCancelRefundable, desired_status = x.Status == "active" ? "active" : "draft" }).ToList();
        var settingsRow = sections["registration"] ? await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == source.Id, ct) : null;
        object? registration = null; var questionCount = 0; var publishedForms = 0;
        if (settingsRow is not null)
        {
            object? publishedForm = null;
            if (settingsRow.FormState == "published" && settingsRow.PublishedFormVersionId is long formId)
            {
                var form = await db.EventRegistrationFormVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == source.Id && x.Id == formId && x.Status == "published", ct);
                if (form is not null)
                {
                    var questions = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == source.Id && x.FormVersionId == form.Id).OrderBy(x => x.Position).ThenBy(x => x.Id).Select(x => new { stable_key = x.StableKey, position = x.Position, question_type = x.QuestionType, prompt = x.Prompt, help_text = x.HelpText, is_required = x.IsRequired, data_classification = x.DataClassification, purpose = x.Purpose, retention_days = x.RetentionDays, choice_options = x.ChoiceOptions, validation_rules = x.ValidationRules, visibility_rules = x.VisibilityRules, displayed_text = x.DisplayedText, displayed_text_version = x.DisplayedTextVersion }).ToListAsync(ct);
                    questionCount = questions.Count; publishedForms = 1; publishedForm = new { name = form.Name, description = form.Description, questions };
                }
            }
            registration = new { settings = new { status = settingsRow.Status, approval_mode = settingsRow.ApprovalMode, opens_offset_seconds = Offset(source.StartsAt, settingsRow.OpensAtUtc), closes_offset_seconds = Offset(source.StartsAt, settingsRow.ClosesAtUtc), cancellation_cutoff_offset_seconds = Offset(source.StartsAt, settingsRow.CancellationCutoffAtUtc), per_member_limit = settingsRow.PerMemberLimit, guests_enabled = settingsRow.GuestsEnabled, max_guests_per_registration = settingsRow.MaxGuestsPerRegistration, guest_retention_days = settingsRow.GuestRetentionDays }, published_form = publishedForm };
        }
        object? safety = null;
        if (sections["safety"])
        {
            var requirement = await db.EventSafetyRequirements.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == source.Id && x.Status == "published" && x.PublishedVersion != null, ct);
            if (requirement is not null)
            {
                var version = await db.EventSafetyRequirementVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == source.Id && x.RequirementsId == requirement.Id && x.VersionNumber == requirement.PublishedVersion, ct);
                if (version is not null) safety = new { published_requirement = new { minimum_age = version.MinimumAge, guardian_consent_required = version.GuardianConsentRequired, minor_age_threshold = version.MinorAgeThreshold, code_of_conduct_required = version.CodeOfConductRequired, code_of_conduct_text = version.CodeOfConductText, code_of_conduct_text_version = version.CodeOfConductTextVersion, code_of_conduct_text_hash = version.CodeOfConductTextHash, eligibility_policy_hash = version.EligibilityPolicyHash } };
            }
        }
        var staffRows = sections["staff"] ? await db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == source.Id && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow)).OrderBy(x => x.Role).ThenBy(x => x.UserId).ToListAsync(ct) : [];
        var staff = staffRows.Select(x => new { user_id = x.UserId, role = x.Role, expires_offset_seconds = Offset(source.StartsAt, x.ExpiresAt) }).ToList();
        var conflicts = new List<object>();
        var paid = ticketRows.Count(x => x.UnitPriceCredits > 0);
        if (paid > 0) conflicts.Add(new { section = "ticket_types", code = "money_definition_unsupported", count = paid });
        if (staff.Count > 0)
        {
            var ids = staffRows.Select(x => x.UserId).Distinct().ToArray();
            var valid = await db.Users.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && ids.Contains(x.Id) && x.IsActive, ct);
            if (valid != ids.Length) conflicts.Add(new { section = "staff", code = "staff_reference_invalid", count = ids.Length - valid });
        }
        var counts = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["sessions"] = sessions.Count, ["speakers"] = speakerCount, ["resources"] = resourceCount, ["ticket_types"] = tickets.Count,
            ["registration_settings"] = settingsRow is null ? 0 : 1, ["published_forms"] = publishedForms,
            ["form_questions"] = questionCount, ["safety_requirements"] = safety is null ? 0 : 1, ["staff_assignments"] = staff.Count
        };
        return new(counts, new { agenda = new { sessions }, ticket_types = new { ticket_types = tickets }, registration, safety, staff = new { assignments = staff } }, conflicts);
    }

    private static long? Offset(DateTime anchor, DateTime? value) => value is null ? null : (long)(value.Value - anchor).TotalSeconds;
    private static object ParseJson(string value) { try { return JsonSerializer.Deserialize<object>(value) ?? new { }; } catch { return new { }; } }

    private async Task<BlueprintContext> LoadContext(int tenantId, int eventId, int actorId, CancellationToken ct)
    {
        var source = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (source is null || source.ParentEventId is null || source.RecurrenceId is null || source.OccurrenceKey is null)
            return new(Error: new("EVENT_RECURRENCE_DEFINITION_NOT_FOUND", "Event not found", 404));
        var root = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == source.ParentEventId && x.IsRecurringTemplate, ct);
        var actor = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == actorId && x.IsActive, ct);
        if (root is null) return new(Error: new("EVENT_RECURRENCE_DEFINITION_NOT_FOUND", "Event not found", 404));
        if (actor is null || !await CanManage(tenantId, root, actor, ct)) return new(Error: new("EVENT_RECURRENCE_DEFINITION_FORBIDDEN", "Forbidden", 403));
        return new(source, root);
    }

    private async Task<bool> CanManage(int tenantId, Event root, User actor, CancellationToken ct)
    {
        var admin = actor.IsAdmin || actor.IsSuperAdmin || actor.IsTenantSuperAdmin || actor.IsGod || actor.Role is "admin" or "super_admin" or "tenant_admin" or "god";
        if (root.GroupId is int groupId)
        {
            var group = await db.Groups.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId && x.IsActive && x.Status == "active", ct);
            if (group is null || !admin && group.CreatedById != actor.Id && !await db.GroupMembers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active", ct)) return false;
        }
        return admin || root.CreatedById == actor.Id || await db.EventStaffAssignments.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.EventId == root.Id && x.UserId == actor.Id && x.Role == "co_organizer" && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);
    }

    private async Task<bool> BoundaryExists(int tenantId, int rootId, string recurrenceId, CancellationToken ct) => await db.Events.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.ParentEventId == rootId && x.RecurrenceId == recurrenceId, ct);
    private static bool TryInput(JsonElement body, out string? effective, out Dictionary<string, bool>? sections, out string? field)
    {
        effective = null; sections = null; field = null;
        if (body.ValueKind != JsonValueKind.Object) { field = "body"; return false; }
        effective = Text(body, "effective_from_recurrence_id");
        if (effective is null || effective.Length != 16 || !DateTime.TryParseExact(effective, "yyyyMMdd'T'HHmmss'Z'", null, System.Globalization.DateTimeStyles.AssumeUniversal, out _)) { field = "effective_from_recurrence_id"; return false; }
        if (!body.TryGetProperty("sections", out var raw) || raw.ValueKind != JsonValueKind.Object) { field = "sections"; return false; }
        var properties = raw.EnumerateObject().ToArray();
        if (properties.Length == 0 || properties.Any(x => !SectionNames.Contains(x.Name) || x.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))) { field = "sections"; return false; }
        sections = SectionNames.ToDictionary(x => x, x => properties.FirstOrDefault(y => y.Name == x).Value.ValueKind == JsonValueKind.True, StringComparer.Ordinal);
        if (!sections.Values.Any(x => x)) { field = "sections"; return false; }
        return true;
    }

    private static object SectionsResource(string json) { try { return SectionsResource(JsonSerializer.Deserialize<Dictionary<string, bool>>(json) ?? []); } catch { return SectionsResource([]); } }
    private static object SectionsResource(Dictionary<string, bool> sections) => new { agenda = sections.GetValueOrDefault("agenda"), ticket_types = sections.GetValueOrDefault("ticket_types"), registration = sections.GetValueOrDefault("registration"), safety = sections.GetValueOrDefault("safety"), staff = sections.GetValueOrDefault("staff") };
    private static object CountsFromManifest(string json) { try { using var document = JsonDocument.Parse(json); return document.RootElement.TryGetProperty("counts", out var counts) ? JsonSerializer.Deserialize<Dictionary<string, int>>(counts.GetRawText()) ?? [] : []; } catch { return new Dictionary<string, int>(); } }
    private static EventRecurrenceResult Replay(EventRecurrenceDefinitionBlueprint row) => new(new { blueprint_id = row.Id, blueprint_version = row.BlueprintVersion, schema_version = row.SchemaVersion, root_event_id = row.RootEventId, source_event_id = row.SourceEventId, source_recurrence_id = row.SourceRecurrenceId, effective_from_recurrence_id = row.EffectiveFromRecurrenceId, selected_sections = SectionsResource(row.SelectedSections), manifest_hash = row.ManifestHash, counts = CountsFromManifest(row.Manifest), idempotent_replay = true, created_at = Iso(row.CreatedAt) });
    private static string? Text(JsonElement x, string name) => x.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static string Iso(DateTime value) => value.ToUniversalTime().ToString("O");
    private static EventRecurrenceResult Validation(string field) => new(null, Error: new("EVENT_RECURRENCE_DEFINITION_VALIDATION_FAILED", "Validation failed", 422, field));
    private static EventRecurrenceResult Conflict(string code, string? field = null) => new(null, Error: new(code, "Invalid input", 409, field));
    private static EventRecurrenceResult Unavailable() => new(null, Error: new("EVENT_RECURRENCE_DEFINITION_UNAVAILABLE", "Service unavailable", 503));
    private sealed record BlueprintToken(string Kind, int TenantId, int ActorId, int SourceEventId, int RootEventId, string SourceRecurrenceId, string EffectiveFrom, string SectionsHash, string ManifestHash, int BlueprintSetVersion, DateTime ExpiresAt);
    private sealed record BlueprintContext(Event? Source = null, Event? Root = null, EventRecurrenceError? Error = null);
    private sealed record BlueprintSnapshot(Dictionary<string, int> Counts, object Definitions, List<object> Conflicts);
}
