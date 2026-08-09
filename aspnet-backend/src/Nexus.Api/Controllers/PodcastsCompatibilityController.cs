// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
public sealed class PodcastsCompatibilityController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly PodcastsCompatibilityService _podcasts;
    private readonly TenantContext _tenant;
    private readonly FileUploadService _files;

    public PodcastsCompatibilityController(PodcastsCompatibilityService podcasts, TenantContext tenant, FileUploadService files)
    {
        _podcasts = podcasts;
        _tenant = tenant;
        _files = files;
    }

    [AllowAnonymous]
    [HttpGet("api/podcasts")]
    [HttpGet("api/v2/podcasts")]
    public async Task<IActionResult> Index(
        [FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int perPage = 12,
        [FromQuery] string? q = null,
        [FromQuery] string? category = null,
        [FromQuery] string? sort = null,
        CancellationToken ct = default)
    {
        var result = await _podcasts.BrowseAsync(_tenant.GetTenantIdOrThrow(), page, perPage, q, category, sort, OptionalUserId(), ct);
        var totalPages = result.PerPage <= 0 ? 0 : (int)Math.Ceiling(result.Total / (double)result.PerPage);
        return Ok(new
        {
            data = result.Items,
            meta = new
            {
                total = result.Total,
                current_page = result.Page,
                per_page = result.PerPage,
                has_more = result.Page < totalPages
            }
        });
    }

    [Authorize]
    [HttpGet("api/podcasts/mine")]
    [HttpGet("api/v2/podcasts/mine")]
    public Task<IActionResult> Authored(CancellationToken ct) =>
        RunAsync(() => _podcasts.AuthoredAsync(_tenant.GetTenantIdOrThrow(), UserId(), ct), meta: new { max_audio_size_mb = 500, allowed_audio_mimes = new[] { "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg" } });

    [Authorize]
    [HttpGet("api/podcasts/{id:int}/validate-feed")]
    [HttpGet("api/v2/podcasts/{id:int}/validate-feed")]
    public Task<IActionResult> ValidateShowFeed(int id, CancellationToken ct) =>
        RunAsync(() => _podcasts.ValidateFeedAsync(_tenant.GetTenantIdOrThrow(), id, ct));

    [Authorize]
    [HttpGet("api/podcasts/{id:int}/stats")]
    [HttpGet("api/v2/podcasts/{id:int}/stats")]
    public Task<IActionResult> ShowStats(int id, [FromQuery] int days = 30, CancellationToken ct = default) =>
        RunAsync(() => _podcasts.ShowStatsAsync(_tenant.GetTenantIdOrThrow(), id, Math.Clamp(days, 1, 365), ct));

    [AllowAnonymous]
    [HttpGet("api/podcasts/{showSlug}")]
    [HttpGet("api/v2/podcasts/{showSlug}")]
    public Task<IActionResult> Show(string showSlug, CancellationToken ct) =>
        RunAsync(() => _podcasts.ShowAsync(_tenant.GetTenantIdOrThrow(), showSlug, OptionalUserId(), ct));

    [AllowAnonymous]
    [HttpGet("api/podcasts/{showSlug}/{episodeSlug}")]
    [HttpGet("api/v2/podcasts/{showSlug}/{episodeSlug}")]
    public Task<IActionResult> Episode(string showSlug, string episodeSlug, CancellationToken ct) =>
        RunAsync(() => _podcasts.EpisodeAsync(_tenant.GetTenantIdOrThrow(), showSlug, episodeSlug, OptionalUserId(), ct));

    [AllowAnonymous]
    [HttpGet("api/podcasts/{showSlug}/feed.xml")]
    [HttpGet("api/v2/podcasts/{showSlug}/feed.xml")]
    public IActionResult Rss(string showSlug, CancellationToken ct)
    {
        try
        {
            var xml = _podcasts.RssAsync(_tenant.GetTenantIdOrThrow(), showSlug, ct).GetAwaiter().GetResult();
            return Content(xml, "application/rss+xml; charset=UTF-8");
        }
        catch (PodcastsCompatibilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    [AllowAnonymous]
    [HttpGet("api/podcasts/feed/{tenantId:int}/{showSlug}.xml")]
    [HttpGet("api/v2/podcasts/feed/{tenantId:int}/{showSlug}.xml")]
    public IActionResult RssForTenant(int tenantId, string showSlug, CancellationToken ct)
    {
        try
        {
            var xml = _podcasts.RssAsync(tenantId, showSlug, ct).GetAwaiter().GetResult();
            return Content(xml, "application/rss+xml; charset=UTF-8");
        }
        catch (PodcastsCompatibilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    [AllowAnonymous]
    [HttpGet("api/podcasts/media/{tenantId:int}/{episodeId:int}/audio")]
    [HttpGet("api/v2/podcasts/media/{tenantId:int}/{episodeId:int}/audio")]
    public async Task<IActionResult> Audio(int tenantId, int episodeId, CancellationToken ct)
    {
        try
        {
            return Redirect(await _podcasts.AudioUrlAsync(tenantId, episodeId, ct));
        }
        catch (PodcastsCompatibilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    [AllowAnonymous]
    [HttpGet("api/podcasts/transcripts/{tenantId:int}/{episodeId:int}.txt")]
    [HttpGet("api/v2/podcasts/transcripts/{tenantId:int}/{episodeId:int}.txt")]
    public IActionResult Transcript(int tenantId, int episodeId, CancellationToken ct)
    {
        try
        {
            var text = _podcasts.TranscriptAsync(tenantId, episodeId, ct).GetAwaiter().GetResult();
            return Content(text, "text/plain; charset=UTF-8");
        }
        catch (PodcastsCompatibilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    [AllowAnonymous]
    [HttpGet("api/podcasts/chapters/{tenantId:int}/{episodeId:int}.json")]
    [HttpGet("api/v2/podcasts/chapters/{tenantId:int}/{episodeId:int}.json")]
    public Task<IActionResult> Chapters(int tenantId, int episodeId, CancellationToken ct) =>
        RunAsync(() => _podcasts.ChaptersAsync(tenantId, episodeId, ct), envelope: false);

    [Authorize]
    [HttpPost("api/podcasts")]
    [HttpPost("api/v2/podcasts")]
    public Task<IActionResult> Store([FromBody] PodcastCompatShowRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.CreateShowAsync(_tenant.GetTenantIdOrThrow(), UserId(), request, ct), StatusCodes.Status201Created);

    [Authorize]
    [HttpPut("api/podcasts/{id:int}")]
    [HttpPut("api/v2/podcasts/{id:int}")]
    public Task<IActionResult> Update(int id, [FromBody] PodcastCompatShowRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.UpdateShowAsync(_tenant.GetTenantIdOrThrow(), id, request, UserId(), ct));

    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.PodcastArtworkPolicy)]
    [RequestSizeLimit(10 * 1024 * 1024)]
    [HttpPost("api/podcasts/{id:int}/artwork")]
    [HttpPost("api/v2/podcasts/{id:int}/artwork")]
    public async Task<IActionResult> UploadArtwork(int id, CancellationToken ct) =>
        await UploadImageAsync(await ReadImageAsync(ct), id, null, ct);

    [Authorize]
    [HttpPost("api/podcasts/{id:int}/publish")]
    [HttpPost("api/v2/podcasts/{id:int}/publish")]
    public Task<IActionResult> Publish(int id, CancellationToken ct) =>
        RunAsync(() => _podcasts.PublishShowAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct));

    [Authorize]
    [HttpPost("api/podcasts/{id:int}/archive")]
    [HttpPost("api/v2/podcasts/{id:int}/archive")]
    public Task<IActionResult> Archive(int id, CancellationToken ct) =>
        RunAsync(() => _podcasts.ArchiveShowAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct));

    [Authorize]
    [HttpDelete("api/podcasts/{id:int}")]
    [HttpDelete("api/v2/podcasts/{id:int}")]
    public Task<IActionResult> Destroy(int id, CancellationToken ct) =>
        RunAsync(async () => new { deleted = await _podcasts.DeleteShowAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct) });

    [Authorize]
    [HttpPost("api/podcasts/{showId:int}/subscribe")]
    [HttpPost("api/v2/podcasts/{showId:int}/subscribe")]
    public Task<IActionResult> Subscribe(int showId, [FromBody] PodcastCompatSubscribeRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.ToggleSubscriptionAsync(_tenant.GetTenantIdOrThrow(), showId, UserId(), request.NotifyNewEpisodes, ct));

    [Authorize]
    [HttpPost("api/podcasts/{showId:int}/episodes")]
    [HttpPost("api/v2/podcasts/{showId:int}/episodes")]
    public async Task<IActionResult> StoreEpisode(int showId, CancellationToken ct)
    {
        var request = await ReadEpisodeRequestAsync(ct);
        return await StoreEpisodeRequestAsync(showId, request, ct);
    }

    [NonAction]
    public Task<IActionResult> StoreEpisode(int showId, PodcastCompatEpisodeRequest request, CancellationToken ct) =>
        StoreEpisodeRequestAsync(showId, request, ct);

    [Authorize]
    [HttpPut("api/podcasts/{showId:int}/episodes/{episodeId:int}")]
    [HttpPut("api/v2/podcasts/{showId:int}/episodes/{episodeId:int}")]
    public Task<IActionResult> UpdateEpisode(int showId, int episodeId, [FromBody] PodcastCompatEpisodeRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.UpdateEpisodeAsync(_tenant.GetTenantIdOrThrow(), showId, episodeId, UserId(), request, ct));

    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.PodcastArtworkPolicy)]
    [RequestSizeLimit(10 * 1024 * 1024)]
    [HttpPost("api/podcasts/{showId:int}/episodes/{episodeId:int}/cover")]
    [HttpPost("api/v2/podcasts/{showId:int}/episodes/{episodeId:int}/cover")]
    public async Task<IActionResult> UploadEpisodeCover(int showId, int episodeId, CancellationToken ct) =>
        await UploadImageAsync(await ReadImageAsync(ct), showId, episodeId, ct);

    [Authorize]
    [HttpPost("api/podcasts/{showId:int}/episodes/{episodeId:int}/publish")]
    [HttpPost("api/v2/podcasts/{showId:int}/episodes/{episodeId:int}/publish")]
    public Task<IActionResult> PublishEpisode(int showId, int episodeId, CancellationToken ct) =>
        RunAsync(() => _podcasts.PublishEpisodeAsync(_tenant.GetTenantIdOrThrow(), showId, episodeId, UserId(), ct));

    [Authorize]
    [HttpPost("api/podcasts/{showId:int}/episodes/{episodeId:int}/archive")]
    [HttpPost("api/v2/podcasts/{showId:int}/episodes/{episodeId:int}/archive")]
    public Task<IActionResult> ArchiveEpisode(int showId, int episodeId, CancellationToken ct) =>
        RunAsync(() => _podcasts.ArchiveEpisodeAsync(_tenant.GetTenantIdOrThrow(), showId, episodeId, UserId(), ct));

    [Authorize]
    [HttpDelete("api/podcasts/{showId:int}/episodes/{episodeId:int}")]
    [HttpDelete("api/v2/podcasts/{showId:int}/episodes/{episodeId:int}")]
    public Task<IActionResult> DestroyEpisode(int showId, int episodeId, CancellationToken ct) =>
        RunAsync(async () => new { deleted = await _podcasts.DeleteEpisodeAsync(_tenant.GetTenantIdOrThrow(), showId, episodeId, UserId(), ct) });

    [AllowAnonymous]
    [HttpPost("api/podcasts/episodes/{episodeId:int}/listen")]
    [HttpPost("api/v2/podcasts/episodes/{episodeId:int}/listen")]
    public Task<IActionResult> RecordListen(int episodeId, [FromBody] PodcastCompatListenRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.RecordListenAsync(_tenant.GetTenantIdOrThrow(), episodeId, OptionalUserId(), request, ct));

    [Authorize]
    [HttpPost("api/podcasts/episodes/{episodeId:int}/reaction")]
    [HttpPost("api/v2/podcasts/episodes/{episodeId:int}/reaction")]
    public Task<IActionResult> ToggleReaction(int episodeId, [FromBody] PodcastCompatReactionRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.ToggleReactionAsync(_tenant.GetTenantIdOrThrow(), episodeId, UserId(), request.Reaction, ct));

    [Authorize]
    [HttpPost("api/podcasts/episodes/{episodeId:int}/report")]
    [HttpPost("api/v2/podcasts/episodes/{episodeId:int}/report")]
    public Task<IActionResult> ReportEpisode(int episodeId, [FromBody] PodcastCompatReportRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.ReportEpisodeAsync(_tenant.GetTenantIdOrThrow(), episodeId, UserId(), request, ct), StatusCodes.Status201Created);

    [Authorize(Policy = "AdminOnly")]
    [HttpGet("api/admin/config/podcasts")]
    [HttpGet("api/v2/admin/config/podcasts")]
    public Task<IActionResult> AdminPodcastConfig(CancellationToken ct) =>
        RunAsync(() => _podcasts.ConfigAsync(_tenant.GetTenantIdOrThrow(), ct), envelope: false);

    [Authorize(Policy = "AdminOnly")]
    [HttpPut("api/admin/config/podcasts/bulk")]
    [HttpPut("api/v2/admin/config/podcasts/bulk")]
    public Task<IActionResult> UpdateAdminPodcastConfig([FromBody] Dictionary<string, object?> settings, CancellationToken ct) =>
        RunAsync(() => _podcasts.UpdateConfigAsync(_tenant.GetTenantIdOrThrow(), settings, ct), dataProperty: "updated");

    [Authorize(Policy = "AdminOnly")]
    [HttpGet("api/admin/podcasts")]
    [HttpGet("api/v2/admin/podcasts")]
    public async Task<IActionResult> AdminIndex(
        [FromQuery(Name = "moderation_status")] string? moderationStatus,
        [FromQuery(Name = "shows_page")] int showsPage = 1,
        [FromQuery(Name = "episodes_page")] int episodesPage = 1,
        [FromQuery(Name = "per_page")] int perPage = 200,
        CancellationToken ct = default)
    {
        try
        {
            var data = await _podcasts.AdminIndexAsync(_tenant.GetTenantIdOrThrow(), moderationStatus, showsPage, episodesPage, perPage, ct);
            return Ok(new
            {
                success = true,
                data,
                meta = new
                {
                    shows_page = showsPage,
                    episodes_page = episodesPage,
                    per_page = perPage,
                    shows_total = data.Stats.TotalShows,
                    episodes_total = data.Stats.TotalEpisodes
                }
            });
        }
        catch (Exception ex) when (ex is PodcastsCompatibilityValidationException or PodcastsCompatibilityNotFoundException or PodcastsCompatibilityForbiddenException)
        {
            return ErrorResult(ex);
        }
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpGet("api/admin/podcasts/shows/{id:int}/validate-feed")]
    [HttpGet("api/v2/admin/podcasts/shows/{id:int}/validate-feed")]
    public Task<IActionResult> AdminValidateFeed(int id, CancellationToken ct) =>
        RunAsync(() => _podcasts.ValidateFeedAsync(_tenant.GetTenantIdOrThrow(), id, ct));

    [Authorize(Policy = "AdminOnly")]
    [HttpPost("api/admin/podcasts/shows/{id:int}/moderate")]
    [HttpPost("api/v2/admin/podcasts/shows/{id:int}/moderate")]
    public Task<IActionResult> ModerateShow(int id, [FromBody] PodcastCompatModerationRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.ModerateShowAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), request.Action, ct));

    [Authorize(Policy = "AdminOnly")]
    [HttpPost("api/admin/podcasts/episodes/{id:int}/moderate")]
    [HttpPost("api/v2/admin/podcasts/episodes/{id:int}/moderate")]
    public Task<IActionResult> ModerateEpisode(int id, [FromBody] PodcastCompatModerationRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.ModerateEpisodeAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), request.Action, ct));

    [Authorize(Policy = "AdminOnly")]
    [HttpPost("api/admin/podcasts/reports/{episodeId:int}/resolve")]
    [HttpPost("api/v2/admin/podcasts/reports/{episodeId:int}/resolve")]
    public Task<IActionResult> ResolveReport(int episodeId, [FromBody] PodcastCompatResolveReportRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.ResolveReportAsync(_tenant.GetTenantIdOrThrow(), episodeId, UserId(), request.Status, ct));

    [Authorize(Policy = "AdminOnly")]
    [HttpPost("api/admin/podcasts/storage/verify")]
    [HttpPost("api/v2/admin/podcasts/storage/verify")]
    public Task<IActionResult> VerifyStorage([FromBody] PodcastCompatStorageVerifyRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.VerifyStorageAsync(request.Disk, ct));

    private async Task<IActionResult> RunAsync<T>(
        Func<Task<T>> action,
        int successStatus = StatusCodes.Status200OK,
        object? meta = null,
        bool envelope = true,
        string dataProperty = "data")
    {
        try
        {
            var data = await action();
            object value;
            if (!envelope)
            {
                value = data!;
            }
            else if (dataProperty == "updated")
            {
                value = new { updated = data };
            }
            else
            {
                value = meta is null ? new { success = true, data } : new { success = true, data, meta };
            }

            return successStatus == StatusCodes.Status200OK
                ? Ok(value)
                : StatusCode(successStatus, value);
        }
        catch (Exception ex) when (ex is PodcastsCompatibilityValidationException or PodcastsCompatibilityNotFoundException or PodcastsCompatibilityForbiddenException)
        {
            return ErrorResult(ex);
        }
    }

    private async Task<IActionResult> UploadImageAsync(IFormFile? image, int showId, int? episodeId, CancellationToken ct)
    {
        if (image is null || image.Length <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelImageError("VALIDATION_FAILED", "No image uploaded"));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = UserId();
        try
        {
            await _podcasts.EnsureArtworkAccessAsync(tenantId, showId, episodeId, userId, IsAdmin(), ct);
        }
        catch (Exception ex) when (ex is PodcastsCompatibilityNotFoundException or PodcastsCompatibilityForbiddenException)
        {
            return ErrorResult(ex);
        }

        await using var stream = image.OpenReadStream();
        var (upload, error) = await _files.UploadAsync(
            stream, image.FileName, image.ContentType, image.Length,
            userId, tenantId, FileCategory.Podcast,
            episodeId ?? showId, episodeId.HasValue ? "podcast_episode" : "podcast_show", ct);

        if (error is not null || upload is null)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelImageError("VALIDATION_FAILED", error ?? "Image upload failed"));
        }

        try
        {
            var url = _files.GetDownloadUrl(upload);
            if (episodeId.HasValue)
            {
                await _podcasts.UpdateEpisodeCoverAsync(tenantId, showId, episodeId.Value, userId, IsAdmin(), url, ct);
            }
            else
            {
                await _podcasts.UpdateShowArtworkAsync(tenantId, showId, userId, IsAdmin(), url, ct);
            }

            return Ok(new { success = true, data = new { url } });
        }
        catch (Exception ex) when (ex is PodcastsCompatibilityValidationException or PodcastsCompatibilityNotFoundException or PodcastsCompatibilityForbiddenException)
        {
            await _files.DeleteAsync(upload.Id, userId);
            return ErrorResult(ex);
        }
        catch
        {
            await _files.DeleteAsync(upload.Id, userId);
            throw;
        }
    }

    private async Task<IFormFile?> ReadImageAsync(CancellationToken ct)
    {
        if (!Request.HasFormContentType)
        {
            return null;
        }

        var form = await Request.ReadFormAsync(ct);
        return form.Files.GetFile("image");
    }

    private IActionResult ErrorResult(Exception ex) =>
        ex switch
        {
            PodcastsCompatibilityValidationException => StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION_FAILED", ex.Message)),
            PodcastsCompatibilityForbiddenException => StatusCode(StatusCodes.Status403Forbidden, LaravelError("FORBIDDEN", ex.Message)),
            PodcastsCompatibilityNotFoundException => StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message)),
            _ => StatusCode(StatusCodes.Status500InternalServerError, LaravelError("SERVER_ERROR", ex.Message))
        };

    private int UserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("user_id");
        return int.TryParse(raw, out var id) ? id : 0;
    }

    private int? OptionalUserId()
    {
        var id = UserId();
        return id <= 0 ? null : id;
    }

    private bool IsAdmin() => User.IsInRole("admin") || User.HasClaim("role", "admin");

    private Task<IActionResult> StoreEpisodeRequestAsync(int showId, PodcastCompatEpisodeRequest request, CancellationToken ct) =>
        RunAsync(() => _podcasts.CreateEpisodeAsync(_tenant.GetTenantIdOrThrow(), showId, UserId(), request, ct), StatusCodes.Status201Created);

    private async Task<PodcastCompatEpisodeRequest> ReadEpisodeRequestAsync(CancellationToken ct)
    {
        if (Request.HasFormContentType)
        {
            return await ReadEpisodeFormRequestAsync(ct);
        }

        if (Request.ContentLength is 0 or null)
        {
            return new PodcastCompatEpisodeRequest();
        }

        return await JsonSerializer.DeserializeAsync<PodcastCompatEpisodeRequest>(Request.Body, JsonOptions, ct)
            ?? new PodcastCompatEpisodeRequest();
    }

    private async Task<PodcastCompatEpisodeRequest> ReadEpisodeFormRequestAsync(CancellationToken ct)
    {
        var form = await Request.ReadFormAsync(ct);
        var audio = form.Files.GetFile("audio") ?? form.Files.GetFile("file");
        var audioUrl = FormValue(form, "audio_url");

        return new PodcastCompatEpisodeRequest
        {
            Title = FormValue(form, "title"),
            Slug = FormValue(form, "slug"),
            Summary = FormValue(form, "summary"),
            Description = FormValue(form, "description"),
            AudioUrl = audio is null ? audioUrl : PodcastsCompatibilityService.UploadedAudioMarker,
            AudioMime = audio?.ContentType ?? FormValue(form, "audio_mime"),
            AudioBytes = audio?.Length ?? ParseLong(FormValue(form, "audio_bytes")),
            DurationSeconds = ParseInt(FormValue(form, "duration_seconds")),
            EpisodeNumber = ParseInt(FormValue(form, "episode_number")),
            SeasonNumber = ParseInt(FormValue(form, "season_number")),
            Explicit = ParseBool(FormValue(form, "explicit")),
            EpisodeType = FormValue(form, "episode_type"),
            Visibility = FormValue(form, "visibility"),
            Transcript = FormValue(form, "transcript"),
            TranscriptLanguage = FormValue(form, "transcript_language"),
            CoverImageUrl = FormValue(form, "cover_image_url"),
            ScheduledFor = ParseDateTime(FormValue(form, "scheduled_for")),
            Chapters = ParseChapters(FormValue(form, "chapters"))
        };
    }

    private static string? FormValue(IFormCollection form, string key)
    {
        var value = form[key].ToString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static int? ParseInt(string? value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    private static long? ParseLong(string? value) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    private static bool? ParseBool(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (bool.TryParse(value, out var parsed))
        {
            return parsed;
        }

        return value.Trim() switch
        {
            "1" => true,
            "0" => false,
            _ => null
        };
    }

    private static DateTime? ParseDateTime(string? value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : null;

    private static IReadOnlyList<PodcastChapterCompatDto>? ParseChapters(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<List<PodcastChapterCompatDto>>(value, JsonOptions);
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static object LaravelError(string code, string message) => new
    {
        errors = new[]
        {
            new { code, message }
        }
    };

    private static object LaravelImageError(string code, string message) => new
    {
        errors = new[]
        {
            new { code, message, field = "image" }
        }
    };
}
