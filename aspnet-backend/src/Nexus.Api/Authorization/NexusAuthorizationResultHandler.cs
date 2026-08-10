// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace Nexus.Api.Authorization;

/// <summary>
/// Emits the canonical Laravel v2 authentication/authorization envelope for
/// policy failures that happen before a controller action executes.
/// Legacy non-v2 routes retain ASP.NET's default challenge/forbid behavior.
/// </summary>
public sealed class NexusAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _fallback = new();

    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Succeeded
            || !context.Request.Path.StartsWithSegments("/api/v2"))
        {
            await _fallback.HandleAsync(next, context, policy, authorizeResult);
            return;
        }

        var anonymous = authorizeResult.Challenged
            || context.User.Identity?.IsAuthenticated != true;
        var accessLevel = ResolveAccessLevel(policy, context.Request.Path.Value);
        var message = anonymous
            ? "Authentication required"
            : accessLevel switch
            {
                NexusAccessLevel.God => "God access required",
                NexusAccessLevel.PlatformSuperAdmin => "Super admin access required",
                NexusAccessLevel.TenantSuperAdminOrHigher => "Tenant super admin access required",
                NexusAccessLevel.BrokerOrAdmin => "Broker or admin access required",
                _ => "Admin access required"
            };

        context.Response.StatusCode = anonymous
            ? StatusCodes.Status401Unauthorized
            : StatusCodes.Status403Forbidden;
        context.Response.Headers["API-Version"] = "2.0";
        var tenantId = context.User.FindFirst("tenant_id")?.Value;
        if (!string.IsNullOrWhiteSpace(tenantId))
        {
            context.Response.Headers["X-Tenant-ID"] = tenantId;
        }
        await context.Response.WriteAsJsonAsync(new
        {
            errors = new[]
            {
                new
                {
                    code = anonymous ? "auth_required" : "forbidden",
                    message
                }
            },
            success = false
        });
    }

    private static NexusAccessLevel ResolveAccessLevel(AuthorizationPolicy policy, string? path)
    {
        var level = policy.Requirements
            .OfType<NexusUserAccessRequirement>()
            .Select(requirement => requirement.AccessLevel)
            .OrderByDescending(PrivilegeRank)
            .FirstOrDefault();

        return level == NexusAccessLevel.RouteAwareAdmin
            ? NexusRouteAccessResolver.Resolve(path)
            : level;
    }

    private static int PrivilegeRank(NexusAccessLevel level) => level switch
    {
        NexusAccessLevel.God => 6,
        NexusAccessLevel.PlatformSuperAdmin => 5,
        NexusAccessLevel.TenantSuperAdminOrHigher => 4,
        NexusAccessLevel.RouteAwareAdmin => 3,
        NexusAccessLevel.Admin => 2,
        NexusAccessLevel.BrokerOrAdmin => 1,
        _ => 0
    };
}
