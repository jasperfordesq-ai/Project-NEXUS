// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventFederationStatusError(string Code, string Message, int Status);
public sealed record EventFederationStatusResult(object? Data, EventFederationStatusError? Error = null) { public bool Succeeded => Error is null; }

public sealed class EventFederationStatusService(NexusDbContext db)
{
    private static readonly string[] Statuses = ["pending", "retry", "processing", "delivered", "dead_letter"];
    private const short MaxAttempts = 5;

    public async Task EnqueueLifecycleAsync(Event evt, CancellationToken ct)
    {
        var action = Eligible(evt) ? "upsert" : "tombstone";
        var nextVersion = Math.Max(evt.FederationVersion + 1, Math.Max(1, Math.Max(evt.LifecycleVersion, evt.CalendarSequence)));
        evt.FederationVersion = nextVersion;

        var activeIds = await db.FederationExternalPartners.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == evt.TenantId && x.ProtocolType == "nexus" && x.Status == "active" && x.AllowEvents)
            .Select(x => x.Id).ToListAsync(ct);
        IEnumerable<int> recipientIds = activeIds;
        if (action == "tombstone")
        {
            var priorIds = await db.EventFederationDeliveries.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == evt.TenantId && x.EventId == evt.Id)
                .Select(x => x.ExternalPartnerId).Distinct().ToListAsync(ct);
            recipientIds = activeIds.Concat(priorIds).Distinct();
        }

        var now = DateTime.UtcNow;
        foreach (var partnerId in recipientIds.OrderBy(x => x))
        {
            var payload = JsonSerializer.Serialize(new
            {
                contract_version = 1,
                event_id = evt.Id,
                action,
                aggregate_version = nextVersion,
                calendar_version = Math.Max(0, evt.CalendarSequence),
                visibility = NormalizeVisibility(evt.FederatedVisibility),
                publication_status = evt.PublicationStatus,
                operational_status = evt.OperationalStatus,
                occurred_at = now.ToString("O")
            });
            var payloadHash = Hash(payload);
            var identity = Hash($"event-federation:v1:{evt.TenantId}:{evt.Id}:{partnerId}:{nextVersion}:{evt.CalendarSequence}:{action}");
            var exists = await db.EventFederationDeliveries.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(x => x.TenantId == evt.TenantId && x.ExternalPartnerId == partnerId && x.IdempotencyKey == identity, ct);
            if (exists) continue;
            db.EventFederationDeliveries.Add(new EventFederationDelivery
            {
                TenantId = evt.TenantId,
                EventId = evt.Id,
                ExternalPartnerId = partnerId,
                PayloadSchemaVersion = 1,
                EventAggregateVersion = nextVersion,
                EventCalendarVersion = Math.Max(0, evt.CalendarSequence),
                Action = action,
                IdempotencyKey = identity,
                PayloadHash = payloadHash,
                Payload = payload,
                Status = "pending",
                AvailableAt = now,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
    }

    public async Task<EventFederationStatusResult> ReadAsync(int tenant, int eventId, int actorId, CancellationToken ct)
    {
        var evt = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == eventId, ct);
        if (evt is null) return Missing();
        var actor = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == actorId && x.IsActive, ct);
        if (actor is null || !await CanManageAsync(tenant, evt, actor, ct)) return Forbidden();

        var deliveries = db.EventFederationDeliveries.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.EventId == eventId);
        var counts = Statuses.ToDictionary(x => x, _ => 0, StringComparer.Ordinal);
        foreach (var group in await deliveries.GroupBy(x => x.Status).Select(x => new { Status = x.Key, Count = x.Count() }).ToListAsync(ct))
            if (counts.ContainsKey(group.Status)) counts[group.Status] = group.Count;
        var latestIds = await deliveries.GroupBy(x => x.ExternalPartnerId).Select(x => x.Max(y => y.Id)).ToListAsync(ct);
        var latest = latestIds.Count == 0 ? [] : await db.EventFederationDeliveries.IgnoreQueryFilters().AsNoTracking()
            .Where(x => latestIds.Contains(x.Id)).OrderBy(x => x.ExternalPartnerId).ToListAsync(ct);
        var partnerIds = latest.Select(x => x.ExternalPartnerId).Distinct().ToArray();
        var partners = await db.FederationExternalPartners.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && partnerIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var configured = await db.FederationExternalPartners.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(x => x.TenantId == tenant && x.ProtocolType == "nexus" && x.Status == "active" && x.AllowEvents, ct);
        var rows = latest.Select(x =>
        {
            partners.TryGetValue(x.ExternalPartnerId, out var partner);
            return new
            {
                partner_id = x.ExternalPartnerId,
                partner_name = partner?.Name,
                partner_status = partner?.Status ?? "removed",
                events_enabled = partner?.AllowEvents ?? false,
                action = x.Action,
                delivery_status = x.Status,
                attempts = Math.Max(0, (int)x.Attempts),
                max_attempts = MaxAttempts,
                aggregate_version = Math.Max(0, x.EventAggregateVersion),
                calendar_version = Math.Max(0, x.EventCalendarVersion),
                available_at = Iso(x.AvailableAt),
                next_attempt_at = Iso(x.NextAttemptAt),
                last_attempt_at = Iso(x.LastAttemptAt),
                delivered_at = Iso(x.DeliveredAt),
                dead_lettered_at = Iso(x.DeadLetteredAt),
                error_code = SafeCode(x.LastErrorCode)
            };
        }).ToArray();
        var health = counts["dead_letter"] > 0 ? "degraded"
            : counts["retry"] + counts["processing"] + counts["pending"] > 0 ? "delivering"
            : rows.Length > 0 && rows.All(x => x.action == "tombstone") ? "withdrawn"
            : configured == 0 ? "not_configured" : "healthy";
        return new(new
        {
            contract_version = 1,
            event_id = eventId,
            federation_version = Math.Max(1, evt.FederationVersion),
            visibility = NormalizeVisibility(evt.FederatedVisibility),
            configured_partners = configured,
            recipient_partners = rows.Length,
            health,
            counts,
            partners = rows,
            generated_at = DateTime.UtcNow.ToString("O")
        });
    }

    private async Task<bool> CanManageAsync(int tenant, Event evt, User actor, CancellationToken ct)
    {
        if (actor.Id == evt.CreatedById || IsAdmin(actor)) return true;
        return evt.GroupId is int groupId && await db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(x => x.TenantId == tenant && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active" && (x.Role == "owner" || x.Role == "admin"), ct);
    }
    private static bool Eligible(Event evt) => evt.FederatedVisibility is "listed" or "joinable" && evt.PublicationStatus == "published" && evt.OperationalStatus is "scheduled" or "postponed";
    private static string NormalizeVisibility(string? value) => value is "listed" or "joinable" ? value : "none";
    private static bool IsAdmin(User x) => x.IsAdmin || x.IsSuperAdmin || x.IsTenantSuperAdmin || x.IsGod || x.Role is "admin" or "tenant_admin" or "super_admin" or "god";
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string? Iso(DateTime? value) => value?.ToUniversalTime().ToString("O");
    private static string? SafeCode(string? value) { var code = value?.Trim().ToUpperInvariant(); return code is not null && code.Length is > 0 and <= 64 && code.All(x => char.IsAsciiLetterOrDigit(x) || x is '_' or '-') ? code : null; }
    private static EventFederationStatusResult Missing() => new(null, new("EVENT_NOT_FOUND", "Event not found", 404));
    private static EventFederationStatusResult Forbidden() => new(null, new("EVENT_FEDERATION_FORBIDDEN", "Forbidden", 403));
}
