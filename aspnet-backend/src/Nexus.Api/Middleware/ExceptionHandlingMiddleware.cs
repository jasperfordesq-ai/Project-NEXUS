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

        var response = new Dictionary<string, object>
        {
            ["error"] = GetUserFacingMessage(statusCode, errorType),
            ["type"] = errorType,
            ["trace_id"] = context.TraceIdentifier
        };

        // In Development/Testing, include exception details for debugging
        if (_env.IsDevelopment() || _env.EnvironmentName == "Testing")
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
