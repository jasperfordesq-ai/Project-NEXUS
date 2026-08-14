// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Middleware;

/// <summary>
/// Laravel-compatible legal-acceptance enforcement gate, mirroring
/// App\Http\Middleware\EnsureLegalAcceptance (Laravel, shipped 2026-08-11).
/// Blocks the fourteen gated member write actions with the exact Laravel
/// contract — 403, errors[0].code == "LEGAL_ACCEPTANCE_REQUIRED",
/// success:false, API-Version header only — until the member has accepted
/// every active, acceptance-requiring legal document of their tenant.
///
/// Laravel behaviours reproduced deliberately:
/// - modes off | report | write | all; default AND invalid-fallback are both
///   "write" (never "off"), with a once-per-process warning on invalid values;
/// - fails OPEN on any infrastructure error — a broken check must not lock
///   members out of the platform;
/// - "report" never blocks: it logs would-block at warning and stamps
///   X-Legal-Acceptance-Pending: 1 on the passed-through response;
/// - admins and machine (partner) callers always pass;
/// - the blocked response carries NO X-Tenant-ID header, matching Laravel's
///   bare response()->json() (unlike this repo's other gate middlewares).
///
/// Known divergence, tracked in CURRENT_ASPNET_CONTRACT_STATUS.md: the ASP.NET
/// legal schema is document-level (no version table, no acceptance_required_for
/// column), so "accepted an outdated version" is not yet representable and the
/// enforced-modes filter has no column to read. Pending here means an active,
/// RequiresAcceptance document with no acceptance row for the member.
/// </summary>
public sealed class LegalAcceptanceGateMiddleware
{
    public const string ErrorCode = "LEGAL_ACCEPTANCE_REQUIRED";
    public const string PendingHeader = "X-Legal-Acceptance-Pending";
    private const string BlockedMessage =
        "Please review and accept the updated terms before continuing";

    private static readonly string[] ValidModes = ["off", "report", "write", "all"];
    private static bool _warnedAboutMode;

    // Laravel attaches the gate to exactly fourteen POST routes
    // (routes/api.php, middleware 'legal-acceptance'), all under /api/v2/.
    // Legacy non-v2 spellings are deliberately NOT gated, matching both
    // Laravel and this repo's onboarding gate. "{int}" matches one integer
    // path segment; templates are relative to "api/v2/".
    private static readonly string[][] GatedTemplates =
    [
        ["exchanges"],
        ["events"],
        ["listings"],
        ["messages"],
        ["users", "me", "sub-accounts", "{int}", "listings"],
        ["users", "me", "sub-accounts", "{int}", "transfer"],
        ["users", "me", "sub-accounts", "{int}", "listings", "{int}", "image"],
        ["users", "me", "support-actions"],
        ["wallet", "transfer"],
        ["feed", "posts"],
        ["reviews"],
        ["volunteering", "opportunities", "{int}", "apply"],
        ["comments"],
        ["resources"],
    ];

    private readonly RequestDelegate _next;
    private readonly ILogger<LegalAcceptanceGateMiddleware> _logger;

    public LegalAcceptanceGateMiddleware(
        RequestDelegate next,
        ILogger<LegalAcceptanceGateMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(
        HttpContext context, NexusDbContext db, IConfiguration configuration)
    {
        if (!HttpMethods.IsPost(context.Request.Method)
            || !IsGatedPath(context.Request.Path.Value))
        {
            await _next(context);
            return;
        }

        var mode = ResolveMode(configuration, _logger);
        if (mode == "off")
        {
            await _next(context);
            return;
        }

        // Unauthenticated requests pass: [Authorize] owns the 401, exactly as
        // auth:sanctum runs before the gate in Laravel.
        var userId = context.User.GetUserId();
        var tenantId = context.User.GetTenantId();
        if (!userId.HasValue || !tenantId.HasValue)
        {
            await _next(context);
            return;
        }

        // Machine callers (partner tokens) are exempt, as in Laravel.
        if (string.Equals(context.User.GetRole(), "partner", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        bool blocked;
        try
        {
            // TenantResolutionMiddleware runs later in this pipeline, so the
            // global tenant query filters are permissive here — every query
            // carries its own explicit tenant predicate.
            var user = await db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    row => row.Id == userId.Value && row.TenantId == tenantId.Value,
                    context.RequestAborted);
            if (user is null)
            {
                await _next(context);
                return;
            }

            if (user.IsAdmin
                || user.IsSuperAdmin
                || user.IsTenantSuperAdmin
                || user.IsGod
                || user.Role is "admin" or "tenant_admin" or "super_admin")
            {
                await _next(context);
                return;
            }

            blocked = await HasPendingDocumentsAsync(
                db, userId.Value, tenantId.Value, context.RequestAborted);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Fail OPEN, as Laravel does: an infrastructure fault in the legal
            // check must never lock members out of the platform.
            _logger.LogWarning(ex, "[LegalGate] check failed, allowing request");
            await _next(context);
            return;
        }

        if (!blocked)
        {
            await _next(context);
            return;
        }

        if (mode == "report")
        {
            _logger.LogWarning(
                "legal.gate.would_block user_id={UserId} tenant_id={TenantId} path={Path} method={Method}",
                userId.Value, tenantId.Value, context.Request.Path.Value, context.Request.Method);
            context.Response.Headers[PendingHeader] = "1";
            await _next(context);
            return;
        }

        // Laravel builds this with the bare response()->json(): 403 (never 401,
        // so web-uk does not clear auth cookies), API-Version only — no
        // X-Tenant-ID header on this specific response.
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.Headers["API-Version"] = "2.0";
        await context.Response.WriteAsJsonAsync(new
        {
            errors = new[] { new { code = ErrorCode, message = BlockedMessage } },
            success = false,
        }, context.RequestAborted);
    }

    /// <summary>
    /// True when the member still has an active, acceptance-requiring legal
    /// document in their tenant with no acceptance row. Shared with the
    /// acceptance-status endpoint so the gate and the flags it publishes can
    /// never disagree.
    /// </summary>
    public static Task<bool> HasPendingDocumentsAsync(
        NexusDbContext db, int userId, int tenantId, CancellationToken cancellationToken)
    {
        return db.LegalDocuments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(d => d.TenantId == tenantId
                && d.IsActive
                && d.RequiresAcceptance
                && !db.LegalDocumentAcceptances
                    .IgnoreQueryFilters()
                    .Any(a => a.TenantId == tenantId
                        && a.UserId == userId
                        && a.LegalDocumentId == d.Id),
                cancellationToken);
    }

    /// <summary>
    /// Mirrors EnsureLegalAcceptance::mode(): configured value when valid,
    /// otherwise "write" — the default AND the invalid-value fallback are both
    /// enforcing, and an invalid value warns once per process.
    /// </summary>
    public static string ResolveMode(IConfiguration configuration, ILogger? logger = null)
    {
        var configured = (configuration["Legal:EnforcementMode"] ?? "write")
            .Trim().ToLowerInvariant();
        if (Array.IndexOf(ValidModes, configured) >= 0)
        {
            return configured;
        }

        if (!_warnedAboutMode)
        {
            _warnedAboutMode = true;
            logger?.LogWarning(
                "legal.gate.invalid_mode configured={Configured} using=write", configured);
        }

        return "write";
    }

    /// <summary>
    /// Mirrors EnsureLegalAcceptance::modeBlocks() — published to clients as
    /// the acceptance-status endpoint's enforcement_blocking flag.
    /// </summary>
    public static bool ModeBlocks(string mode) => mode is "write" or "all";

    private static bool IsGatedPath(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return false;
        }

        var segments = path.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 3
            || !string.Equals(segments[0], "api", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(segments[1], "v2", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        const int start = 2;
        foreach (var template in GatedTemplates)
        {
            if (Matches(segments, start, template))
            {
                return true;
            }
        }

        return false;
    }

    private static bool Matches(string[] segments, int start, string[] template)
    {
        if (segments.Length - start != template.Length)
        {
            return false;
        }

        for (var i = 0; i < template.Length; i++)
        {
            var actual = segments[start + i];
            if (template[i] == "{int}")
            {
                if (!long.TryParse(actual, out _))
                {
                    return false;
                }
                continue;
            }

            if (!string.Equals(actual, template[i], StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        return true;
    }
}
