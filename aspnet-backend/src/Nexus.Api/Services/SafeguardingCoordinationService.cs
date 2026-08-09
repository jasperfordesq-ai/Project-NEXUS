// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record SafeguardingCoordinationResult(bool Succeeded, string Code, string? Message = null);

/// <summary>
/// Delivers an explicit request for staff-mediated contact only when the canonical
/// safeguarding policy currently prevents direct contact.
/// </summary>
public sealed class SafeguardingCoordinationService
{
    private static readonly string[] StaffRoles = ["admin", "tenant_admin", "broker", "super_admin"];
    private static readonly TimeSpan SuccessfulDeliveryWindow = TimeSpan.FromMinutes(10);
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _policy;
    private readonly IEmailService _email;
    private readonly ILogger<SafeguardingCoordinationService> _logger;

    public SafeguardingCoordinationService(
        NexusDbContext db,
        SafeguardingInteractionPolicy policy,
        IEmailService email,
        ILogger<SafeguardingCoordinationService> logger)
    {
        _db = db;
        _policy = policy;
        _email = email;
        _logger = logger;
    }

    public async Task<SafeguardingCoordinationResult> RequestAsync(
        int tenantId,
        int senderId,
        int recipientId,
        string? ipAddress,
        string? userAgent,
        CancellationToken cancellationToken = default)
    {
        if (recipientId <= 0 || senderId == recipientId)
            return Failed("VALIDATION_ERROR", "A different message recipient is required.");

        var users = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => user.TenantId == tenantId && (user.Id == senderId || user.Id == recipientId))
            .ToDictionaryAsync(user => user.Id, cancellationToken);
        if (!users.TryGetValue(recipientId, out var recipient))
            return Failed("NOT_FOUND", "Message recipient not found.");
        if (!users.TryGetValue(senderId, out var sender))
            return Failed("NOT_FOUND", "Message sender not found.");

        var decision = await _policy.EvaluateLocalContactAsync(
            senderId, recipientId, tenantId, "direct_message", cancellationToken);
        if (decision.IsAllowed)
            return Failed("SAFEGUARDING_NOT_RESTRICTED", "Coordinator assistance is not required for this recipient.");
        if (decision.IsUnavailable)
            return Failed("SAFEGUARDING_POLICY_UNAVAILABLE", "Safeguarding policy is temporarily unavailable.");
        if (decision.Code is not ("VETTING_REQUIRED" or "SAFEGUARDING_CONTACT_RESTRICTED"))
            return Failed("SAFEGUARDING_NOT_RESTRICTED", "Coordinator assistance is not required for this recipient.");

        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
            if (_db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true)
            {
                var lockKey = $"{tenantId}:{senderId}:{recipientId}:{decision.Code}";
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))",
                    cancellationToken);
            }

            var now = DateTime.UtcNow;
            var signature = JsonSerializer.Serialize(new
            {
                sender_id = senderId,
                recipient_id = recipientId,
                reason_code = decision.Code,
                required_vetting_types = decision.RequiredAttestationCodes ?? []
            });
            var alreadyDelivered = await _db.Notifications.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(notification => notification.TenantId == tenantId
                    && notification.Type == "safeguarding_coordination_requested"
                    && notification.Data == signature
                    && notification.CreatedAt >= now - SuccessfulDeliveryWindow,
                    cancellationToken);

            if (!alreadyDelivered)
            {
                var staff = await _db.Users.IgnoreQueryFilters().AsNoTracking()
                    .Where(user => user.TenantId == tenantId
                        && user.IsActive
                        && StaffRoles.Contains(user.Role))
                    .OrderBy(user => user.Id)
                    .ToListAsync(cancellationToken);
                var senderName = DisplayName(sender, "A member");
                var recipientName = DisplayName(recipient, "a restricted member");
                var link = $"/broker/safeguarding?user={recipientId}";

                foreach (var member in staff)
                {
                    _db.Notifications.Add(new Notification
                    {
                        TenantId = tenantId,
                        UserId = member.Id,
                        Type = "safeguarding_coordination_requested",
                        Title = "Coordinator assistance requested",
                        Body = $"{senderName} requested help arranging contact with {recipientName}.",
                        Data = signature,
                        Link = link,
                        CreatedAt = now
                    });

                    if (!string.IsNullOrWhiteSpace(member.Email))
                    {
                        var sent = await _email.SendEmailAsync(
                            member.Email,
                            $"Coordinator assistance requested for {recipientName}",
                            EmailBody(member, senderName, recipientName, decision, link),
                            $"{senderName} requested coordinator assistance to contact {recipientName}. Review: {link}",
                            cancellationToken);
                        if (!sent)
                            throw new InvalidOperationException($"Coordinator-assistance email failed for staff user {member.Id}.");
                    }
                }
            }

            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            await transaction.DisposeAsync();
            await AuditBestEffortAsync(
                tenantId,
                senderId,
                recipientId,
                decision,
                ipAddress,
                userAgent,
                now,
                cancellationToken);
            return new(true, decision.Code);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogCritical(exception,
                "Failed to deliver safeguarding coordination request for tenant {TenantId}, sender {SenderId}, recipient {RecipientId}",
                tenantId, senderId, recipientId);
            return Failed("COORDINATION_REQUEST_FAILED", "The coordinator request could not be delivered. Please try again.");
        }
    }

    private static SafeguardingCoordinationResult Failed(string code, string message) => new(false, code, message);

    private async Task AuditBestEffortAsync(
        int tenantId,
        int senderId,
        int recipientId,
        SafeguardingInteractionDecision decision,
        string? ipAddress,
        string? userAgent,
        DateTime now,
        CancellationToken cancellationToken)
    {
        try
        {
            _db.AuditLogs.Add(new AuditLog
            {
                TenantId = tenantId,
                UserId = senderId,
                Action = "safeguarding_coordination_requested",
                EntityType = "user",
                EntityId = recipientId,
                Metadata = JsonSerializer.Serialize(new
                {
                    reason_code = decision.Code,
                    required_vetting_types = decision.RequiredAttestationCodes ?? []
                }),
                IpAddress = ipAddress,
                UserAgent = string.IsNullOrWhiteSpace(userAgent)
                    ? null
                    : userAgent[..Math.Min(500, userAgent.Length)],
                CreatedAt = now
            });
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(exception,
                "Failed to audit safeguarding coordination request for tenant {TenantId}, sender {SenderId}, recipient {RecipientId}",
                tenantId, senderId, recipientId);
        }
    }

    private static string DisplayName(User user, string fallback)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? fallback : name;
    }

    private static string EmailBody(
        User staff,
        string senderName,
        string recipientName,
        SafeguardingInteractionDecision decision,
        string link)
    {
        var staffName = WebUtility.HtmlEncode(DisplayName(staff, "Coordinator"));
        var sender = WebUtility.HtmlEncode(senderName);
        var recipient = WebUtility.HtmlEncode(recipientName);
        var reason = WebUtility.HtmlEncode(decision.Code);
        var vetting = WebUtility.HtmlEncode(string.Join(", ", decision.RequiredAttestationLabels ?? []));
        var href = WebUtility.HtmlEncode(link);
        return $"<p>Hello {staffName},</p><p>{sender} requested coordinator assistance to contact {recipient}.</p>"
            + $"<p><strong>Reason:</strong> {reason}<br><strong>Required vetting:</strong> {(vetting.Length == 0 ? "None" : vetting)}</p>"
            + $"<p><a href=\"{href}\">Review safeguarding details</a></p>";
    }
}
