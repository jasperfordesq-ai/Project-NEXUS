// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using QRCoder;

namespace Nexus.Api.Controllers;

/// <summary>
/// TOTP two-factor authentication management.
/// Endpoints for setting up, verifying, and disabling TOTP 2FA.
/// </summary>
[ApiController]
[Route("api/auth/2fa")]
[Route("api/v2/auth/2fa")]
[Authorize]
public class TotpController : ControllerBase
{
    private readonly TotpService _totpService;
    private readonly ILogger<TotpController> _logger;
    private readonly Data.NexusDbContext _db;
    private readonly TokenService _tokenService;
    private readonly TwoFactorChallengeManager _twoFactorChallenges;

    public TotpController(
        TotpService totpService,
        ILogger<TotpController> logger,
        Data.NexusDbContext db,
        TokenService tokenService,
        TwoFactorChallengeManager twoFactorChallenges)
    {
        _totpService = totpService;
        _logger = logger;
        _db = db;
        _tokenService = tokenService;
        _twoFactorChallenges = twoFactorChallenges;
    }

    private bool IsCanonicalV2Request => Request.Path.StartsWithSegments("/api/v2");

    /// <summary>
    /// Get current 2FA status for the authenticated user.
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus()
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        var enabled = await _totpService.IsTwoFactorEnabledAsync(userId.Value);
        var backupCodesRemaining = enabled
            ? await _totpService.GetRemainingBackupCodeCountAsync(userId.Value, tenantId.Value)
            : 0;

        var data = new
        {
            enabled,
            setup_required = !enabled && !string.IsNullOrEmpty(
                await _db.Users
                    .Where(user => user.Id == userId.Value)
                    .Select(user => user.TotpSecretEncrypted)
                    .SingleOrDefaultAsync()),
            backup_codes_remaining = backupCodesRemaining
        };

        return IsCanonicalV2Request
            ? CanonicalData(data)
            : Ok(new { success = true, data, two_factor_enabled = enabled });
    }

    /// <summary>
    /// Initiate TOTP setup. Returns secret and QR code URI.
    /// User must verify with a code before 2FA is activated.
    /// </summary>
    [HttpPost("setup")]
    public async Task<IActionResult> Setup()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (secret, qrUri, error) = await _totpService.GenerateSetupAsync(userId.Value);

        if (error != null)
        {
            return IsCanonicalV2Request
                ? CanonicalError("SETUP_FAILED", error, StatusCodes.Status400BadRequest)
                : BadRequest(new { error });
        }

        var data = new
        {
            qr_code_url = BuildQrCodeDataUri(qrUri),
            secret,
            backup_codes = Array.Empty<string>()
        };

        return IsCanonicalV2Request
            ? CanonicalData(data)
            : Ok(new
            {
                success = true,
                data,
                secret,
                qr_uri = qrUri,
                message = "Scan the QR code with your authenticator app, then verify with a code."
            });
    }

    /// <summary>
    /// Verify setup code and enable 2FA. Returns backup codes (shown only once).
    /// </summary>
    [HttpPost("verify-setup")]
    [HttpPost("/api/v2/auth/2fa/verify")]
    public async Task<IActionResult> VerifySetup([FromBody] TotpCodeRequest request)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return IsCanonicalV2Request
                ? CanonicalError("VALIDATION_ERROR", "Verification code is required", StatusCodes.Status400BadRequest, "code")
                : BadRequest(new { error = "Verification code is required" });
        }

        var (success, backupCodes, error) = await _totpService.VerifyAndEnableAsync(userId.Value, tenantId.Value, request.Code.Trim());

        if (!success)
        {
            return IsCanonicalV2Request
                ? CanonicalError("VERIFICATION_FAILED", error ?? "Invalid verification code", StatusCodes.Status400BadRequest, "code")
                : BadRequest(new { error });
        }

        var result = new
        {
            backup_codes = backupCodes
        };

        return IsCanonicalV2Request
            ? CanonicalData(result, "Two-factor authentication enabled. Save your backup codes securely.")
            : Ok(new
            {
                success = true,
                message = "Two-factor authentication enabled. Save your backup codes securely.",
                backup_codes = backupCodes
            });
    }

    /// <summary>
    /// Complete the public, stateless login challenge used by the canonical
    /// React client. The opaque challenge is consumed before any bearer or
    /// refresh token is issued.
    /// </summary>
    [HttpPost("/api/totp/verify")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> VerifyLoginChallenge([FromBody] TotpLoginVerifyRequest request)
    {
        Response.Headers["API-Version"] = "2.0";

        var challenge = _twoFactorChallenges.Get(request.TwoFactorToken);
        if (challenge is null)
        {
            return ChallengeError(
                "AUTH_2FA_TOKEN_EXPIRED",
                "2FA session expired. Please log in again.",
                StatusCodes.Status401Unauthorized);
        }

        var attempt = _twoFactorChallenges.RecordAttempt(request.TwoFactorToken);
        if (!attempt.Allowed)
        {
            return ChallengeError(
                "AUTH_2FA_MAX_ATTEMPTS",
                "Too many failed attempts. Please log in again.",
                StatusCodes.Status401Unauthorized);
        }

        var code = request.Code?.Trim() ?? string.Empty;
        if (code.Length == 0)
        {
            return ChallengeError(
                "VALIDATION_REQUIRED_FIELD",
                "Verification code is required.",
                StatusCodes.Status400BadRequest,
                "code");
        }

        var method = request.UseBackupCode ? "backup_code" : "totp";
        if (!challenge.Methods.Contains(method, StringComparer.Ordinal))
        {
            return ChallengeError(
                "AUTH_2FA_INVALID",
                "The requested verification method is not allowed for this challenge.",
                StatusCodes.Status401Unauthorized);
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(candidate => candidate.Id == challenge.UserId);
        if (user is null)
        {
            _twoFactorChallenges.Delete(request.TwoFactorToken);
            return ChallengeError(
                "RESOURCE_NOT_FOUND",
                "User not found.",
                StatusCodes.Status401Unauthorized);
        }

        // The password step authenticated a specific tenant and TOTP
        // enrollment. If either changes before the code exchange, consume the
        // old capability instead of allowing it to cross auth contexts.
        if (user.TenantId != challenge.TenantId
            || !user.TwoFactorEnabled
            || user.TwoFactorEnabledAt != challenge.TwoFactorEnabledAt)
        {
            _twoFactorChallenges.Delete(request.TwoFactorToken);
            _logger.LogWarning(
                "Rejected stale 2FA challenge for user {UserId}: issued tenant {IssuedTenantId}, current tenant {CurrentTenantId}.",
                user.Id,
                challenge.TenantId,
                user.TenantId);
            return ChallengeError(
                "AUTH_2FA_TOKEN_EXPIRED",
                "2FA session expired. Please log in again.",
                StatusCodes.Status401Unauthorized);
        }

        (bool valid, string? error) = request.UseBackupCode
            ? await _totpService.ValidateBackupCodeAsync(user.Id, user.TenantId, code)
            : await _totpService.ValidateLoginCodeAsync(user.Id, code);
        if (!valid)
        {
            return ChallengeError(
                "AUTH_2FA_INVALID",
                error ?? "Invalid code.",
                StatusCodes.Status401Unauthorized);
        }

        if (!_twoFactorChallenges.Consume(request.TwoFactorToken))
        {
            return ChallengeError(
                "AUTH_2FA_TOKEN_EXPIRED",
                "2FA session expired. Please log in again.",
                StatusCodes.Status401Unauthorized);
        }

        if (!user.IsActive
            || user.SuspendedAt is not null
            || user.RegistrationStatus is RegistrationStatus.Rejected
                or RegistrationStatus.PendingAdminReview
                or RegistrationStatus.VerificationFailed)
        {
            return ChallengeError(
                "AUTH_ACCOUNT_SUSPENDED",
                "Account is not permitted to sign in.",
                StatusCodes.Status403Forbidden);
        }

        var tenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == user.TenantId && candidate.IsActive);
        if (tenant is null)
        {
            return ChallengeError(
                "AUTH_TENANT_INACTIVE",
                "Tenant is not active.",
                StatusCodes.Status403Forbidden);
        }

        var accessToken = _tokenService.GenerateJwt(user);
        var (refreshToken, refreshTokenHash) = TokenService.GenerateRefreshToken();
        user.LastLoginAt = DateTime.UtcNow;
        _db.RefreshTokens.Add(new RefreshToken
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            TokenHash = refreshTokenHash,
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            ClientType = "web",
            CreatedByIp = HttpContext.Connection.RemoteIpAddress?.ToString()
        });
        await _db.SaveChangesAsync();

        var onboardingCompleted = await IsOnboardingCompleteAsync(user);
        int? codesRemaining = request.UseBackupCode
            ? await _totpService.GetRemainingBackupCodeCountAsync(user.Id, user.TenantId)
            : null;

        var payload = new Dictionary<string, object?>
        {
            ["success"] = true,
            ["user"] = new
            {
                id = user.Id,
                first_name = user.FirstName,
                last_name = user.LastName,
                email = user.Email,
                avatar_url = user.AvatarUrl,
                tenant_id = user.TenantId,
                role = user.Role,
                is_admin = NexusUserAccessEvaluator.HasProfileAdminIndicator(user),
                is_super_admin = user.IsSuperAdmin,
                is_god = user.IsGod,
                is_tenant_super_admin = user.IsTenantSuperAdmin,
                onboarding_completed = onboardingCompleted
            },
            ["access_token"] = accessToken,
            ["refresh_token"] = refreshToken,
            ["token_type"] = "Bearer",
            ["expires_in"] = _tokenService.AccessTokenExpirySeconds,
            ["refresh_expires_in"] = 7 * 24 * 60 * 60,
            ["is_mobile"] = false,
            ["token"] = accessToken,
            ["sanctum_token"] = null,
            ["config"] = new
            {
                modules = new
                {
                    events = true,
                    polls = true,
                    goals = true,
                    volunteering = true,
                    resources = true
                }
            }
        };
        if (codesRemaining.HasValue)
            payload["codes_remaining"] = codesRemaining.Value;

        _logger.LogInformation("User {UserId} completed an opaque 2FA login challenge.", user.Id);
        return Ok(payload);
    }

    /// <summary>
    /// Verify a TOTP code during login (called after password verification).
    /// </summary>
    [HttpPost("/api/auth/2fa/verify")]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> Verify([FromBody] TotpCodeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "Verification code is required" });

        var (valid, error) = await _totpService.ValidateLoginCodeAsync(userId.Value, request.Code.Trim());

        if (!valid)
            return BadRequest(new { error });

        return Ok(new { success = true, message = "Two-factor code verified" });
    }

    /// <summary>
    /// Disable 2FA. Requires a valid TOTP code.
    /// </summary>
    [HttpPost("/api/auth/2fa/disable")]
    public async Task<IActionResult> Disable([FromBody] TotpCodeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "Verification code is required" });

        var (success, error) = await _totpService.DisableAsync(userId.Value, request.Code.Trim());

        if (!success)
            return BadRequest(new { error });

        return Ok(new { success = true, message = "Two-factor authentication disabled" });
    }

    /// <summary>
    /// Canonical Laravel settings contract. Password re-authentication is
    /// required before TOTP secrets and backup codes are removed.
    /// </summary>
    [HttpPost("/api/v2/auth/2fa/disable")]
    public async Task<IActionResult> DisableCanonical([FromBody] TotpDisableRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return CanonicalError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return CanonicalError(
                "VALIDATION_ERROR",
                "Password is required",
                StatusCodes.Status400BadRequest,
                "password");
        }

        var (success, error) = await _totpService.DisableWithPasswordAsync(userId.Value, request.Password);
        if (!success)
        {
            return CanonicalError(
                "DISABLE_FAILED",
                error ?? "Failed to disable 2FA",
                StatusCodes.Status403Forbidden,
                "password");
        }

        return CanonicalData(new { message = "Two-factor authentication disabled" });
    }

    /// <summary>
    /// Verify a backup code during login (alternative to TOTP code).
    /// </summary>
    [HttpPost("verify-backup")]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> VerifyBackup([FromBody] TotpCodeRequest request)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "Backup code is required" });

        var (valid, error) = await _totpService.ValidateBackupCodeAsync(userId.Value, tenantId.Value, request.Code.Trim());

        if (!valid)
            return BadRequest(new { error });

        return Ok(new { success = true, message = "Backup code verified" });
    }

    /// <summary>
    /// Regenerate backup codes. Invalidates all existing codes.
    /// Requires a valid TOTP code for security.
    /// </summary>
    [HttpPost("backup-codes/regenerate")]
    public async Task<IActionResult> RegenerateBackupCodes([FromBody] TotpCodeRequest request)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "TOTP code is required to regenerate backup codes" });

        // Verify TOTP code first
        var (valid, verifyError) = await _totpService.ValidateLoginCodeAsync(userId.Value, request.Code.Trim());
        if (!valid)
            return BadRequest(new { error = verifyError });

        var (codes, error) = await _totpService.GenerateBackupCodesAsync(userId.Value, tenantId.Value);

        if (codes == null)
            return BadRequest(new { error });

        return Ok(new
        {
            success = true,
            message = "Backup codes regenerated. Save these securely — they replace all previous codes.",
            backup_codes = codes
        });
    }

    /// <summary>
    /// Get count of remaining unused backup codes.
    /// </summary>
    [HttpGet("backup-codes/count")]
    public async Task<IActionResult> GetBackupCodeCount()
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        var count = await _totpService.GetRemainingBackupCodeCountAsync(userId.Value, tenantId.Value);

        return Ok(new { remaining_codes = count });
    }

    private static string BuildQrCodeDataUri(string qrUri)
    {
        using var generator = new QRCodeGenerator();
        using var qrData = generator.CreateQrCode(qrUri, QRCodeGenerator.ECCLevel.Q);
        using var renderer = new SvgQRCode(qrData);
        var svg = renderer.GetGraphic(8);
        return "data:image/svg+xml;base64," + Convert.ToBase64String(Encoding.UTF8.GetBytes(svg));
    }

    private IActionResult ChallengeError(string code, string message, int status, string? field = null)
    {
        return StatusCode(status, new
        {
            success = false,
            code,
            message,
            errors = new[] { new { code, message, field } }
        });
    }

    private IActionResult CanonicalData(object data, string? message = null)
    {
        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data,
            message,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult CanonicalError(
        string code,
        string message,
        int status,
        string? field = null)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new
        {
            errors = new[] { new { code, message, field } },
            success = false
        });
    }

    private async Task<bool> IsOnboardingCompleteAsync(User user)
    {
        var requiredStepIds = await _db.Set<OnboardingStep>()
            .AsNoTracking()
            .Where(step => step.TenantId == user.TenantId && step.IsRequired)
            .Select(step => step.Id)
            .ToListAsync();
        if (requiredStepIds.Count == 0) return true;

        var completed = await _db.Set<OnboardingProgress>()
            .AsNoTracking()
            .CountAsync(progress =>
                progress.TenantId == user.TenantId
                && progress.UserId == user.Id
                && progress.IsCompleted
                && requiredStepIds.Contains(progress.StepId));
        return completed >= requiredStepIds.Count;
    }
}

// === Request DTOs ===

public class TotpCodeRequest
{
    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;
}

public sealed class TotpLoginVerifyRequest
{
    [JsonPropertyName("two_factor_token")]
    public string? TwoFactorToken { get; set; }

    [JsonPropertyName("code")]
    public string? Code { get; set; }

    [JsonPropertyName("use_backup_code")]
    public bool UseBackupCode { get; set; }

    [JsonPropertyName("trust_device")]
    public bool TrustDevice { get; set; }
}

public sealed class TotpDisableRequest
{
    [JsonPropertyName("password")]
    public string? Password { get; set; }
}
