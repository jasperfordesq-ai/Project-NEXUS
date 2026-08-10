// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public class ShiftGroupReservation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ShiftId { get; set; }
    public int GroupId { get; set; }
    public int ReservedBy { get; set; }
    public int ReservedSlots { get; set; }
    public int FilledSlots { get; set; } = 0;
    [MaxLength(20)] public string Status { get; set; } = "active";
    [MaxLength(1000)] public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Tenant? Tenant { get; set; }
    public VolunteerShift? Shift { get; set; }
    public Group? Group { get; set; }
    public User? Reserver { get; set; }
    public ICollection<ShiftGroupMember> Members { get; set; } = new List<ShiftGroupMember>();
}

public class ShiftGroupMember : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ReservationId { get; set; }
    public int UserId { get; set; }
    [MaxLength(20)] public string Status { get; set; } = "confirmed";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ShiftGroupReservation? Reservation { get; set; }
    public User? User { get; set; }
}
