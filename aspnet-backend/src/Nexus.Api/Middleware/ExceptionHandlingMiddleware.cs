// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.Json;

namespace Nexus.Api.Middleware;

/// <summary>
/// Global exception handling middleware that catches unhandled exceptions
/// and returns a standardized JSON error response.
///
/// In Production: Returns a generic error message (no sensitive details).
/// In Development: Returns full exception details for debugging.
/// </summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;
    private readonly IWebHostEnvironment _env;

    public ExceptionHandlingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionHandlingMiddleware> logger,
        IWebHostEnvironment env)
    {
        _next = next;
        _logger = logger;
        _env = env;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        // Log the full exception (always - for debugging/auditing)
        _logger.LogError(
            exception,
            "Unhandled exception: {ExceptionType} at {Path} | TraceId: {TraceId}",
            exception.GetType().Name,
            context.Request.Path,
            context.TraceIdentifier);

        // Determine status code based on exception type
        // NOTE: InvalidOperationException is NOT mapped to 409 because it's thrown
        // by EF Core, ASP.NET Core internals, and .NET framework methods for many
        // non-conflict reasons. Only domain-specific exceptions should map to specific codes.
        var (statusCode, errorType) = exception switch
        {
            ArgumentException => (HttpStatusCode.BadRequest, "bad_request"),
            UnauthorizedAccessException => (HttpStatusCode.Unauthorized, "unauthorized"),
            KeyNotFoundException => (HttpStatusCode.NotFound, "not_found"),
            NotSupportedException => (HttpStatusCode.NotImplemented, "not_implemented"),
            TimeoutException => (HttpStatusCode.GatewayTimeout, "timeout"),
            OperationCanceledException => (HttpStatusCode.ServiceUnavailable, "cancelled"),
            _ => (HttpStatusCode.InternalServerError, "internal_error")
        };

        // Build response
        context.Response.ContentType = "application/json";
        context.Response.StatusCode = (int)statusCode;

        // 🔴 A 401 from here must carry Laravel's auth envelope, not this
        // middleware's generic {error,type,trace_id}. An UnauthorizedAccessException
        // thrown inside a handler produced a FOURTH distinct 401 body -- after the
        // policy handler's, a bare Unauthorized(), and Unauthorized(new{error}) --
        // and the client branches on errors[0].code, so it could not tell this
        // apart from a server fault. Found by diffing React's own endpoint list
        // against Laravel: eight endpoints differed on this alone.
        //
        // Everything that is NOT a 401 keeps this middleware's shape, which is
        // deliberate: it is the generic fault envelope and no Laravel contract
        // depends on it.
        var response = statusCode == HttpStatusCode.Unauthorized
            ? new Dictionary<string, object>
            {
                ["errors"] = new[]
                {
                    new Dictionary<string, string>
                    {
                        ["code"] = "auth_required",
                        ["message"] = "Authentication required",
                    },
                },
                ["success"] = false,
            }
            : new Dictionary<string, object>
            {
                ["error"] = GetUserFacingMessage(statusCode, errorType),
                ["type"] = errorType,
                ["trace_id"] = context.TraceIdentifier
            };

        // In Development/Testing, include exception details for debugging.
        // Never on a 401: "you are not signed in" is not a fault, Laravel does
        // not attach a trace to one, and an extra debug key here is a contract
        // difference that only shows up in dev — the most annoying kind to chase.
        if ((_env.IsDevelopment() || _env.EnvironmentName == "Testing")
            && statusCode != HttpStatusCode.Unauthorized)
        {
            response["exception"] = new
            {
                type = exception.GetType().FullName,
                message = exception.Message,
                stackTrace = exception.StackTrace,
                innerException = exception.InnerException?.Message
            };
        }

        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = _env.IsDevelopment() || _env.EnvironmentName == "Testing"
        });

        await context.Response.WriteAsync(json);
    }

    private static string GetUserFacingMessage(HttpStatusCode statusCode, string errorType)
    {
        return statusCode switch
        {
            HttpStatusCode.BadRequest => "The request was invalid. Please check your input.",
            HttpStatusCode.Unauthorized => "Authentication required.",
            HttpStatusCode.Forbidden => "You don't have permission to perform this action.",
            HttpStatusCode.NotFound => "The requested resource was not found.",
            HttpStatusCode.Conflict => "The request conflicts with the current state.",
            HttpStatusCode.NotImplemented => "This feature is not yet implemented.",
            HttpStatusCode.GatewayTimeout => "The request timed out. Please try again.",
            HttpStatusCode.ServiceUnavailable => "The service is temporarily unavailable.",
            _ => "An unexpected error occurred. Please try again later."
        };
    }
}

/// <summary>
/// Extension method to register exception handling middleware.
/// </summary>
public static class ExceptionHandlingMiddlewareExtensions
{
    public static IApplicationBuilder UseExceptionHandling(this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<ExceptionHandlingMiddleware>();
    }
}
