// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Event attendance reward administration â€” Laravel parity for
/// AdminEventAttendanceRewardController. The reward config and retry are
/// behind the event_attendance_credits tenant feature; the claims ledger and
/// the reversal correction path deliberately are NOT â€” an audit trail and
/// the ability to correct must survive an incident kill of the flag.
/// </summary>
[ApiController]
[Authorize]
public class AdminEventAttendanceRewardsController : ControllerBase
{
    private static readonly string[] AdminRoles = ["admin", "tenant_admin", "super_admin", "god"];
    private static readonly string[] OperationalRoles = ["broker", "coordinator"];

    private readonly NexusDbContext _db;
    private readonly EventCreditService _credits;

    public AdminEventAttendanceRewardsController(NexusDbContext db, EventCreditService credits)
    {
        _db = db;
        _credits = credits;
    }

    [HttpGet("api/v2/admin/events/{id:int}/attendance-reward")]
    public async Task<IActionResult> Show(int id)
    {
        var gate = await GateAsync(requireFeature: true);
        if (gate is not null) return gate;

        var eventRow = await _db.Events.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == id, HttpContext.RequestAborted);
        if (eventRow is null) return LaravelError(404, "NOT_FOUND", "Event not found");

        return LaravelData(new
        {
            event_id = eventRow.Id,
            attendance_credit_amount = ToDouble(eventRow.AttendanceCreditAmount),
            ceiling = (double)_credits.Ceiling(),
            mode = await _credits.ModeAsync(HttpContext.RequestAborted),
            claims = await _credits.ClaimsRollupAsync(id, HttpContext.RequestAborted)
        });
    }

    [HttpPut("api/v2/admin/events/{id:int}/attendance-reward")]
    public async Task<IActionResult> Update(int id, [FromBody] JsonElement body)
    {
        var gate = await GateAsync(requireFeature: true);
        if (gate is not null) return gate;

        // Laravel: 'amount' => present|nullable|numeric|min:0|max:<ceiling>.
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("amount", out var raw))
        {
            return ValidationFailed("amount", "The amount field must be present.");
        }

        decimal? amount = raw.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.Number => raw.GetDecimal(),
            JsonValueKind.String when decimal.TryParse(raw.GetString(), out var parsed) => parsed,
            _ => decimal.MinValue
        };
        var ceiling = _credits.Ceiling();
        if (amount == decimal.MinValue || amount is < 0 || amount > ceiling)
        {
            return ValidationFailed("amount", $"The amount field must be between 0 and {ceiling}.");
        }

        var eventRow = await _db.Events
            .FirstOrDefaultAsync(e => e.Id == id, HttpContext.RequestAborted);
        if (eventRow is null) return LaravelError(404, "NOT_FOUND", "Event not found");

        // null or <= 0 clears the reward.
        eventRow.AttendanceCreditAmount = amount is null or <= 0 ? null : Math.Round(amount.Value, 2);
        eventRow.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return LaravelData(new
        {
            event_id = eventRow.Id,
            attendance_credit_amount = ToDouble(eventRow.AttendanceCreditAmount),
            ceiling = (double)ceiling
        });
    }

    /// <summary>Deliberately NOT feature-gated: the ledger must survive the flag.</summary>
    [HttpGet("api/v2/admin/events/attendance-claims")]
    public async Task<IActionResult> Claims(
        [FromQuery(Name = "event_id")] int? eventId,
        [FromQuery] string? status,
        [FromQuery(Name = "claim_type")] string? claimType,
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int perPage = 25)
    {
        var gate = await GateAsync(requireFeature: false);
        if (gate is not null) return gate;

        page = Math.Max(1, page);
        perPage = Math.Min(Math.Max(perPage, 1), 100);
        var query = _db.EventAttendanceCreditClaims.AsNoTracking().AsQueryable();
        if (eventId.HasValue) query = query.Where(c => c.EventId == eventId.Value);

        // 🔴 `from` and `to` were not even declared, so an admin narrowing this
        // ledger to a date range silently received the UNFILTERED list with no
        // error. This is a credits ledger: a wrong answer here is a wrong answer
        // about money. Laravel validates and applies both
        // (AdminEventAttendanceRewardController.php:136-137,162-167).
        //
        // An unparseable date is refused rather than ignored — silently dropping
        // a filter is exactly the failure being fixed.
        if (!string.IsNullOrWhiteSpace(from))
        {
            if (!DateTime.TryParse(from, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var fromUtc))
            {
                return ValidationFailed("from", "The from date is not a valid date.");
            }
            query = query.Where(c => c.CreatedAt >= fromUtc);
        }

        if (!string.IsNullOrWhiteSpace(to))
        {
            if (!DateTime.TryParse(to, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var toUtc))
            {
                return ValidationFailed("to", "The to date is not a valid date.");
            }
            // A bare date means the whole of that day, not midnight.
            if (toUtc.TimeOfDay == TimeSpan.Zero) toUtc = toUtc.AddDays(1).AddTicks(-1);
            query = query.Where(c => c.CreatedAt <= toUtc);
        }

        if (status is "pending" or "completed" or "failed" or "reversed")
            query = query.Where(c => c.Status == status);
        if (claimType is EventCreditService.TypeReward or EventCreditService.TypeReversal)
            query = query.Where(c => c.ClaimType == claimType);

        var total = await query.CountAsync(HttpContext.RequestAborted);
        var rows = await query
            .OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id)
            .Skip((page - 1) * perPage).Take(perPage)
            .ToListAsync(HttpContext.RequestAborted);

        var eventIds = rows.Select(r => r.EventId).Distinct().ToArray();
        var eventTitles = await _db.Events.AsNoTracking()
            .Where(e => eventIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Title, HttpContext.RequestAborted);
        var userIds = rows.Select(r => r.UserId).Distinct().ToArray();
        var memberNames = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id,
                u => ((u.FirstName + " " + u.LastName).Trim()), HttpContext.RequestAborted);

        return LaravelData(new
        {
            claims = rows.Select(c => (object)new
            {
                id = c.Id,
                event_id = c.EventId,
                event_title = eventTitles.TryGetValue(c.EventId, out var title) ? title : null,
                user_id = c.UserId,
                member_name = memberNames.TryGetValue(c.UserId, out var name)
                    && !string.IsNullOrEmpty(name) ? name : null,
                claim_type = c.ClaimType,
                amount = (double)c.Amount,
                status = c.Status,
                failure_code = c.FailureCode,
                reversal_code = c.ReversalCode,
                transaction_id = c.TransactionId,
                parent_claim_id = c.ParentClaimId,
                created_at = c.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss"),
                completed_at = c.CompletedAt?.ToString("yyyy-MM-dd HH:mm:ss"),
                failed_at = c.FailedAt?.ToString("yyyy-MM-dd HH:mm:ss"),
                reversed_at = c.ReversedAt?.ToString("yyyy-MM-dd HH:mm:ss")
            }).ToList(),
            pagination = new
            {
                page,
                per_page = perPage,
                total,
                total_pages = (int)Math.Ceiling(total / (double)perPage)
            }
        });
    }

    [HttpPost("api/v2/admin/events/attendance-claims/{claimId:long}/retry")]
    public async Task<IActionResult> Retry(long claimId)
    {
        var gate = await GateAsync(requireFeature: true);
        if (gate is not null) return gate;

        var outcome = await _credits.RetryClaimAsync(claimId, HttpContext.RequestAborted);
        return OutcomeResponse(outcome,
            notFoundMessage: "Attendance claim not found",
            conflictMessage: "This claim cannot be retried");
    }

    /// <summary>Deliberately NOT feature-gated: corrections must survive the flag.</summary>
    [HttpPost("api/v2/admin/events/attendance-claims/{claimId:long}/reverse")]
    public async Task<IActionResult> Reverse(long claimId, [FromBody] JsonElement? body)
    {
        var gate = await GateAsync(requireFeature: false);
        if (gate is not null) return gate;

        string? reason = null;
        if (body is { ValueKind: JsonValueKind.Object } payload
            && payload.TryGetProperty("reason", out var r)
            && r.ValueKind == JsonValueKind.String)
        {
            reason = r.GetString()?.Trim();
        }

        if (reason is null || reason.Length < 3 || reason.Length > 200)
        {
            return ValidationFailed("reason", "The reason field is required (3â€“200 characters).");
        }

        var outcome = await _credits.ReverseClaimAsync(
            claimId, User.GetUserId()!.Value, reason, HttpContext.RequestAborted);
        return OutcomeResponse(outcome,
            notFoundMessage: "Attendance claim not found",
            conflictMessage: "This claim cannot be reversed");
    }

    private IActionResult OutcomeResponse(
        EventCreditService.Outcome outcome, string notFoundMessage, string conflictMessage)
    {
        switch (outcome.Status)
        {
            case "not_found":
                return LaravelError(404, "NOT_FOUND", notFoundMessage);
            case "not_retryable":
            case "not_reversible":
                return LaravelError(409, "CONFLICT", conflictMessage);
            case "disabled":
                return LaravelError(409, "CONFLICT", "Attendance credits are switched off");
            default:
            {
                var data = new Dictionary<string, object?>
                {
                    ["status"] = outcome.Status,
                    ["claim_id"] = outcome.ClaimId,
                    ["transaction_id"] = outcome.TransactionId
                };
                // amount is omitted when null, exactly as Laravel's outcome().
                if (outcome.Amount is { } amount) data["amount"] = (double)amount;
                return LaravelData(data);
            }
        }
    }

    private async Task<IActionResult?> GateAsync(bool requireFeature)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null)
        {
            return StatusCode(StatusCodes.Status401Unauthorized,
                new { success = false, error = "Authentication required", code = "AUTH_REQUIRED" });
        }

        if (requireFeature)
        {
            var enabled = await _db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
                .Where(c => c.TenantId == tenantId.Value
                    && c.Key == "features.event_attendance_credits")
                .Select(c => c.Value)
                .FirstOrDefaultAsync(HttpContext.RequestAborted);
            if (enabled is null || enabled.Trim().Trim('"').ToLowerInvariant()
                    is not ("1" or "true" or "yes" or "on" or "enabled"))
            {
                Response.Headers["API-Version"] = "2.0";
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    errors = new[] { new
                    {
                        code = "FEATURE_DISABLED",
                        message = "Attendance rewards are not enabled for this community"
                    } }
                });
            }
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
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Admin access required",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
        }

        return null;
    }

    private static double? ToDouble(decimal? value) => value.HasValue ? (double)value.Value : null;

    private IActionResult ValidationFailed(string field, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(StatusCodes.Status422UnprocessableEntity, new
        {
            message,
            errors = new Dictionary<string, string[]> { [field] = [message] }
        });
    }

    private IActionResult LaravelData(object data)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = (User.GetTenantId() ?? 0).ToString();
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(int status, string code, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new { errors = new[] { new { code, message } } });
    }
}
