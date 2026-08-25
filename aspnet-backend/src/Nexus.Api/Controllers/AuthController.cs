// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
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

using Nexus.Api.Support;

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
    /// <summary>
    /// How long after a rotation a replay of the old token is treated as a
    /// concurrent request rather than theft. Mirrors Laravel's
    /// TokenService::REFRESH_REUSE_GRACE_SECONDS (5).
    /// </summary>
    private const int RefreshReuseGraceSeconds = 5;

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
    private readonly IDisposableEmailService _disposableEmail;
    private readonly IEmailDeliverabilityValidator _emailDeliverability;
    private readonly TenantContext _tenant;
    private readonly LoginThrottleService _loginThrottle;

    // Refresh token validity (7 days default)
    private const int RefreshTokenExpiryDays = 7;

    /// <summary>
    /// The refresh token's remaining life in SECONDS, as `refresh_expires_in`.
    ///
    /// 🔴 Every response that hands out a refresh_token must also report this. The
    /// ACCESSIBLE frontend refuses to build a session without it: web-uk's
    /// `rotatingSessionFrom` (web-uk/src/routes/auth.js:204-216) requires
    /// access_token + refresh_token + expires_in + refresh_expires_in and throws
    /// AUTH_SESSION_RESPONSE_INVALID (502) if any is missing or non-positive. Until
    /// 2026-08-19 this backend omitted it on all four emitting paths, so signing in to
    /// the accessible frontend against ASP.NET could not succeed at all — while the
    /// signed-OUT pages looked healthy, which is why page-level probing missed it.
    /// Laravel reports it from `TokenService::getRefreshTokenExpiry` on every one of
    /// its equivalents (AuthController.php:446, 751; TotpController.php:372;
    /// TwoFactorController.php:254).
    /// </summary>
    private const int RefreshTokenExpirySeconds = RefreshTokenExpiryDays * 24 * 60 * 60;
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
        IPwnedPasswordChecker pwnedPassword,
        IDisposableEmailService disposableEmail,
        IEmailDeliverabilityValidator emailDeliverability,
        TenantContext tenant,
        LoginThrottleService loginThrottle)
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
        _disposableEmail = disposableEmail;
        _emailDeliverability = emailDeliverability;
        _tenant = tenant;
        _loginThrottle = loginThrottle;
    }

    /// <summary>
    /// A registration refusal in the v2 error envelope V1 emits from
    /// BaseApiController::respondWithError — <c>{"errors":[{"code","message"}]}</c>
    /// at HTTP 422. Both clients read errors[0].code, so the status and the
    /// code together are the contract, not the message text.
    /// </summary>
    private ObjectResult RegistrationRefusal(string code, string message)
        => StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = new[] { new { code, message } } });

    /// <summary>
    /// Domain half of an address, for logs only. Never log the local part — it
    /// is member PII and the domain is what tells an operator whether they are
    /// looking at a spam wave.
    /// </summary>
    private static string EmailDomainForLog(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return string.Empty;
        var at = email.LastIndexOf('@');
        return at < 0 || at == email.Length - 1 ? string.Empty : email[(at + 1)..].ToLowerInvariant();
    }

    /// <summary>Admin-shaped account, matching Laravel's $isAdminAccount.</summary>
    private static bool IsAdminAccount(User user)
        => user.Role is "admin" or "tenant_admin" or "org_admin" or "super_admin"
            || user.IsSuperAdmin
            || user.IsTenantSuperAdmin;

    /// <summary>Tenant feature flag lookup (features.&lt;key&gt; in tenant_configs).</summary>
    private async Task<bool> TenantFeatureEnabledAsync(int tenantId, string feature)
    {
        // Both stored spellings -- see TenantFeatureKeys.
        var keys = TenantFeatureKeys.BothKeys(feature);
        var rows = await _db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.TenantId == tenantId && keys.Contains(c.Key))
            .ToDictionaryAsync(c => c.Key, c => c.Value!.Trim().Trim('"'), HttpContext.RequestAborted);

        return TenantFeatureKeys.Read(rows, feature, false);
    }

    private static string MaskEmail(string email)
    {
        var parts = email.Split('@');
        if (parts.Length != 2) return "***";
        var local = parts[0];
        var masked = local.Length <= 2 ? local + "***" : local[..2] + "***";
        return masked + "@" + parts[1];
    }

    /// <summary>
    /// 429 in the auth error envelope the client understands, matching
    /// Laravel's RATE_LIMIT_EXCEEDED response including retry_after.
    /// </summary>
    private IActionResult LockedOut(LoginThrottleService.Verdict verdict)
    {
        _logger.LogWarning("Sign-in locked out; {Seconds}s remaining.", verdict.RetryAfterSeconds);
        Response.Headers["Retry-After"] = verdict.RetryAfterSeconds.ToString();
        return StatusCode(StatusCodes.Status429TooManyRequests, new
        {
            success = false,
            error = LoginThrottleService.RetryMessage(verdict.RetryAfterSeconds),
            code = "RATE_LIMIT_EXCEEDED",
            retry_after = verdict.RetryAfterSeconds,
        });
    }

    /// <summary>
    /// Laravel's refusal for a failed sign-in: 401 with
    /// <c>{"errors":[{"code":"AUTH_INVALID_CREDENTIALS","message":"Invalid credentials"}]}</c>
    /// and NO <c>success</c> key — verified live against the disposable Laravel on
    /// 2026-08-19.
    ///
    /// 🔴 Why this must be built here rather than left to the filter. A bare
    /// <c>Unauthorized(new { error = ... })</c> does not carry an <c>errors</c> array,
    /// so <see cref="Filters.LaravelAuthEnvelopeFilter"/> rewrote it into the GENERIC
    /// challenge body — <c>auth_required</c> / "Authentication required" /
    /// <c>success:false</c>. That is the right body for "you sent no token" and the
    /// WRONG one for "your password was wrong": the client cannot tell the two apart,
    /// and a sign-in form shows the wrong message. Emitting the errors array here means
    /// the filter deliberately leaves it alone.
    ///
    /// 🔴 Laravel is inconsistent between the two on purpose-of-record: its generic 401
    /// DOES include <c>success:false</c> (verified on a protected endpoint with no
    /// token) while this one does not. Both spellings are the contract; do not
    /// "harmonise" them.
    /// </summary>
    private IActionResult InvalidCredentials() => Unauthorized(new
    {
        errors = new[]
        {
            new { code = "AUTH_INVALID_CREDENTIALS", message = "Invalid credentials" }
        }
    });

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
            // 🔴 Laravel answers 400 {"errors":[{"code":"VALIDATION_REQUIRED_FIELD",
            // "message":"Email and password required"}]} — verified live 2026-08-19.
            // A bare {error} string is a DIFFERENT envelope: a client reading
            // errors[0].code to decide which field to highlight gets nothing.
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_REQUIRED_FIELD", message = "Email and password required" }
                }
            });
        }

        // 🔴 Per-ACCOUNT lockout, checked before the password is verified.
        // The existing limiter is per-IP only, so credential stuffing spread
        // across many addresses could grind at one account unthrottled.
        // Mirrors Laravel (App\Core\RateLimiter: 10 failures / 300s window /
        // 300s lockout, checked on both email and IP before verification).
        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        var emailVerdict = await _loginThrottle.CheckAsync(
            request.Email, LoginThrottleService.TypeEmail, HttpContext.RequestAborted);
        if (emailVerdict.Limited) return LockedOut(emailVerdict);

        var ipVerdict = await _loginThrottle.CheckAsync(
            clientIp, LoginThrottleService.TypeIp, HttpContext.RequestAborted);
        if (ipVerdict.Limited) return LockedOut(ipVerdict);

        // Turnstile is intentionally NOT gated here. It was added 2026-05-15
        // after a registration/contact-form email-flood attack, but on the
        // login surface it was blocking legitimate members whose browsers
        // couldn't load challenges.cloudflare.com (ad blockers, slow CDN,
        // corporate DNS). The AuthPolicy rate limiter is the active defence
        // for credential stuffing here. Token field still accepted for
        // backward compatibility with already-deployed frontends.
        _ = request.CfTurnstileResponse;
        _ = request.TurnstileToken;

        // 🔴 The tenant may come from the REQUEST CONTEXT, not just the body.
        //
        // Laravel resolves it with TenantContext::getId() — populated from the
        // host or the X-Tenant-ID / X-Tenant-Slug header — and never requires a
        // body field (AuthController.php login, "Scope login by tenant when
        // tenant context is available").
        //
        // The React client matches that: LoginRequest is {email, password,
        // platform?} (react-frontend/src/types/api.ts:124-128) and the community
        // travels as the X-Tenant-ID header set by tokenManager.setTenantId().
        // Requiring it in the body therefore returned 400 to every browser
        // sign-in, and the login page showed only "Sign-in failed. Please check
        // your details and try again." — a member could not sign in at all.
        // Found by driving the real frontend against this backend on 2026-08-15;
        // no route inventory or contract test could see it, because the endpoint
        // exists and answers.
        // NOTE: /api/auth/login is deliberately excluded from
        // TenantResolutionMiddleware ("login determines tenant from
        // credentials"), so TenantContext is empty here by design. Read the
        // headers directly rather than weakening that exclusion.
        var headerTenantSlug = Request.Headers.TryGetValue("X-Tenant-Slug", out var slugHeader)
            ? slugHeader.ToString().Trim()
            : null;
        var headerTenantId = Request.Headers.TryGetValue("X-Tenant-ID", out var idHeader)
            && int.TryParse(idHeader.ToString(), out var parsedHeaderTenantId)
                ? parsedHeaderTenantId
                : (int?)null;

        var requestTenantSlug = !string.IsNullOrEmpty(request.TenantSlug)
            ? request.TenantSlug
            : (string.IsNullOrWhiteSpace(headerTenantSlug) ? null : headerTenantSlug);
        var requestTenantId = request.TenantId ?? _tenant.TenantId ?? headerTenantId;

        if (string.IsNullOrEmpty(requestTenantSlug) && !requestTenantId.HasValue)
        {
            return BadRequest(new
            {
                error = "Tenant identifier required",
                message = "Provide tenant_slug (preferred) or tenant_id"
            });
        }

        // Step 1: Resolve tenant first
        var tenant = await ResolveTenantAsync(requestTenantSlug, requestTenantId);
        if (tenant == null)
        {
            _logger.LogWarning("Login failed: tenant not found (slug={Slug}, id={Id})",
                request.TenantSlug, request.TenantId);
            return InvalidCredentials();
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
            return InvalidCredentials();
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
            await _loginThrottle.RecordAsync(request.Email, LoginThrottleService.TypeEmail, false,
                HttpContext.RequestAborted);
            await _loginThrottle.RecordAsync(clientIp, LoginThrottleService.TypeIp, false,
                HttpContext.RequestAborted);
            return InvalidCredentials();
        }

        // Step 4: Check if 2FA is required
        // 🔴 Mandatory two-factor for administrators.
        //
        // Laravel refuses to complete an admin sign-in when the account has no
        // second factor yet, and hands back a setup challenge instead
        // (AuthController.php:250-280, code AUTH_2FA_SETUP_REQUIRED). This
        // backend had no such gate at all — AUTH_2FA_SETUP_REQUIRED returned
        // zero hits — so an administrator with two-factor switched off was let
        // straight in. The React client already understands the response and
        // routes to the setup flow (AuthContext.tsx:344-359).
        //
        // Conditions mirror Laravel exactly: the platform switch, the tenant
        // feature, an admin-shaped account, and no second factor yet.
        if (!user.TwoFactorEnabled
            && _config.GetValue("Auth:ForceAdminTwoFactor", false)
            && IsAdminAccount(user)
            && await TenantFeatureEnabledAsync(tenant.Id, "two_factor_authentication"))
        {
            var setupToken = _twoFactorChallenges.Create(
                user.Id, user.TenantId, ["totp_setup"], user.TwoFactorEnabledAt);

            _logger.LogInformation(
                "Admin {UserId} must set up two-factor before signing in (tenant {TenantId}).",
                user.Id, tenant.Id);

            // Laravel answers 200 with success:false — not a 4xx.
            return Ok(new
            {
                success = false,
                requires_2fa_setup = true,
                two_factor_token = setupToken,
                code = "AUTH_2FA_SETUP_REQUIRED",
                message = "Two-factor authentication must be set up before you can sign in.",
                user = new
                {
                    id = user.Id,
                    first_name = user.FirstName,
                    email_masked = MaskEmail(user.Email),
                },
            });
        }

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

        // Step 5: Update last login. A success clears the failure history so a
        // member who mistypes twice and then gets in is not left near a lockout.
        await _loginThrottle.RecordAsync(request.Email, LoginThrottleService.TypeEmail, true,
            HttpContext.RequestAborted);
        await _loginThrottle.RecordAsync(clientIp, LoginThrottleService.TypeIp, true,
            HttpContext.RequestAborted);
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
            refresh_expires_in = RefreshTokenExpirySeconds,
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

        // Revoking the refresh credential is not enough: the access bearer used
        // to call logout would otherwise remain valid until its normal expiry.
        // Record its unique JWT id so every protected route refuses it from this
        // point onward. This is device-scoped; other signed-in devices retain
        // their independently issued access tokens.
        var accessJti = User.FindFirst(JwtRegisteredClaimNames.Jti)?.Value;
        if (!string.IsNullOrWhiteSpace(accessJti)
            && !await _db.RevokedTokens.AnyAsync(token => token.Jti == accessJti))
        {
            DateTime? accessExpiry = null;
            if (long.TryParse(User.FindFirst(JwtRegisteredClaimNames.Exp)?.Value, out var expiresAtUnix))
            {
                accessExpiry = DateTimeOffset.FromUnixTimeSeconds(expiresAtUnix).UtcDateTime;
            }

            _db.RevokedTokens.Add(new RevokedToken
            {
                UserId = userId,
                Jti = accessJti,
                RevokedAt = DateTime.UtcNow,
                ExpiresAt = accessExpiry,
            });
            await _db.SaveChangesAsync();
        }

        _logger.LogInformation("User {UserId} logged out", userId);

        return Ok(new { success = true, message = "Logged out successfully" });
    }

    /// <summary>
    /// Refresh access token using a valid refresh token.
    /// </summary>
    [HttpPost("refresh")]
    // 🔴 /auth/refresh-token is the ONLY refresh path the React client calls
    // (react-frontend/src/lib/api.ts:779) and it is what Laravel registers
    // (routes/api.php:3319). It used to answer 410 Gone from
    // AuthParityController, and the client reads any 4xx other than 408/429 as
    // "these credentials are bad" (api.ts:800) — so it deleted the session at
    // the first access-token expiry and bounced the member to the login screen,
    // repeatedly, with no explanation. Keep both spellings pointed here.
    [HttpPost("refresh-token")]
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

        // Refresh credentials are tenant capabilities. The unchanged React
        // client always supplies X-Tenant-ID, so reject a valid token presented
        // from another tenant before any rotation/reuse mutation can occur.
        if (Request.Headers.TryGetValue("X-Tenant-ID", out var tenantIdHeader)
            && int.TryParse(tenantIdHeader.ToString(), out var requestTenantId)
            && requestTenantId != refreshToken.TenantId)
        {
            _logger.LogWarning(
                "Refresh failed: token tenant {TokenTenantId} did not match request tenant {RequestTenantId}",
                refreshToken.TenantId, requestTenantId);
            return Unauthorized(new { error = "Invalid refresh token" });
        }

        if (Request.Headers.TryGetValue("X-Tenant-Slug", out var tenantSlugHeader)
            && !string.IsNullOrWhiteSpace(tenantSlugHeader))
        {
            var requestTenant = await ResolveTenantAsync(tenantSlugHeader.ToString(), null);
            if (requestTenant == null || requestTenant.Id != refreshToken.TenantId)
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
                // 🔴 Not every replay is theft. Two tabs (or a queued request and
                // its retry) can present the same token within milliseconds of
                // each other; the first rotates it, the second arrives to find it
                // revoked. Treating that as theft logs the member out of every
                // tab for doing nothing wrong.
                //
                // Laravel distinguishes the two: if the token was consumed within
                // a 5-second grace window AND an active successor exists, it
                // returns 409 AUTH_REFRESH_SUPERSEDED and leaves the family
                // alone (TokenService::hasRecentActiveDirectSuccessor,
                // REFRESH_REUSE_GRACE_SECONDS = 5; AuthController.php:724-730).
                // The client already understands that code and preserves its
                // credentials (react-frontend/src/lib/api.ts:790-796).
                //
                // ASP.NET's refresh_tokens table has no family/parent columns, so
                // "direct successor" is approximated as any still-valid token for
                // the same user and tenant issued at or after this one was
                // rotated. That is narrower than it looks: it requires the grace
                // window, the "rotation" reason (never "logout", "password_change"
                // or "reuse_detected"), and a live successor.
                var graceCutoff = DateTime.UtcNow.AddSeconds(-RefreshReuseGraceSeconds);
                if (refreshToken.RevokedReason == "rotation"
                    && refreshToken.RevokedAt >= graceCutoff)
                {
                    var now = DateTime.UtcNow;
                    var hasActiveSuccessor = await _db.RefreshTokens
                        .IgnoreQueryFilters()
                        .AnyAsync(t => t.UserId == refreshToken.UserId
                            && t.TenantId == refreshToken.TenantId
                            && t.RevokedAt == null
                            && t.ExpiresAt > now
                            && t.CreatedAt >= refreshToken.RevokedAt);

                    if (hasActiveSuccessor)
                    {
                        _logger.LogInformation(
                            "Concurrent refresh for user {UserId} superseded by an active successor; "
                            + "preserving the token family.",
                            refreshToken.UserId);

                        return Conflict(new
                        {
                            success = false,
                            errors = new[]
                            {
                                new
                                {
                                    code = "AUTH_REFRESH_SUPERSEDED",
                                    message = "This refresh token was already rotated by a concurrent request.",
                                },
                            },
                        });
                    }
                }

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

        // Claim rotation atomically. Two genuinely concurrent requests may both
        // read the valid row, but only one can transition RevokedAt from null.
        // The loser waits for the winner's transaction and receives the same
        // transient 409 envelope the React client already preserves.
        var rotatedAt = DateTime.UtcNow;
        await using var rotationTransaction = await _db.Database.BeginTransactionAsync();
        var claimed = await _db.RefreshTokens
            .IgnoreQueryFilters()
            .Where(t => t.Id == refreshToken.Id && t.RevokedAt == null && t.ExpiresAt > rotatedAt)
            .ExecuteUpdateAsync(update => update
                .SetProperty(t => t.RevokedAt, rotatedAt)
                .SetProperty(t => t.RevokedReason, "rotation"));
        if (claimed != 1)
        {
            await rotationTransaction.RollbackAsync();
            return Conflict(new
            {
                success = false,
                errors = new[]
                {
                    new
                    {
                        code = "AUTH_REFRESH_SUPERSEDED",
                        message = "This refresh token was already rotated by a concurrent request.",
                    },
                },
            });
        }

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
        await rotationTransaction.CommitAsync();

        _logger.LogInformation("Token refreshed for user {UserId}", refreshToken.UserId);

        return Ok(new
        {
            success = true,
            access_token = accessToken,
            refresh_token = newRefreshToken,
            token_type = "Bearer",
            expires_in = _tokenService.AccessTokenExpirySeconds,
            refresh_expires_in = RefreshTokenExpirySeconds
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

            // The HIBP breach check used to live here, folded into this
            // validation list. It now runs in the email/password guard block
            // below, because V1 runs its whole validator FIRST and only then
            // reaches the breach check — so a submission missing a surname
            // must report the missing surname, never the breached password.
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

        // ── Email-quality and password-breach guards ────────────────────────
        // V1 parity block. Order is load-bearing: RegistrationService.php runs
        // disposable → deliverability → breached, so when several apply the
        // member sees the same one from either backend. All three answer 422
        // with the v2 envelope {"errors":[{"code","message"}]}, because that is
        // what the clients read — web-uk maps each code to the specific form
        // field it should highlight (src/routes/auth.js), and the React client
        // surfaces response.code from errors[0].
        //
        // These sit BEFORE the duplicate-email check, as they do in V1: a
        // throwaway address that happens to be registered already is refused
        // as throwaway, not reported as a duplicate.

        // 1. Throwaway / temp-email providers. Deterministic, no network.
        if (_disposableEmail.IsDisposable(request.Email))
        {
            _logger.LogInformation(
                "registration.disposable_email_blocked tenant={TenantId} ip={Ip} email_domain={Domain}",
                tenant.Id, GetClientIp(), EmailDomainForLog(request.Email));
            return RegistrationRefusal(
                "EMAIL_DISPOSABLE",
                "Throwaway / temporary email addresses are not accepted. Use a permanent email address from a real provider.");
        }

        // 2. Deliverability: reserved documentation/testing names, then MX and
        //    A/AAAA. Allows through on an incomplete DNS lookup and logs it —
        //    see the fail-open policy on EmailDeliverabilityValidator.
        if (!await _emailDeliverability.IsResolvableAsync(request.Email))
        {
            _logger.LogInformation(
                "registration.invalid_email_domain tenant={TenantId} ip={Ip} email_domain={Domain}",
                tenant.Id, GetClientIp(), EmailDomainForLog(request.Email));
            return RegistrationRefusal(
                "EMAIL_DOMAIN_INVALID",
                "The email address is not deliverable — the domain has no mail servers. Check for typos and try again.");
        }

        // 3. Have I Been Pwned k-anonymity breach check.
        if (await _pwnedPassword.IsPwnedAsync(request.Password))
        {
            return RegistrationRefusal(
                "PASSWORD_PWNED",
                "This password appears in a known data breach and cannot be used. Please choose a different password.");
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
            responseData["refresh_expires_in"] = RefreshTokenExpirySeconds;
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
            responseData["refresh_expires_in"] = RefreshTokenExpirySeconds;
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

        var headerTenantSlug = Request.Headers.TryGetValue("X-Tenant-Slug", out var slugHeader)
            ? slugHeader.ToString().Trim()
            : null;
        var headerTenantId = Request.Headers.TryGetValue("X-Tenant-ID", out var idHeader)
            && int.TryParse(idHeader.ToString(), out var parsedHeaderTenantId)
                ? parsedHeaderTenantId
                : (int?)null;
        var requestTenantSlug = !string.IsNullOrWhiteSpace(request.TenantSlug)
            ? request.TenantSlug
            : (string.IsNullOrWhiteSpace(headerTenantSlug) ? null : headerTenantSlug);
        var requestTenantId = request.TenantId ?? headerTenantId;

        if (string.IsNullOrEmpty(requestTenantSlug) && !requestTenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant identifier required" });
        }

        // Resolve tenant
        var tenant = await ResolveTenantAsync(requestTenantSlug, requestTenantId);
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

        // Generate new reset token
        var (resetToken, resetTokenHash) = TokenService.GenerateRefreshToken(); // Reuse the same generation method

        // Build the URL for the real React route. Development/control runs set
        // App:FrontendUrl to their disposable frontend. Production custom-domain
        // tenants use their own domain and therefore remain slug-less.
        var configuredFrontend = _config["App:FrontendUrl"]?.TrimEnd('/');
        var useConfiguredDevelopmentFrontend =
            HttpContext.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment()
            || HttpContext.RequestServices.GetRequiredService<IHostEnvironment>().IsEnvironment("Testing");
        var tenantBase = !useConfiguredDevelopmentFrontend && !string.IsNullOrWhiteSpace(tenant.Domain)
            ? $"https://{tenant.Domain.Trim().TrimEnd('/')}"
            : configuredFrontend ?? "http://localhost:5173";
        var tenantPath = !useConfiguredDevelopmentFrontend && !string.IsNullOrWhiteSpace(tenant.Domain)
            ? string.Empty
            : $"/{Uri.EscapeDataString(tenant.Slug)}";
        var resetUrl = $"{tenantBase}{tenantPath}/password/reset?token={Uri.EscapeDataString(resetToken)}";

        // A reset credential becomes usable only after the dispatch boundary has
        // accepted the email. This preserves any older valid link when delivery
        // fails and makes the email-derived journey deterministic.
        var accepted = false;
        try
        {
            accepted = await _emailService.SendPasswordResetEmailAsync(
                user.Email,
                resetToken,
                user.FirstName ?? "User",
                resetUrl,
                HttpContext.RequestAborted);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            _logger.LogError(ex, "Failed to dispatch password reset email for user {UserId}", user.Id);
        }

        if (accepted)
        {
            var now = DateTime.UtcNow;
            await _db.PasswordResetTokens
                .IgnoreQueryFilters()
                .Where(t => t.UserId == user.Id && t.TenantId == user.TenantId && t.UsedAt == null)
                .ExecuteUpdateAsync(update => update.SetProperty(t => t.UsedAt, now));
            _db.PasswordResetTokens.Add(new PasswordResetToken
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                TokenHash = resetTokenHash,
                ExpiresAt = now.AddMinutes(PasswordResetExpiryMinutes),
            });
            await _db.SaveChangesAsync();
            _logger.LogInformation("Password reset email accepted for user {UserId}", user.Id);
        }
        else
        {
            _logger.LogWarning("Password reset email was not accepted for user {UserId}", user.Id);
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

        var newPassword = request.Password ?? request.NewPassword;
        if (string.IsNullOrWhiteSpace(newPassword))
        {
            return BadRequest(new { error = "New password is required" });
        }

        if (request.PasswordConfirmation is not null && request.PasswordConfirmation != newPassword)
        {
            return BadRequest(new { error = "Passwords do not match" });
        }

        // NIST 800-63B aligned (mirror of Register rule above): length only.
        if (newPassword.Length < 12)
            return BadRequest(new { error = "Password must be at least 12 characters. A memorable passphrase is stronger than a short complex one." });

        // HIBP k-anonymity — same rule as Register.
        if (await _pwnedPassword.IsPwnedAsync(newPassword))
        {
            return BadRequest(new
            {
                error = "This password appears in a known data breach and cannot be used. Please choose a different password.",
                error_code = "password_pwned",
            });
        }

        var tokenHash = TokenService.HashToken(request.Token);

        var requestTenantId = Request.Headers.TryGetValue("X-Tenant-ID", out var tenantHeader)
            && int.TryParse(tenantHeader.ToString(), out var parsedTenantId)
                ? parsedTenantId
                : (int?)null;

        await using var transaction = await _db.Database.BeginTransactionAsync();
        var now = DateTime.UtcNow;
        var resetToken = await _db.PasswordResetTokens
            .IgnoreQueryFilters()
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == tokenHash
                && t.UsedAt == null
                && t.ExpiresAt > now
                && (!requestTenantId.HasValue || t.TenantId == requestTenantId.Value));

        if (resetToken == null)
        {
            return BadRequest(new { error = "Invalid reset token" });
        }

        if (resetToken.User == null)
        {
            return BadRequest(new { error = "User not found" });
        }

        // Atomically claim the one-time reset capability. A concurrent loser
        // re-evaluates the UsedAt predicate after the winner commits and gets 0.
        var claimed = await _db.PasswordResetTokens
            .IgnoreQueryFilters()
            .Where(t => t.Id == resetToken.Id && t.UsedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.UsedAt, now));
        if (claimed != 1)
        {
            await transaction.RollbackAsync();
            return BadRequest(new { error = "Reset token expired or already used" });
        }

        // Update password
        resetToken.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
        resetToken.User.AuthenticationInvalidatedAt = now;

        // Revoke all refresh tokens (force re-login)
        var refreshTokens = await _db.RefreshTokens
            .IgnoreQueryFilters()
            .Where(t => t.UserId == resetToken.UserId && t.RevokedAt == null)
            .ToListAsync();

        foreach (var token in refreshTokens)
        {
            token.RevokedAt = now;
            token.RevokedReason = "password_change";
        }

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

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
    public string? NewPassword { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("password")]
    public string? Password { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("password_confirmation")]
    public string? PasswordConfirmation { get; init; }
}

#endregion
