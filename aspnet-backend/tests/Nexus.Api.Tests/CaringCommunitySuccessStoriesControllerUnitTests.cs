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

public class CaringCommunitySuccessStoriesControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelSuccessStoryRoutes()
    {
        typeof(CaringCommunitySuccessStoriesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/success-stories");
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/success-stories");

        typeof(CaringCommunitySuccessStoriesController)
            .GetMethod(nameof(CaringCommunitySuccessStoriesController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetMethod(nameof(AdminCaringCommunitySuccessStoriesController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetMethod(nameof(AdminCaringCommunitySuccessStoriesController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetMethod(nameof(AdminCaringCommunitySuccessStoriesController.SeedDemo))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("seed-demo");
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetMethod(nameof(AdminCaringCommunitySuccessStoriesController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{storyId}");
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetMethod(nameof(AdminCaringCommunitySuccessStoriesController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{storyId}");
        typeof(AdminCaringCommunitySuccessStoriesController)
            .GetMethod(nameof(AdminCaringCommunitySuccessStoriesController.RefreshLive))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{storyId}/refresh-live");
    }

    [Fact]
    public async Task MemberIndex_ReturnsPublishedStoriesForCurrentTenantOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedStories(db, 42,
            Story("story_published", "Published", isPublished: true),
            Story("story_draft", "Draft", isPublished: false));
        SeedStories(db, 7, Story("story_other", "Other", isPublished: true));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var items = document.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(1);
        items[0].GetProperty("id").GetString().Should().Be("story_published");
        items[0].GetProperty("title").GetString().Should().Be("Published");
    }

    [Fact]
    public async Task AdminStoreUpdateDelete_PersistsTenantJsonEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var invalid = await controller.Store(new SuccessStoryRequest
        {
            Narrative = "No title",
            MethodCaveat = "Manual estimate",
            EvidenceSource = "Workshop"
        }, CancellationToken.None);

        var invalidResult = invalid.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using (var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalidResult.Value)))
        {
            var error = invalidDocument.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_REQUIRED");
            error.GetProperty("field").GetString().Should().Be("title");
        }

        var created = await controller.Store(new SuccessStoryRequest
        {
            Title = "Volunteer hours rose",
            Narrative = "More neighbours joined the care network.",
            MetricSource = "manual",
            BeforeValue = 20,
            AfterValue = 35,
            Unit = "hours",
            Audience = "municipality",
            MethodCaveat = "Manual estimate",
            EvidenceSource = "Coordinator log",
            IsPublished = true
        }, CancellationToken.None);

        var createdObject = created.Should().BeOfType<ObjectResult>().Subject;
        createdObject.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(createdObject.Value));
        var story = createdDocument.RootElement.GetProperty("data").GetProperty("story");
        var storyId = story.GetProperty("id").GetString();
        storyId.Should().MatchRegex("^story_[a-f0-9]{16}$");
        story.GetProperty("is_demo").GetBoolean().Should().BeTrue();
        story.GetProperty("is_published").GetBoolean().Should().BeTrue();

        var update = await controller.Update(storyId!, new SuccessStoryRequest
        {
            Title = "Volunteer hours grew",
            IsDemo = false,
            IsPublished = false
        }, CancellationToken.None);

        var updateOk = update.Should().BeOfType<OkObjectResult>().Subject;
        using var updateDocument = JsonDocument.Parse(JsonSerializer.Serialize(updateOk.Value));
        var updated = updateDocument.RootElement.GetProperty("data").GetProperty("story");
        updated.GetProperty("title").GetString().Should().Be("Volunteer hours grew");
        updated.GetProperty("narrative").GetString().Should().Be("More neighbours joined the care network.");
        updated.GetProperty("is_demo").GetBoolean().Should().BeFalse();
        updated.GetProperty("is_published").GetBoolean().Should().BeFalse();

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == SuccessStoryService.SettingKey);
        stored.Value.Should().Contain(storyId);
        stored.Value.Should().Contain("Volunteer hours grew");

        var delete = await controller.Destroy(storyId!, CancellationToken.None);

        var deleteOk = delete.Should().BeOfType<OkObjectResult>().Subject;
        using var deleteDocument = JsonDocument.Parse(JsonSerializer.Serialize(deleteOk.Value));
        deleteDocument.RootElement.GetProperty("data").GetProperty("ok").GetBoolean().Should().BeTrue();

        var afterDelete = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == SuccessStoryService.SettingKey);
        afterDelete.Value.Should().NotContain(storyId);
    }

    [Fact]
    public async Task SeedAndRefresh_ReturnLaravelConflictAndManualMetricErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var seed = await controller.SeedDemo(CancellationToken.None);

        var seedOk = seed.Should().BeOfType<OkObjectResult>().Subject;
        using var seedDocument = JsonDocument.Parse(JsonSerializer.Serialize(seedOk.Value));
        var items = seedDocument.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(3);
        items.Should().OnlyContain(item => item.GetProperty("is_demo").GetBoolean());
        items.Should().OnlyContain(item => item.GetProperty("is_published").GetBoolean());

        var conflict = await controller.SeedDemo(CancellationToken.None);

        var conflictObject = conflict.Should().BeOfType<ObjectResult>().Subject;
        conflictObject.StatusCode.Should().Be(StatusCodes.Status409Conflict);
        using (var conflictDocument = JsonDocument.Parse(JsonSerializer.Serialize(conflictObject.Value)))
        {
            conflictDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("ALREADY_SEEDED");
        }

        var storyId = items[0].GetProperty("id").GetString()!;
        var refresh = await controller.RefreshLive(storyId, CancellationToken.None);

        var refreshObject = refresh.Should().BeOfType<ObjectResult>().Subject;
        refreshObject.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var refreshDocument = JsonDocument.Parse(JsonSerializer.Serialize(refreshObject.Value));
        refreshDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("MANUAL_METRIC");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelForbiddenError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Index(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static Dictionary<string, object?> Story(string id, string title, bool isPublished)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["title"] = title,
            ["narrative"] = $"{title} narrative",
            ["metric_source"] = "manual",
            ["metric_key"] = null,
            ["before_value"] = 1.0,
            ["after_value"] = 2.0,
            ["unit"] = "%",
            ["audience"] = "municipality",
            ["sub_region_id"] = null,
            ["method_caveat"] = "Manual estimate",
            ["evidence_source"] = "Coordinator report",
            ["is_demo"] = true,
            ["is_published"] = isPublished,
            ["created_at"] = "2026-07-03T10:00:00.0000000Z",
            ["updated_at"] = "2026-07-03T10:00:00.0000000Z"
        };
    }

    private static void SeedStories(NexusDbContext db, int tenantId, params Dictionary<string, object?>[] stories)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = SuccessStoryService.SettingKey,
            Value = JsonSerializer.Serialize(new
            {
                items = stories,
                updated_at = "2026-07-03T10:00:00.0000000Z"
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web))
        });
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

    private static CaringCommunitySuccessStoriesController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new SuccessStoryService(db, tenant);
        return new CaringCommunitySuccessStoriesController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
        };
    }

    private static AdminCaringCommunitySuccessStoriesController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new SuccessStoryService(db, tenant);
        return new AdminCaringCommunitySuccessStoriesController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
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
