// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Laravel-compatible polymorphic reaction on feed-backed content.
/// </summary>
public class ContentReaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [MaxLength(50)]
    public string TargetType { get; set; } = string.Empty;

    public int TargetId { get; set; }
    public int UserId { get; set; }

    [MaxLength(20)]
    public string ReactionType { get; set; } = "like";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
