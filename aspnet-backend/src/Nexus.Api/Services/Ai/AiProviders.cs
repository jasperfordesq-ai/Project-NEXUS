// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 69 — concrete IAiProvider implementations.
 *
 *   - OllamaAiProvider   : wraps the existing ILlamaClient (backwards-compat).
 *   - AnthropicAiProvider: Claude Messages API (https://api.anthropic.com).
 *   - OpenAiAiProvider   : Chat Completions (https://api.openai.com/v1).
 *   - GeminiAiProvider   : Generative Language API (https://generativelanguage.googleapis.com).
 *
 * Selection: <c>Ai:Provider</c> in config. "ollama" (default) | "anthropic"
 * | "openai" | "gemini". Each provider reads its own credential block:
 *   Ai:Anthropic:ApiKey, :Model
 *   Ai:OpenAI:ApiKey, :Model
 *   Ai:Gemini:ApiKey, :Model
 */

using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nexus.Api.Clients;
using Nexus.Api.Configuration;

namespace Nexus.Api.Services.Ai;

internal static class AiProviderJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

// ─── Ollama (existing, kept for parity) ──────────────────────────────────────

public class OllamaAiProvider : IAiProvider
{
    private readonly ILlamaClient _client;
    private readonly LlamaServiceOptions _options;
    private readonly ILogger<OllamaAiProvider> _logger;

    public OllamaAiProvider(ILlamaClient client, IOptions<LlamaServiceOptions> options, ILogger<OllamaAiProvider> logger)
    {
        _client = client;
        _options = options.Value;
        _logger = logger;
    }

    public string Name => "ollama";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_options.Model);

    public async Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct = default)
    {
        var messages = new List<OllamaChatMessage>
        {
            new("system", systemPrompt),
            new("user", userPrompt)
        };
        var request = new OllamaChatRequest(_options.Model, messages, false);
        try
        {
            var response = await _client.ChatAsync(request, ct);
            return response.Message?.Content ?? string.Empty;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Ollama provider failed");
            throw new AiProviderException(Name, "ollama_send_failed", ex);
        }
    }
}

// ─── Anthropic Claude ────────────────────────────────────────────────────────

public class AnthropicAiProvider : IAiProvider
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<AnthropicAiProvider> _logger;

    public AnthropicAiProvider(IHttpClientFactory httpFactory, IConfiguration config, ILogger<AnthropicAiProvider> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    public string Name => "anthropic";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Ai:Anthropic:ApiKey"]);

    public async Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct = default)
    {
        var apiKey = _config["Ai:Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new AiProviderException(Name, "anthropic_api_key_missing");

        var model = _config["Ai:Anthropic:Model"] ?? "claude-3-5-sonnet-latest";
        var maxTokens = int.TryParse(_config["Ai:Anthropic:MaxTokens"], out var mt) ? mt : 1024;

        // POST /v1/messages
        var payload = new
        {
            model,
            max_tokens = maxTokens,
            system = systemPrompt,
            messages = new[] { new { role = "user", content = userPrompt } }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        req.Content = JsonContent.Create(payload, options: AiProviderJson.Options);
        req.Headers.TryAddWithoutValidation("x-api-key", apiKey);
        req.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");

        var client = _httpFactory.CreateClient("NexusAiProvider");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new AiProviderException(Name, $"anthropic_http_{(int)resp.StatusCode}");

            using var doc = JsonDocument.Parse(body);
            // Response shape: { "content": [ { "type":"text", "text":"..." } ], ... }
            if (doc.RootElement.TryGetProperty("content", out var content) &&
                content.ValueKind == JsonValueKind.Array)
            {
                foreach (var part in content.EnumerateArray())
                {
                    if (part.TryGetProperty("type", out var typeEl) &&
                        typeEl.GetString() == "text" &&
                        part.TryGetProperty("text", out var textEl))
                    {
                        return textEl.GetString() ?? string.Empty;
                    }
                }
            }
            return string.Empty;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "Anthropic provider failed");
            throw new AiProviderException(Name, "anthropic_send_failed", ex);
        }
    }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

public class OpenAiAiProvider : IAiProvider
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<OpenAiAiProvider> _logger;

    public OpenAiAiProvider(IHttpClientFactory httpFactory, IConfiguration config, ILogger<OpenAiAiProvider> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    public string Name => "openai";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Ai:OpenAI:ApiKey"]);

    public async Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct = default)
    {
        var apiKey = _config["Ai:OpenAI:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new AiProviderException(Name, "openai_api_key_missing");

        var model = _config["Ai:OpenAI:Model"] ?? "gpt-4o-mini";

        var payload = new
        {
            model,
            messages = new object[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userPrompt }
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Content = JsonContent.Create(payload, options: AiProviderJson.Options);
        req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");

        var client = _httpFactory.CreateClient("NexusAiProvider");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new AiProviderException(Name, $"openai_http_{(int)resp.StatusCode}");

            using var doc = JsonDocument.Parse(body);
            // { "choices": [ { "message": { "content": "..." } } ] }
            if (doc.RootElement.TryGetProperty("choices", out var choices) &&
                choices.ValueKind == JsonValueKind.Array &&
                choices.GetArrayLength() > 0)
            {
                var first = choices[0];
                if (first.TryGetProperty("message", out var msg) &&
                    msg.TryGetProperty("content", out var contentEl))
                {
                    return contentEl.GetString() ?? string.Empty;
                }
            }
            return string.Empty;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "OpenAI provider failed");
            throw new AiProviderException(Name, "openai_send_failed", ex);
        }
    }
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

public class GeminiAiProvider : IAiProvider
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<GeminiAiProvider> _logger;

    public GeminiAiProvider(IHttpClientFactory httpFactory, IConfiguration config, ILogger<GeminiAiProvider> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    public string Name => "gemini";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Ai:Gemini:ApiKey"]);

    public async Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct = default)
    {
        var apiKey = _config["Ai:Gemini:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new AiProviderException(Name, "gemini_api_key_missing");

        var model = _config["Ai:Gemini:Model"] ?? "gemini-1.5-flash-latest";

        // Gemini puts the API key in the URL.
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={Uri.EscapeDataString(apiKey)}";

        // Gemini uses an unconventional shape: contents[].parts[].text + system_instruction.
        var payload = new
        {
            system_instruction = new { parts = new[] { new { text = systemPrompt } } },
            contents = new[]
            {
                new { role = "user", parts = new[] { new { text = userPrompt } } }
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = JsonContent.Create(payload, options: AiProviderJson.Options);

        var client = _httpFactory.CreateClient("NexusAiProvider");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new AiProviderException(Name, $"gemini_http_{(int)resp.StatusCode}");

            using var doc = JsonDocument.Parse(body);
            // { "candidates": [ { "content": { "parts": [ { "text":"..." } ] } } ] }
            if (doc.RootElement.TryGetProperty("candidates", out var candidates) &&
                candidates.ValueKind == JsonValueKind.Array &&
                candidates.GetArrayLength() > 0)
            {
                var first = candidates[0];
                if (first.TryGetProperty("content", out var content) &&
                    content.TryGetProperty("parts", out var parts) &&
                    parts.ValueKind == JsonValueKind.Array &&
                    parts.GetArrayLength() > 0)
                {
                    var textPart = parts[0];
                    if (textPart.TryGetProperty("text", out var textEl))
                        return textEl.GetString() ?? string.Empty;
                }
            }
            return string.Empty;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "Gemini provider failed");
            throw new AiProviderException(Name, "gemini_send_failed", ex);
        }
    }
}

// ─── Null fallback (returns safe defaults, never throws) ─────────────────────

/// <summary>
/// Safety-net provider used when Ollama is unavailable and no paid provider
/// has been configured. Returns benign defaults instead of throwing, so AI
/// features degrade gracefully rather than crashing user-facing requests.
/// Gated by <c>Ai:NullFallbackEnabled</c> (default true).
/// </summary>
public class NullAiProvider : IAiProvider
{
    public string Name => "null";
    public bool IsConfigured => true;

    public Task<string> ChatAsync(string systemPrompt, string userPrompt, CancellationToken ct = default)
        => Task.FromResult("AI service unavailable");
}

// ─── Factory ─────────────────────────────────────────────────────────────────

public class AiProviderFactory : IAiProviderFactory
{
    private static readonly string[] PaidProviders = { "anthropic", "openai", "gemini" };

    private readonly IConfiguration _config;
    private readonly ILogger<AiProviderFactory> _logger;
    private readonly IReadOnlyList<IAiProvider> _all;
    private readonly NullAiProvider _nullProvider;
    private bool _nullFallbackLogged;

    public AiProviderFactory(
        IConfiguration config,
        ILogger<AiProviderFactory> logger,
        OllamaAiProvider ollama,
        AnthropicAiProvider anthropic,
        OpenAiAiProvider openai,
        GeminiAiProvider gemini,
        NullAiProvider nullProvider)
    {
        _config = config;
        _logger = logger;
        _all = new IAiProvider[] { ollama, anthropic, openai, gemini };
        _nullProvider = nullProvider;
    }

    public IReadOnlyList<IAiProvider> All => _all;

    public IAiProvider Resolve()
    {
        var requested = (_config["Ai:Provider"] ?? "ollama").ToLowerInvariant();
        var match = _all.FirstOrDefault(p => string.Equals(p.Name, requested, StringComparison.OrdinalIgnoreCase));

        // If a paid provider was explicitly requested, return it as-is.
        // Misconfiguration must surface (silent fallback could mask billing).
        if (PaidProviders.Contains(requested))
        {
            return match ?? _all.First(p => p.Name == "ollama");
        }

        if (match != null && match.IsConfigured) return match;

        // Default Ollama path: if unconfigured and null-fallback is enabled,
        // return NullAiProvider so callers degrade gracefully rather than
        // throwing AiProviderException on every AI request.
        var nullFallbackEnabled = _config.GetValue<bool?>("Ai:NullFallbackEnabled") ?? true;
        var ollamaProvider = _all.First(p => p.Name == "ollama");
        if (!ollamaProvider.IsConfigured && nullFallbackEnabled)
        {
            if (!_nullFallbackLogged)
            {
                _logger.LogInformation("Ollama not configured; using NullAiProvider fallback (Ai:NullFallbackEnabled=true). AI features will return safe defaults.");
                _nullFallbackLogged = true;
            }
            return _nullProvider;
        }

        return match ?? ollamaProvider;
    }
}
