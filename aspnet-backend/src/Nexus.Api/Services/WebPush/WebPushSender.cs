// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.WebPush;

/// <summary>
/// Phase 73 path-to-1000 item 11 — RFC 8291 / RFC 8030 Web-Push sender.
///
/// Builds an aes128gcm-encrypted body from the plaintext payload + the
/// browser-provided subscription keys, signs a VAPID JWT for the push
/// service's audience, and POSTs the result.
///
/// On HTTP 404/410 from the push service the subscription is permanently
/// gone — we mark it inactive so cron stops dispatching to a dead endpoint.
/// </summary>
public class WebPushSender
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WebPushSender> _logger;
    private readonly NexusDbContext? _db;

    public WebPushSender(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<WebPushSender> logger,
        NexusDbContext? db = null)
    {
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _db = db;
    }

    /// <summary>
    /// Send an encrypted Web-Push payload to the subscription. Returns
    /// <c>true</c> on 2xx. On 404/410 marks the subscription inactive.
    /// </summary>
    public async Task<bool> SendAsync(
        PushSubscription sub,
        string vapidPrivateKey,
        string vapidPublicKey,
        byte[] payload,
        int ttlSeconds = 86400,
        string urgency = "normal",
        CancellationToken ct = default)
    {
        if (sub == null) throw new ArgumentNullException(nameof(sub));
        if (payload == null) throw new ArgumentNullException(nameof(payload));
        if (string.IsNullOrWhiteSpace(vapidPrivateKey)) throw new ArgumentException("vapid private key required", nameof(vapidPrivateKey));
        if (string.IsNullOrWhiteSpace(vapidPublicKey)) throw new ArgumentException("vapid public key required", nameof(vapidPublicKey));

        if (string.IsNullOrWhiteSpace(sub.P256dh) || string.IsNullOrWhiteSpace(sub.Auth))
        {
            _logger.LogWarning(
                "Web-Push subscription {SubscriptionId} for user {UserId} missing P256dh/Auth — marking inactive",
                sub.Id, sub.UserId);
            await DeactivateAsync(sub, ct);
            return false;
        }

        if (!Uri.TryCreate(sub.DeviceToken, UriKind.Absolute, out var endpoint))
        {
            _logger.LogWarning(
                "Web-Push subscription {SubscriptionId} has invalid endpoint URL", sub.Id);
            return false;
        }

        byte[] body;
        try
        {
            var p256dh = VapidJwtSigner.Base64UrlDecode(sub.P256dh!);
            var auth = VapidJwtSigner.Base64UrlDecode(sub.Auth!);
            body = WebPushPayloadEncryptor.Encrypt(payload, p256dh, auth);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or System.Security.Cryptography.CryptographicException)
        {
            _logger.LogWarning(ex,
                "Web-Push payload encryption failed for subscription {SubscriptionId} — marking inactive",
                sub.Id);
            await DeactivateAsync(sub, ct);
            return false;
        }

        var vapidSubject = _configuration["Vapid:Subject"] ?? "mailto:noreply@project-nexus.net";
        string authorization;
        try
        {
            authorization = VapidJwtSigner.BuildAuthorizationHeader(
                audience: VapidJwtSigner.DeriveAudience(endpoint),
                subject: vapidSubject,
                privateKeyBase64Url: vapidPrivateKey,
                publicKeyBase64Url: vapidPublicKey);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or System.Security.Cryptography.CryptographicException)
        {
            _logger.LogWarning(ex,
                "VAPID JWT signing failed for subscription {SubscriptionId}", sub.Id);
            return false;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Content = new ByteArrayContent(body);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentLength = body.Length;
        request.Headers.TryAddWithoutValidation("Content-Encoding", "aes128gcm");
        request.Headers.TryAddWithoutValidation("TTL", ttlSeconds.ToString());
        request.Headers.TryAddWithoutValidation("Urgency", urgency);
        request.Headers.TryAddWithoutValidation("Authorization", authorization);

        var client = _httpClientFactory.CreateClient("NexusPushProvider");
        try
        {
            using var response = await client.SendAsync(request, ct);

            if (response.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
            {
                _logger.LogInformation(
                    "Web-Push subscription {SubscriptionId} returned {StatusCode} — deactivating",
                    sub.Id, (int)response.StatusCode);
                await DeactivateAsync(sub, ct);
                return false;
            }

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Web-Push subscription {SubscriptionId} dispatch failed with HTTP {StatusCode}",
                    sub.Id, (int)response.StatusCode);
                return false;
            }

            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex,
                "Web-Push subscription {SubscriptionId} dispatch threw", sub.Id);
            return false;
        }
    }

    private async Task DeactivateAsync(PushSubscription sub, CancellationToken ct)
    {
        sub.IsActive = false;
        sub.UpdatedAt = DateTime.UtcNow;
        if (_db != null)
        {
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex,
                    "Failed to persist deactivation of push subscription {SubscriptionId}", sub.Id);
            }
        }
    }
}
