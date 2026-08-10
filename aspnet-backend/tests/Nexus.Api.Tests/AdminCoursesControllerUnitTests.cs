// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class AdminCoursesControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelAdminCoursesRoutes()
    {
        var routeTemplates = typeof(AdminCoursesController)
            .GetCustomAttributes<RouteAttribute>()
            .Select(route => route.Template)
            .ToArray();

        routeTemplates.Should().BeEquivalentTo("api/admin/courses", "api/v2/admin/courses");
        typeof(AdminCoursesController)
            .GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");

        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.Analytics))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("analytics");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.Moderate))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/moderate");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.ListInstructors))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("instructors");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.GrantInstructor))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("instructors");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.RevokeInstructor))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("instructors/{userId:int}");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.StoreCategory))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("categories");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.UpdateCategory))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("categories/{id:int}");
        typeof(AdminCoursesController)
            .GetMethod(nameof(AdminCoursesController.DeleteCategory))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("categories/{id:int}");
    }

    [Fact]
    public async Task IndexAnalyticsAndModerate_MatchLaravelEnvelopeAndTenantIsolation()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9001);
        var service = new AdminCoursesService(db);

        var course = await service.UpsertCourseAsync(42, new AdminCourseRecord
        {
            Id = 10,
            Title = "Tenant course",
            Status = "published",
            ModerationStatus = "pending",
            Author = new AdminCourseUserDto(5, "Ada"),
            Category = new AdminCourseCategoryDto(3, "Care")
        }, CancellationToken.None);
        await service.UpsertCourseAsync(7, new AdminCourseRecord
        {
            Id = 11,
            Title = "Other tenant",
            Status = "published",
            ModerationStatus = "pending"
        }, CancellationToken.None);

        var list = await controller.Index(null, CancellationToken.None);

        var listOk = list.Should().BeOfType<OkObjectResult>().Subject;
        using (var listDocument = JsonDocument.Parse(JsonSerializer.Serialize(listOk.Value)))
        {
            var items = listDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
            items.Should().HaveCount(1);
            items[0].GetProperty("id").GetInt32().Should().Be(course.Id);
            items[0].GetProperty("title").GetString().Should().Be("Tenant course");
            items[0].GetProperty("author").GetProperty("name").GetString().Should().Be("Ada");
        }

        var analytics = await controller.Analytics(CancellationToken.None);

        var analyticsOk = analytics.Should().BeOfType<OkObjectResult>().Subject;
        using (var analyticsDocument = JsonDocument.Parse(JsonSerializer.Serialize(analyticsOk.Value)))
        {
            var data = analyticsDocument.RootElement.GetProperty("data");
            data.GetProperty("total_courses").GetInt32().Should().Be(1);
            data.GetProperty("published_courses").GetInt32().Should().Be(1);
            data.GetProperty("pending_moderation").GetInt32().Should().Be(1);
            data.GetProperty("total_enrollments").GetInt32().Should().Be(0);
            data.GetProperty("completed_enrollments").GetInt32().Should().Be(0);
            data.GetProperty("instructors").GetInt32().Should().Be(0);
        }

        var invalid = await controller.Moderate(course.Id, new AdminCourseModerationRequest
        {
            Action = "archive"
        }, CancellationToken.None);

        var invalidResult = invalid.Should().BeOfType<ObjectResult>().Subject;
        invalidResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using (var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalidResult.Value)))
        {
            invalidDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("VALIDATION_FAILED");
        }

        var approved = await controller.Moderate(course.Id, new AdminCourseModerationRequest
        {
            Action = "approve",
            Notes = "Looks good"
        }, CancellationToken.None);

        var approvedOk = approved.Should().BeOfType<OkObjectResult>().Subject;
        using var approvedDocument = JsonDocument.Parse(JsonSerializer.Serialize(approvedOk.Value));
        var approvedCourse = approvedDocument.RootElement.GetProperty("data");
        approvedCourse.GetProperty("moderation_status").GetString().Should().Be("approved");
        approvedCourse.GetProperty("moderation_notes").GetString().Should().Be("Looks good");
        approvedCourse.GetProperty("moderated_by").GetInt32().Should().Be(9001);
    }

    [Fact]
    public async Task ModerationWorkflow_SeesAndApprovesInstructorPublishedCourses()
    {
        var tenant = CreateTenantContext(45);
        await using var db = CreateDbContext(tenant);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = "courses.moderation_enabled",
            Value = "true"
        });
        await db.SaveChangesAsync();

        var instructorController = CreateCoursesController(db, tenant, userId: 9101);
        var adminController = CreateController(db, tenant, userId: 9001);

        var created = await instructorController.Store(new CourseCompatCourseRequest
        {
            Title = "Shared course"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            courseId = createdDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        await instructorController.Publish(courseId, CancellationToken.None);

        var pending = await adminController.Index("pending", CancellationToken.None);
        using (var pendingDocument = JsonDocument.Parse(JsonSerializer.Serialize(pending.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var pendingCourses = pendingDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
            pendingCourses.Should().ContainSingle(course => course.GetProperty("id").GetInt32() == courseId);
        }

        var approved = await adminController.Moderate(courseId, new AdminCourseModerationRequest
        {
            Action = "approve",
            Notes = "Approved for launch"
        }, CancellationToken.None);

        using (var approvedDocument = JsonDocument.Parse(JsonSerializer.Serialize(approved.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var course = approvedDocument.RootElement.GetProperty("data");
            course.GetProperty("status").GetString().Should().Be("published");
            course.GetProperty("moderation_status").GetString().Should().Be("approved");
            course.GetProperty("published_at").ValueKind.Should().NotBe(JsonValueKind.Null);
        }

        var browse = await instructorController.Index(page: 1, perPage: 12, q: null, categoryId: null, level: null, CancellationToken.None);
        using var browseDocument = JsonDocument.Parse(JsonSerializer.Serialize(browse.Should().BeOfType<OkObjectResult>().Subject.Value));
        browseDocument.RootElement.GetProperty("data").EnumerateArray()
            .Should().ContainSingle(course => course.GetProperty("id").GetInt32() == courseId);
    }

    [Fact]
    public async Task InstructorAndCategoryMutations_ReturnLaravelCompatibleShapes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9001);

        var invalidGrant = await controller.GrantInstructor(new AdminCourseInstructorRequest(), CancellationToken.None);

        var invalidGrantResult = invalidGrant.Should().BeOfType<ObjectResult>().Subject;
        invalidGrantResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);

        var granted = await controller.GrantInstructor(new AdminCourseInstructorRequest
        {
            UserId = 5
        }, CancellationToken.None);

        var grantedObject = granted.Should().BeOfType<ObjectResult>().Subject;
        grantedObject.StatusCode.Should().Be(StatusCodes.Status201Created);
        using (var grantedDocument = JsonDocument.Parse(JsonSerializer.Serialize(grantedObject.Value)))
        {
            var data = grantedDocument.RootElement.GetProperty("data");
            data.GetProperty("user_id").GetInt32().Should().Be(5);
            data.GetProperty("granted_by").GetInt32().Should().Be(9001);
        }

        var instructors = await controller.ListInstructors(CancellationToken.None);

        var instructorsOk = instructors.Should().BeOfType<OkObjectResult>().Subject;
        using (var instructorsDocument = JsonDocument.Parse(JsonSerializer.Serialize(instructorsOk.Value)))
        {
            var items = instructorsDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
            items.Should().HaveCount(1);
            items[0].GetProperty("user_id").GetInt32().Should().Be(5);
        }

        var category = await controller.StoreCategory(new AdminCourseCategoryRequest
        {
            Name = " Care skills ",
            Description = "Practical care",
            Position = 2
        }, CancellationToken.None);

        var categoryObject = category.Should().BeOfType<ObjectResult>().Subject;
        categoryObject.StatusCode.Should().Be(StatusCodes.Status201Created);
        int categoryId;
        using (var categoryDocument = JsonDocument.Parse(JsonSerializer.Serialize(categoryObject.Value)))
        {
            var data = categoryDocument.RootElement.GetProperty("data");
            categoryId = data.GetProperty("id").GetInt32();
            data.GetProperty("name").GetString().Should().Be("Care skills");
            data.GetProperty("slug").GetString().Should().Be("care-skills");
        }

        var updated = await controller.UpdateCategory(categoryId, new AdminCourseCategoryRequest
        {
            Name = "Community learning"
        }, CancellationToken.None);

        var updatedOk = updated.Should().BeOfType<OkObjectResult>().Subject;
        using (var updatedDocument = JsonDocument.Parse(JsonSerializer.Serialize(updatedOk.Value)))
        {
            updatedDocument.RootElement.GetProperty("data").GetProperty("name").GetString()
                .Should().Be("Community learning");
        }

        var revoked = await controller.RevokeInstructor(5, CancellationToken.None);

        var revokedOk = revoked.Should().BeOfType<OkObjectResult>().Subject;
        using (var revokedDocument = JsonDocument.Parse(JsonSerializer.Serialize(revokedOk.Value)))
        {
            revokedDocument.RootElement.GetProperty("data").GetProperty("revoked").GetBoolean().Should().BeTrue();
        }

        var deleted = await controller.DeleteCategory(categoryId, CancellationToken.None);

        var deletedOk = deleted.Should().BeOfType<OkObjectResult>().Subject;
        using var deletedDocument = JsonDocument.Parse(JsonSerializer.Serialize(deletedOk.Value));
        deletedDocument.RootElement.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
    }

    private static AdminCoursesController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new AdminCoursesService(db);
        return new AdminCoursesController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
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

    private static CoursesCompatibilityController CreateCoursesController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CoursesCompatibilityService(db);
        return new CoursesCompatibilityController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }
}
