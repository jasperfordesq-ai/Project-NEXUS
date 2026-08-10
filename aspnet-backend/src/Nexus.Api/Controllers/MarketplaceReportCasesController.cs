// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
[Route("api/marketplace/reports")]
[Route("api/v2/marketplace/reports")]
public sealed class MarketplaceReportCasesController(MarketplaceReportCaseService reports) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Mine(CancellationToken ct)
    {
        Private();
        return Result(await reports.MineAsync(Tenant(), Actor(), ct));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        Private();
        return Result(await reports.ShowAsync(Tenant(), Actor(), id, ct));
    }

    [HttpPost("{id:int}/appeal")]
    public async Task<IActionResult> Appeal(int id, [FromBody] MarketplaceReportAppealRequest request, CancellationToken ct)
        => Result(await reports.AppealAsync(Tenant(), Actor(), id, request.AppealText, ct));

    private IActionResult Result(MarketplaceReportCaseResult result)
    {
        if (result.Succeeded) return StatusCode(result.Status, new { success = true, data = result.Data });
        var error = result.Error!;
        return StatusCode(error.Status, new { success = false, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });
    }

    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int Actor() => User.GetUserId() ?? throw new UnauthorizedAccessException();
    private void Private() { Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID"; }
}

public sealed record MarketplaceReportAppealRequest([property: JsonPropertyName("appeal_text")] string? AppealText);
