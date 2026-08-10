// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin CMS page management - CRUD, versioning, reorder, duplicate.
/// </summary>
[ApiController]
[Route("api/admin/pages")]
[Route("api/v2/admin/pages")]
[Authorize(Policy = "AdminOnly")]
public class AdminPagesController : ControllerBase
{
    private readonly PageService _pages;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public AdminPagesController(PageService pages, NexusDbContext db, TenantContext tenantContext)
    {
        _pages = pages;
        _db = db;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/admin/pages - List all pages (including unpublished).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAllPages()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var pages = await _db.Pages
            .AsNoTracking()
            .Include(p => p.CreatedBy)
            .Where(p => p.TenantId == tenantId)
            .OrderBy(p => p.SortOrder)
            .ThenByDescending(p => p.CreatedAt)
            .ToListAsync();
        var metadata = await LoadPageMetadataMapAsync(tenantId, pages.Select(p => p.Id));

        return Ok(new
        {
            data = pages.Select(p => MapLaravelAdminPage(p, metadata.GetValueOrDefault(p.Id), includeContent: false))
        });
    }

    /// <summary>
    /// GET /api/admin/pages/{id} - Get page details (including unpublished).
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetPage(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var page = await _db.Pages
            .AsNoTracking()
            .Include(p => p.CreatedBy)
            .Include(p => p.Children)
            .FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (page == null) return NotFound(new { error = "Page not found" });

        var metadata = await LoadPageMetadataAsync(tenantId, id);
        return Ok(new
        {
            data = MapLaravelAdminPage(page, metadata, includeContent: true)
        });
    }

    /// <summary>
    /// POST /api/admin/pages - Create a page.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> CreatePage([FromBody] JsonElement request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var title = ReadString(request, "title");
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(new { error = "VALIDATION_ERROR", message = "Title is required", field = "title" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var slug = NormalizePageSlug(ReadString(request, "slug") ?? title);
        if (await _db.Pages.AnyAsync(p => p.TenantId == tenantId && p.Slug == slug))
            slug = $"{slug}-{DateTime.UtcNow.Ticks % 10000}";

        var metadata = PageCompatibilityMetadata.From(request);
        var page = new Page
        {
            TenantId = tenantId,
            Title = title.Trim(),
            Slug = slug,
            Content = ReadString(request, "content") ?? string.Empty,
            IsPublished = ReadPublishedState(request, fallback: false),
            ShowInMenu = ReadBoolLike(request, "show_in_menu") ?? false,
            MenuLocation = ReadString(request, "menu_location") ?? "about",
            ParentId = ReadInt(request, "parent_id"),
            PublishAt = ReadDateTime(request, "publish_at"),
            MetaTitle = ReadString(request, "meta_title"),
            MetaDescription = ReadString(request, "meta_description"),
            SortOrder = ReadInt(request, "sort_order") ?? 0,
            CreatedById = userId.Value,
            CreatedAt = DateTime.UtcNow,
            CurrentVersion = 1
        };

        _db.Pages.Add(page);
        await _db.SaveChangesAsync();
        _db.PageVersions.Add(new PageVersion
        {
            PageId = page.Id,
            VersionNumber = 1,
            Title = page.Title,
            Slug = page.Slug,
            Content = page.Content,
            CreatedById = userId.Value
        });
        await SavePageMetadataAsync(tenantId, page.Id, metadata, saveChanges: false);
        await _db.SaveChangesAsync();

        return Created($"/api/v2/admin/pages/{page.Id}", new { data = MapLaravelAdminPage(page, metadata, includeContent: true) });
    }

    /// <summary>
    /// PUT /api/admin/pages/{id} - Update a page.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdatePage(int id, [FromBody] JsonElement request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var page = await _db.Pages.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (page == null) return NotFound(new { error = "Page not found" });

        if (request.TryGetProperty("title", out _))
        {
            var title = ReadString(request, "title");
            if (string.IsNullOrWhiteSpace(title))
                return BadRequest(new { error = "VALIDATION_ERROR", message = "Title is required", field = "title" });
            page.Title = title.Trim();
        }

        if (request.TryGetProperty("slug", out _))
        {
            var slug = NormalizePageSlug(ReadString(request, "slug") ?? page.Title);
            var exists = await _db.Pages.AnyAsync(p => p.TenantId == tenantId && p.Id != id && p.Slug == slug);
            if (exists) return Conflict(new { error = "A page with this slug already exists" });
            page.Slug = slug;
        }
        else if (request.TryGetProperty("title", out _))
        {
            var slug = NormalizePageSlug(page.Title);
            var exists = await _db.Pages.AnyAsync(p => p.TenantId == tenantId && p.Id != id && p.Slug == slug);
            page.Slug = exists ? $"{slug}-{DateTime.UtcNow.Ticks % 10000}" : slug;
        }

        if (request.TryGetProperty("content", out _)) page.Content = ReadString(request, "content") ?? string.Empty;
        if (request.TryGetProperty("status", out _) || request.TryGetProperty("is_published", out _))
            page.IsPublished = ReadPublishedState(request, page.IsPublished);
        if (request.TryGetProperty("show_in_menu", out _)) page.ShowInMenu = ReadBoolLike(request, "show_in_menu") ?? page.ShowInMenu;
        if (request.TryGetProperty("menu_location", out _)) page.MenuLocation = ReadString(request, "menu_location");
        if (request.TryGetProperty("parent_id", out _)) page.ParentId = ReadInt(request, "parent_id");
        if (request.TryGetProperty("publish_at", out _)) page.PublishAt = ReadDateTime(request, "publish_at");
        if (request.TryGetProperty("meta_title", out _)) page.MetaTitle = ReadString(request, "meta_title");
        if (request.TryGetProperty("meta_description", out _)) page.MetaDescription = ReadString(request, "meta_description");
        if (request.TryGetProperty("sort_order", out _)) page.SortOrder = ReadInt(request, "sort_order") ?? page.SortOrder;

        page.UpdatedAt = DateTime.UtcNow;
        page.CurrentVersion++;
        _db.PageVersions.Add(new PageVersion
        {
            PageId = page.Id,
            VersionNumber = page.CurrentVersion,
            Title = page.Title,
            Slug = page.Slug,
            Content = page.Content,
            CreatedById = userId.Value
        });

        var metadata = await LoadPageMetadataAsync(tenantId, id);
        metadata.Apply(request);
        await SavePageMetadataAsync(tenantId, id, metadata, saveChanges: false);
        await _db.SaveChangesAsync();

        return Ok(new { data = MapLaravelAdminPage(page, metadata, includeContent: true) });
    }

    /// <summary>
    /// DELETE /api/admin/pages/{id} - Delete a page.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeletePage(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var page = await _db.Pages.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (page == null) return NotFound(new { error = "Page not found" });

        var children = await _db.Pages.Where(p => p.TenantId == tenantId && p.ParentId == id).ToListAsync();
        foreach (var child in children) child.ParentId = null;

        var versions = await _db.PageVersions.Where(v => v.PageId == id).ToListAsync();
        _db.PageVersions.RemoveRange(versions);
        _db.Pages.Remove(page);
        await DeletePageMetadataAsync(tenantId, id, saveChanges: false);
        await _db.SaveChangesAsync();

        return Ok(new { data = new { deleted = true } });
    }

    /// <summary>
    /// GET /api/admin/pages/{id}/versions - Get version history.
    /// </summary>
    [HttpGet("{id:int}/versions")]
    public async Task<IActionResult> GetVersions(int id)
    {
        var versions = await _pages.GetVersionsAsync(id);
        return Ok(new
        {
            data = versions.Select(v => new
            {
                v.Id,
                v.VersionNumber,
                v.Title,
                v.Slug,
                v.CreatedAt,
                created_by = v.CreatedBy != null ? new { v.CreatedBy.Id, v.CreatedBy.FirstName, v.CreatedBy.LastName } : null
            })
        });
    }

    /// <summary>
    /// POST /api/admin/pages/{id}/revert - Revert to a specific version.
    /// </summary>
    [HttpPost("{id:int}/revert")]
    public async Task<IActionResult> RevertToVersion(int id, [FromBody] RevertRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (page, error) = await _pages.RevertToVersionAsync(id, request.VersionNumber, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { page!.Id, page.Title, current_version = page.CurrentVersion } });
    }

    /// <summary>
    /// POST /api/admin/pages/{id}/duplicate - Duplicate a page.
    /// </summary>
    [HttpPost("{id:int}/duplicate")]
    public async Task<IActionResult> DuplicatePage(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (page, error) = await _pages.DuplicatePageAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Created($"/api/pages/{page!.Slug}", new { data = new { page.Id, page.Title, page.Slug } });
    }

    /// <summary>
    /// PUT /api/admin/pages/reorder - Reorder pages.
    /// </summary>
    [HttpPut("reorder")]
    public async Task<IActionResult> ReorderPages([FromBody] ReorderPagesRequest request)
    {
        var ordering = request.Pages.Select(p => (p.Id, p.SortOrder)).ToList();
        var error = await _pages.ReorderPagesAsync(ordering);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Pages reordered" });
    }

    private async Task<Dictionary<int, PageCompatibilityMetadata>> LoadPageMetadataMapAsync(int tenantId, IEnumerable<int> pageIds)
    {
        var ids = pageIds.Distinct().ToArray();
        if (ids.Length == 0) return new Dictionary<int, PageCompatibilityMetadata>();

        var keys = ids.ToDictionary(PageMetadataKey, id => id);
        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && keys.Keys.Contains(c.Key))
            .ToListAsync();

        var result = ids.ToDictionary(id => id, _ => new PageCompatibilityMetadata());
        foreach (var row in rows)
        {
            if (keys.TryGetValue(row.Key, out var id))
                result[id] = DeserializePageMetadata(row.Value);
        }

        return result;
    }

    private async Task<PageCompatibilityMetadata> LoadPageMetadataAsync(int tenantId, int pageId)
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == PageMetadataKey(pageId))
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        return DeserializePageMetadata(raw);
    }

    private async Task SavePageMetadataAsync(int tenantId, int pageId, PageCompatibilityMetadata metadata, bool saveChanges = true)
    {
        var key = PageMetadataKey(pageId);
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        var now = DateTime.UtcNow;
        var value = JsonSerializer.Serialize(metadata);

        if (row == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = value,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            row.Value = value;
            row.UpdatedAt = now;
        }

        if (saveChanges)
            await _db.SaveChangesAsync();
    }

    private async Task DeletePageMetadataAsync(int tenantId, int pageId, bool saveChanges = true)
    {
        var key = PageMetadataKey(pageId);
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (row != null)
            _db.TenantConfigs.Remove(row);

        if (saveChanges)
            await _db.SaveChangesAsync();
    }

    private static PageCompatibilityMetadata DeserializePageMetadata(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new PageCompatibilityMetadata();
        try
        {
            return JsonSerializer.Deserialize<PageCompatibilityMetadata>(raw, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? new PageCompatibilityMetadata();
        }
        catch (JsonException)
        {
            return new PageCompatibilityMetadata();
        }
    }

    private static string PageMetadataKey(int pageId) => $"admin.pages.metadata.{pageId}";

    private static object MapLaravelAdminPage(Page page, PageCompatibilityMetadata? metadata, bool includeContent)
    {
        metadata ??= new PageCompatibilityMetadata();
        var common = new Dictionary<string, object?>
        {
            ["id"] = page.Id,
            ["tenant_id"] = page.TenantId,
            ["title"] = page.Title,
            ["slug"] = page.Slug,
            ["meta_description"] = page.MetaDescription,
            ["status"] = page.IsPublished ? "published" : "draft",
            ["sort_order"] = page.SortOrder,
            ["show_in_menu"] = page.ShowInMenu ? 1 : 0,
            ["menu_location"] = page.MenuLocation ?? "about",
            ["menu_order"] = metadata.MenuOrder ?? page.SortOrder,
            ["publish_at"] = page.PublishAt,
            ["created_at"] = page.CreatedAt,
            ["updated_at"] = page.UpdatedAt
        };

        if (includeContent)
        {
            common["content"] = page.Content;
            common["content_format"] = metadata.ContentFormat;
            common["design_json"] = metadata.DesignJson;
            common["meta_title"] = page.MetaTitle;
            common["is_published"] = page.IsPublished;
            common["parent_id"] = page.ParentId;
            common["current_version"] = page.CurrentVersion;
            common["children"] = page.Children?.Select(c => new { c.Id, c.Title, c.Slug });
            common["created_by"] = page.CreatedBy != null
                ? new { page.CreatedBy.Id, page.CreatedBy.FirstName, page.CreatedBy.LastName }
                : null;
        }

        return common;
    }

    private static bool ReadPublishedState(JsonElement body, bool fallback)
    {
        var status = ReadString(body, "status");
        if (!string.IsNullOrWhiteSpace(status))
            return status.Equals("published", StringComparison.OrdinalIgnoreCase);

        return ReadBoolLike(body, "is_published") ?? fallback;
    }

    private static string? ReadString(JsonElement body, string propertyName)
    {
        if (!body.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => value.GetRawText()
        };
    }

    private static int? ReadInt(JsonElement body, string propertyName)
    {
        if (!body.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
            return number;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed))
            return parsed;

        return null;
    }

    private static bool? ReadBoolLike(JsonElement body, string propertyName)
    {
        if (!body.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            JsonValueKind.String when int.TryParse(value.GetString(), out var number) => number != 0,
            _ => null
        };
    }

    private static DateTime? ReadDateTime(JsonElement body, string propertyName)
    {
        var raw = ReadString(body, propertyName);
        return DateTime.TryParse(raw, out var parsed) ? parsed : null;
    }

    private static string NormalizePageSlug(string value)
    {
        var raw = value.Trim().TrimStart('/');
        var builder = new StringBuilder();
        var pendingDash = false;

        foreach (var ch in raw.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                if (pendingDash && builder.Length > 0)
                    builder.Append('-');
                builder.Append(ch);
                pendingDash = false;
            }
            else if (ch is '-' or '_' or ' ' or '/')
            {
                pendingDash = true;
            }
        }

        return builder.Length == 0 ? $"page-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}" : builder.ToString();
    }

    private sealed class PageCompatibilityMetadata
    {
        [JsonPropertyName("content_format")]
        public string ContentFormat { get; set; } = "richtext";

        [JsonPropertyName("design_json")]
        public string? DesignJson { get; set; }

        [JsonPropertyName("menu_order")]
        public int? MenuOrder { get; set; }

        public static PageCompatibilityMetadata From(JsonElement body)
        {
            var metadata = new PageCompatibilityMetadata();
            metadata.Apply(body);
            return metadata;
        }

        public void Apply(JsonElement body)
        {
            var contentFormat = ReadString(body, "content_format");
            if (!string.IsNullOrWhiteSpace(contentFormat))
                ContentFormat = contentFormat;

            if (body.TryGetProperty("design_json", out _))
                DesignJson = ReadString(body, "design_json");

            if (body.TryGetProperty("menu_order", out _))
                MenuOrder = ReadInt(body, "menu_order");
        }
    }
}

public class CreatePageRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;
    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
    [JsonPropertyName("is_published")]
    public bool IsPublished { get; set; } = false;
    [JsonPropertyName("show_in_menu")]
    public bool ShowInMenu { get; set; } = false;
    [JsonPropertyName("menu_location")]
    public string? MenuLocation { get; set; }
    [JsonPropertyName("parent_id")]
    public int? ParentId { get; set; }
    [JsonPropertyName("publish_at")]
    public DateTime? PublishAt { get; set; }
    [JsonPropertyName("meta_title")]
    public string? MetaTitle { get; set; }
    [JsonPropertyName("meta_description")]
    public string? MetaDescription { get; set; }
    [JsonPropertyName("sort_order")]
    public int? SortOrder { get; set; }
}

public class UpdatePageRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }
    [JsonPropertyName("content")]
    public string? Content { get; set; }
    [JsonPropertyName("is_published")]
    public bool? IsPublished { get; set; }
    [JsonPropertyName("show_in_menu")]
    public bool? ShowInMenu { get; set; }
    [JsonPropertyName("menu_location")]
    public string? MenuLocation { get; set; }
    [JsonPropertyName("parent_id")]
    public int? ParentId { get; set; }
    [JsonPropertyName("publish_at")]
    public DateTime? PublishAt { get; set; }
    [JsonPropertyName("meta_title")]
    public string? MetaTitle { get; set; }
    [JsonPropertyName("meta_description")]
    public string? MetaDescription { get; set; }
    [JsonPropertyName("sort_order")]
    public int? SortOrder { get; set; }
}

public class RevertRequest
{
    [JsonPropertyName("version_number")]
    public int VersionNumber { get; set; }
}

public class ReorderPagesRequest
{
    [JsonPropertyName("pages")]
    public List<PageOrderItem> Pages { get; set; } = new();
}

public class PageOrderItem
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("sort_order")]
    public int SortOrder { get; set; }
}
