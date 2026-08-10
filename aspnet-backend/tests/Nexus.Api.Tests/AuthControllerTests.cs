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
/// Integration tests for authentication endpoints.
/// Tests login, logout, refresh, register, and password reset flows.
/// </summary>
[Collection("Integration")]
public class AuthControllerTests : IntegrationTestBase
{
    public AuthControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Login Tests

    [Fact]
    public async Task Login_WithValidCredentials_ReturnsTokens()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("refresh_token").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("token_type").GetString().Should().Be("Bearer");
        content.GetProperty("user").GetProperty("email").GetString().Should().Be("admin@test.com");
    }

    [Fact]
    public async Task Login_WithInvalidPassword_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = "WrongPassword",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Login_WithInvalidTenant_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "nonexistent-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Login_WithMissingFields_ReturnsBadRequest()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com"
            // Missing password and tenant
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Register_V2Alias_WithInvalidPayload_ReturnsValidationNotNotFound()
    {
        ClearAuthToken();

        var response = await Client.PostAsJsonAsync("/api/v2/auth/register", new
        {
            email = "",
            password = "",
            tenant_slug = "test-tenant"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Login_UserFromDifferentTenant_ReturnsUnauthorized()
    {
        // Attempt to login as admin@test.com but with other-tenant
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "other-tenant"
        });

        // Assert - User doesn't exist in other-tenant
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Token Refresh Tests

    [Fact]
    public async Task Refresh_WithValidToken_ReturnsNewTokens()
    {
        // Arrange - Login first to get a refresh token
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var loginContent = await loginResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = loginContent.GetProperty("refresh_token").GetString();

        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshToken
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("refresh_token").GetString().Should().NotBeNullOrEmpty();
        // New refresh token should be different (rotation)
        content.GetProperty("refresh_token").GetString().Should().NotBe(refreshToken);
    }

    [Fact]
    public async Task Refresh_WithInvalidToken_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = "invalid-token"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Refresh_WithUsedToken_ReturnsUnauthorized()
    {
        // Arrange - Login and use refresh token once
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var loginContent = await loginResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = loginContent.GetProperty("refresh_token").GetString();

        // Use the refresh token once
        await Client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = refreshToken });

        // Act - Try to use the same token again
        var response = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshToken
        });

        // Assert - Token should be revoked after first use (rotation)
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Logout Tests

    [Fact]
    public async Task Logout_WithValidToken_RevokesRefreshToken()
    {
        // Arrange
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var loginContent = await loginResponse.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = loginContent.GetProperty("access_token").GetString();
        var refreshToken = loginContent.GetProperty("refresh_token").GetString();

        SetAuthToken(accessToken!);

        // Act
        var logoutResponse = await Client.PostAsJsonAsync("/api/auth/logout", new
        {
            refresh_token = refreshToken
        });

        // Assert
        logoutResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // Try to use the refresh token after logout
        ClearAuthToken();
        var refreshResponse = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshToken
        });

        refreshResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Register Tests

    [Fact]
    public async Task Register_WithValidData_CreatesUserAndReturnsTokens()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "newuser@test.com",
            password = "NewPassword123!",
            first_name = "New",
            last_name = "User",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("user").GetProperty("email").GetString().Should().Be("newuser@test.com");
        content.GetProperty("user").GetProperty("role").GetString().Should().Be("member");
    }

    [Fact]
    public async Task Register_WithExistingEmail_ReturnsConflict()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "admin@test.com", // Already exists
            password = "NewPassword123!",
            first_name = "Duplicate",
            last_name = "User",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Register_WithShortPassword_ReturnsBadRequest()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "short@test.com",
            password = "short", // Less than 8 characters
            first_name = "Short",
            last_name = "Password",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Validate Token Tests

    [Fact]
    public async Task Validate_WithValidToken_ReturnsUserInfo()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/auth/validate");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("valid").GetBoolean().Should().BeTrue();
        content.GetProperty("email").GetString().Should().Be("admin@test.com");
        content.GetProperty("role").GetString().Should().Be("admin");
    }

    [Fact]
    public async Task Validate_WithoutToken_ReturnsUnauthorized()
    {
        // Act
        ClearAuthToken();
        var response = await Client.GetAsync("/api/auth/validate");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion
}
