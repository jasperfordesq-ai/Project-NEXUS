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

public sealed class CoursesCompatibilityControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelReactCoursesRoutes()
    {
        var routes = typeof(CoursesCompatibilityController)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .SelectMany(method => method.GetCustomAttributes<HttpMethodAttribute>()
                .SelectMany(attribute => attribute.HttpMethods.Select(http => $"{http} {attribute.Template}")))
            .ToArray();

        routes.Should().Contain([
            "GET api/v2/courses",
            "GET api/v2/courses/categories",
            "GET api/v2/courses/{idOrSlug}",
            "GET api/v2/courses/{id:int}/reviews",
            "POST api/v2/courses",
            "PUT api/v2/courses/{id:int}",
            "DELETE api/v2/courses/{id:int}",
            "POST api/v2/courses/{id:int}/enroll",
            "DELETE api/v2/courses/{id:int}/enroll",
            "GET api/v2/me/courses",
            "GET api/v2/courses/{id:int}/progress",
            "GET api/v2/courses/{id:int}/prerequisites",
            "POST api/v2/courses/{id:int}/lessons/{lessonId:int}/complete",
            "GET api/v2/courses/{id:int}/certificate",
            "GET api/v2/courses/{courseId:int}/lessons/{lessonId:int}/discussions",
            "POST api/v2/courses/{courseId:int}/lessons/{lessonId:int}/discussions",
            "DELETE api/v2/courses/discussions/{id:int}",
            "GET api/v2/courses/quizzes/{quizId:int}",
            "POST api/v2/courses/quizzes/{quizId:int}/attempt",
            "GET api/v2/courses/mine",
            "GET api/v2/courses/{id:int}/analytics",
            "GET api/v2/courses/{courseId:int}/grading",
            "POST api/v2/courses/attempts/{attemptId:int}/grade",
            "POST api/v2/courses/{courseId:int}/quizzes",
            "POST api/v2/courses/{courseId:int}/quizzes/{quizId:int}/questions",
            "DELETE api/v2/courses/{courseId:int}/quizzes/{quizId:int}/questions/{questionId:int}",
            "GET api/v2/courses/{courseId:int}/cohorts",
            "POST api/v2/courses/{courseId:int}/cohorts",
            "DELETE api/v2/courses/{courseId:int}/cohorts/{cohortId:int}",
            "GET api/v2/groups/{groupId:int}/courses",
            "GET api/v2/courses/{courseId:int}/groups",
            "POST api/v2/courses/{courseId:int}/groups/{groupId:int}",
            "DELETE api/v2/courses/{courseId:int}/groups/{groupId:int}",
            "POST api/v2/courses/{courseId:int}/sections",
            "PUT api/v2/courses/{courseId:int}/sections/{sectionId:int}",
            "DELETE api/v2/courses/{courseId:int}/sections/{sectionId:int}",
            "POST api/v2/courses/{courseId:int}/lessons",
            "PUT api/v2/courses/{courseId:int}/lessons/{lessonId:int}",
            "DELETE api/v2/courses/{courseId:int}/lessons/{lessonId:int}",
            "POST api/v2/admin/courses/discussions/{id:int}/hide"
        ]);
    }

    [Fact]
    public async Task ReactCoursesWorkflow_ReturnsLaravelCompatibleEnvelopes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9001);

        var invalid = await controller.Store(new CourseCompatCourseRequest(), CancellationToken.None);
        var invalidResult = invalid.Should().BeOfType<ObjectResult>().Subject;
        invalidResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);

        var created = await controller.Store(new CourseCompatCourseRequest
        {
            Title = "Intro to care",
            Summary = "Basics",
            Level = "beginner",
            Visibility = "public"
        }, CancellationToken.None);

        var createdResult = created.Should().BeOfType<ObjectResult>().Subject;
        createdResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(createdResult.Value)))
        {
            var course = createdDocument.RootElement.GetProperty("data");
            courseId = course.GetProperty("id").GetInt32();
            course.GetProperty("slug").GetString().Should().Be("intro-to-care");
            course.GetProperty("sections").EnumerateArray().Should().BeEmpty();
        }

        var published = await controller.Publish(courseId, CancellationToken.None);
        published.Should().BeOfType<OkObjectResult>();

        var browse = await controller.Index(page: 1, perPage: 12, q: null, categoryId: null, level: null, CancellationToken.None);
        using (var browseDocument = JsonDocument.Parse(JsonSerializer.Serialize(browse.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            browseDocument.RootElement.GetProperty("data").EnumerateArray().Should().ContainSingle();
            browseDocument.RootElement.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(1);
        }

        var section = await controller.StoreSection(courseId, new CourseCompatSectionRequest { Title = "Start" }, CancellationToken.None);
        int sectionId;
        using (var sectionDocument = JsonDocument.Parse(JsonSerializer.Serialize(section.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            sectionId = sectionDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var lesson = await controller.StoreLesson(courseId, new CourseCompatLessonRequest
        {
            SectionId = sectionId,
            Title = "Welcome lesson",
            ContentType = "text"
        }, CancellationToken.None);
        int lessonId;
        using (var lessonDocument = JsonDocument.Parse(JsonSerializer.Serialize(lesson.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            lessonId = lessonDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var enrollment = await controller.Enroll(courseId, CancellationToken.None);
        int enrollmentId;
        using (var enrollmentDocument = JsonDocument.Parse(JsonSerializer.Serialize(enrollment.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            enrollmentId = enrollmentDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
            enrollmentDocument.RootElement.GetProperty("data").GetProperty("status").GetString().Should().Be("active");
        }

        var progress = await controller.Progress(courseId, CancellationToken.None);
        using (var progressDocument = JsonDocument.Parse(JsonSerializer.Serialize(progress.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            progressDocument.RootElement.GetProperty("data").GetProperty("enrollment").GetProperty("id").GetInt32()
                .Should().Be(enrollmentId);
            progressDocument.RootElement.GetProperty("data").GetProperty("availability").EnumerateArray().Should().ContainSingle();
        }

        var prerequisites = await controller.Prerequisites(courseId, CancellationToken.None);
        using (var prerequisitesDocument = JsonDocument.Parse(JsonSerializer.Serialize(prerequisites.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            prerequisitesDocument.RootElement.GetProperty("data").EnumerateArray().Should().BeEmpty();
        }

        var completed = await controller.CompleteLesson(courseId, lessonId, new CourseCompatLessonCompleteRequest { WatchPercent = 100 }, CancellationToken.None);
        using (var completedDocument = JsonDocument.Parse(JsonSerializer.Serialize(completed.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            completedDocument.RootElement.GetProperty("data").GetProperty("progress_percent").GetInt32().Should().Be(100);
        }

        var review = await controller.Review(courseId, new CourseCompatReviewRequest { Rating = 5, Body = "Useful" }, CancellationToken.None);
        review.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status201Created);

        var discussion = await controller.StoreDiscussion(courseId, lessonId, new CourseCompatDiscussionRequest { Body = "Question" }, CancellationToken.None);
        int discussionId;
        using (var discussionDocument = JsonDocument.Parse(JsonSerializer.Serialize(discussion.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            discussionId = discussionDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var quiz = await controller.StoreQuiz(courseId, new CourseCompatQuizRequest
        {
            LessonId = lessonId,
            Title = "Check",
            PassMarkPercent = 70
        }, CancellationToken.None);
        int quizId;
        using (var quizDocument = JsonDocument.Parse(JsonSerializer.Serialize(quiz.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            quizId = quizDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var question = await controller.StoreQuestion(courseId, quizId, new CourseCompatQuestionRequest
        {
            Prompt = "Ready?",
            Type = "truefalse",
            Points = 1
        }, CancellationToken.None);
        question.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status201Created);

        var attempt = await controller.AttemptQuiz(quizId, new CourseCompatQuizAttemptRequest
        {
            Answers = new Dictionary<string, object?> { ["1"] = true }
        }, CancellationToken.None);
        int attemptId;
        using (var attemptDocument = JsonDocument.Parse(JsonSerializer.Serialize(attempt.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            attemptId = attemptDocument.RootElement.GetProperty("data").GetProperty("attempt_id").GetInt32();
        }

        var graded = await controller.GradeAttempt(attemptId, new CourseCompatGradeAttemptRequest
        {
            ScorePercent = 88,
            Passed = true,
            Feedback = "Good"
        }, CancellationToken.None);
        graded.Should().BeOfType<OkObjectResult>();

        var cohort = await controller.StoreCohort(courseId, new CourseCompatCohortRequest { Name = "Spring" }, CancellationToken.None);
        int cohortId;
        using (var cohortDocument = JsonDocument.Parse(JsonSerializer.Serialize(cohort.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            cohortId = cohortDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        db.Groups.Add(new Group
        {
            Id = 123,
            TenantId = tenant.GetTenantIdOrThrow(),
            CreatedById = 9001,
            Name = "Course group"
        });
        await db.SaveChangesAsync();

        (await controller.AttachGroup(courseId, 123, CancellationToken.None)).Should().BeOfType<ObjectResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status201Created);
        (await controller.ForGroup(123, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.HideDiscussion(discussionId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.DeleteCohort(courseId, cohortId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.Drop(courseId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        (await controller.Destroy(courseId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ReactCourseCreate_KeepsLaravelDraftPendingLifecycleForInstructorDashboard()
    {
        var tenant = CreateTenantContext(43);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9002);

        var created = await controller.Store(new CourseCompatCourseRequest
        {
            Title = "Neighbourhood basics",
            Level = "beginner",
            EnrollmentType = "self_paced"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            var course = createdDocument.RootElement.GetProperty("data");
            courseId = course.GetProperty("id").GetInt32();
            course.GetProperty("status").GetString().Should().Be("draft");
            course.GetProperty("moderation_status").GetString().Should().Be("pending");
            course.GetProperty("visibility").GetString().Should().Be("members");
        }

        var authored = await controller.Authored(CancellationToken.None);
        using var authoredDocument = JsonDocument.Parse(JsonSerializer.Serialize(authored.Should().BeOfType<OkObjectResult>().Subject.Value));
        var authoredCourse = authoredDocument.RootElement.GetProperty("data").EnumerateArray()
            .Single(course => course.GetProperty("id").GetInt32() == courseId);
        authoredCourse.GetProperty("status").GetString().Should().Be("draft");
        authoredCourse.GetProperty("moderation_status").GetString().Should().Be("pending");
        authoredCourse.GetProperty("visibility").GetString().Should().Be("members");
    }

    [Fact]
    public async Task ReactCourseEndpoints_RespectLaravelCoursesFeatureFlag()
    {
        var tenant = CreateTenantContext(50);
        await using var db = CreateDbContext(tenant);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = "features.courses",
            Value = "false"
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 9011, role: "member");

        AssertFeatureDisabled(await controller.Index(ct: CancellationToken.None));
        AssertFeatureDisabled(await controller.Store(new CourseCompatCourseRequest
        {
            Title = "Disabled course"
        }, CancellationToken.None));
    }

    [Fact]
    public async Task ReactCourseCreate_RespectsLaravelRestrictedAuthoringPolicy()
    {
        var tenant = CreateTenantContext(46);
        await using var db = CreateDbContext(tenant);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = "courses.allow_member_authoring",
            Value = "false"
        });
        await db.SaveChangesAsync();

        var memberController = CreateController(db, tenant, userId: 9004, role: "member");

        var forbidden = await memberController.Store(new CourseCompatCourseRequest
        {
            Title = "Restricted course"
        }, CancellationToken.None);

        var forbiddenResult = forbidden.Should().BeOfType<ObjectResult>().Subject;
        forbiddenResult.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using (var forbiddenDocument = JsonDocument.Parse(JsonSerializer.Serialize(forbiddenResult.Value)))
        {
            forbiddenDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("FORBIDDEN");
        }

        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = $"{AdminCoursesService.InstructorKeyPrefix}9004",
            Value = "{}"
        });
        await db.SaveChangesAsync();

        var granted = await memberController.Store(new CourseCompatCourseRequest
        {
            Title = "Restricted course"
        }, CancellationToken.None);

        granted.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status201Created);
    }

    [Fact]
    public async Task ReactCourseAuthored_RespectsLaravelRestrictedAuthoringPolicy()
    {
        var tenant = CreateTenantContext(47);
        await using var db = CreateDbContext(tenant);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = "courses.allow_member_authoring",
            Value = "false"
        });
        await db.SaveChangesAsync();

        var memberController = CreateController(db, tenant, userId: 9005, role: "member");

        var forbidden = await memberController.Authored(CancellationToken.None);

        forbidden.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);

        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = $"{AdminCoursesService.InstructorKeyPrefix}9005",
            Value = "{}"
        });
        await db.SaveChangesAsync();

        var authored = await memberController.Authored(CancellationToken.None);

        authored.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ReactCourseOwnerMutations_RequireOwnerOrAdmin()
    {
        var tenant = CreateTenantContext(48);
        await using var db = CreateDbContext(tenant);
        var ownerController = CreateController(db, tenant, userId: 9006, role: "member");

        var created = await ownerController.Store(new CourseCompatCourseRequest
        {
            Title = "Owner managed course"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            courseId = createdDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var otherMemberController = CreateController(db, tenant, userId: 9007, role: "member");

        (await otherMemberController.Update(courseId, new CourseCompatCourseRequest { Title = "Taken over" }, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.Publish(courseId, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.Analytics(courseId, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.Destroy(courseId, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);

        var adminController = CreateController(db, tenant, userId: 9008, role: "admin");

        (await adminController.Publish(courseId, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ReactCourseBuilderEndpoints_RequireOwnerOrAdmin()
    {
        var tenant = CreateTenantContext(49);
        await using var db = CreateDbContext(tenant);
        var ownerController = CreateController(db, tenant, userId: 9009, role: "member");

        var created = await ownerController.Store(new CourseCompatCourseRequest
        {
            Title = "Builder guarded course"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            courseId = createdDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var section = await ownerController.StoreSection(courseId, new CourseCompatSectionRequest { Title = "Owner section" }, CancellationToken.None);
        section.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status201Created);

        var otherMemberController = CreateController(db, tenant, userId: 9010, role: "member");

        (await otherMemberController.StoreSection(courseId, new CourseCompatSectionRequest { Title = "Hijack section" }, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.StoreLesson(courseId, new CourseCompatLessonRequest { Title = "Hijack lesson" }, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.StoreQuiz(courseId, new CourseCompatQuizRequest { Title = "Hijack quiz" }, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.StoreCohort(courseId, new CourseCompatCohortRequest { Name = "Hijack cohort" }, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.AttachGroup(courseId, 123, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.GroupsForCourse(courseId, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await otherMemberController.GradingQueue(courseId, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task ReactCourseGradeAttempt_RequiresCourseOwnerOrAdmin()
    {
        var tenant = CreateTenantContext(51);
        await using var db = CreateDbContext(tenant);
        var ownerController = CreateController(db, tenant, userId: 9012, role: "member");

        var created = await ownerController.Store(new CourseCompatCourseRequest
        {
            Title = "Grading guarded course"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            courseId = createdDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var quiz = await ownerController.StoreQuiz(courseId, new CourseCompatQuizRequest
        {
            Title = "Instructor review"
        }, CancellationToken.None);

        int quizId;
        using (var quizDocument = JsonDocument.Parse(JsonSerializer.Serialize(quiz.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            quizId = quizDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        await ownerController.StoreQuestion(courseId, quizId, new CourseCompatQuestionRequest
        {
            Prompt = "Explain",
            Type = "essay",
            Points = 5
        }, CancellationToken.None);

        var learnerController = CreateController(db, tenant, userId: 9013, role: "member");
        var attempt = await learnerController.AttemptQuiz(quizId, new CourseCompatQuizAttemptRequest
        {
            Answers = new Dictionary<string, object?> { ["1"] = "Answer" }
        }, CancellationToken.None);

        int attemptId;
        using (var attemptDocument = JsonDocument.Parse(JsonSerializer.Serialize(attempt.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            attemptId = attemptDocument.RootElement.GetProperty("data").GetProperty("attempt_id").GetInt32();
        }

        var otherMemberController = CreateController(db, tenant, userId: 9014, role: "member");

        (await otherMemberController.GradeAttempt(attemptId, new CourseCompatGradeAttemptRequest
        {
            ScorePercent = 10,
            Passed = false
        }, CancellationToken.None)).Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);

        var adminController = CreateController(db, tenant, userId: 9015, role: "admin");

        (await adminController.GradeAttempt(attemptId, new CourseCompatGradeAttemptRequest
        {
            ScorePercent = 91,
            Passed = true
        }, CancellationToken.None)).Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ReactCourseGroupLinks_RequireLaravelManageableGroup()
    {
        var tenant = CreateTenantContext(52);
        await using var db = CreateDbContext(tenant);
        var tenantId = tenant.GetTenantIdOrThrow();
        var ownerController = CreateController(db, tenant, userId: 9016, role: "member");

        var created = await ownerController.Store(new CourseCompatCourseRequest
        {
            Title = "Group guarded course"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            courseId = createdDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        db.Groups.AddRange(
            new Group
            {
                Id = 5201,
                TenantId = tenantId,
                CreatedById = 9910,
                Name = "Managed group"
            },
            new Group
            {
                Id = 5202,
                TenantId = tenantId,
                CreatedById = 9911,
                Name = "Unmanaged group"
            });
        db.GroupMembers.Add(new GroupMember
        {
            TenantId = tenantId,
            GroupId = 5201,
            UserId = 9016,
            Role = Group.Roles.Admin
        });
        await db.SaveChangesAsync();

        AssertLaravelError(
            await ownerController.AttachGroup(courseId, 5299, CancellationToken.None),
            StatusCodes.Status404NotFound,
            "RESOURCE_NOT_FOUND");
        AssertLaravelError(
            await ownerController.AttachGroup(courseId, 5202, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FORBIDDEN");
        AssertLaravelError(
            await ownerController.DetachGroup(courseId, 5202, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FORBIDDEN");

        (await ownerController.AttachGroup(courseId, 5201, CancellationToken.None))
            .Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status201Created);
        (await ownerController.DetachGroup(courseId, 5201, CancellationToken.None))
            .Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ReactCoursePublish_RespectsLaravelTenantModerationSetting()
    {
        var tenant = CreateTenantContext(44);
        await using var db = CreateDbContext(tenant);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant.GetTenantIdOrThrow(),
            Key = "courses.moderation_enabled",
            Value = "true"
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 9003);
        var created = await controller.Store(new CourseCompatCourseRequest
        {
            Title = "Moderated course"
        }, CancellationToken.None);

        int courseId;
        using (var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Should().BeOfType<ObjectResult>().Subject.Value)))
        {
            courseId = createdDocument.RootElement.GetProperty("data").GetProperty("id").GetInt32();
        }

        var published = await controller.Publish(courseId, CancellationToken.None);

        using var publishedDocument = JsonDocument.Parse(JsonSerializer.Serialize(published.Should().BeOfType<OkObjectResult>().Subject.Value));
        var course = publishedDocument.RootElement.GetProperty("data");
        course.GetProperty("status").GetString().Should().Be("published");
        course.GetProperty("moderation_status").GetString().Should().Be("pending");
        course.GetProperty("published_at").ValueKind.Should().Be(JsonValueKind.Null);
    }

    private static CoursesCompatibilityController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId,
        string role = "admin")
    {
        var service = new CoursesCompatibilityService(db);
        return new CoursesCompatibilityController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), role)
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

    private static void AssertFeatureDisabled(IActionResult result)
    {
        var objectResult = result.Should().BeOfType<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static void AssertLaravelError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeOfType<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be(code);
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
