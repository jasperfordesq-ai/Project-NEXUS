// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nexus.Api.Data;

namespace Nexus.Api.Middleware;

/// <summary>
/// Resolves tenant context from the incoming request.
///
/// SECURITY RULES:
/// - If user is authenticated (has JWT), tenant_id MUST come from JWT claim.
/// - X-Tenant-ID header is allowed for unauthenticated requests in all environments.
/// - Unauthenticated requests without X-Tenant-ID are BLOCKED (prevents cross-tenant data leak).
/// - This prevents authenticated users from spoofing tenant context via headers.
///
/// TENANT VALIDATION:
/// - After resolving the tenant_id, validates that the tenant exists and is active.
/// - Uses a short-lived in-memory cache (60s) to avoid hitting the database on every request.
/// - Invalid/inactive tenants are rejected with 403 Forbidden.
/// </summary>
public class TenantResolutionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<TenantResolutionMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    // Cache key prefix for tenant validation
    private const string TenantCachePrefix = "tenant_valid:";
    private static readonly TimeSpan TenantCacheDuration = TimeSpan.FromSeconds(60);

    // Paths that don't require tenant resolution (they handle it themselves)
    private static readonly HashSet<string> _excludedPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/health",
        "/health/ready",
        "/health/live",
        "/api/health",
        "/api/v2/health",
        "/swagger",                  // Swagger UI and JSON spec
        "/api/auth/login",           // Login determines tenant from credentials
        "/api/auth/admin-session",   // Legacy admin bridge resolves tenant from submitted JWT token
        "/api/auth/register",        // Register determines tenant from request body
        "/api/v2/auth/register",     // Laravel-compatible register
        "/api/auth/refresh",         // Refresh determines tenant from token lookup
        "/api/totp/verify",          // Public 2FA exchange resolves user and tenant from opaque challenge
        "/api/webauthn/auth-challenge", // Public passkey authentication bootstrap
        "/api/webauthn/auth-verify", // Public passkey exchange resolves tenant from cached challenge
        "/api/auth/forgot-password",           // Forgot password determines tenant from request body
        "/api/auth/reset-password",            // Reset password determines tenant from token lookup
        "/api/auth/registration-info",         // Public registration mode discovery
        "/api/v2/auth/registration-info",      // Laravel-compatible registration mode discovery
        "/api/auth/validate-invite",           // Public invite-code validation during registration
        "/api/v2/auth/validate-invite",        // Laravel-compatible invite-code validation
        "/api/auth/sso",                       // Public SSO endpoints resolve tenant from query/header
        "/api/v2/auth/sso",                    // Laravel-compatible public SSO endpoints
        "/api/auth/oauth/exchange",            // Public one-time OAuth callback-code exchange
        "/api/v2/auth/oauth/exchange",         // Laravel-compatible OAuth callback-code exchange
        "/api/auth/oauth/enabled-providers",   // Public OAuth provider discovery
        "/api/v2/auth/oauth/enabled-providers", // Laravel-compatible OAuth provider discovery
        "/api/auth/oauth/google/redirect",     // Public OAuth redirect bootstrap resolves tenant from query/header
        "/api/auth/oauth/apple/redirect",
        "/api/auth/oauth/facebook/redirect",
        "/api/v2/auth/oauth/google/redirect",  // Laravel-compatible OAuth redirect bootstrap
        "/api/v2/auth/oauth/apple/redirect",
        "/api/v2/auth/oauth/facebook/redirect",
        "/api/geo/os-places/search",           // Public geocoding proxy resolves tenant internally
        "/api/v2/geo/os-places/search",        // Laravel-compatible OS Places proxy
        "/api/public-changelog",               // Public React static content
        "/api/v2/public-changelog",            // Laravel-compatible public changelog
        "/api/public-page-content",            // Public React static page content
        "/api/v2/public-page-content",         // Laravel-compatible public page content
        "/api/public-static-route-content",     // Public React locale-backed route content
        "/api/v2/public-static-route-content",  // Laravel-compatible static route content
        "/api/sw-reset",                        // Browser stale-service-worker recovery document
        "/api/partner-analytics",               // Token-authenticated partner analytics resolves tenant from subscription
        "/api/partner/v1/oauth",                // Partner OAuth resolves tenant from client credentials
        "/api/notifications/unsubscribe",       // Public one-click unsubscribe
        "/api/v2/notifications/unsubscribe",    // Laravel-compatible one-click unsubscribe
        "/api/webhooks/postmark",               // Shared-secret webhook; handles auth itself
        "/api/v2/webhooks/postmark",            // Laravel-compatible Postmark webhook
        "/api/v2/prerender/invalidate",         // Shared-secret/HMAC webhook resolves target tenant from signed payload
        "/api/passkeys/authenticate/begin",    // Passkey auth determines tenant from request body
        "/api/passkeys/authenticate/finish",   // Passkey auth determines tenant from session
        "/api/v1/federation",                  // Federation external API uses its own auth
        "/api/registration/config",            // Public registration config
        "/api/registration/webhook",           // Provider webhook callback
        "/api/tenant/bootstrap",               // Public tenant discovery endpoint; resolves tenant itself
        "/api/v2/tenant/bootstrap",            // Laravel-compatible public tenant discovery alias
        "/api/platform/stats",                 // Public landing page stats
        "/api/v2/platform/stats",              // Laravel-compatible public landing page stats alias
        "/api/pwa/manifest",                   // Public tenant-aware install manifest resolves host/path itself
        "/api/v2/pwa/manifest",                // Laravel-compatible tenant-aware install manifest
        "/api/metrics",                        // Public landing page stats alias
        "/api/sales/orders",                   // Public sales enquiry form; no tenant-scoped data
        "/api/v2/sales/orders",                // Laravel-compatible sales enquiry form
        "/api/menus",                          // Public default menu contract
        "/api/cookie-consent",                 // Public cookie consent compatibility endpoint
        "/api/files",                          // File download handles public avatar vs protected documents
        "/api/media/thumbnail",                // Public Laravel-compatible uploaded-media thumbnail proxy
        "/api/v2/media/thumbnail",             // Laravel-compatible uploaded-media thumbnail proxy
        "/api/announcements",                  // Handles optional tenant context itself
        "/api/realtime/config",                // Static config, no tenant-scoped data
        "/api/tenants",                         // Public tenant list for login page dropdown
        "/api/v2/tenants",                      // Laravel-compatible public tenant list
        "/api/webhooks/volunteering",             // HMAC-authenticated webhook; sets tenant from payload
        "/api/provisioning/requests",             // Public new-tenant provisioning submissions; service assigns platform tenant
        "/api/v2/provisioning-requests"           // Laravel-compatible provisioning submissions/status checks
    };

    public TenantResolutionMiddleware(
        RequestDelegate next,
        ILogger<TenantResolutionMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

    public async Task InvokeAsync(HttpContext context, TenantContext tenantContext, NexusDbContext db, IMemoryCache cache)
    {
        var path = context.Request.Path.Value ?? "";

        // Skip tenant resolution for excluded paths
        if (_excludedPaths.Any(p => path.Equals(p, StringComparison.OrdinalIgnoreCase) ||
                                    path.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase)))
        {
            await _next(context);
            return;
        }

        // Try to resolve tenant with security checks
        var (tenantId, source) = ResolveTenantIdSecure(context);

        if (tenantId.HasValue)
        {
            // Validate tenant exists and is active (cached for 60s)
            var isValid = await ValidateTenantAsync(tenantId.Value, db, cache);
            if (!isValid)
            {
                _logger.LogWarning("Tenant {TenantId} is invalid or inactive for path {Path}",
                    tenantId.Value, path);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new
                {
                    error = "Tenant inactive",
                    message = "Your tenant account is not active"
                });
                return;
            }

            tenantContext.SetTenant(tenantId.Value);
            _logger.LogDebug("Tenant resolved: {TenantId} from {Source} for path {Path}",
                tenantId.Value, source, path);
            await _next(context);
            return;
        }

        // For authenticated users, tenant is required (it should always be in the JWT)
        if (context.User.Identity?.IsAuthenticated == true)
        {
            _logger.LogWarning("Authenticated user has no tenant context for path {Path}", path);
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "Tenant context required",
                message = "Authentication required with valid tenant_id claim"
            });
            return;
        }

        // Unauthenticated requests without tenant context are blocked.
        // Public endpoints must provide X-Tenant-ID header to identify the tenant.
        // Without this, EF Core global query filters become permissive (return all tenants' data).
        _logger.LogWarning("Unauthenticated request to {Path} without tenant context - blocked", path);
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "Tenant context required",
            message = "X-Tenant-ID header is required for this endpoint"
        });
    }

    /// <summary>
    /// Validates that a tenant exists and is active, using a short-lived cache to avoid
    /// hitting the database on every request.
    /// </summary>
    private static async Task<bool> ValidateTenantAsync(int tenantId, NexusDbContext db, IMemoryCache cache)
    {
        var cacheKey = TenantCachePrefix + tenantId;

        if (cache.TryGetValue(cacheKey, out bool isActive))
        {
            return isActive;
        }

        // Query without tenant filter (Tenant entity doesn't have one)
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId);

        isActive = tenant is { IsActive: true };

        cache.Set(cacheKey, isActive, TenantCacheDuration);
        return isActive;
    }

    private (int? TenantId, string Source) ResolveTenantIdSecure(HttpContext context)
    {
        var isAuthenticated = context.User.Identity?.IsAuthenticated == true;

        // 1. If authenticated, MUST use JWT claim - no header override allowed
        if (isAuthenticated)
        {
            var tenantClaim = context.User.FindFirst("tenant_id");
            if (tenantClaim != null && int.TryParse(tenantClaim.Value, out var jwtTenantId))
            {
                // Log warning if header was also provided (potential attack attempt)
                if (context.Request.Headers.ContainsKey("X-Tenant-ID"))
                {
                    _logger.LogWarning(
                        "Authenticated request included X-Tenant-ID header - ignored. " +
                        "JWT tenant_id takes precedence. Path: {Path}",
                        context.Request.Path);
                }
                return (jwtTenantId, "JWT");
            }

            // Authenticated but no tenant_id claim - this is a malformed token
            _logger.LogWarning("Authenticated user has no tenant_id claim");
            return (null, "JWT_MISSING_CLAIM");
        }

        // 2. Not authenticated - allow X-Tenant-ID header in all environments for public endpoints
        if (context.Request.Headers.TryGetValue("X-Tenant-ID", out var headerValue))
        {
            if (int.TryParse(headerValue.FirstOrDefault(), out var headerTenantId))
            {
                _logger.LogDebug("Tenant from X-Tenant-ID header for unauthenticated request");
                return (headerTenantId, "Header");
            }
        }

        // 3. No tenant context available
        return (null, "None");
    }
}
