// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class ProjectAnnouncementService
{
    private static readonly string[] PublicStatuses = ["active", "paused", "completed"];

    private readonly NexusDbContext _db;

    public ProjectAnnouncementService(NexusDbContext db, TenantContext tenantContext)
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

    public Task<bool> IsAvailableAsync(CancellationToken ct)
    {
        return Task.FromResult(true);
    }

    public async Task<IReadOnlyList<ProjectAnnouncementRow>> ListPublishedAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(project => project.TenantId == tenantId && PublicStatuses.Contains(project.Status))
            .ToListAsync(ct);

        return rows
            .OrderBy(project => ProjectStatusRank(project.Status))
            .ThenByDescending(project => project.LastUpdateAt ?? DateTime.MinValue)
            .ThenByDescending(project => project.PublishedAt ?? DateTime.MinValue)
            .Select(project => MapProject(project))
            .ToArray();
    }

    public async Task<IReadOnlyList<ProjectAnnouncementRow>> ListAdminAsync(
        int tenantId,
        string? status,
        CancellationToken ct)
    {
        var rows = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(project => project.TenantId == tenantId)
            .ToListAsync(ct);

        if (status is not null)
        {
            rows = rows.Where(project => project.Status == status).ToList();
        }

        return rows
            .OrderByDescending(project => project.CreatedAt)
            .Select(project => MapProject(project))
            .ToArray();
    }

    public async Task<ProjectAnnouncementRow?> GetProjectAsync(
        int tenantId,
        int id,
        bool includeDrafts,
        int? viewerId,
        CancellationToken ct)
    {
        var project = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);

        if (project is null || (!includeDrafts && !PublicStatuses.Contains(project.Status)))
        {
            return null;
        }

        var updateRows = await _db.CaringProjectUpdates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(update => update.TenantId == tenantId && update.ProjectId == id)
            .ToListAsync(ct);

        if (!includeDrafts)
        {
            updateRows = updateRows.Where(update => update.Status == "published").ToList();
        }

        var updates = updateRows
            .OrderByDescending(update => update.IsMilestone)
            .ThenByDescending(update => update.PublishedAt ?? DateTime.MinValue)
            .ThenByDescending(update => update.CreatedAt)
            .Select(MapUpdate)
            .ToArray();

        var isSubscribed = viewerId is not null
            && await IsSubscribedAsync(id, tenantId, viewerId.Value, ct);

        return MapProject(project, updates, isSubscribed);
    }

    public async Task<ProjectAnnouncementMutationResult> CreateProjectAsync(
        int tenantId,
        int userId,
        ProjectAnnouncementRequest request,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var status = IsProjectStatus(request.Status) ? request.Status! : "draft";
        var project = new CaringProjectAnnouncement
        {
            TenantId = tenantId,
            CreatedBy = userId,
            Title = Truncate(request.Title!, 255),
            Summary = NullIfWhiteSpace(request.Summary),
            Location = TruncateOrNull(request.Location, 255),
            Status = status,
            CurrentStage = TruncateOrNull(request.CurrentStage, 120),
            ProgressPercent = request.ProgressPercent ?? 0,
            StartsAt = DateOrNull(request.StartsAt),
            EndsAt = DateOrNull(request.EndsAt),
            PublishedAt = status == "draft" ? null : now,
            LastUpdateAt = null,
            SubscriberCount = 0,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringProjectAnnouncements.Add(project);
        await _db.SaveChangesAsync(ct);
        return new ProjectAnnouncementMutationResult(
            Row: await GetProjectAsync(tenantId, project.Id, includeDrafts: true, viewerId: null, ct));
    }

    public async Task<ProjectAnnouncementMutationResult> UpdateProjectAsync(
        int tenantId,
        int id,
        ProjectAnnouncementRequest request,
        CancellationToken ct)
    {
        var project = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);

        if (project is null)
        {
            return new ProjectAnnouncementMutationResult(NotFound: true);
        }

        if (request.Title is not null)
        {
            project.Title = Truncate(request.Title, 255);
        }
        if (request.Summary is not null)
        {
            project.Summary = NullIfWhiteSpace(request.Summary);
        }
        if (request.Location is not null)
        {
            project.Location = TruncateOrNull(request.Location, 255);
        }
        if (request.CurrentStage is not null)
        {
            project.CurrentStage = TruncateOrNull(request.CurrentStage, 120);
        }
        if (request.ProgressPercent is not null)
        {
            project.ProgressPercent = request.ProgressPercent.Value;
        }
        if (request.StartsAt is not null)
        {
            project.StartsAt = DateOrNull(request.StartsAt);
        }
        if (request.EndsAt is not null)
        {
            project.EndsAt = DateOrNull(request.EndsAt);
        }
        if (request.Status is not null)
        {
            project.Status = request.Status;
            if (request.Status != "draft")
            {
                project.PublishedAt ??= DateTime.UtcNow;
            }
        }

        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new ProjectAnnouncementMutationResult(
            Row: await GetProjectAsync(tenantId, id, includeDrafts: true, viewerId: null, ct));
    }

    public async Task<ProjectAnnouncementMutationResult> PublishProjectAsync(
        int tenantId,
        int id,
        CancellationToken ct)
    {
        var project = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);

        if (project is null)
        {
            return new ProjectAnnouncementMutationResult(NotFound: true);
        }

        project.Status = "active";
        project.PublishedAt ??= DateTime.UtcNow;
        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new ProjectAnnouncementMutationResult(
            Row: await GetProjectAsync(tenantId, id, includeDrafts: true, viewerId: null, ct));
    }

    public async Task<ProjectUpdateMutationResult> CreateUpdateAsync(
        int tenantId,
        int projectId,
        int userId,
        ProjectUpdateRequest request,
        CancellationToken ct)
    {
        var projectExists = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .AnyAsync(row => row.TenantId == tenantId && row.Id == projectId, ct);

        if (!projectExists)
        {
            return new ProjectUpdateMutationResult(NotFound: true);
        }

        var now = DateTime.UtcNow;
        var status = request.Status is "published" ? "published" : "draft";
        var update = new CaringProjectUpdate
        {
            TenantId = tenantId,
            ProjectId = projectId,
            CreatedBy = userId,
            StageLabel = TruncateOrNull(request.StageLabel, 120),
            Title = Truncate(request.Title!, 255),
            Body = NullIfWhiteSpace(request.Body),
            ProgressPercent = request.ProgressPercent,
            IsMilestone = request.IsMilestone ?? false,
            Status = status,
            PublishedAt = status == "published" ? now : null,
            NotificationCount = 0,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringProjectUpdates.Add(update);
        await _db.SaveChangesAsync(ct);

        if (status == "published")
        {
            await ApplyPublishedUpdateAsync(update.Id, tenantId, ct);
        }

        return new ProjectUpdateMutationResult(Row: await GetUpdateAsync(update.Id, tenantId, ct));
    }

    public async Task<ProjectUpdateMutationResult> PublishUpdateAsync(
        int tenantId,
        int updateId,
        CancellationToken ct)
    {
        var update = await _db.CaringProjectUpdates
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == updateId, ct);

        if (update is null)
        {
            return new ProjectUpdateMutationResult(NotFound: true);
        }

        if (update.Status != "published")
        {
            update.Status = "published";
            update.PublishedAt = DateTime.UtcNow;
            update.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await ApplyPublishedUpdateAsync(updateId, tenantId, ct);
        }

        return new ProjectUpdateMutationResult(Row: await GetUpdateAsync(updateId, tenantId, ct));
    }

    public async Task<ProjectSubscriptionResult> SubscribeAsync(
        int tenantId,
        int projectId,
        int userId,
        CancellationToken ct)
    {
        var project = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.Id == projectId
                && PublicStatuses.Contains(row.Status), ct);

        if (project is null)
        {
            return new ProjectSubscriptionResult(NotFound: true);
        }

        var now = DateTime.UtcNow;
        var subscription = await _db.CaringProjectSubscriptions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.ProjectId == projectId
                && row.UserId == userId, ct);

        if (subscription is null)
        {
            _db.CaringProjectSubscriptions.Add(new CaringProjectSubscription
            {
                TenantId = tenantId,
                ProjectId = projectId,
                UserId = userId,
                SubscribedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            subscription.SubscribedAt = now;
            subscription.UnsubscribedAt = null;
            subscription.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
        await RefreshSubscriberCountAsync(projectId, tenantId, ct);
        return new ProjectSubscriptionResult(Ok: true);
    }

    public async Task<ProjectSubscriptionResult> UnsubscribeAsync(
        int tenantId,
        int projectId,
        int userId,
        CancellationToken ct)
    {
        var subscription = await _db.CaringProjectSubscriptions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.ProjectId == projectId
                && row.UserId == userId, ct);

        if (subscription is not null)
        {
            subscription.UnsubscribedAt = DateTime.UtcNow;
            subscription.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        await RefreshSubscriberCountAsync(projectId, tenantId, ct);
        return new ProjectSubscriptionResult(Ok: true);
    }

    private async Task RefreshSubscriberCountAsync(int projectId, int tenantId, CancellationToken ct)
    {
        var count = await _db.CaringProjectSubscriptions
            .IgnoreQueryFilters()
            .CountAsync(row =>
                row.TenantId == tenantId
                && row.ProjectId == projectId
                && row.UnsubscribedAt == null, ct);

        var project = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == projectId, ct);
        if (project is null)
        {
            return;
        }

        project.SubscriberCount = count;
        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task ApplyPublishedUpdateAsync(int updateId, int tenantId, CancellationToken ct)
    {
        var update = await _db.CaringProjectUpdates
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == updateId, ct);

        if (update is null || update.Status != "published")
        {
            return;
        }

        var project = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == update.ProjectId, ct);

        if (project is null)
        {
            return;
        }

        project.LastUpdateAt = update.PublishedAt ?? DateTime.UtcNow;
        if (update.ProgressPercent is not null)
        {
            project.ProgressPercent = update.ProgressPercent.Value;
        }
        if (!string.IsNullOrWhiteSpace(update.StageLabel))
        {
            project.CurrentStage = Truncate(update.StageLabel, 120);
        }

        update.NotificationCount = await _db.CaringProjectSubscriptions
            .IgnoreQueryFilters()
            .CountAsync(row =>
                row.TenantId == tenantId
                && row.ProjectId == update.ProjectId
                && row.UnsubscribedAt == null, ct);
        update.UpdatedAt = DateTime.UtcNow;
        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task<bool> IsSubscribedAsync(int projectId, int tenantId, int userId, CancellationToken ct)
    {
        return await _db.CaringProjectSubscriptions
            .IgnoreQueryFilters()
            .AnyAsync(row =>
                row.TenantId == tenantId
                && row.ProjectId == projectId
                && row.UserId == userId
                && row.UnsubscribedAt == null, ct);
    }

    private async Task<ProjectUpdateRow?> GetUpdateAsync(int updateId, int tenantId, CancellationToken ct)
    {
        var update = await _db.CaringProjectUpdates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == updateId, ct);

        return update is null ? null : MapUpdate(update);
    }

    private static ProjectAnnouncementRow MapProject(
        CaringProjectAnnouncement project,
        IReadOnlyList<ProjectUpdateRow>? updates = null,
        bool? isSubscribed = null)
    {
        return new ProjectAnnouncementRow(
            Id: project.Id,
            TenantId: project.TenantId,
            CreatedBy: project.CreatedBy,
            Title: project.Title,
            Summary: project.Summary,
            Location: project.Location,
            Status: project.Status,
            CurrentStage: project.CurrentStage,
            ProgressPercent: project.ProgressPercent,
            StartsAt: project.StartsAt,
            EndsAt: project.EndsAt,
            PublishedAt: project.PublishedAt,
            LastUpdateAt: project.LastUpdateAt,
            SubscriberCount: project.SubscriberCount,
            CreatedAt: project.CreatedAt,
            UpdatedAt: project.UpdatedAt,
            Updates: updates,
            IsSubscribed: isSubscribed);
    }

    private static ProjectUpdateRow MapUpdate(CaringProjectUpdate update)
    {
        return new ProjectUpdateRow(
            Id: update.Id,
            TenantId: update.TenantId,
            ProjectId: update.ProjectId,
            CreatedBy: update.CreatedBy,
            StageLabel: update.StageLabel,
            Title: update.Title,
            Body: update.Body,
            ProgressPercent: update.ProgressPercent,
            IsMilestone: update.IsMilestone,
            Status: update.Status,
            PublishedAt: update.PublishedAt,
            NotificationCount: update.NotificationCount,
            CreatedAt: update.CreatedAt,
            UpdatedAt: update.UpdatedAt);
    }

    private static int ProjectStatusRank(string status)
    {
        return status switch
        {
            "active" => 0,
            "paused" => 1,
            "completed" => 2,
            _ => 3
        };
    }

    internal static bool IsProjectStatus(string? status)
    {
        return status is "draft" or "active" or "paused" or "completed" or "cancelled";
    }

    internal static bool IsUpdateStatus(string? status)
    {
        return status is "draft" or "published";
    }

    internal static DateTime? DateOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTime.TryParse(
            value,
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }

    private static string Truncate(string value, int max)
    {
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }

    private static string? TruncateOrNull(string? value, int max)
    {
        var normalized = NullIfWhiteSpace(value);
        return normalized is null ? null : Truncate(normalized, max);
    }

    private static string? NullIfWhiteSpace(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
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

public sealed record ProjectAnnouncementRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("created_by")] int? CreatedBy,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("summary")] string? Summary,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("current_stage")] string? CurrentStage,
    [property: JsonPropertyName("progress_percent")] int ProgressPercent,
    [property: JsonPropertyName("starts_at")] DateTime? StartsAt,
    [property: JsonPropertyName("ends_at")] DateTime? EndsAt,
    [property: JsonPropertyName("published_at")] DateTime? PublishedAt,
    [property: JsonPropertyName("last_update_at")] DateTime? LastUpdateAt,
    [property: JsonPropertyName("subscriber_count")] int SubscriberCount,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("updates")] IReadOnlyList<ProjectUpdateRow>? Updates = null,
    [property: JsonPropertyName("is_subscribed")] bool? IsSubscribed = null);

public sealed record ProjectUpdateRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("project_id")] int ProjectId,
    [property: JsonPropertyName("created_by")] int? CreatedBy,
    [property: JsonPropertyName("stage_label")] string? StageLabel,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("body")] string? Body,
    [property: JsonPropertyName("progress_percent")] int? ProgressPercent,
    [property: JsonPropertyName("is_milestone")] bool IsMilestone,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("published_at")] DateTime? PublishedAt,
    [property: JsonPropertyName("notification_count")] int NotificationCount,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record ProjectSubscriptionResult(bool Ok = false, bool NotFound = false);

public sealed class ProjectAnnouncementRequest
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("location")] public string? Location { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("current_stage")] public string? CurrentStage { get; set; }
    [JsonPropertyName("progress_percent")] public int? ProgressPercent { get; set; }
    [JsonPropertyName("starts_at")] public string? StartsAt { get; set; }
    [JsonPropertyName("ends_at")] public string? EndsAt { get; set; }
}

public sealed class ProjectUpdateRequest
{
    [JsonPropertyName("stage_label")] public string? StageLabel { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("body")] public string? Body { get; set; }
    [JsonPropertyName("progress_percent")] public int? ProgressPercent { get; set; }
    [JsonPropertyName("is_milestone")] public bool? IsMilestone { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
}

public sealed record ProjectAnnouncementMutationResult(
    ProjectAnnouncementRow? Row = null,
    bool NotFound = false);

public sealed record ProjectUpdateMutationResult(
    ProjectUpdateRow? Row = null,
    bool NotFound = false);
