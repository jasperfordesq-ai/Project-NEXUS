// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Support.Authorization;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// The subtree boundary that did not exist until 2026-08-15 (R-4).
///
/// Laravel confines a hub-tenant super admin ("regional") to its own tenant and
/// its descendants; a platform super admin ("master") sees everything. This
/// backend had neither the hierarchy nor the check, so a regional admin was
/// treated exactly like a platform administrator on every super surface,
/// impersonation included.
///
/// The empty-path case is the one to keep an eye on: the boundary is a string
/// prefix match, and every string starts with "", so an unpopulated path must
/// DENY rather than resolve to "everything".
/// </summary>
[Collection("Integration")]
public sealed class SuperPanelSubtreeAccessTests : IntegrationTestBase
{
    public SuperPanelSubtreeAccessTests(NexusWebApplicationFactory factory) : base(factory) { }

    private sealed record Fixture(int HubTenantId, int ChildTenantId, int OutsiderTenantId, int HubAdminId);

    /// <summary>
    /// hub (allows subtenants, path /H/) → child (/H/C/); plus an unrelated
    /// tenant outside that subtree.
    /// </summary>
    private async Task<Fixture> BuildHierarchyAsync(bool hubHasPath = true)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var suffix = Guid.NewGuid().ToString("N")[..8];

        var hub = new Tenant { Slug = $"hub-{suffix}", Name = "Hub", AllowsSubtenants = true, IsActive = true };
        var outsider = new Tenant { Slug = $"out-{suffix}", Name = "Outsider", IsActive = true };
        db.Tenants.AddRange(hub, outsider);
        await db.SaveChangesAsync();

        hub.Path = hubHasPath ? $"/{hub.Id}/" : null;
        hub.Depth = 0;
        outsider.Path = $"/{outsider.Id}/";
        await db.SaveChangesAsync();

        var child = new Tenant
        {
            Slug = $"child-{suffix}",
            Name = "Child",
            IsActive = true,
            ParentId = hub.Id,
            Depth = 1,
        };
        db.Tenants.Add(child);
        await db.SaveChangesAsync();
        child.Path = $"/{hub.Id}/{child.Id}/";
        await db.SaveChangesAsync();

        var hubAdmin = new User
        {
            TenantId = hub.Id,
            Email = $"hub-admin-{suffix}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Hub",
            LastName = "Admin",
            Role = "admin",
            IsActive = true,
            IsTenantSuperAdmin = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow,
        };
        db.Users.Add(hubAdmin);
        await db.SaveChangesAsync();

        return new Fixture(hub.Id, child.Id, outsider.Id, hubAdmin.Id);
    }

    private async Task<T> WithAccessAsync<T>(Func<SuperPanelAccess, Task<T>> body)
    {
        using var scope = Factory.Services.CreateScope();
        var access = scope.ServiceProvider.GetRequiredService<SuperPanelAccess>();
        return await body(access);
    }

    [Fact]
    public async Task HubSuperAdmin_IsRegional_AndReachesOnlyItsOwnSubtree()
    {
        var f = await BuildHierarchyAsync();

        var decision = await WithAccessAsync(a => a.ResolveAsync(f.HubAdminId));
        decision.Granted.Should().BeTrue();
        decision.Level.Should().Be(SuperPanelAccess.LevelRegional);

        (await WithAccessAsync(a => a.CanAccessTenantAsync(f.HubAdminId, f.HubTenantId)))
            .Should().BeTrue("its own tenant is always in scope");
        (await WithAccessAsync(a => a.CanAccessTenantAsync(f.HubAdminId, f.ChildTenantId)))
            .Should().BeTrue("a descendant is in scope");
        (await WithAccessAsync(a => a.CanAccessTenantAsync(f.HubAdminId, f.OutsiderTenantId)))
            .Should().BeFalse("a tenant outside the subtree must be refused");
    }

    [Fact]
    public async Task PlatformSuperAdmin_IsMaster_AndReachesEverything()
    {
        var f = await BuildHierarchyAsync();

        // The fixtures create a platform super admin on demand rather than
        // seeding one, so make our own rather than assume a seeded row exists.
        int platformAdminId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var platformAdmin = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"platform-super-{Guid.NewGuid():N}@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Platform",
                LastName = "Super",
                Role = "member",
                IsSuperAdmin = true,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow,
            };
            db.Users.Add(platformAdmin);
            await db.SaveChangesAsync();
            platformAdminId = platformAdmin.Id;
        }

        var decision = await WithAccessAsync(a => a.ResolveAsync(platformAdminId));
        decision.Granted.Should().BeTrue();
        decision.Level.Should().Be(SuperPanelAccess.LevelMaster);

        (await WithAccessAsync(a => a.CanAccessTenantAsync(platformAdminId, f.OutsiderTenantId)))
            .Should().BeTrue("a platform super admin is not confined");
    }

    /// <summary>
    /// 🔴 The trap. A prefix match against an empty path matches every tenant,
    /// so a hub with no materialised path must be DENIED, not handed the whole
    /// installation.
    /// </summary>
    [Fact]
    public async Task HubSuperAdmin_WithNoMaterialisedPath_IsDeniedRatherThanGrantedEverything()
    {
        var f = await BuildHierarchyAsync(hubHasPath: false);

        var decision = await WithAccessAsync(a => a.ResolveAsync(f.HubAdminId));
        decision.Granted.Should().BeFalse("an empty prefix must never resolve to a wildcard");
        decision.Reason.Should().Contain("materialised path");

        (await WithAccessAsync(a => a.CanAccessTenantAsync(f.HubAdminId, f.OutsiderTenantId)))
            .Should().BeFalse();
        (await WithAccessAsync(a => a.CanAccessTenantAsync(f.HubAdminId, f.HubTenantId)))
            .Should().BeFalse("access is refused outright, including its own tenant");
    }

    /// <summary>
    /// A super admin of a leaf tenant (no sub-tenant capability) is refused by
    /// Laravel's super-panel gate; the old flags-only check admitted them.
    /// </summary>
    [Fact]
    public async Task LeafTenantSuperAdmin_IsRefused()
    {
        int leafAdminId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var suffix = Guid.NewGuid().ToString("N")[..8];
            var leaf = new Tenant
            {
                Slug = $"leaf-{suffix}",
                Name = "Leaf",
                IsActive = true,
                AllowsSubtenants = false,
            };
            db.Tenants.Add(leaf);
            await db.SaveChangesAsync();
            leaf.Path = $"/{leaf.Id}/";
            await db.SaveChangesAsync();

            var admin = new User
            {
                TenantId = leaf.Id,
                Email = $"leaf-admin-{suffix}@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Leaf",
                LastName = "Admin",
                Role = "admin",
                IsActive = true,
                IsTenantSuperAdmin = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow,
            };
            db.Users.Add(admin);
            await db.SaveChangesAsync();
            leafAdminId = admin.Id;
        }

        var decision = await WithAccessAsync(a => a.ResolveAsync(leafAdminId));
        decision.Granted.Should().BeFalse("a leaf tenant has no sub-tenant capability");
        decision.Reason.Should().Contain("sub-tenant capability");
    }

    [Fact]
    public async Task OrdinaryMember_IsRefused()
    {
        var decision = await WithAccessAsync(a => a.ResolveAsync(TestData.MemberUser.Id));
        decision.Granted.Should().BeFalse();
    }
}
