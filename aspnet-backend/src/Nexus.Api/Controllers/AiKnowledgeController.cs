// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Ai;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
public class AiKnowledgeController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly PlatformChatAgent _agent;
    private readonly AiKnowledgeService _knowledge;
    private readonly KnowledgeIndexerService _indexer;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AiKnowledgeController> _logger;

    public AiKnowledgeController(
        NexusDbContext db,
        PlatformChatAgent agent,
        AiKnowledgeService knowledge,
        KnowledgeIndexerService indexer,
        TenantContext tenantContext,
        ILogger<AiKnowledgeController> logger)
    {
        _db = db;
        _agent = agent;
        _knowledge = knowledge;
        _indexer = indexer;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public record PlatformChatBody(int ConversationId, string Message);
    public record FeedbackBody(int Score, string? Comment, string? ReasonCode);

    // ─── Platform-aware chat ──────────────────────────────────────────────

    [HttpPost("/api/ai/chat/platform")]
    public async Task<IActionResult> Chat([FromBody] PlatformChatBody body, CancellationToken ct)
    {
        if (body == null || string.IsNullOrWhiteSpace(body.Message))
            return BadRequest(new { error = "message_required" });
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(new { error = "invalid_token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var resp = await _agent.SendAsync(new PlatformChatRequest(body.ConversationId, body.Message), userId, tenantId, ct);
        if (resp.RateLimited) return StatusCode(StatusCodes.Status429TooManyRequests, resp);
        return Ok(resp);
    }

    // ─── Per-message feedback ─────────────────────────────────────────────

    [HttpPost("/api/ai/messages/{id:int}/feedback")]
    public async Task<IActionResult> Feedback(int id, [FromBody] FeedbackBody body, CancellationToken ct)
    {
        if (body == null || (body.Score != 1 && body.Score != -1))
            return BadRequest(new { error = "score_must_be_plus_or_minus_1" });
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var msg = await _db.AiMessages.IgnoreQueryFilters()
            .FirstOrDefaultAsync(m => m.Id == id && m.TenantId == tenantId, ct);
        if (msg == null) return NotFound();

        var existing = await _db.AiMessageFeedbacks.IgnoreQueryFilters()
            .FirstOrDefaultAsync(f => f.TenantId == tenantId && f.AiMessageId == id && f.UserId == userId, ct);
        if (existing == null)
        {
            existing = new AiMessageFeedback
            {
                TenantId = tenantId,
                AiMessageId = id,
                UserId = userId,
                Score = body.Score,
                Comment = body.Comment,
                ReasonCode = body.ReasonCode
            };
            _db.AiMessageFeedbacks.Add(existing);
        }
        else
        {
            existing.Score = body.Score;
            existing.Comment = body.Comment;
            existing.ReasonCode = body.ReasonCode;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(new { id = existing.Id, existing.Score, existing.ReasonCode });
    }

    // ─── Direct semantic search (debug + admin tooling) ───────────────────

    [HttpGet("/api/ai/knowledge/search")]
    public async Task<IActionResult> Search([FromQuery] string q, [FromQuery] int limit = 8, [FromQuery] string? types = null, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(q)) return BadRequest(new { error = "q_required" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (limit < 1) limit = 1; if (limit > 25) limit = 25;

        var typeList = string.IsNullOrWhiteSpace(types)
            ? null
            : (IReadOnlyCollection<string>)types.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var hits = await _knowledge.SearchAsync(tenantId, q, limit, typeList, ct);
        return Ok(new { hits });
    }

    // ─── Admin: trigger reindex ───────────────────────────────────────────

    [HttpPost("/api/admin/ai/knowledge/reindex")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Reindex(CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var report = await _indexer.ReindexTenantAsync(tenantId, ct);
        await _indexer.FlushAsync(ct);
        return Ok(report);
    }

    // ─── Admin: AI quality dashboard ──────────────────────────────────────

    [HttpGet("/api/admin/ai/quality")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Quality([FromQuery] int days = 30, CancellationToken ct = default)
    {
        if (days < 1) days = 1; if (days > 365) days = 365;
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var since = DateTime.UtcNow.AddDays(-days);

        // Feedback aggregates
        var feedback = await _db.AiMessageFeedbacks.IgnoreQueryFilters()
            .Where(f => f.TenantId == tenantId && f.CreatedAt >= since)
            .GroupBy(f => f.Score)
            .Select(g => new { Score = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var up = feedback.FirstOrDefault(x => x.Score == 1)?.Count ?? 0;
        var down = feedback.FirstOrDefault(x => x.Score == -1)?.Count ?? 0;
        var totalFb = up + down;
        var approvalRate = totalFb == 0 ? (double?)null : Math.Round((double)up / totalFb, 3);

        // Audit aggregates
        var audits = await _db.AiRequestAuditLogs.IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.CreatedAt >= since)
            .Select(a => new { a.Outcome, a.LatencyMs, a.InputTokens, a.OutputTokens, a.RetrievedChunkCount })
            .ToListAsync(ct);
        var ok = audits.Count(a => a.Outcome == "ok");
        var blocked = audits.Count(a => a.Outcome == "blocked");
        var rateLimited = audits.Count(a => a.Outcome == "rate_limited");
        var providerErrors = audits.Count(a => a.Outcome == "provider_error");
        var avgLatency = audits.Count == 0 ? 0 : (int)audits.Average(a => a.LatencyMs);
        var totalIn = audits.Sum(a => (long)a.InputTokens);
        var totalOut = audits.Sum(a => (long)a.OutputTokens);
        var avgRetrieved = audits.Count == 0 ? 0.0 : Math.Round(audits.Average(a => a.RetrievedChunkCount), 2);

        // Top negative reason codes
        var topNegReasons = await _db.AiMessageFeedbacks.IgnoreQueryFilters()
            .Where(f => f.TenantId == tenantId && f.CreatedAt >= since && f.Score == -1 && f.ReasonCode != null)
            .GroupBy(f => f.ReasonCode)
            .Select(g => new { reason = g.Key, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(10)
            .ToListAsync(ct);

        var indexSize = await _db.KnowledgeChunks.IgnoreQueryFilters()
            .CountAsync(c => c.TenantId == tenantId, ct);

        return Ok(new
        {
            window_days = days,
            feedback = new { thumbs_up = up, thumbs_down = down, approval_rate = approvalRate },
            audit = new
            {
                requests = audits.Count,
                ok,
                blocked,
                rate_limited = rateLimited,
                provider_errors = providerErrors,
                avg_latency_ms = avgLatency,
                total_input_tokens = totalIn,
                total_output_tokens = totalOut,
                avg_retrieved = avgRetrieved
            },
            top_negative_reasons = topNegReasons,
            knowledge_index_size = indexSize
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    // Laravel parity: GET /api/v2/admin/ai-traces/metrics?days=30
    [HttpGet("/api/admin/ai-traces/metrics")]
    [HttpGet("/api/v2/admin/ai-traces/metrics")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> TraceMetrics([FromQuery] int days = 30, CancellationToken ct = default)
    {
        if (days < 1) days = 1;
        if (days > 365) days = 365;

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var since = DateTime.UtcNow.AddDays(-days);

        var traces = await _db.AiRequestAuditLogs.IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.CreatedAt >= since)
            .Select(a => new
            {
                a.Id,
                a.Model,
                a.InputTokens,
                a.OutputTokens,
                a.LatencyMs,
                a.ToolsInvoked,
                a.CreatedAt
            })
            .ToListAsync(ct);

        var feedback = await _db.AiMessageFeedbacks.IgnoreQueryFilters()
            .Where(f => f.TenantId == tenantId && f.CreatedAt >= since)
            .Select(f => new
            {
                f.Id,
                f.Score,
                f.Comment,
                f.CreatedAt
            })
            .ToListAsync(ct);

        var topTools = traces
            .OrderByDescending(t => t.CreatedAt)
            .Take(2000)
            .SelectMany(t => SplitToolNames(t.ToolsInvoked))
            .GroupBy(name => name)
            .Select(g => new { name = g.Key, calls = g.Count() })
            .OrderByDescending(tool => tool.calls)
            .ThenBy(tool => tool.name)
            .Take(10)
            .ToList();

        var unanswered = feedback
            .Where(f => f.Score == -1)
            .OrderByDescending(f => f.CreatedAt)
            .Take(20)
            .Select(f => new
            {
                id = f.Id,
                user_text = string.Empty,
                assistant_text = string.Empty,
                note = f.Comment,
                at = f.CreatedAt,
                model = (string?)null
            })
            .ToList();

        var costUsd = traces.Sum(t => EstimateAiTraceCost(t.Model, t.InputTokens, t.OutputTokens));
        var totalTokens = traces.Sum(t => (long)t.InputTokens + t.OutputTokens);
        var avgLatency = traces.Count == 0 ? 0 : (int)Math.Round(traces.Average(t => t.LatencyMs));

        return Ok(new
        {
            data = new
            {
                window_days = days,
                turns = traces.Count,
                tokens_total = totalTokens,
                cost_usd = Math.Round(costUsd, 6),
                avg_latency_ms = avgLatency,
                thumbs_up = feedback.Count(f => f.Score == 1),
                thumbs_down = feedback.Count(f => f.Score == -1),
                top_tools = topTools,
                unanswered
            }
        });
    }

    private int GetUserId()
    {
        var idClaim = User.FindFirst("sub")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(idClaim, out var id) ? id : 0;
    }

    private static IEnumerable<string> SplitToolNames(string? toolsInvoked)
    {
        if (string.IsNullOrWhiteSpace(toolsInvoked))
            return [];

        return toolsInvoked
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(name => name.Length > 0);
    }

    private static double EstimateAiTraceCost(string? model, int inputTokens, int outputTokens)
    {
        var pricing = model switch
        {
            "gpt-4o-mini" => (Input: 0.00015, Output: 0.0006),
            "gpt-4o" => (Input: 0.0025, Output: 0.010),
            "gpt-4-turbo" => (Input: 0.010, Output: 0.030),
            "claude-3-5-sonnet-20241022" => (Input: 0.003, Output: 0.015),
            "claude-sonnet-4-6" => (Input: 0.003, Output: 0.015),
            "claude-haiku-4-5-20251001" => (Input: 0.0008, Output: 0.004),
            "gemini-1.5-flash" => (Input: 0.000075, Output: 0.0003),
            "gemini-1.5-pro" => (Input: 0.00125, Output: 0.005),
            _ => (Input: 0.0, Output: 0.0)
        };

        return Math.Round(
            inputTokens / 1000.0 * pricing.Input + outputTokens / 1000.0 * pricing.Output,
            6);
    }
}
