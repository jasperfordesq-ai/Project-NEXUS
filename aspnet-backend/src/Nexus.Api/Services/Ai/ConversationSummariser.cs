// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Keeps long conversations within token budget by compressing the oldest
/// messages into a rolling summary. The orchestrator replays only
/// <see cref="AiConversationLongMemory.Summary"/> + the tail of messages
/// with Id &gt; the watermark.
/// </summary>
public class ConversationSummariser
{
    private readonly NexusDbContext _db;
    private readonly IAiProviderFactory _providerFactory;
    private readonly ILogger<ConversationSummariser> _logger;

    private const int TailKeepCount = 6;
    private const int CompressThresholdChars = 8000;

    public ConversationSummariser(NexusDbContext db, IAiProviderFactory providerFactory, ILogger<ConversationSummariser> logger)
    {
        _db = db;
        _providerFactory = providerFactory;
        _logger = logger;
    }

    public async Task<AiConversationLongMemory?> EnsureCompressedAsync(int conversationId, int tenantId, CancellationToken ct = default)
    {
        var existing = await _db.AiConversationLongMemories.IgnoreQueryFilters()
            .FirstOrDefaultAsync(m => m.TenantId == tenantId && m.ConversationId == conversationId, ct);

        var watermark = existing?.SummaryWatermarkMessageId ?? 0;

        var unsummarised = await _db.AiMessages.IgnoreQueryFilters()
            .Where(m => m.TenantId == tenantId && m.ConversationId == conversationId && m.Id > watermark)
            .OrderBy(m => m.Id)
            .Select(m => new { m.Id, m.Role, m.Content })
            .ToListAsync(ct);

        if (unsummarised.Count <= TailKeepCount) return existing;
        var totalLen = unsummarised.Sum(m => m.Content?.Length ?? 0);
        if (totalLen < CompressThresholdChars) return existing;

        // Compress everything older than the last TailKeepCount messages.
        var toCompress = unsummarised.Take(unsummarised.Count - TailKeepCount).ToList();
        var compressedUpTo = toCompress[^1].Id;

        var sb = new System.Text.StringBuilder();
        if (existing != null && !string.IsNullOrWhiteSpace(existing.Summary))
            sb.Append("Previous summary:\n").Append(existing.Summary).Append("\n\nNew messages to fold in:\n");
        foreach (var m in toCompress)
            sb.Append('[').Append(m.Role).Append("] ").Append(m.Content).Append('\n');

        var system = "You compress conversation transcripts into a tight bullet list summary. " +
                     "Preserve concrete facts, names, requests, decisions. Drop pleasantries and meta-talk. " +
                     "Output at most ~200 words, plain text, no markdown headings.";

        string summary;
        try
        {
            var provider = _providerFactory.Resolve();
            summary = await provider.ChatAsync(system, sb.ToString(), ct);
            if (string.IsNullOrWhiteSpace(summary))
                summary = existing?.Summary ?? "(no summary available)";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Conversation summariser failed for conversation {ConversationId}", conversationId);
            return existing;
        }

        if (existing == null)
        {
            existing = new AiConversationLongMemory
            {
                TenantId = tenantId,
                ConversationId = conversationId,
                Summary = summary,
                SummaryWatermarkMessageId = compressedUpTo,
                UpdatedAt = DateTime.UtcNow
            };
            _db.AiConversationLongMemories.Add(existing);
        }
        else
        {
            existing.Summary = summary;
            existing.SummaryWatermarkMessageId = compressedUpTo;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync(ct);
        return existing;
    }
}
