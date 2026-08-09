// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Nexus.Api.Services.Ai;

// ─── OpenAI Chat Completions with function calling ──────────────────────────

public class OpenAiToolClient : IPlatformToolClient
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<OpenAiToolClient> _logger;

    public OpenAiToolClient(IHttpClientFactory httpFactory, IConfiguration config, ILogger<OpenAiToolClient> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    public string Name => "openai";
    public string Model => _config["Ai:OpenAI:Model"] ?? "gpt-4o-mini";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Ai:OpenAI:ApiKey"]);
    public bool SupportsTools => true;

    public async Task<AiChatResult> ChatAsync(IReadOnlyList<AiTurn> turns, IReadOnlyList<AiToolDefinition> tools, CancellationToken ct = default)
    {
        var apiKey = _config["Ai:OpenAI:ApiKey"];
        var http = _httpFactory.CreateClient("NexusAiProvider");

        // Build messages array.
        var messages = new List<object>();
        foreach (var turn in turns)
        {
            if (turn.Role == "tool_results" && turn.ToolResults != null)
            {
                // OpenAI requires one "tool" role message per tool result.
                foreach (var r in turn.ToolResults)
                    messages.Add(new { role = "tool", tool_call_id = r.CallId, content = r.ResultJson });
                continue;
            }
            if (turn.Role == "assistant" && turn.ToolCalls != null && turn.ToolCalls.Count > 0)
            {
                messages.Add(new
                {
                    role = "assistant",
                    content = turn.Content,
                    tool_calls = turn.ToolCalls.Select(c => new
                    {
                        id = c.CallId,
                        type = "function",
                        function = new { name = c.Name, arguments = c.ArgumentsJson }
                    }).ToArray()
                });
                continue;
            }
            messages.Add(new { role = turn.Role, content = turn.Content ?? string.Empty });
        }

        var toolDefs = tools.Select(t => new
        {
            type = "function",
            function = new { name = t.Name, description = t.Description, parameters = t.ParametersSchema }
        }).ToArray();

        var body = new
        {
            model = Model,
            messages,
            tools = toolDefs.Length > 0 ? toolDefs : null,
            tool_choice = toolDefs.Length > 0 ? "auto" : null
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        req.Content = JsonContent.Create(body, options: new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        });

        try
        {
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("OpenAI tool chat non-success {Status}: {Body}", resp.StatusCode, err);
                throw new AiProviderException(Name, $"openai_status_{(int)resp.StatusCode}");
            }
            using var doc = await resp.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: ct);
            if (doc == null) throw new AiProviderException(Name, "openai_empty_response");

            var choice = doc.RootElement.GetProperty("choices")[0].GetProperty("message");
            string? content = choice.TryGetProperty("content", out var cEl) && cEl.ValueKind == JsonValueKind.String ? cEl.GetString() : null;
            var toolCalls = new List<AiToolCall>();
            if (choice.TryGetProperty("tool_calls", out var tcEl) && tcEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var tc in tcEl.EnumerateArray())
                {
                    var id = tc.GetProperty("id").GetString() ?? Guid.NewGuid().ToString("N");
                    var fn = tc.GetProperty("function");
                    var name = fn.GetProperty("name").GetString() ?? string.Empty;
                    var args = fn.TryGetProperty("arguments", out var argEl) ? (argEl.GetString() ?? "{}") : "{}";
                    toolCalls.Add(new AiToolCall(id, name, args));
                }
            }

            var usage = doc.RootElement.TryGetProperty("usage", out var uEl) ? uEl : default;
            var inTokens = usage.ValueKind == JsonValueKind.Object && usage.TryGetProperty("prompt_tokens", out var ipt) ? ipt.GetInt32() : 0;
            var outTokens = usage.ValueKind == JsonValueKind.Object && usage.TryGetProperty("completion_tokens", out var opt) ? opt.GetInt32() : 0;

            return new AiChatResult(content, toolCalls, inTokens, outTokens, Name, Model);
        }
        catch (AiProviderException) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            _logger.LogWarning(ex, "OpenAI tool chat failed");
            throw new AiProviderException(Name, "openai_send_failed", ex);
        }
    }
}

// ─── Anthropic Claude Messages API with tool use ────────────────────────────

public class AnthropicToolClient : IPlatformToolClient
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<AnthropicToolClient> _logger;

    public AnthropicToolClient(IHttpClientFactory httpFactory, IConfiguration config, ILogger<AnthropicToolClient> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    public string Name => "anthropic";
    public string Model => _config["Ai:Anthropic:Model"] ?? "claude-3-5-sonnet-20241022";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Ai:Anthropic:ApiKey"]);
    public bool SupportsTools => true;

    public async Task<AiChatResult> ChatAsync(IReadOnlyList<AiTurn> turns, IReadOnlyList<AiToolDefinition> tools, CancellationToken ct = default)
    {
        var apiKey = _config["Ai:Anthropic:ApiKey"];
        var http = _httpFactory.CreateClient("NexusAiProvider");

        // Anthropic takes a top-level "system" string + messages array
        // (user / assistant). Tool results are user-role messages with
        // tool_result content blocks.
        var systemParts = turns.Where(t => t.Role == "system").Select(t => t.Content ?? string.Empty).ToList();
        var systemPrompt = string.Join("\n\n", systemParts);

        var messages = new List<object>();
        foreach (var turn in turns)
        {
            if (turn.Role == "system") continue;

            if (turn.Role == "tool_results" && turn.ToolResults != null)
            {
                var blocks = turn.ToolResults.Select(r => new
                {
                    type = "tool_result",
                    tool_use_id = r.CallId,
                    content = r.ResultJson,
                    is_error = r.IsError
                }).Cast<object>().ToArray();
                messages.Add(new { role = "user", content = blocks });
                continue;
            }

            if (turn.Role == "assistant" && turn.ToolCalls != null && turn.ToolCalls.Count > 0)
            {
                var blocks = new List<object>();
                if (!string.IsNullOrEmpty(turn.Content))
                    blocks.Add(new { type = "text", text = turn.Content });
                foreach (var c in turn.ToolCalls)
                {
                    JsonElement input;
                    try
                    {
                        using var d = JsonDocument.Parse(string.IsNullOrWhiteSpace(c.ArgumentsJson) ? "{}" : c.ArgumentsJson);
                        input = d.RootElement.Clone();
                    }
                    catch (JsonException) { input = JsonDocument.Parse("{}").RootElement.Clone(); }
                    blocks.Add(new { type = "tool_use", id = c.CallId, name = c.Name, input });
                }
                messages.Add(new { role = "assistant", content = blocks });
                continue;
            }

            // Plain user/assistant text.
            messages.Add(new { role = turn.Role, content = turn.Content ?? string.Empty });
        }

        var toolDefs = tools.Select(t => new { name = t.Name, description = t.Description, input_schema = t.ParametersSchema }).ToArray();
        var body = new
        {
            model = Model,
            max_tokens = 1024,
            system = string.IsNullOrEmpty(systemPrompt) ? null : systemPrompt,
            messages,
            tools = toolDefs.Length > 0 ? toolDefs : null
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        req.Headers.Add("x-api-key", apiKey);
        req.Headers.Add("anthropic-version", "2023-06-01");
        req.Content = JsonContent.Create(body, options: new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        });

        try
        {
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("Anthropic tool chat non-success {Status}: {Body}", resp.StatusCode, err);
                throw new AiProviderException(Name, $"anthropic_status_{(int)resp.StatusCode}");
            }
            using var doc = await resp.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: ct);
            if (doc == null) throw new AiProviderException(Name, "anthropic_empty_response");

            var root = doc.RootElement;
            string? text = null;
            var toolCalls = new List<AiToolCall>();
            if (root.TryGetProperty("content", out var contentEl) && contentEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var block in contentEl.EnumerateArray())
                {
                    var type = block.TryGetProperty("type", out var tEl) ? tEl.GetString() : null;
                    if (type == "text") text = (text ?? string.Empty) + (block.GetProperty("text").GetString() ?? string.Empty);
                    else if (type == "tool_use")
                    {
                        var id = block.GetProperty("id").GetString() ?? Guid.NewGuid().ToString("N");
                        var name = block.GetProperty("name").GetString() ?? string.Empty;
                        var argsJson = block.TryGetProperty("input", out var iEl) ? iEl.GetRawText() : "{}";
                        toolCalls.Add(new AiToolCall(id, name, argsJson));
                    }
                }
            }

            var usage = root.TryGetProperty("usage", out var uEl) ? uEl : default;
            var inTokens = usage.ValueKind == JsonValueKind.Object && usage.TryGetProperty("input_tokens", out var it) ? it.GetInt32() : 0;
            var outTokens = usage.ValueKind == JsonValueKind.Object && usage.TryGetProperty("output_tokens", out var ot) ? ot.GetInt32() : 0;

            return new AiChatResult(text, toolCalls, inTokens, outTokens, Name, Model);
        }
        catch (AiProviderException) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            _logger.LogWarning(ex, "Anthropic tool chat failed");
            throw new AiProviderException(Name, "anthropic_send_failed", ex);
        }
    }
}

// ─── Fallback (no native tool support) ──────────────────────────────────────

/// <summary>
/// Used when no tool-capable provider is configured. Flattens the turn list
/// to a single system/user pair, delegates to the standard
/// <see cref="IAiProvider"/>, and returns a text-only result with no tool
/// calls. The orchestrator still works — it just never tool-loops.
/// </summary>
public class FallbackPlatformToolClient : IPlatformToolClient
{
    private readonly IAiProviderFactory _providerFactory;
    private readonly ILogger<FallbackPlatformToolClient> _logger;

    public FallbackPlatformToolClient(IAiProviderFactory providerFactory, ILogger<FallbackPlatformToolClient> logger)
    {
        _providerFactory = providerFactory;
        _logger = logger;
    }

    public string Name => $"fallback({_providerFactory.Resolve().Name})";
    public string Model => "n/a";
    public bool IsConfigured => _providerFactory.Resolve().IsConfigured;
    public bool SupportsTools => false;

    public async Task<AiChatResult> ChatAsync(IReadOnlyList<AiTurn> turns, IReadOnlyList<AiToolDefinition> tools, CancellationToken ct = default)
    {
        var provider = _providerFactory.Resolve();
        var systemParts = turns.Where(t => t.Role == "system").Select(t => t.Content ?? string.Empty);
        var system = string.Join("\n\n", systemParts);
        var userParts = turns.Where(t => t.Role == "user" || t.Role == "assistant")
            .Select(t => $"[{t.Role}] {t.Content}");
        var user = string.Join("\n\n", userParts);
        try
        {
            var reply = await provider.ChatAsync(system, user, ct);
            return new AiChatResult(reply, Array.Empty<AiToolCall>(), 0, 0, Name, provider.Name);
        }
        catch (AiProviderException) { throw; }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Fallback tool client failed");
            throw new AiProviderException(Name, "fallback_failed", ex);
        }
    }
}

// ─── Factory ────────────────────────────────────────────────────────────────

public class PlatformToolClientFactory : IPlatformToolClientFactory
{
    private readonly IServiceProvider _services;
    private readonly IConfiguration _config;

    public PlatformToolClientFactory(IServiceProvider services, IConfiguration config)
    {
        _services = services;
        _config = config;
    }

    public IPlatformToolClient Resolve()
    {
        var selected = (_config["Ai:Provider"] ?? string.Empty).Trim().ToLowerInvariant();

        IPlatformToolClient? candidate = selected switch
        {
            "anthropic" => (IPlatformToolClient)_services.GetService(typeof(AnthropicToolClient))!,
            "openai" => (IPlatformToolClient)_services.GetService(typeof(OpenAiToolClient))!,
            _ => null
        };
        if (candidate != null && candidate.IsConfigured) return candidate;

        // If the selected provider isn't tool-capable or unconfigured, prefer
        // any other configured tool-capable client.
        var anthropic = (AnthropicToolClient)_services.GetService(typeof(AnthropicToolClient))!;
        if (anthropic.IsConfigured) return anthropic;
        var openai = (OpenAiToolClient)_services.GetService(typeof(OpenAiToolClient))!;
        if (openai.IsConfigured) return openai;

        return (FallbackPlatformToolClient)_services.GetService(typeof(FallbackPlatformToolClient))!;
    }
}
