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
[Route("api/caring-community/federation-directory")]
[Authorize]
public sealed class CaringCommunityFederationDirectoryController : ControllerBase
{
    private readonly CaringFederationPeerService _peers;
    private readonly TenantContext _tenant;

    public CaringCommunityFederationDirectoryController(
        CaringFederationPeerService peers,
        TenantContext tenant)
    {
        _peers = peers;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _peers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var rows = await _peers.ListDiscoverableAsync(tenantId, ct);
        return Ok(new { data = new { peers = rows } });
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
