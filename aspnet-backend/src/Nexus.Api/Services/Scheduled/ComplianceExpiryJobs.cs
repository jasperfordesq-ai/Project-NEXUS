// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Scheduled;

// ─────────────────────────────────────────────────────────────────────────────
// Compliance expiry jobs.
//
// 🔴 The 2026-08-15 audit found only 17 of Laravel's 71 scheduled units had any
// counterpart here (R-6). These two are from the compliance cluster — the group
// where "nothing runs" means a record quietly stays true after it should have
// stopped being true.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Expires prepared support actions and notifies the supporter who prepared them.
///
/// Laravel: <c>support-actions:expire</c>, daily
/// (bootstrap/app.php:57, ExpireSupportActions), whose stated purpose is that
/// "the supporter is notified so an expiry is never silent".
///
/// 🔴 This backend already refused to execute an expired action — the read and
/// execute paths filter on <c>ExpiresAt &gt; now</c> — so nothing unsafe could
/// happen. But the row stayed "pending" for ever and nobody was told, so a
/// supporter who prepared something for a member simply never learned it had
/// lapsed. That gap was in work delivered on 2026-08-14; this closes it.
/// </summary>
public class SupportActionExpiryJob : ScheduledHostedService
{
    public SupportActionExpiryJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<SupportActionExpiryJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "SupportActionExpiry";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(24);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(6);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var db = services.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;

        var lapsed = await db.Set<SupportPendingAction>()
            .Where(a => a.TenantId == tenantId
                && a.Status == SupportPendingAction.StatusPending
                && a.ExpiresAt <= now)
            .ToListAsync(ct);

        if (lapsed.Count == 0) return;

        foreach (var action in lapsed)
        {
            action.Status = SupportPendingAction.StatusExpired;
            action.UpdatedAt = now;
        }

        // Tell the supporter who prepared each one. This is the whole point of
        // the job — an expiry that nobody hears about is the failure being fixed.
        var notifications = lapsed.Select(action => new Notification
        {
            TenantId = tenantId,
            UserId = action.SupporterUserId,
            Type = "support_action_expired",
            Title = "A prepared action expired",
            Body = "An action you prepared for someone you support expired before it was confirmed.",
            IsRead = false,
            CreatedAt = now,
        });
        db.Set<Notification>().AddRange(notifications);

        await db.SaveChangesAsync(ct);

        Logger.LogInformation(
            "SupportActionExpiry tenant={TenantId} expired={Count} (supporters notified)",
            tenantId, lapsed.Count);
    }
}

/// <summary>
/// Lifts safeguarding monitoring once its expiry has passed.
///
/// Laravel: <c>safeguarding:clear-expired-monitoring</c>, daily
/// (bootstrap/app.php:49).
///
/// 🔴 With nothing running, a member stayed under monitoring indefinitely after
/// the order that justified it had expired — a restriction outliving its own
/// authority. The expiry date was recorded and then never acted on.
/// </summary>
public class ClearExpiredMonitoringJob : ScheduledHostedService
{
    public ClearExpiredMonitoringJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<ClearExpiredMonitoringJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "ClearExpiredMonitoring";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(24);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(7);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var db = services.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;

        var expired = await db.Set<UserMonitoringRestriction>()
            .Where(s => s.TenantId == tenantId
                && s.UnderMonitoring
                && s.MonitoringExpiresAt != null
                && s.MonitoringExpiresAt <= now)
            .ToListAsync(ct);

        if (expired.Count == 0) return;

        foreach (var status in expired)
        {
            // Only the monitoring flag is lifted. Any other restriction on the
            // record (messaging limits, broker approval) has its own authority
            // and its own expiry, and must not be cleared as a side effect.
            status.UnderMonitoring = false;
            status.MonitoringExpiresAt = null;
            status.UpdatedAt = now;
        }

        await db.SaveChangesAsync(ct);

        Logger.LogInformation(
            "ClearExpiredMonitoring tenant={TenantId} lifted={Count}", tenantId, expired.Count);
    }
}
