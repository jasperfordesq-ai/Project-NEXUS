// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Extensions;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
public class ShiftManagementController : ControllerBase
{
    private readonly ShiftManagementService _svc;

    public ShiftManagementController(ShiftManagementService svc) => _svc = svc;

    // ── Recurring Patterns ────────────────────────────────────────────────────

    [HttpGet("api/volunteering/opportunities/{opportunityId:int}/recurring-patterns")]
    [EnableRateLimiting(RateLimitingExtensions.RecurringPatternListPolicy)]
    public async Task<IActionResult> GetPatterns(
        int opportunityId,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        SetRecurringHeaders();
        if (await RecurringFeatureDisabledAsync(ct) is { } featureError) return featureError;

        try
        {
            var patterns = await _svc.GetPatternsAsync(opportunityId, ct);
            return Ok(new
            {
                data = new { patterns = patterns.Select(RecurringPatternPayload) },
                meta = RecurringMeta()
            });
        }
        catch (RecurringPatternContractException exception)
        {
            return RecurringPatternError(exception);
        }
    }

    [HttpPost("api/volunteering/opportunities/{opportunityId:int}/recurring-patterns")]
    [EnableRateLimiting(RateLimitingExtensions.RecurringPatternCreatePolicy)]
    public async Task<IActionResult> CreatePattern(
        int opportunityId,
        [FromBody] JsonElement body,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        SetRecurringHeaders();
        if (await RecurringFeatureDisabledAsync(ct) is { } featureError) return featureError;

        try
        {
            var pattern = await _svc.CreatePatternAsync(
                opportunityId,
                userId.Value,
                body,
                ct);
            return StatusCode(StatusCodes.Status201Created, new
            {
                data = RecurringPatternPayload(pattern),
                meta = RecurringMeta()
            });
        }
        catch (RecurringPatternContractException exception)
        {
            return RecurringPatternError(exception);
        }
    }

    [HttpPut("api/volunteering/recurring-patterns/{patternId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.RecurringPatternUpdatePolicy)]
    public async Task<IActionResult> UpdatePattern(
        int patternId,
        [FromBody] JsonElement body,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        SetRecurringHeaders();
        if (await RecurringFeatureDisabledAsync(ct) is { } featureError) return featureError;

        try
        {
            var pattern = await _svc.UpdatePatternAsync(
                patternId,
                userId.Value,
                body,
                ct);
            return Ok(new
            {
                data = RecurringPatternPayload(pattern),
                meta = RecurringMeta()
            });
        }
        catch (RecurringPatternContractException exception)
        {
            return RecurringPatternError(exception);
        }
    }

    [HttpDelete("api/volunteering/recurring-patterns/{patternId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.RecurringPatternDeletePolicy)]
    public async Task<IActionResult> DeactivatePattern(
        int patternId,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        SetRecurringHeaders();
        if (await RecurringFeatureDisabledAsync(ct) is { } featureError) return featureError;

        try
        {
            var removed = await _svc.DeactivatePatternAsync(patternId, userId.Value, ct);
            return Ok(new
            {
                data = new
                {
                    message = "Recurring pattern deactivated",
                    future_shifts_removed = removed
                },
                meta = RecurringMeta()
            });
        }
        catch (RecurringPatternContractException exception)
        {
            return RecurringPatternError(exception);
        }
    }

    // ── Shift Swaps ───────────────────────────────────────────────────────────

    [HttpGet("api/volunteering/swaps")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerSwapListPolicy)]
    public async Task<IActionResult> GetSwaps(
        [FromQuery] string direction = "all",
        CancellationToken ct = default)
    {
        SetSwapHeaders();
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var swaps = await _svc.GetSwapRequestsAsync(userId.Value, direction);
        if (!IsCanonicalV2) return Ok(swaps);
        return Ok(new
        {
            data = swaps.Select(swap => SwapPayload(swap, userId.Value, includeDirection: true)),
            meta = Meta(swaps.Count)
        });
    }

    [HttpPost("api/volunteering/swaps")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerSwapRequestPolicy)]
    public async Task<IActionResult> RequestSwap(
        [FromBody] SwapRequest req,
        CancellationToken ct = default)
    {
        SetSwapHeaders();
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var (swap, error) = await _svc.RequestSwapAsync(userId.Value, req);
        if (error != null) return SwapWorkflowError(error);
        if (!IsCanonicalV2) return CreatedAtAction(nameof(GetSwaps), swap);
        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = swap!.Id,
                message = "Shift swap request sent"
            },
            meta = Meta()
        });
    }

    [HttpPut("api/volunteering/swaps/{swapId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerSwapRespondPolicy)]
    public async Task<IActionResult> RespondToSwap(
        int swapId,
        [FromBody] RespondSwapDto dto,
        CancellationToken ct = default)
    {
        SetSwapHeaders();
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var decision = dto.Decision;
        if (!decision.HasValue)
            return SwapActionError("Action must be accept or reject");
        var (swap, error) = await _svc.RespondToSwapAsync(swapId, userId.Value, decision.Value);
        if (error != null) return SwapWorkflowError(error);
        if (!IsCanonicalV2) return Ok(swap);
        return Ok(new
        {
            data = new
            {
                id = swap!.Id,
                status = swap.Status,
                message = swap.Status == "admin_pending"
                    ? "Shift swap accepted and awaiting administrator approval"
                    : null
            },
            meta = Meta()
        });
    }

    [HttpDelete("api/volunteering/swaps/{swapId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerSwapCancelPolicy)]
    public async Task<IActionResult> CancelSwap(
        int swapId,
        CancellationToken ct = default)
    {
        SetSwapHeaders();
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var error = await _svc.CancelSwapAsync(swapId, userId.Value);
        if (error != null) return SwapWorkflowError(error);
        return NoContent();
    }

    // ── Waitlist ──────────────────────────────────────────────────────────────

    [HttpGet("api/volunteering/my-waitlists")]
    public async Task<IActionResult> GetMyWaitlists(CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var entries = await _svc.GetUserWaitlistsAsync(userId.Value, ct);
        if (!IsCanonicalV2) return Ok(entries);

        return Ok(new
        {
            data = entries.Select(entry => new
            {
                id = entry.Id,
                position = entry.Position,
                status = entry.Status,
                notified_at = entry.NotifiedAt,
                shift = new
                {
                    id = entry.Shift.Id,
                    start_time = entry.Shift.StartsAt,
                    end_time = entry.Shift.EndsAt,
                    capacity = entry.Shift.Capacity
                },
                opportunity = new
                {
                    id = entry.Opportunity.Id,
                    title = entry.Opportunity.Title,
                    location = entry.Opportunity.Location
                },
                organization = new { id = 0, name = string.Empty, logo_url = (string?)null },
                joined_at = entry.JoinedAt
            }),
            meta = Meta(entries.Count)
        });
    }

    [HttpPost("api/volunteering/shifts/{shiftId:int}/waitlist")]
    public async Task<IActionResult> JoinWaitlist(int shiftId, CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var (entry, error) = await _svc.JoinWaitlistAsync(shiftId, userId.Value, ct);
        if (error != null) return WorkflowError(error);
        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = entry!.Id,
                position = entry.Position,
                message = "Joined waitlist"
            },
            meta = IsCanonicalV2 ? Meta() : null
        });
    }

    [HttpDelete("api/volunteering/shifts/{shiftId:int}/waitlist")]
    public async Task<IActionResult> LeaveWaitlist(int shiftId, CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var error = await _svc.LeaveWaitlistAsync(shiftId, userId.Value, ct);
        if (error != null) return WorkflowError(error);
        return NoContent();
    }

    [HttpPost("api/volunteering/shifts/{shiftId:int}/waitlist/promote")]
    public async Task<IActionResult> PromoteFromWaitlist(int shiftId, CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var (entry, error) = await _svc.PromoteFromWaitlistAsync(shiftId, userId.Value, ct);
        if (error != null) return WorkflowError(error);
        return Ok(new
        {
            data = new
            {
                id = entry!.Id,
                shift_id = entry.ShiftId,
                message = "Claimed spot"
            },
            meta = IsCanonicalV2 ? Meta() : null
        });
    }

    // ── Group Reservations ────────────────────────────────────────────────────

    [HttpGet("api/volunteering/group-reservations")]
    public async Task<IActionResult> GetGroupReservations(CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var reservations = await _svc.GetUserGroupReservationsAsync(userId.Value, ct);
        if (!IsCanonicalV2) return Ok(reservations);

        return Ok(new
        {
            data = reservations.Select(reservation => new
            {
                id = reservation.Id,
                group_name = reservation.GroupName,
                status = reservation.Status,
                is_leader = reservation.IsLeader,
                shift = new
                {
                    id = reservation.Shift.Id,
                    start_time = reservation.Shift.StartsAt,
                    end_time = reservation.Shift.EndsAt
                },
                opportunity = new
                {
                    id = reservation.Opportunity.Id,
                    title = reservation.Opportunity.Title,
                    location = reservation.Opportunity.Location
                },
                organization = new { id = 0, name = string.Empty, logo_url = (string?)null },
                members = reservation.Members.Select(member => new
                {
                    id = member.Id,
                    name = member.Name,
                    avatar_url = member.AvatarUrl,
                    status = member.Status,
                    created_at = member.CreatedAt
                }),
                max_members = reservation.MaxMembers,
                created_at = reservation.CreatedAt
            }),
            meta = Meta(reservations.Count)
        });
    }

    [HttpPost("api/volunteering/shifts/{shiftId:int}/group-reserve")]
    public async Task<IActionResult> CreateGroupReservation(
        int shiftId,
        [FromBody] GroupReservationRequest req,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        if (IsCanonicalV2 && req.GroupId <= 0)
            return WorkflowError("Group ID is required", "group_id");
        var (reservation, error) = await _svc.CreateGroupReservationAsync(shiftId, userId.Value, req);
        if (error != null) return WorkflowError(error);
        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = reservation!.Id,
                message = $"Reserved {reservation.ReservedSlots} slots"
            },
            meta = IsCanonicalV2 ? Meta() : null
        });
    }

    [HttpPost("api/volunteering/group-reservations/{reservationId:int}/members")]
    public async Task<IActionResult> AddGroupMember(
        int reservationId,
        [FromBody] AddGroupMemberRequest req,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        if (IsCanonicalV2 && req.UserId <= 0)
            return WorkflowError("User ID is required", "user_id");
        var (member, error) = await _svc.AddGroupMemberAsync(reservationId, userId.Value, req);
        if (error != null) return WorkflowError(error);
        return Ok(new
        {
            data = new
            {
                id = member!.Id,
                user_id = member.UserId,
                message = "Member added to reservation"
            },
            meta = IsCanonicalV2 ? Meta() : null
        });
    }

    [HttpDelete("api/volunteering/group-reservations/{reservationId:int}/members/{userId:int}")]
    public async Task<IActionResult> RemoveGroupMember(
        int reservationId,
        int userId,
        CancellationToken ct = default)
    {
        var leaderUserId = User.GetUserId();
        if (leaderUserId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var error = await _svc.RemoveGroupMemberAsync(
            reservationId,
            userId,
            leaderUserId.Value,
            identifierIsLegacyMemberId: !IsCanonicalV2,
            ct: ct);
        if (error != null) return WorkflowError(error);
        return NoContent();
    }

    [HttpDelete("api/volunteering/group-reservations/{reservationId:int}")]
    public async Task<IActionResult> CancelGroupReservation(
        int reservationId,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return AuthError();
        if (await FeatureDisabledAsync(ct) is { } featureError) return featureError;
        var error = await _svc.CancelGroupReservationAsync(reservationId, userId.Value);
        if (error != null) return WorkflowError(error);
        return NoContent();
    }

    private static object RecurringPatternPayload(RecurringPatternView pattern) => new
    {
        id = pattern.Id,
        opportunity_id = pattern.OpportunityId,
        title = pattern.Title,
        frequency = pattern.Frequency,
        days_of_week = pattern.DaysOfWeek,
        start_time = pattern.StartTime.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
        end_time = pattern.EndTime.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
        spots_per_shift = pattern.SpotsPerShift,
        capacity = pattern.Capacity,
        start_date = pattern.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        end_date = pattern.EndDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        max_occurrences = pattern.MaxOccurrences,
        occurrences_generated = pattern.OccurrencesGenerated,
        is_active = pattern.IsActive,
        created_by = pattern.CreatedBy,
        created_by_name = pattern.CreatedByName,
        created_at = pattern.CreatedAt,
        updated_at = pattern.UpdatedAt
    };

    private object RecurringMeta() => new
    {
        base_url = $"{Request.Scheme}://{Request.Host}"
    };

    private void SetRecurringHeaders()
    {
        if (!IsCanonicalV2)
        {
            return;
        }

        Response.Headers["API-Version"] = "2.0";
        var tenantId = User.FindFirst("tenant_id")?.Value;
        if (!string.IsNullOrWhiteSpace(tenantId))
        {
            Response.Headers["X-Tenant-ID"] = tenantId;
        }
    }

    private void SetSwapHeaders() => SetRecurringHeaders();

    private async Task<IActionResult?> RecurringFeatureDisabledAsync(CancellationToken ct)
    {
        if (!IsCanonicalV2)
        {
            return null;
        }

        if (HttpContext.Items.ContainsKey(RecurringPatternFeatureGateMiddleware.PassedItemKey))
        {
            return null;
        }

        if (!await _svc.IsVolunteeringEnabledAsync(ct))
        {
            return RecurringFeatureError(
                "Volunteering module is not enabled for this community");
        }

        if (!await _svc.IsRecurringShiftsEnabledAsync(ct))
        {
            return RecurringFeatureError(
                "This module is not enabled for this community.");
        }

        return null;
    }

    private IActionResult RecurringFeatureError(string message) =>
        StatusCode(StatusCodes.Status403Forbidden, new
        {
            errors = new[]
            {
                new
                {
                    code = "FEATURE_DISABLED",
                    message
                }
            }
        });

    private IActionResult RecurringPatternError(RecurringPatternContractException exception)
    {
        var statusCode = exception.Code switch
        {
            "NOT_FOUND" => StatusCodes.Status404NotFound,
            "FORBIDDEN" or "FEATURE_DISABLED" => StatusCodes.Status403Forbidden,
            _ => StatusCodes.Status400BadRequest
        };
        return StatusCode(statusCode, new
        {
            errors = new[]
            {
                new { code = exception.Code, message = exception.Message }
            }
        });
    }

    private bool IsCanonicalV2 => Request.Path.StartsWithSegments("/api/v2");

    private async Task<IActionResult?> FeatureDisabledAsync(CancellationToken ct)
    {
        if (!IsCanonicalV2 || await _svc.IsVolunteeringEnabledAsync(ct))
        {
            return null;
        }

        return StatusCode(StatusCodes.Status403Forbidden, new
        {
            errors = new[]
            {
                new
                {
                    code = "FEATURE_DISABLED",
                    message = "Volunteering module is not enabled for this community"
                }
            }
        });
    }

    private IActionResult AuthError() => IsCanonicalV2
        ? StatusCode(StatusCodes.Status401Unauthorized, new
        {
            errors = new[] { new { code = "UNAUTHORIZED", message = "Invalid token" } }
        })
        : Unauthorized(new { error = "Invalid token" });

    private IActionResult WorkflowError(string message, string? field = null)
    {
        if (!IsCanonicalV2)
        {
            return BadRequest(new { error = message });
        }

        var (code, statusCode, inferredField) = ClassifyError(message);
        return StatusCode(statusCode, new
        {
            errors = new[]
            {
                new
                {
                    code,
                    message,
                    field = field ?? inferredField
                }
            }
        });
    }

    private IActionResult SwapActionError(string message) => IsCanonicalV2
        ? StatusCode(StatusCodes.Status400BadRequest, new
        {
            errors = new[]
            {
                new { code = "VALIDATION_ERROR", message, field = "action" }
            }
        })
        : BadRequest(new { error = message });

    private IActionResult SwapWorkflowError(string message)
    {
        if (!IsCanonicalV2)
        {
            return BadRequest(new { error = message });
        }

        var (statusCode, code) = message switch
        {
            "Swap request not found" or
            "Swap request not found or already processed" or
            "Swap request not found or not cancellable" or
            "Shift not found" => (StatusCodes.Status404NotFound, "NOT_FOUND"),
            "Not authorized" or
            "You are not assigned to this shift" =>
                (StatusCodes.Status403Forbidden, "FORBIDDEN"),
            "A matching swap request is already pending" =>
                (StatusCodes.Status409Conflict, "ALREADY_EXISTS"),
            _ when message.StartsWith("Failed to ", StringComparison.Ordinal) =>
                (StatusCodes.Status500InternalServerError, "SERVER_ERROR"),
            _ => (StatusCodes.Status400BadRequest, "VALIDATION_ERROR")
        };
        return StatusCode(statusCode, new
        {
            errors = new[] { new { code, message } }
        });
    }

    private static (string Code, int StatusCode, string? Field) ClassifyError(string message)
    {
        if (message == VolunteerGuardianConsentService.RequiredMessage)
        {
            return (
                VolunteerGuardianConsentService.RequiredCode,
                StatusCodes.Status403Forbidden,
                null);
        }

        if (message is "Shift not found"
            or "Opportunity not found or is not active"
            or "Waitlist entry not found"
            or "You are not on the waitlist for this shift"
            or "Group not found"
            or "Reservation not found"
            or "Member not found in this reservation"
            or "Swap request not found"
            or "Swap request not found or already processed"
            or "Swap request not found or not cancellable")
        {
            return ("NOT_FOUND", StatusCodes.Status404NotFound, null);
        }

        if (message is "You must have an approved application to sign up for shifts"
            or "Only group leaders/admins can reserve slots for this group"
            or "Only group leaders/admins can manage this reservation"
            or "Only group leaders/admins can cancel this reservation"
            or "You are not assigned to this shift"
            or "Not authorized")
        {
            return ("FORBIDDEN", StatusCodes.Status403Forbidden, null);
        }

        if (message is "You are already on the waitlist for this shift"
            or "You are already signed up for this shift"
            or "This group already has a reservation for this shift"
            or "User is already in this group reservation"
            or "A matching swap request is already pending")
        {
            return ("ALREADY_EXISTS", StatusCodes.Status409Conflict, null);
        }

        if (message.StartsWith("Failed to ", StringComparison.Ordinal)
            || message.StartsWith("Could not ", StringComparison.Ordinal))
        {
            return ("SERVER_ERROR", StatusCodes.Status500InternalServerError, null);
        }

        var inferredField = message switch
        {
            "Group ID is required" => "group_id",
            "User ID is required" or "Invalid user" => "user_id",
            "Must reserve at least 1 slot" => "reserved_slots",
            _ when message.StartsWith("Only ", StringComparison.Ordinal)
                && message.EndsWith(" slots available", StringComparison.Ordinal) => "reserved_slots",
            _ => null
        };
        return ("VALIDATION_ERROR", StatusCodes.Status422UnprocessableEntity, inferredField);
    }

    private object Meta(int? total = null) => new
    {
        base_url = $"{Request.Scheme}://{Request.Host}",
        total
    };

    internal static object SwapPayload(
        ShiftSwapRequest swap,
        int viewerUserId,
        bool includeDirection)
    {
        var fromShift = swap.FromShift!;
        var toShift = swap.ToShift!;
        var payload = new Dictionary<string, object?>
        {
            ["id"] = swap.Id,
            ["status"] = swap.Status,
            ["message"] = swap.Message,
            ["requires_admin_approval"] = swap.RequiresAdminApproval,
            ["requester"] = new
            {
                id = swap.FromUserId,
                name = UserName(swap.FromUser),
                avatar_url = swap.FromUser?.AvatarUrl
            },
            ["recipient"] = new
            {
                id = swap.ToUserId,
                name = UserName(swap.ToUser),
                avatar_url = swap.ToUser?.AvatarUrl
            },
            ["original_shift"] = new
            {
                id = fromShift.Id,
                start_time = fromShift.StartsAt,
                end_time = fromShift.EndsAt,
                opportunity_title = fromShift.Opportunity?.Title,
                organization_name = fromShift.Opportunity?.VolunteerOrganisation?.Name
            },
            ["proposed_shift"] = new
            {
                id = toShift.Id,
                start_time = toShift.StartsAt,
                end_time = toShift.EndsAt,
                opportunity_title = toShift.Opportunity?.Title,
                organization_name = toShift.Opportunity?.VolunteerOrganisation?.Name
            },
            ["created_at"] = swap.CreatedAt
        };
        if (includeDirection)
        {
            payload["direction"] = swap.FromUserId == viewerUserId ? "sent" : "received";
        }

        return payload;
    }

    private static string UserName(User? user) => user is null
        ? string.Empty
        : (user.FirstName + " " + user.LastName).Trim();
}

public sealed record RespondSwapDto(
    [property: JsonPropertyName("action")] string? Action,
    [property: JsonPropertyName("accept")] bool? Accept)
{
    public bool? Decision => Action?.Trim().ToLowerInvariant() switch
    {
        "accept" => true,
        "reject" => false,
        null when Accept.HasValue => Accept.Value,
        _ => null
    };
}
