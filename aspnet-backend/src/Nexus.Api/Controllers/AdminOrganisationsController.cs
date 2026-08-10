// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin organisation management - list, verify, suspend.
/// </summary>
[ApiController]
[Route("api/admin/organisations")]
[Authorize(Policy = "AdminOnly")]
public class AdminOrganisationsController : ControllerBase
{
    private readonly OrganisationService _orgs;

    public AdminOrganisationsController(OrganisationService orgs)
    {
        _orgs = orgs;
    }

    /// <summary>
    /// GET /api/admin/organisations - List all organisations (any status).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListOrganisations(
        [FromQuery] string? status = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);
        var (orgs, total) = await _orgs.AdminListAsync(status, search, page, limit);
        return Ok(new
        {
            data = orgs.Select(o => new
            {
                o.Id, o.Name, o.Slug, o.Type, o.Industry, o.Status,
                email = o.Email,
                member_count = o.Members.Count,
                is_public = o.IsPublic, created_at = o.CreatedAt, verified_at = o.VerifiedAt,
                owner = o.Owner != null ? new { o.Owner.Id, o.Owner.FirstName, o.Owner.LastName } : null
            }),
            pagination = new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    /// <summary>
    /// PUT /api/admin/organisations/{id}/verify - Verify an organisation.
    /// </summary>
    [HttpPut("{id:int}/verify")]
    public async Task<IActionResult> Verify(int id)
    {
        var (org, error) = await _orgs.AdminVerifyAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { org!.Id, org.Name, org.Status, verified_at = org.VerifiedAt } });
    }

    /// <summary>
    /// PUT /api/admin/organisations/{id}/suspend - Suspend an organisation.
    /// </summary>
    [HttpPut("{id:int}/suspend")]
    public async Task<IActionResult> Suspend(int id)
    {
        var (org, error) = await _orgs.AdminSuspendAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { org!.Id, org.Name, org.Status } });
    }
}
