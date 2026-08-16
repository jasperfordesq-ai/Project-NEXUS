// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly IConfiguration _config;
    private static readonly string[] SupportedOAuthProviders = ["google", "apple", "facebook"];

    public AuthParityController(NexusDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    [HttpGet("csrf-token")]
    [AllowAnonymous]
    public IActionResult CsrfToken() => Ok(new { csrf_token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant() });

    [HttpGet("check-session")]
    [Authorize]
    public IActionResult CheckSession() => Ok(new { authenticated = true, user_id = User.GetUserId(), role = User.GetRole() });

    [HttpPost("admin-session")]
    [AllowAnonymous]
    public async Task<IActionResult> AdminSession()
    {
        var token = await GetSubmittedTokenAsync();
        var redirect = SanitizeLegacyAdminRedirect(await GetSubmittedRedirectAsync());

        if (string.IsNullOrWhiteSpace(token))
            return BadRequest(new { success = false, error = "missing_token", code = "AUTH_TOKEN_MISSING" });

        var principal = ValidateSubmittedJwt(token);
        if (principal == null)
            return Unauthorized(new { success = false, error = "invalid_or_expired_token", code = "AUTH_TOKEN_INVALID" });

        var userIdValue = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var tenantIdValue = principal.FindFirst("tenant_id")?.Value;
        if (!int.TryParse(userIdValue, out var userId) || !int.TryParse(tenantIdValue, out var tenantId))
            return Unauthorized(new { success = false, error = "invalid_token_payload", code = "AUTH_TOKEN_INVALID" });

        var user = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.Id == userId && u.TenantId == tenantId)
            .Select(u => new { u.Id, u.Role, u.IsActive })
            .FirstOrDefaultAsync();

        if (user == null || !user.IsActive)
            return NotFound(new { success = false, error = "user_not_found", code = "RESOURCE_NOT_FOUND" });

        if (user.Role != "admin" && user.Role != "super_admin" && user.Role != "tenant_admin")
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "admin_access_required", code = "AUTH_INSUFFICIENT_PERMISSIONS" });

        return Redirect(redirect);
    }

    [HttpPost("heartbeat")]
    [Authorize]
    public IActionResult Heartbeat() => Ok(new { alive = true, at = DateTime.UtcNow });

    [HttpPost("refresh-session")]
    [Authorize]
    public IActionResult RefreshSession() => Ok(new { refreshed = true, user_id = User.GetUserId() });

    // Retired 2026-05-11 (audit finding): the previous anonymous stubs returned
    // {restored:true}/{refreshed:true} unconditionally, advertising a working
    // auth surface without verification. Now return 410 Gone so misbehaving
    // clients fail loudly instead of believing they have a session.
    [HttpPost("restore-session")]
    [AllowAnonymous]
    public IActionResult RestoreSession() =>
        StatusCode(StatusCodes.Status410Gone, new { error = "endpoint_retired", message = "Use POST /api/auth/refresh." });

    // 🔴 refresh-token is NOT retired: it is the only refresh path the React
    // client calls (react-frontend/src/lib/api.ts:779) and the one Laravel
    // registers (routes/api.php:3319). Answering 410 here logged every member
    // out at the first token expiry, because the client treats a 4xx as
    // "credentials are bad" and deletes them. The real handler now owns both
    // spellings (AuthController.Refresh); this stub is deliberately gone rather
    // than commented out, so it cannot be reinstated by accident.

    /// <summary>
    /// POST /api/auth/revoke — revoke one refresh token (sign out one device).
    ///
    /// 🔴 Returned <c>{revoked:true}</c> unconditionally until 2026-08-16 while
    /// revoking nothing. A member told "that device has been signed out" kept a
    /// fully working session on it, and the platform had no record either way.
    /// For a sign-out control that is not a cosmetic bug — it is the control
    /// people reach for when they think someone else has their account.
    ///
    /// Laravel: <c>AuthController::revokeToken</c> (routes/api.php:3423) —
    /// requires <c>refresh_token</c> in the body, 400 when absent, 400 when the
    /// token is unknown or already revoked, and scopes the revoke to the caller
    /// so one member cannot revoke another's session.
    /// </summary>
    [HttpPost("revoke")]
    [Authorize]
    public async Task<IActionResult> Revoke([FromBody] RevokeTokenRequest? request)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(new { success = false, error = "Authentication required", code = "AUTH_TOKEN_MISSING" });
        }

        var submitted = request?.RefreshToken;
        if (string.IsNullOrWhiteSpace(submitted))
        {
            return BadRequest(new
            {
                success = false,
                error = "refresh_token is required",
                code = "VALIDATION_REQUIRED_FIELD",
            });
        }

        var tokenHash = TokenService.HashToken(submitted);

        // 🔴 Scoped to the caller. Matching on the hash alone would let anyone
        // holding a stolen token revoke the rightful owner's session, and would
        // also let one member sign another out.
        var token = await _db.RefreshTokens.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.TokenHash == tokenHash
                && t.UserId == userId.Value
                && t.RevokedAt == null);

        if (token is null)
        {
            // Deliberately the same answer for "not yours", "unknown" and
            // "already revoked": distinguishing them tells a caller holding a
            // token whether it is real.
            return BadRequest(new
            {
                success = false,
                error = "Invalid or already revoked refresh token",
                code = "AUTH_TOKEN_INVALID",
            });
        }

        token.RevokedAt = DateTime.UtcNow;
        token.RevokedReason = "manual";
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { revoked = true } });
    }

    /// <summary>
    /// POST /api/auth/revoke-all — revoke every refresh token for the caller
    /// (sign out everywhere).
    ///
    /// 🔴 Returned <c>{revoked:"all"}</c> unconditionally until 2026-08-16
    /// while revoking nothing. This is the control a member uses after "someone
    /// else has my password" — reporting success while every stolen session
    /// stays live is the worst possible answer to that.
    ///
    /// Laravel: <c>AuthController::revokeAllTokens</c> (routes/api.php:3424).
    /// </summary>
    [HttpPost("revoke-all")]
    [Authorize]
    public async Task<IActionResult> RevokeAll()
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(new { success = false, error = "Authentication required", code = "AUTH_TOKEN_MISSING" });
        }

        var now = DateTime.UtcNow;
        var revoked = await _db.RefreshTokens.IgnoreQueryFilters()
            .Where(t => t.UserId == userId.Value && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.RevokedReason, "revoke_all"));

        // A member with no live refresh tokens is already signed out
        // everywhere, so zero is a success, not an error.
        return Ok(new { success = true, data = new { revoked = true, count = revoked } });
    }

    public sealed class RevokeTokenRequest
    {
        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; set; }
    }

    [HttpGet("validate-token")]
    [Authorize]
    public IActionResult ValidateTokenGet() => Ok(new { valid = true, user_id = User.GetUserId() });

    // Retired 2026-05-11 (audit finding): previously returned {valid:true}
    // unconditionally without checking the token. Now requires the standard
    // JWT [Authorize] flow — clients that need to validate should call
    // GET /api/auth/validate-token (which uses [Authorize]).
    [HttpPost("validate-token")]
    [Authorize]
    public IActionResult ValidateTokenPost() => Ok(new { valid = true, user_id = User.GetUserId() });

    [HttpGet("oauth/enabled-providers")]
    [HttpGet("~/api/v2/auth/oauth/enabled-providers")]
    [AllowAnonymous]
    public IActionResult EnabledProviders()
    {
        var providers = OAuthEnabled() && ResolveOAuthTenantId() > 0 ? SupportedOAuthProviders : [];
        return Ok(new { success = true, providers });
    }

    [HttpGet("oauth/{provider}/redirect")]
    [HttpGet("~/api/v2/auth/oauth/{provider}/redirect")]
    [AllowAnonymous]
    public IActionResult OAuthRedirect(string provider)
    {
        provider = NormalizeOAuthProvider(provider);
        if (!SupportedOAuthProviders.Contains(provider))
            return BadRequest(new { success = false, error = "unsupported_provider", message = "OAuth provider is not supported." });

        if (ResolveOAuthTenantId() <= 0)
            return BadRequest(new { success = false, error = "tenant_required", message = "Tenant is required for OAuth." });

        if (!OAuthEnabled())
            return BadRequest(new { success = false, error = "oauth_redirect_failed", message = "OAuth provider is disabled for this community." });

        var state = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        var intent = string.Equals(Request.Query["intent"].FirstOrDefault(), "register", StringComparison.OrdinalIgnoreCase)
            ? "register"
            : "login";
        var redirectUrl = $"/api/v2/auth/oauth/{provider}/callback?state={Uri.EscapeDataString(state)}&intent={intent}";
        return Ok(new { success = true, redirect_url = redirectUrl, state, provider });
    }

    [HttpGet("oauth/me/identities")]
    [HttpGet("~/api/v2/auth/oauth/me/identities")]
    [Authorize]
    public IActionResult OAuthIdentities() => Ok(new
    {
        success = true,
        identities = Array.Empty<object>(),
        enabled_providers = OAuthEnabled() ? SupportedOAuthProviders : [],
        supported_providers = SupportedOAuthProviders
    });

    [HttpPost("oauth/{provider}/link")]
    [HttpPost("~/api/v2/auth/oauth/{provider}/link")]
    [Authorize]
    public IActionResult LinkOAuth(string provider, [FromBody] JsonElement body)
    {
        provider = NormalizeOAuthProvider(provider);
        if (!SupportedOAuthProviders.Contains(provider))
            return BadRequest(new { success = false, error = "unsupported_provider", message = "OAuth provider is not supported." });

        if (!OAuthEnabled())
            return BadRequest(new { success = false, error = "oauth_link_failed", message = "OAuth provider is disabled for this community." });

        var state = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        return Ok(new
        {
            success = true,
            redirect_url = $"/api/v2/auth/oauth/{provider}/callback?state={Uri.EscapeDataString(state)}&intent=link",
            state
        });
    }

    [HttpDelete("oauth/{provider}/unlink")]
    [HttpDelete("~/api/v2/auth/oauth/{provider}/unlink")]
    [Authorize]
    public IActionResult UnlinkOAuth(string provider)
    {
        provider = NormalizeOAuthProvider(provider);
        if (!SupportedOAuthProviders.Contains(provider))
            return UnprocessableEntity(new { success = false, error = "unlink_failed", message = "OAuth provider is not supported." });

        return Ok(new { success = true });
    }

    private bool OAuthEnabled()
    {
        var configured = _config["OAuth:Enabled"]
            ?? _config["OAUTH_ENABLED"];

        return bool.TryParse(configured, out var enabled) && enabled;
    }

    private int ResolveOAuthTenantId()
    {
        if (int.TryParse(Request.Query["tenant_id"].FirstOrDefault(), out var queryTenantId))
            return queryTenantId;

        if (int.TryParse(Request.Headers["X-Tenant-Id"].FirstOrDefault(), out var headerTenantId))
            return headerTenantId;

        if (int.TryParse(Request.Headers["X-Tenant-ID"].FirstOrDefault(), out var alternateHeaderTenantId))
            return alternateHeaderTenantId;

        return 0;
    }

    private static string NormalizeOAuthProvider(string provider) =>
        provider.Trim().ToLowerInvariant();

    private async Task<string?> GetSubmittedTokenAsync()
    {
        if (Request.HasFormContentType)
            return (await Request.ReadFormAsync())["token"].FirstOrDefault();

        if (Request.Headers.Authorization.FirstOrDefault() is { } authorization &&
            authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return authorization["Bearer ".Length..].Trim();
        }

        return Request.Query["token"].FirstOrDefault();
    }

    private async Task<string?> GetSubmittedRedirectAsync()
    {
        if (Request.HasFormContentType)
            return (await Request.ReadFormAsync())["redirect"].FirstOrDefault();

        return Request.Query["redirect"].FirstOrDefault();
    }

    private ClaimsPrincipal? ValidateSubmittedJwt(string token)
    {
        var secret = _config["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(secret))
            return null;

        var issuer = _config["Jwt:Issuer"];
        var audience = _config["Jwt:Audience"];
        var parameters = new TokenValidationParameters
        {
            NameClaimType = "sub",
            RoleClaimType = "role",
            ValidateIssuer = !string.IsNullOrWhiteSpace(issuer),
            ValidateAudience = !string.IsNullOrWhiteSpace(audience),
            ValidIssuer = issuer,
            ValidAudience = audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        try
        {
            return new JwtSecurityTokenHandler().ValidateToken(token, parameters, out _);
        }
        catch (SecurityTokenException)
        {
            return null;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static string SanitizeLegacyAdminRedirect(string? redirect)
    {
        if (string.IsNullOrWhiteSpace(redirect) ||
            !redirect.StartsWith("/admin-legacy", StringComparison.Ordinal))
        {
            return "/admin-legacy";
        }

        return redirect;
    }
}
