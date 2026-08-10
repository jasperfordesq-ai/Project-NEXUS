// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;

namespace Nexus.Api.Services;

/// <summary>
/// Have I Been Pwned k-anonymity password check (V2 .NET parity with
/// V1 PHP PwnedPasswordService).
///
/// Sends only the first 5 hex chars of SHA-1(password) to the HIBP API;
/// receives the list of matching suffixes + breach counts. We never reveal
/// the candidate password to a third party (k-anonymity guarantee).
///
/// Failure mode: fail-OPEN on network/timeout — better to let a legit
/// user register with a possibly-pwned password than block all
/// registrations during a HIBP outage.
///
/// Config (appsettings / env):
///   Hibp:Enabled    — "false" disables (default true)
///   Hibp:Threshold  — reject if breach-count > threshold (default 0)
/// </summary>
public interface IPwnedPasswordChecker
{
    Task<bool> IsPwnedAsync(string password, CancellationToken ct = default);
}

public class PwnedPasswordChecker : IPwnedPasswordChecker
{
    private const string ApiUrl = "https://api.pwnedpasswords.com/range/";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<PwnedPasswordChecker> _logger;

    public PwnedPasswordChecker(HttpClient http, IConfiguration config, ILogger<PwnedPasswordChecker> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    public async Task<bool> IsPwnedAsync(string password, CancellationToken ct = default)
    {
        var enabled = _config.GetValue("Hibp:Enabled", true);
        if (!enabled) return false;
        if (string.IsNullOrEmpty(password)) return false;

        var threshold = Math.Max(0, _config.GetValue("Hibp:Threshold", 0));

        var sha1 = ComputeSha1Hex(password).ToUpperInvariant();
        var prefix = sha1[..5];
        var suffix = sha1[5..];

        string body;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, ApiUrl + prefix);
            req.Headers.TryAddWithoutValidation("Add-Padding", "true");
            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogInformation("hibp.http_error status={Status}", (int)resp.StatusCode);
                return false;
            }
            body = await resp.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogInformation(ex, "hibp.network_error");
            return false; // fail-open
        }

        foreach (var rawLine in body.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0) continue;
            var sep = line.IndexOf(':');
            if (sep <= 0) continue;
            var lineSuffix = line[..sep];
            if (!string.Equals(lineSuffix, suffix, StringComparison.OrdinalIgnoreCase)) continue;
            if (!int.TryParse(line[(sep + 1)..].Trim(), out var count)) continue;
            if (count > threshold)
            {
                _logger.LogInformation("hibp.password_pwned count={Count}", count);
                return true;
            }
        }
        return false;
    }

    private static string ComputeSha1Hex(string input)
    {
        var bytes = Encoding.UTF8.GetBytes(input);
        var hash = SHA1.HashData(bytes);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
