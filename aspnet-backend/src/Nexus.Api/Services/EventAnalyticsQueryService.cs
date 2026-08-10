// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventAnalyticsError(string Code, string Message, int Status);
public sealed record EventAnalyticsResult(object? Data, EventAnalyticsError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class EventAnalyticsQueryService(NexusDbContext db, IConfiguration configuration)
{
    private sealed record PrivacyCountValue(int? value, bool suppressed);

    public async Task<EventAnalyticsResult> SummaryAsync(
        int tenantId,
        int eventId,
        int actorId,
        string accessScope,
        CancellationToken ct)
    {
        if (accessScope is not ("organizer_summary" or "csv_export")) return Invalid();

        var tenantAvailable = await db.Tenants.AsNoTracking().AnyAsync(x => x.Id == tenantId && x.IsActive, ct);
        if (!tenantAvailable) return Unavailable();

        var actor = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == actorId && x.IsActive, ct);
        var evt = await db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (actor is null || evt is null || !await CanManageAsync(tenantId, evt, actor, ct)) return NotFound();

        var threshold = Math.Max(5, configuration.GetValue("Events:Analytics:PrivacyThreshold", 5));
        var generatedAt = new DateTime(DateTime.UtcNow.Ticks / TimeSpan.TicksPerSecond * TimeSpan.TicksPerSecond, DateTimeKind.Utc);

        var registrations = await CountsAsync(
            db.EventRegistrations.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId),
            x => x.RegistrationState,
            ct);
        var registrationTransitions = await CountsAsync(
            db.EventRegistrationHistory.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId),
            x => x.Action,
            ct);
        var waitlist = await CountsAsync(
            db.EventWaitlistEntries.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId),
            x => x.QueueState,
            ct);
        var waitlistTransitions = await CountsAsync(
            db.EventWaitlistEntryHistory.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId),
            x => x.Action,
            ct);

        var attendanceRows = await db.EventAttendance.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId)
            .Select(x => new { x.AttendanceStatus, x.CheckedInAt, x.CheckedOutAt })
            .ToListAsync(ct);
        var checkedIn = attendanceRows.Count(x => x.AttendanceStatus == "checked_in" || x.AttendanceStatus == null && x.CheckedInAt != null && x.CheckedOutAt == null);
        var checkedOut = attendanceRows.Count(x => x.AttendanceStatus == "checked_out" || x.AttendanceStatus == null && x.CheckedOutAt != null);
        var attended = attendanceRows.Count(x => x.AttendanceStatus == "attended");
        var noShow = attendanceRows.Count(x => x.AttendanceStatus == "no_show");

        var claims = await db.EventAttendanceCreditClaims.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId)
            .ToListAsync(ct);
        var completedClaims = claims.Where(x => x.Status == "completed").ToList();

        var deliveryRows = await (
            from delivery in db.EventNotificationDeliveries.IgnoreQueryFilters().AsNoTracking()
            join outbox in db.EventDomainOutbox.IgnoreQueryFilters().AsNoTracking()
                on new { delivery.TenantId, Id = delivery.OutboxId } equals new { outbox.TenantId, outbox.Id }
            where delivery.TenantId == tenantId && outbox.EventId == eventId
            select new { delivery.Channel, delivery.Status }).ToListAsync(ct);
        var communications = CommunicationCounts(deliveryRows.Select(x => (x.Channel, x.Status)));

        var optionalCounts = await db.EventAnalyticsOptionalFacts.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId && x.Status == "active")
            .GroupBy(x => x.Metric)
            .Select(x => new { Metric = x.Key, Count = x.Count() })
            .ToDictionaryAsync(x => x.Metric, x => x.Count, StringComparer.Ordinal, ct);
        var eventViews = PrivacyCount(optionalCounts.GetValueOrDefault("event_viewed"), threshold);
        var registrationStarts = PrivacyCount(optionalCounts.GetValueOrDefault("registration_started"), threshold);

        var invitationCounts = await CountsAsync(
            db.EventInvitations.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId),
            x => x.Status,
            ct);
        var invitationIssued = invitationCounts.Values.Sum();
        var invitationAccepted = invitationCounts.GetValueOrDefault("accepted");

        var canViewFinance = IsAdmin(actor) || evt.CreatedById == actorId || await HasActiveStaffRoleAsync(tenantId, eventId, actorId, "finance_manager", ct);
        object tickets;
        if (!canViewFinance)
        {
            tickets = new { available = true, redacted = true, confirmed_entitlements = (int?)null, confirmed_units = (int?)null, cancelled_units = (int?)null, confirmed_credit_value = (string?)null };
        }
        else
        {
            var entitlements = await db.EventTicketEntitlements.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.EventId == eventId).ToListAsync(ct);
            tickets = new
            {
                available = true,
                redacted = false,
                confirmed_entitlements = entitlements.Count(x => x.Status == "confirmed"),
                confirmed_units = entitlements.Where(x => x.Status == "confirmed").Sum(x => x.Units),
                cancelled_units = entitlements.Where(x => x.Status == "cancelled").Sum(x => x.Units),
                confirmed_credit_value = Money(entitlements.Where(x => x.Status == "confirmed").Sum(x => x.TotalPriceCreditsSnapshot))
            };
        }

        var guardianCount = await db.EventGuardianConsents.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Status == "active", ct);
        var confirmed = registrations.GetValueOrDefault("confirmed");
        var pending = registrations.GetValueOrDefault("pending");
        var waitlistJoined = waitlistTransitions.GetValueOrDefault("joined");
        var waitlistAccepted = waitlistTransitions.GetValueOrDefault("accepted");
        var attendanceOutcomes = attended + checkedOut;
        var capacityLimit = evt.MaxAttendees is null ? (int?)null : Math.Max(0, evt.MaxAttendees.Value);

        var summary = new
        {
            contract_version = 1,
            event_id = eventId,
            event_title = evt.Title,
            generated_at = generatedAt.ToString("O"),
            privacy_threshold = threshold,
            registration = new
            {
                capacity_limit = capacityLimit,
                confirmed,
                pending,
                invited = registrations.GetValueOrDefault("invited"),
                declined = registrations.GetValueOrDefault("declined"),
                cancelled = registrations.GetValueOrDefault("cancelled"),
                remaining = capacityLimit is null ? (int?)null : Math.Max(0, capacityLimit.Value - confirmed),
                completion_transitions = registrationTransitions.GetValueOrDefault("confirmed"),
                cancellation_transitions = registrationTransitions.GetValueOrDefault("cancelled")
            },
            invitation = new
            {
                available = true,
                issued = invitationIssued,
                accepted = invitationAccepted,
                revoked = invitationCounts.GetValueOrDefault("revoked"),
                expired = invitationCounts.GetValueOrDefault("expired"),
                conversion = Rate(invitationAccepted, invitationIssued)
            },
            waitlist = new
            {
                current_waiting = waitlist.GetValueOrDefault("waiting"),
                current_offered = waitlist.GetValueOrDefault("offered"),
                joined = waitlistJoined,
                offered = waitlistTransitions.GetValueOrDefault("offered"),
                accepted = waitlistAccepted,
                expired = waitlistTransitions.GetValueOrDefault("expired"),
                cancelled = waitlistTransitions.GetValueOrDefault("cancelled"),
                conversion = Rate(waitlistAccepted, waitlistJoined)
            },
            attendance = new { checked_in = checkedIn, checked_out = checkedOut, attended, no_show = noShow, attendance_rate = Rate(attendanceOutcomes, attendanceOutcomes + noShow) },
            tickets,
            credits = new
            {
                completed_claims = completedClaims.Count,
                completed_amount = Money(completedClaims.Sum(x => x.Amount)),
                pending_claims = claims.Count(x => x.Status == "pending"),
                failed_claims = claims.Count(x => x.Status == "failed"),
                reversed_claims = claims.Count(x => x.Status == "reversed")
            },
            communications,
            optional_funnel = new
            {
                event_views = eventViews,
                registration_starts = registrationStarts,
                start_to_registration_conversion = registrationStarts.suppressed
                    ? SuppressedRate(confirmed)
                    : Rate(confirmed, registrationStarts.value ?? 0)
            },
            safeguarding = new { available = true, guardian_consents = PrivacyCount(guardianCount, threshold) }
        };

        var (resultCount, suppressedCount) = AuditCounts(JsonSerializer.SerializeToElement(summary));
        db.EventAnalyticsAccessAudits.Add(new EventAnalyticsAccessAudit
        {
            TenantId = tenantId,
            EventId = eventId,
            ActorUserId = actorId,
            AccessScope = accessScope,
            PurposeCode = accessScope == "csv_export" ? "csv_export" : "dashboard_view",
            QueryHash = Hash($"event-analytics:v1:{accessScope}:{eventId}"),
            ResultCount = Math.Max(resultCount, suppressedCount),
            SuppressedCount = suppressedCount,
            PrivacyThreshold = threshold,
            CreatedAt = generatedAt
        });
        await db.SaveChangesAsync(ct);
        return new(summary);
    }

    private async Task<bool> CanManageAsync(int tenantId, Event evt, User actor, CancellationToken ct)
    {
        if (IsAdmin(actor) || evt.CreatedById == actor.Id) return true;
        if (await HasActiveStaffRoleAsync(tenantId, evt.Id, actor.Id, "co_organizer", ct)) return true;
        if (evt.GroupId is not int groupId) return false;
        return await db.GroupMembers.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
            x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active" && (x.Role == "owner" || x.Role == "admin"), ct);
    }

    private Task<bool> HasActiveStaffRoleAsync(int tenantId, int eventId, int actorId, string role, CancellationToken ct) =>
        db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
            x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId && x.Role == role && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);

    private static async Task<Dictionary<string, int>> CountsAsync<T>(IQueryable<T> query, System.Linq.Expressions.Expression<Func<T, string>> key, CancellationToken ct) where T : class =>
        await query.AsNoTracking().GroupBy(key).Select(x => new { Key = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, StringComparer.Ordinal, ct);

    private static object CommunicationCounts(IEnumerable<(string Channel, string Status)> rows)
    {
        static Dictionary<string, int> Empty() => new(StringComparer.Ordinal) { ["pending"] = 0, ["delivered"] = 0, ["suppressed"] = 0, ["failed"] = 0, ["dead_lettered"] = 0 };
        var totals = Empty();
        var channels = new SortedDictionary<string, Dictionary<string, int>>(StringComparer.Ordinal);
        foreach (var (channel, rawStatus) in rows)
        {
            var status = rawStatus switch
            {
                "processing" or "claimed" or "retry" or "retrying" => "pending",
                "failed_terminal" => "dead_lettered",
                "pending" or "delivered" or "suppressed" or "failed" or "dead_lettered" => rawStatus,
                _ => "failed"
            };
            if (!channels.TryGetValue(channel, out var channelCounts)) channels[channel] = channelCounts = Empty();
            totals[status]++;
            channelCounts[status]++;
        }
        var rate = Rate(totals["delivered"], totals["delivered"] + totals["failed"] + totals["dead_lettered"]);
        return new { pending = totals["pending"], delivered = totals["delivered"], suppressed = totals["suppressed"], failed = totals["failed"], dead_lettered = totals["dead_lettered"], delivery_rate = rate, by_channel = channels };
    }

    private static PrivacyCountValue PrivacyCount(int value, int threshold) =>
        value > 0 && value < threshold ? new(null, true) : new(value, false);

    private static object Rate(int numerator, int denominator) => new
    {
        numerator = Math.Max(0, numerator),
        denominator = Math.Max(0, denominator),
        basis_points = denominator > 0 ? (int?)Math.Round((decimal)Math.Max(0, numerator) / denominator * 10_000m, MidpointRounding.AwayFromZero) : null,
        suppressed = false
    };

    private static object SuppressedRate(int numerator) => new { numerator = Math.Max(0, numerator), denominator = 0, basis_points = (int?)null, suppressed = true };
    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static (int Results, int Suppressed) AuditCounts(JsonElement value)
    {
        var results = 0;
        var suppressed = 0;
        void Walk(JsonElement node)
        {
            if (node.ValueKind != JsonValueKind.Object && node.ValueKind != JsonValueKind.Array) return;
            if (node.ValueKind == JsonValueKind.Object && node.TryGetProperty("suppressed", out var flag) && flag.ValueKind == JsonValueKind.True) suppressed++;
            foreach (var child in node.EnumerateObjectOrArray())
            {
                if (child.ValueKind == JsonValueKind.Number && child.TryGetInt32(out var count) && count >= 0) results++;
                else Walk(child);
            }
        }
        Walk(value);
        return (results, suppressed);
    }

    private static bool IsAdmin(User user) => user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod || user.Role is "admin" or "super_admin" or "god";
    private static EventAnalyticsResult NotFound() => new(null, new("EVENT_ANALYTICS_NOT_FOUND", "Event not found", 404));
    private static EventAnalyticsResult Unavailable() => new(null, new("EVENT_ANALYTICS_UNAVAILABLE", "Service unavailable", 503));
    private static EventAnalyticsResult Invalid() => new(null, new("EVENT_ANALYTICS_INVALID", "Invalid input", 422));
}

internal static class EventAnalyticsJsonExtensions
{
    public static IEnumerable<JsonElement> EnumerateObjectOrArray(this JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().Select(x => x.Value),
        JsonValueKind.Array => value.EnumerateArray(),
        _ => []
    };
}
