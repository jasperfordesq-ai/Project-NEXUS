// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>Builds the runtime-validated Events v2 detail contract.</summary>
public sealed class EventContractProjectionService(NexusDbContext db)
{
    public async Task<object?> DetailAsync(int tenantId, int eventId, int viewerId, CancellationToken ct)
    {
        var evt = await db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        var viewer = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == viewerId && x.IsActive, ct);
        if (evt is null || viewer is null) return null;

        var organizer = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == evt.CreatedById, ct);
        var group = evt.GroupId is int groupId
            ? await db.Groups.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId, ct)
            : null;
        var category = evt.CategoryId is int categoryId
            ? await db.Categories.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == categoryId, ct)
            : null;

        var canonical = await db.EventRegistrations.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId && x.CapacityPoolKey == "event")
            .ToListAsync(ct);
        var legacy = await db.EventRsvps.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId).ToListAsync(ct);
        var waitlist = await db.EventWaitlistEntries.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId && x.CapacityPoolKey == "event")
            .OrderBy(x => x.QueueSequence).ThenBy(x => x.Id).ToListAsync(ct);
        var attendance = await db.EventAttendance.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == viewerId, ct);

        var canonicalUsers = canonical.Select(x => x.UserId).ToHashSet();
        var confirmed = canonical.Where(x => x.RegistrationState == "confirmed").Sum(x => Math.Max(1, x.PartySize))
            + legacy.Count(x => !canonicalUsers.Contains(x.UserId) && x.Status is "going" or "attended");
        var interested = legacy.Count(x => x.Status is "interested" or "maybe");
        var activeWaitlist = waitlist.Where(x => x.QueueState is "waiting" or "offered").ToList();
        var ownRegistration = canonical.OrderByDescending(x => x.Id).FirstOrDefault(x => x.UserId == viewerId);
        var ownLegacy = legacy.OrderByDescending(x => x.Id).FirstOrDefault(x => x.UserId == viewerId);
        var ownWaitlist = activeWaitlist.FirstOrDefault(x => x.UserId == viewerId);
        var registrationState = ownWaitlist?.QueueState == "offered" ? "offered"
            : ownWaitlist is not null ? "waitlisted"
            : ownRegistration?.RegistrationState ?? LegacyRegistration(ownLegacy?.Status);
        var waitlistPosition = ownWaitlist is null ? (int?)null : activeWaitlist.FindIndex(x => x.Id == ownWaitlist.Id) + 1;

        var isAdmin = IsAdmin(viewer);
        var canManage = await CanManageAsync(tenantId, evt, viewer, group, isAdmin, ct);
        var moderationRequired = await ModerationRequiredAsync(tenantId, ct);
        var recurrenceRootId = evt.IsRecurringTemplate ? evt.Id : evt.ParentEventId;
        var recurrenceRule = recurrenceRootId is int rootId
            ? await db.EventRecurrenceRules.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == rootId, ct)
            : null;
        var recurrenceRows = recurrenceRootId is int recurrenceRoot
            ? await db.Events.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.ParentEventId == recurrenceRoot && x.RecurrenceId != null)
                .OrderBy(x => x.StartsAt).ThenBy(x => x.Id)
                .Select(x => new { x.Id, x.StartsAt })
                .ToListAsync(ct)
            : [];
        var recurrenceOccurrences = recurrenceRows.Select(x => new { id = x.Id, start_at = Iso(x.StartsAt), date = x.StartsAt.ToUniversalTime().ToString("yyyy-MM-dd") }).ToArray();
        var isFull = evt.MaxAttendees is int limit && confirmed >= limit;
        var registrable = evt.PublicationStatus == "published" && evt.OperationalStatus == "scheduled" && evt.StartsAt > DateTime.UtcNow;
        var canParticipate = !canManage && registrable;
        var hasRegistration = registrationState is "invited" or "pending" or "confirmed";
        var mode = evt.AllowRemoteAttendance ? "hybrid" : evt.IsOnline ? "online" : "in_person";

        return new
        {
            contract_version = 2,
            id = evt.Id,
            title = evt.Title,
            description = Clean(evt.Description),
            primary_image = string.IsNullOrWhiteSpace(evt.ImageUrl) ? null : new { url = evt.ImageUrl, alt_text = evt.Title },
            organizer = new
            {
                id = evt.CreatedById,
                display_name = Name(organizer),
                avatar_url = organizer?.AvatarUrl,
                relationship = evt.CreatedById == viewerId ? "self" : "member",
                actions = new { view_profile = organizer is not null, message = organizer is not null && organizer.Id != viewerId }
            },
            category = category is null ? null : new { id = (int?)category.Id, name = Clean(category.Name), slug = Clean(category.Slug), colour = (string?)null },
            location = new
            {
                label = Clean(evt.Location), latitude = evt.Latitude, longitude = evt.Longitude, mode,
                accessibility = new
                {
                    step_free = evt.AccessibilityStepFree, accessible_toilet = evt.AccessibilityToilet,
                    hearing_loop = evt.AccessibilityHearingLoop, quiet_space = evt.AccessibilityQuietSpace,
                    seating = evt.AccessibilitySeating, accessible_parking = evt.AccessibilityParking,
                    parking_details = Clean(evt.AccessibilityParkingDetails), transit_details = Clean(evt.AccessibilityTransitDetails),
                    assistance_contact = Clean(evt.AccessibilityAssistanceContact), notes = Clean(evt.AccessibilityNotes)
                }
            },
            schedule = new
            {
                start_at = Iso(evt.StartsAt), end_at = Iso(evt.EndsAt), timezone = Clean(evt.Timezone) ?? "UTC",
                all_day = evt.AllDay, state = ScheduleState(evt), publication_state = evt.PublicationStatus,
                operational_state = evt.OperationalStatus, lifecycle_version = evt.LifecycleVersion,
                cancellation_reason = Clean(evt.CancellationReason)
            },
            relationship = new
            {
                engagement = new { state = ownLegacy?.Status is "interested" or "maybe" ? "interested" : "none", can_change = canParticipate },
                registration = new
                {
                    state = registrationState, waitlist_position = waitlistPosition,
                    can_register = canParticipate && !hasRegistration && ownWaitlist is null && !isFull,
                    can_withdraw = registrationState is "invited" or "pending" or "confirmed",
                    can_join_waitlist = canParticipate && !hasRegistration && ownWaitlist is null && isFull,
                    can_leave_waitlist = ownWaitlist is not null
                },
                attendance = new
                {
                    state = AttendanceState(attendance), checked_in_at = Iso(attendance?.CheckedInAt),
                    checked_out_at = Iso(attendance?.CheckedOutAt)
                },
                capacity = new
                {
                    limit = evt.MaxAttendees, confirmed,
                    remaining = evt.MaxAttendees is int capacity ? Math.Max(0, capacity - confirmed) : (int?)null,
                    is_full = isFull, waitlist_count = activeWaitlist.Count
                }
            },
            online_access = new
            {
                mode, reveal_state = mode == "in_person" ? "not_applicable" : "not_configured",
                join_url = (string?)null, video_url = (string?)null, reveal_at = (string?)null, expires_at = (string?)null
            },
            series = new
            {
                named = (object?)null,
                recurrence = recurrenceRule is null ? null : new
                {
                    parent_event_id = evt.ParentEventId, root_event_id = recurrenceRootId ?? 0,
                    is_template = evt.IsRecurringTemplate, frequency = recurrenceRule.Frequency,
                    interval = recurrenceRule.Interval, rrule = recurrenceRule.RRule,
                    recurrence_id = evt.RecurrenceId, engine = evt.RecurrenceEngine,
                    engine_version = evt.RecurrenceEngineVersion,
                    occurrence_count = recurrenceOccurrences.Length, occurrences = recurrenceOccurrences
                }
            },
            permissions = new
            {
                edit = canManage && evt.PublicationStatus != "pending_review", cancel = canManage,
                manage_people = canManage, check_in = canManage, message = canManage, export = canManage,
                publish = canManage && evt.PublicationStatus is "draft" or "pending_review" && (!moderationRequired || isAdmin),
                submit_for_review = canManage && evt.PublicationStatus == "draft" && moderationRequired && !isAdmin,
                manage_agenda = canManage, manage_staff = canManage, manage_registration = canManage,
                broadcast = canManage, manage_finance = isAdmin || evt.CreatedById == viewerId,
                reconcile_credits = isAdmin || evt.CreatedById == viewerId,
                reconcile_tickets = isAdmin || evt.CreatedById == viewerId,
                transfer_ownership = isAdmin || evt.CreatedById == viewerId
            },
            metrics = new { confirmed_count = confirmed, interested_count = interested, waitlist_count = activeWaitlist.Count },
            created_at = Iso(evt.CreatedAt), updated_at = Iso(evt.UpdatedAt),
            group = group is null ? null : new { id = group.Id, name = group.Name, slug = (string?)null }
        };
    }

    private async Task<bool> CanManageAsync(int tenantId, Event evt, User viewer, Group? group, bool isAdmin, CancellationToken ct)
    {
        if (evt.GroupId is int groupId)
        {
            if (group is null || !group.IsActive || group.Status != "active") return false;
            if (!isAdmin && group.CreatedById != viewer.Id && !await db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == viewer.Id && x.Status == "active", ct))
                return false;
        }
        if (isAdmin || evt.CreatedById == viewer.Id) return true;
        return await db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
            x.TenantId == tenantId && x.EventId == evt.Id && x.UserId == viewer.Id && x.Role == "co_organizer"
            && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);
    }

    private async Task<bool> ModerationRequiredAsync(int tenantId, CancellationToken ct)
    {
        var values = await db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && (x.Key == "moderation.enabled" || x.Key == "moderation.require_event"))
            .ToDictionaryAsync(x => x.Key, x => x.Value, ct);
        return values.TryGetValue("moderation.enabled", out var enabled) && StoredBoolean(enabled)
            && values.TryGetValue("moderation.require_event", out var required) && StoredBoolean(required);
    }

    private static string LegacyRegistration(string? status) => status switch
    {
        "going" or "attended" => "confirmed", "invited" => "invited", "waitlisted" => "waitlisted",
        "declined" or "not_going" => "declined", "cancelled" => "cancelled", _ => "none"
    };
    private static string AttendanceState(EventAttendance? row) => row?.AttendanceStatus switch
    {
        "checked_in" => "checked_in", "checked_out" => "checked_out", "attended" => "attended", "no_show" => "no_show", _ => "not_checked_in"
    };
    private static string ScheduleState(Event evt)
    {
        if (evt.PublicationStatus is "draft" or "pending_review" or "archived") return evt.PublicationStatus;
        if (evt.OperationalStatus != "scheduled") return evt.OperationalStatus;
        var now = DateTime.UtcNow;
        if (now < evt.StartsAt) return "upcoming";
        return now <= (evt.EndsAt ?? evt.StartsAt) ? "ongoing" : "ended";
    }
    private static bool IsAdmin(User user) => user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod
        || user.Role is "admin" or "super_admin" or "tenant_admin" or "god";
    private static bool StoredBoolean(string? value) => value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string? Name(User? user) => user is null ? null : Clean($"{user.FirstName} {user.LastName}");
    private static string Iso(DateTime value) => value.ToUniversalTime().ToString("O");
    private static string? Iso(DateTime? value) => value is null ? null : Iso(value.Value);
}
