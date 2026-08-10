// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Nexus.Api.Services;

public sealed class CaringHelpRequestVoiceProcessor : ICaringHelpRequestVoiceProcessor
{
    private static readonly HashSet<string> Categories = new(StringComparer.Ordinal)
    {
        "transport",
        "shopping",
        "companionship",
        "household",
        "technology",
        "other"
    };

    private static readonly HashSet<string> ContactPreferences = new(StringComparer.Ordinal)
    {
        "phone",
        "message",
        "either"
    };

    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CaringHelpRequestVoiceProcessor> _logger;

    public CaringHelpRequestVoiceProcessor(
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger<CaringHelpRequestVoiceProcessor> logger)
    {
        _httpFactory = httpFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<MemberHelpRequestVoiceResult> ProcessAsync(
        int tenantId,
        int userId,
        Stream audio,
        string? fileName,
        string contentType,
        string locale,
        CancellationToken ct)
    {
        var apiKey = _configuration["Ai:OpenAI:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            _logger.LogWarning("Caring help request voice transcription requested without OpenAI API key");
            return MemberHelpRequestVoiceResult.Failed("TRANSCRIPTION_FAILED");
        }

        var transcript = await TranscribeAsync(apiKey, audio, fileName, contentType, ct);
        if (transcript is null || string.IsNullOrWhiteSpace(transcript.Text))
        {
            _logger.LogWarning(
                "Caring help request voice transcription failed for tenant {TenantId}, user {UserId}",
                tenantId,
                userId);
            return MemberHelpRequestVoiceResult.Failed("TRANSCRIPTION_FAILED");
        }

        var detectedLanguage = string.IsNullOrWhiteSpace(transcript.Language)
            ? locale
            : transcript.Language!;
        var extracted = await ExtractIntentAsync(apiKey, transcript.Text, detectedLanguage, ct);

        return MemberHelpRequestVoiceResult.Success(
            transcript.Text,
            detectedLanguage,
            extracted.Category,
            extracted.When,
            extracted.ContactPreference,
            extracted.RawText);
    }

    private async Task<TranscriptResult?> TranscribeAsync(
        string apiKey,
        Stream audio,
        string? fileName,
        string contentType,
        CancellationToken ct)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/audio/transcriptions");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            using var form = new MultipartFormDataContent();
            using var audioContent = new StreamContent(audio);
            if (!string.IsNullOrWhiteSpace(contentType))
            {
                audioContent.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
            }

            form.Add(audioContent, "file", SafeFileName(fileName));
            form.Add(new StringContent("whisper-1", Encoding.UTF8), "model");
            form.Add(new StringContent("verbose_json", Encoding.UTF8), "response_format");
            request.Content = form;

            using var response = await _httpFactory.CreateClient("NexusAiProvider").SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning(
                    "OpenAI transcription failed with {Status}: {Body}",
                    (int)response.StatusCode,
                    errorBody);
                return null;
            }

            await using var body = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(body, cancellationToken: ct);
            var root = document.RootElement;
            var text = root.TryGetProperty("text", out var textValue) ? textValue.GetString() : null;
            var language = root.TryGetProperty("language", out var languageValue) ? languageValue.GetString() : null;
            return new TranscriptResult(text?.Trim() ?? string.Empty, language);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OpenAI transcription request failed");
            return null;
        }
    }

    private async Task<ExtractedIntent> ExtractIntentAsync(
        string apiKey,
        string transcript,
        string locale,
        CancellationToken ct)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            request.Content = JsonContent.Create(new
            {
                model = "gpt-4o-mini",
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You extract structured intent from a community member's spoken help request. "
                                  + $"The member locale is '{locale}'. Map category to transport, shopping, companionship, household, technology, or other. "
                                  + "Return a concrete ISO-8601 datetime only when implied. Always call the function."
                    },
                    new { role = "user", content = transcript }
                },
                tools = new object[]
                {
                    new
                    {
                        type = "function",
                        function = new
                        {
                            name = "extract_help_request_intent",
                            description = "Extract the category, time, and contact preference from a help request.",
                            parameters = new
                            {
                                type = "object",
                                properties = new
                                {
                                    category = new
                                    {
                                        type = new object[] { "string", "null" },
                                        @enum = new object?[] { "transport", "shopping", "companionship", "household", "technology", "other", null }
                                    },
                                    when = new
                                    {
                                        type = new object[] { "string", "null" }
                                    },
                                    contact_preference = new
                                    {
                                        type = new object[] { "string", "null" },
                                        @enum = new object?[] { "phone", "message", "either", null }
                                    }
                                },
                                required = new[] { "category", "when", "contact_preference" },
                                additionalProperties = false
                            }
                        }
                    }
                },
                tool_choice = new
                {
                    type = "function",
                    function = new { name = "extract_help_request_intent" }
                },
                temperature = 0.1,
                max_tokens = 256
            });

            using var response = await _httpFactory.CreateClient("NexusAiProvider").SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning(
                    "OpenAI help-request intent extraction failed with {Status}: {Body}",
                    (int)response.StatusCode,
                    errorBody);
                return ExtractedIntent.Fallback(transcript);
            }

            await using var body = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(body, cancellationToken: ct);
            var root = document.RootElement;
            var arguments = root
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("tool_calls")[0]
                .GetProperty("function")
                .GetProperty("arguments")
                .GetString();

            if (string.IsNullOrWhiteSpace(arguments))
            {
                return ExtractedIntent.Fallback(transcript);
            }

            using var args = JsonDocument.Parse(arguments);
            return SanitizeIntent(args.RootElement, transcript);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OpenAI help-request intent extraction failed");
            return ExtractedIntent.Fallback(transcript);
        }
    }

    private static ExtractedIntent SanitizeIntent(JsonElement args, string transcript)
    {
        var category = args.TryGetProperty("category", out var categoryValue)
            && categoryValue.ValueKind == JsonValueKind.String
            && Categories.Contains(categoryValue.GetString() ?? string.Empty)
                ? categoryValue.GetString()
                : null;

        string? when = null;
        if (args.TryGetProperty("when", out var whenValue)
            && whenValue.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(whenValue.GetString(), out var parsed))
        {
            when = parsed.ToString("O");
        }

        var contactPreference = args.TryGetProperty("contact_preference", out var contactValue)
            && contactValue.ValueKind == JsonValueKind.String
            && ContactPreferences.Contains(contactValue.GetString() ?? string.Empty)
                ? contactValue.GetString()
                : null;

        return new ExtractedIntent(category, when, contactPreference, transcript);
    }

    private static string SafeFileName(string? fileName)
    {
        return string.IsNullOrWhiteSpace(fileName)
            ? "audio.webm"
            : Path.GetFileName(fileName);
    }

    private sealed record TranscriptResult(string Text, string? Language);

    private sealed record ExtractedIntent(
        string? Category,
        string? When,
        string? ContactPreference,
        string RawText)
    {
        public static ExtractedIntent Fallback(string transcript)
        {
            return new ExtractedIntent(null, null, null, transcript);
        }
    }
}
