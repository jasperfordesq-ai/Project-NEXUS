// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for voice message management.
/// </summary>
public class VoiceMessageService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VoiceMessageService> _logger;

    private const int MaxDurationSeconds = 300; // 5 minutes
    private const long MaxFileSizeBytes = 10 * 1024 * 1024; // 10MB

    public VoiceMessageService(NexusDbContext db, TenantContext tenantContext, ILogger<VoiceMessageService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<List<VoiceMessage>> GetConversationVoiceMessagesAsync(int conversationId, int page = 1, int limit = 20)
    {
        return await _db.Set<VoiceMessage>()
            .Where(v => v.ConversationId == conversationId)
            .Include(v => v.Sender)
            .OrderByDescending(v => v.CreatedAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();
    }

    public async Task<VoiceMessage?> GetByIdAsync(int id)
    {
        return await _db.Set<VoiceMessage>()
            .Include(v => v.Sender)
            .FirstOrDefaultAsync(v => v.Id == id);
    }

    public async Task<(VoiceMessage? Msg, string? Error)> CreateAsync(
        int senderId, int conversationId, string audioUrl,
        int durationSeconds, long fileSizeBytes, string format)
    {
        if (durationSeconds > MaxDurationSeconds)
            return (null, $"Voice message too long. Maximum is {MaxDurationSeconds} seconds");
        if (fileSizeBytes > MaxFileSizeBytes)
            return (null, $"File too large. Maximum is {MaxFileSizeBytes / (1024 * 1024)}MB");

        var allowedFormats = new[] { "webm", "ogg", "mp3", "m4a", "wav" };
        if (!allowedFormats.Contains(format.ToLower()))
            return (null, $"Unsupported format. Allowed: {string.Join(", ", allowedFormats)}");

        var msg = new VoiceMessage
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            SenderId = senderId,
            ConversationId = conversationId,
            AudioUrl = audioUrl,
            DurationSeconds = durationSeconds,
            FileSizeBytes = fileSizeBytes,
            Format = format.ToLower()
        };

        _db.Set<VoiceMessage>().Add(msg);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Voice message {MsgId} sent by user {UserId}", msg.Id, senderId);
        return (msg, null);
    }

    public async Task<string?> MarkAsReadAsync(int id, int userId)
    {
        var msg = await _db.Set<VoiceMessage>().FirstOrDefaultAsync(x => x.Id == id);
        if (msg == null) return "Voice message not found";
        if (msg.SenderId == userId) return null; // Sender can't mark own as read

        msg.IsRead = true;
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<string?> DeleteAsync(int id, int userId)
    {
        var msg = await _db.Set<VoiceMessage>().FirstOrDefaultAsync(x => x.Id == id);
        if (msg == null) return "Voice message not found";
        if (msg.SenderId != userId) return "Not authorized";

        _db.Set<VoiceMessage>().Remove(msg);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<(VoiceMessage? Msg, string? Error)> SetTranscriptionAsync(int id, string transcription)
    {
        var msg = await _db.Set<VoiceMessage>().FirstOrDefaultAsync(x => x.Id == id);
        if (msg == null) return (null, "Voice message not found");

        msg.Transcription = transcription;
        await _db.SaveChangesAsync();
        return (msg, null);
    }
}
