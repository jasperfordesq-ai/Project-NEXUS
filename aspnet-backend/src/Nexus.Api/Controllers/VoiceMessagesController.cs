// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Voice message endpoints.
/// </summary>
[ApiController]
[Route("api/voice-messages")]
[Authorize]
public class VoiceMessagesController : ControllerBase
{
    private readonly VoiceMessageService _voiceMessages;

    public VoiceMessagesController(VoiceMessageService voiceMessages)
    {
        _voiceMessages = voiceMessages;
    }

    /// <summary>
    /// GET /api/voice-messages/conversation/{conversationId} - List voice messages in a conversation.
    /// </summary>
    [HttpGet("conversation/{conversationId}")]
    public async Task<IActionResult> GetConversationMessages(int conversationId, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var messages = await _voiceMessages.GetConversationVoiceMessagesAsync(conversationId, page, limit);
        return Ok(new
        {
            data = messages.Select(m => MapVoiceMessage(m))
        });
    }

    /// <summary>
    /// GET /api/voice-messages/{id} - Get voice message details.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetMessage(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var msg = await _voiceMessages.GetByIdAsync(id);
        if (msg == null) return NotFound(new { error = "Voice message not found" });
        return Ok(new { data = MapVoiceMessage(msg) });
    }

    /// <summary>
    /// POST /api/voice-messages - Send a voice message.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateVoiceMessageRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (msg, error) = await _voiceMessages.CreateAsync(
            userId.Value, request.ConversationId, request.AudioUrl,
            request.DurationSeconds, request.FileSizeBytes, request.Format ?? "webm");

        if (error != null) return BadRequest(new { error });
        return Created($"/api/voice-messages/{msg!.Id}", new { data = MapVoiceMessage(msg) });
    }

    /// <summary>
    /// PUT /api/voice-messages/{id}/read - Mark as read.
    /// </summary>
    [HttpPut("{id:int}/read")]
    public async Task<IActionResult> MarkAsRead(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _voiceMessages.MarkAsReadAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Marked as read" });
    }

    /// <summary>
    /// DELETE /api/voice-messages/{id} - Delete voice message.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _voiceMessages.DeleteAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Voice message deleted" });
    }

    private static object MapVoiceMessage(Entities.VoiceMessage m) => new
    {
        m.Id,
        sender_id = m.SenderId,
        conversation_id = m.ConversationId,
        audio_url = m.AudioUrl,
        duration_seconds = m.DurationSeconds,
        file_size_bytes = m.FileSizeBytes,
        m.Format,
        m.Transcription,
        is_read = m.IsRead,
        created_at = m.CreatedAt,
        sender = m.Sender != null ? new { m.Sender.Id, m.Sender.FirstName, m.Sender.LastName } : null
    };
}

public class CreateVoiceMessageRequest
{
    [JsonPropertyName("conversation_id")] public int ConversationId { get; set; }
    [JsonPropertyName("audio_url")] public string AudioUrl { get; set; } = string.Empty;
    [JsonPropertyName("duration_seconds")] public int DurationSeconds { get; set; }
    [JsonPropertyName("file_size_bytes")] public long FileSizeBytes { get; set; }
    [JsonPropertyName("format")] public string? Format { get; set; }
}
