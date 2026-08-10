// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityMemberStatementsController : ControllerBase
{
    private readonly CaringCommunityMemberStatementService _statements;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityMemberStatementsController(
        CaringCommunityMemberStatementService statements,
        TenantContext tenant)
    {
        _statements = statements;
        _tenant = tenant;
    }

    [HttpGet("member-statements/{userId:int}")]
    public async Task<IActionResult> Show(
        int userId,
        [FromQuery(Name = "start_date")] string? startDate,
        [FromQuery(Name = "end_date")] string? endDate,
        [FromQuery] string? format,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _statements.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var filters = new CaringMemberStatementFilters(
            startDate ?? Request.Query["start_date"].FirstOrDefault(),
            endDate ?? Request.Query["end_date"].FirstOrDefault());

        if (string.Equals(format ?? Request.Query["format"].FirstOrDefault(), "csv", StringComparison.OrdinalIgnoreCase))
        {
            var csv = await _statements.CsvAsync(tenantId, userId, filters, ct);
            if (csv is null)
            {
                return StatusCode(StatusCodes.Status404NotFound,
                    LaravelError("NOT_FOUND", "User not found."));
            }

            return Ok(new { data = csv });
        }

        var statement = await _statements.StatementAsync(tenantId, userId, filters, ct);
        if (statement is null)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "User not found."));
        }

        return Ok(new { data = statement });
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };

        if (field is not null)
        {
            error["field"] = field;
        }

        return new { errors = new[] { error } };
    }
}
