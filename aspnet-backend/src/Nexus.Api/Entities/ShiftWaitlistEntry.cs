// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public class ShiftWaitlistEntry : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ShiftId { get; set; }
    public int UserId { get; set; }
    public int Position { get; set; }
    /// <summary>waiting | notified | promoted | cancelled</summary>
    [MaxLength(20)] public string Status { get; set; } = "waiting";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? NotifiedAt { get; set; }
    public DateTime? PromotedAt { get; set; }
    public Tenant? Tenant { get; set; }
    public VolunteerShift? Shift { get; set; }
    public User? User { get; set; }
}
