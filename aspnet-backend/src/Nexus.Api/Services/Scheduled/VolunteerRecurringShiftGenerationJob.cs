// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Generates the next 14 days of shifts from every active recurring pattern.
/// The shared scheduler supplies an isolated scope and tenant context for each
/// active tenant and uses the same body for natural and manual executions.
/// </summary>
public class VolunteerRecurringShiftGenerationJob : ScheduledHostedService
{
    public VolunteerRecurringShiftGenerationJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<VolunteerRecurringShiftGenerationJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "VolunteerRecurringShiftGeneration";
    protected override TimeSpan DefaultInterval => TimeSpan.FromDays(1);
    protected override TimeSpan StartupDelay => DelayUntilNextUtcRun(DateTime.UtcNow, includeCurrentBoundary: true);

    protected override TimeSpan DelayAfterRun(TimeSpan resolvedInterval)
    {
        var configuredMinutes = Configuration.GetValue<double?>($"Scheduled:{JobName}:IntervalMinutes");
        return configuredMinutes is > 0
            ? resolvedInterval
            : DelayUntilNextUtcRun(DateTime.UtcNow, includeCurrentBoundary: false);
    }

    protected override async Task RunForTenantAsync(
        IServiceProvider services,
        int tenantId,
        CancellationToken ct)
    {
        var shiftManagement = services.GetRequiredService<ShiftManagementService>();
        var result = await shiftManagement.ProcessAllPatternsAsync(14, ct);
        if (result.Errors > 0)
        {
            Logger.LogWarning(
                "Recurring shift generation for tenant {TenantId} processed {ProcessedCount} patterns, generated {GeneratedCount} shifts, and recorded {ErrorCount} pattern errors",
                tenantId,
                result.Processed,
                result.Generated,
                result.Errors);
            throw new InvalidOperationException(
                $"Recurring shift generation recorded {result.Errors} pattern error(s) for tenant {tenantId}.");
        }

        Logger.LogInformation(
            "Recurring shift generation for tenant {TenantId} processed {ProcessedCount} patterns and generated {GeneratedCount} shifts",
            tenantId,
            result.Processed,
            result.Generated);
    }

    internal static TimeSpan DelayUntilNextUtcRun(DateTime utcNow, bool includeCurrentBoundary)
    {
        var normalized = utcNow.Kind == DateTimeKind.Utc
            ? utcNow
            : utcNow.ToUniversalTime();
        var next = normalized.Date.AddHours(6);
        if (next < normalized || (!includeCurrentBoundary && next == normalized))
        {
            next = next.AddDays(1);
        }

        return next - normalized;
    }
}
