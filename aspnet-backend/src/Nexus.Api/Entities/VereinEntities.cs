// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped Verein membership-fee configuration.
/// Mirrors Laravel's verein_membership_fees table.
/// </summary>
public sealed class VereinMembershipFee : ITenantEntity
{
    public long Id { get; set; }
    public int OrganizationId { get; set; }
    public int TenantId { get; set; }
    public int FeeAmountCents { get; set; }
    public string Currency { get; set; } = "CHF";
    public string BillingCycle { get; set; } = "annual";
    public int GracePeriodDays { get; set; } = 30;
    public int? LateFeeCents { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public VolunteerOrganisation? Organization { get; set; }
}

/// <summary>
/// Per-member, per-year Verein dues lifecycle row.
/// Mirrors Laravel's verein_member_dues table.
/// </summary>
public sealed class VereinMemberDue : ITenantEntity
{
    public long Id { get; set; }
    public int OrganizationId { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int MembershipYear { get; set; }
    public int AmountCents { get; set; }
    public string Currency { get; set; } = "CHF";
    public string Status { get; set; } = "pending";
    public DateOnly DueDate { get; set; }
    public DateTime? PaidAt { get; set; }
    public string? StripePaymentIntentId { get; set; }
    public int ReminderCount { get; set; }
    public DateTime? LastReminderAt { get; set; }
    public DateTime? ReminderEmailFailedAt { get; set; }
    public string? ReminderEmailLastError { get; set; }
    public DateTime? GeneratedEmailSentAt { get; set; }
    public DateTime? GeneratedEmailFailedAt { get; set; }
    public DateTime? PaidEmailSentAt { get; set; }
    public DateTime? PaidEmailFailedAt { get; set; }
    public int? WaivedByAdminId { get; set; }
    public string? WaivedReason { get; set; }
    public DateTime? RefundedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public VolunteerOrganisation? Organization { get; set; }
    public User? User { get; set; }
    public User? WaivedByAdmin { get; set; }
    public ICollection<VereinDuesPayment> Payments { get; set; } = [];
}

/// <summary>
/// Provider payment evidence for a Verein dues row.
/// Mirrors Laravel's verein_dues_payments table.
/// </summary>
public sealed class VereinDuesPayment : ITenantEntity
{
    public long Id { get; set; }
    public long DuesId { get; set; }
    public int TenantId { get; set; }
    public string StripePaymentIntentId { get; set; } = string.Empty;
    public int AmountCents { get; set; }
    public string Currency { get; set; } = "CHF";
    public DateTime PaidAt { get; set; }
    public string? PaymentMethod { get; set; }
    public string? ReceiptUrl { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public VereinMemberDue? Due { get; set; }
}

/// <summary>
/// Tenant-scoped event share between two Vereine.
/// Mirrors Laravel's verein_event_shares table.
/// </summary>
public sealed class VereinEventShare : ITenantEntity
{
    public long Id { get; set; }
    public int SourceOrganizationId { get; set; }
    public int TargetOrganizationId { get; set; }
    public int EventId { get; set; }
    public int TenantId { get; set; }
    public DateTime SharedAt { get; set; }
    public string Status { get; set; } = "active";
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public VolunteerOrganisation? SourceOrganization { get; set; }
    public VolunteerOrganisation? TargetOrganization { get; set; }
    public Event? Event { get; set; }
}

/// <summary>
/// Tenant-scoped member invitation between two Vereine.
/// Mirrors Laravel's verein_cross_invitations table.
/// </summary>
public sealed class VereinCrossInvitation : ITenantEntity
{
    public long Id { get; set; }
    public int SourceOrganizationId { get; set; }
    public int TargetOrganizationId { get; set; }
    public int TenantId { get; set; }
    public int InviterUserId { get; set; }
    public int InviteeUserId { get; set; }
    public string? Message { get; set; }
    public string Status { get; set; } = "sent";
    public DateTime SentAt { get; set; }
    public DateTime? RespondedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public VolunteerOrganisation? SourceOrganization { get; set; }
    public VolunteerOrganisation? TargetOrganization { get; set; }
    public User? InviterUser { get; set; }
    public User? InviteeUser { get; set; }
}
