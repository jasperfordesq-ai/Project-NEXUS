// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Controllers;

/// <summary>
/// Public tenants endpoint — returns the list of active communities.
/// Used by the login page when no tenant is resolved from URL/domain,
/// so users can pick their community from a dropdown.
/// </summary>
[ApiController]
[Route("api/tenants")]
[Route("api/v2/tenants")]
public class TenantsController : ControllerBase
{
    private readonly NexusDbContext _db;

    public TenantsController(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// GET /api/tenants - List active tenants (public, no auth required).
    /// Query params:
    ///   ?include_master=1 — include tenant ID 1 (platform/master tenant)
    ///   ?slug=acme — filter by slug
    /// </summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> ListTenants(
        [FromQuery] string? include_master = null,
        [FromQuery] string? slug = null)
    {
        var query = _db.Tenants
            .IgnoreQueryFilters()
            .Where(t => t.IsActive);

        // By default, exclude tenant 1 (master/platform) unless explicitly requested
        if (include_master != "1")
        {
            query = query.Where(t => t.Id != 1);
        }

        if (!string.IsNullOrWhiteSpace(slug))
        {
            query = query.Where(t => t.Slug == slug);
        }

        var tenants = await query
            .OrderBy(t => t.Name)
            .Select(t => new TenantResponse
            {
                Id = t.Id,
                Name = t.Name,
                Slug = t.Slug,
                Tagline = t.Tagline,
                Domain = t.Domain,
                LogoUrl = t.LogoUrl
            })
            .ToListAsync();

        return Ok(tenants);
    }

    /// <summary>
    /// GET /api/tenants/{slug} - Get a single tenant by slug (public).
    /// Used for tenant resolution by custom domain or slug lookup.
    /// </summary>
    [HttpGet("{slug}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetTenantBySlug(string slug)
    {
        var tenant = await _db.Tenants
            .IgnoreQueryFilters()
            .Where(t => t.IsActive && t.Slug == slug)
            .Select(t => new TenantResponse
            {
                Id = t.Id,
                Name = t.Name,
                Slug = t.Slug,
                Tagline = t.Tagline,
                Domain = t.Domain,
                LogoUrl = t.LogoUrl
            })
            .FirstOrDefaultAsync();

        if (tenant == null)
            return NotFound(new { error = "Tenant not found" });

        return Ok(tenant);
    }

    public class TenantResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("slug")]
        public string Slug { get; set; } = string.Empty;

        [JsonPropertyName("tagline")]
        public string? Tagline { get; set; }

        [JsonPropertyName("domain")]
        public string? Domain { get; set; }

        [JsonPropertyName("logo_url")]
        public string? LogoUrl { get; set; }
    }
}
