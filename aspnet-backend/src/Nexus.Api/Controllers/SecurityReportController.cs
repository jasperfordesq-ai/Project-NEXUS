// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * POST /api/csp-report — the browser's Content-Security-Policy violation sink.
 *
 * 🔴 Why this matters more than its size. The BROWSER posts here, unprompted, when
 * a page violates its CSP. This backend answered 404, so every violation report a
 * real browser session produced was lost, and the first React-against-ASP.NET run
 * would have generated a stream of them with nothing to receive them. It is one of
 * the nine genuine method-level route gaps.
 *
 * Contract read from Laravel's SecurityReportController::csp and confirmed live on
 * 2026-08-19 (204 No Content for a well-formed report):
 *
 *   - anonymous: a CSP report carries no credentials
 *   - over 32 KB          -> 413
 *   - unparseable body    -> 204 (never an error; the browser cannot act on one)
 *   - anything else       -> 204
 *   - logs ONE warning, with the fields below
 *
 * 🔴 The log line is deliberately lossy, and that is the point. Laravel stores only
 * scheme://host/path for every URL it records, truncated to 500 characters, and
 * caps the directive at 120. A CSP report's document-uri and blocked-uri can carry
 * query strings and fragments containing session tokens, reset tokens or personal
 * data straight out of the address bar, so logging them whole would put member data
 * into a diagnostics log. Keep originAndPath; never log the raw value.
 *
 * Both the legacy `csp-report` wrapper and the Reporting API `body` wrapper are
 * accepted, and a report posted as a single-element array is unwrapped, because
 * browsers differ and Laravel handles all three.
 */

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Nexus.Api.Controllers;

[ApiController]
public class SecurityReportController : ControllerBase
{
    /// <summary>Laravel's cap: reports larger than this are refused outright.</summary>
    private const int MaxReportBytes = 32 * 1024;

    private readonly ILogger<SecurityReportController> _logger;

    public SecurityReportController(ILogger<SecurityReportController> logger) => _logger = logger;

    [HttpPost("api/csp-report")]
    [HttpPost("api/v2/csp-report")]
    [AllowAnonymous]
    public async Task<IActionResult> Csp()
    {
        if (Request.ContentLength is > MaxReportBytes)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        string raw;
        using (var reader = new StreamReader(Request.Body))
        {
            raw = await reader.ReadToEndAsync();
        }

        // 🔴 Guard the length again after reading. Content-Length is client-supplied
        // and may be absent on a chunked request, so the header check above is not
        // sufficient on its own.
        if (raw.Length > MaxReportBytes)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        JsonElement report;
        try
        {
            using var parsed = JsonDocument.Parse(raw);
            report = parsed.RootElement.Clone();
        }
        catch (JsonException)
        {
            // Laravel returns no content for an unparseable body rather than an
            // error: the browser cannot do anything with a 4xx here, and a noisy
            // failure would turn a diagnostics channel into an alert source.
            return NoContent();
        }

        // A report posted as a list: take the first element, as Laravel does.
        if (report.ValueKind == JsonValueKind.Array)
        {
            report = report.GetArrayLength() > 0 && report[0].ValueKind == JsonValueKind.Object
                ? report[0].Clone()
                : default;
        }

        if (report.ValueKind != JsonValueKind.Object)
        {
            return NoContent();
        }

        // Legacy `csp-report` wrapper, Reporting API `body` wrapper, or a bare report.
        var body = report;
        if (report.TryGetProperty("csp-report", out var legacy) && legacy.ValueKind == JsonValueKind.Object)
        {
            body = legacy;
        }
        else if (report.TryGetProperty("body", out var reporting) && reporting.ValueKind == JsonValueKind.Object)
        {
            body = reporting;
        }

        _logger.LogWarning(
            "security.csp_violation document={Document} blocked={Blocked} directive={Directive} "
            + "source_file={SourceFile} line={Line}",
            OriginAndPath(Str(body, "document-uri", "documentURL")),
            OriginAndPath(Str(body, "blocked-uri", "blockedURL")),
            Truncate(Str(body, "violated-directive", "effectiveDirective"), 120),
            OriginAndPath(Str(body, "source-file", "sourceFile")),
            Int(body, "line-number", "lineNumber"));

        return NoContent();
    }

    private static string? Str(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
        }
        return null;
    }

    private static int Int(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var v))
            {
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)) return n;
                if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s)) return s;
            }
        }
        return 0;
    }

    /// <summary>
    /// 🔴 Reduce a URL to scheme://host/path and nothing else — no query, no
    /// fragment. A CSP report's URLs come from the address bar, so they can carry
    /// session tokens, password-reset tokens and personal data. Laravel does exactly
    /// this (SecurityReportController::originAndPath) and the 500-character cap is
    /// its too.
    /// </summary>
    private static string? OriginAndPath(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;

        if (Uri.TryCreate(value, UriKind.Absolute, out var uri))
        {
            return Truncate($"{uri.Scheme}://{uri.Host}{uri.AbsolutePath}", 500);
        }

        // Not absolute (for example "inline" or "eval", which browsers do send).
        // Strip anything after a query or fragment marker before recording it.
        var cut = value.IndexOfAny(['?', '#']);
        return Truncate(cut >= 0 ? value[..cut] : value, 500);
    }

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? value : value.Length <= max ? value : value[..max];
}
