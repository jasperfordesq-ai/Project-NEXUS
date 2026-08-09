// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Community group for organizing users around shared interests or activities.
/// Groups can have multiple members with different roles (member, admin, owner).
/// </summary>
public class Group : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// User who created the group (automatically becomes owner).
    /// </summary>
    public int CreatedById { get; set; }

    /// <summary>
    /// Group name displayed in listings.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Longer description of the group's purpose.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether anyone can join or membership requires approval.
    /// </summary>
    public bool IsPrivate { get; set; } = false;

    /// <summary>
    /// Optional image URL for the group.
    /// </summary>
    public string? ImageUrl { get; set; }
    public string? CoverImageUrl { get; set; }
    public string Visibility { get; set; } = "public";
    public string? Location { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public int? TypeId { get; set; }
    public int? ParentId { get; set; }
    public string? PrimaryColor { get; set; }
    public string? AccentColor { get; set; }
    public bool IsActive { get; set; } = true;
    public string Status { get; set; } = "active";
    public bool HasChildren { get; set; }
    public int CachedMemberCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
    public ICollection<GroupMember> Members { get; set; } = new List<GroupMember>();
    public ICollection<Event> Events { get; set; } = new List<Event>();

    /// <summary>
    /// Group member role constants.
    /// </summary>
    public static class Roles
    {
        public const string Member = "member";
        public const string Admin = "admin";
        public const string Owner = "owner";
    }
}
