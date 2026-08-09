// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Nexus.Api.Services;

/// <summary>
/// Verifies Cloudflare Turnstile challenge tokens against siteverify.
///
/// Behaviour mirrors the V1 PHP TurnstileService:
///   - When Turnstile:SecretKey is unset OR equals the always-passes test
///     key 1x0000000000000000000000000000000AA, verification is skipped
///     (returns true) so dev/CI keeps working.
///   - On network error, non-2xx, malformed response, or success=false,
///     returns false and logs the failure mode at Information level.
///   - 4-second hard timeout via HttpClient registration.
/// </summary>
public interface ITurnstileVerifier
{
    Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default);
}

public class TurnstileVerifier : ITurnstileVerifier
{
    private const string SiteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    private const string TestPassSecret = "1x0000000000000000000000000000000AA";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<TurnstileVerifier> _logger;

    public TurnstileVerifier(HttpClient http, IConfiguration config, ILogger<TurnstileVerifier> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    public async Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default)
    {
        var secret = _config["Turnstile:SecretKey"] ?? string.Empty;

        if (string.IsNullOrEmpty(secret) || secret == TestPassSecret)
        {
            _logger.LogDebug("turnstile.skipped reason={Reason}",
                string.IsNullOrEmpty(secret) ? "unset" : "test_pass_key");
            return true;
        }

        if (string.IsNullOrWhiteSpace(token))
        {
            _logger.LogInformation("turnstile.missing_token");
            return false;
        }

        var form = new List<KeyValuePair<string, string>>
        {
            new("secret", secret),
            new("response", token),
        };
        if (!string.IsNullOrEmpty(remoteIp))
            form.Add(new("remoteip", remoteIp));

        try
        {
            using var response = await _http.PostAsync(SiteverifyUrl, new FormUrlEncodedContent(form), ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogInformation("turnstile.http_error status={Status}", (int)response.StatusCode);
                return false;
            }

            var body = await response.Content.ReadFromJsonAsync<SiteverifyResponse>(cancellationToken: ct);

            if (body == null || !body.Success)
            {
                _logger.LogInformation("turnstile.rejected errors={Errors} hostname={Hostname}",
                    body?.ErrorCodes == null ? "[]" : string.Join(",", body.ErrorCodes),
                    body?.Hostname);
                return false;
            }

            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogInformation(ex, "turnstile.network_error");
            return false;
        }
    }

    private sealed class SiteverifyResponse
    {
        [JsonPropertyName("success")]
        public bool Success { get; init; }

        [JsonPropertyName("error-codes")]
        public string[]? ErrorCodes { get; init; }

        [JsonPropertyName("hostname")]
        public string? Hostname { get; init; }
    }
}
