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
/// Unified search across listings, users, groups, and events.
/// </summary>
[ApiController]
[Route("api/search")]
[Authorize]
public class SearchController : ControllerBase
{
    private readonly NexusDbContext _db;

    public SearchController(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Unified search across listings, users, groups, and events.
    /// </summary>
    /// <param name="query">Search query parameters</param>
    /// <returns>Search results with pagination</returns>
    [HttpGet]
    [ProducesResponseType(typeof(UnifiedSearchResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Search([FromQuery] SearchQueryParams query)
    {
        // Validate limit explicitly (Range attribute handles 1-50, but we want clear error message)
        if (query.Limit > 50)
        {
            return BadRequest(new { error = "Limit must not exceed 50" });
        }

        if (query.Page < 1)
        {
            return BadRequest(new { error = "Page must be at least 1" });
        }

        // Validate type parameter
        var typeError = query.ValidateType();
        if (typeError != null)
        {
            return BadRequest(new { error = typeError });
        }

        // Validate q parameter
        if (string.IsNullOrWhiteSpace(query.Q))
        {
            return BadRequest(new { error = "Search query is required" });
        }

        if (query.Q.Length < 2)
        {
            return BadRequest(new { error = "Search query must be at least 2 characters" });
        }

        if (query.Q.Length > 100)
        {
            return BadRequest(new { error = "Search query must not exceed 100 characters" });
        }

        var searchTerm = EscapeLikePattern(query.Q.ToLowerInvariant());
        var type = query.Type.ToLowerInvariant();
        var skip = (query.Page - 1) * query.Limit;

        var result = new UnifiedSearchResultDto();
        var totalCount = 0;

        // Search listings
        if (type == "all" || type == "listings")
        {
            var listingsQuery = _db.Listings
                .Where(l => EF.Functions.ILike(l.Title, $"%{searchTerm}%", "\\")
                         || EF.Functions.ILike(l.Description ?? "", $"%{searchTerm}%", "\\"));

            if (type == "listings")
            {
                totalCount = await listingsQuery.CountAsync();
                var listings = await listingsQuery
                    .OrderBy(l => EF.Functions.ILike(l.Title, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(l => l.CreatedAt)
                    .Skip(skip)
                    .Take(query.Limit)
                    .Select(l => new SearchListingDto
                    {
                        Id = l.Id,
                        Title = l.Title,
                        Description = l.Description,
                        Type = l.Type.ToString().ToLower(),
                        Status = l.Status.ToString().ToLower(),
                        CreatedAt = l.CreatedAt
                    })
                    .ToListAsync();

                result.Listings = listings;
            }
            else
            {
                result.Listings = await listingsQuery
                    .OrderBy(l => EF.Functions.ILike(l.Title, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(l => l.CreatedAt)
                    .Take(query.Limit)
                    .Select(l => new SearchListingDto
                    {
                        Id = l.Id,
                        Title = l.Title,
                        Description = l.Description,
                        Type = l.Type.ToString().ToLower(),
                        Status = l.Status.ToString().ToLower(),
                        CreatedAt = l.CreatedAt
                    })
                    .ToListAsync();
            }
        }

        // Search users
        if (type == "all" || type == "users")
        {
            var usersQuery = _db.Users
                .Where(u => u.IsActive)
                .Where(u => EF.Functions.ILike(u.FirstName, $"%{searchTerm}%", "\\")
                         || EF.Functions.ILike(u.LastName, $"%{searchTerm}%", "\\"));

            if (type == "users")
            {
                totalCount = await usersQuery.CountAsync();
                var users = await usersQuery
                    .OrderBy(u => EF.Functions.ILike(u.FirstName, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(u => u.CreatedAt)
                    .Skip(skip)
                    .Take(query.Limit)
                    .Select(u => new SearchUserDto
                    {
                        Id = u.Id,
                        FirstName = u.FirstName,
                        LastName = u.LastName,
                        AvatarUrl = null, // Field doesn't exist on User entity
                        Bio = null        // Field doesn't exist on User entity
                    })
                    .ToListAsync();

                result.Users = users;
            }
            else
            {
                result.Users = await usersQuery
                    .OrderBy(u => EF.Functions.ILike(u.FirstName, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(u => u.CreatedAt)
                    .Take(query.Limit)
                    .Select(u => new SearchUserDto
                    {
                        Id = u.Id,
                        FirstName = u.FirstName,
                        LastName = u.LastName,
                        AvatarUrl = null,
                        Bio = null
                    })
                    .ToListAsync();
            }
        }

        // Search groups
        if (type == "all" || type == "groups")
        {
            var groupsQuery = _db.Groups
                .Include(g => g.Members)
                .Where(g => EF.Functions.ILike(g.Name, $"%{searchTerm}%", "\\")
                         || EF.Functions.ILike(g.Description ?? "", $"%{searchTerm}%", "\\"));

            if (type == "groups")
            {
                totalCount = await groupsQuery.CountAsync();
                var groups = await groupsQuery
                    .OrderBy(g => EF.Functions.ILike(g.Name, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(g => g.CreatedAt)
                    .Skip(skip)
                    .Take(query.Limit)
                    .Select(g => new SearchGroupDto
                    {
                        Id = g.Id,
                        Name = g.Name,
                        Description = g.Description,
                        MemberCount = g.Members.Count,
                        IsPublic = !g.IsPrivate
                    })
                    .ToListAsync();

                result.Groups = groups;
            }
            else
            {
                result.Groups = await groupsQuery
                    .OrderBy(g => EF.Functions.ILike(g.Name, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(g => g.CreatedAt)
                    .Take(query.Limit)
                    .Select(g => new SearchGroupDto
                    {
                        Id = g.Id,
                        Name = g.Name,
                        Description = g.Description,
                        MemberCount = g.Members.Count,
                        IsPublic = !g.IsPrivate
                    })
                    .ToListAsync();
            }
        }

        // Search events
        if (type == "all" || type == "events")
        {
            var eventsQuery = _db.Events
                .Where(e => !e.IsCancelled)
                .Where(e => EF.Functions.ILike(e.Title, $"%{searchTerm}%", "\\")
                         || EF.Functions.ILike(e.Description ?? "", $"%{searchTerm}%", "\\")
                         || EF.Functions.ILike(e.Location ?? "", $"%{searchTerm}%", "\\"));

            if (type == "events")
            {
                totalCount = await eventsQuery.CountAsync();
                var events = await eventsQuery
                    .OrderBy(e => EF.Functions.ILike(e.Title, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(e => e.CreatedAt)
                    .Skip(skip)
                    .Take(query.Limit)
                    .Select(e => new SearchEventDto
                    {
                        Id = e.Id,
                        Title = e.Title,
                        Description = e.Description,
                        Location = e.Location,
                        StartsAt = e.StartsAt,
                        Status = "active" // All returned events are active (cancelled excluded)
                    })
                    .ToListAsync();

                result.Events = events;
            }
            else
            {
                result.Events = await eventsQuery
                    .OrderBy(e => EF.Functions.ILike(e.Title, $"{searchTerm}%", "\\") ? 0 : 1)
                    .ThenByDescending(e => e.CreatedAt)
                    .Take(query.Limit)
                    .Select(e => new SearchEventDto
                    {
                        Id = e.Id,
                        Title = e.Title,
                        Description = e.Description,
                        Location = e.Location,
                        StartsAt = e.StartsAt,
                        Status = "active"
                    })
                    .ToListAsync();
            }
        }

        // For "all" type, total is the sum of returned items (pagination not supported for "all")
        if (type == "all")
        {
            totalCount = result.Listings.Count + result.Users.Count + result.Groups.Count + result.Events.Count;
        }

        // Note: For type="all", pagination reflects per-type limits, not true cross-type paging
        result.Pagination = PaginationDto.Create(type == "all" ? 1 : query.Page, query.Limit, totalCount);

        return Ok(result);
    }

    /// <summary>
    /// Autocomplete suggestions for search.
    /// </summary>
    /// <param name="query">Suggestion query parameters</param>
    /// <returns>Array of suggestions</returns>
    [HttpGet("suggestions")]
    [ProducesResponseType(typeof(List<SearchSuggestionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Suggestions([FromQuery] SuggestionsQueryParams query)
    {
        // Validate limit explicitly
        if (query.Limit > 10)
        {
            return BadRequest(new { error = "Limit must not exceed 10" });
        }

        // Validate q parameter
        if (string.IsNullOrWhiteSpace(query.Q))
        {
            return BadRequest(new { error = "Search query is required" });
        }

        if (query.Q.Length < 2)
        {
            return BadRequest(new { error = "Search query must be at least 2 characters" });
        }

        if (query.Q.Length > 100)
        {
            return BadRequest(new { error = "Search query must not exceed 100 characters" });
        }

        var searchTerm = EscapeLikePattern(query.Q.ToLowerInvariant());
        var suggestions = new List<SearchSuggestionDto>();
        var remaining = query.Limit;

        // Get listing suggestions (prioritize prefix matches)
        if (remaining > 0)
        {
            var listingSuggestions = await _db.Listings
                .Where(l => EF.Functions.ILike(l.Title, $"%{searchTerm}%", "\\"))
                .OrderBy(l => EF.Functions.ILike(l.Title, $"{searchTerm}%", "\\") ? 0 : 1)
                .ThenByDescending(l => l.CreatedAt)
                .Take(remaining)
                .Select(l => new SearchSuggestionDto
                {
                    Text = l.Title,
                    Type = "listings",
                    Id = l.Id
                })
                .ToListAsync();

            suggestions.AddRange(listingSuggestions);
            remaining -= listingSuggestions.Count;
        }

        // Get user suggestions
        if (remaining > 0)
        {
            var userSuggestions = await _db.Users
                .Where(u => u.IsActive)
                .Where(u => EF.Functions.ILike(u.FirstName, $"%{searchTerm}%", "\\")
                         || EF.Functions.ILike(u.LastName, $"%{searchTerm}%", "\\"))
                .OrderBy(u => EF.Functions.ILike(u.FirstName, $"{searchTerm}%", "\\") ? 0 : 1)
                .ThenByDescending(u => u.CreatedAt)
                .Take(remaining)
                .Select(u => new SearchSuggestionDto
                {
                    Text = u.FirstName + " " + u.LastName,
                    Type = "users",
                    Id = u.Id
                })
                .ToListAsync();

            suggestions.AddRange(userSuggestions);
            remaining -= userSuggestions.Count;
        }

        // Get group suggestions
        if (remaining > 0)
        {
            var groupSuggestions = await _db.Groups
                .Where(g => EF.Functions.ILike(g.Name, $"%{searchTerm}%", "\\"))
                .OrderBy(g => EF.Functions.ILike(g.Name, $"{searchTerm}%", "\\") ? 0 : 1)
                .ThenByDescending(g => g.CreatedAt)
                .Take(remaining)
                .Select(g => new SearchSuggestionDto
                {
                    Text = g.Name,
                    Type = "groups",
                    Id = g.Id
                })
                .ToListAsync();

            suggestions.AddRange(groupSuggestions);
            remaining -= groupSuggestions.Count;
        }

        // Get event suggestions
        if (remaining > 0)
        {
            var eventSuggestions = await _db.Events
                .Where(e => !e.IsCancelled)
                .Where(e => EF.Functions.ILike(e.Title, $"%{searchTerm}%", "\\"))
                .OrderBy(e => EF.Functions.ILike(e.Title, $"{searchTerm}%", "\\") ? 0 : 1)
                .ThenByDescending(e => e.CreatedAt)
                .Take(remaining)
                .Select(e => new SearchSuggestionDto
                {
                    Text = e.Title,
                    Type = "events",
                    Id = e.Id
                })
                .ToListAsync();

            suggestions.AddRange(eventSuggestions);
        }

        // Ensure we don't exceed limit and return flat array
        return Ok(suggestions.Take(query.Limit).ToList());
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
