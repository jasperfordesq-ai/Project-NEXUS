// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Stripe Identity provider adapter.
/// Uses Stripe's VerificationSession API for identity verification.
/// Supports redirect-based flow (hosted verification page).
///
/// Provider config JSON format:
/// {
///   "secret_key": "sk_live_...",
///   "webhook_secret": "whsec_...",
///   "return_url": "https://platform.project-nexus.net/registration/verify/complete"
/// }
/// </summary>
public class StripeIdentityProvider : IIdentityVerificationProvider
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<StripeIdentityProvider> _logger;
    private const string StripeApiBase = "https://api.stripe.com/v1";

    public VerificationProvider ProviderType => VerificationProvider.StripeIdentity;
    public string DisplayName => "Stripe Identity";

    public StripeIdentityProvider(
        IHttpClientFactory httpClientFactory,
        ILogger<StripeIdentityProvider> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig)
    {
        var config = ParseConfig(providerConfig);
        if (string.IsNullOrEmpty(config.SecretKey))
            throw new InvalidOperationException("Stripe secret key not configured.");

        var client = CreateClient(config.SecretKey);

        var verificationOptions = MapVerificationLevel(level);

        var formData = new Dictionary<string, string>
        {
            ["type"] = "document",
            ["metadata[user_id]"] = userId.ToString(),
            ["metadata[tenant_id]"] = tenantId.ToString(),
            ["options[document][require_matching_selfie]"] = verificationOptions.RequireSelfie ? "true" : "false",
        };

        if (!string.IsNullOrEmpty(config.ReturnUrl))
        {
            formData["return_url"] = config.ReturnUrl;
        }

        var request = new HttpRequestMessage(HttpMethod.Post, $"{StripeApiBase}/identity/verification_sessions")
        {
            Content = new FormUrlEncodedContent(formData)
        };

        var response = await client.SendAsync(request);
        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Stripe Identity session creation failed: {StatusCode} {Body}",
                response.StatusCode, responseBody);
            throw new InvalidOperationException($"Stripe Identity API error: {response.StatusCode}");
        }

        var json = JsonDocument.Parse(responseBody);
        var root = json.RootElement;

        var sessionId = root.GetProperty("id").GetString()!;
        var sessionUrl = root.TryGetProperty("url", out var urlProp) ? urlProp.GetString() : null;

        return new VerificationSessionResult
        {
            ExternalSessionId = sessionId,
            RedirectUrl = sessionUrl,
            ExpiresAt = DateTime.UtcNow.AddHours(24) // Stripe sessions last 24h
        };
    }

    public async Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig)
    {
        var config = ParseConfig(providerConfig);
        if (string.IsNullOrEmpty(config.SecretKey))
            throw new InvalidOperationException("Stripe secret key not configured.");

        var client = CreateClient(config.SecretKey);
        var response = await client.GetAsync($"{StripeApiBase}/identity/verification_sessions/{externalSessionId}");
        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Stripe Identity status check failed: {StatusCode}", response.StatusCode);
            return new VerificationStatusResult
            {
                Status = VerificationSessionStatus.Failed,
                Decision = "error",
                DecisionReason = $"API error: {response.StatusCode}"
            };
        }

        var json = JsonDocument.Parse(responseBody);
        return MapStripeStatus(json.RootElement);
    }

    public Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig)
    {
        JsonDocument json;
        try
        {
            json = JsonDocument.Parse(payload.RawBody);
        }
        catch
        {
            _logger.LogWarning("Stripe webhook: invalid JSON body");
            return Task.FromResult<VerificationStatusResult?>(null);
        }

        var root = json.RootElement;

        if (!root.TryGetProperty("type", out var typeProp))
            return Task.FromResult<VerificationStatusResult?>(null);

        var eventType = typeProp.GetString();

        // Only handle identity verification events
        if (eventType is not ("identity.verification_session.verified"
            or "identity.verification_session.requires_input"
            or "identity.verification_session.canceled"))
        {
            return Task.FromResult<VerificationStatusResult?>(null);
        }

        var dataObject = root.GetProperty("data").GetProperty("object");
        var result = MapStripeStatus(dataObject);

        // Extract session ID for matching
        var sessionId = dataObject.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
        if (sessionId != null)
            result = result with { ExternalSessionId = sessionId };

        _logger.LogInformation("Stripe webhook processed: type={EventType}, session={SessionId}, decision={Decision}",
            eventType, sessionId, result.Decision);

        return Task.FromResult<VerificationStatusResult?>(result);
    }

    public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig)
    {
        var config = ParseConfig(providerConfig);
        if (string.IsNullOrEmpty(config.WebhookSecret))
        {
            _logger.LogWarning("Stripe webhook secret not configured — rejecting webhook");
            return false;
        }

        // Stripe uses Stripe-Signature header with timestamp and HMAC-SHA256
        if (!payload.Headers.TryGetValue("Stripe-Signature", out var signatureHeader))
        {
            _logger.LogWarning("Missing Stripe-Signature header");
            return false;
        }

        return VerifyStripeSignature(payload.RawBody, signatureHeader, config.WebhookSecret);
    }

    #region Private Helpers

    private HttpClient CreateClient(string secretKey)
    {
        var client = _httpClientFactory.CreateClient("StripeIdentity");
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", secretKey);
        client.DefaultRequestHeaders.Add("Stripe-Version", "2024-12-18.acacia");
        return client;
    }

    private static VerificationStatusResult MapStripeStatus(JsonElement session)
    {
        var status = session.GetProperty("status").GetString();
        var lastError = session.TryGetProperty("last_error", out var errorProp) && errorProp.ValueKind != JsonValueKind.Null
            ? errorProp.TryGetProperty("reason", out var reasonProp) ? reasonProp.GetString() : null
            : null;

        return status switch
        {
            "verified" => new VerificationStatusResult
            {
                Status = VerificationSessionStatus.Completed,
                Decision = "approved",
                DecisionReason = "Identity verified by Stripe",
                ConfidenceScore = 1.0
            },
            "requires_input" => new VerificationStatusResult
            {
                Status = VerificationSessionStatus.Failed,
                Decision = "declined",
                DecisionReason = lastError ?? "Verification requires additional input",
                ConfidenceScore = 0.0
            },
            "canceled" => new VerificationStatusResult
            {
                Status = VerificationSessionStatus.Cancelled,
                Decision = "cancelled",
                DecisionReason = "Verification session was cancelled"
            },
            "processing" => new VerificationStatusResult
            {
                Status = VerificationSessionStatus.InProgress,
                Decision = null,
                DecisionReason = "Stripe is processing the verification"
            },
            _ => new VerificationStatusResult
            {
                Status = VerificationSessionStatus.InProgress,
                Decision = null,
                DecisionReason = $"Stripe status: {status}"
            }
        };
    }

    private static (bool RequireSelfie, bool RequireLiveness) MapVerificationLevel(VerificationLevel level)
    {
        return level switch
        {
            VerificationLevel.DocumentOnly => (false, false),
            VerificationLevel.DocumentAndSelfie => (true, false),
            VerificationLevel.AuthoritativeDataMatch => (true, true),
            _ => (false, false)
        };
    }

    private static bool VerifyStripeSignature(string payload, string signatureHeader, string secret)
    {
        // Parse Stripe-Signature header: t=timestamp,v1=signature
        var parts = signatureHeader.Split(',')
            .Select(p => p.Trim().Split('=', 2))
            .Where(p => p.Length == 2)
            .ToDictionary(p => p[0], p => p[1]);

        if (!parts.TryGetValue("t", out var timestamp) || !parts.TryGetValue("v1", out var signature))
            return false;

        // Verify timestamp is within tolerance (5 minutes)
        if (!long.TryParse(timestamp, out var ts))
            return false;

        var eventTime = DateTimeOffset.FromUnixTimeSeconds(ts);
        if (Math.Abs((DateTimeOffset.UtcNow - eventTime).TotalMinutes) > 5)
            return false;

        // Compute expected signature: HMAC-SHA256(secret, "timestamp.payload")
        var signedPayload = $"{timestamp}.{payload}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expectedBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload));
        var expectedSignature = Convert.ToHexString(expectedBytes).ToLowerInvariant();

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expectedSignature),
            Encoding.UTF8.GetBytes(signature));
    }

    private static StripeConfig ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json))
            return new StripeConfig();

        try
        {
            return JsonSerializer.Deserialize<StripeConfig>(json) ?? new StripeConfig();
        }
        catch
        {
            return new StripeConfig();
        }
    }

    private record StripeConfig
    {
        [System.Text.Json.Serialization.JsonPropertyName("secret_key")]
        public string? SecretKey { get; init; }

        [System.Text.Json.Serialization.JsonPropertyName("webhook_secret")]
        public string? WebhookSecret { get; init; }

        [System.Text.Json.Serialization.JsonPropertyName("return_url")]
        public string? ReturnUrl { get; init; }
    }

    #endregion
}
