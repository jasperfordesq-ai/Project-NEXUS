// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Acknowledges marketplace reports that nobody has acted on within 24 hours.
///
/// Laravel: <c>marketplace:process-unacknowledged-reports</c>, hourly
/// (bootstrap/app.php:460, MarketplaceReportService::processUnacknowledged).
///
/// 🔴 With nothing running, a member who reported an illegal or harmful listing
/// was never told anything. The report sat at "received" indefinitely, and the
/// seller was never told their listing was under review. Acknowledging a report
/// is a Digital Services Act obligation with a clock on it, so "we will get to
/// it" is not an available position: if no human has responded within a day, the
/// platform must respond by itself.
///
/// Both parties are told, deliberately:
///
/// <list type="bullet">
/// <item><description>the <b>reporter</b>, so a report does not vanish into
/// silence — the thing that stops people reporting at all;</description></item>
/// <item><description>the <b>seller</b>, because DSA transparency requires that
/// someone whose listing is under review knows it is.</description></item>
/// </list>
///
/// 🔴 <b>Divergence from Laravel, deliberate.</b> Laravel queues emails through
/// its report-notification pipeline. The equivalent table here
/// (<c>MarketplaceReportNotification</c>) is mapped but <b>nothing writes to it
/// and nothing sends from it</b> — queueing into it would produce rows nobody
/// ever delivers, which is the no-op pattern this backend is being cleaned of.
/// So both notices are written to the in-app <c>Notification</c> table, which is
/// a live surface members actually read. When a report-email sender exists here,
/// add it alongside; do not move the in-app notice into a queue that does not
/// drain.
///
/// The status change is the load-bearing part and happens first: a member must
/// never be told their report was acknowledged by a run that then failed to
/// record the acknowledgement.
/// </summary>
public class MarketplaceUnacknowledgedReportsJob : ScheduledHostedService
{
    private const int AcknowledgementDeadlineHours = 24;
    private const string ReporterNotificationType = "marketplace_report_acknowledged";
    private const string SellerNotificationType = "marketplace_listing_under_review";

    /// <summary>Bounded so one very backed-up community cannot starve the rest.</summary>
    private const int BatchSize = 200;

    public MarketplaceUnacknowledgedReportsJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<MarketplaceUnacknowledgedReportsJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "MarketplaceUnacknowledgedReports";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(1);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(13);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var db = services.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var cutoff = now.AddHours(-AcknowledgementDeadlineHours);

        var overdue = await db.Set<MarketplaceReport>()
            .Where(r => r.TenantId == tenantId
                && r.Status == "received"
                && r.AcknowledgedAt == null
                && r.CreatedAt <= cutoff)
            .OrderBy(r => r.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(ct);

        if (overdue.Count == 0) return;

        // One lookup for the listings involved, so the seller notice can name
        // the listing rather than referring to it by number.
        var listingIds = overdue.Select(r => r.MarketplaceListingId).Distinct().ToList();
        var listings = await db.Set<MarketplaceListing>().AsNoTracking()
            .Where(l => l.TenantId == tenantId && listingIds.Contains(l.Id))
            .Select(l => new { l.Id, l.UserId, l.Title })
            .ToDictionaryAsync(l => l.Id, ct);

        var sellersNotified = 0;

        foreach (var report in overdue)
        {
            report.Status = "acknowledged";
            report.AcknowledgedAt = now;
            report.UpdatedAt = now;

            db.Set<Notification>().Add(new Notification
            {
                TenantId = tenantId,
                UserId = report.ReporterUserId,
                Type = ReporterNotificationType,
                Title = "Your report is under review",
                Body = "Nobody had responded to your report within 24 hours, so it has been "
                    + "acknowledged automatically and is now with the moderation team.",
                Data = $"{{\"report_id\":{report.Id}}}",
                IsRead = false,
                CreatedAt = now,
            });

            if (!listings.TryGetValue(report.MarketplaceListingId, out var listing)) continue;

            // Do not tell the seller their own report put their listing under
            // review; they would receive two notices about the same event.
            if (listing.UserId == report.ReporterUserId) continue;

            db.Set<Notification>().Add(new Notification
            {
                TenantId = tenantId,
                UserId = listing.UserId,
                Type = SellerNotificationType,
                Title = "One of your listings is under review",
                Body = $"\"{listing.Title}\" has been reported and is being reviewed. "
                    + "It stays available unless the review finds a problem.",
                Data = $"{{\"listing_id\":{listing.Id},\"report_id\":{report.Id}}}",
                IsRead = false,
                CreatedAt = now,
            });
            sellersNotified++;
        }

        await db.SaveChangesAsync(ct);

        Logger.LogInformation(
            "MarketplaceUnacknowledgedReports tenant={TenantId} acknowledged={Count} sellers_notified={Sellers}",
            tenantId, overdue.Count, sellersNotified);
    }
}
