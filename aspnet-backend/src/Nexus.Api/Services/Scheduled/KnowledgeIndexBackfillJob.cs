// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nexus.Api.Services.Ai;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Periodic per-tenant pass that keeps the semantic knowledge index in sync
/// with platform content. Re-runs against unchanged content cost is one
/// SHA-256 + a lookup per row (no embedding calls), so an aggressive
/// schedule is fine.
/// </summary>
public class KnowledgeIndexBackfillJob : ScheduledHostedService
{
    public KnowledgeIndexBackfillJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<KnowledgeIndexBackfillJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "KnowledgeIndexBackfill";
    protected override TimeSpan DefaultInterval => TimeSpan.FromMinutes(15);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(2);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var indexer = services.GetRequiredService<KnowledgeIndexerService>();
        var report = await indexer.ReindexTenantAsync(tenantId, ct);
        await indexer.FlushAsync(ct);
        Logger.LogInformation(
            "KnowledgeIndexBackfill tenant={TenantId} added={Added} updated={Updated} skipped={Skipped} failed={Failed} notes={Notes}",
            tenantId, report.Added, report.Updated, report.Skipped, report.Failed, report.Notes ?? "-");
    }
}
