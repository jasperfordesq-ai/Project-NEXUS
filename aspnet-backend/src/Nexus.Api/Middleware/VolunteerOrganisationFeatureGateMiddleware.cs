// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Services;
using Nexus.Api.Extensions;

namespace Nexus.Api.Middleware;

/// <summary>
/// Runs Laravel's volunteering feature gate before member organisation and
/// hours action limiters so disabled requests do not consume action buckets.
/// </summary>
public sealed class VolunteerOrganisationFeatureGateMiddleware
{
    private readonly RequestDelegate _next;

    public VolunteerOrganisationFeatureGateMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(
        HttpContext context,
        VolunteerOrganisationService volunteerOrganisations)
    {
        if (!IsGatedRequest(context)
            || context.User.Identity?.IsAuthenticated != true
            || !int.TryParse(context.User.FindFirst("tenant_id")?.Value, out var tenantId))
        {
            await _next(context);
            return;
        }

        if (await volunteerOrganisations.IsFeatureEnabledAsync(tenantId, context.RequestAborted))
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json";
        context.Response.Headers["API-Version"] = "2.0";
        context.Response.Headers["X-Tenant-ID"] = tenantId.ToString();
        var adminHours = IsAdminVolunteerHoursRequest(context);
        await context.Response.WriteAsJsonAsync(new
        {
            errors = new[]
            {
                new
                {
                    code = "FEATURE_DISABLED",
                    message = adminHours
                        ? "Service unavailable"
                        : "Volunteering module is not enabled for this community"
                }
            }
        }, context.RequestAborted);
    }

    private static bool IsGatedRequest(HttpContext context)
    {
        var isCreate = VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Post,
                "api",
                "v2",
                "volunteering",
                "organisations")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Post,
                "api",
                "volunteering",
                "organisations");
        var isMyOrganisations = VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Get,
                "api",
                "v2",
                "volunteering",
                "my-organisations")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Get,
                "api",
                "volunteering",
                "my-organisations");
        var isOpportunityDelete = VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Delete,
                "api",
                "v2",
                "volunteering",
                "opportunities",
                "{int}")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Delete,
                "api",
                "volunteering",
                "opportunities",
                "{int}");
        var isMemberWallet = VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Get,
                "api",
                "v2",
                "volunteering",
                "organisations",
                "{int}",
                "wallet")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Get,
                "api",
                "volunteering",
                "organisations",
                "{int}",
                "wallet")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Get,
                "api",
                "v2",
                "volunteering",
                "organisations",
                "{int}",
                "wallet",
                "transactions")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Get,
                "api",
                "volunteering",
                "organisations",
                "{int}",
                "wallet",
                "transactions")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Post,
                "api",
                "v2",
                "volunteering",
                "organisations",
                "{int}",
                "wallet",
                "deposit")
            || VolunteerHoursRouteMatcher.IsRoute(
                context,
                HttpMethods.Post,
                "api",
                "volunteering",
                "organisations",
                "{int}",
                "wallet",
                "deposit");
        var isAdminWalletAdjustment = VolunteerHoursRouteMatcher.IsRoute(
            context,
            HttpMethods.Put,
            "api",
            "v2",
            "admin",
            "volunteering",
            "organizations",
            "{int}",
            "wallet",
            "adjust");
        var isVolunteerHours = VolunteerHoursRouteMatcher.IsMemberFeatureRoute(context);
        var isAdminVolunteerHours = VolunteerHoursRouteMatcher.IsAdminFeatureRoute(context)
            && context.User.IsAdmin();
        return isCreate
            || isMyOrganisations
            || isOpportunityDelete
            || isMemberWallet
            || isAdminWalletAdjustment
            || isVolunteerHours
            || isAdminVolunteerHours;
    }

    private static bool IsAdminVolunteerHoursRequest(HttpContext context)
    {
        return VolunteerHoursRouteMatcher.IsAdminFeatureRoute(context)
            && context.User.IsAdmin();
    }
}
