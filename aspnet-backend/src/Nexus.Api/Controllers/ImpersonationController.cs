// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Impersonation exchange and end — Laravel parity for
/// AuthController::impersonateExchange / impersonateEnd. Absolute /api/v2
/// routes only (deliberately NOT the versioned auth controller, so no
/// /api/v1 twin of an anonymous credential-spending endpoint is exposed).
///
/// The exchange is anonymous: the proof IS the credential. It is consumed
/// single-use by inserting its jti into revoked_tokens (a duplicate insert
/// means already spent), then a 15-minute session token is minted with NO
/// refresh token. Authority is re-checked at spend time so a promotion inside
/// the 5-minute window can never become an escalation.
/// </summary>
[ApiController]
public class ImpersonationController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TokenService _tokens;
    private readonly ILogger<ImpersonationController> _logger;

    public ImpersonationController(
        NexusDbContext db, TokenService tokens, ILogger<ImpersonationController> logger)
    {
        _db = db;
        _tokens = tokens;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpPost("api/v2/auth/impersonate/exchange")]
    public async Task<IActionResult> Exchange([FromBody] JsonElement body)
    {
        var proof = ReadString(body, "token") ?? ReadString(body, "impersonation_token");
        if (string.IsNullOrWhiteSpace(proof))
        {
            return Error(422, "VALIDATION_ERROR", "An impersonation token is required");
        }

        var principal = _tokens.ReadImpersonationProof(proof);
        if (principal is null)
        {
            return Error(401, "AUTH_TOKEN_EXPIRED", "This impersonation link is invalid or has expired");
        }

        var jti = principal.FindFirst(JwtRegisteredClaimNames.Jti)!.Value;
        var targetId = int.Parse(principal.FindFirst(JwtRegisteredClaimNames.Sub)!.Value);
        var tokenTenantId = int.Parse(principal.FindFirst("tenant_id")!.Value);
        var impersonatedBy = int.Parse(principal.FindFirst("impersonated_by")!.Value);

        // Single-use consumption: the UNIQUE(jti) makes the first inserter the
        // only spender; a duplicate means the proof was already used.
        _db.RevokedTokens.Add(new Entities.RevokedToken
        {
            UserId = targetId,
            Jti = jti,
            RevokedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddSeconds(TokenService.ImpersonationProofExpirySeconds)
        });
        try
        {
            await _db.SaveChangesAsync(HttpContext.RequestAborted);
        }
        catch (DbUpdateException)
        {
            return Error(401, "AUTH_TOKEN_EXPIRED", "This impersonation link has already been used");
        }

        // Tenant binding: a resolved tenant must match the proof's tenant.
        var headerTenant = Request.Headers["X-Tenant-ID"].FirstOrDefault();
        if (int.TryParse(headerTenant, out var headerTenantId) && headerTenantId != tokenTenantId)
        {
            return Error(403, "AUTH_INSUFFICIENT_PERMISSIONS", "This link is for a different community");
        }

        var target = await _db.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(u => u.Id == targetId && u.TenantId == tokenTenantId,
                HttpContext.RequestAborted);
        if (target is null || !target.IsActive)
        {
            return Error(403, "AUTH_INSUFFICIENT_PERMISSIONS", "This member's account is not available");
        }

        // Spend-time re-check: a promotion within the 5-minute window must not
        // become an escalation.
        if (target.Role is "super_admin" or "god" || target.IsSuperAdmin || target.IsGod)
        {
            return Error(403, "AUTH_INSUFFICIENT_PERMISSIONS", "This member's account is not available");
        }

        var actor = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == impersonatedBy, HttpContext.RequestAborted);
        var actorIsAdmin = actor is not null && actor.IsActive
            && (actor.Role is "admin" or "tenant_admin" or "super_admin" or "god"
                || actor.IsAdmin || actor.IsSuperAdmin || actor.IsTenantSuperAdmin || actor.IsGod);
        if (!actorIsAdmin)
        {
            return Error(403, "AUTH_INSUFFICIENT_PERMISSIONS", "The impersonating administrator is unavailable");
        }

        var (sessionToken, _) = _tokens.GenerateImpersonationSessionToken(target, impersonatedBy);
        var targetName = $"{target.FirstName} {target.LastName}".Trim();
        var actorName = $"{actor!.FirstName} {actor.LastName}".Trim();
        _logger.LogInformation(
            "[Impersonation] session started admin_id={AdminId} target_user_id={TargetId} tenant_id={TenantId}",
            impersonatedBy, target.Id, tokenTenantId);

        // Raw shape, NOT the data/meta envelope — Laravel returns this verbatim.
        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            success = true,
            access_token = sessionToken,
            token = sessionToken,
            token_type = "Bearer",
            expires_in = TokenService.ImpersonationSessionExpirySeconds,
            impersonation = new
            {
                active = true,
                user_id = target.Id,
                user_name = string.IsNullOrEmpty(targetName) ? target.Email : targetName,
                tenant_id = tokenTenantId,
                admin_id = impersonatedBy,
                admin_name = string.IsNullOrEmpty(actorName) ? actor.Email : actorName,
                expires_in = TokenService.ImpersonationSessionExpirySeconds
            }
            // No refresh_token — deliberately.
        });
    }

    [Authorize]
    [HttpPost("api/v2/auth/impersonate/end")]
    public async Task<IActionResult> End()
    {
        var bearer = Request.Headers.Authorization.FirstOrDefault();
        var token = bearer?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
            ? bearer["Bearer ".Length..] : null;
        var sessionJti = TokenService.ReadImpersonationSessionJti(token);
        if (string.IsNullOrWhiteSpace(sessionJti))
        {
            return Error(422, "VALIDATION_ERROR", "No impersonation session was found");
        }

        // Idempotent: a duplicate end is not an error. Only this session's jti
        // is revoked — the member's own sessions are untouched.
        var alreadyRevoked = await _db.RevokedTokens
            .AnyAsync(t => t.Jti == sessionJti, HttpContext.RequestAborted);
        if (!alreadyRevoked)
        {
            _db.RevokedTokens.Add(new Entities.RevokedToken
            {
                UserId = User.GetUserId(),
                Jti = sessionJti,
                RevokedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddSeconds(TokenService.ImpersonationSessionExpirySeconds)
            });
            try
            {
                await _db.SaveChangesAsync(HttpContext.RequestAborted);
            }
            catch (DbUpdateException)
            {
                // Lost the race to another end call — still ended.
            }
        }

        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data = new { ended = true },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private static string? ReadString(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private IActionResult Error(int status, string code, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new { errors = new[] { new { code, message } } });
    }
}
