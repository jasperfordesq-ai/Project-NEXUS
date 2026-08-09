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

public sealed class AdminCoursesService
{
    public const string CourseKeyPrefix = "admin_courses.course.";
    public const string InstructorKeyPrefix = "admin_courses.instructor.";
    public const string CategoryKeyPrefix = "admin_courses.category.";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly Regex SlugUnsafeCharacters = new("[^a-z0-9]+", RegexOptions.Compiled);

    private readonly NexusDbContext _db;

    public AdminCoursesService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<AdminCourseDto>> ListCoursesAsync(
        int tenantId,
        string? moderationStatus,
        CancellationToken ct)
    {
        var courses = await LoadStoredAsync<AdminCourseRecord>(tenantId, CourseKeyPrefix, ct);
        var adminCourseIds = courses.Select(course => course.Value.Id).ToHashSet();
        var compatibilityState = await LoadCompatibilityStateAsync(tenantId, ct);
        var merged = courses
            .Select(course => ToCourseDto(course.Value))
            .Concat(compatibilityState.Courses
                .Where(course => !adminCourseIds.Contains(course.Id))
                .Select(ToCourseDto));

        var filtered = string.IsNullOrWhiteSpace(moderationStatus)
            ? merged
            : merged.Where(course =>
                string.Equals(course.ModerationStatus, moderationStatus, StringComparison.OrdinalIgnoreCase));

        return filtered
            .OrderByDescending(course => course.CreatedAt ?? DateTime.MinValue)
            .ThenByDescending(course => course.Id)
            .Take(200)
            .ToArray();
    }

    public async Task<AdminCourseDto> UpsertCourseAsync(
        int tenantId,
        AdminCourseRecord record,
        CancellationToken ct)
    {
        if (record.Id <= 0)
        {
            throw new AdminCoursesValidationException("course id is required");
        }

        var now = DateTime.UtcNow;
        var existing = await FindRowAsync(tenantId, CourseKeyPrefix, record.Id, ct);
        var stored = record with
        {
            Title = string.IsNullOrWhiteSpace(record.Title) ? $"Course #{record.Id}" : record.Title.Trim(),
            Status = string.IsNullOrWhiteSpace(record.Status) ? "draft" : record.Status.Trim(),
            ModerationStatus = string.IsNullOrWhiteSpace(record.ModerationStatus)
                ? "pending"
                : record.ModerationStatus.Trim(),
            CreatedAt = record.CreatedAt ?? now,
            UpdatedAt = now
        };

        await UpsertRowAsync(tenantId, CourseKeyPrefix, stored.Id, stored, existing, now, ct);
        return ToCourseDto(stored);
    }

    public async Task<AdminCourseDto> ModerateAsync(
        int tenantId,
        int id,
        int adminId,
        string? action,
        string? notes,
        CancellationToken ct)
    {
        var row = await FindRowAsync(tenantId, CourseKeyPrefix, id, ct);
        if (row is null)
        {
            return await ModerateCompatibilityCourseAsync(tenantId, id, adminId, action, notes, ct);
        }

        var course = Decode<AdminCourseRecord>(row.Value)
            ?? throw new AdminCoursesNotFoundException("Course not found");

        var normalizedAction = NormalizeModerationAction(action);
        var moderationStatus = ModerationStatusForAction(normalizedAction);

        var now = DateTime.UtcNow;
        var updated = course with
        {
            ModerationStatus = moderationStatus,
            ModerationNotes = notes,
            ModeratedBy = adminId,
            ModeratedAt = now,
            Status = normalizedAction == "reject" ? "draft" : course.Status,
            PublishedAt = normalizedAction == "approve"
                && string.Equals(course.Status, "published", StringComparison.OrdinalIgnoreCase)
                && course.PublishedAt is null
                    ? now
                    : course.PublishedAt,
            UpdatedAt = now
        };

        row.Value = JsonSerializer.Serialize(updated, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
        return ToCourseDto(updated);
    }

    public async Task<AdminCoursesAnalyticsDto> AnalyticsAsync(int tenantId, CancellationToken ct)
    {
        var courses = await LoadStoredAsync<AdminCourseRecord>(tenantId, CourseKeyPrefix, ct);
        var instructors = await LoadStoredAsync<AdminCourseInstructorDto>(tenantId, InstructorKeyPrefix, ct);
        var adminCourseValues = courses.Select(course => course.Value).ToArray();
        var adminCourseIds = adminCourseValues.Select(course => course.Id).ToHashSet();
        var compatibilityState = await LoadCompatibilityStateAsync(tenantId, ct);
        var courseValues = adminCourseValues
            .Select(ToCourseDto)
            .Concat(compatibilityState.Courses
                .Where(course => !adminCourseIds.Contains(course.Id))
                .Select(ToCourseDto))
            .ToArray();

        return new AdminCoursesAnalyticsDto(
            courseValues.Length,
            courseValues.Count(course => string.Equals(course.Status, "published", StringComparison.OrdinalIgnoreCase)),
            courseValues.Count(course =>
                string.Equals(course.ModerationStatus, "pending", StringComparison.OrdinalIgnoreCase)),
            adminCourseValues.Sum(course => Math.Max(0, course.TotalEnrollments)),
            adminCourseValues.Sum(course => Math.Max(0, course.CompletedEnrollments)),
            instructors.Count);
    }

    public async Task<IReadOnlyList<AdminCourseInstructorDto>> ListInstructorsAsync(int tenantId, CancellationToken ct)
    {
        var instructors = await LoadStoredAsync<AdminCourseInstructorDto>(tenantId, InstructorKeyPrefix, ct);
        return instructors
            .Select(row => row.Value)
            .OrderByDescending(instructor => instructor.GrantedAt ?? DateTime.MinValue)
            .ThenByDescending(instructor => instructor.Id)
            .ToArray();
    }

    public async Task<AdminCourseInstructorDto> GrantInstructorAsync(
        int tenantId,
        int userId,
        int adminId,
        CancellationToken ct)
    {
        if (userId <= 0)
        {
            throw new AdminCoursesValidationException("user_id is required");
        }

        var now = DateTime.UtcNow;
        var existing = await FindRowAsync(tenantId, InstructorKeyPrefix, userId, ct);
        var stored = Decode<AdminCourseInstructorDto>(existing?.Value) ?? new AdminCourseInstructorDto(
            userId,
            userId,
            adminId,
            now,
            new AdminCourseUserDto(userId, $"#{userId}"));

        await UpsertRowAsync(tenantId, InstructorKeyPrefix, userId, stored with
        {
            GrantedBy = stored.GrantedBy == 0 ? adminId : stored.GrantedBy,
            GrantedAt = stored.GrantedAt ?? now
        }, existing, now, ct);

        return stored with
        {
            GrantedBy = stored.GrantedBy == 0 ? adminId : stored.GrantedBy,
            GrantedAt = stored.GrantedAt ?? now
        };
    }

    public async Task<bool> RevokeInstructorAsync(int tenantId, int userId, CancellationToken ct)
    {
        var row = await FindRowAsync(tenantId, InstructorKeyPrefix, userId, ct);
        if (row is null)
        {
            return false;
        }

        _db.TenantConfigs.Remove(row);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<AdminCourseCategoryDto> StoreCategoryAsync(
        int tenantId,
        AdminCourseCategoryRequest request,
        CancellationToken ct)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (name.Length == 0)
        {
            throw new AdminCoursesValidationException("name is required");
        }

        var categories = await LoadStoredAsync<AdminCourseCategoryDto>(tenantId, CategoryKeyPrefix, ct);
        var id = categories.Count == 0 ? 1 : categories.Max(row => row.Value.Id) + 1;
        var slug = string.IsNullOrWhiteSpace(request.Slug) ? Slugify(name) : Slugify(request.Slug);
        var now = DateTime.UtcNow;
        var category = new AdminCourseCategoryDto(
            id,
            name,
            slug,
            request.Description,
            request.Icon,
            request.Position ?? 0);

        await UpsertRowAsync(tenantId, CategoryKeyPrefix, id, category, null, now, ct);
        return category;
    }

    public async Task<AdminCourseCategoryDto> UpdateCategoryAsync(
        int tenantId,
        int id,
        AdminCourseCategoryRequest request,
        CancellationToken ct)
    {
        var row = await FindRowAsync(tenantId, CategoryKeyPrefix, id, ct)
            ?? throw new AdminCoursesNotFoundException("Category not found");
        var stored = Decode<AdminCourseCategoryDto>(row.Value)
            ?? throw new AdminCoursesNotFoundException("Category not found");

        var updated = stored with
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? stored.Name : request.Name.Trim(),
            Description = request.Description ?? stored.Description,
            Icon = request.Icon ?? stored.Icon,
            Position = request.Position ?? stored.Position
        };

        row.Value = JsonSerializer.Serialize(updated, JsonOptions);
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return updated;
    }

    public async Task<bool> DeleteCategoryAsync(int tenantId, int id, CancellationToken ct)
    {
        var row = await FindRowAsync(tenantId, CategoryKeyPrefix, id, ct);
        if (row is null)
        {
            return false;
        }

        _db.TenantConfigs.Remove(row);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    private static AdminCourseDto ToCourseDto(AdminCourseRecord course)
    {
        return new AdminCourseDto(
            course.Id,
            course.Title,
            course.Status,
            course.ModerationStatus,
            course.Author,
            course.Category,
            course.ModerationNotes,
            course.ModeratedBy,
            course.ModeratedAt,
            course.PublishedAt,
            course.CreatedAt,
            course.UpdatedAt);
    }

    private static AdminCourseDto ToCourseDto(CourseCompatDto course)
    {
        return new AdminCourseDto(
            course.Id,
            course.Title,
            course.Status,
            course.ModerationStatus,
            course.Author is null ? null : new AdminCourseUserDto(course.Author.Id, course.Author.Name),
            course.Category is null ? null : new AdminCourseCategoryDto(
                course.Category.Id,
                course.Category.Name,
                course.Category.Slug,
                course.Category.Description,
                course.Category.Icon,
                course.Category.Position),
            null,
            null,
            null,
            course.PublishedAt,
            course.CreatedAt,
            course.UpdatedAt);
    }

    private async Task<AdminCourseDto> ModerateCompatibilityCourseAsync(
        int tenantId,
        int id,
        int adminId,
        string? action,
        string? notes,
        CancellationToken ct)
    {
        var state = await LoadCompatibilityStateAsync(tenantId, ct);
        var course = state.Courses.FirstOrDefault(row => row.Id == id)
            ?? throw new AdminCoursesNotFoundException("Course not found");

        var normalizedAction = NormalizeModerationAction(action);
        var moderationStatus = ModerationStatusForAction(normalizedAction);
        var now = DateTime.UtcNow;
        var updated = course with
        {
            ModerationStatus = moderationStatus,
            Status = normalizedAction == "reject" ? "draft" : course.Status,
            PublishedAt = normalizedAction == "approve"
                && string.Equals(course.Status, "published", StringComparison.OrdinalIgnoreCase)
                && course.PublishedAt is null
                    ? now
                    : course.PublishedAt,
            UpdatedAt = now
        };

        Replace(state.Courses, course, updated);
        await SaveCompatibilityStateAsync(tenantId, state, ct);
        return ToCourseDto(updated);
    }

    private async Task<TenantConfig?> FindRowAsync(
        int tenantId,
        string prefix,
        int id,
        CancellationToken ct)
    {
        var key = prefix + id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == key, ct);
    }

    private async Task UpsertRowAsync<T>(
        int tenantId,
        string prefix,
        int id,
        T payload,
        TenantConfig? existing,
        DateTime now,
        CancellationToken ct)
    {
        var row = existing;
        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = prefix + id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = JsonSerializer.Serialize(payload, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private async Task<IReadOnlyList<(TenantConfig Row, T Value)>> LoadStoredAsync<T>(
        int tenantId,
        string prefix,
        CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key.StartsWith(prefix))
            .ToListAsync(ct);

        return rows
            .Select(row => (Row: row, Value: Decode<T>(row.Value)))
            .Where(row => row.Value is not null)
            .Select(row => (row.Row, row.Value!))
            .ToArray();
    }

    private async Task<CourseCompatibilityState> LoadCompatibilityStateAsync(int tenantId, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == CoursesCompatibilityService.StateKey, ct);

        return Decode<CourseCompatibilityState>(row?.Value) ?? new CourseCompatibilityState();
    }

    private async Task SaveCompatibilityStateAsync(int tenantId, CourseCompatibilityState state, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == CoursesCompatibilityService.StateKey, ct);
        var now = DateTime.UtcNow;
        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = CoursesCompatibilityService.StateKey,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = JsonSerializer.Serialize(state, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private static string NormalizeModerationAction(string? action)
    {
        var normalized = (action ?? string.Empty).Trim().ToLowerInvariant();
        return normalized is "approve" or "reject" or "flag"
            ? normalized
            : throw new AdminCoursesValidationException("Invalid moderation action");
    }

    private static string ModerationStatusForAction(string action) => action switch
    {
        "approve" => "approved",
        "reject" => "rejected",
        "flag" => "flagged",
        _ => throw new AdminCoursesValidationException("Invalid moderation action")
    };

    private static void Replace<T>(List<T> list, T oldValue, T newValue)
    {
        var index = list.IndexOf(oldValue);
        if (index >= 0)
        {
            list[index] = newValue;
        }
    }

    private static T? Decode<T>(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return default;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(value, JsonOptions);
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private static string Slugify(string value)
    {
        var lower = value.Trim().ToLowerInvariant();
        var slug = SlugUnsafeCharacters.Replace(lower, "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "category" : slug;
    }
}

public sealed record AdminCourseRecord
{
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("title")] public string Title { get; init; } = string.Empty;
    [JsonPropertyName("status")] public string Status { get; init; } = "draft";
    [JsonPropertyName("moderation_status")] public string ModerationStatus { get; init; } = "pending";
    [JsonPropertyName("author")] public AdminCourseUserDto? Author { get; init; }
    [JsonPropertyName("category")] public AdminCourseCategoryDto? Category { get; init; }
    [JsonPropertyName("moderation_notes")] public string? ModerationNotes { get; init; }
    [JsonPropertyName("moderated_by")] public int? ModeratedBy { get; init; }
    [JsonPropertyName("moderated_at")] public DateTime? ModeratedAt { get; init; }
    [JsonPropertyName("published_at")] public DateTime? PublishedAt { get; init; }
    [JsonPropertyName("created_at")] public DateTime? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTime? UpdatedAt { get; init; }
    [JsonPropertyName("total_enrollments")] public int TotalEnrollments { get; init; }
    [JsonPropertyName("completed_enrollments")] public int CompletedEnrollments { get; init; }
}

public sealed record AdminCourseDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("moderation_status")] string ModerationStatus,
    [property: JsonPropertyName("author")] AdminCourseUserDto? Author,
    [property: JsonPropertyName("category")] AdminCourseCategoryDto? Category,
    [property: JsonPropertyName("moderation_notes")] string? ModerationNotes,
    [property: JsonPropertyName("moderated_by")] int? ModeratedBy,
    [property: JsonPropertyName("moderated_at")] DateTime? ModeratedAt,
    [property: JsonPropertyName("published_at")] DateTime? PublishedAt,
    [property: JsonPropertyName("created_at")] DateTime? CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record AdminCourseUserDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name);

public sealed record AdminCourseCategoryDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug = "",
    [property: JsonPropertyName("description")] string? Description = null,
    [property: JsonPropertyName("icon")] string? Icon = null,
    [property: JsonPropertyName("position")] int Position = 0);

public sealed record AdminCourseInstructorDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("granted_by")] int GrantedBy,
    [property: JsonPropertyName("granted_at")] DateTime? GrantedAt,
    [property: JsonPropertyName("user")] AdminCourseUserDto? User);

public sealed record AdminCoursesAnalyticsDto(
    [property: JsonPropertyName("total_courses")] int TotalCourses,
    [property: JsonPropertyName("published_courses")] int PublishedCourses,
    [property: JsonPropertyName("pending_moderation")] int PendingModeration,
    [property: JsonPropertyName("total_enrollments")] int TotalEnrollments,
    [property: JsonPropertyName("completed_enrollments")] int CompletedEnrollments,
    [property: JsonPropertyName("instructors")] int Instructors);

public sealed class AdminCourseModerationRequest
{
    [JsonPropertyName("action")] public string? Action { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

public sealed class AdminCourseInstructorRequest
{
    [JsonPropertyName("user_id")] public int UserId { get; set; }
}

public sealed class AdminCourseCategoryRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("icon")] public string? Icon { get; set; }
    [JsonPropertyName("position")] public int? Position { get; set; }
}

public sealed class AdminCoursesValidationException : Exception
{
    public AdminCoursesValidationException(string message) : base(message) { }
}

public sealed class AdminCoursesNotFoundException : Exception
{
    public AdminCoursesNotFoundException(string message) : base(message) { }
}
