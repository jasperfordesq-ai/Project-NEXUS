// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/ai-module-docs")]
[Route("api/v2/admin/ai-module-docs")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminAiModuleDocsController : ControllerBase
{
    private readonly AiModuleDocsService _docs;
    private readonly TenantContext _tenant;

    public AdminAiModuleDocsController(AiModuleDocsService docs, TenantContext tenant)
    {
        _docs = docs;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var items = await _docs.ListForTenantAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = items });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] AiModuleDocRequest request, CancellationToken ct)
    {
        try
        {
            var doc = await _docs.UpsertAsync(_tenant.GetTenantIdOrThrow(), UserId(), request, ct);
            return StatusCode(StatusCodes.Status201Created, new { data = doc });
        }
        catch (AiModuleDocsValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION", ex.Message));
        }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] AiModuleDocRequest request, CancellationToken ct)
    {
        try
        {
            var doc = await _docs.UpdateAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), request, ct);
            return Ok(new { data = doc });
        }
        catch (AiModuleDocsNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("NOT_FOUND", ex.Message));
        }
        catch (AiModuleDocsValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION", ex.Message));
        }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Destroy(int id, CancellationToken ct)
    {
        var deleted = await _docs.DeleteAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        return Ok(new { data = new { deleted } });
    }

    [HttpPost("seed-defaults")]
    public async Task<IActionResult> SeedDefaults(CancellationToken ct)
    {
        var inserted = await _docs.SeedDefaultsForTenantAsync(_tenant.GetTenantIdOrThrow(), UserId(), ct);
        return Ok(new { data = new { inserted } });
    }

    private int UserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return int.TryParse(id, out var parsed) ? parsed : 0;
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new { code, message }
            }
        };
    }
}
