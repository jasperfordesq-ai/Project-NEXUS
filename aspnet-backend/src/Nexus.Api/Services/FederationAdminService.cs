// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

using System.Security.Cryptography;

/// <summary>
/// Super admin service for managing federation partnerships across tenants.
/// Provides cross-tenant visibility, emergency controls, and audit capabilities.
/// </summary>
public class FederationAdminService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<FederationAdminService> _logger;

    public FederationAdminService(NexusDbContext db, ILogger<FederationAdminService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// List ALL federation partners across tenants (super admin). Uses IgnoreQueryFilters.
    /// </summary>
    public async Task<List<FederationPartner>> GetAllPartnersAsync(string? status)
    {
        var query = _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<PartnerStatus>(status, true, out var parsed))
            query = query.Where(p => p.Status == parsed);

        return await query
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Suspend a federation partner and log the action.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> SuspendPartnerAsync(int partnerId, int adminUserId)
    {
        var partner = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == partnerId);

        if (partner == null)
            return (null, "Federation partner not found.");

        if (partner.Status == PartnerStatus.Suspended)
            return (null, "Partner is already suspended.");

        if (partner.Status == PartnerStatus.Revoked)
            return (null, "Cannot suspend a revoked partner.");

        partner.Status = PartnerStatus.Suspended;
        partner.UpdatedAt = DateTime.UtcNow;

        await LogAuditAsync(partner.TenantId, partner.PartnerTenantId,
            "partner.suspended", "FederationPartner", partner.Id,
            $"Suspended by admin {adminUserId}");

        await _db.SaveChangesAsync();

        _logger.LogWarning(
            "Federation partner {PartnerId} suspended by admin {AdminUserId}",
            partnerId, adminUserId);

        return (partner, null);
    }

    /// <summary>
    /// Revoke a federation partner permanently.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> RevokePartnerAsync(int partnerId, int adminUserId)
    {
        var partner = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == partnerId);

        if (partner == null)
            return (null, "Federation partner not found.");

        if (partner.Status == PartnerStatus.Revoked)
            return (null, "Partner is already revoked.");

        partner.Status = PartnerStatus.Revoked;
        partner.UpdatedAt = DateTime.UtcNow;

        await LogAuditAsync(partner.TenantId, partner.PartnerTenantId,
            "partner.revoked", "FederationPartner", partner.Id,
            $"Revoked by admin {adminUserId}");

        await _db.SaveChangesAsync();

        _logger.LogWarning(
            "Federation partner {PartnerId} revoked by admin {AdminUserId}",
            partnerId, adminUserId);

        return (partner, null);
    }

    /// <summary>
    /// Reactivate a suspended federation partner.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> ReactivatePartnerAsync(int partnerId, int adminUserId)
    {
        var partner = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == partnerId);

        if (partner == null)
            return (null, "Federation partner not found.");

        if (partner.Status != PartnerStatus.Suspended)
            return (null, "Only suspended partners can be reactivated.");

        partner.Status = PartnerStatus.Active;
        partner.UpdatedAt = DateTime.UtcNow;

        await LogAuditAsync(partner.TenantId, partner.PartnerTenantId,
            "partner.reactivated", "FederationPartner", partner.Id,
            $"Reactivated by admin {adminUserId}");

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Federation partner {PartnerId} reactivated by admin {AdminUserId}",
            partnerId, adminUserId);

        return (partner, null);
    }

    /// <summary>
    /// Get cross-tenant federation statistics.
    /// </summary>
    public async Task<object> GetFederationStatsAsync()
    {
        var partners = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .ToListAsync();

        return new
        {
            TotalPartners = partners.Count,
            Active = partners.Count(p => p.Status == PartnerStatus.Active),
            Pending = partners.Count(p => p.Status == PartnerStatus.Pending),
            Suspended = partners.Count(p => p.Status == PartnerStatus.Suspended),
            Revoked = partners.Count(p => p.Status == PartnerStatus.Revoked),
            TotalSharedListings = partners.Count(p => p.SharedListings && p.Status == PartnerStatus.Active),
            TotalSharedEvents = partners.Count(p => p.SharedEvents && p.Status == PartnerStatus.Active),
            TotalSharedMembers = partners.Count(p => p.SharedMembers && p.Status == PartnerStatus.Active)
        };
    }

    /// <summary>
    /// Get federation audit log with pagination, optionally filtered by partner.
    /// </summary>
    public async Task<(List<FederationAuditLog> Logs, int Total)> GetAuditLogAsync(
        int? partnerId, int page = 1, int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<FederationAuditLog>()
            .IgnoreQueryFilters()
            .AsQueryable();

        if (partnerId.HasValue)
        {
            var partner = await _db.Set<FederationPartner>()
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(p => p.Id == partnerId.Value);

            if (partner != null)
            {
                query = query.Where(l =>
                    (l.TenantId == partner.TenantId && l.PartnerTenantId == partner.PartnerTenantId) ||
                    (l.TenantId == partner.PartnerTenantId && l.PartnerTenantId == partner.TenantId));
            }
        }

        var total = await query.CountAsync();

        var logs = await query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (logs, total);
    }

    /// <summary>
    /// Enable or disable a federation feature for a specific tenant.
    /// </summary>
    public async Task<(FederationFeatureToggle? Toggle, string? Error)> SetFeatureToggleAsync(
        int tenantId, string featureName, bool enabled)
    {
        if (string.IsNullOrWhiteSpace(featureName))
            return (null, "Feature name is required.");

        var toggle = await _db.Set<FederationFeatureToggle>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Feature == featureName);

        if (toggle == null)
        {
            toggle = new FederationFeatureToggle
            {
                TenantId = tenantId,
                Feature = featureName,
                IsEnabled = enabled,
                CreatedAt = DateTime.UtcNow
            };
            _db.Set<FederationFeatureToggle>().Add(toggle);
        }
        else
        {
            toggle.IsEnabled = enabled;
            toggle.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Federation feature {Feature} set to {Enabled} for tenant {TenantId}",
            featureName, enabled, tenantId);

        return (toggle, null);
    }

    /// <summary>
    /// List all federation feature toggles for a tenant.
    /// </summary>
    public async Task<List<FederationFeatureToggle>> GetFeatureTogglesAsync(int tenantId)
    {
        return await _db.Set<FederationFeatureToggle>()
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId)
            .OrderBy(t => t.Feature)
            .ToListAsync();
    }

    /// <summary>
    /// Emergency disconnect: revoke partner, disable all sharing, and log.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> ForceDisconnectAsync(
        int partnerId, int adminUserId)
    {
        var partner = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == partnerId);

        if (partner == null)
            return (null, "Federation partner not found.");

        partner.Status = PartnerStatus.Revoked;
        partner.SharedListings = false;
        partner.SharedEvents = false;
        partner.SharedMembers = false;
        partner.UpdatedAt = DateTime.UtcNow;

        // Disable all federation features for both tenants
        var toggles = await _db.Set<FederationFeatureToggle>()
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == partner.TenantId || t.TenantId == partner.PartnerTenantId)
            .ToListAsync();

        foreach (var toggle in toggles)
        {
            toggle.IsEnabled = false;
            toggle.UpdatedAt = DateTime.UtcNow;
        }

        // Revoke API keys for both tenants
        var apiKeys = await _db.Set<FederationApiKey>()
            .IgnoreQueryFilters()
            .Where(k => (k.TenantId == partner.TenantId || k.TenantId == partner.PartnerTenantId) && k.IsActive)
            .ToListAsync();

        foreach (var key in apiKeys)
            key.IsActive = false;

        await LogAuditAsync(partner.TenantId, partner.PartnerTenantId,
            "partner.force_disconnected", "FederationPartner", partner.Id,
            $"Emergency disconnect by admin {adminUserId}. All sharing disabled, API keys revoked.");

        await _db.SaveChangesAsync();

        _logger.LogCritical(
            "EMERGENCY: Federation partner {PartnerId} force-disconnected by admin {AdminUserId}",
            partnerId, adminUserId);

        return (partner, null);
    }

    /// <summary>
    /// Get API key usage stats, optionally filtered by tenant.
    /// </summary>
    public async Task<object> GetApiKeyUsageAsync(int? tenantId)
    {
        var query = _db.Set<FederationApiKey>()
            .IgnoreQueryFilters()
            .AsQueryable();

        if (tenantId.HasValue)
            query = query.Where(k => k.TenantId == tenantId.Value);

        var keys = await query.ToListAsync();

        return new
        {
            TotalKeys = keys.Count,
            ActiveKeys = keys.Count(k => k.IsActive),
            RevokedKeys = keys.Count(k => !k.IsActive),
            ExpiredKeys = keys.Count(k => k.ExpiresAt.HasValue && k.ExpiresAt < DateTime.UtcNow),
            KeysByTenant = keys
                .GroupBy(k => k.TenantId)
                .Select(g => new { TenantId = g.Key, Count = g.Count(), Active = g.Count(k => k.IsActive) })
                .ToList()
        };
    }

    /// <summary>
    /// Revoke a federation API key.
    /// </summary>
    public async Task<(FederationApiKey? Key, string? Error)> RevokeApiKeyAsync(int keyId, int adminUserId)
    {
        var key = await _db.Set<FederationApiKey>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(k => k.Id == keyId);

        if (key == null)
            return (null, "API key not found.");

        if (!key.IsActive)
            return (null, "API key is already revoked.");

        key.IsActive = false;

        await LogAuditAsync(key.TenantId, 0,
            "apikey.revoked", "FederationApiKey", key.Id,
            $"API key {key.KeyPrefix}... revoked by admin {adminUserId}");

        await _db.SaveChangesAsync();

        _logger.LogWarning(
            "Federation API key {KeyId} ({Prefix}...) revoked by admin {AdminUserId}",
            keyId, key.KeyPrefix, adminUserId);

        return (key, null);
    }

    /// <summary>
    /// Regenerate a federation API key: create new key, revoke old.
    /// Returns the raw key (only shown once).
    /// </summary>
    public async Task<(FederationApiKey? Key, string? RawKey, string? Error)> RegenerateApiKeyAsync(
        int keyId, int adminUserId)
    {
        var oldKey = await _db.Set<FederationApiKey>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(k => k.Id == keyId);

        if (oldKey == null)
            return (null, null, "API key not found.");

        // Revoke old key
        oldKey.IsActive = false;

        // Generate new key
        var rawKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var keyHash = BitConverter.ToString(
            SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawKey)))
            .Replace("-", "").ToLowerInvariant();

        var newKey = new FederationApiKey
        {
            TenantId = oldKey.TenantId,
            KeyHash = keyHash,
            KeyPrefix = rawKey[..8],
            Name = oldKey.Name,
            Scopes = oldKey.Scopes,
            IsActive = true,
            RateLimitPerMinute = oldKey.RateLimitPerMinute,
            ExpiresAt = oldKey.ExpiresAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FederationApiKey>().Add(newKey);

        await LogAuditAsync(oldKey.TenantId, 0,
            "apikey.regenerated", "FederationApiKey", oldKey.Id,
            $"API key {oldKey.KeyPrefix}... regenerated by admin {adminUserId}. New key ID will be assigned.");

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Federation API key {OldKeyId} regenerated as {NewKeyId} by admin {AdminUserId}",
            keyId, newKey.Id, adminUserId);

        return (newKey, rawKey, null);
    }

    private async Task LogAuditAsync(
        int tenantId, int partnerTenantId, string action, string? entityType, int? entityId, string? details)
    {
        _db.Set<FederationAuditLog>().Add(new FederationAuditLog
        {
            TenantId = tenantId,
            PartnerTenantId = partnerTenantId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Details = details,
            CreatedAt = DateTime.UtcNow
        });
        // Caller is responsible for SaveChangesAsync
    }
}
