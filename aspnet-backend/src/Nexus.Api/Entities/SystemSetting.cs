// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Global system configuration setting (not tenant-specific).
/// Settings can be categorized and optionally marked as secret.
/// </summary>
public class SystemSetting
{
    public int Id { get; set; }

    /// <summary>
    /// Unique key for the setting (e.g. "max_upload_size_mb").
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// The setting value (stored as text).
    /// </summary>
    [Required]
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Human-readable description of the setting.
    /// </summary>
    [MaxLength(500)]
    public string? Description { get; set; }

    /// <summary>
    /// Category for grouping settings (e.g. "general", "security", "email", "limits").
    /// </summary>
    [MaxLength(50)]
    public string? Category { get; set; }

    /// <summary>
    /// If true, value is redacted in API responses.
    /// </summary>
    public bool IsSecret { get; set; } = false;

    /// <summary>
    /// Last admin to update this setting.
    /// </summary>
    public int? UpdatedById { get; set; }

    public DateTime? UpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
