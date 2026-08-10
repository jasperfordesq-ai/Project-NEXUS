// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Caching.Memory;

namespace Nexus.Api.Services;

/// <summary>
/// Simple in-memory caching service for tenant-scoped data.
/// Provides caching for static/semi-static data like categories, roles, and config.
///
/// Cache keys are prefixed with tenant ID to ensure tenant isolation.
/// </summary>
public class CacheService
{
    private readonly IMemoryCache _cache;
    private readonly ILogger<CacheService> _logger;

    // Cache durations - kept short to reduce stale data risk
    // All cached data is explicitly invalidated on mutation
    private static readonly TimeSpan CategoryCacheDuration = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RoleCacheDuration = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan ConfigCacheDuration = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan BadgeCacheDuration = TimeSpan.FromMinutes(15);

    public CacheService(IMemoryCache cache, ILogger<CacheService> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    #region Generic Cache Operations

    /// <summary>
    /// Get or create a cached item.
    /// </summary>
    public async Task<T?> GetOrCreateAsync<T>(
        string key,
        int tenantId,
        Func<Task<T>> factory,
        TimeSpan? expiration = null)
    {
        var cacheKey = BuildKey(key, tenantId);

        if (_cache.TryGetValue(cacheKey, out T? cached))
        {
            _logger.LogDebug("Cache hit: {Key}", cacheKey);
            return cached;
        }

        _logger.LogDebug("Cache miss: {Key}", cacheKey);
        var value = await factory();

        var options = new MemoryCacheEntryOptions()
            .SetAbsoluteExpiration(expiration ?? TimeSpan.FromMinutes(10))
            .SetSlidingExpiration(TimeSpan.FromMinutes(3));

        _cache.Set(cacheKey, value, options);
        return value;
    }

    /// <summary>
    /// Remove a cached item.
    /// </summary>
    public void Remove(string key, int tenantId)
    {
        var cacheKey = BuildKey(key, tenantId);
        _cache.Remove(cacheKey);
        _logger.LogDebug("Cache removed: {Key}", cacheKey);
    }

    /// <summary>
    /// Remove all items matching a prefix for a tenant.
    /// NOTE: IMemoryCache does not support enumeration, so this method is a no-op.
    /// Use the specific Invalidate* methods (e.g., InvalidateCategories) instead.
    /// </summary>
    [Obsolete("Use specific Invalidate* methods instead. IMemoryCache does not support prefix-based removal.")]
    public void RemoveByPrefix(string prefix, int tenantId)
    {
        _logger.LogWarning("RemoveByPrefix is a no-op. Use specific Invalidate* methods instead. Prefix: {Prefix}, TenantId: {TenantId}", prefix, tenantId);
    }

    #endregion

    #region Category Cache

    public async Task<List<T>> GetCategoriesAsync<T>(int tenantId, Func<Task<List<T>>> factory)
    {
        return await GetOrCreateAsync(
            "categories",
            tenantId,
            factory,
            CategoryCacheDuration) ?? new List<T>();
    }

    public void InvalidateCategories(int tenantId)
    {
        Remove("categories", tenantId);
    }

    #endregion

    #region Role Cache

    public async Task<List<T>> GetRolesAsync<T>(int tenantId, Func<Task<List<T>>> factory)
    {
        return await GetOrCreateAsync(
            "roles",
            tenantId,
            factory,
            RoleCacheDuration) ?? new List<T>();
    }

    public void InvalidateRoles(int tenantId)
    {
        Remove("roles", tenantId);
    }

    #endregion

    #region Config Cache

    public async Task<T?> GetConfigAsync<T>(int tenantId, Func<Task<T>> factory)
    {
        return await GetOrCreateAsync(
            "config",
            tenantId,
            factory,
            ConfigCacheDuration);
    }

    public void InvalidateConfig(int tenantId)
    {
        Remove("config", tenantId);
    }

    #endregion

    #region Badge Cache

    public async Task<List<T>> GetBadgesAsync<T>(int tenantId, Func<Task<List<T>>> factory)
    {
        return await GetOrCreateAsync(
            "badges",
            tenantId,
            factory,
            BadgeCacheDuration) ?? new List<T>();
    }

    public void InvalidateBadges(int tenantId)
    {
        Remove("badges", tenantId);
    }

    #endregion

    private static string BuildKey(string key, int tenantId) => $"tenant:{tenantId}:{key}";
}
