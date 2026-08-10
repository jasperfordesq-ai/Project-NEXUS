// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersParityController : ControllerBase
{
    private const string AppreciationsKey = "social.appreciations";
    private static readonly JsonSerializerOptions StoreJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public UsersParityController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string? q = null)
    {
        var users = await _db.Users.Where(u => u.TenantId == TenantId() && (q == null || u.FirstName.Contains(q) || u.LastName.Contains(q) || u.Email.Contains(q))).Take(50).Select(u => new { u.Id, u.FirstName, u.LastName, u.Email, u.AvatarUrl }).ToListAsync();
        return Ok(new { data = users });
    }

    [HttpGet("blocked")]
    public async Task<IActionResult> Blocked()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var rows = await (
            from block in _db.UserBlocks.AsNoTracking()
            join blockedUser in _db.Users.AsNoTracking() on block.BlockedUserId equals blockedUser.Id
            where block.TenantId == tenantId
                && block.UserId == userId
                && blockedUser.TenantId == tenantId
            orderby block.CreatedAt descending
            select new
            {
                block_id = block.Id,
                user_id = block.BlockedUserId,
                first_name = blockedUser.FirstName,
                last_name = blockedUser.LastName,
                avatar_url = blockedUser.AvatarUrl,
                reason = block.Reason,
                blocked_at = block.CreatedAt
            }).ToListAsync();

        var data = rows.Select(row => new
        {
            row.block_id,
            row.user_id,
            name = $"{row.first_name} {row.last_name}".Trim(),
            row.first_name,
            row.last_name,
            row.avatar_url,
            row.reason,
            row.blocked_at
        }).ToList();

        return Ok(new { data, meta = BaseMeta() });
    }

    [HttpPost("{userId:int}/block")]
    public async Task<IActionResult> BlockUser(int userId, [FromBody] JsonElement body)
    {
        var tenantId = TenantId();
        var currentUserId = UserId();
        if (currentUserId == userId)
        {
            return BadRequest(ErrorEnvelope("VALIDATION_ERROR", "You cannot block yourself."));
        }

        var targetExists = await _db.Users.AsNoTracking()
            .AnyAsync(u => u.TenantId == tenantId && u.Id == userId);
        if (!targetExists)
        {
            return NotFound(ErrorEnvelope("NOT_FOUND", "User not found."));
        }

        var existing = await _db.UserBlocks.FirstOrDefaultAsync(block =>
            block.TenantId == tenantId &&
            block.UserId == currentUserId &&
            block.BlockedUserId == userId);

        if (existing == null)
        {
            _db.UserBlocks.Add(new UserBlock
            {
                TenantId = tenantId,
                UserId = currentUserId,
                BlockedUserId = userId,
                Reason = Str(body, "reason"),
                CreatedAt = DateTime.UtcNow
            });
        }

        var connections = await _db.Connections
            .Where(connection => connection.TenantId == tenantId &&
                ((connection.RequesterId == currentUserId && connection.AddresseeId == userId) ||
                 (connection.RequesterId == userId && connection.AddresseeId == currentUserId)))
            .ToListAsync();
        if (connections.Count > 0)
        {
            _db.Connections.RemoveRange(connections);
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            data = new
            {
                success = true,
                message = "User blocked.",
                blocked_user_id = userId
            },
            meta = BaseMeta()
        });
    }

    [HttpDelete("{userId:int}/block")]
    public async Task<IActionResult> UnblockUser(int userId)
    {
        var tenantId = TenantId();
        var currentUserId = UserId();
        var block = await _db.UserBlocks.FirstOrDefaultAsync(row =>
            row.TenantId == tenantId &&
            row.UserId == currentUserId &&
            row.BlockedUserId == userId);

        if (block == null)
        {
            return NotFound(ErrorEnvelope("NOT_FOUND", "User is not blocked."));
        }

        _db.UserBlocks.Remove(block);
        await _db.SaveChangesAsync();
        return Ok(new
        {
            data = new
            {
                success = true,
                message = "User unblocked.",
                unblocked_user_id = userId
            },
            meta = BaseMeta()
        });
    }

    [HttpGet("{userId:int}/block-status")]
    public async Task<IActionResult> BlockStatus(int userId)
    {
        var tenantId = TenantId();
        var currentUserId = UserId();
        var isBlocked = await _db.UserBlocks.AsNoTracking().AnyAsync(block =>
            block.TenantId == tenantId &&
            block.UserId == currentUserId &&
            block.BlockedUserId == userId);
        var isBlockedBy = await _db.UserBlocks.AsNoTracking().AnyAsync(block =>
            block.TenantId == tenantId &&
            block.UserId == userId &&
            block.BlockedUserId == currentUserId);

        return Ok(new { data = new { is_blocked = isBlocked, is_blocked_by = isBlockedBy }, meta = BaseMeta() });
    }

    [HttpGet("{userId:int}/appreciations")]
    public async Task<IActionResult> Appreciations(int userId, [FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 20)
    {
        var tenantId = TenantId();
        var safePage = Math.Max(page, 1);
        var safePerPage = Math.Clamp(perPage, 1, 100);
        var all = (await LoadAppreciationsAsync(tenantId))
            .Where(a => a.ReceiverId == userId && a.IsPublic)
            .OrderByDescending(a => a.CreatedAt)
            .ToList();
        var data = await MapAppreciationsAsync(all.Skip((safePage - 1) * safePerPage).Take(safePerPage), UserId());

        return Ok(new
        {
            success = true,
            data,
            meta = PageMeta(safePage, safePerPage, all.Count)
        });
    }

    [HttpGet("{userId:int}/rating")]
    public async Task<IActionResult> Rating(int userId)
    {
        var reviews = await _db.Reviews.Where(r => r.TenantId == TenantId() && r.TargetUserId == userId).ToListAsync();
        return Ok(new { data = new { user_id = userId, average = reviews.Count == 0 ? 0 : Math.Round(reviews.Average(r => r.Rating), 2), count = reviews.Count } });
    }

    [HttpGet("{userId:int}/skills")]
    public async Task<IActionResult> Skills(int userId) => Ok(new { data = await _db.UserSkills.Where(s => s.TenantId == TenantId() && s.UserId == userId).Include(s => s.Skill).ToListAsync() });

    [HttpGet("{userId:int}/public-collections")]
    public async Task<IActionResult> PublicCollections(int userId) => Ok(new { data = await _db.MarketplaceCollections.Where(c => c.TenantId == TenantId() && c.UserId == userId && c.IsPublic).ToListAsync() });

    [HttpGet("{userId:int}/verein-membership-status")]
    public IActionResult VereinMembershipStatus(int userId) => Ok(new { data = new { user_id = userId, status = "none" } });

    [HttpGet("me/listings")]
    public async Task<IActionResult> MyListings() => Ok(new { data = await _db.Listings.Where(l => l.TenantId == TenantId() && l.UserId == UserId()).ToListAsync() });

    [HttpGet("me/activity/hours")]
    public async Task<IActionResult> ActivityHours()
    {
        var hours = await _db.VolunteerCheckIns.Where(c => c.TenantId == TenantId() && c.UserId == UserId()).SumAsync(c => c.HoursLogged ?? 0);
        return Ok(new { data = new { hours } });
    }

    [HttpGet("me/activity/monthly")]
    public IActionResult ActivityMonthly() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("me/activity/timeline")]
    public async Task<IActionResult> ActivityTimeline() => Ok(new { data = await _db.AuditLogs.Where(a => a.TenantId == TenantId() && a.UserId == UserId()).OrderByDescending(a => a.CreatedAt).Take(50).ToListAsync() });

    [HttpGet("me/availability")]
    public async Task<IActionResult> Availability()
    {
        var weekly = await BuildAvailabilityWeeklyAsync(UserId());
        return Ok(new { success = true, data = new { weekly, timezone = "Europe/Zurich" } });
    }

    [HttpPost("me/availability/date")]
    public async Task<IActionResult> AvailabilityDate([FromBody] JsonElement body)
    {
        var exception = new AvailabilityException { TenantId = TenantId(), UserId = UserId(), Date = Date(body, "date") ?? DateTime.UtcNow.Date, Type = Str(body, "type") ?? "available", StartTime = Str(body, "start_time"), EndTime = Str(body, "end_time"), Reason = Str(body, "reason") };
        _db.AvailabilityExceptions.Add(exception);
        await _db.SaveChangesAsync();
        return Ok(new { data = exception });
    }

    [HttpPut("me/availability/{id:int}")]
    public async Task<IActionResult> UpdateAvailability([FromRoute(Name = "id")] int availabilityId, [FromBody] JsonElement body)
    {
        var slot = await _db.MemberAvailabilities.FirstOrDefaultAsync(a => a.TenantId == TenantId() && a.UserId == UserId() && a.Id == availabilityId);
        if (slot == null) return NotFound(new { error = "Availability not found" });
        slot.StartTime = Str(body, "start_time") ?? slot.StartTime;
        slot.EndTime = Str(body, "end_time") ?? slot.EndTime;
        slot.IsActive = Bool(body, "is_active") ?? slot.IsActive;
        slot.Note = Str(body, "note") ?? slot.Note;
        slot.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = slot });
    }

    [HttpPut("me/availability/{day}")]
    public async Task<IActionResult> UpdateAvailabilityByDay(string day, [FromBody] JsonElement body)
    {
        var dayNumber = ParseDayOfWeek(day);
        if (dayNumber is null) return BadRequest(new { error = "Invalid day" });

        var tenantId = TenantId();
        var userId = UserId();
        var slot = await _db.MemberAvailabilities.FirstOrDefaultAsync(a =>
            a.TenantId == tenantId && a.UserId == userId && a.DayOfWeek == dayNumber.Value);
        if (slot == null)
        {
            slot = new MemberAvailability
            {
                TenantId = tenantId,
                UserId = userId,
                DayOfWeek = dayNumber.Value,
                StartTime = Str(body, "start_time") ?? "09:00",
                EndTime = Str(body, "end_time") ?? "17:00",
                IsActive = Bool(body, "is_active") ?? true,
                Note = Str(body, "note"),
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _db.MemberAvailabilities.Add(slot);
        }
        else
        {
            slot.StartTime = Str(body, "start_time") ?? slot.StartTime;
            slot.EndTime = Str(body, "end_time") ?? slot.EndTime;
            slot.IsActive = Bool(body, "is_active") ?? slot.IsActive;
            slot.Note = Str(body, "note") ?? slot.Note;
            slot.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return Ok(new { data = slot });
    }

    [HttpDelete("me/availability/{id:int}")]
    public async Task<IActionResult> DeleteAvailability([FromRoute(Name = "id")] int availabilityId)
    {
        var slot = await _db.MemberAvailabilities.FirstOrDefaultAsync(a => a.TenantId == TenantId() && a.UserId == UserId() && a.Id == availabilityId);
        if (slot != null) _db.MemberAvailabilities.Remove(slot);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("me/match-preferences")]
    public async Task<IActionResult> MatchPreferences()
    {
        var data = await BuildLaravelMatchPreferencesAsync();
        return Ok(new { success = true, data });
    }

    [HttpPut("/api/v2/users/me/match-preferences")]
    public async Task<IActionResult> UpdateMatchPreferences([FromBody] JsonElement body)
    {
        var tenantId = TenantId();
        var userId = UserId();
        var preferences = await _db.MatchPreferences.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        if (preferences == null)
        {
            preferences = new MatchPreference
            {
                TenantId = tenantId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            };
            _db.MatchPreferences.Add(preferences);
        }

        if (Int(body, "max_distance_km") is { } maxDistance)
        {
            preferences.MaxDistanceKm = Math.Clamp(maxDistance, 1, 100);
        }

        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("categories", out var categories) && categories.ValueKind == JsonValueKind.Array)
        {
            preferences.PreferredCategories = JsonSerializer.Serialize(categories.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out _))
                .Select(item => item.GetInt32())
                .ToArray(), StoreJsonOptions);
        }

        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("availability", out var availability) && availability.ValueKind == JsonValueKind.Array)
        {
            preferences.AvailableDays = JsonSerializer.Serialize(availability.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => (item.GetString() ?? string.Empty).Trim())
                .Where(item => item.Length > 0)
                .Select(item => item.Length > 50 ? item[..50] : item)
                .ToArray(), StoreJsonOptions);
        }

        if (Bool(body, "matching_paused") is { } paused)
        {
            preferences.IsActive = !paused;
        }

        var user = await CurrentUserAsync();
        var bag = ParsePreferenceBag(user.NotificationPreferences);
        if (Str(body, "notification_frequency") is { } frequency)
        {
            var normalized = frequency == "weekly" ? "monthly" : frequency;
            if (normalized is not ("daily" or "monthly" or "fortnightly" or "never"))
            {
                return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "notification_frequency" });
            }

            bag["match_notification_frequency"] = normalized;
        }

        if (Bool(body, "notify_hot_matches") is { } notifyHot)
        {
            bag["match_notify_hot_matches"] = notifyHot;
        }

        if (Bool(body, "notify_mutual_matches") is { } notifyMutual)
        {
            bag["match_notify_mutual_matches"] = notifyMutual;
        }

        if (Int(body, "min_match_score") is { } minScore)
        {
            bag["match_min_match_score"] = Math.Clamp(minScore, 0, 100);
        }

        user.NotificationPreferences = bag.ToJsonString(StoreJsonOptions);
        user.UpdatedAt = DateTime.UtcNow;
        preferences.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var data = await BuildLaravelMatchPreferencesAsync();
        return Ok(new { success = true, data });
    }

    [HttpPut("me/theme-preferences")]
    public async Task<IActionResult> ThemePreferences([FromBody] JsonElement body)
    {
        var accentColor = Str(body, "accent_color");
        var fontSize = Str(body, "font_size");
        var density = Str(body, "density");

        if (accentColor is not null && !System.Text.RegularExpressions.Regex.IsMatch(accentColor, "^#[0-9a-fA-F]{6}$"))
        {
            return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "accent_color" });
        }

        if (fontSize is not null && fontSize is not ("small" or "medium" or "large"))
        {
            return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "font_size" });
        }

        if (density is not null && density is not ("compact" or "comfortable" or "spacious"))
        {
            return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "density" });
        }

        var pref = await _db.UserPreferences.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.UserId == UserId());
        if (pref == null)
        {
            pref = new Nexus.Api.Entities.UserPreference { TenantId = TenantId(), UserId = UserId() };
            _db.UserPreferences.Add(pref);
        }
        pref.Theme = Str(body, "theme") ?? pref.Theme;
        pref.Language = Str(body, "language") ?? pref.Language;
        pref.UpdatedAt = DateTime.UtcNow;

        var user = await CurrentUserAsync();
        var bag = ParsePreferenceBag(user.NotificationPreferences);
        var preferences = ThemePreferencesBag(bag);

        if (accentColor is not null) preferences["accent_color"] = accentColor;
        if (fontSize is not null) preferences["font_size"] = fontSize;
        if (density is not null) preferences["density"] = density;
        if (Bool(body, "large_text") is { } largeText) preferences["large_text"] = largeText;
        if (Bool(body, "high_contrast") is { } highContrast) preferences["high_contrast"] = highContrast;
        if (Bool(body, "reduced_motion") is { } reducedMotion) preferences["reduced_motion"] = reducedMotion;
        if (Bool(body, "simplified_layout") is { } simplifiedLayout) preferences["simplified_layout"] = simplifiedLayout;

        bag["theme_preferences"] = preferences;
        user.NotificationPreferences = bag.ToJsonString(StoreJsonOptions);
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { message = "Theme preferences updated.", theme_preferences = preferences } });
    }

    [HttpPut("me/resume-visibility")]
    public async Task<IActionResult> ResumeVisibility([FromBody] JsonElement body)
    {
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.UserId == UserId());
        if (profile == null)
        {
            profile = new Nexus.Api.Entities.JobSavedProfile { TenantId = TenantId(), UserId = UserId() };
            _db.JobSavedProfiles.Add(profile);
        }
        profile.VisibleToEmployers = Bool(body, "visible") ?? Bool(body, "visible_to_employers") ?? profile.VisibleToEmployers;
        await _db.SaveChangesAsync();
        return Ok(new { data = profile });
    }

    [HttpPut("me/skills/{id:int}")]
    public async Task<IActionResult> UpdateSkill([FromRoute(Name = "id")] int skillId, [FromBody] JsonElement body)
    {
        var skill = await _db.UserSkills.FirstOrDefaultAsync(s =>
            s.TenantId == TenantId() &&
            s.UserId == UserId() &&
            (s.Id == skillId || s.SkillId == skillId));
        if (skill == null) return NotFound(new { error = "Skill not found" });

        if ((Str(body, "proficiency_level") ?? Str(body, "proficiency")) is { } proficiency)
        {
            skill.ProficiencyLevel = NormalizeSkillLevel(proficiency);
        }

        skill.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = await BuildLaravelUserSkillListAsync(UserId()) });
    }

    [HttpGet("me/parent-accounts")]
    public async Task<IActionResult> ParentAccounts()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var rows = await (
            from relationship in _db.SubAccounts.AsNoTracking()
            join parent in _db.Users.AsNoTracking() on relationship.PrimaryUserId equals parent.Id
            where relationship.TenantId == tenantId
                && relationship.SubUserId == userId
                && parent.TenantId == tenantId
            orderby relationship.CreatedAt descending
            select new { relationship, user = parent })
            .ToListAsync();

        return Ok(new { data = rows.Select(row => SubAccountRelationshipRow(row.relationship, row.user)) });
    }

    [HttpGet("me/sub-accounts")]
    public async Task<IActionResult> SubAccounts()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var rows = await (
            from relationship in _db.SubAccounts.AsNoTracking()
            join child in _db.Users.AsNoTracking() on relationship.SubUserId equals child.Id
            where relationship.TenantId == tenantId
                && relationship.PrimaryUserId == userId
                && child.TenantId == tenantId
            orderby relationship.CreatedAt descending
            select new { relationship, user = child })
            .ToListAsync();

        return Ok(new { data = rows.Select(row => SubAccountRelationshipRow(row.relationship, row.user)) });
    }

    [HttpGet("me/sub-accounts/{childId:int}/activity")]
    public IActionResult SubAccountActivity([FromRoute(Name = "childId")] int subAccountId) => Ok(new { data = Array.Empty<object>(), sub_account_id = subAccountId });

    private async Task<object> BuildLaravelMatchPreferencesAsync()
    {
        var row = await _db.MatchPreferences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.UserId == UserId());
        var user = await CurrentUserAsync();
        var bag = ParsePreferenceBag(user.NotificationPreferences);

        return new
        {
            max_distance_km = (int)Math.Round(row?.MaxDistanceKm ?? 25),
            min_match_score = PreferenceInt(bag, "match_min_match_score", 50),
            notification_frequency = PreferenceString(bag, "match_notification_frequency", "monthly"),
            notify_hot_matches = PreferenceBool(bag, "match_notify_hot_matches", true),
            notify_mutual_matches = PreferenceBool(bag, "match_notify_mutual_matches", true),
            matching_paused = row?.IsActive == false,
            categories = ParseIntArray(row?.PreferredCategories),
            availability = ParseStringArray(row?.AvailableDays)
        };
    }

    private async Task<User> CurrentUserAsync()
    {
        var userId = UserId();
        return await _db.Users.FirstOrDefaultAsync(u => u.TenantId == TenantId() && u.Id == userId)
            ?? throw new UnauthorizedAccessException("Invalid token");
    }

    private static object SubAccountRelationshipRow(SubAccount relationship, User user) => new
    {
        relationship_id = relationship.Id,
        relationship_type = relationship.Relationship,
        permissions = new
        {
            can_view_activity = true,
            can_manage_listings = relationship.CanJoinGroups,
            can_transact = relationship.CanTransact,
            can_view_messages = relationship.CanMessage
        },
        status = relationship.IsActive ? "active" : "pending",
        approved_at = relationship.IsActive ? relationship.UpdatedAt ?? relationship.CreatedAt : (DateTime?)null,
        created_at = relationship.CreatedAt,
        user_id = user.Id,
        first_name = user.FirstName,
        last_name = user.LastName,
        avatar_url = user.AvatarUrl,
        email = user.Email
    };

    private static JsonObject ThemePreferencesBag(JsonObject bag)
    {
        var existing = bag.TryGetPropertyValue("theme_preferences", out var node) && node is JsonObject obj
            ? obj
            : new JsonObject();

        existing["accent_color"] ??= "#6366f1";
        existing["font_size"] ??= "medium";
        existing["density"] ??= "comfortable";
        existing["large_text"] ??= false;
        existing["high_contrast"] ??= false;
        existing["reduced_motion"] ??= false;
        existing["simplified_layout"] ??= false;
        return existing;
    }

    private async Task<List<object>> BuildAvailabilityWeeklyAsync(int userId)
    {
        var rows = await _db.MemberAvailabilities
            .AsNoTracking()
            .Where(a => a.TenantId == TenantId() && a.UserId == userId && a.IsActive)
            .OrderBy(a => a.DayOfWeek)
            .ThenBy(a => a.StartTime)
            .ToListAsync();

        return rows.Select(a => (object)new
        {
            id = a.Id,
            day_of_week = a.DayOfWeek,
            start_time = a.StartTime,
            end_time = a.EndTime,
            note = a.Note
        }).ToList();
    }

    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");
    private static object BaseMeta() => new { base_url = "" };
    private static object PageMeta(int page, int perPage, int total)
    {
        var totalPages = total == 0 ? 1 : (int)Math.Ceiling(total / (double)perPage);
        return new { current_page = page, page, per_page = perPage, total, last_page = totalPages, total_pages = totalPages };
    }

    private async Task<List<AppreciationRecord>> LoadAppreciationsAsync(int tenantId)
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == AppreciationsKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<AppreciationRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task<List<object>> MapAppreciationsAsync(IEnumerable<AppreciationRecord> records, int? currentUserId)
    {
        var items = records.ToList();
        var senderIds = items.Select(a => a.SenderId).Distinct().ToArray();
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == TenantId() && senderIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return items.Select(record =>
        {
            users.TryGetValue(record.SenderId, out var sender);
            return (object)new
            {
                id = record.Id,
                sender_id = record.SenderId,
                receiver_id = record.ReceiverId,
                message = record.Message,
                context_type = record.ContextType,
                context_id = record.ContextId,
                is_public = record.IsPublic,
                reactions_count = record.Reactions.Count,
                created_at = record.CreatedAt,
                updated_at = record.UpdatedAt,
                sender = sender == null ? null : new
                {
                    id = sender.Id,
                    name = DisplayName(sender),
                    avatar_url = sender.AvatarUrl
                },
                my_reaction = currentUserId.HasValue && record.Reactions.TryGetValue(currentUserId.Value.ToString(), out var reaction)
                    ? reaction
                    : null
            };
        }).ToList();
    }

    private static string DisplayName(User user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private sealed class AppreciationRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int SenderId { get; set; }
        public int ReceiverId { get; set; }
        public string Message { get; set; } = string.Empty;
        public string? ContextType { get; set; }
        public int? ContextId { get; set; }
        public bool IsPublic { get; set; } = true;
        public Dictionary<string, string> Reactions { get; set; } = [];
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private static object ErrorEnvelope(string code, string message) => new { errors = new[] { new { code, message } } };
    private static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static bool? Bool(JsonElement e, string name) => bool.TryParse(Str(e, name), out var value) ? value : null;
    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;
    private static DateTime? Date(JsonElement e, string name) => DateTime.TryParse(Str(e, name), out var value) ? value : null;

    private async Task<List<object>> BuildLaravelUserSkillListAsync(int userId)
    {
        var rows = await _db.UserSkills
            .AsNoTracking()
            .Where(us => us.TenantId == TenantId() && us.UserId == userId)
            .Include(us => us.Skill)
            .ThenInclude(skill => skill!.Category)
            .OrderBy(us => us.Skill!.Name)
            .ToListAsync();

        return rows.Select(us => (object)new
        {
            id = us.Id,
            user_id = us.UserId,
            tenant_id = us.TenantId,
            skill_id = us.SkillId,
            category_id = us.Skill?.CategoryId,
            skill_name = us.Skill?.Name ?? string.Empty,
            category_name = us.Skill?.Category?.Name,
            category_slug = us.Skill?.Category?.Slug,
            proficiency_level = us.ProficiencyLevel.ToString().ToLowerInvariant(),
            is_offering = true,
            is_requesting = false,
            endorsement_count = us.EndorsementCount,
            created_at = us.CreatedAt
        }).ToList();
    }

    private static SkillLevel NormalizeSkillLevel(string? proficiencyLevel)
    {
        if (string.IsNullOrWhiteSpace(proficiencyLevel))
        {
            return SkillLevel.Intermediate;
        }

        return Enum.TryParse<SkillLevel>(proficiencyLevel.Trim(), true, out var parsed)
            ? parsed
            : SkillLevel.Intermediate;
    }

    private static JsonObject ParsePreferenceBag(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(raw) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static bool PreferenceBool(JsonObject bag, string key, bool defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return defaultValue;
        }

        try
        {
            if (value.TryGetValue<bool>(out var boolValue)) return boolValue;
            if (value.TryGetValue<int>(out var intValue)) return intValue != 0;
            if (value.TryGetValue<string>(out var stringValue) && bool.TryParse(stringValue, out var parsed)) return parsed;
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }

        return defaultValue;
    }

    private static int PreferenceInt(JsonObject bag, string key, int defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return defaultValue;
        }

        try
        {
            if (value.TryGetValue<int>(out var intValue)) return intValue;
            if (value.TryGetValue<string>(out var stringValue) && int.TryParse(stringValue, out var parsed)) return parsed;
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }

        return defaultValue;
    }

    private static string PreferenceString(JsonObject bag, string key, string defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return defaultValue;
        }

        try
        {
            return value.TryGetValue<string>(out var stringValue) && !string.IsNullOrWhiteSpace(stringValue)
                ? stringValue
                : defaultValue;
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }
    }

    private static int[] ParseIntArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try
        {
            return JsonSerializer.Deserialize<int[]>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string[] ParseStringArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try
        {
            return JsonSerializer.Deserialize<string[]>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static int? ParseDayOfWeek(string day)
    {
        if (int.TryParse(day, out var number) && number is >= 0 and <= 6) return number;
        return day.Trim().ToLowerInvariant() switch
        {
            "sunday" or "sun" => 0,
            "monday" or "mon" => 1,
            "tuesday" or "tue" or "tues" => 2,
            "wednesday" or "wed" => 3,
            "thursday" or "thu" or "thurs" => 4,
            "friday" or "fri" => 5,
            "saturday" or "sat" => 6,
            _ => null
        };
    }
}
