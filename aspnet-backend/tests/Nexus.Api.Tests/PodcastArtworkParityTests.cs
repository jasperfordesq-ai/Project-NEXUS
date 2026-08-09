// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class PodcastArtworkParityTests : IntegrationTestBase
{
    public PodcastArtworkParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Uploads_PersistPlatformUrlsAndResetApprovedModeration()
    {
        await AuthenticateAsAdminAsync();
        var show = await CreateShowAsync();
        var showId = show.GetProperty("id").GetInt32();
        (await Client.PostAsJsonAsync($"/api/v2/podcasts/{showId}/publish", new { })).EnsureSuccessStatusCode();

        var artwork = await UploadAsync($"/api/v2/podcasts/{showId}/artwork", "artwork.png");
        artwork.StatusCode.Should().Be(HttpStatusCode.OK);
        var artworkUrl = (await artwork.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("url").GetString();
        artworkUrl.Should().MatchRegex("^/api/files/[0-9]+/download$");

        var episodeResponse = await Client.PostAsJsonAsync($"/api/v2/podcasts/{showId}/episodes", new
        {
            title = "Artwork episode",
            audio_url = "https://cdn.example.test/artwork.mp3"
        });
        episodeResponse.EnsureSuccessStatusCode();
        var episodeId = (await episodeResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32();
        (await Client.PostAsJsonAsync($"/api/v2/podcasts/{showId}/episodes/{episodeId}/publish", new { })).EnsureSuccessStatusCode();

        var cover = await UploadAsync($"/api/v2/podcasts/{showId}/episodes/{episodeId}/cover", "cover.webp", "image/webp");
        cover.StatusCode.Should().Be(HttpStatusCode.OK);
        var coverUrl = (await cover.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("url").GetString();

        var mine = await Client.GetFromJsonAsync<JsonElement>("/api/v2/podcasts/mine");
        var persisted = mine.GetProperty("data").EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == showId);
        persisted.GetProperty("artwork_url").GetString().Should().Be(artworkUrl);
        persisted.GetProperty("moderation_status").GetString().Should().Be("pending");
        var episode = persisted.GetProperty("episodes").EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == episodeId);
        episode.GetProperty("cover_image_url").GetString().Should().Be(coverUrl);
        episode.GetProperty("moderation_status").GetString().Should().Be("pending");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.FileUploads.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant1.Id && x.Category == FileCategory.Podcast)).Should().Be(2);
    }

    [Fact]
    public async Task Uploads_RejectMissingInvalidForeignAndCrossTenantImagesWithoutLeakingFiles()
    {
        await AuthenticateAsAdminAsync();
        var showId = (await CreateShowAsync()).GetProperty("id").GetInt32();

        using (var missing = new MultipartFormDataContent())
        {
            missing.Add(new StringContent("podcast"), "context");
            (await Client.PostAsync($"/api/v2/podcasts/{showId}/artwork", missing)).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        }

        (await UploadAsync($"/api/v2/podcasts/{showId}/artwork", "payload.txt", "text/plain"))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        await AuthenticateAsMemberAsync();
        (await UploadAsync($"/api/v2/podcasts/{showId}/artwork", "foreign.png"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsOtherTenantUserAsync();
        (await UploadAsync($"/api/v2/podcasts/{showId}/artwork", "cross-tenant.png"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.FileUploads.IgnoreQueryFilters().CountAsync(x => x.Category == FileCategory.Podcast)).Should().Be(0);
    }

    private async Task<JsonElement> CreateShowAsync()
    {
        var response = await Client.PostAsJsonAsync("/api/v2/podcasts", new { title = $"Artwork {Guid.NewGuid():N}" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private async Task<HttpResponseMessage> UploadAsync(string path, string fileName, string contentType = "image/png")
    {
        using var form = new MultipartFormDataContent();
        var image = new ByteArrayContent([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
        image.Headers.ContentType = new(contentType);
        form.Add(image, "image", fileName);
        return await Client.PostAsync(path, form);
    }
}
