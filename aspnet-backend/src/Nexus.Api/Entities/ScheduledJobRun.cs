// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

/// <summary>
/// Persisted run record for a single tick of a <c>ScheduledHostedService</c>.
/// Written by the base class on every iteration so operators can confirm
/// jobs are firing on schedule and inspect failure history.
///
/// Not tenant-scoped: most jobs are global, and per-tenant jobs still emit
/// a single run row per tick (the tenant fan-out happens inside the tick).
/// </summary>
public class ScheduledJobRun
{
    public int Id { get; set; }

    /// <summary>
    /// Optional tenant association. Null for global jobs and for the
    /// per-tick "outer" run row of tenant-iterating jobs.
    /// </summary>
    public int? TenantId { get; set; }

    [Required]
    [MaxLength(100)]
    public string JobName { get; set; } = string.Empty;

    public DateTime StartedAt { get; set; } = DateTime.UtcNow;

    public DateTime? CompletedAt { get; set; }

    public ScheduledJobRunStatus Status { get; set; } = ScheduledJobRunStatus.Running;

    public int ItemsProcessed { get; set; }

    [MaxLength(2000)]
    public string? ErrorMessage { get; set; }

    [Column(TypeName = "text")]
    public string? ErrorType { get; set; }

    /// <summary>Duration in milliseconds, set when <see cref="CompletedAt"/> is written.</summary>
    public double? DurationMs { get; set; }
}

public enum ScheduledJobRunStatus
{
    Running,
    Success,
    Failed,
    Skipped
}
