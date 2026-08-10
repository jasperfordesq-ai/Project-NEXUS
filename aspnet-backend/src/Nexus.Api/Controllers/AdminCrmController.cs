// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin CRM endpoints for user notes, flags, and advanced search.
/// All endpoints require admin role.
/// </summary>
[ApiController]
[Route("api/admin/crm")]
[Authorize(Policy = "AdminOnly")]
public class AdminCrmController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly AdminCrmService _crmService;
    private readonly ILogger<AdminCrmController> _logger;

    public AdminCrmController(
        NexusDbContext db,
        AdminCrmService crmService,
        ILogger<AdminCrmController> logger)
    {
        _db = db;
        _crmService = crmService;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    /// <summary>
    /// Advanced user search with multiple filter criteria.
    /// </summary>
    [HttpGet("users/search")]
    public async Task<IActionResult> SearchUsers(
        [FromQuery] string? role,
        [FromQuery] bool? is_active,
        [FromQuery] DateTime? joined_after,
        [FromQuery] DateTime? joined_before,
        [FromQuery] DateTime? last_login_after,
        [FromQuery] DateTime? last_login_before,
        [FromQuery] int? min_xp,
        [FromQuery] int? max_xp,
        [FromQuery] int? min_exchange_count,
        [FromQuery] int? max_exchange_count,
        [FromQuery] bool? has_warnings,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);
        var filters = new AdvancedUserSearchFilters
        {
            Role = role,
            IsActive = is_active,
            JoinedAfter = joined_after,
            JoinedBefore = joined_before,
            LastLoginAfter = last_login_after,
            LastLoginBefore = last_login_before,
            MinXp = min_xp,
            MaxXp = max_xp,
            MinExchangeCount = min_exchange_count,
            MaxExchangeCount = max_exchange_count,
            HasWarnings = has_warnings,
            Search = search,
            Page = page,
            Limit = limit
        };

        var result = await _crmService.SearchUsersAdvancedAsync(filters);
        return Ok(result);
    }

    /// <summary>
    /// Add an admin note to a user.
    /// </summary>
    [HttpPost("users/{userId}/notes")]
    public async Task<IActionResult> AddNote(int userId, [FromBody] AddNoteRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null)
        {
            return Unauthorized(new { error = "Unable to determine admin identity" });
        }

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new { error = "Content is required" });
        }

        var note = await _crmService.AddNoteAsync(userId, adminId.Value, request.Content, request.Category, request.IsFlagged);
        if (note == null)
        {
            return NotFound(new { error = "User not found" });
        }

        return Created($"api/admin/crm/notes/{note.Id}", note);
    }

    /// <summary>
    /// Get admin notes for a specific user.
    /// </summary>
    [HttpGet("users/{userId}/notes")]
    public async Task<IActionResult> GetNotes(int userId, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);
        var result = await _crmService.GetNotesAsync(userId, page, limit);
        return Ok(result);
    }

    /// <summary>
    /// Update an admin note. Only the admin who created it can update it.
    /// </summary>
    [HttpPut("notes/{id:int}")]
    public async Task<IActionResult> UpdateNote(int id, [FromBody] UpdateNoteRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null)
        {
            return Unauthorized(new { error = "Unable to determine admin identity" });
        }

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new { error = "Content is required" });
        }

        var note = await _crmService.UpdateNoteAsync(id, adminId.Value, request.Content, request.Category, request.IsPinned ?? request.IsFlagged);
        if (note == null)
        {
            return NotFound(new { error = "Note not found or you do not have permission to update it" });
        }

        if (IsLaravelReactV2Request())
        {
            return Ok(new { data = MapLaravelReactNote(note), meta = new { base_url = $"{Request.Scheme}://{Request.Host}" } });
        }

        return Ok(note);
    }

    /// <summary>
    /// Delete an admin note. Only the admin who created it can delete it.
    /// </summary>
    [HttpDelete("notes/{id:int}")]
    public async Task<IActionResult> DeleteNote(int id)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null)
        {
            return Unauthorized(new { error = "Unable to determine admin identity" });
        }

        var deleted = await _crmService.DeleteNoteAsync(id, adminId.Value);
        if (!deleted)
        {
            return NotFound(new { error = "Note not found or you do not have permission to delete it" });
        }

        if (IsLaravelReactV2Request())
        {
            return Ok(new { data = new { deleted = true }, meta = new { base_url = $"{Request.Scheme}://{Request.Host}" } });
        }

        return NoContent();
    }

    /// <summary>
    /// Get all flagged notes across all users.
    /// </summary>
    [HttpGet("flagged-notes")]
    public async Task<IActionResult> GetFlaggedNotes([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);
        var result = await _crmService.GetFlaggedNotesAsync(page, limit);
        return Ok(result);
    }


    /// <summary>GET /api/admin/crm/tasks - List CRM tasks.</summary>
    [HttpGet("tasks")]
    public async Task<IActionResult> ListCrmTasks(
        [FromQuery] int? user_id,
        [FromQuery] string? status,
        [FromQuery] string? priority,
        [FromQuery] int? assigned_to,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        if (IsLaravelReactV2Request())
        {
            page = Math.Max(1, page);
            limit = Math.Clamp(limit, 1, 100);

            var query = _db.CrmTasks
                .AsNoTracking()
                .Include(t => t.TargetUser)
                .Include(t => t.AssignedToAdmin)
                .Where(t => t.TenantId == tenantId.Value);

            if (!string.IsNullOrWhiteSpace(status) && IsLaravelCrmTaskStatus(status))
            {
                var statusValue = NormalizeLaravelCrmTaskStatus(status);
                query = statusValue == "completed"
                    ? query.Where(t => t.Status == "completed" || t.Status == "done")
                    : query.Where(t => t.Status == statusValue);
            }

            if (!string.IsNullOrWhiteSpace(priority) && IsLaravelCrmTaskPriority(priority))
            {
                query = query.Where(t => t.Priority == priority);
            }

            if (assigned_to.HasValue)
            {
                query = query.Where(t => t.AssignedToAdminId == assigned_to.Value);
            }

            if (!string.IsNullOrWhiteSpace(search) && search.Trim().Length >= 2)
            {
                var term = search.Trim().ToLowerInvariant();
                query = query.Where(t =>
                    t.Title.ToLower().Contains(term) ||
                    (t.Description != null && t.Description.ToLower().Contains(term)));
            }

            var v2Total = await query.CountAsync();
            var v2Tasks = await query
                .OrderBy(t => t.Status == "pending" ? 0 :
                    t.Status == "in_progress" ? 1 :
                    t.Status == "completed" || t.Status == "done" ? 2 : 3)
                .ThenBy(t => t.Priority == "urgent" ? 0 : t.Priority == "high" ? 1 : t.Priority == "medium" ? 2 : 3)
                .ThenBy(t => t.DueDate)
                .ThenByDescending(t => t.CreatedAt)
                .Skip((page - 1) * limit)
                .Take(limit)
                .ToListAsync();

            return Ok(new
            {
                data = v2Tasks.Select(MapLaravelReactTask),
                meta = LaravelPaginationMeta(page, limit, v2Total)
            });
        }

        var (tasks, total) = await _crmService.ListCrmTasksAsync(tenantId.Value, user_id, status);

        return Ok(new
        {
            data = tasks.Select(t => new
            {
                t.Id,
                t.TargetUserId,
                t.AssignedToAdminId,
                t.Title,
                t.Description,
                t.Priority,
                t.Status,
                t.DueDate,
                t.CompletedAt,
                t.CreatedAt
            }),
            total
        });
    }

    /// <summary>POST /api/admin/crm/tasks - Create CRM task.</summary>
    [HttpPost("tasks")]
    public async Task<IActionResult> CreateCrmTask([FromBody] CreateCrmTaskRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Unable to determine admin identity" });

        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "Title is required" });

        if (IsLaravelReactV2Request())
        {
            var targetUserId = request.UserId ?? request.TargetUserId;
            var assignedTo = request.AssignedTo ?? adminId.Value;

            if (targetUserId <= 0)
            {
                return BadRequest(new { error = "user_id is required" });
            }

            var targetUserExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId.Value && u.Id == targetUserId);
            if (!targetUserExists)
            {
                return NotFound(new { error = "User not found" });
            }

            var assigneeExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId.Value && u.Id == assignedTo);
            if (!assigneeExists)
            {
                assignedTo = adminId.Value;
            }

            var priority = IsLaravelCrmTaskPriority(request.Priority) ? request.Priority!.Trim().ToLowerInvariant() : "medium";
            var v2Task = new CrmTask
            {
                TenantId = tenantId.Value,
                TargetUserId = targetUserId,
                AssignedToAdminId = assignedTo,
                Title = request.Title.Trim(),
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                Priority = priority,
                Status = "pending",
                DueDate = NormalizeUtc(request.DueDate),
                CreatedAt = DateTime.UtcNow
            };

            _db.CrmTasks.Add(v2Task);
            await _db.SaveChangesAsync();

            var saved = await LoadLaravelReactTaskAsync(tenantId.Value, v2Task.Id);
            return Ok(new { data = MapLaravelReactTask(saved!), meta = LaravelMeta() });
        }

        var (task, error) = await _crmService.CreateCrmTaskAsync(
            tenantId.Value, request.TargetUserId, adminId.Value,
            request.Title, request.Description, request.Priority, request.DueDate);

        if (error != null) return BadRequest(new { error });

        return Created($"api/admin/crm/tasks/{task!.Id}", new
        {
            task.Id,
            task.TargetUserId,
            task.Title,
            task.Priority,
            task.Status,
            task.DueDate,
            task.CreatedAt
        });
    }

    /// <summary>PUT /api/admin/crm/tasks/{id} - Update CRM task.</summary>
    [HttpPut("tasks/{id:int}")]
    public async Task<IActionResult> UpdateCrmTask(int id, [FromBody] CreateCrmTaskRequest request)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        var task = await _db.CrmTasks.FirstOrDefaultAsync(t => t.TenantId == tenantId.Value && t.Id == id);
        if (task == null)
        {
            return NotFound(new { error = "Task not found" });
        }

        if (!string.IsNullOrWhiteSpace(request.Title))
        {
            task.Title = request.Title.Trim();
        }

        if (request.Description != null)
        {
            task.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        }

        if (IsLaravelCrmTaskPriority(request.Priority))
        {
            task.Priority = request.Priority!.Trim().ToLowerInvariant();
        }

        if (IsLaravelCrmTaskStatus(request.Status))
        {
            var newStatus = request.Status!.Trim().ToLowerInvariant();
            task.Status = newStatus;
            task.CompletedAt = newStatus == "completed" ? DateTime.UtcNow : null;
        }

        if (request.AssignedTo.HasValue)
        {
            var assigneeExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId.Value && u.Id == request.AssignedTo.Value);
            if (assigneeExists)
            {
                task.AssignedToAdminId = request.AssignedTo.Value;
            }
        }

        if (request.UserId.HasValue)
        {
            if (request.UserId.Value > 0)
            {
                var userExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId.Value && u.Id == request.UserId.Value);
                if (!userExists)
                {
                    return NotFound(new { error = "User not found" });
                }

                task.TargetUserId = request.UserId.Value;
            }
        }

        if (request.DueDate.HasValue)
        {
            task.DueDate = NormalizeUtc(request.DueDate);
        }

        await _db.SaveChangesAsync();

        if (IsLaravelReactV2Request())
        {
            var updated = await LoadLaravelReactTaskAsync(tenantId.Value, task.Id);
            return Ok(new { data = MapLaravelReactTask(updated!), meta = LaravelMeta() });
        }

        return Ok(new
        {
            task.Id,
            task.TargetUserId,
            task.AssignedToAdminId,
            task.Title,
            task.Description,
            task.Priority,
            task.Status,
            task.DueDate,
            task.CompletedAt,
            task.CreatedAt
        });
    }

    /// <summary>PUT /api/admin/crm/tasks/{id}/complete - Mark task done.</summary>
    [HttpPut("tasks/{id:int}/complete")]
    public async Task<IActionResult> CompleteCrmTask(int id)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        var (success, error) = await _crmService.CompleteCrmTaskAsync(tenantId.Value, id);
        if (!success) return NotFound(new { error = error ?? "Task not found" });

        return Ok(new { message = "Task marked as done" });
    }

    /// <summary>DELETE /api/admin/crm/tasks/{id} - Delete CRM task.</summary>
    [HttpDelete("tasks/{id:int}")]
    public async Task<IActionResult> DeleteCrmTask(int id)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        var (success, error) = await _crmService.DeleteCrmTaskAsync(tenantId.Value, id);
        if (!success) return NotFound(new { error = error ?? "Task not found" });

        if (IsLaravelReactV2Request())
        {
            return Ok(new { data = new { deleted = true }, meta = LaravelMeta() });
        }

        return NoContent();
    }

    /// <summary>POST /api/admin/crm/users/{userId}/tags - Add tag to user.</summary>
    [HttpPost("users/{userId}/tags")]
    public async Task<IActionResult> AddTag(int userId, [FromBody] TagRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Unable to determine admin identity" });

        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        if (string.IsNullOrWhiteSpace(request.Tag))
            return BadRequest(new { error = "Tag is required" });

        var (success, error) = await _crmService.AddTagToUserAsync(tenantId.Value, userId, adminId.Value, request.Tag);
        if (!success) return BadRequest(new { error });

        return Ok(new { message = "Tag added", user_id = userId, tag = request.Tag.Trim().ToLower() });
    }

    /// <summary>DELETE /api/admin/crm/users/{userId}/tags/{tag} - Remove tag.</summary>
    [HttpDelete("users/{userId}/tags/{tag}")]
    public async Task<IActionResult> RemoveTag(int userId, string tag)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        var (success, error) = await _crmService.RemoveTagFromUserAsync(tenantId.Value, userId, tag);
        if (!success) return NotFound(new { error = error ?? "Tag not found" });

        return NoContent();
    }

    /// <summary>GET /api/admin/crm/users/{userId}/tags - List user tags.</summary>
    [HttpGet("users/{userId}/tags")]
    public async Task<IActionResult> GetUserTags(int userId)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        var tags = await _crmService.GetUserTagsAsync(tenantId.Value, userId);
        return Ok(new { data = tags, total = tags.Count, user_id = userId });
    }

    /// <summary>GET /api/admin/crm/users/export - Export users as CSV.</summary>
    [HttpGet("users/export")]
    public async Task<IActionResult> ExportUsers(
        [FromQuery] string? role,
        [FromQuery] bool? is_active,
        [FromQuery] string? search)
    {
        var tenantId = GetCurrentTenantId();
        if (tenantId == null) return Unauthorized(new { error = "Invalid tenant" });

        var filters = new AdvancedUserSearchFilters
        {
            Role = role,
            IsActive = is_active,
            Search = search,
            Page = 1,
            Limit = 5000
        };

        var csv = await _crmService.ExportUsersAsCsvAsync(tenantId.Value, filters);

        return File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv", "users_export.csv");
    }

    private int? GetCurrentTenantId()
    {
        var tenantIdClaim = User.FindFirst("tenant_id")?.Value;
        return int.TryParse(tenantIdClaim, out var id) ? id : null;
    }

    private bool IsLaravelReactV2Request()
        => Request.Path.StartsWithSegments("/api/v2", StringComparison.OrdinalIgnoreCase);

    private object LaravelMeta() => new
    {
        base_url = $"{Request.Scheme}://{Request.Host}"
    };

    private object LaravelPaginationMeta(int page, int perPage, int total)
    {
        var totalPages = total > 0 ? (int)Math.Ceiling((double)total / perPage) : 0;
        return new
        {
            base_url = $"{Request.Scheme}://{Request.Host}",
            current_page = page,
            per_page = perPage,
            total,
            total_pages = totalPages,
            has_more = page < totalPages
        };
    }

    private async Task<CrmTask?> LoadLaravelReactTaskAsync(int tenantId, int taskId)
        => await _db.CrmTasks
            .AsNoTracking()
            .Include(t => t.TargetUser)
            .Include(t => t.AssignedToAdmin)
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == taskId);

    private static object MapLaravelReactTask(CrmTask task)
    {
        var assignedName = DisplayName(task.AssignedToAdmin);
        return new
        {
            id = task.Id,
            tenant_id = task.TenantId,
            assigned_to = task.AssignedToAdminId,
            assigned_to_name = assignedName,
            created_by = task.AssignedToAdminId,
            created_by_name = assignedName,
            user_id = task.TargetUserId,
            user_name = DisplayName(task.TargetUser),
            user_avatar = task.TargetUser?.AvatarUrl,
            title = task.Title,
            description = task.Description,
            priority = IsLaravelCrmTaskPriority(task.Priority) ? task.Priority : "medium",
            status = NormalizeLaravelCrmTaskStatus(task.Status),
            due_date = task.DueDate,
            completed_at = task.CompletedAt,
            created_at = task.CreatedAt,
            updated_at = (DateTime?)null
        };
    }

    private static string DisplayName(User? user)
        => user == null
            ? string.Empty
            : string.Join(" ", new[] { user.FirstName, user.LastName }.Where(part => !string.IsNullOrWhiteSpace(part))).Trim();

    private static bool IsLaravelCrmTaskPriority(string? value)
        => value?.Trim().ToLowerInvariant() is "low" or "medium" or "high" or "urgent";

    private static bool IsLaravelCrmTaskStatus(string? value)
        => value?.Trim().ToLowerInvariant() is "pending" or "in_progress" or "completed" or "cancelled" or "done";

    private static string NormalizeLaravelCrmTaskStatus(string? value)
        => value?.Trim().ToLowerInvariant() switch
        {
            "done" => "completed",
            "completed" => "completed",
            "in_progress" => "in_progress",
            "cancelled" => "cancelled",
            _ => "pending"
        };

    private static DateTime? NormalizeUtc(DateTime? value)
        => value?.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.Value.ToUniversalTime(),
            DateTimeKind.Unspecified => DateTime.SpecifyKind(value.Value, DateTimeKind.Utc),
            _ => value
        };

    private static object MapLaravelReactNote(AdminNoteDto note) => new
    {
        id = note.Id,
        user_id = note.UserId,
        author_id = note.AdminId,
        admin_id = note.AdminId,
        content = note.Content,
        category = string.IsNullOrWhiteSpace(note.Category) ? "general" : note.Category,
        is_pinned = note.IsFlagged,
        is_flagged = note.IsFlagged,
        user_name = note.UserName,
        user_avatar = (string?)null,
        author_name = note.AdminName,
        admin_name = note.AdminName,
        created_at = note.CreatedAt,
        updated_at = note.UpdatedAt
    };
}

#region Request DTOs

public class AddNoteRequest
{
    [JsonPropertyName("content"), MaxLength(5000)]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("category"), MaxLength(100)]
    public string? Category { get; set; }

    [JsonPropertyName("is_flagged")]
    public bool IsFlagged { get; set; } = false;
}

public class UpdateNoteRequest
{
    [JsonPropertyName("content"), MaxLength(5000)]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("category"), MaxLength(100)]
    public string? Category { get; set; }

    [JsonPropertyName("is_flagged")]
    public bool? IsFlagged { get; set; }

    [JsonPropertyName("is_pinned")]
    public bool? IsPinned { get; set; }
}

public class CreateCrmTaskRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("target_user_id")]
    public int TargetUserId { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("user_id")]
    public int? UserId { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("assigned_to")]
    public int? AssignedTo { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("title"), MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("description"), MaxLength(2000)]
    public string? Description { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("priority"), MaxLength(50)]
    public string? Priority { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("status"), MaxLength(50)]
    public string? Status { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("due_date")]
    public DateTime? DueDate { get; set; }
}

public class TagRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("tag"), MaxLength(100)]
    public string Tag { get; set; } = string.Empty;
}

#endregion
