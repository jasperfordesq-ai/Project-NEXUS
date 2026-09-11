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

    [Theory]
    [InlineData("POST", "/api/passkeys/register/begin")]
    [InlineData("POST", "/api/passkeys/register/finish")]
    [InlineData("DELETE", "/api/passkeys/123")]
    [InlineData("PUT", "/api/passkeys/123")]
    public async Task CompatibilityMutation_RequiresSecurityConfirmation(string method, string path)
    {
        SetAuthToken(await GetAuthTokenAsync());
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Content = JsonContent.Create(new
        {
            display_name = "Example",
            attestation_response = new
            {
                id = "fake", rawId = "fake", type = "public-key", authenticatorAttachment = "platform",
                clientExtensionResults = new { },
                response = new { clientDataJSON = "fake", attestationObject = "fake", transports = new[] { "internal" } }
            }
        });
        using var response = await Client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, await response.Content.ReadAsStringAsync());
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("SECURITY_CONFIRMATION_REQUIRED");
    }

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
        SetAuthToken(token);
        request.Headers.Add("X-Security-Confirmation", await ConfirmSecurityAsync());

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
        content.GetProperty("authenticatorSelection").GetProperty("userVerification").GetString().Should().Be("required");
        content.GetProperty("authenticatorSelection").GetProperty("residentKey").GetString().Should().Be("required");
    }

    [Fact]
    public async Task FinishRegistration_WithoutBegin_ReturnsBadRequest()
    {
        // Arrange
        var token = await GetAuthTokenAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/passkeys/register/finish");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        SetAuthToken(token);
        request.Headers.Add("X-Security-Confirmation", await ConfirmSecurityAsync());
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
        data.GetProperty("userVerification").GetString().Should().Be("required");
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
        SetAuthToken(token);
        request.Headers.Add("X-Security-Confirmation", await ConfirmSecurityAsync());

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
        SetAuthToken(token);
        request.Headers.Add("X-Security-Confirmation", await ConfirmSecurityAsync());
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
            numericIdAttempt.StatusCode.Should().Be(HttpStatusCode.NotFound);

            using var opaqueIdAttempt = await Client.PostAsJsonAsync("/api/webauthn/remove", new
            {
                credential_id = Base64UrlEncoder.Encode(foreignCredential.CredentialId),
                security_confirmation_token = securityToken
            });
            opaqueIdAttempt.StatusCode.Should().Be(HttpStatusCode.NotFound);

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
            removeAllPayload.GetProperty("data").GetProperty("sessions_revoked").GetBoolean().Should().BeTrue();
            using var staleAccess = await Client.GetAsync("/api/webauthn/credentials");
            staleAccess.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            using (var revocationScope = Factory.Services.CreateScope())
            {
                var revocationDb = revocationScope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var sessions = await revocationDb.RefreshTokens.IgnoreQueryFilters()
                    .Where(t => t.UserId == actor.Id).ToListAsync();
                sessions.Should().NotBeEmpty();
                sessions.Should().OnlyContain(t => t.RevokedAt != null && t.RevokedReason == "passkey_removed");
            }

            SetAuthToken(await GetAccessTokenAsync(actor.Email, TestData.Tenant1.Slug));
            using var freshAccess = await Client.GetAsync("/api/webauthn/credentials");
            freshAccess.StatusCode.Should().Be(HttpStatusCode.OK);
            using var staleProof = await Client.PostAsJsonAsync("/api/webauthn/remove-all", new
            {
                security_confirmation_token = securityToken
            });
            staleProof.StatusCode.Should().Be(HttpStatusCode.Forbidden);

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

    [Fact]
    public async Task ConcurrentRemovals_CannotConsumeBothPasswordlessCredentials()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var actor = new User
        {
            TenantId = TestData.Tenant1.Id, Email = $"passkey-race-{Guid.NewGuid():N}@example.test",
            PasswordHash = "", FirstName = "Race", LastName = "Member", Role = "member",
            IsActive = true, RegistrationStatus = RegistrationStatus.Active
        };
        db.Users.Add(actor);
        await db.SaveChangesAsync();
        var keys = new[] { NewStoredPasskey(actor, actor.TenantId, "One"), NewStoredPasskey(actor, actor.TenantId, "Two") };
        db.UserPasskeys.AddRange(keys);
        await db.SaveChangesAsync();
        try
        {
            async Task<bool> RemoveAsync(UserPasskey key)
            {
                using var requestScope = Factory.Services.CreateScope();
                var service = requestScope.ServiceProvider.GetRequiredService<PasskeyService>();
                try { return await service.DeleteCredentialAsync(Base64UrlEncoder.Encode(key.CredentialId), actor.Id, actor.TenantId); }
                catch (InvalidOperationException) { return false; }
            }
            var results = await Task.WhenAll(keys.Select(RemoveAsync));
            results.Count(result => result).Should().Be(1);
            (await db.UserPasskeys.IgnoreQueryFilters().CountAsync(p => p.UserId == actor.Id)).Should().Be(1);
        }
        finally
        {
            await db.UserPasskeys.IgnoreQueryFilters().Where(p => p.UserId == actor.Id).ExecuteDeleteAsync();
            await db.Users.IgnoreQueryFilters().Where(u => u.Id == actor.Id).ExecuteDeleteAsync();
        }
    }

    [Theory]
    [InlineData("single")]
    [InlineData("all")]
    [InlineData("numeric")]
    [InlineData("missing-id")]
    public async Task Removal_PreservesPasswordlessMembersFinalCredential(string operation)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var tokens = scope.ServiceProvider.GetRequiredService<TokenService>();
        var actor = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"passkey-only-{Guid.NewGuid():N}@example.test",
            PasswordHash = "",
            FirstName = "Passkey", LastName = "Only", Role = "member",
            IsActive = true, RegistrationStatus = RegistrationStatus.Active
        };
        db.Users.Add(actor);
        await db.SaveChangesAsync();
        var credential = NewStoredPasskey(actor, actor.TenantId, "Only credential");
        db.UserPasskeys.Add(credential);
        await db.SaveChangesAsync();
        try
        {
            SetAuthToken(tokens.GenerateJwt(actor, "passkey", "user_verification"));
            var proof = tokens.GenerateSecurityConfirmationToken(actor.Id, actor.TenantId, "passkey_uv");
            Client.DefaultRequestHeaders.Add("X-Security-Confirmation", proof);
            using var response = operation == "numeric"
                ? await Client.DeleteAsync($"/api/passkeys/{credential.Id}")
                : await Client.PostAsJsonAsync(operation == "all" ? "/api/webauthn/remove-all" : "/api/webauthn/remove", new
                {
                    credential_id = operation == "missing-id" ? null : Base64UrlEncoder.Encode(credential.CredentialId),
                    security_confirmation_token = proof
                });
            response.StatusCode.Should().Be(operation == "missing-id"
                ? HttpStatusCode.UnprocessableEntity : HttpStatusCode.Conflict);
            (await db.UserPasskeys.IgnoreQueryFilters().AnyAsync(p => p.Id == credential.Id)).Should().BeTrue();
            await db.Entry(actor).ReloadAsync();
            actor.AuthenticationInvalidatedAt.Should().BeNull("a rejected removal must not revoke the member's session");
            using var access = await Client.GetAsync("/api/webauthn/credentials");
            access.StatusCode.Should().Be(HttpStatusCode.OK);
        }
        finally
        {
            await db.UserPasskeys.IgnoreQueryFilters().Where(p => p.UserId == actor.Id).ExecuteDeleteAsync();
            await db.Users.IgnoreQueryFilters().Where(u => u.Id == actor.Id).ExecuteDeleteAsync();
        }
    }

    [Theory]
    [InlineData("inactive")]
    [InlineData("suspended")]
    [InlineData("pending")]
    [InlineData("disabled")]
    [InlineData("disabled-legacy")]
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
        TenantConfig? featureConfig = null;
        string? originalFeatureValue = null;

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
                case "disabled":
                case "disabled-legacy":
                    var key = gate == "disabled" ? "features.biometric_login" : "feature.biometric_login";
                    featureConfig = await db.TenantConfigs.IgnoreQueryFilters()
                        .SingleOrDefaultAsync(c => c.TenantId == user.TenantId && c.Key == key);
                    if (featureConfig is null)
                    {
                        featureConfig = new TenantConfig { TenantId = user.TenantId, Key = key, Value = "false" };
                        db.TenantConfigs.Add(featureConfig);
                    }
                    else
                    {
                        originalFeatureValue = featureConfig.Value;
                        featureConfig.Value = "false";
                    }
                    break;
            }
            await db.SaveChangesAsync();

            if (gate.StartsWith("disabled", StringComparison.Ordinal))
            {
                Func<Task> begin = async () => await service.BeginAuthenticationAsync(user.TenantId, user.Email);
                await begin.Should().ThrowAsync<InvalidOperationException>().WithMessage("*disabled*");
                Func<Task> enrol = async () => await service.BeginRegistrationAsync(user);
                await enrol.Should().ThrowAsync<InvalidOperationException>().WithMessage("*disabled*");
                (await service.GetUserPasskeysAsync(user.Id, user.TenantId)).Should().ContainSingle();
                foreach (var route in new[] { "/api/webauthn/auth-challenge", "/api/passkeys/authenticate/begin" })
                {
                    using var rejected = await Client.PostAsJsonAsync(route, new { tenant_slug = TestData.Tenant1.Slug });
                    rejected.StatusCode.Should().Be(HttpStatusCode.Forbidden);
                }
            }

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
            if (featureConfig is not null)
            {
                if (originalFeatureValue is null) db.TenantConfigs.Remove(featureConfig);
                else featureConfig.Value = originalFeatureValue;
                await db.SaveChangesAsync();
            }
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
        SetAuthToken(token);
        regRequest.Headers.Add("X-Security-Confirmation", await ConfirmSecurityAsync());

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
