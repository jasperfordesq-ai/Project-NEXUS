// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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
/// GDPR controller - data export, data deletion, and consent management.
/// Phase 27: GDPR / Data Export.
/// </summary>
[ApiController]
[Route("api/privacy")]
[Authorize]
public class GdprController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly GdprService _gdprService;
    private readonly ILogger<GdprController> _logger;

    public GdprController(NexusDbContext db, GdprService gdprService, ILogger<GdprController> logger)
    {
        _db = db;
        _gdprService = gdprService;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    #region Data Export

    /// <summary>
    /// POST /api/privacy/export - Request a data export.
    /// </summary>
    [HttpPost("export")]
    public async Task<IActionResult> RequestExport([FromBody] ExportRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var exportRequest = await _gdprService.RequestDataExportAsync(userId.Value, request.Format ?? "json");

            return Ok(new
            {
                id = exportRequest.Id,
                status = exportRequest.Status.ToString().ToLowerInvariant(),
                format = exportRequest.Format,
                requested_at = exportRequest.RequestedAt,
                message = "Your data export has been requested. It will be ready for download shortly."
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/privacy/export - List my export requests.
    /// </summary>
    [HttpGet("export")]
    public async Task<IActionResult> GetExportRequests()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var requests = await _gdprService.GetExportRequestsAsync(userId.Value);

        return Ok(new
        {
            data = requests.Select(r => new
            {
                r.Id,
                status = r.Status.ToString().ToLowerInvariant(),
                r.Format,
                file_size_bytes = r.FileSizeBytes,
                requested_at = r.RequestedAt,
                completed_at = r.CompletedAt,
                expires_at = r.ExpiresAt,
                downloaded_at = r.DownloadedAt,
                error_message = r.ErrorMessage
            }),
            total = requests.Count
        });
    }

    /// <summary>
    /// GET /api/privacy/export/{id}/download - Download an export.
    /// </summary>
    [HttpGet("export/{id:int}/download")]
    public async Task<IActionResult> DownloadExport(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var request = await _gdprService.DownloadExportAsync(id, userId.Value);
            if (request == null)
            {
                return NotFound(new { error = "Export request not found" });
            }

            // In production, this would redirect to the actual file storage URL.
            // For now, return the metadata indicating the download was acknowledged.
            return Ok(new
            {
                id = request.Id,
                status = request.Status.ToString().ToLowerInvariant(),
                file_url = request.FileUrl,
                file_size_bytes = request.FileSizeBytes,
                downloaded_at = request.DownloadedAt,
                message = "Export marked as downloaded."
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    #endregion

    #region Data Deletion

    /// <summary>
    /// POST /api/privacy/delete - Request account deletion (right to be forgotten).
    /// </summary>
    [HttpPost("delete")]
    public async Task<IActionResult> RequestDeletion([FromBody] DeletionRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var deletionRequest = await _gdprService.RequestDataDeletionAsync(userId.Value, request.Reason);

            return Ok(new
            {
                id = deletionRequest.Id,
                status = deletionRequest.Status.ToString().ToLowerInvariant(),
                requested_at = deletionRequest.CreatedAt,
                message = "Your account deletion request has been submitted and is pending admin review."
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    #endregion

    #region Consent Management

    /// <summary>
    /// GET /api/privacy/consents - Get my consent records.
    /// </summary>
    [HttpGet("consents")]
    public async Task<IActionResult> GetConsents()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var consents = await _gdprService.GetUserConsentsAsync(userId.Value);

        return Ok(new
        {
            data = consents.Select(c => new
            {
                consent_type = c.ConsentType,
                is_granted = c.IsGranted,
                granted_at = c.GrantedAt,
                revoked_at = c.RevokedAt,
                updated_at = c.UpdatedAt
            }),
            total = consents.Count
        });
    }

    /// <summary>
    /// PUT /api/privacy/consents - Update a consent record.
    /// </summary>
    [HttpPut("consents")]
    public async Task<IActionResult> UpdateConsent([FromBody] ConsentUpdateRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.ConsentType))
        {
            return BadRequest(new { error = "consent_type is required" });
        }

        var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString();

        var consent = await _gdprService.RecordConsentAsync(
            userId.Value, request.ConsentType, request.IsGranted, ipAddress);

        return Ok(new
        {
            consent_type = consent.ConsentType,
            is_granted = consent.IsGranted,
            granted_at = consent.GrantedAt,
            revoked_at = consent.RevokedAt,
            updated_at = consent.UpdatedAt
        });
    }

    /// <summary>
    /// DELETE /api/privacy/consents/{type} - Revoke a specific consent.
    /// </summary>
    [HttpDelete("consents/{type}")]
    public async Task<IActionResult> RevokeConsent(string type)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var consent = await _gdprService.RevokeConsentAsync(userId.Value, type);
        if (consent == null)
        {
            return NotFound(new { error = "Consent record not found" });
        }

        return Ok(new
        {
            consent_type = consent.ConsentType,
            is_granted = consent.IsGranted,
            revoked_at = consent.RevokedAt,
            message = $"Consent '{type}' has been revoked."
        });
    }

    #endregion
}

/// <summary>
/// Admin endpoints for GDPR management.
/// </summary>
[ApiController]
[Route("api/admin/privacy")]
[Authorize(Policy = "AdminOnly")]
public class AdminGdprController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly GdprService _gdprService;
    private readonly ILogger<AdminGdprController> _logger;

    public AdminGdprController(NexusDbContext db, GdprService gdprService, ILogger<AdminGdprController> logger)
    {
        _db = db;
        _gdprService = gdprService;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    /// <summary>
    /// POST /api/admin/privacy/users/{userId}/export - Request a data export for a user.
    /// </summary>
    [HttpPost("users/{userId:int}/export")]
    public async Task<IActionResult> RequestUserExport(int userId, [FromBody] ExportRequest? request = null)
    {
        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists) return NotFound(new { error = "User not found" });

        try
        {
            var exportRequest = await _gdprService.RequestDataExportAsync(userId, request?.Format ?? "json");
            return Ok(new
            {
                id = exportRequest.Id,
                user_id = userId,
                status = exportRequest.Status.ToString().ToLowerInvariant(),
                format = exportRequest.Format,
                requested_at = exportRequest.RequestedAt,
                message = "Data export requested"
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/admin/privacy/deletions - List pending deletion requests.
    /// </summary>
    [HttpGet("deletions")]
    public async Task<IActionResult> GetDeletionRequests(
        [FromQuery] string? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Set<DataDeletionRequest>()
            .AsNoTracking()
            .Include(r => r.User)
            .AsQueryable();

        if (!string.IsNullOrEmpty(status) && Enum.TryParse<DeletionStatus>(status, true, out var parsedStatus))
        {
            query = query.Where(r => r.Status == parsedStatus);
        }
        else
        {
            // Default to pending
            query = query.Where(r => r.Status == DeletionStatus.Pending);
        }

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var requests = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(r => new
            {
                r.Id,
                user = new
                {
                    id = r.User != null ? r.User.Id : 0,
                    email = r.User != null ? r.User.Email : "",
                    first_name = r.User != null ? r.User.FirstName : "",
                    last_name = r.User != null ? r.User.LastName : ""
                },
                status = r.Status.ToString().ToLowerInvariant(),
                r.Reason,
                reviewed_by_id = r.ReviewedById,
                reviewed_at = r.ReviewedAt,
                completed_at = r.CompletedAt,
                data_retained_reason = r.DataRetainedReason,
                created_at = r.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = requests,
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    /// <summary>
    /// PUT /api/admin/privacy/deletions/{id}/review - Review a deletion request.
    /// </summary>
    [HttpPut("deletions/{id:int}/review")]
    public async Task<IActionResult> ReviewDeletion(int id, [FromBody] DeletionReviewRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var result = await _gdprService.ReviewDeletionRequestAsync(
                id, adminId.Value, request.Approved, request.RetainedReason);

            if (result == null)
            {
                return NotFound(new { error = "Deletion request not found" });
            }

            return Ok(new
            {
                id = result.Id,
                status = result.Status.ToString().ToLowerInvariant(),
                reviewed_by_id = result.ReviewedById,
                reviewed_at = result.ReviewedAt,
                completed_at = result.CompletedAt,
                data_retained_reason = result.DataRetainedReason,
                message = request.Approved
                    ? "Deletion request approved and processing."
                    : "Deletion request rejected."
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

#region Request DTOs

public class ExportRequest
{
    [JsonPropertyName("format")]
    public string? Format { get; set; }
}

public class DeletionRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class ConsentUpdateRequest
{
    [JsonPropertyName("consent_type")]
    public string ConsentType { get; set; } = string.Empty;

    [JsonPropertyName("is_granted")]
    public bool IsGranted { get; set; }
}

public class DeletionReviewRequest
{
    [JsonPropertyName("approved")]
    public bool Approved { get; set; }

    [JsonPropertyName("retained_reason")]
    public string? RetainedReason { get; set; }
}

#endregion
