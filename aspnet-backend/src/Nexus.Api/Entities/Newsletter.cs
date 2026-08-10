// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a newsletter created by an admin for distribution to subscribers.
/// Phase 31: Newsletter system.
/// </summary>
public class Newsletter : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [Required]
    [MaxLength(500)]
    public string Subject { get; set; } = string.Empty;

    /// <summary>
    /// HTML content of the newsletter.
    /// </summary>
    [Required]
    [Column(TypeName = "text")]
    public string ContentHtml { get; set; } = string.Empty;

    /// <summary>
    /// Plain text version of the newsletter content.
    /// </summary>
    [Column(TypeName = "text")]
    public string? ContentText { get; set; }

    public NewsletterStatus Status { get; set; } = NewsletterStatus.Draft;

    /// <summary>
    /// When the newsletter is scheduled to be sent.
    /// </summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>
    /// When the newsletter was actually sent.
    /// </summary>
    public DateTime? SentAt { get; set; }

    /// <summary>
    /// The admin user who created this newsletter.
    /// </summary>
    public int CreatedById { get; set; }

    /// <summary>
    /// Number of recipients the newsletter was sent to.
    /// </summary>
    public int RecipientCount { get; set; }

    /// <summary>
    /// Number of times the newsletter was opened.
    /// </summary>
    public int OpenCount { get; set; }

    /// <summary>
    /// Number of link clicks in the newsletter.
    /// </summary>
    public int ClickCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
}

/// <summary>
/// Newsletter lifecycle states.
/// </summary>
public enum NewsletterStatus
{
    Draft,
    Scheduled,
    Queued,     // Enqueued for dispatch; actual email sending not yet complete
    Sending,
    Sent,
    Cancelled
}
