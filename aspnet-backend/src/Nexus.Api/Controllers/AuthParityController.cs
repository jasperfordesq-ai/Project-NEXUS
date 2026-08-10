// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

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

    [HttpPost("refresh-token")]
    [AllowAnonymous]
    public IActionResult LegacyRefreshToken() =>
        StatusCode(StatusCodes.Status410Gone, new { error = "endpoint_retired", message = "Use POST /api/auth/refresh." });

    [HttpPost("revoke")]
    [Authorize]
    public IActionResult Revoke() => Ok(new { revoked = true });

    [HttpPost("revoke-all")]
    [Authorize]
    public IActionResult RevokeAll() => Ok(new { revoked = "all" });

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
