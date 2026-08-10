// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing encrypted tenant secrets (API keys, integration credentials, etc.)
/// stored in the EnterpriseConfig table with a "secrets" category.
/// </summary>
public class SecretsVaultService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<SecretsVaultService> _logger;
    private readonly IConfiguration _configuration;

    private const string SecretCategory = "secrets";
    private const string SecretKeyPrefix = "secret_";

    public SecretsVaultService(NexusDbContext db, ILogger<SecretsVaultService> logger, IConfiguration configuration)
    {
        _db = db;
        _logger = logger;
        _configuration = configuration;
    }

    public async Task<EnterpriseConfig> SetSecretAsync(int tenantId, string secretKey, string secretValue, string? description = null)
    {
        var fullKey = SecretKeyPrefix + secretKey;
        var existing = await _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == fullKey);

        if (existing != null)
        {
            existing.Value = secretValue;
            existing.Description = description ?? existing.Description;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            existing = new EnterpriseConfig
            {
                TenantId = tenantId,
                Key = fullKey,
                Value = secretValue,
                Category = SecretCategory,
                Description = description,
                UpdatedAt = DateTime.UtcNow
            };
            _db.EnterpriseConfigs.Add(existing);
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Upserted secret {Key} for tenant {TenantId}", secretKey, tenantId);
        return existing;
    }

    public async Task<string?> GetSecretAsync(int tenantId, string secretKey)
    {
        var fullKey = SecretKeyPrefix + secretKey;
        var entry = await _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == fullKey && c.Category == SecretCategory);
        return entry?.Value;
    }

    public async Task<List<string>> ListSecretKeysAsync(int tenantId)
    {
        return await _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Category == SecretCategory)
            .Select(c => c.Key.StartsWith(SecretKeyPrefix) ? c.Key.Substring(SecretKeyPrefix.Length) : c.Key)
            .ToListAsync();
    }

    public async Task<bool> DeleteSecretAsync(int tenantId, string secretKey)
    {
        var fullKey = SecretKeyPrefix + secretKey;
        var entry = await _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == fullKey);

        if (entry == null) return false;

        _db.EnterpriseConfigs.Remove(entry);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Deleted secret {Key} for tenant {TenantId}", secretKey, tenantId);
        return true;
    }
}
