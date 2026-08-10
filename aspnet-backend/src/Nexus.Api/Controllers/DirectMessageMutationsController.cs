// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Canonical Laravel direct-message edit and scoped-delete routes. The
/// application route convention also exposes these actions under /api/v2.
/// </summary>
[ApiController]
[Authorize]
[Route("api/messages")]
public sealed class DirectMessageMutationsController : ControllerBase
{
    private readonly DirectMessageMutationService _mutations;
    private readonly TenantContext _tenantContext;

    public DirectMessageMutationsController(
        DirectMessageMutationService mutations,
        TenantContext tenantContext)
    {
        _mutations = mutations;
        _tenantContext = tenantContext;
    }

    [HttpPut("{id:int}")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesEditPolicy)]
    public async Task<IActionResult> EditMessage(
        int id,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] DirectMessageEditRequest? request = null,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (userId == null)
        {
            return Unauthorized(new
            {
                errors = new[] { new { code = "AUTH_REQUIRED", message = "Authentication required" } }
            });
        }

        var body = request?.Body?.Trim() ?? string.Empty;
        if (body.Length == 0)
        {
            return MutationError(new(
                "VALIDATION_ERROR",
                "Message body is required",
                StatusCodes.Status400BadRequest,
                "body"));
        }

        if (body.EnumerateRunes().Count() > 10_000)
        {
            return MutationError(new(
                "VALIDATION_ERROR",
                "Message is too long (max 10000 characters)",
                StatusCodes.Status400BadRequest,
                "body"));
        }

        var outcome = await _mutations.EditAsync(
            _tenantContext.GetTenantIdOrThrow(),
            userId.Value,
            id,
            body,
            cancellationToken);
        if (outcome.Error != null)
        {
            return MutationError(outcome.Error);
        }

        if (outcome.SafeguardingDecision != null)
        {
            return SafeguardingError(outcome.SafeguardingDecision);
        }

        var result = outcome.Result!;
        return Ok(new
        {
            data = new
            {
                id = result.Id,
                body = result.Body,
                is_edited = true,
                sender_id = result.SenderId,
                created_at = result.CreatedAt
            },
            meta = new { base_url = BaseUrl() }
        });
    }

    [HttpDelete("{id:int}")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesDeletePolicy)]
    public async Task<IActionResult> DeleteMessage(
        int id,
        [FromQuery] string? scope,
        CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        if (userId == null)
        {
            return Unauthorized(new
            {
                errors = new[] { new { code = "AUTH_REQUIRED", message = "Authentication required" } }
            });
        }

        var resolvedScope = await ResolveDeleteScopeAsync(scope, cancellationToken);
        var outcome = await _mutations.DeleteAsync(
            _tenantContext.GetTenantIdOrThrow(),
            userId.Value,
            id,
            resolvedScope,
            cancellationToken);
        if (!outcome.Success)
        {
            return MutationError(outcome.Error!);
        }

        return Ok(new
        {
            data = new
            {
                success = true,
                message = "Message deleted"
            },
            meta = new { base_url = BaseUrl() }
        });
    }

    private async Task<DirectMessageDeleteScope> ResolveDeleteScopeAsync(
        string? queryScope,
        CancellationToken cancellationToken)
    {
        var value = queryScope;
        if (Request.ContentLength is > 0 || Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            try
            {
                using var body = await JsonDocument.ParseAsync(Request.Body, cancellationToken: cancellationToken);
                if (body.RootElement.ValueKind == JsonValueKind.Object
                    && body.RootElement.TryGetProperty("scope", out var property))
                {
                    // Laravel merges JSON request input ahead of query input.
                    // An explicit non-string/null body value therefore also
                    // shadows the query and falls through to the default.
                    value = property.ValueKind == JsonValueKind.String
                        ? property.GetString()
                        : null;
                }
            }
            catch (JsonException)
            {
                // A malformed JSON body contributes no Laravel request input,
                // so the query value (or the endpoint default) still applies.
            }
        }

        return string.Equals(value, "self", StringComparison.Ordinal)
            ? DirectMessageDeleteScope.Self
            : DirectMessageDeleteScope.Everyone;
    }

    private IActionResult MutationError(DirectMessageMutationError error)
    {
        var payload = new Dictionary<string, object?>
        {
            ["code"] = error.Code,
            ["message"] = error.Message
        };
        if (error.Field != null)
        {
            payload["field"] = error.Field;
        }

        return StatusCode(error.Status, new { errors = new[] { payload } });
    }

    private IActionResult SafeguardingError(SafeguardingInteractionDecision decision)
    {
        var status = decision.IsUnavailable
            ? StatusCodes.Status503ServiceUnavailable
            : StatusCodes.Status403Forbidden;
        return StatusCode(status, new { errors = new[] { BuildSafeguardingError(decision) } });
    }

    private static Dictionary<string, object?> BuildSafeguardingError(
        SafeguardingInteractionDecision decision)
    {
        var requiredCodes = decision.RequiredAttestationCodes?.ToArray() ?? [];
        var requiredLabels = decision.RequiredAttestationLabels?.ToArray() ?? [];
        if (decision.Code == "SAFEGUARDING_POLICY_UNAVAILABLE")
        {
            return new()
            {
                ["code"] = "SAFEGUARDING_POLICY_UNAVAILABLE",
                ["message"] = "We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.",
                ["title"] = "Safeguarding check temporarily unavailable",
                ["detail"] = "Project NEXUS could not safely evaluate the contact policy, so this interaction has been paused.",
                ["action_label"] = "Check again",
                ["required_vetting_types"] = requiredCodes,
                ["required_vetting_labels"] = requiredLabels,
                ["retryable"] = true
            };
        }

        if (decision.Code == "VETTING_REQUIRED")
        {
            var types = string.Join(", ", requiredLabels);
            return new()
            {
                ["code"] = "VETTING_REQUIRED",
                ["message"] = $"This conversation is paused by a community safeguarding rule. Your community must have recorded a current {types} confirmation for you before you can message this member. Ask your broker or community administrator to record this metadata-only status. Do not send or upload any vetting document.",
                ["title"] = "Safeguarding check needed",
                ["detail"] = $"This member can only be contacted for this type of interaction by members whose community has recorded a current {types} status. The record is metadata only; no document should be sent or uploaded.",
                ["action_label"] = "Open help",
                ["required_vetting_types"] = requiredCodes,
                ["required_vetting_labels"] = requiredLabels
            };
        }

        return new()
        {
            ["code"] = "SAFEGUARDING_CONTACT_RESTRICTED",
            ["message"] = "This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.",
            ["title"] = "Coordinator arrangement needed",
            ["detail"] = "This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact. You can ask a coordinator to help arrange contact.",
            ["action_label"] = "Open help"
        };
    }

    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
}

public sealed record DirectMessageEditRequest(
    [property: JsonPropertyName("body")] string? Body);
