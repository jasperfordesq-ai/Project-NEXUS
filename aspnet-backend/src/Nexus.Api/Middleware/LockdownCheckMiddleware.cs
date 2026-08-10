// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Caching.Memory;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Middleware;

/// <summary>
/// Middleware that checks if the platform is in emergency lockdown mode.
/// When active, returns 503 Service Unavailable for all non-admin, non-health requests.
/// Uses IMemoryCache with a 10-second TTL to avoid hitting the database on every request.
/// </summary>
public class LockdownCheckMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<LockdownCheckMiddleware> _logger;

    private const string CacheKey = "system.lockdown.active";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(10);

    public LockdownCheckMiddleware(RequestDelegate next, ILogger<LockdownCheckMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, IMemoryCache cache, LockdownService lockdownService)
    {
        var path = context.Request.Path.Value ?? "";

        // Always allow health endpoints
        if (path.StartsWith("/health", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // Privilege claims have already been rehydrated from the database by
        // JWT validation. Apply the same semantics as AdminOnly for both route aliases.
        var isAdminPath = path.StartsWith("/api/admin/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/v2/admin/", StringComparison.OrdinalIgnoreCase);
        if (isAdminPath)
        {
            if (context.User?.IsAdmin() == true)
            {
                await _next(context);
                return;
            }
            // Non-admin users hitting admin paths during lockdown fall through to lockdown check
        }

        // Check lockdown status (cached for 10 seconds)
        var isLocked = await cache.GetOrCreateAsync(CacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            return await lockdownService.IsLockdownActiveAsync();
        });

        if (isLocked == true)
        {
            _logger.LogWarning("Request blocked by lockdown: {Method} {Path}", context.Request.Method, path);

            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                error = "Service temporarily unavailable",
                message = "Platform is in emergency lockdown mode"
            });
            return;
        }

        await _next(context);
    }
}
