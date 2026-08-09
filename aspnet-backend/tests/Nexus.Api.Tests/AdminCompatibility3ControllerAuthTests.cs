// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for AdminCompatibility3Controller (React admin route aliases part 3).
 * Verifies the [Authorize(Policy = "AdminOnly")] gate on GET /api/admin/enterprise/roles.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminCompatibility3ControllerAuthTests : IntegrationTestBase
{
    private readonly HashSet<int> _syntheticActorIds = [];
    private readonly List<TenantConfig> _syntheticHubConfigs = [];

    public AdminCompatibility3ControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_syntheticActorIds.Count > 0)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var hubConfigIds = _syntheticHubConfigs
                    .Where(config => config.Id > 0)
                    .Select(config => config.Id)
                    .ToArray();
                if (hubConfigIds.Length > 0)
                {
                    await db.TenantConfigs
                        .IgnoreQueryFilters()
                        .Where(config => hubConfigIds.Contains(config.Id))
                        .ExecuteDeleteAsync();
                }
                await db.RefreshTokens
                    .IgnoreQueryFilters()
                    .Where(token => _syntheticActorIds.Contains(token.UserId))
                    .ExecuteDeleteAsync();
                await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => _syntheticActorIds.Contains(user.Id))
                    .ExecuteDeleteAsync();
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    private const string Path = "/api/admin/enterprise/roles";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminCompatibility3_AuthGate(string role, int expectedStatus)
    {
        if (role == "anonymous")
        {
            ClearAuthToken();
        }
        else
        {
            var email = role == "admin" ? "admin@test.com" : "member@test.com";
            var token = await GetAccessTokenAsync(email, "test-tenant");
            SetAuthToken(token);
        }

        var resp = await Client.GetAsync(Path);

        if (role == "admin")
        {
            var code = (int)resp.StatusCode;
            code.Should().NotBe(401, $"admin must not get auth-rejected on {Path}");
            code.Should().NotBe(403, $"{role} must not get authz-rejected on {Path}");
        }
        else
        {
            ((int)resp.StatusCode).Should().Be(expectedStatus);
        }
    }

    [Fact]
    public async Task SuperRoutes_RequirePlatformAccess_AndGlobalPrivilegeWritesRequireGod()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/v2/admin/super/dashboard")).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.TenantSuperAdmin);
        (await Client.GetAsync("/api/v2/admin/super/dashboard")).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);
        (await Client.GetAsync("/api/v2/admin/super/dashboard")).StatusCode
            .Should().Be(HttpStatusCode.OK);
        (await Client.PostAsync("/api/v2/admin/super/users/999999/grant-global-super-admin", null)).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.God);
        (await Client.GetAsync("/api/v2/admin/super/dashboard")).StatusCode
            .Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SuperTenantV2Aliases_ReturnLaravelReactAdminShapes()
    {
        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var list = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/tenants?search=test&is_active=true"));
        list.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        list.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var detail = await ReadJsonAsync(await Client.GetAsync($"/api/v2/admin/super/tenants/{TestData.Tenant1.Id}"));
        detail.GetProperty("id").GetInt32().Should().Be(TestData.Tenant1.Id);
        detail.GetProperty("is_active").GetBoolean().Should().BeTrue();

        var hierarchy = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/tenants/hierarchy"));
        hierarchy.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var created = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/tenants", new
        {
            name = "React parity tenant",
            slug = "react-parity-tenant"
        }));
        created.GetProperty("success").GetBoolean().Should().BeTrue();

        var updated = await ReadJsonAsync(await Client.PutAsJsonAsync($"/api/v2/admin/super/tenants/{TestData.Tenant1.Id}", new
        {
            name = "Updated React parity tenant"
        }));
        updated.GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await ReadJsonAsync(await Client.DeleteAsync($"/api/v2/admin/super/tenants/{TestData.Tenant1.Id}"));
        deleted.GetProperty("success").GetBoolean().Should().BeTrue();

        var reactivated = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/tenants/{TestData.Tenant1.Id}/reactivate", new { }));
        reactivated.GetProperty("success").GetBoolean().Should().BeTrue();

        var toggle = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/tenants/{TestData.Tenant1.Id}/toggle-hub", new { enable = true }));
        toggle.GetProperty("success").GetBoolean().Should().BeTrue();

        var moved = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/tenants/{TestData.Tenant1.Id}/move", new { new_parent_id = TestData.Tenant2.Id }));
        moved.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task SuperUserPrivilegeV2Aliases_ReturnLaravelDataEnvelopesAndPersistState()
    {
        int tenantUserId;
        int globalUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var tenantUser = NewSuperPanelUser("super-panel-tenant", TestData.Tenant1.Id);
            var globalUser = NewSuperPanelUser("super-panel-global", TestData.Tenant2.Id);
            ConfigureHub(db, TestData.Tenant1.Id);
            db.Users.AddRange(tenantUser, globalUser);
            await db.SaveChangesAsync();
            tenantUserId = tenantUser.Id;
            globalUserId = globalUser.Id;
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var grantTenant = await ReadJsonAsync(await Client.PostAsync($"/api/v2/admin/super/users/{tenantUserId}/grant-super-admin", null));
        grantTenant.TryGetProperty("success", out _).Should().BeFalse();
        var grantTenantData = grantTenant.GetProperty("data");
        grantTenantData.GetProperty("granted").GetBoolean().Should().BeTrue();
        grantTenantData.GetProperty("user_id").GetInt32().Should().Be(tenantUserId);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == tenantUserId);
            user.Role.Should().Be("admin");
            user.IsTenantSuperAdmin.Should().BeTrue();
        }

        var revokeTenant = await ReadJsonAsync(await Client.PostAsync($"/api/v2/admin/super/users/{tenantUserId}/revoke-super-admin", null));
        var revokeTenantData = revokeTenant.GetProperty("data");
        revokeTenantData.GetProperty("revoked").GetBoolean().Should().BeTrue();
        revokeTenantData.GetProperty("user_id").GetInt32().Should().Be(tenantUserId);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == tenantUserId);
            user.Role.Should().Be("admin");
            user.IsTenantSuperAdmin.Should().BeFalse();
        }

        var nonHubGrant = await Client.PostAsync($"/api/v2/admin/super/users/{globalUserId}/grant-super-admin", null);
        nonHubGrant.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            ConfigureHub(db, TestData.Tenant2.Id);
            await db.SaveChangesAsync();
        }

        var godActorId = await AuthenticateAsSyntheticActorAsync(SyntheticActor.God);
        var godToken = Client.DefaultRequestHeaders.Authorization!.Parameter!;
        var grantGlobal = await ReadJsonAsync(await Client.PostAsync($"/api/v2/admin/super/users/{globalUserId}/grant-global-super-admin", null));
        grantGlobal.TryGetProperty("success", out _).Should().BeFalse();
        var grantGlobalData = grantGlobal.GetProperty("data");
        grantGlobalData.GetProperty("granted").GetBoolean().Should().BeTrue();
        grantGlobalData.GetProperty("user_id").GetInt32().Should().Be(globalUserId);
        grantGlobalData.GetProperty("level").GetString().Should().Be("global");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == globalUserId);
            user.Role.Should().Be("admin");
            user.IsSuperAdmin.Should().BeTrue();
            (await db.TenantConfigs.IgnoreQueryFilters().AnyAsync(c =>
                c.TenantId == TestData.Tenant2.Id && c.Key == "super_admins.global_user_ids")).Should().BeFalse();
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);
        (await Client.PostAsync($"/api/v2/admin/super/users/{globalUserId}/grant-super-admin", null)).StatusCode
            .Should().Be(HttpStatusCode.OK);
        (await Client.PostAsync($"/api/v2/admin/super/users/{globalUserId}/revoke-super-admin", null)).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);

        SetAuthToken(godToken);
        (await Client.PostAsync($"/api/v2/admin/super/users/{globalUserId}/revoke-super-admin", null)).StatusCode
            .Should().Be(HttpStatusCode.OK);

        var selfRevoke = await Client.PostAsync($"/api/v2/admin/super/users/{godActorId}/revoke-global-super-admin", null);
        selfRevoke.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var revokeGlobal = await ReadJsonAsync(await Client.PostAsync($"/api/v2/admin/super/users/{globalUserId}/revoke-global-super-admin", null));
        var revokeGlobalData = revokeGlobal.GetProperty("data");
        revokeGlobalData.GetProperty("revoked").GetBoolean().Should().BeTrue();
        revokeGlobalData.GetProperty("user_id").GetInt32().Should().Be(globalUserId);
        revokeGlobalData.GetProperty("level").GetString().Should().Be("global");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == globalUserId);
            user.Role.Should().Be("admin");
            user.IsSuperAdmin.Should().BeFalse();
            user.IsTenantSuperAdmin.Should().BeFalse();
        }

        var missing = await Client.PostAsync("/api/v2/admin/super/users/999999/grant-super-admin", null);
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var missingJson = await missing.Content.ReadFromJsonAsync<JsonElement>();
        missingJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task SuperUserMoveV2Aliases_ReturnLaravelDataEnvelopesAndUpdateTenantAndRole()
    {
        int moveUserId;
        int promoteUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var moveUser = NewSuperPanelUser("super-panel-move", TestData.Tenant1.Id);
            moveUser.Role = "admin";
            moveUser.IsTenantSuperAdmin = true;
            var promoteUser = NewSuperPanelUser("super-panel-promote", TestData.Tenant2.Id);
            ConfigureHub(db, TestData.Tenant1.Id);
            db.Users.AddRange(moveUser, promoteUser);
            await db.SaveChangesAsync();
            moveUserId = moveUser.Id;
            promoteUserId = promoteUser.Id;
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var move = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/users/{moveUserId}/move-tenant", new
        {
            new_tenant_id = TestData.Tenant2.Id
        }));
        move.TryGetProperty("success", out _).Should().BeFalse();
        var moveData = move.GetProperty("data");
        moveData.GetProperty("moved").GetBoolean().Should().BeTrue();
        moveData.GetProperty("user_id").GetInt32().Should().Be(moveUserId);
        moveData.GetProperty("old_tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        moveData.GetProperty("new_tenant_id").GetInt32().Should().Be(TestData.Tenant2.Id);
        moveData.GetProperty("records_moved").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        moveData.GetProperty("tables_failed").ValueKind.Should().Be(JsonValueKind.Array);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var movedUser = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == moveUserId);
            movedUser.TenantId.Should().Be(TestData.Tenant2.Id);
            movedUser.Role.Should().Be("admin");
            movedUser.IsTenantSuperAdmin.Should().BeFalse();
        }

        var promote = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/users/{promoteUserId}/move-and-promote", new
        {
            target_tenant_id = TestData.Tenant1.Id
        }));
        var promoteData = promote.GetProperty("data");
        promoteData.GetProperty("moved").GetBoolean().Should().BeTrue();
        promoteData.GetProperty("promoted").GetBoolean().Should().BeTrue();
        promoteData.GetProperty("user_id").GetInt32().Should().Be(promoteUserId);
        promoteData.GetProperty("old_tenant_id").GetInt32().Should().Be(TestData.Tenant2.Id);
        promoteData.GetProperty("new_tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var promotedUser = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == promoteUserId);
            promotedUser.TenantId.Should().Be(TestData.Tenant1.Id);
            promotedUser.Role.Should().Be("admin");
            promotedUser.IsTenantSuperAdmin.Should().BeTrue();
        }

        var nonHubPromotion = await Client.PostAsJsonAsync($"/api/v2/admin/super/users/{promoteUserId}/move-and-promote", new
        {
            target_tenant_id = TestData.Tenant2.Id
        });
        nonHubPromotion.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var missingTenant = await Client.PostAsJsonAsync($"/api/v2/admin/super/users/{moveUserId}/move-tenant", new { });
        missingTenant.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var missingTenantJson = await missingTenant.Content.ReadFromJsonAsync<JsonElement>();
        missingTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task SuperBulkOperationV2Aliases_ReturnLaravelDataEnvelopesAndPersistBulkState()
    {
        int userOneId;
        int userTwoId;
        int targetTenantId;
        int tenantToDeactivateId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var targetTenant = new Tenant
            {
                Name = "Bulk move target",
                Slug = $"bulk-move-target-{Guid.NewGuid():N}",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            var tenantToDeactivate = new Tenant
            {
                Name = "Bulk deactivate tenant",
                Slug = $"bulk-deactivate-{Guid.NewGuid():N}",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            var userOne = NewSuperPanelUser("super-panel-bulk-one", TestData.Tenant1.Id);
            var userTwo = NewSuperPanelUser("super-panel-bulk-two", TestData.Tenant2.Id);
            db.Tenants.AddRange(targetTenant, tenantToDeactivate);
            await db.SaveChangesAsync();
            ConfigureHub(db, targetTenant.Id);
            db.Users.AddRange(userOne, userTwo);
            await db.SaveChangesAsync();
            userOneId = userOne.Id;
            userTwoId = userTwo.Id;
            targetTenantId = targetTenant.Id;
            tenantToDeactivateId = tenantToDeactivate.Id;
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var move = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/bulk/move-users", new
        {
            user_ids = new[] { userOneId, userTwoId, 999999 },
            target_tenant_id = targetTenantId,
            grant_super_admin = true
        }));
        move.TryGetProperty("success", out _).Should().BeFalse();
        var moveData = move.GetProperty("data");
        moveData.GetProperty("moved_count").GetInt32().Should().Be(2);
        moveData.GetProperty("total_requested").GetInt32().Should().Be(3);
        moveData.GetProperty("errors").ValueKind.Should().Be(JsonValueKind.Array);
        moveData.GetProperty("errors").EnumerateArray().Should().Contain(e => e.GetString()!.Contains("999999"));

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var movedUsers = await db.Users.IgnoreQueryFilters()
                .Where(u => u.Id == userOneId || u.Id == userTwoId)
                .OrderBy(u => u.Id)
                .ToListAsync();
            movedUsers.Should().HaveCount(2);
            movedUsers.Should().OnlyContain(u => u.TenantId == targetTenantId);
            movedUsers.Should().OnlyContain(u => u.Role == "admin");
            movedUsers.Should().OnlyContain(u => u.IsTenantSuperAdmin);
        }

        var nonHubGrant = await Client.PostAsJsonAsync("/api/v2/admin/super/bulk/move-users", new
        {
            user_ids = new[] { userOneId },
            target_tenant_id = tenantToDeactivateId,
            grant_super_admin = true
        });
        nonHubGrant.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var moveToNonHub = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/bulk/move-users", new
        {
            user_ids = new[] { userOneId },
            target_tenant_id = tenantToDeactivateId,
            grant_super_admin = false
        }));
        moveToNonHub.GetProperty("data").GetProperty("moved_count").GetInt32().Should().Be(1);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var movedUser = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == userOneId);
            movedUser.TenantId.Should().Be(tenantToDeactivateId);
            movedUser.Role.Should().Be("admin");
            movedUser.IsTenantSuperAdmin.Should().BeFalse();
        }

        var update = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/bulk/update-tenants", new
        {
            tenant_ids = new[] { tenantToDeactivateId, 999998 },
            action = "deactivate"
        }));
        update.TryGetProperty("success", out _).Should().BeFalse();
        var updateData = update.GetProperty("data");
        updateData.GetProperty("updated_count").GetInt32().Should().Be(1);
        updateData.GetProperty("total_requested").GetInt32().Should().Be(2);
        updateData.GetProperty("action").GetString().Should().Be("deactivate");
        updateData.GetProperty("errors").EnumerateArray().Should().Contain(e => e.GetString()!.Contains("999998"));

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var tenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == tenantToDeactivateId);
            tenant.IsActive.Should().BeFalse();
        }

        var invalid = await Client.PostAsJsonAsync("/api/v2/admin/super/bulk/update-tenants", new
        {
            tenant_ids = new[] { tenantToDeactivateId },
            action = "archive"
        });
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var invalidJson = await invalid.Content.ReadFromJsonAsync<JsonElement>();
        invalidJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task SuperAuditV2Alias_ReturnsLaravelReactAuditEntriesWithFilters()
    {
        int actorId;
        int targetUserId;
        int matchingAuditId;
        var now = DateTime.UtcNow;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var actor = NewSuperPanelUser("super-panel-audit-actor", TestData.Tenant1.Id);
            actor.FirstName = "Ada";
            actor.LastName = "Audit";
            var targetUser = NewSuperPanelUser("super-panel-audit-target", TestData.Tenant1.Id);
            targetUser.FirstName = "Target";
            targetUser.LastName = "Person";
            db.Users.AddRange(actor, targetUser);
            await db.SaveChangesAsync();
            actorId = actor.Id;
            targetUserId = targetUser.Id;

            var matchingAudit = new AuditLog
            {
                TenantId = TestData.Tenant1.Id,
                UserId = actorId,
                Action = "tenant.moved",
                EntityType = "user",
                EntityId = targetUserId,
                OldValues = "{\"tenant_id\":1}",
                NewValues = "{\"tenant_id\":2}",
                Metadata = "{\"description\":\"Moved Target Person to another tenant\"}",
                CreatedAt = now.AddMinutes(-5)
            };
            var otherAudit = new AuditLog
            {
                TenantId = TestData.Tenant1.Id,
                UserId = actorId,
                Action = "tenant.updated",
                EntityType = "tenant",
                EntityId = TestData.Tenant1.Id,
                Metadata = "{\"description\":\"Updated tenant settings\"}",
                CreatedAt = now.AddMinutes(-2)
            };
            db.AuditLogs.AddRange(matchingAudit, otherAudit);
            await db.SaveChangesAsync();
            matchingAuditId = matchingAudit.Id;
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var response = await Client.GetAsync("/api/v2/admin/super/audit?action_type=tenant.moved&target_type=user&search=Target&limit=10&offset=0");
        var json = await ReadJsonAsync(response);

        json.TryGetProperty("success", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Array);
        data.GetArrayLength().Should().Be(1);

        var entry = data[0];
        entry.GetProperty("id").GetInt32().Should().Be(matchingAuditId);
        entry.GetProperty("action_type").GetString().Should().Be("tenant.moved");
        entry.GetProperty("target_type").GetString().Should().Be("user");
        entry.GetProperty("target_id").GetInt32().Should().Be(targetUserId);
        entry.GetProperty("target_label").GetString().Should().Be("Target Person");
        entry.GetProperty("actor_id").GetInt32().Should().Be(actorId);
        entry.GetProperty("actor_name").GetString().Should().Be("Ada Audit");
        entry.GetProperty("actor_email").GetString().Should().Contain("super-panel-audit-actor");
        entry.GetProperty("old_value").GetProperty("tenant_id").GetInt32().Should().Be(1);
        entry.GetProperty("new_value").GetProperty("tenant_id").GetInt32().Should().Be(2);
        entry.GetProperty("description").GetString().Should().Be("Moved Target Person to another tenant");
        entry.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task SuperFederationSystemControlsV2Aliases_ReturnLaravelDataAndPersistState()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var control = await db.FederationSystemControls.FirstOrDefaultAsync(c => c.Id == 1);
            if (control == null)
            {
                db.FederationSystemControls.Add(new FederationSystemControl
                {
                    Id = 1,
                    FederationEnabled = false,
                    EmergencyLockdown = false,
                    RequireTenantWhitelist = true,
                    MaxPartnersPerTenant = 100,
                    UpdatedAt = DateTime.UtcNow.AddDays(-1)
                });
            }
            else
            {
                control.FederationEnabled = false;
                control.EmergencyLockdown = false;
                control.RequireTenantWhitelist = true;
                control.UpdatedAt = DateTime.UtcNow.AddDays(-1);
            }

            await db.SaveChangesAsync();
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var initial = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/federation/system-controls"));
        initial.TryGetProperty("success", out _).Should().BeFalse();
        var initialData = initial.GetProperty("data");
        initialData.GetProperty("federation_enabled").GetBoolean().Should().BeFalse();
        initialData.GetProperty("whitelist_mode_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("emergency_lockdown_active").GetBoolean().Should().BeFalse();
        initialData.GetProperty("max_federation_level").GetInt32().Should().Be(4);
        initialData.GetProperty("cross_tenant_profiles_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("cross_tenant_messaging_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("cross_tenant_transactions_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("cross_tenant_listings_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("cross_tenant_events_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("cross_tenant_groups_enabled").GetBoolean().Should().BeTrue();

        var update = await ReadJsonAsync(await Client.PutAsJsonAsync("/api/v2/admin/super/federation/system-controls", new
        {
            federation_enabled = true,
            whitelist_mode_enabled = false,
            max_federation_level = 9,
            cross_tenant_messaging_enabled = false
        }));
        update.GetProperty("data").GetProperty("updated").GetBoolean().Should().BeTrue();

        var afterUpdate = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/federation/system-controls"));
        var afterUpdateData = afterUpdate.GetProperty("data");
        afterUpdateData.GetProperty("federation_enabled").GetBoolean().Should().BeTrue();
        afterUpdateData.GetProperty("whitelist_mode_enabled").GetBoolean().Should().BeFalse();
        afterUpdateData.GetProperty("max_federation_level").GetInt32().Should().Be(4);
        afterUpdateData.GetProperty("cross_tenant_messaging_enabled").GetBoolean().Should().BeFalse();

        var lockdown = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/federation/emergency-lockdown", new
        {
            reason = "contract test"
        }));
        lockdown.GetProperty("data").GetProperty("lockdown").GetBoolean().Should().BeTrue();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var control = await db.FederationSystemControls.SingleAsync(c => c.Id == 1);
            control.FederationEnabled.Should().BeTrue();
            control.RequireTenantWhitelist.Should().BeFalse();
            control.EmergencyLockdown.Should().BeTrue();
            var messaging = await db.SystemSettings.SingleAsync(s => s.Key == "federation.cross_tenant_messaging_enabled");
            messaging.Value.Should().Be("false");
        }

        var lifted = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/federation/lift-lockdown", new { }));
        lifted.GetProperty("data").GetProperty("lockdown").GetBoolean().Should().BeFalse();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var control = await db.FederationSystemControls.SingleAsync(c => c.Id == 1);
            control.EmergencyLockdown.Should().BeFalse();
        }
    }

    [Fact]
    public async Task SuperFederationWhitelistV2Aliases_ReturnLaravelDataAndPersistEntries()
    {
        int tenantId;
        const string notes = "Approved for regional federation";
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var tenant = new Tenant
            {
                Name = "Federation Whitelist Target",
                Slug = $"federation-whitelist-{Guid.NewGuid():N}",
                Domain = "federation-whitelist.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            };
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var add = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/admin/super/federation/whitelist", new
        {
            tenant_id = tenantId,
            notes
        }));
        add.TryGetProperty("success", out _).Should().BeFalse();
        var addData = add.GetProperty("data");
        addData.GetProperty("added").GetBoolean().Should().BeTrue();
        addData.GetProperty("tenant_id").GetInt32().Should().Be(tenantId);

        var list = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/federation/whitelist"));
        var rows = list.GetProperty("data").EnumerateArray().ToList();
        var row = rows.Single(r => r.GetProperty("tenant_id").GetInt32() == tenantId);
        row.GetProperty("tenant_name").GetString().Should().Be("Federation Whitelist Target");
        row.GetProperty("tenant_domain").GetString().Should().Be("federation-whitelist.example.test");
        row.GetProperty("added_by").GetInt32().Should().BeGreaterThan(0);
        row.GetProperty("added_at").GetString().Should().NotBeNullOrWhiteSpace();
        row.GetProperty("notes").GetString().Should().Be(notes);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.FederationTenantWhitelists.IgnoreQueryFilters().SingleAsync(w => w.TenantId == tenantId);
            stored.IsEnabled.Should().BeTrue();
            stored.Notes.Should().Be(notes);
            stored.ApprovedByUserId.Should().NotBeNull();
        }

        var remove = await ReadJsonAsync(await Client.DeleteAsync($"/api/v2/admin/super/federation/whitelist/{tenantId}"));
        var removeData = remove.GetProperty("data");
        removeData.GetProperty("removed").GetBoolean().Should().BeTrue();
        removeData.GetProperty("tenant_id").GetInt32().Should().Be(tenantId);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stillStored = await db.FederationTenantWhitelists.IgnoreQueryFilters().AnyAsync(w => w.TenantId == tenantId);
            stillStored.Should().BeFalse();
        }
    }

    [Fact]
    public async Task SuperFederationPartnershipV2Aliases_ReturnLaravelDataAndPersistStatuses()
    {
        int partnershipId;
        int tenantOneId;
        int tenantTwoId;
        int adminUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            adminUserId = await db.Users.IgnoreQueryFilters()
                .Where(u => u.Email == "admin@test.com")
                .Select(u => u.Id)
                .SingleAsync();
            var tenantOne = new Tenant
            {
                Name = "Federation Partner One",
                Slug = $"federation-partner-one-{Guid.NewGuid():N}",
                Domain = "partner-one.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            var tenantTwo = new Tenant
            {
                Name = "Federation Partner Two",
                Slug = $"federation-partner-two-{Guid.NewGuid():N}",
                Domain = "partner-two.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            db.Tenants.AddRange(tenantOne, tenantTwo);
            await db.SaveChangesAsync();
            tenantOneId = tenantOne.Id;
            tenantTwoId = tenantTwo.Id;

            var partnership = new FederationPartner
            {
                TenantId = tenantOneId,
                PartnerTenantId = tenantTwoId,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                CreditExchangeRate = 1.0m,
                RequestedById = adminUserId,
                ApprovedById = adminUserId,
                ApprovedAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.FederationPartners.Add(partnership);
            await db.SaveChangesAsync();
            partnershipId = partnership.Id;
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var list = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/federation/partnerships"));
        list.TryGetProperty("success", out _).Should().BeFalse();
        var data = list.GetProperty("data");
        var rows = data.GetProperty("partnerships").EnumerateArray().ToList();
        var row = rows.Single(r => r.GetProperty("id").GetInt32() == partnershipId);
        row.GetProperty("tenant_1_id").GetInt32().Should().Be(tenantOneId);
        row.GetProperty("tenant_1_name").GetString().Should().Be("Federation Partner One");
        row.GetProperty("tenant_2_id").GetInt32().Should().Be(tenantTwoId);
        row.GetProperty("tenant_2_name").GetString().Should().Be("Federation Partner Two");
        row.GetProperty("status").GetString().Should().Be("active");
        row.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("stats").GetProperty("active").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var suspend = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/federation/partnerships/{partnershipId}/suspend", new
        {
            reason = "maintenance"
        }));
        suspend.GetProperty("data").GetProperty("suspended").GetBoolean().Should().BeTrue();
        suspend.GetProperty("data").GetProperty("partnership_id").GetInt32().Should().Be(partnershipId);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.FederationPartners.IgnoreQueryFilters().SingleAsync(p => p.Id == partnershipId);
            stored.Status.Should().Be(PartnerStatus.Suspended);
        }

        var reactivate = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/federation/partnerships/{partnershipId}/reactivate", new { }));
        reactivate.GetProperty("data").GetProperty("reactivated").GetBoolean().Should().BeTrue();
        reactivate.GetProperty("data").GetProperty("partnership_id").GetInt32().Should().Be(partnershipId);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.FederationPartners.IgnoreQueryFilters().SingleAsync(p => p.Id == partnershipId);
            stored.Status.Should().Be(PartnerStatus.Active);
        }

        var terminate = await ReadJsonAsync(await Client.PostAsJsonAsync($"/api/v2/admin/super/federation/partnerships/{partnershipId}/terminate", new
        {
            reason = "contract complete"
        }));
        terminate.GetProperty("data").GetProperty("terminated").GetBoolean().Should().BeTrue();
        terminate.GetProperty("data").GetProperty("partnership_id").GetInt32().Should().Be(partnershipId);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.FederationPartners.IgnoreQueryFilters().SingleAsync(p => p.Id == partnershipId);
            stored.Status.Should().Be(PartnerStatus.Revoked);
        }
    }

    [Fact]
    public async Task SuperFederationOverviewV2Alias_ReturnsLaravelReactOverviewData()
    {
        int adminUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            adminUserId = await db.Users.IgnoreQueryFilters()
                .Where(u => u.Email == "admin@test.com")
                .Select(u => u.Id)
                .SingleAsync();

            var tenantOne = new Tenant
            {
                Name = "Federation Overview One",
                Slug = $"federation-overview-one-{Guid.NewGuid():N}",
                Domain = "overview-one.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            var tenantTwo = new Tenant
            {
                Name = "Federation Overview Two",
                Slug = $"federation-overview-two-{Guid.NewGuid():N}",
                Domain = "overview-two.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.Tenants.AddRange(tenantOne, tenantTwo);
            await db.SaveChangesAsync();

            db.FederationTenantWhitelists.Add(new FederationTenantWhitelist
            {
                TenantId = tenantOne.Id,
                IsEnabled = true,
                ApprovedByUserId = adminUserId,
                ApprovedAt = DateTime.UtcNow.AddDays(-1)
            });
            var activePartnership = new FederationPartner
            {
                TenantId = tenantOne.Id,
                PartnerTenantId = tenantTwo.Id,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                CreditExchangeRate = 1.0m,
                RequestedById = adminUserId,
                ApprovedById = adminUserId,
                ApprovedAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            };
            var pendingPartnership = new FederationPartner
            {
                TenantId = tenantTwo.Id,
                PartnerTenantId = tenantOne.Id,
                Status = PartnerStatus.Pending,
                CreditExchangeRate = 1.0m,
                RequestedById = adminUserId,
                CreatedAt = DateTime.UtcNow.AddHours(-12)
            };
            db.FederationPartners.AddRange(activePartnership, pendingPartnership);
            db.AuditLogs.Add(new AuditLog
            {
                TenantId = tenantOne.Id,
                UserId = adminUserId,
                Action = "federation.whitelist.added",
                EntityType = "tenant",
                EntityId = tenantOne.Id,
                Metadata = "{\"description\":\"Tenant added to federation whitelist\"}",
                CreatedAt = DateTime.UtcNow.AddMinutes(-10)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var overview = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/federation"));
        overview.TryGetProperty("success", out _).Should().BeFalse();
        var data = overview.GetProperty("data");
        var controls = data.GetProperty("system_controls");
        controls.GetProperty("federation_enabled").ValueKind.Should().Be(JsonValueKind.True);
        controls.GetProperty("max_federation_level").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        controls.GetProperty("cross_tenant_messaging_enabled").ValueKind.Should().Be(JsonValueKind.True);
        var stats = data.GetProperty("partnership_stats");
        stats.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(2);
        stats.GetProperty("active").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        stats.GetProperty("pending").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        stats.GetProperty("suspended").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        data.GetProperty("whitelisted_count").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        data.GetProperty("recent_audit").EnumerateArray().Should().Contain(a =>
            a.GetProperty("target_id").GetInt32() > 0 &&
            a.GetProperty("action_type").GetString() == "federation.whitelist.added");
    }

    [Fact]
    public async Task SuperFederationJwtStatusV2Alias_ReturnsLaravelReactStatusWithoutSecret()
    {
        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var status = await ReadJsonAsync(await Client.GetAsync("/api/v2/admin/super/federation/jwt-status"));

        status.TryGetProperty("success", out _).Should().BeFalse();
        var data = status.GetProperty("data");
        data.GetProperty("configured").GetBoolean().Should().BeTrue();
        data.GetProperty("issuer").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("key_bits").GetInt32().Should().BeGreaterThanOrEqualTo(256);
        data.GetProperty("recommended_bits").GetInt32().Should().Be(256);
        data.TryGetProperty("secret", out _).Should().BeFalse();
        data.TryGetProperty("jwt_secret", out _).Should().BeFalse();
    }

    [Fact]
    public async Task SuperFederationTenantFeatureV2Aliases_ReturnReactFeatureShapeAndPersistUpdates()
    {
        int tenantId;
        int partnerTenantId;
        int adminUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            adminUserId = await db.Users.IgnoreQueryFilters()
                .Where(u => u.Email == "admin@test.com")
                .Select(u => u.Id)
                .SingleAsync();
            var tenant = new Tenant
            {
                Name = "Federation Feature Tenant",
                Slug = $"federation-feature-tenant-{Guid.NewGuid():N}",
                Domain = "feature-tenant.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            var partnerTenant = new Tenant
            {
                Name = "Federation Feature Partner",
                Slug = $"federation-feature-partner-{Guid.NewGuid():N}",
                Domain = "feature-partner.example.test",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.Tenants.AddRange(tenant, partnerTenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            partnerTenantId = partnerTenant.Id;

            db.FederationTenantWhitelists.Add(new FederationTenantWhitelist
            {
                TenantId = tenantId,
                IsEnabled = true,
                ApprovedByUserId = adminUserId,
                ApprovedAt = DateTime.UtcNow.AddDays(-1),
                Notes = "React tenant feature compatibility"
            });
            db.FederationTenantFeatures.Add(new FederationTenantFeature
            {
                TenantId = tenantId,
                Feature = "tenant_messaging_enabled",
                IsEnabled = true,
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            });
            db.FederationPartners.Add(new FederationPartner
            {
                TenantId = tenantId,
                PartnerTenantId = partnerTenantId,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                CreditExchangeRate = 1.0m,
                RequestedById = adminUserId,
                ApprovedById = adminUserId,
                ApprovedAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsSyntheticActorAsync(SyntheticActor.PlatformSuperAdmin);

        var initial = await ReadJsonAsync(await Client.GetAsync($"/api/v2/admin/super/federation/tenant/{tenantId}/features"));
        initial.TryGetProperty("success", out _).Should().BeFalse();
        var data = initial.GetProperty("data");
        data.GetProperty("tenant").GetProperty("id").GetInt32().Should().Be(tenantId);
        data.GetProperty("tenant").GetProperty("name").GetString().Should().Be("Federation Feature Tenant");
        data.GetProperty("tenant").GetProperty("domain").GetString().Should().Be("feature-tenant.example.test");
        data.GetProperty("is_whitelisted").GetBoolean().Should().BeTrue();
        data.GetProperty("active_partnerships_count").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        var features = data.GetProperty("features");
        features.GetProperty("cross_tenant_profiles_enabled").GetBoolean().Should().BeTrue();
        features.GetProperty("cross_tenant_messaging_enabled").GetBoolean().Should().BeTrue();
        features.GetProperty("cross_tenant_transactions_enabled").GetBoolean().Should().BeTrue();
        features.GetProperty("cross_tenant_listings_enabled").GetBoolean().Should().BeTrue();
        features.GetProperty("cross_tenant_events_enabled").GetBoolean().Should().BeTrue();
        features.GetProperty("cross_tenant_groups_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("partnerships").EnumerateArray().Should().Contain(p =>
            p.GetProperty("tenant_1_id").GetInt32() == tenantId &&
            p.GetProperty("tenant_2_id").GetInt32() == partnerTenantId);

        var update = await ReadJsonAsync(await Client.PutAsJsonAsync($"/api/v2/admin/super/federation/tenant/{tenantId}/features", new
        {
            feature = "cross_tenant_messaging_enabled",
            enabled = false
        }));
        update.GetProperty("data").GetProperty("updated").GetBoolean().Should().BeTrue();
        update.GetProperty("data").GetProperty("tenant_id").GetInt32().Should().Be(tenantId);
        update.GetProperty("data").GetProperty("feature").GetString().Should().Be("cross_tenant_messaging_enabled");
        update.GetProperty("data").GetProperty("enabled").GetBoolean().Should().BeFalse();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.FederationTenantFeatures.IgnoreQueryFilters()
                .SingleAsync(f => f.TenantId == tenantId && f.Feature == "tenant_messaging_enabled");
            stored.IsEnabled.Should().BeFalse();
        }

        var refreshed = await ReadJsonAsync(await Client.GetAsync($"/api/v2/admin/super/federation/tenant/{tenantId}/features"));
        refreshed.GetProperty("data").GetProperty("features")
            .GetProperty("cross_tenant_messaging_enabled").GetBoolean().Should().BeFalse();
    }

    private async Task<int> AuthenticateAsSyntheticActorAsync(SyntheticActor actor)
    {
        var email = $"super-route-{actor.ToString().ToLowerInvariant()}-{Guid.NewGuid():N}@test.local";
        int userId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Synthetic",
                LastName = actor.ToString(),
                Role = "member",
                IsAdmin = false,
                IsSuperAdmin = actor == SyntheticActor.PlatformSuperAdmin,
                IsTenantSuperAdmin = actor == SyntheticActor.TenantSuperAdmin,
                IsGod = actor == SyntheticActor.God,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        _syntheticActorIds.Add(userId);
        SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant1.Slug));
        return userId;
    }

    private void ConfigureHub(NexusDbContext db, int tenantId)
    {
        var config = new TenantConfig
        {
            TenantId = tenantId,
            Key = "super_admin.allows_subtenants",
            Value = "true",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _syntheticHubConfigs.Add(config);
        db.TenantConfigs.Add(config);
    }

    private enum SyntheticActor
    {
        TenantSuperAdmin,
        PlatformSuperAdmin,
        God
    }

    private static User NewSuperPanelUser(string prefix, int tenantId)
        => new()
        {
            TenantId = tenantId,
            Email = $"{prefix}-{Guid.NewGuid():N}@example.test",
            PasswordHash = TestDataSeeder.TestPasswordHash,
            FirstName = "Super",
            LastName = "Panel",
            Role = "member",
            IsActive = true,
            CreatedAt = DateTime.UtcNow.AddDays(-2)
        };

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
