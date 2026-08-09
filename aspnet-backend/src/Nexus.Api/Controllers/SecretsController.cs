// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin controller for managing encrypted tenant secrets (API keys, integration credentials, webhooks).
/// Wraps SecretsVaultService. All endpoints require admin role.
/// </summary>
[ApiController]
[Route("api/admin/secrets")]
[Authorize(Policy = "AdminOnly")]
public class SecretsController : ControllerBase
{
    private readonly SecretsVaultService _secrets;
    private readonly ILogger<SecretsController> _logger;

    public SecretsController(SecretsVaultService secrets, ILogger<SecretsController> logger)
    {
        _secrets = secrets;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/admin/secrets - List all secret keys for this tenant (values not returned).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListSecrets()
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "No tenant context" });

        try
        {
            var keys = await _secrets.ListSecretKeysAsync(tenantId.Value);
            return Ok(new { count = keys.Count, keys });
        }
        catch (ArgumentException ex)
        {
            _logger.LogError(ex, "Error listing secrets for tenant {TenantId}", tenantId);
            return StatusCode(500, new { error = "Failed to list secrets" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Error listing secrets for tenant {TenantId}", tenantId);
            return StatusCode(500, new { error = "Failed to list secrets" });
        }
        catch (CryptographicException ex)
        {
            _logger.LogError(ex, "Error listing secrets for tenant {TenantId}", tenantId);
            return StatusCode(500, new { error = "Failed to list secrets" });
        }
    }

    /// <summary>
    /// GET /api/admin/secrets/{key} - Retrieve the value of a secret.
    /// </summary>
    [HttpGet("{key}")]
    public async Task<IActionResult> GetSecret(string key)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "No tenant context" });

        try
        {
            var value = await _secrets.GetSecretAsync(tenantId.Value, key);
            if (value == null) return NotFound(new { error = "Secret not found" });
            return Ok(new { key, value });
        }
        catch (ArgumentException ex)
        {
            _logger.LogError(ex, "Error getting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to get secret" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Error getting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to get secret" });
        }
        catch (CryptographicException ex)
        {
            _logger.LogError(ex, "Error getting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to get secret" });
        }
    }

    /// <summary>
    /// PUT /api/admin/secrets/{key} - Create or update a secret value.
    /// </summary>
    [HttpPut("{key}")]
    public async Task<IActionResult> SetSecret(string key, [FromBody] SetSecretRequest request)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "No tenant context" });

        try
        {
            await _secrets.SetSecretAsync(tenantId.Value, key, request.Value, request.Description);
            _logger.LogInformation("Secret {Key} set for tenant {TenantId}", key, tenantId);
            return Ok(new { key, updatedAt = DateTime.UtcNow });
        }
        catch (ArgumentException ex)
        {
            _logger.LogError(ex, "Error setting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to set secret" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Error setting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to set secret" });
        }
        catch (CryptographicException ex)
        {
            _logger.LogError(ex, "Error setting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to set secret" });
        }
    }

    /// <summary>
    /// DELETE /api/admin/secrets/{key} - Delete a secret.
    /// </summary>
    [HttpDelete("{key}")]
    public async Task<IActionResult> DeleteSecret(string key)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "No tenant context" });

        try
        {
            var deleted = await _secrets.DeleteSecretAsync(tenantId.Value, key);
            if (!deleted) return NotFound(new { error = "Secret not found" });
            return NoContent();
        }
        catch (ArgumentException ex)
        {
            _logger.LogError(ex, "Error deleting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to delete secret" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Error deleting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to delete secret" });
        }
        catch (CryptographicException ex)
        {
            _logger.LogError(ex, "Error deleting secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to delete secret" });
        }
    }

    /// <summary>
    /// POST /api/admin/secrets/{key}/rotate - Rotate a secret to a new auto-generated value.
    /// </summary>
    [HttpPost("{key}/rotate")]
    public async Task<IActionResult> RotateSecret(string key)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "No tenant context" });

        try
        {
            var existing = await _secrets.GetSecretAsync(tenantId.Value, key);
            if (existing == null) return NotFound(new { error = "Secret not found" });

            var newValue = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
            await _secrets.SetSecretAsync(tenantId.Value, key, newValue);
            _logger.LogInformation("Secret {Key} rotated for tenant {TenantId}", key, tenantId);
            return Ok(new { key, rotatedAt = DateTime.UtcNow, newValue });
        }
        catch (ArgumentException ex)
        {
            _logger.LogError(ex, "Error rotating secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to rotate secret" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Error rotating secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to rotate secret" });
        }
        catch (CryptographicException ex)
        {
            _logger.LogError(ex, "Error rotating secret {Key} for tenant {TenantId}", key, tenantId);
            return StatusCode(500, new { error = "Failed to rotate secret" });
        }
    }
}

public class SetSecretRequest
{
    [Required]
    public string Value { get; set; } = "";

    public string? Description { get; set; }
}
