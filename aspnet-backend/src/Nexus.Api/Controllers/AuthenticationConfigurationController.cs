// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Authorization;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/v2/admin/config/authentication")]
[Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
public sealed class AuthenticationConfigurationController : ControllerBase
{
    private readonly AuthenticationConfigurationService _configuration;

    public AuthenticationConfigurationController(AuthenticationConfigurationService configuration) =>
        _configuration = configuration;

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var tenantId = CurrentTenantId();
        return Ok(new
        {
            success = true,
            data = new
            {
                config = await _configuration.GetAllAsync(tenantId, cancellationToken),
                defaults = AuthenticationConfigurationService.Defaults
            }
        });
    }

    [HttpPut("bulk")]
    public async Task<IActionResult> UpdateBulk([FromBody] JsonElement body, CancellationToken cancellationToken)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("settings", out var settings)
            || settings.ValueKind != JsonValueKind.Object
            || !settings.EnumerateObject().Any())
        {
            return ValidationError("settings", "The settings field is required.");
        }

        var updates = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var property in settings.EnumerateObject())
        {
            if (!AuthenticationConfigurationService.Defaults.ContainsKey(property.Name))
                return ValidationError(property.Name, "No recognized authentication setting was provided.");
            if (!AuthenticationConfigurationService.TryReadValidValue(property.Name, property.Value, out var value))
                return ValidationError(property.Name, "The given data was invalid.");
            updates[property.Name] = value!;
        }

        await _configuration.UpdateAsync(CurrentTenantId(), updates, cancellationToken);
        return Ok(new { success = true, data = new { updated = updates } });
    }

    private int CurrentTenantId()
    {
        var claim = User.FindFirstValue("tenant_id");
        if (!int.TryParse(claim, out var tenantId) || tenantId <= 0)
            throw new InvalidOperationException("Authenticated administrator has no tenant context.");
        return tenantId;
    }

    private static ObjectResult ValidationError(string field, string message) =>
        new(new
        {
            success = false,
            error = new { code = "VALIDATION_ERROR", message, field }
        }) { StatusCode = StatusCodes.Status422UnprocessableEntity };
}
