// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// File upload and management endpoints.
/// Supports avatar uploads, listing images, group files, and documents.
/// </summary>
[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly FileUploadService _fileService;
    private readonly ILogger<FilesController> _logger;

    public FilesController(FileUploadService fileService, ILogger<FilesController> logger)
    {
        _fileService = fileService;
        _logger = logger;
    }

    /// <summary>
    /// Upload a file. Category determines allowed types and size limits.
    /// </summary>
    [HttpPost("upload")]
    [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
    public async Task<IActionResult> Upload(
        IFormFile file,
        [FromQuery] string category = "document",
        [FromQuery] int? entity_id = null,
        [FromQuery] string? entity_type = null)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        if (!Enum.TryParse<FileCategory>(category, true, out var parsedCategory))
            return BadRequest(new { error = "Invalid category. Use: avatar, listing, group, event, document, message" });

        await using var stream = file.OpenReadStream();
        var (upload, error) = await _fileService.UploadAsync(
            stream, file.FileName, file.ContentType, file.Length,
            userId.Value, tenantId.Value, parsedCategory, entity_id, entity_type);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetFile), new { id = upload!.Id }, MapFileResponse(upload));
    }

    /// <summary>
    /// Upload an avatar for the current user.
    /// </summary>
    [HttpPost("avatar")]
    [RequestSizeLimit(5 * 1024 * 1024)] // 5 MB
    public async Task<IActionResult> UploadAvatar(IFormFile file)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        await using var stream = file.OpenReadStream();
        var (upload, error) = await _fileService.UploadAsync(
            stream, file.FileName, file.ContentType, file.Length,
            userId.Value, tenantId.Value, FileCategory.Avatar, userId.Value, "user");

        if (error != null)
            return BadRequest(new { error });

        return Ok(MapFileResponse(upload!));
    }

    /// <summary>
    /// Get file metadata by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetFile(int id)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid token" });

        var file = await _fileService.GetByIdAsync(id);
        if (file == null)
            return NotFound(new { error = "File not found" });

        if (file.TenantId != tenantId.Value)
            return NotFound(new { error = "File not found" });

        return Ok(MapFileResponse(file));
    }

    /// <summary>
    /// Download/serve a file by ID.
    /// </summary>
    [HttpGet("{id:int}/download")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadFile(int id)
    {
        var file = await _fileService.GetByIdAsync(id);
        if (file == null)
            return NotFound(new { error = "File not found" });

        var isPublicImage = IsPublicImage(file);
        var tenantId = User.GetTenantId();
        if (!isPublicImage)
        {
            if (tenantId == null) return Unauthorized(new { error = "Invalid token" });
            if (file.TenantId != tenantId.Value)
                return NotFound(new { error = "File not found" });
        }

        var fullPath = _fileService.GetFullPath(file);
        if (!System.IO.File.Exists(fullPath))
            return NotFound(new { error = "File not found on disk" });

        if (isPublicImage)
        {
            Response.Headers.CacheControl = "public, max-age=86400";
            return PhysicalFile(fullPath, file.ContentType);
        }

        Response.Headers.Append("Content-Disposition", $"attachment; filename=\"{file.OriginalFilename}\"");
        return PhysicalFile(fullPath, file.ContentType, file.OriginalFilename);
    }

    /// <summary>
    /// List files for an entity (e.g., listing images).
    /// </summary>
    [HttpGet("by-entity/{entityType}/{entityId:int}")]
    public async Task<IActionResult> GetByEntity(string entityType, int entityId)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid token" });

        var files = await _fileService.GetByEntityAsync(entityType, entityId);
        var tenantFiles = files.Where(f => f.TenantId == tenantId.Value);
        return Ok(new { data = tenantFiles.Select(MapFileResponse) });
    }

    /// <summary>
    /// Delete a file (owner only).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteFile(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _fileService.DeleteAsync(id, userId.Value);
        if (!success)
            return BadRequest(new { error });

        return Ok(new { success = true, message = "File deleted" });
    }

    private object MapFileResponse(FileUpload f) => new
    {
        id = f.Id,
        original_filename = f.OriginalFilename,
        content_type = f.ContentType,
        file_size_bytes = f.FileSizeBytes,
        category = f.Category.ToString().ToLowerInvariant(),
        entity_id = f.EntityId,
        entity_type = f.EntityType,
        url = _fileService.GetDownloadUrl(f),
        created_at = f.CreatedAt
    };

    private static bool IsPublicImage(FileUpload file)
    {
        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return false;

        return file.Category is FileCategory.Avatar
            or FileCategory.Listing
            or FileCategory.Group
            or FileCategory.Event;
    }
}
