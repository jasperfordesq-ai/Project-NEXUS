// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Asp.Versioning;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using Nexus.Api.Configuration;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Hubs;
using Nexus.Api.Middleware;
using Nexus.Api.Observability;
using Nexus.Api.Routing;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Sentry.AspNetCore;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// The historical forced-admin login gate has no compatible first-time setup
// client and would lock unenrolled administrators out. Reject either legacy
// configuration spelling before constructing the application.
ForcedAdminTwoFactorGuard.Validate(builder.Configuration);

// Sentry error tracking (configure via Sentry:Dsn env var or appsettings)
builder.WebHost.UseSentry(o =>
{
    o.Dsn = builder.Configuration["Sentry:Dsn"] ?? "";
    o.Environment = builder.Configuration["Sentry:Environment"] ?? builder.Environment.EnvironmentName;
    o.TracesSampleRate = builder.Configuration.GetValue("Sentry:TracesSampleRate", 0.1);
    o.SendDefaultPii = builder.Configuration.GetValue("Sentry:SendDefaultPii", false);

    // Drop EF Core's "Failed executing DbCommand" error logs from Sentry.
    //
    // EF Core logs every failed command at Error level under the
    // "Microsoft.EntityFrameworkCore.Database.Command" category. Sentry's
    // logging integration turns those Error logs into standalone issues — but
    // they are pure duplicate noise:
    //   - When a query fails inside a request, the exception propagates and is
    //     already captured (with a full stack trace + request context) by the
    //     ASP.NET Core integration / global exception handler.
    //   - When a scheduled job's DB write fails, the failure is deliberately
    //     swallowed (observability writes in ScheduledHostedService must never
    //     block job work) and any genuine job failure is captured explicitly
    //     via SentrySdk.CaptureException with a `job_name` tag.
    // In both cases the raw EF command-error log adds nothing and only creates
    // stack-trace-less, "system-only" issues (e.g. DOTNET-ASPNETCORE-9).
    // Dropping log-derived events from this category here suppresses the noise
    // without affecting captured exceptions or console/Serilog logging — the
    // logging integration stamps SentryEvent.Logger with the category name.
    o.SetBeforeSend((@event, _) =>
        @event.Logger == "Microsoft.EntityFrameworkCore.Database.Command"
            ? null
            : @event);
});

// =============================================================================
// DOCKER-ONLY DEVELOPMENT CHECK
// =============================================================================
// This project is designed to run in Docker. Running directly with `dotnet run`
// is not supported and may cause configuration issues.
var isRunningInDocker = Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true";
var isTestEnvironment = builder.Environment.EnvironmentName == "Testing";
if (!isRunningInDocker && !isTestEnvironment && builder.Environment.IsDevelopment())
{
    Console.ForegroundColor = ConsoleColor.Yellow;
    Console.WriteLine("╔════════════════════════════════════════════════════════════════════╗");
    Console.WriteLine("║  WARNING: Running outside Docker is not supported.                 ║");
    Console.WriteLine("║  Please use: docker compose up -d                                  ║");
    Console.WriteLine("║  See docs/system/LOCAL_DEVELOPMENT.md for details.                 ║");
    Console.WriteLine("╚════════════════════════════════════════════════════════════════════╝");
    Console.ResetColor();
}

// =============================================================================
// SERILOG CONFIGURATION (Production only)
// =============================================================================
// In Production, Serilog reads config from appsettings.Production.json
// Features: structured JSON logging, file rotation, enrichers
// In Development and Testing, use the default console provider so integration
// failures retain their exception details. Production/staging keep structured
// Serilog sinks from environment configuration.
if (!builder.Environment.IsDevelopment()
    && !builder.Environment.IsEnvironment("Testing"))
{
    Log.Logger = new LoggerConfiguration()
        .ReadFrom.Configuration(builder.Configuration)
        .CreateLogger();

    builder.Host.UseSerilog();
}

// =============================================================================
// SERVICES
// =============================================================================

// Add controllers with request body size limit.
builder.Services.AddControllers(opt =>
{
    opt.Conventions.Add(new AdminV2RouteAliasConvention());
});

// Global request body size limit (5MB) to prevent abuse
// Individual endpoints can override with [RequestSizeLimit] attribute
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 5 * 1024 * 1024; // 5MB
});

// API Versioning
builder.Services.AddApiVersioning(options =>
{
    options.DefaultApiVersion = new ApiVersion(1, 0);
    options.AssumeDefaultVersionWhenUnspecified = true;
    options.ReportApiVersions = true;
    options.ApiVersionReader = ApiVersionReader.Combine(
        new UrlSegmentApiVersionReader(),
        new HeaderApiVersionReader("X-Api-Version")
    );
}).AddApiExplorer(options =>
{
    options.GroupNameFormat = "'v'VVV";
    options.SubstituteApiVersionInUrl = true;
});

// Swagger for development
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new() { Title = "Nexus API", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Enter your token below.",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

// Rate Limiting
builder.Services.AddRateLimitingPolicies(builder.Configuration);

// Response Compression - reduces bandwidth by 70% for JSON responses
// Note: EnableForHttps is safe here because we use JWT Bearer tokens (not cookies).
// BREACH attacks only affect cookie-based auth where secrets are reflected in responses.
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = new[]
    {
        "application/json",
        "text/json",
        "application/json; charset=utf-8"
    };
});

// PostgreSQL + EF Core
builder.Services.AddDbContext<NexusDbContext>((sp, options) =>
{
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection"));
});

// TenantContext - scoped per request
builder.Services.AddScoped<TenantContext>();

// Domain services, Meilisearch, Registration Policy Engine, AI, and SignalR
builder.Services.AddNexusServices(builder.Configuration);

// JWT Bearer authentication + AdminOnly authorization policy
builder.Services.AddNexusAuthentication(builder.Configuration, isTestEnvironment);

// Health checks
var healthChecks = builder.Services.AddHealthChecks();
var defaultConnectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (!string.IsNullOrEmpty(defaultConnectionString))
    healthChecks.AddNpgSql(defaultConnectionString);

// CORS - explicit browser origins; credentials are allowed for compatibility
// with canonical clients that send credentials on selected public requests.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? Array.Empty<string>();

// Sanitize origins: remove trailing slashes, empty entries, validate format
allowedOrigins = allowedOrigins
    .Where(o => !string.IsNullOrWhiteSpace(o))
    .Select(o => o.TrimEnd('/'))
    .Where(o => Uri.TryCreate(o, UriKind.Absolute, out var uri)
                && (uri.Scheme == "http" || uri.Scheme == "https")
                && string.IsNullOrEmpty(uri.PathAndQuery.TrimStart('/')))
    .Distinct()
    .ToArray();

// In Production, CORS origins are required; in Development, warn but allow startup
if (allowedOrigins.Length == 0)
{
    if (builder.Environment.IsProduction())
    {
        throw new InvalidOperationException(
            "Cors:AllowedOrigins must be configured in Production. " +
            "Check appsettings.Production.json");
    }
    else
    {
        // Development: log warning, CORS policy will reject all cross-origin requests
        // Swagger/same-origin requests still work
        Console.WriteLine("WARNING: No valid CORS origins configured. Cross-origin requests will be blocked.");
    }
}

// Fido2 origins - fail-fast in Production if missing or insecure
// Mirrors the CORS pattern: WebAuthn requires HTTPS in production
var fido2Origins = builder.Configuration.GetSection("Fido2:Origins").Get<string[]>()
    ?? Array.Empty<string>();
fido2Origins = fido2Origins
    .Where(o => !string.IsNullOrWhiteSpace(o))
    .Select(o => o.TrimEnd('/'))
    .ToArray();

if (builder.Environment.IsProduction())
{
    if (fido2Origins.Length == 0)
    {
        throw new InvalidOperationException(
            "Fido2:Origins must be configured in Production. " +
            "Check appsettings.Production.json");
    }
    var insecure = fido2Origins.FirstOrDefault(o => o.StartsWith("http://", StringComparison.OrdinalIgnoreCase));
    if (insecure != null)
    {
        throw new InvalidOperationException(
            $"Fido2:Origins contains insecure (http://) origin '{insecure}' in Production. " +
            "WebAuthn requires HTTPS.");
    }
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("Default", policy =>
    {
        if (allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins)
                .AllowAnyMethod()
                // Security: Only allow headers actually needed by the API
                // - Authorization: JWT Bearer token
                // - Content-Type: JSON request bodies
                // - X-Api-Version: API versioning header
                // - X-Tenant-ID: Tenant context for unauthenticated requests
                // - X-Requested-With: Required by SignalR client
                // - X-SignalR-User-Agent: SignalR connection metadata
                // - Idempotency-Key: Canonical wallet transfer replay protection
                .WithHeaders("Authorization", "Content-Type", "X-Api-Version", "X-Tenant-ID", "X-Requested-With", "X-SignalR-User-Agent", "Idempotency-Key")
                // The React frontend uses fetch with credentials: 'include' for some
                // public endpoints (bootstrap, tenant chooser, menus) so the browser
                // will attach session cookies if present. Spec-compliant because we
                // use explicit origins (not "*").
                .AllowCredentials()
                // Performance: Cache preflight responses for 30 minutes
                // Reduces OPTIONS requests from browsers
                .SetPreflightMaxAge(TimeSpan.FromMinutes(30));
        }
    });
});

// =============================================================================
// OPENTELEMETRY (metrics + traces)
// =============================================================================
// Default ON, except in Testing (avoids double-registering Meters across
// WebApplicationFactory instances). Disable explicitly via Otel:Enabled=false.
// If Otel:Endpoint is set we export OTLP; otherwise we expose Prometheus
// scrape at /metrics.
var otelEnabled = builder.Configuration.GetValue("Otel:Enabled", !isTestEnvironment);
var otelEndpoint = builder.Configuration["Otel:Endpoint"];
var useOtlp = !string.IsNullOrWhiteSpace(otelEndpoint);
if (otelEnabled)
{
    var serviceVersion = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
    builder.Services.AddOpenTelemetry()
        .ConfigureResource(r => r
            .AddService(serviceName: "nexus-api", serviceVersion: serviceVersion))
        .WithMetrics(metrics =>
        {
            metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddMeter(NexusMetrics.MeterName)
                .AddView(
                    instrumentName: "nexus.exchange.completion.duration",
                    metricStreamConfiguration: new ExplicitBucketHistogramConfiguration
                    {
                        Boundaries = NexusMetrics.DurationBucketsSeconds
                    });

            if (useOtlp)
            {
                metrics.AddOtlpExporter(o => o.Endpoint = new Uri(otelEndpoint!));
            }
            else
            {
                metrics.AddPrometheusExporter();
            }
        })
        .WithTracing(tracing =>
        {
            tracing
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddEntityFrameworkCoreInstrumentation();

            if (useOtlp)
            {
                tracing.AddOtlpExporter(o => o.Endpoint = new Uri(otelEndpoint!));
            }
        });
}

// =============================================================================
// PRODUCTION SECRET GUARD
// =============================================================================
// Fails fast in Production if required secrets are unset or placeholder-like.
// In Development, logs warnings only. Skipped during integration tests.
if (!isTestEnvironment)
{
    using var guardLoggerFactory = LoggerFactory.Create(b => b.AddConsole());
    var guardLogger = guardLoggerFactory.CreateLogger("ProductionSecretGuard");
    ProductionSecretGuard.Validate(builder.Configuration, builder.Environment, guardLogger);
}

var app = builder.Build();

// =============================================================================
// STARTUP LOGGING
// =============================================================================
// Log environment and CORS configuration (no sensitive values)
var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
var corsMode = app.Environment.IsProduction() ? "strict" : "permissive";
startupLogger.LogInformation(
    "Environment: {Environment} | CORS origins: {OriginCount} | CORS mode: {CorsMode}",
    app.Environment.EnvironmentName,
    allowedOrigins.Length,
    corsMode);

if (allowedOrigins.Length > 0 && !app.Environment.IsProduction())
{
    // In Development, log the actual origins for debugging (safe - just localhost URLs)
    startupLogger.LogDebug("CORS allowed origins: {Origins}", string.Join(", ", allowedOrigins));
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    // Apply EF migrations on every non-Testing startup. Integration tests own
    // their disposable database lifecycle and apply the migration chain in the
    // shared test factory.
    if (!app.Environment.IsEnvironment("Testing"))
    {
        await db.Database.MigrateAsync();
    }

    // WARNING: TEST DATA ONLY — never runs in Production.
    // Seeds fictitious tenants/users/listings with well-known dev passwords.
    var runDemoShowcaseSeed = app.Configuration.GetValue<bool>("DemoShowcaseSeed:Run");
    var seedOnly = app.Configuration.GetValue<bool>("DemoShowcaseSeed:SeedOnly");

    if (app.Environment.IsDevelopment())
    {
        await SeedData.SeedAsync(db, logger, app.Environment);
        await DemoShowcaseSeedData.SeedAsync(db, logger, app.Environment);
    }
    else if (runDemoShowcaseSeed)
    {
        logger.LogWarning("Running explicitly requested Project NEXUS .NET Edition demo showcase seed in {Environment}.", app.Environment.EnvironmentName);
        await DemoShowcaseSeedData.SeedAsync(db, logger, app.Environment, allowProduction: true);

        if (seedOnly)
        {
            logger.LogInformation("DemoShowcaseSeed:SeedOnly is enabled; exiting after seed.");
            return;
        }
    }
}

// =============================================================================
// MIDDLEWARE PIPELINE (order matters!)
// =============================================================================
// 1. Exception Handling - MUST be first to catch all errors
// 2. Response Compression - compress responses early
// 3. Swagger (dev only)
// 4. HTTPS redirect (prod only)
// 5. CORS
// 6. Authentication - parses JWT, populates HttpContext.User
// 7. Partner-token boundary and Authorization
// 8. Feature/validation/onboarding gates, then Rate Limiting
// 9. Privacy/lockdown/module/federation guards
// 10. TenantResolution and identity-enriched logging
// 11. Controllers
// =============================================================================

// Forwarded Headers - MUST be first to ensure correct client IPs behind the configured reverse proxy
// Without this, HttpContext.Connection.RemoteIpAddress shows the proxy IP, not the real client
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});

// Sentry performance tracing
app.UseSentryTracing();

// Request correlation — runs FIRST in our pipeline (after Sentry tracing) so
// every log entry + every error response carries the same request_id.
// Reads X-Request-Id / X-Correlation-Id from upstream and falls back to a
// fresh GUID. Always sets the same id on the response header.
app.UseRequestCorrelation();

// Global exception handling - MUST be early in pipeline
// In Development: returns full exception details
// In Production: returns generic error message (no sensitive details)
app.UseExceptionHandling();

// Response compression - reduces bandwidth by 70% for JSON payloads
app.UseResponseCompression();

// Development only
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// HTTPS redirection (prod only)
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Security headers - add early to apply to all responses
app.UseSecurityHeaders();

// Local demo/static assets for generated showcase imagery under wwwroot.
app.UseStaticFiles();

// CORS
app.UseCors("Default");

// Authentication - populates HttpContext.User from JWT
app.UseAuthentication();

// Partner client-credential JWTs are not member tokens. Constrain them to the
// dedicated partner surface before ordinary [Authorize] policies run.
app.UseMiddleware<PartnerTokenBoundaryMiddleware>();

// Authorization - enforces [Authorize] attributes
app.UseAuthorization();

// Laravel authenticates and runs module/feature gates before action-specific
// throttles. Preserve that order for recurring patterns and volunteer-
// organisation registration so 401/403 responses neither consume nor become
// a 429 from those endpoint buckets.
app.UseMiddleware<RecurringPatternFeatureGateMiddleware>();
// Laravel FormRequest validation precedes the controller-level feature gate
// and action throttle for the two member volunteer-hours mutations.
app.UseMiddleware<VolunteerHoursMutationValidationMiddleware>();
app.UseMiddleware<VolunteerOrganisationFeatureGateMiddleware>();
// The admin hours endpoint validates inside its controller in Laravel, so its
// canonical 400 body error must run after the controller-level feature gate.
app.UseMiddleware<AdminVolunteerHoursMutationValidationMiddleware>();
app.UseMiddleware<OnboardingRequiredMiddleware>();

// Rate limiting follows authentication/authorization so authenticated
// endpoint policies partition by user while protected anonymous requests
// short-circuit first. Anonymous [AllowAnonymous] policies still partition by IP.
app.UseRateLimiter();

// Surname privacy — strips last_name / surname from /api/* JSON responses
// for non-admin viewers. A member always sees their own surname (object's
// id matches current user). MUST run after Authentication so role + user_id
// are populated, and before any feature middleware that may short-circuit.
app.UseMiddleware<Nexus.Api.Middleware.SurnamePrivacyMiddleware>();

// Emergency Lockdown check - blocks non-admin, non-health requests when lockdown is active
// MUST be after Authentication/Authorization so admin role can be checked
app.UseMiddleware<LockdownCheckMiddleware>();

// Former parity-exclusion feature guard: returns 404 for legacy V1 module
// surfaces (Marketplace, Caring Community, Verein/Clubs, Regional Analytics,
// National KISS) unless the per-tenant feature flag is on. MUST be before
// MapControllers so disabled gap routes never hit the controller.
app.UseMiddleware<OutOfScopeFeatureGuardMiddleware>();

// Federation API middleware - authenticates external federation API calls
// Uses API Key or Federation JWT, separate from standard auth
app.UseMiddleware<FederationApiMiddleware>();

// Tenant resolution - MUST come after UseAuthentication()
// Reads tenant_id from JWT claims and sets TenantContext
app.UseMiddleware<TenantResolutionMiddleware>();

// Log enrichment - pushes tenant_id + user_id onto Serilog LogContext.
// MUST run after authentication AND tenant resolution so both values are set.
app.UseMiddleware<IdentityLogEnrichmentMiddleware>();

// Prometheus scrape endpoint (no auth — standard for Prometheus pull).
// Only mapped when OTel is enabled AND no OTLP endpoint is configured.
if (otelEnabled && !useOtlp)
{
    app.MapPrometheusScrapingEndpoint("/metrics");
}

// Map controllers and health checks
app.MapControllers();
app.MapHealthChecks("/health", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var result = System.Text.Json.JsonSerializer.Serialize(new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                duration = e.Value.Duration.TotalMilliseconds
            })
        });
        await context.Response.WriteAsync(result);
    }
});

// Map SignalR hubs
// Endpoint: /hubs/messages
// WebSocket connection: ws://localhost:5080/hubs/messages?access_token=<jwt>
app.MapHub<MessagesHub>("/hubs/messages");

// =============================================================================
// RUN
// =============================================================================

app.Run();

// Make Program class accessible for integration tests
public partial class Program { }
