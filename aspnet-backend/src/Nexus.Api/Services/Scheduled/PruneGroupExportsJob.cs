// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Deletes expired group data exports from disk and prunes their records.
///
/// Laravel: <c>groups:prune-exports</c>, daily (bootstrap/app.php:360,
/// PruneGroupDataExportsCommand) — delete the file, mark the row
/// <c>expired</c>, then drop expired rows older than 30 days.
///
/// 🔴 With nothing running, every group data export ever produced stayed on
/// disk for ever. A group export contains member names, email addresses,
/// discussions and files — it is one of the most sensitive artefacts the
/// platform creates, which is exactly why it is given an expiry date. Recording
/// the expiry and never acting on it is a data-protection exposure that grows
/// with use.
/// </summary>
public class PruneGroupExportsJob : ScheduledHostedService
{
    /// <summary>How long an expired record is kept before the row itself goes.</summary>
    private const int RecordRetentionDays = 30;

    public PruneGroupExportsJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<PruneGroupExportsJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "PruneGroupExports";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(24);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(9);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var db = services.GetRequiredService<NexusDbContext>();
        var exports = services.GetRequiredService<GroupDataExportService>();
        var now = DateTime.UtcNow;

        // Stage 1 — expire anything past its expiry that still holds a file.
        var due = await db.Set<GroupDataExport>()
            .Where(e => e.TenantId == tenantId
                && e.ExpiresAt <= now
                && e.Status != "expired")
            .Take(500)
            .ToListAsync(ct);

        var filesDeleted = 0;
        foreach (var row in due)
        {
            // Reuse the service's traversal-safe resolver rather than joining
            // paths here: it refuses anything outside the export root, and a
            // deletion routine is the last place to hand-roll that check.
            var absolute = exports.SafeAbsolutePath(row);
            if (absolute is not null)
            {
                try
                {
                    if (File.Exists(absolute))
                    {
                        File.Delete(absolute);
                        filesDeleted++;
                    }
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    // Leave the row un-expired so the next run tries again. Marking
                    // it expired while the file survives would lose the only
                    // pointer to a file full of member data.
                    Logger.LogWarning(exception,
                        "PruneGroupExports could not delete {Path} for export {ExportId}; will retry",
                        absolute, row.Id);
                    continue;
                }
            }

            row.Status = "expired";
            row.StoragePath = null;
            row.ByteSize = null;
            row.UpdatedAt = now;
        }

        // Stage 2 — drop long-expired records. The file is already gone; this is
        // the bookkeeping row.
        var pruneBefore = now.AddDays(-RecordRetentionDays);
        var pruned = await db.Set<GroupDataExport>()
            .Where(e => e.TenantId == tenantId
                && e.Status == "expired"
                && e.UpdatedAt <= pruneBefore)
            .ExecuteDeleteAsync(ct);

        if (due.Count == 0 && pruned == 0) return;

        await db.SaveChangesAsync(ct);

        Logger.LogInformation(
            "PruneGroupExports tenant={TenantId} expired={Expired} files_deleted={Files} rows_pruned={Pruned}",
            tenantId, due.Count, filesDeleted, pruned);
    }
}
