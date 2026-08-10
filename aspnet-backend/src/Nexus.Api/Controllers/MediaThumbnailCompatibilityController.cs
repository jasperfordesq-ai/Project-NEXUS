// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Laravel React-compatible thumbnail endpoint for local uploaded media.
/// </summary>
[ApiController]
[AllowAnonymous]
public class MediaThumbnailCompatibilityController : ControllerBase
{
    private readonly FileUploadService _fileUploadService;

    public MediaThumbnailCompatibilityController(FileUploadService fileUploadService)
    {
        _fileUploadService = fileUploadService;
    }

    [HttpGet("/api/media/thumbnail")]
    [HttpGet("/api/v2/media/thumbnail")]
    public async Task<IActionResult> Show([FromQuery] string? src, [FromQuery(Name = "w")] int? width = null, [FromQuery(Name = "h")] int? height = null)
    {
        if (!TryExtractFileUploadId(src, out var fileId))
            return NotFound();

        var upload = await _fileUploadService.GetByIdAsync(fileId);
        if (upload == null)
            return NotFound();

        var fullPath = _fileUploadService.GetFullPath(upload);
        if (!System.IO.File.Exists(fullPath))
            return NotFound();

        _ = Math.Clamp(width ?? 0, 16, 1200);
        _ = Math.Clamp(height ?? 0, 16, 1200);

        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers.ContentDisposition = "inline";
        Response.Headers.ETag = $"\"{upload.Id}-{upload.FileSizeBytes}\"";

        return PhysicalFile(fullPath, upload.ContentType);
    }

    private static bool TryExtractFileUploadId(string? src, out int fileId)
    {
        fileId = 0;
        if (string.IsNullOrWhiteSpace(src))
            return false;

        var value = Uri.UnescapeDataString(src.Trim());
        if (value.Contains("..", StringComparison.Ordinal) || value.Contains('\\', StringComparison.Ordinal))
            return false;

        if (Uri.TryCreate(value, UriKind.Absolute, out var absolute))
            value = absolute.AbsolutePath;

        var segments = value.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (string.Equals(segments[i], "files", StringComparison.OrdinalIgnoreCase)
                && int.TryParse(segments[i + 1], out fileId))
            {
                return true;
            }
        }

        return false;
    }
}
