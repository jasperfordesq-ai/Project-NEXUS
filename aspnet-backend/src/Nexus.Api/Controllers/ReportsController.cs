// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
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
/// Reports controller - content reporting and abuse detection.
/// Phase 26: Content Reporting & Abuse Detection.
/// </summary>
[ApiController]
[Authorize]
public class ReportsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ContentReportService _reportService;
    private readonly ILogger<ReportsController> _logger;

    public ReportsController(
        NexusDbContext db,
        ContentReportService reportService,
        ILogger<ReportsController> logger)
    {
        _db = db;
        _reportService = reportService;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    #region User Endpoints

    /// <summary>
    /// POST /api/reports - File a content report.
    /// </summary>
    [HttpPost("api/reports")]
    public async Task<IActionResult> FileReport([FromBody] FileReportRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _reportService.ReportContentAsync(
            userId.Value,
            request.ContentType,
            request.ContentId,
            request.Reason,
            request.Description);

        if (!result.Success)
        {
            return BadRequest(new { error = result.Error });
        }

        return Created($"/api/reports/{result.ReportId}", new
        {
            id = result.ReportId,
            status = result.Status.ToString()!.ToLowerInvariant(),
            message = "Report filed successfully"
        });
    }

    /// <summary>
    /// GET /api/reports/my - Get my filed reports (paginated).
    /// </summary>
    [HttpGet("api/reports/my")]
    public async Task<IActionResult> GetMyReports(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (reports, total) = await _reportService.GetMyReportsAsync(userId.Value, page, limit);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = reports.Select(r => MapReportToResponse(r)),
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
    /// GET /api/reports/warnings - Get my warnings.
    /// </summary>
    [HttpGet("api/reports/warnings")]
    public async Task<IActionResult> GetMyWarnings()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var warnings = await _reportService.GetUserWarningsAsync(userId.Value);

        return Ok(new
        {
            data = warnings.Select(w => MapWarningToResponse(w))
        });
    }

    /// <summary>
    /// PUT /api/reports/warnings/{id}/acknowledge - Acknowledge a warning.
    /// </summary>
    [HttpPut("api/reports/warnings/{id:int}/acknowledge")]
    public async Task<IActionResult> AcknowledgeWarning(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _reportService.AcknowledgeWarningAsync(id, userId.Value);

        if (!result)
        {
            return NotFound(new { error = "Warning not found" });
        }

        return Ok(new { message = "Warning acknowledged" });
    }

    #endregion

    #region Admin Endpoints

    /// <summary>
    /// GET /api/admin/reports - Pending reports queue (admin).
    /// </summary>
    [HttpGet("api/admin/reports")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetPendingReports(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (reports, total) = await _reportService.GetPendingReportsAsync(page, limit);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = reports.Select(r => new
            {
                id = r.Id,
                reporter = r.Reporter != null
                    ? new { id = r.Reporter.Id, first_name = r.Reporter.FirstName, last_name = r.Reporter.LastName }
                    : null,
                content_type = r.ContentType,
                content_id = r.ContentId,
                reason = r.Reason.ToString().ToLowerInvariant(),
                description = r.Description,
                status = r.Status.ToString().ToLowerInvariant(),
                created_at = r.CreatedAt
            }),
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
    /// GET /api/admin/reports/{id} - Get report detail (admin).
    /// </summary>
    [HttpGet("api/admin/reports/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetReportDetail(int id)
    {
        var report = await _db.Set<ContentReport>()
            .Include(r => r.Reporter)
            .Include(r => r.ReviewedBy)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (report == null)
        {
            return NotFound(new { error = "Report not found" });
        }

        return Ok(new
        {
            id = report.Id,
            reporter = report.Reporter != null
                ? new { id = report.Reporter.Id, first_name = report.Reporter.FirstName, last_name = report.Reporter.LastName }
                : null,
            content_type = report.ContentType,
            content_id = report.ContentId,
            reason = report.Reason.ToString().ToLowerInvariant(),
            description = report.Description,
            status = report.Status.ToString().ToLowerInvariant(),
            reviewed_by = report.ReviewedBy != null
                ? new { id = report.ReviewedBy.Id, first_name = report.ReviewedBy.FirstName, last_name = report.ReviewedBy.LastName }
                : null,
            reviewed_at = report.ReviewedAt,
            review_notes = report.ReviewNotes,
            action_taken = report.ActionTaken,
            created_at = report.CreatedAt,
            updated_at = report.UpdatedAt
        });
    }

    /// <summary>
    /// PUT /api/admin/reports/{id}/review - Review a report (admin).
    /// </summary>
    [HttpPut("api/admin/reports/{id:int}/review")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ReviewReport(int id, [FromBody] ReviewReportRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _reportService.ReviewReportAsync(
            id,
            adminId.Value,
            request.Status,
            request.Notes,
            request.ActionTaken);

        if (!result.Success)
        {
            return BadRequest(new { error = result.Error });
        }

        return Ok(new
        {
            id = result.ReportId,
            status = result.Status.ToString()!.ToLowerInvariant(),
            message = "Report reviewed successfully"
        });
    }

    /// <summary>
    /// POST /api/admin/reports/warn/{userId} - Issue a warning to a user (admin).
    /// </summary>
    [HttpPost("api/admin/reports/warn/{userId}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> IssueWarning(int userId, [FromBody] IssueWarningRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _reportService.IssueWarningAsync(
            userId,
            adminId.Value,
            request.Reason,
            request.Severity,
            request.ReportId);

        if (!result.Success)
        {
            return BadRequest(new { error = result.Error });
        }

        return Created($"/api/admin/reports/user/{userId}/warnings", new
        {
            id = result.WarningId,
            severity = result.Severity.ToString()!.ToLowerInvariant(),
            message = "Warning issued successfully"
        });
    }

    /// <summary>
    /// GET /api/admin/reports/user/{userId}/warnings - Get a user's warnings (admin).
    /// </summary>
    [HttpGet("api/admin/reports/user/{userId}/warnings")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetUserWarnings(int userId)
    {
        // Verify user exists
        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists)
        {
            return NotFound(new { error = "User not found" });
        }

        var warnings = await _reportService.GetUserWarningsAsync(userId);
        var reportCount = await _reportService.CheckUserReportCountAsync(userId);

        return Ok(new
        {
            user_id = userId,
            report_count = reportCount,
            data = warnings.Select(w => MapWarningToResponse(w))
        });
    }

    /// <summary>
    /// GET /api/admin/reports/stats - Report statistics (admin).
    /// </summary>
    [HttpGet("api/admin/reports/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetReportStats()
    {
        var stats = await _reportService.GetReportStatsAsync();

        return Ok(new
        {
            total_reports = stats.TotalReports,
            pending_count = stats.PendingCount,
            by_status = stats.ByStatus,
            by_reason = stats.ByReason,
            by_content_type = stats.ByContentType
        });
    }

    #endregion

    #region Helpers

    private static object MapReportToResponse(ContentReport r) => new
    {
        id = r.Id,
        content_type = r.ContentType,
        content_id = r.ContentId,
        reason = r.Reason.ToString().ToLowerInvariant(),
        description = r.Description,
        status = r.Status.ToString().ToLowerInvariant(),
        reviewed_at = r.ReviewedAt,
        review_notes = r.ReviewNotes,
        action_taken = r.ActionTaken,
        created_at = r.CreatedAt,
        updated_at = r.UpdatedAt
    };

    private static object MapWarningToResponse(UserWarning w) => new
    {
        id = w.Id,
        reason = w.Reason,
        severity = w.Severity.ToString().ToLowerInvariant(),
        issued_by = w.IssuedBy != null
            ? new { id = w.IssuedBy.Id, first_name = w.IssuedBy.FirstName, last_name = w.IssuedBy.LastName }
            : null,
        report_id = w.ReportId,
        acknowledged_at = w.AcknowledgedAt,
        expires_at = w.ExpiresAt,
        created_at = w.CreatedAt
    };

    #endregion
}

#region Request DTOs

public class FileReportRequest
{
    [Required]
    [MaxLength(50)]
    [JsonPropertyName("content_type")]
    public string ContentType { get; set; } = string.Empty;

    [Required]
    [JsonPropertyName("content_id")]
    public int ContentId { get; set; }

    [Required]
    [JsonPropertyName("reason")]
    public ReportReason Reason { get; set; }

    [MaxLength(2000)]
    [JsonPropertyName("description")]
    public string? Description { get; set; }
}

public class ReviewReportRequest
{
    [Required]
    [JsonPropertyName("status")]
    public ReportStatus Status { get; set; }

    [MaxLength(2000)]
    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [MaxLength(500)]
    [JsonPropertyName("action_taken")]
    public string? ActionTaken { get; set; }
}

public class IssueWarningRequest
{
    [Required]
    [MaxLength(2000)]
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = string.Empty;

    [Required]
    [JsonPropertyName("severity")]
    public WarningSeverity Severity { get; set; }

    [JsonPropertyName("report_id")]
    public int? ReportId { get; set; }
}

#endregion
