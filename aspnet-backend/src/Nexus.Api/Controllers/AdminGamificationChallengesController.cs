// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin challenge CRUD — Laravel parity for AdminGamificationController's
/// challenge actions. Serves the Laravel wire shape (challenge_type strings,
/// action_type, start_date/end_date, badge_reward) from the existing
/// Challenge entity; badge_reward maps to a Badge slug (BadgeId internally).
/// Laravel quirk copied: a partial update skips keys sent as explicit JSON
/// null, so null can never clear description or badge_reward.
/// </summary>
[ApiController]
[Authorize]
public class AdminGamificationChallengesController : ControllerBase
{
    private static readonly string[] AdminRoles = ["admin", "tenant_admin", "super_admin", "god"];
    private static readonly string[] OperationalRoles = ["broker", "coordinator"];
    private static readonly string[] SupportedActionTypes =
        ["venue_visit", "event_attendance_verified", "attend_event"];
    private static readonly string[] ChallengeTypes = ["daily", "weekly", "monthly", "special"];

    private readonly NexusDbContext _db;

    public AdminGamificationChallengesController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("api/v2/admin/gamification/challenges")]
    public async Task<IActionResult> List(
        [FromQuery] int limit = 50, [FromQuery] int offset = 0,
        [FromQuery(Name = "challenge_type")] string? challengeType = null,
        [FromQuery(Name = "is_active")] string? isActive = null)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        limit = Math.Min(Math.Max(limit, 0), 100);
        offset = Math.Max(0, offset);
        var query = _db.Set<Challenge>().AsNoTracking().AsQueryable();
        if (!string.IsNullOrEmpty(challengeType) && TryParseType(challengeType, out var parsedType))
        {
            query = query.Where(c => c.ChallengeType == parsedType);
        }

        if (!string.IsNullOrEmpty(isActive))
        {
            var active = isActive is "1" or "true" or "on" or "yes";
            query = query.Where(c => c.IsActive == active);
        }

        var total = await query.CountAsync(HttpContext.RequestAborted);
        var rows = await query
            .OrderByDescending(c => c.CreatedAt)
            .Skip(offset).Take(limit)
            .ToListAsync(HttpContext.RequestAborted);
        var badgeSlugs = await BadgeSlugsAsync(rows);

        return LaravelData(new
        {
            challenges = rows.Select(c => Present(c, badgeSlugs)).ToList(),
            total,
            supported_action_types = SupportedActionTypes,
            challenge_types = ChallengeTypes
        });
    }

    [HttpPost("api/v2/admin/gamification/challenges")]
    public async Task<IActionResult> Create([FromBody] JsonElement body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var invalidField = InvalidChallengeField(body, partial: false);
        if (invalidField is not null)
        {
            return LaravelError(422, "VALIDATION_ERROR",
                "One or more challenge fields are invalid", invalidField);
        }

        var challenge = new Challenge
        {
            TenantId = User.GetTenantId() ?? 0,
            Title = (ReadString(body, "title") ?? "").Trim(),
            Description = ReadString(body, "description"),
            ChallengeType = TryParseType(ReadString(body, "challenge_type") ?? "weekly", out var type)
                ? type : ChallengeType.Weekly,
            TargetAction = ReadString(body, "action_type") ?? "",
            TargetCount = Math.Max(1, ReadInt(body, "target_count") ?? 1),
            XpReward = Math.Max(0, ReadInt(body, "xp_reward") ?? 50),
            BadgeId = await ResolveBadgeIdAsync(ReadString(body, "badge_reward")),
            StartsAt = ParseDate(ReadString(body, "start_date")) ?? DateTime.UtcNow.Date,
            EndsAt = ParseDate(ReadString(body, "end_date")) ?? DateTime.UtcNow.Date,
            IsActive = ReadBool(body, "is_active") ?? true,
            CreatedAt = DateTime.UtcNow
        };
        _db.Set<Challenge>().Add(challenge);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return LaravelData(Present(challenge, await BadgeSlugsAsync([challenge])),
            StatusCodes.Status201Created);
    }

    [HttpPut("api/v2/admin/gamification/challenges/{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] JsonElement body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var challenge = await _db.Set<Challenge>()
            .FirstOrDefaultAsync(c => c.Id == id, HttpContext.RequestAborted);
        if (challenge is null) return LaravelError(404, "NOT_FOUND", "Challenge not found", null);

        var invalidField = InvalidChallengeField(body, partial: true);
        if (invalidField is not null)
        {
            return LaravelError(422, "VALIDATION_ERROR",
                "One or more challenge fields are invalid", invalidField);
        }

        // Laravel skips keys whose value is null, so JSON null never clears.
        if (ReadString(body, "title") is { } title) challenge.Title = title.Trim();
        if (ReadString(body, "description") is { } description) challenge.Description = description;
        // 🔴 Do not let a round-trip destroy the stored type.
        //
        // PresentType() renders the pre-parity values (Individual/Team/
        // Community) as "special" so the admin UI's closed vocabulary always
        // has something to show. But the admin form then sends "special" back
        // on ANY save — editing an unrelated field, such as the title — and
        // this assignment persisted ChallengeType.Special, permanently
        // destroying the original type with no warning. Laravel has no such
        // collapse.
        //
        // So: only apply the incoming type when it is a genuine change. A
        // "special" that is merely the echo of a rendered Individual/Team/
        // Community row is ignored.
        if (ReadString(body, "challenge_type") is { } typeValue
            && TryParseType(typeValue, out var parsedType)
            && !IsRenderedEchoOfLegacyType(challenge.ChallengeType, parsedType))
        {
            challenge.ChallengeType = parsedType;
        }
        if (ReadString(body, "action_type") is { } actionType) challenge.TargetAction = actionType;
        if (ReadInt(body, "target_count") is { } targetCount)
            challenge.TargetCount = Math.Max(1, targetCount);
        if (ReadInt(body, "xp_reward") is { } xpReward) challenge.XpReward = Math.Max(0, xpReward);
        if (ReadString(body, "badge_reward") is { } badgeReward)
            challenge.BadgeId = await ResolveBadgeIdAsync(badgeReward);
        if (ParseDate(ReadString(body, "start_date")) is { } startDate) challenge.StartsAt = startDate;
        if (ParseDate(ReadString(body, "end_date")) is { } endDate) challenge.EndsAt = endDate;
        if (ReadBool(body, "is_active") is { } activeFlag) challenge.IsActive = activeFlag;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return LaravelData(Present(challenge, await BadgeSlugsAsync([challenge])));
    }

    [HttpDelete("api/v2/admin/gamification/challenges/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var challenge = await _db.Set<Challenge>()
            .FirstOrDefaultAsync(c => c.Id == id, HttpContext.RequestAborted);
        if (challenge is null) return LaravelError(404, "NOT_FOUND", "Challenge not found", null);

        _db.Set<Challenge>().Remove(challenge);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);
        return LaravelData(new { deleted = true });
    }

    /// <summary>
    /// Laravel's hand-rolled invalidChallengeField, same rule order: first
    /// offending field name, or null when clean.
    /// </summary>
    private static string? InvalidChallengeField(JsonElement body, bool partial)
    {
        var title = ReadString(body, "title");
        if (!partial || HasKey(body, "title"))
        {
            if (!partial && string.IsNullOrWhiteSpace(title)) return "title";
            if (partial && HasKey(body, "title") && string.IsNullOrWhiteSpace(title)) return "title";
            if (title is { Length: > 255 }) return "title";
        }

        if (ReadString(body, "description") is { Length: > 5000 }) return "description";
        if (ReadString(body, "badge_reward") is { Length: > 50 }) return "badge_reward";

        var actionType = ReadString(body, "action_type");
        if (!partial && !SupportedActionTypes.Contains(actionType ?? "")) return "action_type";
        if (partial && HasKey(body, "action_type")
            && !SupportedActionTypes.Contains(actionType ?? "")) return "action_type";

        if (HasKey(body, "challenge_type")
            && !ChallengeTypes.Contains(ReadString(body, "challenge_type") ?? "")) return "challenge_type";
        if (ReadInt(body, "target_count") is < 1) return "target_count";
        if (ReadInt(body, "xp_reward") is < 0 or > 1000) return "xp_reward";

        var startDate = ReadString(body, "start_date");
        var endDate = ReadString(body, "end_date");
        if (!partial)
        {
            if (string.IsNullOrWhiteSpace(startDate)) return "start_date";
            if (string.IsNullOrWhiteSpace(endDate)) return "end_date";
        }

        if (!string.IsNullOrWhiteSpace(startDate) && !string.IsNullOrWhiteSpace(endDate))
        {
            var start = ParseDate(startDate);
            var end = ParseDate(endDate);
            if (start is null || end is null || end < start) return "end_date";
        }

        return null;
    }

    private object Present(Challenge challenge, IReadOnlyDictionary<int, string> badgeSlugs) => new
    {
        id = challenge.Id,
        tenant_id = challenge.TenantId,
        title = challenge.Title,
        description = challenge.Description,
        challenge_type = PresentType(challenge.ChallengeType),
        action_type = challenge.TargetAction,
        target_count = challenge.TargetCount,
        xp_reward = challenge.XpReward,
        badge_reward = challenge.BadgeId is { } badgeId
            && badgeSlugs.TryGetValue(badgeId, out var slug) ? slug : null,
        start_date = challenge.StartsAt.ToString("yyyy-MM-dd'T'HH:mm:ss.000000'Z'"),
        end_date = challenge.EndsAt.ToString("yyyy-MM-dd'T'HH:mm:ss.000000'Z'"),
        is_active = challenge.IsActive,
        created_at = challenge.CreatedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.000000'Z'")
    };

    private async Task<Dictionary<int, string>> BadgeSlugsAsync(IReadOnlyCollection<Challenge> rows)
    {
        var badgeIds = rows.Where(c => c.BadgeId.HasValue).Select(c => c.BadgeId!.Value)
            .Distinct().ToArray();
        if (badgeIds.Length == 0) return [];
        return await _db.Badges.AsNoTracking()
            .Where(b => badgeIds.Contains(b.Id))
            .ToDictionaryAsync(b => b.Id, b => b.Slug, HttpContext.RequestAborted);
    }

    private async Task<int?> ResolveBadgeIdAsync(string? badgeSlug)
    {
        if (string.IsNullOrWhiteSpace(badgeSlug)) return null;
        var id = await _db.Badges.AsNoTracking()
            .Where(b => b.Slug == badgeSlug)
            .Select(b => (int?)b.Id)
            .FirstOrDefaultAsync(HttpContext.RequestAborted);
        return id;
    }

    private static bool TryParseType(string value, out ChallengeType type)
    {
        type = value switch
        {
            "daily" => ChallengeType.Daily,
            "weekly" => ChallengeType.Weekly,
            "monthly" => ChallengeType.Monthly,
            "special" => ChallengeType.Special,
            _ => ChallengeType.Individual
        };
        return ChallengeTypes.Contains(value);
    }

    /// <summary>
    /// True when the incoming type is only the UI echoing back what
    /// <see cref="PresentType"/> rendered for a pre-parity row, rather than an
    /// admin genuinely choosing "special". Without this, saving any field on an
    /// Individual/Team/Community challenge silently converts it to Special.
    /// </summary>
    private static bool IsRenderedEchoOfLegacyType(ChallengeType stored, ChallengeType incoming)
        => incoming == ChallengeType.Special
            && stored is ChallengeType.Individual or ChallengeType.Team or ChallengeType.Community;

    private static string PresentType(ChallengeType type) => type switch
    {
        ChallengeType.Daily => "daily",
        ChallengeType.Weekly => "weekly",
        ChallengeType.Monthly => "monthly",
        ChallengeType.Special => "special",
        // Pre-parity rows (Individual/Team/Community) surface as special so
        // the admin UI's closed vocabulary always has a rendering.
        _ => "special"
    };

    private static bool HasKey(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out _);

    private static string? ReadString(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? ReadInt(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var parsed)) return parsed;
        return value.ValueKind == JsonValueKind.String
            && int.TryParse(value.GetString(), out var fromString) ? fromString : null;
    }

    private static bool? ReadBool(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => value.GetString() is "1" or "true" or "on" or "yes",
            JsonValueKind.Number => value.TryGetInt32(out var n) && n != 0,
            _ => null
        };
    }

    private static DateTime? ParseDate(string? value) =>
        DateTime.TryParse(value, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AdjustToUniversal
            | System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed : null;

    private async Task<IActionResult?> GateAsync()
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status401Unauthorized, new
            {
                errors = new[] { new { code = "auth_required", message = "Authentication required" } },
                success = false
            });
        }

        var user = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId.Value,
                HttpContext.RequestAborted);
        var allowed = user is not null
            && !OperationalRoles.Contains(user.Role)
            && (AdminRoles.Contains(user.Role)
                || user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod);
        if (!allowed)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[] { new { code = "forbidden", message = "Admin access required" } },
                success = false
            });
        }

        return null;
    }

    private IActionResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = (User.GetTenantId() ?? 0).ToString();
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(int status, string code, string message, string? field)
    {
        Response.Headers["API-Version"] = "2.0";
        if (field is null)
            return StatusCode(status, new { errors = new[] { new { code, message } } });
        return StatusCode(status, new { errors = new[] { new { code, message, field } } });
    }
}
