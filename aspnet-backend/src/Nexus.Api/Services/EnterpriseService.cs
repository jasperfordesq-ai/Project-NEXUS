// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for enterprise configuration and dashboard metrics.
/// Phase 57: Enterprise/Governance.
///
/// <para>
/// <b>CROSS-TENANT BY DESIGN.</b> This service intentionally bypasses the
/// EF Core global tenant query filters via <c>.IgnoreQueryFilters()</c>
/// because it powers system-wide configuration, governance, and
/// enterprise-tier admin views (security posture, compliance overviews,
/// governance dashboards). Tenant scoping is applied explicitly via
/// <c>Where(x =&gt; x.TenantId == tenantId)</c> on every query — the filter
/// bypass exists so administrators acting in a system/super-admin context
/// can resolve metrics for an arbitrary tenant id passed by the caller,
/// not so this service is exempt from isolation.
/// </para>
/// <para>
/// <b>Caller contract:</b> every endpoint that calls into this service
/// MUST be admin-gated (e.g. <c>[Authorize(Policy = "AdminOnly")]</c>) and
/// MUST validate that the supplied <c>tenantId</c> is one the caller is
/// authorised to view. Do NOT copy this <c>IgnoreQueryFilters()</c>
/// pattern into tenant-scoped services — regular controllers should rely
/// on the global filters and the resolved <c>TenantContext</c>.
/// </para>
/// </summary>
public class EnterpriseService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<EnterpriseService> _logger;

    public EnterpriseService(NexusDbContext db, ILogger<EnterpriseService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// List enterprise configs for a tenant, optionally filtered by category.
    /// </summary>
    public async Task<List<EnterpriseConfig>> GetConfigsAsync(int tenantId, string? category = null)
    {
        // CROSS-TENANT READ: admin lookup of arbitrary tenant's enterprise config (caller-supplied tenantId, admin-gated).
        var query = _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(c => c.Category == category);

        return await query.OrderBy(c => c.Key).ToListAsync();
    }

    /// <summary>
    /// Create or update an enterprise config entry.
    /// </summary>
    public async Task<EnterpriseConfig> SetConfigAsync(
        int tenantId,
        string key,
        string value,
        string? category = null,
        string? description = null)
    {
        // CROSS-TENANT READ: admin upsert against caller-supplied tenantId (admin-gated).
        var existing = await _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);

        if (existing != null)
        {
            existing.Value = value;
            existing.Category = category ?? existing.Category;
            existing.Description = description ?? existing.Description;
            existing.UpdatedAt = DateTime.UtcNow;
            _logger.LogInformation("Updated enterprise config {Key} for tenant {TenantId}", key, tenantId);
        }
        else
        {
            existing = new EnterpriseConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = value,
                Category = category,
                Description = description,
                UpdatedAt = DateTime.UtcNow
            };
            _db.EnterpriseConfigs.Add(existing);
            _logger.LogInformation("Created enterprise config {Key} for tenant {TenantId}", key, tenantId);
        }

        await _db.SaveChangesAsync();
        return existing;
    }

    /// <summary>
    /// Delete an enterprise config entry.
    /// </summary>
    public async Task<bool> DeleteConfigAsync(int tenantId, string key)
    {
        // CROSS-TENANT READ: admin delete against caller-supplied tenantId (admin-gated).
        var config = await _db.EnterpriseConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);

        if (config == null)
            return false;

        _db.EnterpriseConfigs.Remove(config);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Deleted enterprise config {Key} for tenant {TenantId}", key, tenantId);
        return true;
    }

    /// <summary>
    /// Get enterprise dashboard metrics for a tenant.
    /// </summary>
    public async Task<EnterpriseDashboard> GetDashboardAsync(int tenantId)
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        // CROSS-TENANT READ: enterprise dashboard aggregates for caller-supplied tenantId (admin-gated).
        var activeUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.IsActive);

        var totalUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId);

        var exchangesThisMonth = await _db.Exchanges
            .IgnoreQueryFilters()
            .CountAsync(e => e.TenantId == tenantId && e.CreatedAt >= monthStart);

        var completedExchangesThisMonth = await _db.Exchanges
            .IgnoreQueryFilters()
            .CountAsync(e => e.TenantId == tenantId
                && e.Status == ExchangeStatus.Completed
                && e.CompletedAt >= monthStart);

        var totalCreditsTransferred = await _db.Transactions
            .IgnoreQueryFilters()
            .ExcludeInternalWalletAdapters()
            .Where(t => t.TenantId == tenantId && t.CreatedAt >= monthStart)
            .SumAsync(t => (decimal?)t.Amount) ?? 0;

        var pendingExportRequests = await _db.DataExportRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == ExportStatus.Pending);

        var pendingDeletionRequests = await _db.DataDeletionRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == DeletionStatus.Pending);

        return new EnterpriseDashboard
        {
            TenantId = tenantId,
            TotalUsers = totalUsers,
            ActiveUsers = activeUsers,
            ExchangesThisMonth = exchangesThisMonth,
            CompletedExchangesThisMonth = completedExchangesThisMonth,
            TotalCreditsTransferredThisMonth = totalCreditsTransferred,
            PendingDataExportRequests = pendingExportRequests,
            PendingDataDeletionRequests = pendingDeletionRequests,
            GeneratedAt = now
        };
    }

    /// <summary>
    /// Get compliance overview for a tenant (GDPR stats).
    /// </summary>
    public async Task<ComplianceOverview> GetComplianceOverviewAsync(int tenantId)
    {
        // CROSS-TENANT READ: GDPR compliance overview for caller-supplied tenantId (admin-gated).
        var totalConsents = await _db.ConsentRecords
            .IgnoreQueryFilters()
            .CountAsync(c => c.TenantId == tenantId);

        var grantedConsents = await _db.ConsentRecords
            .IgnoreQueryFilters()
            .CountAsync(c => c.TenantId == tenantId && c.IsGranted);

        var revokedConsents = totalConsents - grantedConsents;

        var totalExportRequests = await _db.DataExportRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId);

        var pendingExportRequests = await _db.DataExportRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == ExportStatus.Pending);

        var totalDeletionRequests = await _db.DataDeletionRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId);

        var pendingDeletionRequests = await _db.DataDeletionRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == DeletionStatus.Pending);

        var completedDeletions = await _db.DataDeletionRequests
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == DeletionStatus.Completed);

        var consentTypes = await _db.ConsentRecords
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId)
            .Select(c => c.ConsentType)
            .Distinct()
            .CountAsync();

        return new ComplianceOverview
        {
            TenantId = tenantId,
            TotalConsentRecords = totalConsents,
            GrantedConsents = grantedConsents,
            RevokedConsents = revokedConsents,
            ConsentTypesTracked = consentTypes,
            TotalDataExportRequests = totalExportRequests,
            PendingDataExportRequests = pendingExportRequests,
            TotalDataDeletionRequests = totalDeletionRequests,
            PendingDataDeletionRequests = pendingDeletionRequests,
            CompletedDeletions = completedDeletions,
            GeneratedAt = DateTime.UtcNow
        };
    }

    /// <summary>
    /// Enhanced governance monitoring dashboard with security and compliance metrics.
    /// </summary>
    public async Task<object> GetGovernanceDashboardAsync(int tenantId)
    {
        var now = DateTime.UtcNow;
        var thirtyDaysAgo = now.AddDays(-30);

        // CROSS-TENANT READ: governance/security dashboard for caller-supplied tenantId (admin-gated).
        var activeUsers30d = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.LastLoginAt != null && u.LastLoginAt > thirtyDaysAgo);

        var suspendedUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && !u.IsActive);

        var pendingRegistrations = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.RegistrationStatus != RegistrationStatus.Active);

        var unverifiedEmails = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && !u.EmailVerified);

        // 2FA adoption: percentage of active users with 2FA enabled
        var totalActiveUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.IsActive);

        var twoFactorUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.IsActive && u.TwoFactorEnabled);

        var twoFactorAdoption = totalActiveUsers > 0
            ? Math.Round((double)twoFactorUsers / totalActiveUsers * 100, 1)
            : 0.0;

        var activeSessions = await _db.UserSessions
            .IgnoreQueryFilters()
            .CountAsync(s => s.TenantId == tenantId && s.IsActive);

        // Metadata-only attestations do not expire like legacy document
        // records. Surface unresolved current-policy review workload in the
        // existing dashboard slot; vetting_records must never affect trust.
        var expiringVetting = await _db.SafeguardingVettingReviewRequests
            .IgnoreQueryFilters()
            .CountAsync(review => review.TenantId == tenantId
                && review.Status == SafeguardingVettingReviewRequest.PendingStatus);

        var openGdprBreaches = await _db.GdprBreaches
            .IgnoreQueryFilters()
            .CountAsync(b => b.TenantId == tenantId && b.ResolvedAt == null);

        var pendingContentReports = await _db.ContentReports
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == ReportStatus.Pending);

        var recentAuditEvents = await _db.FederationAuditLogs
            .IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId)
            .OrderByDescending(a => a.CreatedAt)
            .Take(10)
            .Select(a => new { a.Id, a.Action, a.EntityType, a.EntityId, a.Details, a.CreatedAt })
            .ToListAsync();

        return new
        {
            active_users_30d = activeUsers30d,
            suspended_users = suspendedUsers,
            pending_registrations = pendingRegistrations,
            unverified_emails = unverifiedEmails,
            two_factor_adoption = twoFactorAdoption,
            active_sessions = activeSessions,
            expiring_vetting = expiringVetting,
            open_gdpr_breaches = openGdprBreaches,
            pending_content_reports = pendingContentReports,
            recent_audit_events = recentAuditEvents,
            generated_at = now
        };
    }

    /// <summary>
    /// Security posture score (0-100) based on governance metrics.
    /// </summary>
    public async Task<object> GetSecurityPostureAsync(int tenantId)
    {
        var now = DateTime.UtcNow;
        var breakdown = new List<object>();
        var totalScore = 0;

        // CROSS-TENANT READ: security posture score (multi-table aggregate) for caller-supplied tenantId (admin-gated).
        // 1. 2FA adoption > 50% => +20
        var totalActiveUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.IsActive);

        var twoFactorUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.IsActive && u.TwoFactorEnabled);

        var twoFaRate = totalActiveUsers > 0 ? (double)twoFactorUsers / totalActiveUsers * 100 : 0;
        var twoFaPoints = twoFaRate > 50 ? 20 : 0;
        totalScore += twoFaPoints;
        breakdown.Add(new { metric = "2fa_adoption", points = twoFaPoints, max_points = 20, status = twoFaRate > 50 ? "pass" : "fail" });

        // 2. No open GDPR breaches => +20
        var openBreaches = await _db.GdprBreaches
            .IgnoreQueryFilters()
            .CountAsync(b => b.TenantId == tenantId && b.ResolvedAt == null);
        var breachPoints = openBreaches == 0 ? 20 : 0;
        totalScore += breachPoints;
        breakdown.Add(new { metric = "no_open_gdpr_breaches", points = breachPoints, max_points = 20, status = openBreaches == 0 ? "pass" : "fail" });

        // 3. Current-policy safeguarding review queue clear => +15. Legacy
        // document-era vetting rows are deliberately excluded from authority.
        var pendingVettingReviews = await _db.SafeguardingVettingReviewRequests
            .IgnoreQueryFilters()
            .CountAsync(review => review.TenantId == tenantId
                && review.Status == SafeguardingVettingReviewRequest.PendingStatus);
        var vettingPoints = pendingVettingReviews == 0 ? 15 : 0;
        totalScore += vettingPoints;
        breakdown.Add(new { metric = "vetting_records_current", points = vettingPoints, max_points = 15, status = pendingVettingReviews == 0 ? "pass" : "fail" });

        // 4. Email verification rate > 80% => +15
        var totalUsers = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId);

        var verifiedEmails = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && u.EmailVerified);

        var emailRate = totalUsers > 0 ? (double)verifiedEmails / totalUsers * 100 : 0;
        var emailPoints = emailRate > 80 ? 15 : 0;
        totalScore += emailPoints;
        breakdown.Add(new { metric = "email_verification_rate", points = emailPoints, max_points = 15, status = emailRate > 80 ? "pass" : "fail" });

        // 5. No suspended users pending review => +15
        var suspendedPending = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == tenantId && !u.IsActive && u.RegistrationStatus != RegistrationStatus.Active);
        var suspendedPoints = suspendedPending == 0 ? 15 : 0;
        totalScore += suspendedPoints;
        breakdown.Add(new { metric = "no_suspended_pending_review", points = suspendedPoints, max_points = 15, status = suspendedPending == 0 ? "pass" : "fail" });

        // 6. Content report queue < 5 => +15
        var pendingReports = await _db.ContentReports
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.Status == ReportStatus.Pending);
        var reportPoints = pendingReports < 5 ? 15 : 0;
        totalScore += reportPoints;
        breakdown.Add(new { metric = "content_report_queue_clear", points = reportPoints, max_points = 15, status = pendingReports < 5 ? "pass" : "fail" });

        return new
        {
            score = totalScore,
            max_score = 100,
            breakdown,
            generated_at = now
        };
    }

}

/// <summary>
/// Enterprise dashboard metrics DTO.
/// </summary>
public class EnterpriseDashboard
{
    public int TenantId { get; set; }
    public int TotalUsers { get; set; }
    public int ActiveUsers { get; set; }
    public int ExchangesThisMonth { get; set; }
    public int CompletedExchangesThisMonth { get; set; }
    public decimal TotalCreditsTransferredThisMonth { get; set; }
    public int PendingDataExportRequests { get; set; }
    public int PendingDataDeletionRequests { get; set; }
    public DateTime GeneratedAt { get; set; }
}

/// <summary>
/// Compliance overview metrics DTO.
/// </summary>
public class ComplianceOverview
{
    public int TenantId { get; set; }
    public int TotalConsentRecords { get; set; }
    public int GrantedConsents { get; set; }
    public int RevokedConsents { get; set; }
    public int ConsentTypesTracked { get; set; }
    public int TotalDataExportRequests { get; set; }
    public int PendingDataExportRequests { get; set; }
    public int TotalDataDeletionRequests { get; set; }
    public int PendingDataDeletionRequests { get; set; }
    public int CompletedDeletions { get; set; }
    public DateTime GeneratedAt { get; set; }
}
