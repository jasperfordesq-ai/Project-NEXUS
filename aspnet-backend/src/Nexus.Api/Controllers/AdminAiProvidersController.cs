// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Diagnostics;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Middleware;
using Nexus.Api.Services.Ai;

namespace Nexus.Api.Controllers;

/// <summary>
/// Phase 69 — admin endpoints for the AI multi-provider layer.
/// Exposes which provider is active, which are configured, and runs a
/// quick chat round-trip for testing.
/// </summary>
[ApiController]
[Route("api/admin/ai/providers")]
[Authorize(Policy = "AdminOnly")]
public class AdminAiProvidersController : ControllerBase
{
    private readonly IAiProviderFactory _factory;
    private readonly ILogger<AdminAiProvidersController> _logger;

    public AdminAiProvidersController(IAiProviderFactory factory, ILogger<AdminAiProvidersController> logger)
    {
        _factory = factory;
        _logger = logger;
    }

    /// <summary>List all available providers + which is currently active.</summary>
    [HttpGet]
    public IActionResult List()
    {
        var active = _factory.Resolve();
        var rows = _factory.All.Select(p => new
        {
            name = p.Name,
            is_configured = p.IsConfigured,
            is_active = p.Name == active.Name
        });
        return Ok(new { data = rows, active = active.Name });
    }

    /// <summary>
    /// Run a quick test prompt against a specific provider (or the active one).
    /// Surfaces transport errors as JSON instead of 500s so the admin UI can
    /// display them inline.
    /// </summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test([FromBody] TestRequest req, CancellationToken ct)
    {
        var providerName = string.IsNullOrWhiteSpace(req.Provider) ? null : req.Provider.ToLowerInvariant();
        var provider = providerName == null
            ? _factory.Resolve()
            : _factory.All.FirstOrDefault(p => p.Name == providerName) ?? _factory.Resolve();

        if (!provider.IsConfigured)
            return Ok(new { ok = false, provider = provider.Name, error = "provider_not_configured" });

        try
        {
            var response = await provider.ChatAsync(
                systemPrompt: req.SystemPrompt ?? "You are a helpful assistant. Reply concisely.",
                userPrompt: req.UserPrompt ?? "Reply with the single word OK.",
                ct: ct);
            return Ok(new { ok = true, provider = provider.Name, response });
        }
        catch (AiProviderException ex)
        {
            _logger.LogWarning(ex, "AI provider test failed for {Provider}", provider.Name);
            return Ok(new { ok = false, provider = provider.Name, error = ex.Message });
        }
    }

    /// <summary>
    /// Laravel-compatible provider connection test. This operation is kept on
    /// the member-facing AI route because that is where the canonical admin UI
    /// calls it, but it remains admin-only and spends real provider credit.
    /// </summary>
    [HttpPost("/api/ai/test-provider")]
    [HttpPost("/api/v2/ai/test-provider")]
    [EnableRateLimiting(RateLimitingExtensions.AiProviderTestPolicy)]
    public async Task<IActionResult> TestLaravelProvider([FromBody] LaravelTestRequest? req, CancellationToken ct)
    {
        var providerName = string.IsNullOrWhiteSpace(req?.Provider)
            ? "gemini"
            : req.Provider.Trim().ToLowerInvariant();
        var provider = _factory.All.FirstOrDefault(p =>
            string.Equals(p.Name, providerName, StringComparison.OrdinalIgnoreCase));

        if (provider is null || !provider.IsConfigured)
        {
            return Ok(new
            {
                data = new
                {
                    success = false,
                    message = "AI provider connection test failed."
                }
            });
        }

        var timer = Stopwatch.StartNew();
        try
        {
            await provider.ChatAsync(
                systemPrompt: "You are a connection test. Reply concisely.",
                userPrompt: "Reply with the single word OK.",
                ct: ct);
            timer.Stop();

            return Ok(new
            {
                data = new
                {
                    success = true,
                    message = "AI provider connection test succeeded.",
                    latency_ms = (int)Math.Round(timer.Elapsed.TotalMilliseconds)
                }
            });
        }
        catch (Exception ex)
        {
            timer.Stop();
            _logger.LogWarning(ex, "Laravel-compatible AI provider test failed for {Provider}", provider.Name);
            return Ok(new
            {
                data = new
                {
                    success = false,
                    message = "AI provider connection test failed."
                }
            });
        }
    }

    public class TestRequest
    {
        [JsonPropertyName("provider")] public string? Provider { get; set; }
        [JsonPropertyName("system_prompt")] public string? SystemPrompt { get; set; }
        [JsonPropertyName("user_prompt")] public string? UserPrompt { get; set; }
    }

    public class LaravelTestRequest
    {
        [JsonPropertyName("provider")] public string? Provider { get; set; }
    }
}

/// <summary>
/// Phase 69 — endpoints exposing the named agents that ship on top of the
/// AI multi-provider abstraction.
/// </summary>
[ApiController]
[Route("api/admin/ai/agents")]
[Authorize(Policy = "AdminOnly")]
public class AdminAiAgentsController : ControllerBase
{
    private readonly ActivitySummariserAgent _activitySummariser;
    private readonly NudgeDrafterAgent _nudgeDrafter;

    public AdminAiAgentsController(ActivitySummariserAgent activitySummariser, NudgeDrafterAgent nudgeDrafter)
    {
        _activitySummariser = activitySummariser;
        _nudgeDrafter = nudgeDrafter;
    }

    /// <summary>POST /api/admin/ai/agents/activity-summary — summarise a user's recent activity.</summary>
    [HttpPost("activity-summary")]
    public async Task<IActionResult> ActivitySummary([FromQuery] int userId, [FromQuery] int days = 30, CancellationToken ct = default)
    {
        if (userId <= 0) return BadRequest(new { error = "userId required" });
        var summary = await _activitySummariser.SummariseUserActivityAsync(userId, Math.Clamp(days, 1, 365), ct);
        return Ok(new { user_id = userId, days, summary });
    }

    /// <summary>POST /api/admin/ai/agents/nudge — draft a re-engagement nudge for a stale user.</summary>
    [HttpPost("nudge")]
    public async Task<IActionResult> Nudge([FromQuery] int userId, CancellationToken ct = default)
    {
        if (userId <= 0) return BadRequest(new { error = "userId required" });
        var draft = await _nudgeDrafter.DraftReEngagementNudgeAsync(userId, ct);
        return Ok(new { user_id = userId, draft });
    }
}
