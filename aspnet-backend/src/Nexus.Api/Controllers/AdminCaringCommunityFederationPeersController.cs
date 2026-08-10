// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/federation-peers")]
[Authorize]
public sealed class AdminCaringCommunityFederationPeersController : ControllerBase
{
    private readonly CaringFederationPeerService _peers;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityFederationPeersController(
        CaringFederationPeerService peers,
        TenantContext tenant)
    {
        _peers = peers;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var rows = await _peers.ListForTenantAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { peers = rows } });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] CaringFederationPeerRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _peers.CreateAsync(_tenant.GetTenantIdOrThrow(), request, ct);
        if (result.ErrorCode is not null)
        {
            return UnprocessableEntity(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Validation failed."));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpPut("{id:int}/status")]
    public async Task<IActionResult> UpdateStatus(
        int id,
        [FromBody] CaringFederationPeerStatusRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _peers.UpdateStatusAsync(_tenant.GetTenantIdOrThrow(), id, request.Status, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("PEER_NOT_FOUND", "Peer not found."));
        }

        if (result.ErrorCode is not null)
        {
            return UnprocessableEntity(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Validation failed."));
        }

        return Ok(new { data = result.Row });
    }

    [HttpPost("{id:int}/rotate-secret")]
    public async Task<IActionResult> RotateSecret(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _peers.RotateSecretAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("PEER_NOT_FOUND", "Peer not found."));
        }

        return Ok(new { data = result.Row });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Destroy(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        await _peers.DeleteAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        return Ok(new { data = new { deleted = true } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _peers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new
                {
                    code,
                    message
                }
            }
        };
    }
}
