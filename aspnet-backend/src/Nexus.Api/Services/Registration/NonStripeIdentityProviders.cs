// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Nexus.Api.Entities;
using static Nexus.Api.Services.Registration.IdentityProviderAdapterHelpers;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Veriff identity-verification adapter. Mirrors the Laravel provider's hosted
/// session, status polling, webhook normalization, and HMAC verification.
/// </summary>
public sealed class VeriffIdentityProvider : IIdentityVerificationProvider
{
    private const string ApiBase = "https://stationapi.veriff.com/v1";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<VeriffIdentityProvider> _logger;

    public VerificationProvider ProviderType => VerificationProvider.Veriff;
    public string DisplayName => "Veriff";

    public VeriffIdentityProvider(
        IHttpClientFactory httpClientFactory,
        ILogger<VeriffIdentityProvider> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        if (string.IsNullOrWhiteSpace(config.ApiKey))
            throw new InvalidOperationException("Veriff API key not configured.");

        using var client = _httpClientFactory.CreateClient("VeriffIdentity");
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/sessions")
        {
            Content = CreateJsonContent(new
            {
                verification = new
                {
                    callback = callbackUrl,
                    person = new
                    {
                        firstName = config.FirstName ?? string.Empty,
                        lastName = config.LastName ?? string.Empty
                    },
                    vendorData = JsonSerializer.Serialize(new
                    {
                        nexus_user_id = userId,
                        nexus_tenant_id = tenantId
                    })
                }
            })
        };
        request.Headers.TryAddWithoutValidation("X-AUTH-CLIENT", config.ApiKey);

        var root = await SendJsonAsync(client, request, "Veriff session creation");
        var verification = root.TryGetProperty("verification", out var node) ? node : root;

        return new VerificationSessionResult
        {
            ExternalSessionId = verification.GetStringOrDefault("id") ?? string.Empty,
            RedirectUrl = verification.GetStringOrDefault("url"),
            ExpiresAt = DateTime.UtcNow.AddHours(24)
        };
    }

    public async Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        if (string.IsNullOrWhiteSpace(config.ApiKey))
            throw new InvalidOperationException("Veriff API key not configured.");

        using var client = _httpClientFactory.CreateClient("VeriffIdentity");
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{ApiBase}/sessions/{Uri.EscapeDataString(externalSessionId)}/decision");
        request.Headers.TryAddWithoutValidation("X-AUTH-CLIENT", config.ApiKey);

        var root = await SendJsonAsync(client, request, "Veriff status check");
        var verification = root.TryGetProperty("verification", out var node) ? node : root;
        return MapVeriffDecision(verification, externalSessionId);
    }

    public Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig)
    {
        if (!TryParseJson(payload.RawBody, _logger, "Veriff", out var root))
            return Task.FromResult<VerificationStatusResult?>(null);

        if (!root.TryGetProperty("verification", out var verification))
            return Task.FromResult<VerificationStatusResult?>(null);

        return Task.FromResult<VerificationStatusResult?>(MapVeriffDecision(verification, verification.GetStringOrDefault("id")));
    }

    public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        var secret = config.WebhookSecret ?? config.ApiSecret;
        return VerifyHmacSha256(payload, secret, "X-HMAC-Signature");
    }

    private static VerificationStatusResult MapVeriffDecision(JsonElement verification, string? fallbackSessionId)
    {
        var decision = verification.GetStringOrDefault("status") ?? "review";
        var status = decision switch
        {
            "approved" => VerificationSessionStatus.Completed,
            "resubmission_requested" or "declined" => VerificationSessionStatus.Failed,
            "expired" or "abandoned" => VerificationSessionStatus.Expired,
            _ => VerificationSessionStatus.InProgress
        };

        return new VerificationStatusResult
        {
            ExternalSessionId = verification.GetStringOrDefault("id") ?? fallbackSessionId,
            Status = status,
            Decision = status == VerificationSessionStatus.Completed
                ? "approved"
                : status == VerificationSessionStatus.Failed
                    ? "declined"
                    : null,
            DecisionReason = verification.GetStringOrDefault("reason"),
            ConfidenceScore = verification.GetDoubleOrDefault("riskScore")
        };
    }
}

/// <summary>
/// Onfido identity-verification adapter. Uses Onfido applicants and SDK token
/// creation for the embedded flow, plus Laravel-compatible webhook mapping.
/// </summary>
public sealed class OnfidoIdentityProvider : IIdentityVerificationProvider
{
    private const string ApiBase = "https://api.eu.onfido.com/v3.6";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<OnfidoIdentityProvider> _logger;

    public VerificationProvider ProviderType => VerificationProvider.Onfido;
    public string DisplayName => "Onfido";

    public OnfidoIdentityProvider(
        IHttpClientFactory httpClientFactory,
        ILogger<OnfidoIdentityProvider> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        var token = config.ApiToken ?? config.ApiKey;
        if (string.IsNullOrWhiteSpace(token))
            throw new InvalidOperationException("Onfido API token not configured.");

        using var client = CreateClient(token);
        using var applicantRequest = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/applicants")
        {
            Content = CreateJsonContent(new
            {
                first_name = config.FirstName ?? "Applicant",
                last_name = config.LastName ?? userId.ToString()
            })
        };

        var applicant = await SendJsonAsync(client, applicantRequest, "Onfido applicant creation");
        var applicantId = applicant.GetStringOrDefault("id")
            ?? throw new InvalidOperationException("Onfido applicant response did not include an id.");

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/sdk_token")
        {
            Content = CreateJsonContent(new
            {
                applicant_id = applicantId,
                referrer = config.Referrer ?? "*://*/*"
            })
        };

        var sdkToken = await SendJsonAsync(client, tokenRequest, "Onfido SDK token creation");

        return new VerificationSessionResult
        {
            ExternalSessionId = applicantId,
            SdkToken = sdkToken.GetStringOrDefault("token"),
            ExpiresAt = DateTime.UtcNow.AddHours(24)
        };
    }

    public async Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        var token = config.ApiToken ?? config.ApiKey;
        if (string.IsNullOrWhiteSpace(token))
            throw new InvalidOperationException("Onfido API token not configured.");

        using var client = CreateClient(token);
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{ApiBase}/applicants/{Uri.EscapeDataString(externalSessionId)}/checks");

        var root = await SendJsonAsync(client, request, "Onfido status check");
        if (!root.TryGetProperty("checks", out var checks)
            || checks.ValueKind != JsonValueKind.Array
            || checks.GetArrayLength() == 0)
        {
            return new VerificationStatusResult
            {
                ExternalSessionId = externalSessionId,
                Status = VerificationSessionStatus.Created
            };
        }

        return MapOnfidoCheck(checks[0], externalSessionId);
    }

    public Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig)
    {
        if (!TryParseJson(payload.RawBody, _logger, "Onfido", out var root))
            return Task.FromResult<VerificationStatusResult?>(null);

        if (!root.TryGetProperty("payload", out var wrapper))
            return Task.FromResult<VerificationStatusResult?>(null);

        var resourceType = wrapper.GetStringOrDefault("resource_type") ?? string.Empty;
        var action = wrapper.GetStringOrDefault("action") ?? string.Empty;
        var obj = wrapper.TryGetProperty("object", out var objectNode) ? objectNode : wrapper;
        var rawEventType = $"{resourceType}.{action}";

        if (resourceType != "check")
        {
            return Task.FromResult<VerificationStatusResult?>(new VerificationStatusResult
            {
                ExternalSessionId = obj.GetStringOrDefault("id"),
                Status = VerificationSessionStatus.InProgress,
                DecisionReason = rawEventType
            });
        }

        return Task.FromResult<VerificationStatusResult?>(MapOnfidoCheck(obj, obj.GetStringOrDefault("applicant_id"), rawEventType));
    }

    public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        return VerifyHmacSha256(payload, config.WebhookSecret, "X-SHA2-Signature");
    }

    private HttpClient CreateClient(string token)
    {
        var client = _httpClientFactory.CreateClient("OnfidoIdentity");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Token", $"token={token}");
        return client;
    }

    private static VerificationStatusResult MapOnfidoCheck(JsonElement check, string? fallbackSessionId, string? rawEventType = null)
    {
        var statusValue = check.GetStringOrDefault("status") ?? (rawEventType == "check.completed" ? "complete" : "in_progress");
        var result = check.GetStringOrDefault("result");
        var status = statusValue switch
        {
            "complete" => result == "clear" ? VerificationSessionStatus.Completed : VerificationSessionStatus.Failed,
            "awaiting_applicant" => VerificationSessionStatus.InProgress,
            "withdrawn" => VerificationSessionStatus.Cancelled,
            _ => VerificationSessionStatus.InProgress
        };

        return new VerificationStatusResult
        {
            ExternalSessionId = check.GetStringOrDefault("applicant_id") ?? fallbackSessionId,
            Status = status,
            Decision = status == VerificationSessionStatus.Completed
                ? "approved"
                : status == VerificationSessionStatus.Failed
                    ? "declined"
                    : null,
            DecisionReason = status == VerificationSessionStatus.Failed
                ? "Identity check did not pass"
                : rawEventType
        };
    }
}

/// <summary>
/// Jumio identity-verification adapter.
/// </summary>
public sealed class JumioIdentityProvider : IIdentityVerificationProvider
{
    private const string ApiBase = "https://account.amer-1.jumio.ai/api/v1";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<JumioIdentityProvider> _logger;

    public VerificationProvider ProviderType => VerificationProvider.Jumio;
    public string DisplayName => "Jumio";

    public JumioIdentityProvider(
        IHttpClientFactory httpClientFactory,
        ILogger<JumioIdentityProvider> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        if (string.IsNullOrWhiteSpace(config.ApiToken) || string.IsNullOrWhiteSpace(config.ApiSecret))
            throw new InvalidOperationException("Jumio API token and secret are not configured.");

        using var client = CreateClient(config.ApiToken, config.ApiSecret);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/accounts")
        {
            Content = CreateJsonContent(new
            {
                customerInternalReference = $"nexus_{tenantId}_{userId}",
                userReference = $"user_{userId}",
                callbackUrl,
                workflowDefinition = new
                {
                    key = level == VerificationLevel.DocumentAndSelfie ? 10 : 2
                }
            })
        };

        var root = await SendJsonAsync(client, request, "Jumio account creation");
        return new VerificationSessionResult
        {
            ExternalSessionId = root.GetPropertyOrNull("account")?.GetStringOrDefault("id") ?? string.Empty,
            RedirectUrl = root.GetPropertyOrNull("web")?.GetStringOrDefault("href"),
            SdkToken = root.GetPropertyOrNull("sdk")?.GetStringOrDefault("token"),
            ExpiresAt = DateTime.UtcNow.AddHours(24)
        };
    }

    public async Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        if (string.IsNullOrWhiteSpace(config.ApiToken) || string.IsNullOrWhiteSpace(config.ApiSecret))
            throw new InvalidOperationException("Jumio API token and secret are not configured.");

        using var client = CreateClient(config.ApiToken, config.ApiSecret);
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{ApiBase}/accounts/{Uri.EscapeDataString(externalSessionId)}");

        var root = await SendJsonAsync(client, request, "Jumio status check");
        return MapJumioDecision(root, externalSessionId);
    }

    public Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig)
    {
        if (!TryParseJson(payload.RawBody, _logger, "Jumio", out var root))
            return Task.FromResult<VerificationStatusResult?>(null);

        return Task.FromResult<VerificationStatusResult?>(MapJumioDecision(root, root.GetStringOrDefault("accountId")));
    }

    public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        return VerifyHmacSha256(payload, config.WebhookSecret ?? config.ApiSecret, "Jumio-Signature");
    }

    private HttpClient CreateClient(string token, string secret)
    {
        var client = _httpClientFactory.CreateClient("JumioIdentity");
        var credential = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{token}:{secret}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", credential);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("NexusPlatform/1.0");
        return client;
    }

    private static VerificationStatusResult MapJumioDecision(JsonElement root, string? fallbackSessionId)
    {
        var decision = root.GetPropertyOrNull("decision");
        var decisionType = decision?.GetStringOrDefault("type") ?? "PENDING";
        var status = decisionType switch
        {
            "APPROVED" => VerificationSessionStatus.Completed,
            "REJECTED" or "NOT_EXECUTED" => VerificationSessionStatus.Failed,
            "EXPIRED" => VerificationSessionStatus.Expired,
            _ => VerificationSessionStatus.InProgress
        };

        return new VerificationStatusResult
        {
            ExternalSessionId = root.GetStringOrDefault("accountId") ?? fallbackSessionId,
            Status = status,
            Decision = status == VerificationSessionStatus.Completed
                ? "approved"
                : status == VerificationSessionStatus.Failed
                    ? "declined"
                    : null,
            DecisionReason = decision?.GetPropertyOrNull("details")?.GetStringOrDefault("label"),
            ConfidenceScore = decision?.GetDoubleOrDefault("riskScore")
        };
    }
}

/// <summary>
/// iDenfy identity-verification adapter.
/// </summary>
public sealed class IdenfyIdentityProvider : IIdentityVerificationProvider
{
    private const string ApiBase = "https://ivs.idenfy.com/api/v2";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<IdenfyIdentityProvider> _logger;

    public VerificationProvider ProviderType => VerificationProvider.Idenfy;
    public string DisplayName => "iDenfy";

    public IdenfyIdentityProvider(
        IHttpClientFactory httpClientFactory,
        ILogger<IdenfyIdentityProvider> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<VerificationSessionResult> CreateSessionAsync(
        int userId,
        int tenantId,
        VerificationLevel level,
        string callbackUrl,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        if (string.IsNullOrWhiteSpace(config.ApiKey) || string.IsNullOrWhiteSpace(config.ApiSecret))
            throw new InvalidOperationException("iDenfy API key and secret are not configured.");

        using var client = CreateClient(config.ApiKey, config.ApiSecret);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/token")
        {
            Content = CreateJsonContent(new
            {
                clientId = $"nexus_{tenantId}_{userId}",
                generateDigitString = true,
                callbackUrl,
                successUrl = config.SuccessUrl,
                errorUrl = config.ErrorUrl,
                unverifiedUrl = config.UnverifiedUrl,
                externalRef = level == VerificationLevel.DocumentAndSelfie ? "selfie_required" : null
            })
        };

        var root = await SendJsonAsync(client, request, "iDenfy token creation");
        var authToken = root.GetStringOrDefault("authToken");

        return new VerificationSessionResult
        {
            ExternalSessionId = root.GetStringOrDefault("scanRef") ?? root.GetStringOrDefault("clientId") ?? string.Empty,
            RedirectUrl = string.IsNullOrWhiteSpace(authToken)
                ? null
                : $"https://ivs.idenfy.com/api/v2/redirect?authToken={Uri.EscapeDataString(authToken)}",
            SdkToken = authToken,
            ExpiresAt = root.GetUnixSecondsOrDefault("expiryTime") ?? DateTime.UtcNow.AddHours(24)
        };
    }

    public async Task<VerificationStatusResult> GetSessionStatusAsync(
        string externalSessionId,
        string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        if (string.IsNullOrWhiteSpace(config.ApiKey) || string.IsNullOrWhiteSpace(config.ApiSecret))
            throw new InvalidOperationException("iDenfy API key and secret are not configured.");

        using var client = CreateClient(config.ApiKey, config.ApiSecret);
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{ApiBase}/status?scanRef={Uri.EscapeDataString(externalSessionId)}");

        var root = await SendJsonAsync(client, request, "iDenfy status check");
        return MapIdenfyStatus(root, externalSessionId);
    }

    public Task<VerificationStatusResult?> ProcessWebhookAsync(
        WebhookPayload payload,
        string? providerConfig)
    {
        if (!TryParseJson(payload.RawBody, _logger, "iDenfy", out var root))
            return Task.FromResult<VerificationStatusResult?>(null);

        return Task.FromResult<VerificationStatusResult?>(MapIdenfyStatus(root, root.GetStringOrDefault("scanRef")));
    }

    public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig)
    {
        var config = IdentityProviderConfig.Parse(providerConfig);
        return VerifyHmacSha256(payload, config.WebhookSecret ?? config.ApiSecret, "Idenfy-Signature");
    }

    private HttpClient CreateClient(string key, string secret)
    {
        var client = _httpClientFactory.CreateClient("IdenfyIdentity");
        var credential = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{key}:{secret}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credential);
        return client;
    }

    private static VerificationStatusResult MapIdenfyStatus(JsonElement root, string? fallbackSessionId)
    {
        var final = root.GetPropertyOrNull("final");
        var statusNode = root.GetPropertyOrNull("status");
        var overall = final?.GetStringOrDefault("overall")
            ?? statusNode?.GetStringOrDefault("overall")
            ?? root.GetStringOrDefault("overall")
            ?? "ACTIVE";

        var status = overall switch
        {
            "APPROVED" => VerificationSessionStatus.Completed,
            "DENIED" or "SUSPECTED" => VerificationSessionStatus.Failed,
            "EXPIRED" => VerificationSessionStatus.Expired,
            "ACTIVE" => VerificationSessionStatus.InProgress,
            _ => VerificationSessionStatus.InProgress
        };

        var reasons = final?.GetStringArrayOrDefault("suspicionReasons")
            ?? root.GetStringArrayOrDefault("suspicionReasons")
            ?? Array.Empty<string>();

        return new VerificationStatusResult
        {
            ExternalSessionId = final?.GetStringOrDefault("scanRef") ?? root.GetStringOrDefault("scanRef") ?? fallbackSessionId,
            Status = status,
            Decision = status == VerificationSessionStatus.Completed
                ? "approved"
                : status == VerificationSessionStatus.Failed
                    ? "declined"
                    : null,
            DecisionReason = status == VerificationSessionStatus.Failed
                ? (reasons.Length > 0 ? string.Join(", ", reasons) : "Verification denied")
                : null
        };
    }
}

internal static class IdentityProviderAdapterHelpers
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = null,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static StringContent CreateJsonContent(object payload)
        => new(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");

    public static async Task<JsonElement> SendJsonAsync(
        HttpClient client,
        HttpRequestMessage request,
        string operation)
    {
        using var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"{operation} failed: {(int)response.StatusCode} {response.ReasonPhrase}");

        if (string.IsNullOrWhiteSpace(body))
            return JsonDocument.Parse("{}").RootElement.Clone();

        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }

    public static bool VerifyHmacSha256(WebhookPayload payload, string? secret, string headerName)
    {
        if (string.IsNullOrWhiteSpace(secret))
            return false;

        var signature = payload.Headers.FirstOrDefault(h =>
            string.Equals(h.Key, headerName, StringComparison.OrdinalIgnoreCase)).Value;
        if (string.IsNullOrWhiteSpace(signature))
            return false;

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload.RawBody))).ToLowerInvariant();

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(signature.ToLowerInvariant()));
    }

    public static bool TryParseJson(
        string rawBody,
        ILogger logger,
        string providerName,
        out JsonElement root)
    {
        try
        {
            using var document = JsonDocument.Parse(rawBody);
            root = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            logger.LogWarning("{Provider} webhook: invalid JSON body", providerName);
            root = default;
            return false;
        }
    }

    public static string? GetStringOrDefault(this JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;

        return property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : property.ToString();
    }

    public static double? GetDoubleOrDefault(this JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
            return null;

        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var number))
            return number;

        if (property.ValueKind == JsonValueKind.String && double.TryParse(property.GetString(), out number))
            return number;

        return null;
    }

    public static DateTime? GetUnixSecondsOrDefault(this JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
            return null;

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var seconds))
            return DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime;

        return null;
    }

    public static JsonElement? GetPropertyOrNull(this JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) ? property : null;
    }

    public static string[]? GetStringArrayOrDefault(this JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Array)
            return null;

        return property
            .EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToArray();
    }
}

internal sealed record IdentityProviderConfig
{
    [JsonPropertyName("api_key")]
    public string? ApiKey { get; init; }

    [JsonPropertyName("api_token")]
    public string? ApiToken { get; init; }

    [JsonPropertyName("api_secret")]
    public string? ApiSecret { get; init; }

    [JsonPropertyName("webhook_secret")]
    public string? WebhookSecret { get; init; }

    [JsonPropertyName("first_name")]
    public string? FirstName { get; init; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; init; }

    [JsonPropertyName("referrer")]
    public string? Referrer { get; init; }

    [JsonPropertyName("success_url")]
    public string? SuccessUrl { get; init; }

    [JsonPropertyName("error_url")]
    public string? ErrorUrl { get; init; }

    [JsonPropertyName("unverified_url")]
    public string? UnverifiedUrl { get; init; }

    public static IdentityProviderConfig Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return new IdentityProviderConfig();

        try
        {
            return JsonSerializer.Deserialize<IdentityProviderConfig>(json) ?? new IdentityProviderConfig();
        }
        catch (JsonException)
        {
            return new IdentityProviderConfig();
        }
    }
}
