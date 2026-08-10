// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Group-exchange contract shared by the legacy /api path and Laravel React's
/// canonical /api/v2 path. Both routes execute the same tenant-safe service.
/// </summary>
[ApiController]
[Route("api/group-exchanges")]
[Route("api/v2/group-exchanges")]
public class GroupExchangeController : ControllerBase
{
    private readonly GroupExchangeService _service;

    public GroupExchangeController(GroupExchangeService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] int limit = 20,
        [FromQuery] int offset = 0,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var result = await _service.ListForUserAsync(
            userId.Value,
            status,
            Math.Clamp(limit, 1, 100),
            Math.Max(offset, 0),
            cancellationToken);

        return Ok(new
        {
            data = result.Items,
            meta = new { base_url = BaseUrl(), has_more = result.HasMore }
        });
    }

    [HttpPost]
    public async Task<IActionResult> Create(
        [FromBody] CreateGroupExchangeRequest? request,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        if (request == null || !HasPhpNonEmptyString(request.Title))
        {
            return Error("VALIDATION_ERROR", "Title is required", "title", StatusCodes.Status400BadRequest);
        }

        if (!request.TotalHours.HasValue || request.TotalHours.Value <= 0m)
        {
            return Error(
                "VALIDATION_ERROR",
                "Total hours must be greater than 0",
                "total_hours",
                StatusCodes.Status400BadRequest);
        }

        var participants = (request.Participants ?? Array.Empty<GroupExchangeParticipantRequest>())
            .Select(item => new GroupExchangeParticipantInput(
                item.UserId,
                item.Role ?? string.Empty,
                item.Hours ?? 0m,
                item.Weight ?? 1m))
            .ToArray();

        var result = await _service.CreateAsync(
            userId.Value,
            new CreateGroupExchangeInput(
                request.Title!,
                request.Description,
                request.Status,
                request.SplitType,
                request.TotalHours.Value,
                request.ListingId,
                request.BrokerId,
                request.BrokerNotes,
                participants),
            cancellationToken);

        if (!result.Success || !result.ExchangeId.HasValue)
        {
            return OperationError(
                result.ErrorCode,
                result.Error ?? "Failed to add participant (may already exist)");
        }

        var exchange = await _service.GetAsync(result.ExchangeId.Value, cancellationToken: cancellationToken);
        return exchange == null
            ? Error("INTERNAL_ERROR", "Failed to create exchange", null, StatusCodes.Status500InternalServerError)
            : StatusCode(StatusCodes.Status201Created, Data(exchange));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Show(int id, CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, includeCalculatedSplit: true, cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (!CanView(exchange, userId.Value))
        {
            return Error(
                "FORBIDDEN",
                "You do not have permission to view this exchange",
                null,
                StatusCodes.Status403Forbidden);
        }

        return Ok(Data(exchange));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(
        int id,
        [FromBody] UpdateGroupExchangeRequest? request,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (exchange.OrganizerId != userId.Value)
        {
            return Error("FORBIDDEN", "Only the organizer can update", null, StatusCodes.Status403Forbidden);
        }

        if (exchange.Status is "completed" or "cancelled")
        {
            return Error(
                "VALIDATION_ERROR",
                "Cannot update a completed or cancelled exchange",
                null,
                StatusCodes.Status400BadRequest);
        }

        request ??= new UpdateGroupExchangeRequest();
        bool updatedSuccessfully;
        try
        {
            updatedSuccessfully = await _service.UpdateAsync(
                id,
                new UpdateGroupExchangeInput(
                    request.Title,
                    request.Description,
                    request.SplitType,
                    request.TotalHours,
                    request.BrokerId,
                    request.BrokerNotes,
                    request.ListingId),
                cancellationToken);
        }
        catch (DbUpdateException)
        {
            return Error(
                "SERVER_ERROR",
                "An unexpected error occurred.",
                null,
                StatusCodes.Status500InternalServerError);
        }

        if (!updatedSuccessfully)
        {
            return Error(
                "VALIDATION_ERROR",
                "This exchange can no longer be updated.",
                null,
                StatusCodes.Status400BadRequest);
        }

        var updated = await _service.GetAsync(id, cancellationToken: cancellationToken);
        return Ok(Data(updated!));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Destroy(int id, CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (exchange.OrganizerId != userId.Value)
        {
            return Error("FORBIDDEN", "Only the organizer can cancel", null, StatusCodes.Status403Forbidden);
        }

        await _service.CancelAsync(id, cancellationToken);
        return Ok(Data(new { message = "Exchange cancelled" }));
    }

    [HttpPost("{id:int}/participants")]
    public async Task<IActionResult> AddParticipant(
        int id,
        [FromBody] GroupExchangeParticipantRequest? request,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (exchange.OrganizerId != userId.Value)
        {
            return Error("FORBIDDEN", "Only the organizer can update", null, StatusCodes.Status403Forbidden);
        }

        if (request == null || request.UserId <= 0 || !HasPhpNonEmptyString(request.Role))
        {
            return Error(
                "VALIDATION_ERROR",
                "user_id and role are required",
                null,
                StatusCodes.Status400BadRequest);
        }

        var result = await _service.AddParticipantAsync(
            id,
            userId.Value,
            new GroupExchangeParticipantInput(
                request.UserId,
                request.Role!,
                request.Hours ?? 0m,
                request.Weight ?? 1m),
            cancellationToken);

        if (!result.Success)
        {
            return OperationError(
                result.ErrorCode,
                result.Error ?? "Failed to add participant (may already exist)");
        }

        var updated = await _service.GetAsync(id, cancellationToken: cancellationToken);
        return Ok(Data(updated!));
    }

    [HttpDelete("{id:int}/participants/{userId:int}")]
    public async Task<IActionResult> RemoveParticipant(
        int id,
        [FromRoute(Name = "userId")] int participantUserId,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (exchange.OrganizerId != userId.Value)
        {
            return Error("FORBIDDEN", "Only the organizer can update", null, StatusCodes.Status403Forbidden);
        }

        await _service.RemoveParticipantAsync(id, userId.Value, participantUserId, cancellationToken);
        var updated = await _service.GetAsync(id, cancellationToken: cancellationToken);
        return Ok(Data(updated!));
    }

    [HttpPost("{id:int}/start")]
    public async Task<IActionResult> Start(int id, CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (exchange.OrganizerId != userId.Value)
        {
            return Error("FORBIDDEN", "Only the organizer can update", null, StatusCodes.Status403Forbidden);
        }

        var result = await _service.StartAsync(id, cancellationToken);
        if (!result.Success)
        {
            return OperationError(
                result.ErrorCode,
                result.Error ?? "This exchange cannot be started from its current status.");
        }

        var updated = await _service.GetAsync(id, cancellationToken: cancellationToken);
        return Ok(Data(updated!));
    }

    [HttpPost("{id:int}/confirm")]
    public async Task<IActionResult> Confirm(int id, CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (!exchange.Participants.Any(item => item.UserId == userId.Value))
        {
            return Error(
                "FORBIDDEN",
                "You must be a participant in this exchange",
                null,
                StatusCodes.Status403Forbidden);
        }

        var result = await _service.ConfirmParticipationAsync(id, userId.Value, cancellationToken);
        if (!result.Success)
        {
            return OperationError(
                result.ErrorCode,
                result.Error ?? "Failed to confirm participation");
        }

        var updated = await _service.GetAsync(id, cancellationToken: cancellationToken);
        return Ok(Data(updated!));
    }

    [HttpPost("{id:int}/complete")]
    public async Task<IActionResult> Complete(int id, CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue) return UnauthorizedError();

        var exchange = await _service.GetAsync(id, cancellationToken: cancellationToken);
        if (exchange == null)
        {
            return Error("NOT_FOUND", "Exchange not found.", null, StatusCodes.Status404NotFound);
        }

        if (exchange.OrganizerId != userId.Value)
        {
            return Error("FORBIDDEN", "Only the organizer can complete", null, StatusCodes.Status403Forbidden);
        }

        var result = await _service.CompleteAsync(id, cancellationToken);
        if (!result.Success)
        {
            return OperationError(
                result.ErrorCode,
                result.Error ?? "Exchange is already completed");
        }

        return Ok(Data(new
        {
            message = "Exchange completed",
            transaction_ids = result.TransactionIds
        }));
    }

    private object Data(object value) => new
    {
        data = value,
        meta = new { base_url = BaseUrl() }
    };

    private IActionResult Error(string code, string message, string? field, int status)
    {
        return StatusCode(status, new
        {
            errors = new[] { new GroupExchangeApiError(code, message, field) }
        });
    }

    private IActionResult OperationError(string? code, string message)
    {
        code ??= "VALIDATION_ERROR";
        var status = code switch
        {
            "SAFEGUARDING_POLICY_UNAVAILABLE" => StatusCodes.Status503ServiceUnavailable,
            "VETTING_REQUIRED" or "SAFEGUARDING_CONTACT_RESTRICTED" => StatusCodes.Status403Forbidden,
            "INTERNAL_ERROR" or "SERVER_ERROR" => StatusCodes.Status500InternalServerError,
            _ => StatusCodes.Status400BadRequest
        };
        return Error(code, message, null, status);
    }

    private IActionResult UnauthorizedError() => StatusCode(
        StatusCodes.Status401Unauthorized,
        new
        {
            success = false,
            error = "Authentication required",
            code = "AUTH_REQUIRED"
        });

    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}";

    private static bool HasPhpNonEmptyString(string? value) =>
        !string.IsNullOrEmpty(value) && value != "0";

    private static bool CanView(GroupExchangeDetail exchange, int userId) =>
        exchange.OrganizerId == userId || exchange.Participants.Any(item => item.UserId == userId);
}

public sealed class CreateGroupExchangeRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("status")]
    public string? Status { get; init; }

    [JsonPropertyName("split_type")]
    public string? SplitType { get; init; }

    [JsonPropertyName("total_hours")]
    public decimal? TotalHours { get; init; }

    [JsonPropertyName("listing_id")]
    public int? ListingId { get; init; }

    [JsonPropertyName("broker_id")]
    public int? BrokerId { get; init; }

    [JsonPropertyName("broker_notes")]
    public string? BrokerNotes { get; init; }

    [JsonPropertyName("participants")]
    public IReadOnlyCollection<GroupExchangeParticipantRequest>? Participants { get; init; }
}

public sealed class UpdateGroupExchangeRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("split_type")]
    public string? SplitType { get; init; }

    [JsonPropertyName("total_hours")]
    public decimal? TotalHours { get; init; }

    [JsonPropertyName("broker_id")]
    public int? BrokerId { get; init; }

    [JsonPropertyName("broker_notes")]
    public string? BrokerNotes { get; init; }

    [JsonPropertyName("listing_id")]
    public int? ListingId { get; init; }
}

public sealed class GroupExchangeParticipantRequest
{
    [JsonPropertyName("user_id")]
    public int UserId { get; init; }

    [JsonPropertyName("role")]
    public string? Role { get; init; }

    [JsonPropertyName("hours")]
    public decimal? Hours { get; init; }

    [JsonPropertyName("weight")]
    public decimal? Weight { get; init; }
}

public sealed record GroupExchangeApiError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("field")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Field);
