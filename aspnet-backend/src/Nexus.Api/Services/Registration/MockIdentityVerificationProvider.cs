// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Mock identity verification provider for development and testing.
/// Simulates the verification flow without calling any external service.
/// Behaviour is controlled via providerConfig JSON:
/// - {"auto_approve": true} — instantly approves
/// - {"auto_approve": false} — requires manual webhook trigger
/// - {"simulate_failure": true} — always fails
/// </summary>
public class MockIdentityVerificationProvider : IIdentityVerificationProvider
{
    public VerificationProvider ProviderType => VerificationProvider.Mock;
    public string DisplayName => "Mock Provider (Development)";

    public Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig)
    {
        var sessionId = $"mock_{Guid.NewGuid():N}";
        var config = ParseConfig(providerConfig);

        var result = new VerificationSessionResult
        {
            ExternalSessionId = sessionId,
            RedirectUrl = config.AutoApprove ? null : $"/mock-verify/{sessionId}",
            ExpiresAt = DateTime.UtcNow.AddHours(1)
        };

        return Task.FromResult(result);
    }

    public Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig)
    {
        var config = ParseConfig(providerConfig);

        if (config.SimulateFailure)
        {
            return Task.FromResult(new VerificationStatusResult
            {
                Status = VerificationSessionStatus.Failed,
                Decision = "declined",
                DecisionReason = "Mock: simulated failure"
            });
        }

        if (config.AutoApprove)
        {
            return Task.FromResult(new VerificationStatusResult
            {
                Status = VerificationSessionStatus.Completed,
                Decision = "approved",
                DecisionReason = "Mock: auto-approved",
                ConfidenceScore = 1.0
            });
        }

        return Task.FromResult(new VerificationStatusResult
        {
            Status = VerificationSessionStatus.InProgress,
            Decision = null,
            DecisionReason = "Mock: awaiting manual trigger"
        });
    }

    public Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig)
    {
        // Mock provider: the raw body is the decision ("approved" or "declined")
        var decision = payload.RawBody.Trim().ToLowerInvariant();

        if (decision != "approved" && decision != "declined")
        {
            return Task.FromResult<VerificationStatusResult?>(null);
        }

        return Task.FromResult<VerificationStatusResult?>(new VerificationStatusResult
        {
            Status = decision == "approved"
                ? VerificationSessionStatus.Completed
                : VerificationSessionStatus.Failed,
            Decision = decision,
            DecisionReason = $"Mock: webhook {decision}",
            ConfidenceScore = decision == "approved" ? 1.0 : 0.0
        });
    }

    public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig)
    {
        // Mock provider: check for a "X-Mock-Secret" header matching config
        var config = ParseConfig(providerConfig);
        if (string.IsNullOrEmpty(config.WebhookSecret))
            return true; // No secret configured = accept all

        return payload.Headers.TryGetValue("X-Mock-Secret", out var secret)
            && secret == config.WebhookSecret;
    }

    private static MockConfig ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json))
            return new MockConfig();

        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<MockConfig>(json) ?? new MockConfig();
        }
        catch
        {
            return new MockConfig();
        }
    }

    private record MockConfig
    {
        [System.Text.Json.Serialization.JsonPropertyName("auto_approve")]
        public bool AutoApprove { get; init; } = true;

        [System.Text.Json.Serialization.JsonPropertyName("simulate_failure")]
        public bool SimulateFailure { get; init; }

        [System.Text.Json.Serialization.JsonPropertyName("webhook_secret")]
        public string? WebhookSecret { get; init; }
    }
}
