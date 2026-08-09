// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Nexus.Api.Services;

public interface IPusherEventPublisher
{
    Task<bool> TriggerAsync(
        string channel,
        string eventName,
        object payload,
        CancellationToken cancellationToken = default);
}

public sealed class PusherEventPublisher : IPusherEventPublisher
{
    private readonly HttpClient _http;
    private readonly IConfiguration _configuration;
    private readonly ILogger<PusherEventPublisher> _logger;

    public PusherEventPublisher(
        HttpClient http,
        IConfiguration configuration,
        ILogger<PusherEventPublisher> logger)
    {
        _http = http;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<bool> TriggerAsync(
        string channel,
        string eventName,
        object payload,
        CancellationToken cancellationToken = default)
    {
        var appId = Value("PUSHER_APP_ID", "Pusher:AppId");
        var key = Value("PUSHER_APP_KEY", "Pusher:Key", "Pusher:AppKey");
        var secret = Value("PUSHER_APP_SECRET", "Pusher:Secret", "Pusher:AppSecret");
        if (string.IsNullOrWhiteSpace(appId)
            || string.IsNullOrWhiteSpace(key)
            || string.IsNullOrWhiteSpace(secret))
        {
            _logger.LogDebug("Pusher typing event skipped because credentials are not configured");
            return false;
        }

        var cluster = Value("PUSHER_APP_CLUSTER", "Pusher:Cluster") ?? "eu";
        var host = Value("PUSHER_API_HOST", "Pusher:ApiHost") ?? $"https://api-{cluster}.pusher.com";
        var path = $"/apps/{Uri.EscapeDataString(appId)}/events";
        var body = JsonSerializer.Serialize(new
        {
            name = eventName,
            channels = new[] { channel },
            data = JsonSerializer.Serialize(payload)
        });
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var bodyMd5 = Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        var unsigned = $"auth_key={Uri.EscapeDataString(key)}&auth_timestamp={timestamp}&auth_version=1.0&body_md5={bodyMd5}";
        var signature = Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(secret),
            Encoding.UTF8.GetBytes($"POST\n{path}\n{unsigned}"))).ToLowerInvariant();
        var url = $"{host.TrimEnd('/')}{path}?{unsigned}&auth_signature={signature}";

        try
        {
            using var content = new StringContent(body, Encoding.UTF8, "application/json");
            using var response = await _http.PostAsync(url, content, cancellationToken);
            if (response.IsSuccessStatusCode)
                return true;
            _logger.LogDebug("Pusher event returned HTTP {StatusCode}", (int)response.StatusCode);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogDebug(exception, "Pusher event delivery failed");
        }
        return false;
    }

    private string? Value(string environmentName, params string[] keys)
    {
        var environment = Environment.GetEnvironmentVariable(environmentName);
        if (!string.IsNullOrWhiteSpace(environment))
            return environment;
        return keys.Select(key => _configuration[key]).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
    }
}
