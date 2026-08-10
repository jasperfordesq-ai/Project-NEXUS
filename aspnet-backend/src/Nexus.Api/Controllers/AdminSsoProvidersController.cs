// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin endpoints for tenant-scoped OpenID Connect SSO providers.
/// Mirrors Laravel's /api/v2/admin/sso/providers contract.
/// </summary>
[ApiController]
[Route("api/admin/sso/providers")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminSsoProvidersController : ControllerBase
{
    private readonly TenantSsoProviderService _providers;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AdminSsoProvidersController> _logger;

    public AdminSsoProvidersController(
        TenantSsoProviderService providers,
        TenantContext tenantContext,
        ILogger<AdminSsoProvidersController> logger)
    {
        _providers = providers;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var providers = await _providers.ListForAdminAsync(tenantId, ct);
        return Ok(new
        {
            data = new
            {
                providers,
                presets = TenantSsoProviderService.Presets
            }
        });
    }

    [HttpPut("{providerKey}")]
    public async Task<IActionResult> Upsert(
        string providerKey,
        [FromBody] SsoProviderUpsertRequest request,
        CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        try
        {
            var provider = await _providers.UpsertAsync(
                tenantId,
                providerKey,
                request,
                User.GetUserId(),
                ct);
            return Ok(new { data = new { provider } });
        }
        catch (SsoProviderValidationException ex)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", ex.Message, "provider"));
        }
    }

    [HttpDelete("{providerKey}")]
    public async Task<IActionResult> Destroy(string providerKey, CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        await _providers.DeleteAsync(tenantId, providerKey, User.GetUserId(), ct);
        return Ok(new { data = new { deleted = true } });
    }

    [HttpPost("{providerKey}/test")]
    public async Task<IActionResult> Test(string providerKey, CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var provider = await _providers.FindForAdminAsync(tenantId, providerKey, ct);
        if (provider is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "SSO provider not found.", "provider"));
        }

        try
        {
            var discovery = await _providers.DiscoverAsync(provider.IssuerUrl, ct);
            return Ok(new
            {
                data = new
                {
                    ok = true,
                    issuer = discovery.Issuer,
                    authorization_endpoint = discovery.AuthorizationEndpoint
                }
            });
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "SSO discovery test failed for provider {ProviderKey}", provider.ProviderKey);
            return Ok(new
            {
                data = new
                {
                    ok = false,
                    error = ex.Message
                }
            });
        }
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null) error["field"] = field;
        return new { errors = new[] { error } };
    }
}
