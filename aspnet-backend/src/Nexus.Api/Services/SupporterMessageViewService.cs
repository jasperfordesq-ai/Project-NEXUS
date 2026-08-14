// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Support.Safeguarding;

namespace Nexus.Api.Services;

/// <summary>
/// Supervised message viewing — Laravel parity for
/// SupporterMessageViewService. A supporter holding the consented messages
/// tier (capped at assist) may LIST and READ the supported member's message
/// threads, and nothing else:
/// - a non-blank purpose (max 500 chars) is required on every view;
/// - the immutable audit row is written BEFORE any data is fetched;
/// - reads run AS the member: their deleted messages stay invisible;
/// - unread counts are stripped and nothing is ever marked read;
/// - there is deliberately NO write route under this surface.
/// </summary>
public class SupporterMessageViewService
{
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly ILogger<SupporterMessageViewService> _logger;
    private readonly List<object> _errors = [];

    public SupporterMessageViewService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        ILogger<SupporterMessageViewService> logger)
    {
        _db = db;
        _safeguarding = safeguarding;
        _logger = logger;
    }

    public IReadOnlyList<object> Errors => _errors;

    public async Task<object?> ListConversationsAsync(
        int supporterUserId, int supportedUserId, string? purpose, int limit,
        CancellationToken ct)
    {
        var relationship = await AuthorizeAsync(supporterUserId, supportedUserId, purpose, ct);
        if (relationship is null) return null;

        // Audit BEFORE fetching: there can never be a view without its record.
        await WriteAuditAsync(relationship, supporterUserId, supportedUserId,
            SupporterMessageViewAudit.ActionList, null, purpose!, ct);

        limit = Math.Max(1, Math.Min(limit, 50));
        var conversations = await _db.Conversations
            .AsNoTracking()
            .Where(c => c.Participant1Id == supportedUserId || c.Participant2Id == supportedUserId)
            .Select(c => new
            {
                c.Id,
                PartnerId = c.Participant1Id == supportedUserId ? c.Participant2Id : c.Participant1Id,
                c.CreatedAt,
                LastMessage = c.Messages
                    .Where(m => !m.IsDeleted
                        && (m.SenderId == supportedUserId ? !m.IsDeletedSender : !m.IsDeletedReceiver))
                    .OrderByDescending(m => m.Id)
                    .Select(m => new { m.Id, m.Content, m.CreatedAt })
                    .FirstOrDefault()
            })
            .ToListAsync(ct);

        var ordered = conversations
            .OrderByDescending(c => c.LastMessage?.Id ?? 0)
            .Take(limit + 1)
            .ToList();
        var hasMore = ordered.Count > limit;
        if (hasMore) ordered = ordered.Take(limit).ToList();

        var partnerIds = ordered.Select(c => c.PartnerId).Distinct().ToArray();
        var partners = await _db.Users.AsNoTracking()
            .Where(u => partnerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        var rows = ordered.Select(c => (object)new
        {
            partner_id = c.PartnerId,
            other_user = partners.TryGetValue(c.PartnerId, out var partner)
                ? new
                {
                    id = partner.Id,
                    name = $"{partner.FirstName} {partner.LastName}".Trim(),
                    first_name = partner.FirstName,
                    last_name = partner.LastName,
                    avatar_url = partner.AvatarUrl
                }
                : null,
            last_message = c.LastMessage is null
                ? null
                : new
                {
                    body = c.LastMessage.Content,
                    created_at = c.LastMessage.CreatedAt.ToString("yyyy-MM-dd'T'HH:mm:ssK")
                },
            created_at = c.CreatedAt.ToString("yyyy-MM-dd'T'HH:mm:ssK")
            // Deliberately NO unread_count: the supporter must never learn
            // what the member has or has not read.
        }).ToList();

        return new
        {
            conversations = rows,
            cursor = (string?)null,
            has_more = hasMore
        };
    }

    public async Task<object?> ShowThreadAsync(
        int supporterUserId, int supportedUserId, int partnerUserId, string? purpose, int limit,
        CancellationToken ct)
    {
        var relationship = await AuthorizeAsync(supporterUserId, supportedUserId, purpose, ct);
        if (relationship is null) return null;

        await WriteAuditAsync(relationship, supporterUserId, supportedUserId,
            SupporterMessageViewAudit.ActionRead, partnerUserId, purpose!, ct);

        var conversation = await _db.Conversations
            .AsNoTracking()
            .FirstOrDefaultAsync(c =>
                (c.Participant1Id == supportedUserId && c.Participant2Id == partnerUserId)
                || (c.Participant1Id == partnerUserId && c.Participant2Id == supportedUserId), ct);
        if (conversation is null)
        {
            _errors.Add(new { code = "NOT_FOUND", message = "Conversation not found" });
            return null;
        }

        limit = Math.Max(1, Math.Min(limit, 100));
        // Read AS the member: their per-message deletions stay deleted, and
        // nothing is ever marked read.
        var messages = await _db.Messages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversation.Id && !m.IsDeleted)
            .Where(m => m.SenderId == supportedUserId ? !m.IsDeletedSender : !m.IsDeletedReceiver)
            .OrderByDescending(m => m.Id)
            .Take(limit)
            .ToListAsync(ct);
        messages.Reverse();

        var senderIds = messages.Select(m => m.SenderId).Distinct().ToArray();
        var senders = await _db.Users.AsNoTracking()
            .Where(u => senderIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        return new
        {
            items = messages.Select(m => (object)new
            {
                id = m.Id,
                sender_id = m.SenderId,
                receiver_id = m.SenderId == supportedUserId ? partnerUserId : supportedUserId,
                body = m.Content,
                is_voice = false,
                created_at = m.CreatedAt.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
                sender = senders.TryGetValue(m.SenderId, out var sender)
                    ? new
                    {
                        id = sender.Id,
                        first_name = sender.FirstName,
                        last_name = sender.LastName,
                        avatar_url = sender.AvatarUrl
                    }
                    : null
            }).ToList()
        };
    }

    private async Task<AccountRelationship?> AuthorizeAsync(
        int supporterUserId, int supportedUserId, string? purpose, CancellationToken ct)
    {
        _errors.Clear();
        if (string.IsNullOrWhiteSpace(purpose) || purpose.Trim().Length > 500)
        {
            _errors.Add(new
            {
                code = "VALIDATION_ERROR",
                message = "Say why you are viewing these messages"
            });
            return null;
        }

        var relationship = await _db.AccountRelationships
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.ParentUserId == supporterUserId
                && r.ChildUserId == supportedUserId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null
            || !SupportTiers.AtLeast(
                AccountRelationshipService.ResolvedTiers(relationship),
                "messages", SupportTiers.Assist))
        {
            _errors.Add(new
            {
                code = "FORBIDDEN",
                message = "You do not have permission to do this for that account"
            });
            return null;
        }

        try
        {
            // A safeguarding restriction beats an active grant.
            await _safeguarding.AssertLocalContactAllowedAsync(
                supporterUserId, supportedUserId, relationship.TenantId,
                "supporter_message_view", ct);
        }
        catch (Exception ex)
        {
            _errors.Add(new { code = "FORBIDDEN", message = ex.Message });
            return null;
        }

        return relationship;
    }

    /// <summary>The audit write is load-bearing: if it fails, the view fails.</summary>
    private async Task WriteAuditAsync(
        AccountRelationship relationship, int supporterUserId, int supportedUserId,
        string action, int? partnerUserId, string purpose, CancellationToken ct)
    {
        var trimmedPurpose = purpose.Trim();
        _db.SupporterMessageViewAudits.Add(new SupporterMessageViewAudit
        {
            TenantId = relationship.TenantId,
            RelationshipId = relationship.Id,
            SupporterUserId = supporterUserId,
            SupportedUserId = supportedUserId,
            PartnerUserId = partnerUserId,
            Action = action,
            Purpose = trimmedPurpose,
            CorrelationHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                $"{relationship.TenantId}|{supporterUserId}|{supportedUserId}|{partnerUserId}|{trimmedPurpose}|{DateTime.UtcNow:yyyy-MM-dd}")))
                .ToLowerInvariant(),
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
    }

}
