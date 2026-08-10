// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;

namespace Nexus.Api.Controllers;

[ApiController]
public sealed class PwaManifestController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public PwaManifestController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [AllowAnonymous]
    [HttpGet("/api/pwa/manifest")]
    [HttpGet("/api/v2/pwa/manifest")]
    [EnableRateLimiting(RateLimitingExtensions.PwaManifestPolicy)]
    public async Task<IActionResult> Show([FromQuery] string? path, CancellationToken ct)
    {
        var (tenant, prefix) = await ResolveTenantAndPrefixAsync(path, ct);
        var scope = string.IsNullOrEmpty(prefix) ? "/" : $"{prefix}/";
        var name = string.IsNullOrWhiteSpace(tenant?.Name) ? "NEXUS Timebanking" : tenant.Name;

        var icon192 = new { src = "/icons/icon-192.png", sizes = "192x192" };
        var manifest = new
        {
            name,
            short_name = TruncateTextElements(name, 30),
            description = "Community timebanking platform — exchange skills and services using time credits.",
            id = scope,
            start_url = scope,
            scope,
            display = "standalone",
            background_color = "#0f0f13",
            theme_color = "#6366f1",
            orientation = "portrait-primary",
            categories = new[] { "social", "lifestyle", "productivity" },
            icons = new[]
            {
                new { src = "/icons/icon-192.png", sizes = "192x192", type = "image/png", purpose = "any" },
                new { src = "/icons/icon-192.png", sizes = "192x192", type = "image/png", purpose = "maskable" },
                new { src = "/icons/icon-512.png", sizes = "512x512", type = "image/png", purpose = "any" },
                new { src = "/icons/icon-512.png", sizes = "512x512", type = "image/png", purpose = "maskable" }
            },
            screenshots = Array.Empty<object>(),
            shortcuts = new[]
            {
                new { name = "Listings", short_name = "Listings", description = "Browse service listings", url = $"{prefix}/listings", icons = new[] { icon192 } },
                new { name = "Messages", short_name = "Messages", description = "Open messages", url = $"{prefix}/messages", icons = new[] { icon192 } },
                new { name = "Wallet", short_name = "Wallet", description = "View time credit balance", url = $"{prefix}/wallet", icons = new[] { icon192 } }
            }
        };

        Response.Headers.CacheControl = "public, max-age=300, stale-while-revalidate=60";
        Response.Headers.Vary = "Host";
        return Content(
            JsonSerializer.Serialize(manifest),
            "application/manifest+json; charset=UTF-8");
    }

    private async Task<(Tenant? Tenant, string Prefix)> ResolveTenantAndPrefixAsync(string? requestedPath, CancellationToken ct)
    {
        var host = Request.Host.Host.Trim().TrimEnd('.');
        var tenant = await ResolveCurrentTenantAsync(host, ct);
        var prefix = TenantUsesDedicatedHost(tenant, host) || tenant is null || tenant.Id == 1
            ? string.Empty
            : $"/{tenant.Slug.Trim('/')}";
        var firstSegment = FirstPathSegment(requestedPath);
        if (string.IsNullOrEmpty(firstSegment))
            return (tenant, prefix);

        IQueryable<Tenant> candidateQuery = _db.Tenants.AsNoTracking()
            .Where(candidate => candidate.IsActive && candidate.Slug == firstSegment);
        if (TenantUsesDedicatedHost(tenant, host) && tenant is { Id: > 1 })
        {
            candidateQuery = candidateQuery.Where(candidate => _db.TenantHierarchies
                .Any(link => link.IsActive
                    && link.ParentTenantId == tenant.Id
                    && link.ChildTenantId == candidate.Id));
        }

        var pathTenant = await candidateQuery.FirstOrDefaultAsync(ct);
        return pathTenant is null
            ? (tenant, prefix)
            : (pathTenant, $"/{pathTenant.Slug.Trim('/')}");
    }

    private async Task<Tenant?> ResolveCurrentTenantAsync(string host, CancellationToken ct)
    {
        if (_tenantContext.TenantId is int contextTenantId)
            return await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == contextTenantId && t.IsActive, ct);

        if (Request.Headers.TryGetValue("X-Tenant-ID", out var header)
            && int.TryParse(header.FirstOrDefault(), out var headerTenantId))
            return await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == headerTenantId && t.IsActive, ct);

        var domainTenant = await _db.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.IsActive && t.Domain != null && t.Domain.ToLower() == host.ToLower(), ct);
        return domainTenant ?? await _db.Tenants.AsNoTracking()
            .OrderBy(t => t.Id == 1 ? 0 : 1)
            .ThenBy(t => t.Id)
            .FirstOrDefaultAsync(t => t.IsActive, ct);
    }

    private static bool TenantUsesDedicatedHost(Tenant? tenant, string host)
        => tenant is { Id: > 1 }
            && !string.IsNullOrWhiteSpace(tenant.Domain)
            && string.Equals(tenant.Domain.Trim().TrimEnd('.'), host, StringComparison.OrdinalIgnoreCase);

    private static string FirstPathSegment(string? requestedPath)
    {
        var path = requestedPath ?? "/";
        var end = path.IndexOfAny(['?', '#']);
        if (end >= 0)
            path = path[..end];
        return path.Trim('/').Split('/', 2, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;
    }

    private static string TruncateTextElements(string value, int maxTextElements)
    {
        var info = new System.Globalization.StringInfo(value);
        return info.LengthInTextElements <= maxTextElements
            ? value
            : info.SubstringByTextElements(0, maxTextElements);
    }
}
