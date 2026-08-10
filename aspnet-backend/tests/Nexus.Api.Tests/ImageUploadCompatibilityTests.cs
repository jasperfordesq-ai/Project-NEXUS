// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ImageUploadCompatibilityTests : IntegrationTestBase
{
    public ImageUploadCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task UploadAvatar_WithAvatarField_ReturnsDownloadUrlAndUserIncludesAvatarUrl()
    {
        await AuthenticateAsMemberAsync();

        using var form = CreateImageForm("avatar");
        var uploadResponse = await Client.PostAsync("/api/users/me/avatar", form);

        uploadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var uploadJson = await uploadResponse.Content.ReadFromJsonAsync<JsonElement>();
        var imageUrl = uploadJson.GetProperty("avatar_url").GetString();
        imageUrl.Should().StartWith("/api/files/");
        await AssertAnonymousImageDownloadSucceedsAsync(imageUrl!);

        var userResponse = await Client.GetAsync("/api/users/me");
        userResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var userJson = await userResponse.Content.ReadFromJsonAsync<JsonElement>();
        userJson.GetProperty("data").GetProperty("avatar_url").GetString().Should().Be(imageUrl);
    }

    [Fact]
    public async Task UploadListingImage_WithImageField_ReturnsDownloadUrlAndListingIncludesImageUrl()
    {
        await AuthenticateAsAdminAsync();

        using var form = CreateImageForm("image");
        var uploadResponse = await Client.PostAsync($"/api/listings/{TestData.Listing1.Id}/image", form);

        uploadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var uploadJson = await uploadResponse.Content.ReadFromJsonAsync<JsonElement>();
        var imageUrl = uploadJson.GetProperty("image_url").GetString();
        imageUrl.Should().StartWith("/api/files/");
        await AssertAnonymousImageDownloadSucceedsAsync(imageUrl!);

        var listingResponse = await Client.GetAsync($"/api/listings/{TestData.Listing1.Id}");
        listingResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var listingJson = await listingResponse.Content.ReadFromJsonAsync<JsonElement>();
        listingJson.GetProperty("image_url").GetString().Should().Be(imageUrl);
    }

    [Fact]
    public async Task UploadEventImage_WithImageField_PersistsDownloadUrl()
    {
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Image Upload Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createJson.GetProperty("event").GetProperty("id").GetInt32();

        using var form = CreateImageForm("image");
        var uploadResponse = await Client.PostAsync($"/api/events/{eventId}/image", form);

        uploadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var uploadJson = await uploadResponse.Content.ReadFromJsonAsync<JsonElement>();
        var imageUrl = uploadJson.GetProperty("image_url").GetString();
        imageUrl.Should().StartWith("/api/files/");
        await AssertAnonymousImageDownloadSucceedsAsync(imageUrl!);

        var eventResponse = await Client.GetAsync($"/api/events/{eventId}");
        eventResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var eventJson = await eventResponse.Content.ReadFromJsonAsync<JsonElement>();
        eventJson.GetProperty("event").GetProperty("image_url").GetString().Should().Be(imageUrl);
    }

    [Fact]
    public async Task UploadGroupImage_WithImageField_PersistsDownloadUrl()
    {
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/groups", new
        {
            name = "Image Upload Group",
            description = "A group used to test image upload compatibility."
        });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var groupId = createJson.GetProperty("group").GetProperty("id").GetInt32();

        using var form = CreateImageForm("image");
        var uploadResponse = await Client.PostAsync($"/api/groups/{groupId}/image", form);

        uploadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var uploadJson = await uploadResponse.Content.ReadFromJsonAsync<JsonElement>();
        var imageUrl = uploadJson.GetProperty("image_url").GetString();
        imageUrl.Should().StartWith("/api/files/");
        await AssertAnonymousImageDownloadSucceedsAsync(imageUrl!);

        var groupResponse = await Client.GetAsync($"/api/groups/{groupId}");
        groupResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var groupJson = await groupResponse.Content.ReadFromJsonAsync<JsonElement>();
        groupJson.GetProperty("group").GetProperty("image_url").GetString().Should().Be(imageUrl);
    }

    private static MultipartFormDataContent CreateImageForm(string fieldName)
    {
        var bytes = new byte[1024];
        bytes[0] = 0x89;
        bytes[1] = 0x50;
        bytes[2] = 0x4E;
        bytes[3] = 0x47;

        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(fileContent, fieldName, "image.png");
        return form;
    }

    private async Task AssertAnonymousImageDownloadSucceedsAsync(string imageUrl)
    {
        using var anonymousClient = Factory.CreateClient();
        var imageResponse = await anonymousClient.GetAsync(imageUrl);
        imageResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        imageResponse.Content.Headers.ContentType?.MediaType.Should().Be("image/png");
    }
}
