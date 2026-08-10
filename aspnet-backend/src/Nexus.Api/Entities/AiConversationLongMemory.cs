// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Rolling AI-generated summary of older messages in a conversation.
/// Compressed by <c>ConversationSummariser</c> once the live tail exceeds
/// the token budget. Only messages with Id &gt; <see cref="SummaryWatermarkMessageId"/>
/// are replayed verbatim — older turns are represented by <see cref="Summary"/>.
/// </summary>
public class AiConversationLongMemory : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ConversationId { get; set; }

    /// <summary>Plain-text rolling summary.</summary>
    public string Summary { get; set; } = string.Empty;

    /// <summary>Highest AiMessage.Id absorbed into <see cref="Summary"/>.</summary>
    public int SummaryWatermarkMessageId { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public AiConversation? Conversation { get; set; }
    public Tenant? Tenant { get; set; }
}
