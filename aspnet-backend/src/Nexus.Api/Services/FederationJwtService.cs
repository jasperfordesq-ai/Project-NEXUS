// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Nexus.Api.Services;

/// <summary>
/// Service for generating and validating federation-specific JWT tokens.
/// These tokens authenticate cross-tenant API requests between federated servers.
/// Uses HMAC-SHA256 for compatibility with the main auth system.
/// </summary>
public class FederationJwtService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<FederationJwtService> _logger;
    private readonly string _signingKey;
    private readonly string _issuer;

    public FederationJwtService(IConfiguration configuration, ILogger<FederationJwtService> logger)
    {
        _configuration = configuration;
        _logger = logger;
        // Federation uses a derived key from the main JWT secret
        var mainSecret = configuration["Jwt:Secret"] ?? throw new InvalidOperationException("Jwt:Secret not configured");
        _signingKey = DeriveKey(mainSecret, "federation-jwt-v1");
        _issuer = configuration["Federation:Issuer"] ?? "nexus-federation";
    }

    /// <summary>
    /// Generate a federation JWT for a tenant-to-tenant request.
    /// Short-lived (5 minutes) for security.
    /// </summary>
    public string GenerateToken(int sourceTenantId, string sourceTenantSlug, int targetTenantId, string[] scopes)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_signingKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new("sub", $"tenant:{sourceTenantId}"),
            new("source_tenant_id", sourceTenantId.ToString()),
            new("source_tenant_slug", sourceTenantSlug),
            new("target_tenant_id", targetTenantId.ToString()),
            new("token_type", "federation"),
            new("jti", Guid.NewGuid().ToString("N"))
        };

        foreach (var scope in scopes)
            claims.Add(new Claim("scope", scope));

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: $"tenant:{targetTenantId}",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Validate a federation JWT and extract claims.
    /// Returns null if invalid.
    /// </summary>
    public FederationTokenClaims? ValidateToken(string token)
    {
        try
        {
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_signingKey));
            var handler = new JwtSecurityTokenHandler();

            var parameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = _issuer,
                ValidateAudience = false, // We validate target_tenant_id manually
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(30),
                IssuerSigningKey = key,
                ValidateIssuerSigningKey = true
            };

            var principal = handler.ValidateToken(token, parameters, out var validatedToken);

            var sourceTenantId = int.Parse(principal.FindFirstValue("source_tenant_id") ?? "0");
            var targetTenantId = int.Parse(principal.FindFirstValue("target_tenant_id") ?? "0");
            var scopes = principal.FindAll("scope").Select(c => c.Value).ToArray();

            if (sourceTenantId == 0 || targetTenantId == 0)
                return null;

            return new FederationTokenClaims
            {
                SourceTenantId = sourceTenantId,
                SourceTenantSlug = principal.FindFirstValue("source_tenant_slug") ?? "",
                TargetTenantId = targetTenantId,
                Scopes = scopes,
                TokenId = principal.FindFirstValue("jti") ?? ""
            };
        }
        catch (Exception ex) when (ex is Microsoft.IdentityModel.Tokens.SecurityTokenException or ArgumentException or System.Security.Cryptography.CryptographicException)
        {
            _logger.LogError(ex, "Federation JWT validation failed");
            return null;
        }
    }

    /// <summary>
    /// Derive a federation-specific key from the main JWT secret using HKDF.
    /// </summary>
    private static string DeriveKey(string mainSecret, string context)
    {
        var inputBytes = Encoding.UTF8.GetBytes(mainSecret);
        var contextBytes = Encoding.UTF8.GetBytes(context);
        var derived = HKDF.DeriveKey(HashAlgorithmName.SHA256, inputBytes, 32, contextBytes);
        return Convert.ToBase64String(derived);
    }
}

/// <summary>
/// Claims extracted from a validated federation JWT.
/// </summary>
public class FederationTokenClaims
{
    public int SourceTenantId { get; set; }
    public string SourceTenantSlug { get; set; } = string.Empty;
    public int TargetTenantId { get; set; }
    public string[] Scopes { get; set; } = Array.Empty<string>();
    public string TokenId { get; set; } = string.Empty;

    public bool HasScope(string scope) => Scopes.Contains(scope, StringComparer.OrdinalIgnoreCase);
}
