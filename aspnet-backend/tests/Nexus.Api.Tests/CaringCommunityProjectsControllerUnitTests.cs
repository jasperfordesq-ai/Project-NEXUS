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

public class CaringCommunityProjectsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelProjectMemberRoutes()
    {
        typeof(CaringCommunityProjectsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/projects");

        typeof(CaringCommunityProjectsController)
            .GetMethod(nameof(CaringCommunityProjectsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(CaringCommunityProjectsController)
            .GetMethod(nameof(CaringCommunityProjectsController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("{id:int}");
        typeof(CaringCommunityProjectsController)
            .GetMethod(nameof(CaringCommunityProjectsController.Subscribe))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/subscribe");
        typeof(CaringCommunityProjectsController)
            .GetMethod(nameof(CaringCommunityProjectsController.Unsubscribe))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{id:int}/subscribe");
    }

    [Fact]
    public void Actions_ExposeLaravelProjectAdminRoutes()
    {
        typeof(AdminCaringCommunityProjectsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/projects");
        typeof(AdminCaringCommunityProjectUpdatesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/project-updates");

        typeof(AdminCaringCommunityProjectsController)
            .GetMethod(nameof(AdminCaringCommunityProjectsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityProjectsController)
            .GetMethod(nameof(AdminCaringCommunityProjectsController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityProjectsController)
            .GetMethod(nameof(AdminCaringCommunityProjectsController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminCaringCommunityProjectsController)
            .GetMethod(nameof(AdminCaringCommunityProjectsController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminCaringCommunityProjectsController)
            .GetMethod(nameof(AdminCaringCommunityProjectsController.Publish))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/publish");
        typeof(AdminCaringCommunityProjectsController)
            .GetMethod(nameof(AdminCaringCommunityProjectsController.CreateUpdate))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/updates");
        typeof(AdminCaringCommunityProjectUpdatesController)
            .GetMethod(nameof(AdminCaringCommunityProjectUpdatesController.Publish))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/publish");
    }

    [Fact]
    public async Task Index_ReturnsPublishedCurrentTenantProjectsOrderedLikeLaravel()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringProjectAnnouncements.AddRange(
            Project(42, "Completed kitchen", "completed", publishedAt: new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc), lastUpdateAt: new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc), subscribers: 8, progress: 100),
            Project(42, "Paused garden", "paused", publishedAt: new DateTime(2026, 6, 2, 9, 0, 0, DateTimeKind.Utc), lastUpdateAt: new DateTime(2026, 6, 22, 9, 0, 0, DateTimeKind.Utc), subscribers: 3, progress: 45),
            Project(42, "Active hall", "active", publishedAt: new DateTime(2026, 6, 3, 9, 0, 0, DateTimeKind.Utc), lastUpdateAt: new DateTime(2026, 6, 21, 9, 0, 0, DateTimeKind.Utc), subscribers: 5, progress: 60),
            Project(42, "Draft pantry", "draft"),
            Project(7, "Other tenant", "active"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().HaveCount(3);
        rows[0].GetProperty("title").GetString().Should().Be("Active hall");
        rows[0].GetProperty("status").GetString().Should().Be("active");
        rows[0].GetProperty("subscriber_count").GetInt32().Should().Be(5);
        rows[1].GetProperty("title").GetString().Should().Be("Paused garden");
        rows[2].GetProperty("title").GetString().Should().Be("Completed kitchen");
    }

    [Fact]
    public async Task Show_ReturnsPublishedProjectWithPublishedUpdatesAndSubscriptionFlag()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        var project = Project(42, "Community greenhouse", "active");
        var draft = Project(42, "Not yet public", "draft");
        db.CaringProjectAnnouncements.AddRange(project, draft);
        await db.SaveChangesAsync();
        db.CaringProjectUpdates.AddRange(
            Update(42, project.Id, "Milestone ready", "published", isMilestone: true, publishedAt: new DateTime(2026, 6, 25, 9, 0, 0, DateTimeKind.Utc)),
            Update(42, project.Id, "Staff note", "draft", isMilestone: false));
        db.CaringProjectSubscriptions.Add(new CaringProjectSubscription
        {
            TenantId = 42,
            ProjectId = project.Id,
            UserId = 1001,
            SubscribedAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc),
            UpdatedAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Show(project.Id, CancellationToken.None);
        var hidden = await controller.Show(draft.Id, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var row = document.RootElement.GetProperty("data");
        row.GetProperty("title").GetString().Should().Be("Community greenhouse");
        row.GetProperty("is_subscribed").GetBoolean().Should().BeTrue();
        var updates = row.GetProperty("updates").EnumerateArray().ToArray();
        updates.Should().HaveCount(1);
        updates[0].GetProperty("title").GetString().Should().Be("Milestone ready");

        hidden.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task SubscribeAndUnsubscribe_UpsertSubscriptionAndRefreshSubscriberCount()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        var project = Project(42, "Pocket park", "active");
        var draft = Project(42, "Secret launch", "draft");
        db.CaringProjectAnnouncements.AddRange(project, draft);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var subscribed = await controller.Subscribe(project.Id, CancellationToken.None);
        var subscribedAgain = await controller.Subscribe(project.Id, CancellationToken.None);
        var unsubscribed = await controller.Unsubscribe(project.Id, CancellationToken.None);
        var rejected = await controller.Subscribe(draft.Id, CancellationToken.None);

        subscribed.Should().BeOfType<OkObjectResult>();
        subscribedAgain.Should().BeOfType<OkObjectResult>();
        unsubscribed.Should().BeOfType<OkObjectResult>();
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(((OkObjectResult)unsubscribed).Value)))
        {
            document.RootElement.GetProperty("data").GetProperty("ok").GetBoolean().Should().BeTrue();
        }

        var subscriptions = await db.CaringProjectSubscriptions.IgnoreQueryFilters().ToListAsync();
        subscriptions.Should().ContainSingle(row => row.ProjectId == project.Id && row.UserId == 1001);
        subscriptions.Single(row => row.ProjectId == project.Id && row.UserId == 1001)
            .UnsubscribedAt.Should().NotBeNull();
        (await db.CaringProjectAnnouncements.IgnoreQueryFilters().SingleAsync(row => row.Id == project.Id))
            .SubscriberCount.Should().Be(0);

        var missing = rejected.Should().BeOfType<NotFoundObjectResult>().Subject;
        using var missingDocument = JsonDocument.Parse(JsonSerializer.Serialize(missing.Value));
        missingDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SERVICE_ERROR");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelForbiddenError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Index(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task AdminIndex_FiltersByValidStatusAndFallsBackForInvalidStatus()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringProjectAnnouncements.AddRange(
            Project(42, "Draft path", "draft"),
            Project(42, "Active path", "active"),
            Project(42, "Paused path", "paused"),
            Project(7, "Other tenant", "draft"));
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 1001);

        var drafts = await controller.Index("draft", CancellationToken.None);
        var invalid = await controller.Index("archived", CancellationToken.None);

        var draftOk = drafts.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(draftOk.Value)))
        {
            var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
            rows.Should().ContainSingle();
            rows[0].GetProperty("title").GetString().Should().Be("Draft path");
        }

        var invalidOk = invalid.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(invalidOk.Value)))
        {
            document.RootElement.GetProperty("data").EnumerateArray().Should().HaveCount(3);
        }
    }

    [Fact]
    public async Task AdminStoreUpdateAndPublish_ValidateAndPersistProjects()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 1001);

        var missingTitle = await controller.Store(new ProjectAnnouncementRequest
        {
            Summary = "No title"
        }, CancellationToken.None);
        var created = await controller.Store(new ProjectAnnouncementRequest
        {
            Title = "Library ramp",
            Summary = "Accessible entrance work",
            Location = "Leeds",
            Status = "active",
            CurrentStage = "Build",
            ProgressPercent = 45,
            StartsAt = "2026-07-10"
        }, CancellationToken.None);

        var unprocessable = missingTitle.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(unprocessable.Value)))
        {
            document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("VALIDATION_ERROR");
        }

        var createdObject = created.Should().BeOfType<ObjectResult>().Subject;
        createdObject.StatusCode.Should().Be(StatusCodes.Status201Created);
        int projectId;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(createdObject.Value)))
        {
            var row = document.RootElement.GetProperty("data");
            projectId = row.GetProperty("id").GetInt32();
            row.GetProperty("created_by").GetInt32().Should().Be(1001);
            row.GetProperty("status").GetString().Should().Be("active");
            row.GetProperty("progress_percent").GetInt32().Should().Be(45);
            row.GetProperty("published_at").ValueKind.Should().NotBe(JsonValueKind.Null);
        }

        var invalidUpdate = await controller.Update(projectId, new ProjectAnnouncementRequest
        {
            Status = "archived"
        }, CancellationToken.None);
        invalidUpdate.Should().BeOfType<UnprocessableEntityObjectResult>();

        var updated = await controller.Update(projectId, new ProjectAnnouncementRequest
        {
            Title = "Library ramp phase 2",
            Status = "paused",
            ProgressPercent = 75
        }, CancellationToken.None);
        var published = await controller.Publish(projectId, CancellationToken.None);

        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(((OkObjectResult)updated).Value)))
        {
            var row = document.RootElement.GetProperty("data");
            row.GetProperty("title").GetString().Should().Be("Library ramp phase 2");
            row.GetProperty("status").GetString().Should().Be("paused");
            row.GetProperty("progress_percent").GetInt32().Should().Be(75);
        }

        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(((OkObjectResult)published).Value)))
        {
            document.RootElement.GetProperty("data").GetProperty("status").GetString().Should().Be("active");
        }
    }

    [Fact]
    public async Task AdminShowCreateUpdateAndPublishUpdate_IncludeDraftsAndApplyPublishedUpdate()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        var project = Project(42, "Garden beds", "draft");
        db.CaringProjectAnnouncements.Add(project);
        await db.SaveChangesAsync();
        db.CaringProjectUpdates.AddRange(
            Update(42, project.Id, "Public milestone", "published", isMilestone: true, publishedAt: new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)),
            Update(42, project.Id, "Draft note", "draft", isMilestone: false));
        db.CaringProjectSubscriptions.Add(new CaringProjectSubscription
        {
            TenantId = 42,
            ProjectId = project.Id,
            UserId = 2001,
            SubscribedAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc),
            UpdatedAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 1001);
        var updatesController = CreateAdminUpdatesController(db, tenant, userId: 1001);

        var shown = await controller.Show(project.Id, CancellationToken.None);
        var missingTitle = await controller.CreateUpdate(project.Id, new ProjectUpdateRequest
        {
            Body = "Missing title"
        }, CancellationToken.None);
        var draftUpdate = await controller.CreateUpdate(project.Id, new ProjectUpdateRequest
        {
            Title = "Raised beds ready",
            Body = "Timber delivered",
            StageLabel = "Build",
            ProgressPercent = 80,
            IsMilestone = true,
            Status = "draft"
        }, CancellationToken.None);

        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(((OkObjectResult)shown).Value)))
        {
            document.RootElement.GetProperty("data").GetProperty("updates").EnumerateArray()
                .Should().HaveCount(2);
        }

        missingTitle.Should().BeOfType<UnprocessableEntityObjectResult>();

        var draftCreated = draftUpdate.Should().BeOfType<ObjectResult>().Subject;
        draftCreated.StatusCode.Should().Be(StatusCodes.Status201Created);
        int updateId;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(draftCreated.Value)))
        {
            var row = document.RootElement.GetProperty("data");
            updateId = row.GetProperty("id").GetInt32();
            row.GetProperty("status").GetString().Should().Be("draft");
            row.GetProperty("published_at").ValueKind.Should().Be(JsonValueKind.Null);
        }

        var published = await updatesController.Publish(updateId, CancellationToken.None);

        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(((OkObjectResult)published).Value)))
        {
            var row = document.RootElement.GetProperty("data");
            row.GetProperty("status").GetString().Should().Be("published");
            row.GetProperty("notification_count").GetInt32().Should().Be(1);
        }

        var storedProject = await db.CaringProjectAnnouncements.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == project.Id);
        storedProject.CurrentStage.Should().Be("Build");
        storedProject.ProgressPercent.Should().Be(80);
        storedProject.LastUpdateAt.Should().NotBeNull();
    }

    private static CaringProjectAnnouncement Project(
        int tenantId,
        string title,
        string status,
        DateTime? publishedAt = null,
        DateTime? lastUpdateAt = null,
        int subscribers = 0,
        int progress = 0)
    {
        var now = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc);
        return new CaringProjectAnnouncement
        {
            TenantId = tenantId,
            Title = title,
            Summary = $"{title} summary",
            Location = "Leeds",
            Status = status,
            CurrentStage = status == "completed" ? "Done" : "Planning",
            ProgressPercent = progress,
            PublishedAt = publishedAt,
            LastUpdateAt = lastUpdateAt,
            SubscriberCount = subscribers,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    private static CaringProjectUpdate Update(
        int tenantId,
        int projectId,
        string title,
        string status,
        bool isMilestone,
        DateTime? publishedAt = null)
    {
        var now = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc);
        return new CaringProjectUpdate
        {
            TenantId = tenantId,
            ProjectId = projectId,
            StageLabel = "Build",
            Title = title,
            Body = $"{title} body",
            ProgressPercent = 40,
            IsMilestone = isMilestone,
            Status = status,
            PublishedAt = publishedAt,
            CreatedAt = now,
            UpdatedAt = now
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

    private static CaringCommunityProjectsController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new ProjectAnnouncementService(db, tenant);
        return new CaringCommunityProjectsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow())
        };
    }

    private static AdminCaringCommunityProjectsController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new ProjectAnnouncementService(db, tenant);
        return new AdminCaringCommunityProjectsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static AdminCaringCommunityProjectUpdatesController CreateAdminUpdatesController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new ProjectAnnouncementService(db, tenant);
        return new AdminCaringCommunityProjectUpdatesController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role = "member")
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
