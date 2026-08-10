// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 69 — agent runner with two named agents for V1 parity.
 *
 *   - ActivitySummariserAgent — summarises a member's recent platform
 *     activity into a short paragraph. V1 source: ActivitySummariserAgent.php.
 *   - NudgeDrafterAgent — drafts a short re-engagement nudge for a stale
 *     member. V1 source: NudgeDrafterAgent.php.
 *
 * Each agent is just a typed prompt + response shape on top of IAiProvider.
 * Future agents (CoordinatorRouter, TandemMatchmaker) plug into the same
 * pattern. There is no agent registry / DAG yet — each agent is a class.
 *
 * Caring Community / Marketplace agents are intentionally not ported.
 */

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Services.Ai;

public abstract class BaseAgent
{
    protected readonly IAiProviderFactory ProviderFactory;
    protected readonly ILogger Logger;

    protected BaseAgent(IAiProviderFactory providerFactory, ILogger logger)
    {
        ProviderFactory = providerFactory;
        Logger = logger;
    }

    public abstract string Name { get; }

    protected async Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct)
    {
        var provider = ProviderFactory.Resolve();
        Logger.LogInformation("Agent {Agent} dispatching via provider {Provider}", Name, provider.Name);
        try
        {
            return await provider.ChatAsync(systemPrompt, userPrompt, ct);
        }
        catch (AiProviderException ex)
        {
            Logger.LogWarning(ex, "Agent {Agent} provider {Provider} failed", Name, provider.Name);
            return string.Empty;
        }
    }
}

// ─── ActivitySummariserAgent ────────────────────────────────────────────────

public class ActivitySummariserAgent : BaseAgent
{
    private readonly NexusDbContext _db;

    public ActivitySummariserAgent(IAiProviderFactory providerFactory, NexusDbContext db, ILogger<ActivitySummariserAgent> logger)
        : base(providerFactory, logger)
    {
        _db = db;
    }

    public override string Name => "ActivitySummariser";

    /// <summary>
    /// Summarise the recent platform activity for a single member. Pulls a
    /// compact bullet list from the database and asks the active provider for
    /// a 2–3 sentence summary suitable for the admin CRM timeline.
    /// </summary>
    public async Task<string> SummariseUserActivityAsync(int userId, int dayWindow = 30, CancellationToken ct = default)
    {
        var since = DateTime.UtcNow.AddDays(-dayWindow);

        var listings = await _db.Listings
            .Where(l => l.UserId == userId && l.CreatedAt >= since)
            .OrderByDescending(l => l.CreatedAt).Take(5)
            .Select(l => new { l.Title, l.CreatedAt }).ToListAsync(ct);

        var transactions = await _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => (t.SenderId == userId || t.ReceiverId == userId) && t.CreatedAt >= since)
            .OrderByDescending(t => t.CreatedAt).Take(5)
            .Select(t => new { t.Amount, t.CreatedAt, role = t.SenderId == userId ? "spent" : "earned" }).ToListAsync(ct);

        var newConnections = await _db.Connections
            .CountAsync(c => (c.RequesterId == userId || c.AddresseeId == userId) && c.CreatedAt >= since, ct);

        if (listings.Count == 0 && transactions.Count == 0 && newConnections == 0)
            return $"No platform activity in the past {dayWindow} days.";

        var bullets = new List<string>();
        foreach (var l in listings) bullets.Add($"- Posted listing '{l.Title}' on {l.CreatedAt:yyyy-MM-dd}");
        foreach (var t in transactions) bullets.Add($"- {t.role} {t.Amount} hours on {t.CreatedAt:yyyy-MM-dd}");
        if (newConnections > 0) bullets.Add($"- {newConnections} new connection(s)");

        var systemPrompt = "You are an admin CRM assistant. Summarise a member's recent activity in 2–3 short sentences. Plain prose, no bullets, no markdown.";
        var userPrompt = $"Member activity in the last {dayWindow} days:\n" + string.Join("\n", bullets);

        var summary = await ChatAsync(systemPrompt, userPrompt, ct);
        return string.IsNullOrWhiteSpace(summary)
            ? $"Active member: {listings.Count} listings, {transactions.Count} transactions, {newConnections} new connections in the last {dayWindow} days."
            : summary.Trim();
    }
}

// ─── NudgeDrafterAgent ──────────────────────────────────────────────────────

public class NudgeDrafterAgent : BaseAgent
{
    private readonly NexusDbContext _db;

    public NudgeDrafterAgent(IAiProviderFactory providerFactory, NexusDbContext db, ILogger<NudgeDrafterAgent> logger)
        : base(providerFactory, logger)
    {
        _db = db;
    }

    public override string Name => "NudgeDrafter";

    /// <summary>
    /// Draft a short, friendly re-engagement message for a stale member.
    /// Returns a 1–2 sentence message body suitable for the admin to send via
    /// the messaging system. Intentionally does NOT send the message —
    /// admin reviews + dispatches.
    /// </summary>
    public async Task<string> DraftReEngagementNudgeAsync(int userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user == null) return string.Empty;

        var lastActive = user.LastLoginAt ?? user.CreatedAt;
        var inactiveDays = (DateTime.UtcNow - lastActive).Days;

        var systemPrompt = "You are a community coordinator. Draft a short, warm re-engagement message (1–2 sentences max, no greeting, no signature, no markdown). Tone: friendly, low-pressure, inviting.";
        var userPrompt = $"Member name: {user.FirstName}\nLast active: {inactiveDays} days ago\n";

        var draft = await ChatAsync(systemPrompt, userPrompt, ct);
        return string.IsNullOrWhiteSpace(draft)
            ? $"Hi {user.FirstName}, we'd love to see you back — anything we can help with?"
            : draft.Trim();
    }
}
