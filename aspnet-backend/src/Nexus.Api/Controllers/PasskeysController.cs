// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Asp.Versioning;
using Fido2NetLib;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// WebAuthn/Passkey endpoints for passwordless authentication.
/// Supports registration (adding passkeys to existing accounts) and
/// authentication (signing in with passkeys).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/passkeys")]
[Route("api/passkeys")] // Backward compatibility
public class PasskeysController : ControllerBase
{
    private readonly PasskeyService _passkeyService;
    private readonly NexusDbContext _db;
    private readonly TokenService _tokenService;
    private readonly TotpService _totpService;
    private readonly PasskeyChallengeStore _challengeStore;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<PasskeysController> _logger;

    // The legacy /api/passkeys ceremony retains its historical five-minute
    // window. Canonical Laravel /api/webauthn challenges expire after 120s.
    private static readonly TimeSpan ChallengeTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan CanonicalChallengeTtl = TimeSpan.FromSeconds(120);
    private static readonly JsonSerializerOptions WebJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public PasskeysController(
        PasskeyService passkeyService,
        NexusDbContext db,
        TokenService tokenService,
        TotpService totpService,
        PasskeyChallengeStore challengeStore,
        TenantContext tenantContext,
        ILogger<PasskeysController> logger)
    {
        _passkeyService = passkeyService;
        _db = db;
        _tokenService = tokenService;
        _totpService = totpService;
        _challengeStore = challengeStore;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    // =========================================================================
    // REGISTRATION (requires authentication - user adds passkey to their account)
    // =========================================================================

    /// <summary>
    /// Begin passkey registration. Returns WebAuthn creation options.
    /// The client passes these to navigator.credentials.create().
    /// </summary>
    [HttpPost("register/begin")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> BeginRegistration()
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized(new { error = "User not found" });

        try
        {
            var options = await _passkeyService.BeginRegistrationAsync(user);

            // Store options by user ID (registration requires auth so this is safe)
            var cacheKey = $"passkey:reg:{user.Id}:{user.TenantId}";
            _challengeStore.Set(cacheKey, options, ChallengeTtl);

            return Ok(options);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Maximum"))
        {
            return Conflict(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Complete passkey registration. Verifies the authenticator response and stores the credential.
    /// </summary>
    [HttpPost("register/finish")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> FinishRegistration([FromBody] PasskeyRegistrationFinishRequest request)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized(new { error = "User not found" });

        // Retrieve stored options (keyed by user ID since registration requires auth)
        var cacheKey = $"passkey:reg:{user.Id}:{user.TenantId}";
        if (!_challengeStore.TryTake<CredentialCreateOptions>(cacheKey, out var options))
        {
            return BadRequest(new { error = "Registration session expired or not started. Call begin first." });
        }

        try
        {
            var passkey = await _passkeyService.FinishRegistrationAsync(
                options, request.AttestationResponse, user, request.DisplayName);

            return Ok(new
            {
                success = true,
                passkey = new
                {
                    id = passkey.Id,
                    display_name = passkey.DisplayName,
                    created_at = passkey.CreatedAt,
                    is_discoverable = passkey.IsDiscoverable,
                    transports = passkey.Transports
                }
            });
        }
        catch (Fido2VerificationException ex)
        {
            _logger.LogWarning("Passkey registration verification failed for user {UserId}: {Error}",
                user.Id, ex.Message);
            return BadRequest(new { error = "Passkey verification failed", details = ex.Message });
        }
    }

    /// <summary>
    /// Canonical Laravel/React registration challenge. The opaque challenge ID
    /// is bound to the authenticated user and tenant and is valid once only.
    /// </summary>
    [HttpPost("/api/webauthn/register-challenge")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> BeginCanonicalRegistration(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement? body)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return CanonicalWebAuthnError(
                "AUTH_REQUIRED",
                "Authentication required",
                StatusCodes.Status401Unauthorized);
        }

        if (!HasSecurityConfirmation(body, user.Id, user.TenantId))
            return SecurityConfirmationRequired();

        try
        {
            var options = await _passkeyService.BeginRegistrationAsync(user);
            var challengeId = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
            _challengeStore.Set(
                $"passkey:reg:canonical:{challengeId}",
                new PasskeyRegistrationChallenge(options, user.Id, user.TenantId),
                CanonicalChallengeTtl);

            // CredentialCreateOptions already owns the browser-facing FIDO
            // shape and converters. Preserve that exact JSON while adding the
            // Laravel challenge identifier used by the React client.
            var serialized = JsonSerializer.SerializeToElement(options, WebJsonOptions);
            var data = serialized.EnumerateObject()
                .ToDictionary(
                    property => property.Name,
                    property => (object?)property.Value.Clone(),
                    StringComparer.Ordinal);
            data["challenge"] = Base64UrlEncoder.Encode(options.Challenge);
            data["challenge_id"] = challengeId;

            return CanonicalWebAuthnData(data);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(
                "Canonical passkey registration challenge denied for user {UserId}: {Error}",
                user.Id,
                ex.Message);
            var disabled = ex.Message.Contains("disabled", StringComparison.OrdinalIgnoreCase);
            return CanonicalWebAuthnError(
                disabled ? "FEATURE_DISABLED" : "WEBAUTHN_CREDENTIAL_LIMIT",
                disabled ? "This feature is disabled" : "Passkey registration is unavailable",
                disabled ? StatusCodes.Status403Forbidden : StatusCodes.Status409Conflict);
        }
    }

    /// <summary>
    /// Canonical Laravel/React registration verification. The challenge is
    /// removed before parsing or FIDO verification so every attempt is single-use.
    /// </summary>
    [HttpPost("/api/webauthn/register-verify")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> FinishCanonicalRegistration([FromBody] JsonElement body)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
            return CanonicalWebAuthnError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);
        if (!HasSecurityConfirmation(body, user.Id, user.TenantId))
            return SecurityConfirmationRequired();

        var challengeId = ReadJsonString(body, "challenge_id");
        if (string.IsNullOrWhiteSpace(challengeId))
        {
            return CanonicalWebAuthnError(
                "VALIDATION_REQUIRED_FIELD",
                "challenge_id is required",
                StatusCodes.Status400BadRequest);
        }

        var cacheKey = $"passkey:reg:canonical:{challengeId}";
        if (!_challengeStore.TryTake<PasskeyRegistrationChallenge>(cacheKey, out var challenge))
        {
            return CanonicalWebAuthnError(
                "AUTH_WEBAUTHN_CHALLENGE_EXPIRED",
                "Registration challenge expired",
                StatusCodes.Status401Unauthorized);
        }
        if (user.Id != challenge.UserId
            || user.TenantId != challenge.TenantId)
        {
            return CanonicalWebAuthnError(
                "AUTH_WEBAUTHN_CHALLENGE_INVALID",
                "Registration challenge does not belong to this account",
                StatusCodes.Status401Unauthorized);
        }

        AuthenticatorAttestationRawResponse? attestation;
        try
        {
            attestation = body.Deserialize<AuthenticatorAttestationRawResponse>(WebJsonOptions);
        }
        catch (Exception ex) when (ex is JsonException or FormatException or ArgumentException)
        {
            attestation = null;
        }

        if (attestation is null
            || string.IsNullOrWhiteSpace(attestation.Id)
            || attestation.Response is null)
        {
            return CanonicalWebAuthnError(
                "VALIDATION_REQUIRED_FIELD",
                "Invalid WebAuthn credential",
                StatusCodes.Status400BadRequest);
        }

        try
        {
            await _passkeyService.FinishRegistrationAsync(
                challenge.Options,
                attestation,
                user,
                ReadJsonString(body, "device_name"));

            return CanonicalWebAuthnData(new
            {
                message = "Passkey registered successfully"
            });
        }
        catch (Fido2VerificationException ex)
        {
            _logger.LogWarning(
                "Canonical passkey registration verification failed for user {UserId}: {Error}",
                user.Id,
                ex.Message);
            return CanonicalWebAuthnError(
                "AUTH_WEBAUTHN_FAILED",
                "Passkey registration failed",
                StatusCodes.Status400BadRequest);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(
                "Canonical passkey registration denied for user {UserId}: {Error}",
                user.Id,
                ex.Message);
            return CanonicalWebAuthnError(
                "AUTH_WEBAUTHN_FAILED",
                "Passkey registration is unavailable",
                StatusCodes.Status403Forbidden);
        }
    }

    // =========================================================================
    // AUTHENTICATION (public - used to sign in)
    // =========================================================================

    /// <summary>
    /// Canonical Laravel/React WebAuthn challenge contract. Unlike the legacy
    /// compatibility owner, this returns a real FIDO assertion challenge and
    /// stores the original options for one verification attempt.
    /// </summary>
    [HttpPost("/api/webauthn/auth-challenge")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> BeginCanonicalAuthentication([FromBody] PasskeyAuthBeginRequest? request)
    {
        var tenantId = await ResolveAuthenticationTenantAsync(request);
        var tenantWasExplicitlyRequested = HasExplicitTenantHint(request);
        var challengeTenantId = tenantId ?? (tenantWasExplicitlyRequested ? 0 : null);
        var options = await _passkeyService.BeginAuthenticationAsync(challengeTenantId, request?.Email);
        var challengeId = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
        _challengeStore.Set(
            $"passkey:auth:{challengeId}",
            new PasskeyAuthenticationChallenge(options, challengeTenantId),
            CanonicalChallengeTtl);

        var allowCredentials = options.AllowCredentials?
            .Select(credential => new
            {
                type = "public-key",
                id = Base64UrlEncoder.Encode(credential.Id)
            })
            .ToArray();

        return Ok(new
        {
            data = new
            {
                challenge = Base64UrlEncoder.Encode(options.Challenge),
                challenge_id = challengeId,
                rpId = options.RpId,
                timeout = options.Timeout,
                userVerification = options.UserVerification?.ToString().ToLowerInvariant() ?? "preferred",
                allowCredentials = allowCredentials is { Length: > 0 } ? allowCredentials : null
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    /// <summary>
    /// Canonical Laravel/React WebAuthn verification contract. A challenge is
    /// removed before signature verification, so failed assertions cannot be
    /// replayed against the same ceremony.
    /// </summary>
    [HttpPost("/api/webauthn/auth-verify")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> FinishCanonicalAuthentication([FromBody] JsonElement body)
    {
        var challengeId = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("challenge_id", out var challengeElement)
            && challengeElement.ValueKind == JsonValueKind.String
                ? challengeElement.GetString()
                : null;
        if (string.IsNullOrWhiteSpace(challengeId))
            return CanonicalWebAuthnError("VALIDATION_REQUIRED_FIELD", "challenge_id is required", StatusCodes.Status400BadRequest);

        var cacheKey = $"passkey:auth:{challengeId}";
        if (!_challengeStore.TryTake<PasskeyAuthenticationChallenge>(cacheKey, out var challenge))
            return CanonicalWebAuthnError("AUTH_WEBAUTHN_CHALLENGE_EXPIRED", "Authentication challenge expired", StatusCodes.Status401Unauthorized);

        AuthenticatorAssertionRawResponse? assertion;
        try
        {
            assertion = body.Deserialize<AuthenticatorAssertionRawResponse>(WebJsonOptions);
        }
        catch (JsonException)
        {
            assertion = null;
        }

        if (assertion is null
            || string.IsNullOrWhiteSpace(assertion.Id)
            || assertion.Response is null)
        {
            return CanonicalWebAuthnError("VALIDATION_REQUIRED_FIELD", "Invalid WebAuthn assertion", StatusCodes.Status400BadRequest);
        }

        try
        {
            var user = await _passkeyService.FinishAuthenticationAsync(
                challenge.Options,
                assertion,
                challenge.TenantId);
            var accessToken = _tokenService.GenerateJwt(user, "passkey", "user_verification");
            var (refreshToken, refreshTokenHash) = TokenService.GenerateRefreshToken();
            _db.RefreshTokens.Add(new Entities.RefreshToken
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                TokenHash = refreshTokenHash,
                ExpiresAt = DateTime.UtcNow.AddDays(7),
                ClientType = "passkey",
                CreatedByIp = HttpContext.Connection.RemoteIpAddress?.ToString()
            });
            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = "Passkey authentication successful.",
                user = new
                {
                    id = user.Id,
                    first_name = user.FirstName,
                    last_name = user.LastName,
                    email = user.Email
                },
                access_token = accessToken,
                refresh_token = refreshToken,
                token_type = "Bearer",
                expires_in = _tokenService.AccessTokenExpirySeconds,
                security_confirmation_token = _tokenService.GenerateSecurityConfirmationToken(user.Id, user.TenantId, "passkey_uv"),
                security_confirmation_expires_in = 300,
                is_mobile = false
            });
        }
        catch (Fido2VerificationException ex)
        {
            _logger.LogWarning("Canonical passkey verification failed: {Error}", ex.Message);
            return CanonicalWebAuthnError("AUTH_WEBAUTHN_FAILED", "Passkey authentication failed", StatusCodes.Status401Unauthorized);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning("Canonical passkey authentication failed: {Error}", ex.Message);
            return CanonicalWebAuthnError("AUTH_WEBAUTHN_FAILED", "Passkey authentication failed", StatusCodes.Status401Unauthorized);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            _logger.LogWarning("Canonical passkey assertion was malformed: {Error}", ex.Message);
            return CanonicalWebAuthnError("VALIDATION_REQUIRED_FIELD", "Invalid WebAuthn assertion", StatusCodes.Status400BadRequest);
        }
    }

    /// <summary>
    /// Begin passkey authentication. Returns WebAuthn assertion options.
    /// The client passes these to navigator.credentials.get().
    /// Can be called with or without tenant/email for different flows:
    /// - No params: conditional UI / autofill (empty allowCredentials, discoverable only)
    /// - With tenant_slug + email: user-specific (allowCredentials scoped to user)
    /// - With tenant_slug only: tenant-wide discoverable credentials
    /// </summary>
    [HttpPost("authenticate/begin")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> BeginAuthentication([FromBody] PasskeyAuthBeginRequest? request)
    {
        int? tenantId;
        string? email = request?.Email;

        // Resolve tenant if provided
        if (!string.IsNullOrEmpty(request?.TenantSlug))
        {
            var tenant = await _db.Tenants
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Slug == request.TenantSlug && t.IsActive);
            if (tenant != null) tenantId = tenant.Id;
            else tenantId = 0;
        }
        else if (request?.TenantId.HasValue == true)
        {
            tenantId = await IsActiveTenantAsync(request.TenantId.Value)
                ? request.TenantId.Value
                : 0;
        }
        else
        {
            tenantId = await ResolveAuthenticationTenantAsync(request);
        }

        var options = await _passkeyService.BeginAuthenticationAsync(tenantId, email);

        // Store options by a session ID for retrieval in finish
        var sessionId = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var cacheKey = $"passkey:auth:{sessionId}";
        _challengeStore.Set(cacheKey, new PasskeyAuthenticationChallenge(options, tenantId), ChallengeTtl);

        // Return options + session ID
        return Ok(new
        {
            options,
            session_id = sessionId
        });
    }

    /// <summary>
    /// Complete passkey authentication. Verifies the assertion and returns JWT tokens.
    /// </summary>
    [HttpPost("authenticate/finish")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> FinishAuthentication([FromBody] PasskeyAuthFinishRequest request)
    {
        if (string.IsNullOrEmpty(request.SessionId))
        {
            return BadRequest(new { error = "session_id is required" });
        }

        // Retrieve stored assertion options
        var cacheKey = $"passkey:auth:{request.SessionId}";
        if (!_challengeStore.TryTake<PasskeyAuthenticationChallenge>(cacheKey, out var challenge))
        {
            return BadRequest(new { error = "Authentication session expired or not started" });
        }

        try
        {
            var user = await _passkeyService.FinishAuthenticationAsync(
                challenge.Options,
                request.AssertionResponse,
                challenge.TenantId);

            // Resolve tenant for response
            var tenant = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == user.TenantId);

            // Generate JWT (same as password login)
            var accessToken = _tokenService.GenerateJwt(user);
            var (refreshToken, refreshTokenHash) = TokenService.GenerateRefreshToken();

            // Store refresh token
            var refreshTokenEntity = new Entities.RefreshToken
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                TokenHash = refreshTokenHash,
                ExpiresAt = DateTime.UtcNow.AddDays(7),
                ClientType = "passkey",
                CreatedByIp = HttpContext.Connection.RemoteIpAddress?.ToString()
            };
            _db.RefreshTokens.Add(refreshTokenEntity);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
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
                    tenant_id = user.TenantId,
                    tenant_slug = tenant?.Slug
                }
            });
        }
        catch (Fido2VerificationException ex)
        {
            _logger.LogWarning("Passkey authentication verification failed: {Error}", ex.Message);
            return Unauthorized(new { error = "Passkey verification failed" });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning("Passkey authentication failed: {Error}", ex.Message);
            return Unauthorized(new { error = ex.Message });
        }
    }

    // =========================================================================
    // MANAGEMENT (requires authentication)
    // =========================================================================

    /// <summary>
    /// List all passkeys for the current user.
    /// </summary>
    [HttpGet]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> ListPasskeys()
    {
        var (userId, tenantId) = GetUserContext();
        if (userId == 0) return Unauthorized(new { error = "Invalid token" });

        var passkeys = await _passkeyService.GetUserPasskeysAsync(userId, tenantId);

        return Ok(new
        {
            passkeys = passkeys.Select(p => new
            {
                id = p.Id,
                display_name = p.DisplayName,
                created_at = p.CreatedAt,
                last_used_at = p.LastUsedAt,
                is_discoverable = p.IsDiscoverable,
                transports = p.Transports
            })
        });
    }

    /// <summary>
    /// Delete a passkey.
    /// </summary>
    [HttpDelete("{id:int}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> DeletePasskey(int id)
    {
        var (userId, tenantId) = GetUserContext();
        if (userId == 0) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var (deleted, deleteError) = await _passkeyService.DeletePasskeyAsync(id, userId, tenantId);
            if (!deleted) return NotFound(new { error = deleteError ?? "Passkey not found" });

            return Ok(new { success = true, message = "Passkey deleted" });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Rename a passkey.
    /// </summary>
    [HttpPut("{id:int}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RenamePasskey(int id, [FromBody] RenamePasskeyRequest request)
    {
        var (userId, tenantId) = GetUserContext();
        if (userId == 0) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            return BadRequest(new { error = "display_name is required" });
        }

        var (renamed, renameError) = await _passkeyService.RenamePasskeyAsync(id, userId, tenantId, request.DisplayName.Trim());
        if (!renamed) return NotFound(new { error = renameError ?? "Passkey not found" });

        return Ok(new { success = true });
    }

    // =========================================================================
    // CANONICAL LARAVEL / REACT MANAGEMENT
    // =========================================================================

    [HttpGet("/api/webauthn/status")]
    [Authorize]
    public async Task<IActionResult> CanonicalStatus()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return CanonicalWebAuthnError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);
        }

        var passkeys = await _passkeyService.GetUserPasskeysAsync(user.Id, user.TenantId);
        return CanonicalWebAuthnData(new
        {
            registered = passkeys.Count > 0,
            count = passkeys.Count
        });
    }

    [HttpGet("/api/webauthn/credentials")]
    [Authorize]
    public async Task<IActionResult> CanonicalCredentials()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return CanonicalWebAuthnError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);
        }

        var passkeys = await _passkeyService.GetUserPasskeysAsync(user.Id, user.TenantId);
        var credentials = passkeys.Select(passkey => new
        {
            credential_id = Base64UrlEncoder.Encode(passkey.CredentialId),
            device_name = passkey.DisplayName,
            authenticator_type = passkey.CredType,
            created_at = passkey.CreatedAt,
            last_used_at = passkey.LastUsedAt
        }).ToArray();

        return CanonicalWebAuthnData(new
        {
            credentials,
            count = credentials.Length
        });
    }

    [HttpPost("/api/webauthn/remove")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> CanonicalRemove([FromBody] JsonElement body)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return CanonicalWebAuthnError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);
        }
        if (!HasSecurityConfirmation(body, user.Id, user.TenantId))
            return SecurityConfirmationRequired();

        var credentialId = ReadJsonString(body, "credential_id");
        if (string.IsNullOrWhiteSpace(credentialId))
        {
            // Laravel retains this legacy behavior for callers predating the
            // dedicated remove-all route.
            await _passkeyService.RemoveAllUserPasskeysAsync(user.Id, user.TenantId);
        }
        else
        {
            await _passkeyService.DeleteCredentialAsync(credentialId, user.Id, user.TenantId);
        }

        return CanonicalWebAuthnData(new
        {
            message = "Credential(s) removed"
        });
    }

    [HttpPost("/api/webauthn/rename")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> CanonicalRename([FromBody] JsonElement body)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return CanonicalWebAuthnError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);
        }
        if (!HasSecurityConfirmation(body, user.Id, user.TenantId))
            return SecurityConfirmationRequired();

        var credentialId = ReadJsonString(body, "credential_id");
        var deviceName = ReadJsonString(body, "device_name")?.Trim();
        if (string.IsNullOrWhiteSpace(credentialId) || string.IsNullOrWhiteSpace(deviceName))
        {
            return CanonicalWebAuthnError(
                "VALIDATION_ERROR",
                "credential_id and device_name are required",
                StatusCodes.Status400BadRequest);
        }

        deviceName = deviceName[..Math.Min(deviceName.Length, 100)];
        var renamed = await _passkeyService.RenameCredentialAsync(
            credentialId,
            user.Id,
            user.TenantId,
            deviceName);
        if (!renamed)
        {
            return CanonicalWebAuthnError(
                "RESOURCE_NOT_FOUND",
                "Credential not found",
                StatusCodes.Status404NotFound);
        }

        return CanonicalWebAuthnData(new { device_name = deviceName });
    }

    [HttpPost("/api/webauthn/remove-all")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> CanonicalRemoveAll(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement? body)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return CanonicalWebAuthnError("AUTH_REQUIRED", "Authentication required", StatusCodes.Status401Unauthorized);
        }
        if (!HasSecurityConfirmation(body, user.Id, user.TenantId))
            return SecurityConfirmationRequired();

        var removedCount = await _passkeyService.RemoveAllUserPasskeysAsync(user.Id, user.TenantId);
        return CanonicalWebAuthnData(new
        {
            message = $"Removed {removedCount} passkey(s). You can now re-register on any device.",
            removed_count = removedCount
        });
    }

    [HttpPost("/api/webauthn/security-confirm")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.WebAuthnSecurityConfirmPolicy)]
    public async Task<IActionResult> ConfirmCanonicalSecurityAction(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement? body)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
            return CanonicalWebAuthnError("AUTH_ACCOUNT_SUSPENDED", "Account suspended", StatusCodes.Status403Forbidden);

        string? method = null;
        var password = ReadJsonString(body, "current_password");
        var totpCode = ReadJsonString(body, "totp_code");
        var backupCode = ReadJsonString(body, "backup_code");

        if (!string.IsNullOrEmpty(password))
        {
            if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
                return SecurityConfirmationRequired();
            method = "password";
        }
        else if (!string.IsNullOrEmpty(totpCode))
        {
            var result = await _totpService.ValidateLoginCodeAsync(user.Id, string.Concat(totpCode.Where(c => !char.IsWhiteSpace(c))));
            if (!result.Valid)
                return SecurityConfirmationRequired();
            method = "totp";
        }
        else if (!string.IsNullOrEmpty(backupCode))
        {
            var result = await _totpService.ValidateBackupCodeAsync(user.Id, user.TenantId, backupCode);
            if (!result.Valid)
                return SecurityConfirmationRequired();
            method = "backup_code";
        }
        else if (HasRecentPasskeyUserVerification())
        {
            method = "passkey_uv";
        }
        else
        {
            return SecurityConfirmationRequired();
        }

        Response.Headers.CacheControl = "no-store, private";
        Response.Headers.Pragma = "no-cache";
        _logger.LogInformation(
            "WebAuthn security action confirmed for tenant {TenantId}, user {UserId}, method {Method}",
            user.TenantId,
            user.Id,
            method);
        return CanonicalWebAuthnData(new
        {
            security_confirmation_token = _tokenService.GenerateSecurityConfirmationToken(user.Id, user.TenantId, method),
            expires_in = 300
        });
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private async Task<Entities.User?> GetCurrentUserAsync()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        var tenantIdClaim = User.FindFirst("tenant_id")?.Value;

        if (!int.TryParse(userIdClaim, out var userId) || !int.TryParse(tenantIdClaim, out var tenantId))
            return null;

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(candidate =>
                candidate.Id == userId
                && candidate.TenantId == tenantId
                && candidate.IsActive
                && candidate.SuspendedAt == null
                && candidate.RegistrationStatus == Entities.RegistrationStatus.Active);
        if (user is null || !await IsActiveTenantAsync(tenantId))
        {
            return null;
        }

        return user;
    }

    private (int userId, int tenantId) GetUserContext()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        var tenantIdClaim = User.FindFirst("tenant_id")?.Value;

        if (int.TryParse(userIdClaim, out var userId) && int.TryParse(tenantIdClaim, out var tenantId))
            return (userId, tenantId);

        return (0, 0);
    }

    private bool HasSecurityConfirmation(JsonElement? body, int userId, int tenantId)
    {
        var token = ReadJsonString(body, "security_confirmation_token")
            ?? Request.Headers["X-Security-Confirmation"].FirstOrDefault();
        return _tokenService.ValidateSecurityConfirmationToken(token, userId, tenantId);
    }

    private bool HasRecentPasskeyUserVerification()
    {
        var methods = User.FindAll("amr").Select(claim => claim.Value).ToHashSet(StringComparer.Ordinal);
        var issuedAtText = User.FindFirst("iat")?.Value;
        return methods.Contains("passkey")
            && methods.Contains("user_verification")
            && long.TryParse(issuedAtText, out var issuedAt)
            && issuedAt >= DateTimeOffset.UtcNow.AddMinutes(-5).ToUnixTimeSeconds()
            && issuedAt <= DateTimeOffset.UtcNow.AddSeconds(30).ToUnixTimeSeconds();
    }

    private IActionResult SecurityConfirmationRequired()
    {
        Response.Headers.CacheControl = "no-store, private";
        Response.Headers.Pragma = "no-cache";
        return CanonicalWebAuthnError(
            "SECURITY_CONFIRMATION_REQUIRED",
            "Validation failed",
            StatusCodes.Status403Forbidden);
    }

    private static string? ReadJsonString(JsonElement? body, string name)
        => body.HasValue ? ReadJsonString(body.Value, name) : null;

    private IActionResult CanonicalWebAuthnError(string code, string message, int status)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new
        {
            success = false,
            errors = new[] { new { code, message } }
        });
    }

    private IActionResult CanonicalWebAuthnData(object data)
    {
        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private async Task<int?> ResolveAuthenticationTenantAsync(PasskeyAuthBeginRequest? request)
    {
        var tokenTenantId = User.FindFirst("tenant_id")?.Value;
        if (int.TryParse(tokenTenantId, out var claimedTenantId)
            && await IsActiveTenantAsync(claimedTenantId))
        {
            return claimedTenantId;
        }

        if (_tenantContext.TenantId is { } contextTenantId
            && await IsActiveTenantAsync(contextTenantId))
        {
            return contextTenantId;
        }

        if (request?.TenantId is { } requestedTenantId)
        {
            return await IsActiveTenantAsync(requestedTenantId)
                ? requestedTenantId
                : null;
        }

        if (!string.IsNullOrWhiteSpace(request?.TenantSlug))
        {
            return await _db.Tenants
                .AsNoTracking()
                .Where(tenant => tenant.IsActive && tenant.Slug == request.TenantSlug)
                .Select(tenant => (int?)tenant.Id)
                .FirstOrDefaultAsync();
        }

        if (Request.Headers.TryGetValue("X-Tenant-ID", out var tenantHeader)
            && int.TryParse(tenantHeader.FirstOrDefault(), out var headerTenantId))
        {
            return await IsActiveTenantAsync(headerTenantId)
                ? headerTenantId
                : null;
        }

        var requestHost = Request.Host.Host;
        if (!string.IsNullOrWhiteSpace(requestHost)
            && !requestHost.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            && !requestHost.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase))
        {
            var hostTenantId = await _db.Tenants
                .AsNoTracking()
                .Where(tenant =>
                    tenant.IsActive
                    && tenant.Domain != null
                    && tenant.Domain.ToLower() == requestHost.ToLower())
                .Select(tenant => (int?)tenant.Id)
                .FirstOrDefaultAsync();
            if (hostTenantId.HasValue)
            {
                return hostTenantId;
            }
        }

        if (!string.IsNullOrWhiteSpace(request?.Email))
        {
            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            var candidateTenantIds = await _db.UserPasskeys
                .IgnoreQueryFilters()
                .Where(passkey =>
                    passkey.User != null
                    && passkey.User.TenantId == passkey.TenantId
                    && passkey.User.Email.ToLower() == normalizedEmail
                    && passkey.User.IsActive
                    && passkey.User.SuspendedAt == null
                    && passkey.User.RegistrationStatus == Entities.RegistrationStatus.Active
                    && passkey.Tenant != null
                    && passkey.Tenant.IsActive)
                .Select(passkey => passkey.TenantId)
                .Distinct()
                .Take(2)
                .ToListAsync();
            if (candidateTenantIds.Count == 1)
            {
                return candidateTenantIds[0];
            }
        }

        return null;
    }

    private bool HasExplicitTenantHint(PasskeyAuthBeginRequest? request)
    {
        return request?.TenantId.HasValue == true
            || !string.IsNullOrWhiteSpace(request?.TenantSlug)
            || Request.Headers.ContainsKey("X-Tenant-ID")
            || User.FindFirst("tenant_id") is not null;
    }

    private Task<bool> IsActiveTenantAsync(int tenantId)
    {
        return _db.Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsActive);
    }

    private static string? ReadJsonString(JsonElement body, string propertyName)
    {
        return body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.String
                ? property.GetString()
                : null;
    }

}

// =========================================================================
// Request models
// =========================================================================

public record PasskeyRegistrationFinishRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("attestation_response")]
    public AuthenticatorAttestationRawResponse AttestationResponse { get; init; } = null!;

    [System.Text.Json.Serialization.JsonPropertyName("display_name")]
    public string? DisplayName { get; init; }
}

public record PasskeyAuthBeginRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("tenant_slug")]
    public string? TenantSlug { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("tenant_id")]
    public int? TenantId { get; init; }

    [System.Text.Json.Serialization.JsonPropertyName("email")]
    public string? Email { get; init; }
}

public record PasskeyAuthFinishRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("session_id")]
    public string SessionId { get; init; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("assertion_response")]
    public AuthenticatorAssertionRawResponse AssertionResponse { get; init; } = null!;
}

public record RenamePasskeyRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("display_name")]
    public string DisplayName { get; init; } = string.Empty;
}

internal sealed record PasskeyRegistrationChallenge(
    CredentialCreateOptions Options,
    int UserId,
    int TenantId);

internal sealed record PasskeyAuthenticationChallenge(
    AssertionOptions Options,
    int? TenantId);
