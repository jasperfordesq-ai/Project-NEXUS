// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing saved search queries.
/// Users can save, re-run, and optionally receive notifications for new results.
/// </summary>
public class SavedSearchService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<SavedSearchService> _logger;

    private static readonly HashSet<string> ValidSearchTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "listings", "users", "events", "groups"
    };

    private const int MaxSavedSearchesPerUser = 20;

    public SavedSearchService(NexusDbContext db, ILogger<SavedSearchService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// List all saved searches for a user.
    /// </summary>
    public async Task<List<SavedSearch>> ListAsync(int tenantId, int userId)
    {
        return await _db.Set<SavedSearch>()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.UpdatedAt ?? s.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get a single saved search, verifying ownership.
    /// </summary>
    public async Task<(SavedSearch? Search, string? Error)> GetByIdAsync(int tenantId, int userId, int id)
    {
        var search = await _db.Set<SavedSearch>().FirstOrDefaultAsync(x => x.Id == id);

        if (search == null)
            return (null, "Saved search not found.");

        if (search.UserId != userId)
            return (null, "You do not own this saved search.");

        return (search, null);
    }

    /// <summary>
    /// Create a new saved search. Validates name, search type, and enforces max 20 per user.
    /// </summary>
    public async Task<(SavedSearch? Search, string? Error)> CreateAsync(
        int tenantId, int userId, string name, string searchType, string queryJson, bool notifyOnNewResults)
    {
        if (string.IsNullOrWhiteSpace(name))
            return (null, "Name is required.");

        if (!ValidSearchTypes.Contains(searchType))
            return (null, "Invalid search type. Must be one of: " + string.Join(", ", ValidSearchTypes));

        var existingCount = await _db.Set<SavedSearch>()
            .CountAsync(s => s.UserId == userId);

        if (existingCount >= MaxSavedSearchesPerUser)
            return (null, $"Maximum of {MaxSavedSearchesPerUser} saved searches reached.");

        var search = new SavedSearch
        {
            TenantId = tenantId,
            UserId = userId,
            Name = name.Trim(),
            SearchType = searchType.ToLowerInvariant(),
            QueryJson = string.IsNullOrWhiteSpace(queryJson) ? "{}" : queryJson,
            NotifyOnNewResults = notifyOnNewResults,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<SavedSearch>().Add(search);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Saved search created: {Name} ({SearchType}) for user {UserId}",
            name, searchType, userId);

        return (search, null);
    }

    /// <summary>
    /// Update a saved search. Verifies ownership.
    /// </summary>
    public async Task<(SavedSearch? Search, string? Error)> UpdateAsync(
        int tenantId, int userId, int id, string? name, string? queryJson, bool? notifyOnNewResults)
    {
        var search = await _db.Set<SavedSearch>().FirstOrDefaultAsync(x => x.Id == id);

        if (search == null)
            return (null, "Saved search not found.");

        if (search.UserId != userId)
            return (null, "You do not own this saved search.");

        if (!string.IsNullOrWhiteSpace(name))
            search.Name = name.Trim();

        if (queryJson != null)
            search.QueryJson = queryJson;

        if (notifyOnNewResults.HasValue)
            search.NotifyOnNewResults = notifyOnNewResults.Value;

        search.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return (search, null);
    }

    /// <summary>
    /// Delete a saved search. Verifies ownership. Returns error string or null on success.
    /// </summary>
    public async Task<string?> DeleteAsync(int tenantId, int userId, int id)
    {
        var search = await _db.Set<SavedSearch>().FirstOrDefaultAsync(x => x.Id == id);

        if (search == null)
            return "Saved search not found.";

        if (search.UserId != userId)
            return "You do not own this saved search.";

        _db.Set<SavedSearch>().Remove(search);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Saved search {Id} deleted by user {UserId}", id, userId);

        return null;
    }

    /// <summary>
    /// Mark a search as run and update result count.
    /// </summary>
    public async Task<(SavedSearch? Search, string? Error)> MarkAsRunAsync(
        int tenantId, int userId, int id, int resultCount)
    {
        var search = await _db.Set<SavedSearch>().FirstOrDefaultAsync(x => x.Id == id);

        if (search == null)
            return (null, "Saved search not found.");

        if (search.UserId != userId)
            return (null, "You do not own this saved search.");

        search.LastRunAt = DateTime.UtcNow;
        search.LastResultCount = resultCount;
        search.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        return (search, null);
    }

    // --- Original method names preserved for compatibility ---

    /// <summary>List saved searches (original name).</summary>
    public async Task<List<SavedSearch>> GetSavedSearchesAsync(int userId)
    {
        return await ListAsync(0, userId);
    }

    /// <summary>Get single saved search (original name).</summary>
    public async Task<(SavedSearch? Search, string? Error)> GetSavedSearchAsync(int id, int userId)
    {
        return await GetByIdAsync(0, userId, id);
    }

    /// <summary>Create saved search (original name).</summary>
    public async Task<(SavedSearch? Search, string? Error)> CreateSavedSearchAsync(
        int tenantId, int userId, string name, string searchType, string queryJson, bool notifyOnNewResults)
    {
        return await CreateAsync(tenantId, userId, name, searchType, queryJson, notifyOnNewResults);
    }

    /// <summary>Update saved search (original name).</summary>
    public async Task<(SavedSearch? Search, string? Error)> UpdateSavedSearchAsync(
        int id, int userId, string name, string? queryJson, bool? notifyOnNewResults)
    {
        return await UpdateAsync(0, userId, id, name, queryJson, notifyOnNewResults);
    }

    /// <summary>Delete saved search (original name).</summary>
    public async Task<(bool Success, string? Error)> DeleteSavedSearchAsync(int id, int userId)
    {
        var error = await DeleteAsync(0, userId, id);
        return (error == null, error);
    }

    /// <summary>Mark search run (original name). Verifies ownership before updating.</summary>
    public async Task<(SavedSearch? Search, string? Error)> MarkSearchRunAsync(int id, int userId, int resultCount)
    {
        var search = await _db.Set<SavedSearch>().FirstOrDefaultAsync(x => x.Id == id);
        if (search == null)
            return (null, "Saved search not found.");

        if (search.UserId != userId)
            return (null, "You do not own this saved search.");

        search.LastRunAt = DateTime.UtcNow;
        search.LastResultCount = resultCount;
        search.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return (search, null);
    }

    /// <summary>
    /// Parse a saved search QueryJson and execute it against the appropriate entity set.
    /// Returns matching IDs and total count.
    /// </summary>
    public async Task<(List<int> MatchingIds, int Total, string? Error)> ExecuteSearchAsync(int tenantId, SavedSearch search)
    {
        Dictionary<string, JsonElement>? filters;
        try
        {
            filters = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(search.QueryJson);
        }
        catch (JsonException)
        {
            return (new List<int>(), 0, "Invalid query JSON format.");
        }

        filters ??= new Dictionary<string, JsonElement>();

        string? queryText = filters.TryGetValue("query", out var q) ? q.GetString() : null;

        switch (search.SearchType)
        {
            case "listings":
            {
                var query = _db.Set<Listing>().AsQueryable();

                if (!string.IsNullOrWhiteSpace(queryText))
                    query = query.Where(l => l.Title.Contains(queryText) || (l.Description != null && l.Description.Contains(queryText)));

                if (filters.TryGetValue("category_id", out var catId) && catId.TryGetInt32(out var categoryId))
                    query = query.Where(l => l.CategoryId == categoryId);

                if (filters.TryGetValue("type", out var typeVal))
                {
                    var typeStr = typeVal.GetString();
                    if (string.Equals(typeStr, "offer", StringComparison.OrdinalIgnoreCase))
                        query = query.Where(l => l.Type == ListingType.Offer);
                    else if (string.Equals(typeStr, "request", StringComparison.OrdinalIgnoreCase))
                        query = query.Where(l => l.Type == ListingType.Request);
                }

                if (filters.TryGetValue("min_credits", out var minC) && minC.TryGetDecimal(out var minCredits))
                    query = query.Where(l => l.EstimatedHours >= minCredits);

                if (filters.TryGetValue("max_credits", out var maxC) && maxC.TryGetDecimal(out var maxCredits))
                    query = query.Where(l => l.EstimatedHours <= maxCredits);

                var total = await query.CountAsync();
                var ids = await query.Select(l => l.Id).ToListAsync();
                return (ids, total, null);
            }

            case "users":
            {
                var query = _db.Users.AsQueryable();

                if (!string.IsNullOrWhiteSpace(queryText))
                    query = query.Where(u => u.FirstName.Contains(queryText) || u.LastName.Contains(queryText) || u.Email.Contains(queryText));

                if (filters.TryGetValue("role", out var roleVal))
                {
                    var role = roleVal.GetString();
                    if (!string.IsNullOrWhiteSpace(role))
                        query = query.Where(u => u.Role == role);
                }

                if (filters.TryGetValue("is_active", out var activeVal) && activeVal.ValueKind == JsonValueKind.True)
                    query = query.Where(u => u.IsActive);
                else if (filters.TryGetValue("is_active", out var inactiveVal) && inactiveVal.ValueKind == JsonValueKind.False)
                    query = query.Where(u => !u.IsActive);

                var total = await query.CountAsync();
                var ids = await query.Select(u => u.Id).ToListAsync();
                return (ids, total, null);
            }

            case "events":
            {
                var query = _db.Set<Event>().AsQueryable();

                if (!string.IsNullOrWhiteSpace(queryText))
                    query = query.Where(e => e.Title.Contains(queryText));

                if (filters.TryGetValue("starts_after", out var afterVal))
                {
                    var afterStr = afterVal.GetString();
                    if (DateTime.TryParse(afterStr, out var startsAfter))
                        query = query.Where(e => e.StartsAt >= startsAfter);
                }

                if (filters.TryGetValue("starts_before", out var beforeVal))
                {
                    var beforeStr = beforeVal.GetString();
                    if (DateTime.TryParse(beforeStr, out var startsBefore))
                        query = query.Where(e => e.StartsAt <= startsBefore);
                }

                var total = await query.CountAsync();
                var ids = await query.Select(e => e.Id).ToListAsync();
                return (ids, total, null);
            }

            case "groups":
            {
                var query = _db.Set<Group>().AsQueryable();

                if (!string.IsNullOrWhiteSpace(queryText))
                    query = query.Where(g => g.Name.Contains(queryText) || (g.Description != null && g.Description.Contains(queryText)));

                if (filters.TryGetValue("is_public", out var pubVal))
                {
                    if (pubVal.ValueKind == JsonValueKind.True)
                        query = query.Where(g => !g.IsPrivate);
                    else if (pubVal.ValueKind == JsonValueKind.False)
                        query = query.Where(g => g.IsPrivate);
                }

                var total = await query.CountAsync();
                var ids = await query.Select(g => g.Id).ToListAsync();
                return (ids, total, null);
            }

            default:
                return (new List<int>(), 0, $"Unsupported search type: {search.SearchType}");
        }
    }

    /// <summary>
    /// Execute a saved search and return full results with metadata.
    /// </summary>
    public async Task<(object? Results, string? Error)> RunSearchWithResultsAsync(int tenantId, int userId, int searchId)
    {
        var (search, error) = await GetByIdAsync(tenantId, userId, searchId);
        if (search == null)
            return (null, error);

        var (matchingIds, total, execError) = await ExecuteSearchAsync(tenantId, search);
        if (execError != null)
            return (null, execError);

        // Update LastRunAt and LastResultCount
        search.LastRunAt = DateTime.UtcNow;
        search.LastResultCount = total;
        search.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var result = new
        {
            search_id = search.Id,
            search_name = search.Name,
            search_type = search.SearchType,
            total_results = total,
            matching_ids = matchingIds,
            executed_at = search.LastRunAt
        };

        _logger.LogInformation(
            "Search {SearchId} executed for user {UserId}: {Total} results",
            searchId, userId, total);

        return (result, null);
    }
}
