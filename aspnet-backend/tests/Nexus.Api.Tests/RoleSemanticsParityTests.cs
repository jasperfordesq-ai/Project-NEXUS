// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Focused Laravel parity coverage for database-backed role and privilege flags.
/// </summary>
[Collection("Integration")]
public class RoleSemanticsParityTests : IntegrationTestBase
{
    private readonly HashSet<string> _createdUserEmails = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, UserSecurityState> _usersToRestore = new();

    public RoleSemanticsParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Theory]
    [InlineData("/api/v2/admin/users", NexusAccessLevel.Admin)]
    [InlineData("/api/v2/admin/users/42/impersonate", NexusAccessLevel.PlatformSuperAdmin)]
    [InlineData("/api/v2/admin/users/42/super-admin", NexusAccessLevel.PlatformSuperAdmin)]
    [InlineData("/api/v2/admin/users/42/global-super-admin", NexusAccessLevel.God)]
    [InlineData("/api/v2/admin/super/dashboard", NexusAccessLevel.PlatformSuperAdmin)]
    [InlineData("/api/v2/admin/super/users/42/grant-global-super-admin", NexusAccessLevel.God)]
    [InlineData("/api/v2/admin/super/billing/snapshot", NexusAccessLevel.God)]
    [InlineData("/api/v2/admin/super/federation/jwt-status", NexusAccessLevel.PlatformSuperAdmin)]
    [InlineData("/api/v2/admin/super/tenants/42/purge-preview", NexusAccessLevel.God)]
    [InlineData("/api/v2/super-admin/provisioning-requests", NexusAccessLevel.PlatformSuperAdmin)]
    [InlineData("/api/admin/settings/powered-by-image-light", NexusAccessLevel.God)]
    [InlineData("/api/admin/system/users/admins", NexusAccessLevel.PlatformSuperAdmin)]
    [InlineData("/api/admin/timebanking/adjust-balance", NexusAccessLevel.BrokerOrAdmin)]
    [InlineData("/api/v2/admin/timebanking/adjust-balance", NexusAccessLevel.BrokerOrAdmin)]
    public void RouteAwareResolver_UsesCanonicalPrivilegeTier(string path, NexusAccessLevel expected)
    {
        NexusRouteAccessResolver.Resolve(path).Should().Be(expected);
    }

    public override async Task DisposeAsync()
    {
        try
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

            foreach (var state in _usersToRestore.Values)
            {
                await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => user.Id == state.Id)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(user => user.TenantId, state.TenantId)
                        .SetProperty(user => user.Role, state.Role)
                        .SetProperty(user => user.IsActive, state.IsActive)
                        .SetProperty(user => user.IsAdmin, state.IsAdmin)
                        .SetProperty(user => user.IsSuperAdmin, state.IsSuperAdmin)
                        .SetProperty(user => user.IsTenantSuperAdmin, state.IsTenantSuperAdmin)
                        .SetProperty(user => user.IsGod, state.IsGod));
            }

            if (_createdUserEmails.Count > 0)
            {
                var createdUserIds = await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => _createdUserEmails.Contains(user.Email))
                    .Select(user => user.Id)
                    .ToListAsync();

                if (createdUserIds.Count > 0)
                {
                    await db.RefreshTokens
                        .IgnoreQueryFilters()
                        .Where(token => createdUserIds.Contains(token.UserId))
                        .ExecuteDeleteAsync();
                    await db.Users
                        .IgnoreQueryFilters()
                        .Where(user => createdUserIds.Contains(user.Id))
                        .ExecuteDeleteAsync();
                }
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    [Fact]
    public async Task PrivilegedPolicies_UseCurrentDatabaseRoleAndFlags()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var authorization = scope.ServiceProvider.GetRequiredService<IAuthorizationService>();

        var member = NewUser("role-member");
        var admin = NewUser("role-admin", role: "admin");
        var legacyTenantAdmin = NewUser("role-tenant-admin", role: "tenant_admin");
        var brokerWithDriftedFlags = NewUser(
            "role-broker",
            role: "broker",
            isAdmin: true,
            isSuperAdmin: true,
            isTenantSuperAdmin: true,
            isGod: true);
        var coordinator = NewUser("role-coordinator", role: "coordinator");
        var flagAdmin = NewUser("role-flag-admin", isAdmin: true);
        var tenantSuperAdmin = NewUser("role-tenant-super", isTenantSuperAdmin: true);
        var platformSuperAdmin = NewUser("role-platform-super", isSuperAdmin: true);
        var god = NewUser("role-god-flag", isGod: true);
        var legacyGod = NewUser("role-god-alias", role: "god");
        var inactiveAdmin = NewUser("role-inactive-admin", role: "admin", isActive: false);

        db.Users.AddRange(
            member,
            admin,
            legacyTenantAdmin,
            brokerWithDriftedFlags,
            coordinator,
            flagAdmin,
            tenantSuperAdmin,
            platformSuperAdmin,
            god,
            legacyGod,
            inactiveAdmin);
        await db.SaveChangesAsync();

        await AssertPolicyAsync(authorization, member, NexusAuthorizationPolicies.AdminOnly, false);
        await AssertPolicyAsync(authorization, admin, NexusAuthorizationPolicies.AdminOnly, true);
        await AssertPolicyAsync(authorization, legacyTenantAdmin, NexusAuthorizationPolicies.AdminOnly, true);
        await AssertPolicyAsync(authorization, flagAdmin, NexusAuthorizationPolicies.AdminOnly, true);
        await AssertPolicyAsync(authorization, tenantSuperAdmin, NexusAuthorizationPolicies.AdminOnly, true);
        await AssertPolicyAsync(authorization, platformSuperAdmin, NexusAuthorizationPolicies.AdminOnly, true);
        await AssertPolicyAsync(authorization, god, NexusAuthorizationPolicies.AdminOnly, true);
        await AssertPolicyAsync(authorization, legacyGod, NexusAuthorizationPolicies.AdminOnly, false);
        await AssertPolicyAsync(authorization, brokerWithDriftedFlags, NexusAuthorizationPolicies.AdminOnly, false);
        await AssertPolicyAsync(authorization, inactiveAdmin, NexusAuthorizationPolicies.AdminOnly, false);

        await AssertPolicyAsync(authorization, brokerWithDriftedFlags, NexusAuthorizationPolicies.BrokerOrAdmin, true);
        await AssertPolicyAsync(authorization, coordinator, NexusAuthorizationPolicies.BrokerOrAdmin, true);
        await AssertPolicyAsync(authorization, legacyGod, NexusAuthorizationPolicies.BrokerOrAdmin, true);
        await AssertPolicyAsync(authorization, admin, NexusAuthorizationPolicies.BrokerOrAdmin, true);
        await AssertPolicyAsync(authorization, member, NexusAuthorizationPolicies.BrokerOrAdmin, false);

        await AssertPolicyAsync(authorization, tenantSuperAdmin, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, true);
        await AssertPolicyAsync(authorization, platformSuperAdmin, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, true);
        await AssertPolicyAsync(authorization, god, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, true);
        await AssertPolicyAsync(authorization, legacyGod, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, true);
        await AssertPolicyAsync(authorization, admin, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, false);
        await AssertPolicyAsync(authorization, flagAdmin, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, false);

        await AssertPolicyAsync(authorization, tenantSuperAdmin, NexusAuthorizationPolicies.PlatformSuperAdminOnly, false);
        await AssertPolicyAsync(authorization, platformSuperAdmin, NexusAuthorizationPolicies.PlatformSuperAdminOnly, true);
        await AssertPolicyAsync(authorization, god, NexusAuthorizationPolicies.PlatformSuperAdminOnly, true);
        await AssertPolicyAsync(authorization, legacyGod, NexusAuthorizationPolicies.PlatformSuperAdminOnly, true);

        await AssertPolicyAsync(authorization, god, NexusAuthorizationPolicies.GodOnly, true);
        await AssertPolicyAsync(authorization, legacyGod, NexusAuthorizationPolicies.GodOnly, false);
        await AssertPolicyAsync(authorization, platformSuperAdmin, NexusAuthorizationPolicies.GodOnly, false);

        await AssertPolicyAsync(
            authorization,
            admin,
            NexusAuthorizationPolicies.AdminOnly,
            false,
            claimedTenantId: TestData.Tenant2.Id);
        await AssertPolicyAsync(
            authorization,
            admin,
            NexusAuthorizationPolicies.AdminOnly,
            false,
            claimedRole: "member");
    }

    [Fact]
    public async Task LoginAndUsersMe_ReturnCanonicalProfileIndicatorAndRawPrivilegeClaims()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users
                .IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.Id == TestData.MemberUser.Id);
            TrackForRestore(user);
            user.IsAdmin = true;
            user.IsSuperAdmin = false;
            user.IsTenantSuperAdmin = false;
            user.IsGod = true;
            await db.SaveChangesAsync();
        }

        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = TestData.MemberUser.Email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug
        });

        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await login.Content.ReadFromJsonAsync<JsonElement>();
        var loginUser = payload.GetProperty("user");
        loginUser.GetProperty("role").GetString().Should().Be("member");
        loginUser.GetProperty("is_admin").GetBoolean().Should().BeFalse(
            "Laravel's profile indicator does not fold raw is_admin or is_god flags into is_admin");
        loginUser.GetProperty("is_super_admin").GetBoolean().Should().BeFalse();
        loginUser.GetProperty("is_tenant_super_admin").GetBoolean().Should().BeFalse();
        loginUser.GetProperty("is_god").GetBoolean().Should().BeTrue();

        var accessToken = payload.GetProperty("access_token").GetString()!;
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(accessToken);
        ClaimValue(jwt, NexusPrivilegeClaimTypes.IsAdmin).Should().Be("true");
        ClaimValue(jwt, NexusPrivilegeClaimTypes.IsSuperAdmin).Should().Be("false");
        ClaimValue(jwt, NexusPrivilegeClaimTypes.IsTenantSuperAdmin).Should().Be("false");
        ClaimValue(jwt, NexusPrivilegeClaimTypes.IsGod).Should().Be("true");

        SetAuthToken(accessToken);
        var me = await Client.GetAsync("/api/v2/users/me");

        me.StatusCode.Should().Be(HttpStatusCode.OK);
        var mePayload = await me.Content.ReadFromJsonAsync<JsonElement>();
        var meUser = mePayload.GetProperty("data");
        meUser.GetProperty("is_admin").GetBoolean().Should().BeFalse();
        meUser.GetProperty("is_super_admin").GetBoolean().Should().BeFalse();
        meUser.GetProperty("is_tenant_super_admin").GetBoolean().Should().BeFalse();
        meUser.GetProperty("is_god").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminOnly_RehydratesFlagChanges_AndRejectsBrokerFlagDrift()
    {
        User flagAdmin;
        User brokerWithDriftedFlags;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            flagAdmin = NewUser("runtime-flag-admin", isAdmin: true);
            brokerWithDriftedFlags = NewUser(
                "runtime-broker",
                role: "broker",
                isAdmin: true,
                isSuperAdmin: true,
                isTenantSuperAdmin: true,
                isGod: true);
            db.Users.AddRange(flagAdmin, brokerWithDriftedFlags);
            await db.SaveChangesAsync();
        }

        SetAuthToken(await GetAccessTokenAsync(flagAdmin.Email, TestData.Tenant1.Slug));
        var granted = await Client.GetAsync("/api/admin/dashboard");
        granted.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Conflict);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var current = await db.Users
                .IgnoreQueryFilters()
                .SingleAsync(user => user.Id == flagAdmin.Id);
            current.IsAdmin = false;
            await db.SaveChangesAsync();
        }

        var revoked = await Client.GetAsync("/api/admin/dashboard");
        revoked.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        SetAuthToken(await GetAccessTokenAsync(brokerWithDriftedFlags.Email, TestData.Tenant1.Slug));
        var broker = await Client.GetAsync("/api/admin/dashboard");
        broker.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AuthenticatedRequest_WithTokenTenantMismatch_IsRejected()
    {
        var token = await GetAccessTokenAsync(TestData.MemberUser.Email, TestData.Tenant1.Slug);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users
                .IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.Id == TestData.MemberUser.Id);
            TrackForRestore(user);
            await db.Users
                .IgnoreQueryFilters()
                .Where(candidate => candidate.Id == user.Id)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(candidate => candidate.TenantId, TestData.Tenant2.Id));
        }

        SetAuthToken(token);
        var response = await Client.GetAsync("/api/v2/users/me");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private User NewUser(
        string emailPrefix,
        string role = "member",
        bool isAdmin = false,
        bool isSuperAdmin = false,
        bool isTenantSuperAdmin = false,
        bool isGod = false,
        bool isActive = true)
    {
        var email = $"{emailPrefix}@test.com";
        _createdUserEmails.Add(email);

        return new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Role",
            LastName = "Parity",
            Role = role,
            IsAdmin = isAdmin,
            IsSuperAdmin = isSuperAdmin,
            IsTenantSuperAdmin = isTenantSuperAdmin,
            IsGod = isGod,
            IsActive = isActive,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
    }

    private void TrackForRestore(User user)
    {
        _usersToRestore.TryAdd(
            user.Id,
            new UserSecurityState(
                user.Id,
                user.TenantId,
                user.Role,
                user.IsActive,
                user.IsAdmin,
                user.IsSuperAdmin,
                user.IsTenantSuperAdmin,
                user.IsGod));
    }

    private static async Task AssertPolicyAsync(
        IAuthorizationService authorization,
        User user,
        string policyName,
        bool expected,
        int? claimedTenantId = null,
        string? claimedRole = null)
    {
        var identity = new ClaimsIdentity(
            new[]
            {
                new Claim("sub", user.Id.ToString()),
                new Claim("tenant_id", (claimedTenantId ?? user.TenantId).ToString()),
                new Claim("role", claimedRole ?? user.Role)
            },
            authenticationType: "test",
            nameType: "sub",
            roleType: "role");
        var principal = new ClaimsPrincipal(identity);

        var result = await authorization.AuthorizeAsync(
            principal,
            resource: null,
            policyName: policyName);

        result.Succeeded.Should().Be(
            expected,
            $"policy {policyName} should evaluate current DB state for {user.Email}");
    }

    private static string ClaimValue(JwtSecurityToken token, string claimType)
    {
        return token.Claims.Single(claim => claim.Type == claimType).Value;
    }

    private sealed record UserSecurityState(
        int Id,
        int TenantId,
        string Role,
        bool IsActive,
        bool IsAdmin,
        bool IsSuperAdmin,
        bool IsTenantSuperAdmin,
        bool IsGod);
}
