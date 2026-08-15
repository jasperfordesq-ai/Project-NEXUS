// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Chases safeguarding vetting that is about to expire, or already has.
///
/// Laravel: <c>safeguarding:vetting-renewals</c>, daily
/// (bootstrap/app.php:268, VettingRenewalRemindersCommand) — "notify active
/// brokers and administrators before safeguarding confirmations require renewal
/// and after they expire", at 90 / 30 / 7 days and once past expiry.
///
/// 🔴 With nothing running, expired vetting was never chased. Vetting is what
/// evidences that someone is cleared to work with children and at-risk adults,
/// so an expiry nobody notices means a person keeps that access on the strength
/// of a document that has lapsed. Of everything in the missing-jobs list, this
/// is the one with the most direct safeguarding consequence.
///
/// 🔴 DIVERGENCE, deliberate: Laravel stamps reminder columns on the record
/// (renewal_reminder_90_sent_at and friends) to avoid repeats. This backend's
/// vetting_records table has no such columns, and adding five nullable
/// timestamps is a schema change that would need its own migration and
/// backfill. Instead the notification itself is the dedupe key: a reminder is
/// only sent when no notification of the same type exists for that record in
/// the current window. Same outcome, no schema change; if the stamp columns are
/// ever added, prefer them, because they survive notification pruning.
/// </summary>
public class VettingRenewalRemindersJob : ScheduledHostedService
{
    /// <summary>Days before expiry at which a reminder is sent, matching Laravel.</summary>
    private static readonly int[] ReminderDays = [90, 30, 7];

    private const string NotificationType = "safeguarding_vetting_renewal";

    public VettingRenewalRemindersJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<VettingRenewalRemindersJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "VettingRenewalReminders";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(24);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(8);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var db = services.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var horizon = now.AddDays(ReminderDays.Max());

        // Anything expiring inside the widest reminder window, or already past.
        var due = await db.VettingRecords.AsNoTracking()
            .Where(v => v.TenantId == tenantId
                && v.Status == "verified"
                && v.ExpiresAt != null
                && v.ExpiresAt <= horizon)
            .Select(v => new { v.Id, v.UserId, v.VettingType, v.ExpiresAt })
            .ToListAsync(ct);

        if (due.Count == 0) return;

        // Who is told: the member whose vetting it is, and the community's
        // administrators. Laravel notifies "active brokers and administrators".
        var adminIds = await db.Users.AsNoTracking()
            .Where(u => u.TenantId == tenantId
                && u.IsActive
                && (u.IsAdmin || u.IsSuperAdmin || u.IsTenantSuperAdmin
                    || u.Role == "admin" || u.Role == "broker" || u.Role == "coordinator"))
            .Select(u => u.Id)
            .ToListAsync(ct);

        var sent = 0;
        foreach (var record in due)
        {
            var stage = StageFor(record.ExpiresAt!.Value, now);
            if (stage is null) continue;

            // The notification is the dedupe key — see the divergence note above.
            var marker = $"vetting:{record.Id}:{stage}";
            var alreadySent = await db.Set<Notification>().AsNoTracking()
                .AnyAsync(n => n.TenantId == tenantId
                    && n.Type == NotificationType
                    && n.Data == marker, ct);
            if (alreadySent) continue;

            var expired = record.ExpiresAt.Value <= now;
            var title = expired
                ? "Safeguarding vetting has expired"
                : "Safeguarding vetting is due for renewal";
            var body = expired
                ? $"A {record.VettingType} check expired on {record.ExpiresAt:d MMM yyyy} and needs renewing."
                : $"A {record.VettingType} check expires on {record.ExpiresAt:d MMM yyyy}.";

            var recipients = adminIds.Append(record.UserId).Distinct();
            foreach (var recipientId in recipients)
            {
                db.Set<Notification>().Add(new Notification
                {
                    TenantId = tenantId,
                    UserId = recipientId,
                    Type = NotificationType,
                    Title = title,
                    Body = body,
                    Data = marker,
                    IsRead = false,
                    CreatedAt = now,
                });
            }
            sent++;
        }

        if (sent == 0) return;
        await db.SaveChangesAsync(ct);

        Logger.LogInformation(
            "VettingRenewalReminders tenant={TenantId} records={Count} reminded={Sent}",
            tenantId, due.Count, sent);
    }

    /// <summary>
    /// Which reminder stage this record is in, or null if it is not yet at one.
    /// Past expiry is its own stage so the chase does not simply stop.
    /// </summary>
    private static string? StageFor(DateTime expiresAt, DateTime now)
    {
        if (expiresAt <= now) return "expired";
        var daysLeft = (expiresAt - now).TotalDays;
        foreach (var threshold in ReminderDays.OrderBy(d => d))
        {
            if (daysLeft <= threshold) return threshold.ToString();
        }
        return null;
    }
}
