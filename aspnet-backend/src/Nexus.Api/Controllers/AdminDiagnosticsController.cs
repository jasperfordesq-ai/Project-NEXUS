// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Services.Ai;
using Nexus.Api.Services.Scheduled;

namespace Nexus.Api.Controllers;

/// <summary>
/// Phase 73 — comprehensive operational diagnostics endpoint for ops staff.
///
/// Returns at-a-glance system health: DB migration version, hosted-service
/// runtime status, external-service config presence, application metadata.
/// Distinct from <c>/health</c> (which is the load-balancer probe — fast
/// + binary up/down). This endpoint is admin-only and gives operators the
/// detail they need to triage incidents.
/// </summary>
[ApiController]
[Route("api/admin/system/diagnostics")]
[Authorize(Policy = "AdminOnly")]
public class AdminDiagnosticsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ScheduledJobsRegistry _jobsRegistry;
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IAiProviderFactory _aiProviders;
    private readonly ILogger<AdminDiagnosticsController> _logger;

    public AdminDiagnosticsController(
        NexusDbContext db,
        ScheduledJobsRegistry jobsRegistry,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        IAiProviderFactory aiProviders,
        ILogger<AdminDiagnosticsController> logger)
    {
        _db = db;
        _jobsRegistry = jobsRegistry;
        _config = config;
        _httpFactory = httpFactory;
        _aiProviders = aiProviders;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        // Database — migration version + connection.
        string? appliedMigration = null;
        var dbConnected = false;
        try
        {
            var applied = await _db.Database.GetAppliedMigrationsAsync();
            appliedMigration = applied.LastOrDefault();
            dbConnected = appliedMigration != null;
        }
        catch (Exception ex)
        {
            appliedMigration = $"error:{ex.GetType().Name}";
        }

        // Pending migrations (would be applied on next startup).
        IList<string> pending;
        try { pending = (await _db.Database.GetPendingMigrationsAsync()).ToList(); }
        catch { pending = Array.Empty<string>(); }

        // Hosted-services snapshot.
        var jobs = _jobsRegistry.Snapshot();

        // External services — presence-only check (does the config key exist?).
        // We deliberately do NOT round-trip live calls here — this endpoint
        // must stay fast and side-effect-free. Live probes belong on per-service
        // health pages (/api/admin/ai/providers/test, /api/admin/federation/protocols/partners/{id}/ping/...).
        var externals = new Dictionary<string, object>
        {
            ["sendgrid"] = new
            {
                configured = !string.IsNullOrWhiteSpace(_config["SendGrid:ApiKey"]),
                enabled = _config.GetValue("SendGrid:Enabled", false)
            },
            ["gmail"] = new
            {
                configured = !string.IsNullOrWhiteSpace(_config["Gmail:RefreshToken"]),
            },
            ["stripe"] = new
            {
                secret_configured = !string.IsNullOrWhiteSpace(_config["Stripe:SecretKey"]),
                webhook_secret_configured = !string.IsNullOrWhiteSpace(_config["Stripe:WebhookSecret"])
                    || !string.IsNullOrWhiteSpace(_config["Stripe:WebhookSecret_Donations"])
            },
            ["ai"] = new
            {
                active_provider = _config["Ai:Provider"] ?? "ollama",
                anthropic_configured = !string.IsNullOrWhiteSpace(_config["Ai:Anthropic:ApiKey"]),
                openai_configured = !string.IsNullOrWhiteSpace(_config["Ai:OpenAI:ApiKey"]),
                gemini_configured = !string.IsNullOrWhiteSpace(_config["Ai:Gemini:ApiKey"]),
                ollama_url = _config["LlamaService:BaseUrl"]
            },
            ["push"] = new
            {
                provider = _config["Push:Provider"],
                fcm_configured = !string.IsNullOrWhiteSpace(_config["Firebase:ServerKey"])
                    || !string.IsNullOrWhiteSpace(_config["Fcm:ServerKey"]),
                vapid_configured = !string.IsNullOrWhiteSpace(_config["Vapid:PublicKey"])
                    && !string.IsNullOrWhiteSpace(_config["Vapid:PrivateKey"])
            },
            ["meilisearch"] = new
            {
                configured = !string.IsNullOrWhiteSpace(_config["Meilisearch:BaseUrl"])
            },
            ["sentry"] = new
            {
                configured = !string.IsNullOrWhiteSpace(_config["Sentry:Dsn"])
            }
        };

        // Process info.
        var process = System.Diagnostics.Process.GetCurrentProcess();
        var info = new
        {
            uptime_seconds = (DateTime.UtcNow - process.StartTime.ToUniversalTime()).TotalSeconds,
            working_set_mb = process.WorkingSet64 / 1024 / 1024,
            thread_count = process.Threads.Count,
            machine_name = Environment.MachineName,
            os = Environment.OSVersion.VersionString,
            framework = Environment.Version.ToString(),
            assembly_version = typeof(AdminDiagnosticsController).Assembly.GetName().Version?.ToString()
        };

        // Overall health verdict.
        var anyJobFailing = jobs.Any(j => j.Status == "failing" && j.ConsecutiveFailures >= 3);
        var pendingMigrations = pending.Count;
        var verdict = !dbConnected
            ? "critical"
            : anyJobFailing || pendingMigrations > 0
                ? "degraded"
                : "ok";

        return Ok(new
        {
            verdict,
            generated_at = DateTime.UtcNow,
            database = new
            {
                connected = dbConnected,
                applied_migration = appliedMigration,
                pending_migrations = pending,
                pending_count = pendingMigrations
            },
            hosted_services = jobs,
            external_services = externals,
            process = info
        });
    }

    /// <summary>
    /// Live external-service round-trip probes. Distinct from the main GET
    /// (which only checks config presence). Each probe has a 5-second
    /// timeout and is wrapped so a failure of one doesn't block the others.
    ///
    /// What gets probed:
    ///   - DB: SELECT 1 (in addition to AddNpgSql healthcheck)
    ///   - Stripe: GET /v1/balance with the configured secret key
    ///   - AI active provider: short prompt round-trip
    ///   - SendGrid: HEAD https://api.sendgrid.com (auth-not-required reachability)
    ///
    /// Returns a result-per-probe with status + latency_ms + optional error.
    /// </summary>
    [HttpGet("probe")]
    public async Task<IActionResult> Probe(CancellationToken ct)
    {
        var results = new List<object>();

        results.Add(await RunProbe("database", async _ =>
        {
            await _db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
            return (true, (string?)null);
        }, ct));

        results.Add(await RunProbe("stripe", async (probeCt) =>
        {
            var apiKey = _config["Stripe:SecretKey"];
            if (string.IsNullOrWhiteSpace(apiKey)) return (false, "stripe_secret_key_not_configured");
            using var client = _httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);
            using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.stripe.com/v1/balance");
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
            try
            {
                using var resp = await client.SendAsync(req, probeCt);
                return resp.IsSuccessStatusCode
                    ? (true, null)
                    : (false, $"stripe_http_{(int)resp.StatusCode}");
            }
            catch (HttpRequestException ex) { return (false, $"stripe_send_failed: {ex.Message}"); }
            catch (TaskCanceledException) { return (false, "stripe_timeout"); }
        }, ct));

        results.Add(await RunProbe("ai_active_provider", async (probeCt) =>
        {
            var provider = _aiProviders.Resolve();
            if (!provider.IsConfigured) return (false, $"{provider.Name}_not_configured");
            try
            {
                var response = await provider.ChatAsync(
                    "Reply with the word OK only.",
                    "ping",
                    probeCt);
                return string.IsNullOrWhiteSpace(response)
                    ? (false, $"{provider.Name}_empty_response")
                    : (true, null);
            }
            catch (AiProviderException ex) { return (false, ex.Message); }
        }, ct));

        results.Add(await RunProbe("sendgrid_reachable", async (probeCt) =>
        {
            // Reachability only (HEAD) — doesn't require API key. Confirms the
            // pod can route to SendGrid's network.
            using var client = _httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);
            try
            {
                using var resp = await client.SendAsync(
                    new HttpRequestMessage(HttpMethod.Head, "https://api.sendgrid.com"), probeCt);
                // Any HTTP response (including 401) means we can reach them.
                return (true, null);
            }
            catch (HttpRequestException ex) { return (false, $"sendgrid_unreachable: {ex.Message}"); }
            catch (TaskCanceledException) { return (false, "sendgrid_timeout"); }
        }, ct));

        return Ok(new
        {
            generated_at = DateTime.UtcNow,
            probes = results
        });
    }

    private static async Task<object> RunProbe(string name, Func<CancellationToken, Task<(bool Ok, string? Error)>> probe, CancellationToken ct)
    {
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var (ok, error) = await probe(ct);
            stopwatch.Stop();
            return new
            {
                name,
                ok,
                latency_ms = stopwatch.ElapsedMilliseconds,
                error
            };
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            return new
            {
                name,
                ok = false,
                latency_ms = stopwatch.ElapsedMilliseconds,
                error = $"{ex.GetType().Name}: {ex.Message}"
            };
        }
    }

    /// <summary>
    /// Fire a controlled test exception that the configured Sentry middleware
    /// will capture. Operators use this immediately after configuring
    /// Sentry:Dsn to verify the integration is reaching the right project.
    ///
    /// Returns the captured event id so the operator can find it in the
    /// Sentry dashboard.
    /// </summary>
    [HttpPost("sentry-test")]
    public IActionResult SentryTest([FromQuery] string? message = null)
    {
        if (string.IsNullOrWhiteSpace(_config["Sentry:Dsn"]))
        {
            return BadRequest(new
            {
                ok = false,
                error = "sentry_dsn_not_configured",
                hint = "Set Sentry:Dsn in configuration before running this test."
            });
        }

        var msg = string.IsNullOrWhiteSpace(message)
            ? $"Nexus admin Sentry test at {DateTime.UtcNow:O}"
            : $"Nexus admin Sentry test: {message}";

        var ex = new InvalidOperationException(msg);
        // Tag the event so it's easy to filter in Sentry — admin-fired tests
        // shouldn't pollute real-incident searches.
        var eventId = SentrySdk.CaptureException(ex, scope =>
        {
            scope.SetTag("nexus.test", "admin-diagnostics");
            scope.SetTag("nexus.environment", _config["Sentry:Environment"] ?? "unknown");
            scope.Level = SentryLevel.Info;
        });

        _logger.LogInformation("Sentry test event captured with id {EventId}", eventId);

        return Ok(new
        {
            ok = true,
            event_id = eventId.ToString(),
            message = msg,
            hint = $"Search for tag nexus.test=admin-diagnostics in your Sentry project. Expect to see this event arrive within 30 seconds."
        });
    }
}
