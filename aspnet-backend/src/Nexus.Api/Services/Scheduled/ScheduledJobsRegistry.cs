// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Collections.Concurrent;

namespace Nexus.Api.Services.Scheduled;

/// <summary>
/// In-memory registry of background-job health. The base
/// <see cref="ScheduledHostedService"/> writes a tick result here every
/// iteration; the admin diagnostics endpoint reads from here.
///
/// Singleton lifetime. Thread-safe.
///
/// Why not just read the database? Because:
///  - Not every job writes a TenantConfig summary (some only mutate domain
///    entities). The registry gives a uniform view across all jobs.
///  - We want to surface the LAST EXCEPTION text without persisting it
///    (PII risk). Memory-only is fine; an alerting tier can scrape this.
///  - Readers (the diagnostics endpoint) need a fast snapshot, not a query.
/// </summary>
public class ScheduledJobsRegistry
{
    private readonly ConcurrentDictionary<string, JobHealth> _state = new();

    public void RecordStart(string jobName)
    {
        _state.AddOrUpdate(jobName,
            _ => new JobHealth { JobName = jobName, LastStartedAt = DateTime.UtcNow, Status = "running" },
            (_, existing) =>
            {
                existing.LastStartedAt = DateTime.UtcNow;
                existing.Status = "running";
                return existing;
            });
    }

    public void RecordSuccess(string jobName, TimeSpan elapsed)
    {
        _state.AddOrUpdate(jobName,
            _ => new JobHealth
            {
                JobName = jobName,
                LastSucceededAt = DateTime.UtcNow,
                LastDurationMs = elapsed.TotalMilliseconds,
                Status = "idle",
                ConsecutiveFailures = 0
            },
            (_, existing) =>
            {
                existing.LastSucceededAt = DateTime.UtcNow;
                existing.LastDurationMs = elapsed.TotalMilliseconds;
                existing.Status = "idle";
                existing.ConsecutiveFailures = 0;
                return existing;
            });
    }

    public void RecordFailure(string jobName, Exception ex)
    {
        _state.AddOrUpdate(jobName,
            _ => new JobHealth
            {
                JobName = jobName,
                LastFailedAt = DateTime.UtcNow,
                LastFailureMessage = Truncate(ex.Message, 500),
                LastFailureType = ex.GetType().Name,
                Status = "failing",
                ConsecutiveFailures = 1
            },
            (_, existing) =>
            {
                existing.LastFailedAt = DateTime.UtcNow;
                existing.LastFailureMessage = Truncate(ex.Message, 500);
                existing.LastFailureType = ex.GetType().Name;
                existing.Status = "failing";
                existing.ConsecutiveFailures += 1;
                return existing;
            });
    }

    public void RecordDisabled(string jobName)
    {
        _state.AddOrUpdate(jobName,
            _ => new JobHealth { JobName = jobName, Status = "disabled" },
            (_, existing) => { existing.Status = "disabled"; return existing; });
    }

    public IReadOnlyList<JobHealth> Snapshot() =>
        _state.Values.OrderBy(j => j.JobName).Select(j => j.Clone()).ToList();

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";
}

public class JobHealth
{
    public string JobName { get; set; } = string.Empty;
    public string Status { get; set; } = "unknown";
    public DateTime? LastStartedAt { get; set; }
    public DateTime? LastSucceededAt { get; set; }
    public DateTime? LastFailedAt { get; set; }
    public double? LastDurationMs { get; set; }
    public string? LastFailureType { get; set; }
    public string? LastFailureMessage { get; set; }
    public int ConsecutiveFailures { get; set; }

    internal JobHealth Clone() => new()
    {
        JobName = JobName,
        Status = Status,
        LastStartedAt = LastStartedAt,
        LastSucceededAt = LastSucceededAt,
        LastFailedAt = LastFailedAt,
        LastDurationMs = LastDurationMs,
        LastFailureType = LastFailureType,
        LastFailureMessage = LastFailureMessage,
        ConsecutiveFailures = ConsecutiveFailures
    };
}
