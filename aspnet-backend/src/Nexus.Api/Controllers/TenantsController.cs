// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Services;
using Nexus.Api.Support;

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

        // 🔴 Ordered by id, not name. Laravel's list() orders `id asc`
        // (TenantBootstrapController.php:209) and the community picker on the
        // login page renders them in the order it receives.
        var tenants = await query
            .OrderBy(t => t.Id)
            .Select(t => new { t.Id, t.Name, t.Slug, t.Tagline, t.Domain })
            .ToListAsync();

        var tenantIds = tenants.Select(t => t.Id).ToList();

        // Per-tenant overrides for the two flags Laravel publishes here. Both
        // default to true when the tenant has said nothing.
        var configs = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => tenantIds.Contains(c.TenantId)
                && (c.Key == AuthenticationConfigStoreKey
                    || c.Key == TenantFeatureKeys.CanonicalPrefix + BiometricLoginFlag
                    || c.Key == TenantFeatureKeys.LegacyPrefix + BiometricLoginFlag))
            .Select(c => new TenantConfigEntry(c.TenantId, c.Key, c.Value))
            .ToListAsync();

        var data = new List<Dictionary<string, object?>>(tenants.Count);
        foreach (var tenant in tenants)
        {
            var item = new Dictionary<string, object?>
            {
                ["id"] = tenant.Id,
                ["name"] = tenant.Name,
                ["slug"] = tenant.Slug,
                ["authentication_config"] = new Dictionary<string, object?>
                {
                    [AuthenticationConfigurationService.PasskeysConditionalAutofill] =
                        ReadConditionalAutofill(configs, tenant.Id)
                },
                ["features"] = new Dictionary<string, object?>
                {
                    ["biometric_login"] = ReadBiometricLogin(configs, tenant.Id)
                }
            };

            // 🔴 domain and tagline are present ONLY when non-empty. Laravel adds
            // them conditionally (TenantBootstrapController.php:238-243) rather
            // than emitting null, so a client checking `'domain' in tenant` sees
            // the same thing on both backends.
            if (!string.IsNullOrWhiteSpace(tenant.Domain)) item["domain"] = tenant.Domain;
            if (!string.IsNullOrWhiteSpace(tenant.Tagline)) item["tagline"] = tenant.Tagline;

            data.Add(item);
        }

        // Laravel wraps this in respondWithData — `{data, meta}`, not a bare
        // array. There is no logo_url on the wire; Laravel does not select it.
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private const string AuthenticationConfigStoreKey = "authentication_config";
    private const string BiometricLoginFlag = "biometric_login";

    /// <summary>One tenant_config row, narrowed to the columns this list needs.</summary>
    private sealed record TenantConfigEntry(int TenantId, string Key, string? Value);

    private static bool ReadConditionalAutofill(List<TenantConfigEntry> configs, int tenantId)
    {
        var raw = Find(configs, tenantId, AuthenticationConfigStoreKey);
        if (string.IsNullOrWhiteSpace(raw)) return true;

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty(
                    AuthenticationConfigurationService.PasskeysConditionalAutofill, out var value))
            {
                return value.ValueKind switch
                {
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.String => IsTruthy(value.GetString()),
                    _ => true
                };
            }
        }
        catch (JsonException)
        {
            // Malformed stored config falls back to the default, matching
            // Laravel's `json_decode(...) ?: []`.
        }

        return true;
    }

    private static bool ReadBiometricLogin(List<TenantConfigEntry> configs, int tenantId)
    {
        // Both stored spellings -- see TenantFeatureKeys. Defaults to true, as
        // Laravel's FEATURE_DEFAULTS does.
        var flags = configs
            .Where(c => c.TenantId == tenantId && c.Value is not null)
            .ToDictionary(c => c.Key, c => c.Value!, StringComparer.Ordinal);

        return TenantFeatureKeys.Read(flags, BiometricLoginFlag, true);
    }

    private static string? Find(List<TenantConfigEntry> configs, int tenantId, string key) =>
        configs.FirstOrDefault(c => c.TenantId == tenantId && string.Equals(c.Key, key, StringComparison.Ordinal))?.Value;

    private static bool IsTruthy(string? value) =>
        value is not null
        && (value.Equals("1", StringComparison.Ordinal)
            || value.Equals("true", StringComparison.OrdinalIgnoreCase)
            || value.Equals("yes", StringComparison.OrdinalIgnoreCase)
            || value.Equals("on", StringComparison.OrdinalIgnoreCase));

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
