// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventFederationStatusController(EventFederationStatusService federation) : ControllerBase
{
    [HttpGet("api/events/{id:int}/federation-status")]
    [HttpGet("api/v2/events/{id:int}/federation-status")]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        var result = await federation.ReadAsync(User.GetTenantId() ?? throw new UnauthorizedAccessException(), id, User.GetUserId() ?? throw new UnauthorizedAccessException(), ct);
        Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        return result.Succeeded ? Ok(new { success = true, data = result.Data }) : StatusCode(result.Error!.Status, new { success = false, errors = new[] { new { code = result.Error.Code, message = result.Error.Message } } });
    }
}
