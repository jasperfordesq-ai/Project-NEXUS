// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents QR attendance for a volunteer shift. Attendance does not itself
/// approve hours or create credits; legacy rows may still carry historical
/// hours/transaction evidence in the compatibility fields below.
/// </summary>
public class VolunteerCheckIn : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The shift this check-in belongs to.
    /// </summary>
    public int ShiftId { get; set; }

    /// <summary>
    /// The volunteer who checked in.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// Opaque, volunteer-specific capability rendered in the shift QR code.
    /// Historical attendance rows may not have a token.
    /// </summary>
    [MaxLength(64)]
    public string? QrToken { get; set; }

    /// <summary>
    /// Attendance lifecycle: pending, checked_in, checked_out, or no_show.
    /// </summary>
    [MaxLength(20)]
    public string Status { get; set; } = "pending";

    /// <summary>
    /// When the volunteer checked in.
    /// </summary>
    public DateTime? CheckedInAt { get; set; }

    /// <summary>
    /// When the volunteer checked out (null if still checked in).
    /// </summary>
    public DateTime? CheckedOutAt { get; set; }

    /// <summary>
    /// Coordinator who verified the QR check-in.
    /// </summary>
    public int? CheckedInById { get; set; }

    /// <summary>
    /// Coordinator who completed check-out.
    /// </summary>
    public int? CheckedOutById { get; set; }

    /// <summary>
    /// Legacy hours evidence. The QR attendance workflow never writes it.
    /// </summary>
    public decimal? HoursLogged { get; set; }

    /// <summary>
    /// Optional notes about the check-in.
    /// </summary>
    [MaxLength(2000)]
    public string? Notes { get; set; }

    /// <summary>
    /// Legacy transaction evidence. The QR attendance workflow never writes it.
    /// </summary>
    public int? TransactionId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public VolunteerShift? Shift { get; set; }
    public User? User { get; set; }
    public User? CheckedInBy { get; set; }
    public User? CheckedOutBy { get; set; }
    public Transaction? Transaction { get; set; }
}
