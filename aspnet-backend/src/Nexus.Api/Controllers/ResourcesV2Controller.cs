// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/v2/resources")]
public class ResourcesV2Controller : ControllerBase
{
    private static readonly Regex SlugUnsafeCharacters = new("[^a-z0-9]+", RegexOptions.Compiled);
    private static readonly IReadOnlyDictionary<string, string[]> AllowedResourceMimesByExtension = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        ["pdf"] = new[] { "application/pdf" },
        ["doc"] = new[] { "application/msword", "application/vnd.ms-office", "application/x-cfb" },
        ["docx"] = new[] { "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip" },
        ["xls"] = new[] { "application/vnd.ms-excel", "application/vnd.ms-office", "application/x-cfb" },
        ["xlsx"] = new[] { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip" },
        ["txt"] = new[] { "text/plain" },
        ["csv"] = new[] { "text/csv", "text/plain", "application/csv", "application/vnd.ms-excel" },
        ["jpg"] = new[] { "image/jpeg" },
        ["png"] = new[] { "image/png" },
        ["gif"] = new[] { "image/gif" },
        ["webp"] = new[] { "image/webp" }
    };

    private const long MaxUploadBytes = 10 * 1024 * 1024;

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IConfiguration _configuration;

    public ResourcesV2Controller(NexusDbContext db, TenantContext tenantContext, IConfiguration configuration)
    {
        _db = db;
        _tenantContext = tenantContext;
        _configuration = configuration;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> List(
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery] string? cursor = null,
        [FromQuery] string? search = null,
        [FromQuery(Name = "category_id")] int? categoryId = null,
        CancellationToken ct = default)
    {
        var tenantId = TenantId();
        perPage = Math.Clamp(perPage, 1, 50);

        var query = _db.Resources
            .AsNoTracking()
            .Include(r => r.CreatedBy)
            .Include(r => r.Category)
            .Where(r => r.TenantId == tenantId && r.IsPublished);

        if (TryDecodeCursor(cursor, out var afterId))
            query = query.Where(r => r.Id < afterId);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(r =>
                r.Title.ToLower().Contains(term) ||
                (r.Description != null && r.Description.ToLower().Contains(term)));
        }

        if (categoryId.HasValue)
            query = query.Where(r => r.CategoryId == categoryId.Value);

        var items = await query
            .OrderBy(r => r.SortOrder)
            .ThenByDescending(r => r.CreatedAt)
            .Take(perPage + 1)
            .ToListAsync(ct);

        var hasMore = items.Count > perPage;
        var pageItems = items.Take(perPage).ToList();
        var nextCursor = hasMore && pageItems.Count > 0 ? EncodeCursor(pageItems[^1].Id) : null;
        var metadata = await LoadUploadMetadataAsync(pageItems.Select(r => r.Id), ct);
        var downloadCounts = await LoadDownloadCountsAsync(pageItems.Select(r => r.Id), ct);

        return Ok(new
        {
            success = true,
            data = pageItems.Select(resource => MapResource(
                resource,
                metadata.GetValueOrDefault(resource.Id),
                downloadCounts.GetValueOrDefault(resource.Id))),
            meta = new
            {
                base_url = BaseUrl(),
                per_page = perPage,
                has_more = hasMore,
                cursor = nextCursor
            }
        });
    }

    [HttpGet("categories")]
    [AllowAnonymous]
    public async Task<IActionResult> Categories(CancellationToken ct = default)
    {
        var tenantId = TenantId();
        var counts = await _db.Resources
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.CategoryId.HasValue)
            .GroupBy(r => r.CategoryId!.Value)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.CategoryId, x => x.Count, ct);

        var categories = await _db.ResourceCategories
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderBy(c => c.Name)
            .ToListAsync(ct);

        return Ok(new
        {
            success = true,
            data = categories.Select(c => MapCategory(c, counts.GetValueOrDefault(c.Id)))
        });
    }

    [HttpGet("categories/tree")]
    [AllowAnonymous]
    public async Task<IActionResult> CategoryTree(CancellationToken ct = default)
    {
        var tenantId = TenantId();
        var counts = await _db.Resources
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.CategoryId.HasValue)
            .GroupBy(r => r.CategoryId!.Value)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.CategoryId, x => x.Count, ct);

        var all = await _db.ResourceCategories
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .ToListAsync(ct);

        var children = all
            .Where(c => c.ParentId.HasValue)
            .GroupBy(c => c.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        var roots = all.Where(c => !c.ParentId.HasValue).ToList();
        return Ok(new
        {
            success = true,
            data = roots.Select(c => MapCategoryTree(c, children, counts))
        });
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Store(CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });

        var form = await Request.ReadFormAsync(ct);
        var title = form["title"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(new { success = false, error = "Title is required" });

        var file = form.Files.GetFile("file");
        if (file == null || file.Length == 0)
            return BadRequest(new { success = false, error = "File is required" });
        if (file.Length > MaxUploadBytes)
            return BadRequest(new { success = false, error = "File exceeds 10 MB" });

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        var detectedContentType = await DetectResourceMimeAsync(file, ct);
        if (!AllowedResourceMimesByExtension.TryGetValue(extension, out var allowedMimes) ||
            detectedContentType is null ||
            !allowedMimes.Contains(detectedContentType, StringComparer.OrdinalIgnoreCase))
        {
            return ResourceUploadError("FILE_TYPE_NOT_ALLOWED", "File type is not allowed", "file");
        }

        var contentType = detectedContentType;
        var storedFilename = $"{Guid.NewGuid():N}.{extension}";
        var relativePath = $"{TenantId()}/resources/{storedFilename}";
        var fullPath = Path.Combine(UploadsRoot(), relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await using (var output = new FileStream(fullPath, FileMode.Create, FileAccess.Write))
            await file.CopyToAsync(output, ct);

        var categoryId = int.TryParse(form["category_id"].FirstOrDefault(), out var parsedCategoryId)
            ? parsedCategoryId
            : (int?)null;

        var resource = new Resource
        {
            TenantId = TenantId(),
            Title = title.Trim(),
            Description = form["description"].FirstOrDefault()?.Trim(),
            Url = storedFilename,
            ResourceType = contentType,
            CategoryId = categoryId,
            CreatedById = userId.Value,
            SortOrder = await NextSortOrderAsync(categoryId, ct),
            IsPublished = true,
            CreatedAt = DateTime.UtcNow
        };
        _db.Resources.Add(resource);
        await _db.SaveChangesAsync(ct);

        var upload = new FileUpload
        {
            TenantId = resource.TenantId,
            UserId = userId.Value,
            OriginalFilename = SanitizeFilename(file.FileName),
            StoredFilename = storedFilename,
            FilePath = relativePath,
            ContentType = contentType,
            FileSizeBytes = file.Length,
            Category = FileCategory.Document,
            EntityId = resource.Id,
            EntityType = "resource",
            CreatedAt = resource.CreatedAt
        };
        _db.FileUploads.Add(upload);
        await _db.SaveChangesAsync(ct);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = MapResource(resource, UploadMetadata.From(upload)) });
    }

    [HttpGet("{id:int}/download")]
    [Authorize]
    public async Task<IActionResult> Download(int id, CancellationToken ct = default)
    {
        var resource = await _db.Resources.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id && r.TenantId == TenantId(), ct);
        if (resource == null) return NotFound(new { success = false, error = "Resource not found" });

        var upload = await _db.FileUploads
            .AsNoTracking()
            .Where(f => f.TenantId == TenantId() && f.EntityType == "resource" && f.EntityId == id)
            .OrderByDescending(f => f.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (upload == null)
        {
            var fileName = string.IsNullOrWhiteSpace(resource.Url) ? $"resource-{id}.txt" : Path.GetFileName(resource.Url);
            await IncrementDownloadCountAsync(id, ct);
            return File(System.Text.Encoding.UTF8.GetBytes(resource.Title), "application/octet-stream", fileName);
        }

        var fullPath = Path.Combine(UploadsRoot(), upload.FilePath.Replace('/', Path.DirectorySeparatorChar));
        if (!System.IO.File.Exists(fullPath))
            return NotFound(new { success = false, error = "File not found" });

        var bytes = await System.IO.File.ReadAllBytesAsync(fullPath, ct);
        var downloadName = FriendlyDownloadName(resource.Title, upload.StoredFilename);
        await IncrementDownloadCountAsync(id, ct);
        return File(bytes, upload.ContentType, downloadName);
    }

    [HttpPut("{id:int}")]
    [Authorize]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateResourceV2Request request)
    {
        var existing = await _db.Resources
            .Include(r => r.CreatedBy)
            .Include(r => r.Category)
            .FirstOrDefaultAsync(r => r.Id == id && r.TenantId == TenantId());
        if (existing == null) return NotFound(new { success = false, error = "Resource not found" });

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        if (existing.CreatedById != userId.Value && !User.IsAdmin())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You can only update your own resources" });

        if (request.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
                return BadRequest(new { success = false, error = "Title is required" });
            existing.Title = request.Title.Trim();
        }

        if (request.Description is not null)
            existing.Description = request.Description.Trim();
        if (request.CategoryId.HasValue)
            existing.CategoryId = request.CategoryId.Value;
        if (!string.IsNullOrWhiteSpace(request.FilePath ?? request.Url))
            existing.Url = request.FilePath ?? request.Url;
        if (!string.IsNullOrWhiteSpace(request.FileType ?? request.ResourceType))
            existing.ResourceType = request.FileType ?? request.ResourceType ?? existing.ResourceType;
        existing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        var metadata = (await LoadUploadMetadataAsync(new[] { existing.Id }, CancellationToken.None)).GetValueOrDefault(existing.Id);
        var downloads = (await LoadDownloadCountsAsync(new[] { existing.Id }, CancellationToken.None)).GetValueOrDefault(existing.Id);
        return Ok(new { success = true, data = MapResource(existing, metadata, downloads) });
    }

    [HttpDelete("{id:int}")]
    [Authorize]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _db.Resources.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == TenantId());
        if (existing == null) return NotFound(new { success = false, error = "Resource not found" });

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        if (existing.CreatedById != userId.Value && !User.IsAdmin())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You can only delete your own resources" });

        var uploads = await _db.FileUploads
            .Where(f => f.TenantId == TenantId() && f.EntityType == "resource" && f.EntityId == id)
            .ToListAsync();
        foreach (var upload in uploads)
        {
            var fullPath = Path.Combine(UploadsRoot(), upload.FilePath.Replace('/', Path.DirectorySeparatorChar));
            if (System.IO.File.Exists(fullPath))
                System.IO.File.Delete(fullPath);
        }

        _db.FileUploads.RemoveRange(uploads);
        _db.Resources.Remove(existing);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpPut("reorder")]
    [Authorize]
    public async Task<IActionResult> Reorder([FromBody] ReorderResourcesV2Request request)
    {
        if (!User.IsAdmin())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Admin access required" });

        var resourceIds = request.Order ?? request.ResourceIds ?? Array.Empty<int>();
        if (resourceIds.Length == 0) return BadRequest(new { success = false, error = "Resource IDs are required" });
        var resources = await _db.Resources.Where(r => r.TenantId == TenantId() && resourceIds.Contains(r.Id)).ToListAsync();
        if (resources.Count != resourceIds.Length) return BadRequest(new { success = false, error = "One or more resources not found" });
        for (var i = 0; i < resourceIds.Length; i++)
            resources.First(r => r.Id == resourceIds[i]).SortOrder = i + 1;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { reordered = true } });
    }

    [HttpPost("categories")]
    [Authorize]
    public async Task<IActionResult> CreateCategory([FromBody] CreateResourceCategoryV2Request request)
    {
        if (!User.IsAdmin())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Admin access required" });

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, error = "Name is required" });
        var category = new ResourceCategory
        {
            TenantId = TenantId(),
            Name = request.Name.Trim(),
            Description = request.Description?.Trim(),
            ParentId = request.ParentId,
            SortOrder = 1,
            CreatedAt = DateTime.UtcNow
        };
        _db.ResourceCategories.Add(category);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new { success = true, data = MapCategory(category, 0) });
    }

    [HttpPut("categories/{id:int}")]
    [Authorize]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] UpdateResourceCategoryV2Request request)
    {
        if (!User.IsAdmin())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Admin access required" });

        var category = await _db.ResourceCategories.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == TenantId());
        if (category == null) return NotFound(new { success = false, error = "Category not found" });
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, error = "Name is required" });
        category.Name = request.Name.Trim();
        category.Description = request.Description?.Trim();
        await _db.SaveChangesAsync();
        var count = await _db.Resources.CountAsync(r => r.TenantId == TenantId() && r.CategoryId == id);
        return Ok(new { success = true, data = MapCategory(category, count) });
    }

    [HttpDelete("categories/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteCategory(int id)
    {
        if (!User.IsAdmin())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Admin access required" });

        var category = await _db.ResourceCategories
            .Include(c => c.Children)
            .Include(c => c.Resources)
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == TenantId());
        if (category == null) return NotFound(new { success = false, error = "Category not found" });
        if (category.Children.Any() || category.Resources.Any())
            return BadRequest(new { success = false, error = "Cannot delete category with related resources" });
        _db.ResourceCategories.Remove(category);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    private int TenantId() => _tenantContext.GetTenantIdOrThrow();

    private object MapResource(Resource resource, UploadMetadata? metadata = null, int downloads = 0)
    {
        var filePath = metadata?.StoredFilename ?? resource.Url ?? string.Empty;
        return new
        {
            id = resource.Id,
            title = resource.Title,
            description = resource.Description ?? string.Empty,
            file_url = FileUrl(filePath),
            file_path = filePath,
            file_type = metadata?.ContentType ?? resource.ResourceType,
            file_size = metadata?.Size ?? 0,
            downloads,
            sort_order = resource.SortOrder,
            content_type = "plain",
            content_body = (string?)null,
            created_at = resource.CreatedAt,
            uploader = new
            {
                id = resource.CreatedById,
                name = resource.CreatedBy == null
                    ? "Unknown"
                    : string.Join(' ', new[] { resource.CreatedBy.FirstName, resource.CreatedBy.LastName }.Where(p => !string.IsNullOrWhiteSpace(p))),
                avatar = AvatarUrl(resource.CreatedBy?.AvatarUrl)
            },
            category = resource.Category == null
                ? null
                : new
                {
                    id = resource.Category.Id,
                    name = resource.Category.Name,
                    color = "blue"
                },
            is_liked = false,
            likes_count = 0,
            comments_count = 0
        };
    }

    private static object MapCategory(ResourceCategory category, int resourceCount) => new
    {
        id = category.Id,
        name = category.Name,
        slug = Slugify(category.Name),
        color = "blue",
        resource_count = resourceCount
    };

    private object MapCategoryTree(
        ResourceCategory category,
        IReadOnlyDictionary<int, List<ResourceCategory>> children,
        IReadOnlyDictionary<int, int> counts) => new
        {
            id = category.Id,
            name = category.Name,
            slug = Slugify(category.Name),
            color = "blue",
            resource_count = counts.GetValueOrDefault(category.Id),
            children = children.GetValueOrDefault(category.Id, new List<ResourceCategory>())
                .Select(child => MapCategoryTree(child, children, counts))
        };

    private string FileUrl(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return string.Empty;
        if (filePath.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            filePath.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return filePath;
        if (filePath.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            return BaseUrl() + filePath;
        return $"{BaseUrl()}/uploads/{TenantId()}/resources/{filePath.TrimStart('/')}";
    }

    private string? AvatarUrl(string? avatarUrl)
    {
        if (string.IsNullOrWhiteSpace(avatarUrl)) return null;
        if (avatarUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            avatarUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return avatarUrl;
        return BaseUrl() + "/" + avatarUrl.TrimStart('/');
    }

    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}";

    private string UploadsRoot() => _configuration["FileUpload:UploadsRoot"] ?? Path.Combine(AppContext.BaseDirectory, "uploads");

    private static IActionResult ResourceUploadError(string code, string message, string field) =>
        new BadRequestObjectResult(new
        {
            errors = new[]
            {
                new { code, message, field }
            }
        });

    private static async Task<string?> DetectResourceMimeAsync(IFormFile file, CancellationToken ct)
    {
        var buffer = new byte[Math.Min(file.Length, 512)];
        await using (var stream = file.OpenReadStream())
        {
            var offset = 0;
            while (offset < buffer.Length)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), ct);
                if (read == 0) break;
                offset += read;
            }
        }

        if (buffer.Length >= 5 && buffer.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
            return "application/pdf";
        if (buffer.Length >= 8 && buffer.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a }))
            return "image/png";
        if (buffer.Length >= 3 && buffer[0] == 0xff && buffer[1] == 0xd8 && buffer[2] == 0xff)
            return "image/jpeg";
        if (buffer.Length >= 6 && (buffer.AsSpan(0, 6).SequenceEqual("GIF87a"u8) || buffer.AsSpan(0, 6).SequenceEqual("GIF89a"u8)))
            return "image/gif";
        if (buffer.Length >= 12 && buffer.AsSpan(0, 4).SequenceEqual("RIFF"u8) && buffer.AsSpan(8, 4).SequenceEqual("WEBP"u8))
            return "image/webp";
        if (buffer.Length >= 8 && buffer.AsSpan(0, 8).SequenceEqual(new byte[] { 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1 }))
            return "application/x-cfb";
        if (buffer.Length >= 4 && buffer[0] == 0x50 && buffer[1] == 0x4b && (buffer[2] == 0x03 || buffer[2] == 0x05 || buffer[2] == 0x07))
            return "application/zip";
        if (LooksLikeText(buffer))
            return "text/plain";

        return null;
    }

    private static bool LooksLikeText(byte[] buffer) =>
        buffer.Length > 0 && buffer.All(b => b is 0x09 or 0x0a or 0x0d || b >= 0x20);

    private async Task<int> NextSortOrderAsync(int? categoryId, CancellationToken ct)
    {
        var maxSort = await _db.Resources
            .Where(r => r.TenantId == TenantId() && r.CategoryId == categoryId)
            .Select(r => (int?)r.SortOrder)
            .MaxAsync(ct);
        return (maxSort ?? 0) + 1;
    }

    private async Task<Dictionary<int, UploadMetadata>> LoadUploadMetadataAsync(IEnumerable<int> resourceIds, CancellationToken ct)
    {
        var ids = resourceIds.Distinct().ToArray();
        if (ids.Length == 0) return new Dictionary<int, UploadMetadata>();

        var uploads = await _db.FileUploads
            .AsNoTracking()
            .Where(f => f.TenantId == TenantId() && f.EntityType == "resource" && f.EntityId.HasValue && ids.Contains(f.EntityId.Value))
            .OrderByDescending(f => f.CreatedAt)
            .ToListAsync(ct);

        return uploads
            .GroupBy(f => f.EntityId!.Value)
            .ToDictionary(g => g.Key, g => UploadMetadata.From(g.First()));
    }

    private async Task<Dictionary<int, int>> LoadDownloadCountsAsync(IEnumerable<int> resourceIds, CancellationToken ct)
    {
        var keys = resourceIds.Distinct().Select(DownloadCountKey).ToArray();
        if (keys.Length == 0) return new Dictionary<int, int>();

        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == TenantId() && keys.Contains(c.Key))
            .ToListAsync(ct);

        return rows
            .Select(row => new
            {
                ResourceId = ParseDownloadCountResourceId(row.Key),
                Downloads = int.TryParse(row.Value, out var parsed) ? parsed : 0
            })
            .Where(row => row.ResourceId.HasValue)
            .ToDictionary(row => row.ResourceId!.Value, row => row.Downloads);
    }

    private async Task IncrementDownloadCountAsync(int resourceId, CancellationToken ct)
    {
        var key = DownloadCountKey(resourceId);
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.Key == key, ct);
        if (row == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TenantId(),
                Key = key,
                Value = "1",
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            var downloads = int.TryParse(row.Value, out var parsed) ? parsed : 0;
            row.Value = (downloads + 1).ToString();
            row.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }

    private static string DownloadCountKey(int resourceId) => $"resources.{resourceId}.downloads";

    private static int? ParseDownloadCountResourceId(string key)
    {
        const string prefix = "resources.";
        const string suffix = ".downloads";
        if (!key.StartsWith(prefix, StringComparison.Ordinal) || !key.EndsWith(suffix, StringComparison.Ordinal))
            return null;

        var idText = key[prefix.Length..^suffix.Length];
        return int.TryParse(idText, out var id) ? id : null;
    }

    private static string FriendlyDownloadName(string title, string storedFilename)
    {
        var extension = Path.GetExtension(storedFilename);
        var safeTitle = Regex.Replace(title, "[^a-zA-Z0-9_\\-\\s]", string.Empty).Trim();
        safeTitle = Regex.Replace(safeTitle, "\\s+", "_");
        return string.IsNullOrWhiteSpace(safeTitle) ? $"download{extension}" : $"{safeTitle}{extension}";
    }

    private static string SanitizeFilename(string filename)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = string.Concat(filename.Where(c => !invalid.Contains(c)));
        return string.IsNullOrWhiteSpace(sanitized) ? "upload" : sanitized;
    }

    private static string Slugify(string value)
    {
        var slug = SlugUnsafeCharacters.Replace(value.Trim().ToLowerInvariant(), "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "resource" : slug;
    }

    private static string EncodeCursor(int id) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(id.ToString()));

    private static bool TryDecodeCursor(string? cursor, out int id)
    {
        id = 0;
        if (string.IsNullOrWhiteSpace(cursor)) return false;

        if (int.TryParse(cursor, out id)) return true;

        try
        {
            var decoded = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out id);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private sealed record UploadMetadata(string StoredFilename, string ContentType, long Size)
    {
        public static UploadMetadata From(FileUpload upload) => new(upload.StoredFilename, upload.ContentType, upload.FileSizeBytes);
    }
}

public sealed class UpdateResourceV2Request
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }
    [JsonPropertyName("file_path")] public string? FilePath { get; set; }
    [JsonPropertyName("resource_type")] public string? ResourceType { get; set; }
    [JsonPropertyName("file_type")] public string? FileType { get; set; }
    [JsonPropertyName("category_id")] public int? CategoryId { get; set; }
}

public sealed class ReorderResourcesV2Request
{
    [JsonPropertyName("order")] public int[]? Order { get; set; }
    [JsonPropertyName("resource_ids")] public int[]? ResourceIds { get; set; }
}

public sealed class CreateResourceCategoryV2Request
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("parent_id")] public int? ParentId { get; set; }
}

public sealed class UpdateResourceCategoryV2Request
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
}
