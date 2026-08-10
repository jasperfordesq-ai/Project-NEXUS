// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Fido2NetLib;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for passkey/WebAuthn endpoints.
/// Note: Full registration/authentication flows require actual browser WebAuthn API
/// interaction, so these tests focus on endpoint availability, auth requirements,
/// error handling, and management operations.
/// </summary>
[Collection("Integration")]
public class PasskeysControllerTests : IntegrationTestBase
{
    public PasskeysControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Registration Endpoint Tests

    [Fact]
    public async Task BeginRegistration_WithoutAuth_ReturnsUnauthorized()
    {
        // Act - no auth header
        var response = await Client.PostAsync("/api/passkeys/register/begin", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task BeginRegistration_WithAuth_ReturnsCreationOptions()
    {
        // Arrange
        var token = await GetAuthTokenAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/passkeys/register/begin");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        // Act
        var response = await Client.SendAsync(request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        // Should return WebAuthn creation options
        content.GetProperty("rp").GetProperty("name").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("user").GetProperty("name").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("challenge").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("pubKeyCredParams").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task FinishRegistration_WithoutBegin_ReturnsBadRequest()
    {
        // Arrange
        var token = await GetAuthTokenAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/passkeys/register/finish");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(new
        {
            attestation_response = new { id = "fake", rawId = "fake", response = new { clientDataJSON = "fake", attestationObject = "fake" }, type = "public-key" },
            display_name = "Test Passkey"
        });

        // Act
        var response = await Client.SendAsync(request);

        // Assert - should fail because no begin was called first
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CanonicalRegistration_RequiresAuth_ReturnsRealChallenge_AndConsumesEveryAttempt()
    {
        ClearAuthToken();
        using (var anonymousRequest = new HttpRequestMessage(
                   HttpMethod.Post,
                   "/api/webauthn/register-challenge"))
        {
            anonymousRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
            using var anonymousResponse = await Client.SendAsync(anonymousRequest);
            anonymousResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        SetAuthToken(await GetAuthTokenAsync());
        using (var unconfirmed = await Client.PostAsync("/api/webauthn/register-challenge", content: null))
        {
            unconfirmed.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            var error = await unconfirmed.Content.ReadFromJsonAsync<JsonElement>();
            error.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("SECURITY_CONFIRMATION_REQUIRED");
        }
        using (var rejected = await Client.PostAsJsonAsync("/api/webauthn/security-confirm", new
               {
                   current_password = "not-the-password"
               }))
        {
            rejected.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            rejected.Headers.CacheControl?.NoStore.Should().BeTrue();
        }
        var securityToken = await ConfirmSecurityAsync();
        using var challengeResponse = await Client.PostAsJsonAsync(
            "/api/webauthn/register-challenge",
            new { security_confirmation_token = securityToken });

        challengeResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await challengeResponse.Content.ReadFromJsonAsync<JsonElement>();
        var data = payload.GetProperty("data");
        data.GetProperty("challenge").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("challenge_id").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("rp").GetProperty("id").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("user").GetProperty("id").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("pubKeyCredParams").GetArrayLength().Should().BeGreaterThan(0);
        data.TryGetProperty("use", out _).Should().BeFalse("the V15 fake challenge owner was removed");

        var challengeId = data.GetProperty("challenge_id").GetString()!;
        var invalidCredential = new
        {
            challenge_id = challengeId,
            id = "ZmFrZQ",
            rawId = "ZmFrZQ",
            type = "public-key",
            response = new
            {
                clientDataJSON = "ZmFrZQ",
                attestationObject = "ZmFrZQ",
                transports = Array.Empty<string>()
            },
            device_name = "Test device",
            security_confirmation_token = securityToken
        };

        using var firstVerify = await Client.PostAsJsonAsync(
            "/api/webauthn/register-verify",
            invalidCredential);
        firstVerify.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var replay = await Client.PostAsJsonAsync(
            "/api/webauthn/register-verify",
            invalidCredential);
        replay.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var replayPayload = await replay.Content.ReadFromJsonAsync<JsonElement>();
        replayPayload.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("AUTH_WEBAUTHN_CHALLENGE_EXPIRED");
    }

    #endregion

    #region Authentication Endpoint Tests

    [Fact]
    public async Task BeginAuthentication_WithoutParams_ReturnsOptions()
    {
        // Act - empty body for conditional/discoverable flow
        var response = await Client.PostAsJsonAsync("/api/passkeys/authenticate/begin", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("session_id").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("options").GetProperty("challenge").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task BeginAuthentication_WithTenantSlug_ReturnsOptions()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/passkeys/authenticate/begin", new
        {
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("session_id").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task FinishAuthentication_WithInvalidSession_ReturnsBadRequest()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/passkeys/authenticate/finish", new
        {
            session_id = "invalid-session-id",
            assertion_response = new { id = "fake", rawId = "fake", response = new { clientDataJSON = "fake", authenticatorData = "fake", signature = "fake" }, type = "public-key" }
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CanonicalAuthenticationRoutes_UseRealSingleUseFidoChallenge()
    {
        var challengeResponse = await Client.PostAsJsonAsync("/api/webauthn/auth-challenge", new
        {
            email = TestData.AdminUser.Email
        });

        var challengeBody = await challengeResponse.Content.ReadAsStringAsync();
        challengeResponse.StatusCode.Should().Be(HttpStatusCode.OK, "response body was {0}", challengeBody);
        var payload = await challengeResponse.Content.ReadFromJsonAsync<JsonElement>();
        var data = payload.GetProperty("data");
        var challenge = data.GetProperty("challenge").GetString();
        challenge.Should().NotBeNullOrWhiteSpace();
        data.GetProperty("rpId").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("timeout").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("userVerification").GetString().Should().Be("preferred");
        var challengeId = data.GetProperty("challenge_id").GetString();
        challengeId.Should().NotBeNullOrWhiteSpace();

        var invalidAssertion = new
        {
            challenge_id = challengeId,
            id = "ZmFrZQ",
            rawId = "ZmFrZQ",
            type = "public-key",
            response = new
            {
                clientDataJSON = "ZmFrZQ",
                authenticatorData = "ZmFrZQ",
                signature = "ZmFrZQ",
                userHandle = (string?)null
            }
        };
        var firstVerify = await Client.PostAsJsonAsync("/api/webauthn/auth-verify", invalidAssertion);
        firstVerify.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized);
        var firstPayload = await firstVerify.Content.ReadFromJsonAsync<JsonElement>();
        firstPayload.GetProperty("success").GetBoolean().Should().BeFalse();
        firstPayload.GetProperty("errors").GetArrayLength().Should().Be(1);

        var replay = await Client.PostAsJsonAsync("/api/webauthn/auth-verify", invalidAssertion);
        replay.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var replayPayload = await replay.Content.ReadFromJsonAsync<JsonElement>();
        replayPayload.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("AUTH_WEBAUTHN_CHALLENGE_EXPIRED");
    }

    [Theory]
    [InlineData("authentication")]
    [InlineData("registration")]
    public async Task ProcessLocalChallengeStore_ConcurrentTakes_AllowExactlyOneConsumer(
        string ceremony)
    {
        // This intentionally proves the guarantee within one API process. The
        // in-memory store does not claim atomic consumption across API nodes.
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var store = new PasskeyChallengeStore(cache);
        var cacheKey = $"passkey:test:{ceremony}:{Guid.NewGuid():N}";
        store.Set(cacheKey, ceremony, TimeSpan.FromMinutes(1));

        using var start = new ManualResetEventSlim(initialState: false);
        var attempts = Enumerable.Range(0, 32)
            .Select(_ => Task.Run(() =>
            {
                start.Wait();
                return store.TryTake<string>(cacheKey, out var challenge)
                    && challenge == ceremony;
            }))
            .ToArray();

        start.Set();
        var results = await Task.WhenAll(attempts);

        results.Count(consumed => consumed).Should().Be(1);
        store.TryTake<string>(cacheKey, out _).Should().BeFalse();
    }

    #endregion

    #region Management Endpoint Tests

    [Fact]
    public async Task ListPasskeys_WithoutAuth_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/passkeys");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListPasskeys_WithAuth_ReturnsEmptyList()
    {
        // Arrange
        var token = await GetAuthTokenAsync();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/passkeys");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        // Act
        var response = await Client.SendAsync(request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("passkeys").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task DeletePasskey_NonExistent_ReturnsNotFound()
    {
        // Arrange
        var token = await GetAuthTokenAsync();
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/passkeys/99999");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        // Act
        var response = await Client.SendAsync(request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RenamePasskey_NonExistent_ReturnsNotFound()
    {
        // Arrange
        var token = await GetAuthTokenAsync();
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/passkeys/99999");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(new { display_name = "New Name" });

        // Act
        var response = await Client.SendAsync(request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CanonicalManagement_ScopesOpaqueCredentialIdsToCurrentUserAndTenant()
    {
        var actor = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"passkey-owner-{Guid.NewGuid():N}@example.test",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Passkey",
            LastName = "Owner",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        var ownCredential = NewStoredPasskey(actor, TestData.Tenant1.Id, "Owner credential");
        var foreignCredential = NewStoredPasskey(
            TestData.AdminUser,
            TestData.Tenant1.Id,
            "Foreign credential");

        try
        {
            using (var scope = Factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                db.Users.Add(actor);
                await db.SaveChangesAsync();
                ownCredential.UserId = actor.Id;
                db.UserPasskeys.AddRange(ownCredential, foreignCredential);
                await db.SaveChangesAsync();
            }

            SetAuthToken(await GetAccessTokenAsync(actor.Email, TestData.Tenant1.Slug));
            var securityToken = await ConfirmSecurityAsync();

            using var credentialsResponse = await Client.GetAsync("/api/webauthn/credentials");
            credentialsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var credentialsPayload = await credentialsResponse.Content.ReadFromJsonAsync<JsonElement>();
            var credentials = credentialsPayload.GetProperty("data").GetProperty("credentials")
                .EnumerateArray()
                .ToArray();
            credentials.Should().ContainSingle();
            credentials[0].GetProperty("credential_id").GetString()
                .Should().Be(Base64UrlEncoder.Encode(ownCredential.CredentialId));
            credentials[0].GetProperty("device_name").GetString().Should().Be("Owner credential");

            using var numericIdAttempt = await Client.PostAsJsonAsync("/api/webauthn/remove", new
            {
                credential_id = foreignCredential.Id.ToString(),
                security_confirmation_token = securityToken
            });
            numericIdAttempt.StatusCode.Should().Be(HttpStatusCode.OK);

            using var opaqueIdAttempt = await Client.PostAsJsonAsync("/api/webauthn/remove", new
            {
                credential_id = Base64UrlEncoder.Encode(foreignCredential.CredentialId),
                security_confirmation_token = securityToken
            });
            opaqueIdAttempt.StatusCode.Should().Be(HttpStatusCode.OK);

            using var renameAttempt = await Client.PostAsJsonAsync("/api/webauthn/rename", new
            {
                credential_id = Base64UrlEncoder.Encode(foreignCredential.CredentialId),
                device_name = "Stolen",
                security_confirmation_token = securityToken
            });
            renameAttempt.StatusCode.Should().Be(HttpStatusCode.NotFound);

            using var removeAll = await Client.PostAsJsonAsync("/api/webauthn/remove-all", new
            {
                security_confirmation_token = securityToken
            });
            removeAll.StatusCode.Should().Be(HttpStatusCode.OK);
            var removeAllPayload = await removeAll.Content.ReadFromJsonAsync<JsonElement>();
            removeAllPayload.GetProperty("data").GetProperty("removed_count").GetInt32().Should().Be(1);

            using var verificationScope = Factory.Services.CreateScope();
            var verificationDb = verificationScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await verificationDb.UserPasskeys
                    .IgnoreQueryFilters()
                    .AnyAsync(passkey => passkey.Id == foreignCredential.Id))
                .Should().BeTrue("another user's credential must survive every mutation attempt");
            (await verificationDb.UserPasskeys
                    .IgnoreQueryFilters()
                    .Where(passkey => passkey.Id == foreignCredential.Id)
                    .Select(passkey => passkey.DisplayName)
                    .SingleAsync())
                .Should().Be("Foreign credential");
        }
        finally
        {
            using var cleanupScope = Factory.Services.CreateScope();
            var cleanupDb = cleanupScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await cleanupDb.RefreshTokens
                .IgnoreQueryFilters()
                .Where(token => token.UserId == actor.Id)
                .ExecuteDeleteAsync();
            await cleanupDb.UserPasskeys
                .IgnoreQueryFilters()
                .Where(passkey => passkey.UserId == actor.Id || passkey.Id == foreignCredential.Id)
                .ExecuteDeleteAsync();
            await cleanupDb.Users
                .IgnoreQueryFilters()
                .Where(user => user.Id == actor.Id)
                .ExecuteDeleteAsync();
        }
    }

    [Theory]
    [InlineData("inactive")]
    [InlineData("suspended")]
    [InlineData("pending")]
    public async Task AuthenticationService_RejectsIneligibleAccountBeforeFidoVerification(string gate)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var service = scope.ServiceProvider.GetRequiredService<PasskeyService>();
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"passkey-gate-{gate}-{Guid.NewGuid():N}@example.test",
            PasswordHash = TestDataSeeder.TestPasswordHash,
            FirstName = "Passkey",
            LastName = "Gate",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        var passkey = NewStoredPasskey(user, TestData.Tenant1.Id, $"Gate {gate}");

        db.Users.Add(user);
        await db.SaveChangesAsync();
        passkey.UserId = user.Id;
        db.UserPasskeys.Add(passkey);
        await db.SaveChangesAsync();

        try
        {
            var options = await service.BeginAuthenticationAsync(user.TenantId, user.Email);

            switch (gate)
            {
                case "inactive":
                    user.IsActive = false;
                    break;
                case "suspended":
                    user.SuspendedAt = DateTime.UtcNow;
                    break;
                case "pending":
                    user.RegistrationStatus = RegistrationStatus.PendingAdminReview;
                    break;
            }
            await db.SaveChangesAsync();

            var assertion = JsonSerializer.Deserialize<AuthenticatorAssertionRawResponse>(
                JsonSerializer.Serialize(new
                {
                    id = Base64UrlEncoder.Encode(passkey.CredentialId),
                    rawId = Base64UrlEncoder.Encode(passkey.CredentialId),
                    type = "public-key",
                    response = new
                    {
                        clientDataJSON = "AQID",
                        authenticatorData = "AQID",
                        signature = "AQID",
                        userHandle = Base64UrlEncoder.Encode(passkey.UserHandle)
                    }
                }),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
                {
                    PropertyNameCaseInsensitive = true
                })!;

            Func<Task> act = async () =>
                await service.FinishAuthenticationAsync(options, assertion, user.TenantId);

            await act.Should()
                .ThrowAsync<InvalidOperationException>()
                .WithMessage("*unavailable*");
        }
        finally
        {
            await db.UserPasskeys
                .IgnoreQueryFilters()
                .Where(candidate => candidate.Id == passkey.Id)
                .ExecuteDeleteAsync();
            await db.Users
                .IgnoreQueryFilters()
                .Where(candidate => candidate.Id == user.Id)
                .ExecuteDeleteAsync();
        }
    }

    #endregion

    #region TokenService Integration Tests

    [Fact]
    public async Task Login_ReturnsJwt_WithExpectedClaimsStructure()
    {
        // This verifies TokenService generates JWTs with the correct claims
        // (same structure as before the refactor: sub, tenant_id, role, email, iat)
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = content.GetProperty("access_token").GetString()!;
        content.GetProperty("expires_in").GetInt32().Should().BeGreaterThan(0);

        // Decode JWT and verify claims structure (don't validate signature)
        var handler = new JwtSecurityTokenHandler();
        var jwt = handler.ReadJwtToken(accessToken);

        jwt.Claims.Should().Contain(c => c.Type == "sub");
        jwt.Claims.Should().Contain(c => c.Type == "tenant_id");
        jwt.Claims.Should().Contain(c => c.Type == "role");
        jwt.Claims.Should().Contain(c => c.Type == "email");
        jwt.Claims.Should().Contain(c => c.Type == "iat");
    }

    [Fact]
    public async Task Login_TokenWorksForPasskeyEndpoints()
    {
        // Verify the TokenService-generated JWT is accepted by passkey endpoints
        var token = await GetAuthTokenAsync();

        // Use it on passkey list endpoint
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/passkeys");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await Client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // And on passkey register begin
        using var regRequest = new HttpRequestMessage(HttpMethod.Post, "/api/passkeys/register/begin");
        regRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var regResponse = await Client.SendAsync(regRequest);
        regResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Refresh_ReturnsNewTokenWithSameClaimsStructure()
    {
        // Login to get a refresh token
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var loginContent = await loginResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = loginContent.GetProperty("refresh_token").GetString()!;

        // Use refresh to get a new access token
        var refreshResponse = await Client.PostAsJsonAsync("/api/auth/refresh", new
        {
            refresh_token = refreshToken
        });

        refreshResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var refreshContent = await refreshResponse.Content.ReadFromJsonAsync<JsonElement>();
        var newAccessToken = refreshContent.GetProperty("access_token").GetString()!;
        refreshContent.GetProperty("expires_in").GetInt32().Should().BeGreaterThan(0);

        // Verify the refreshed token has the same claims structure
        var handler = new JwtSecurityTokenHandler();
        var jwt = handler.ReadJwtToken(newAccessToken);

        jwt.Claims.Should().Contain(c => c.Type == "sub");
        jwt.Claims.Should().Contain(c => c.Type == "tenant_id");
        jwt.Claims.Should().Contain(c => c.Type == "role");
        jwt.Claims.Should().Contain(c => c.Type == "email");
    }

    #endregion

    #region Helpers

    private async Task<string> GetAuthTokenAsync()
    {
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "admin@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant"
        });

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        return content.GetProperty("access_token").GetString()!;
    }

    private async Task<string> ConfirmSecurityAsync()
    {
        using var response = await Client.PostAsJsonAsync("/api/webauthn/security-confirm", new
        {
            current_password = TestDataSeeder.TestPassword
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.Headers.CacheControl?.NoStore.Should().BeTrue();
        payload.GetProperty("data").GetProperty("expires_in").GetInt32().Should().Be(300);
        return payload.GetProperty("data").GetProperty("security_confirmation_token").GetString()!;
    }

    private static UserPasskey NewStoredPasskey(User user, int tenantId, string displayName)
    {
        return new UserPasskey
        {
            TenantId = tenantId,
            UserId = user.Id,
            CredentialId = RandomNumberGenerator.GetBytes(32),
            PublicKey = RandomNumberGenerator.GetBytes(64),
            UserHandle = RandomNumberGenerator.GetBytes(32),
            SignCount = 0,
            CredType = "public-key",
            AaGuid = Guid.NewGuid(),
            DisplayName = displayName,
            Transports = "internal",
            IsDiscoverable = true,
            CreatedAt = DateTime.UtcNow
        };
    }

    #endregion
}
