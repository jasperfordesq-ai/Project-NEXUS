// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class SafeguardingVettingAccessServiceTests : IntegrationTestBase
{
    public SafeguardingVettingAccessServiceTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public async Task DecisionMaker_UsesCurrentDatabaseStateAndCategoricallyDeniesCoordinator()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var users = new[]
        {
            NewUser("vetting-broker", role: "broker"),
            NewUser("vetting-admin-role", role: "admin"),
            NewUser("vetting-tenant-admin-role", role: "tenant_admin"),
            NewUser("vetting-super-admin-role", role: "super_admin"),
            NewUser("vetting-god-role", role: "god"),
            NewUser("vetting-admin-flag", isAdmin: true),
            NewUser("vetting-super-flag", isSuperAdmin: true),
            NewUser("vetting-tenant-super-flag", isTenantSuperAdmin: true),
            NewUser("vetting-god-flag", isGod: true),
            NewUser(
                "vetting-coordinator-with-flags",
                role: "coordinator",
                isAdmin: true,
                isSuperAdmin: true,
                isTenantSuperAdmin: true,
                isGod: true),
            NewUser("vetting-uppercase-admin-role", role: "ADMIN"),
            NewUser("vetting-spaced-broker-role", role: " broker "),
            NewUser("vetting-member"),
            NewUser("vetting-inactive-admin", role: "admin", isActive: false)
        };
        db.Users.AddRange(users);
        await db.SaveChangesAsync();

        var service = CreateService(db, TestData.Tenant1.Id);
        var expected = new[]
        {
            true, true, true, true, true, true, true, true, true,
            false, false, false, false, false
        };

        try
        {
            for (var index = 0; index < users.Length; index++)
            {
                var result = await service.ResolveDecisionMakerUserIdAsync(
                    Principal(users[index].Id, TestData.Tenant1.Id));

                if (expected[index])
                {
                    result.Should().Be(users[index].Id);
                }
                else
                {
                    result.Should().BeNull();
                }
            }
        }
        finally
        {
            db.Users.RemoveRange(users);
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task VettingAdmin_UsesNamedRolesOrOnlyTheTwoSuperFlags()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var users = new[]
        {
            NewUser("policy-admin-role", role: "admin"),
            NewUser("policy-tenant-admin-role", role: "tenant_admin"),
            NewUser("policy-super-admin-role", role: "super_admin"),
            NewUser("policy-god-role", role: "god"),
            NewUser("policy-super-flag", isSuperAdmin: true),
            NewUser("policy-tenant-super-flag", isTenantSuperAdmin: true),
            NewUser("policy-broker-super-flag", role: "broker", isSuperAdmin: true),
            NewUser("policy-coordinator-super-flag", role: "coordinator", isTenantSuperAdmin: true),
            NewUser("policy-admin-flag-only", isAdmin: true),
            NewUser("policy-god-flag-only", isGod: true),
            NewUser("policy-uppercase-admin-role", role: "ADMIN"),
            NewUser("policy-spaced-admin-role", role: " admin "),
            NewUser("policy-broker", role: "broker"),
            NewUser("policy-member")
        };
        db.Users.AddRange(users);
        await db.SaveChangesAsync();

        var service = CreateService(db, TestData.Tenant1.Id);
        var expected = new[]
        {
            true, true, true, true, true, true, true, true,
            false, false, false, false, false, false
        };

        try
        {
            for (var index = 0; index < users.Length; index++)
            {
                var result = await service.ResolveVettingAdminUserIdAsync(
                    Principal(users[index].Id, TestData.Tenant1.Id));

                if (expected[index])
                {
                    result.Should().Be(users[index].Id);
                }
                else
                {
                    result.Should().BeNull();
                }
            }
        }
        finally
        {
            db.Users.RemoveRange(users);
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task AccessLookup_FailsClosedForUnresolvedMismatchedAnonymousOrCrossTenantState()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var unresolved = new SafeguardingVettingAccessService(
            db,
            new TenantContext(),
            NullLogger<SafeguardingVettingAccessService>.Instance);
        (await unresolved.ResolveDecisionMakerUserIdAsync(
                Principal(TestData.AdminUser.Id, TestData.Tenant1.Id)))
            .Should().BeNull();

        var service = CreateService(db, TestData.Tenant1.Id);
        (await service.ResolveDecisionMakerUserIdAsync(
                Principal(TestData.AdminUser.Id, TestData.Tenant2.Id)))
            .Should().BeNull("the token tenant must match the resolved request tenant");
        (await service.ResolveDecisionMakerUserIdAsync(
                Principal(TestData.OtherTenantUser.Id, TestData.Tenant1.Id)))
            .Should().BeNull("the current database user must belong to the resolved tenant");
        var stalePrivilegedPrincipal = Principal(
            TestData.MemberUser.Id,
            TestData.Tenant1.Id,
            stalePrivilegeClaims: true);
        (await service.ResolveDecisionMakerUserIdAsync(stalePrivilegedPrincipal))
            .Should().BeNull("role and privilege claims must not override current database state");
        (await service.ResolveVettingAdminUserIdAsync(stalePrivilegedPrincipal))
            .Should().BeNull("role and privilege claims must not override current database state");
        (await service.ResolveDecisionMakerUserIdAsync(
                Principal(TestData.AdminUser.Id, TestData.Tenant1.Id, authenticated: false)))
            .Should().BeNull();
        (await service.ResolveDecisionMakerUserIdAsync(new ClaimsPrincipal()))
            .Should().BeNull();
    }

    private SafeguardingVettingAccessService CreateService(NexusDbContext db, int tenantId)
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(tenantId);
        return new SafeguardingVettingAccessService(
            db,
            tenantContext,
            NullLogger<SafeguardingVettingAccessService>.Instance);
    }

    private User NewUser(
        string localPart,
        string role = "member",
        bool isActive = true,
        bool isAdmin = false,
        bool isSuperAdmin = false,
        bool isTenantSuperAdmin = false,
        bool isGod = false)
        => new()
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"{localPart}@test.com",
            PasswordHash = TestData.MemberUser.PasswordHash,
            FirstName = "Vetting",
            LastName = "Access",
            Role = role,
            IsActive = isActive,
            IsAdmin = isAdmin,
            IsSuperAdmin = isSuperAdmin,
            IsTenantSuperAdmin = isTenantSuperAdmin,
            IsGod = isGod,
            CreatedAt = DateTime.UtcNow
        };

    private static ClaimsPrincipal Principal(
        int userId,
        int tenantId,
        bool authenticated = true,
        bool stalePrivilegeClaims = false)
    {
        var claims = new List<Claim>
        {
            new Claim("sub", userId.ToString()),
            new Claim("tenant_id", tenantId.ToString())
        };
        if (stalePrivilegeClaims)
        {
            claims.Add(new Claim("role", "admin"));
            claims.Add(new Claim("is_admin", "true"));
            claims.Add(new Claim("is_super_admin", "true"));
            claims.Add(new Claim("is_tenant_super_admin", "true"));
            claims.Add(new Claim("is_god", "true"));
        }

        var identity = new ClaimsIdentity(claims, authenticated ? "vetting-test" : null);
        return new ClaimsPrincipal(identity);
    }
}
