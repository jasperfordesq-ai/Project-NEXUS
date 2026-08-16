// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Tenants;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Tenant hierarchy writes (R-26).
///
/// 🔴 R-3 added the hierarchy columns and backfilled them, so the tree existed
/// but nothing could change it: all six super-admin tenant write endpoints were
/// no-op stubs. One answered "Tenant deleted" while the community stayed fully
/// live — a destructive-sounding confirmation for something that never happened.
///
/// The weight here is on the rules whose absence causes real damage rather than
/// a wrong message: a move that detaches a subtree, a move that escapes the
/// caller's own subtree, and a delete that strands children.
/// </summary>
[Collection("Integration")]
public sealed class TenantHierarchyWriteTests : IntegrationTestBase
{
    public TenantHierarchyWriteTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static TenantHierarchyService Service(IServiceProvider services)
        => services.GetRequiredService<TenantHierarchyService>();

    /// <summary>Creates a root community with a correct materialised path.</summary>
    private async Task<Tenant> SeedRootAsync(bool allowsSubtenants = true)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var tenant = new Tenant
        {
            Name = $"Root {Guid.NewGuid():N}"[..12],
            Slug = $"root-{Guid.NewGuid():N}"[..16],
            IsActive = true,
            Depth = 0,
            AllowsSubtenants = allowsSubtenants,
            MaxDepth = 3,
            CreatedAt = DateTime.UtcNow,
        };
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        tenant.Path = $"/{tenant.Id}/";
        await db.SaveChangesAsync();
        return tenant;
    }

    private async Task<Tenant> GetAsync(int id)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Tenants.IgnoreQueryFilters().AsNoTracking().SingleAsync(t => t.Id == id);
    }

    [Fact]
    public async Task CreatingASubCommunity_GivesItAPathAndDepthBelowItsParent()
    {
        var parent = await SeedRootAsync();

        using var scope = Factory.Services.CreateScope();
        var result = await Service(scope.ServiceProvider).CreateAsync(
            "Branch community", null, parent.Id, null, null,
            allowsSubtenants: false, maxDepth: null, CancellationToken.None);

        result.Success.Should().BeTrue(result.Error);
        var created = await GetAsync(result.TenantId!.Value);
        created.ParentId.Should().Be(parent.Id);
        created.Depth.Should().Be(1);
        created.Path.Should().Be($"{parent.Path}{created.Id}/",
            "a community with no path is treated as corrupt by move and by subtree access");
    }

    [Fact]
    public async Task ASlugThatCollidesWithAPlatformRoute_IsRefused()
    {
        var parent = await SeedRootAsync();
        using var scope = Factory.Services.CreateScope();
        var service = Service(scope.ServiceProvider);

        foreach (var reserved in new[] { "admin", "api", "settings" })
        {
            var result = await service.CreateAsync(
                "Colliding", reserved, parent.Id, null, null, false, null, CancellationToken.None);
            result.Success.Should().BeFalse($"a community slugged '{reserved}' would be unreachable");
        }

        var badFormat = await service.CreateAsync(
            "Bad", "Not A Slug!", parent.Id, null, null, false, null, CancellationToken.None);
        badFormat.Success.Should().BeFalse();
    }

    [Fact]
    public async Task ACommunityThatIsNotAHub_CannotBeGivenChildren()
    {
        var parent = await SeedRootAsync(allowsSubtenants: false);

        using var scope = Factory.Services.CreateScope();
        var result = await Service(scope.ServiceProvider).CreateAsync(
            "Child", null, parent.Id, null, null, false, null, CancellationToken.None);

        result.Success.Should().BeFalse("only the master community and hubs may parent");
    }

    [Fact]
    public async Task DeletingIsADeactivation_AndIsRefusedWhileActiveChildrenExist()
    {
        var parent = await SeedRootAsync();
        using var scope = Factory.Services.CreateScope();
        var service = Service(scope.ServiceProvider);

        var child = await service.CreateAsync(
            "Child", null, parent.Id, null, null, false, null, CancellationToken.None);
        child.Success.Should().BeTrue(child.Error);

        var refused = await service.DeleteAsync(parent.Id, hardDelete: false, CancellationToken.None);
        refused.Success.Should().BeFalse(
            "the children would keep a path through a parent that is gone");
        (await GetAsync(parent.Id)).IsActive.Should().BeTrue();

        // Deactivate the child, and the parent can then go.
        (await service.DeleteAsync(child.TenantId!.Value, false, CancellationToken.None))
            .Success.Should().BeTrue();
        var allowed = await service.DeleteAsync(parent.Id, false, CancellationToken.None);
        allowed.Success.Should().BeTrue(allowed.Error);

        var after = await GetAsync(parent.Id);
        after.IsActive.Should().BeFalse("delete is a deactivation");
        after.Id.Should().Be(parent.Id, "the row survives — purging is a separate, god-only operation");
    }

    [Fact]
    public async Task TheMasterCommunity_CanNeverBeDeletedOrMoved()
    {
        var elsewhere = await SeedRootAsync();
        using var scope = Factory.Services.CreateScope();
        var service = Service(scope.ServiceProvider);

        (await service.DeleteAsync(1, false, CancellationToken.None)).Success.Should().BeFalse();
        (await service.MoveAsync(1, elsewhere.Id, CancellationToken.None)).Success.Should().BeFalse();
        (await GetAsync(1)).IsActive.Should().BeTrue();
    }

    [Fact]
    public async Task HardDelete_IsRefusedOutright()
    {
        var tenant = await SeedRootAsync();
        using var scope = Factory.Services.CreateScope();

        var result = await Service(scope.ServiceProvider)
            .DeleteAsync(tenant.Id, hardDelete: true, CancellationToken.None);

        result.Success.Should().BeFalse();
        (await GetAsync(tenant.Id)).Should().NotBeNull("nothing was destroyed");
    }

    [Fact]
    public async Task MovingACommunity_RewritesEveryDescendantsPathAndDepth()
    {
        var oldParent = await SeedRootAsync();
        var newParent = await SeedRootAsync();

        using var scope = Factory.Services.CreateScope();
        var service = Service(scope.ServiceProvider);

        var mid = await service.CreateAsync("Mid", null, oldParent.Id, null, null, true, null, CancellationToken.None);
        mid.Success.Should().BeTrue(mid.Error);
        var leaf = await service.CreateAsync("Leaf", null, mid.TenantId!.Value, null, null, false, null, CancellationToken.None);
        leaf.Success.Should().BeTrue(leaf.Error);

        var moved = await service.MoveAsync(mid.TenantId!.Value, newParent.Id, CancellationToken.None);
        moved.Success.Should().BeTrue(moved.Error);

        var midAfter = await GetAsync(mid.TenantId!.Value);
        var leafAfter = await GetAsync(leaf.TenantId!.Value);

        midAfter.ParentId.Should().Be(newParent.Id);
        midAfter.Path.Should().Be($"{newParent.Path}{midAfter.Id}/");
        leafAfter.Path.Should().Be($"{midAfter.Path}{leafAfter.Id}/",
            "updating only the moved row leaves the whole subtree routed through a parent it no longer has");
        leafAfter.Depth.Should().Be(midAfter.Depth + 1);
    }

    [Fact]
    public async Task ACommunityCannotBeMovedUnderItsOwnDescendant()
    {
        var root = await SeedRootAsync();
        using var scope = Factory.Services.CreateScope();
        var service = Service(scope.ServiceProvider);

        var child = await service.CreateAsync("Child", null, root.Id, null, null, true, null, CancellationToken.None);
        var grandchild = await service.CreateAsync(
            "Grandchild", null, child.TenantId!.Value, null, null, true, null, CancellationToken.None);

        (await service.MoveAsync(child.TenantId!.Value, grandchild.TenantId!.Value, CancellationToken.None))
            .Success.Should().BeFalse("that detaches the subtree from the tree entirely");
        (await service.MoveAsync(child.TenantId!.Value, child.TenantId!.Value, CancellationToken.None))
            .Success.Should().BeFalse("a community cannot be its own parent");
    }

    /// <summary>
    /// 🔴 The single most important case here. The cycle check is a string
    /// prefix match, and EVERY string starts with "", so a community with no
    /// path would make any destination look acceptable — including one inside
    /// its own subtree. It must refuse rather than guess.
    /// </summary>
    [Fact]
    public async Task AMoveIsRefusedWhenPathDataIsMissing()
    {
        var destination = await SeedRootAsync();
        int strandedId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stranded = new Tenant
            {
                Name = "No path",
                Slug = $"nopath-{Guid.NewGuid():N}"[..18],
                IsActive = true,
                Depth = 0,
                Path = null,
                CreatedAt = DateTime.UtcNow,
            };
            db.Tenants.Add(stranded);
            await db.SaveChangesAsync();
            strandedId = stranded.Id;
        }

        using var runScope = Factory.Services.CreateScope();
        var result = await Service(runScope.ServiceProvider)
            .MoveAsync(strandedId, destination.Id, CancellationToken.None);

        result.Success.Should().BeFalse("fail closed — an empty prefix matches everything");
        (await GetAsync(strandedId)).ParentId.Should().BeNull("nothing was changed");
    }

    [Fact]
    public async Task TurningOffHubCapability_IsRefusedWhileChildrenExist_AndOtherwiseRemovesNetworkAdmins()
    {
        var hub = await SeedRootAsync();
        using var scope = Factory.Services.CreateScope();
        var service = Service(scope.ServiceProvider);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var networkAdmin = new User
        {
            TenantId = hub.Id,
            Email = $"network-admin-{Guid.NewGuid():N}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Network",
            LastName = "Admin",
            Role = "admin",
            IsActive = true,
            IsTenantSuperAdmin = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow,
        };
        db.Users.Add(networkAdmin);
        await db.SaveChangesAsync();

        var child = await service.CreateAsync("Child", null, hub.Id, null, null, false, null, CancellationToken.None);
        child.Success.Should().BeTrue(child.Error);

        (await service.ToggleSubtenantCapabilityAsync(hub.Id, false, CancellationToken.None))
            .Success.Should().BeFalse("its sub-communities would be orphaned by the setting alone");

        // Move the child away, then the hub can stop being a hub.
        var elsewhere = await SeedRootAsync();
        (await service.MoveAsync(child.TenantId!.Value, elsewhere.Id, CancellationToken.None))
            .Success.Should().BeTrue();

        (await service.ToggleSubtenantCapabilityAsync(hub.Id, false, CancellationToken.None))
            .Success.Should().BeTrue();

        using var checkScope = Factory.Services.CreateScope();
        var checkDb = checkScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var after = await checkDb.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(u => u.Id == networkAdmin.Id);
        after.IsTenantSuperAdmin.Should().BeFalse(
            "network admin is a cross-community power justified only by having sub-communities; "
            + "leaving it set keeps a privilege whose justification was withdrawn");
    }
}
