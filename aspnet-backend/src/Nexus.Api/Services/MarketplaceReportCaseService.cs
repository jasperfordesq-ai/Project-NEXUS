// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record MarketplaceReportCaseError(string Code, string Message, int Status, string? Field = null);
public sealed record MarketplaceReportCaseResult(object? Data, MarketplaceReportCaseError? Error = null, int Status = 200)
{
    public bool Succeeded => Error is null;
}

public sealed class MarketplaceReportCaseService(NexusDbContext db)
{
    private static readonly HashSet<string> Reasons = ["counterfeit", "illegal", "unsafe", "misleading", "discrimination", "ip_violation", "other"];
    private static readonly HashSet<string> Actions = ["none", "warning", "listing_removed", "seller_suspended"];
    private static readonly string[] PendingStatuses = ["received", "acknowledged", "under_review", "appealed"];

    public async Task<MarketplaceReportCaseResult> CreateAsync(int tenant, int actorId, int listingId, string? reason, string? description, IReadOnlyCollection<string>? evidenceUrls, CancellationToken ct)
    {
        reason = reason?.Trim().ToLowerInvariant();
        description = description?.Trim();
        if (reason is null || !Reasons.Contains(reason)) return Validation("reason");
        if (string.IsNullOrWhiteSpace(description) || description.Length > 5000) return Validation("description");
        if (evidenceUrls is { Count: > 10 } || evidenceUrls?.Any(x => !SafeUrl(x)) == true) return Validation("evidence_urls");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Lock(tenant, listingId, ct);
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == listingId, ct);
        if (listing is null) return Missing();
        if (listing.UserId == actorId) return new(null, new("VALIDATION_ERROR", "You cannot report your own listing", 422, "listing_id"));
        var duplicate = await db.MarketplaceReports.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.MarketplaceListingId == listingId && x.ReporterUserId == actorId && PendingStatuses.Contains(x.Status), ct);
        if (duplicate) return new(null, new("VALIDATION_ERROR", "An active report already exists", 422, "listing_id"));

        var now = DateTime.UtcNow;
        var report = new MarketplaceReport
        {
            TenantId = tenant,
            MarketplaceListingId = listingId,
            ReporterUserId = actorId,
            Reason = reason,
            Details = description,
            EvidenceUrlsJson = evidenceUrls is { Count: > 0 } ? JsonSerializer.Serialize(evidenceUrls) : null,
            Status = "received",
            CreatedAt = now,
            UpdatedAt = now
        };
        db.MarketplaceReports.Add(report);
        await db.SaveChangesAsync(ct);
        Notify(tenant, actorId, "marketplace_report_received", "Marketplace report received", report.Id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(new
        {
            id = report.Id,
            listing_id = report.MarketplaceListingId,
            marketplace_listing_id = report.MarketplaceListingId,
            reporter_id = report.ReporterUserId,
            reporter_user_id = report.ReporterUserId,
            reason = report.Reason,
            details = report.Details,
            status = report.Status,
            message = "Report submitted"
        }, Status: 201);
    }

    public async Task<MarketplaceReportCaseResult> MineAsync(int tenant, int actorId, CancellationToken ct)
    {
        var sellerListingIds = db.MarketplaceListings.IgnoreQueryFilters().Where(x => x.TenantId == tenant && x.UserId == actorId).Select(x => x.Id);
        var reports = await db.MarketplaceReports.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && (x.ReporterUserId == actorId || sellerListingIds.Contains(x.MarketplaceListingId)))
            .OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(ct);
        var listings = await Listings(tenant, reports.Select(x => x.MarketplaceListingId), ct);
        return new(reports.Select(x => Viewer(x, listings.GetValueOrDefault(x.MarketplaceListingId), actorId)).ToArray());
    }

    public async Task<MarketplaceReportCaseResult> ShowAsync(int tenant, int actorId, int reportId, CancellationToken ct)
    {
        var report = await db.MarketplaceReports.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == reportId, ct);
        if (report is null) return Missing();
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == report.MarketplaceListingId, ct);
        if (report.ReporterUserId != actorId && listing?.UserId != actorId) return Forbidden();
        return new(Viewer(report, listing, actorId));
    }

    public async Task<MarketplaceReportCaseResult> AppealAsync(int tenant, int actorId, int reportId, string? appealText, CancellationToken ct)
    {
        appealText = appealText?.Trim();
        if (appealText is null || appealText.Length is < 20 or > 5000) return Validation("appeal_text");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Lock(tenant, reportId, ct);
        var report = await db.MarketplaceReports.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == reportId, ct);
        if (report is null) return Missing();
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == report.MarketplaceListingId, ct);
        var reporter = report.ReporterUserId == actorId;
        var seller = listing?.UserId == actorId;
        if (!reporter && !seller) return Forbidden();
        if (!((reporter && report.Status == "no_action") || (seller && report.Status == "action_taken")))
            return new(null, new("VALIDATION_ERROR", "Report is not eligible for appeal", 422, "status"));
        report.Status = "appealed";
        report.AppealText = appealText;
        report.AppealedByUserId = actorId;
        report.UpdatedAt = DateTime.UtcNow;
        Notify(tenant, actorId, "marketplace_report_appealed", "Marketplace appeal received", report.Id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(new { id = report.Id, status = report.Status, message = "Appeal submitted" });
    }

    public async Task<MarketplaceReportCaseResult> AdminListAsync(int tenant, string? status, int page, int perPage, CancellationToken ct)
    {
        page = Math.Max(1, page); perPage = Math.Clamp(perPage, 1, 100);
        var query = db.MarketplaceReports.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant);
        query = string.IsNullOrWhiteSpace(status) ? query.Where(x => PendingStatuses.Contains(x.Status)) : query.Where(x => x.Status == status.Trim());
        var total = await query.CountAsync(ct);
        var reports = await query.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).Skip((page - 1) * perPage).Take(perPage).ToListAsync(ct);
        var listings = await Listings(tenant, reports.Select(x => x.MarketplaceListingId), ct);
        var users = await Users(tenant, reports.SelectMany(x => new int?[] { x.ReporterUserId, x.ResolvedByUserId }).Where(x => x.HasValue).Select(x => x!.Value), ct);
        return new(new { items = reports.Select(x => Admin(x, listings.GetValueOrDefault(x.MarketplaceListingId), users)).ToArray(), total, page, per_page = perPage });
    }

    public async Task<MarketplaceReportCaseResult> AcknowledgeAsync(int tenant, int adminId, int reportId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Lock(tenant, reportId, ct);
        var report = await db.MarketplaceReports.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == reportId, ct);
        if (report is null) return Missing();
        if (report.Status is not ("received" or "acknowledged")) return InvalidState();
        report.Status = "under_review"; report.AcknowledgedAt = DateTime.UtcNow; report.ResolvedByUserId = adminId; report.UpdatedAt = DateTime.UtcNow;
        Notify(tenant, report.ReporterUserId, "marketplace_report_under_review", "Marketplace report under review", report.Id);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(new { message = "Report acknowledged", status = report.Status });
    }

    public async Task<MarketplaceReportCaseResult> ResolveAsync(int tenant, int adminId, int reportId, string? action, string? reason, bool appeal, CancellationToken ct)
    {
        action = action?.Trim().ToLowerInvariant(); reason = reason?.Trim();
        if (action is null || !Actions.Contains(action)) return Validation("action_taken");
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 5000) return Validation("resolution_reason");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Lock(tenant, reportId, ct);
        var report = await db.MarketplaceReports.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == reportId, ct);
        if (report is null) return Missing();
        if (appeal ? report.Status != "appealed" : report.Status is not ("received" or "acknowledged" or "under_review")) return InvalidState();
        var previousAction = report.ActionTaken ?? "none";
        report.ResolutionNotes = reason;
        if (appeal && previousAction != action) await RestoreEnforcement(tenant, report, ct);
        if (action is "listing_removed" or "seller_suspended")
        {
            report.EnforcementSnapshotJson ??= await Snapshot(tenant, report.MarketplaceListingId, ct);
            await ApplyEnforcement(tenant, report, action, ct);
        }
        report.Status = appeal ? "appeal_resolved" : action == "none" ? "no_action" : "action_taken";
        report.ActionTaken = action; report.ResolvedByUserId = adminId;
        report.ResolvedAt ??= DateTime.UtcNow; report.AppealResolvedAt = appeal ? DateTime.UtcNow : null;
        report.TransparencyReportIncluded = true; report.UpdatedAt = DateTime.UtcNow;
        Notify(tenant, report.ReporterUserId, appeal ? "marketplace_report_appeal_resolved" : "marketplace_report_resolved", appeal ? "Marketplace appeal resolved" : "Marketplace report resolved", report.Id);
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == report.MarketplaceListingId, ct);
        if (listing is not null && listing.UserId != report.ReporterUserId) Notify(tenant, listing.UserId, "marketplace_enforcement_decision", "Marketplace enforcement decision", report.Id);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(new { message = appeal ? "Report appeal resolved" : "Report resolved", status = report.Status, action_taken = report.ActionTaken });
    }

    private async Task<string> Snapshot(int tenant, int listingId, CancellationToken ct)
    {
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.TenantId == tenant && x.Id == listingId, ct);
        var rows = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.UserId == listing.UserId)
            .Select(x => new ListingState(x.Id, x.Status, x.ModerationStatus)).ToListAsync(ct);
        var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.UserId == listing.UserId)
            .Select(x => new ProfileState(x.Id, x.IsSuspended, x.SuspensionReason)).SingleOrDefaultAsync(ct);
        return JsonSerializer.Serialize(new EnforcementState(listing.UserId, rows, profile));
    }

    private async Task ApplyEnforcement(int tenant, MarketplaceReport report, string action, CancellationToken ct)
    {
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().SingleAsync(x => x.TenantId == tenant && x.Id == report.MarketplaceListingId, ct);
        List<MarketplaceListing> targets;
        if (action == "seller_suspended")
            targets = await db.MarketplaceListings.IgnoreQueryFilters().Where(x => x.TenantId == tenant && x.UserId == listing.UserId).ToListAsync(ct);
        else
            targets = [listing];
        foreach (var target in targets) { target.Status = "removed"; target.ModerationStatus = "rejected"; target.MarketplaceEnforcementReportId = report.Id; target.UpdatedAt = DateTime.UtcNow; }
        if (action == "seller_suspended")
        {
            var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.UserId == listing.UserId, ct);
            if (profile is not null) { profile.IsSuspended = true; profile.SuspensionReason = report.ResolutionNotes; profile.MarketplaceSuspensionReportId = report.Id; profile.UpdatedAt = DateTime.UtcNow; }
        }
    }

    private async Task RestoreEnforcement(int tenant, MarketplaceReport report, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(report.EnforcementSnapshotJson)) return;
        var state = JsonSerializer.Deserialize<EnforcementState>(report.EnforcementSnapshotJson);
        if (state is null) return;
        var saved = state.Listings.ToDictionary(x => x.Id);
        var rows = await db.MarketplaceListings.IgnoreQueryFilters().Where(x => x.TenantId == tenant && x.MarketplaceEnforcementReportId == report.Id).ToListAsync(ct);
        foreach (var row in rows) if (saved.TryGetValue(row.Id, out var prior)) { row.Status = prior.Status; row.ModerationStatus = prior.ModerationStatus; row.MarketplaceEnforcementReportId = null; row.UpdatedAt = DateTime.UtcNow; }
        if (state.Profile is not null)
        {
            var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == state.Profile.Id && x.MarketplaceSuspensionReportId == report.Id, ct);
            if (profile is not null) { profile.IsSuspended = state.Profile.IsSuspended; profile.SuspensionReason = state.Profile.SuspensionReason; profile.MarketplaceSuspensionReportId = null; profile.UpdatedAt = DateTime.UtcNow; }
        }
    }

    private static object Viewer(MarketplaceReport report, MarketplaceListing? listing, int actorId)
    {
        var reporter = report.ReporterUserId == actorId;
        var seller = !reporter && listing?.UserId == actorId;
        return new { id = report.Id, marketplace_listing_id = report.MarketplaceListingId, reason = report.Reason, description = reporter ? report.Details : null, evidence_urls = reporter ? ParseUrls(report.EvidenceUrlsJson) : null, status = report.Status, acknowledged_at = Iso(report.AcknowledgedAt), resolved_at = Iso(report.ResolvedAt), resolution_reason = report.ResolutionNotes, action_taken = report.ActionTaken, appeal_text = report.AppealedByUserId == actorId ? report.AppealText : null, appeal_resolved_at = Iso(report.AppealResolvedAt), can_appeal = reporter && report.Status == "no_action" || seller && report.Status == "action_taken", viewer_role = reporter ? "reporter" : "seller", listing = listing is null ? null : new { id = listing.Id, title = listing.Title, status = listing.Status } };
    }

    private static object Admin(MarketplaceReport report, MarketplaceListing? listing, Dictionary<int, User> users)
    {
        users.TryGetValue(report.ReporterUserId, out var reporter); User? handler = null; if (report.ResolvedByUserId is int id) users.TryGetValue(id, out handler);
        return new { id = report.Id, marketplace_listing_id = report.MarketplaceListingId, reason = report.Reason, description = report.Details, evidence_urls = ParseUrls(report.EvidenceUrlsJson), status = report.Status, acknowledged_at = Iso(report.AcknowledgedAt), resolved_at = Iso(report.ResolvedAt), resolution_reason = report.ResolutionNotes, action_taken = report.ActionTaken, appeal_text = report.AppealText, appealed_by = report.AppealedByUserId, appeal_resolved_at = Iso(report.AppealResolvedAt), transparency_report_included = report.TransparencyReportIncluded, listing = listing is null ? null : new { id = listing.Id, title = listing.Title, status = listing.Status }, reporter = reporter is null ? null : new { id = reporter.Id, name = Name(reporter), avatar_url = reporter.AvatarUrl }, handler = handler is null ? null : new { id = handler.Id, name = Name(handler) }, created_at = Iso(report.CreatedAt), updated_at = Iso(report.UpdatedAt) };
    }

    private async Task<Dictionary<int, MarketplaceListing>> Listings(int tenant, IEnumerable<int> ids, CancellationToken ct) => await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && ids.Distinct().Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
    private async Task<Dictionary<int, User>> Users(int tenant, IEnumerable<int> ids, CancellationToken ct) => await db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && ids.Distinct().Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
    private Task Lock(int tenant, int id, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {id})", ct);
    private void Notify(int tenant, int userId, string type, string title, int reportId) => db.Notifications.Add(new Notification { TenantId = tenant, UserId = userId, Type = type, Title = title, Link = $"/marketplace/reports/{reportId}", Data = JsonSerializer.Serialize(new { marketplace_report_id = reportId }) });
    private static string Name(User user) => string.Join(' ', new[] { user.FirstName, user.LastName }.Where(x => !string.IsNullOrWhiteSpace(x)));
    private static string? Iso(DateTime? value) => value?.ToUniversalTime().ToString("O");
    private static string[]? ParseUrls(string? json) { try { return string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<string[]>(json); } catch { return null; } }
    private static bool SafeUrl(string value) => value.Length <= 2000 && Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo);
    private static MarketplaceReportCaseResult Validation(string field) => new(null, new("VALIDATION_ERROR", "Validation failed", 422, field));
    private static MarketplaceReportCaseResult Missing() => new(null, new("NOT_FOUND", "Marketplace report not found", 404));
    private static MarketplaceReportCaseResult Forbidden() => new(null, new("FORBIDDEN", "You cannot access this report", 403));
    private static MarketplaceReportCaseResult InvalidState() => new(null, new("VALIDATION_ERROR", "Marketplace report is not in a valid state", 422, "status"));
    private sealed record ListingState(int Id, string Status, string ModerationStatus);
    private sealed record ProfileState(int Id, bool IsSuspended, string? SuspensionReason);
    private sealed record EnforcementState(int SellerId, List<ListingState> Listings, ProfileState? Profile);
}
