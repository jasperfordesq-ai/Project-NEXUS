// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Controllers;

/// <summary>
/// Phase 73.x — surfaces the latest per-tenant summary rows that the Phase 63
/// scheduled hosted services write to <c>TenantConfig</c> (keys
/// <c>scheduled.summary.*</c> and <c>reports.monthly.*</c>). Read-only
/// observability for the admin UI.
/// </summary>
[ApiController]
[Route("api/admin/scheduled")]
[Authorize(Policy = "AdminOnly")]
public class AdminScheduledJobsController : ControllerBase
{
    private static readonly string[] KnownJobs = new[]
    {
        "SyncFederationPartners",
        "PruneFederationLogs",
        "CheckInactiveGroups",
        "PollStuckIdentityVerifications",
        "SafeguardingSlaEscalate",
        "MarkOverdueDues",
        "PruneLogs",
        "GenerateMonthlyReports",
        "ReconcileFederatedHourTransfers",
        "SavedSearchAlert"
    };

    private readonly NexusDbContext _db;
    public AdminScheduledJobsController(NexusDbContext db) { _db = db; }

    /// <summary>
    /// GET /api/admin/scheduled/jobs — list every Phase 63 job with its latest
    /// summary row (if any) so the admin UI can show "last seen" status.
    /// </summary>
    [HttpGet("jobs")]
    public async Task<IActionResult> ListJobs()
    {
        var summaries = await _db.TenantConfigs
            .Where(c => c.Key.StartsWith("scheduled.summary.")
                || c.Key.StartsWith("reports.monthly."))
            .Select(c => new { c.Key, c.Value, c.UpdatedAt, c.CreatedAt })
            .ToListAsync();

        var results = KnownJobs.Select(name => new
        {
            name,
            // the job's primary summary key (where applicable)
            summary_key = MapJobSummaryKey(name),
            latest_summary = (object?)summaries
                .Where(s => s.Key == MapJobSummaryKey(name))
                .OrderByDescending(s => s.UpdatedAt ?? s.CreatedAt)
                .Select(s => new
                {
                    updated_at = s.UpdatedAt ?? s.CreatedAt,
                    payload = TryParse(s.Value)
                })
                .FirstOrDefault()
        }).ToList();

        // Surface the most recent monthly snapshot too.
        var latestMonthly = summaries
            .Where(s => s.Key.StartsWith("reports.monthly."))
            .OrderByDescending(s => s.Key)
            .FirstOrDefault();

        return Ok(new
        {
            jobs = results,
            latest_monthly_report = latestMonthly == null
                ? null
                : (object)new
                {
                    key = latestMonthly.Key,
                    updated_at = latestMonthly.UpdatedAt ?? latestMonthly.CreatedAt,
                    payload = TryParse(latestMonthly.Value)
                }
        });
    }

    private static string? MapJobSummaryKey(string jobName) => jobName switch
    {
        "CheckInactiveGroups" => "scheduled.summary.inactive_groups",
        "SafeguardingSlaEscalate" => "scheduled.summary.safeguarding_sla",
        // Other jobs don't write a TenantConfig summary — they mutate domain
        // entities directly. Their "last seen" is implicit in those mutations.
        _ => null
    };

    private static object? TryParse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try { using var doc = JsonDocument.Parse(raw); return Serialize(doc.RootElement); }
        catch (JsonException) { return raw; }
    }

    private static object? Serialize(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Object => el.EnumerateObject().ToDictionary(p => p.Name, p => Serialize(p.Value)),
        JsonValueKind.Array => el.EnumerateArray().Select(Serialize).ToArray(),
        JsonValueKind.String => el.GetString(),
        JsonValueKind.Number => el.TryGetInt64(out var i) ? i : el.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null
    };
}
