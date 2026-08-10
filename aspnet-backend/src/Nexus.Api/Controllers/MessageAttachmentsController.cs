// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/messages")]
[Authorize]
public class MessageAttachmentsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    public MessageAttachmentsController(NexusDbContext db, TenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    /// <summary>GET /api/messages/{id}/attachments - List attachments for a message.</summary>
    [HttpGet("{messageId}/attachments")]
    public async Task<IActionResult> ListAttachments(int messageId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();

        var message = await _db.Messages.AsNoTracking()

            .FirstOrDefaultAsync(m => m.Id == messageId);

        if (message == null) return NotFound(new { error = "Message not found" });

        // Verify user is participant in the conversation
        var isParticipant = await _db.Conversations.AsNoTracking()
            .AnyAsync(c => c.Id == message.ConversationId &&
                           (c.Participant1Id == userId || c.Participant2Id == userId));
        if (!isParticipant) return Forbid();

        var attachments = await _db.MessageAttachments.AsNoTracking()
            .Include(a => a.FileUpload)
            .Where(a => a.MessageId == messageId)
            .Select(a => new
            {
                a.Id, a.MessageId, a.CreatedAt,
                file = new
                {
                    a.FileUpload!.Id,
                    a.FileUpload.OriginalFilename,
                    a.FileUpload.ContentType,
                    a.FileUpload.FileSizeBytes,
                    a.FileUpload.CreatedAt
                }
            })
            .ToListAsync();

        return Ok(new { data = attachments });
    }

    /// <summary>POST /api/messages/{id}/attachments - Attach an uploaded file to a message.</summary>
    [HttpPost("{messageId}/attachments")]
    public async Task<IActionResult> AddAttachment(int messageId, [FromBody] AddAttachmentRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();

        var message = await _db.Messages.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == messageId);
        if (message == null) return NotFound(new { error = "Message not found" });

        // Verify user sent this message
        if (message.SenderId != userId)
            return Forbid();

        // Verify file belongs to user
        var file = await _db.FileUploads.AsNoTracking()
            .FirstOrDefaultAsync(f => f.Id == request.FileUploadId && f.UserId == userId);
        if (file == null) return NotFound(new { error = "File not found or not owned by you" });

        // Check not already attached
        var alreadyAttached = await _db.MessageAttachments
            .AnyAsync(a => a.MessageId == messageId && a.FileUploadId == request.FileUploadId);
        if (alreadyAttached) return Conflict(new { error = "File already attached to this message" });

        var attachment = new MessageAttachment
        {
            MessageId = messageId,
            FileUploadId = request.FileUploadId,
            UploadedById = userId.Value
        };
        _db.MessageAttachments.Add(attachment);
        await _db.SaveChangesAsync();

        return StatusCode(201, new { success = true, id = attachment.Id });
    }

    /// <summary>DELETE /api/messages/{messageId}/attachments/{id} - Remove attachment from message.</summary>
    [HttpDelete("{messageId}/attachments/{id:int}")]
    public async Task<IActionResult> RemoveAttachment(int messageId, int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();

        var attachment = await _db.MessageAttachments
            .FirstOrDefaultAsync(a => a.Id == id && a.MessageId == messageId);
        if (attachment == null) return NotFound(new { error = "Attachment not found" });

        if (attachment.UploadedById != userId) return Forbid();

        _db.MessageAttachments.Remove(attachment);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }
}

public class AddAttachmentRequest
{
    public int FileUploadId { get; set; }
}
