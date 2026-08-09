// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Configurable policies for a group (e.g., exchange rules, posting rules).
/// Stored as key-value pairs per group.
/// </summary>
public class GroupPolicy : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }

    /// <summary>
    /// Policy key, e.g. "require_approval_for_exchanges", "max_exchange_hours", "allow_external_members".
    /// </summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// Policy value (JSON or simple string).
    /// </summary>
    public string Value { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public Group? Group { get; set; }
}
