// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Nexus.Api.Configuration;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Meilisearch integration service for full-text search indexing and querying.
/// Falls back gracefully when Meilisearch is not available.
/// </summary>
public class MeilisearchService
{
    private readonly HttpClient _http;
    private readonly MeilisearchOptions _options;
    private readonly ILogger<MeilisearchService> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public MeilisearchService(HttpClient http, IOptions<MeilisearchOptions> options, ILogger<MeilisearchService> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public bool IsEnabled => _options.Enabled;

    private string IndexName(int tenantId, string type) => $"{_options.IndexPrefix}_t{tenantId}_{type}";

    /// <summary>
    /// Search an index with Meilisearch full-text search.
    /// Returns null if Meilisearch is unavailable (caller should fall back to ILIKE).
    /// </summary>
    public async Task<MeilisearchSearchResult?> SearchAsync(int tenantId, string indexType, string query, int limit = 20, int offset = 0)
    {
        if (!_options.Enabled) return null;

        try
        {
            var index = IndexName(tenantId, indexType);
            var request = new
            {
                q = query,
                limit,
                offset,
                attributesToHighlight = new[] { "title", "description", "name" },
                highlightPreTag = "<mark>",
                highlightPostTag = "</mark>"
            };

            var response = await _http.PostAsJsonAsync($"/indexes/{index}/search", request, JsonOptions);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Meilisearch search failed: {StatusCode} for index {Index}", response.StatusCode, index);
                return null;
            }

            return await response.Content.ReadFromJsonAsync<MeilisearchSearchResult>(JsonOptions);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Meilisearch search error for tenant {TenantId}, type {Type}", tenantId, indexType);
            return null;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Meilisearch search error for tenant {TenantId}, type {Type}", tenantId, indexType);
            return null;
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Meilisearch search error for tenant {TenantId}, type {Type}", tenantId, indexType);
            return null;
        }
    }

    /// <summary>
    /// Multi-index search across multiple types simultaneously.
    /// </summary>
    public async Task<Dictionary<string, MeilisearchSearchResult>?> MultiSearchAsync(int tenantId, string query, string[] types, int limitPerType = 5)
    {
        if (!_options.Enabled) return null;

        try
        {
            var queries = types.Select(t => new
            {
                indexUid = IndexName(tenantId, t),
                q = query,
                limit = limitPerType,
                attributesToHighlight = new[] { "title", "description", "name" },
                highlightPreTag = "<mark>",
                highlightPostTag = "</mark>"
            }).ToArray();

            var response = await _http.PostAsJsonAsync("/multi-search", new { queries }, JsonOptions);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Meilisearch multi-search failed: {StatusCode}", response.StatusCode);
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync<MeilisearchMultiSearchResult>(JsonOptions);
            if (result?.Results == null) return null;

            var dict = new Dictionary<string, MeilisearchSearchResult>();
            for (int i = 0; i < types.Length && i < result.Results.Count; i++)
            {
                dict[types[i]] = result.Results[i];
            }
            return dict;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Meilisearch multi-search error for tenant {TenantId}", tenantId);
            return null;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Meilisearch multi-search error for tenant {TenantId}", tenantId);
            return null;
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Meilisearch multi-search error for tenant {TenantId}", tenantId);
            return null;
        }
    }

    /// <summary>
    /// Index a single document (upsert).
    /// </summary>
    public async Task IndexDocumentAsync(int tenantId, string indexType, object document)
    {
        if (!_options.Enabled) return;

        try
        {
            var index = IndexName(tenantId, indexType);
            await _http.PostAsJsonAsync($"/indexes/{index}/documents", new[] { document }, JsonOptions);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Meilisearch index document error");
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Meilisearch index document error");
        }
    }

    /// <summary>
    /// Index multiple documents in batch.
    /// </summary>
    public async Task IndexDocumentsAsync(int tenantId, string indexType, IEnumerable<object> documents)
    {
        if (!_options.Enabled) return;

        try
        {
            var index = IndexName(tenantId, indexType);
            await _http.PostAsJsonAsync($"/indexes/{index}/documents", documents, JsonOptions);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Meilisearch batch index error");
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Meilisearch batch index error");
        }
    }

    /// <summary>
    /// Delete a document from an index.
    /// </summary>
    public async Task DeleteDocumentAsync(int tenantId, string indexType, int documentId)
    {
        if (!_options.Enabled) return;

        try
        {
            var index = IndexName(tenantId, indexType);
            await _http.DeleteAsync($"/indexes/{index}/documents/{documentId}");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Meilisearch delete document error");
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Meilisearch delete document error");
        }
    }

    /// <summary>
    /// Create or update an index with searchable/filterable attributes.
    /// </summary>
    public async Task<bool> EnsureIndexAsync(int tenantId, string indexType, string[] searchableAttributes, string[]? filterableAttributes = null, string[]? sortableAttributes = null)
    {
        if (!_options.Enabled) return false;

        try
        {
            var index = IndexName(tenantId, indexType);

            // Create index
            await _http.PostAsJsonAsync("/indexes", new { uid = index, primaryKey = "id" }, JsonOptions);

            // Configure searchable attributes
            await _http.PutAsJsonAsync($"/indexes/{index}/settings/searchable-attributes", searchableAttributes, JsonOptions);

            // Configure filterable attributes
            if (filterableAttributes != null)
                await _http.PutAsJsonAsync($"/indexes/{index}/settings/filterable-attributes", filterableAttributes, JsonOptions);

            // Configure sortable attributes
            if (sortableAttributes != null)
                await _http.PutAsJsonAsync($"/indexes/{index}/settings/sortable-attributes", sortableAttributes, JsonOptions);

            _logger.LogInformation("Meilisearch index {Index} configured", index);
            return true;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Meilisearch ensure index error for {IndexType}", indexType);
            return false;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Meilisearch ensure index error for {IndexType}", indexType);
            return false;
        }
    }

    /// <summary>
    /// Full reindex of a tenant's data from the database.
    /// </summary>
    public async Task ReindexTenantAsync(NexusDbContext db, int tenantId)
    {
        if (!_options.Enabled) return;

        _logger.LogInformation("Starting full reindex for tenant {TenantId}", tenantId);

        // Index listings
        await EnsureIndexAsync(tenantId, "listings",
            searchableAttributes: new[] { "title", "description", "location" },
            filterableAttributes: new[] { "type", "status", "categoryId" },
            sortableAttributes: new[] { "createdAt", "estimatedHours" });

        var listings = await db.Listings
            .Where(l => l.TenantId == tenantId && l.Status == ListingStatus.Active)
            .Select(l => new { l.Id, l.Title, l.Description, l.Location, type = l.Type.ToString().ToLower(), status = l.Status.ToString().ToLower(), l.CategoryId, l.EstimatedHours, l.CreatedAt })
            .ToListAsync();
        if (listings.Any())
            await IndexDocumentsAsync(tenantId, "listings", listings.Cast<object>());

        // Index users
        await EnsureIndexAsync(tenantId, "users",
            searchableAttributes: new[] { "firstName", "lastName" },
            filterableAttributes: new[] { "isActive" },
            sortableAttributes: new[] { "createdAt" });

        var users = await db.Users
            .Where(u => u.TenantId == tenantId && u.IsActive)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.IsActive, u.CreatedAt })
            .ToListAsync();
        if (users.Any())
            await IndexDocumentsAsync(tenantId, "users", users.Cast<object>());

        // Index groups
        await EnsureIndexAsync(tenantId, "groups",
            searchableAttributes: new[] { "name", "description" },
            filterableAttributes: new[] { "isPrivate" },
            sortableAttributes: new[] { "createdAt" });

        var groups = await db.Groups
            .Where(g => g.TenantId == tenantId)
            .Select(g => new { g.Id, g.Name, g.Description, g.IsPrivate, g.CreatedAt })
            .ToListAsync();
        if (groups.Any())
            await IndexDocumentsAsync(tenantId, "groups", groups.Cast<object>());

        // Index events
        await EnsureIndexAsync(tenantId, "events",
            searchableAttributes: new[] { "title", "description", "location" },
            filterableAttributes: new[] { "isCancelled" },
            sortableAttributes: new[] { "startsAt", "createdAt" });

        var events = await db.Events
            .Where(e => e.TenantId == tenantId && !e.IsCancelled)
            .Select(e => new { e.Id, e.Title, e.Description, e.Location, e.IsCancelled, e.StartsAt, e.CreatedAt })
            .ToListAsync();
        if (events.Any())
            await IndexDocumentsAsync(tenantId, "events", events.Cast<object>());

        // Index KB articles
        await EnsureIndexAsync(tenantId, "kb",
            searchableAttributes: new[] { "title", "content", "tags" },
            filterableAttributes: new[] { "categoryId", "isPublished" },
            sortableAttributes: new[] { "createdAt" });

        var articles = await db.KnowledgeArticles
            .Where(a => a.TenantId == tenantId && a.IsPublished)
            .Select(a => new { a.Id, a.Title, content = a.Content ?? "", tags = a.Tags ?? "", a.IsPublished, a.CreatedAt })
            .ToListAsync();
        if (articles.Any())
            await IndexDocumentsAsync(tenantId, "kb", articles.Cast<object>());

        // Index jobs
        await EnsureIndexAsync(tenantId, "jobs",
            searchableAttributes: new[] { "title", "description", "location" },
            filterableAttributes: new[] { "status", "type" },
            sortableAttributes: new[] { "createdAt" });

        var jobs = await db.JobVacancies
            .Where(j => j.TenantId == tenantId && j.Status == "active")
            .Select(j => new { j.Id, j.Title, j.Description, j.Location, j.Status, type = j.JobType, j.CreatedAt })
            .ToListAsync();
        if (jobs.Any())
            await IndexDocumentsAsync(tenantId, "jobs", jobs.Cast<object>());

        _logger.LogInformation("Reindex complete for tenant {TenantId}: {Listings} listings, {Users} users, {Groups} groups, {Events} events, {Articles} articles, {Jobs} jobs",
            tenantId, listings.Count, users.Count, groups.Count, events.Count, articles.Count, jobs.Count);
    }

    /// <summary>
    /// Check if Meilisearch is healthy.
    /// </summary>
    public async Task<bool> IsHealthyAsync()
    {
        if (!_options.Enabled) return false;

        try
        {
            var response = await _http.GetAsync("/health");
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Get Meilisearch stats.
    /// </summary>
    public async Task<MeilisearchStats?> GetStatsAsync()
    {
        if (!_options.Enabled) return null;

        try
        {
            var response = await _http.GetAsync("/stats");
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadFromJsonAsync<MeilisearchStats>(JsonOptions);
        }
        catch
        {
            return null;
        }
    }
}

// DTOs for Meilisearch responses

public class MeilisearchSearchResult
{
    [JsonPropertyName("hits")] public List<JsonElement> Hits { get; set; } = new();
    [JsonPropertyName("query")] public string Query { get; set; } = string.Empty;
    [JsonPropertyName("processingTimeMs")] public int ProcessingTimeMs { get; set; }
    [JsonPropertyName("limit")] public int Limit { get; set; }
    [JsonPropertyName("offset")] public int Offset { get; set; }
    [JsonPropertyName("estimatedTotalHits")] public int EstimatedTotalHits { get; set; }
}

public class MeilisearchMultiSearchResult
{
    [JsonPropertyName("results")] public List<MeilisearchSearchResult> Results { get; set; } = new();
}

public class MeilisearchStats
{
    [JsonPropertyName("databaseSize")] public long DatabaseSize { get; set; }
    [JsonPropertyName("indexes")] public Dictionary<string, MeilisearchIndexStats>? Indexes { get; set; }
}

public class MeilisearchIndexStats
{
    [JsonPropertyName("numberOfDocuments")] public int NumberOfDocuments { get; set; }
    [JsonPropertyName("isIndexing")] public bool IsIndexing { get; set; }
}
