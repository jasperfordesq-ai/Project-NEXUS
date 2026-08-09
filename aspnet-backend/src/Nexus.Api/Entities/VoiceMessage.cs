// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Voice message attachment in conversations. Tenant-scoped.
/// </summary>
public class VoiceMessage : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int SenderId { get; set; }
    public int? ConversationId { get; set; }

    /// <summary>
    /// URL to stored audio file.
    /// </summary>
    public string AudioUrl { get; set; } = string.Empty;

    /// <summary>
    /// Duration in seconds.
    /// </summary>
    public int DurationSeconds { get; set; }

    /// <summary>
    /// File size in bytes.
    /// </summary>
    public long FileSizeBytes { get; set; }

    /// <summary>
    /// Audio format: webm, ogg, mp3
    /// </summary>
    public string Format { get; set; } = "webm";

    /// <summary>
    /// Optional AI-generated transcription.
    /// </summary>
    public string? Transcription { get; set; }

    public bool IsRead { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? Sender { get; set; }
    public Conversation? Conversation { get; set; }
}
