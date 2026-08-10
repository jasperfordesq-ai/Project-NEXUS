// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Dtos;

namespace Nexus.Api.Controllers;

/// <summary>
/// Member directory with name filtering.
/// </summary>
[ApiController]
[Route("api/members")]
[Authorize]
public class MembersController : ControllerBase
{
    private readonly NexusDbContext _db;

    public MembersController(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Get member directory with optional name filter.
    /// </summary>
    /// <param name="query">Query parameters</param>
    /// <returns>Paginated list of members</returns>
    [HttpGet]
    [ProducesResponseType(typeof(MemberDirectoryResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetMembers([FromQuery] MembersQueryParams query)
    {
        // Validate limit explicitly
        if (query.Limit > 50)
        {
            return BadRequest(new { error = "Limit must not exceed 50" });
        }

        if (query.Page < 1)
        {
            return BadRequest(new { error = "Page must be at least 1" });
        }

        var skip = (query.Page - 1) * query.Limit;

        // Base query: active users only
        var usersQuery = _db.Users.Where(u => u.IsActive);

        // Apply name filter if provided
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var searchTerm = EscapeLikePattern(query.Q.ToLowerInvariant());
            usersQuery = usersQuery.Where(u =>
                EF.Functions.ILike(u.FirstName, $"%{searchTerm}%") ||
                EF.Functions.ILike(u.LastName, $"%{searchTerm}%"));
        }

        // Get total count
        var totalCount = await usersQuery.CountAsync();

        // Get paginated results
        var members = await usersQuery
            .OrderByDescending(u => u.CreatedAt)
            .Skip(skip)
            .Take(query.Limit)
            .Select(u => new MemberDto
            {
                Id = u.Id,
                FirstName = u.FirstName,
                LastName = u.LastName,
                AvatarUrl = null, // Field doesn't exist on User entity
                Bio = null,       // Field doesn't exist on User entity
                CreatedAt = u.CreatedAt
            })
            .ToListAsync();

        var result = new MemberDirectoryResultDto
        {
            Data = members,
            Pagination = PaginationDto.Create(query.Page, query.Limit, totalCount)
        };

        return Ok(result);
    }

    /// <summary>
    /// Escapes LIKE/ILIKE wildcard characters in user input to prevent wildcard injection.
    /// </summary>
    private static string EscapeLikePattern(string input)
    {
        return input
            .Replace("\\", "\\\\")
            .Replace("%", "\\%")
            .Replace("_", "\\_");
    }
}
