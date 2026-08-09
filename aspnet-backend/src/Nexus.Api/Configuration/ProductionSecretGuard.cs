// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Configuration;

/// <summary>
/// Startup guard that validates required secrets/config in Production.
/// In Production, throws InvalidOperationException listing all bad keys so
/// the operator can fix them in one pass. In Development, logs warnings only.
/// </summary>
public static class ProductionSecretGuard
{
    private static readonly string[] PlaceholderTokens =
    {
        "REPLACE", "CHANGEME", "TODO", "your-", "xxxx"
    };

    public static void Validate(IConfiguration config, IHostEnvironment env, ILogger logger)
    {
        var failures = new List<string>();
        var warnings = new List<string>();

        // JWT secret: required, min 16 chars, no placeholder
        var jwtSecret = config["Jwt:Secret"] ?? Environment.GetEnvironmentVariable("JWT_SECRET");
        CheckSecret("Jwt:Secret", jwtSecret, failures, requireMinLength: true);

        // Stripe: only enforce if section/key exists
        var stripeSection = config.GetSection("Stripe");
        if (stripeSection.Exists())
        {
            var stripeSecret = config["Stripe:SecretKey"];
            if (!string.IsNullOrEmpty(stripeSecret) || stripeSection.GetChildren().Any())
            {
                CheckSecret("Stripe:SecretKey", stripeSecret, failures, requireMinLength: true);
                CheckSecret("Stripe:WebhookSecret", config["Stripe:WebhookSecret"], failures, requireMinLength: true);

                var identitySection = config.GetSection("Stripe:Identity");
                if (identitySection.Exists())
                {
                    CheckSecret("Stripe:Identity:WebhookSecret", config["Stripe:Identity:WebhookSecret"], failures, requireMinLength: true);
                }
            }
        }

        // SendGrid: only enforce if section exists
        var sendGridSection = config.GetSection("SendGrid");
        if (sendGridSection.Exists())
        {
            CheckSecret("SendGrid:ApiKey", config["SendGrid:ApiKey"], failures, requireMinLength: true);
        }

        // Sentry: warn only
        var sentryDsn = config["Sentry:Dsn"];
        if (string.IsNullOrWhiteSpace(sentryDsn) || LooksPlaceholder(sentryDsn))
        {
            warnings.Add("Sentry:Dsn is not configured (error tracking disabled)");
        }

        // Connection string: must contain a real password
        var connStr = config.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connStr))
        {
            failures.Add("ConnectionStrings:DefaultConnection is empty");
        }
        else if (LooksPlaceholderConnection(connStr))
        {
            failures.Add("ConnectionStrings:DefaultConnection contains a placeholder/empty password");
        }

        if (env.IsProduction())
        {
            foreach (var w in warnings) logger.LogWarning("[ProductionSecretGuard] {Warning}", w);
            if (failures.Count > 0)
            {
                var list = string.Join("\n  - ", failures);
                throw new InvalidOperationException(
                    $"Production startup blocked: {failures.Count} secret/config value(s) are missing or look like placeholders:\n  - {list}\n" +
                    "Fix these via environment variables or appsettings.Production.json before deploying.");
            }
        }
        else
        {
            foreach (var w in warnings) logger.LogWarning("[ProductionSecretGuard:dev] {Warning}", w);
            foreach (var f in failures) logger.LogWarning("[ProductionSecretGuard:dev] {Failure}", f);
        }
    }

    private static void CheckSecret(string key, string? value, List<string> failures, bool requireMinLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            failures.Add($"{key} is empty");
            return;
        }
        if (LooksPlaceholder(value))
        {
            failures.Add($"{key} looks like a placeholder");
            return;
        }
        if (requireMinLength && value.Length < 16)
        {
            failures.Add($"{key} is shorter than 16 characters");
        }
    }

    private static bool LooksPlaceholder(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        foreach (var token in PlaceholderTokens)
        {
            if (value.Contains(token, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static bool LooksPlaceholderConnection(string connStr)
    {
        // Inspect Password=... segment when present
        var lower = connStr.ToLowerInvariant();
        if (LooksPlaceholder(connStr)) return true;
        // Detect common bad passwords
        var parts = connStr.Split(';', StringSplitOptions.RemoveEmptyEntries);
        foreach (var part in parts)
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2) continue;
            var k = kv[0].Trim().ToLowerInvariant();
            var v = kv[1].Trim();
            if (k == "password" || k == "pwd")
            {
                if (string.IsNullOrWhiteSpace(v)) return true;
                if (string.Equals(v, "password", StringComparison.OrdinalIgnoreCase)) return true;
                if (LooksPlaceholder(v)) return true;
            }
        }
        return false;
    }
}
