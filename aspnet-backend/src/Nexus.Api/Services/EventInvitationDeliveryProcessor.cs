// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventInvitationDeliveryBatchResult(int Claimed, int Completed, int Retrying, int DeadLettered);

public sealed class EventInvitationDeliveryProcessor(
    NexusDbContext db,
    IDataProtectionProvider protection,
    IEmailService email,
    PushNotificationService push,
    IPusherEventPublisher pusher,
    EventInvitationRecipientAuthorizer recipientAuthorizer,
    EventInvitationEvidenceHasher invitationHasher,
    EventNotificationPreferenceResolver notificationPreferences,
    IConfiguration configuration,
    ILogger<EventInvitationDeliveryProcessor> logger)
{
    private static readonly string[] Terminal = ["delivered", "suppressed", "failed_terminal"];
    private readonly IDataProtector _protector = protection.CreateProtector("nexus.event-registration-product.v1");

    public async Task<EventInvitationDeliveryBatchResult> ProcessBatchAsync(int maximum = 50, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var staleBefore = now.AddMinutes(-5);
        var outboxIds = await db.EventDomainOutbox.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.Action == "event.invitation.issued"
                && (x.Status == "pending" || x.Status == "retrying" || x.Status == "processing" && x.ClaimedAt <= staleBefore)
                && (x.AvailableAt == null || x.AvailableAt <= now)
                && (x.NextAttemptAt == null || x.NextAttemptAt <= now))
            .OrderBy(x => x.Id).Select(x => x.Id).Take(Math.Clamp(maximum, 1, 250)).ToListAsync(ct);
        var claimed = 0; var completed = 0; var retrying = 0; var dead = 0;
        foreach (var id in outboxIds)
        {
            var outcome = await ProcessOneAsync(id, ct);
            claimed += outcome == "ignored" ? 0 : 1;
            completed += outcome == "completed" ? 1 : 0;
            retrying += outcome == "retrying" ? 1 : 0;
            dead += outcome == "dead_lettered" ? 1 : 0;
        }
        return new(claimed, completed, retrying, dead);
    }

    private async Task<string> ProcessOneAsync(long outboxId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var staleBefore = now.AddMinutes(-5);
        var claimToken = Guid.NewGuid();
        var claimed = await db.EventDomainOutbox.IgnoreQueryFilters()
            .Where(x => x.Id == outboxId
                && x.Action == "event.invitation.issued"
                && (x.Status == "pending" || x.Status == "retrying" || x.Status == "processing" && x.ClaimedAt <= staleBefore)
                && (x.AvailableAt == null || x.AvailableAt <= now)
                && (x.NextAttemptAt == null || x.NextAttemptAt <= now))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.Status, "processing")
                .SetProperty(x => x.ClaimToken, claimToken)
                .SetProperty(x => x.ClaimedAt, now)
                .SetProperty(x => x.Attempts, x => (short)(x.Attempts + 1))
                .SetProperty(x => x.NextAttemptAt, (DateTime?)null)
                .SetProperty(x => x.UpdatedAt, now), ct);
        if (claimed != 1) return "ignored";
        db.ChangeTracker.Clear();
        var outbox = await db.EventDomainOutbox.IgnoreQueryFilters()
            .SingleAsync(x => x.Id == outboxId && x.ClaimToken == claimToken, ct);
        try
        {
            using var document = JsonDocument.Parse(outbox.Payload);
            var payload = document.RootElement;
            var invitationId = RequiredLong(payload, "invitation_id");
            var campaignId = RequiredLong(payload, "campaign_id");
            var invitationVersion = RequiredLong(payload, "invitation_version");
            var locale = RequiredString(payload, "recipient_locale");
            var invitation = await db.EventInvitations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == outbox.TenantId && x.EventId == outbox.EventId && x.CampaignId == campaignId && x.Id == invitationId, ct)
                ?? throw new InvalidOperationException("invitation_subject_missing");
            var campaign = await db.EventInvitationCampaigns.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == outbox.TenantId && x.EventId == outbox.EventId && x.Id == campaignId, ct)
                ?? throw new InvalidOperationException("campaign_subject_missing");
            var issuer = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == outbox.TenantId && x.Id == campaign.CreatedBy && x.IsActive, ct);
            var evt = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == outbox.TenantId && x.Id == outbox.EventId, ct)
                ?? throw new InvalidOperationException("event_subject_missing");
            var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.Id == outbox.TenantId && x.IsActive, ct)
                ?? throw new InvalidOperationException("tenant_subject_missing");
            var deliveries = await db.EventNotificationDeliveries.IgnoreQueryFilters().Where(x => x.TenantId == outbox.TenantId && x.OutboxId == outbox.Id).OrderBy(x => x.Id).ToListAsync(ct);
            if (deliveries.Count == 0) throw new InvalidOperationException("delivery_ledger_missing");
            var evidenceLocales = await db.EventInvitationDeliveryEvidence.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == outbox.TenantId && x.InvitationId == invitationId && x.OutboxId == outbox.Id && x.EvidenceVersion == 1)
                .Select(x => x.RecipientLocale).Distinct().ToListAsync(ct);
            if (evidenceLocales.Count != 1 || evidenceLocales[0] != locale) throw new InvalidOperationException("locale_evidence_invalid");

            int? userId = payload.TryGetProperty("recipient_user_id", out var userValue) && userValue.ValueKind == JsonValueKind.Number ? userValue.GetInt32() : null;
            User? recipient = null;
            if (userId is int memberId)
                recipient = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == outbox.TenantId && x.Id == memberId, ct);
            var active = invitation.Status == "issued" && invitation.InvitationVersion == invitationVersion && invitation.TokenExpiresAt > DateTime.UtcNow;
            var eligible = userId is null || recipient?.IsActive == true;
            if (!active || !eligible || issuer is null)
            {
                await SuppressAsync(deliveries, issuer is null ? "invitation_actor_ineligible" : !eligible ? "recipient_ineligible" : "invitation_not_active", ct);
                return await CompleteAsync(outbox, invitation, deliveries, ct);
            }
            if (userId is int target && invitation.UserId != target || userId is null && invitation.UserId is not null)
                throw new InvalidOperationException("delivery_target_invalid");
            var token = Unprotect(RequiredString(payload, "token_ciphertext")) ?? throw new InvalidOperationException("token_unavailable");
            if (invitation.TokenHash != invitationHasher.Token(outbox.TenantId, outbox.EventId, token)) throw new InvalidOperationException("token_evidence_invalid");
            var destinationEmail = userId is not null ? recipient!.Email : Unprotect(RequiredString(payload, "external_email_ciphertext"));
            if (userId is null && (destinationEmail is null || invitation.EmailBlindHash != invitationHasher.Email(outbox.TenantId, destinationEmail)))
                throw new InvalidOperationException("external_email_evidence_invalid");
            var targetDecision = await recipientAuthorizer.EvaluateAsync(
                outbox.TenantId, evt, issuer.Id, recipient?.Id, recipient is null ? destinationEmail : null, ct);
            if (targetDecision.IsUnavailable) throw new InvalidOperationException("invitation_target_policy_unavailable");
            if (!targetDecision.IsAllowed) { await SuppressAsync(deliveries, "invitation_target_ineligible", ct); return await CompleteAsync(outbox, invitation, deliveries, ct); }

            var title = $"Invitation to {evt.Title}";
            var message = $"You have been invited to {evt.Title}.";
            var link = $"/events/{outbox.EventId}?invitation={invitation.Id}";
            var emailLink = BuildTenantFrontendUrl(tenant, outbox.EventId, token, configuration);
            var livePreference = recipient is null ? null : await notificationPreferences.ResolveAsync(outbox.TenantId, recipient.Id, outbox.EventId, ct);
            foreach (var delivery in deliveries.Where(x => !Terminal.Contains(x.Status, StringComparer.Ordinal)))
            {
                if (!ConfiguredChannel(payload, delivery.Channel) || recipient is not null && !LivePreferenceAllows(livePreference, delivery.Channel))
                {
                    Suppress(delivery, "invitation_channel_disabled");
                    continue;
                }
                await DeliverAsync(delivery, outbox, recipient, destinationEmail, title, message, link, emailLink, locale, ct);
            }
            return await CompleteAsync(outbox, invitation, deliveries, ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Invitation outbox {OutboxId} could not be processed", outbox.Id);
            return await RetryOutboxAsync(outbox, Sanitise(exception.Message), ct);
        }
    }

    private static string BuildTenantFrontendUrl(Tenant tenant, int eventId, string token, IConfiguration configuration)
    {
        string origin;
        string slugPrefix;
        if (tenant.Id > 1 && !string.IsNullOrWhiteSpace(tenant.Domain))
        {
            var domain = tenant.Domain.Trim().TrimEnd('/');
            origin = domain.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                || domain.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                    ? domain
                    : $"https://{domain}";
            slugPrefix = string.Empty;
        }
        else
        {
            origin = (configuration["App:FrontendUrl"] ?? "https://app.project-nexus.ie").Trim().TrimEnd('/');
            slugPrefix = string.IsNullOrWhiteSpace(tenant.Slug) ? string.Empty : $"/{Uri.EscapeDataString(tenant.Slug)}";
        }

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed)
            || parsed.Scheme is not ("http" or "https"))
            throw new InvalidOperationException("frontend_url_invalid");

        return $"{origin}{slugPrefix}/events/{eventId}?invitation_token={Uri.EscapeDataString(token)}";
    }

    private async Task DeliverAsync(EventNotificationDelivery delivery, EventDomainOutbox outbox, User? recipient, string? destinationEmail, string title, string message, string link, string emailLink, string locale, CancellationToken ct)
    {
        delivery.Status = "processing"; delivery.ClaimToken = Guid.NewGuid(); delivery.ClaimedAt = DateTime.UtcNow; delivery.Attempts++; delivery.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        try
        {
            switch (delivery.Channel)
            {
                case "email":
                    if (string.IsNullOrWhiteSpace(destinationEmail)) { Suppress(delivery, "email_address_missing"); break; }
                    var successfulEmail = await db.EmailLogs.IgnoreQueryFilters().AsNoTracking()
                        .Where(x => x.TenantId == outbox.TenantId && x.IdempotencyKey == delivery.DeliveryKey && x.Status == EmailSendStatus.Sent)
                        .OrderByDescending(x => x.Id)
                        .FirstOrDefaultAsync(ct);
                    if (successfulEmail is not null)
                    {
                        Delivered(delivery, successfulEmail.Provider, successfulEmail.ProviderMessageId ?? $"email_log:{successfulEmail.Id}");
                        break;
                    }
                    var emailLog = await db.EmailLogs.IgnoreQueryFilters()
                        .SingleOrDefaultAsync(x => x.TenantId == outbox.TenantId && x.IdempotencyKey == delivery.DeliveryKey, ct);
                    if (emailLog is null)
                    {
                        emailLog = new EmailLog
                        {
                            TenantId = outbox.TenantId,
                            UserId = recipient?.Id,
                            ToEmail = destinationEmail,
                            Subject = title,
                            TemplateKey = "event_invitation",
                            IdempotencyKey = delivery.DeliveryKey,
                            Source = nameof(EventInvitationDeliveryProcessor),
                            Provider = "pending"
                        };
                        db.EmailLogs.Add(emailLog);
                    }
                    emailLog.Status = EmailSendStatus.Pending;
                    emailLog.ErrorMessage = null;
                    emailLog.RetryCount = Math.Max(0, delivery.Attempts - 1);
                    await db.SaveChangesAsync(ct);
                    var emailResult = await email.SendEmailWithEvidenceAsync(destinationEmail, title, $"<p>{System.Net.WebUtility.HtmlEncode(message)}</p><p><a href=\"{System.Net.WebUtility.HtmlEncode(emailLink)}\">View event</a></p>", $"{message} {emailLink}", delivery.DeliveryKey, ct);
                    emailLog.Provider = emailResult.Provider;
                    emailLog.ProviderMessageId = emailResult.ProviderMessageId;
                    emailLog.Status = emailResult.Accepted ? EmailSendStatus.Sent : EmailSendStatus.Failed;
                    emailLog.ErrorMessage = emailResult.Accepted ? null : Sanitise(emailResult.FailureReason ?? "email_provider_rejected");
                    emailLog.SentAt = emailResult.Accepted ? DateTime.UtcNow : null;
                    await db.SaveChangesAsync(ct);
                    if (!emailResult.Accepted) throw new InvalidOperationException(emailLog.ErrorMessage ?? "email_provider_rejected");
                    Delivered(delivery, emailResult.Provider, emailResult.ProviderMessageId ?? $"email_log:{emailLog.Id}"); break;
                case "in_app":
                    if (recipient is null) { Suppress(delivery, "internal_recipient_required"); break; }
                    db.Notifications.Add(new Notification { TenantId = outbox.TenantId, UserId = recipient.Id, Type = "event_invitation", Title = title, Body = message, Link = link, Data = JsonSerializer.Serialize(new { event_id = outbox.EventId, locale, delivery_key = delivery.DeliveryKey }) });
                    Delivered(delivery, "database", delivery.DeliveryKey); break;
                case "web_push":
                    if (recipient is null) { Suppress(delivery, "internal_recipient_required"); break; }
                    var previousPush = await db.Set<PushNotificationLog>().IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == outbox.TenantId && x.UserId == recipient.Id && x.Data != null && x.Data.Contains(delivery.DeliveryKey)).ToListAsync(ct);
                    if (previousPush.Any(x => x.Status == PushStatus.Sent)) { Delivered(delivery, "push", previousPush.First(x => x.Status == PushStatus.Sent).Id.ToString()); break; }
                    if (await push.SendPushChannelAsync(recipient.Id, title, message, JsonSerializer.Serialize(new { link, type = "event_invitation", locale, delivery_key = delivery.DeliveryKey }), "web-push", outbox.TenantId) < 1) { Suppress(delivery, "web_push_destination_missing"); break; }
                    var pushResult = await push.ProcessPendingPushNotificationsAsync(500, ct);
                    var pushEvidence = await db.Set<PushNotificationLog>().IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == outbox.TenantId && x.UserId == recipient.Id && x.Data != null && x.Data.Contains(delivery.DeliveryKey)).OrderByDescending(x => x.Id).FirstOrDefaultAsync(ct);
                    if (pushEvidence?.Status != PushStatus.Sent) throw new InvalidOperationException(pushEvidence?.ErrorMessage ?? $"{pushResult.Provider}_push_provider_rejected");
                    Delivered(delivery, pushResult.Provider, pushEvidence.Id.ToString()); break;
                case "fcm":
                    if (recipient is null) { Suppress(delivery, "internal_recipient_required"); break; }
                    var previousFcm = await db.Set<PushNotificationLog>().IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == outbox.TenantId && x.UserId == recipient.Id && x.Data != null && x.Data.Contains(delivery.DeliveryKey)).ToListAsync(ct);
                    if (previousFcm.Any(x => x.Status == PushStatus.Sent)) { Delivered(delivery, "fcm", previousFcm.First(x => x.Status == PushStatus.Sent).Id.ToString()); break; }
                    if (await push.SendPushChannelAsync(recipient.Id, title, message, JsonSerializer.Serialize(new { link, type = "event_invitation", locale, delivery_key = delivery.DeliveryKey }), "fcm", outbox.TenantId) < 1) { Suppress(delivery, "fcm_destination_missing"); break; }
                    var fcmResult = await push.ProcessPendingPushNotificationsAsync(500, ct);
                    var fcmEvidence = await db.Set<PushNotificationLog>().IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == outbox.TenantId && x.UserId == recipient.Id && x.Data != null && x.Data.Contains(delivery.DeliveryKey)).OrderByDescending(x => x.Id).FirstOrDefaultAsync(ct);
                    if (fcmEvidence?.Status != PushStatus.Sent) throw new InvalidOperationException(fcmEvidence?.ErrorMessage ?? $"{fcmResult.Provider}_push_provider_rejected");
                    Delivered(delivery, "fcm", fcmEvidence.Id.ToString()); break;
                case "realtime":
                    if (recipient is null) { Suppress(delivery, "internal_recipient_required"); break; }
                    if (!await pusher.TriggerAsync($"private-user-{recipient.Id}", "event-notification", new { type = "event_invitation", message, link }, ct)) { Suppress(delivery, "realtime_provider_unconfigured"); break; }
                    Delivered(delivery, "pusher", delivery.DeliveryKey); break;
                default: Suppress(delivery, "channel_unsupported"); break;
            }
            await db.SaveChangesAsync(ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            delivery.LastError = Sanitise(exception.Message); delivery.ClaimToken = null; delivery.ClaimedAt = null; delivery.UpdatedAt = DateTime.UtcNow;
            if (delivery.Attempts >= 5) { delivery.Status = "failed_terminal"; delivery.DeadLetteredAt = DateTime.UtcNow; }
            else { delivery.Status = "retrying"; delivery.NextAttemptAt = DateTime.UtcNow.AddSeconds(Math.Pow(2, delivery.Attempts) * 15); }
            await db.SaveChangesAsync(ct);
        }
    }

    private async Task<string> CompleteAsync(EventDomainOutbox outbox, EventInvitation invitation, IReadOnlyCollection<EventNotificationDelivery> deliveries, CancellationToken ct)
    {
        foreach (var delivery in deliveries.Where(x => Terminal.Contains(x.Status, StringComparer.Ordinal)))
            await AppendTerminalEvidenceAsync(outbox, invitation, delivery, ct);
        if (deliveries.Any(x => !Terminal.Contains(x.Status, StringComparer.Ordinal)))
            return await RetryOutboxAsync(outbox, "delivery_retry_required", ct);
        outbox.Status = "processed"; outbox.ProcessedAt = DateTime.UtcNow; outbox.ClaimToken = null; outbox.ClaimedAt = null; outbox.NextAttemptAt = null; outbox.LastError = null; outbox.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); return "completed";
    }

    private async Task AppendTerminalEvidenceAsync(EventDomainOutbox outbox, EventInvitation invitation, EventNotificationDelivery delivery, CancellationToken ct)
    {
        if (await db.EventInvitationDeliveryEvidence.IgnoreQueryFilters().AnyAsync(x => x.TenantId == outbox.TenantId && x.NotificationDeliveryId == delivery.Id && x.EvidenceVersion == 2, ct)) return;
        var initial = await db.EventInvitationDeliveryEvidence.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.TenantId == outbox.TenantId && x.InvitationId == invitation.Id && x.Channel == delivery.Channel && x.EvidenceVersion == 1, ct);
        var status = delivery.Status == "delivered" ? "delivered" : delivery.Status == "suppressed" ? "suppressed" : "failed";
        db.EventInvitationDeliveryEvidence.Add(new EventInvitationDeliveryEvidence { TenantId = outbox.TenantId, EventId = outbox.EventId, CampaignId = invitation.CampaignId, InvitationId = invitation.Id, OutboxId = outbox.Id, NotificationDeliveryId = delivery.Id, EvidenceVersion = 2, Channel = delivery.Channel, Status = status, RecipientHash = initial.RecipientHash, RecipientLocale = initial.RecipientLocale, PreferenceDecision = initial.PreferenceDecision, PreferenceReason = initial.PreferenceReason, ProviderEvidenceId = delivery.ProviderEvidenceId, FailureCode = status == "failed" ? Sanitise(delivery.LastError ?? "delivery_failed") : null, DeliveredAt = status == "delivered" ? delivery.DeliveredAt ?? DateTime.UtcNow : null, IdempotencyHash = Sha256($"terminal|{outbox.TenantId}|{invitation.Id}|{delivery.Channel}|{status}") });
        await db.SaveChangesAsync(ct);
    }

    private async Task SuppressAsync(IEnumerable<EventNotificationDelivery> deliveries, string reason, CancellationToken ct) { foreach (var delivery in deliveries.Where(x => !Terminal.Contains(x.Status, StringComparer.Ordinal))) Suppress(delivery, reason); await db.SaveChangesAsync(ct); }
    private static bool ConfiguredChannel(JsonElement payload, string channel) => payload.TryGetProperty("channels", out var channels)
        && channels.ValueKind == JsonValueKind.Object && channels.TryGetProperty(channel, out var configured) && configured.ValueKind == JsonValueKind.True;
    private static bool LivePreferenceAllows(EventNotificationPreferenceResolution? preference, string channel) => channel switch
    {
        "email" => preference?.Allows("email") == true && preference.Cadence == "instant",
        "in_app" => preference?.Allows("in_app") == true,
        "realtime" => preference?.Allows("realtime") == true,
        "web_push" => preference?.Allows("web_push") == true,
        "fcm" => preference?.Allows("fcm") == true,
        _ => false
    };
    private static void Suppress(EventNotificationDelivery delivery, string reason) { delivery.Status = "suppressed"; delivery.SuppressionReason = reason; delivery.SuppressedAt = DateTime.UtcNow; delivery.ClaimToken = null; delivery.ClaimedAt = null; delivery.UpdatedAt = DateTime.UtcNow; }
    private static void Delivered(EventNotificationDelivery delivery, string provider, string evidence) { delivery.Status = "delivered"; delivery.Provider = provider; delivery.ProviderEvidenceId = evidence; delivery.DeliveredAt = DateTime.UtcNow; delivery.ClaimToken = null; delivery.ClaimedAt = null; delivery.LastError = null; delivery.UpdatedAt = DateTime.UtcNow; }
    private async Task<string> RetryOutboxAsync(EventDomainOutbox outbox, string error, CancellationToken ct) { outbox.LastError = error; outbox.ClaimToken = null; outbox.ClaimedAt = null; outbox.UpdatedAt = DateTime.UtcNow; if (outbox.Attempts >= 5) { outbox.Status = "dead_lettered"; outbox.DeadLetteredAt = DateTime.UtcNow; await db.SaveChangesAsync(ct); return "dead_lettered"; } outbox.Status = "retrying"; outbox.NextAttemptAt = DateTime.UtcNow.AddSeconds(Math.Pow(2, outbox.Attempts) * 15); await db.SaveChangesAsync(ct); return "retrying"; }
    private string? Unprotect(string value) { try { return _protector.Unprotect(value); } catch { return null; } }
    private static long RequiredLong(JsonElement payload, string name) => payload.TryGetProperty(name, out var value) && value.TryGetInt64(out var parsed) && parsed > 0 ? parsed : throw new InvalidOperationException($"{name}_invalid");
    private static string RequiredString(JsonElement payload, string name) => payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()) ? value.GetString()! : throw new InvalidOperationException($"{name}_invalid");
    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string Sanitise(string value) { var cleaned = new string(value.Where(x => !char.IsControl(x)).ToArray()).Trim(); return cleaned.Length <= 500 ? cleaned : cleaned[..500]; }
}

public sealed class EventInvitationDeliveryWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<EventInvitationDeliveryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (configuration.GetValue<bool>("BackgroundServices:SuppressAutomaticExecution")) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try { using var scope = scopes.CreateScope(); await scope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>().ProcessBatchAsync(50, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogError(exception, "Invitation delivery worker iteration failed"); }
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
