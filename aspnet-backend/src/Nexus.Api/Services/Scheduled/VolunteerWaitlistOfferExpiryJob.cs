// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nexus.Api.Services;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Expires stale volunteer shift waitlist offers and passes each released place
/// to the next eligible volunteer. This is a global pass because the underlying
/// service deliberately processes stale offers across all tenants.
/// </summary>
public class VolunteerWaitlistOfferExpiryJob : ScheduledHostedService
{
    public VolunteerWaitlistOfferExpiryJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<VolunteerWaitlistOfferExpiryJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "VolunteerWaitlistOfferExpiry";
    protected override TimeSpan DefaultInterval => TimeSpan.FromMinutes(30);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(6);
    protected override bool PerTenant => false;

    protected override async Task RunGlobalAsync(IServiceProvider services, CancellationToken ct)
    {
        var shiftManagement = services.GetRequiredService<ShiftManagementService>();
        var expired = await shiftManagement.ExpireStaleWaitlistedVolunteerOffersAsync(
            hours: 48,
            ct: ct);

        Logger.LogInformation(
            "VolunteerWaitlistOfferExpiry expired and reoffered {ExpiredCount} stale offers",
            expired);
    }
}
