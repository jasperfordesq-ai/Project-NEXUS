// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the impersonation handshake against Laravel's ImpersonationExchangeTest:
/// a super admin mints a one-time proof that authenticates NOTHING as a bearer;
/// the anonymous exchange spends it single-use for a 15-minute session token
/// with NO refresh token; the session carries impersonated_by +
/// impersonation_jti; and ending it revokes only that session.
/// </summary>
[Collection("Integration")]
public class ImpersonationTests : IntegrationTestBase
{
    public ImpersonationTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    /// <summary>Mint a proof as a platform super admin against a fresh member.</summary>
    private async Task<(string Proof, int TargetId)> MintProofAsync()
    {
        var targetEmail = $"impersonate-target-{Guid.NewGuid():N}@test.com";
        int targetId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var target = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = targetEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Target",
                LastName = "Member",
                Role = "member",
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(target);
            await db.SaveChangesAsync();
            targetId = target.Id;
        }

        await AuthenticateAsPlatformSuperAdminAsync();
        var mint = await Client.PostAsJsonAsync(
            $"/api/v2/admin/super/users/{targetId}/impersonate", new { });
        mint.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(mint)).GetProperty("data");
        data.GetProperty("user_id").GetInt32().Should().Be(targetId);
        var proof = data.GetProperty("token").GetString()!;
        return (proof, targetId);
    }

    private HttpClient AnonymousClient()
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        return client;
    }

    [Fact]
    public async Task Mint_RefusesSelf_SuperAdminTargets_AndOrdinaryCallers()
    {
        await AuthenticateAsMemberAsync();
        var (_, targetId) = (default(string), 0);
        var asMember = await Client.PostAsJsonAsync(
            $"/api/v2/admin/super/users/{TestData.AdminUser.Id}/impersonate", new { });
        asMember.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "an ordinary member cannot mint an impersonation proof");

        await AuthenticateAsPlatformSuperAdminAsync();
        var self = await Client.PostAsJsonAsync(
            $"/api/v2/admin/super/users/{CurrentUserId()}/impersonate", new { });
        self.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "you cannot impersonate yourself");

        // Target a god user → refused.
        int godId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var god = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"god-target-{Guid.NewGuid():N}@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "God", LastName = "Target", Role = "member",
                IsActive = true, IsGod = true,
                RegistrationStatus = RegistrationStatus.Active, CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(god);
            await db.SaveChangesAsync();
            godId = god.Id;
        }

        var superTarget = await Client.PostAsJsonAsync(
            $"/api/v2/admin/super/users/{godId}/impersonate", new { });
        superTarget.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a super/god account can never be impersonated");
        _ = targetId;
    }

    [Fact]
    public async Task Proof_IsUselessAsABearerToken()
    {
        var (proof, _) = await MintProofAsync();

        // Presenting the proof as a session bearer must be rejected — this is
        // the whole reason the exchange exists.
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", proof);
        client.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var response = await client.GetAsync("/api/v2/users/me/support-actions");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "type=impersonation authenticates nothing on its own");
    }

    [Fact]
    public async Task Exchange_SpendsTheProofOnce_ForASessionWithNoRefreshToken()
    {
        var (proof, targetId) = await MintProofAsync();
        var anon = AnonymousClient();

        var exchange = await anon.PostAsJsonAsync(
            "/api/v2/auth/impersonate/exchange", new { token = proof });
        exchange.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(exchange);
        body.GetProperty("success").GetBoolean().Should().BeTrue();
        var sessionToken = body.GetProperty("access_token").GetString()!;
        body.TryGetProperty("refresh_token", out _).Should().BeFalse(
            "an impersonated session must not mint a durable refresh family");
        var impersonation = body.GetProperty("impersonation");
        impersonation.GetProperty("user_id").GetInt32().Should().Be(targetId);
        impersonation.GetProperty("admin_id").GetInt32().Should().Be(CurrentUserIdOfSuper());

        // The minted session carries the revocable claims.
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(sessionToken);
        jwt.Claims.Should().Contain(c => c.Type == "impersonated_by");
        jwt.Claims.Should().Contain(c => c.Type == "impersonation_jti");
        jwt.Claims.First(c => c.Type == "sub").Value.Should().Be(targetId.ToString());

        // The session token actually works as the target member.
        var asTarget = Factory.CreateClient();
        asTarget.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", sessionToken);
        asTarget.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        (await asTarget.GetAsync("/api/v2/users/me/support-actions"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // Replaying the same proof is refused — single use.
        var replay = await anon.PostAsJsonAsync(
            "/api/v2/auth/impersonate/exchange", new { token = proof });
        replay.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "the proof is single-use");
    }

    [Fact]
    public async Task Exchange_RejectsMissingAndGarbageTokens()
    {
        var anon = AnonymousClient();
        (await anon.PostAsJsonAsync("/api/v2/auth/impersonate/exchange", new { }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await anon.PostAsJsonAsync("/api/v2/auth/impersonate/exchange", new { token = "not-a-jwt" }))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task End_RevokesOnlyTheImpersonatedSession()
    {
        var (proof, _) = await MintProofAsync();
        var anon = AnonymousClient();
        var exchange = await anon.PostAsJsonAsync(
            "/api/v2/auth/impersonate/exchange", new { token = proof });
        var sessionToken = (await ReadJsonAsync(exchange)).GetProperty("access_token").GetString()!;

        var asTarget = Factory.CreateClient();
        asTarget.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", sessionToken);
        asTarget.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        var end = await asTarget.PostAsJsonAsync("/api/v2/auth/impersonate/end", new { });
        end.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(end)).GetProperty("data").GetProperty("ended")
            .GetBoolean().Should().BeTrue();

        // The impersonated session is now dead (denylist fails closed).
        var afterEnd = await asTarget.GetAsync("/api/v2/users/me/support-actions");
        afterEnd.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "the revoked jti bars the session");
    }

    private int CurrentUserId()
    {
        // The platform-super identity was just authenticated; resolve its id.
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return db.Users.IgnoreQueryFilters()
            .Where(u => u.IsSuperAdmin && u.TenantId == TestData.Tenant1.Id)
            .OrderByDescending(u => u.Id)
            .Select(u => u.Id)
            .First();
    }

    private int CurrentUserIdOfSuper() => CurrentUserId();
}
