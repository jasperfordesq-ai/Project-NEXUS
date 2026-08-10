// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks background/scheduled tasks and their execution history.
/// </summary>
public class ScheduledTask : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Name of the task (e.g. "send_digests", "expire_listings", "compute_matches").
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string TaskName { get; set; } = string.Empty;

    /// <summary>
    /// Current execution status.
    /// </summary>
    public ScheduledTaskStatus Status { get; set; } = ScheduledTaskStatus.Pending;

    /// <summary>
    /// When the task last ran.
    /// </summary>
    public DateTime? LastRunAt { get; set; }

    /// <summary>
    /// When the task is next scheduled to run.
    /// </summary>
    public DateTime? NextRunAt { get; set; }

    /// <summary>
    /// Cron expression defining the schedule (e.g. "0 0 * * *" for daily).
    /// </summary>
    [MaxLength(50)]
    public string? CronExpression { get; set; }

    /// <summary>
    /// JSON-encoded parameters for the task.
    /// </summary>
    public string? Parameters { get; set; }

    /// <summary>
    /// Error message from the last failed run.
    /// </summary>
    [MaxLength(2000)]
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// Total number of times this task has run.
    /// </summary>
    public int RunCount { get; set; } = 0;

    /// <summary>
    /// Average duration of task runs in milliseconds.
    /// </summary>
    public long AverageDurationMs { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Status of a scheduled task. Named to avoid conflict with System.Threading.Tasks.TaskStatus.
/// </summary>
public enum ScheduledTaskStatus
{
    Pending,
    Running,
    Completed,
    Failed
}
