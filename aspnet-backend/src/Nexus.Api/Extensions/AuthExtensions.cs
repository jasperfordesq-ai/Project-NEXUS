// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Authorization;
using Nexus.Api.Entities;

namespace Nexus.Api.Extensions;

/// <summary>
/// IServiceCollection extension methods for JWT authentication and authorization.
/// Extracted from Program.cs to keep startup file concise.
/// </summary>
public static class AuthExtensions
{
    /// <summary>
    /// Configures JWT Bearer authentication, SignalR token extraction,
    /// and database-backed authorization policies.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">The application configuration.</param>
    /// <param name="isTestEnvironment">
    /// When true, a deterministic secret is generated if Jwt:Secret is absent.
    /// </param>
    public static IServiceCollection AddNexusAuthentication(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isTestEnvironment)
    {
        var jwtSecret = configuration["Jwt:Secret"];

        if (!isTestEnvironment && (string.IsNullOrEmpty(jwtSecret) || jwtSecret.Contains("REPLACE")))
        {
            throw new InvalidOperationException(
                "Jwt:Secret must be configured via environment variable. " +
                "Set JWT_SECRET or Jwt__Secret environment variable.");
        }

        if (isTestEnvironment && string.IsNullOrEmpty(jwtSecret))
        {
            jwtSecret = Convert.ToBase64String(
                System.Security.Cryptography.SHA256.HashData(
                    Encoding.UTF8.GetBytes("nexus-test-environment-jwt")));
        }

        var jwtIssuer = configuration["Jwt:Issuer"];
        var jwtAudience = configuration["Jwt:Audience"];
        var validateIssuer = !string.IsNullOrEmpty(jwtIssuer);
        var validateAudience = !string.IsNullOrEmpty(jwtAudience);

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    NameClaimType = "sub",
                    RoleClaimType = "role",
                    ValidateIssuer = validateIssuer,
                    ValidateAudience = validateAudience,
                    ValidIssuer = validateIssuer ? jwtIssuer : null,
                    ValidAudience = validateAudience ? jwtAudience : null,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret!)),
                    ClockSkew = TimeSpan.FromMinutes(1)
                };

                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var accessToken = context.Request.Query["access_token"];
                        var path = context.HttpContext.Request.Path;
                        if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                        {
                            context.Token = accessToken;
                        }

                        return Task.CompletedTask;
                    },
                    // Rehydrate the identity from the current database row.
                    // Role and tenant changes invalidate an existing token;
                    // privilege flag grants/revocations take effect immediately.
                    OnTokenValidated = async context =>
                    {
                        var principal = context.Principal;
                        if (principal is null)
                        {
                            context.Fail("missing_principal");
                            return;
                        }

                        var sub = principal.FindFirst("sub")?.Value
                            ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                        var tokenTenant = principal.FindFirst("tenant_id")?.Value;
                        var tokenRole = principal.FindFirst("role")?.Value
                            ?? principal.FindFirst(ClaimTypes.Role)?.Value;

                        if (!int.TryParse(tokenTenant, out var tokenTenantId)
                            || string.IsNullOrWhiteSpace(tokenRole))
                        {
                            context.Fail("invalid_identity_claims");
                            return;
                        }

                        // Partner client-credential JWTs share the signing key
                        // but are not member identities. Their persisted token,
                        // scope, IP, sandbox and rate controls are enforced by
                        // the partner API guard; never try to rehydrate sub=0 as
                        // a user. A global route boundary confines this identity
                        // to /api/partner/v1/**.
                        if (string.Equals(tokenRole, "partner", StringComparison.Ordinal))
                        {
                            var partnerId = principal.FindFirst("partner_id")?.Value;
                            if (!string.Equals(sub, "0", StringComparison.Ordinal)
                                || tokenTenantId <= 0
                                || !Guid.TryParse(partnerId, out _))
                            {
                                context.Fail("invalid_partner_identity_claims");
                            }
                            return;
                        }

                        if (!int.TryParse(sub, out var userId))
                        {
                            context.Fail("invalid_identity_claims");
                            return;
                        }

                        var accessReader = context.HttpContext.RequestServices
                            .GetRequiredService<INexusUserAccessReader>();
                        var current = await accessReader.FindAsync(
                            userId,
                            context.HttpContext.RequestAborted);

                        if (current is null)
                        {
                            context.Fail("user_not_found_or_inactive");
                            return;
                        }

                        // Pending-verification identities are intentionally
                        // inactive until the provider flow succeeds. Their
                        // access token is valid only for the two verification
                        // endpoints; every other authenticated route retains
                        // the normal active-user requirement.
                        var pendingVerificationEndpoint =
                            current.RegistrationStatus == RegistrationStatus.PendingVerification
                            && IsRegistrationVerificationEndpoint(context.HttpContext.Request.Path);
                        if (!current.IsActive && !pendingVerificationEndpoint)
                        {
                            context.Fail("user_not_found_or_inactive");
                            return;
                        }

                        if (current.TenantId != tokenTenantId)
                        {
                            context.Fail("tenant_changed_since_token_issue");
                            return;
                        }

                        if (!string.Equals(current.Role, tokenRole, StringComparison.Ordinal))
                        {
                            context.Fail("role_changed_since_token_issue");
                            return;
                        }

                        NexusUserAccessEvaluator.ApplyDatabaseSnapshot(principal, current);
                    }
                };
            });

        services.AddScoped<INexusUserAccessReader, NexusUserAccessReader>();
        services.AddScoped<IAuthorizationHandler, NexusUserAccessAuthorizationHandler>();

        services.AddAuthorization(options =>
        {
            AddAccessPolicy(options, NexusAuthorizationPolicies.AdminOnly, NexusAccessLevel.Admin);
            AddAccessPolicy(options, NexusAuthorizationPolicies.BrokerOrAdmin, NexusAccessLevel.BrokerOrAdmin);
            AddAccessPolicy(options, NexusAuthorizationPolicies.TenantSuperAdminOrHigher, NexusAccessLevel.TenantSuperAdminOrHigher);
            AddAccessPolicy(options, NexusAuthorizationPolicies.PlatformSuperAdminOnly, NexusAccessLevel.PlatformSuperAdmin);
            AddAccessPolicy(options, NexusAuthorizationPolicies.GodOnly, NexusAccessLevel.God);
            AddAccessPolicy(options, NexusAuthorizationPolicies.RouteAwareAdmin, NexusAccessLevel.RouteAwareAdmin);
        });
        services.Replace(ServiceDescriptor.Singleton<
            IAuthorizationMiddlewareResultHandler,
            NexusAuthorizationResultHandler>());

        return services;
    }

    private static bool IsRegistrationVerificationEndpoint(PathString path)
    {
        var normalized = (path.Value ?? string.Empty).TrimEnd('/').ToLowerInvariant();
        if (normalized is "/api/registration/verify/start" or "/api/registration/verify/status")
        {
            return true;
        }

        return normalized.StartsWith("/api/v", StringComparison.Ordinal)
            && (normalized.EndsWith("/registration/verify/start", StringComparison.Ordinal)
                || normalized.EndsWith("/registration/verify/status", StringComparison.Ordinal));
    }

    private static void AddAccessPolicy(
        AuthorizationOptions options,
        string policyName,
        NexusAccessLevel accessLevel)
    {
        options.AddPolicy(policyName, policy =>
        {
            policy.RequireAuthenticatedUser();
            policy.AddRequirements(new NexusUserAccessRequirement(accessLevel));
        });
    }
}
