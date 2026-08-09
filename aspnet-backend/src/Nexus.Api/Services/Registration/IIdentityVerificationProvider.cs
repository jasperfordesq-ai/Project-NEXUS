// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Result of creating a verification session with a provider.
/// </summary>
public record VerificationSessionResult
{
    /// <summary>External session ID from the provider.</summary>
    public string ExternalSessionId { get; init; } = string.Empty;

    /// <summary>URL to redirect the user to (for hosted verification flows).</summary>
    public string? RedirectUrl { get; init; }

    /// <summary>SDK token for embedded verification flows (e.g. Veriff, Jumio).</summary>
    public string? SdkToken { get; init; }

    /// <summary>When this session expires.</summary>
    public DateTime ExpiresAt { get; init; }
}

/// <summary>
/// Result of checking verification status or processing a webhook.
/// </summary>
public record VerificationStatusResult
{
    public VerificationSessionStatus Status { get; init; }
    public string? Decision { get; init; }
    public string? DecisionReason { get; init; }
    public double? ConfidenceScore { get; init; }

    /// <summary>External session ID from the provider webhook, used to match against stored sessions.</summary>
    public string? ExternalSessionId { get; init; }
}

/// <summary>
/// Data for webhook signature verification.
/// </summary>
public record WebhookPayload
{
    public string RawBody { get; init; } = string.Empty;
    public Dictionary<string, string> Headers { get; init; } = new();
}

/// <summary>
/// Adapter interface for identity verification providers.
/// Each provider (Veriff, Jumio, Persona, etc.) implements this interface.
/// Provider-specific logic is fully encapsulated behind this abstraction.
/// </summary>
public interface IIdentityVerificationProvider
{
    /// <summary>The provider type this adapter handles.</summary>
    VerificationProvider ProviderType { get; }

    /// <summary>Human-readable provider name.</summary>
    string DisplayName { get; }

    /// <summary>
    /// Creates a new verification session with the provider.
    /// </summary>
    /// <param name="userId">Internal user ID.</param>
    /// <param name="tenantId">Tenant ID for isolation.</param>
    /// <param name="level">Required verification level.</param>
    /// <param name="callbackUrl">Webhook callback URL for this session.</param>
    /// <param name="providerConfig">Decrypted provider configuration (API keys, etc.).</param>
    Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig);

    /// <summary>
    /// Checks the current status of a verification session.
    /// </summary>
    Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig);

    /// <summary>
    /// Processes a webhook callback from the provider.
    /// Returns null if the webhook is not valid or not for this provider.
    /// </summary>
    Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig);

    /// <summary>
    /// Verifies the webhook signature to ensure authenticity.
    /// </summary>
    bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig);
}
