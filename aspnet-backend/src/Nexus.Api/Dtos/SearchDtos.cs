// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Nexus.Api.Dtos;

// ============================================================================
// Query Parameter DTOs
// ============================================================================

/// <summary>
/// Query parameters for GET /api/search
/// </summary>
public class SearchQueryParams
{
    [Required(ErrorMessage = "Search query is required")]
    [MinLength(2, ErrorMessage = "Search query must be at least 2 characters")]
    [MaxLength(100, ErrorMessage = "Search query must not exceed 100 characters")]
    public string Q { get; set; } = string.Empty;

    public string Type { get; set; } = "all";

    [Range(1, int.MaxValue, ErrorMessage = "Page must be at least 1")]
    public int Page { get; set; } = 1;

    [Range(1, 50, ErrorMessage = "Limit must not exceed 50")]
    public int Limit { get; set; } = 20;

    /// <summary>
    /// Validates the type parameter and returns error message if invalid.
    /// </summary>
    public string? ValidateType()
    {
        var validTypes = new[] { "all", "listings", "users", "groups", "events" };
        if (!validTypes.Contains(Type.ToLowerInvariant()))
        {
            return "Invalid type filter. Must be one of: all, listings, users, groups, events";
        }
        return null;
    }
}

/// <summary>
/// Query parameters for GET /api/search/suggestions
/// </summary>
public class SuggestionsQueryParams
{
    [Required(ErrorMessage = "Search query is required")]
    [MinLength(2, ErrorMessage = "Search query must be at least 2 characters")]
    [MaxLength(100, ErrorMessage = "Search query must not exceed 100 characters")]
    public string Q { get; set; } = string.Empty;

    [Range(1, 10, ErrorMessage = "Limit must not exceed 10")]
    public int Limit { get; set; } = 5;
}

/// <summary>
/// Query parameters for GET /api/members
/// </summary>
public class MembersQueryParams
{
    [MaxLength(100, ErrorMessage = "Search query must not exceed 100 characters")]
    public string? Q { get; set; }

    [Range(1, int.MaxValue, ErrorMessage = "Page must be at least 1")]
    public int Page { get; set; } = 1;

    [Range(1, 50, ErrorMessage = "Limit must not exceed 50")]
    public int Limit { get; set; } = 20;
}

// ============================================================================
// Response DTOs
// ============================================================================

/// <summary>
/// Pagination metadata for paginated responses.
/// </summary>
public class PaginationDto
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("pages")]
    public int Pages { get; set; }

    public static PaginationDto Create(int page, int limit, int total)
    {
        return new PaginationDto
        {
            Page = page,
            Limit = limit,
            Total = total,
            Pages = total == 0 ? 0 : (int)Math.Ceiling((double)total / limit)
        };
    }
}

/// <summary>
/// Response for GET /api/search
/// </summary>
public class UnifiedSearchResultDto
{
    [JsonPropertyName("listings")]
    public List<SearchListingDto> Listings { get; set; } = new();

    [JsonPropertyName("users")]
    public List<SearchUserDto> Users { get; set; } = new();

    [JsonPropertyName("groups")]
    public List<SearchGroupDto> Groups { get; set; } = new();

    [JsonPropertyName("events")]
    public List<SearchEventDto> Events { get; set; } = new();

    [JsonPropertyName("pagination")]
    public PaginationDto Pagination { get; set; } = new();
}

/// <summary>
/// Listing item in search results.
/// </summary>
public class SearchListingDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// User item in search results.
/// </summary>
public class SearchUserDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("first_name")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("last_name")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("avatar_url")]
    public string? AvatarUrl { get; set; }

    [JsonPropertyName("bio")]
    public string? Bio { get; set; }
}

/// <summary>
/// Group item in search results.
/// </summary>
public class SearchGroupDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("member_count")]
    public int MemberCount { get; set; }

    [JsonPropertyName("is_public")]
    public bool IsPublic { get; set; }
}

/// <summary>
/// Event item in search results.
/// </summary>
public class SearchEventDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime StartsAt { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "active";
}

/// <summary>
/// Single suggestion item for autocomplete.
/// </summary>
public class SearchSuggestionDto
{
    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("id")]
    public int Id { get; set; }
}

/// <summary>
/// Response for GET /api/members
/// </summary>
public class MemberDirectoryResultDto
{
    [JsonPropertyName("data")]
    public List<MemberDto> Data { get; set; } = new();

    [JsonPropertyName("pagination")]
    public PaginationDto Pagination { get; set; } = new();
}

/// <summary>
/// Member item in directory results.
/// </summary>
public class MemberDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("first_name")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("last_name")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("avatar_url")]
    public string? AvatarUrl { get; set; }

    [JsonPropertyName("bio")]
    public string? Bio { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }
}
