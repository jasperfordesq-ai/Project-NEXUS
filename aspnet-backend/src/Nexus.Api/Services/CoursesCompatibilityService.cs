// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CoursesCompatibilityService
{
    public const string StateKey = "courses_compatibility.state";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly Regex SlugUnsafe = new("[^a-z0-9]+", RegexOptions.Compiled);

    private readonly NexusDbContext _db;

    public CoursesCompatibilityService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<CourseBrowseResult> BrowseAsync(int tenantId, int page, int perPage, string? search, int? categoryId, string? level, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var filtered = state.Courses
            .Where(course => course.Status == "published" && course.ModerationStatus == "approved");

        if (!string.IsNullOrWhiteSpace(search))
        {
            filtered = filtered.Where(course =>
                course.Title.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase)
                || (course.Summary?.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase) ?? false));
        }

        if (categoryId.HasValue)
        {
            filtered = filtered.Where(course => course.CategoryId == categoryId.Value);
        }

        if (!string.IsNullOrWhiteSpace(level))
        {
            filtered = filtered.Where(course => string.Equals(course.Level, level.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        var safePage = Math.Max(1, page);
        var safePerPage = Math.Clamp(perPage <= 0 ? 12 : perPage, 1, 50);
        var items = filtered.OrderByDescending(course => course.PublishedAt ?? course.CreatedAt).ToArray();
        return new CourseBrowseResult(
            items.Skip((safePage - 1) * safePerPage).Take(safePerPage).Select(course => HydrateCourse(state, course, null)).ToArray(),
            items.Length,
            safePage,
            safePerPage);
    }

    public async Task<IReadOnlyList<CourseCategoryCompatDto>> CategoriesAsync(int tenantId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        if (state.Categories.Count == 0)
        {
            state.Categories.Add(new CourseCategoryCompatDto(1, "Community learning", "community-learning", null, null, 0));
            await SaveAsync(tenantId, state, ct);
        }

        return state.Categories.OrderBy(category => category.Position).ThenBy(category => category.Name).ToArray();
    }

    public async Task<CourseCompatDto> ShowAsync(int tenantId, string idOrSlug, int? userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var course = FindCourse(state, idOrSlug);
        return HydrateCourse(state, course, userId);
    }

    public async Task<IReadOnlyList<CourseReviewCompatDto>> ReviewsAsync(int tenantId, int courseId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        return state.Reviews
            .Where(review => review.CourseId == courseId && review.Status == "approved")
            .OrderByDescending(review => review.CreatedAt)
            .ToArray();
    }

    public async Task<CourseCompatDto> CreateCourseAsync(int tenantId, int userId, CourseCompatCourseRequest request, CancellationToken ct)
    {
        var title = (request.Title ?? string.Empty).Trim();
        if (title.Length == 0)
        {
            throw new CoursesCompatibilityValidationException("title is required");
        }

        var state = await LoadAsync(tenantId, ct);
        var id = NextId(state.Courses.Select(course => course.Id));
        var now = DateTime.UtcNow;
        var course = new CourseCompatDto(
            id,
            userId,
            request.CategoryId,
            title,
            Slugify(request.Slug ?? title),
            request.Summary,
            request.Description,
            request.CoverImage,
            Clean(request.Level, "beginner"),
            Clean(request.Visibility, "members"),
            Clean(request.EnrollmentType, "self_paced"),
            "draft",
            "pending",
            request.CreditCost ?? 0,
            request.LearnerCreditReward ?? 0,
            request.InstructorCreditReward ?? 0,
            request.Prerequisites,
            0,
            0,
            0,
            0,
            null,
            new CourseUserCompatDto(userId, $"#{userId}", null),
            null,
            [],
            false,
            now,
            now);

        state.Courses.Add(course);
        await SaveAsync(tenantId, state, ct);
        return HydrateCourse(state, course, userId);
    }

    public async Task<CourseCompatDto> UpdateCourseAsync(int tenantId, int id, CourseCompatCourseRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var existing = EnsureCourse(state, id);
        var updated = existing with
        {
            Title = string.IsNullOrWhiteSpace(request.Title) ? existing.Title : request.Title.Trim(),
            Summary = request.Summary ?? existing.Summary,
            Description = request.Description ?? existing.Description,
            CoverImage = request.CoverImage ?? existing.CoverImage,
            Level = Clean(request.Level, existing.Level),
            Visibility = Clean(request.Visibility, existing.Visibility),
            CategoryId = request.CategoryId ?? existing.CategoryId,
            UpdatedAt = DateTime.UtcNow
        };

        Replace(state.Courses, existing, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateCourse(state, updated, null);
    }

    public async Task<CourseCompatDto> SetPublishedAsync(int tenantId, int id, bool published, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var existing = EnsureCourse(state, id);
        var moderationEnabled = published && await IsCourseModerationEnabledAsync(tenantId, ct);
        var moderationStatus = published
            ? moderationEnabled && existing.ModerationStatus != "approved" ? "pending" : "approved"
            : existing.ModerationStatus;
        var updated = existing with
        {
            Status = published ? "published" : "draft",
            ModerationStatus = moderationStatus,
            PublishedAt = published && moderationStatus == "approved" ? existing.PublishedAt ?? DateTime.UtcNow : null,
            UpdatedAt = DateTime.UtcNow
        };
        Replace(state.Courses, existing, updated);
        await SaveAsync(tenantId, state, ct);
        return HydrateCourse(state, updated, null);
    }

    public async Task<bool> DeleteCourseAsync(int tenantId, int id, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var removed = state.Courses.RemoveAll(course => course.Id == id) > 0;
        state.Enrollments.RemoveAll(enrollment => enrollment.CourseId == id);
        state.Sections.RemoveAll(section => section.CourseId == id);
        state.Lessons.RemoveAll(lesson => lesson.CourseId == id);
        state.Reviews.RemoveAll(review => review.CourseId == id);
        state.Cohorts.RemoveAll(cohort => cohort.CourseId == id);
        state.GroupLinks.RemoveAll(link => link.CourseId == id);
        state.Quizzes.RemoveAll(quiz => quiz.CourseId == id);
        state.Discussions.RemoveAll(discussion => discussion.CourseId == id);
        await SaveAsync(tenantId, state, ct);
        return removed;
    }

    public async Task<IReadOnlyList<CourseCompatDto>> AuthoredAsync(int tenantId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return state.Courses
            .Where(course => course.AuthorUserId == userId)
            .OrderByDescending(course => course.CreatedAt)
            .Select(course => HydrateCourse(state, course, userId))
            .ToArray();
    }

    public async Task<CourseEnrollmentCompatDto> EnrollAsync(int tenantId, int courseId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        var existing = state.Enrollments.FirstOrDefault(enrollment =>
            enrollment.CourseId == courseId && enrollment.UserId == userId && enrollment.Status != "dropped");
        if (existing is not null)
        {
            return existing;
        }

        var enrollment = new CourseEnrollmentCompatDto(
            NextId(state.Enrollments.Select(row => row.Id)),
            courseId,
            userId,
            "active",
            0,
            DateTime.UtcNow,
            null,
            null);
        state.Enrollments.Add(enrollment);
        await SaveAsync(tenantId, state, ct);
        return enrollment;
    }

    public async Task<bool> DropAsync(int tenantId, int courseId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var enrollment = state.Enrollments.FirstOrDefault(row => row.CourseId == courseId && row.UserId == userId && row.Status != "dropped");
        if (enrollment is null)
        {
            return false;
        }

        Replace(state.Enrollments, enrollment, enrollment with { Status = "dropped" });
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<IReadOnlyList<CourseEnrollmentCompatDto>> MyCoursesAsync(int tenantId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return state.Enrollments
            .Where(enrollment => enrollment.UserId == userId && enrollment.Status != "dropped")
            .Select(enrollment => enrollment with { Course = HydrateCourse(state, EnsureCourse(state, enrollment.CourseId), userId) })
            .ToArray();
    }

    public async Task<CourseProgressEnvelope> ProgressAsync(int tenantId, int courseId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var enrollment = state.Enrollments.FirstOrDefault(row => row.CourseId == courseId && row.UserId == userId && row.Status != "dropped")
            ?? throw new CoursesCompatibilityNotFoundException("Not enrolled");
        var lessons = state.Lessons.Where(lesson => lesson.CourseId == courseId).OrderBy(lesson => lesson.Position).ToArray();
        return new CourseProgressEnvelope(
            enrollment,
            lessons.Select(lesson =>
            {
                var progress = state.LessonProgress.FirstOrDefault(row => row.EnrollmentId == enrollment.Id && row.LessonId == lesson.Id);
                return progress ?? new CourseLessonProgressCompatDto(lesson.Id, "not_started", 0, null, enrollment.Id);
            }).ToArray(),
            lessons.Select(lesson => new CourseLessonAvailabilityCompatDto(lesson.Id, true, null)).ToArray());
    }

    public async Task<CourseLessonCompletionResult> CompleteLessonAsync(int tenantId, int courseId, int lessonId, int userId, int watchPercent, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var enrollment = state.Enrollments.FirstOrDefault(row => row.CourseId == courseId && row.UserId == userId && row.Status != "dropped")
            ?? throw new CoursesCompatibilityNotFoundException("Not enrolled");
        EnsureLesson(state, courseId, lessonId);
        state.LessonProgress.RemoveAll(row => row.EnrollmentId == enrollment.Id && row.LessonId == lessonId);
        state.LessonProgress.Add(new CourseLessonProgressCompatDto(lessonId, "completed", Math.Clamp(watchPercent, 0, 100), DateTime.UtcNow, enrollment.Id));
        var lessonCount = Math.Max(1, state.Lessons.Count(lesson => lesson.CourseId == courseId));
        var completed = state.LessonProgress.Count(row => row.EnrollmentId == enrollment.Id && row.Status == "completed");
        var percent = (int)Math.Round(completed / (double)lessonCount * 100);
        Replace(state.Enrollments, enrollment, enrollment with
        {
            ProgressPercent = percent,
            Status = percent >= 100 ? "completed" : enrollment.Status,
            CompletedAt = percent >= 100 ? DateTime.UtcNow : enrollment.CompletedAt
        });
        await SaveAsync(tenantId, state, ct);
        return new CourseLessonCompletionResult(percent, percent >= 100);
    }

    public async Task<IReadOnlyList<CoursePrerequisiteCompatDto>> PrerequisitesAsync(int tenantId, int courseId, int? userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var course = EnsureCourse(state, courseId);
        return (course.Prerequisites ?? [])
            .Select(id => EnsureCourse(state, id))
            .Select(course => new CoursePrerequisiteCompatDto(course.Id, course.Title, course.Slug, false))
            .ToArray();
    }

    public async Task<CourseCertificateEnvelope> CertificateAsync(int tenantId, int courseId, int userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var enrollment = state.Enrollments.FirstOrDefault(row => row.CourseId == courseId && row.UserId == userId)
            ?? throw new CoursesCompatibilityNotFoundException("Not enrolled");
        if (enrollment.Status != "completed")
        {
            throw new CoursesCompatibilityForbiddenException("Course not completed");
        }

        var serial = $"COURSE-{tenantId}-{courseId}-{userId}";
        return new CourseCertificateEnvelope(
            new CourseCertificateCompatDto(enrollment.Id, serial, enrollment.CompletedAt),
            $"<h1>Certificate {serial}</h1>");
    }

    public async Task<CourseReviewCompatDto> ReviewAsync(int tenantId, int courseId, int userId, CourseCompatReviewRequest request, CancellationToken ct)
    {
        if (request.Rating is < 1 or > 5)
        {
            throw new CoursesCompatibilityValidationException("rating is required");
        }

        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        state.Reviews.RemoveAll(review => review.CourseId == courseId && review.UserId == userId);
        var review = new CourseReviewCompatDto(
            NextId(state.Reviews.Select(row => row.Id)),
            courseId,
            userId,
            request.Rating,
            request.Body,
            "approved",
            DateTime.UtcNow,
            new CourseUserCompatDto(userId, $"#{userId}", null));
        state.Reviews.Add(review);
        await SaveAsync(tenantId, state, ct);
        return review;
    }

    public async Task<CourseAnalyticsCompatDto> AnalyticsAsync(int tenantId, int courseId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var course = EnsureCourse(state, courseId);
        var enrollments = state.Enrollments.Where(row => row.CourseId == courseId).ToArray();
        var lessons = state.Lessons.Where(row => row.CourseId == courseId).OrderBy(row => row.Position).ToArray();
        var completed = enrollments.Count(row => row.Status == "completed");
        return new CourseAnalyticsCompatDto(
            new CourseAnalyticsCourseDto(course.Id, course.Title),
            new CourseEnrollmentStatsDto(enrollments.Length, enrollments.Count(row => row.Status == "active"), completed, enrollments.Count(row => row.Status == "dropped")),
            enrollments.Length == 0 ? 0 : Math.Round(completed / (double)enrollments.Length * 100, 1),
            enrollments.Length == 0 ? 0 : Math.Round(enrollments.Average(row => row.ProgressPercent), 1),
            0,
            state.Attempts.Count(row => state.Quizzes.Any(q => q.CourseId == courseId && q.Id == row.QuizId)),
            lessons.Select(lesson => new CoursePerLessonAnalyticsDto(lesson.Id, lesson.Title, state.LessonProgress.Count(row => row.LessonId == lesson.Id && row.Status == "completed"))).ToArray());
    }

    public async Task<CourseSectionCompatDto> StoreSectionAsync(int tenantId, int courseId, CourseCompatSectionRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        var section = new CourseSectionCompatDto(
            NextId(state.Sections.Select(row => row.Id)),
            courseId,
            string.IsNullOrWhiteSpace(request.Title) ? "Untitled section" : request.Title.Trim(),
            request.Position ?? state.Sections.Count(row => row.CourseId == courseId) + 1,
            []);
        state.Sections.Add(section);
        await SaveAsync(tenantId, state, ct);
        return section;
    }

    public async Task<CourseSectionCompatDto> UpdateSectionAsync(int tenantId, int courseId, int sectionId, CourseCompatSectionRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var section = EnsureSection(state, courseId, sectionId);
        var updated = section with
        {
            Title = string.IsNullOrWhiteSpace(request.Title) ? section.Title : request.Title.Trim(),
            Position = request.Position ?? section.Position
        };
        Replace(state.Sections, section, updated);
        await SaveAsync(tenantId, state, ct);
        return updated;
    }

    public async Task<bool> DeleteSectionAsync(int tenantId, int courseId, int sectionId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureSection(state, courseId, sectionId);
        state.Sections.RemoveAll(row => row.Id == sectionId && row.CourseId == courseId);
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<CourseLessonCompatDto> StoreLessonAsync(int tenantId, int courseId, CourseCompatLessonRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        var lesson = new CourseLessonCompatDto(
            NextId(state.Lessons.Select(row => row.Id)),
            courseId,
            request.SectionId,
            string.IsNullOrWhiteSpace(request.Title) ? "Untitled lesson" : request.Title.Trim(),
            Clean(request.ContentType, "text"),
            request.Body,
            request.VideoUrl,
            request.AttachmentUrl,
            request.EmbedUrl,
            request.Position ?? state.Lessons.Count(row => row.CourseId == courseId) + 1,
            request.MinWatchPercent ?? 80,
            request.DripType ?? "none",
            request.DripOffsetDays,
            request.DripDate,
            request.IsPreview ?? false,
            null);
        state.Lessons.Add(lesson);
        await SaveAsync(tenantId, state, ct);
        return lesson;
    }

    public async Task<CourseLessonCompatDto> UpdateLessonAsync(int tenantId, int courseId, int lessonId, CourseCompatLessonRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var lesson = EnsureLesson(state, courseId, lessonId);
        var updated = lesson with
        {
            Title = string.IsNullOrWhiteSpace(request.Title) ? lesson.Title : request.Title.Trim(),
            ContentType = Clean(request.ContentType, lesson.ContentType),
            Body = request.Body ?? lesson.Body,
            Position = request.Position ?? lesson.Position,
            IsPreview = request.IsPreview ?? lesson.IsPreview
        };
        Replace(state.Lessons, lesson, updated);
        await SaveAsync(tenantId, state, ct);
        return updated;
    }

    public async Task<bool> DeleteLessonAsync(int tenantId, int courseId, int lessonId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureLesson(state, courseId, lessonId);
        state.Lessons.RemoveAll(row => row.Id == lessonId && row.CourseId == courseId);
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<IReadOnlyList<CourseCohortCompatDto>> CohortsAsync(int tenantId, int courseId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        return state.Cohorts.Where(row => row.CourseId == courseId).OrderBy(row => row.StartDate).ToArray();
    }

    public async Task<CourseCohortCompatDto> StoreCohortAsync(int tenantId, int courseId, CourseCompatCohortRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new CoursesCompatibilityValidationException("name is required");
        }

        var cohort = new CourseCohortCompatDto(NextId(state.Cohorts.Select(row => row.Id)), courseId, request.Name.Trim(), request.StartDate, request.EndDate, request.Capacity);
        state.Cohorts.Add(cohort);
        await SaveAsync(tenantId, state, ct);
        return cohort;
    }

    public async Task<bool> DeleteCohortAsync(int tenantId, int courseId, int cohortId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var removed = state.Cohorts.RemoveAll(row => row.CourseId == courseId && row.Id == cohortId) > 0;
        await SaveAsync(tenantId, state, ct);
        return removed;
    }

    public async Task<CourseGroupLinkCompatDto> AttachGroupAsync(int tenantId, int courseId, int groupId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        var existing = state.GroupLinks.FirstOrDefault(row => row.CourseId == courseId && row.GroupId == groupId);
        if (existing is not null)
        {
            return existing;
        }

        var link = new CourseGroupLinkCompatDto(NextId(state.GroupLinks.Select(row => row.Id)), courseId, groupId);
        state.GroupLinks.Add(link);
        await SaveAsync(tenantId, state, ct);
        return link;
    }

    public async Task<bool> DetachGroupAsync(int tenantId, int courseId, int groupId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var detached = state.GroupLinks.RemoveAll(row => row.CourseId == courseId && row.GroupId == groupId) > 0;
        await SaveAsync(tenantId, state, ct);
        return detached;
    }

    public async Task EnsureGroupManageableAsync(int tenantId, int groupId, int userId, bool isPlatformAdmin, CancellationToken ct)
    {
        var group = await _db.Groups
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == groupId, ct);

        if (group is null)
        {
            throw new CoursesCompatibilityNotFoundException("Group not found");
        }

        if (isPlatformAdmin || group.CreatedById == userId)
        {
            return;
        }

        var canManage = await _db.GroupMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(row =>
                row.TenantId == tenantId
                && row.GroupId == groupId
                && row.UserId == userId
                && (row.Role == Nexus.Api.Entities.Group.Roles.Owner || row.Role == Nexus.Api.Entities.Group.Roles.Admin), ct);

        if (!canManage)
        {
            throw new CoursesCompatibilityForbiddenException("Group cannot be modified by this user");
        }
    }

    public async Task<IReadOnlyList<int>> GroupsForCourseAsync(int tenantId, int courseId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return state.GroupLinks.Where(row => row.CourseId == courseId).Select(row => row.GroupId).Distinct().ToArray();
    }

    public async Task<IReadOnlyList<CourseCompatDto>> CoursesForGroupAsync(int tenantId, int groupId, int? userId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var courseIds = state.GroupLinks.Where(row => row.GroupId == groupId).Select(row => row.CourseId).ToHashSet();
        return state.Courses.Where(course => courseIds.Contains(course.Id)).Select(course => HydrateCourse(state, course, userId)).ToArray();
    }

    public async Task<IReadOnlyList<CourseDiscussionCompatDto>> DiscussionsAsync(int tenantId, int courseId, int lessonId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureLesson(state, courseId, lessonId);
        return state.Discussions.Where(row => row.CourseId == courseId && row.LessonId == lessonId && row.Status != "deleted").OrderBy(row => row.CreatedAt).ToArray();
    }

    public async Task<CourseDiscussionCompatDto> StoreDiscussionAsync(int tenantId, int courseId, int lessonId, int userId, CourseCompatDiscussionRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Body))
        {
            throw new CoursesCompatibilityValidationException("body is required");
        }

        var state = await LoadAsync(tenantId, ct);
        EnsureLesson(state, courseId, lessonId);
        var discussion = new CourseDiscussionCompatDto(
            NextId(state.Discussions.Select(row => row.Id)),
            courseId,
            lessonId,
            userId,
            request.ParentId,
            request.Body.Trim(),
            "visible",
            DateTime.UtcNow,
            new CourseUserCompatDto(userId, $"#{userId}", null),
            []);
        state.Discussions.Add(discussion);
        await SaveAsync(tenantId, state, ct);
        return discussion;
    }

    public async Task<bool> DeleteDiscussionAsync(int tenantId, int id, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var discussion = state.Discussions.FirstOrDefault(row => row.Id == id)
            ?? throw new CoursesCompatibilityNotFoundException("Discussion not found");
        Replace(state.Discussions, discussion, discussion with { Status = "deleted" });
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<bool> HideDiscussionAsync(int tenantId, int id, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var discussion = state.Discussions.FirstOrDefault(row => row.Id == id)
            ?? throw new CoursesCompatibilityNotFoundException("Discussion not found");
        Replace(state.Discussions, discussion, discussion with { Status = "hidden" });
        await SaveAsync(tenantId, state, ct);
        return true;
    }

    public async Task<CourseQuizCompatDto> StoreQuizAsync(int tenantId, int courseId, CourseCompatQuizRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureCourse(state, courseId);
        var quiz = new CourseQuizCompatDto(
            NextId(state.Quizzes.Select(row => row.Id)),
            courseId,
            request.LessonId,
            string.IsNullOrWhiteSpace(request.Title) ? "Quiz" : request.Title.Trim(),
            request.Description,
            request.PassMarkPercent ?? 70,
            request.MaxAttempts ?? 0,
            request.TimeLimitMinutes,
            []);
        state.Quizzes.Add(quiz);
        await SaveAsync(tenantId, state, ct);
        return quiz;
    }

    public async Task<CourseQuizQuestionCompatDto> StoreQuestionAsync(int tenantId, int courseId, int quizId, CourseCompatQuestionRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureQuiz(state, courseId, quizId);
        var question = new CourseQuizQuestionCompatDto(
            NextId(state.Questions.Select(row => row.Id)),
            quizId,
            Clean(request.Type, "mcq"),
            string.IsNullOrWhiteSpace(request.Prompt) ? "Question" : request.Prompt.Trim(),
            request.Options,
            request.Points <= 0 ? 1 : request.Points,
            request.Position ?? state.Questions.Count(row => row.QuizId == quizId) + 1);
        state.Questions.Add(question);
        await SaveAsync(tenantId, state, ct);
        return question;
    }

    public async Task<bool> DeleteQuestionAsync(int tenantId, int courseId, int quizId, int questionId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        EnsureQuiz(state, courseId, quizId);
        var removed = state.Questions.RemoveAll(row => row.QuizId == quizId && row.Id == questionId) > 0;
        await SaveAsync(tenantId, state, ct);
        return removed;
    }

    public async Task<CourseQuizCompatDto> QuizAsync(int tenantId, int quizId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var quiz = state.Quizzes.FirstOrDefault(row => row.Id == quizId)
            ?? throw new CoursesCompatibilityNotFoundException("Quiz not found");
        return quiz with { Questions = state.Questions.Where(row => row.QuizId == quizId).OrderBy(row => row.Position).ToArray() };
    }

    public async Task<CourseQuizAttemptResult> AttemptQuizAsync(int tenantId, int quizId, int userId, CourseCompatQuizAttemptRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var quiz = state.Quizzes.FirstOrDefault(row => row.Id == quizId)
            ?? throw new CoursesCompatibilityNotFoundException("Quiz not found");
        var attempt = new CourseQuizAttemptCompatDto(
            NextId(state.Attempts.Select(row => row.Id)),
            quizId,
            userId,
            request.Answers,
            100,
            "graded",
            DateTime.UtcNow,
            null,
            new CourseUserCompatDto(userId, $"#{userId}", null));
        state.Attempts.Add(attempt);
        await SaveAsync(tenantId, state, ct);
        return new CourseQuizAttemptResult(100, true, false, attempt.Id);
    }

    public async Task<IReadOnlyList<CourseQuizAttemptCompatDto>> GradingQueueAsync(int tenantId, int courseId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var quizIds = state.Quizzes.Where(row => row.CourseId == courseId).Select(row => row.Id).ToHashSet();
        return state.Attempts.Where(row => quizIds.Contains(row.QuizId)).ToArray();
    }

    public async Task<CourseQuizAttemptCompatDto> GradeAttemptAsync(int tenantId, int attemptId, CourseCompatGradeAttemptRequest request, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var attempt = state.Attempts.FirstOrDefault(row => row.Id == attemptId)
            ?? throw new CoursesCompatibilityNotFoundException("Attempt not found");
        var updated = attempt with { ScorePercent = request.ScorePercent, GradingStatus = "graded" };
        Replace(state.Attempts, attempt, updated);
        await SaveAsync(tenantId, state, ct);
        return updated;
    }

    public async Task<bool> IsMemberAuthoringAllowedAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "courses.allow_member_authoring")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return !bool.TryParse(value, out var allowed) || allowed;
    }

    public async Task<bool> IsCoursesFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.courses")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return !IsExplicitlyDisabled(value);
    }

    public async Task<bool> HasInstructorGrantAsync(int tenantId, int userId, CancellationToken ct)
    {
        return await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AnyAsync(config =>
                config.TenantId == tenantId
                && config.Key == $"{AdminCoursesService.InstructorKeyPrefix}{userId}", ct);
    }

    public async Task<int> GetCourseAuthorUserIdAsync(int tenantId, int courseId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        return EnsureCourse(state, courseId).AuthorUserId;
    }

    public async Task<int> GetCourseIdForAttemptAsync(int tenantId, int attemptId, CancellationToken ct)
    {
        var state = await LoadAsync(tenantId, ct);
        var attempt = state.Attempts.FirstOrDefault(row => row.Id == attemptId)
            ?? throw new CoursesCompatibilityNotFoundException("Attempt not found");
        var quiz = state.Quizzes.FirstOrDefault(row => row.Id == attempt.QuizId)
            ?? throw new CoursesCompatibilityNotFoundException("Quiz not found");
        EnsureCourse(state, quiz.CourseId);
        return quiz.CourseId;
    }

    private static bool IsExplicitlyDisabled(string? value)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            return false;
        }

        return string.Equals(normalized, "false", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, "0", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, "no", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, "off", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<CourseCompatibilityState> LoadAsync(int tenantId, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == StateKey, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
        {
            return new CourseCompatibilityState();
        }

        try
        {
            return JsonSerializer.Deserialize<CourseCompatibilityState>(row.Value, JsonOptions) ?? new CourseCompatibilityState();
        }
        catch (JsonException)
        {
            return new CourseCompatibilityState();
        }
    }

    private async Task SaveAsync(int tenantId, CourseCompatibilityState state, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == StateKey, ct);
        var now = DateTime.UtcNow;
        if (row is null)
        {
            row = new TenantConfig { TenantId = tenantId, Key = StateKey, CreatedAt = now };
            _db.TenantConfigs.Add(row);
        }

        row.Value = JsonSerializer.Serialize(state, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private async Task<bool> IsCourseModerationEnabledAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "courses.moderation_enabled")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return bool.TryParse(value, out var enabled) && enabled;
    }

    private CourseCompatDto HydrateCourse(CourseCompatibilityState state, CourseCompatDto course, int? userId)
    {
        var category = course.CategoryId.HasValue
            ? state.Categories.FirstOrDefault(category => category.Id == course.CategoryId.Value)
            : null;
        var sections = state.Sections
            .Where(section => section.CourseId == course.Id)
            .OrderBy(section => section.Position)
            .Select(section => section with
            {
                Lessons = state.Lessons
                    .Where(lesson => lesson.CourseId == course.Id && lesson.SectionId == section.Id)
                    .OrderBy(lesson => lesson.Position)
                    .Select(lesson => lesson with
                    {
                        Quiz = HydrateLessonQuiz(state, lesson.Id)
                    })
                    .ToArray()
            })
            .ToArray();
        var approvedReviews = state.Reviews
            .Where(row => row.CourseId == course.Id && row.Status == "approved")
            .ToArray();
        var isEnrolled = userId.HasValue && state.Enrollments.Any(row => row.CourseId == course.Id && row.UserId == userId.Value && row.Status != "dropped");
        return course with
        {
            Category = category,
            Sections = sections,
            IsEnrolled = isEnrolled,
            EnrollmentCount = state.Enrollments.Count(row => row.CourseId == course.Id && row.Status != "dropped"),
            CompletionCount = state.Enrollments.Count(row => row.CourseId == course.Id && row.Status == "completed"),
            RatingCount = approvedReviews.Length,
            RatingAvg = approvedReviews.Length == 0 ? 0 : Math.Round(approvedReviews.Average(row => row.Rating), 1)
        };
    }

    private static CourseQuizCompatDto? HydrateLessonQuiz(CourseCompatibilityState state, int lessonId)
    {
        var quiz = state.Quizzes.FirstOrDefault(row => row.LessonId == lessonId);
        return quiz is null
            ? null
            : quiz with
            {
                Questions = state.Questions
                    .Where(question => question.QuizId == quiz.Id)
                    .OrderBy(question => question.Position)
                    .ToArray()
            };
    }

    private static CourseCompatDto FindCourse(CourseCompatibilityState state, string idOrSlug)
    {
        var course = int.TryParse(idOrSlug, out var id)
            ? state.Courses.FirstOrDefault(row => row.Id == id)
            : state.Courses.FirstOrDefault(row => string.Equals(row.Slug, idOrSlug, StringComparison.OrdinalIgnoreCase));
        return course ?? throw new CoursesCompatibilityNotFoundException("Course not found");
    }

    private static CourseCompatDto EnsureCourse(CourseCompatibilityState state, int id)
        => state.Courses.FirstOrDefault(row => row.Id == id)
           ?? throw new CoursesCompatibilityNotFoundException("Course not found");

    private static CourseSectionCompatDto EnsureSection(CourseCompatibilityState state, int courseId, int sectionId)
        => state.Sections.FirstOrDefault(row => row.CourseId == courseId && row.Id == sectionId)
           ?? throw new CoursesCompatibilityNotFoundException("Section not found");

    private static CourseLessonCompatDto EnsureLesson(CourseCompatibilityState state, int courseId, int lessonId)
        => state.Lessons.FirstOrDefault(row => row.CourseId == courseId && row.Id == lessonId)
           ?? throw new CoursesCompatibilityNotFoundException("Lesson not found");

    private static CourseQuizCompatDto EnsureQuiz(CourseCompatibilityState state, int courseId, int quizId)
        => state.Quizzes.FirstOrDefault(row => row.CourseId == courseId && row.Id == quizId)
           ?? throw new CoursesCompatibilityNotFoundException("Quiz not found");

    private static int NextId(IEnumerable<int> values)
    {
        var ids = values.ToArray();
        return ids.Length == 0 ? 1 : ids.Max() + 1;
    }

    private static string Clean(string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string Slugify(string value)
    {
        var slug = SlugUnsafe.Replace(value.Trim().ToLowerInvariant(), "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "course" : slug;
    }

    private static void Replace<T>(List<T> list, T oldValue, T newValue)
    {
        var index = list.IndexOf(oldValue);
        if (index >= 0)
        {
            list[index] = newValue;
        }
    }
}

public sealed class CourseCompatibilityState
{
    [JsonPropertyName("courses")] public List<CourseCompatDto> Courses { get; set; } = [];
    [JsonPropertyName("categories")] public List<CourseCategoryCompatDto> Categories { get; set; } = [];
    [JsonPropertyName("enrollments")] public List<CourseEnrollmentCompatDto> Enrollments { get; set; } = [];
    [JsonPropertyName("lesson_progress")] public List<CourseLessonProgressCompatDto> LessonProgress { get; set; } = [];
    [JsonPropertyName("sections")] public List<CourseSectionCompatDto> Sections { get; set; } = [];
    [JsonPropertyName("lessons")] public List<CourseLessonCompatDto> Lessons { get; set; } = [];
    [JsonPropertyName("reviews")] public List<CourseReviewCompatDto> Reviews { get; set; } = [];
    [JsonPropertyName("discussions")] public List<CourseDiscussionCompatDto> Discussions { get; set; } = [];
    [JsonPropertyName("cohorts")] public List<CourseCohortCompatDto> Cohorts { get; set; } = [];
    [JsonPropertyName("group_links")] public List<CourseGroupLinkCompatDto> GroupLinks { get; set; } = [];
    [JsonPropertyName("quizzes")] public List<CourseQuizCompatDto> Quizzes { get; set; } = [];
    [JsonPropertyName("questions")] public List<CourseQuizQuestionCompatDto> Questions { get; set; } = [];
    [JsonPropertyName("attempts")] public List<CourseQuizAttemptCompatDto> Attempts { get; set; } = [];
}

public sealed record CourseBrowseResult(IReadOnlyList<CourseCompatDto> Items, int Total, int Page, int PerPage);

public sealed record CourseCompatDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("author_user_id")] int AuthorUserId,
    [property: JsonPropertyName("category_id")] int? CategoryId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("summary")] string? Summary,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("cover_image")] string? CoverImage,
    [property: JsonPropertyName("level")] string Level,
    [property: JsonPropertyName("visibility")] string Visibility,
    [property: JsonPropertyName("enrollment_type")] string EnrollmentType,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("moderation_status")] string ModerationStatus,
    [property: JsonPropertyName("credit_cost")] decimal CreditCost,
    [property: JsonPropertyName("learner_credit_reward")] decimal LearnerCreditReward,
    [property: JsonPropertyName("instructor_credit_reward")] decimal InstructorCreditReward,
    [property: JsonPropertyName("prerequisites")] int[]? Prerequisites,
    [property: JsonPropertyName("enrollment_count")] int EnrollmentCount,
    [property: JsonPropertyName("completion_count")] int CompletionCount,
    [property: JsonPropertyName("rating_avg")] double RatingAvg,
    [property: JsonPropertyName("rating_count")] int RatingCount,
    [property: JsonPropertyName("published_at")] DateTime? PublishedAt,
    [property: JsonPropertyName("author")] CourseUserCompatDto? Author,
    [property: JsonPropertyName("category")] CourseCategoryCompatDto? Category,
    [property: JsonPropertyName("sections")] IReadOnlyList<CourseSectionCompatDto> Sections,
    [property: JsonPropertyName("is_enrolled")] bool IsEnrolled,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime UpdatedAt);

public sealed record CourseUserCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("name")] string Name, [property: JsonPropertyName("avatar_url")] string? AvatarUrl);
public sealed record CourseCategoryCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("name")] string Name, [property: JsonPropertyName("slug")] string Slug, [property: JsonPropertyName("description")] string? Description, [property: JsonPropertyName("icon")] string? Icon, [property: JsonPropertyName("position")] int Position);
public sealed record CourseSectionCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("position")] int Position, [property: JsonPropertyName("lessons")] IReadOnlyList<CourseLessonCompatDto> Lessons);
public sealed record CourseLessonCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("section_id")] int? SectionId, [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("content_type")] string ContentType, [property: JsonPropertyName("body")] string? Body, [property: JsonPropertyName("video_url")] string? VideoUrl, [property: JsonPropertyName("attachment_url")] string? AttachmentUrl, [property: JsonPropertyName("embed_url")] string? EmbedUrl, [property: JsonPropertyName("position")] int Position, [property: JsonPropertyName("min_watch_percent")] int MinWatchPercent, [property: JsonPropertyName("drip_type")] string? DripType, [property: JsonPropertyName("drip_offset_days")] int? DripOffsetDays, [property: JsonPropertyName("drip_date")] DateTime? DripDate, [property: JsonPropertyName("is_preview")] bool IsPreview, [property: JsonPropertyName("quiz")] CourseQuizCompatDto? Quiz);
public sealed record CourseEnrollmentCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("user_id")] int UserId, [property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("progress_percent")] int ProgressPercent, [property: JsonPropertyName("enrolled_at")] DateTime? EnrolledAt, [property: JsonPropertyName("completed_at")] DateTime? CompletedAt, [property: JsonPropertyName("course")] CourseCompatDto? Course);
public sealed record CourseLessonProgressCompatDto([property: JsonPropertyName("lesson_id")] int LessonId, [property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("watch_percent")] int WatchPercent, [property: JsonPropertyName("completed_at")] DateTime? CompletedAt, [property: JsonIgnore] int EnrollmentId);
public sealed record CourseLessonAvailabilityCompatDto([property: JsonPropertyName("lesson_id")] int LessonId, [property: JsonPropertyName("available")] bool Available, [property: JsonPropertyName("unlock_at")] DateTime? UnlockAt);
public sealed record CourseProgressEnvelope([property: JsonPropertyName("enrollment")] CourseEnrollmentCompatDto Enrollment, [property: JsonPropertyName("lessons")] IReadOnlyList<CourseLessonProgressCompatDto> Lessons, [property: JsonPropertyName("availability")] IReadOnlyList<CourseLessonAvailabilityCompatDto> Availability);
public sealed record CourseLessonCompletionResult([property: JsonPropertyName("progress_percent")] int ProgressPercent, [property: JsonPropertyName("course_completed")] bool CourseCompleted);
public sealed record CoursePrerequisiteCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("slug")] string Slug, [property: JsonPropertyName("completed")] bool Completed);
public sealed record CourseCertificateEnvelope([property: JsonPropertyName("certificate")] CourseCertificateCompatDto Certificate, [property: JsonPropertyName("html")] string Html);
public sealed record CourseCertificateCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("serial")] string Serial, [property: JsonPropertyName("issued_at")] DateTime? IssuedAt);
public sealed record CourseReviewCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("user_id")] int UserId, [property: JsonPropertyName("rating")] int Rating, [property: JsonPropertyName("body")] string? Body, [property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("created_at")] DateTime? CreatedAt, [property: JsonPropertyName("user")] CourseUserCompatDto? User);
public sealed record CourseDiscussionCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("lesson_id")] int? LessonId, [property: JsonPropertyName("user_id")] int UserId, [property: JsonPropertyName("parent_id")] int? ParentId, [property: JsonPropertyName("body")] string Body, [property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("created_at")] DateTime? CreatedAt, [property: JsonPropertyName("user")] CourseUserCompatDto? User, [property: JsonPropertyName("replies")] IReadOnlyList<CourseDiscussionCompatDto> Replies);
public sealed record CourseCohortCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("name")] string Name, [property: JsonPropertyName("start_date")] DateTime? StartDate, [property: JsonPropertyName("end_date")] DateTime? EndDate, [property: JsonPropertyName("capacity")] int? Capacity);
public sealed record CourseGroupLinkCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("group_id")] int GroupId);
public sealed record CourseQuizCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("course_id")] int CourseId, [property: JsonPropertyName("lesson_id")] int? LessonId, [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("description")] string? Description, [property: JsonPropertyName("pass_mark_percent")] int PassMarkPercent, [property: JsonPropertyName("max_attempts")] int MaxAttempts, [property: JsonPropertyName("time_limit_minutes")] int? TimeLimitMinutes, [property: JsonPropertyName("questions")] IReadOnlyList<CourseQuizQuestionCompatDto> Questions);
public sealed record CourseQuizQuestionCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("quiz_id")] int QuizId, [property: JsonPropertyName("type")] string Type, [property: JsonPropertyName("prompt")] string Prompt, [property: JsonPropertyName("options")] IReadOnlyList<CourseQuizOptionCompatDto>? Options, [property: JsonPropertyName("points")] int Points, [property: JsonPropertyName("position")] int Position);
public sealed record CourseQuizOptionCompatDto([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("label")] string Label);
public sealed record CourseQuizAttemptCompatDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("quiz_id")] int QuizId, [property: JsonPropertyName("user_id")] int UserId, [property: JsonPropertyName("answers")] IReadOnlyDictionary<string, object?>? Answers, [property: JsonPropertyName("score_percent")] decimal ScorePercent, [property: JsonPropertyName("grading_status")] string GradingStatus, [property: JsonPropertyName("submitted_at")] DateTime? SubmittedAt, [property: JsonPropertyName("quiz")] CourseQuizCompatDto? Quiz, [property: JsonPropertyName("user")] CourseUserCompatDto? User);
public sealed record CourseQuizAttemptResult([property: JsonPropertyName("score_percent")] decimal ScorePercent, [property: JsonPropertyName("passed")] bool Passed, [property: JsonPropertyName("needs_review")] bool NeedsReview, [property: JsonPropertyName("attempt_id")] int AttemptId);
public sealed record CourseAnalyticsCompatDto([property: JsonPropertyName("course")] CourseAnalyticsCourseDto Course, [property: JsonPropertyName("enrollments")] CourseEnrollmentStatsDto Enrollments, [property: JsonPropertyName("completion_rate")] double CompletionRate, [property: JsonPropertyName("avg_progress")] double AvgProgress, [property: JsonPropertyName("avg_quiz_score")] double AvgQuizScore, [property: JsonPropertyName("quiz_attempts")] int QuizAttempts, [property: JsonPropertyName("per_lesson")] IReadOnlyList<CoursePerLessonAnalyticsDto> PerLesson);
public sealed record CourseAnalyticsCourseDto([property: JsonPropertyName("id")] int Id, [property: JsonPropertyName("title")] string Title);
public sealed record CourseEnrollmentStatsDto([property: JsonPropertyName("total")] int Total, [property: JsonPropertyName("active")] int Active, [property: JsonPropertyName("completed")] int Completed, [property: JsonPropertyName("dropped")] int Dropped);
public sealed record CoursePerLessonAnalyticsDto([property: JsonPropertyName("lesson_id")] int LessonId, [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("completed")] int Completed);

public sealed class CourseCompatCourseRequest
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("category_id")] public int? CategoryId { get; set; }
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("cover_image")] public string? CoverImage { get; set; }
    [JsonPropertyName("level")] public string? Level { get; set; }
    [JsonPropertyName("visibility")] public string? Visibility { get; set; }
    [JsonPropertyName("enrollment_type")] public string? EnrollmentType { get; set; }
    [JsonPropertyName("credit_cost")] public decimal? CreditCost { get; set; }
    [JsonPropertyName("learner_credit_reward")] public decimal? LearnerCreditReward { get; set; }
    [JsonPropertyName("instructor_credit_reward")] public decimal? InstructorCreditReward { get; set; }
    [JsonPropertyName("prerequisites")] public int[]? Prerequisites { get; set; }
}

public sealed class CourseCompatSectionRequest { [JsonPropertyName("title")] public string? Title { get; set; } [JsonPropertyName("position")] public int? Position { get; set; } }
public sealed class CourseCompatLessonRequest { [JsonPropertyName("section_id")] public int? SectionId { get; set; } [JsonPropertyName("title")] public string? Title { get; set; } [JsonPropertyName("content_type")] public string? ContentType { get; set; } [JsonPropertyName("body")] public string? Body { get; set; } [JsonPropertyName("video_url")] public string? VideoUrl { get; set; } [JsonPropertyName("attachment_url")] public string? AttachmentUrl { get; set; } [JsonPropertyName("embed_url")] public string? EmbedUrl { get; set; } [JsonPropertyName("position")] public int? Position { get; set; } [JsonPropertyName("min_watch_percent")] public int? MinWatchPercent { get; set; } [JsonPropertyName("drip_type")] public string? DripType { get; set; } [JsonPropertyName("drip_offset_days")] public int? DripOffsetDays { get; set; } [JsonPropertyName("drip_date")] public DateTime? DripDate { get; set; } [JsonPropertyName("is_preview")] public bool? IsPreview { get; set; } }
public sealed class CourseCompatLessonCompleteRequest { [JsonPropertyName("watch_percent")] public int WatchPercent { get; set; } = 100; }
public sealed class CourseCompatReviewRequest { [JsonPropertyName("rating")] public int Rating { get; set; } [JsonPropertyName("body")] public string? Body { get; set; } }
public sealed class CourseCompatDiscussionRequest { [JsonPropertyName("body")] public string? Body { get; set; } [JsonPropertyName("parent_id")] public int? ParentId { get; set; } }
public sealed class CourseCompatCohortRequest { [JsonPropertyName("name")] public string? Name { get; set; } [JsonPropertyName("start_date")] public DateTime? StartDate { get; set; } [JsonPropertyName("end_date")] public DateTime? EndDate { get; set; } [JsonPropertyName("capacity")] public int? Capacity { get; set; } }
public sealed class CourseCompatQuizRequest { [JsonPropertyName("lesson_id")] public int? LessonId { get; set; } [JsonPropertyName("title")] public string? Title { get; set; } [JsonPropertyName("description")] public string? Description { get; set; } [JsonPropertyName("pass_mark_percent")] public int? PassMarkPercent { get; set; } [JsonPropertyName("max_attempts")] public int? MaxAttempts { get; set; } [JsonPropertyName("time_limit_minutes")] public int? TimeLimitMinutes { get; set; } }
public sealed class CourseCompatQuestionRequest { [JsonPropertyName("type")] public string? Type { get; set; } [JsonPropertyName("prompt")] public string? Prompt { get; set; } [JsonPropertyName("options")] public IReadOnlyList<CourseQuizOptionCompatDto>? Options { get; set; } [JsonPropertyName("points")] public int Points { get; set; } = 1; [JsonPropertyName("position")] public int? Position { get; set; } [JsonPropertyName("correct")] public object? Correct { get; set; } }
public sealed class CourseCompatQuizAttemptRequest { [JsonPropertyName("answers")] public IReadOnlyDictionary<string, object?>? Answers { get; set; } }
public sealed class CourseCompatGradeAttemptRequest { [JsonPropertyName("score_percent")] public decimal ScorePercent { get; set; } [JsonPropertyName("passed")] public bool Passed { get; set; } [JsonPropertyName("feedback")] public string? Feedback { get; set; } }

public sealed class CoursesCompatibilityValidationException : Exception { public CoursesCompatibilityValidationException(string message) : base(message) { } }
public sealed class CoursesCompatibilityNotFoundException : Exception { public CoursesCompatibilityNotFoundException(string message) : base(message) { } }
public sealed class CoursesCompatibilityForbiddenException : Exception { public CoursesCompatibilityForbiddenException(string message) : base(message) { } }
public sealed class CoursesCompatibilityFeatureDisabledException : Exception { public CoursesCompatibilityFeatureDisabledException(string message) : base(message) { } }
