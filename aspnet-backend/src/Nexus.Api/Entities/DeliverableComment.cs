// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A comment thread entry on a Deliverable.
/// </summary>
public class DeliverableComment : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int DeliverableId { get; set; }
    public int UserId { get; set; }

    [Required]
    [MaxLength(3000)]
    public string Content { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Deliverable? Deliverable { get; set; }
    public User? User { get; set; }
}
