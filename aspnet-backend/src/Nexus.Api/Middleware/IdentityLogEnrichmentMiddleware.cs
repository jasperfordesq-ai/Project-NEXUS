// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Data;
using Serilog.Context;

namespace Nexus.Api.Middleware;

/// <summary>
/// Pushes tenant_id (from <see cref="TenantContext"/>) and user_id
/// (from JWT "sub" claim) onto the Serilog LogContext so every log entry
/// emitted while serving the request carries those properties.
///
/// MUST be registered after UseAuthentication / UseAuthorization AND after
/// <see cref="TenantResolutionMiddleware"/> so both values are available.
/// </summary>
public class IdentityLogEnrichmentMiddleware
{
    private readonly RequestDelegate _next;

    public IdentityLogEnrichmentMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, TenantContext tenantContext)
    {
        var tenantId = tenantContext.TenantId;
        var userId = context.User?.Identity?.IsAuthenticated == true
            ? context.User.FindFirst("sub")?.Value
            : null;

        // Always push both keys (with null sentinels when missing) so
        // downstream filters and dashboards see a consistent property shape.
        using (LogContext.PushProperty("tenant_id", tenantId))
        using (LogContext.PushProperty("user_id", userId))
        {
            await _next(context);
        }
    }
}
