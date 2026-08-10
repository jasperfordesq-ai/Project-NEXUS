// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Manages federation API keys for external API authentication.
/// Keys are stored as SHA-256 hashes; the raw key is only shown once at creation.
/// </summary>
public class FederationApiKeyService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<FederationApiKeyService> _logger;

    public FederationApiKeyService(NexusDbContext db, ILogger<FederationApiKeyService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Create a new API key for a tenant. Returns the raw key (only shown once).
    /// </summary>
    public async Task<(FederationApiKey Key, string RawKey, string? Error)> CreateApiKeyAsync(
        int tenantId, string name, string scopes, int? rateLimitPerMinute = 60, DateTime? expiresAt = null)
    {
        // Check limit
        var existingCount = await _db.Set<FederationApiKey>()
            .CountAsync(k => k.TenantId == tenantId && k.IsActive);

        if (existingCount >= 10)
            return (null!, "", "Maximum of 10 active API keys per tenant");

        // Generate a secure random key
        var rawKey = GenerateApiKey();
        var keyHash = HashKey(rawKey);
        var keyPrefix = rawKey[..8];

        var apiKey = new FederationApiKey
        {
            TenantId = tenantId,
            KeyHash = keyHash,
            KeyPrefix = keyPrefix,
            Name = name,
            Scopes = scopes,
            IsActive = true,
            RateLimitPerMinute = rateLimitPerMinute,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FederationApiKey>().Add(apiKey);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Federation API key created: {KeyPrefix}... for tenant {TenantId}", keyPrefix, tenantId);

        return (apiKey, rawKey, null);
    }

    /// <summary>
    /// Validate an API key and return the associated key entity if valid.
    /// </summary>
    public async Task<FederationApiKey?> ValidateApiKeyAsync(string rawKey)
    {
        var keyHash = HashKey(rawKey);

        var apiKey = await _db.Set<FederationApiKey>()
            .IgnoreQueryFilters()
            .Include(k => k.Tenant)
            .FirstOrDefaultAsync(k => k.KeyHash == keyHash && k.IsActive);

        if (apiKey == null) return null;

        // Check expiration
        if (apiKey.ExpiresAt.HasValue && apiKey.ExpiresAt < DateTime.UtcNow)
        {
            apiKey.IsActive = false;
            await _db.SaveChangesAsync();
            return null;
        }

        // Update last used
        apiKey.LastUsedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return apiKey;
    }

    /// <summary>
    /// List all API keys for a tenant (without hashes).
    /// </summary>
    public async Task<List<FederationApiKey>> ListApiKeysAsync(int tenantId)
    {
        return await _db.Set<FederationApiKey>()
            .Where(k => k.TenantId == tenantId)
            .OrderByDescending(k => k.CreatedAt)
            .AsNoTracking()
            .ToListAsync();
    }

    /// <summary>
    /// Revoke (deactivate) an API key.
    /// </summary>
    public async Task<(bool Success, string? Error)> RevokeApiKeyAsync(int tenantId, int keyId)
    {
        var apiKey = await _db.Set<FederationApiKey>()
            .FirstOrDefaultAsync(k => k.Id == keyId && k.TenantId == tenantId);

        if (apiKey == null) return (false, "API key not found");

        apiKey.IsActive = false;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Federation API key revoked: {KeyPrefix}... for tenant {TenantId}",
            apiKey.KeyPrefix, tenantId);

        return (true, null);
    }

    /// <summary>
    /// Log an API call for audit purposes.
    /// </summary>
    public async Task LogApiCallAsync(int? tenantId, int? apiKeyId, string method, string path,
        int statusCode, string? ipAddress, int durationMs, string direction = "inbound")
    {
        _db.Set<FederationApiLog>().Add(new FederationApiLog
        {
            TenantId = tenantId,
            ApiKeyId = apiKeyId,
            HttpMethod = method,
            Path = path,
            StatusCode = statusCode,
            IpAddress = ipAddress,
            DurationMs = durationMs,
            Direction = direction,
            CreatedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();
    }

    /// <summary>Check if a key has a specific scope.</summary>
    public static bool HasScope(FederationApiKey key, string scope)
    {
        var scopes = key.Scopes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return scopes.Contains(scope, StringComparer.OrdinalIgnoreCase) || scopes.Contains("*");
    }

    private static string GenerateApiKey()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return $"nxfed_{Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=')}";
    }

    private static string HashKey(string rawKey)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawKey));
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }
}
