// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a role with associated permissions.
/// Roles can be system-defined (admin, member) or custom tenant-specific roles.
/// </summary>
public class Role : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>
    /// JSON array of permission strings.
    /// Example: ["users.read", "listings.write", "admin.dashboard"]
    /// </summary>
    public string Permissions { get; set; } = "[]";
    /// <summary>
    /// System roles (admin, member) cannot be deleted or renamed.
    /// </summary>
    public bool IsSystem { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }

    // Well-known role names
    public static class Names
    {
        public const string Admin = "admin";
        public const string Member = "member";
    }
}
