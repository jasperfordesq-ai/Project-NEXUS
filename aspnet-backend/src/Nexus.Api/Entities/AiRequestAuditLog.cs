// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// One row per AI request — successful or failed. Captures the provider,
/// model, token counts, retrieval depth, latency, and outcome so admins can
/// trace quality regressions and cost.
/// </summary>
public class AiRequestAuditLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int? UserId { get; set; }
    public int? ConversationId { get; set; }

    /// <summary>"chat", "search", "reindex", etc.</summary>
    public string RequestType { get; set; } = "chat";

    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;

    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public int LatencyMs { get; set; }
    public int RetrievedChunkCount { get; set; }

    /// <summary>Comma-separated tool names invoked, in order. Truncated to 512.</summary>
    public string? ToolsInvoked { get; set; }

    /// <summary>
    /// "ok" | "blocked" | "rate_limited" | "provider_error" | "not_found".
    /// </summary>
    public string Outcome { get; set; } = "ok";

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
}
