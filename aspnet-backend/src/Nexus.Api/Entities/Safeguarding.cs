// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public class SafeguardingOption : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [MaxLength(120)]
    public string OptionKey { get; set; } = string.Empty;

    [MaxLength(40)]
    public string OptionType { get; set; } = "checkbox";

    [MaxLength(200)]
    public string Label { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    [MaxLength(500)]
    public string? HelpUrl { get; set; }

    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsRequired { get; set; }
    public string? SelectOptionsJson { get; set; }
    public string? TriggersJson { get; set; }

    [MaxLength(80)]
    public string? PresetSource { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public Tenant? Tenant { get; set; }
}

public class UserSafeguardingPreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int OptionId { get; set; }

    [MaxLength(255)]
    public string SelectedValue { get; set; } = "true";

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public DateTime ConsentGivenAt { get; set; } = DateTime.UtcNow;

    [MaxLength(64)]
    public string? ConsentIp { get; set; }

    public DateTime? RevokedAt { get; set; }
    public DateTime? ReviewReminderSentAt { get; set; }
    public DateTime? ReviewConfirmedAt { get; set; }
    public DateTime? ReviewEscalatedAt { get; set; }
    public DateTime? PolicyReviewRequiredAt { get; set; }

    [MaxLength(64)]
    public string? PolicyReviewReasonCode { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public SafeguardingOption? Option { get; set; }
}

public class SafeguardingAssignment : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int WardUserId { get; set; }
    public int GuardianUserId { get; set; }

    [MaxLength(30)]
    public string Status { get; set; } = "active";

    public DateTime? ConsentGivenAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Ward { get; set; }
    public User? Guardian { get; set; }
}

public class SafeguardingMessageReview : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int MessageId { get; set; }
    public int SenderId { get; set; }
    public int? RecipientId { get; set; }

    [MaxLength(30)]
    public string Severity { get; set; } = "medium";

    [MaxLength(120)]
    public string FlagReason { get; set; } = "manual_review";

    public bool IsFlagged { get; set; } = true;
    public int? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }

    [MaxLength(4000)]
    public string? ReviewNotes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public Message? Message { get; set; }
    public User? Sender { get; set; }
    public User? Recipient { get; set; }
    public User? ReviewedBy { get; set; }
}

public class SafeguardingReport : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int ReporterUserId { get; set; }
    public int? SubjectUserId { get; set; }
    public int? SubjectOrganisationId { get; set; }

    [MaxLength(60)]
    public string Category { get; set; } = "other";

    [MaxLength(20)]
    public string Severity { get; set; } = "medium";

    public string Description { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? EvidenceUrl { get; set; }

    [MaxLength(30)]
    public string Status { get; set; } = "submitted";

    public int? AssignedToUserId { get; set; }
    public DateTime? ReviewDueAt { get; set; }
    public bool Escalated { get; set; }
    public DateTime? EscalatedAt { get; set; }
    public string? ResolutionNotes { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Reporter { get; set; }
    public User? SubjectUser { get; set; }
    public User? AssignedTo { get; set; }
    public ICollection<SafeguardingReportAction> Actions { get; set; } = new List<SafeguardingReportAction>();
}

public class SafeguardingReportAction : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long ReportId { get; set; }
    public int ActorUserId { get; set; }

    [MaxLength(30)]
    public string Action { get; set; } = "created";

    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public SafeguardingReport? Report { get; set; }
    public User? ActorUser { get; set; }
}

public class BrokerRiskTag : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ListingId { get; set; }

    [MaxLength(30)]
    public string RiskLevel { get; set; } = "medium";

    [MaxLength(120)]
    public string RiskType { get; set; } = "manual";

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public Listing? Listing { get; set; }
    public User? CreatedBy { get; set; }
}

public class UserMonitoringRestriction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public bool UnderMonitoring { get; set; } = true;
    public bool RequiresBrokerApproval { get; set; }
    public bool MessagingDisabled { get; set; }
    public DateTime? MonitoringExpiresAt { get; set; }

    [MaxLength(2000)]
    public string? Reason { get; set; }

    public int? SetByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? SetBy { get; set; }
}
