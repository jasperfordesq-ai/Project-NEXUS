// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Cookie consent controller - public consent recording and admin policy management.
/// Phase 32: Cookie Consent system.
/// </summary>
[ApiController]
public class CookieConsentController : ControllerBase
{
    private readonly CookieConsentService _cookieConsentService;
    private readonly ILogger<CookieConsentController> _logger;

    public CookieConsentController(
        CookieConsentService cookieConsentService,
        ILogger<CookieConsentController> logger)
    {
        _cookieConsentService = cookieConsentService;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    #region Public Endpoints

    /// <summary>
    /// POST /api/cookies/consent - Record cookie consent.
    /// No authentication required (supports anonymous visitors).
    /// </summary>
    [HttpPost("api/cookies/consent")]
    [AllowAnonymous]
    public async Task<IActionResult> RecordConsent([FromBody] RecordConsentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.SessionId))
            return BadRequest(new { error = "Session ID is required" });

        try
        {
            var userId = GetCurrentUserId();
            var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString();
            var userAgent = Request.Headers.UserAgent.FirstOrDefault();

            var consent = await _cookieConsentService.RecordConsentAsync(
                userId,
                request.SessionId,
                request.AnalyticsCookies,
                request.MarketingCookies,
                request.PreferenceCookies,
                ipAddress,
                userAgent);

            return Ok(MapConsent(consent));
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Database error while recording cookie consent");
            return StatusCode(500, new { error = "Failed to record consent" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Unexpected error in RecordConsent operation");
            return StatusCode(500, new { error = "Failed to record consent" });
        }
    }

    /// <summary>
    /// GET /api/cookies/consent - Get current cookie consent.
    /// Looks up by authenticated user ID or session_id query parameter.
    /// </summary>
    [HttpGet("api/cookies/consent")]
    [AllowAnonymous]
    public async Task<IActionResult> GetConsent([FromQuery] string? session_id = null)
    {
        try
        {
            var userId = GetCurrentUserId();

            var consent = await _cookieConsentService.GetConsentAsync(userId, session_id);
            if (consent == null)
            {
                return NotFound(new { error = "No consent record found" });
            }

            return Ok(MapConsent(consent));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Invalid operation while retrieving cookie consent");
            return BadRequest(new { error = ex.Message });
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Unexpected error in GetConsent operation");
            return StatusCode(500, new { error = "Failed to retrieve consent" });
        }
    }

    /// <summary>
    /// PUT /api/cookies/consent - Update cookie consent.
    /// Creates a new consent record for audit trail.
    /// </summary>
    [HttpPut("api/cookies/consent")]
    [AllowAnonymous]
    public async Task<IActionResult> UpdateConsent([FromBody] UpdateConsentRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();

            var consent = await _cookieConsentService.UpdateConsentAsync(
                userId,
                request.SessionId,
                request.AnalyticsCookies,
                request.MarketingCookies,
                request.PreferenceCookies);

            if (consent == null)
            {
                return BadRequest(new { error = "Unable to update consent. Provide userId or sessionId." });
            }

            return Ok(MapConsent(consent));
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Database error while updating cookie consent");
            return StatusCode(500, new { error = "Failed to update consent" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Unexpected error in UpdateConsent operation");
            return StatusCode(500, new { error = "Failed to update consent" });
        }
    }

    /// <summary>
    /// GET /api/cookies/policy - Get the active cookie policy.
    /// </summary>
    [HttpGet("api/cookies/policy")]
    [AllowAnonymous]
    public async Task<IActionResult> GetActivePolicy()
    {
        try
        {
            var policy = await _cookieConsentService.GetActivePolicyAsync();
            if (policy == null)
            {
                return NotFound(new { error = "No active cookie policy found" });
            }

            return Ok(new
            {
                policy.Id,
                policy.Version,
                content_html = policy.ContentHtml,
                is_active = policy.IsActive,
                published_at = policy.PublishedAt,
                created_at = policy.CreatedAt
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Invalid operation while retrieving cookie policy");
            return BadRequest(new { error = ex.Message });
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Unexpected error in GetActivePolicy operation");
            return StatusCode(500, new { error = "Failed to retrieve cookie policy" });
        }
    }

    #endregion

    #region Admin Endpoints

    /// <summary>
    /// POST /api/admin/cookies/policy - Create a new cookie policy version.
    /// Deactivates all previous versions.
    /// </summary>
    [HttpPost("api/admin/cookies/policy")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> CreatePolicyVersion([FromBody] CreatePolicyRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Version))
        {
            return BadRequest(new { error = "Version is required" });
        }
        if (string.IsNullOrWhiteSpace(request.ContentHtml))
        {
            return BadRequest(new { error = "Content HTML is required" });
        }

        try
        {
            var policy = await _cookieConsentService.CreatePolicyVersionAsync(
                request.Version, request.ContentHtml);

            return CreatedAtAction(nameof(GetActivePolicy), null, new
            {
                policy.Id,
                policy.Version,
                content_html = policy.ContentHtml,
                is_active = policy.IsActive,
                published_at = policy.PublishedAt,
                created_at = policy.CreatedAt
            });
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Database error while creating cookie policy version");
            return StatusCode(500, new { error = "Failed to create cookie policy" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Invalid operation while creating cookie policy version");
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/admin/cookies/stats - Get consent statistics.
    /// </summary>
    [HttpGet("api/admin/cookies/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetConsentStats()
    {
        try
        {
            var stats = await _cookieConsentService.GetConsentStatsAsync();

            return Ok(new
            {
                total_consents = stats.TotalConsents,
                analytics_percentage = stats.AnalyticsPercentage,
                marketing_percentage = stats.MarketingPercentage,
                preferences_percentage = stats.PreferencesPercentage
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Invalid operation while retrieving consent statistics");
            return BadRequest(new { error = ex.Message });
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Unexpected error in GetConsentStats operation");
            return StatusCode(500, new { error = "Failed to retrieve consent stats" });
        }
    }

    #endregion

    #region Helpers

    private static object MapConsent(Entities.CookieConsent c) => new
    {
        c.Id,
        user_id = c.UserId,
        session_id = c.SessionId,
        necessary_cookies = c.NecessaryCookies,
        analytics_cookies = c.AnalyticsCookies,
        marketing_cookies = c.MarketingCookies,
        preference_cookies = c.PreferenceCookies,
        consented_at = c.ConsentedAt,
        updated_at = c.UpdatedAt,
        created_at = c.CreatedAt
    };

    #endregion
}

#region Request DTOs

public class RecordConsentRequest
{
    [JsonPropertyName("session_id")]
    public string? SessionId { get; set; }

    [JsonPropertyName("analytics_cookies")]
    public bool AnalyticsCookies { get; set; }

    [JsonPropertyName("marketing_cookies")]
    public bool MarketingCookies { get; set; }

    [JsonPropertyName("preference_cookies")]
    public bool PreferenceCookies { get; set; }
}

public class UpdateConsentRequest
{
    [JsonPropertyName("session_id")]
    public string? SessionId { get; set; }

    [JsonPropertyName("analytics_cookies")]
    public bool? AnalyticsCookies { get; set; }

    [JsonPropertyName("marketing_cookies")]
    public bool? MarketingCookies { get; set; }

    [JsonPropertyName("preference_cookies")]
    public bool? PreferenceCookies { get; set; }
}

public class CreatePolicyRequest
{
    [JsonPropertyName("version")]
    public string Version { get; set; } = string.Empty;

    [JsonPropertyName("content_html")]
    public string ContentHtml { get; set; } = string.Empty;
}

#endregion
