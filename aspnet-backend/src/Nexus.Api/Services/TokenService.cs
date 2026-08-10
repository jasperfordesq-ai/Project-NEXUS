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

    public TokenService(IConfiguration config)
    {
        _config = config;
    }

    public string GenerateJwt(User user, params string[] authenticationMethods)
    {
        var secret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var expiryMinutes = _config.GetValue<int>("Jwt:AccessTokenExpiryMinutes", 120);
        var expires = DateTime.UtcNow.AddMinutes(expiryMinutes);

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

    public int AccessTokenExpirySeconds =>
        _config.GetValue<int>("Jwt:AccessTokenExpiryMinutes", 120) * 60;

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
