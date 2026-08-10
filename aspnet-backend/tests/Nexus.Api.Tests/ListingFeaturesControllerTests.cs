// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for the ListingFeaturesController.
/// Tests analytics, favorites, tags, featured, expiring, and renew.
/// </summary>
[Collection("Integration")]
public class ListingFeaturesControllerTests : IntegrationTestBase
{
    public ListingFeaturesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Auth Checks

    [Fact]
    public async Task TrackView_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.PostAsync($"/api/listings/{TestData.Listing1.Id}/view", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetFavorites_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/listings/favorites");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region View Tracking

    [Fact]
    public async Task TrackView_ValidListing_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsync($"/api/listings/{TestData.Listing1.Id}/view", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("message").GetString().Should().Be("View tracked.");
    }

    [Fact]
    public async Task TrackView_NonExistentListing_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsync("/api/listings/99999/view", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Analytics

    [Fact]
    public async Task GetAnalytics_AsOwner_ReturnsOk()
    {
        // Arrange - Listing1 is owned by admin
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync($"/api/listings/{TestData.Listing1.Id}/analytics");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("listing_id").GetInt32().Should().Be(TestData.Listing1.Id);
        content.TryGetProperty("view_count", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetAnalytics_NotOwner_ReturnsForbidden()
    {
        // Arrange - Listing1 is owned by admin, authenticate as member
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync($"/api/listings/{TestData.Listing1.Id}/analytics");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region Favorites

    [Fact]
    public async Task FavoriteListing_ValidListing_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsync($"/api/listings/{TestData.Listing1.Id}/favorite", null);

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetFavorites_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/listings/favorites");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task UnfavoriteListing_NotFavorited_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync($"/api/listings/{TestData.Listing1.Id}/favorite");

        // Assert
        // Could be NotFound if not previously favorited, or OK if it was
        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    #endregion

    #region Tags

    [Fact]
    public async Task AddTag_AsOwner_ReturnsCreated()
    {
        // Arrange - Listing1 is owned by admin
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/tags", new
        {
            tag = "gardening",
            tag_type = "skill"
        });

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
    }

    [Fact]
    public async Task AddTag_EmptyTag_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/tags", new
        {
            tag = "",
            tag_type = "skill"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Tag is required");
    }

    [Fact]
    public async Task AddTag_InvalidTagType_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/tags", new
        {
            tag = "cooking",
            tag_type = "invalid"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("skill");
    }

    [Fact]
    public async Task AddTag_NotOwner_ReturnsForbidden()
    {
        // Arrange - Listing1 is owned by admin, authenticate as member
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/tags", new
        {
            tag = "plumbing",
            tag_type = "skill"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region Featured & Expiring

    [Fact]
    public async Task GetFeatured_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/listings/featured");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task GetExpiring_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/listings/expiring?days=30");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    #endregion

    #region Renew

    [Fact]
    public async Task RenewListing_NotOwner_ReturnsNotFound()
    {
        // Arrange - Listing1 owned by admin, member tries to renew
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/renew", new
        {
            days_to_add = 30
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RenewListing_InvalidDays_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/renew", new
        {
            days_to_add = 400
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("between 1 and 365");
    }

    #endregion
}
