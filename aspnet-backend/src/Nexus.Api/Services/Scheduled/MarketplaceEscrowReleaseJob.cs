// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Hourly equivalent of Laravel's marketplace:process-escrow-releases task.
/// Provider calls are protected by the payment service's durable payout state
/// and stable Stripe idempotency key.
/// </summary>
public sealed class MarketplaceEscrowReleaseJob : ScheduledHostedService
{
    public MarketplaceEscrowReleaseJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<MarketplaceEscrowReleaseJob> logger)
        : base(scopeFactory, configuration, logger)
    {
    }

    protected override string JobName => "MarketplaceEscrowRelease";
    protected override TimeSpan DefaultInterval => TimeSpan.FromHours(1);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(3);
    protected override bool PerTenant => false;

    protected override async Task RunGlobalAsync(IServiceProvider services, CancellationToken ct)
    {
        var paymentService = services.GetRequiredService<MarketplacePaymentService>();
        var released = await paymentService.ProcessEligibleEscrowReleasesAsync(ct);
        Logger.LogInformation("Marketplace escrow release completed; released={Released}", released);
    }
}
