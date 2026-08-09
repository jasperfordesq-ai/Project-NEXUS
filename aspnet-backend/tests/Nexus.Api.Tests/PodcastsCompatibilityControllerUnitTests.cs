// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class PodcastsCompatibilityControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelReactPodcastRoutes()
    {
        var routes = typeof(PodcastsCompatibilityController)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .SelectMany(method => method.GetCustomAttributes<HttpMethodAttribute>()
                .SelectMany(attribute => attribute.HttpMethods.Select(http => $"{http} {attribute.Template}")))
            .ToArray();

        routes.Should().Contain([
            "GET api/v2/podcasts",
            "GET api/v2/podcasts/mine",
            "GET api/v2/podcasts/{id:int}/validate-feed",
            "GET api/v2/podcasts/{id:int}/stats",
            "GET api/v2/podcasts/{showSlug}",
            "GET api/v2/podcasts/{showSlug}/{episodeSlug}",
            "GET api/v2/podcasts/{showSlug}/feed.xml",
            "GET api/v2/podcasts/feed/{tenantId:int}/{showSlug}.xml",
            "GET api/v2/podcasts/media/{tenantId:int}/{episodeId:int}/audio",
            "GET api/v2/podcasts/transcripts/{tenantId:int}/{episodeId:int}.txt",
            "GET api/v2/podcasts/chapters/{tenantId:int}/{episodeId:int}.json",
            "POST api/v2/podcasts",
            "PUT api/v2/podcasts/{id:int}",
            "POST api/v2/podcasts/{id:int}/artwork",
            "POST api/v2/podcasts/{id:int}/publish",
            "POST api/v2/podcasts/{id:int}/archive",
            "DELETE api/v2/podcasts/{id:int}",
            "POST api/v2/podcasts/{showId:int}/subscribe",
            "POST api/v2/podcasts/{showId:int}/episodes",
            "PUT api/v2/podcasts/{showId:int}/episodes/{episodeId:int}",
            "POST api/v2/podcasts/{showId:int}/episodes/{episodeId:int}/cover",
            "POST api/v2/podcasts/{showId:int}/episodes/{episodeId:int}/publish",
            "POST api/v2/podcasts/{showId:int}/episodes/{episodeId:int}/archive",
            "DELETE api/v2/podcasts/{showId:int}/episodes/{episodeId:int}",
            "POST api/v2/podcasts/episodes/{episodeId:int}/listen",
            "POST api/v2/podcasts/episodes/{episodeId:int}/reaction",
            "POST api/v2/podcasts/episodes/{episodeId:int}/report",
            "GET api/v2/admin/config/podcasts",
            "PUT api/v2/admin/config/podcasts/bulk",
            "GET api/v2/admin/podcasts",
            "GET api/v2/admin/podcasts/shows/{id:int}/validate-feed",
            "POST api/v2/admin/podcasts/shows/{id:int}/moderate",
            "POST api/v2/admin/podcasts/episodes/{id:int}/moderate",
            "POST api/v2/admin/podcasts/reports/{episodeId:int}/resolve",
            "POST api/v2/admin/podcasts/storage/verify"
        ]);
    }

    [Fact]
    public async Task ReactPodcastWorkflow_ReturnsLaravelCompatibleEnvelopes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9001);

        var invalid = await controller.Store(new PodcastCompatShowRequest(), CancellationToken.None);
        invalid.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);

        var created = await controller.Store(new PodcastCompatShowRequest
        {
            Title = "Community Stories",
            Summary = "Audio from members",
            Language = "en",
            Category = "community",
            Visibility = "public"
        }, CancellationToken.None);

        var createdResult = created.Should().BeOfType<ObjectResult>().Subject;
        createdResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        int showId;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(createdResult.Value)))
        {
            var show = document.RootElement.GetProperty("data");
            showId = show.GetProperty("id").GetInt32();
            show.GetProperty("slug").GetString().Should().Be("community-stories");
            show.GetProperty("episode_count").GetInt32().Should().Be(0);
        }

        (await controller.Publish(showId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();

        var episode = await controller.StoreEpisode(showId, new PodcastCompatEpisodeRequest
        {
            Title = "First Episode",
            Summary = "Welcome",
            AudioUrl = "https://cdn.example.test/audio.mp3",
            DurationSeconds = 120,
            Transcript = "Hello",
            Chapters =
            [
                new PodcastChapterCompatDto(null, null, "Intro", 0, null, 1)
            ]
        }, CancellationToken.None);

        int episodeId;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(episode.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            var row = document.RootElement.GetProperty("data");
            episodeId = row.GetProperty("id").GetInt32();
            row.GetProperty("slug").GetString().Should().Be("first-episode");
            row.GetProperty("audio_url").GetString().Should().Be("https://cdn.example.test/audio.mp3");
        }

        (await controller.PublishEpisode(showId, episodeId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();

        var browse = await controller.Index(page: 1, perPage: 12, q: null, category: null, sort: null, CancellationToken.None);
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(browse.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            document.RootElement.GetProperty("data").EnumerateArray().Should().ContainSingle();
            document.RootElement.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(1);
        }

        var showResult = await controller.Show("community-stories", CancellationToken.None);
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(showResult.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            document.RootElement.GetProperty("data").GetProperty("episodes").EnumerateArray().Should().ContainSingle();
            document.RootElement.GetProperty("data").GetProperty("rss_enabled").GetBoolean().Should().BeTrue();
        }

        (await controller.Episode("community-stories", "first-episode", CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.Authored(CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.Subscribe(showId, new PodcastCompatSubscribeRequest { NotifyNewEpisodes = true }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.RecordListen(episodeId, new PodcastCompatListenRequest { Completed = true, ListenedSeconds = 120 }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.ToggleReaction(episodeId, new PodcastCompatReactionRequest { Reaction = "like" }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.ReportEpisode(episodeId, new PodcastCompatReportRequest { Reason = "spam", Details = "Noisy" }, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status201Created);
        (await controller.ValidateShowFeed(showId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.ShowStats(showId, 30, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.AdminIndex(null, 1, 1, 20, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.ModerateShow(showId, new PodcastCompatModerationRequest { Action = "approve" }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.ModerateEpisode(episodeId, new PodcastCompatModerationRequest { Action = "approve" }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.ResolveReport(episodeId, new PodcastCompatResolveReportRequest { Status = "resolved" }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.AdminPodcastConfig(CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.UpdateAdminPodcastConfig(new Dictionary<string, object?> { ["enable_rss_feed"] = true }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.VerifyStorage(new PodcastCompatStorageVerifyRequest { Disk = "local" }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();

        var chapters = await controller.Chapters(42, episodeId, CancellationToken.None);
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(chapters.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            document.RootElement.GetProperty("version").GetString().Should().Be("1.2.0");
            document.RootElement.GetProperty("chapters").EnumerateArray().Should().ContainSingle();
        }

        controller.Transcript(42, episodeId, CancellationToken.None).Should().BeOfType<ContentResult>()
            .Which.ContentType.Should().Be("text/plain; charset=UTF-8");
        controller.Rss("community-stories", CancellationToken.None).Should().BeOfType<ContentResult>()
            .Which.ContentType.Should().Be("application/rss+xml; charset=UTF-8");

        (await controller.ArchiveEpisode(showId, episodeId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.DestroyEpisode(showId, episodeId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.Archive(showId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.Destroy(showId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
    }

    private static PodcastsCompatibilityController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new PodcastsCompatibilityService(db);
        var files = new FileUploadService(
            db,
            new ConfigurationBuilder().AddInMemoryCollection().Build(),
            NullLogger<FileUploadService>.Instance);
        return new PodcastsCompatibilityController(service, tenant, files)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, role),
                    new Claim("role", role)
                ], "Test"))
            }
        };
    }
}
