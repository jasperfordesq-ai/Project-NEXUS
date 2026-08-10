// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// Canonical Laravel feed source-type values. <c>volunteer_hours</c> maps to a
/// volunteer log; <c>volunteer</c> maps to a volunteer opportunity and must not
/// be used for approved-hours activity.
/// </summary>
public static class FeedActivitySourceTypes
{
    public const string Post = "post";
    public const string Listing = "listing";
    public const string Event = "event";
    public const string Poll = "poll";
    public const string Goal = "goal";
    public const string Review = "review";
    public const string Job = "job";
    public const string Challenge = "challenge";
    public const string Volunteer = "volunteer";
    public const string VolunteerHours = "volunteer_hours";
    public const string Blog = "blog";
    public const string Discussion = "discussion";
    public const string BadgeEarned = "badge_earned";
    public const string LevelUp = "level_up";
    public const string Course = "course";
    public const string PodcastShow = "podcast_show";
    public const string PodcastEpisode = "podcast_episode";

    private static readonly string[] CanonicalValues =
    [
        Post,
        Listing,
        Event,
        Poll,
        Goal,
        Review,
        Job,
        Challenge,
        Volunteer,
        VolunteerHours,
        Blog,
        Discussion,
        BadgeEarned,
        LevelUp,
        Course,
        PodcastShow,
        PodcastEpisode
    ];

    private static readonly HashSet<string> CanonicalSet =
        new(CanonicalValues, StringComparer.Ordinal);

    public static IReadOnlyList<string> All { get; } =
        Array.AsReadOnly(CanonicalValues);

    public static bool IsSupported(string? sourceType) =>
        sourceType is not null && CanonicalSet.Contains(sourceType);
}

/// <summary>
/// Optional denormalized display fields accepted by Laravel's generic feed
/// publisher. Visibility is intentionally service-owned rather than caller-
/// controlled.
/// </summary>
public sealed record FeedActivityData
{
    public string? Title { get; init; }
    public string? Content { get; init; }
    public string? ImageUrl { get; init; }
    public int? GroupId { get; init; }
    public IReadOnlyDictionary<string, object?>? Metadata { get; init; }
    public DateTime? CreatedAt { get; init; }
}

/// <summary>
/// Writes the denormalized <c>feed_activity</c> projection with Laravel's
/// idempotent (tenant, source type, source id) semantics.
/// </summary>
public sealed class FeedActivityService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<FeedActivityService> _logger;

    public FeedActivityService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<FeedActivityService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Inserts or refreshes one canonical feed row. A conflict updates Laravel's
    /// denormalized display fields but deliberately preserves moderation state.
    /// </summary>
    public async Task RecordActivityAsync(
        int tenantId,
        int userId,
        string sourceType,
        int sourceId,
        FeedActivityData? data = null,
        CancellationToken ct = default)
    {
        if (!FeedActivitySourceTypes.IsSupported(sourceType))
        {
            _logger.LogError(
                "FeedActivityService rejected unsupported source type {SourceType}.",
                sourceType);
            return;
        }

        ValidateIdentity(tenantId, userId, sourceId);

        if (sourceType == FeedActivitySourceTypes.VolunteerHours
            && !string.IsNullOrEmpty(data?.Content))
        {
            throw new ArgumentException(
                "volunteer_hours feed activity cannot contain free-text content.",
                nameof(data));
        }

        var activityData = data ?? new FeedActivityData();

        if (activityData.Title?.Length > 500)
        {
            throw new ArgumentException("Feed activity title cannot exceed 500 characters.", nameof(data));
        }

        if (activityData.ImageUrl?.Length > 500)
        {
            throw new ArgumentException("Feed activity image URL cannot exceed 500 characters.", nameof(data));
        }

        var groupId = activityData.GroupId > 0 ? activityData.GroupId : null;
        var content = string.IsNullOrEmpty(activityData.Content) ? null : activityData.Content;
        var metadataJson = activityData.Metadata is null
            ? null
            : JsonSerializer.Serialize(activityData.Metadata);
        var createdAt = NormalizeUtc(activityData.CreatedAt ?? DateTime.UtcNow);

        await _db.Database.ExecuteSqlInterpolatedAsync($@"
            INSERT INTO feed_activity
                (tenant_id, user_id, source_type, source_id, group_id, title,
                 content, image_url, metadata, is_visible, created_at, is_hidden)
            VALUES
                ({tenantId}, {userId}, {sourceType}, {sourceId}, {groupId}, {activityData.Title},
                 {content}, {activityData.ImageUrl}, CAST({metadataJson} AS jsonb), TRUE,
                 {createdAt}, FALSE)
            ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                group_id = EXCLUDED.group_id,
                title = EXCLUDED.title,
                content = EXCLUDED.content,
                image_url = EXCLUDED.image_url,
                metadata = EXCLUDED.metadata,
                created_at = EXCLUDED.created_at",
            ct);
    }

    /// <summary>
    /// Safe approved-hours publisher. Its signature intentionally has no log
    /// description/content argument, preventing organisation-facing free text
    /// from leaking into the community feed.
    /// </summary>
    public Task RecordVolunteerHoursAsync(
        int tenantId,
        int userId,
        int volunteerLogId,
        decimal hours,
        int? organisationId,
        string? organisationName,
        int? opportunityId,
        CancellationToken ct = default)
    {
        if (hours <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(hours), "Volunteer hours must be positive.");
        }

        var title = string.Format(
            CultureInfo.InvariantCulture,
            "Volunteered {0:F2} hours",
            hours);
        var metadata = new Dictionary<string, object?>
        {
            ["vol_log_id"] = volunteerLogId,
            ["organization_id"] = organisationId,
            ["organization"] = organisationName,
            ["opportunity_id"] = opportunityId,
            ["hours"] = hours
        };

        return RecordActivityAsync(
            tenantId,
            userId,
            FeedActivitySourceTypes.VolunteerHours,
            volunteerLogId,
            new FeedActivityData
            {
                Title = title,
                Content = null,
                Metadata = metadata
            },
            ct);
    }

    private void ValidateIdentity(int tenantId, int userId, int sourceId)
    {
        if (tenantId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(tenantId));
        }

        if (_tenantContext.IsResolved && _tenantContext.GetTenantIdOrThrow() != tenantId)
        {
            throw new InvalidOperationException(
                "Feed activity tenant does not match the resolved tenant context.");
        }

        if (userId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(userId));
        }

        if (sourceId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sourceId));
        }
    }

    private static DateTime NormalizeUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}
