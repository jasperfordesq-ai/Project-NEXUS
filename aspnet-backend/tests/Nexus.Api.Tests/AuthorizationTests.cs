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
/// Integration tests for authorization and ownership checks.
/// Verifies users can only modify their own resources.
/// </summary>
[Collection("Integration")]
public class AuthorizationTests : IntegrationTestBase
{
    public AuthorizationTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Listing Ownership Tests

    [Fact]
    public async Task UpdateListing_AsOwner_Succeeds()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/listings/{TestData.Listing1.Id}", new
        {
            title = "Updated Title",
            description = "Updated description",
            type = "offer",
            status = "active"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UpdateListing_AsNonOwner_ReturnsForbidden()
    {
        // Arrange - Member trying to update Admin's listing
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/listings/{TestData.Listing1.Id}", new
        {
            title = "Hacked Title",
            description = "Hacked description",
            type = "offer",
            status = "active"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task DeleteListing_AsOwner_Succeeds()
    {
        // Arrange - Create a listing to delete
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/listings", new
        {
            title = "To Be Deleted",
            description = "This will be deleted",
            type = "offer",
            estimated_hours = 1.0
        });

        var content = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var listingId = content.GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/listings/{listingId}");

        // Assert - DELETE returns NoContent (204) on success
        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task DeleteListing_AsNonOwner_ReturnsForbidden()
    {
        // Arrange - Member trying to delete Admin's listing
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync($"/api/listings/{TestData.Listing1.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region User Profile Tests

    [Fact]
    public async Task UpdateProfile_OwnProfile_Succeeds()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PatchAsJsonAsync("/api/users/me", new
        {
            first_name = "Updated",
            last_name = "Name"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetCurrentUser_ReturnsCorrectUser()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/users/me");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetProperty("email").GetString().Should().Be("member@test.com");
    }

    #endregion

    #region Protected Endpoints Without Auth

    [Fact]
    public async Task GetListings_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/listings");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetBalance_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/wallet/balance");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetUsers_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/users");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Public Endpoints

    [Fact]
    public async Task Health_WithoutAuth_Succeeds()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/health");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Login_WithoutAuth_Succeeds()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    #endregion
}
