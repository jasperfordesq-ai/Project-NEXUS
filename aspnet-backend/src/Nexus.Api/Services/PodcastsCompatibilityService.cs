// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class PodcastsCompatibilityService
{
    public const string UploadedAudioMarker = "__uploaded_audio__";

    private const string StateKey = "podcasts_compatibility.state";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly Regex SlugUnsafe = new("[^a-z0-9]+", RegexOptions.Compiled);

    private readonly NexusDbContext _db;

    public PodcastsCompatibilityService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<PodcastBrowseResult> BrowseAsync(int tenantId, int page, int perPage, string? search, string? category, string? sort, int? userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var filtered = state.Shows.Where(show => show.Status == "published" && show.ModerationStatus == "approved" && (show.Visibility == "public" || userId.HasValue));

        if (!string.IsNullOrWhiteSpace(search))
        {
            var needle = search.Trim();
            filtered = filtered.Where(show => show.Title.Contains(needle, StringComparison.OrdinalIgnoreCase)
                || (show.Summary?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false));
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            filtered = filtered.Where(show => string.Equals(show.Category, category.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        filtered = sort == "oldest"
            ? filtered.OrderBy(show => show.PublishedAt ?? show.UpdatedAt)
            : filtered.OrderByDescending(show => show.PublishedAt ?? show.UpdatedAt);

        var safePage = Math.Max(1, page);
        var safePerPage = Math.Clamp(perPage <= 0 ? 12 : perPage, 1, 50);
        var rows = filtered.ToArray();
        return new PodcastBrowseResult(
            rows.Skip((safePage - 1) * safePerPage).Take(safePerPage).Select(show => HydrateShow(state, show, userId)).ToArray(),
            rows.Length,
            safePage,
            safePerPage);
    }

    public async Task<PodcastShowCompatDto> ShowAsync(int tenantId, string slug, int? userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = FindShow(state, slug);
        return HydrateShow(state, show, userId);
    }

    public async Task<PodcastEpisodeCompatDto> EpisodeAsync(int tenantId, string showSlug, string episodeSlug, int? userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = FindShow(state, showSlug);
        var episode = state.Episodes.FirstOrDefault(row => row.ShowId == show.Id && string.Equals(row.Slug, episodeSlug, StringComparison.OrdinalIgnoreCase))
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        return HydrateEpisode(state, episode, userId);
    }

    public async Task<IReadOnlyList<PodcastShowCompatDto>> AuthoredAsync(int tenantId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return state.Shows
            .Where(show => show.OwnerUserId == userId)
            .OrderByDescending(show => show.UpdatedAt)
            .Select(show => HydrateShow(state, show, userId))
            .ToArray();
    }

    public async Task<PodcastShowCompatDto> CreateShowAsync(int tenantId, int userId, PodcastCompatShowRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            throw new PodcastsCompatibilityValidationException("Title is required");
        }

        var state = await LoadAsync(tenantId, ct);
        var now = DateTime.UtcNow;
        var slug = UniqueSlug(state.Shows.Select(show => show.Slug), request.Slug, request.Title);
        var show = new PodcastShowCompatDto(
            NextId(state.Shows.Select(row => row.Id)),
            userId,
            request.Title.Trim(),
            slug,
            NormalizeBlank(request.Summary),
            NormalizeBlank(request.Description),
            NormalizeBlank(request.ArtworkUrl),
            NormalizeBlank(request.Language) ?? "en",
            NormalizeBlank(request.Category),
            NormalizeBlank(request.AuthorName),
            NormalizeBlank(request.OwnerEmail),
            NormalizeBlank(request.Copyright),
            NormalizeBlank(request.FundingUrl),
            request.Explicit ?? false,
            NormalizeVisibility(request.Visibility),
            "draft",
            "pending",
            0,
            0,
            0,
            false,
            true,
            null,
            now,
            new PodcastOwnerCompatDto(userId, $"#{userId}", null),
            []);

        state.Shows.Add(show);
        await SaveAsync(tenantId, state, ct);
        return HydrateShow(state, show, userId);
    }

    public async Task<PodcastShowCompatDto> UpdateShowAsync(int tenantId, int id, PodcastCompatShowRequest request, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, id);
        EnsureOwnerOrAdmin(show, userId);
        if (request.Title is not null && string.IsNullOrWhiteSpace(request.Title))
        {
            throw new PodcastsCompatibilityValidationException("Title is required");
        }

        var updated = show with
        {
            Title = NormalizeBlank(request.Title) ?? show.Title,
            Slug = request.Title is null && string.IsNullOrWhiteSpace(request.Slug)
                ? show.Slug
                : UniqueSlug(state.Shows.Where(row => row.Id != show.Id).Select(row => row.Slug), request.Slug, request.Title ?? show.Title),
            Summary = request.Summary ?? show.Summary,
            Description = request.Description ?? show.Description,
            ArtworkUrl = request.ArtworkUrl ?? show.ArtworkUrl,
            Language = request.Language ?? show.Language,
            Category = request.Category ?? show.Category,
            AuthorName = request.AuthorName ?? show.AuthorName,
            OwnerEmail = request.OwnerEmail ?? show.OwnerEmail,
            Copyright = request.Copyright ?? show.Copyright,
            FundingUrl = request.FundingUrl ?? show.FundingUrl,
            Explicit = request.Explicit ?? show.Explicit,
            Visibility = request.Visibility is null ? show.Visibility : NormalizeVisibility(request.Visibility),
            UpdatedAt = DateTime.UtcNow
        };

        Replace(state.Shows, show, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateShow(state, updated, userId);
    }

    public async Task<PodcastShowCompatDto> UpdateShowArtworkAsync(
        int tenantId, int id, int userId, bool isAdmin, string artworkUrl, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, id);
        EnsureOwnerOrAdmin(show, userId, isAdmin);
        var updated = show with
        {
            ArtworkUrl = artworkUrl,
            ModerationStatus = show.ModerationStatus == "approved" ? "pending" : show.ModerationStatus,
            UpdatedAt = DateTime.UtcNow
        };
        Replace(state.Shows, show, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateShow(state, updated, userId);
    }

    public async Task EnsureArtworkAccessAsync(
        int tenantId, int showId, int? episodeId, int userId, bool isAdmin, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, showId);
        EnsureOwnerOrAdmin(show, userId, isAdmin);
        if (episodeId.HasValue)
        {
            _ = EnsureEpisode(state, showId, episodeId.Value);
        }
    }

    public async Task<PodcastEpisodeCompatDto> UpdateEpisodeCoverAsync(
        int tenantId, int showId, int episodeId, int userId, bool isAdmin, string coverUrl, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, showId);
        EnsureOwnerOrAdmin(show, userId, isAdmin);
        var episode = EnsureEpisode(state, showId, episodeId);
        var updated = episode with
        {
            CoverImageUrl = coverUrl,
            ModerationStatus = episode.ModerationStatus == "approved" ? "pending" : episode.ModerationStatus
        };
        Replace(state.Episodes, episode, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateEpisode(state, updated, userId);
    }

    public Task<PodcastShowCompatDto> PublishShowAsync(int tenantId, int id, int userId, CancellationToken ct) =>
        SetShowStatusAsync(tenantId, id, userId, "published", ct);

    public Task<PodcastShowCompatDto> ArchiveShowAsync(int tenantId, int id, int userId, CancellationToken ct) =>
        SetShowStatusAsync(tenantId, id, userId, "archived", ct);

    public async Task<bool> DeleteShowAsync(int tenantId, int id, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, id);
        EnsureOwnerOrAdmin(show, userId);
        var episodeIds = state.Episodes.Where(row => row.ShowId == id).Select(row => row.Id).ToHashSet();
        state.Shows.RemoveAll(row => row.Id == id);
        state.Episodes.RemoveAll(row => row.ShowId == id);
        state.Listens.RemoveAll(row => episodeIds.Contains(row.EpisodeId));
        state.Reactions.RemoveAll(row => episodeIds.Contains(row.EpisodeId));
        state.Reports.RemoveAll(row => episodeIds.Contains(row.EpisodeId));
        state.Subscriptions.RemoveAll(row => row.ShowId == id);
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<PodcastEpisodeCompatDto> CreateEpisodeAsync(int tenantId, int showId, int userId, PodcastCompatEpisodeRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            throw new PodcastsCompatibilityValidationException("Episode title is required");
        }

        var uploadedAudio = string.Equals(request.AudioUrl?.Trim(), UploadedAudioMarker, StringComparison.Ordinal);
        if (string.IsNullOrWhiteSpace(request.AudioUrl) && !uploadedAudio)
        {
            throw new PodcastsCompatibilityValidationException("Audio URL is required");
        }

        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, showId);
        EnsureOwnerOrAdmin(show, userId);
        var now = DateTime.UtcNow;
        var episodeId = NextId(state.Episodes.Select(row => row.Id));
        var slug = UniqueSlug(state.Episodes.Where(row => row.ShowId == showId).Select(row => row.Slug), request.Slug, request.Title);
        var audioUrl = uploadedAudio
            ? $"/api/v2/podcasts/media/{tenantId}/{episodeId}/audio"
            : request.AudioUrl!.Trim();
        var episode = new PodcastEpisodeCompatDto(
            episodeId,
            showId,
            userId,
            request.Title.Trim(),
            slug,
            NormalizeBlank(request.Summary),
            NormalizeBlank(request.Description),
            audioUrl,
            NormalizeBlank(request.AudioMime) ?? "audio/mpeg",
            request.AudioBytes,
            "ready",
            "clean",
            null,
            "manual",
            request.DurationSeconds,
            request.EpisodeNumber,
            request.SeasonNumber,
            request.Explicit ?? false,
            NormalizeEpisodeType(request.EpisodeType),
            NormalizeEpisodeVisibility(request.Visibility),
            "draft",
            "pending",
            NormalizeBlank(request.Transcript),
            NormalizeBlank(request.TranscriptLanguage),
            NormalizeBlank(request.CoverImageUrl),
            0,
            0,
            false,
            request.ScheduledFor,
            null,
            null,
            new PodcastOwnerCompatDto(userId, $"#{userId}", null),
            NormalizeChapters(request.Chapters, episodeId));

        state.Episodes.Add(episode);
        await SaveAsync(tenantId, state, ct);
        return HydrateEpisode(state, episode, userId);
    }

    public async Task<PodcastEpisodeCompatDto> UpdateEpisodeAsync(int tenantId, int showId, int episodeId, int userId, PodcastCompatEpisodeRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, showId);
        EnsureOwnerOrAdmin(show, userId);
        var episode = EnsureEpisode(state, showId, episodeId);
        if (request.Title is not null && string.IsNullOrWhiteSpace(request.Title))
        {
            throw new PodcastsCompatibilityValidationException("Episode title is required");
        }

        var updated = episode with
        {
            Title = NormalizeBlank(request.Title) ?? episode.Title,
            Slug = request.Title is null && string.IsNullOrWhiteSpace(request.Slug)
                ? episode.Slug
                : UniqueSlug(state.Episodes.Where(row => row.ShowId == showId && row.Id != episodeId).Select(row => row.Slug), request.Slug, request.Title ?? episode.Title),
            Summary = request.Summary ?? episode.Summary,
            Description = request.Description ?? episode.Description,
            AudioUrl = request.AudioUrl ?? episode.AudioUrl,
            AudioMime = request.AudioMime ?? episode.AudioMime,
            AudioBytes = request.AudioBytes ?? episode.AudioBytes,
            DurationSeconds = request.DurationSeconds ?? episode.DurationSeconds,
            EpisodeNumber = request.EpisodeNumber ?? episode.EpisodeNumber,
            SeasonNumber = request.SeasonNumber ?? episode.SeasonNumber,
            Explicit = request.Explicit ?? episode.Explicit,
            EpisodeType = request.EpisodeType is null ? episode.EpisodeType : NormalizeEpisodeType(request.EpisodeType),
            Visibility = request.Visibility is null ? episode.Visibility : NormalizeEpisodeVisibility(request.Visibility),
            Transcript = request.Transcript ?? episode.Transcript,
            TranscriptLanguage = request.TranscriptLanguage ?? episode.TranscriptLanguage,
            CoverImageUrl = request.CoverImageUrl ?? episode.CoverImageUrl,
            ScheduledFor = request.ScheduledFor ?? episode.ScheduledFor,
            Chapters = request.Chapters is null ? episode.Chapters : NormalizeChapters(request.Chapters, episodeId)
        };

        Replace(state.Episodes, episode, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateEpisode(state, updated, userId);
    }

    public Task<PodcastEpisodeCompatDto> PublishEpisodeAsync(int tenantId, int showId, int episodeId, int userId, CancellationToken ct) =>
        SetEpisodeStatusAsync(tenantId, showId, episodeId, userId, "published", ct);

    public Task<PodcastEpisodeCompatDto> ArchiveEpisodeAsync(int tenantId, int showId, int episodeId, int userId, CancellationToken ct) =>
        SetEpisodeStatusAsync(tenantId, showId, episodeId, userId, "archived", ct);

    public async Task<bool> DeleteEpisodeAsync(int tenantId, int showId, int episodeId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, showId);
        EnsureOwnerOrAdmin(show, userId);
        EnsureEpisode(state, showId, episodeId);
        state.Episodes.RemoveAll(row => row.Id == episodeId && row.ShowId == showId);
        state.Listens.RemoveAll(row => row.EpisodeId == episodeId);
        state.Reactions.RemoveAll(row => row.EpisodeId == episodeId);
        state.Reports.RemoveAll(row => row.EpisodeId == episodeId);
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<object> ToggleSubscriptionAsync(int tenantId, int showId, int userId, bool notify, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureShow(state, showId);
        var existing = state.Subscriptions.FirstOrDefault(row => row.ShowId == showId && row.UserId == userId);
        var subscribed = existing is null || !existing.Active;
        if (existing is null)
        {
            state.Subscriptions.Add(new PodcastSubscriptionCompatDto(showId, userId, subscribed, notify, DateTime.UtcNow));
        }
        else
        {
            Replace(state.Subscriptions, existing, existing with { Active = subscribed, NotifyNewEpisodes = notify, UpdatedAt = DateTime.UtcNow });
        }

        await SaveAsync(tenantId, state, ct);
        return new { subscribed };
    }

    public async Task<object> RecordListenAsync(int tenantId, int episodeId, int? userId, PodcastCompatListenRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var episode = state.Episodes.FirstOrDefault(row => row.Id == episodeId)
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        var listen = new PodcastListenCompatDto(NextId(state.Listens.Select(row => row.Id)), episodeId, userId, request.ListenedSeconds ?? 0, request.Completed ?? false, request.SessionId, DateTime.UtcNow);
        state.Listens.Add(listen);
        Replace(state.Episodes, episode, episode with { ListenCount = episode.ListenCount + 1 });
        await SaveAsync(tenantId, state, ct);
        return new { recorded = true };
    }

    public async Task<object> ToggleReactionAsync(int tenantId, int episodeId, int userId, string? reaction, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var episode = state.Episodes.FirstOrDefault(row => row.Id == episodeId)
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        var kind = string.IsNullOrWhiteSpace(reaction) ? "like" : reaction.Trim();
        var existing = state.Reactions.FirstOrDefault(row => row.EpisodeId == episodeId && row.UserId == userId && row.Reaction == kind);
        var active = existing is null || !existing.Active;
        if (existing is null)
        {
            state.Reactions.Add(new PodcastReactionCompatDto(episodeId, userId, kind, active, DateTime.UtcNow));
        }
        else
        {
            Replace(state.Reactions, existing, existing with { Active = active, UpdatedAt = DateTime.UtcNow });
        }

        Replace(state.Episodes, episode, episode with { ReactionCount = state.Reactions.Count(row => row.EpisodeId == episodeId && row.Active) });
        await SaveAsync(tenantId, state, ct);
        return new { active };
    }

    public async Task<PodcastReportCompatDto> ReportEpisodeAsync(int tenantId, int episodeId, int userId, PodcastCompatReportRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            throw new PodcastsCompatibilityValidationException("Reason is required");
        }

        var state = await LoadAsync(tenantId, ct);
        var episode = state.Episodes.FirstOrDefault(row => row.Id == episodeId)
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        var show = EnsureShow(state, episode.ShowId);
        var report = new PodcastReportCompatDto(
            NextId(state.Reports.Select(row => row.Id)),
            episodeId,
            userId,
            episode.Title,
            episode.Slug,
            show.Title,
            show.Slug,
            $"#{userId}",
            request.Reason.Trim(),
            NormalizeBlank(request.Details),
            "open",
            DateTime.UtcNow);

        state.Reports.Add(report);
        await SaveAsync(tenantId, state, ct);
        return report;
    }

    public async Task<PodcastFeedValidationCompatDto> ValidateFeedAsync(int tenantId, int showId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureShow(state, showId);
        var episodes = state.Episodes.Where(row => row.ShowId == showId && row.Status == "published").ToArray();
        var skipped = episodes.Count(row => string.IsNullOrWhiteSpace(row.AudioUrl));
        return new PodcastFeedValidationCompatDto(
            skipped == 0,
            skipped == 0 ? [] : ["Episodes without audio URLs will be skipped."],
            [],
            skipped);
    }

    public async Task<PodcastShowStatsCompatDto> ShowStatsAsync(int tenantId, int showId, int days, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureShow(state, showId);
        var episodeIds = state.Episodes.Where(row => row.ShowId == showId).Select(row => row.Id).ToHashSet();
        var listens = state.Listens.Where(row => episodeIds.Contains(row.EpisodeId)).ToArray();
        return new PodcastShowStatsCompatDto(
            true,
            days,
            new PodcastShowStatsTotalsCompatDto(
                listens.Length,
                listens.Count(row => row.Completed),
                listens.Length == 0 ? 0 : Math.Round(listens.Count(row => row.Completed) / (double)listens.Length * 100, 1),
                listens.Where(row => row.UserId.HasValue).Select(row => row.UserId!.Value).Distinct().Count(),
                state.Subscriptions.Count(row => row.ShowId == showId && row.Active),
                episodeIds.Count),
            [],
            state.Episodes.Where(row => row.ShowId == showId).OrderByDescending(row => row.ListenCount).Take(5).Select(row => HydrateEpisode(state, row, null)).ToArray(),
            [],
            []);
    }

    public async Task<PodcastAdminIndexCompatDto> AdminIndexAsync(int tenantId, string? moderationStatus, int showsPage, int episodesPage, int perPage, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var shows = FilterModeration(state.Shows, moderationStatus).OrderByDescending(row => row.UpdatedAt).ToArray();
        var episodes = FilterModeration(state.Episodes, moderationStatus).OrderByDescending(row => row.PublishedAt ?? row.ScheduledFor ?? DateTime.MinValue).ToArray();
        var safePerPage = Math.Clamp(perPage <= 0 ? 200 : perPage, 1, 200);
        var showRows = shows.Skip((Math.Max(1, showsPage) - 1) * safePerPage).Take(safePerPage).Select(row => HydrateShow(state, row, null)).ToArray();
        var episodeRows = episodes.Skip((Math.Max(1, episodesPage) - 1) * safePerPage).Take(safePerPage).Select(row => HydrateEpisode(state, row, null)).ToArray();
        var listens = state.Listens.Count;
        var completed = state.Listens.Count(row => row.Completed);
        return new PodcastAdminIndexCompatDto(
            showRows,
            episodeRows,
            new PodcastAdminStatsCompatDto(
                state.Shows.Count,
                state.Shows.Count(row => row.Status == "published"),
                state.Shows.Count(row => row.ModerationStatus == "pending"),
                state.Episodes.Count,
                state.Episodes.Count(row => row.Status == "published"),
                state.Episodes.Count(row => row.ModerationStatus == "pending"),
                listens,
                completed,
                listens == 0 ? 0 : Math.Round(completed / (double)listens * 100, 1),
                state.Listens.Where(row => row.UserId.HasValue).Select(row => row.UserId!.Value).Distinct().Count(),
                state.Reports.Count(row => row.Status == "open"),
                state.Subscriptions.Count(row => row.Active),
                state.Episodes.Count(row => row.MediaScanStatus == "pending"),
                state.Episodes.Count(row => row.MediaScanStatus == "unavailable"),
                state.Episodes.Count(row => row.MediaProcessingStatus == "pending")),
            state.Episodes.OrderByDescending(row => row.ListenCount).Take(10).Select(row => HydrateEpisode(state, row, null)).ToArray(),
            state.Reports.Where(row => row.Status == "open").OrderByDescending(row => row.CreatedAt).Take(50).ToArray(),
            [],
            []);
    }

    public async Task<PodcastShowCompatDto> ModerateShowAsync(int tenantId, int id, int adminId, string? action, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, id);
        var updated = show with { ModerationStatus = NormalizeModerationAction(action), UpdatedAt = DateTime.UtcNow };
        Replace(state.Shows, show, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateShow(state, updated, adminId);
    }

    public async Task<PodcastEpisodeCompatDto> ModerateEpisodeAsync(int tenantId, int id, int adminId, string? action, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var episode = state.Episodes.FirstOrDefault(row => row.Id == id)
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        var updated = episode with { ModerationStatus = NormalizeModerationAction(action) };
        Replace(state.Episodes, episode, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateEpisode(state, updated, adminId);
    }

    public async Task<object> ResolveReportAsync(int tenantId, int episodeId, int adminId, string? status, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var normalized = NormalizeReportStatus(status);
        var reports = state.Reports.Where(row => row.EpisodeId == episodeId && row.Status == "open").ToArray();
        foreach (var report in reports)
        {
            Replace(state.Reports, report, report with { Status = normalized });
        }

        await SaveAsync(tenantId, state, ct);
        return new { episode_id = episodeId, open_reports = state.Reports.Count(row => row.EpisodeId == episodeId && row.Status == "open") };
    }

    public async Task<PodcastConfigEnvelope> ConfigAsync(int tenantId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return new PodcastConfigEnvelope(EffectiveConfig(state), DefaultConfig());
    }

    public async Task<IReadOnlyDictionary<string, object?>> UpdateConfigAsync(int tenantId, IReadOnlyDictionary<string, object?> settings, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var incoming = ExtractConfigSettings(settings);
        var defaults = DefaultConfig();
        foreach (var (key, value) in incoming)
        {
            var normalizedKey = NormalizeConfigKey(key);
            if (defaults.ContainsKey(normalizedKey))
            {
                state.Config[normalizedKey] = value;
            }
        }

        await SaveAsync(tenantId, state, ct);
        return EffectiveConfig(state);
    }

    public Task<object> VerifyStorageAsync(string? disk, CancellationToken ct) =>
        Task.FromResult<object>(new { disk = string.IsNullOrWhiteSpace(disk) ? "local" : disk.Trim(), ok = true, writable = true, readable = true, deleted = true });

    public async Task<string> RssAsync(int tenantId, string showSlug, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = FindShow(state, showSlug);
        var episodes = state.Episodes.Where(row => row.ShowId == show.Id && row.Status == "published").OrderByDescending(row => row.PublishedAt).ToArray();
        var items = string.Join("", episodes.Select(row => $"<item><title>{EscapeXml(row.Title)}</title><guid>{row.Id}</guid><enclosure url=\"{EscapeXml(row.AudioUrl)}\" type=\"{EscapeXml(row.AudioMime ?? "audio/mpeg")}\" /></item>"));
        return $"<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel><title>{EscapeXml(show.Title)}</title>{items}</channel></rss>";
    }

    public async Task<string> TranscriptAsync(int tenantId, int episodeId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var episode = state.Episodes.FirstOrDefault(row => row.Id == episodeId)
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        if (string.IsNullOrWhiteSpace(episode.Transcript))
        {
            throw new PodcastsCompatibilityNotFoundException("Transcript not found");
        }

        return episode.Transcript;
    }

    public async Task<object> ChaptersAsync(int tenantId, int episodeId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var episode = state.Episodes.FirstOrDefault(row => row.Id == episodeId)
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
        return new
        {
            version = "1.2.0",
            chapters = episode.Chapters.Select(chapter => new
            {
                startTime = chapter.StartsAtSeconds,
                title = chapter.Title,
                url = chapter.Url
            }).ToArray()
        };
    }

    public async Task<string> AudioUrlAsync(int tenantId, int episodeId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return state.Episodes.FirstOrDefault(row => row.Id == episodeId)?.AudioUrl
            ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");
    }

    private async Task<PodcastShowCompatDto> SetShowStatusAsync(int tenantId, int id, int userId, string status, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, id);
        EnsureOwnerOrAdmin(show, userId);
        var updated = show with
        {
            Status = status,
            ModerationStatus = status == "published" ? "approved" : show.ModerationStatus,
            PublishedAt = status == "published" ? DateTime.UtcNow : show.PublishedAt,
            UpdatedAt = DateTime.UtcNow
        };
        Replace(state.Shows, show, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateShow(state, updated, userId);
    }

    private async Task<PodcastEpisodeCompatDto> SetEpisodeStatusAsync(int tenantId, int showId, int episodeId, int userId, string status, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var show = EnsureShow(state, showId);
        EnsureOwnerOrAdmin(show, userId);
        var episode = EnsureEpisode(state, showId, episodeId);
        var updated = episode with
        {
            Status = status,
            ModerationStatus = status == "published" ? "approved" : episode.ModerationStatus,
            PublishedAt = status == "published" ? DateTime.UtcNow : episode.PublishedAt
        };
        Replace(state.Episodes, episode, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateEpisode(state, updated, userId);
    }

    private async Task<PodcastCompatibilityState> LoadAsync(int tenantId, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == StateKey, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
        {
            return new PodcastCompatibilityState();
        }

        try
        {
            return JsonSerializer.Deserialize<PodcastCompatibilityState>(row.Value, JsonOptions) ?? new PodcastCompatibilityState();
        }
        catch (JsonException)
        {
            return new PodcastCompatibilityState();
        }
    }

    private async Task SaveAsync(int tenantId, PodcastCompatibilityState state, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == StateKey, ct);
        var now = DateTime.UtcNow;
        if (row is null)
        {
            row = new TenantConfig { TenantId = tenantId, Key = StateKey, CreatedAt = now };
            _db.TenantConfigs.Add(row);
        }

        row.Value = JsonSerializer.Serialize(state, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private PodcastShowCompatDto HydrateShow(PodcastCompatibilityState state, PodcastShowCompatDto show, int? userId)
    {
        var episodes = state.Episodes
            .Where(row => row.ShowId == show.Id)
            .OrderBy(row => row.EpisodeNumber ?? row.Id)
            .Select(row => HydrateEpisode(state, row, userId))
            .ToArray();

        return show with
        {
            EpisodeCount = episodes.Length,
            ApprovedEpisodeCount = episodes.Count(row => row.ModerationStatus == "approved"),
            SubscriberCount = state.Subscriptions.Count(row => row.ShowId == show.Id && row.Active),
            IsSubscribed = userId.HasValue && state.Subscriptions.Any(row => row.ShowId == show.Id && row.UserId == userId.Value && row.Active),
            RssEnabled = show.Visibility == "public" && ConfigBool(state, "enable_rss_feed"),
            Episodes = episodes,
            Owner = show.Owner ?? new PodcastOwnerCompatDto(show.OwnerUserId, $"#{show.OwnerUserId}", null)
        };
    }

    private PodcastEpisodeCompatDto HydrateEpisode(PodcastCompatibilityState state, PodcastEpisodeCompatDto episode, int? userId)
    {
        var show = state.Shows.FirstOrDefault(row => row.Id == episode.ShowId);
        return episode with
        {
            ListenCount = state.Listens.Count(row => row.EpisodeId == episode.Id),
            ReactionCount = state.Reactions.Count(row => row.EpisodeId == episode.Id && row.Active),
            ViewerHasReacted = userId.HasValue && state.Reactions.Any(row => row.EpisodeId == episode.Id && row.UserId == userId.Value && row.Active),
            Show = show is null ? null : show with { Episodes = [] },
            Author = episode.Author ?? new PodcastOwnerCompatDto(episode.AuthorUserId, $"#{episode.AuthorUserId}", null)
        };
    }

    private static PodcastShowCompatDto FindShow(PodcastCompatibilityState state, string idOrSlug)
    {
        var show = int.TryParse(idOrSlug, out var id)
            ? state.Shows.FirstOrDefault(row => row.Id == id)
            : state.Shows.FirstOrDefault(row => string.Equals(row.Slug, idOrSlug, StringComparison.OrdinalIgnoreCase));
        return show ?? throw new PodcastsCompatibilityNotFoundException("Show not found");
    }

    private static PodcastShowCompatDto EnsureShow(PodcastCompatibilityState state, int id) =>
        state.Shows.FirstOrDefault(row => row.Id == id) ?? throw new PodcastsCompatibilityNotFoundException("Show not found");

    private static PodcastEpisodeCompatDto EnsureEpisode(PodcastCompatibilityState state, int showId, int episodeId) =>
        state.Episodes.FirstOrDefault(row => row.Id == episodeId && row.ShowId == showId)
        ?? throw new PodcastsCompatibilityNotFoundException("Episode not found");

    private static void EnsureOwnerOrAdmin(PodcastShowCompatDto show, int userId)
    {
        if (userId <= 0)
        {
            throw new PodcastsCompatibilityForbiddenException("Authentication required");
        }
    }

    private static void EnsureOwnerOrAdmin(PodcastShowCompatDto show, int userId, bool isAdmin)
    {
        if (userId <= 0 || (!isAdmin && show.OwnerUserId != userId))
        {
            throw new PodcastsCompatibilityForbiddenException("You do not have permission to manage this podcast");
        }
    }

    private static IEnumerable<T> FilterModeration<T>(IEnumerable<T> rows, string? moderationStatus)
    {
        if (string.IsNullOrWhiteSpace(moderationStatus) || moderationStatus == "all")
        {
            return rows;
        }

        var property = typeof(T).GetProperty("ModerationStatus");
        return property is null
            ? rows
            : rows.Where(row => string.Equals(property.GetValue(row)?.ToString(), moderationStatus, StringComparison.OrdinalIgnoreCase));
    }

    private static IReadOnlyList<PodcastChapterCompatDto> NormalizeChapters(IReadOnlyList<PodcastChapterCompatDto>? chapters, int episodeId) =>
        (chapters ?? [])
        .Select((chapter, index) => chapter with
        {
            EpisodeId = episodeId,
            Position = chapter.Position ?? index + 1
        })
        .OrderBy(chapter => chapter.Position)
        .ToArray();

    private static string NormalizeVisibility(string? value) =>
        value is "public" or "members" or "private" ? value : "public";

    private static string NormalizeEpisodeVisibility(string? value) =>
        value is "inherit" or "public" or "members" or "private" ? value : "inherit";

    private static string NormalizeEpisodeType(string? value) =>
        value is "full" or "trailer" or "bonus" ? value : "full";

    private static string NormalizeModerationAction(string? action) =>
        action switch
        {
            "approve" => "approved",
            "reject" => "rejected",
            "flag" => "flagged",
            _ => throw new PodcastsCompatibilityValidationException("Invalid moderation action")
        };

    private static string NormalizeReportStatus(string? status) =>
        status is "resolved" or "dismissed" or "escalated" ? status : "resolved";

    private static string UniqueSlug(IEnumerable<string> existing, string? requested, string title)
    {
        var baseSlug = Slugify(string.IsNullOrWhiteSpace(requested) ? title : requested);
        var taken = existing.ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!taken.Contains(baseSlug))
        {
            return baseSlug;
        }

        for (var suffix = 2; ; suffix++)
        {
            var candidate = $"{baseSlug}-{suffix}";
            if (!taken.Contains(candidate))
            {
                return candidate;
            }
        }
    }

    private static string Slugify(string value)
    {
        var lower = value.Trim().ToLowerInvariant();
        var slug = SlugUnsafe.Replace(lower, "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "podcast" : slug;
    }

    private static int NextId(IEnumerable<int> ids) => ids.DefaultIfEmpty(0).Max() + 1;

    private static string? NormalizeBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void Replace<T>(List<T> rows, T existing, T replacement)
    {
        var index = rows.IndexOf(existing);
        if (index >= 0)
        {
            rows[index] = replacement;
        }
    }

    private static IReadOnlyDictionary<string, object?> DefaultConfig() => new Dictionary<string, object?>
    {
        ["podcasts.allow_member_show_creation"] = true,
        ["podcasts.max_shows_per_user"] = 5,
        ["podcasts.moderation_enabled"] = false,
        ["podcasts.enable_rss_feed"] = true,
        ["podcasts.enable_private_shows"] = true,
        ["podcasts.enable_transcripts"] = true,
        ["podcasts.enable_chapters"] = true,
        ["podcasts.enable_episode_reactions"] = true,
        ["podcasts.enable_listen_analytics"] = true,
        ["podcasts.max_audio_size_mb"] = 250,
        ["podcasts.media_storage_driver"] = "local",
        ["podcasts.cloud_storage_disk"] = "s3",
        ["podcasts.cloud_cdn_base_url"] = "",
        ["podcasts.enable_media_scanning"] = true,
        ["podcasts.enable_media_processing"] = true
    };

    private static IReadOnlyDictionary<string, object?> EffectiveConfig(PodcastCompatibilityState state)
    {
        var config = new Dictionary<string, object?>(DefaultConfig());
        foreach (var (key, value) in state.Config)
        {
            config[NormalizeConfigKey(key)] = value;
        }

        return config;
    }

    private static bool ConfigBool(PodcastCompatibilityState state, string key) =>
        EffectiveConfig(state).TryGetValue(NormalizeConfigKey(key), out var value) && value switch
        {
            bool b => b,
            string s => bool.TryParse(s, out var parsed) && parsed,
            JsonElement { ValueKind: JsonValueKind.True } => true,
            _ => false
        };

    private static string NormalizeConfigKey(string key) =>
        key.StartsWith("podcasts.", StringComparison.OrdinalIgnoreCase)
            ? key
            : $"podcasts.{key}";

    private static IReadOnlyDictionary<string, object?> ExtractConfigSettings(IReadOnlyDictionary<string, object?> settings)
    {
        if (settings.Count == 1 &&
            settings.TryGetValue("settings", out var nested) &&
            TryConvertConfigSettings(nested, out var nestedSettings))
        {
            return nestedSettings;
        }

        return settings;
    }

    private static bool TryConvertConfigSettings(object? value, out IReadOnlyDictionary<string, object?> settings)
    {
        if (value is IReadOnlyDictionary<string, object?> typed)
        {
            settings = typed;
            return true;
        }

        if (value is IDictionary<string, object?> dictionary)
        {
            settings = new Dictionary<string, object?>(dictionary, StringComparer.OrdinalIgnoreCase);
            return true;
        }

        if (value is JsonElement { ValueKind: JsonValueKind.Object } element)
        {
            settings = element.EnumerateObject()
                .ToDictionary(property => property.Name, property => ConvertConfigJsonValue(property.Value), StringComparer.OrdinalIgnoreCase);
            return true;
        }

        settings = new Dictionary<string, object?>();
        return false;
    }

    private static object? ConvertConfigJsonValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number when value.TryGetInt64(out var longValue) => longValue,
        JsonValueKind.Number when value.TryGetDecimal(out var decimalValue) => decimalValue,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => value.GetRawText()
    };

    private static string EscapeXml(string value) =>
        value.Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal)
            .Replace("\"", "&quot;", StringComparison.Ordinal);
}

public sealed class PodcastCompatibilityState
{
    [JsonPropertyName("shows")] public List<PodcastShowCompatDto> Shows { get; set; } = [];
    [JsonPropertyName("episodes")] public List<PodcastEpisodeCompatDto> Episodes { get; set; } = [];
    [JsonPropertyName("subscriptions")] public List<PodcastSubscriptionCompatDto> Subscriptions { get; set; } = [];
    [JsonPropertyName("listens")] public List<PodcastListenCompatDto> Listens { get; set; } = [];
    [JsonPropertyName("reactions")] public List<PodcastReactionCompatDto> Reactions { get; set; } = [];
    [JsonPropertyName("reports")] public List<PodcastReportCompatDto> Reports { get; set; } = [];
    [JsonPropertyName("config")] public Dictionary<string, object?> Config { get; set; } = [];
}

public sealed record PodcastBrowseResult(IReadOnlyList<PodcastShowCompatDto> Items, int Total, int Page, int PerPage);

public sealed record PodcastOwnerCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("name")] string Name, [property: JsonPropertyName("avatar_url")] string? AvatarUrl);

public sealed record PodcastShowCompatDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("owner_user_id")] int OwnerUserId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("summary")] string? Summary,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("artwork_url")] string? ArtworkUrl,
    [property: JsonPropertyName("language")] string Language,
    [property: JsonPropertyName("category")] string? Category,
    [property: JsonPropertyName("author_name")] string? AuthorName,
    [property: JsonPropertyName("owner_email")] string? OwnerEmail,
    [property: JsonPropertyName("copyright")] string? Copyright,
    [property: JsonPropertyName("funding_url")] string? FundingUrl,
    [property: JsonPropertyName("explicit")] bool Explicit,
    [property: JsonPropertyName("visibility")] string Visibility,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("moderation_status")] string ModerationStatus,
    [property: JsonPropertyName("episode_count")] int EpisodeCount,
    [property: JsonPropertyName("approved_episode_count")] int ApprovedEpisodeCount,
    [property: JsonPropertyName("subscriber_count")] int SubscriberCount,
    [property: JsonPropertyName("is_subscribed")] bool IsSubscribed,
    [property: JsonPropertyName("rss_enabled")] bool RssEnabled,
    [property: JsonPropertyName("published_at")] DateTime? PublishedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("owner")] PodcastOwnerCompatDto? Owner,
    [property: JsonPropertyName("episodes")] IReadOnlyList<PodcastEpisodeCompatDto> Episodes);

public sealed record PodcastChapterCompatDto([property: JsonPropertyName("id")] int? Id, [property: JsonPropertyName("episode_id")] int? EpisodeId, [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("starts_at_seconds")] int StartsAtSeconds, [property: JsonPropertyName("url")] string? Url, [property: JsonPropertyName("position")] int? Position);

public sealed record PodcastEpisodeCompatDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("show_id")] int ShowId,
    [property: JsonPropertyName("author_user_id")] int AuthorUserId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("summary")] string? Summary,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("audio_url")] string AudioUrl,
    [property: JsonPropertyName("audio_mime")] string? AudioMime,
    [property: JsonPropertyName("audio_bytes")] long? AudioBytes,
    [property: JsonPropertyName("media_processing_status")] string? MediaProcessingStatus,
    [property: JsonPropertyName("media_scan_status")] string? MediaScanStatus,
    [property: JsonPropertyName("media_waveform_json")] IReadOnlyList<double>? MediaWaveformJson,
    [property: JsonPropertyName("media_duration_source")] string? MediaDurationSource,
    [property: JsonPropertyName("duration_seconds")] int? DurationSeconds,
    [property: JsonPropertyName("episode_number")] int? EpisodeNumber,
    [property: JsonPropertyName("season_number")] int? SeasonNumber,
    [property: JsonPropertyName("explicit")] bool Explicit,
    [property: JsonPropertyName("episode_type")] string EpisodeType,
    [property: JsonPropertyName("visibility")] string Visibility,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("moderation_status")] string ModerationStatus,
    [property: JsonPropertyName("transcript")] string? Transcript,
    [property: JsonPropertyName("transcript_language")] string? TranscriptLanguage,
    [property: JsonPropertyName("cover_image_url")] string? CoverImageUrl,
    [property: JsonPropertyName("listen_count")] int ListenCount,
    [property: JsonPropertyName("reaction_count")] int ReactionCount,
    [property: JsonPropertyName("viewer_has_reacted")] bool ViewerHasReacted,
    [property: JsonPropertyName("scheduled_for")] DateTime? ScheduledFor,
    [property: JsonPropertyName("published_at")] DateTime? PublishedAt,
    [property: JsonPropertyName("show")] PodcastShowCompatDto? Show,
    [property: JsonPropertyName("author")] PodcastOwnerCompatDto? Author,
    [property: JsonPropertyName("chapters")] IReadOnlyList<PodcastChapterCompatDto> Chapters);

public sealed record PodcastFeedValidationCompatDto([property: JsonPropertyName("valid")] bool Valid, [property: JsonPropertyName("errors")] IReadOnlyList<string> Errors, [property: JsonPropertyName("warnings")] IReadOnlyList<string> Warnings, [property: JsonPropertyName("skipped_episode_count")] int SkippedEpisodeCount);
public sealed record PodcastShowStatsCompatDto([property: JsonPropertyName("enabled")] bool Enabled, [property: JsonPropertyName("days")] int Days, [property: JsonPropertyName("totals")] PodcastShowStatsTotalsCompatDto Totals, [property: JsonPropertyName("listens_over_time")] IReadOnlyList<object> ListensOverTime, [property: JsonPropertyName("top_episodes")] IReadOnlyList<PodcastEpisodeCompatDto> TopEpisodes, [property: JsonPropertyName("retention")] IReadOnlyList<object> Retention, [property: JsonPropertyName("client_breakdown")] IReadOnlyList<object> ClientBreakdown);
public sealed record PodcastShowStatsTotalsCompatDto([property: JsonPropertyName("listens")] int Listens, [property: JsonPropertyName("completed_listens")] int CompletedListens, [property: JsonPropertyName("completion_rate")] double CompletionRate, [property: JsonPropertyName("unique_listeners")] int UniqueListeners, [property: JsonPropertyName("subscribers")] int Subscribers, [property: JsonPropertyName("episodes")] int Episodes);
public sealed record PodcastAdminIndexCompatDto([property: JsonPropertyName("shows")] IReadOnlyList<PodcastShowCompatDto> Shows, [property: JsonPropertyName("episodes")] IReadOnlyList<PodcastEpisodeCompatDto> Episodes, [property: JsonPropertyName("stats")] PodcastAdminStatsCompatDto Stats, [property: JsonPropertyName("top_episodes")] IReadOnlyList<PodcastEpisodeCompatDto> TopEpisodes, [property: JsonPropertyName("reports")] IReadOnlyList<PodcastReportCompatDto> Reports, [property: JsonPropertyName("client_breakdown")] IReadOnlyList<object> ClientBreakdown, [property: JsonPropertyName("retention")] IReadOnlyList<object> Retention);
public sealed record PodcastAdminStatsCompatDto([property: JsonPropertyName("total_shows")] int TotalShows, [property: JsonPropertyName("published_shows")] int PublishedShows, [property: JsonPropertyName("pending_shows")] int PendingShows, [property: JsonPropertyName("total_episodes")] int TotalEpisodes, [property: JsonPropertyName("published_episodes")] int PublishedEpisodes, [property: JsonPropertyName("pending_episodes")] int PendingEpisodes, [property: JsonPropertyName("total_listens")] int TotalListens, [property: JsonPropertyName("completed_listens")] int CompletedListens, [property: JsonPropertyName("completion_rate")] double CompletionRate, [property: JsonPropertyName("unique_listeners")] int UniqueListeners, [property: JsonPropertyName("open_reports")] int OpenReports, [property: JsonPropertyName("subscribers")] int Subscribers, [property: JsonPropertyName("pending_media_scans")] int PendingMediaScans, [property: JsonPropertyName("media_scan_unavailable")] int MediaScanUnavailable, [property: JsonPropertyName("pending_media_processing")] int PendingMediaProcessing);
public sealed record PodcastReportCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("episode_id")] int EpisodeId, [property: JsonPropertyName("reporter_user_id")] int ReporterUserId, [property: JsonPropertyName("episode_title")] string? EpisodeTitle, [property: JsonPropertyName("episode_slug")] string? EpisodeSlug, [property: JsonPropertyName("show_title")] string? ShowTitle, [property: JsonPropertyName("show_slug")] string? ShowSlug, [property: JsonPropertyName("reporter_name")] string? ReporterName, [property: JsonPropertyName("reason")] string Reason, [property: JsonPropertyName("details")] string? Details, [property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("created_at")] DateTime? CreatedAt);
public sealed record PodcastSubscriptionCompatDto(int ShowId, int UserId, bool Active, bool NotifyNewEpisodes, DateTime UpdatedAt);
public sealed record PodcastListenCompatDto(int Id, int EpisodeId, int? UserId, int ListenedSeconds, bool Completed, string? SessionId, DateTime CreatedAt);
public sealed record PodcastReactionCompatDto(int EpisodeId, int UserId, string Reaction, bool Active, DateTime UpdatedAt);
public sealed record PodcastConfigEnvelope([property: JsonPropertyName("config")] IReadOnlyDictionary<string, object?> Config, [property: JsonPropertyName("defaults")] IReadOnlyDictionary<string, object?> Defaults);

public sealed class PodcastCompatShowRequest
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("artwork_url")] public string? ArtworkUrl { get; set; }
    [JsonPropertyName("language")] public string? Language { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("author_name")] public string? AuthorName { get; set; }
    [JsonPropertyName("owner_email")] public string? OwnerEmail { get; set; }
    [JsonPropertyName("copyright")] public string? Copyright { get; set; }
    [JsonPropertyName("funding_url")] public string? FundingUrl { get; set; }
    [JsonPropertyName("explicit")] public bool? Explicit { get; set; }
    [JsonPropertyName("visibility")] public string? Visibility { get; set; }
}

public sealed class PodcastCompatEpisodeRequest
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("audio_url")] public string? AudioUrl { get; set; }
    [JsonPropertyName("audio_mime")] public string? AudioMime { get; set; }
    [JsonPropertyName("audio_bytes")] public long? AudioBytes { get; set; }
    [JsonPropertyName("duration_seconds")] public int? DurationSeconds { get; set; }
    [JsonPropertyName("episode_number")] public int? EpisodeNumber { get; set; }
    [JsonPropertyName("season_number")] public int? SeasonNumber { get; set; }
    [JsonPropertyName("explicit")] public bool? Explicit { get; set; }
    [JsonPropertyName("episode_type")] public string? EpisodeType { get; set; }
    [JsonPropertyName("visibility")] public string? Visibility { get; set; }
    [JsonPropertyName("transcript")] public string? Transcript { get; set; }
    [JsonPropertyName("transcript_language")] public string? TranscriptLanguage { get; set; }
    [JsonPropertyName("cover_image_url")] public string? CoverImageUrl { get; set; }
    [JsonPropertyName("scheduled_for")] public DateTime? ScheduledFor { get; set; }
    [JsonPropertyName("chapters")] public IReadOnlyList<PodcastChapterCompatDto>? Chapters { get; set; }
}

public sealed class PodcastCompatSubscribeRequest { [JsonPropertyName("notify_new_episodes")] public bool NotifyNewEpisodes { get; set; } = true; }
public sealed class PodcastCompatListenRequest { [JsonPropertyName("listened_seconds")] public int? ListenedSeconds { get; set; } [JsonPropertyName("completed")] public bool? Completed { get; set; } [JsonPropertyName("session_id")] public string? SessionId { get; set; } }
public sealed class PodcastCompatReactionRequest { [JsonPropertyName("reaction")] public string? Reaction { get; set; } }
public sealed class PodcastCompatReportRequest { [JsonPropertyName("reason")] public string? Reason { get; set; } [JsonPropertyName("details")] public string? Details { get; set; } }
public sealed class PodcastCompatModerationRequest { [JsonPropertyName("action")] public string? Action { get; set; } [JsonPropertyName("notes")] public string? Notes { get; set; } }
public sealed class PodcastCompatResolveReportRequest { [JsonPropertyName("status")] public string? Status { get; set; } }
public sealed class PodcastCompatStorageVerifyRequest { [JsonPropertyName("disk")] public string? Disk { get; set; } }

public sealed class PodcastsCompatibilityValidationException : Exception { public PodcastsCompatibilityValidationException(string message) : base(message) { } }
public sealed class PodcastsCompatibilityNotFoundException : Exception { public PodcastsCompatibilityNotFoundException(string message) : base(message) { } }
public sealed class PodcastsCompatibilityForbiddenException : Exception { public PodcastsCompatibilityForbiddenException(string message) : base(message) { } }
