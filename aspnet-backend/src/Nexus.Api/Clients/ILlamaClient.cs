// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Clients;

/// <summary>
/// Client interface for interacting with the Ollama Llama service.
/// </summary>
public interface ILlamaClient
{
    /// <summary>
    /// Send a chat completion request.
    /// </summary>
    Task<OllamaChatResponse> ChatAsync(OllamaChatRequest request, CancellationToken ct = default);

    /// <summary>
    /// Generate embeddings for the given text.
    /// </summary>
    Task<OllamaEmbeddingResponse> EmbedAsync(OllamaEmbeddingRequest request, CancellationToken ct = default);

    /// <summary>
    /// Get list of available models.
    /// </summary>
    Task<OllamaTagsResponse> GetModelsAsync(CancellationToken ct = default);

    /// <summary>
    /// Check if the Llama service is healthy and has models loaded.
    /// </summary>
    Task<bool> IsHealthyAsync(CancellationToken ct = default);
}
