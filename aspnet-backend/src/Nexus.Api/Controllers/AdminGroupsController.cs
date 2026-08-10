// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin group management endpoints.
/// </summary>
[ApiController]
[Route("api/admin/groups")]
[Authorize(Policy = "AdminOnly")]
public class AdminGroupsController : ControllerBase
{
    private readonly NexusDbContext _db;

    public AdminGroupsController(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// GET /api/admin/groups - List all groups with stats.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListGroups(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? search = null,
        [FromQuery] string? type = null)
    {
        var query = _db.Groups
            .Include(g => g.CreatedBy)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(g => g.Name.ToLower().Contains(term) ||
                                     (g.Description != null && g.Description.ToLower().Contains(term)));
        }

        if (type == "public")
            query = query.Where(g => !g.IsPrivate);
        else if (type == "private")
            query = query.Where(g => g.IsPrivate);

        var total = await query.CountAsync();

        var groups = await query
            .OrderByDescending(g => g.CreatedAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();

        var groupIds = groups.Select(g => g.Id).ToList();
        var memberCounts = await _db.GroupMembers
            .Where(m => groupIds.Contains(m.GroupId))
            .GroupBy(m => m.GroupId)
            .Select(g => new { GroupId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.GroupId, x => x.Count);

        return Ok(new
        {
            data = groups.Select(g => new
            {
                g.Id, g.Name, g.Description, is_private = g.IsPrivate, g.CreatedAt,
                member_count = memberCounts.GetValueOrDefault(g.Id, 0),
                created_by = g.CreatedBy != null ? new { g.CreatedBy.Id, g.CreatedBy.FirstName, g.CreatedBy.LastName } : null
            }),
            meta = new { page, limit, total }
        });
    }

    /// <summary>
    /// GET /api/admin/groups/stats - Group statistics.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var totalGroups = await _db.Groups.CountAsync();
        var totalMembers = await _db.GroupMembers.CountAsync();
        var publicGroups = await _db.Groups.CountAsync(g => g.IsPrivate == false);

        return Ok(new
        {
            data = new
            {
                total_groups = totalGroups,
                total_memberships = totalMembers,
                public_groups = publicGroups,
                private_groups = totalGroups - publicGroups
            }
        });
    }

    /// <summary>
    /// DELETE /api/admin/groups/{id} - Admin delete a group.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteGroup(int id)
    {
        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null) return NotFound(new { error = "Group not found" });

        var members = await _db.GroupMembers.Where(m => m.GroupId == id).ToListAsync();
        _db.GroupMembers.RemoveRange(members);
        _db.Groups.Remove(group);
        await _db.SaveChangesAsync();
        return Ok(new { data = new { deleted = true, id } });
    }
}
