// Copyright (C) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks which users have favorited which ideas.
/// </summary>
public class IdeaFavorite : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int IdeaId { get; set; }
    public int UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Idea? Idea { get; set; }
    public User? User { get; set; }
}
