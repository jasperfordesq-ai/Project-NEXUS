// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Nexus.Api.Middleware;

/// <summary>
/// Mirrors Laravel FormRequest ordering for the two member volunteer-hours
/// mutations. Laravel validates these request bodies before the controller's
/// feature gate and action throttle, so invalid requests must neither become a
/// feature error nor consume the named mutation bucket.
/// </summary>
public sealed class VolunteerHoursMutationValidationMiddleware
{
    private readonly RequestDelegate _next;

    public VolunteerHoursMutationValidationMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var requestKind = RequestKind(context);
        if (requestKind == VolunteerHoursRequestKind.None
            || context.User.Identity?.IsAuthenticated != true)
        {
            await _next(context);
            return;
        }

        context.Request.EnableBuffering();
        string rawBody;
        using (var reader = new StreamReader(
            context.Request.Body,
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: false,
            leaveOpen: true))
        {
            rawBody = await reader.ReadToEndAsync(context.RequestAborted);
        }
        context.Request.Body.Position = 0;

        JsonElement payload = default;
        JsonDocument? document = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(rawBody))
            {
                document = JsonDocument.Parse(rawBody);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                    payload = document.RootElement;
            }

            var errors = requestKind == VolunteerHoursRequestKind.Log
                ? ValidateLog(payload)
                : ValidateVerify(payload);
            if (errors.Count == 0)
            {
                await _next(context);
                return;
            }

            context.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;
            context.Response.ContentType = "application/json";
            context.Response.Headers["API-Version"] = "2.0";
            var tenantId = context.User.FindFirst("tenant_id")?.Value;
            if (!string.IsNullOrWhiteSpace(tenantId))
                context.Response.Headers["X-Tenant-ID"] = tenantId;
            await context.Response.WriteAsJsonAsync(new { errors }, context.RequestAborted);
        }
        catch (JsonException)
        {
            var errors = requestKind == VolunteerHoursRequestKind.Log
                ? RequiredLogErrors()
                : new[] { Error("The action field is required.", "action") };
            context.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;
            context.Response.ContentType = "application/json";
            context.Response.Headers["API-Version"] = "2.0";
            var tenantId = context.User.FindFirst("tenant_id")?.Value;
            if (!string.IsNullOrWhiteSpace(tenantId))
                context.Response.Headers["X-Tenant-ID"] = tenantId;
            await context.Response.WriteAsJsonAsync(new { errors }, context.RequestAborted);
        }
        finally
        {
            document?.Dispose();
            if (context.Request.Body.CanSeek)
                context.Request.Body.Position = 0;
        }
    }

    private static List<object> ValidateLog(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
            return RequiredLogErrors().ToList();

        var errors = new List<object>();
        if (!payload.TryGetProperty("organization_id", out var organisation)
            || IsEmpty(organisation))
        {
            errors.Add(Error("The organization id field is required.", "organization_id"));
        }
        else if (!IsInteger(organisation))
        {
            errors.Add(Error("The organization id field must be an integer.", "organization_id"));
        }

        if (payload.TryGetProperty("opportunity_id", out var opportunity)
            && !IsEmpty(opportunity)
            && !IsInteger(opportunity))
        {
            errors.Add(Error("The opportunity id field must be an integer.", "opportunity_id"));
        }

        if (!payload.TryGetProperty("date", out var date) || IsEmpty(date))
        {
            errors.Add(Error("The date field is required.", "date"));
        }
        else if (!TryDate(date, out var parsedDate))
        {
            errors.Add(Error("The date field must be a valid date.", "date"));
        }
        else if (parsedDate > DateOnly.FromDateTime(DateTime.Now))
        {
            errors.Add(Error("The date field must be a date before or equal to today.", "date"));
        }

        if (!payload.TryGetProperty("hours", out var hours) || IsEmpty(hours))
        {
            errors.Add(Error("The hours field is required.", "hours"));
        }
        else if (!TryDecimal(hours, out var parsedHours))
        {
            errors.Add(Error("The hours field must be a number.", "hours"));
        }
        else
        {
            if (parsedHours < 0.25m)
                errors.Add(Error("The hours field must be at least 0.25.", "hours"));
            if (parsedHours > 24m)
                errors.Add(Error("The hours field must not be greater than 24.", "hours"));
        }

        if (payload.TryGetProperty("description", out var description)
            && !IsEmpty(description))
        {
            if (description.ValueKind != JsonValueKind.String)
            {
                errors.Add(Error("The description field must be a string.", "description"));
            }
            else if ((description.GetString()?.Length ?? 0) > 1000)
            {
                errors.Add(Error(
                    "The description field must not be greater than 1000 characters.",
                    "description"));
            }
        }

        return errors;
    }

    private static List<object> ValidateVerify(JsonElement payload)
    {
        var errors = new List<object>();
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty("action", out var action)
            || IsEmpty(action))
        {
            errors.Add(Error("The action field is required.", "action"));
        }
        else if (action.ValueKind != JsonValueKind.String
            || action.GetString() is not ("approve" or "decline"))
        {
            errors.Add(Error("The selected action is invalid.", "action"));
        }

        return errors;
    }

    private static object[] RequiredLogErrors() =>
    [
        Error("The organization id field is required.", "organization_id"),
        Error("The date field is required.", "date"),
        Error("The hours field is required.", "hours")
    ];

    private static object Error(string message, string field) => new
    {
        code = "VALIDATION_ERROR",
        message,
        field
    };

    private static bool IsEmpty(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
        || (element.ValueKind == JsonValueKind.String
            && string.IsNullOrWhiteSpace(element.GetString()));

    private static bool IsInteger(JsonElement element) =>
        element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out _)
        || element.ValueKind == JsonValueKind.String
            && int.TryParse(
                element.GetString(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out _);

    private static bool TryDecimal(JsonElement element, out decimal value)
    {
        if (element.ValueKind == JsonValueKind.Number)
            return element.TryGetDecimal(out value);
        if (element.ValueKind == JsonValueKind.String)
        {
            return decimal.TryParse(
                element.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out value);
        }

        value = default;
        return false;
    }

    private static bool TryDate(JsonElement element, out DateOnly value)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            return DateOnly.TryParse(
                element.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces,
                out value);
        }

        value = default;
        return false;
    }

    private static VolunteerHoursRequestKind RequestKind(HttpContext context)
    {
        if (VolunteerHoursRouteMatcher.IsMemberLog(context))
            return VolunteerHoursRequestKind.Log;

        return VolunteerHoursRouteMatcher.IsMemberVerify(context)
            ? VolunteerHoursRequestKind.Verify
            : VolunteerHoursRequestKind.None;
    }

    private enum VolunteerHoursRequestKind
    {
        None,
        Log,
        Verify
    }
}

/// <summary>
/// Mirrors the admin controller's Laravel validation after the volunteering
/// feature gate. The dedicated stage is required because this route does not
/// use a Laravel FormRequest: a disabled tenant receives FEATURE_DISABLED even
/// when the JSON body is malformed, while an enabled tenant receives the
/// canonical 400 errors envelope before ASP.NET's input formatter can emit
/// ValidationProblemDetails.
/// </summary>
public sealed class AdminVolunteerHoursMutationValidationMiddleware
{
    private readonly RequestDelegate _next;

    public AdminVolunteerHoursMutationValidationMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!VolunteerHoursRouteMatcher.IsAdminVerify(context)
            || context.User.Identity?.IsAuthenticated != true)
        {
            await _next(context);
            return;
        }

        context.Request.EnableBuffering();
        string rawBody;
        using (var reader = new StreamReader(
            context.Request.Body,
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: false,
            leaveOpen: true))
        {
            rawBody = await reader.ReadToEndAsync(context.RequestAborted);
        }

        var valid = false;
        try
        {
            if (!string.IsNullOrWhiteSpace(rawBody))
            {
                using var document = JsonDocument.Parse(rawBody);
                valid = document.RootElement.ValueKind == JsonValueKind.Object
                    && document.RootElement.TryGetProperty("action", out var action)
                    && action.ValueKind == JsonValueKind.String
                    && action.GetString() is "approve" or "decline";
            }
        }
        catch (JsonException)
        {
            valid = false;
        }
        finally
        {
            if (context.Request.Body.CanSeek)
                context.Request.Body.Position = 0;
        }

        if (valid)
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        context.Response.ContentType = "application/json";
        context.Response.Headers["API-Version"] = "2.0";
        var tenantId = context.User.FindFirst("tenant_id")?.Value;
        if (!string.IsNullOrWhiteSpace(tenantId))
            context.Response.Headers["X-Tenant-ID"] = tenantId;
        await context.Response.WriteAsJsonAsync(new
        {
            errors = new[]
            {
                new
                {
                    code = "VALIDATION_ERROR",
                    message = "Decision is required.",
                    field = "action"
                }
            }
        }, context.RequestAborted);
    }
}

internal static class VolunteerHoursRouteMatcher
{
    private const string IntegerSegment = "{int}";

    internal static bool IsMemberLog(HttpContext context) =>
        IsRoute(context, HttpMethods.Post, "api", "v2", "volunteering", "hours")
        || IsRoute(context, HttpMethods.Post, "api", "volunteering", "hours");

    internal static bool IsMemberVerify(HttpContext context) =>
        IsRoute(context, HttpMethods.Put, "api", "v2", "volunteering", "hours", IntegerSegment, "verify")
        || IsRoute(context, HttpMethods.Put, "api", "volunteering", "hours", IntegerSegment, "verify");

    internal static bool IsAdminVerify(HttpContext context) =>
        IsRoute(
            context,
            HttpMethods.Post,
            "api",
            "v2",
            "admin",
            "volunteering",
            "hours",
            IntegerSegment,
            "verify");

    internal static bool IsMemberFeatureRoute(HttpContext context) =>
        IsRoute(context, HttpMethods.Get, "api", "v2", "volunteering", "hours")
        || IsMemberLog(context)
        || IsRoute(context, HttpMethods.Get, "api", "v2", "volunteering", "hours", "summary")
        || IsRoute(context, HttpMethods.Get, "api", "v2", "volunteering", "hours", "pending-review")
        || IsMemberVerify(context)
        || IsRoute(
            context,
            HttpMethods.Get,
            "api",
            "v2",
            "volunteering",
            "organisations",
            IntegerSegment,
            "hours",
            "pending")
        || IsRoute(context, HttpMethods.Get, "api", "volunteering", "hours", "summary")
        || IsRoute(context, HttpMethods.Get, "api", "volunteering", "hours", "pending-review")
        || IsRoute(
            context,
            HttpMethods.Get,
            "api",
            "volunteering",
            "organisations",
            IntegerSegment,
            "hours",
            "pending");

    internal static bool IsAdminFeatureRoute(HttpContext context) =>
        IsRoute(context, HttpMethods.Get, "api", "v2", "admin", "volunteering", "hours")
        || IsAdminVerify(context);

    internal static bool IsRoute(
        HttpContext context,
        string method,
        params string[] template)
    {
        if (!string.Equals(context.Request.Method, method, StringComparison.OrdinalIgnoreCase))
            return false;

        var path = context.Request.Path.Value?.Trim('/');
        var segments = string.IsNullOrEmpty(path)
            ? Array.Empty<string>()
            : path.Split('/');
        if (segments.Length != template.Length)
            return false;

        for (var index = 0; index < template.Length; index++)
        {
            if (template[index] == IntegerSegment)
            {
                if (!int.TryParse(
                        segments[index],
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out _))
                {
                    return false;
                }

                continue;
            }

            if (!segments[index].Equals(template[index], StringComparison.OrdinalIgnoreCase))
                return false;
        }

        return true;
    }
}
