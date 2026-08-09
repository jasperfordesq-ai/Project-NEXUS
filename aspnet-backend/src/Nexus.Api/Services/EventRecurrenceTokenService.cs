// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Nexus.Api.Services;

public sealed class EventRecurrenceTokenService(IConfiguration configuration)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public string? Issue<T>(T payload)
    {
        var key = Key();
        if (key is null) return null;
        var body = JsonSerializer.SerializeToUtf8Bytes(payload, Json);
        using var hmac = new HMACSHA256(key);
        return Base64Url(body) + "." + Base64Url(hmac.ComputeHash(body));
    }

    public bool TryRead<T>(string token, out T? payload)
    {
        payload = default;
        var key = Key();
        if (key is null || string.IsNullOrWhiteSpace(token) || token.Length > 8192) return false;
        var parts = token.Split('.');
        if (parts.Length != 2) return false;
        try
        {
            var body = FromBase64Url(parts[0]);
            var signature = FromBase64Url(parts[1]);
            using var hmac = new HMACSHA256(key);
            if (!CryptographicOperations.FixedTimeEquals(signature, hmac.ComputeHash(body))) return false;
            payload = JsonSerializer.Deserialize<T>(body, Json);
            return payload is not null;
        }
        catch (Exception exception) when (exception is FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }

    private byte[]? Key()
    {
        var secret = configuration["Jwt:Secret"] ?? configuration["JWT_SECRET"] ?? configuration["Jwt__Secret"];
        return string.IsNullOrWhiteSpace(secret) || secret.Length < 32
            ? null
            : SHA256.HashData(Encoding.UTF8.GetBytes("event-recurrence-preview-v1|" + secret));
    }

    private static string Base64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] FromBase64Url(string value)
    {
        if (value.Length == 0 || value.Any(x => !char.IsAsciiLetterOrDigit(x) && x is not '-' and not '_')) throw new FormatException();
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        var decoded = Convert.FromBase64String(normalized);
        if (!string.Equals(Base64Url(decoded), value, StringComparison.Ordinal)) throw new FormatException();
        return decoded;
    }
}
