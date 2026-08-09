// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventAnalyticsController(EventAnalyticsQueryService analytics, NexusDbContext db) : ControllerBase
{
    [HttpGet("api/events/{id:int}/analytics")]
    [HttpGet("api/v2/events/{id:int}/analytics")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationReadPolicy)]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        var result = await analytics.SummaryAsync(Tenant(), id, UserId(), "organizer_summary", ct);
        PrivateHeaders();
        return result.Succeeded
            ? Ok(new { success = true, data = result.Data })
            : StatusCode(result.Error!.Status, new { success = false, code = result.Error.Code, message = result.Error.Message, error = new { code = result.Error.Code, message = result.Error.Message } });
    }

    [HttpGet("api/events/{id:int}/analytics/export.csv")]
    [HttpGet("api/v2/events/{id:int}/analytics/export.csv")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationRestrictedPolicy)]
    public async Task<IActionResult> Export(int id, CancellationToken ct)
    {
        var result = await analytics.SummaryAsync(Tenant(), id, UserId(), "csv_export", ct);
        PrivateHeaders();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (!result.Succeeded)
            return StatusCode(result.Error!.Status, new { success = false, code = result.Error.Code, message = result.Error.Message, error = new { code = result.Error.Code, message = result.Error.Message } });

        var actorLocale = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == Tenant() && x.Id == UserId())
            .Select(x => x.PreferredLanguage)
            .SingleOrDefaultAsync(ct) ?? "en";
        var csv = BuildCsv(JsonSerializer.SerializeToElement(result.Data), CsvHeaders(actorLocale));
        return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "text/csv; charset=UTF-8", $"event-{id}-analytics.csv");
    }

    private void PrivateHeaders()
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        Response.Headers["API-Version"] = "2.0";
    }

    private static string BuildCsv(JsonElement summary, (string Metric, string Value, string Suppressed) headers)
    {
        var rows = new List<string> { Csv(headers.Metric, headers.Value, headers.Suppressed) };
        void Walk(JsonElement value, string prefix)
        {
            foreach (var property in value.EnumerateObject())
            {
                var path = prefix.Length == 0 ? property.Name : $"{prefix}.{property.Name}";
                if (property.Value.ValueKind == JsonValueKind.Object)
                {
                    if (property.Value.TryGetProperty("value", out var privacyValue) && property.Value.TryGetProperty("suppressed", out var suppressed))
                    {
                        rows.Add(Csv(path, Scalar(privacyValue), suppressed.ValueKind == JsonValueKind.True ? "1" : "0"));
                    }
                    else Walk(property.Value, path);
                    continue;
                }
                rows.Add(Csv(path, Scalar(property.Value), "0"));
            }
        }
        Walk(summary, "");
        return string.Join("\r\n", rows) + "\r\n";
    }

    private static string Scalar(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null => "",
        JsonValueKind.True => "1",
        JsonValueKind.False => "0",
        JsonValueKind.String => value.GetString() ?? "",
        _ => value.GetRawText()
    };

    private static string Csv(params string[] cells) => string.Join(',', cells.Select(Cell));
    private static string Cell(string value)
    {
        var candidate = value.TrimStart();
        if (candidate.Length > 0 && "=+-@".Contains(candidate[0])) value = "'" + value;
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? '"' + value.Replace("\"", "\"\"") + '"'
            : value;
    }

    private static (string, string, string) CsvHeaders(string locale) => locale.Trim().ToLowerInvariant() switch
    {
        "ar" => ("\u0627\u0644\u0645\u0624\u0634\u0631", "\u0627\u0644\u0642\u064A\u0645\u0629", "\u0645\u062D\u062C\u0648\u0628"),
        "de" => ("Kennzahl", "Wert", "Unterdr\u00FCckt"),
        "es" or "pt" => ("M\u00E9trica", "Valor", "Suprimido"),
        "fr" => ("Indicateur", "Valeur", "Masqu\u00E9"),
        "ga" => ("M\u00E9adrach", "Luach", "Faoi cheilt"),
        "it" => ("Metrica", "Valore", "Oscurato"),
        "ja" => ("\u6307\u6A19", "\u5024", "\u975E\u8868\u793A"),
        "nl" => ("Kengetal", "Waarde", "Onderdrukt"),
        "pl" => ("Wska\u017Anik", "Warto\u015B\u0107", "Ukryte"),
        _ => ("Metric", "Value", "Suppressed")
    };

    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException();
}
