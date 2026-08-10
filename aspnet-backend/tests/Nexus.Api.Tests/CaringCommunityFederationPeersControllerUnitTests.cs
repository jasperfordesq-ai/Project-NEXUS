// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityFederationPeersControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelFederationPeerRoutes()
    {
        typeof(AdminCaringCommunityFederationPeersController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/federation-peers");

        typeof(AdminCaringCommunityFederationPeersController)
            .GetMethod(nameof(AdminCaringCommunityFederationPeersController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityFederationPeersController)
            .GetMethod(nameof(AdminCaringCommunityFederationPeersController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityFederationPeersController)
            .GetMethod(nameof(AdminCaringCommunityFederationPeersController.UpdateStatus))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}/status");
        typeof(AdminCaringCommunityFederationPeersController)
            .GetMethod(nameof(AdminCaringCommunityFederationPeersController.RotateSecret))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/rotate-secret");
        typeof(AdminCaringCommunityFederationPeersController)
            .GetMethod(nameof(AdminCaringCommunityFederationPeersController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{id:int}");

        var directoryType = ResolveFederationDirectoryControllerType();
        directoryType.Should().NotBeNull();
        var type = directoryType!;
        type.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/federation-directory");
        var index = type.GetMethod("Index");
        index.Should().NotBeNull();
        index!.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
    }

    [Fact]
    public async Task Index_ReturnsCurrentTenantPeersSortedWithSecretRedacted()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringFederationPeers.AddRange(
            Peer(42, "beta", "Beta Peer", "secret-beta"),
            Peer(42, "alpha", "Alpha Peer", "secret-alpha"),
            Peer(7, "other", "Other Tenant", "secret-other"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var peers = document.RootElement.GetProperty("data").GetProperty("peers").EnumerateArray().ToArray();
        peers.Select(peer => peer.GetProperty("display_name").GetString())
            .Should().Equal("Alpha Peer", "Beta Peer");
        peers[0].GetProperty("shared_secret").ValueKind.Should().Be(JsonValueKind.Null);
        peers[0].GetProperty("shared_secret_set").GetBoolean().Should().BeTrue();
        peers[0].GetProperty("tenant_id").GetInt32().Should().Be(42);
    }

    [Fact]
    public async Task Directory_ReturnsDiscoverableActivePeersForCurrentTenantOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringFederationPeers.AddRange(
            Peer(42, "beta", "Beta Peer", "secret-beta", status: "active"),
            Peer(42, "alpha", "Alpha Peer", "secret-alpha", status: "active"),
            Peer(42, "pending", "Pending Peer", "secret-pending", status: "pending"),
            Peer(42, "suspended", "Suspended Peer", "secret-suspended", status: "suspended"),
            Peer(7, "other", "Other Tenant", "secret-other", status: "active"));
        await db.SaveChangesAsync();
        var controller = CreateDirectoryController(db, tenant, userId: 9001);

        var result = await InvokeActionAsync(controller, "Index", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var peers = document.RootElement.GetProperty("data").GetProperty("peers").EnumerateArray().ToArray();
        peers.Select(peer => peer.GetProperty("display_name").GetString())
            .Should().Equal("Alpha Peer", "Beta Peer");
        peers.Select(peer => peer.GetProperty("slug").GetString())
            .Should().Equal("alpha", "beta");
        peers[0].GetProperty("base_url").GetString().Should().Be("https://alpha.example.test");
        peers[0].GetProperty("region").ValueKind.Should().Be(JsonValueKind.Null);
        peers[0].GetProperty("member_count_bucket").ValueKind.Should().Be(JsonValueKind.Null);
        peers[0].GetProperty("accepts_inbound_transfers").GetBoolean().Should().BeTrue();
        peers[0].TryGetProperty("shared_secret", out _).Should().BeFalse();
        peers[0].TryGetProperty("notes", out _).Should().BeFalse();
        peers[0].TryGetProperty("tenant_id", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Directory_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateDirectoryController(db, tenant, userId: 9001);

        var result = await InvokeActionAsync(controller, "Index", CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task Store_CreatesTenantScopedPeerAndRevealsSecretOnce()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Store(new CaringFederationPeerRequest
        {
            PeerSlug = "kiss-zug",
            DisplayName = "KISS Zug",
            BaseUrl = "https://api.kiss-zug.example/",
            Status = "active",
            Notes = "Signed AG23 agreement."
        }, CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var row = document.RootElement.GetProperty("data");
        row.GetProperty("peer_slug").GetString().Should().Be("kiss-zug");
        row.GetProperty("base_url").GetString().Should().Be("https://api.kiss-zug.example");
        row.GetProperty("status").GetString().Should().Be("active");
        row.GetProperty("shared_secret").GetString().Should().MatchRegex("^[a-f0-9]{64}$");
        row.GetProperty("shared_secret_set").GetBoolean().Should().BeTrue();

        var stored = await db.CaringFederationPeers.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.PeerSlug.Should().Be("kiss-zug");
        stored.SharedSecret.Should().HaveLength(64);
    }

    [Fact]
    public async Task Store_InvalidSlugReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Store(new CaringFederationPeerRequest
        {
            PeerSlug = "Bad Slug",
            DisplayName = "Bad",
            BaseUrl = "https://example.test"
        }, CancellationToken.None);

        var invalid = result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task UpdateStatusAndRotateSecret_AreTenantScopedAndRespectSecretVisibility()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringFederationPeers.AddRange(
            Peer(42, "alpha", "Alpha", "old-secret-old-secret-old-secret-1234", status: "pending"),
            Peer(7, "alpha", "Other", "other-secret-other-secret-other-1234", status: "active"));
        await db.SaveChangesAsync();
        var id = await db.CaringFederationPeers.IgnoreQueryFilters()
            .Where(peer => peer.TenantId == 42)
            .Select(peer => peer.Id)
            .SingleAsync();
        var controller = CreateController(db, tenant);

        var statusResult = await controller.UpdateStatus(id, new CaringFederationPeerStatusRequest
        {
            Status = "active"
        }, CancellationToken.None);

        var statusOk = statusResult.Should().BeOfType<OkObjectResult>().Subject;
        using var statusDocument = JsonDocument.Parse(JsonSerializer.Serialize(statusOk.Value));
        var statusRow = statusDocument.RootElement.GetProperty("data");
        statusRow.GetProperty("status").GetString().Should().Be("active");
        statusRow.GetProperty("shared_secret").ValueKind.Should().Be(JsonValueKind.Null);

        var rotateResult = await controller.RotateSecret(id, CancellationToken.None);

        var rotateOk = rotateResult.Should().BeOfType<OkObjectResult>().Subject;
        using var rotateDocument = JsonDocument.Parse(JsonSerializer.Serialize(rotateOk.Value));
        var rotateRow = rotateDocument.RootElement.GetProperty("data");
        var newSecret = rotateRow.GetProperty("shared_secret").GetString();
        newSecret.Should().MatchRegex("^[a-f0-9]{64}$");
        newSecret.Should().NotBe("old-secret-old-secret-old-secret-1234");

        var stored = await db.CaringFederationPeers.IgnoreQueryFilters().SingleAsync(peer => peer.Id == id);
        stored.Status.Should().Be("active");
        stored.SharedSecret.Should().Be(newSecret);
        (await db.CaringFederationPeers.IgnoreQueryFilters().SingleAsync(peer => peer.TenantId == 7))
            .SharedSecret.Should().Be("other-secret-other-secret-other-1234");
    }

    [Fact]
    public async Task Destroy_DeletesCurrentTenantPeerOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringFederationPeers.AddRange(
            Peer(42, "delete-me", "Delete Me", "tenant-secret-tenant-secret-1234"),
            Peer(7, "delete-me", "Other Tenant", "other-secret-other-secret-1234"));
        await db.SaveChangesAsync();
        var id = await db.CaringFederationPeers.IgnoreQueryFilters()
            .Where(peer => peer.TenantId == 42)
            .Select(peer => peer.Id)
            .SingleAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Destroy(id, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        (await db.CaringFederationPeers.IgnoreQueryFilters().AnyAsync(peer => peer.TenantId == 42))
            .Should().BeFalse();
        (await db.CaringFederationPeers.IgnoreQueryFilters().AnyAsync(peer => peer.TenantId == 7))
            .Should().BeTrue();
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static CaringFederationPeer Peer(
        int tenantId,
        string slug,
        string displayName,
        string secret,
        string status = "active")
    {
        return new CaringFederationPeer
        {
            TenantId = tenantId,
            PeerSlug = slug,
            DisplayName = displayName,
            BaseUrl = $"https://{slug}.example.test",
            SharedSecret = secret,
            Status = status,
            Notes = $"{displayName} notes",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static Type? ResolveFederationDirectoryControllerType()
    {
        return Type.GetType("Nexus.Api.Controllers.CaringCommunityFederationDirectoryController, Nexus.Api");
    }

    private static ControllerBase CreateDirectoryController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var controllerType = ResolveFederationDirectoryControllerType();
        controllerType.Should().NotBeNull();
        var service = new CaringFederationPeerService(db, tenant);
        var controller = Activator.CreateInstance(controllerType!, service, tenant)
            .Should().BeAssignableTo<ControllerBase>().Subject;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), role: "member");
        return controller;
    }

    private static async Task<IActionResult> InvokeActionAsync(
        object controller,
        string actionName,
        params object?[] parameters)
    {
        var method = controller.GetType().GetMethod(actionName);
        method.Should().NotBeNull();
        var result = method!.Invoke(controller, parameters);
        return await result.Should().BeAssignableTo<Task<IActionResult>>().Subject;
    }

    private static AdminCaringCommunityFederationPeersController CreateController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var service = new CaringFederationPeerService(db, tenant);
        return new AdminCaringCommunityFederationPeersController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId: 9001, tenantId: tenant.GetTenantIdOrThrow(), role: "admin")
        };
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, role),
                    new Claim("role", role)
                ], "Test"))
            }
        };
    }
}
