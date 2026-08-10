// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Configuration;

/// <summary>
/// Configuration options for the Llama AI service (Ollama).
/// </summary>
public class LlamaServiceOptions
{
    public const string SectionName = "LlamaService";

    /// <summary>
    /// Base URL of the Ollama service.
    /// </summary>
    public string BaseUrl { get; set; } = "http://llama-service:11434";

    /// <summary>
    /// Model to use for chat completions.
    /// </summary>
    public string Model { get; set; } = "llama3.2:3b";

    /// <summary>
    /// Request timeout in seconds.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 60;

    /// <summary>
    /// Maximum number of retry attempts for transient failures.
    /// </summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary>
    /// Number of consecutive failures before circuit breaker opens.
    /// </summary>
    public int CircuitBreakerFailures { get; set; } = 5;

    /// <summary>
    /// Duration in seconds the circuit breaker stays open.
    /// </summary>
    public int CircuitBreakerDurationSeconds { get; set; } = 30;

    /// <summary>
    /// Maximum allowed prompt length in characters.
    /// </summary>
    public int MaxPromptLength { get; set; } = 4000;

    /// <summary>
    /// Default maximum tokens for responses.
    /// </summary>
    public int DefaultMaxTokens { get; set; } = 512;
}
