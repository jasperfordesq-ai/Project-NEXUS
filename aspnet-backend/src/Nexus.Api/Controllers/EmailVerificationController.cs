// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Email verification controller - send, verify, and check email verification status.
/// </summary>
[ApiController]
[Route("api/email-verification")]
[Authorize]
public class EmailVerificationController : ControllerBase
{
    private readonly EmailVerificationService _emailVerificationService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<EmailVerificationController> _logger;

    public EmailVerificationController(EmailVerificationService emailVerificationService, TenantContext tenantContext, ILogger<EmailVerificationController> logger)
    {
        _emailVerificationService = emailVerificationService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/email-verification/send - Send verification email.
    /// </summary>
    [HttpPost("send")]
    public async Task<IActionResult> SendVerification()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var email = User.FindFirst("email")?.Value;
        if (string.IsNullOrEmpty(email))
            return BadRequest(new { error = "Email not found in token" });

        var (success, error) = await _emailVerificationService.SendVerificationEmailAsync(userId.Value, email);
        if (!success) return BadRequest(new { error });

        return Ok(new { success = true, message = "Verification email sent" });
    }

    /// <summary>
    /// POST /api/email-verification/verify - Verify email with token.
    /// </summary>
    [HttpPost("verify")]
    public async Task<IActionResult> Verify([FromBody] VerifyEmailTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
            return BadRequest(new { error = "Token is required" });

        var (success, error) = await _emailVerificationService.VerifyEmailAsync(request.Token);
        if (!success) return BadRequest(new { error });

        return Ok(new { success = true, message = "Email verified successfully" });
    }

    /// <summary>
    /// GET /api/email-verification/status - Get current user verification status.
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var isVerified = await _emailVerificationService.IsEmailVerifiedAsync(userId.Value);
        var email = User.FindFirst("email")?.Value;

        return Ok(new
        {
            email,
            is_verified = isVerified
        });
    }

    /// <summary>
    /// POST /api/email-verification/resend - Resend verification email.
    /// </summary>
    [HttpPost("resend")]
    public async Task<IActionResult> Resend()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _emailVerificationService.ResendVerificationAsync(userId.Value);
        if (!success) return BadRequest(new { error });

        return Ok(new { success = true, message = "Verification email resent" });
    }
}

public record VerifyEmailTokenRequest
{
    [JsonPropertyName("token")] public string Token { get; init; } = string.Empty;
}
