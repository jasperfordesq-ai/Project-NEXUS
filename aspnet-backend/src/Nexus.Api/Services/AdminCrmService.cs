// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// CRM service for admin user management: notes, flags, and advanced search.
/// All queries are tenant-scoped via EF Core global query filters.
/// </summary>
public class AdminCrmService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AdminCrmService> _logger;

    public AdminCrmService(NexusDbContext db, TenantContext tenantContext, ILogger<AdminCrmService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Add an admin note to a user.
    /// </summary>
    public async Task<AdminNoteDto?> AddNoteAsync(int userId, int adminId, string content, string? category = null, bool isFlagged = false)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
        {
            _logger.LogWarning("Cannot add note: user {UserId} not found", userId);
            return null;
        }

        var note = new AdminNote
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            AdminId = adminId,
            Content = content,
            Category = category,
            IsFlagged = isFlagged
        };

        _db.Set<AdminNote>().Add(note);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} added note {NoteId} for user {UserId}", adminId, note.Id, userId);

        return MapToDto(note, null, null);
    }

    /// <summary>
    /// Get paginated notes for a specific user.
    /// </summary>
    public async Task<PaginatedNotesDto> GetNotesAsync(int userId, int page = 1, int limit = 20)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<AdminNote>()
            .AsNoTracking()
            .Where(n => n.UserId == userId)
            .OrderByDescending(n => n.CreatedAt);

        var total = await query.CountAsync();

        var notes = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        // Load admin names
        var adminIds = notes.Select(n => n.AdminId).Distinct().ToList();
        var admins = await _db.Users.AsNoTracking()
            .Where(u => adminIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        // Load user name
        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId);

        return new PaginatedNotesDto
        {
            Notes = notes.Select(n => MapToDto(n, user, admins.GetValueOrDefault(n.AdminId))).ToList(),
            Total = total,
            Page = page,
            Limit = limit
        };
    }

    /// <summary>
    /// Update an existing admin note. Only the admin who created it can update it.
    /// </summary>
    public async Task<AdminNoteDto?> UpdateNoteAsync(int noteId, int adminId, string content, string? category = null, bool? isFlagged = null)
    {
        var note = await _db.Set<AdminNote>().FirstOrDefaultAsync(n => n.Id == noteId);
        if (note == null)
        {
            _logger.LogWarning("Cannot update note: note {NoteId} not found", noteId);
            return null;
        }

        if (note.AdminId != adminId)
        {
            _logger.LogWarning("Admin {AdminId} cannot update note {NoteId} owned by admin {OwnerId}", adminId, noteId, note.AdminId);
            return null;
        }

        note.Content = content;
        if (category != null) note.Category = category;
        if (isFlagged.HasValue) note.IsFlagged = isFlagged.Value;
        note.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated note {NoteId}", adminId, noteId);

        return MapToDto(note, null, null);
    }

    /// <summary>
    /// Delete an admin note. Only the admin who created it can delete it.
    /// </summary>
    public async Task<bool> DeleteNoteAsync(int noteId, int adminId)
    {
        var note = await _db.Set<AdminNote>().FirstOrDefaultAsync(n => n.Id == noteId);
        if (note == null)
        {
            return false;
        }

        if (note.AdminId != adminId)
        {
            _logger.LogWarning("Admin {AdminId} cannot delete note {NoteId} owned by admin {OwnerId}", adminId, noteId, note.AdminId);
            return false;
        }

        _db.Set<AdminNote>().Remove(note);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted note {NoteId}", adminId, noteId);
        return true;
    }

    /// <summary>
    /// Get all flagged notes across all users (paginated).
    /// </summary>
    public async Task<PaginatedNotesDto> GetFlaggedNotesAsync(int page = 1, int limit = 20)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<AdminNote>()
            .AsNoTracking()
            .Where(n => n.IsFlagged)
            .OrderByDescending(n => n.CreatedAt);

        var total = await query.CountAsync();

        var notes = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        // Load admin and user names
        var adminIds = notes.Select(n => n.AdminId).Distinct().ToList();
        var userIds = notes.Select(n => n.UserId).Distinct().ToList();
        var allIds = adminIds.Union(userIds).Distinct().ToList();

        var users = await _db.Users.AsNoTracking()
            .Where(u => allIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return new PaginatedNotesDto
        {
            Notes = notes.Select(n => MapToDto(n, users.GetValueOrDefault(n.UserId), users.GetValueOrDefault(n.AdminId))).ToList(),
            Total = total,
            Page = page,
            Limit = limit
        };
    }

    /// <summary>
    /// Advanced user search with multiple filter criteria.
    /// </summary>
    public async Task<AdvancedSearchResultDto> SearchUsersAdvancedAsync(AdvancedUserSearchFilters filters)
    {
        var page = Math.Max(1, filters.Page);
        var limit = Math.Clamp(filters.Limit, 1, 100);

        var query = _db.Users.AsNoTracking().AsQueryable();

        // Filter by role
        if (!string.IsNullOrWhiteSpace(filters.Role))
        {
            query = query.Where(u => u.Role == filters.Role);
        }

        // Filter by active status
        if (filters.IsActive.HasValue)
        {
            query = query.Where(u => u.IsActive == filters.IsActive.Value);
        }

        // Filter by join date range
        if (filters.JoinedAfter.HasValue)
        {
            query = query.Where(u => u.CreatedAt >= filters.JoinedAfter.Value);
        }
        if (filters.JoinedBefore.HasValue)
        {
            query = query.Where(u => u.CreatedAt <= filters.JoinedBefore.Value);
        }

        // Filter by last login range
        if (filters.LastLoginAfter.HasValue)
        {
            query = query.Where(u => u.LastLoginAt != null && u.LastLoginAt >= filters.LastLoginAfter.Value);
        }
        if (filters.LastLoginBefore.HasValue)
        {
            query = query.Where(u => u.LastLoginAt != null && u.LastLoginAt <= filters.LastLoginBefore.Value);
        }

        // Filter by XP range
        if (filters.MinXp.HasValue)
        {
            query = query.Where(u => u.TotalXp >= filters.MinXp.Value);
        }
        if (filters.MaxXp.HasValue)
        {
            query = query.Where(u => u.TotalXp <= filters.MaxXp.Value);
        }

        // Filter by name or email search
        if (!string.IsNullOrWhiteSpace(filters.Search))
        {
            var search = filters.Search.ToLower();
            query = query.Where(u =>
                u.Email.ToLower().Contains(search) ||
                u.FirstName.ToLower().Contains(search) ||
                u.LastName.ToLower().Contains(search));
        }

        // Filter: has warnings (suspended users)
        if (filters.HasWarnings == true)
        {
            query = query.Where(u => u.SuspendedAt != null);
        }

        // For exchange count filters, we must apply them before pagination.
        // Load all matching user IDs, compute exchange counts, filter, then paginate.
        if (filters.MinExchangeCount.HasValue || filters.MaxExchangeCount.HasValue)
        {
            var allMatchingUsers = await query
                .OrderByDescending(u => u.CreatedAt)
                .ToListAsync();

            var allUserIds = allMatchingUsers.Select(u => u.Id).ToList();
            var exchangeCounts = await GetExchangeCountsForUsersAsync(allUserIds);

            var filtered = allMatchingUsers
                .Select(u => MapUserToDto(u, exchangeCounts.GetValueOrDefault(u.Id, 0)))
                .AsEnumerable();

            if (filters.MinExchangeCount.HasValue)
                filtered = filtered.Where(u => u.ExchangeCount >= filters.MinExchangeCount.Value);
            if (filters.MaxExchangeCount.HasValue)
                filtered = filtered.Where(u => u.ExchangeCount <= filters.MaxExchangeCount.Value);

            var filteredList = filtered.ToList();
            var total = filteredList.Count;

            var userDtos = filteredList
                .Skip((page - 1) * limit)
                .Take(limit)
                .ToList();

            return new AdvancedSearchResultDto
            {
                Users = userDtos,
                Total = total,
                Page = page,
                Limit = limit
            };
        }
        else
        {
            var total = await query.CountAsync();

            var users = await query
                .OrderByDescending(u => u.CreatedAt)
                .Skip((page - 1) * limit)
                .Take(limit)
                .ToListAsync();

            var userIds = users.Select(u => u.Id).ToList();
            var exchangeCounts = await GetExchangeCountsForUsersAsync(userIds);

            var userDtos = users.Select(u => MapUserToDto(u, exchangeCounts.GetValueOrDefault(u.Id, 0))).ToList();

            return new AdvancedSearchResultDto
            {
                Users = userDtos,
                Total = total,
                Page = page,
                Limit = limit
            };
        }
    }

    /// <summary>Create a CRM task for a user.</summary>
    public async Task<(CrmTask?, string? Error)> CreateCrmTaskAsync(
        int tenantId, int targetUserId, int adminId, string title,
        string? description, string? priority, DateTime? dueDate)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == targetUserId);
        if (user == null) return (null, "User not found");

        var task = new CrmTask
        {
            TenantId = tenantId,
            TargetUserId = targetUserId,
            AssignedToAdminId = adminId,
            Title = title,
            Description = description,
            Priority = priority ?? "medium",
            Status = "pending",
            DueDate = dueDate
        };

        _db.Set<CrmTask>().Add(task);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created CRM task {TaskId} for user {UserId}", adminId, task.Id, targetUserId);
        return (task, null);
    }

    /// <summary>List CRM tasks with optional filters.</summary>
    public async Task<(List<CrmTask> Tasks, int Total)> ListCrmTasksAsync(int tenantId, int? targetUserId, string? status)
    {
        var query = _db.Set<CrmTask>().Where(t => t.TenantId == tenantId);

        if (targetUserId.HasValue)
            query = query.Where(t => t.TargetUserId == targetUserId.Value);

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(t => t.Status == status);

        var total = await query.CountAsync();
        var tasks = await query.OrderByDescending(t => t.CreatedAt).ToListAsync();
        return (tasks, total);
    }

    /// <summary>Mark a CRM task as done.</summary>
    public async Task<(bool Success, string? Error)> CompleteCrmTaskAsync(int tenantId, int taskId)
    {
        var task = await _db.Set<CrmTask>().FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == taskId);
        if (task == null) return (false, "Task not found");
        task.Status = "done";
        task.CompletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>Delete a CRM task.</summary>
    public async Task<(bool Success, string? Error)> DeleteCrmTaskAsync(int tenantId, int taskId)
    {
        var task = await _db.Set<CrmTask>().FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == taskId);
        if (task == null) return (false, "Task not found");
        _db.Set<CrmTask>().Remove(task);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>Add a tag to a user.</summary>
    public async Task<(bool Success, string? Error)> AddTagToUserAsync(int tenantId, int userId, int adminId, string tag)
    {
        tag = tag.Trim().ToLower();
        if (string.IsNullOrWhiteSpace(tag)) return (false, "Tag cannot be empty");
        if (tag.Length > 100) return (false, "Tag must be 100 characters or fewer");

        var existing = await _db.Set<UserTag>()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.UserId == userId && t.Tag == tag);
        if (existing != null) return (true, null); // Idempotent: already applied is success

        var userTag = new UserTag
        {
            TenantId = tenantId,
            UserId = userId,
            Tag = tag,
            AppliedByAdminId = adminId
        };
        _db.Set<UserTag>().Add(userTag);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Concurrent insert race — tag was added between check and insert; treat as success
            return (true, null);
        }
        return (true, null);
    }

    /// <summary>Remove a tag from a user.</summary>
    public async Task<(bool Success, string? Error)> RemoveTagFromUserAsync(int tenantId, int userId, string tag)
    {
        tag = tag.Trim().ToLower();
        var existing = await _db.Set<UserTag>()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.UserId == userId && t.Tag == tag);
        if (existing == null) return (false, "Tag not found");
        _db.Set<UserTag>().Remove(existing);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>Get all tags for a user.</summary>
    public async Task<List<string>> GetUserTagsAsync(int tenantId, int userId)
    {
        return await _db.Set<UserTag>()
            .Where(t => t.TenantId == tenantId && t.UserId == userId)
            .OrderBy(t => t.Tag)
            .Select(t => t.Tag)
            .ToListAsync();
    }

    /// <summary>Export filtered users as CSV string.</summary>
    public async Task<string> ExportUsersAsCsvAsync(int tenantId, AdvancedUserSearchFilters filters)
    {
        filters.Limit = 5000; // cap for export
        var result = await SearchUsersAdvancedAsync(filters);

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("id,email,first_name,last_name,role,is_active,created_at,last_login_at,total_xp,level,exchange_count");

        foreach (var u in result.Users)
        {
            sb.AppendLine(
                $"{u.Id},{EscapeCsv(u.Email)},{EscapeCsv(u.FirstName)},{EscapeCsv(u.LastName)}," +
                $"{u.Role},{u.IsActive},{u.CreatedAt:O},{u.LastLoginAt?.ToString("O") ?? string.Empty}," +
                $"{u.TotalXp},{u.Level},{u.ExchangeCount}");
        }

        return sb.ToString();
    }

    private static string EscapeCsv(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return "";

        // Remove newlines and carriage returns
        var cleaned = value.Replace("\r", " ").Replace("\n", " ");

        // Prefix with single-quote if value starts with a formula character
        // to prevent spreadsheet formula injection
        if (cleaned.Length > 0 && "=+-@\t\r".IndexOf(cleaned[0]) >= 0)
            cleaned = "'" + cleaned;

        // If value contains comma, quote, or whitespace, wrap in double quotes
        if (cleaned.Contains(',') || cleaned.Contains('"') || cleaned.Contains(' '))
        {
            cleaned = cleaned.Replace("\"", "\"\"");
            cleaned = $"\"{cleaned}\"";
        }

        return cleaned;
    }

    #region Private helpers

    private async Task<Dictionary<int, int>> GetExchangeCountsForUsersAsync(List<int> userIds)
    {
        if (!userIds.Any()) return new Dictionary<int, int>();

        var exchanges = await _db.Exchanges.AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed &&
                        (userIds.Contains(e.InitiatorId) || userIds.Contains(e.ListingOwnerId)))
            .Select(e => new { e.InitiatorId, e.ListingOwnerId })
            .ToListAsync();

        var counts = new Dictionary<int, int>();
        foreach (var id in userIds)
        {
            counts[id] = exchanges.Count(e => e.InitiatorId == id || e.ListingOwnerId == id);
        }
        return counts;
    }

    private static AdminNoteDto MapToDto(AdminNote note, User? user, User? admin)
    {
        return new AdminNoteDto
        {
            Id = note.Id,
            UserId = note.UserId,
            UserName = user != null ? $"{user.FirstName} {user.LastName}" : null,
            AdminId = note.AdminId,
            AdminName = admin != null ? $"{admin.FirstName} {admin.LastName}" : null,
            Content = note.Content,
            Category = note.Category,
            IsFlagged = note.IsFlagged,
            CreatedAt = note.CreatedAt,
            UpdatedAt = note.UpdatedAt
        };
    }

    private static CrmUserDto MapUserToDto(User user, int exchangeCount)
    {
        return new CrmUserDto
        {
            Id = user.Id,
            Email = user.Email,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = user.Role,
            IsActive = user.IsActive,
            CreatedAt = user.CreatedAt,
            LastLoginAt = user.LastLoginAt,
            TotalXp = user.TotalXp,
            Level = user.Level,
            ExchangeCount = exchangeCount,
            SuspendedAt = user.SuspendedAt,
            SuspensionReason = user.SuspensionReason
        };
    }

    #endregion
}

#region DTOs

public class AdminNoteDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("user_id")]
    public int UserId { get; set; }

    [JsonPropertyName("user_name")]
    public string? UserName { get; set; }

    [JsonPropertyName("admin_id")]
    public int AdminId { get; set; }

    [JsonPropertyName("admin_name")]
    public string? AdminName { get; set; }

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("is_flagged")]
    public bool IsFlagged { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public DateTime? UpdatedAt { get; set; }
}

public class PaginatedNotesDto
{
    [JsonPropertyName("notes")]
    public List<AdminNoteDto> Notes { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }
}

public class AdvancedUserSearchFilters
{
    public string? Role { get; set; }
    public bool? IsActive { get; set; }
    public DateTime? JoinedAfter { get; set; }
    public DateTime? JoinedBefore { get; set; }
    public DateTime? LastLoginAfter { get; set; }
    public DateTime? LastLoginBefore { get; set; }
    public int? MinXp { get; set; }
    public int? MaxXp { get; set; }
    public int? MinExchangeCount { get; set; }
    public int? MaxExchangeCount { get; set; }
    public bool? HasWarnings { get; set; }
    public string? Search { get; set; }
    public int Page { get; set; } = 1;
    public int Limit { get; set; } = 20;
}

public class CrmUserDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("first_name")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("last_name")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonPropertyName("is_active")]
    public bool IsActive { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonPropertyName("last_login_at")]
    public DateTime? LastLoginAt { get; set; }

    [JsonPropertyName("total_xp")]
    public int TotalXp { get; set; }

    [JsonPropertyName("level")]
    public int Level { get; set; }

    [JsonPropertyName("exchange_count")]
    public int ExchangeCount { get; set; }

    [JsonPropertyName("suspended_at")]
    public DateTime? SuspendedAt { get; set; }

    [JsonPropertyName("suspension_reason")]
    public string? SuspensionReason { get; set; }
}

public class AdvancedSearchResultDto
{
    [JsonPropertyName("users")]
    public List<CrmUserDto> Users { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }
}

#endregion
