// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data.Common;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;

namespace Nexus.Api.Controllers;

/// <summary>
/// Health check endpoints for load balancers and monitoring.
/// These endpoints do NOT require tenant resolution.
/// </summary>
[ApiController]
[Route("[controller]")]
[AllowAnonymous]
public class HealthController : ControllerBase
{
    private const int ProbeTimeoutMs = 500;

    private readonly NexusDbContext _db;
    private readonly ILogger<HealthController> _logger;
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public HealthController(
        NexusDbContext db,
        ILogger<HealthController> logger,
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory)
    {
        _db = db;
        _logger = logger;
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>
    /// Basic liveness check - returns 200 if the app is running.
    /// </summary>
    [HttpGet]
    [HttpGet("live")]
    public IActionResult Live()
    {
        return Ok(new { status = "healthy", timestamp = DateTime.UtcNow });
    }

    /// <summary>
    /// Readiness check - verifies critical (Postgres) and optional
    /// (SendGrid, Stripe) upstream connectivity.
    ///
    /// Postgres failure → 503 Unhealthy.
    /// Optional probe failure → 200 Degraded.
    /// All pass / skipped → 200 Healthy.
    /// </summary>
    [HttpGet("ready")]
    public async Task<IActionResult> Ready()
    {
        var checks = new Dictionary<string, string>();

        // Postgres — required.
        var postgresHealthy = false;
        try
        {
            postgresHealthy = await _db.Database.CanConnectAsync();
            checks["postgres"] = postgresHealthy ? "healthy" : "unhealthy";
        }
        catch (DbException ex)
        {
            _logger.LogError(ex, "Postgres readiness probe failed");
            checks["postgres"] = "unhealthy";
        }

        if (!postgresHealthy)
        {
            return StatusCode(503, new
            {
                status = "Unhealthy",
                checks,
                timestamp = DateTime.UtcNow
            });
        }

        // SendGrid + Stripe — optional, run in parallel with hard 500ms cap each.
        var sendGridTask = ProbeSendGridAsync();
        var stripeTask = ProbeStripeAsync();
        await Task.WhenAll(sendGridTask, stripeTask);

        checks["sendgrid"] = sendGridTask.Result;
        checks["stripe"] = stripeTask.Result;

        var degraded =
            checks["sendgrid"] == "unhealthy" ||
            checks["stripe"] == "unhealthy";

        return Ok(new
        {
            status = degraded ? "Degraded" : "Healthy",
            checks,
            timestamp = DateTime.UtcNow
        });
    }

    private async Task<string> ProbeSendGridAsync()
    {
        var apiKey = _configuration["SendGrid:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return "skipped";
        }

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(ProbeTimeoutMs));
            using var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Head, "https://api.sendgrid.com/v3/scopes");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var response = await client.SendAsync(request, cts.Token);
            // Treat 200 (reachable + authenticated) and 401 (reachable but bad key)
            // as "reachable". Anything else (network failure, 5xx) → unhealthy.
            var code = (int)response.StatusCode;
            return (code == 200 || code == 401) ? "healthy" : "unhealthy";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SendGrid readiness probe failed");
            return "unhealthy";
        }
    }

    private async Task<string> ProbeStripeAsync()
    {
        var apiKey =
            _configuration["Stripe:SecretKey"] ??
            _configuration["Stripe:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return "skipped";
        }

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(ProbeTimeoutMs));
            using var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.stripe.com/v1/balance");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var response = await client.SendAsync(request, cts.Token);
            var code = (int)response.StatusCode;
            return (code == 200 || code == 401) ? "healthy" : "unhealthy";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stripe readiness probe failed");
            return "unhealthy";
        }
    }
}
