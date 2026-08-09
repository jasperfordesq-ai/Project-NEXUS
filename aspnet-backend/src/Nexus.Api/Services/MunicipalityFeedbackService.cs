// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class MunicipalityFeedbackService
{
    private static readonly string[] Categories = ["question", "idea", "issue_report", "sentiment"];
    private static readonly string[] SentimentTags = ["positive", "neutral", "negative", "concerned"];
    private static readonly string[] Statuses = ["new", "triaging", "in_progress", "resolved", "closed"];
    private static readonly string[] OpenStatuses = ["new", "triaging", "in_progress"];

    private const int MaxSubject = 200;
    private const int MaxBody = 5000;

    private readonly NexusDbContext _db;

    public MunicipalityFeedbackService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<MunicipalityFeedbackMutationResult> SubmitAsync(
        int tenantId,
        int userId,
        MunicipalityFeedbackRequest request,
        CancellationToken ct)
    {
        var errors = ValidateSubmission(request);
        if (errors.Count > 0)
        {
            return new MunicipalityFeedbackMutationResult(Errors: errors);
        }

        var now = DateTime.UtcNow;
        var row = new CaringMunicipalityFeedback
        {
            TenantId = tenantId,
            SubmitterUserId = userId,
            SubRegionId = request.SubRegionId,
            Category = request.Category!.Trim(),
            Subject = request.Subject!.Trim(),
            Body = request.Body!.Trim(),
            SentimentTag = string.IsNullOrWhiteSpace(request.SentimentTag) ? null : request.SentimentTag,
            Status = "new",
            IsAnonymous = request.IsAnonymous,
            IsPublic = request.IsPublic,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringMunicipalityFeedback.Add(row);
        await _db.SaveChangesAsync(ct);

        return new MunicipalityFeedbackMutationResult(Row: Map(row, adminContext: false, memberOwnView: false));
    }

    public async Task<IReadOnlyList<MunicipalityFeedbackRow>> ListForMemberAsync(
        int tenantId,
        int userId,
        int limit,
        CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 200);

        var rows = await _db.CaringMunicipalityFeedback
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.SubmitterUserId == userId)
            .OrderByDescending(row => row.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);

        return rows.Select(row => Map(row, adminContext: false, memberOwnView: true)).ToArray();
    }

    public async Task<MunicipalityFeedbackPage> ListForAdminAsync(
        int tenantId,
        string? statusFilter,
        string? categoryFilter,
        string? subRegionId,
        int page,
        int perPage,
        CancellationToken ct)
    {
        page = Math.Max(1, page);
        perPage = Math.Clamp(perPage, 1, 200);

        var query = _db.CaringMunicipalityFeedback
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId);

        if (IsAllowed(statusFilter, Statuses))
        {
            query = query.Where(row => row.Status == statusFilter);
        }

        if (IsAllowed(categoryFilter, Categories))
        {
            query = query.Where(row => row.Category == categoryFilter);
        }

        if (!string.IsNullOrWhiteSpace(subRegionId) && int.TryParse(subRegionId, out var parsedSubRegionId))
        {
            query = query.Where(row => row.SubRegionId == parsedSubRegionId);
        }

        var total = await query.CountAsync(ct);
        var rows = await query
            .OrderByDescending(row => row.CreatedAt)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .ToListAsync(ct);

        return new MunicipalityFeedbackPage(
            rows.Select(row => Map(row, adminContext: true, memberOwnView: false)).ToArray(),
            new MunicipalityFeedbackMeta(
                CurrentPage: page,
                PerPage: perPage,
                Total: total,
                TotalPages: total > 0 ? (int)Math.Ceiling(total / (double)perPage) : 0));
    }

    public async Task<MunicipalityFeedbackRow?> ShowAsync(int tenantId, long id, bool adminContext, CancellationToken ct)
    {
        var row = await FindAsync(tenantId, id, tracking: false, ct);
        return row is null ? null : Map(row, adminContext, memberOwnView: false);
    }

    public async Task<MunicipalityFeedbackMutationResult> TriageAsync(
        int tenantId,
        long id,
        MunicipalityFeedbackTriageRequest request,
        CancellationToken ct)
    {
        var row = await FindAsync(tenantId, id, tracking: true, ct);
        if (row is null)
        {
            return NotFoundResult();
        }

        if (request.Status is not null)
        {
            if (!IsAllowed(request.Status, Statuses))
            {
                return SingleError("INVALID_STATUS", "Status is invalid.", "status");
            }

            row.Status = request.Status;
        }

        if (request.AssignedUserId.HasValue)
        {
            row.AssignedUserId = request.AssignedUserId.Value;
        }
        else if (request.ClearAssignedUserId == true)
        {
            row.AssignedUserId = null;
        }

        if (request.AssignedRoleSet)
        {
            row.AssignedRole = string.IsNullOrWhiteSpace(request.AssignedRole)
                ? null
                : request.AssignedRole.Trim()[..Math.Min(64, request.AssignedRole.Trim().Length)];
        }

        if (request.TriageNotesSet)
        {
            row.TriageNotes = string.IsNullOrWhiteSpace(request.TriageNotes) ? null : request.TriageNotes;
        }

        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new MunicipalityFeedbackMutationResult(Row: Map(row, adminContext: true, memberOwnView: false));
    }

    public async Task<MunicipalityFeedbackMutationResult> ResolveAsync(
        int tenantId,
        long id,
        MunicipalityFeedbackResolveRequest request,
        CancellationToken ct)
    {
        var row = await FindAsync(tenantId, id, tracking: true, ct);
        if (row is null)
        {
            return NotFoundResult();
        }

        var notes = request.ResolutionNotes?.Trim() ?? string.Empty;
        if (notes.Length == 0)
        {
            return SingleError("NOTES_REQUIRED", "Resolution notes are required.", "resolution_notes");
        }

        row.Status = "resolved";
        row.ResolutionNotes = notes;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new MunicipalityFeedbackMutationResult(Row: Map(row, adminContext: true, memberOwnView: false));
    }

    public async Task<MunicipalityFeedbackMutationResult> CloseAsync(int tenantId, long id, CancellationToken ct)
    {
        var row = await FindAsync(tenantId, id, tracking: true, ct);
        if (row is null)
        {
            return NotFoundResult();
        }

        row.Status = "closed";
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new MunicipalityFeedbackMutationResult(Row: Map(row, adminContext: true, memberOwnView: false));
    }

    public async Task<MunicipalityFeedbackDashboard> DashboardStatsAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.CaringMunicipalityFeedback
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId)
            .ToListAsync(ct);

        return new MunicipalityFeedbackDashboard(
            TotalOpen: rows.Count(row => OpenStatuses.Contains(row.Status, StringComparer.Ordinal)),
            ByStatus: rows.GroupBy(row => row.Status).ToDictionary(group => group.Key, group => group.Count()),
            ByCategory: rows.GroupBy(row => row.Category).ToDictionary(group => group.Key, group => group.Count()),
            BySubRegion: rows.Where(row => row.SubRegionId.HasValue)
                .GroupBy(row => row.SubRegionId!.Value)
                .ToDictionary(group => group.Key, group => group.Count()),
            RecentCount7d: rows.Count(row => row.CreatedAt >= DateTime.UtcNow.AddDays(-7)),
            SentimentDistribution: rows.Where(row => row.SentimentTag is not null)
                .GroupBy(row => row.SentimentTag!)
                .ToDictionary(group => group.Key, group => group.Count()));
    }

    public async Task<string> ExportCsvAsync(
        int tenantId,
        string? statusFilter,
        string? categoryFilter,
        CancellationToken ct)
    {
        var query = _db.CaringMunicipalityFeedback
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId);

        if (IsAllowed(statusFilter, Statuses))
        {
            query = query.Where(row => row.Status == statusFilter);
        }

        if (IsAllowed(categoryFilter, Categories))
        {
            query = query.Where(row => row.Category == categoryFilter);
        }

        var rows = await query
            .OrderByDescending(row => row.CreatedAt)
            .Take(10000)
            .ToListAsync(ct);

        var builder = new StringBuilder("\uFEFF");
        AppendCsvRow(builder,
        [
            "id", "created_at", "category", "status", "subject", "sentiment_tag",
            "sub_region_id", "submitter", "is_anonymous", "is_public",
            "assigned_role", "triage_notes", "resolution_notes", "body"
        ]);

        foreach (var row in rows)
        {
            AppendCsvRow(builder,
            [
                row.Id.ToString(),
                FormatDate(row.CreatedAt),
                row.Category,
                row.Status,
                row.Subject,
                row.SentimentTag ?? "",
                row.SubRegionId?.ToString() ?? "",
                row.IsAnonymous ? "(anonymous)" : row.SubmitterUserId?.ToString() ?? "",
                row.IsAnonymous ? "1" : "0",
                row.IsPublic ? "1" : "0",
                row.AssignedRole ?? "",
                row.TriageNotes ?? "",
                row.ResolutionNotes ?? "",
                row.Body
            ]);
        }

        return builder.ToString();
    }

    private async Task<CaringMunicipalityFeedback?> FindAsync(int tenantId, long id, bool tracking, CancellationToken ct)
    {
        var query = _db.CaringMunicipalityFeedback
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId && row.Id == id);

        if (!tracking)
        {
            query = query.AsNoTracking();
        }

        return await query.FirstOrDefaultAsync(ct);
    }

    private static List<LaravelErrorRow> ValidateSubmission(MunicipalityFeedbackRequest request)
    {
        var errors = new List<LaravelErrorRow>();

        if (!IsAllowed(request.Category, Categories))
        {
            errors.Add(new LaravelErrorRow("INVALID_CATEGORY", "Feedback category is invalid.", "category"));
        }

        var subject = request.Subject?.Trim() ?? string.Empty;
        if (subject.Length == 0)
        {
            errors.Add(new LaravelErrorRow("SUBJECT_REQUIRED", "Subject is required.", "subject"));
        }
        else if (subject.Length > MaxSubject)
        {
            errors.Add(new LaravelErrorRow("SUBJECT_TOO_LONG", "Subject is too long.", "subject"));
        }

        var body = request.Body?.Trim() ?? string.Empty;
        if (body.Length == 0)
        {
            errors.Add(new LaravelErrorRow("BODY_REQUIRED", "Body is required.", "body"));
        }
        else if (body.Length > MaxBody)
        {
            errors.Add(new LaravelErrorRow("BODY_TOO_LONG", "Body is too long.", "body"));
        }

        if (!string.IsNullOrWhiteSpace(request.SentimentTag)
            && !IsAllowed(request.SentimentTag, SentimentTags))
        {
            errors.Add(new LaravelErrorRow("INVALID_SENTIMENT", "Sentiment tag is invalid.", "sentiment_tag"));
        }

        if (request.SubRegionId < 0)
        {
            errors.Add(new LaravelErrorRow("INVALID_SUB_REGION", "Sub-region is invalid.", "sub_region_id"));
        }

        return errors;
    }

    private static MunicipalityFeedbackRow Map(
        CaringMunicipalityFeedback row,
        bool adminContext,
        bool memberOwnView)
    {
        var exposeSubmitter = adminContext || memberOwnView || !row.IsAnonymous;

        return new MunicipalityFeedbackRow(
            Id: row.Id,
            TenantId: row.TenantId,
            SubmitterUserId: exposeSubmitter ? row.SubmitterUserId : null,
            SubRegionId: row.SubRegionId,
            Category: row.Category,
            Subject: row.Subject,
            Body: row.Body,
            SentimentTag: row.SentimentTag,
            Status: row.Status,
            AssignedUserId: row.AssignedUserId,
            AssignedRole: row.AssignedRole,
            TriageNotes: row.TriageNotes,
            ResolutionNotes: row.ResolutionNotes,
            IsAnonymous: row.IsAnonymous,
            IsPublic: row.IsPublic,
            CreatedAt: FormatDate(row.CreatedAt),
            UpdatedAt: row.UpdatedAt.HasValue ? FormatDate(row.UpdatedAt.Value) : "");
    }

    private static bool IsAllowed(string? value, IReadOnlyCollection<string> allowed)
    {
        return !string.IsNullOrWhiteSpace(value) && allowed.Contains(value, StringComparer.Ordinal);
    }

    private static MunicipalityFeedbackMutationResult SingleError(string code, string message, string? field = null)
    {
        return new MunicipalityFeedbackMutationResult(Errors: [new LaravelErrorRow(code, message, field)]);
    }

    private static MunicipalityFeedbackMutationResult NotFoundResult()
    {
        return SingleError("NOT_FOUND", "Feedback not found.");
    }

    private static void AppendCsvRow(StringBuilder builder, IReadOnlyList<string> cells)
    {
        for (var i = 0; i < cells.Count; i++)
        {
            if (i > 0)
            {
                builder.Append(',');
            }

            builder.Append(EscapeCsvCell(cells[i]));
        }

        builder.Append('\n');
    }

    private static string EscapeCsvCell(string raw)
    {
        var value = raw;
        if (value.Length > 0 && "=+-@".Contains(value[0], StringComparison.Ordinal))
        {
            value = "'" + value;
        }

        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }

    private static string FormatDate(DateTime value)
    {
        return value.ToUniversalTime().ToString("O");
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }
}

public sealed class MunicipalityFeedbackRequest
{
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("subject")] public string? Subject { get; set; }
    [JsonPropertyName("body")] public string? Body { get; set; }
    [JsonPropertyName("sentiment_tag")] public string? SentimentTag { get; set; }
    [JsonPropertyName("sub_region_id")] public int? SubRegionId { get; set; }
    [JsonPropertyName("is_anonymous")] public bool IsAnonymous { get; set; }
    [JsonPropertyName("is_public")] public bool IsPublic { get; set; }
}

public sealed class MunicipalityFeedbackTriageRequest
{
    private string? _assignedRole;
    private string? _triageNotes;

    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("assigned_user_id")] public int? AssignedUserId { get; set; }
    [JsonIgnore] public bool? ClearAssignedUserId { get; set; }

    [JsonPropertyName("assigned_role")]
    public string? AssignedRole
    {
        get => _assignedRole;
        set
        {
            _assignedRole = value;
            AssignedRoleSet = true;
        }
    }

    [JsonIgnore] public bool AssignedRoleSet { get; private set; }

    [JsonPropertyName("triage_notes")]
    public string? TriageNotes
    {
        get => _triageNotes;
        set
        {
            _triageNotes = value;
            TriageNotesSet = true;
        }
    }

    [JsonIgnore] public bool TriageNotesSet { get; private set; }
}

public sealed class MunicipalityFeedbackResolveRequest
{
    [JsonPropertyName("resolution_notes")] public string? ResolutionNotes { get; set; }
}

public sealed record MunicipalityFeedbackRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("submitter_user_id")] int? SubmitterUserId,
    [property: JsonPropertyName("sub_region_id")] int? SubRegionId,
    [property: JsonPropertyName("category")] string Category,
    [property: JsonPropertyName("subject")] string Subject,
    [property: JsonPropertyName("body")] string Body,
    [property: JsonPropertyName("sentiment_tag")] string? SentimentTag,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("assigned_user_id")] int? AssignedUserId,
    [property: JsonPropertyName("assigned_role")] string? AssignedRole,
    [property: JsonPropertyName("triage_notes")] string? TriageNotes,
    [property: JsonPropertyName("resolution_notes")] string? ResolutionNotes,
    [property: JsonPropertyName("is_anonymous")] bool IsAnonymous,
    [property: JsonPropertyName("is_public")] bool IsPublic,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("updated_at")] string UpdatedAt);

public sealed record MunicipalityFeedbackPage(
    IReadOnlyList<MunicipalityFeedbackRow> Items,
    MunicipalityFeedbackMeta Meta);

public sealed record MunicipalityFeedbackMeta(
    [property: JsonPropertyName("current_page")] int CurrentPage,
    [property: JsonPropertyName("per_page")] int PerPage,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("total_pages")] int TotalPages)
{
    [JsonPropertyName("has_more")]
    public bool HasMore => CurrentPage < TotalPages;
}

public sealed record MunicipalityFeedbackDashboard(
    [property: JsonPropertyName("total_open")] int TotalOpen,
    [property: JsonPropertyName("by_status")] IReadOnlyDictionary<string, int> ByStatus,
    [property: JsonPropertyName("by_category")] IReadOnlyDictionary<string, int> ByCategory,
    [property: JsonPropertyName("by_sub_region")] IReadOnlyDictionary<int, int> BySubRegion,
    [property: JsonPropertyName("recent_count_7d")] int RecentCount7d,
    [property: JsonPropertyName("sentiment_distribution")] IReadOnlyDictionary<string, int> SentimentDistribution);

public sealed record MunicipalityFeedbackMutationResult(
    MunicipalityFeedbackRow? Row = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null);

public sealed record LaravelErrorRow(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("field")] string? Field = null);
