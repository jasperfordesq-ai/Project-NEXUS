// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
public sealed class CoursesCompatibilityController : ControllerBase
{
    private readonly CoursesCompatibilityService _courses;
    private readonly TenantContext _tenant;

    public CoursesCompatibilityController(CoursesCompatibilityService courses, TenantContext tenant)
    {
        _courses = courses;
        _tenant = tenant;
    }

    [AllowAnonymous]
    [HttpGet("api/courses")]
    [HttpGet("api/v2/courses")]
    public async Task<IActionResult> Index(
        [FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int perPage = 12,
        [FromQuery] string? q = null,
        [FromQuery(Name = "category_id")] int? categoryId = null,
        [FromQuery] string? level = null,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _courses.IsCoursesFeatureEnabledAsync(tenantId, ct))
        {
            return FeatureDisabled();
        }

        var result = await _courses.BrowseAsync(tenantId, page, perPage, q, categoryId, level, ct);
        var totalPages = result.PerPage <= 0 ? 0 : (int)Math.Ceiling(result.Total / (double)result.PerPage);
        return Ok(new
        {
            data = result.Items,
            meta = new
            {
                total = result.Total,
                current_page = result.Page,
                per_page = result.PerPage,
                total_pages = totalPages,
                has_more = result.Page < totalPages
            }
        });
    }

    [AllowAnonymous]
    [HttpGet("api/courses/categories")]
    [HttpGet("api/v2/courses/categories")]
    public async Task<IActionResult> Categories(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _courses.IsCoursesFeatureEnabledAsync(tenantId, ct))
        {
            return FeatureDisabled();
        }

        return Ok(new { data = await _courses.CategoriesAsync(tenantId, ct) });
    }

    [AllowAnonymous]
    [HttpGet("api/courses/{idOrSlug}")]
    [HttpGet("api/v2/courses/{idOrSlug}")]
    public Task<IActionResult> Show(string idOrSlug, CancellationToken ct) =>
        RunAsync(() => _courses.ShowAsync(_tenant.GetTenantIdOrThrow(), idOrSlug, OptionalUserId(), ct));

    [AllowAnonymous]
    [HttpGet("api/courses/{id:int}/reviews")]
    [HttpGet("api/v2/courses/{id:int}/reviews")]
    public Task<IActionResult> Reviews(int id, CancellationToken ct) =>
        RunAsync(() => _courses.ReviewsAsync(_tenant.GetTenantIdOrThrow(), id, ct));

    [HttpPost("api/courses/{id:int}/reviews")]
    [HttpPost("api/v2/courses/{id:int}/reviews")]
    public Task<IActionResult> Review(int id, [FromBody] CourseCompatReviewRequest request, CancellationToken ct) =>
        RunAsync(() => _courses.ReviewAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), request, ct), StatusCodes.Status201Created);

    [HttpPost("api/courses")]
    [HttpPost("api/v2/courses")]
    public Task<IActionResult> Store([FromBody] CourseCompatCourseRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var userId = UserId();
            await EnsureCourseAuthorAsync(tenantId, userId, ct);
            return await _courses.CreateCourseAsync(tenantId, userId, request, ct);
        }, StatusCodes.Status201Created);

    [HttpPut("api/courses/{id:int}")]
    [HttpPut("api/v2/courses/{id:int}")]
    public Task<IActionResult> Update(int id, [FromBody] CourseCompatCourseRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, id, UserId(), ct);
            return await _courses.UpdateCourseAsync(tenantId, id, request, ct);
        });

    [HttpDelete("api/courses/{id:int}")]
    [HttpDelete("api/v2/courses/{id:int}")]
    public Task<IActionResult> Destroy(int id, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, id, UserId(), ct);
            return new { deleted = await _courses.DeleteCourseAsync(tenantId, id, ct) };
        });

    [HttpPost("api/courses/{id:int}/publish")]
    [HttpPost("api/v2/courses/{id:int}/publish")]
    public Task<IActionResult> Publish(int id, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, id, UserId(), ct);
            return await _courses.SetPublishedAsync(tenantId, id, published: true, ct);
        });

    [HttpPost("api/courses/{id:int}/unpublish")]
    [HttpPost("api/v2/courses/{id:int}/unpublish")]
    public Task<IActionResult> Unpublish(int id, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, id, UserId(), ct);
            return await _courses.SetPublishedAsync(tenantId, id, published: false, ct);
        });

    [HttpPost("api/courses/{id:int}/enroll")]
    [HttpPost("api/v2/courses/{id:int}/enroll")]
    public Task<IActionResult> Enroll(int id, CancellationToken ct) =>
        RunAsync(() => _courses.EnrollAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct), StatusCodes.Status201Created);

    [HttpDelete("api/courses/{id:int}/enroll")]
    [HttpDelete("api/v2/courses/{id:int}/enroll")]
    public Task<IActionResult> Drop(int id, CancellationToken ct) =>
        RunAsync(async () => new { dropped = await _courses.DropAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct) });

    [HttpGet("api/me/courses")]
    [HttpGet("api/v2/me/courses")]
    public Task<IActionResult> MyCourses(CancellationToken ct) =>
        RunAsync(() => _courses.MyCoursesAsync(_tenant.GetTenantIdOrThrow(), UserId(), ct));

    [HttpGet("api/courses/{id:int}/progress")]
    [HttpGet("api/v2/courses/{id:int}/progress")]
    public Task<IActionResult> Progress(int id, CancellationToken ct) =>
        RunAsync(() => _courses.ProgressAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct));

    [HttpGet("api/courses/{id:int}/prerequisites")]
    [HttpGet("api/v2/courses/{id:int}/prerequisites")]
    public Task<IActionResult> Prerequisites(int id, CancellationToken ct) =>
        RunAsync(() => _courses.PrerequisitesAsync(_tenant.GetTenantIdOrThrow(), id, OptionalUserId(), ct));

    [HttpPost("api/courses/{id:int}/lessons/{lessonId:int}/complete")]
    [HttpPost("api/v2/courses/{id:int}/lessons/{lessonId:int}/complete")]
    public Task<IActionResult> CompleteLesson(int id, int lessonId, [FromBody] CourseCompatLessonCompleteRequest request, CancellationToken ct) =>
        RunAsync(() => _courses.CompleteLessonAsync(_tenant.GetTenantIdOrThrow(), id, lessonId, UserId(), request.WatchPercent, ct));

    [HttpGet("api/courses/{id:int}/certificate")]
    [HttpGet("api/v2/courses/{id:int}/certificate")]
    public Task<IActionResult> Certificate(int id, CancellationToken ct) =>
        RunAsync(() => _courses.CertificateAsync(_tenant.GetTenantIdOrThrow(), id, UserId(), ct));

    [HttpGet("api/courses/{courseId:int}/lessons/{lessonId:int}/discussions")]
    [HttpGet("api/v2/courses/{courseId:int}/lessons/{lessonId:int}/discussions")]
    public Task<IActionResult> Discussions(int courseId, int lessonId, CancellationToken ct) =>
        RunAsync(() => _courses.DiscussionsAsync(_tenant.GetTenantIdOrThrow(), courseId, lessonId, ct));

    [HttpPost("api/courses/{courseId:int}/lessons/{lessonId:int}/discussions")]
    [HttpPost("api/v2/courses/{courseId:int}/lessons/{lessonId:int}/discussions")]
    public Task<IActionResult> StoreDiscussion(int courseId, int lessonId, [FromBody] CourseCompatDiscussionRequest request, CancellationToken ct) =>
        RunAsync(() => _courses.StoreDiscussionAsync(_tenant.GetTenantIdOrThrow(), courseId, lessonId, UserId(), request, ct), StatusCodes.Status201Created);

    [HttpDelete("api/courses/discussions/{id:int}")]
    [HttpDelete("api/v2/courses/discussions/{id:int}")]
    public Task<IActionResult> DeleteDiscussion(int id, CancellationToken ct) =>
        RunAsync(async () => new { deleted = await _courses.DeleteDiscussionAsync(_tenant.GetTenantIdOrThrow(), id, ct) });

    [HttpGet("api/courses/quizzes/{quizId:int}")]
    [HttpGet("api/v2/courses/quizzes/{quizId:int}")]
    public Task<IActionResult> Quiz(int quizId, CancellationToken ct) =>
        RunAsync(() => _courses.QuizAsync(_tenant.GetTenantIdOrThrow(), quizId, ct));

    [HttpPost("api/courses/quizzes/{quizId:int}/attempt")]
    [HttpPost("api/v2/courses/quizzes/{quizId:int}/attempt")]
    public Task<IActionResult> AttemptQuiz(int quizId, [FromBody] CourseCompatQuizAttemptRequest request, CancellationToken ct) =>
        RunAsync(() => _courses.AttemptQuizAsync(_tenant.GetTenantIdOrThrow(), quizId, UserId(), request, ct), StatusCodes.Status201Created);

    [HttpGet("api/courses/mine")]
    [HttpGet("api/v2/courses/mine")]
    public Task<IActionResult> Authored(CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var userId = UserId();
            await EnsureCourseAuthorAsync(tenantId, userId, ct);
            return await _courses.AuthoredAsync(tenantId, userId, ct);
        });

    [HttpGet("api/courses/{id:int}/analytics")]
    [HttpGet("api/v2/courses/{id:int}/analytics")]
    public Task<IActionResult> Analytics(int id, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, id, UserId(), ct);
            return await _courses.AnalyticsAsync(tenantId, id, ct);
        });

    [HttpGet("api/courses/{courseId:int}/grading")]
    [HttpGet("api/v2/courses/{courseId:int}/grading")]
    public Task<IActionResult> GradingQueue(int courseId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.GradingQueueAsync(tenantId, courseId, ct);
        });

    [HttpPost("api/courses/attempts/{attemptId:int}/grade")]
    [HttpPost("api/v2/courses/attempts/{attemptId:int}/grade")]
    public Task<IActionResult> GradeAttempt(int attemptId, [FromBody] CourseCompatGradeAttemptRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var courseId = await _courses.GetCourseIdForAttemptAsync(tenantId, attemptId, ct);
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.GradeAttemptAsync(tenantId, attemptId, request, ct);
        });

    [HttpPost("api/courses/{courseId:int}/quizzes")]
    [HttpPost("api/v2/courses/{courseId:int}/quizzes")]
    public Task<IActionResult> StoreQuiz(int courseId, [FromBody] CourseCompatQuizRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.StoreQuizAsync(tenantId, courseId, request, ct);
        }, StatusCodes.Status201Created);

    [HttpPost("api/courses/{courseId:int}/quizzes/{quizId:int}/questions")]
    [HttpPost("api/v2/courses/{courseId:int}/quizzes/{quizId:int}/questions")]
    public Task<IActionResult> StoreQuestion(int courseId, int quizId, [FromBody] CourseCompatQuestionRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.StoreQuestionAsync(tenantId, courseId, quizId, request, ct);
        }, StatusCodes.Status201Created);

    [HttpDelete("api/courses/{courseId:int}/quizzes/{quizId:int}/questions/{questionId:int}")]
    [HttpDelete("api/v2/courses/{courseId:int}/quizzes/{quizId:int}/questions/{questionId:int}")]
    public Task<IActionResult> DeleteQuestion(int courseId, int quizId, int questionId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return new { deleted = await _courses.DeleteQuestionAsync(tenantId, courseId, quizId, questionId, ct) };
        });

    [HttpGet("api/courses/{courseId:int}/cohorts")]
    [HttpGet("api/v2/courses/{courseId:int}/cohorts")]
    public Task<IActionResult> Cohorts(int courseId, CancellationToken ct) =>
        RunAsync(() => _courses.CohortsAsync(_tenant.GetTenantIdOrThrow(), courseId, ct));

    [HttpPost("api/courses/{courseId:int}/cohorts")]
    [HttpPost("api/v2/courses/{courseId:int}/cohorts")]
    public Task<IActionResult> StoreCohort(int courseId, [FromBody] CourseCompatCohortRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.StoreCohortAsync(tenantId, courseId, request, ct);
        }, StatusCodes.Status201Created);

    [HttpDelete("api/courses/{courseId:int}/cohorts/{cohortId:int}")]
    [HttpDelete("api/v2/courses/{courseId:int}/cohorts/{cohortId:int}")]
    public Task<IActionResult> DeleteCohort(int courseId, int cohortId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return new { deleted = await _courses.DeleteCohortAsync(tenantId, courseId, cohortId, ct) };
        });

    [HttpGet("api/groups/{groupId:int}/courses")]
    [HttpGet("api/v2/groups/{groupId:int}/courses")]
    public Task<IActionResult> ForGroup(int groupId, CancellationToken ct) =>
        RunAsync(() => _courses.CoursesForGroupAsync(_tenant.GetTenantIdOrThrow(), groupId, OptionalUserId(), ct));

    [HttpGet("api/courses/{courseId:int}/groups")]
    [HttpGet("api/v2/courses/{courseId:int}/groups")]
    public Task<IActionResult> GroupsForCourse(int courseId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.GroupsForCourseAsync(tenantId, courseId, ct);
        });

    [HttpPost("api/courses/{courseId:int}/groups/{groupId:int}")]
    [HttpPost("api/v2/courses/{courseId:int}/groups/{groupId:int}")]
    public Task<IActionResult> AttachGroup(int courseId, int groupId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var userId = UserId();
            var isAdmin = HasAdminRole();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, userId, ct);
            await _courses.EnsureGroupManageableAsync(tenantId, groupId, userId, isAdmin, ct);
            return await _courses.AttachGroupAsync(tenantId, courseId, groupId, ct);
        }, StatusCodes.Status201Created);

    [HttpDelete("api/courses/{courseId:int}/groups/{groupId:int}")]
    [HttpDelete("api/v2/courses/{courseId:int}/groups/{groupId:int}")]
    public Task<IActionResult> DetachGroup(int courseId, int groupId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var userId = UserId();
            var isAdmin = HasAdminRole();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, userId, ct);
            await _courses.EnsureGroupManageableAsync(tenantId, groupId, userId, isAdmin, ct);
            return new { detached = await _courses.DetachGroupAsync(tenantId, courseId, groupId, ct) };
        });

    [HttpPost("api/courses/{courseId:int}/sections")]
    [HttpPost("api/v2/courses/{courseId:int}/sections")]
    public Task<IActionResult> StoreSection(int courseId, [FromBody] CourseCompatSectionRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.StoreSectionAsync(tenantId, courseId, request, ct);
        }, StatusCodes.Status201Created);

    [HttpPut("api/courses/{courseId:int}/sections/{sectionId:int}")]
    [HttpPut("api/v2/courses/{courseId:int}/sections/{sectionId:int}")]
    public Task<IActionResult> UpdateSection(int courseId, int sectionId, [FromBody] CourseCompatSectionRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.UpdateSectionAsync(tenantId, courseId, sectionId, request, ct);
        });

    [HttpDelete("api/courses/{courseId:int}/sections/{sectionId:int}")]
    [HttpDelete("api/v2/courses/{courseId:int}/sections/{sectionId:int}")]
    public Task<IActionResult> DeleteSection(int courseId, int sectionId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return new { deleted = await _courses.DeleteSectionAsync(tenantId, courseId, sectionId, ct) };
        });

    [HttpPost("api/courses/{courseId:int}/lessons")]
    [HttpPost("api/v2/courses/{courseId:int}/lessons")]
    public Task<IActionResult> StoreLesson(int courseId, [FromBody] CourseCompatLessonRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.StoreLessonAsync(tenantId, courseId, request, ct);
        }, StatusCodes.Status201Created);

    [HttpPut("api/courses/{courseId:int}/lessons/{lessonId:int}")]
    [HttpPut("api/v2/courses/{courseId:int}/lessons/{lessonId:int}")]
    public Task<IActionResult> UpdateLesson(int courseId, int lessonId, [FromBody] CourseCompatLessonRequest request, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return await _courses.UpdateLessonAsync(tenantId, courseId, lessonId, request, ct);
        });

    [HttpDelete("api/courses/{courseId:int}/lessons/{lessonId:int}")]
    [HttpDelete("api/v2/courses/{courseId:int}/lessons/{lessonId:int}")]
    public Task<IActionResult> DeleteLesson(int courseId, int lessonId, CancellationToken ct) =>
        RunAsync(async () =>
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            await EnsureCourseOwnerOrAdminAsync(tenantId, courseId, UserId(), ct);
            return new { deleted = await _courses.DeleteLessonAsync(tenantId, courseId, lessonId, ct) };
        });

    [HttpPost("api/admin/courses/discussions/{id:int}/hide")]
    [HttpPost("api/v2/admin/courses/discussions/{id:int}/hide")]
    public Task<IActionResult> HideDiscussion(int id, CancellationToken ct) =>
        RunAsync(async () => new { hidden = await _courses.HideDiscussionAsync(_tenant.GetTenantIdOrThrow(), id, ct) });

    private async Task<IActionResult> RunAsync<T>(Func<Task<T>> action, int successStatus = StatusCodes.Status200OK)
    {
        try
        {
            await EnsureCoursesFeatureAsync();
            var data = await action();
            return successStatus == StatusCodes.Status200OK
                ? Ok(new { data })
                : StatusCode(successStatus, new { data });
        }
        catch (CoursesCompatibilityFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, LaravelError("FEATURE_DISABLED", ex.Message));
        }
        catch (CoursesCompatibilityValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION_FAILED", ex.Message));
        }
        catch (CoursesCompatibilityForbiddenException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, LaravelError("FORBIDDEN", ex.Message));
        }
        catch (CoursesCompatibilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    private async Task EnsureCoursesFeatureAsync()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _courses.IsCoursesFeatureEnabledAsync(tenantId, HttpContext?.RequestAborted ?? CancellationToken.None))
        {
            throw new CoursesCompatibilityFeatureDisabledException("Courses feature is not enabled for this tenant.");
        }
    }

    private int UserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("user_id");

        return int.TryParse(raw, out var id) ? id : 0;
    }

    private int? OptionalUserId()
    {
        var id = UserId();
        return id <= 0 ? null : id;
    }

    private async Task EnsureCourseAuthorAsync(int tenantId, int userId, CancellationToken ct)
    {
        if (await _courses.IsMemberAuthoringAllowedAsync(tenantId, ct))
        {
            return;
        }

        if (HasAdminRole() || await _courses.HasInstructorGrantAsync(tenantId, userId, ct))
        {
            return;
        }

        throw new CoursesCompatibilityForbiddenException("Course authoring is restricted to instructors and admins");
    }

    private async Task EnsureCourseOwnerOrAdminAsync(int tenantId, int courseId, int userId, CancellationToken ct)
    {
        if (HasAdminRole())
        {
            return;
        }

        var authorUserId = await _courses.GetCourseAuthorUserIdAsync(tenantId, courseId, ct);
        if (authorUserId == userId)
        {
            return;
        }

        throw new CoursesCompatibilityForbiddenException("Course can only be managed by its owner or an admin");
    }

    private bool HasAdminRole()
    {
        static bool IsAdminRole(string? role) =>
            string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "super_admin", StringComparison.OrdinalIgnoreCase);

        return User.Claims
            .Where(claim => claim.Type == ClaimTypes.Role || claim.Type == "role")
            .Any(claim => IsAdminRole(claim.Value));
    }

    private static object LaravelError(string code, string message) => new
    {
        errors = new[]
        {
            new { code, message }
        }
    };

    private static ObjectResult FeatureDisabled() =>
        new(LaravelError("FEATURE_DISABLED", "Courses feature is not enabled for this tenant."))
        {
            StatusCode = StatusCodes.Status403Forbidden
        };
}
