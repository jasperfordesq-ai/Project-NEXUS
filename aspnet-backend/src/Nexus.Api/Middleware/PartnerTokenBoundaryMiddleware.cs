// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text.Json;

namespace Nexus.Api.Middleware;

/// <summary>
/// Prevents a partner client-credential JWT from being reused as a member JWT.
/// Partner endpoints perform their own persisted-token, scope, IP, sandbox and
/// rate checks; this middleware supplies the global route boundary.
/// </summary>
public sealed class PartnerTokenBoundaryMiddleware
{
    private readonly RequestDelegate _next;

    public PartnerTokenBoundaryMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var role = context.User.FindFirst("role")?.Value
            ?? context.User.FindFirst(ClaimTypes.Role)?.Value;
        if (context.User.Identity?.IsAuthenticated == true
            && string.Equals(role, "partner", StringComparison.Ordinal)
            && !context.Request.Path.StartsWithSegments("/api/partner/v1"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "partner_token_route_forbidden",
                        message = "Partner access tokens may only be used on /api/partner/v1 endpoints."
                    }
                }
            }));
            return;
        }

        await _next(context);
    }
}
