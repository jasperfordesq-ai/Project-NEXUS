// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Authenticated, tenant-scoped delivery for private direct-message media —
/// the port of Laravel's `MessageMediaController` (two of the four route gaps
/// Baseline 3 recorded; voice messages were UPLOADABLE here but never fetchable,
/// so a received voice message could not be played against this backend).
///
/// 🔴 THE HEADERS ARE THE CONTRACT (`MessageMediaController.php:70-80`): private
/// no-store caching, nosniff, a sandboxing CSP and same-site CORP on every media
/// response. They exist so a hostile upload rendered inline cannot script, and so no
/// shared cache ever holds a private message's audio. Do not "simplify" them away.
///
/// 🔴 Authorization mirrors Laravel's `authorizedMessage`: the caller must be a
/// message participant — its sender, or (because this backend models both direct and
/// group conversations through `conversation_participants`) a participant in the
/// message's conversation. 404 for an unknown message/media/missing file, 403 for a
/// non-participant. The 404-vs-403 split is Laravel's, kept deliberately.
/// </summary>
[ApiController]
[Authorize]
public class MessageMediaController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly FileUploadService _fileService;

    public MessageMediaController(NexusDbContext db, FileUploadService fileService)
    {
        _db = db;
        _fileService = fileService;
    }

    /// <summary>GET /api/v2/messages/{message}/voice — the message's audio attachment.</summary>
    // 🔴 No explicit /api/v2 attribute: AdminV2RouteAliasConvention rewrites every
    // `api/messages*` template into its /api/v2 alias (selector-copied, so [Authorize]
    // metadata survives — see the convention's own warning). Declaring v2 here too
    // would create a DUPLICATE v2 template and an AmbiguousMatchException at runtime.
    [HttpGet("api/messages/{message:int}/voice")]
    public async Task<IActionResult> Voice(int message)
    {
        var (record, forbidden) = await AuthorizedMessageAsync(message);
        if (record is null)
        {
            return forbidden ? Forbid() : NotFound(new { error = "Message not found" });
        }

        // Laravel resolves the message's own audio file; here a voice message is stored
        // as the message's attachment whose upload is audio (CreateVoiceMessage writes
        // exactly that pair). Taking the first audio attachment is therefore the same
        // file Laravel's `audio_url` names.
        var upload = await _db.MessageAttachments
            .AsNoTracking()
            .Where(a => a.MessageId == record.Id)
            .Select(a => a.FileUpload)
            .Where(f => f != null && f.ContentType.StartsWith("audio/"))
            .FirstOrDefaultAsync();

        return ServePrivate(upload);
    }

    /// <summary>GET /api/v2/messages/{message}/attachments/{attachment}.</summary>
    [HttpGet("api/messages/{message:int}/attachments/{attachment:int}")]
    public async Task<IActionResult> Attachment(int message, int attachment)
    {
        var (record, forbidden) = await AuthorizedMessageAsync(message);
        if (record is null)
        {
            return forbidden ? Forbid() : NotFound(new { error = "Message not found" });
        }

        // Scoped to the message exactly as Laravel scopes it (`where message_id`), so an
        // attachment id from someone else's message 404s rather than serving.
        var upload = await _db.MessageAttachments
            .AsNoTracking()
            .Where(a => a.Id == attachment && a.MessageId == record.Id)
            .Select(a => a.FileUpload)
            .FirstOrDefaultAsync();

        return ServePrivate(upload);
    }

    private async Task<(Message? Record, bool Forbidden)> AuthorizedMessageAsync(int messageId)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return (null, true);
        }

        var record = await _db.Messages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == messageId);
        if (record is null)
        {
            return (null, false);
        }

        var isParticipant = record.SenderId == userId.Value
            || await _db.ConversationParticipants
                .AsNoTracking()
                .AnyAsync(p => p.ConversationId == record.ConversationId && p.UserId == userId.Value)
            || await _db.Conversations
                .AsNoTracking()
                .AnyAsync(c => c.Id == record.ConversationId
                    && (c.Participant1Id == userId.Value || c.Participant2Id == userId.Value));

        return isParticipant ? (record, false) : (null, true);
    }

    private IActionResult ServePrivate(FileUpload? upload)
    {
        if (upload is null)
        {
            return NotFound(new { error = "Media not found" });
        }

        var fullPath = _fileService.GetFullPath(upload);
        if (!System.IO.File.Exists(fullPath))
        {
            return NotFound(new { error = "Media not found" });
        }

        // Laravel's private-media header set, byte for byte.
        Response.Headers.CacheControl = "private, no-store, max-age=0";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        Response.Headers["Cross-Origin-Resource-Policy"] = "same-site";

        var mime = string.IsNullOrWhiteSpace(upload.ContentType)
            ? "application/octet-stream"
            : upload.ContentType;
        return PhysicalFile(fullPath, mime);
    }
}
