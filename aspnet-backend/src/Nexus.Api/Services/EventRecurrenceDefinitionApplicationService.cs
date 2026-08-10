// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventRecurrenceDefinitionApplicationResult(
    bool Applied,
    bool Replayed,
    long? BlueprintId,
    IReadOnlyDictionary<string, int> Counts);

/// <summary>
/// Applies an immutable definition blueprint to a newly materialized occurrence.
/// The caller must own the surrounding recurrence transaction.
/// </summary>
public sealed class EventRecurrenceDefinitionApplicationService(NexusDbContext db)
{
    public async Task<EventRecurrenceDefinitionApplicationResult> ApplyAsync(
        int tenantId,
        Event root,
        Event occurrence,
        int actorId,
        CancellationToken ct)
    {
        if (occurrence.Id <= 0 || occurrence.ParentEventId != root.Id || occurrence.RecurrenceId is null)
            throw new InvalidOperationException("event_recurrence_definition_occurrence_invalid");

        var existing = await db.EventRecurrenceDefinitionApplications.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == occurrence.Id, ct);
        if (existing is not null)
            return new(false, true, existing.BlueprintId, ReadCounts(existing.AppliedCounts));

        var blueprint = await db.EventRecurrenceDefinitionBlueprints.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.RootEventId == root.Id &&
                        string.Compare(x.EffectiveFromRecurrenceId, occurrence.RecurrenceId) <= 0)
            .OrderByDescending(x => x.EffectiveFromRecurrenceId)
            .ThenByDescending(x => x.BlueprintVersion)
            .FirstOrDefaultAsync(ct);
        if (blueprint is null)
            return new(false, false, null, EmptyCounts());
        if (blueprint.SchemaVersion != 1 || EventRecurrenceService.Hash(EventRecurrenceService.CanonicalJson(blueprint.Manifest)) != blueprint.ManifestHash)
            throw new InvalidOperationException("event_recurrence_definition_manifest_invalid");

        using var document = JsonDocument.Parse(blueprint.Manifest);
        if (!TryProperty(document.RootElement, "definitions", out var definitions) || definitions.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("event_recurrence_definition_manifest_invalid");
        var sections = ReadSections(blueprint.SelectedSections);
        var counts = EmptyCounts();
        if (sections.GetValueOrDefault("agenda")) await ApplyAgendaAsync(tenantId, occurrence, actorId, definitions, counts, ct);
        if (sections.GetValueOrDefault("ticket_types")) ApplyTickets(tenantId, occurrence, actorId, definitions, counts);
        if (sections.GetValueOrDefault("registration")) await ApplyRegistrationAsync(tenantId, occurrence, actorId, definitions, counts, ct);
        if (sections.GetValueOrDefault("safety")) await ApplySafetyAsync(tenantId, occurrence, actorId, definitions, counts, ct);
        if (sections.GetValueOrDefault("staff")) ApplyStaff(tenantId, occurrence, actorId, definitions, counts);

        var countsJson = JsonSerializer.Serialize(counts);
        var applicationHash = EventRecurrenceService.Hash(JsonSerializer.Serialize(new
        {
            blueprint_id = blueprint.Id,
            blueprint_version = blueprint.BlueprintVersion,
            event_id = occurrence.Id,
            manifest_hash = blueprint.ManifestHash,
            recurrence_id = occurrence.RecurrenceId,
            root_event_id = root.Id,
            counts
        }));
        db.EventRecurrenceDefinitionApplications.Add(new EventRecurrenceDefinitionApplication
        {
            TenantId = tenantId,
            RootEventId = root.Id,
            EventId = occurrence.Id,
            RecurrenceId = occurrence.RecurrenceId,
            BlueprintId = blueprint.Id,
            BlueprintVersion = blueprint.BlueprintVersion,
            ManifestHash = blueprint.ManifestHash,
            ApplicationHash = applicationHash,
            AppliedCounts = countsJson,
            Status = "applied",
            AppliedByUserId = actorId,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync(ct);
        return new(true, false, blueprint.Id, counts);
    }

    private async Task ApplyAgendaAsync(int tenantId, Event occurrence, int actorId, JsonElement definitions, Dictionary<string, int> counts, CancellationToken ct)
    {
        if (!SectionArray(definitions, "agenda", "sessions", out var sessions)) return;
        foreach (var item in sessions.EnumerateArray())
        {
            var starts = occurrence.StartsAt.AddSeconds(Number(item, "start_offset_seconds") ??
                OffsetFromAbsolute(item, "StartsAtUtc", occurrence.StartsAt));
            var duration = Number(item, "duration_seconds") ?? DurationFromAbsolute(item, "StartsAtUtc", "EndsAtUtc");
            if (duration <= 0) throw new InvalidOperationException("event_recurrence_definition_manifest_invalid");
            var session = new EventSession
            {
                TenantId = tenantId, EventId = occurrence.Id, Title = RequiredText(item, "title", "Title"),
                Description = Text(item, "description", "Description"), SessionType = Text(item, "session_type", "SessionType") ?? "session",
                Visibility = Text(item, "visibility", "Visibility") ?? "public", Capacity = Integer(item, "capacity", "Capacity"),
                Status = "scheduled", StartsAtUtc = starts, EndsAtUtc = starts.AddSeconds(duration),
                Timezone = Text(item, "timezone", "Timezone") ?? occurrence.Timezone,
                TrackName = Text(item, "track_name", "TrackName"), RoomName = Text(item, "room_name", "RoomName"),
                RoomKey = Text(item, "room_key", "RoomKey"), Position = Integer(item, "position", "Position") ?? counts["sessions"],
                CreatedBy = actorId, UpdatedBy = actorId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
            };
            db.EventSessions.Add(session);
            await db.SaveChangesAsync(ct);
            counts["sessions"]++;
            if (TryProperty(item, "speakers", out var speakers) && speakers.ValueKind == JsonValueKind.Array)
            {
                foreach (var speaker in speakers.EnumerateArray())
                {
                    db.EventSessionSpeakers.Add(new EventSessionSpeaker
                    {
                        TenantId = tenantId, EventId = occurrence.Id, SessionId = session.Id,
                        UserId = Integer(speaker, "user_id", "UserId"), DisplayName = Text(speaker, "display_name", "DisplayName"),
                        RoleLabel = Text(speaker, "role_label", "RoleLabel"), Position = Integer(speaker, "position", "Position") ?? counts["speakers"],
                        CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
                    });
                    counts["speakers"]++;
                }
            }
            if (TryProperty(item, "resources", out var resources) && resources.ValueKind == JsonValueKind.Array)
            {
                foreach (var resource in resources.EnumerateArray())
                {
                    db.EventSessionResources.Add(new EventSessionResource
                    {
                        TenantId = tenantId, EventId = occurrence.Id, SessionId = session.Id,
                        ResourceType = Text(resource, "resource_type", "ResourceType") ?? "link",
                        Visibility = Text(resource, "visibility", "Visibility") ?? "public",
                        Title = RequiredText(resource, "title", "Title"), UrlCiphertext = RequiredText(resource, "url_ciphertext", "UrlCiphertext"),
                        Position = Integer(resource, "position", "Position") ?? counts["resources"], CreatedBy = actorId, UpdatedBy = actorId,
                        CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
                    });
                    counts["resources"]++;
                }
            }
        }
    }

    private void ApplyTickets(int tenantId, Event occurrence, int actorId, JsonElement definitions, Dictionary<string, int> counts)
    {
        if (!SectionArray(definitions, "ticket_types", "ticket_types", out var tickets) &&
            !TryProperty(definitions, "tickets", out tickets)) return;
        foreach (var item in tickets.EnumerateArray())
        {
            var price = Decimal(item, "unit_price_credits", "UnitPriceCredits");
            if (price > 0) throw new InvalidOperationException("event_recurrence_definition_money_unsupported");
            var opens = occurrence.StartsAt.AddSeconds(Number(item, "sales_open_offset_seconds") ??
                OffsetFromAbsolute(item, "SalesOpensAt", occurrence.StartsAt));
            var closes = occurrence.StartsAt.AddSeconds(Number(item, "sales_close_offset_seconds") ??
                OffsetFromAbsolute(item, "SalesClosesAt", occurrence.StartsAt));
            db.EventTicketTypes.Add(new EventTicketType
            {
                TenantId = tenantId, EventId = occurrence.Id, OccurrenceKey = $"event:{occurrence.Id}",
                Name = RequiredText(item, "name", "Name"), Description = Text(item, "description", "Description"),
                Kind = Text(item, "kind", "Kind") ?? "free", UnitPriceCredits = price,
                AllocationLimit = Integer(item, "allocation_limit", "AllocationLimit") ?? 0,
                SalesOpensAt = opens, SalesClosesAt = closes, EventStartsAtSnapshot = occurrence.StartsAt,
                EventTimezoneSnapshot = occurrence.Timezone, PerMemberLimit = Integer(item, "per_member_limit", "PerMemberLimit") ?? 1,
                EligibilityPolicy = JsonText(item, "eligibility_policy", "EligibilityPolicy") ?? "{}",
                RefundCutoffAt = NullableOffset(item, occurrence.StartsAt, "refund_cutoff_offset_seconds", "RefundCutoffAt"),
                OrganizerCancelRefundable = Boolean(item, "organizer_cancel_refundable", "OrganizerCancelRefundable"),
                Status = "draft", CreatedBy = actorId, UpdatedBy = actorId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
            });
            counts["ticket_types"]++;
        }
    }

    private async Task ApplyRegistrationAsync(int tenantId, Event occurrence, int actorId, JsonElement definitions, Dictionary<string, int> counts, CancellationToken ct)
    {
        if (!TrySection(definitions, "registration", out var registration))
        {
            if (!TryProperty(definitions, "registration_settings", out registration) || registration.ValueKind is JsonValueKind.Null) return;
        }
        var settingsElement = TryProperty(registration, "settings", out var nested) ? nested : registration;
        if (settingsElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return;
        var settings = new EventRegistrationSettings
        {
            TenantId = tenantId, EventId = occurrence.Id, Status = Text(settingsElement, "status", "Status") ?? "draft",
            ApprovalMode = Text(settingsElement, "approval_mode", "ApprovalMode") ?? "auto", FormState = "none",
            PerMemberLimit = Integer(settingsElement, "per_member_limit", "PerMemberLimit") ?? 1,
            GuestsEnabled = Boolean(settingsElement, "guests_enabled", "GuestsEnabled"),
            MaxGuestsPerRegistration = Integer(settingsElement, "max_guests_per_registration", "MaxGuestsPerRegistration") ?? 0,
            GuestRetentionDays = Integer(settingsElement, "guest_retention_days", "GuestRetentionDays") ?? 30,
            OpensAtUtc = NullableOffset(settingsElement, occurrence.StartsAt, "opens_offset_seconds", "OpensAtUtc"),
            ClosesAtUtc = NullableOffset(settingsElement, occurrence.StartsAt, "closes_offset_seconds", "ClosesAtUtc"),
            CancellationCutoffAtUtc = NullableOffset(settingsElement, occurrence.StartsAt, "cancellation_cutoff_offset_seconds", "CancellationCutoffAtUtc"),
            EventTimezoneSnapshot = occurrence.Timezone, CreatedBy = actorId, UpdatedBy = actorId,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        db.EventRegistrationSettingsProduct.Add(settings);
        counts["registration_settings"]++;

        JsonElement questions = default;
        var hasQuestions = TryProperty(registration, "published_form", out var form) && form.ValueKind == JsonValueKind.Object &&
                           TryProperty(form, "questions", out questions) && questions.ValueKind == JsonValueKind.Array;
        if (!hasQuestions && TryProperty(definitions, "form_questions", out questions) && questions.ValueKind == JsonValueKind.Array)
        {
            form = default;
            hasQuestions = true;
        }
        if (!hasQuestions) return;
        var formRow = new EventRegistrationFormVersion
        {
            TenantId = tenantId, EventId = occurrence.Id, VersionNumber = 1, Revision = 1, Status = "published",
            Name = form.ValueKind == JsonValueKind.Object ? Text(form, "name", "Name") ?? "Registration form" : "Registration form",
            Description = form.ValueKind == JsonValueKind.Object ? Text(form, "description", "Description") : null,
            DefinitionHash = EventRecurrenceService.Hash(questions.GetRawText()), CreatedBy = actorId, UpdatedBy = actorId,
            PublishedBy = actorId, CreateIdempotencyHash = EventRecurrenceService.Hash($"blueprint|form|{occurrence.OccurrenceKey}"),
            CreateRequestHash = EventRecurrenceService.Hash(questions.GetRawText()), PublishedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        db.EventRegistrationFormVersions.Add(formRow);
        await db.SaveChangesAsync(ct);
        foreach (var item in questions.EnumerateArray())
        {
            db.EventRegistrationFormQuestions.Add(new EventRegistrationFormQuestion
            {
                TenantId = tenantId, EventId = occurrence.Id, FormVersionId = formRow.Id,
                StableKey = RequiredText(item, "stable_key", "StableKey"), Position = Integer(item, "position", "Position") ?? counts["form_questions"],
                QuestionType = Text(item, "question_type", "QuestionType") ?? "short_text", Prompt = RequiredText(item, "prompt", "Prompt"),
                HelpText = Text(item, "help_text", "HelpText"), IsRequired = Boolean(item, "is_required", "IsRequired"),
                DataClassification = Text(item, "data_classification", "DataClassification") ?? "public",
                Purpose = Text(item, "purpose", "Purpose") ?? "event_registration", RetentionDays = Integer(item, "retention_days", "RetentionDays") ?? settings.GuestRetentionDays,
                ChoiceOptions = JsonText(item, "choice_options", "ChoiceOptions"), ValidationRules = JsonText(item, "validation_rules", "ValidationRules"),
                VisibilityRules = JsonText(item, "visibility_rules", "VisibilityRules"), DisplayedText = Text(item, "displayed_text", "DisplayedText"),
                DisplayedTextVersion = Text(item, "displayed_text_version", "DisplayedTextVersion"), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
            });
            counts["form_questions"]++;
        }
        settings.FormState = "published";
        settings.PublishedFormVersionId = formRow.Id;
        settings.PublishedBy = actorId;
        settings.PublishedAt = DateTime.UtcNow;
        counts["published_forms"]++;
    }

    private async Task ApplySafetyAsync(int tenantId, Event occurrence, int actorId, JsonElement definitions, Dictionary<string, int> counts, CancellationToken ct)
    {
        JsonElement requirement;
        if (TrySection(definitions, "safety", out var safety) && TryProperty(safety, "published_requirement", out requirement)) { }
        else if (TryProperty(definitions, "safety_requirements", out var list) && list.ValueKind == JsonValueKind.Array && list.GetArrayLength() > 0)
            requirement = list[0];
        else return;
        if (requirement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return;
        var row = new EventSafetyRequirement
        {
            TenantId = tenantId, EventId = occurrence.Id, Revision = 1, CurrentVersion = 1, PublishedVersion = 1,
            Status = "published", CreatedByUserId = actorId, UpdatedByUserId = actorId, PublishedByUserId = actorId,
            PublishedAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        db.EventSafetyRequirements.Add(row);
        await db.SaveChangesAsync(ct);
        db.EventSafetyRequirementVersions.Add(new EventSafetyRequirementVersion
        {
            TenantId = tenantId, EventId = occurrence.Id, RequirementsId = row.Id, VersionNumber = 1,
            MinimumAge = Integer(requirement, "minimum_age", "MinimumAge"),
            GuardianConsentRequired = Boolean(requirement, "guardian_consent_required", "GuardianConsentRequired"),
            MinorAgeThreshold = Integer(requirement, "minor_age_threshold", "MinorAgeThreshold"),
            CodeOfConductRequired = Boolean(requirement, "code_of_conduct_required", "CodeOfConductRequired"),
            CodeOfConductText = Text(requirement, "code_of_conduct_text", "CodeOfConductText"),
            CodeOfConductTextVersion = Text(requirement, "code_of_conduct_text_version", "CodeOfConductTextVersion"),
            CodeOfConductTextHash = Text(requirement, "code_of_conduct_text_hash", "CodeOfConductTextHash"),
            EligibilityPolicyHash = Text(requirement, "eligibility_policy_hash", "EligibilityPolicyHash") ?? EventRecurrenceService.Hash("{}"),
            CapturedByUserId = actorId, IdempotencyHash = EventRecurrenceService.Hash($"blueprint|safety|{occurrence.OccurrenceKey}"),
            RequestHash = EventRecurrenceService.Hash(requirement.GetRawText()), CreatedAt = DateTime.UtcNow
        });
        counts["safety_requirements"]++;
    }

    private void ApplyStaff(int tenantId, Event occurrence, int actorId, JsonElement definitions, Dictionary<string, int> counts)
    {
        JsonElement staff;
        if (TrySection(definitions, "staff", out var section) && TryProperty(section, "assignments", out staff)) { }
        else if (!TryProperty(definitions, "staff_assignments", out staff)) return;
        if (staff.ValueKind != JsonValueKind.Array) return;
        foreach (var item in staff.EnumerateArray())
        {
            db.EventStaffAssignments.Add(new EventStaffAssignment
            {
                TenantId = tenantId, EventId = occurrence.Id, UserId = Integer(item, "user_id", "UserId") ?? throw new InvalidOperationException("event_recurrence_definition_manifest_invalid"),
                Role = Text(item, "role", "Role") ?? "check_in_staff", Status = "active", AssignmentVersion = 1,
                GrantedAt = DateTime.UtcNow, GrantedBy = actorId,
                ExpiresAt = NullableOffset(item, occurrence.StartsAt, "expires_offset_seconds", "ExpiresAt"),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
            });
            counts["staff_assignments"]++;
        }
    }

    private static bool SectionArray(JsonElement definitions, string sectionName, string arrayName, out JsonElement array)
    {
        if (TrySection(definitions, sectionName, out var section) && TryProperty(section, arrayName, out array) && array.ValueKind == JsonValueKind.Array) return true;
        array = default;
        return false;
    }
    private static bool TrySection(JsonElement definitions, string name, out JsonElement section) => TryProperty(definitions, name, out section) && section.ValueKind == JsonValueKind.Object;
    private static Dictionary<string, bool> ReadSections(string json) { try { return JsonSerializer.Deserialize<Dictionary<string, bool>>(json) ?? []; } catch { return []; } }
    private static Dictionary<string, int> ReadCounts(string json) { try { return JsonSerializer.Deserialize<Dictionary<string, int>>(json) ?? EmptyCounts(); } catch { return EmptyCounts(); } }
    private static Dictionary<string, int> EmptyCounts() => new(StringComparer.Ordinal) { ["sessions"] = 0, ["speakers"] = 0, ["resources"] = 0, ["ticket_types"] = 0, ["registration_settings"] = 0, ["published_forms"] = 0, ["form_questions"] = 0, ["safety_requirements"] = 0, ["staff_assignments"] = 0 };
    private static bool TryProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var property in element.EnumerateObject())
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)) { value = property.Value; return true; }
        value = default; return false;
    }
    private static string RequiredText(JsonElement item, params string[] names) => Text(item, names) ?? throw new InvalidOperationException("event_recurrence_definition_manifest_invalid");
    private static string? Text(JsonElement item, params string[] names) { foreach (var name in names) if (TryProperty(item, name, out var value) && value.ValueKind == JsonValueKind.String) return value.GetString(); return null; }
    private static int? Integer(JsonElement item, params string[] names) { foreach (var name in names) if (TryProperty(item, name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var result)) return result; return null; }
    private static long? Number(JsonElement item, params string[] names) { foreach (var name in names) if (TryProperty(item, name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var result)) return result; return null; }
    private static decimal Decimal(JsonElement item, params string[] names) { foreach (var name in names) if (TryProperty(item, name, out var value) && (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var result) || value.ValueKind == JsonValueKind.String && decimal.TryParse(value.GetString(), out result))) return result; return 0; }
    private static bool Boolean(JsonElement item, params string[] names) { foreach (var name in names) if (TryProperty(item, name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False) return value.GetBoolean(); return false; }
    private static string? JsonText(JsonElement item, params string[] names) { foreach (var name in names) if (TryProperty(item, name, out var value) && value.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)) return value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText(); return null; }
    private static long OffsetFromAbsolute(JsonElement item, string name, DateTime anchor) => TryProperty(item, name, out var value) && value.TryGetDateTime(out var date) ? (long)(date.ToUniversalTime() - anchor).TotalSeconds : 0;
    private static long DurationFromAbsolute(JsonElement item, string startName, string endName) => TryProperty(item, startName, out var start) && TryProperty(item, endName, out var end) && start.TryGetDateTime(out var startDate) && end.TryGetDateTime(out var endDate) ? (long)(endDate - startDate).TotalSeconds : 0;
    private static DateTime? NullableOffset(JsonElement item, DateTime anchor, string offsetName, string absoluteName) => Number(item, offsetName) is long offset ? anchor.AddSeconds(offset) : TryProperty(item, absoluteName, out var value) && value.TryGetDateTime(out var date) ? date.ToUniversalTime() : null;
}
