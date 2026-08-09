// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Log of all sent emails for tracking and debugging.
/// </summary>
public class EmailLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int? UserId { get; set; }
    public string ToEmail { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string TemplateKey { get; set; } = string.Empty;
    public string Provider { get; set; } = "local";
    public string? ProviderMessageId { get; set; }
    public string? IdempotencyKey { get; set; }
    public string? Source { get; set; }
    public EmailSendStatus Status { get; set; } = EmailSendStatus.Pending;
    public string? ErrorMessage { get; set; }
    public int RetryCount { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

public enum EmailSendStatus
{
    Pending,
    Sent,
    Failed,
    Bounced
}
