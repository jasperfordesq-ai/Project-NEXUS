// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;

namespace Nexus.Api.Controllers;

/// <summary>
/// Cron / scheduled-job observability for operators.
///
/// Lists every <see cref="ScheduledHostedService"/> registered as an
/// <see cref="IHostedService"/>, and surfaces persisted run history from the
/// <c>scheduled_job_runs</c> table written by the base class on every tick.
///
/// Distinct from the older <c>AdminScheduledJobsController</c> at
/// <c>/api/admin/scheduled</c>, which surfaces TenantConfig-derived summaries.
/// This controller answers the harder operational question: did the job
/// actually fire on schedule?
/// </summary>
[ApiController]
[Route("api/admin/scheduled-jobs")]
[Authorize(Policy = "AdminOnly")]
public class AdminScheduledJobObservabilityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly IEnumerable<IHostedService> _hostedServices;

    public AdminScheduledJobObservabilityController(
        NexusDbContext db,
        IEnumerable<IHostedService> hostedServices)
    {
        _db = db;
        _hostedServices = hostedServices;
    }

    /// <summary>
    /// GET /api/admin/scheduled-jobs — list every registered ScheduledHostedService
    /// with last run + 24h success/failure counts + configured interval.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var registered = ResolveRegisteredJobs();
        var jobNames = registered.Select(j => j.Name).ToList();

        var since = DateTime.UtcNow.AddHours(-24);

        // Pull last-run-per-job and 24h tallies in two round-trips.
        var lastRuns = await _db.ScheduledJobRuns
            .Where(r => jobNames.Contains(r.JobName))
            .GroupBy(r => r.JobName)
            .Select(g => g.OrderByDescending(r => r.StartedAt).First())
            .ToListAsync();

        var tallies = await _db.ScheduledJobRuns
            .Where(r => jobNames.Contains(r.JobName) && r.StartedAt >= since)
            .GroupBy(r => new { r.JobName, r.Status })
            .Select(g => new { g.Key.JobName, g.Key.Status, Count = g.Count() })
            .ToListAsync();

        var results = registered.Select(job =>
        {
            var last = lastRuns.FirstOrDefault(r => r.JobName == job.Name);
            var jobTallies = tallies.Where(t => t.JobName == job.Name).ToList();
            return new
            {
                name = job.Name,
                enabled = job.IsEnabled,
                interval_minutes = job.ResolvedInterval.TotalMinutes,
                last_run = last == null ? null : (object)new
                {
                    started_at = last.StartedAt,
                    completed_at = last.CompletedAt,
                    status = last.Status.ToString(),
                    duration_ms = last.DurationMs,
                    items_processed = last.ItemsProcessed,
                    error_message = last.ErrorMessage,
                    error_type = last.ErrorType
                },
                successes_24h = jobTallies.Where(t => t.Status == ScheduledJobRunStatus.Success).Sum(t => t.Count),
                failures_24h = jobTallies.Where(t => t.Status == ScheduledJobRunStatus.Failed).Sum(t => t.Count),
                running_24h = jobTallies.Where(t => t.Status == ScheduledJobRunStatus.Running).Sum(t => t.Count),
                skipped_24h = jobTallies.Where(t => t.Status == ScheduledJobRunStatus.Skipped).Sum(t => t.Count)
            };
        }).ToList();

        return Ok(new { jobs = results, generated_at = DateTime.UtcNow });
    }

    /// <summary>
    /// GET /api/admin/scheduled-jobs/{name}/runs — last 50 runs for a named job.
    /// Supports ?page=N (1-based, 50 per page).
    /// </summary>
    [HttpGet("{name}/runs")]
    public async Task<IActionResult> Runs(string name, [FromQuery] int page = 1)
    {
        if (string.IsNullOrWhiteSpace(name)) return BadRequest(new { error = "name required" });
        page = page < 1 ? 1 : page;
        const int pageSize = 50;

        var query = _db.ScheduledJobRuns.Where(r => r.JobName == name);
        var total = await query.CountAsync();
        var runs = await query
            .OrderByDescending(r => r.StartedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => new
            {
                id = r.Id,
                started_at = r.StartedAt,
                completed_at = r.CompletedAt,
                status = r.Status.ToString(),
                duration_ms = r.DurationMs,
                items_processed = r.ItemsProcessed,
                error_message = r.ErrorMessage,
                error_type = r.ErrorType
            })
            .ToListAsync();

        return Ok(new { name, page, page_size = pageSize, total, runs });
    }

    /// <summary>
    /// POST /api/admin/scheduled-jobs/{name}/trigger — request an immediate run.
    /// The base <see cref="ScheduledHostedService"/> does not currently expose a
    /// manual-trigger seam (the loop is driven internally by Task.Delay). Wiring
    /// one in safely (without racing the natural tick or duplicating run rows)
    /// is out of scope for this slice; the response returns 501 with guidance
    /// so operators can lower the interval as a stop-gap.
    /// </summary>
    [HttpPost("{name}/trigger")]
    public IActionResult Trigger(string name)
    {
        var registered = ResolveRegisteredJobs();
        if (!registered.Any(j => j.Name == name))
        {
            return NotFound(new { error = $"Unknown scheduled job '{name}'." });
        }

        Response.StatusCode = StatusCodes.Status501NotImplemented;
        return new ObjectResult(new
        {
            error = "Manual trigger is not yet wired into the ScheduledHostedService base class.",
            workaround = "Lower Scheduled:" + name + ":IntervalMinutes via admin config or restart the API to force the StartupDelay tick.",
            job = name
        });
    }

    private List<ScheduledHostedService> ResolveRegisteredJobs() =>
        _hostedServices.OfType<ScheduledHostedService>().OrderBy(s => s.Name).ToList();
}
