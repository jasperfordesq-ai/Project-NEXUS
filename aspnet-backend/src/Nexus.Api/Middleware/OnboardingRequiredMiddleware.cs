// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Middleware;

/// <summary>
/// Laravel-compatible settled-member gate for the canonical v2 wallet transfer.
/// It deliberately runs after authentication/authorization and before the
/// endpoint limiter so rejected onboarding requests do not consume transfer
/// attempts.
/// </summary>
public sealed class OnboardingRequiredMiddleware
{
    private readonly RequestDelegate _next;

    public OnboardingRequiredMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, NexusDbContext db)
    {
        if (!HttpMethods.IsPost(context.Request.Method)
            || !string.Equals(
                context.Request.Path.Value?.TrimEnd('/'),
                "/api/v2/wallet/transfer",
                StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var userId = context.User.GetUserId();
        var tenantId = context.User.GetTenantId();
        if (!userId.HasValue || !tenantId.HasValue)
        {
            await WriteErrorAsync(
                context,
                StatusCodes.Status401Unauthorized,
                "auth_required",
                "Authentication required");
            return;
        }

        var user = await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(row => row.Id == userId.Value
                && row.TenantId == tenantId.Value,
                context.RequestAborted);
        if (user is null)
        {
            await WriteErrorAsync(
                context,
                StatusCodes.Status401Unauthorized,
                "auth_required",
                "Authentication required");
            return;
        }

        if (user.IsAdmin
            || user.IsSuperAdmin
            || user.IsTenantSuperAdmin
            || user.IsGod
            || user.Role is "admin" or "tenant_admin" or "super_admin")
        {
            await _next(context);
            return;
        }

        var mandatoryValue = await db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId.Value
                && row.Key == "onboarding.mandatory")
            .Select(row => row.Value)
            .SingleOrDefaultAsync(context.RequestAborted);
        if (mandatoryValue is not null && IsFalse(mandatoryValue))
        {
            await _next(context);
            return;
        }

        var requiredStepIds = await db.Set<OnboardingStep>()
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(step => step.TenantId == tenantId.Value && step.IsRequired)
            .Select(step => step.Id)
            .ToArrayAsync(context.RequestAborted);
        if (requiredStepIds.Length == 0)
        {
            await _next(context);
            return;
        }

        var completedCount = await db.Set<OnboardingProgress>()
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(progress => progress.TenantId == tenantId.Value
                && progress.UserId == userId.Value
                && progress.IsCompleted
                && requiredStepIds.Contains(progress.StepId))
            .Select(progress => progress.StepId)
            .Distinct()
            .CountAsync(context.RequestAborted);
        if (completedCount >= requiredStepIds.Length)
        {
            await _next(context);
            return;
        }

        await WriteErrorAsync(
            context,
            StatusCodes.Status403Forbidden,
            "ONBOARDING_REQUIRED",
            "Please complete onboarding to access this resource");
    }

    private static async Task WriteErrorAsync(
        HttpContext context,
        int status,
        string code,
        string message)
    {
        context.Response.StatusCode = status;
        context.Response.Headers["API-Version"] = "2.0";
        var tenantId = context.User.GetTenantId();
        if (tenantId.HasValue)
            context.Response.Headers["X-Tenant-ID"] = tenantId.Value.ToString();
        await context.Response.WriteAsJsonAsync(new
        {
            errors = new[] { new { code, message } },
            success = false
        });
    }

    private static bool IsFalse(string value) =>
        value.Trim().ToLowerInvariant() is "0" or "false" or "off" or "no" or "disabled";
}
