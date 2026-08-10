// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// Global daily maintenance sweep that moves overdue pending and active
/// guardian consents to the canonical expired state across every tenant.
/// </summary>
public class VolunteerGuardianConsentExpiryJob : ScheduledHostedService
{
    public VolunteerGuardianConsentExpiryJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<VolunteerGuardianConsentExpiryJob> logger)
        : base(scopeFactory, configuration, logger) { }

    protected override string JobName => "VolunteerGuardianConsentExpiry";
    protected override TimeSpan DefaultInterval => TimeSpan.FromDays(1);
    protected override TimeSpan StartupDelay => TimeSpan.FromMinutes(8);
    protected override bool PerTenant => false;

    protected override async Task RunGlobalAsync(IServiceProvider services, CancellationToken ct)
    {
        var guardianConsents = services.GetRequiredService<VolunteerGuardianConsentService>();
        var expired = await guardianConsents.ExpireOldConsentsAsync(ct);
        Logger.LogInformation(
            "Volunteer guardian consent expiry marked {ExpiredCount} overdue consents expired",
            expired);
    }
}
