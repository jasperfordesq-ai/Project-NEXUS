// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Services;

namespace Nexus.Api.Middleware;

/// <summary>
/// Runs the two Laravel recurring-pattern feature gates before endpoint rate
/// limiting. This keeps disabled requests at 403 without consuming an action
/// bucket, matching VolunteerCommunityController's action order.
/// </summary>
public sealed class RecurringPatternFeatureGateMiddleware
{
    public const string PassedItemKey = "RecurringPatternFeatureGatePassed";

    private readonly RequestDelegate _next;

    public RecurringPatternFeatureGateMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(
        HttpContext context,
        ShiftManagementService shiftManagement)
    {
        var cancellationToken = context.RequestAborted;
        if (!IsCanonicalRecurringPatternRequest(context.Request.Path)
            || context.User.Identity?.IsAuthenticated != true
            || !int.TryParse(context.User.FindFirst("tenant_id")?.Value, out var tenantId))
        {
            await _next(context);
            return;
        }

        string? disabledMessage = null;
        if (!await shiftManagement.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            disabledMessage = "Volunteering module is not enabled for this community";
        }
        else if (!await shiftManagement.IsRecurringShiftsEnabledAsync(tenantId, cancellationToken))
        {
            disabledMessage = "This module is not enabled for this community.";
        }

        if (disabledMessage is null)
        {
            context.Items[PassedItemKey] = true;
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json";
        context.Response.Headers["API-Version"] = "2.0";
        context.Response.Headers["X-Tenant-ID"] = tenantId.ToString();
        await context.Response.WriteAsJsonAsync(new
        {
            errors = new[]
            {
                new { code = "FEATURE_DISABLED", message = disabledMessage }
            }
        }, cancellationToken);
    }

    private static bool IsCanonicalRecurringPatternRequest(PathString path) =>
        path.StartsWithSegments("/api/v2/volunteering")
        && path.Value?.Contains("/recurring-patterns", StringComparison.OrdinalIgnoreCase) == true;
}
