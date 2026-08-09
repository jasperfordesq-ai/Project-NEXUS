// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http;
using System.Security.Claims;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using Nexus.Api.Services.Registration;
using Nexus.Contracts.Events;
using Nexus.Messaging;

namespace Nexus.Api.Controllers;

/// <summary>
/// Authentication controller - JWT generation, validation, and token management.
/// Phase 8: Added logout, refresh, register, and password reset endpoints.
/// Rate limited to prevent brute-force attacks.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[ApiVersion("2.0")]
[Route("api/v{version:apiVersion}/auth")]
[Route("api/auth")] // Backward compatibility
public class AuthController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthController> _logger;
    private readonly IEventPublisher _eventPublisher;
    private readonly RegistrationOrchestrator _registrationOrchestrator;
    private readonly IEmailService _emailService;
    private readonly TokenService _tokenService;
    private readonly TwoFactorChallengeManager _twoFactorChallenges;
    private readonly ITurnstileVerifier _turnstile;
    private readonly IPwnedPasswordChecker _pwnedPassword;

    // Refresh token validity (7 days default)
    private const int RefreshTokenExpiryDays = 7;
    // Password reset token validity. Shortened from 60 → 30 min on 2026-05-11
    // (audit finding) — industry baseline for password-reset windows.
    private const int PasswordResetExpiryMinutes = 30;

    public AuthController(
        NexusDbContext db,
        IConfiguration config,
        ILogger<AuthController> logger,
        IEventPublisher eventPublisher,
        RegistrationOrchestrator registrationOrchestrator,
        IEmailService emailService,
        TokenService tokenService,
        TwoFactorChallengeManager twoFactorChallenges,
        ITurnstileVerifier turnstile,
        IPwnedPasswordChecker pwnedPassword)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _eventPublisher = eventPublisher;
        _registrationOrchestrator = registrationOrchestrator;
        _emailService = emailService;
        _tokenService = tokenService;
        _twoFactorChallenges = twoFactorChallenges;
        _turnstile = turnstile;
        _pwnedPassword = pwnedPassword;
    }

    /// <summary>
    /// Login with email, password, and tenant identifier.
    /// Returns access token and refresh token.
    /// Rate limited: 5 requests per minute per IP.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        // Validate required fields
        if (string.IsNullOrEmpty(request.Email) || string.IsNullOrEmpty(request.Password))
        {
            return BadRequest(new { error = "Email and password are required" });
        }

        // Turnstile is intentionally NOT gated here. It was added 2026-05-15
        // after a registration/contact-form email-flood attack, but on the
        // login surface it was blocking legitimate members whose browsers
        // couldn't load challenges.cloudflare.com (ad blockers, slow CDN,
        // corporate DNS). The AuthPolicy rate limiter is the active defence
        // for credential stuffing here. Token field still accepted for
        // backward compatibility with already-deployed frontends.
        _ = request.CfTurnstileResponse;
        _ = request.TurnstileToken;

        // Tenant identifier is required (slug preferred, id as fallback)
        if (string.IsNullOrEmpty(request.TenantSlug) && !request.TenantId.HasValue)
        {
            return BadRequest(new
            {
                error = "Tenant identifier required",
                message = "Provide tenant_slug (preferred) or tenant_id"
            });
        }

        // Step 1: Resolve tenant first
        var tenant = await ResolveTenantAsync(request.TenantSlug, request.TenantId);
        if (tenant == null)
        {
            _logger.LogWarning("Login failed: tenant not found (slug={Slug}, id={Id})",
                request.TenantSlug, request.TenantId);
            return Unauthorized(new { error = "Invalid credentials" });
        }

        if (!tenant.IsActive)
        {
            _logger.LogWarning("Login failed: tenant {TenantId} is inactive", tenant.Id);
            return Unauthorized(new { error = "Tenant is not active" });
        }

        // Step 2: Find user within the resolved tenant only
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u =>
                u.TenantId == tenant.Id &&
                u.Email.ToLower() == request.Email.ToLowerInvariant());

        if (user == null)
        {
            _logger.LogWarning("Login failed: user not found for {Email} in tenant {TenantId}",
                request.Email, tenant.Id);
            return Unauthorized(new { error = "Invalid credentials" });
        }

        // Check registration/account status before password verification
        if (user.RegistrationStatus == Nexus.Api.Entities.RegistrationStatus.Rejected)
        {
            _logger.LogWarning("Login failed: user {Email} registration was rejected", request.Email);
            return Unauthorized(new { error = "Your registration has been rejected. Contact support for details." });
        }

        if (user.RegistrationStatus == Nexus.Api.Entities.RegistrationStatus.PendingAdminReview)
        {
            _logger.LogWarning("Login failed: user {Email} is pending admin review", request.Email);
            return Unauthorized(new { error = "Your registration is pending approval by an administrator." });
        }

        if (!user.IsActive && user.RegistrationStatus != Nexus.Api.Entities.RegistrationStatus.PendingVerification)
        {
            _logger.LogWarning("Login failed: user {Email} account is inactive", request.Email);
            return Unauthorized(new { error = "Your account is not active. Contact support for assistance." });
        }

        // Step 3: Verify password (using BCrypt - same as PHP)
        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            _logger.LogWarning("Login failed: invalid password for {Email} in tenant {TenantId}",
                request.Email, tenant.Id);
            return Unauthorized(new { error = "Invalid credentials" });
        }

        // Step 4: Check if 2FA is required
        if (user.TwoFactorEnabled)
        {
            // Issue a short-lived token that only allows 2FA verification
            user.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var challengeToken = _twoFactorChallenges.Create(
                user.Id,
                user.TenantId,
                ["totp", "backup_code"],
                user.TwoFactorEnabledAt);

            // Build masked email (e.g. "ja***@example.com")
            var emailParts = user.Email.Split('@');
            var localPart = emailParts[0];
            var maskedLocal = localPart.Length <= 2
                ? localPart + "***"
                : localPart[..2] + "***";
            var emailMasked = maskedLocal + "@" + emailParts[1];

            _logger.LogInformation("User {UserId} requires 2FA for tenant {TenantId}", user.Id, tenant.Id);

            return Ok(new
            {
                success = false,
                requires_2fa = true,
                two_factor_token = challengeToken,
                methods = new[] { "totp", "backup_code" },
                code = "AUTH_2FA_REQUIRED",
                user = new
                {
                    id = user.Id,
                    first_name = user.FirstName,
                    email_masked = emailMasked
                },
                message = "Two-factor authentication required."
            });
        }

        // Step 5: Update last login
        user.LastLoginAt = DateTime.UtcNow;

        // Step 6: Generate tokens
        var accessToken = _tokenService.GenerateJwt(user);
        var (refreshToken, refreshTokenHash) = TokenService.GenerateRefreshToken();

        // Step 7: Store refresh token
        var refreshTokenEntity = new RefreshToken
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            TokenHash = refreshTokenHash,
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenExpiryDays),
            ClientType = request.ClientType,
            CreatedByIp = GetClientIp()
        };
        _db.RefreshTokens.Add(refreshTokenEntity);
        await _db.SaveChangesAsync();

        // Fetch preferred language from UserPreferences (default "en")
        var userPrefs = await _db.Set<UserPreference>()
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == user.Id && p.TenantId == user.TenantId);
        var preferredLanguage = userPrefs?.Language ?? "en";

        // Check onboarding completion: true if any progress exists and all required steps are done
        var hasOnboardingSteps = await _db.Set<OnboardingStep>()
            .AsNoTracking()
            .AnyAsync(s => s.TenantId == user.TenantId && s.IsRequired);
        var onboardingCompleted = !hasOnboardingSteps || await _db.Set<OnboardingProgress>()
            .AsNoTracking()
            .Where(p => p.UserId == user.Id && p.TenantId == user.TenantId && p.IsCompleted)
            .Join(
                _db.Set<OnboardingStep>().Where(s => s.TenantId == user.TenantId && s.IsRequired),
                p => p.StepId,
                s => s.Id,
                (p, s) => s.Id)
            .CountAsync() >= await _db.Set<OnboardingStep>()
                .AsNoTracking()
                .CountAsync(s => s.TenantId == user.TenantId && s.IsRequired);

        _logger.LogInformation("User {UserId} logged in to tenant {TenantId}", user.Id, tenant.Id);

        return Ok(new
        {
            success = true,
            requires_2fa = false,
            access_token = accessToken,
            refresh_token = refreshToken,
            token_type = "Bearer",
            expires_in = _tokenService.AccessTokenExpirySeconds,
            user = new
            {
                id = user.Id,
                email = user.Email,
                first_name = user.FirstName,
                last_name = user.LastName,
                role = user.Role,
                is_admin = NexusUserAccessEvaluator.HasProfileAdminIndicator(user),
                is_super_admin = user.IsSuperAdmin,
                is_tenant_super_admin = user.IsTenantSuperAdmin,
                is_god = user.IsGod,
                tenant_id = user.TenantId,
                tenant_slug = tenant.Slug,
                preferred_language = preferredLanguage,
                onboarding_completed = onboardingCompleted
            }
        });
    }

    /// <summary>
    /// Logout - revokes the current refresh token.
    /// </summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout([FromBody] LogoutRequest? request)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (!string.IsNullOrEmpty(request?.RefreshToken))
        {
            // Revoke specific refresh token
            var tokenHash = TokenService.HashToken(request.RefreshToken);
            var token = await _db.RefreshTokens
                .FirstOrDefaultAsync(t => t.UserId == userId && t.TokenHash == tokenHash && t.RevokedAt == null);

            if (token != null)
            {
                token.RevokedAt = DateTime.UtcNow;
                token.RevokedReason = "logout";
                await _db.SaveChangesAsync();
            }
        }
        else
        {
            // Revoke all refresh tokens for this user
            var invalidatedAt = DateTime.UtcNow;
            var tokens = await _db.RefreshTokens
                .Where(t => t.UserId == userId && t.RevokedAt == null)
                .ToListAsync();

            foreach (var token in tokens)
            {
                token.RevokedAt = invalidatedAt;
                token.RevokedReason = "logout_all";
            }
            var user = await _db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Id == userId);
            if (user is not null) user.AuthenticationInvalidatedAt = invalidatedAt;
            await _db.SaveChangesAsync();
        }

        _logger.LogInformation("User {UserId} logged out", userId);

        return Ok(new { success = true, message = "Logged out successfully" });
    }

    /// <summary>
    /// Refresh access token using a valid refresh token.
    /// </summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest request)
    {
        if (string.IsNullOrEmpty(request.RefreshToken))
        {
            return BadRequest(new { error = "Refresh token is required" });
        }

        var tokenHash = TokenService.HashToken(request.RefreshToken);

        // Find the refresh token (ignore tenant filter - we'll verify manually)
        var refreshToken = await _db.RefreshTokens
            .IgnoreQueryFilters()
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == tokenHash);

        if (refreshToken == null)
        {
            _logger.LogWarning("Refresh failed: token not found");
            return Unauthorized(new { error = "Invalid refresh token" });
        }

        if (!refreshToken.IsValid)
        {
            // Refresh-token reuse detection (2026-05-11 audit, OAuth2 best practice).
            // If the presented token has been revoked (e.g. used once already
            // and rotated), that's a strong signal the token was stolen and a
            // replay is in flight. Revoke the entire token family for this
            // user so the attacker — and the legitimate session — both lose
            // access immediately.
            if (refreshToken.RevokedAt != null)
            {
                var revokedCount = await _db.RefreshTokens
                    .IgnoreQueryFilters()
                    .Where(t => t.UserId == refreshToken.UserId
                        && t.TenantId == refreshToken.TenantId
                        && t.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(t => t.RevokedAt, DateTime.UtcNow)
                        .SetProperty(t => t.RevokedReason, "reuse_detected"));
                _logger.LogWarning(
                    "Refresh-token reuse detected for user {UserId} — revoked {Count} sibling token(s). " +
                    "Possible token theft.",
                    refreshToken.UserId, revokedCount);
            }
            else
            {
                _logger.LogWarning("Refresh failed: token expired for user {UserId}", refreshToken.UserId);
            }
            return Unauthorized(new { error = "Refresh token expired or revoked" });
        }

        if (refreshToken.User == null || !refreshToken.User.IsActive)
        {
            _logger.LogWarning("Refresh failed: user inactive for token {TokenId}", refreshToken.Id);
            return Unauthorized(new { error = "User account is inactive" });
        }

        // Revoke old refresh token (rotation)
        refreshToken.RevokedAt = DateTime.UtcNow;
        refreshToken.RevokedReason = "rotation";

        // Generate new tokens
        var accessToken = _tokenService.GenerateJwt(refreshToken.User);
        var (newRefreshToken, newRefreshTokenHash) = TokenService.GenerateRefreshToken();

        // Store new refresh token
        var newRefreshTokenEntity = new RefreshToken
        {
            TenantId = refreshToken.TenantId,
            UserId = refreshToken.UserId,
            TokenHash = newRefreshTokenHash,
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenExpiryDays),
            ClientType = refreshToken.ClientType,
            CreatedByIp = GetClientIp()
        };
        _db.RefreshTokens.Add(newRefreshTokenEntity);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Token refreshed for user {UserId}", refreshToken.UserId);

        return Ok(new
        {
            success = true,
            access_token = accessToken,
            refresh_token = newRefreshToken,
            token_type = "Bearer",
            expires_in = _tokenService.AccessTokenExpirySeconds
        });
    }

    /// <summary>
    /// Register a new user.
    /// Rate limited: 5 requests per minute per IP.
    /// </summary>
    [HttpPost("register")]
    [HttpPost("/api/v2/auth/register")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        // Bot honeypot — if a value came back in the hidden `website` or
        // explicit `honeypot` field, this is form-spam. Mirror the success
        // response shape so the attacker can't distinguish bot-rejection
        // from genuine registration, and log for telemetry. No DB write,
        // no welcome email, no user row.
        var honeypotValue = request.Honeypot ?? request.Website;
        if (!string.IsNullOrWhiteSpace(honeypotValue))
        {
            _logger.LogInformation(
                "registration.honeypot_triggered tenant={TenantSlug} ip={Ip} value={Value}",
                request.TenantSlug,
                GetClientIp(),
                honeypotValue.Length > 100 ? honeypotValue[..100] : honeypotValue);
            return Ok(new
            {
                success = true,
                message = "Registration successful. Please check your email to verify your account.",
                requires_verification = true,
            });
        }

        // Cloudflare Turnstile verification. Reads cf-turnstile-response from
        // either of the documented field names (form-style or JSON-style).
        // Verifier short-circuits to true when Turnstile:SecretKey is unset.
        var turnstileToken = request.CfTurnstileResponse ?? request.TurnstileToken;
        if (!await _turnstile.VerifyAsync(turnstileToken, GetClientIp()))
        {
            return BadRequest(new
            {
                error = "Bot verification failed. Please retry the challenge and submit again.",
                error_code = "turnstile_failed",
            });
        }

        // Validate required fields
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(request.Email))
            errors.Add("Email is required");
        else if (!IsValidEmail(request.Email))
            errors.Add("Invalid email format");

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors.Add("Password is required");
        }
        else
        {
            // NIST SP 800-63B aligned: 12-char minimum, NO mandatory
            // character classes. Real defence is the HIBP breach check
            // below — complexity rules without breach checks just push
            // users to predictable patterns like "P@ssw0rd1!".
            if (request.Password.Length < 12)
                errors.Add("Password must be at least 12 characters. A memorable passphrase is stronger than a short complex one.");

            // HIBP k-anonymity check — gates submission against known breach
            // corpora. Only checked when length is OK (no point hitting the
            // API for a password we're about to reject).
            if (errors.Count == 0 && await _pwnedPassword.IsPwnedAsync(request.Password))
                errors.Add("This password appears in a known data breach. Please choose a different password.");
        }

        if (string.IsNullOrWhiteSpace(request.FirstName))
            errors.Add("First name is required");
        else if (request.FirstName.Length > 100)
            errors.Add("First name must be 100 characters or less");

        if (string.IsNullOrWhiteSpace(request.LastName))
            errors.Add("Last name is required");
        else if (request.LastName.Length > 100)
            errors.Add("Last name must be 100 characters or less");

        if (string.IsNullOrEmpty(request.TenantSlug) && !request.TenantId.HasValue)
            errors.Add("Tenant identifier required (tenant_slug or tenant_id)");

        if (errors.Count > 0)
        {
            return BadRequest(new { error = "Validation failed", details = errors });
        }

        // Resolve tenant
        var tenant = await ResolveTenantAsync(request.TenantSlug, request.TenantId);
        if (tenant == null || !tenant.IsActive)
        {
            return BadRequest(new { error = "Invalid or inactive tenant" });
        }

        // Check if email already exists in this tenant
        var existingUser = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.TenantId == tenant.Id && u.Email.ToLower() == request.Email.ToLowerInvariant());

        if (existingUser != null)
        {
            return Conflict(new { error = "Email already registered" });
        }

        // Use registration orchestrator (respects tenant policy)
        var registrationResult = await _registrationOrchestrator.RegisterAsync(
            tenant.Id,
            request.Email.Trim().ToLowerInvariant(),
            BCrypt.Net.BCrypt.HashPassword(request.Password),
            request.FirstName.Trim(),
            request.LastName.Trim(),
            request.InviteCode,
            GetClientIp());

        if (!registrationResult.IsSuccess)
        {
            return BadRequest(new { error = registrationResult.Error });
        }

        var user = registrationResult.User!;

        _logger.LogInformation("New user {UserId} registered in tenant {TenantId} with status {Status}",
            user.Id, tenant.Id, registrationResult.Status);

        // Send welcome or verification email (non-blocking)
        if (registrationResult.Status == RegistrationStatus.Active)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendWelcomeEmailAsync(
                        user.Email,
                        user.FirstName ?? "User",
                        tenant.Name ?? tenant.Slug);
                }
                catch (HttpRequestException ex)
                {
                    _logger.LogError(ex, "Failed to send welcome email for user {UserId}", user.Id);
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogError(ex, "Failed to send welcome email for user {UserId}", user.Id);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Unexpected error sending welcome email for user {UserId}", user.Id);
                }
            });
        }
        else if (registrationResult.Status == RegistrationStatus.PendingVerification)
        {
            // Generate and send verification code
            var code = GenerateVerificationCode();
            user.EmailVerificationCode = code;
            user.EmailVerificationCodeExpiresAt = DateTime.UtcNow.AddMinutes(30);
            await _db.SaveChangesAsync();

            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendEmailAsync(
                        user.Email,
                        "Verify your email - Project NEXUS",
                        $"<h2>Welcome to Project NEXUS!</h2><p>Your verification code is: <strong>{code}</strong></p><p>This code expires in 30 minutes.</p>");
                }
                catch (HttpRequestException ex)
                {
                    _logger.LogError(ex, "Failed to send verification email for user {UserId}", user.Id);
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogError(ex, "Failed to send verification email for user {UserId}", user.Id);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Unexpected error sending verification email for user {UserId}", user.Id);
                }
            });
        }

        // Build response based on registration status
        var responseData = new Dictionary<string, object?>
        {
            ["success"] = true,
            ["registration_status"] = registrationResult.Status.ToString(),
            ["registration_message"] = registrationResult.Message,
            ["user"] = new
            {
                id = user.Id,
                email = user.Email,
                first_name = user.FirstName,
                last_name = user.LastName,
                role = user.Role,
                tenant_id = user.TenantId,
                tenant_slug = tenant.Slug
            }
        };

        // Only issue tokens if the user is immediately active
        if (registrationResult.Status == RegistrationStatus.Active)
        {
            var accessToken = _tokenService.GenerateJwt(user);
            var (refreshToken, refreshTokenHash) = TokenService.GenerateRefreshToken();

            var refreshTokenEntity = new RefreshToken
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                TokenHash = refreshTokenHash,
                ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenExpiryDays),
                ClientType = request.ClientType,
                CreatedByIp = GetClientIp()
            };
            _db.RefreshTokens.Add(refreshTokenEntity);
            await _db.SaveChangesAsync();

            responseData["access_token"] = accessToken;
            responseData["refresh_token"] = refreshToken;
            responseData["token_type"] = "Bearer";
            responseData["expires_in"] = _tokenService.AccessTokenExpirySeconds;
        }
        else if (registrationResult.Status == RegistrationStatus.PendingVerification)
        {
            // Issue a limited token so the user can call the verification endpoints
            var accessToken = _tokenService.GenerateJwt(user);
            var (refreshToken, refreshTokenHash) = TokenService.GenerateRefreshToken();

            var refreshTokenEntity = new RefreshToken
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                TokenHash = refreshTokenHash,
                ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenExpiryDays),
                ClientType = request.ClientType,
                CreatedByIp = GetClientIp()
            };
            _db.RefreshTokens.Add(refreshTokenEntity);
            await _db.SaveChangesAsync();

            responseData["access_token"] = accessToken;
            responseData["refresh_token"] = refreshToken;
            responseData["token_type"] = "Bearer";
            responseData["expires_in"] = _tokenService.AccessTokenExpirySeconds;
            responseData["requires_verification"] = true;
        }

        return StatusCode(201, responseData);
    }

    /// <summary>
    /// Request a password reset. Generates a token (would be emailed in production).
    /// Rate limited: 5 requests per minute per IP.
    /// </summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request)
    {
        // Always return success to prevent email enumeration
        var successResponse = new { success = true, message = "If the email exists, a reset link will be sent" };

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return BadRequest(new { error = "Email is required" });
        }

        // Turnstile was previously gated here. It was silently rejecting
        // legitimate reset requests (legit users whose browser couldn't load
        // the Turnstile widget got a fake-success response and never received
        // an email — exactly the symptom reported by a member 2026-05-15).
        // Email enumeration is already mitigated by the always-200 response
        // and by the AuthPolicy rate limiter. Token field still accepted for
        // backward compatibility with already-deployed frontends.
        _ = request.CfTurnstileResponse;
        _ = request.TurnstileToken;

        if (string.IsNullOrEmpty(request.TenantSlug) && !request.TenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant identifier required" });
        }

        // Resolve tenant
        var tenant = await ResolveTenantAsync(request.TenantSlug, request.TenantId);
        if (tenant == null)
        {
            // Don't reveal tenant doesn't exist
            return Ok(successResponse);
        }

        // Find user
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.TenantId == tenant.Id && u.Email.ToLower() == request.Email.ToLowerInvariant() && u.IsActive);

        if (user == null)
        {
            // Don't reveal user doesn't exist
            return Ok(successResponse);
        }

        // Invalidate any existing reset tokens
        var existingTokens = await _db.PasswordResetTokens
            .IgnoreQueryFilters()
            .Where(t => t.UserId == user.Id && t.UsedAt == null)
            .ToListAsync();

        foreach (var existingToken in existingTokens)
        {
            existingToken.UsedAt = DateTime.UtcNow; // Mark as used
        }

        // Generate new reset token
        var (resetToken, resetTokenHash) = TokenService.GenerateRefreshToken(); // Reuse the same generation method

        var passwordResetToken = new PasswordResetToken
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            TokenHash = resetTokenHash,
            ExpiresAt = DateTime.UtcNow.AddMinutes(PasswordResetExpiryMinutes)
        };
        _db.PasswordResetTokens.Add(passwordResetToken);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Password reset requested for user {UserId}", user.Id);

        // Build reset URL from frontend base URL
        var frontendUrl = _config["App:FrontendUrl"]?.TrimEnd('/') ?? "http://localhost:5173";
        var resetUrl = $"{frontendUrl}/reset-password?token={Uri.EscapeDataString(resetToken)}";

        // Send the password reset email (fire-and-forget, don't block the response)
        _ = Task.Run(async () =>
        {
            try
            {
                await _emailService.SendPasswordResetEmailAsync(
                    user.Email,
                    resetToken,
                    user.FirstName ?? "User",
                    resetUrl);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Failed to send password reset email for user {UserId}", user.Id);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Failed to send password reset email for user {UserId}", user.Id);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error sending password reset email for user {UserId}", user.Id);
            }
        });

        // In development, also return the token in the response for testing
        if (_config.GetValue<bool>("IsDevelopment", false) ||
            Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") == "Development")
        {
            return Ok(new
            {
                success = true,
                message = "Password reset token generated",
                reset_token = resetToken, // Only in development!
                expires_in = PasswordResetExpiryMinutes * 60
            });
        }

        return Ok(successResponse);
    }

    /// <summary>
    /// Reset password using a valid reset token.
    /// Rate limited: 5 requests per minute per IP.
    /// </summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request)
    {
        if (string.IsNullOrEmpty(request.Token))
        {
            return BadRequest(new { error = "Reset token is required" });
        }

        if (string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return BadRequest(new { error = "New password is required" });
        }

        // NIST 800-63B aligned (mirror of Register rule above): length only.
        if (request.NewPassword.Length < 12)
            return BadRequest(new { error = "Password must be at least 12 characters. A memorable passphrase is stronger than a short complex one." });

        // HIBP k-anonymity — same rule as Register.
        if (await _pwnedPassword.IsPwnedAsync(request.NewPassword))
        {
            return BadRequest(new
            {
                error = "This password appears in a known data breach and cannot be used. Please choose a different password.",
                error_code = "password_pwned",
            });
        }

        var tokenHash = TokenService.HashToken(request.Token);

        // Find the reset token
        var resetToken = await _db.PasswordResetTokens
            .IgnoreQueryFilters()
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == tokenHash);

        if (resetToken == null)
        {
            return BadRequest(new { error = "Invalid reset token" });
        }

        if (!resetToken.IsValid)
        {
            return BadRequest(new { error = "Reset token expired or already used" });
        }

        if (resetToken.User == null)
        {
            return BadRequest(new { error = "User not found" });
        }

        // Update password
        resetToken.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        resetToken.User.AuthenticationInvalidatedAt = DateTime.UtcNow;

        // Mark token as used
        resetToken.UsedAt = DateTime.UtcNow;

        // Revoke all refresh tokens (force re-login)
        var refreshTokens = await _db.RefreshTokens
            .IgnoreQueryFilters()
            .Where(t => t.UserId == resetToken.UserId && t.RevokedAt == null)
            .ToListAsync();

        foreach (var token in refreshTokens)
        {
            token.RevokedAt = DateTime.UtcNow;
            token.RevokedReason = "password_change";
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Password reset completed for user {UserId}", resetToken.UserId);

        // Publish password changed event
        await _eventPublisher.PublishAsync(new UserPasswordChangedEvent
        {
            TenantId = resetToken.TenantId,
            UserId = resetToken.UserId,
            WasReset = true
        });

        return Ok(new { success = true, message = "Password reset successfully" });
    }

    /// <summary>
    /// Validate the current access token and return resolved tenant context.
    /// </summary>
    [HttpGet("validate")]
    [Authorize]
    public IActionResult Validate([FromServices] TenantContext tenantContext)
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        var tenantIdClaim = User.FindFirst("tenant_id")?.Value;
        var role = User.FindFirst(ClaimTypes.Role)?.Value
            ?? User.FindFirst("role")?.Value;
        var email = User.FindFirst(ClaimTypes.Email)?.Value
            ?? User.FindFirst("email")?.Value;

        return Ok(new
        {
            valid = true,
            user_id = userId,
            tenant_id_claim = tenantIdClaim,
            tenant_id_resolved = tenantContext.TenantId,
            tenant_context_matches = tenantIdClaim == tenantContext.TenantId?.ToString(),
            role = role,
            email = email
        });
    }

    /// <summary>
    /// Verify email address using 6-digit code sent during registration.
    /// </summary>
    [HttpPost("verify-email")]
    [Authorize]
    public async Task<IActionResult> VerifyEmail([FromBody] VerifyEmailRequest request)
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(userIdClaim, out var userId))
            return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "Verification code is required" });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return NotFound(new { error = "User not found" });

        if (user.EmailVerified)
            return Ok(new { success = true, message = "Email is already verified" });

        if (string.IsNullOrEmpty(user.EmailVerificationCode))
            return BadRequest(new { error = "No verification code pending. Request a new one." });

        if (user.EmailVerificationCodeExpiresAt < DateTime.UtcNow)
            return BadRequest(new { error = "Verification code has expired. Request a new one." });

        if (user.EmailVerificationCode != request.Code.Trim())
            return BadRequest(new { error = "Invalid verification code" });

        user.EmailVerified = true;
        user.EmailVerifiedAt = DateTime.UtcNow;
        user.EmailVerificationCode = null;
        user.EmailVerificationCodeExpiresAt = null;

        // If user was pending verification, activate them
        if (user.RegistrationStatus == RegistrationStatus.PendingVerification)
        {
            user.RegistrationStatus = RegistrationStatus.Active;
            user.IsActive = true;
            user.IsApproved = true;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Email verified for user {UserId}", userId);
        return Ok(new { success = true, message = "Email verified successfully" });
    }

    /// <summary>
    /// Resend email verification code.
    /// </summary>
    [HttpPost("resend-verification")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> ResendVerification()
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(userIdClaim, out var userId))
            return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return NotFound(new { error = "User not found" });

        if (user.EmailVerified)
            return Ok(new { success = true, message = "Email is already verified" });

        // Generate 6-digit code
        var code = GenerateVerificationCode();
        user.EmailVerificationCode = code;
        user.EmailVerificationCodeExpiresAt = DateTime.UtcNow.AddMinutes(30);
        await _db.SaveChangesAsync();

        // Send verification email (fire-and-forget)
        _ = Task.Run(async () =>
        {
            try
            {
                await _emailService.SendEmailAsync(
                    user.Email,
                    "Verify your email - Project NEXUS",
                    $"<h2>Email Verification</h2><p>Your verification code is: <strong>{code}</strong></p><p>This code expires in 30 minutes.</p>");
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Failed to send verification email for user {UserId}", userId);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Failed to send verification email for user {UserId}", userId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error sending verification email for user {UserId}", userId);
            }
        });

        _logger.LogInformation("Verification code resent for user {UserId}", userId);
        return Ok(new { success = true, message = "Verification code sent to your email" });
    }

    private static string GenerateVerificationCode()
    {
        var bytes = new byte[4];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        var number = BitConverter.ToUInt32(bytes) % 1000000;
        return number.ToString("D6");
    }

    #region Private Methods

    private async Task<Tenant?> ResolveTenantAsync(string? slug, int? id)
    {
        if (!string.IsNullOrEmpty(slug))
        {
            return await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug);
        }

        if (id.HasValue)
        {
            return await _db.Tenants.FirstOrDefaultAsync(x => x.Id == id.Value);
        }

        return null;
    }

    private string? GetClientIp()
    {
        return HttpContext.Connection.RemoteIpAddress?.ToString();
    }

    private static readonly System.Text.RegularExpressions.Regex EmailRegex = new(
        @"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
        System.Text.RegularExpressions.RegexOptions.Compiled,
        TimeSpan.FromMilliseconds(250)); // ReDoS protection

    private static bool IsValidEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 254)
            return false;

        try
        {
            // First validate with regex (RFC 5322 compliant pattern)
            if (!EmailRegex.IsMatch(email))
                return false;

            // Then use MailAddress for additional validation
            var addr = new System.Net.Mail.MailAddress(email);
            return addr.Address == email.Trim();
        }
        catch
        {
            return false;
        }
    }

    #endregion
}

#region Request Models

public record LoginRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("email")]
    public string Email { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("password")]
    public string Password { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("tenant_slug")]
    public string? TenantSlug { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("tenant_id")]
    public int? TenantId { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("client_type")]
    public string? ClientType { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("cf-turnstile-response")]
    public string? CfTurnstileResponse { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("turnstile_token")]
    public string? TurnstileToken { get; init; }
}

public record LogoutRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("refresh_token")]
    public string? RefreshToken { get; init; }
}

public record RefreshRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("refresh_token")]
    public string RefreshToken { get; init; } = string.Empty;
}

public record RegisterRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("email")]
    public string Email { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("password")]
    public string Password { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("first_name")]
    public string FirstName { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("last_name")]
    public string LastName { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("tenant_slug")]
    public string? TenantSlug { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("tenant_id")]
    public int? TenantId { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("client_type")]
    public string? ClientType { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("invite_code")]
    public string? InviteCode { get; init; }

    // Bot honeypot — hidden field on the frontend form. Real users never
    // fill it; form-spam bots auto-fill every input. Accepted under either
    // `website` or `honeypot` to align with V1's field name.
    [System.Text.Json.Serialization.JsonPropertyName("website")]
    public string? Website { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("honeypot")]
    public string? Honeypot { get; init; }

    // Cloudflare Turnstile token. The widget emits this as
    // `cf-turnstile-response` (form-style) when posted from a Blade/Nunjucks
    // form; the React frontend posts JSON, so we accept the camelCase variant
    // `turnstileToken` too.
    [System.Text.Json.Serialization.JsonPropertyName("cf-turnstile-response")]
    public string? CfTurnstileResponse { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("turnstile_token")]
    public string? TurnstileToken { get; init; }
}

public record ForgotPasswordRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("email")]
    public string Email { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("tenant_slug")]
    public string? TenantSlug { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("tenant_id")]
    public int? TenantId { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("cf-turnstile-response")]
    public string? CfTurnstileResponse { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("turnstile_token")]
    public string? TurnstileToken { get; init; }
}

public record VerifyEmailRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("code")]
    public string Code { get; init; } = string.Empty;
}

public record ResetPasswordRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("token")]
    public string Token { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("new_password")]
    public string NewPassword { get; init; } = string.Empty;
}

#endregion
