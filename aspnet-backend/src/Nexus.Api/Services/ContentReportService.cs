// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for content reporting and abuse detection.
/// Handles report filing, admin review, user warnings, and report statistics.
/// </summary>
public class ContentReportService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ContentReportService> _logger;

    private static readonly HashSet<string> ValidContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "listing", "user", "post", "comment", "message", "group", "exchange"
    };

    public ContentReportService(NexusDbContext db, TenantContext tenantContext, ILogger<ContentReportService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// File a content report. Prevents duplicate reports by the same user on the same content.
    /// </summary>
    public async Task<ContentReportResult> ReportContentAsync(
        int reporterId,
        string contentType,
        int contentId,
        ReportReason reason,
        string? description = null)
    {
        if (!ValidContentTypes.Contains(contentType))
        {
            return new ContentReportResult
            {
                Success = false,
                Error = $"Invalid content type. Valid types: {string.Join(", ", ValidContentTypes)}"
            };
        }

        // Prevent users from reporting themselves
        if (contentType.Equals("user", StringComparison.OrdinalIgnoreCase) && contentId == reporterId)
        {
            return new ContentReportResult
            {
                Success = false,
                Error = "You cannot report yourself"
            };
        }

        // Check for duplicate report
        var existingReport = await _db.Set<ContentReport>()
            .AnyAsync(r =>
                r.ReporterId == reporterId &&
                r.ContentType == contentType.ToLowerInvariant() &&
                r.ContentId == contentId &&
                r.Status != ReportStatus.Dismissed);

        if (existingReport)
        {
            return new ContentReportResult
            {
                Success = false,
                Error = "You have already reported this content"
            };
        }

        var report = new ContentReport
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            ReporterId = reporterId,
            ContentType = contentType.ToLowerInvariant(),
            ContentId = contentId,
            Reason = reason,
            Description = description,
            Status = ReportStatus.Pending
        };

        _db.Set<ContentReport>().Add(report);

        // Auto-escalate if content has multiple reports
        var reportCount = await _db.Set<ContentReport>()
            .CountAsync(r =>
                r.ContentType == report.ContentType &&
                r.ContentId == report.ContentId &&
                r.Status == ReportStatus.Pending);

        if (reportCount >= 3)
        {
            // Escalate all pending reports for this content
            var pendingReports = await _db.Set<ContentReport>()
                .Where(r =>
                    r.ContentType == report.ContentType &&
                    r.ContentId == report.ContentId &&
                    r.Status == ReportStatus.Pending)
                .ToListAsync();

            foreach (var pending in pendingReports)
            {
                pending.Status = ReportStatus.Escalated;
                pending.UpdatedAt = DateTime.UtcNow;
            }

            report.Status = ReportStatus.Escalated;
            _logger.LogWarning(
                "Content {ContentType}:{ContentId} auto-escalated with {Count} reports in tenant {TenantId}",
                report.ContentType, report.ContentId, reportCount + 1, report.TenantId);
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "User {ReporterId} reported {ContentType}:{ContentId} for {Reason} in tenant {TenantId}",
            reporterId, contentType, contentId, reason, report.TenantId);

        return new ContentReportResult
        {
            Success = true,
            ReportId = report.Id,
            Status = report.Status
        };
    }

    /// <summary>
    /// Get reports filed by a specific user (paginated).
    /// </summary>
    public async Task<(List<ContentReport> Reports, int Total)> GetMyReportsAsync(int userId, int page, int limit)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<ContentReport>()
            .Where(r => r.ReporterId == userId);

        var total = await query.CountAsync();

        var reports = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(r => r.ReviewedBy)
            .ToListAsync();

        return (reports, total);
    }

    /// <summary>
    /// Get pending reports for admin review (paginated).
    /// Includes Pending and Escalated statuses.
    /// </summary>
    public async Task<(List<ContentReport> Reports, int Total)> GetPendingReportsAsync(int page, int limit)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<ContentReport>()
            .Where(r => r.Status == ReportStatus.Pending || r.Status == ReportStatus.Escalated);

        var total = await query.CountAsync();

        var reports = await query
            .OrderBy(r => r.Status == ReportStatus.Escalated ? 0 : 1) // Escalated first
            .ThenByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(r => r.Reporter)
            .ToListAsync();

        return (reports, total);
    }

    /// <summary>
    /// Admin reviews a report - updates status, adds notes and action taken.
    /// </summary>
    public async Task<ContentReportResult> ReviewReportAsync(
        int reportId,
        int adminId,
        ReportStatus status,
        string? notes = null,
        string? actionTaken = null)
    {
        var report = await _db.Set<ContentReport>()
            .FirstOrDefaultAsync(r => r.Id == reportId);

        if (report == null)
        {
            return new ContentReportResult { Success = false, Error = "Report not found" };
        }

        if (report.Status == ReportStatus.ActionTaken || report.Status == ReportStatus.Dismissed)
        {
            return new ContentReportResult { Success = false, Error = "Report has already been reviewed" };
        }

        report.Status = status;
        report.ReviewedById = adminId;
        report.ReviewedAt = DateTime.UtcNow;
        report.ReviewNotes = notes;
        report.ActionTaken = actionTaken;
        report.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Admin {AdminId} reviewed report {ReportId} with status {Status} in tenant {TenantId}",
            adminId, reportId, status, report.TenantId);

        return new ContentReportResult
        {
            Success = true,
            ReportId = report.Id,
            Status = report.Status
        };
    }

    /// <summary>
    /// Issue a warning to a user. Optionally linked to a content report.
    /// </summary>
    public async Task<UserWarningResult> IssueWarningAsync(
        int userId,
        int adminId,
        string reason,
        WarningSeverity severity,
        int? reportId = null)
    {
        // Verify target user exists
        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists)
        {
            return new UserWarningResult { Success = false, Error = "User not found" };
        }

        // If linked to a report, verify it exists
        if (reportId.HasValue)
        {
            var reportExists = await _db.Set<ContentReport>().AnyAsync(r => r.Id == reportId.Value);
            if (!reportExists)
            {
                return new UserWarningResult { Success = false, Error = "Linked report not found" };
            }
        }

        var warning = new UserWarning
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            IssuedById = adminId,
            Reason = reason,
            Severity = severity,
            ReportId = reportId
        };

        _db.Set<UserWarning>().Add(warning);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Admin {AdminId} issued {Severity} warning to user {UserId} in tenant {TenantId}",
            adminId, severity, userId, warning.TenantId);

        return new UserWarningResult
        {
            Success = true,
            WarningId = warning.Id,
            Severity = warning.Severity
        };
    }

    /// <summary>
    /// Get all warnings for a user.
    /// </summary>
    public async Task<List<UserWarning>> GetUserWarningsAsync(int userId)
    {
        return await _db.Set<UserWarning>()
            .Where(w => w.UserId == userId)
            .OrderByDescending(w => w.CreatedAt)
            .Include(w => w.IssuedBy)
            .Include(w => w.Report)
            .ToListAsync();
    }

    /// <summary>
    /// User acknowledges a warning.
    /// </summary>
    public async Task<bool> AcknowledgeWarningAsync(int warningId, int userId)
    {
        var warning = await _db.Set<UserWarning>()
            .FirstOrDefaultAsync(w => w.Id == warningId && w.UserId == userId);

        if (warning == null)
        {
            return false;
        }

        if (warning.AcknowledgedAt.HasValue)
        {
            return true; // Already acknowledged - idempotent
        }

        warning.AcknowledgedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "User {UserId} acknowledged warning {WarningId} in tenant {TenantId}",
            userId, warningId, warning.TenantId);

        return true;
    }

    /// <summary>
    /// Get report statistics for admin dashboard.
    /// </summary>
    public async Task<ReportStatsResult> GetReportStatsAsync()
    {
        var reports = _db.Set<ContentReport>().AsQueryable();

        var byStatus = await reports
            .GroupBy(r => r.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync();

        var byReason = await reports
            .GroupBy(r => r.Reason)
            .Select(g => new { Reason = g.Key, Count = g.Count() })
            .ToListAsync();

        var byContentType = await reports
            .GroupBy(r => r.ContentType)
            .Select(g => new { ContentType = g.Key, Count = g.Count() })
            .ToListAsync();

        var totalPending = byStatus
            .Where(s => s.Status == ReportStatus.Pending || s.Status == ReportStatus.Escalated)
            .Sum(s => s.Count);

        return new ReportStatsResult
        {
            TotalReports = await reports.CountAsync(),
            PendingCount = totalPending,
            ByStatus = byStatus.ToDictionary(s => s.Status.ToString(), s => s.Count),
            ByReason = byReason.ToDictionary(r => r.Reason.ToString(), r => r.Count),
            ByContentType = byContentType.ToDictionary(c => c.ContentType, c => c.Count)
        };
    }

    /// <summary>
    /// Check how many times a user has been reported (for auto-escalation logic).
    /// </summary>
    public async Task<int> CheckUserReportCountAsync(int userId)
    {
        return await _db.Set<ContentReport>()
            .CountAsync(r =>
                r.ContentType == "user" &&
                r.ContentId == userId &&
                r.Status != ReportStatus.Dismissed);
    }
}

/// <summary>
/// Result of a content report operation.
/// </summary>
public class ContentReportResult
{
    public bool Success { get; set; }
    public int? ReportId { get; set; }
    public ReportStatus? Status { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Result of a user warning operation.
/// </summary>
public class UserWarningResult
{
    public bool Success { get; set; }
    public int? WarningId { get; set; }
    public WarningSeverity? Severity { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Report statistics for admin dashboard.
/// </summary>
public class ReportStatsResult
{
    public int TotalReports { get; set; }
    public int PendingCount { get; set; }
    public Dictionary<string, int> ByStatus { get; set; } = new();
    public Dictionary<string, int> ByReason { get; set; } = new();
    public Dictionary<string, int> ByContentType { get; set; } = new();
}
