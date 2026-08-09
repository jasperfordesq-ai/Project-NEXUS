// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed partial class EventRegistrationProductService
{
    private static readonly string[] InvitationChannels = ["email", "in_app", "web_push", "fcm", "realtime"];

    private async Task<object> QueueInvitationAsync(int tenantId, int eventId, EventInvitationCampaign campaign, int? userId, string? externalEmail, DateTime expires, CancellationToken ct)
    {
        var token = "nxi1_" + Base64Url(RandomNumberGenerator.GetBytes(32));
        var recipient = userId is int memberId
            ? await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == memberId, ct)
            : null;
        if (userId is not null && recipient is null) throw new InvalidOperationException("invitation_recipient_missing");
        var locale = GuestLocale(recipient?.PreferredLanguage) ?? GuestLocale(campaign.DefaultLocale) ?? "en";
        var invitation = new EventInvitation
        {
            TenantId = tenantId, EventId = eventId, CampaignId = campaign.Id, UserId = userId,
            EmailCiphertext = externalEmail is null ? null : Protect(externalEmail),
            EmailBlindHash = externalEmail is null ? null : invitationHasher.Email(tenantId, externalEmail), TokenHash = invitationHasher.Token(tenantId, eventId, token),
            TokenPrefix = invitationHasher.Token(tenantId, eventId, token)[..16], Locale = locale, TokenExpiresAt = expires
        };
        db.Add(invitation); await db.SaveChangesAsync(ct);

        var preference = userId is int target
            ? await notificationPreferences.ResolveAsync(tenantId, target, eventId, ct)
            : null;
        var eligible = recipient?.IsActive ?? userId is null;
        var channels = new Dictionary<string, bool>(StringComparer.Ordinal)
        {
            ["email"] = userId is null || eligible && preference?.Allows("email") == true && preference.Cadence == "instant" && !string.IsNullOrWhiteSpace(recipient?.Email),
            ["in_app"] = userId is not null && eligible && preference?.Allows("in_app") == true,
            ["web_push"] = userId is not null && eligible && preference?.Allows("web_push") == true,
            ["fcm"] = userId is not null && eligible && preference?.Allows("fcm") == true,
            ["realtime"] = userId is not null && eligible && preference?.Allows("realtime") == true
        };
        var now = DateTime.UtcNow;
        var externalHash = externalEmail is null ? null : invitationHasher.Email(tenantId, externalEmail);
        var outbox = new EventDomainOutbox
        {
            TenantId = tenantId, EventId = eventId, AggregateStream = $"event:{eventId}:invitation:{invitation.Id}",
            AggregateVersion = invitation.InvitationVersion, Action = "event.invitation.issued",
            IdempotencyKey = $"event-invitation:{tenantId}:{eventId}:{invitation.Id}:{invitation.InvitationVersion}",
            ProductionMode = "outbox_authoritative", Status = "pending", AvailableAt = now,
            Payload = JsonSerializer.Serialize(new
            {
                schema_version = 1, tenant_id = tenantId, event_id = eventId, campaign_id = campaign.Id,
                invitation_id = invitation.Id, invitation_version = invitation.InvitationVersion,
                recipient_user_id = userId, external_recipient_hash = externalHash,
                external_email_ciphertext = invitation.EmailCiphertext, recipient_locale = locale,
                token_ciphertext = Protect(token), token_expires_at = expires, channels
            }), CreatedAt = now, UpdatedAt = now
        };
        db.Add(outbox); await db.SaveChangesAsync(ct);

        foreach (var channel in InvitationChannels)
        {
            EventNotificationDelivery? delivery = null;
            if (userId is not null || channel == "email")
            {
                var allowed = channels[channel];
                delivery = new EventNotificationDelivery
                {
                    TenantId = tenantId, OutboxId = outbox.Id, RecipientUserId = userId,
                    ExternalRecipientHash = userId is null ? externalHash : null, Channel = channel,
                    DeliveryKey = Hash($"event-invitation-delivery|{tenantId}|{eventId}|{invitation.Id}|{invitation.InvitationVersion}|{userId}|{externalHash}|{channel}"),
                    Status = allowed ? "pending" : "suppressed",
                    PreferenceReason = userId is null ? "external_invitation" : eligible ? "event_notification_preferences" : "recipient_ineligible",
                    SuppressionReason = allowed ? null : userId is null ? "external_channel_unavailable" : eligible ? "invitation_channel_disabled" : "recipient_ineligible",
                    SuppressedAt = allowed ? null : now, CreatedAt = now, UpdatedAt = now
                };
                db.Add(delivery); await db.SaveChangesAsync(ct);
            }
            var allowedForEvidence = channels[channel];
            db.Add(new EventInvitationDeliveryEvidence
            {
                TenantId = tenantId, EventId = eventId, CampaignId = campaign.Id, InvitationId = invitation.Id,
                OutboxId = outbox.Id, NotificationDeliveryId = delivery?.Id, EvidenceVersion = 1, Channel = channel,
                Status = allowedForEvidence ? "queued" : "suppressed", RecipientHash = userId is int member ? Hash($"user:{member}") : externalHash!,
                RecipientLocale = locale, PreferenceDecision = allowedForEvidence ? "deliver" : "suppressed",
                PreferenceReason = delivery?.PreferenceReason ?? "external_channel_unavailable",
                IdempotencyHash = Hash($"event-invitation-evidence|{tenantId}|{invitation.Id}|{invitation.InvitationVersion}|{channel}|1")
            });
        }
        await db.SaveChangesAsync(ct);
        return new { invitation = InvitationProjection(invitation), delivery_queued = channels.Values.Any(x => x) };
    }
}
