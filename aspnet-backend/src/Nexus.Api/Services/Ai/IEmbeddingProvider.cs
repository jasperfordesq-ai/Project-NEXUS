// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Provider-agnostic text-embedding abstraction. Implementations wrap a
/// remote embedding API (Ollama, OpenAI, etc.) and produce a fixed-size
/// dense float vector for one or many input strings.
/// </summary>
public interface IEmbeddingProvider
{
    /// <summary>Stable identifier persisted with each chunk e.g. "ollama".</summary>
    string Name { get; }

    /// <summary>Model identifier persisted with each chunk e.g. "nomic-embed-text".</summary>
    string Model { get; }

    /// <summary>Expected length of the returned vector.</summary>
    int Dimensions { get; }

    /// <summary>True if the provider has credentials / endpoint configured.</summary>
    bool IsConfigured { get; }

    /// <summary>Embed a single string. Returns an empty array on transport failure.</summary>
    Task<float[]> EmbedAsync(string text, CancellationToken ct = default);

    /// <summary>Embed many strings. Implementations may batch; order preserved.</summary>
    Task<IReadOnlyList<float[]>> EmbedBatchAsync(IReadOnlyList<string> texts, CancellationToken ct = default);
}

/// <summary>Picks the active embedding provider based on <c>Ai:Embedding:Provider</c>.</summary>
public interface IEmbeddingProviderFactory
{
    IEmbeddingProvider Resolve();
}
