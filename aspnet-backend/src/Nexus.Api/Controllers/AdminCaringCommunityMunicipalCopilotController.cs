// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/copilot/proposals")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityMunicipalCopilotController : ControllerBase
{
    private const int MaxDraftChars = 4000;
    private const int MaxReasonChars = 600;

    private readonly MunicipalCommunicationCopilotService _copilot;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityMunicipalCopilotController(
        MunicipalCommunicationCopilotService copilot,
        TenantContext tenant)
    {
        _copilot = copilot;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index([FromQuery] int? limit, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _copilot.ListProposalsAsync(_tenant.GetTenantIdOrThrow(), limit, ct);
        return Ok(new { data });
    }

    [HttpPost]
    public async Task<IActionResult> Generate(
        [FromBody] MunicipalCopilotGenerateRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var draft = (request.Draft ?? string.Empty).Trim();
        if (draft.Length == 0)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_REQUIRED", "Draft text is required.", "draft"));
        }

        if (draft.Length > MaxDraftChars)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_LENGTH",
                $"Draft must be {MaxDraftChars} characters or fewer.",
                "draft"));
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var proposal = await _copilot.GenerateProposalAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            draft,
            TruncateOptional(request.AudienceHint, 120),
            TruncateOptional(request.SubRegionId, 64),
            ct);

        return StatusCode(StatusCodes.Status201Created, new { data = new { proposal } });
    }

    [HttpPost("{proposalId}/accept")]
    public async Task<IActionResult> Accept(
        string proposalId,
        [FromBody] MunicipalCopilotAcceptRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (request.EditedPolishedText is not null && request.EditedPolishedText.Length > MaxDraftChars)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_LENGTH",
                $"Edited polished text must be {MaxDraftChars} characters or fewer.",
                "edited_polished_text"));
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var editedFields = new MunicipalCopilotAcceptFields(
            string.IsNullOrEmpty(request.EditedPolishedText) ? null : request.EditedPolishedText,
            TruncateOptional(request.EditedAudience, 120));

        var proposal = await _copilot.AcceptAndPublishAsync(
            _tenant.GetTenantIdOrThrow(),
            proposalId,
            editedFields.EditedPolishedText is null && editedFields.EditedAudience is null ? null : editedFields,
            userId.Value,
            ct);

        if (proposal is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "Proposal not found."));
        }

        return Ok(new
        {
            data = new
            {
                proposal,
                published = string.Equals(proposal.Status, "published", StringComparison.Ordinal)
            }
        });
    }

    [HttpPost("{proposalId}/reject")]
    public async Task<IActionResult> Reject(
        string proposalId,
        [FromBody] MunicipalCopilotRejectRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var reason = (request.Reason ?? string.Empty).Trim();
        if (reason.Length == 0)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_REQUIRED", "Rejection reason is required.", "reason"));
        }

        if (reason.Length > MaxReasonChars)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_LENGTH",
                $"Reason must be {MaxReasonChars} characters or fewer.",
                "reason"));
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var proposal = await _copilot.RejectProposalAsync(
            _tenant.GetTenantIdOrThrow(),
            proposalId,
            reason,
            userId.Value,
            ct);

        if (proposal is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "Proposal not found."));
        }

        return Ok(new { data = new { proposal } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _copilot.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FORBIDDEN", "Caring Community feature is not enabled for this tenant."));
        }

        return null;
    }

    private static string? TruncateOptional(string? raw, int maxLength)
    {
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };

        if (field is not null)
        {
            error["field"] = field;
        }

        return new { errors = new[] { error } };
    }
}
