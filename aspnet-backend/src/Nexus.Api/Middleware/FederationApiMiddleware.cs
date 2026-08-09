// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Middleware;

/// <summary>
/// Middleware that authenticates external federation API requests.
/// Supports two authentication methods:
///   1. API Key via X-Federation-Key header
///   2. Federation JWT via Authorization: Bearer header (with token_type=federation)
/// Only applies to /api/v1/federation/* routes.
/// </summary>
public class FederationApiMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<FederationApiMiddleware> _logger;
    private const string FederationApiPrefix = "/api/v1/federation";
    private const string ApiKeyHeader = "X-Federation-Key";
    private const string LegacyApiKeyHeader = "X-API-Key";

    public FederationApiMiddleware(RequestDelegate next, ILogger<FederationApiMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Only apply to federation external API routes
        if (!context.Request.Path.StartsWithSegments(FederationApiPrefix))
        {
            await _next(context);
            return;
        }

        // Allow the info and health endpoints without auth.
        if ((context.Request.Path.Equals($"{FederationApiPrefix}", StringComparison.OrdinalIgnoreCase) ||
             context.Request.Path.Equals($"{FederationApiPrefix}/health", StringComparison.OrdinalIgnoreCase)) &&
            context.Request.Method == "GET")
        {
            await _next(context);
            return;
        }

        var sw = Stopwatch.StartNew();
        var apiKeyService = context.RequestServices.GetRequiredService<FederationApiKeyService>();
        var jwtService = context.RequestServices.GetRequiredService<FederationJwtService>();

        // Try API Key authentication first. V1.5 accepts X-API-Key and raw Bearer
        // API keys; keep X-Federation-Key as the V2-native header.
        var apiKeyText = GetApiKey(context);
        if (!string.IsNullOrWhiteSpace(apiKeyText))
        {
            if (HasHmacHeaders(context) && !await VerifyHmacSignatureAsync(context, apiKeyText))
            {
                sw.Stop();
                await LogAndReject(context, apiKeyService, sw.Elapsed, "Invalid request signature");
                return;
            }

            var apiKey = await apiKeyService.ValidateApiKeyAsync(apiKeyText);
            if (apiKey == null)
            {
                sw.Stop();
                await LogAndReject(context, apiKeyService, sw.Elapsed, "Invalid or expired API key");
                return;
            }

            if (HasHmacHeaders(context))
            {
                var nonceClaim = await ClaimHmacNonceAsync(context, apiKey.Id);
                if (nonceClaim == NonceClaimResult.Duplicate)
                {
                    sw.Stop();
                    await LogAndReject(context, apiKeyService, sw.Elapsed, "Federation request nonce has already been used");
                    return;
                }
                if (nonceClaim == NonceClaimResult.StoreUnavailable)
                {
                    sw.Stop();
                    context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsJsonAsync(new
                    {
                        error = "Federation replay-protection store is unavailable"
                    });
                    return;
                }
            }

            // Store the authenticated tenant info in HttpContext
            context.Items["FederationAuth"] = HasHmacHeaders(context) ? "hmac" : "apikey";
            context.Items["FederationTenantId"] = apiKey.TenantId;
            context.Items["FederationApiKeyId"] = apiKey.Id;
            context.Items["FederationScopes"] = apiKey.Scopes;

            await _next(context);

            // Log the API call
            sw.Stop();
            await apiKeyService.LogApiCallAsync(
                apiKey.TenantId, apiKey.Id,
                context.Request.Method, context.Request.Path,
                context.Response.StatusCode,
                context.Connection.RemoteIpAddress?.ToString(),
                (int)sw.ElapsedMilliseconds);
            return;
        }

        // Try Federation JWT authentication
        var authHeader = context.Request.Headers.Authorization.ToString();
        if (authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var token = authHeader["Bearer ".Length..].Trim();
            var claims = jwtService.ValidateToken(token);

            if (claims != null)
            {
                context.Items["FederationAuth"] = "jwt";
                context.Items["FederationTenantId"] = claims.SourceTenantId;
                context.Items["FederationTargetTenantId"] = claims.TargetTenantId;
                context.Items["FederationScopes"] = string.Join(",", claims.Scopes);

                await _next(context);

                sw.Stop();
                await apiKeyService.LogApiCallAsync(
                    claims.SourceTenantId, null,
                    context.Request.Method, context.Request.Path,
                    context.Response.StatusCode,
                    context.Connection.RemoteIpAddress?.ToString(),
                    (int)sw.ElapsedMilliseconds);
                return;
            }
        }

        // No valid authentication
        sw.Stop();
        await LogAndReject(context, apiKeyService, sw.Elapsed, "Federation API authentication required");
    }

    private static string? GetApiKey(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue(ApiKeyHeader, out var apiKeyValue))
            return apiKeyValue.ToString();

        if (context.Request.Headers.TryGetValue(LegacyApiKeyHeader, out var legacyApiKeyValue))
            return legacyApiKeyValue.ToString();

        var authHeader = context.Request.Headers.Authorization.ToString();
        if (!authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return null;

        var bearer = authHeader["Bearer ".Length..].Trim();
        return bearer.Count(c => c == '.') == 2 ? null : bearer;
    }

    private static bool HasHmacHeaders(HttpContext context) =>
        context.Request.Headers.ContainsKey("X-Federation-Signature") &&
        context.Request.Headers.ContainsKey("X-Federation-Timestamp");

    private static async Task<bool> VerifyHmacSignatureAsync(HttpContext context, string sharedSecret)
    {
        var timestamp = context.Request.Headers["X-Federation-Timestamp"].ToString();
        var signature = context.Request.Headers["X-Federation-Signature"].ToString();
        var nonce = context.Request.Headers["X-Federation-Nonce"].ToString();

        if (string.IsNullOrWhiteSpace(timestamp) ||
            string.IsNullOrWhiteSpace(signature) ||
            string.IsNullOrWhiteSpace(nonce))
            return false;

        if (!DateTimeOffset.TryParse(timestamp, out var parsedTimestamp) &&
            (!long.TryParse(timestamp, out var unixTimestamp) ||
             (parsedTimestamp = DateTimeOffset.FromUnixTimeSeconds(unixTimestamp)) == default))
            return false;

        if (Math.Abs((DateTimeOffset.UtcNow - parsedTimestamp.ToUniversalTime()).TotalSeconds) > 300)
            return false;

        context.Request.EnableBuffering();
        string body;
        using (var reader = new StreamReader(context.Request.Body, Encoding.UTF8, leaveOpen: true))
        {
            body = await reader.ReadToEndAsync();
            context.Request.Body.Position = 0;
        }

        var path = context.Request.Path + context.Request.QueryString;
        var stringToSign = string.Join("\n", context.Request.Method.ToUpperInvariant(), path, timestamp, nonce, body);
        var expectedBytes = HMACSHA256.HashData(Encoding.UTF8.GetBytes(sharedSecret), Encoding.UTF8.GetBytes(stringToSign));
        var expected = Convert.ToHexString(expectedBytes).ToLowerInvariant();

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(signature.ToLowerInvariant()));
    }

    private static async Task<NonceClaimResult> ClaimHmacNonceAsync(HttpContext context, int apiKeyId)
    {
        var nonce = context.Request.Headers["X-Federation-Nonce"].ToString();
        var timestamp = context.Request.Headers["X-Federation-Timestamp"].ToString();
        if (!TryParseTimestamp(timestamp, out var parsedTimestamp) || string.IsNullOrWhiteSpace(nonce))
        {
            return NonceClaimResult.Duplicate;
        }

        var db = context.RequestServices.GetRequiredService<NexusDbContext>();
        var platformId = $"federation-api-key:{apiKeyId}";
        var createdAt = DateTime.UtcNow;
        var expiresAt = parsedTimestamp.ToUniversalTime().AddSeconds(300).UtcDateTime;
        try
        {
            var claimed = await db.Database.ExecuteSqlInterpolatedAsync(
                $@"INSERT INTO federation_webhook_nonces
                   (""PlatformId"", ""Nonce"", ""ExpiresAt"", ""CreatedAt"")
                   VALUES ({platformId}, {nonce}, {expiresAt}, {createdAt})
                   ON CONFLICT (""PlatformId"", ""Nonce"") DO NOTHING",
                context.RequestAborted);
            return claimed == 1 ? NonceClaimResult.Claimed : NonceClaimResult.Duplicate;
        }
        catch (Exception exception) when (exception is DbUpdateException
            or InvalidOperationException
            or System.Data.Common.DbException)
        {
            return NonceClaimResult.StoreUnavailable;
        }
    }

    private static bool TryParseTimestamp(string timestamp, out DateTimeOffset parsedTimestamp)
    {
        if (DateTimeOffset.TryParse(timestamp, out parsedTimestamp))
        {
            return true;
        }

        if (long.TryParse(timestamp, out var unixTimestamp))
        {
            parsedTimestamp = DateTimeOffset.FromUnixTimeSeconds(unixTimestamp);
            return true;
        }

        parsedTimestamp = default;
        return false;
    }

    private enum NonceClaimResult
    {
        Claimed,
        Duplicate,
        StoreUnavailable
    }

    private async Task LogAndReject(HttpContext context, FederationApiKeyService apiKeyService,
        TimeSpan elapsed, string message)
    {
        context.Response.StatusCode = 401;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new { error = message });

        try
        {
            await apiKeyService.LogApiCallAsync(
                null, null,
                context.Request.Method, context.Request.Path,
                401,
                context.Connection.RemoteIpAddress?.ToString(),
                (int)elapsed.TotalMilliseconds);
        }
        catch (Exception ex) when (ex is InvalidOperationException or Microsoft.EntityFrameworkCore.DbUpdateException or OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to log rejected federation API call");
        }
    }
}
