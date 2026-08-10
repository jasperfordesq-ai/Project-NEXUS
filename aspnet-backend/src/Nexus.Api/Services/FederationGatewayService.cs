// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Central gateway for federation operations.
/// Implements 3-layer feature gating: System → Tenant → User.
/// All federation operations should check through this gateway first.
/// </summary>
public class FederationGatewayService
{
    private readonly NexusDbContext _db;
    private readonly IConfiguration _configuration;
    private readonly ILogger<FederationGatewayService> _logger;

    // System-level federation master switch (from config)
    private bool SystemFederationEnabled => _configuration.GetValue("Federation:Enabled", false);

    public FederationGatewayService(NexusDbContext db, IConfiguration configuration, ILogger<FederationGatewayService> logger)
    {
        _db = db;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Check if federation is enabled at all 3 layers for a specific feature.
    /// </summary>
    public async Task<(bool Allowed, string? Reason)> CheckFeatureAccessAsync(
        int tenantId, int? userId, string feature)
    {
        // Layer 1: System-level check
        if (!SystemFederationEnabled)
            return (false, "Federation is disabled at the system level");

        // Layer 2: Tenant-level check
        var tenantToggle = await _db.Set<FederationFeatureToggle>()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Feature == feature);

        if (tenantToggle == null || !tenantToggle.IsEnabled)
            return (false, $"Feature '{feature}' is not enabled for this tenant");

        // Layer 3: User-level check (if userId provided)
        if (userId.HasValue)
        {
            var userSettings = await _db.Set<FederationUserSetting>()
                .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.UserId == userId.Value);

            if (userSettings == null || !userSettings.FederationOptIn)
                return (false, "User has not opted into federation");
        }

        return (true, null);
    }

    /// <summary>
    /// Check if federation is enabled at system + tenant level (no user check).
    /// Use for admin operations.
    /// </summary>
    public async Task<(bool Allowed, string? Reason)> CheckTenantAccessAsync(int tenantId, string feature)
    {
        return await CheckFeatureAccessAsync(tenantId, null, feature);
    }

    /// <summary>
    /// Get all feature toggles for a tenant.
    /// </summary>
    public async Task<List<FederationFeatureToggle>> GetTenantTogglesAsync(int tenantId)
    {
        return await _db.Set<FederationFeatureToggle>()
            .Where(t => t.TenantId == tenantId)
            .AsNoTracking()
            .OrderBy(t => t.Feature)
            .ToListAsync();
    }

    /// <summary>
    /// Set a feature toggle for a tenant.
    /// </summary>
    public async Task<FederationFeatureToggle> SetFeatureToggleAsync(
        int tenantId, string feature, bool enabled, string? configuration = null)
    {
        var toggle = await _db.Set<FederationFeatureToggle>()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Feature == feature);

        if (toggle == null)
        {
            toggle = new FederationFeatureToggle
            {
                TenantId = tenantId,
                Feature = feature,
                IsEnabled = enabled,
                Configuration = configuration,
                CreatedAt = DateTime.UtcNow
            };
            _db.Set<FederationFeatureToggle>().Add(toggle);
        }
        else
        {
            toggle.IsEnabled = enabled;
            toggle.Configuration = configuration;
            toggle.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Federation feature '{Feature}' set to {Enabled} for tenant {TenantId}",
            feature, enabled, tenantId);

        return toggle;
    }

    /// <summary>
    /// Get user federation settings.
    /// </summary>
    public async Task<FederationUserSetting?> GetUserSettingsAsync(int tenantId, int userId)
    {
        return await _db.Set<FederationUserSetting>()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.UserId == userId);
    }

    /// <summary>
    /// Update user federation settings.
    /// </summary>
    public async Task<FederationUserSetting> UpdateUserSettingsAsync(
        int tenantId,
        int userId,
        bool optIn,
        bool profileVisible,
        bool listingsVisible,
        bool? transactionsEnabled,
        string? blockedTenants)
    {
        var settings = await _db.Set<FederationUserSetting>()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.UserId == userId);

        if (settings == null)
        {
            settings = new FederationUserSetting
            {
                TenantId = tenantId,
                UserId = userId,
                FederationOptIn = optIn,
                ProfileVisible = profileVisible,
                ListingsVisible = listingsVisible,
                TransactionsEnabled = transactionsEnabled ?? false,
                BlockedPartnerTenants = blockedTenants,
                CreatedAt = DateTime.UtcNow
            };
            _db.Set<FederationUserSetting>().Add(settings);
        }
        else
        {
            settings.FederationOptIn = optIn;
            settings.ProfileVisible = profileVisible;
            settings.ListingsVisible = listingsVisible;
            if (transactionsEnabled.HasValue)
                settings.TransactionsEnabled = transactionsEnabled.Value;
            settings.BlockedPartnerTenants = blockedTenants;
            settings.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return settings;
    }

    /// <summary>
    /// Get system-level federation status.
    /// </summary>
    public object GetSystemStatus()
    {
        return new
        {
            federation_enabled = SystemFederationEnabled,
            max_partners_per_tenant = _configuration.GetValue("Federation:MaxPartnersPerTenant", 50),
            max_api_keys_per_tenant = _configuration.GetValue("Federation:MaxApiKeysPerTenant", 10),
            default_rate_limit = _configuration.GetValue("Federation:DefaultRateLimitPerMinute", 60)
        };
    }
}
