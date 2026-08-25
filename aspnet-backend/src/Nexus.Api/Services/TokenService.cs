// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Authorization;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Shared JWT and refresh token generation.
/// Used by AuthController and PasskeysController to avoid duplication.
/// Claims structure must match PHP for interoperability.
/// </summary>
public class TokenService
{
    private readonly IConfiguration _config;
    private readonly IHostEnvironment? _environment;

    public TokenService(IConfiguration config, IHostEnvironment? environment = null)
    {
        _config = config;
        _environment = environment;
    }

    public string GenerateJwt(User user, params string[] authenticationMethods)
    {
        var secret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var expires = DateTime.UtcNow.AddSeconds(AccessTokenExpirySeconds);

        // Claims must match PHP structure for interoperability
        var claims = new List<Claim>
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim("tenant_id", user.TenantId.ToString()),
            new Claim("role", user.Role),
            new Claim("email", user.Email),
            BooleanClaim(NexusPrivilegeClaimTypes.IsAdmin, user.IsAdmin),
            BooleanClaim(NexusPrivilegeClaimTypes.IsSuperAdmin, user.IsSuperAdmin),
            BooleanClaim(NexusPrivilegeClaimTypes.IsTenantSuperAdmin, user.IsTenantSuperAdmin),
            BooleanClaim(NexusPrivilegeClaimTypes.IsGod, user.IsGod),
            new Claim(JwtRegisteredClaimNames.Jti, Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()),
            new Claim(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
        };
        claims.AddRange(authenticationMethods
            .Where(method => !string.IsNullOrWhiteSpace(method))
            .Distinct(StringComparer.Ordinal)
            .Select(method => new Claim("amr", method)));

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: expires,
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateSecurityConfirmationToken(int userId, int tenantId, string method)
    {
        var secret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");
        var now = DateTime.UtcNow;
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim("tenant_id", tenantId.ToString()),
                new Claim("type", "security_confirmation"),
                new Claim("method", method),
                new Claim(JwtRegisteredClaimNames.Jti, Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()),
                new Claim(JwtRegisteredClaimNames.Iat, new DateTimeOffset(now).ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
            ],
            notBefore: now,
            expires: now.AddMinutes(5),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
                SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public bool ValidateSecurityConfirmationToken(string? token, int userId, int tenantId)
    {
        if (string.IsNullOrWhiteSpace(token))
            return false;

        try
        {
            var principal = new JwtSecurityTokenHandler().ValidateToken(token, ValidationParameters(), out _);
            var subject = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return subject == userId.ToString()
                && principal.FindFirst("tenant_id")?.Value == tenantId.ToString()
                && principal.FindFirst("type")?.Value == "security_confirmation"
                && !string.IsNullOrWhiteSpace(principal.FindFirst("method")?.Value);
        }
        catch (SecurityTokenException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    public int AccessTokenExpirySeconds
    {
        get
        {
            // Certification needs to observe a genuinely expired bearer in one
            // bounded run. The seconds override is deliberately inert outside
            // Development/Testing, even if somebody sets it in production.
            var testSeconds = _config.GetValue<int?>("Jwt:TestAccessTokenExpirySeconds");
            if ((_environment?.IsDevelopment() == true || _environment?.IsEnvironment("Testing") == true)
                && testSeconds is > 0 and <= 60)
            {
                return testSeconds.Value;
            }

            return _config.GetValue<int>("Jwt:AccessTokenExpiryMinutes", 120) * 60;
        }
    }

    /// <summary>Laravel IMPERSONATION_TOKEN_EXPIRY: the proof lives 5 minutes.</summary>
    public const int ImpersonationProofExpirySeconds = 300;

    /// <summary>Laravel impersonation session ACCESS_TOKEN_EXPIRY: 15 minutes.</summary>
    public const int ImpersonationSessionExpirySeconds = 900;

    /// <summary>
    /// The one-time impersonation PROOF — Laravel generateImpersonationToken.
    /// type=impersonation makes it useless as a bearer (the auth pipeline
    /// rejects that type); it authenticates nothing until exchanged. The jti
    /// is what the exchange consumes single-use.
    /// </summary>
    public (string Token, string Jti) GenerateImpersonationProof(
        int userId, int tenantId, int impersonatedBy)
    {
        var secret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");
        var now = DateTime.UtcNow;
        var jti = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim("tenant_id", tenantId.ToString()),
                new Claim("type", "impersonation"),
                new Claim("impersonated_by", impersonatedBy.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, jti),
                new Claim(JwtRegisteredClaimNames.Iat,
                    new DateTimeOffset(now).ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
            ],
            notBefore: now,
            expires: now.AddSeconds(ImpersonationProofExpirySeconds),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
                SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), jti);
    }

    /// <summary>
    /// The impersonation SESSION token — Laravel generateImpersonationSessionToken.
    /// A real 15-minute access token for the target member (same claim shape as
    /// a normal login token so rehydration works), plus impersonated_by and a
    /// fresh impersonation_jti the end endpoint can revoke. DELIBERATELY no
    /// refresh token — an impersonated session must not mint a durable family.
    /// </summary>
    public (string Token, string SessionJti) GenerateImpersonationSessionToken(
        User target, int impersonatedBy)
    {
        var secret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");
        var now = DateTime.UtcNow;
        var sessionJti = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, target.Id.ToString()),
                new Claim("tenant_id", target.TenantId.ToString()),
                new Claim("role", target.Role),
                new Claim("email", target.Email),
                BooleanClaim(NexusPrivilegeClaimTypes.IsAdmin, target.IsAdmin),
                BooleanClaim(NexusPrivilegeClaimTypes.IsSuperAdmin, target.IsSuperAdmin),
                BooleanClaim(NexusPrivilegeClaimTypes.IsTenantSuperAdmin, target.IsTenantSuperAdmin),
                BooleanClaim(NexusPrivilegeClaimTypes.IsGod, target.IsGod),
                new Claim("impersonated_by", impersonatedBy.ToString()),
                new Claim("impersonation_jti", sessionJti),
                new Claim(JwtRegisteredClaimNames.Iat,
                    new DateTimeOffset(now).ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
            ],
            notBefore: now,
            expires: now.AddSeconds(ImpersonationSessionExpirySeconds),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
                SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), sessionJti);
    }

    /// <summary>
    /// Validates a proof's signature/lifetime and returns its claims for the
    /// exchange to inspect. Consumption (single-use) is the caller's job via
    /// the revoked-tokens insert. Returns null on any validation failure.
    /// </summary>
    public ClaimsPrincipal? ReadImpersonationProof(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            // MapInboundClaims=false keeps sub/jti/tenant_id verbatim, matching
            // the JWT bearer pipeline; the default true would remap "sub" to a
            // URI and the exchange's FindFirst("sub") would miss.
            var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
            var principal = handler.ValidateToken(token, ValidationParameters(), out _);
            return principal.FindFirst("type")?.Value == "impersonation"
                && !string.IsNullOrWhiteSpace(principal.FindFirst(JwtRegisteredClaimNames.Jti)?.Value)
                && !string.IsNullOrWhiteSpace(principal.FindFirst("impersonated_by")?.Value)
                ? principal : null;
        }
        catch (SecurityTokenException) { return null; }
        catch (ArgumentException) { return null; }
    }

    /// <summary>Reads the impersonation_jti from a session token without lifetime checks.</summary>
    public static string? ReadImpersonationSessionJti(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
            return jwt.Claims.FirstOrDefault(c => c.Type == "impersonation_jti")?.Value;
        }
        catch (ArgumentException) { return null; }
    }

    public static (string token, string hash) GenerateRefreshToken()
    {
        var randomBytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomBytes);
        var token = Convert.ToBase64String(randomBytes);
        var hash = HashToken(token);
        return (token, hash);
    }

    public static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToBase64String(bytes);
    }

    private static Claim BooleanClaim(string claimType, bool value)
    {
        return new Claim(claimType, value ? "true" : "false", ClaimValueTypes.Boolean);
    }

    private TokenValidationParameters ValidationParameters() => new()
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(
            _config["Jwt:Secret"] ?? throw new InvalidOperationException("JWT secret not configured"))),
        ValidateIssuer = !string.IsNullOrWhiteSpace(_config["Jwt:Issuer"]),
        ValidIssuer = _config["Jwt:Issuer"],
        ValidateAudience = !string.IsNullOrWhiteSpace(_config["Jwt:Audience"]),
        ValidAudience = _config["Jwt:Audience"],
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = JwtRegisteredClaimNames.Sub
    };
}
