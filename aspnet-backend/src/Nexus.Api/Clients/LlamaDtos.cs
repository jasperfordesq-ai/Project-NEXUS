// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;

namespace Nexus.Api.Clients;

// ============================================================================
// Ollama Request DTOs
// ============================================================================

/// <summary>
/// Request to Ollama /api/chat endpoint.
/// </summary>
public record OllamaChatRequest(
    [property: JsonPropertyName("model")] string Model,
    [property: JsonPropertyName("messages")] List<OllamaChatMessage> Messages,
    [property: JsonPropertyName("stream")] bool Stream = false
);

/// <summary>
/// A single message in an Ollama chat request/response.
/// </summary>
public record OllamaChatMessage(
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("content")] string Content
);

/// <summary>
/// Request to Ollama /api/embeddings endpoint.
/// </summary>
public record OllamaEmbeddingRequest(
    [property: JsonPropertyName("model")] string Model,
    [property: JsonPropertyName("prompt")] string Prompt
);

// ============================================================================
// Ollama Response DTOs
// ============================================================================

/// <summary>
/// Response from Ollama /api/chat endpoint.
/// </summary>
public record OllamaChatResponse(
    [property: JsonPropertyName("model")] string Model,
    [property: JsonPropertyName("message")] OllamaChatMessage Message,
    [property: JsonPropertyName("done")] bool Done,
    [property: JsonPropertyName("total_duration")] long TotalDuration,
    [property: JsonPropertyName("eval_count")] int EvalCount
);

/// <summary>
/// Response from Ollama /api/embeddings endpoint.
/// </summary>
public record OllamaEmbeddingResponse(
    [property: JsonPropertyName("embedding")] float[] Embedding
);

/// <summary>
/// Response from Ollama /api/tags endpoint (list models).
/// </summary>
public record OllamaTagsResponse(
    [property: JsonPropertyName("models")] List<OllamaModel> Models
);

/// <summary>
/// Model information from Ollama.
/// </summary>
public record OllamaModel(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("size")] long Size,
    [property: JsonPropertyName("digest")] string Digest
);
