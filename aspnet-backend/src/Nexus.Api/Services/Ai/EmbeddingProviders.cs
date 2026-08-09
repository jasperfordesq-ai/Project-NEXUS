// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Nexus.Api.Clients;

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Embeds text via the local Ollama service (wraps <see cref="ILlamaClient"/>).
/// Used in dev and as the default fallback in production.
/// </summary>
public class OllamaEmbeddingProvider : IEmbeddingProvider
{
    private readonly ILlamaClient _client;
    private readonly IConfiguration _config;
    private readonly ILogger<OllamaEmbeddingProvider> _logger;

    public OllamaEmbeddingProvider(ILlamaClient client, IConfiguration config, ILogger<OllamaEmbeddingProvider> logger)
    {
        _client = client;
        _config = config;
        _logger = logger;
    }

    public string Name => "ollama";
    public string Model => _config["Ai:Embedding:Ollama:Model"] ?? "nomic-embed-text";
    public int Dimensions => _config.GetValue<int?>("Ai:Embedding:Ollama:Dimensions") ?? 768;
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Llama:BaseUrl"]);

    public async Task<float[]> EmbedAsync(string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return Array.Empty<float>();
        try
        {
            var resp = await _client.EmbedAsync(new OllamaEmbeddingRequest(Model, text), ct);
            return resp.Embedding ?? Array.Empty<float>();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Ollama embedding failed");
            return Array.Empty<float>();
        }
    }

    public async Task<IReadOnlyList<float[]>> EmbedBatchAsync(IReadOnlyList<string> texts, CancellationToken ct = default)
    {
        var results = new List<float[]>(texts.Count);
        foreach (var t in texts)
        {
            ct.ThrowIfCancellationRequested();
            results.Add(await EmbedAsync(t, ct));
        }
        return results;
    }
}

/// <summary>
/// Embeds text via the OpenAI Embeddings API.
/// </summary>
public class OpenAiEmbeddingProvider : IEmbeddingProvider
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<OpenAiEmbeddingProvider> _logger;

    private const string EndpointUrl = "https://api.openai.com/v1/embeddings";
    private const int BatchSize = 96;

    public OpenAiEmbeddingProvider(IHttpClientFactory httpFactory, IConfiguration config, ILogger<OpenAiEmbeddingProvider> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    public string Name => "openai";
    public string Model => _config["Ai:Embedding:OpenAI:Model"] ?? "text-embedding-3-small";
    public int Dimensions => _config.GetValue<int?>("Ai:Embedding:OpenAI:Dimensions") ?? 1536;
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Ai:OpenAI:ApiKey"]);

    public async Task<float[]> EmbedAsync(string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return Array.Empty<float>();
        var batch = await EmbedBatchAsync(new[] { text }, ct);
        return batch.Count > 0 ? batch[0] : Array.Empty<float>();
    }

    public async Task<IReadOnlyList<float[]>> EmbedBatchAsync(IReadOnlyList<string> texts, CancellationToken ct = default)
    {
        if (texts.Count == 0) return Array.Empty<float[]>();
        if (!IsConfigured)
        {
            _logger.LogWarning("OpenAI embedding API key not configured; returning empty vectors");
            return texts.Select(_ => Array.Empty<float>()).ToList();
        }

        var apiKey = _config["Ai:OpenAI:ApiKey"];
        var results = new List<float[]>(texts.Count);
        var http = _httpFactory.CreateClient("NexusAiProvider");

        for (var offset = 0; offset < texts.Count; offset += BatchSize)
        {
            ct.ThrowIfCancellationRequested();
            var slice = texts.Skip(offset).Take(BatchSize).ToArray();
            var payload = new { model = Model, input = slice };

            using var req = new HttpRequestMessage(HttpMethod.Post, EndpointUrl);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            req.Content = JsonContent.Create(payload);

            try
            {
                using var resp = await http.SendAsync(req, ct);
                if (!resp.IsSuccessStatusCode)
                {
                    var err = await resp.Content.ReadAsStringAsync(ct);
                    _logger.LogWarning("OpenAI embedding non-success {Status}: {Body}", resp.StatusCode, err);
                    foreach (var _ in slice) results.Add(Array.Empty<float>());
                    continue;
                }
                using var doc = await resp.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: ct);
                if (doc == null) { foreach (var _ in slice) results.Add(Array.Empty<float>()); continue; }
                var data = doc.RootElement.GetProperty("data");
                foreach (var item in data.EnumerateArray())
                {
                    var arr = item.GetProperty("embedding");
                    var vec = new float[arr.GetArrayLength()];
                    var i = 0;
                    foreach (var v in arr.EnumerateArray()) vec[i++] = v.GetSingle();
                    results.Add(vec);
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
            {
                _logger.LogWarning(ex, "OpenAI embedding call failed");
                foreach (var _ in slice) results.Add(Array.Empty<float>());
            }
        }

        return results;
    }
}

/// <summary>
/// Reads <c>Ai:Embedding:Provider</c> and returns the matching provider.
/// Defaults to Ollama when unset.
/// </summary>
public class EmbeddingProviderFactory : IEmbeddingProviderFactory
{
    private readonly IServiceProvider _services;
    private readonly IConfiguration _config;

    public EmbeddingProviderFactory(IServiceProvider services, IConfiguration config)
    {
        _services = services;
        _config = config;
    }

    public IEmbeddingProvider Resolve()
    {
        var selected = (_config["Ai:Embedding:Provider"] ?? "ollama").Trim().ToLowerInvariant();
        return selected switch
        {
            "openai" => (IEmbeddingProvider)_services.GetService(typeof(OpenAiEmbeddingProvider))!,
            _ => (IEmbeddingProvider)_services.GetService(typeof(OllamaEmbeddingProvider))!
        };
    }
}
