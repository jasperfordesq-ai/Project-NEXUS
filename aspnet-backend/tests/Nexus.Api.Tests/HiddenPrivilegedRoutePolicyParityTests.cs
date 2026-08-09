// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Live coverage for the privilege tiers hidden behind mixed admin controllers.
/// These requests prove the effective endpoint policy, not just policy metadata
/// or the route resolver in isolation.
/// </summary>
[Collection("Integration")]
public sealed class HiddenPrivilegedRoutePolicyParityTests : IntegrationTestBase
{
    private const string AdminPath = "/api/v2/admin/users";
    private const string PlatformPath = "/api/v2/admin/super/dashboard";
    private const string GodPath = "/api/v2/admin/super/billing/snapshot";

    private readonly HashSet<int> _createdUserIds = [];

    public HiddenPrivilegedRoutePolicyParityTests(NexusWebApplicationFactory factory)
        : base(factory)
    {
    }

    [Theory]
    [InlineData(ActorKind.OrdinaryAdmin, 200, 403, 403)]
    [InlineData(ActorKind.TenantSuperAdmin, 200, 403, 403)]
    [InlineData(ActorKind.PlatformSuperAdmin, 200, 200, 403)]
    [InlineData(ActorKind.RoleOnlyGod, 403, 200, 403)]
    [InlineData(ActorKind.ExplicitGod, 200, 200, 200)]
    public async Task HiddenPrivilegedRoutes_EnforceCanonicalRoleAndFlagMatrix(
        ActorKind actor,
        int expectedAdminStatus,
        int expectedPlatformStatus,
        int expectedGodStatus)
    {
        await AuthenticateSyntheticActorAsync(actor);

        await AssertPolicyResponseAsync(
            AdminPath,
            expectedAdminStatus,
            "Admin access required");
        await AssertPolicyResponseAsync(
            PlatformPath,
            expectedPlatformStatus,
            "Super admin access required");
        await AssertPolicyResponseAsync(
            GodPath,
            expectedGodStatus,
            "God access required");
    }

    [Theory]
    [InlineData(AdminPath)]
    [InlineData(PlatformPath)]
    [InlineData(GodPath)]
    public async Task HiddenPrivilegedV2Routes_AnonymousChallengeUsesCanonicalEnvelope(string path)
    {
        ClearAuthToken();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        using var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await AssertCanonicalErrorAsync(response, "auth_required", "Authentication required");
    }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_createdUserIds.Count > 0)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

                await db.RefreshTokens
                    .IgnoreQueryFilters()
                    .Where(token => _createdUserIds.Contains(token.UserId))
                    .ExecuteDeleteAsync();
                await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => _createdUserIds.Contains(user.Id))
                    .ExecuteDeleteAsync();
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    private async Task AuthenticateSyntheticActorAsync(ActorKind actor)
    {
        var email = $"hidden-policy-{actor.ToString().ToLowerInvariant()}-{Guid.NewGuid():N}@example.test";

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Hidden",
                LastName = "Policy",
                Role = actor switch
                {
                    ActorKind.OrdinaryAdmin => "admin",
                    ActorKind.RoleOnlyGod => "god",
                    _ => "member"
                },
                IsAdmin = false,
                IsTenantSuperAdmin = actor == ActorKind.TenantSuperAdmin,
                IsSuperAdmin = actor == ActorKind.PlatformSuperAdmin,
                IsGod = actor == ActorKind.ExplicitGod,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            };

            db.Users.Add(user);
            await db.SaveChangesAsync();
            _createdUserIds.Add(user.Id);
        }

        SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant1.Slug));
    }

    private async Task AssertPolicyResponseAsync(
        string path,
        int expectedStatus,
        string forbiddenMessage)
    {
        using var response = await Client.GetAsync(path);

        ((int)response.StatusCode).Should().Be(expectedStatus, $"effective policy mismatch on {path}");
        if (expectedStatus == StatusCodes.Status403Forbidden)
        {
            await AssertCanonicalErrorAsync(response, "forbidden", forbiddenMessage);
        }
    }

    private static async Task AssertCanonicalErrorAsync(
        HttpResponseMessage response,
        string expectedCode,
        string expectedMessage)
    {
        response.Headers.TryGetValues("API-Version", out var versionValues).Should().BeTrue();
        versionValues.Should().Equal("2.0");

        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("success").GetBoolean().Should().BeFalse();
        var errors = payload.GetProperty("errors").EnumerateArray().ToArray();
        errors.Should().ContainSingle();
        errors[0].GetProperty("code").GetString().Should().Be(expectedCode);
        errors[0].GetProperty("message").GetString().Should().Be(expectedMessage);
    }

    public enum ActorKind
    {
        OrdinaryAdmin,
        TenantSuperAdmin,
        PlatformSuperAdmin,
        RoleOnlyGod,
        ExplicitGod
    }
}
