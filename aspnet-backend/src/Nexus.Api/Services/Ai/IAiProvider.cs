// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Phase 69 — provider-agnostic AI abstraction. The pre-existing AiService
/// hard-coded the Ollama client; this interface lets us swap in Anthropic /
/// OpenAI / Gemini / etc. without touching prompt logic.
///
/// Implementations should be DI-singleton or DI-scoped; the factory picks one
/// per request based on the configured <c>Ai:Provider</c> key.
/// </summary>
public interface IAiProvider
{
    /// <summary>Identifier reported in logs and the /api/ai/status endpoint.</summary>
    string Name { get; }

    /// <summary>True if the provider has its credentials / endpoints configured.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Send a system prompt + user prompt to the provider and return the raw
    /// text response. May throw <see cref="AiProviderException"/> on transport
    /// failure; callers should treat that as a degraded path.
    /// </summary>
    Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct = default);
}

/// <summary>Picks the active provider based on <c>Ai:Provider</c> config.</summary>
public interface IAiProviderFactory
{
    IAiProvider Resolve();
    IReadOnlyList<IAiProvider> All { get; }
}

public class AiProviderException : Exception
{
    public string ProviderName { get; }
    public AiProviderException(string providerName, string message, Exception? inner = null)
        : base(message, inner) { ProviderName = providerName; }
}
