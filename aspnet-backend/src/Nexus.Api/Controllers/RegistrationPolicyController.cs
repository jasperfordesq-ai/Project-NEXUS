// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services.Registration;

namespace Nexus.Api.Controllers;

/// <summary>
/// Registration policy management — both public (for registration UI) and admin (for configuration).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/registration")]
[Route("api/registration")]
public class RegistrationPolicyController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly RegistrationOrchestrator _orchestrator;
    private readonly ProviderConfigEncryption _encryption;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<RegistrationPolicyController> _logger;
    private readonly IConfiguration _config;
    private readonly IHostEnvironment _env;

    public RegistrationPolicyController(
        NexusDbContext db,
        RegistrationOrchestrator orchestrator,
        ProviderConfigEncryption encryption,
        TenantContext tenantContext,
        ILogger<RegistrationPolicyController> logger,
        IConfiguration config,
        IHostEnvironment env)
    {
        _db = db;
        _orchestrator = orchestrator;
        _encryption = encryption;
        _tenantContext = tenantContext;
        _logger = logger;
        _config = config;
        _env = env;
    }

    // ─── PUBLIC ENDPOINTS (for registration UI) ───

    /// <summary>
    /// Get the public registration configuration for a tenant.
    /// Used by frontends to render the correct registration flow.
    /// Does NOT expose provider secrets or internal config.
    /// </summary>
    [HttpGet("config")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetPublicConfig([FromQuery] string? tenant_slug, [FromQuery] int? tenant_id)
    {
        int tenantId;

        if (_tenantContext.IsResolved && _tenantContext.TenantId.HasValue)
        {
            tenantId = _tenantContext.TenantId.Value;
        }
        else if (!string.IsNullOrEmpty(tenant_slug))
        {
            var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenant_slug);
            if (tenant == null) return NotFound(new { error = "Tenant not found" });
            tenantId = tenant.Id;
        }
        else if (tenant_id.HasValue)
        {
            tenantId = tenant_id.Value;
        }
        else
        {
            return BadRequest(new { error = "Tenant identifier required (tenant_slug or tenant_id)" });
        }

        var policy = await _orchestrator.GetPolicyAsync(tenantId);

        return Ok(new
        {
            success = true,
            data = new
            {
                mode = policy.Mode.ToString(),
                mode_value = (int)policy.Mode,
                requires_verification = policy.Mode is RegistrationMode.VerifiedIdentity or RegistrationMode.GovernmentId,
                requires_approval = policy.Mode == RegistrationMode.StandardWithApproval
                    || policy.PostVerificationAction == PostVerificationAction.SendToAdminForApproval,
                requires_invite = policy.Mode == RegistrationMode.InviteOnly,
                verification_level = policy.VerificationLevel.ToString(),
                provider_name = policy.Provider == VerificationProvider.Custom
                    ? policy.CustomProviderName
                    : policy.Provider != VerificationProvider.None
                        ? policy.Provider.ToString()
                        : null,
                registration_message = policy.RegistrationMessage
            }
        });
    }

    /// <summary>
    /// Start identity verification for a registered user who is in PendingVerification status.
    /// </summary>
    [HttpPost("verify/start")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> StartVerification()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var result = await _orchestrator.StartVerificationAsync(userId.Value, tenantId);

        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return Ok(new
        {
            success = true,
            data = new
            {
                session_id = result.Session!.Id,
                status = result.Session.Status.ToString(),
                redirect_url = result.ProviderResult!.RedirectUrl,
                sdk_token = result.ProviderResult.SdkToken,
                expires_at = result.Session.ExpiresAt
            }
        });
    }

    /// <summary>
    /// Get the current verification session status for the authenticated user.
    /// </summary>
    [HttpGet("verify/status")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetVerificationStatus()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var session = await _orchestrator.GetVerificationSessionAsync(userId.Value, tenantId);

        if (session == null)
            return NotFound(new { error = "No verification session found" });

        return Ok(new
        {
            success = true,
            data = new
            {
                session_id = session.Id,
                status = session.Status.ToString(),
                provider = session.Provider.ToString(),
                level = session.Level.ToString(),
                decision = session.ProviderDecision,
                decision_reason = session.DecisionReason,
                created_at = session.CreatedAt,
                completed_at = session.CompletedAt,
                expires_at = session.ExpiresAt
            }
        });
    }

    /// <summary>
    /// Retry identity verification for a user whose previous attempt failed or expired.
    /// Transitions the user from VerificationFailed back to PendingVerification and creates a new session.
    /// </summary>
    [HttpPost("verify/retry")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> RetryVerification()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var result = await _orchestrator.RetryVerificationAsync(userId.Value, tenantId);

        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return Ok(new
        {
            success = true,
            data = new
            {
                session_id = result.Session!.Id,
                status = result.Session.Status.ToString(),
                redirect_url = result.ProviderResult!.RedirectUrl,
                sdk_token = result.ProviderResult.SdkToken,
                expires_at = result.Session.ExpiresAt
            }
        });
    }

    /// <summary>
    /// Webhook callback endpoint for verification providers.
    /// </summary>
    [HttpPost("webhook/{tenantId:int}")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Webhook(int tenantId, [FromQuery] string? provider)
    {
        if (!Enum.TryParse<VerificationProvider>(provider, true, out var providerType))
        {
            return BadRequest(new { error = "Invalid provider" });
        }

        // Read raw body for signature verification (exact bytes required for HMAC).
        Request.EnableBuffering();
        Request.Body.Position = 0;
        using var reader = new StreamReader(Request.Body, Encoding.UTF8, leaveOpen: true);
        var rawBody = await reader.ReadToEndAsync();
        Request.Body.Position = 0;

        // HMAC-SHA256 verification of identity-provider webhook (CRITICAL audit fix).
        // Mirrors the Stripe pattern in Phase72Controllers.ReceiveDonationEvent.
        var signatureHeader = _config["Registration:WebhookSignatureHeader"] ?? "X-Provider-Signature";
        var perTenantSecret = _config[$"Registration:WebhookSecret:{tenantId}"];
        var fallbackSecret = _config["Registration:WebhookSecret"];
        var secret = !string.IsNullOrWhiteSpace(perTenantSecret) ? perTenantSecret : fallbackSecret;

        if (!string.IsNullOrWhiteSpace(secret))
        {
            var sig = Request.Headers[signatureHeader].FirstOrDefault();
            var (ok, reason) = VerifyProviderSignature(rawBody, sig, secret!);
            if (!ok)
            {
                _logger.LogWarning(
                    "Registration webhook signature rejected for tenant {TenantId} provider {Provider}: {Reason}",
                    tenantId, providerType, reason);
                return Unauthorized(new { error = "signature_invalid", reason });
            }
        }
        else if (_env.IsProduction())
        {
            // Production must never accept unsigned identity-provider webhooks — a
            // forged "verified" event would bypass KYC. Fail closed.
            _logger.LogError(
                "Registration webhook secret unset in Production for tenant {TenantId}. " +
                "Refusing payload. Set Registration:WebhookSecret:{TenantId} or Registration:WebhookSecret.",
                tenantId, tenantId);
            return StatusCode(503, new { error = "webhook_secret_unconfigured" });
        }
        else
        {
            _logger.LogWarning(
                "Registration webhook received without configured secret for tenant {TenantId} — " +
                "accepting payload (non-Production). Set Registration:WebhookSecret to enforce.",
                tenantId);
        }

        var headers = Request.Headers.ToDictionary(
            h => h.Key,
            h => h.Value.ToString());

        var payload = new WebhookPayload
        {
            RawBody = rawBody,
            Headers = headers
        };

        var success = await _orchestrator.ProcessWebhookAsync(tenantId, providerType, payload);

        if (!success)
            return BadRequest(new { error = "Webhook processing failed" });

        return Ok(new { success = true });
    }

    /// <summary>
    /// Verify a provider webhook signature. Supports two formats:
    /// (1) Stripe-style <c>t=&lt;unix-ts&gt;,v1=&lt;hex&gt;</c> with 5-min replay window.
    /// (2) Plain hex HMAC-SHA256 of the raw body (no replay protection).
    /// Returns (true, null) on success, (false, reason) on failure.
    /// </summary>
    public static (bool Ok, string? Reason) VerifyProviderSignature(string rawBody, string? signatureHeader, string secret)
    {
        if (string.IsNullOrWhiteSpace(signatureHeader)) return (false, "missing_signature_header");

        // Stripe-style header detection: contains "t=" and "v1="
        if (signatureHeader.Contains("t=", StringComparison.Ordinal) &&
            signatureHeader.Contains("v1=", StringComparison.Ordinal))
        {
            long? timestamp = null;
            var v1Sigs = new List<string>();
            foreach (var pair in signatureHeader.Split(','))
            {
                var eq = pair.IndexOf('=');
                if (eq <= 0) continue;
                var k = pair[..eq].Trim();
                var v = pair[(eq + 1)..].Trim();
                if (k == "t" && long.TryParse(v, out var ts)) timestamp = ts;
                else if (k == "v1") v1Sigs.Add(v);
            }
            if (timestamp is null) return (false, "missing_timestamp");
            if (v1Sigs.Count == 0) return (false, "missing_v1_signature");

            const int toleranceSeconds = 300;
            var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (Math.Abs(nowUnix - timestamp.Value) > toleranceSeconds) return (false, "timestamp_outside_tolerance");

            var signedPayload = $"{timestamp.Value}.{rawBody}";
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var expectedBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload));
            var expectedHex = Convert.ToHexString(expectedBytes).ToLowerInvariant();

            foreach (var candidate in v1Sigs)
            {
                if (candidate.Length != expectedHex.Length) continue;
                var candidateBytes = Encoding.ASCII.GetBytes(candidate.ToLowerInvariant());
                var expectedHexBytes = Encoding.ASCII.GetBytes(expectedHex);
                if (CryptographicOperations.FixedTimeEquals(candidateBytes, expectedHexBytes))
                    return (true, null);
            }
            return (false, "no_v1_signature_match");
        }

        // Plain hex HMAC-SHA256 of the raw body.
        var candidateHex = signatureHeader.Trim();
        if (candidateHex.StartsWith("sha256=", StringComparison.OrdinalIgnoreCase))
            candidateHex = candidateHex["sha256=".Length..];

        using var hmacPlain = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = hmacPlain.ComputeHash(Encoding.UTF8.GetBytes(rawBody));
        var expectedHexPlain = Convert.ToHexString(expected).ToLowerInvariant();

        if (candidateHex.Length != expectedHexPlain.Length) return (false, "signature_length_mismatch");
        var lhs = Encoding.ASCII.GetBytes(candidateHex.ToLowerInvariant());
        var rhs = Encoding.ASCII.GetBytes(expectedHexPlain);
        return CryptographicOperations.FixedTimeEquals(lhs, rhs)
            ? (true, null)
            : (false, "signature_mismatch");
    }

    // ─── ADMIN ENDPOINTS ───

    /// <summary>
    /// Get the full registration policy for the current tenant (admin only).
    /// </summary>
    [HttpGet("admin/policy")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetPolicy()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var policy = await _orchestrator.GetPolicyAsync(tenantId);

        return Ok(new
        {
            success = true,
            data = new
            {
                id = policy.Id,
                mode = policy.Mode.ToString(),
                mode_value = (int)policy.Mode,
                provider = policy.Provider.ToString(),
                provider_value = (int)policy.Provider,
                verification_level = policy.VerificationLevel.ToString(),
                verification_level_value = (int)policy.VerificationLevel,
                post_verification_action = policy.PostVerificationAction.ToString(),
                post_verification_action_value = (int)policy.PostVerificationAction,
                has_provider_config = !string.IsNullOrEmpty(policy.ProviderConfigEncrypted),
                custom_webhook_url = policy.CustomWebhookUrl,
                custom_provider_name = policy.CustomProviderName,
                registration_message = policy.RegistrationMessage,
                invite_code = policy.InviteCode,
                max_invite_uses = policy.MaxInviteUses,
                invite_uses_count = policy.InviteUsesCount,
                is_active = policy.IsActive,
                updated_at = policy.UpdatedAt,
                updated_by_user_id = policy.UpdatedByUserId
            }
        });
    }

    /// <summary>
    /// Update the registration policy for the current tenant (admin only).
    /// </summary>
    [HttpPut("admin/policy")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> UpdatePolicy([FromBody] UpdateRegistrationPolicyRequest request)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var adminUserId = GetUserId();

        var existing = await _db.TenantRegistrationPolicies
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.IsActive);

        if (existing == null)
        {
            existing = new TenantRegistrationPolicy
            {
                TenantId = tenantId,
                CreatedAt = DateTime.UtcNow
            };
            _db.TenantRegistrationPolicies.Add(existing);
        }

        // Update fields
        if (request.Mode.HasValue)
            existing.Mode = request.Mode.Value;
        if (request.Provider.HasValue)
            existing.Provider = request.Provider.Value;
        if (request.VerificationLevel.HasValue)
            existing.VerificationLevel = request.VerificationLevel.Value;
        if (request.PostVerificationAction.HasValue)
            existing.PostVerificationAction = request.PostVerificationAction.Value;
        if (request.ProviderConfig != null)
            existing.ProviderConfigEncrypted = _encryption.Encrypt(request.ProviderConfig);
        if (request.CustomWebhookUrl != null)
            existing.CustomWebhookUrl = request.CustomWebhookUrl;
        if (request.CustomProviderName != null)
            existing.CustomProviderName = request.CustomProviderName;
        if (request.RegistrationMessage != null)
            existing.RegistrationMessage = request.RegistrationMessage;
        if (request.InviteCode != null)
            existing.InviteCode = request.InviteCode;
        if (request.MaxInviteUses.HasValue)
            existing.MaxInviteUses = request.MaxInviteUses;

        existing.UpdatedAt = DateTime.UtcNow;
        existing.UpdatedByUserId = adminUserId;
        existing.IsActive = true;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated registration policy for tenant {TenantId}",
            adminUserId, tenantId);

        return Ok(new { success = true, message = "Registration policy updated" });
    }

    /// <summary>
    /// Get users pending admin approval.
    /// </summary>
    [HttpGet("admin/pending")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetPendingRegistrations([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var query = _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId
                     && u.RegistrationStatus == RegistrationStatus.PendingAdminReview)
            .OrderBy(u => u.CreatedAt);

        var total = await query.CountAsync();
        var users = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(u => new
            {
                id = u.Id,
                email = u.Email,
                first_name = u.FirstName,
                last_name = u.LastName,
                registration_status = u.RegistrationStatus.ToString(),
                created_at = u.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = users,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    /// <summary>
    /// Approve a pending user registration (admin only).
    /// </summary>
    [HttpPut("admin/users/{userId:int}/approve")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> ApproveRegistration(int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var adminUserId = GetUserId();
        if (adminUserId == null) return Unauthorized();

        var success = await _orchestrator.AdminApproveAsync(userId, tenantId, adminUserId.Value);
        if (!success)
            return BadRequest(new { error = "Cannot approve user. Check registration status." });

        return Ok(new { success = true, message = "User registration approved" });
    }

    /// <summary>
    /// Reject a pending user registration (admin only).
    /// </summary>
    [HttpPut("admin/users/{userId:int}/reject")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> RejectRegistration(int userId, [FromBody] RejectRegistrationRequest? request)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var adminUserId = GetUserId();
        if (adminUserId == null) return Unauthorized();

        var success = await _orchestrator.AdminRejectAsync(userId, tenantId, adminUserId.Value, request?.Reason);
        if (!success)
            return BadRequest(new { error = "Cannot reject user. Check registration status." });

        return Ok(new { success = true, message = "User registration rejected" });
    }

    /// <summary>
    /// Get available registration modes and providers (admin reference).
    /// </summary>
    [HttpGet("admin/options")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public IActionResult GetOptions()
    {
        return Ok(new
        {
            success = true,
            data = new
            {
                modes = Enum.GetValues<RegistrationMode>().Select(m => new { value = (int)m, name = m.ToString() }),
                providers = Enum.GetValues<VerificationProvider>().Select(p => new { value = (int)p, name = p.ToString() }),
                verification_levels = Enum.GetValues<VerificationLevel>().Select(l => new { value = (int)l, name = l.ToString() }),
                post_verification_actions = Enum.GetValues<PostVerificationAction>().Select(a => new { value = (int)a, name = a.ToString() })
            }
        });
    }

    #region Helpers

    private int? GetUserId()
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        return int.TryParse(claim, out var id) ? id : null;
    }

    #endregion
}

#region Request Models

public record UpdateRegistrationPolicyRequest
{
    [JsonPropertyName("mode")]
    public RegistrationMode? Mode { get; init; }

    [JsonPropertyName("provider")]
    public VerificationProvider? Provider { get; init; }

    [JsonPropertyName("verification_level")]
    public VerificationLevel? VerificationLevel { get; init; }

    [JsonPropertyName("post_verification_action")]
    public PostVerificationAction? PostVerificationAction { get; init; }

    [JsonPropertyName("provider_config")]
    public string? ProviderConfig { get; init; }

    [JsonPropertyName("custom_webhook_url")]
    public string? CustomWebhookUrl { get; init; }

    [JsonPropertyName("custom_provider_name")]
    public string? CustomProviderName { get; init; }

    [JsonPropertyName("registration_message")]
    public string? RegistrationMessage { get; init; }

    [JsonPropertyName("invite_code")]
    public string? InviteCode { get; init; }

    [JsonPropertyName("max_invite_uses")]
    public int? MaxInviteUses { get; init; }
}

public record RejectRegistrationRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; init; }
}

#endregion
