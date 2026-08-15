// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Services;
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

    /// <summary>
    /// 🔴 The React client sends ONLY {email, password} and carries the community
    /// in the X-Tenant-ID header (react-frontend/src/types/api.ts:124-128;
    /// tokenManager.setTenantId). Laravel resolves the tenant from request
    /// context and never requires a body field. This backend demanded
    /// tenant_slug/tenant_id in the BODY and returned 400 to every browser
    /// sign-in — the login page showed "Sign-in failed. Please check your details
    /// and try again." and a member could not get in at all.
    ///
    /// Found by driving the real frontend against this backend, not by any
    /// contract test: the endpoint existed and answered, so route inventories
    /// reported it as present and working.
    /// </summary>
    [Theory]
    [InlineData("X-Tenant-ID", "1")]
    [InlineData("X-Tenant-Slug", "test-tenant")]
    public async Task Login_ResolvesTheTenantFromRequestHeaders_WhenTheBodyOmitsIt(
        string headerName, string headerValue)
    {
        var client = Factory.CreateClient();
        if (headerName == "X-Tenant-ID")
        {
            headerValue = TestData.Tenant1.Id.ToString();
        }
        client.DefaultRequestHeaders.Add(headerName, headerValue);

        var response = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "the browser identifies the community by header, not in the login body");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
    }

    /// <summary>With no tenant anywhere, the request is still refused.</summary>
    [Fact]
    public async Task Login_WithNoTenantInBodyOrHeaders_IsStillRejected()
    {
        var client = Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// An IMMEDIATE replay of a just-rotated token is a concurrent request, not
    /// theft — two tabs, or a queued request and its retry. Laravel answers 409
    /// AUTH_REFRESH_SUPERSEDED and leaves the token family intact
    /// (AuthController.php:724-730), and the React client relies on exactly that
    /// to keep its credentials (react-frontend/src/lib/api.ts:790-796).
    ///
    /// 🔴 This test asserted 401 until 2026-08-15. That pinned ASP.NET-only
    /// behaviour: the member was logged out of every tab for a harmless race.
    /// </summary>
    [Fact]
    public async Task Refresh_WithTokenRotatedByAConcurrentRequest_ReturnsSupersededAndKeepsTheFamily()
    {
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var loginContent = await loginResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = loginContent.GetProperty("refresh_token").GetString();

        var first = await Client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = refreshToken });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var successor = (await first.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("refresh_token").GetString();

        // Act — the loser of the race presents the now-rotated token.
        var response = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshToken
        });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("AUTH_REFRESH_SUPERSEDED");

        // The successor must still work — the family was not revoked.
        var stillAlive = await Client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = successor });
        stillAlive.StatusCode.Should().Be(HttpStatusCode.OK,
            "a concurrent-refresh race must not destroy the session");
    }

    /// <summary>
    /// Outside the grace window a replay really is a replay: revoke the whole
    /// family, as OAuth2 reuse detection requires.
    /// </summary>
    [Fact]
    public async Task Refresh_WithTokenReplayedAfterTheGraceWindow_RevokesTheFamily()
    {
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var loginContent = await loginResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = loginContent.GetProperty("refresh_token").GetString();

        var first = await Client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = refreshToken });
        var successor = (await first.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("refresh_token").GetString();

        // Age the rotation past the 5-second grace window.
        var stolenHash = TokenService.HashToken(refreshToken!);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var rotated = await db.RefreshTokens.IgnoreQueryFilters()
                .SingleAsync(t => t.TokenHash == stolenHash);
            rotated.RevokedAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }

        var response = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshToken
        });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Reuse detection revokes the family, so the successor dies too.
        var successorAfter = await Client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = successor });
        successorAfter.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "a genuine replay must revoke the whole token family");
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
