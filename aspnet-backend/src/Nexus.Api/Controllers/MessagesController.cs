// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Messages controller - conversations and message history.
/// Phase 6: READ operations. Phase 7: WRITE operations.
/// </summary>
[ApiController]
[Route("api/messages")]
[Authorize]
public class MessagesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<MessagesController> _logger;
    private readonly IRealTimeMessagingService _realTimeMessaging;
    private readonly FileUploadService _fileUploadService;
    private readonly SafeguardingInteractionPolicy _safeguardingInteractionPolicy;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly DirectMessageReactionService _messageReactions;

    public MessagesController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<MessagesController> logger,
        IRealTimeMessagingService realTimeMessaging,
        FileUploadService fileUploadService,
        SafeguardingInteractionPolicy safeguardingInteractionPolicy,
        DirectMessageReactionService messageReactions,
        IServiceScopeFactory scopeFactory)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _realTimeMessaging = realTimeMessaging;
        _fileUploadService = fileUploadService;
        _safeguardingInteractionPolicy = safeguardingInteractionPolicy;
        _messageReactions = messageReactions;
        _scopeFactory = scopeFactory;
    }

    /// <summary>
    /// Get all conversations for the current user.
    /// Returns conversations with the other participant's info and last message preview.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetConversations(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery(Name = "per_page")] int? perPage = null,
        [FromQuery] bool archived = false)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (perPage.HasValue)
        {
            limit = perPage.Value;
        }

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var currentUserId = userId.Value;

        // Laravel's inbox is a per-user view over message rows. A normalized
        // conversation appears only when it has a message whose archive marker
        // matches the requested active/archived tab for the current user.
        var query = _db.Conversations
            .Include(c => c.Participant1)
            .Include(c => c.Participant2)
            .Where(c => c.Participant1Id == currentUserId || c.Participant2Id == currentUserId)
            .Where(c => c.Messages.Any(message => archived
                ? (message.SenderId == currentUserId
                    ? message.ArchivedBySender != null
                    : message.ArchivedByReceiver != null)
                : (message.SenderId == currentUserId
                    ? message.ArchivedBySender == null
                    : message.ArchivedByReceiver == null)))
            .OrderByDescending(c => c.Messages
                .Where(message => archived
                    ? (message.SenderId == currentUserId
                        ? message.ArchivedBySender != null
                        : message.ArchivedByReceiver != null)
                    : (message.SenderId == currentUserId
                        ? message.ArchivedBySender == null
                        : message.ArchivedByReceiver == null))
                .Max(message => (int?)message.Id));

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var conversations = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        // Resolve the latest message in the selected per-user view without
        // loading every historical row in each normalized conversation.
        var conversationIds = conversations.Select(c => c.Id).ToList();
        var visibleMessages = _db.Messages.Where(message =>
            conversationIds.Contains(message.ConversationId)
            && (archived
                ? (message.SenderId == currentUserId
                    ? message.ArchivedBySender != null
                    : message.ArchivedByReceiver != null)
                : (message.SenderId == currentUserId
                    ? message.ArchivedBySender == null
                    : message.ArchivedByReceiver == null)));
        var latestMessageIds = await visibleMessages
            .GroupBy(message => message.ConversationId)
            .Select(group => group.Max(message => message.Id))
            .ToArrayAsync();
        var lastMessages = await _db.Messages
            .Where(message => latestMessageIds.Contains(message.Id))
            .ToDictionaryAsync(message => message.ConversationId);

        // Archived or receiver-hidden messages do not contribute to unread
        // badges, even when the caller is currently viewing the archive tab.
        var unreadCounts = await _db.Messages
            .Where(m => conversationIds.Contains(m.ConversationId)
                && m.SenderId != currentUserId
                && !m.IsRead
                && m.ArchivedByReceiver == null
                && !m.IsDeletedReceiver
                && !m.IsDeleted)
            .GroupBy(m => m.ConversationId)
            .Select(g => new { ConversationId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ConversationId, x => x.Count);

        var result = conversations.Select(c =>
        {
            var otherParticipant = c.Participant1Id == currentUserId ? c.Participant2 : c.Participant1;
            lastMessages.TryGetValue(c.Id, out var lastMessage);
            unreadCounts.TryGetValue(c.Id, out var unreadCount);

            var otherUser = new
            {
                id = otherParticipant?.Id,
                name = $"{otherParticipant?.FirstName} {otherParticipant?.LastName}".Trim(),
                first_name = otherParticipant?.FirstName,
                last_name = otherParticipant?.LastName,
                avatar_url = otherParticipant?.AvatarUrl
            };

            var preview = lastMessage == null ? null : lastMessage.Content.Length > 100
                ? lastMessage.Content[..100] + "..."
                : lastMessage.Content;

            return new
            {
                // Laravel addresses a direct conversation by the partner user,
                // not by its internal normalized conversation row.
                id = IsLaravelV2Request() ? otherParticipant?.Id : c.Id,
                conversation_id = c.Id,
                partner_id = otherParticipant?.Id,
                participant = new
                {
                    id = otherParticipant?.Id,
                    first_name = otherParticipant?.FirstName,
                    last_name = otherParticipant?.LastName
                },
                other_user = otherUser,
                last_message = lastMessage == null ? null : new
                {
                    id = lastMessage.Id,
                    content = preview,
                    body = preview,
                    sender_id = lastMessage.SenderId,
                    is_read = lastMessage.IsRead,
                    created_at = lastMessage.CreatedAt
                },
                unread_count = unreadCount,
                created_at = c.CreatedAt,
                updated_at = c.UpdatedAt
            };
        });

        return Ok(new
        {
            success = true,
            data = result,
            meta = new
            {
                per_page = limit,
                has_more = page < totalPages,
                cursor = page < totalPages ? (page + 1).ToString() : null
            },
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    /// <summary>
    /// Get messages in a specific conversation.
    /// Only accessible if user is a participant.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetConversation(
        int id,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50,
        [FromQuery(Name = "per_page")] int? perPage = null,
        [FromQuery] string? direction = null,
        [FromQuery] string? cursor = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (perPage.HasValue)
        {
            limit = perPage.Value;
        }

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        if (IsLaravelV2Request())
        {
            return await GetLaravelReactConversationAsync(id, userId.Value, limit, direction, cursor);
        }

        // Get conversation and verify user is a participant
        var conversation = await _db.Conversations
            .Include(c => c.Participant1)
            .Include(c => c.Participant2)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (conversation == null)
        {
            return NotFound(new { error = "Conversation not found" });
        }

        // Security check: user must be a participant
        if (conversation.Participant1Id != userId.Value && conversation.Participant2Id != userId.Value)
        {
            return NotFound(new { error = "Conversation not found" });
        }

        var otherParticipant = conversation.Participant1Id == userId.Value
            ? conversation.Participant2
            : conversation.Participant1;

        // Get messages with pagination (newest first)
        var messageQuery = _db.Messages
            .Include(m => m.Sender)
            .Where(m => m.ConversationId == id)
            .OrderByDescending(m => m.CreatedAt);

        var total = await messageQuery.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var messages = await messageQuery
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            id = conversation.Id,
            participant = new
            {
                id = otherParticipant?.Id,
                first_name = otherParticipant?.FirstName,
                last_name = otherParticipant?.LastName
            },
            other_user = new
            {
                id = otherParticipant?.Id,
                name = $"{otherParticipant?.FirstName} {otherParticipant?.LastName}".Trim(),
                first_name = otherParticipant?.FirstName,
                last_name = otherParticipant?.LastName,
                avatar_url = otherParticipant?.AvatarUrl
            },
            messages = messages.Select(m => new
            {
                id = m.Id,
                content = m.Content,
                body = m.Content,
                sender = new
                {
                    id = m.Sender?.Id,
                    first_name = m.Sender?.FirstName,
                    last_name = m.Sender?.LastName
                },
                is_read = m.IsRead,
                created_at = m.CreatedAt,
                read_at = m.ReadAt
            }),
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            },
            created_at = conversation.CreatedAt,
            updated_at = conversation.UpdatedAt
        });
    }

    private async Task<IActionResult> GetLaravelReactConversationAsync(
        int otherUserId,
        int currentUserId,
        int limit,
        string? direction,
        string? cursor)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var otherUser = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == otherUserId);
        if (otherUser == null)
        {
            return NotFound(new
            {
                success = false,
                code = "NOT_FOUND",
                error = "User not found"
            });
        }

        var participant1Id = Math.Min(currentUserId, otherUserId);
        var participant2Id = Math.Max(currentUserId, otherUserId);
        var conversation = await _db.Conversations
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId
                && c.Participant1Id == participant1Id
                && c.Participant2Id == participant2Id);

        var normalizedDirection = string.Equals(direction, "newer", StringComparison.OrdinalIgnoreCase)
            ? "newer"
            : "older";
        var cursorId = DecodeCursor(cursor);

        var baseMessageQuery = _db.Messages
            .AsNoTracking()
            .Include(m => m.Sender);
        var messageQuery = conversation == null
            ? baseMessageQuery.Where(m => false)
            : baseMessageQuery.Where(m => m.ConversationId == conversation.Id
                && !(m.SenderId == currentUserId && m.IsDeletedSender)
                && !(m.SenderId != currentUserId && m.IsDeletedReceiver));

        if (cursorId.HasValue)
        {
            messageQuery = normalizedDirection == "newer"
                ? messageQuery.Where(m => m.Id > cursorId.Value)
                : messageQuery.Where(m => m.Id < cursorId.Value);
        }

        messageQuery = normalizedDirection == "newer"
            ? messageQuery.OrderBy(m => m.Id)
            : messageQuery.OrderByDescending(m => m.Id);

        var messages = await messageQuery
            .Take(limit + 1)
            .ToListAsync();
        var hasMore = messages.Count > limit;
        if (hasMore)
        {
            messages.RemoveAt(messages.Count - 1);
        }

        var messageIds = messages.Select(message => message.Id).ToArray();
        var attachmentsByMessage = messageIds.Length == 0
            ? new Dictionary<int, MessageAttachment[]>()
            : (await _db.MessageAttachments
                .AsNoTracking()
                .Include(attachment => attachment.FileUpload)
                .Where(attachment => messageIds.Contains(attachment.MessageId))
                .OrderBy(attachment => attachment.Id)
                .ToListAsync())
                .Where(attachment => attachment.FileUpload != null)
                .GroupBy(attachment => attachment.MessageId)
                .ToDictionary(group => group.Key, group => group.ToArray());

        // Laravel reports the unread state observed when the thread is opened,
        // before the same request marks those messages as read.
        var unreadCount = conversation == null
            ? 0
            : await _db.Messages.CountAsync(m => m.ConversationId == conversation.Id
                && m.SenderId == otherUserId
                && !m.IsRead
                && m.ArchivedByReceiver == null
                && !m.IsDeletedReceiver
                && !m.IsDeleted);

        if (conversation != null && (normalizedDirection != "newer" || cursorId == null))
        {
            var now = DateTime.UtcNow;
            await _db.Messages
                .Where(m => m.ConversationId == conversation.Id
                    && m.SenderId == otherUserId
                    && !m.IsRead)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(m => m.IsRead, true)
                    .SetProperty(m => m.ReadAt, now));
        }

        var messageCount = conversation == null
            ? 0
            : await _db.Messages.CountAsync(m => m.ConversationId == conversation.Id);
        // This is intentionally a pure projection. Opening a conversation may
        // explain why the composer is unavailable, but must never record a
        // contact attempt or otherwise mutate safeguarding state.
        var safeguardingDecision = await _safeguardingInteractionPolicy.EvaluateLocalContactAsync(
            currentUserId,
            otherUserId,
            _tenantContext.GetTenantIdOrThrow(),
            "direct_message");
        var safeguarding = BuildSafeguardingProjection(safeguardingDecision);

        return Ok(new
        {
            success = true,
            data = messages.Select(message => MapLaravelReactMessage(
                message,
                currentUserId,
                otherUserId,
                attachmentsByMessage.GetValueOrDefault(message.Id) ?? [])),
            meta = new
            {
                conversation = new
                {
                    id = otherUserId,
                    conversation_id = conversation?.Id,
                    other_user = new
                    {
                        id = otherUser.Id,
                        name = $"{otherUser.FirstName} {otherUser.LastName}".Trim(),
                        first_name = otherUser.FirstName,
                        last_name = otherUser.LastName,
                        avatar_url = otherUser.AvatarUrl,
                        is_online = otherUser.LastLoginAt.HasValue && otherUser.LastLoginAt.Value > DateTime.UtcNow.AddMinutes(-5)
                    },
                    unread_count = unreadCount,
                    message_count = messageCount,
                    safeguarding
                },
                cursor = hasMore && messages.Count > 0 ? EncodeCursor(messages[^1].Id) : null,
                per_page = limit,
                has_more = hasMore
            }
        });
    }

    private object MapLaravelReactMessage(
        Message message,
        int currentUserId,
        int otherUserId,
        IReadOnlyCollection<MessageAttachment> attachments)
    {
        var recipientId = message.SenderId == currentUserId ? otherUserId : currentUserId;
        return new
        {
            id = message.Id,
            conversation_id = message.ConversationId,
            sender_id = message.SenderId,
            receiver_id = recipientId,
            recipient_id = recipientId,
            content = message.Content,
            body = message.Content,
            sender = new
            {
                id = message.Sender?.Id,
                first_name = message.Sender?.FirstName,
                last_name = message.Sender?.LastName,
                avatar_url = message.Sender?.AvatarUrl
            },
            attachments = attachments
                .Select(attachment => MapLaravelReactAttachment(attachment, attachment.FileUpload!))
                .ToArray(),
            is_read = message.IsRead,
            is_edited = message.IsEdited,
            edited_at = message.EditedAt,
            is_deleted = message.IsDeleted,
            deleted_at = message.DeletedAt,
            created_at = message.CreatedAt,
            read_at = message.ReadAt
        };
    }

    private static int? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor))
        {
            return null;
        }

        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out var id) ? id : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string EncodeCursor(int id) => Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString()));

    /// <summary>
    /// Get the count of unread messages for the current user.
    /// </summary>
    [HttpGet("unread-count")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesUnreadCountPolicy)]
    public async Task<IActionResult> GetUnreadCount()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Get tenant-scoped conversation IDs where user is a participant.
        var conversationIds = await _db.Conversations
            .Where(c => c.TenantId == tenantId
                && (c.Participant1Id == userId.Value || c.Participant2Id == userId.Value))
            .Select(c => c.Id)
            .ToListAsync();

        // Count unread messages (messages from others that are not read)
        var unreadCount = await _db.Messages
            .Where(m => conversationIds.Contains(m.ConversationId)
                && m.SenderId != userId.Value
                && !m.IsRead
                && m.ArchivedByReceiver == null
                && !m.IsDeletedReceiver
                && !m.IsDeleted)
            .CountAsync();

        if (IsLaravelV2Request())
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    count = unreadCount
                }
            });
        }

        return Ok(new
        {
            unread_count = unreadCount
        });
    }

    /// <summary>
    /// Archive the direct conversation with another tenant user. The route id
    /// is the partner user id, matching Laravel, rather than the normalized
    /// Conversation primary key used internally by this service.
    /// </summary>
    [HttpDelete("conversations/{otherUserId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesArchivePolicy)]
    public async Task<IActionResult> ArchiveConversation(
        int otherUserId,
        CancellationToken cancellationToken = default)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (!await TenantPartnerExistsAsync(otherUserId, tenantId, cancellationToken))
        {
            return ConversationNotFound();
        }

        var scope = await ResolveArchiveScopeAsync(cancellationToken);
        await ArchiveConversationAsync(
            currentUserId.Value,
            otherUserId,
            tenantId,
            scope,
            cancellationToken);

        // Archiving is idempotent. Laravel returns success even when every
        // matching row already carries the requested archive marker.
        return Ok(new
        {
            data = new
            {
                success = true,
                message = "Conversation deleted"
            },
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}{Request.PathBase}"
            }
        });
    }

    /// <summary>
    /// Laravel's compact conversation-delete alias always performs a
    /// current-user-only archive and responds with 204 No Content.
    /// </summary>
    [HttpDelete("/api/v2/conversations/{otherUserId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesArchivePolicy)]
    public async Task<IActionResult> ArchiveConversationAlias(
        int otherUserId,
        CancellationToken cancellationToken = default)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (!await TenantPartnerExistsAsync(otherUserId, tenantId, cancellationToken))
        {
            return ConversationNotFound();
        }

        await ArchiveConversationAsync(
            currentUserId.Value,
            otherUserId,
            tenantId,
            "self",
            cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Restore only the current user's archive markers. The other
    /// participant's independent archive state is deliberately preserved.
    /// </summary>
    [HttpPost("conversations/{otherUserId:int}/restore")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesRestorePolicy)]
    public async Task<IActionResult> RestoreConversation(
        int otherUserId,
        CancellationToken cancellationToken = default)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var restoredCount = await RestoreConversationAsync(
            currentUserId.Value,
            otherUserId,
            tenantId,
            cancellationToken);
        if (restoredCount == 0)
        {
            return NotFound(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "NOT_FOUND",
                        message = "No archived conversation found"
                    }
                }
            });
        }

        return Ok(new
        {
            data = new
            {
                success = true,
                message = "Conversation restored",
                restored_count = restoredCount
            },
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}{Request.PathBase}"
            }
        });
    }

    private async Task<bool> TenantPartnerExistsAsync(
        int otherUserId,
        int tenantId,
        CancellationToken cancellationToken) =>
        await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(
                user => user.Id == otherUserId && user.TenantId == tenantId,
                cancellationToken);

    private async Task<int?> FindDirectConversationIdAsync(
        int currentUserId,
        int otherUserId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var participant1Id = Math.Min(currentUserId, otherUserId);
        var participant2Id = Math.Max(currentUserId, otherUserId);
        return await _db.Conversations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(conversation => conversation.TenantId == tenantId
                && conversation.Participant1Id == participant1Id
                && conversation.Participant2Id == participant2Id)
            .Select(conversation => (int?)conversation.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<int> ArchiveConversationAsync(
        int currentUserId,
        int otherUserId,
        int tenantId,
        string scope,
        CancellationToken cancellationToken)
    {
        var conversationId = await FindDirectConversationIdAsync(
            currentUserId,
            otherUserId,
            tenantId,
            cancellationToken);
        if (!conversationId.HasValue)
        {
            return 0;
        }

        var now = DateTime.UtcNow;
        var messages = _db.Messages
            .IgnoreQueryFilters()
            .Where(message => message.TenantId == tenantId
                && message.ConversationId == conversationId.Value);

        if (string.Equals(scope, "everyone", StringComparison.Ordinal))
        {
            return await messages.ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(message => message.ArchivedBySender, now)
                    .SetProperty(message => message.ArchivedByReceiver, now),
                cancellationToken);
        }

        return await messages
            .Where(message => (message.SenderId == currentUserId
                    && message.ArchivedBySender == null)
                || (message.SenderId == otherUserId
                    && message.ArchivedByReceiver == null))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(
                        message => message.ArchivedBySender,
                        message => message.SenderId == currentUserId
                            ? (DateTime?)now
                            : message.ArchivedBySender)
                    .SetProperty(
                        message => message.ArchivedByReceiver,
                        message => message.SenderId == otherUserId
                            ? (DateTime?)now
                            : message.ArchivedByReceiver),
                cancellationToken);
    }

    private async Task<int> RestoreConversationAsync(
        int currentUserId,
        int otherUserId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var conversationId = await FindDirectConversationIdAsync(
            currentUserId,
            otherUserId,
            tenantId,
            cancellationToken);
        if (!conversationId.HasValue)
        {
            return 0;
        }

        var messages = _db.Messages
            .IgnoreQueryFilters()
            .Where(message => message.TenantId == tenantId
                && message.ConversationId == conversationId.Value);
        return await messages
            .Where(message => (message.SenderId == currentUserId
                    && message.ArchivedBySender != null)
                || (message.SenderId == otherUserId
                    && message.ArchivedByReceiver != null))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(
                        message => message.ArchivedBySender,
                        message => message.SenderId == currentUserId
                            ? (DateTime?)null
                            : message.ArchivedBySender)
                    .SetProperty(
                        message => message.ArchivedByReceiver,
                        message => message.SenderId == otherUserId
                            ? (DateTime?)null
                            : message.ArchivedByReceiver),
                cancellationToken);
    }

    private async Task<string> ResolveArchiveScopeAsync(CancellationToken cancellationToken)
    {
        var queryScope = NormalizeArchiveScope(Request.Query["scope"].FirstOrDefault());

        // Laravel merges body input over query input. An absent key, empty
        // body, or malformed JSON therefore leaves the query fallback in
        // control; a present body key (even an invalid value) takes precedence.
        if (Request.ContentLength == null
            && !Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            return queryScope;
        }

        if (Request.ContentLength == 0)
        {
            return queryScope;
        }

        try
        {
            using var document = await JsonDocument.ParseAsync(
                Request.Body,
                cancellationToken: cancellationToken);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("scope", out var scopeElement))
            {
                return queryScope;
            }

            return scopeElement.ValueKind == JsonValueKind.String
                ? NormalizeArchiveScope(scopeElement.GetString())
                : "self";
        }
        catch (JsonException)
        {
            return queryScope;
        }
    }

    private static string NormalizeArchiveScope(string? scope) =>
        string.Equals(scope, "everyone", StringComparison.Ordinal)
            ? "everyone"
            : "self";

    private NotFoundObjectResult ConversationNotFound() => NotFound(new
    {
        errors = new[]
        {
            new
            {
                code = "NOT_FOUND",
                message = "Conversation not found"
            }
        }
    });

    /// <summary>
    /// Send a message to another user.
    /// Creates a new conversation if one doesn't exist.
    /// </summary>
    [HttpPost]
    [RequestSizeLimit(55L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 55L * 1024 * 1024)]
    public async Task<IActionResult> SendMessage(CancellationToken ct)
    {
        var (request, attachmentFiles) = await ReadSendMessageRequestAsync(ct);
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        // Laravel trims before its mb_strlen validation, then strips all HTML
        // immediately before persistence. Count Unicode scalar values rather
        // than UTF-16 code units so astral characters have the same length.
        var trimmedMessageContent = request.ResolvedContent.Trim();
        var hasAttachments = attachmentFiles.Count > 0;

        if (request.RecipientId <= 0)
        {
            return MessageWriteError(
                "VALIDATION_ERROR",
                "recipient_id is required",
                StatusCodes.Status422UnprocessableEntity,
                "recipient_id");
        }

        if (request.RecipientId == userId.Value)
        {
            return MessageWriteError(
                "VALIDATION_ERROR",
                "You cannot send a message to yourself",
                IsLaravelV2Request()
                    ? StatusCodes.Status422UnprocessableEntity
                    : StatusCodes.Status400BadRequest);
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Ordinary account and block checks deliberately run before the
        // safeguarding policy. A blocked or cross-tenant caller must not be
        // able to infer the recipient's confidential safeguarding choices.
        var sender = await LoadActiveMessageUserAsync(userId.Value, tenantId, ct);
        if (sender == null)
        {
            return MessageWriteError(
                "FORBIDDEN",
                "Your account is not allowed to send messages",
                StatusCodes.Status403Forbidden);
        }

        var recipient = await LoadMessageRecipientAsync(request.RecipientId, tenantId, ct);
        if (recipient == null)
        {
            return MessageWriteError(
                "NOT_FOUND",
                "Recipient not found",
                IsLaravelV2Request() ? StatusCodes.Status404NotFound : StatusCodes.Status400BadRequest);
        }

        if (await IsSenderMessagingDisabledAsync(userId.Value, tenantId, ct))
        {
            return MessageWriteError(
                "MESSAGING_DISABLED",
                "Your messaging has been restricted by an administrator",
                StatusCodes.Status403Forbidden);
        }

        if (await IsMessagePairBlockedAsync(userId.Value, request.RecipientId, tenantId, ct))
        {
            return MessageWriteError(
                "BLOCKED",
                "You cannot send messages to this user",
                StatusCodes.Status403Forbidden);
        }

        var preflightDecision = await _safeguardingInteractionPolicy.EvaluateLocalContactAsync(
            userId.Value,
            request.RecipientId,
            tenantId,
            "direct_message",
            ct);
        if (!preflightDecision.IsAllowed)
        {
            await NotifySafeguardingBlockedAttemptAsync(
                tenantId,
                userId.Value,
                request.RecipientId,
                preflightDecision);
            return SafeguardingWriteError(preflightDecision);
        }

        var maximumLength = IsLaravelV2Request() ? 10_000 : 5_000;
        if (trimmedMessageContent.EnumerateRunes().Count() > maximumLength)
        {
            return MessageWriteError(
                "VALIDATION_ERROR",
                IsLaravelV2Request()
                    ? "Message is too long (max 10000 characters)"
                    : "Message content must be 5000 characters or less",
                StatusCodes.Status400BadRequest,
                "body");
        }

        if (attachmentFiles.Count > 5)
        {
            return MessageWriteError(
                "VALIDATION_ERROR",
                "You can attach up to 5 files",
                StatusCodes.Status422UnprocessableEntity,
                "attachments");
        }

        if ((string.IsNullOrWhiteSpace(trimmedMessageContent) || trimmedMessageContent == "0")
            && !hasAttachments)
        {
            return MessageWriteError(
                "VALIDATION_ERROR",
                IsLaravelV2Request()
                    ? "Message body or voice message is required"
                    : "Message content is required",
                IsLaravelV2Request()
                    ? StatusCodes.Status422UnprocessableEntity
                    : StatusCodes.Status400BadRequest,
                "body");
        }

        // Laravel stages validated bytes before the definitive write. These
        // rows remain unattached until the locked decision succeeds and are
        // removed, with their stored files, on every subsequent failure.
        var stagedUploads = new List<FileUpload>();
        try
        {
            foreach (var attachmentFile in attachmentFiles)
            {
                await using var stream = attachmentFile.OpenReadStream();
                var (upload, uploadError) = await _fileUploadService.UploadAsync(
                    stream,
                    attachmentFile.FileName,
                    string.IsNullOrWhiteSpace(attachmentFile.ContentType)
                        ? "application/octet-stream"
                        : attachmentFile.ContentType,
                    attachmentFile.Length,
                    userId.Value,
                    tenantId,
                    FileCategory.Message,
                    entityId: null,
                    entityType: "message",
                    cancellationToken: ct);

                if (uploadError != null)
                {
                    await CleanupStagedMessageUploadsAsync(stagedUploads);
                    return MessageWriteError(
                        "VALIDATION_ERROR",
                        uploadError,
                        StatusCodes.Status422UnprocessableEntity,
                        "attachments");
                }

                stagedUploads.Add(upload!);
            }
        }
        catch (OperationCanceledException)
        {
            stagedUploads.AddRange(NewTrackedMessageUploads(stagedUploads, userId.Value, tenantId));
            await CleanupStagedMessageUploadsAsync(stagedUploads);
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stagedUploads.AddRange(NewTrackedMessageUploads(stagedUploads, userId.Value, tenantId));
            await CleanupStagedMessageUploadsAsync(stagedUploads);
            _logger.LogError(exception, "Failed to stage message attachments for user {UserId}", userId.Value);
            return MessageWriteError(
                "UPLOAD_FAILED",
                "Failed to upload attachment",
                StatusCodes.Status400BadRequest,
                "attachments");
        }

        var messageContent = StripAllHtml(trimmedMessageContent);
        if (IsLaravelEmptyString(messageContent) && !hasAttachments)
        {
            await CleanupStagedMessageUploadsAsync(stagedUploads);
            return MessageWriteError(
                "VALIDATION_ERROR",
                "Message body is required",
                IsLaravelV2Request()
                    ? StatusCodes.Status422UnprocessableEntity
                    : StatusCodes.Status400BadRequest,
                "body");
        }

        // UploadAsync uses this scoped context to persist each staged file.
        // Detach those committed rows before beginning the all-or-nothing
        // message transaction, then reload and bind them tenant-safely below.
        _db.ChangeTracker.Clear();

        var participant1Id = Math.Min(userId.Value, request.RecipientId);
        var participant2Id = Math.Max(userId.Value, request.RecipientId);
        Conversation? conversation = null;
        Message? message = null;
        var persistedAttachments = new List<(MessageAttachment Attachment, FileUpload Upload)>();
        IDbContextTransaction? transaction = null;

        async Task<IActionResult> AbortWriteAsync(
            IActionResult result,
            SafeguardingInteractionDecision? blockedDecision = null)
        {
            if (transaction != null)
            {
                try
                {
                    await transaction.RollbackAsync(CancellationToken.None);
                }
                catch (Exception rollbackException)
                {
                    _logger.LogCritical(
                        rollbackException,
                        "Failed to roll back a denied message write; staged cleanup will continue");
                }

                try
                {
                    await transaction.DisposeAsync();
                }
                catch (Exception disposeException)
                {
                    _logger.LogCritical(
                        disposeException,
                        "Failed to dispose a denied message transaction; staged cleanup will continue");
                }
                transaction = null;
            }

            await CleanupStagedMessageUploadsAsync(stagedUploads);
            if (blockedDecision != null)
            {
                await NotifySafeguardingBlockedAttemptAsync(
                    tenantId,
                    userId.Value,
                    request.RecipientId,
                    blockedDecision);
            }

            return result;
        }

        try
        {
            transaction = await _db.Database.BeginTransactionAsync(ct);
            sender = await LoadActiveMessageUserAsync(userId.Value, tenantId, ct);
            if (sender == null)
            {
                return await AbortWriteAsync(MessageWriteError(
                    "FORBIDDEN",
                    "Your account is not allowed to send messages",
                    StatusCodes.Status403Forbidden));
            }

            recipient = await LoadMessageRecipientAsync(request.RecipientId, tenantId, ct);
            if (recipient == null)
            {
                return await AbortWriteAsync(MessageWriteError(
                    "NOT_FOUND",
                    "Recipient not found",
                    IsLaravelV2Request() ? StatusCodes.Status404NotFound : StatusCodes.Status400BadRequest));
            }

            if (await IsSenderMessagingDisabledAsync(userId.Value, tenantId, ct))
            {
                return await AbortWriteAsync(MessageWriteError(
                    "MESSAGING_DISABLED",
                    "Your messaging has been restricted by an administrator",
                    StatusCodes.Status403Forbidden));
            }

            if (await IsMessagePairBlockedAsync(userId.Value, request.RecipientId, tenantId, ct))
            {
                return await AbortWriteAsync(MessageWriteError(
                    "BLOCKED",
                    "You cannot send messages to this user",
                    StatusCodes.Status403Forbidden));
            }

            var stagedUploadIds = stagedUploads.Select(upload => upload.Id).Distinct().ToArray();
            var uploads = stagedUploadIds.Length == 0
                ? []
                : await _db.FileUploads
                    .IgnoreQueryFilters()
                    .Where(upload => upload.TenantId == tenantId
                        && upload.UserId == userId.Value
                        && upload.Category == FileCategory.Message
                        && stagedUploadIds.Contains(upload.Id))
                    .OrderBy(upload => upload.Id)
                    .ToListAsync(ct);
            if (uploads.Count != stagedUploadIds.Length)
            {
                throw new InvalidOperationException("A staged message attachment is no longer available.");
            }

            // This is the definitive race-safe boundary. Nothing in the
            // conversation graph is persisted before the current policy,
            // recipient preferences, and sender attestations are locked and
            // evaluated together.
            var lockedDecision = await _safeguardingInteractionPolicy.EvaluateLockedLocalContactAsync(
                userId.Value,
                request.RecipientId,
                tenantId,
                "direct_message",
                ct);
            if (!lockedDecision.IsAllowed)
            {
                return await AbortWriteAsync(
                    SafeguardingWriteError(lockedDecision),
                    lockedDecision);
            }

            // The safeguarding lock serializes direct-message writers for the
            // tenant. Read the normalized pair only after acquiring it so a
            // waiter observes the first writer's committed conversation rather
            // than attempting a duplicate insert against the unique index.
            conversation = await _db.Conversations
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(row => row.TenantId == tenantId
                    && row.Participant1Id == participant1Id
                    && row.Participant2Id == participant2Id, ct);

            var now = DateTime.UtcNow;
            if (conversation == null)
            {
                conversation = new Conversation
                {
                    TenantId = tenantId,
                    Participant1Id = participant1Id,
                    Participant2Id = participant2Id,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                _db.Conversations.Add(conversation);
            }
            else
            {
                conversation.UpdatedAt = now;
            }

            message = new Message
            {
                TenantId = tenantId,
                Conversation = conversation,
                SenderId = userId.Value,
                Content = messageContent,
                IsRead = false,
                CreatedAt = now
            };
            _db.Messages.Add(message);
            await _db.SaveChangesAsync(ct);

            foreach (var upload in uploads)
            {
                upload.EntityId = message.Id;
                upload.EntityType = "message";
                var attachment = new MessageAttachment
                {
                    MessageId = message.Id,
                    FileUploadId = upload.Id,
                    UploadedById = userId.Value,
                    CreatedAt = now
                };
                _db.MessageAttachments.Add(attachment);
                persistedAttachments.Add((attachment, upload));
            }

            if (persistedAttachments.Count > 0)
            {
                await _db.SaveChangesAsync(ct);
            }

            await transaction.CommitAsync(ct);
            var committedTransaction = transaction;
            transaction = null;
            try
            {
                await committedTransaction.DisposeAsync();
            }
            catch (Exception disposeException)
            {
                // Commit has succeeded. Never route a disposal-only failure
                // through rollback cleanup, which would delete attachments
                // belonging to the now-durable message.
                _logger.LogError(
                    disposeException,
                    "Message {MessageId} committed but transaction disposal failed",
                    message!.Id);
            }
        }
        catch (Exception exception)
        {
            if (transaction != null)
            {
                try
                {
                    await transaction.RollbackAsync(CancellationToken.None);
                }
                catch (Exception rollbackException)
                {
                    _logger.LogCritical(
                        rollbackException,
                        "Failed to roll back message transaction after {FailureType}",
                        exception.GetType().Name);
                }
                finally
                {
                    try
                    {
                        await transaction.DisposeAsync();
                    }
                    catch (Exception disposeException)
                    {
                        _logger.LogCritical(
                            disposeException,
                            "Failed to dispose message transaction after {FailureType}; staged cleanup will continue",
                            exception.GetType().Name);
                    }
                    transaction = null;
                }
            }

            await CleanupStagedMessageUploadsAsync(stagedUploads);
            throw;
        }
        finally
        {
            if (transaction != null)
            {
                try
                {
                    await transaction.DisposeAsync();
                }
                catch (Exception disposeException)
                {
                    _logger.LogCritical(disposeException, "Failed to dispose residual message transaction");
                }
            }
        }

        if (conversation == null || message == null || sender == null || recipient == null)
        {
            throw new InvalidOperationException("The committed message graph was not available for its response.");
        }

        if (conversation.CreatedAt == conversation.UpdatedAt)
        {
            _logger.LogInformation(
                "Created new conversation {ConversationId} between users {User1Id} and {User2Id}",
                conversation.Id,
                participant1Id,
                participant2Id);
        }

        _logger.LogInformation("User {SenderId} sent message {MessageId} to user {RecipientId}",
            userId.Value, message.Id, request.RecipientId);

        // Send real-time notification to the recipient
        var notification = new MessageNotification
        {
            Id = message.Id,
            ConversationId = conversation.Id,
            Content = message.Content,
            Sender = new SenderInfo
            {
                Id = sender.Id,
                FirstName = sender.FirstName
            },
            IsRead = message.IsRead,
            CreatedAt = message.CreatedAt
        };

        await DispatchSuccessfulMessageSideEffectsAsync(
            tenantId,
            sender,
            recipient,
            conversation.Id,
            message.Id,
            notification,
            awardXp: IsLaravelV2Request());

        var responseMessage = new
        {
            id = message.Id,
            conversation_id = conversation.Id,
            sender_id = sender.Id,
            receiver_id = recipient.Id,
            recipient_id = recipient.Id,
            content = message.Content,
            body = message.Content,
            sender = new
            {
                id = sender.Id,
                first_name = sender.FirstName,
                last_name = sender.LastName
            },
            recipient = new
            {
                id = recipient.Id,
                first_name = recipient.FirstName,
                last_name = recipient.LastName
            },
            attachments = persistedAttachments
                .Select(row => MapLaravelReactAttachment(row.Attachment, row.Upload))
                .ToArray(),
            is_read = message.IsRead,
            created_at = message.CreatedAt
        };

        if (IsLaravelV2Request())
        {
            return StatusCode(StatusCodes.Status201Created, new
            {
                data = responseMessage,
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}"
                }
            });
        }

        return CreatedAtAction(nameof(GetConversation), new { id = conversation.Id }, responseMessage);
    }

    /// <summary>
    /// Mark all messages in a conversation as read.
    /// Only marks messages from the other participant as read.
    /// </summary>
    [HttpPut("{id:int}/read")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesMarkReadPolicy)]
    public async Task<IActionResult> MarkConversationRead(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (IsLaravelV2Request())
        {
            return await MarkLaravelReactConversationReadAsync(id, userId.Value);
        }

        // Get conversation and verify user is a participant
        var conversation = await _db.Conversations
            .FirstOrDefaultAsync(c => c.Id == id);

        if (conversation == null)
        {
            return NotFound(new { error = "Conversation not found" });
        }

        // Security check: user must be a participant
        if (conversation.Participant1Id != userId.Value && conversation.Participant2Id != userId.Value)
        {
            return NotFound(new { error = "Conversation not found" });
        }

        // Mark all unread messages from the other participant as read using batch update
        var now = DateTime.UtcNow;
        var markedCount = await _db.Messages
            .Where(m => m.ConversationId == id
                && m.SenderId != userId.Value
                && !m.IsRead)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(m => m.IsRead, true)
                .SetProperty(m => m.ReadAt, now));

        _logger.LogInformation("User {UserId} marked {Count} messages as read in conversation {ConversationId}",
            userId.Value, markedCount, id);

        // Notify the other participant that messages were read
        if (markedCount > 0)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _realTimeMessaging.NotifyMessagesReadAsync(id, userId.Value, markedCount);
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogError(ex, "Failed to send read notification for conversation {ConversationId}", id);
                }
                catch (TimeoutException ex)
                {
                    _logger.LogError(ex, "Failed to send read notification for conversation {ConversationId}", id);
                }
            });
        }

        return Ok(new
        {
            conversation_id = id,
            marked_read = markedCount
        });
    }

    private async Task<IActionResult> MarkLaravelReactConversationReadAsync(int otherUserId, int currentUserId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var participant1Id = Math.Min(currentUserId, otherUserId);
        var participant2Id = Math.Max(currentUserId, otherUserId);
        var conversation = await _db.Conversations
            .FirstOrDefaultAsync(c => c.TenantId == tenantId
                && c.Participant1Id == participant1Id
                && c.Participant2Id == participant2Id);

        if (conversation == null)
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    marked_read = 0
                }
            });
        }

        var now = DateTime.UtcNow;
        var markedCount = await _db.Messages
            .Where(m => m.ConversationId == conversation.Id
                && m.SenderId == otherUserId
                && !m.IsRead)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(m => m.IsRead, true)
                .SetProperty(m => m.ReadAt, now));

        _logger.LogInformation("User {UserId} marked {Count} messages as read from user {OtherUserId}",
            currentUserId, markedCount, otherUserId);

        return Ok(new
        {
            success = true,
            data = new
            {
                marked_read = markedCount
            }
        });
    }

    /// <summary>GET /api/messages/reactions-batch - batch fetch emoji reactions for a list of message IDs</summary>
    [HttpGet("reactions-batch")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesReactionBatchPolicy)]
    public async Task<IActionResult> GetMessageReactionsBatch(
        [FromQuery] string? messageIds,
        [FromQuery] string? ids,
        CancellationToken cancellationToken)
    {
        var idList = (ids ?? messageIds ?? string.Empty).Split(',')
            .Select(s => int.TryParse(s.Trim(), out var n) ? (int?)n : null)
            .Where(n => n is > 0)
            .Select(n => n!.Value)
            .Take(100)
            .ToList();

        var result = await _messageReactions.BatchAsync(
            _tenantContext.GetTenantIdOrThrow(),
            GetCurrentUserId()!.Value,
            idList,
            cancellationToken);
        return Ok(new
        {
            success = true,
            data = new
            {
                reactions = result.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value.Select(group => new
                    {
                        emoji = group.Emoji,
                        count = group.Count,
                        user_ids = group.UserIds
                    }).ToArray())
            }
        });
    }

    private async Task<User?> LoadActiveMessageUserAsync(
        int userId,
        int tenantId,
        CancellationToken cancellationToken)
        => await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == userId
                && user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null, cancellationToken);

    private async Task<User?> LoadMessageRecipientAsync(
        int userId,
        int tenantId,
        CancellationToken cancellationToken)
        => await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == userId
                && user.TenantId == tenantId, cancellationToken);

    private Task<bool> IsMessagePairBlockedAsync(
        int senderId,
        int recipientId,
        int tenantId,
        CancellationToken cancellationToken)
        => _db.UserBlocks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(block => block.TenantId == tenantId
                && ((block.UserId == senderId && block.BlockedUserId == recipientId)
                    || (block.UserId == recipientId && block.BlockedUserId == senderId)), cancellationToken);

    private async Task<bool> IsSenderMessagingDisabledAsync(
        int senderId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await _db.UserMonitoringRestrictions
            .IgnoreQueryFilters()
            .Where(restriction => restriction.TenantId == tenantId
                && restriction.UserId == senderId
                && restriction.UnderMonitoring
                && restriction.MonitoringExpiresAt != null
                && restriction.MonitoringExpiresAt <= now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(restriction => restriction.UnderMonitoring, false)
                .SetProperty(restriction => restriction.MessagingDisabled, false)
                .SetProperty(restriction => restriction.MonitoringExpiresAt, (DateTime?)null),
                cancellationToken);

        return await _db.UserMonitoringRestrictions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(restriction => restriction.TenantId == tenantId
                && restriction.UserId == senderId
                && restriction.MessagingDisabled, cancellationToken);
    }

    private async Task NotifySafeguardingBlockedAttemptAsync(
        int tenantId,
        int senderId,
        int recipientId,
        SafeguardingInteractionDecision decision)
    {
        if (decision.IsAllowed || decision.IsUnavailable)
            return;

        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync(CancellationToken.None);

            if (db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true)
            {
                var lockKey = SafeguardingAlertLockKey(tenantId, senderId, recipientId);
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({lockKey})",
                    CancellationToken.None);
            }

            var sender = await db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == senderId);
            var recipient = await db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == recipientId);
            var staff = await db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(user => user.TenantId == tenantId
                    && user.IsActive
                    && user.SuspendedAt == null
                    && (user.Role == "admin"
                        || user.Role == "tenant_admin"
                        || user.Role == "broker"
                        || user.Role == "super_admin"
                        || user.IsAdmin
                        || user.IsSuperAdmin
                        || user.IsTenantSuperAdmin
                        || user.IsGod))
                .ToListAsync();

            var requiredTypes = decision.RequiredAttestationCodes?
                .OrderBy(code => code, StringComparer.Ordinal)
                .ToArray() ?? [];
            var payload = JsonSerializer.Serialize(new
            {
                sender_id = senderId,
                recipient_id = recipientId,
                reason_code = decision.Code,
                required_vetting_types = requiredTypes
            });
            var recentCutoff = DateTime.UtcNow.AddMinutes(-10);
            var existingRecipients = await db.Notifications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(notification => notification.TenantId == tenantId
                    && notification.Type == "safeguarding_contact_blocked"
                    && notification.Data == payload
                    && notification.CreatedAt >= recentCutoff)
                .Select(notification => notification.UserId)
                .ToListAsync();
            var existingRecipientIds = existingRecipients.ToHashSet();
            var senderName = DisplayName(sender, "A member");
            var recipientName = DisplayName(recipient, "a protected member");
            var reason = decision.Code == "VETTING_REQUIRED"
                ? "required safeguarding confirmation is not current"
                : "coordinator-mediated contact is required";

            foreach (var staffUser in staff.Where(user => !existingRecipientIds.Contains(user.Id)))
            {
                db.Notifications.Add(new Notification
                {
                    TenantId = tenantId,
                    UserId = staffUser.Id,
                    Type = "safeguarding_contact_blocked",
                    Title = "Safeguarding contact attempt blocked",
                    Body = $"{senderName} was prevented from messaging {recipientName}: {reason}.",
                    Data = payload,
                    Link = $"/broker/safeguarding?user={recipientId}",
                    IsRead = false,
                    CreatedAt = DateTime.UtcNow
                });
            }

            await db.SaveChangesAsync(CancellationToken.None);
            await transaction.CommitAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogCritical(
                exception,
                "Failed to persist safeguarding blocked-contact alert for tenant {TenantId}, sender {SenderId}, recipient {RecipientId}",
                tenantId,
                senderId,
                recipientId);
        }
    }

    private async Task DispatchSuccessfulMessageSideEffectsAsync(
        int tenantId,
        User sender,
        User recipient,
        int conversationId,
        int messageId,
        MessageNotification notification,
        bool awardXp)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync(CancellationToken.None);
            if (db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true)
            {
                var lockKey = MessageSideEffectLockKey(tenantId, sender.Id);
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({lockKey})",
                    CancellationToken.None);
            }

            var notificationData = JsonSerializer.Serialize(new
            {
                message_id = messageId,
                conversation_id = conversationId,
                sender_id = sender.Id
            });

            var notificationExists = await db.Notifications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(row => row.TenantId == tenantId
                    && row.UserId == recipient.Id
                    && row.Type == "new_message"
                    && row.Data == notificationData);
            if (!notificationExists)
            {
                db.Notifications.Add(new Notification
                {
                    TenantId = tenantId,
                    UserId = recipient.Id,
                    Type = "new_message",
                    Title = "New message",
                    Body = $"New message from {DisplayName(sender, "a member")}",
                    Data = notificationData,
                    Link = $"/messages/{sender.Id}",
                    IsRead = false,
                    CreatedAt = DateTime.UtcNow
                });
                await db.SaveChangesAsync(CancellationToken.None);
            }

            if (awardXp)
            {
                var xpAlreadyAwarded = await db.XpLogs
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .AnyAsync(row => row.TenantId == tenantId
                        && row.UserId == sender.Id
                        && row.Source == "send_message"
                        && row.ReferenceId == messageId);
                if (!xpAlreadyAwarded)
                {
                    var gamification = scope.ServiceProvider.GetRequiredService<GamificationService>();
                    var award = await gamification.AwardXpAsync(
                        sender.Id,
                        XpLog.Amounts.MessageSent,
                        "send_message",
                        messageId,
                        "Sent a message");
                    if (!award.Success)
                    {
                        _logger.LogWarning(
                            "Message {MessageId} committed but its XP award failed: {Error}",
                            messageId,
                            award.Error);
                    }
                }
            }

            await transaction.CommitAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            // The message is already committed. Preserve the canonical write
            // response and surface the side-effect failure operationally rather
            // than encouraging a client retry that would duplicate the message.
            _logger.LogError(exception, "Post-commit durable effects failed for message {MessageId}", messageId);
        }

        try
        {
            await _realTimeMessaging.NotifyNewMessageAsync(tenantId, recipient.Id, notification);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Real-time delivery failed for committed message {MessageId}", messageId);
        }
    }

    private static string StripAllHtml(string content) => PhpTextSanitizer.StripTags(content);

    private static bool IsLaravelEmptyString(string content)
        => string.IsNullOrEmpty(content) || content == "0";

    private static string DisplayName(User? user, string fallback)
    {
        if (user == null)
            return fallback;

        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? fallback : name;
    }

    private static long SafeguardingAlertLockKey(int tenantId, int senderId, int recipientId)
    {
        unchecked
        {
            const long lockNamespace = 0x4e58534d00000000;
            return lockNamespace
                ^ ((long)(uint)tenantId << 32)
                ^ ((long)(uint)senderId << 1)
                ^ (uint)recipientId;
        }
    }

    private static long MessageSideEffectLockKey(int tenantId, int senderId)
    {
        unchecked
        {
            const long lockNamespace = 0x4e58535800000000;
            return lockNamespace
                ^ ((long)(uint)tenantId << 32)
                ^ (uint)senderId;
        }
    }

    private IActionResult MessageWriteError(string code, string message, int status, string? field = null)
    {
        if (IsLaravelV2Request())
        {
            var error = new Dictionary<string, object?>
            {
                ["code"] = code,
                ["message"] = message
            };
            if (field != null)
            {
                error["field"] = field;
            }
            return StatusCode(status, new { errors = new[] { error } });
        }

        return StatusCode(status, new { error = message });
    }

    private IActionResult SafeguardingWriteError(SafeguardingInteractionDecision decision)
        => StatusCode(
            decision.IsUnavailable
                ? StatusCodes.Status503ServiceUnavailable
                : StatusCodes.Status403Forbidden,
            new { errors = new[] { BuildSafeguardingError(decision) } });

    private static Dictionary<string, object?>? BuildSafeguardingProjection(
        SafeguardingInteractionDecision decision)
    {
        if (decision.IsAllowed)
        {
            return null;
        }

        var error = BuildSafeguardingError(decision);
        return new Dictionary<string, object?>
        {
            ["restricted"] = true,
            ["code"] = error["code"],
            ["title"] = error.GetValueOrDefault("title"),
            ["message"] = error.GetValueOrDefault("message"),
            ["detail"] = error.GetValueOrDefault("detail"),
            ["action_label"] = error.GetValueOrDefault("action_label"),
            ["required_vetting_types"] = error.GetValueOrDefault("required_vetting_types") ?? Array.Empty<string>(),
            ["required_vetting_labels"] = error.GetValueOrDefault("required_vetting_labels") ?? Array.Empty<string>(),
            ["can_request_coordinator"] = true
        };
    }

    private static Dictionary<string, object?> BuildSafeguardingError(
        SafeguardingInteractionDecision decision)
    {
        var requiredCodes = decision.RequiredAttestationCodes?.ToArray() ?? Array.Empty<string>();
        var requiredLabels = decision.RequiredAttestationLabels?.ToArray() ?? Array.Empty<string>();

        if (decision.Code == "SAFEGUARDING_POLICY_UNAVAILABLE")
        {
            return new Dictionary<string, object?>
            {
                ["code"] = "SAFEGUARDING_POLICY_UNAVAILABLE",
                ["message"] = "We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.",
                ["title"] = "Safeguarding check temporarily unavailable",
                ["detail"] = "Project NEXUS could not safely evaluate the contact policy, so this interaction has been paused.",
                ["action_label"] = "Check again",
                ["required_vetting_types"] = requiredCodes,
                ["required_vetting_labels"] = requiredLabels,
                ["retryable"] = true
            };
        }

        if (decision.Code == "VETTING_REQUIRED")
        {
            var types = string.Join(", ", requiredLabels);
            return new Dictionary<string, object?>
            {
                ["code"] = "VETTING_REQUIRED",
                ["message"] = $"This conversation is paused by a community safeguarding rule. Your community must have recorded a current {types} confirmation for you before you can message this member. Ask your broker or community administrator to record this metadata-only status. Do not send or upload any vetting document.",
                ["title"] = "Safeguarding check needed",
                ["detail"] = $"This member can only be contacted for this type of interaction by members whose community has recorded a current {types} status. The record is metadata only; no document should be sent or uploaded.",
                ["action_label"] = "Open help",
                ["required_vetting_types"] = requiredCodes,
                ["required_vetting_labels"] = requiredLabels
            };
        }

        return new Dictionary<string, object?>
        {
            ["code"] = "SAFEGUARDING_CONTACT_RESTRICTED",
            ["message"] = "This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.",
            ["title"] = "Coordinator arrangement needed",
            ["detail"] = "This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact. You can ask a coordinator to help arrange contact.",
            ["action_label"] = "Open help"
        };
    }

    private IReadOnlyList<FileUpload> NewTrackedMessageUploads(
        IReadOnlyCollection<FileUpload> known,
        int userId,
        int tenantId)
    {
        var knownIds = known.Select(upload => upload.Id).ToHashSet();
        return _db.ChangeTracker.Entries<FileUpload>()
            .Select(entry => entry.Entity)
            .Where(upload => upload.TenantId == tenantId
                && upload.UserId == userId
                && upload.Category == FileCategory.Message
                && !knownIds.Contains(upload.Id))
            .ToArray();
    }

    private async Task CleanupStagedMessageUploadsAsync(IEnumerable<FileUpload> uploads)
    {
        var staged = uploads
            .GroupBy(
                upload => upload.Id > 0
                    ? $"id:{upload.Id}"
                    : $"path:{upload.FilePath}",
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
        if (staged.Length == 0)
        {
            return;
        }

        var removableIds = new List<int>();
        foreach (var upload in staged)
        {
            try
            {
                var fullPath = _fileUploadService.GetFullPath(upload);
                if (System.IO.File.Exists(fullPath))
                    System.IO.File.Delete(fullPath);

                if (upload.Id > 0)
                    removableIds.Add(upload.Id);
            }
            catch (Exception exception)
            {
                // Keep the database row when bytes cannot be removed. That
                // preserves a discoverable cleanup record instead of creating
                // an untracked filesystem leak.
                _logger.LogCritical(
                    exception,
                    "Failed to remove staged message file {FileUploadId} at {Path}; retaining its database row and continuing cleanup",
                    upload.Id,
                    upload.FilePath);
            }
        }

        var ids = removableIds.Distinct().ToArray();
        if (ids.Length > 0)
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var cleanupDb = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                await cleanupDb.FileUploads
                    .IgnoreQueryFilters()
                    .Where(upload => ids.Contains(upload.Id))
                    .ExecuteDeleteAsync(CancellationToken.None);
            }
            catch (Exception exception)
            {
                _logger.LogCritical(
                    exception,
                    "Failed to remove staged message upload rows {FileUploadIds}",
                    string.Join(',', ids));
            }
        }
    }

    private bool IsLaravelV2Request() => Request.Path.StartsWithSegments("/api/v2", StringComparison.OrdinalIgnoreCase);

    private int? GetCurrentUserId() => User.GetUserId();

    private async Task<(SendMessageRequest Request, IReadOnlyList<IFormFile> Attachments)> ReadSendMessageRequestAsync(CancellationToken ct)
    {
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(ct);
            return (new SendMessageRequest
            {
                RecipientId = ParseInt(FormValue(form, "recipient_id")),
                Body = FormRawValue(form, "body"),
                Content = FormRawValue(form, "content") ?? string.Empty,
                ListingId = ParseIntNullable(FormValue(form, "listing_id")),
                ContextType = FormValue(form, "context_type"),
                ContextId = ParseIntNullable(FormValue(form, "context_id"))
            }, ReadAttachmentFiles(form));
        }

        if (Request.ContentLength is 0 or null)
        {
            return (new SendMessageRequest(), []);
        }

        var request = await JsonSerializer.DeserializeAsync<SendMessageRequest>(Request.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web), ct)
            ?? new SendMessageRequest();
        return (request, []);
    }

    private static IReadOnlyList<IFormFile> ReadAttachmentFiles(IFormCollection form)
    {
        var files = form.Files.GetFiles("attachments[]")
            .Concat(form.Files.GetFiles("attachments"))
            .Where(file => file.Length > 0)
            .ToArray();
        return files;
    }

    private static string? FormValue(IFormCollection form, string key)
    {
        var value = form[key].ToString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string? FormRawValue(IFormCollection form, string key)
        => form.ContainsKey(key) ? form[key].ToString() : null;

    private static int ParseInt(string? value) =>
        int.TryParse(value, out var parsed) ? parsed : 0;

    private static int? ParseIntNullable(string? value) =>
        int.TryParse(value, out var parsed) ? parsed : null;

    private object MapLaravelReactAttachment(MessageAttachment attachment, FileUpload upload) => new
    {
        id = attachment.Id,
        message_id = attachment.MessageId,
        file_upload_id = upload.Id,
        original_filename = upload.OriginalFilename,
        file_name = upload.OriginalFilename,
        name = upload.OriginalFilename,
        content_type = upload.ContentType,
        mime_type = upload.ContentType,
        type = upload.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
            ? "image"
            : "file",
        file_size_bytes = upload.FileSizeBytes,
        file_size = upload.FileSizeBytes,
        size = upload.FileSizeBytes,
        url = _fileUploadService.GetDownloadUrl(upload),
        created_at = attachment.CreatedAt
    };
}

/// <summary>
/// Request model for sending a message.
/// </summary>
public class SendMessageRequest
{
    [JsonPropertyName("recipient_id")]
    public int RecipientId { get; set; }

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("body")]
    public string? Body { get; set; }

    [JsonPropertyName("listing_id")]
    public int? ListingId { get; set; }

    [JsonPropertyName("context_type")]
    public string? ContextType { get; set; }

    [JsonPropertyName("context_id")]
    public int? ContextId { get; set; }

    public string ResolvedContent => Body ?? Content;
}
