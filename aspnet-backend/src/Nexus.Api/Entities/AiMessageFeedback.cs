// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// User feedback on a specific assistant message (thumbs up / thumbs down
/// with an optional comment). Powers the admin AI quality dashboard.
/// </summary>
public class AiMessageFeedback : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int AiMessageId { get; set; }
    public int UserId { get; set; }

    /// <summary>+1 (thumbs up) or -1 (thumbs down).</summary>
    public int Score { get; set; }

    public string? Comment { get; set; }

    /// <summary>Short machine-readable reason e.g. "wrong_answer", "off_topic".</summary>
    public string? ReasonCode { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public AiMessage? AiMessage { get; set; }
    public User? User { get; set; }
    public Tenant? Tenant { get; set; }
}
