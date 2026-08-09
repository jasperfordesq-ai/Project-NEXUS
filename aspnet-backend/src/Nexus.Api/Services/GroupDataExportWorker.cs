// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

public sealed class GroupDataExportWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    public GroupDataExportWorker(IServiceScopeFactory scopeFactory, IConfiguration configuration) { _scopeFactory = scopeFactory; _configuration = configuration; }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_configuration.GetValue<bool>("BackgroundServices:SuppressAutomaticExecution")) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var ids = await db.GroupDataExports.IgnoreQueryFilters().AsNoTracking().Where(x => x.Status == "queued" || x.Status == "processing" && x.ProcessingStartedAt < DateTime.UtcNow.AddMinutes(-10)).OrderBy(x => x.CreatedAt).Select(x => x.Id).Take(10).ToListAsync(stoppingToken);
            var service = scope.ServiceProvider.GetRequiredService<GroupDataExportService>();
            foreach (var id in ids) await service.GenerateAsync(id, stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(ids.Count == 0 ? 5 : 1), stoppingToken);
        }
    }
}
