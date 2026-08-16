// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Deletes safeguarding message reviews once their retention period has passed.
///
/// Laravel: <c>safeguarding:purge-message-copies</c>, weekly
/// (bootstrap/app.php:253, PurgeBrokerMessageCopiesCommand).
///
/// 🔴 With nothing running, a copy of every message a broker ever reviewed was
/// kept for ever. These rows exist so a safeguarding concern can be reviewed;
/// keeping them past that purpose turns a safeguarding control into an
/// indefinite archive of members' private messages, which is precisely what a
/// retention period is there to prevent.
///
/// Two rules, both deliberate:
///
/// <list type="bullet">
/// <item><description><b>An unreviewed row is never deleted</b>, however old.
/// Deleting one would silently discard a safeguarding concern nobody has looked
/// at yet — the one outcome worse than keeping it too long. Laravel expresses
/// the same rule as <c>whereNotNull('reviewed_at')</c>.</description></item>
/// <item><description><b>Flagged rows are kept far longer</b> (365 days) than
/// cleared ones (90). A flagged review is potential evidence; a cleared one is
/// not. Laravel treats this period as uniform and not tenant-tunable, and so
/// does this.</description></item>
/// </list>
///
/// 🔴 <b>Divergence from Laravel, deliberate.</b> Laravel reads each community's
/// own <c>broker_config.retention_days</c> from its <c>tenant_settings</c>
/// key/value table. This backend has no such table — settings here are typed
/// per feature — and no broker retention setting exists on any of them. So
/// retention is uniform and configurable per deployment
/// (<c>Scheduled:PurgeBrokerMessageCopies:ReviewedRetentionDays</c> /
/// <c>FlaggedRetentionDays</c>) rather than per community. If a per-community
/// broker configuration is ever added here, read it and fall back to these
/// values, matching Laravel's shape.
///
/// The same floors as Laravel apply and are not configurable away: 7 days for
/// cleared rows, 365 for flagged. A community that set retention to 0 would
/// otherwise erase its entire broker review queue on the next run.
///
/// Second divergence: Laravel filters on <c>sent_at</c> (when the message was
/// sent). This entity has no such column, so <c>CreatedAt</c> — when the review
/// was raised — is used. That is at or after the send time, so this errs
/// towards keeping rows slightly longer, never shorter.
/// </summary>
public class PurgeBrokerMessageCopiesJob : ScheduledHostedService
{
    private const int MinimumReviewedRetentionDays = 7;
    private const int MinimumFlaggedRetentionDays = 365;
    private const int DefaultReviewedRetentionDays = 90;

    public PurgeBrokerMessageCopiesJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<PurgeBrokerMessageCopiesJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "PurgeBrokerMessageCopies";
    protected override TimeSpan DefaultInterval => TimeSpan.FromDays(7);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(11);

    private int ReviewedRetentionDays => Math.Max(
        MinimumReviewedRetentionDays,
        Configuration.GetValue<int?>($"Scheduled:{JobName}:ReviewedRetentionDays")
            ?? DefaultReviewedRetentionDays);

    private int FlaggedRetentionDays => Math.Max(
        MinimumFlaggedRetentionDays,
        Configuration.GetValue<int?>($"Scheduled:{JobName}:FlaggedRetentionDays")
            ?? MinimumFlaggedRetentionDays);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var db = services.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;

        var clearedBefore = now.AddDays(-ReviewedRetentionDays);
        var flaggedBefore = now.AddDays(-FlaggedRetentionDays);

        // Cleared: reviewed, not flagged, past the shorter period.
        var clearedDeleted = await db.Set<SafeguardingMessageReview>()
            .Where(r => r.TenantId == tenantId
                && r.ReviewedAt != null
                && !r.IsFlagged
                && r.CreatedAt < clearedBefore)
            .ExecuteDeleteAsync(ct);

        // Flagged: reviewed, flagged, past the longer legal-retention period.
        var flaggedDeleted = await db.Set<SafeguardingMessageReview>()
            .Where(r => r.TenantId == tenantId
                && r.ReviewedAt != null
                && r.IsFlagged
                && r.CreatedAt < flaggedBefore)
            .ExecuteDeleteAsync(ct);

        if (clearedDeleted == 0 && flaggedDeleted == 0) return;

        Logger.LogInformation(
            "PurgeBrokerMessageCopies tenant={TenantId} cleared_deleted={Cleared} flagged_deleted={Flagged} "
            + "reviewed_retention_days={ReviewedDays} flagged_retention_days={FlaggedDays}",
            tenantId, clearedDeleted, flaggedDeleted, ReviewedRetentionDays, FlaggedRetentionDays);
    }
}
