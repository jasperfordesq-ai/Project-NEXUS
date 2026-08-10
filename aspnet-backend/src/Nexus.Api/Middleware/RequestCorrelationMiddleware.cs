// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Diagnostics;

namespace Nexus.Api.Middleware;

/// <summary>
/// Production observability — request correlation.
///
/// On the way in:
///   - Reads <c>X-Request-Id</c> from the incoming request (passes through if
///     an upstream load balancer / reverse proxy / client supplied one).
///   - Falls back to <c>X-Correlation-Id</c> for compatibility with other
///     conventions.
///   - Generates a fresh GUID if neither header is present.
///   - Stamps the value on <see cref="HttpContext.TraceIdentifier"/> so it
///     flows into <c>ExceptionHandlingMiddleware</c>'s error responses + the
///     ASP.NET Core <c>Activity</c>.
///   - Pushes a logging scope so EVERY log entry written during the request
///     carries the same <c>request_id</c> field — the single thing that lets
///     you stitch logs together when a prod incident hits.
///
/// On the way out:
///   - Sets the <c>X-Request-Id</c> response header so the client (and any
///     CDN / log-shipping path) sees the same id and can attach it to
///     bug reports / support tickets.
/// </summary>
public class RequestCorrelationMiddleware
{
    private const string RequestIdHeader = "X-Request-Id";
    private const string CorrelationIdHeader = "X-Correlation-Id";

    private readonly RequestDelegate _next;
    private readonly ILogger<RequestCorrelationMiddleware> _logger;

    public RequestCorrelationMiddleware(RequestDelegate next, ILogger<RequestCorrelationMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var requestId = ResolveRequestId(context);
        context.TraceIdentifier = requestId;

        // Set the header BEFORE handing off so it's present even if a
        // downstream middleware short-circuits the response.
        context.Response.Headers[RequestIdHeader] = requestId;

        // Push a logging scope. ALL log entries inside the using-block carry
        // request_id. The scope props also include trace_id from the .NET
        // Activity (W3C traceparent) when available — useful for distributed
        // tracing once OpenTelemetry is wired.
        var activity = Activity.Current;
        var scopeProps = new Dictionary<string, object?>
        {
            ["request_id"] = requestId,
            ["method"] = context.Request.Method,
            ["path"] = context.Request.Path.Value,
            ["trace_id"] = activity?.TraceId.ToString(),
            ["span_id"] = activity?.SpanId.ToString()
        };

        using (_logger.BeginScope(scopeProps))
        {
            await _next(context);
        }
    }

    private static string ResolveRequestId(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue(RequestIdHeader, out var primary)
            && !string.IsNullOrWhiteSpace(primary.ToString()))
        {
            return Sanitize(primary.ToString());
        }
        if (context.Request.Headers.TryGetValue(CorrelationIdHeader, out var secondary)
            && !string.IsNullOrWhiteSpace(secondary.ToString()))
        {
            return Sanitize(secondary.ToString());
        }
        return Guid.NewGuid().ToString("N");
    }

    /// <summary>
    /// Strip control / non-ASCII / overly-long values to prevent log injection
    /// and abuse. Cap at 128 chars (UUIDs and most internal correlation
    /// schemes fit comfortably below this).
    /// </summary>
    private static string Sanitize(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length > 128) trimmed = trimmed[..128];
        var sb = new System.Text.StringBuilder(trimmed.Length);
        foreach (var c in trimmed)
        {
            if (c >= 0x20 && c < 0x7F) sb.Append(c);
        }
        return sb.Length == 0 ? Guid.NewGuid().ToString("N") : sb.ToString();
    }
}

public static class RequestCorrelationMiddlewareExtensions
{
    public static IApplicationBuilder UseRequestCorrelation(this IApplicationBuilder builder)
        => builder.UseMiddleware<RequestCorrelationMiddleware>();
}
