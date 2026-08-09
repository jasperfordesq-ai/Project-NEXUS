// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public class ShiftSwapRequest : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int FromUserId { get; set; }
    public int? ToUserId { get; set; }
    public int FromShiftId { get; set; }
    public int? ToShiftId { get; set; }
    /// <summary>pending | admin_pending | accepted | rejected | admin_rejected | cancelled</summary>
    [MaxLength(30)] public string Status { get; set; } = "pending";
    public bool RequiresAdminApproval { get; set; } = false;
    [MaxLength(1000)] public string? Message { get; set; }
    public int? AdminId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public Tenant? Tenant { get; set; }
    public User? FromUser { get; set; }
    public User? ToUser { get; set; }
    public VolunteerShift? FromShift { get; set; }
    public VolunteerShift? ToShift { get; set; }
}
