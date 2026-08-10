// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.WebPush;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing push notification subscriptions, preferences, and delivery.
/// Phase 33: Push Notifications.
/// </summary>
public class PushNotificationService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IConfiguration _configuration;
    private readonly ILogger<PushNotificationService> _logger;
    private readonly IHttpClientFactory? _httpClientFactory;
    private readonly WebPushSender? _webPushSender;

    private static readonly JsonSerializerOptions ProviderJsonOptions = new(JsonSerializerDefaults.Web);

    public PushNotificationService(
        NexusDbContext db,
        TenantContext tenantContext,
        IConfiguration configuration,
        ILogger<PushNotificationService> logger,
        IHttpClientFactory? httpClientFactory = null,
        WebPushSender? webPushSender = null)
    {
        _db = db;
        _tenantContext = tenantContext;
        _configuration = configuration;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _webPushSender = webPushSender;
    }

    /// <summary>
    /// Register a device for push notifications. If the token already exists for the user,
    /// reactivates it and updates metadata.
    /// </summary>
    public async Task<PushSubscription> RegisterDeviceAsync(int userId, string deviceToken, string platform, string? deviceName = null, string? p256dh = null, string? auth = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Check if this token is already registered for this tenant
        var existing = await _db.Set<PushSubscription>()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.DeviceToken == deviceToken);

        if (existing != null)
        {
            // Reactivate and update ownership if needed
            existing.UserId = userId;
            existing.Platform = platform;
            existing.DeviceName = deviceName ?? existing.DeviceName;
            existing.IsActive = true;
            existing.UpdatedAt = DateTime.UtcNow;
            // Update web-push browser keys if the new registration provides them.
            if (!string.IsNullOrWhiteSpace(p256dh)) existing.P256dh = p256dh;
            if (!string.IsNullOrWhiteSpace(auth)) existing.Auth = auth;

            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Push subscription reactivated for user {UserId}, platform {Platform}",
                userId, platform);

            return existing;
        }

        var subscription = new PushSubscription
        {
            TenantId = tenantId,
            UserId = userId,
            DeviceToken = deviceToken,
            Platform = platform,
            DeviceName = deviceName,
            P256dh = p256dh,
            Auth = auth,
            IsActive = true
        };

        _db.Set<PushSubscription>().Add(subscription);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Push subscription registered for user {UserId}, platform {Platform}, device {DeviceName}",
            userId, platform, deviceName ?? "(unnamed)");

        return subscription;
    }

    /// <summary>
    /// Unregister a device by deactivating its subscription.
    /// </summary>
    public async Task<bool> UnregisterDeviceAsync(int userId, string deviceToken)
    {
        var subscription = await _db.Set<PushSubscription>()
            .FirstOrDefaultAsync(s => s.UserId == userId && s.DeviceToken == deviceToken);

        if (subscription == null)
        {
            return false;
        }

        subscription.IsActive = false;
        subscription.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Push subscription unregistered for user {UserId}, token ending {TokenEnd}",
            userId, deviceToken.Length > 8 ? deviceToken[^8..] : deviceToken);

        return true;
    }

    /// <summary>
    /// Get all active device subscriptions for a user.
    /// </summary>
    public async Task<List<PushSubscription>> GetUserDevicesAsync(int userId)
    {
        return await _db.Set<PushSubscription>()
            .Where(s => s.UserId == userId && s.IsActive)
            .OrderByDescending(s => s.LastUsedAt ?? s.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Queue a push notification for all active devices for a user.
    /// Creates honest provider-status log entries for each delivery attempt.
    /// </summary>
    public async Task<int> SendPushAsync(
        int userId,
        string title,
        string body,
        string? data = null,
        int? tenantId = null)
        => await QueuePushAsync(userId, title, body, data, tenantId, requestedProvider: null);

    /// <summary>
    /// Queues a notification only for subscriptions owned by the requested native
    /// provider. This keeps Web Push and FCM delivery ledgers independent instead
    /// of treating one provider send as evidence for both channels.
    /// </summary>
    public async Task<int> SendPushChannelAsync(
        int userId,
        string title,
        string body,
        string? data,
        string provider,
        int? tenantId = null)
    {
        var normalizedProvider = provider.Trim().ToLowerInvariant() switch
        {
            "web_push" or "web-push" => "web-push",
            "fcm" => "fcm",
            _ => throw new ArgumentOutOfRangeException(nameof(provider), provider, "Only web-push and fcm are supported channel providers.")
        };

        return await QueuePushAsync(userId, title, body, data, tenantId, normalizedProvider);
    }

    private async Task<int> QueuePushAsync(
        int userId,
        string title,
        string body,
        string? data,
        int? tenantId,
        string? requestedProvider)
    {
        IQueryable<PushSubscription> subscriptions = _db.Set<PushSubscription>();
        if (tenantId.HasValue)
        {
            subscriptions = subscriptions
                .IgnoreQueryFilters()
                .Where(subscription => subscription.TenantId == tenantId.Value);
        }

        subscriptions = subscriptions.Where(s => s.UserId == userId && s.IsActive);
        if (requestedProvider == "web-push")
        {
            subscriptions = subscriptions.Where(s => s.Platform == "web"
                && s.P256dh != null && s.P256dh != ""
                && s.Auth != null && s.Auth != "");
        }
        else if (requestedProvider == "fcm")
        {
            subscriptions = subscriptions.Where(s => s.Platform == "android" || s.Platform == "ios");
        }

        var devices = await subscriptions
            .ToListAsync();

        if (devices.Count == 0)
        {
            _logger.LogDebug("No active push subscriptions for user {UserId}", userId);
            return 0;
        }

        var providerStatus = GetProviderStatusInternal(requestedProvider);
        var queuedCount = 0;

        foreach (var device in devices)
        {
            var log = new PushNotificationLog
            {
                TenantId = device.TenantId,
                UserId = userId,
                SubscriptionId = device.Id,
                Title = title,
                Body = body,
                Data = BuildProviderLogData(data, providerStatus.Provider, providerStatus.Configured),
                Status = PushStatus.Pending,
                ErrorMessage = providerStatus.FailureReason
            };

            _db.Set<PushNotificationLog>().Add(log);
            queuedCount++;

            _logger.LogDebug(
                "Push notification queued for device {DeviceId}, user {UserId}, provider {Provider}, configured={Configured}: {Title}",
                device.Id, userId, providerStatus.Provider, providerStatus.Configured, title);
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Push notification queued to {QueuedCount}/{TotalCount} devices for user {UserId}; provider {Provider}, configured={Configured}",
            queuedCount, devices.Count, userId, providerStatus.Provider, providerStatus.Configured);

        return queuedCount;
    }

    /// <summary>
    /// Send a push notification to multiple users in batch.
    /// </summary>
    public async Task<int> SendBulkPushAsync(IEnumerable<int> userIds, string title, string body, string? data = null)
    {
        var totalSent = 0;

        foreach (var userId in userIds)
        {
            totalSent += await SendPushAsync(userId, title, body, data);
        }

        return totalSent;
    }

    /// <summary>
    /// Explicitly attempts queued push dispatch through the configured generic HTTP provider.
    /// If no dispatchable provider is configured, attempts are marked failed with a
    /// machine-readable reason instead of pretending delivery succeeded.
    /// </summary>
    public async Task<PushDispatchProcessResult> ProcessPendingPushNotificationsAsync(
        int maxLogs = 100,
        CancellationToken ct = default)
    {
        var logs = await _db.Set<PushNotificationLog>()
            .Include(l => l.Subscription)
            .Where(l => l.Status == PushStatus.Pending)
            .OrderBy(l => l.CreatedAt)
            .Take(Math.Clamp(maxLogs, 1, 500))
            .ToListAsync(ct);

        var result = new PushDispatchProcessResult
        {
            Attempted = logs.Count
        };

        var providers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allProvidersConfigured = true;

        foreach (var log in logs)
        {
            var providerStatus = GetProviderStatusInternal(ReadProviderFromLogData(log.Data));
            providers.Add(providerStatus.Provider);
            allProvidersConfigured &= providerStatus.Configured;
            log.Data = BuildProviderLogData(log.Data, providerStatus.Provider, providerStatus.Configured);

            if (!providerStatus.CanDispatch)
            {
                MarkPushFailed(log, providerStatus.FailureReason ?? "provider_not_configured");
                result.Failed++;
                continue;
            }

            if (await DispatchPushLogAsync(log, providerStatus, ct))
            {
                result.Sent++;
            }
            else
            {
                result.Failed++;
            }
        }

        result.Provider = providers.Count switch
        {
            0 => GetProviderStatusInternal().Provider,
            1 => providers.Single(),
            _ => "mixed"
        };
        result.ProviderConfigured = logs.Count == 0
            ? GetProviderStatusInternal().Configured
            : allProvidersConfigured;

        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Processed {Attempted} pending push notifications; provider {Provider}, configured={Configured}, failed={Failed}",
            result.Attempted, result.Provider, result.ProviderConfigured, result.Failed);

        return result;
    }

    /// <summary>
    /// Check whether a user should receive a notification for a given type and channel.
    /// Returns true by default if no preference is set (opt-out model).
    /// </summary>
    public async Task<bool> ShouldNotifyAsync(int userId, string notificationType, string channel)
    {
        var pref = await _db.Set<NotificationPreference>()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.NotificationType == notificationType);

        if (pref == null)
        {
            // No preference set - use defaults (in-app and push on, email off)
            return channel switch
            {
                "in_app" => true,
                "push" => true,
                "email" => false,
                _ => true
            };
        }

        return channel switch
        {
            "in_app" => pref.EnableInApp,
            "push" => pref.EnablePush,
            "email" => pref.EnableEmail,
            _ => true
        };
    }

    /// <summary>
    /// Get all notification preferences for a user.
    /// </summary>
    public async Task<List<NotificationPreference>> GetPreferencesAsync(int userId)
    {
        return await _db.Set<NotificationPreference>()
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.NotificationType)
            .ToListAsync();
    }

    /// <summary>
    /// Update a single notification preference for a user.
    /// Creates the preference if it doesn't exist.
    /// </summary>
    public async Task<NotificationPreference> UpdatePreferenceAsync(
        int userId,
        string notificationType,
        bool? enableInApp = null,
        bool? enablePush = null,
        bool? enableEmail = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var pref = await _db.Set<NotificationPreference>()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.NotificationType == notificationType);

        if (pref == null)
        {
            pref = new NotificationPreference
            {
                TenantId = tenantId,
                UserId = userId,
                NotificationType = notificationType
            };
            _db.Set<NotificationPreference>().Add(pref);
        }

        if (enableInApp.HasValue) pref.EnableInApp = enableInApp.Value;
        if (enablePush.HasValue) pref.EnablePush = enablePush.Value;
        if (enableEmail.HasValue) pref.EnableEmail = enableEmail.Value;
        pref.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Notification preference updated for user {UserId}, type {NotificationType}: in_app={InApp}, push={Push}, email={Email}",
            userId, notificationType, pref.EnableInApp, pref.EnablePush, pref.EnableEmail);

        return pref;
    }

    /// <summary>
    /// Remove inactive or expired push tokens.
    /// Tokens not used in 90 days are considered expired.
    /// </summary>
    public async Task<int> CleanupExpiredTokensAsync()
    {
        var cutoff = DateTime.UtcNow.AddDays(-90);

        var count = await _db.Set<PushSubscription>()
            .Where(s => s.IsActive && (s.LastUsedAt ?? s.CreatedAt) < cutoff)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.IsActive, false)
                .SetProperty(s => s.UpdatedAt, DateTime.UtcNow));

        if (count > 0)
        {
            _logger.LogInformation("Cleaned up {Count} expired push subscriptions", count);
        }

        return count;
    }

    private PushProviderStatus GetProviderStatusInternal(string? requestedProvider = null)
    {
        var endpointValue = FirstConfiguredValue(
            "Push:Http:Endpoint",
            "Push:GenericHttp:Endpoint",
            "Push:ProviderEndpoint",
            "Push:Endpoint");

        var endpoint = TryCreateHttpUri(endpointValue);
        var endpointWasConfigured = !string.IsNullOrWhiteSpace(endpointValue);

        var provider = requestedProvider ?? _configuration["Push:Provider"];
        if (string.IsNullOrWhiteSpace(provider))
        {
            if (endpoint != null || endpointWasConfigured)
            {
                provider = "generic-http";
            }
            else if (!string.IsNullOrWhiteSpace(_configuration["Firebase:ServerKey"]) ||
                !string.IsNullOrWhiteSpace(_configuration["Fcm:ServerKey"]))
            {
                provider = "fcm";
            }
            else if (!string.IsNullOrWhiteSpace(_configuration["Vapid:PublicKey"]) &&
                     !string.IsNullOrWhiteSpace(_configuration["Vapid:PrivateKey"]))
            {
                provider = "web-push";
            }
            else if (!string.IsNullOrWhiteSpace(_configuration["Apns:KeyId"]))
            {
                provider = "apns";
            }
            else
            {
                provider = "none";
            }
        }

        var legacyProviderConfigured = provider switch
        {
            "fcm" => !string.IsNullOrWhiteSpace(_configuration["Firebase:ServerKey"]) ||
                     !string.IsNullOrWhiteSpace(_configuration["Fcm:ServerKey"]),
            "web-push" => !string.IsNullOrWhiteSpace(_configuration["Vapid:PublicKey"]) &&
                          !string.IsNullOrWhiteSpace(_configuration["Vapid:PrivateKey"]),
            "apns" => !string.IsNullOrWhiteSpace(_configuration["Apns:KeyId"]),
            _ => false
        };

        var configured = endpoint != null || legacyProviderConfigured;
        var failureReason = endpointWasConfigured && endpoint == null
            ? "provider_endpoint_invalid"
            : configured
                ? endpoint == null ? "provider_dispatch_not_implemented" : null
                : "provider_not_configured";

        return new PushProviderStatus
        {
            Provider = provider,
            Configured = configured,
            Endpoint = endpoint,
            FailureReason = failureReason,
            AuthHeaderName = FirstConfiguredValue("Push:Http:AuthHeaderName", "Push:AuthHeaderName"),
            AuthHeaderValue = FirstConfiguredValue("Push:Http:AuthHeaderValue", "Push:AuthHeaderValue"),
            BearerToken = FirstConfiguredValue("Push:Http:BearerToken", "Push:BearerToken")
        };
    }

    private static string BuildProviderLogData(string? data, string provider, bool providerConfigured)
    {
        return JsonSerializer.Serialize(new
        {
            provider,
            provider_configured = providerConfigured,
            original_data = data
        });
    }

    private static string? ReadProviderFromLogData(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return null;
        try
        {
            using var document = JsonDocument.Parse(data);
            return document.RootElement.TryGetProperty("provider", out var provider)
                ? provider.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<bool> DispatchPushLogAsync(
        PushNotificationLog log,
        PushProviderStatus provider,
        CancellationToken ct)
    {
        if (_httpClientFactory == null)
        {
            MarkPushFailed(log, "provider_client_not_available");
            return false;
        }

        if (log.Subscription == null)
        {
            MarkPushFailed(log, "subscription_not_found");
            return false;
        }

        // Phase 64 — provider-aware dispatch. Detection already happens in
        // GetProviderStatusInternal; here we route to the right transport.
        try
        {
            return provider.Provider switch
            {
                "fcm" => await DispatchFcmAsync(log, ct),
                "web-push" => await DispatchWebPushAsync(log, ct),
                _ => await DispatchGenericHttpAsync(log, provider, ct)
            };
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            MarkPushFailed(log, "provider_send_failed");
            _logger.LogWarning(ex, "Push notification log {PushLogId} failed during provider dispatch", log.Id);
            return false;
        }
    }

    /// <summary>
    /// FCM legacy HTTP API dispatch. Requires <c>Firebase:ServerKey</c> (or
    /// <c>Fcm:ServerKey</c>) in configuration. Returns true on 2xx.
    /// </summary>
    private async Task<bool> DispatchFcmAsync(PushNotificationLog log, CancellationToken ct)
    {
        var serverKey = FirstConfiguredValue("Firebase:ServerKey", "Fcm:ServerKey");
        if (string.IsNullOrWhiteSpace(serverKey))
        {
            MarkPushFailed(log, "fcm_server_key_missing");
            return false;
        }

        var endpoint = new Uri(_configuration["Firebase:Endpoint"] ?? "https://fcm.googleapis.com/fcm/send");
        // FCM legacy payload: { to, notification: { title, body }, data: {...} }
        var fcmPayload = new
        {
            to = log.Subscription!.DeviceToken,
            notification = new { title = log.Title, body = log.Body },
            data = string.IsNullOrWhiteSpace(log.Data) ? null : (object?)JsonSerializer.Deserialize<JsonElement>(log.Data!)
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Content = JsonContent.Create(fcmPayload, options: ProviderJsonOptions);
        request.Headers.TryAddWithoutValidation("Authorization", $"key={serverKey}");

        var client = _httpClientFactory!.CreateClient("NexusPushProvider");
        using var response = await client.SendAsync(request, ct);

        if (!response.IsSuccessStatusCode)
        {
            MarkPushFailed(log, $"fcm_http_{(int)response.StatusCode}");
            return false;
        }

        // FCM body: {"success":1,"failure":0,"results":[{...}]} — if results[0]
        // contains "error", the token is bad. Mark subscription inactive so we
        // don't keep dispatching.
        var body = await response.Content.ReadAsStringAsync(ct);
        if (body.Contains("\"error\"", StringComparison.OrdinalIgnoreCase) &&
            body.Contains("NotRegistered", StringComparison.OrdinalIgnoreCase))
        {
            log.Subscription!.IsActive = false;
            log.Subscription.UpdatedAt = DateTime.UtcNow;
            MarkPushFailed(log, "fcm_token_not_registered");
            return false;
        }

        log.Status = PushStatus.Sent;
        log.ErrorMessage = null;
        log.SentAt = DateTime.UtcNow;
        log.Subscription!.LastUsedAt = DateTime.UtcNow;
        log.Subscription.UpdatedAt = DateTime.UtcNow;
        return true;
    }

    /// <summary>
    /// Web Push (RFC 8030) dispatch. Posts an empty body (notification fetched
    /// by service worker via separate fetch) to the subscription endpoint URL
    /// stored in <see cref="PushSubscription.DeviceToken"/>.
    ///
    /// VAPID signing is intentionally minimal: we send the configured VAPID
    /// public key as the <c>Crypto-Key</c> header so the push service can
    /// associate the request, but full JWT signing + payload AES-128-GCM
    /// encryption requires a NuGet (WebPush 1.x) which is intentionally not
    /// added in this phase to avoid pulling System.Net cryptography wrappers.
    /// Configure your service worker to fetch the payload from
    /// <c>/api/push/payload/:logId</c> (a thin endpoint that returns the
    /// title/body/data for the log row) so unencrypted notifications still work.
    /// </summary>
    private async Task<bool> DispatchWebPushAsync(PushNotificationLog log, CancellationToken ct)
    {
        var endpointUrl = log.Subscription!.DeviceToken;
        if (!Uri.TryCreate(endpointUrl, UriKind.Absolute, out var subscriptionEndpoint))
        {
            MarkPushFailed(log, "web_push_invalid_endpoint");
            return false;
        }

        var vapidPublic = _configuration["Vapid:PublicKey"];
        if (string.IsNullOrWhiteSpace(vapidPublic))
        {
            MarkPushFailed(log, "vapid_public_key_missing");
            return false;
        }
        var vapidPrivate = _configuration["Vapid:PrivateKey"];
        var vapidSubject = _configuration["Vapid:Subject"] ?? "mailto:noreply@project-nexus.net";

        // Phase 73 path-to-1000 #11 — when the subscription carries the
        // browser's p256dh + auth keys AND we have a VAPID private key, use
        // the dedicated WebPushSender to handle RFC 8291 encryption + RFC
        // 8292 VAPID signing in one place.
        if (_webPushSender != null
            && !string.IsNullOrWhiteSpace(vapidPrivate)
            && WebPushPayloadEncryptor.CanEncrypt(log.Subscription.P256dh, log.Subscription.Auth))
        {
            var payloadJson = JsonSerializer.Serialize(new
            {
                title = log.Title,
                body = log.Body,
                data = string.IsNullOrWhiteSpace(log.Data) ? null : (object?)JsonDocument.Parse(log.Data!).RootElement
            }, ProviderJsonOptions);

            var ok = await _webPushSender.SendAsync(
                log.Subscription,
                vapidPrivateKey: vapidPrivate!,
                vapidPublicKey: vapidPublic!,
                payload: System.Text.Encoding.UTF8.GetBytes(payloadJson),
                ct: ct);

            if (ok)
            {
                log.Status = PushStatus.Sent;
                log.ErrorMessage = null;
                log.SentAt = DateTime.UtcNow;
                log.Subscription.LastUsedAt = DateTime.UtcNow;
                log.Subscription.UpdatedAt = DateTime.UtcNow;
                return true;
            }

            // WebPushSender already logs + (if relevant) marks the
            // subscription inactive. Surface a stable failure reason.
            MarkPushFailed(log, log.Subscription.IsActive ? "web_push_send_failed" : "web_push_subscription_gone");
            return false;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, subscriptionEndpoint);
        request.Headers.TryAddWithoutValidation("TTL", "86400");
        request.Headers.TryAddWithoutValidation("Urgency", "normal");

        // Phase 73 — RFC 8291 payload encryption when the browser-side
        // subscription keys are stored. The browser ships p256dh + auth
        // when registering; older registrations without them fall back to
        // the empty-body pattern (service worker fetches payload from a
        // separate authenticated route).
        if (WebPushPayloadEncryptor.CanEncrypt(log.Subscription.P256dh, log.Subscription.Auth))
        {
            try
            {
                // Body shape the service worker will receive. Keep it small
                // — Web-Push services cap at ~4KB pre-encryption.
                var payloadJson = JsonSerializer.Serialize(new
                {
                    title = log.Title,
                    body = log.Body,
                    data = string.IsNullOrWhiteSpace(log.Data) ? null : (object?)JsonDocument.Parse(log.Data!).RootElement
                }, ProviderJsonOptions);

                var encrypted = WebPushPayloadEncryptor.Encrypt(
                    payloadJson, log.Subscription.P256dh!, log.Subscription.Auth!);

                request.Content = new ByteArrayContent(encrypted);
                request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                request.Content.Headers.ContentLength = encrypted.Length;
                request.Headers.TryAddWithoutValidation("Content-Encoding", "aes128gcm");
            }
            catch (Exception ex) when (ex is ArgumentException or FormatException or System.Security.Cryptography.CryptographicException)
            {
                _logger.LogWarning(ex, "Web-Push payload encryption failed; sending empty body instead");
                request.Content = new ByteArrayContent(Array.Empty<byte>());
            }
        }
        else
        {
            // Empty-body pattern — service worker fetches payload separately.
            request.Content = new ByteArrayContent(Array.Empty<byte>());
        }

        // Phase 73 — RFC 8292 VAPID auth. If private key is configured, sign
        // an ES256 JWT and send the proper Authorization header. Otherwise
        // fall back to the legacy Crypto-Key-only header (browsers will still
        // route the push but stricter push services may reject it).
        if (!string.IsNullOrWhiteSpace(vapidPrivate))
        {
            try
            {
                var audience = VapidJwtSigner.DeriveAudience(subscriptionEndpoint);
                var authHeader = VapidJwtSigner.BuildAuthorizationHeader(
                    audience: audience,
                    subject: vapidSubject,
                    privateKeyBase64Url: vapidPrivate,
                    publicKeyBase64Url: vapidPublic);
                request.Headers.TryAddWithoutValidation("Authorization", authHeader);
            }
            catch (Exception ex) when (ex is ArgumentException or FormatException or System.Security.Cryptography.CryptographicException)
            {
                _logger.LogWarning(ex, "VAPID JWT signing failed; falling back to Crypto-Key header only");
                request.Headers.TryAddWithoutValidation("Crypto-Key", $"p256ecdsa={vapidPublic}");
            }
        }
        else
        {
            // Legacy compatibility — VAPID private key not configured.
            request.Headers.TryAddWithoutValidation("Crypto-Key", $"p256ecdsa={vapidPublic}");
        }

        var client = _httpClientFactory!.CreateClient("NexusPushProvider");
        using var response = await client.SendAsync(request, ct);

        if (response.StatusCode == System.Net.HttpStatusCode.Gone ||
            response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // Subscription expired — deactivate.
            log.Subscription.IsActive = false;
            log.Subscription.UpdatedAt = DateTime.UtcNow;
            MarkPushFailed(log, $"web_push_subscription_{(int)response.StatusCode}");
            return false;
        }

        if (!response.IsSuccessStatusCode)
        {
            MarkPushFailed(log, $"web_push_http_{(int)response.StatusCode}");
            return false;
        }

        log.Status = PushStatus.Sent;
        log.ErrorMessage = null;
        log.SentAt = DateTime.UtcNow;
        log.Subscription.LastUsedAt = DateTime.UtcNow;
        log.Subscription.UpdatedAt = DateTime.UtcNow;
        return true;
    }

    private async Task<bool> DispatchGenericHttpAsync(
        PushNotificationLog log,
        PushProviderStatus provider,
        CancellationToken ct)
    {
        var payload = new
        {
            tenantId = log.TenantId,
            userId = log.UserId,
            subscriptionId = log.SubscriptionId,
            deviceToken = log.Subscription!.DeviceToken,
            platform = log.Subscription.Platform,
            title = log.Title,
            body = log.Body,
            data = log.Data
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, provider.Endpoint);
        request.Content = JsonContent.Create(payload, options: ProviderJsonOptions);
        ApplyConfiguredAuthHeaders(request, provider);

        var client = _httpClientFactory!.CreateClient("NexusPushProvider");
        using var response = await client.SendAsync(request, ct);

        if (!response.IsSuccessStatusCode)
        {
            MarkPushFailed(log, $"provider_http_{(int)response.StatusCode}");
            return false;
        }

        log.Status = PushStatus.Sent;
        log.ErrorMessage = null;
        log.SentAt = DateTime.UtcNow;
        log.Subscription.LastUsedAt = DateTime.UtcNow;
        log.Subscription.UpdatedAt = DateTime.UtcNow;
        return true;
    }

    private static void ApplyConfiguredAuthHeaders(HttpRequestMessage request, PushProviderStatus provider)
    {
        if (!string.IsNullOrWhiteSpace(provider.BearerToken))
        {
            request.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", provider.BearerToken);
        }

        if (!string.IsNullOrWhiteSpace(provider.AuthHeaderName) &&
            !string.IsNullOrWhiteSpace(provider.AuthHeaderValue))
        {
            request.Headers.TryAddWithoutValidation(provider.AuthHeaderName, provider.AuthHeaderValue);
        }
    }

    private static void MarkPushFailed(PushNotificationLog log, string reason)
    {
        log.Status = PushStatus.Failed;
        log.ErrorMessage = reason;
    }

    private string? FirstConfiguredValue(params string[] keys)
    {
        foreach (var key in keys)
        {
            var value = _configuration[key];
            if (!string.IsNullOrWhiteSpace(value))
                return value;
        }

        return null;
    }

    private static Uri? TryCreateHttpUri(string? value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            ? uri
            : null;
    }

    private sealed class PushProviderStatus
    {
        public string Provider { get; init; } = "none";
        public bool Configured { get; init; }
        public Uri? Endpoint { get; init; }
        // FCM and Web-Push dispatch without a generic relay endpoint — FCM has its
        // own well-known URL, Web-Push uses per-subscription endpoint URLs.
        public bool CanDispatch =>
            Endpoint != null ||
            Provider == "fcm" ||
            Provider == "web-push";
        public string? FailureReason { get; init; }
        public string? AuthHeaderName { get; init; }
        public string? AuthHeaderValue { get; init; }
        public string? BearerToken { get; init; }
    }
}

public class PushDispatchProcessResult
{
    public int Attempted { get; set; }
    public int Sent { get; set; }
    public int Failed { get; set; }
    public bool ProviderConfigured { get; set; }
    public string Provider { get; set; } = "none";
}
