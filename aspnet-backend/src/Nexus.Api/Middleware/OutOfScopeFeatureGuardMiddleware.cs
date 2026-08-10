// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nexus.Api.Data;

namespace Nexus.Api.Middleware;

/// <summary>
/// Returns 404 for requests targeting former parity-exclusion V1 modules that
/// are still gaps (Marketplace, Caring Community, Verein/Clubs, Regional Analytics,
/// National KISS), unless the corresponding tenant feature flag is enabled.
///
/// Per CLAUDE.md, these modules are now tracked parity gaps. Controllers may
/// exist incrementally, but disabled tenant features must not become reachable
/// in production by accident.
/// Flag lookup order: tenant <c>TenantConfig</c> entry
/// <c>features.{flag}</c> (string "true"/"1"/"yes" enables) → falls back to
/// global appsettings <c>OutOfScopeFeatures:{Flag}</c>.
/// </summary>
public class OutOfScopeFeatureGuardMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<OutOfScopeFeatureGuardMiddleware> _logger;

    // Path prefix → feature flag key. Order matters: more specific first.
    // Match is case-insensitive and matches the prefix exactly or with a
    // following "/".
    private static readonly (string Prefix, string Flag)[] PathPrefixes = new[]
    {
        // National KISS lives under /api/admin/national/kiss — must come
        // before any broader /api/admin match.
        ("/api/admin/national/kiss", "national_kiss"),

        ("/api/marketplace",                 "marketplace"),
        ("/api/admin/marketplace",           "marketplace"),

        ("/api/caring",                      "caring_community"),
        ("/api/admin/caring",                "caring_community"),

        ("/api/verein",                      "verein_clubs"),
        ("/api/clubs",                       "verein_clubs"),
        ("/api/admin/verein",                "verein_clubs"),

        ("/api/regional-analytics",          "regional_analytics"),
        ("/api/admin/regional-analytics",    "regional_analytics"),
    };

    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

    public OutOfScopeFeatureGuardMiddleware(
        RequestDelegate next,
        ILogger<OutOfScopeFeatureGuardMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(
        HttpContext context,
        IMemoryCache cache,
        IServiceProvider services,
        IConfiguration configuration,
        IWebHostEnvironment env)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        var match = MatchPrefix(path);
        if (match is null)
        {
            await _next(context);
            return;
        }

        // Skip the guard in Testing environment — integration tests cover legacy
        // controllers that may still respond, and the gate would mask real
        // assertions. In Development we still log + 404 so devs notice.
        if (env.EnvironmentName.Equals("Testing", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var (_, flag) = match.Value;

        // 1. Try tenant-scoped feature flag (TenantConfig key "features.{flag}").
        var tenantId = ResolveTenantId(context);
        bool? enabled = null;
        if (tenantId.HasValue)
        {
            enabled = await GetTenantFlagAsync(cache, services, tenantId.Value, flag);
        }

        // 2. Fall back to global appsettings OutOfScopeFeatures:{Pascal}.
        if (enabled is null)
        {
            enabled = configuration.GetValue<bool?>($"OutOfScopeFeatures:{ToPascal(flag)}");
        }

        if (enabled == true)
        {
            await _next(context);
            return;
        }

        _logger.LogInformation(
            "Parity-gap feature gate blocked request: {Method} {Path} (flag={Flag} tenant={TenantId})",
            context.Request.Method, path, flag, tenantId);

        context.Response.StatusCode = StatusCodes.Status404NotFound;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new { error = "feature_not_enabled" });
    }

    private static (string Prefix, string Flag)? MatchPrefix(string path)
    {
        foreach (var entry in PathPrefixes)
        {
            if (path.Equals(entry.Prefix, StringComparison.OrdinalIgnoreCase))
                return entry;
            if (path.StartsWith(entry.Prefix + "/", StringComparison.OrdinalIgnoreCase))
                return entry;
        }
        return null;
    }

    private static int? ResolveTenantId(HttpContext context)
    {
        // Prefer the resolved TenantContext if the resolver ran before us.
        var tenantContext = context.RequestServices.GetService<TenantContext>();
        if (tenantContext?.TenantId is int id)
            return id;

        // Fallback: read tenant_id directly from JWT claims. The resolver
        // middleware runs after this guard in the pipeline order, but the
        // claim is already populated by UseAuthentication().
        var claim = context.User?.FindFirst("tenant_id")?.Value;
        if (int.TryParse(claim, out var fromClaim))
            return fromClaim;

        return null;
    }

    private static async Task<bool?> GetTenantFlagAsync(
        IMemoryCache cache,
        IServiceProvider services,
        int tenantId,
        string flag)
    {
        var cacheKey = $"oos.feature.{tenantId}.{flag}";
        if (cache.TryGetValue<bool?>(cacheKey, out var cached))
            return cached;

        bool? value;
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var raw = await db.TenantConfigs
                .IgnoreQueryFilters()
                .Where(c => c.TenantId == tenantId && c.Key == $"features.{flag}")
                .Select(c => c.Value)
                .FirstOrDefaultAsync();

            value = raw is null ? null : ParseBool(raw);
        }
        catch
        {
            // If the DB is unreachable, fail closed (treat as disabled).
            value = false;
        }

        cache.Set(cacheKey, value, CacheTtl);
        return value;
    }

    private static bool? ParseBool(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null,
        };
    }

    private static string ToPascal(string snake)
    {
        var parts = snake.Split('_', StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select(p =>
            char.ToUpperInvariant(p[0]) + p[1..].ToLowerInvariant()));
    }
}
