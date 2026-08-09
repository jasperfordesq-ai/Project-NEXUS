// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Services.Scheduled;

public sealed class EventRecurrenceMaterializationJob : ScheduledHostedService
{
    public EventRecurrenceMaterializationJob(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<EventRecurrenceMaterializationJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "EventRecurrenceMaterialization";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(1);

    protected override async Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct)
    {
        var materializer = services.GetRequiredService<EventRecurrenceMaterializationService>();
        var summary = await materializer.MaterializeDueAsync(tenantId, DateTime.UtcNow, ct);
        if (summary.Failed > 0)
            throw new InvalidOperationException($"Event recurrence materialization failed for {summary.Failed} series in tenant {tenantId}.");
        Logger.LogInformation("Event recurrence materialization tenant {TenantId}: examined {Examined}, inserted {Inserted}, replayed {Replayed}", tenantId, summary.Examined, summary.OccurrencesInserted, summary.OccurrencesReplayed);
    }
}
