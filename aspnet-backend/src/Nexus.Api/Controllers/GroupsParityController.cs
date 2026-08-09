// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// V1.5 compatibility endpoints for advanced group modules.
/// </summary>
[ApiController]
[Route("api/groups")]
[Authorize]
public class GroupsParityController : ControllerBase
{
    private const string GroupTaskKeyPrefix = "compat:group-task:";
    private const string GroupChatroomKeyPrefix = "compat:group-chatroom:";
    private const string GroupChatroomMessageKeyPrefix = "compat:group-chatroom-message:";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GroupQaMutationService _qaMutations;
    private readonly GroupInviteLifecycleService _invites;

    public GroupsParityController(NexusDbContext db, TenantContext tenantContext, GroupQaMutationService qaMutations, GroupInviteLifecycleService invites)
    {
        _db = db;
        _tenantContext = tenantContext;
        _qaMutations = qaMutations;
        _invites = invites;
    }

    [HttpGet("recommendations")]
    public async Task<IActionResult> Recommendations([FromQuery] int limit = 10)
    {
        var tenantId = TenantId();
        var joined = await _db.GroupMembers.Where(m => m.UserId == UserId()).Select(m => m.GroupId).ToListAsync();
        var groups = await _db.Groups.Where(g => g.TenantId == tenantId && !joined.Contains(g.Id))
            .OrderByDescending(g => _db.GroupMembers.Count(m => m.GroupId == g.Id))
            .Take(Math.Clamp(limit, 1, 50))
            .ToListAsync();
        return Ok(new { data = groups.Select(g => new { group = MapGroup(g), score = 75, reason = "Popular in your community" }) });
    }

    [HttpGet("recommendations/metrics")]
    public async Task<IActionResult> RecommendationMetrics()
    {
        var tenantId = TenantId();
        var eventsCount = await _db.GroupRecommendationEvents.CountAsync(e => e.TenantId == tenantId);
        return Ok(new { data = new { events = eventsCount, click_through_rate = eventsCount == 0 ? 0 : 0.18m } });
    }

    [HttpPost("recommendations/track")]
    public async Task<IActionResult> TrackRecommendation([FromBody] JsonElement body)
    {
        _db.GroupRecommendationEvents.Add(new GroupRecommendationEvent
        {
            TenantId = TenantId(),
            UserId = UserId(),
            GroupId = Int(body, "group_id"),
            EventType = Str(body, "event_type") ?? "view"
        });
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpGet("{groupId:int}/analytics")]
    public async Task<IActionResult> Analytics(int groupId) => Ok(new { data = await AnalyticsData(groupId) });

    [HttpGet("{groupId:int}/analytics/engagement")]
    public async Task<IActionResult> Engagement(int groupId)
    {
        var tenantId = TenantId();
        return Ok(new
        {
            data = new
            {
                discussions = await _db.GroupDiscussions.CountAsync(d => d.TenantId == tenantId && d.GroupId == groupId),
                replies = await _db.GroupDiscussionReplies.CountAsync(r => r.TenantId == tenantId),
                questions = await _db.GroupQuestions.CountAsync(q => q.TenantId == tenantId && q.GroupId == groupId)
            }
        });
    }

    [HttpGet("{groupId:int}/analytics/growth")]
    public async Task<IActionResult> Growth(int groupId)
    {
        var members = await _db.GroupMembers.Where(m => m.GroupId == groupId).GroupBy(m => m.JoinedAt.Date).Select(g => new { date = g.Key, members = g.Count() }).ToListAsync();
        return Ok(new { data = members });
    }

    [HttpGet("{groupId:int}/analytics/retention")]
    public async Task<IActionResult> Retention(int groupId)
    {
        var total = await _db.GroupMembers.CountAsync(m => m.GroupId == groupId);
        return Ok(new { data = new { group_id = groupId, retained_members = total, retention_rate = total == 0 ? 0 : 1m } });
    }

    [HttpGet("{groupId:int}/analytics/contributors")]
    public async Task<IActionResult> Contributors(int groupId)
    {
        var tenantId = TenantId();
        var authors = await _db.GroupDiscussions.Where(d => d.TenantId == tenantId && d.GroupId == groupId)
            .GroupBy(d => d.AuthorId)
            .Select(g => new { user_id = g.Key, contributions = g.Count() })
            .OrderByDescending(x => x.contributions)
            .ToListAsync();
        return Ok(new { data = authors });
    }

    [HttpGet("{groupId:int}/analytics/comparative")]
    public async Task<IActionResult> Comparative(int groupId)
    {
        var current = await AnalyticsData(groupId);
        var tenantId = TenantId();
        var avgMembers = await _db.Groups.Where(g => g.TenantId == tenantId).Select(g => _db.GroupMembers.Count(m => m.GroupId == g.Id)).AverageAsync();
        return Ok(new { data = new { current, tenant_average_members = Math.Round(avgMembers, 2) } });
    }

    [HttpGet("{groupId:int}/analytics/export/activity")]
    public async Task<IActionResult> ExportActivity(int groupId) => File(Encoding.UTF8.GetBytes($"group_id,metric,value\n{groupId},activity,1\n"), "text/csv", $"group-{groupId}-activity.csv");

    [HttpGet("{groupId:int}/analytics/export/members")]
    public async Task<IActionResult> ExportMembers(int groupId)
    {
        var members = await _db.GroupMembers.Where(m => m.GroupId == groupId).Include(m => m.User).ToListAsync();
        var csv = new StringBuilder("user_id,email,role,joined_at\n");
        foreach (var m in members) csv.AppendLine($"{m.UserId},{Csv(m.User?.Email)},{Csv(m.Role)},{m.JoinedAt:o}");
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", $"group-{groupId}-members.csv");
    }

    [HttpGet("{groupId:int}/export")]
    [HttpGet("/api/v2/groups/{groupId:int}/export")]
    public IActionResult ExportGroup(int groupId) => StatusCode(StatusCodes.Status410Gone, new
    {
        error = new { code = "CAPABILITY_RETIRED", message = "Use the queued group export endpoint" }
    });

    [HttpGet("{groupId:int}/invites")]
    public async Task<IActionResult> Invites(int groupId)
    {
        var tenantId = TenantId();
        var invites = await _db.GroupInvites.Where(i => i.TenantId == tenantId && i.GroupId == groupId).OrderByDescending(i => i.CreatedAt).ToListAsync();
        return Ok(new { data = invites });
    }

    [HttpPost("{groupId:int}/invites/link")]
    public async Task<IActionResult> InviteLink(int groupId)
    {
        var invite = NewInvite(groupId, null);
        _db.GroupInvites.Add(invite);
        await _db.SaveChangesAsync();
        return Ok(new { data = invite, url = $"/api/groups/invite/{invite.Token}/accept" });
    }

    [HttpPost("{groupId:int}/invites/email")]
    public async Task<IActionResult> InviteEmail(int groupId, [FromBody] JsonElement body)
    {
        var invite = NewInvite(groupId, Str(body, "email"));
        _db.GroupInvites.Add(invite);
        await _db.SaveChangesAsync();
        return Ok(new { data = invite });
    }

    [HttpDelete("{groupId:int}/invites/{inviteId:int}")]
    public async Task<IActionResult> DeleteInvite(int groupId, int inviteId)
    {
        var invite = await _db.GroupInvites.FirstOrDefaultAsync(i => i.TenantId == TenantId() && i.GroupId == groupId && i.Id == inviteId);
        if (invite == null) return NotFound(new { error = "Invite not found" });
        _db.GroupInvites.Remove(invite);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("invite/{token}")]
    [HttpGet("/api/v2/groups/invite/{token}")]
    public async Task<IActionResult> PreviewInvite(string token, CancellationToken ct)
    {
        var result = await _invites.PreviewAsync(TenantId(), UserId(), token, ct);
        return InviteResult(result);
    }

    [HttpPost("invite/{token}/accept")]
    [HttpPost("/api/v2/groups/invite/{token}/accept")]
    public async Task<IActionResult> AcceptInvite(string token, CancellationToken ct)
    {
        var result = await _invites.AcceptAsync(TenantId(), UserId(), token, ct);
        return InviteResult(result);
    }

    [HttpGet("{groupId:int}/media")]
    public async Task<IActionResult> Media(int groupId) => Ok(new { data = await _db.GroupMediaItems.Where(m => m.TenantId == TenantId() && m.GroupId == groupId).ToListAsync() });

    [HttpPost("{groupId:int}/media")]
    public async Task<IActionResult> AddMedia(int groupId, [FromBody] JsonElement body)
    {
        var item = new GroupMediaItem { TenantId = TenantId(), GroupId = groupId, UploadedByUserId = UserId(), Url = Required(Str(body, "url"), "url"), MediaType = Str(body, "media_type") ?? "image", Caption = Str(body, "caption") };
        _db.GroupMediaItems.Add(item);
        await _db.SaveChangesAsync();
        return Ok(new { data = item });
    }

    [HttpDelete("{groupId:int}/media/{mediaId:int}")]
    public async Task<IActionResult> DeleteMedia(int groupId, int mediaId)
    {
        var item = await _db.GroupMediaItems.FirstOrDefaultAsync(m => m.TenantId == TenantId() && m.GroupId == groupId && m.Id == mediaId);
        if (item == null) return NotFound(new { error = "Media not found" });
        _db.GroupMediaItems.Remove(item);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{groupId:int}/wiki")]
    public async Task<IActionResult> Wiki(int groupId) => Ok(new { data = await _db.GroupWikiPages.Where(w => w.TenantId == TenantId() && w.GroupId == groupId).OrderBy(w => w.Title).ToListAsync() });

    [HttpGet("{groupId:int}/wiki/{pageId:int}")]
    public async Task<IActionResult> WikiPage(int groupId, int pageId)
    {
        var page = await _db.GroupWikiPages.FirstOrDefaultAsync(w => w.TenantId == TenantId() && w.GroupId == groupId && w.Id == pageId);
        return page == null ? NotFound(new { error = "Wiki page not found" }) : Ok(new { data = page });
    }

    [HttpPost("{groupId:int}/wiki")]
    public async Task<IActionResult> CreateWiki(int groupId, [FromBody] JsonElement body)
    {
        var page = new GroupWikiPage { TenantId = TenantId(), GroupId = groupId, AuthorUserId = UserId(), Title = Required(Str(body, "title"), "title"), Slug = Slug(Str(body, "slug") ?? Str(body, "title")!), Content = Str(body, "content") ?? string.Empty };
        _db.GroupWikiPages.Add(page);
        await _db.SaveChangesAsync();
        await AddRevision(page);
        return Ok(new { data = page });
    }

    [HttpPut("{groupId:int}/wiki/{pageId:int}")]
    public async Task<IActionResult> UpdateWiki(int groupId, int pageId, [FromBody] JsonElement body)
    {
        var page = await _db.GroupWikiPages.FirstOrDefaultAsync(w => w.TenantId == TenantId() && w.GroupId == groupId && w.Id == pageId);
        if (page == null) return NotFound(new { error = "Wiki page not found" });
        page.Title = Str(body, "title") ?? page.Title;
        page.Content = Str(body, "content") ?? page.Content;
        page.Revision++;
        page.UpdatedAt = DateTime.UtcNow;
        await AddRevision(page);
        await _db.SaveChangesAsync();
        return Ok(new { data = page });
    }

    [HttpDelete("{groupId:int}/wiki/{pageId:int}")]
    public async Task<IActionResult> DeleteWiki(int groupId, int pageId)
    {
        var page = await _db.GroupWikiPages.FirstOrDefaultAsync(w => w.TenantId == TenantId() && w.GroupId == groupId && w.Id == pageId);
        if (page == null) return NotFound(new { error = "Wiki page not found" });
        _db.GroupWikiPages.Remove(page);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{groupId:int}/wiki/{pageId:int}/revisions")]
    public async Task<IActionResult> WikiRevisions(int groupId, int pageId) => Ok(new { data = await _db.GroupWikiRevisions.Where(r => r.TenantId == TenantId() && r.PageId == pageId).ToListAsync() });

    [HttpGet("{groupId:int}/questions")]
    public async Task<IActionResult> Questions(int groupId) => Ok(new { data = await _db.GroupQuestions.Where(q => q.TenantId == TenantId() && q.GroupId == groupId).ToListAsync() });

    [HttpGet("{groupId:int}/questions/{questionId:int}")]
    public async Task<IActionResult> Question(int groupId, int questionId)
    {
        var q = await _db.GroupQuestions.FirstOrDefaultAsync(x => x.TenantId == TenantId() && x.GroupId == groupId && x.Id == questionId);
        if (q == null) return NotFound(new { error = "Question not found" });
        var answers = await _db.GroupAnswers.Where(a => a.TenantId == TenantId() && a.QuestionId == questionId).ToListAsync();
        return Ok(new { data = q, answers });
    }

    [HttpPost("{groupId:int}/questions")]
    public async Task<IActionResult> CreateQuestion(int groupId, [FromBody] JsonElement body)
    {
        return QaMutationResponse(await _qaMutations.CreateQuestionAsync(
            TenantId(), groupId, UserId(), Str(body, "title") ?? string.Empty,
            Str(body, "body") ?? Str(body, "content") ?? string.Empty));
    }

    [HttpPost("{groupId:int}/questions/{questionId:int}/answers")]
    public async Task<IActionResult> CreateAnswer(int groupId, int questionId, [FromBody] JsonElement body)
    {
        return QaMutationResponse(await _qaMutations.CreateAnswerAsync(
            TenantId(), groupId, questionId, UserId(),
            Str(body, "body") ?? Str(body, "content") ?? string.Empty));
    }

    [HttpPut("{groupId:int}/questions/{questionId:int}")]
    public async Task<IActionResult> UpdateQuestion(int groupId, int questionId, [FromBody] JsonElement body, CancellationToken cancellationToken)
    {
        var result = await _qaMutations.UpdateQuestionAsync(
            TenantId(), groupId, questionId, UserId(), Str(body, "title") ?? string.Empty,
            Str(body, "body") ?? string.Empty, cancellationToken);
        return QaMutationResponse(result);
    }

    [HttpDelete("{groupId:int}/questions/{questionId:int}")]
    public async Task<IActionResult> DeleteQuestion(int groupId, int questionId, CancellationToken cancellationToken) =>
        QaMutationResponse(await _qaMutations.DeleteQuestionAsync(
            TenantId(), groupId, questionId, UserId(), cancellationToken));

    [HttpPut("{groupId:int}/answers/{answerId:int}")]
    public async Task<IActionResult> UpdateAnswer(int groupId, int answerId, [FromBody] JsonElement body, CancellationToken cancellationToken)
    {
        var result = await _qaMutations.UpdateAnswerAsync(
            TenantId(), groupId, answerId, UserId(), Str(body, "body") ?? string.Empty, cancellationToken);
        return QaMutationResponse(result);
    }

    [HttpDelete("{groupId:int}/answers/{answerId:int}")]
    public async Task<IActionResult> DeleteAnswer(int groupId, int answerId, CancellationToken cancellationToken) =>
        QaMutationResponse(await _qaMutations.DeleteAnswerAsync(
            TenantId(), groupId, answerId, UserId(), cancellationToken));

    [HttpPost("{groupId:int}/answers/{answerId:int}/accept")]
    public async Task<IActionResult> AcceptAnswer(int groupId, int answerId)
    {
        return QaMutationResponse(await _qaMutations.AcceptAnswerAsync(
            TenantId(), groupId, answerId, UserId()));
    }

    private IActionResult QaMutationResponse(GroupQaMutationResult result) => result.Succeeded
        ? Ok(new { data = result.Data })
        : StatusCode(result.Error!.Status, new
        {
            success = false,
            errors = new[] { new { code = result.Error.Code, message = result.Error.Message, field = (string?)null } }
        });

    [HttpPost("{groupId:int}/qa/vote")]
    public async Task<IActionResult> Vote(int groupId, [FromBody] JsonElement body)
    {
        var targetType = Str(body, "target_type") ?? "question";
        var targetId = Int(body, "target_id") ?? 0;
        var vote = await _db.GroupQaVotes.FirstOrDefaultAsync(v => v.TenantId == TenantId() && v.UserId == UserId() && v.TargetType == targetType && v.TargetId == targetId);
        if (vote == null)
        {
            vote = new GroupQaVote { TenantId = TenantId(), UserId = UserId(), TargetType = targetType, TargetId = targetId };
            _db.GroupQaVotes.Add(vote);
        }
        vote.Value = Int(body, "value") ?? 1;
        await _db.SaveChangesAsync();
        return Ok(new { data = vote });
    }

    [HttpGet("{groupId:int}/challenges")]
    public async Task<IActionResult> Challenges(int groupId) => Ok(new { data = await _db.GroupChallenges.Where(c => c.TenantId == TenantId() && c.GroupId == groupId).ToListAsync() });

    [HttpPost("{groupId:int}/challenges")]
    public async Task<IActionResult> CreateChallenge(int groupId, [FromBody] JsonElement body)
    {
        var challenge = new GroupChallenge { TenantId = TenantId(), GroupId = groupId, CreatedByUserId = UserId(), Title = Required(Str(body, "title"), "title"), Description = Str(body, "description"), StartsAt = Date(body, "starts_at"), EndsAt = Date(body, "ends_at") };
        _db.GroupChallenges.Add(challenge);
        await _db.SaveChangesAsync();
        return Ok(new { data = challenge });
    }

    [HttpDelete("{groupId:int}/challenges/{challengeId:int}")]
    public async Task<IActionResult> DeleteChallenge(int groupId, int challengeId)
    {
        var challenge = await _db.GroupChallenges.FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.GroupId == groupId && c.Id == challengeId);
        if (challenge == null) return NotFound(new { error = "Challenge not found" });
        _db.GroupChallenges.Remove(challenge);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{groupId:int}/scheduled-posts")]
    public async Task<IActionResult> ScheduledPosts(int groupId) => Ok(new { data = await _db.GroupScheduledPosts.Where(p => p.TenantId == TenantId() && p.GroupId == groupId).ToListAsync() });

    [HttpPost("{groupId:int}/scheduled-posts")]
    public async Task<IActionResult> CreateScheduledPost(int groupId, [FromBody] JsonElement body)
    {
        var post = new GroupScheduledPost { TenantId = TenantId(), GroupId = groupId, AuthorUserId = UserId(), Content = Required(Str(body, "content"), "content"), ScheduledFor = Date(body, "scheduled_for") ?? DateTime.UtcNow.AddHours(1) };
        _db.GroupScheduledPosts.Add(post);
        await _db.SaveChangesAsync();
        return Ok(new { data = post });
    }

    [HttpDelete("{groupId:int}/scheduled-posts/{postId:int}")]
    public async Task<IActionResult> DeleteScheduledPost(int groupId, int postId)
    {
        var post = await _db.GroupScheduledPosts.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.GroupId == groupId && p.Id == postId);
        if (post == null) return NotFound(new { error = "Scheduled post not found" });
        _db.GroupScheduledPosts.Remove(post);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{groupId:int}/webhooks")]
    public async Task<IActionResult> Webhooks(int groupId) => Ok(new { data = await _db.GroupWebhooks.Where(w => w.TenantId == TenantId() && w.GroupId == groupId).ToListAsync() });

    [HttpPost("{groupId:int}/webhooks")]
    public async Task<IActionResult> CreateWebhook(int groupId, [FromBody] JsonElement body)
    {
        var webhook = new GroupWebhook { TenantId = TenantId(), GroupId = groupId, CreatedByUserId = UserId(), Url = Required(Str(body, "url"), "url"), Events = Raw(body, "events") ?? "[]" };
        _db.GroupWebhooks.Add(webhook);
        await _db.SaveChangesAsync();
        return Ok(new { data = webhook });
    }

    [HttpPut("{groupId:int}/webhooks/{webhookId:int}/toggle")]
    public async Task<IActionResult> ToggleWebhook(int groupId, int webhookId)
    {
        var hook = await _db.GroupWebhooks.FirstOrDefaultAsync(w => w.TenantId == TenantId() && w.GroupId == groupId && w.Id == webhookId);
        if (hook == null) return NotFound(new { error = "Webhook not found" });
        hook.IsActive = !hook.IsActive;
        await _db.SaveChangesAsync();
        return Ok(new { data = hook });
    }

    [HttpDelete("{groupId:int}/webhooks/{webhookId:int}")]
    public async Task<IActionResult> DeleteWebhook(int groupId, int webhookId)
    {
        var hook = await _db.GroupWebhooks.FirstOrDefaultAsync(w => w.TenantId == TenantId() && w.GroupId == groupId && w.Id == webhookId);
        if (hook == null) return NotFound(new { error = "Webhook not found" });
        _db.GroupWebhooks.Remove(hook);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{groupId:int}/notification-prefs")]
    public async Task<IActionResult> NotificationPrefs(int groupId)
    {
        var prefs = await GetOrCreatePrefs(groupId);
        return Ok(new { data = prefs });
    }

    [HttpPut("{groupId:int}/notification-prefs")]
    public async Task<IActionResult> UpdateNotificationPrefs(int groupId, [FromBody] JsonElement body)
    {
        var prefs = await GetOrCreatePrefs(groupId);
        prefs.EmailNotifications = Bool(body, "email_notifications") ?? prefs.EmailNotifications;
        prefs.PushNotifications = Bool(body, "push_notifications") ?? prefs.PushNotifications;
        prefs.DigestFrequency = Str(body, "digest_frequency") ?? prefs.DigestFrequency;
        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = prefs });
    }

    [HttpGet("{groupId:int}/custom-fields")]
    public async Task<IActionResult> CustomFields(int groupId) => Ok(new { data = await _db.GroupCustomFields.Where(f => f.TenantId == TenantId() && f.GroupId == groupId).ToListAsync() });

    [HttpPut("{groupId:int}/custom-fields")]
    public async Task<IActionResult> SetCustomFields(int groupId, [FromBody] JsonElement body)
    {
        var fields = body.ValueKind == JsonValueKind.Array ? body.EnumerateArray().ToList() : new List<JsonElement> { body };
        foreach (var f in fields)
        {
            var key = Required(Str(f, "key"), "key");
            var field = await _db.GroupCustomFields.FirstOrDefaultAsync(x => x.TenantId == TenantId() && x.GroupId == groupId && x.Key == key);
            if (field == null)
            {
                field = new GroupCustomField { TenantId = TenantId(), GroupId = groupId, Key = key };
                _db.GroupCustomFields.Add(field);
            }
            field.Label = Str(f, "label") ?? key;
            field.FieldType = Str(f, "field_type") ?? "text";
            field.IsRequired = Bool(f, "is_required") ?? false;
        }
        await _db.SaveChangesAsync();
        return await CustomFields(groupId);
    }

    [HttpGet("{groupId:int}/welcome")]
    public async Task<IActionResult> Welcome(int groupId)
    {
        var settings = await GetOrCreateWelcome(groupId);
        return Ok(new { data = settings });
    }

    [HttpPut("{groupId:int}/welcome")]
    public async Task<IActionResult> UpdateWelcome(int groupId, [FromBody] JsonElement body)
    {
        var settings = await GetOrCreateWelcome(groupId);
        settings.Message = Str(body, "message") ?? settings.Message;
        settings.SendOnJoin = Bool(body, "send_on_join") ?? settings.SendOnJoin;
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = settings });
    }

    [HttpGet("{groupId:int}/tags")]
    public async Task<IActionResult> Tags(int groupId)
    {
        var policy = await _db.GroupPolicies.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.GroupId == groupId && p.Key == "tags");
        return Ok(new { data = string.IsNullOrWhiteSpace(policy?.Value) ? Array.Empty<string>() : policy.Value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) });
    }

    [HttpPut("{groupId:int}/tags")]
    public async Task<IActionResult> SetTags(int groupId, [FromBody] JsonElement body)
    {
        var tags = body.ValueKind == JsonValueKind.Array ? string.Join(",", body.EnumerateArray().Select(x => x.ToString())) : Str(body, "tags") ?? string.Empty;
        var policy = await _db.GroupPolicies.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.GroupId == groupId && p.Key == "tags");
        if (policy == null)
        {
            policy = new GroupPolicy { TenantId = TenantId(), GroupId = groupId, Key = "tags" };
            _db.GroupPolicies.Add(policy);
        }
        policy.Value = tags;
        policy.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return await Tags(groupId);
    }

    [HttpGet("{groupId:int}/mentions/suggest")]
    public async Task<IActionResult> MentionSuggest(int groupId, [FromQuery] string? q = null)
    {
        var members = await _db.GroupMembers.Where(m => m.GroupId == groupId).Include(m => m.User).ToListAsync();
        var data = members.Where(m => q == null || (m.User!.FirstName + " " + m.User.LastName).Contains(q, StringComparison.OrdinalIgnoreCase)).Select(m => MapUser(m.User));
        return Ok(new { data });
    }

    [HttpGet("{groupId:int}/similar")]
    public async Task<IActionResult> Similar(int groupId)
    {
        var group = await _db.Groups.FirstOrDefaultAsync(g => g.TenantId == TenantId() && g.Id == groupId);
        if (group == null) return NotFound(new { error = "Group not found" });
        var data = await _db.Groups.Where(g => g.TenantId == TenantId() && g.Id != groupId && (g.IsPrivate == group.IsPrivate || g.Name.Contains(group.Name.Substring(0, 1)))).Take(10).ToListAsync();
        return Ok(new { data = data.Select(MapGroup) });
    }

    [HttpGet("{groupId:int}/files/folders")]
    public async Task<IActionResult> FileFolders(int groupId)
    {
        var files = await _db.GroupFiles.Where(f => f.TenantId == TenantId() && f.GroupId == groupId).ToListAsync();
        return Ok(new { data = files.Select(f => (f.Description ?? "General")).Distinct() });
    }

    [HttpGet("{groupId:int}/files/stats")]
    public async Task<IActionResult> FileStats(int groupId)
    {
        var files = await _db.GroupFiles.Where(f => f.TenantId == TenantId() && f.GroupId == groupId).ToListAsync();
        return Ok(new { data = new { count = files.Count, bytes = files.Sum(f => f.FileSizeBytes) } });
    }

    [HttpGet("{groupId:int}/files/{fileId:int}/download")]
    public async Task<IActionResult> DownloadFile(int groupId, int fileId)
    {
        var file = await _db.GroupFiles.FirstOrDefaultAsync(f => f.TenantId == TenantId() && f.GroupId == groupId && f.Id == fileId);
        return file == null ? NotFound(new { error = "File not found" }) : Redirect(file.FileUrl);
    }

    [HttpGet("{groupId:int}/chatrooms")]
    public async Task<IActionResult> Chatrooms(int groupId)
    {
        if (!await IsGroupMemberOrCreator(groupId))
            return StatusCode(403, new { error = "Only group members can view chatrooms" });

        var messages = await ReadStoredChatroomMessagesAsync();
        var rooms = (await ReadStoredChatroomsAsync())
            .Where(c => c.GroupId == groupId)
            .OrderByDescending(c => c.IsDefault)
            .ThenBy(c => c.Name)
            .Select(c => ToLaravelChatroomDto(c, messages.Count(m => m.ChatroomId == c.Id)))
            .ToArray();

        return Ok(new { success = true, data = rooms });
    }

    [HttpPost("{groupId:int}/chatrooms")]
    public async Task<IActionResult> CreateChatroom(int groupId, [FromBody] JsonElement body)
    {
        if (!await IsGroupMemberOrCreator(groupId))
            return StatusCode(403, new { error = "Only group members can create chatrooms" });

        var name = Str(body, "name")?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { success = false, errors = new[] { new { code = "VALIDATION_ERROR", message = "Chatroom name is required", field = "name" } } });

        var now = DateTime.UtcNow;
        var config = new TenantConfig
        {
            TenantId = TenantId(),
            Key = $"{GroupChatroomKeyPrefix}{Guid.NewGuid():N}",
            Value = JsonSerializer.Serialize(new
            {
                kind = "group_chatroom",
                group_id = groupId,
                name,
                description = Str(body, "description"),
                category = Str(body, "category"),
                is_default = false,
                is_private = Bool(body, "is_private") ?? false,
                created_by = UserId(),
                created_at = now
            }),
            CreatedAt = now
        };

        _db.TenantConfigs.Add(config);
        await _db.SaveChangesAsync();

        var chatroom = ParseStoredChatroom(config)!;
        return CreatedAtAction(null, new { success = true, data = ToLaravelChatroomDto(chatroom, 0) });
    }

    [HttpPost("{groupId:int}/chatrooms/{chatroomId:int}/pin/{messageId:int}")]
    public async Task<IActionResult> PinMessage(int groupId, int chatroomId, int messageId)
    {
        if (!await IsGroupAdminOrCreator(groupId))
            return StatusCode(403, new { error = "Only group admins can pin messages" });

        var chatroom = await FindStoredChatroomAsync(chatroomId);
        var message = await FindStoredChatroomMessageAsync(messageId);
        if (chatroom == null || chatroom.GroupId != groupId)
            return NotFound(new { error = "Chatroom not found" });
        if (message == null || message.ChatroomId != chatroomId)
            return NotFound(new { error = "Message not found" });

        if (!await _db.GroupChatroomPins.AnyAsync(p => p.TenantId == TenantId() && p.GroupId == groupId && p.ChatroomId == chatroomId && p.MessageId == messageId))
        {
            _db.GroupChatroomPins.Add(new GroupChatroomPin { TenantId = TenantId(), GroupId = groupId, ChatroomId = chatroomId, MessageId = messageId, PinnedByUserId = UserId() });
        }

        await _db.SaveChangesAsync();
        return CreatedAtAction(null, new { success = true, data = new { pinned = true } });
    }

    [HttpDelete("{groupId:int}/chatrooms/{chatroomId:int}/pin/{messageId:int}")]
    public async Task<IActionResult> UnpinMessage(int groupId, int chatroomId, int messageId)
    {
        if (!await IsGroupAdminOrCreator(groupId))
            return StatusCode(403, new { error = "Only group admins can unpin messages" });

        var pin = await _db.GroupChatroomPins.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.GroupId == groupId && p.ChatroomId == chatroomId && p.MessageId == messageId);
        if (pin != null) _db.GroupChatroomPins.Remove(pin);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{groupId:int}/chatrooms/{chatroomId:int}/pinned")]
    public async Task<IActionResult> PinnedMessages(int groupId, int chatroomId)
    {
        if (!await IsGroupMemberOrCreator(groupId))
            return StatusCode(403, new { error = "Only group members can view pinned messages" });

        var messages = await ReadStoredChatroomMessagesAsync();
        var pins = await _db.GroupChatroomPins
            .AsNoTracking()
            .Where(p => p.TenantId == TenantId() && p.GroupId == groupId && p.ChatroomId == chatroomId)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();

        var data = pins
            .Select(pin => new { Pin = pin, Message = messages.FirstOrDefault(m => m.Id == pin.MessageId) })
            .Where(item => item.Message != null)
            .Select(item => ToLaravelPinnedMessageDto(item.Message!, item.Pin.PinnedByUserId, item.Pin.CreatedAt))
            .ToArray();

        return Ok(new { success = true, data });
    }

    [HttpGet("/api/group-chatrooms/{chatroomId:int}/messages")]
    public async Task<IActionResult> ChatroomMessages(int chatroomId)
    {
        var chatroom = await FindStoredChatroomAsync(chatroomId);
        if (chatroom == null) return NotFound(new { error = "Chatroom not found" });
        if (!await IsGroupMemberOrCreator(chatroom.GroupId))
            return StatusCode(403, new { error = "Only group members can view messages" });

        var perPage = QueryInt("per_page", 50, 1, 100);
        var cursor = QueryInt("cursor", null, 1, int.MaxValue);
        var messages = (await ReadStoredChatroomMessagesAsync())
            .Where(m => m.ChatroomId == chatroomId)
            .Where(m => cursor == null || m.Id < cursor)
            .OrderByDescending(m => m.Id)
            .Take(perPage + 1)
            .ToList();

        var hasMore = messages.Count > perPage;
        if (hasMore) messages.RemoveAt(messages.Count - 1);

        return Ok(new
        {
            success = true,
            data = messages.Select(ToLaravelChatroomMessageDto).ToArray(),
            meta = new
            {
                cursor = messages.Count > 0 ? messages[^1].Id.ToString() : null,
                per_page = perPage,
                has_more = hasMore
            }
        });
    }

    [HttpPost("/api/group-chatrooms/{chatroomId:int}/messages")]
    public async Task<IActionResult> PostChatroomMessage(int chatroomId, [FromBody] JsonElement body)
    {
        var chatroom = await FindStoredChatroomAsync(chatroomId);
        if (chatroom == null) return NotFound(new { error = "Chatroom not found" });
        if (!await IsGroupMemberOrCreator(chatroom.GroupId))
            return StatusCode(403, new { error = "Only group members can post messages" });

        var text = Str(body, "body")?.Trim();
        if (string.IsNullOrWhiteSpace(text))
            return BadRequest(new { success = false, errors = new[] { new { code = "VALIDATION_ERROR", message = "Message body is required", field = "body" } } });

        var now = DateTime.UtcNow;
        var config = new TenantConfig
        {
            TenantId = TenantId(),
            Key = $"{GroupChatroomMessageKeyPrefix}{Guid.NewGuid():N}",
            Value = JsonSerializer.Serialize(new
            {
                kind = "group_chatroom_message",
                group_id = chatroom.GroupId,
                chatroom_id = chatroomId,
                user_id = UserId(),
                body = text,
                created_at = now,
                updated_at = (DateTime?)null
            }),
            CreatedAt = now
        };

        _db.TenantConfigs.Add(config);
        await _db.SaveChangesAsync();

        return CreatedAtAction(null, new { success = true, data = new { id = config.Id } });
    }

    [HttpDelete("/api/group-chatroom-messages/{messageId:int}")]
    public async Task<IActionResult> DeleteChatroomMessage(int messageId)
    {
        var config = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.Id == messageId && c.Key.StartsWith(GroupChatroomMessageKeyPrefix));
        var message = config == null ? null : ParseStoredChatroomMessage(config);
        if (config == null || message == null) return NotFound(new { error = "Message not found" });

        if (message.UserId != UserId() && !await IsGroupAdminOrCreator(message.GroupId))
            return StatusCode(403, new { error = "Only the author or group admins can delete messages" });

        var pins = await _db.GroupChatroomPins.Where(p => p.TenantId == TenantId() && p.MessageId == messageId).ToListAsync();
        _db.GroupChatroomPins.RemoveRange(pins);
        _db.TenantConfigs.Remove(config);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("/api/group-chatrooms/{chatroomId:int}")]
    public async Task<IActionResult> DeleteStoredChatroom(int chatroomId)
    {
        var config = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.Id == chatroomId && c.Key.StartsWith(GroupChatroomKeyPrefix));
        var chatroom = config == null ? null : ParseStoredChatroom(config);
        if (config == null || chatroom == null) return NotFound(new { error = "Chatroom not found" });
        if (chatroom.IsDefault) return StatusCode(403, new { error = "Default chatroom cannot be deleted" });
        if (chatroom.CreatedBy != UserId() && !await IsGroupAdminOrCreator(chatroom.GroupId))
            return StatusCode(403, new { error = "Only the creator or group admins can delete chatrooms" });

        var messageRows = await _db.TenantConfigs
            .Where(c => c.TenantId == TenantId() && c.Key.StartsWith(GroupChatroomMessageKeyPrefix))
            .ToListAsync();
        var deletedMessageIds = messageRows
            .Select(ParseStoredChatroomMessage)
            .Where(m => m?.ChatroomId == chatroomId)
            .Select(m => m!.Id)
            .ToHashSet();
        var messagesToDelete = messageRows.Where(c => deletedMessageIds.Contains(c.Id)).ToList();
        var pins = await _db.GroupChatroomPins.Where(p => p.TenantId == TenantId() && p.ChatroomId == chatroomId).ToListAsync();

        _db.GroupChatroomPins.RemoveRange(pins);
        _db.TenantConfigs.RemoveRange(messagesToDelete);
        _db.TenantConfigs.Remove(config);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{groupId:int}/discussions/{discussionId:int}/messages")]
    public async Task<IActionResult> DiscussionMessage(int groupId, int discussionId, [FromBody] JsonElement body)
    {
        var reply = new GroupDiscussionReply { TenantId = TenantId(), DiscussionId = discussionId, AuthorId = UserId(), Content = Required(Str(body, "content") ?? Str(body, "message"), "content") };
        _db.GroupDiscussionReplies.Add(reply);
        await _db.SaveChangesAsync();
        return Ok(new { data = reply });
    }

    [HttpGet("{groupId:int}/documents")]
    public async Task<IActionResult> Documents(int groupId)
    {
        if (!await IsGroupMemberOrCreator(groupId))
            return StatusCode(403, new { error = "Only group members can view documents" });

        var perPage = QueryInt("per_page", 50, 1, 100);
        var cursor = QueryInt("cursor", null, 1, int.MaxValue);

        var documents = await _db.GroupFiles
            .AsNoTracking()
            .Include(f => f.UploadedBy)
            .Where(f => f.TenantId == TenantId() && f.GroupId == groupId)
            .Where(f => cursor == null || f.Id < cursor)
            .OrderByDescending(f => f.Id)
            .Take(perPage + 1)
            .ToListAsync();

        var hasMore = documents.Count > perPage;
        if (hasMore) documents.RemoveAt(documents.Count - 1);

        return Ok(new
        {
            success = true,
            data = documents.Select(ToLaravelTeamDocumentDto).ToArray(),
            meta = new
            {
                cursor = documents.Count > 0 ? documents[^1].Id.ToString() : null,
                per_page = perPage,
                has_more = hasMore
            }
        });
    }

    [HttpGet("{groupId:int}/tasks")]
    public async Task<IActionResult> Tasks(int groupId)
    {
        if (!await IsGroupMemberOrCreator(groupId))
            return StatusCode(403, new { error = "Only group members can view tasks" });

        var perPage = QueryInt("per_page", 50, 1, 100);
        var status = Request.Query["status"].FirstOrDefault();
        var assignedTo = QueryInt("assigned_to", null, 1, int.MaxValue);
        var cursor = QueryInt("cursor", null, 1, int.MaxValue);

        var tasks = await ReadStoredGroupTasksAsync();
        var filtered = tasks
            .Where(t => t.GroupId == groupId)
            .Where(t => string.IsNullOrWhiteSpace(status) || t.Status == status)
            .Where(t => assignedTo == null || t.AssignedTo == assignedTo)
            .Where(t => cursor == null || t.Id < cursor)
            .OrderByDescending(t => t.Id)
            .Take(perPage + 1)
            .ToList();

        var hasMore = filtered.Count > perPage;
        if (hasMore) filtered.RemoveAt(filtered.Count - 1);

        return Ok(new
        {
            success = true,
            data = filtered.Select(ToLaravelTeamTaskDto).ToArray(),
            meta = new
            {
                cursor = filtered.Count > 0 ? filtered[^1].Id.ToString() : null,
                per_page = perPage,
                has_more = hasMore
            }
        });
    }

    [HttpGet("{groupId:int}/task-stats")]
    public async Task<IActionResult> TaskStats(int groupId)
    {
        if (!await IsGroupMemberOrCreator(groupId))
            return StatusCode(403, new { error = "Only group members can view tasks" });

        var today = DateTime.UtcNow.Date;
        var tasks = (await ReadStoredGroupTasksAsync()).Where(t => t.GroupId == groupId).ToArray();

        return Ok(new
        {
            success = true,
            data = new
            {
                total = tasks.Length,
                todo = tasks.Count(t => t.Status == "todo"),
                in_progress = tasks.Count(t => t.Status == "in_progress"),
                done = tasks.Count(t => t.Status == "done"),
                overdue = tasks.Count(t =>
                    t.Status != "done" &&
                    DateTime.TryParse(t.DueDate, out var dueDate) &&
                    dueDate.Date < today)
            }
        });
    }

    private async Task<object> AnalyticsData(int groupId)
    {
        var tenantId = TenantId();
        return new
        {
            group_id = groupId,
            members = await _db.GroupMembers.CountAsync(m => m.GroupId == groupId),
            discussions = await _db.GroupDiscussions.CountAsync(d => d.TenantId == tenantId && d.GroupId == groupId),
            files = await _db.GroupFiles.CountAsync(f => f.TenantId == tenantId && f.GroupId == groupId),
            invites = await _db.GroupInvites.CountAsync(i => i.TenantId == tenantId && i.GroupId == groupId)
        };
    }

    private GroupInvite NewInvite(int groupId, string? email) => new()
    {
        TenantId = TenantId(), GroupId = groupId, InvitedByUserId = UserId(), Email = email,
        InviteType = email is null ? "link" : "email", Token = Token(), ExpiresAt = DateTime.UtcNow.AddDays(14)
    };

    private async Task AddRevision(GroupWikiPage page)
    {
        _db.GroupWikiRevisions.Add(new GroupWikiRevision { TenantId = page.TenantId, PageId = page.Id, AuthorUserId = UserId(), Revision = page.Revision, Title = page.Title, Content = page.Content });
        await _db.SaveChangesAsync();
    }

    private async Task<GroupNotificationPreference> GetOrCreatePrefs(int groupId)
    {
        var prefs = await _db.GroupNotificationPreferences.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.GroupId == groupId && p.UserId == UserId());
        if (prefs != null) return prefs;
        prefs = new GroupNotificationPreference { TenantId = TenantId(), GroupId = groupId, UserId = UserId() };
        _db.GroupNotificationPreferences.Add(prefs);
        await _db.SaveChangesAsync();
        return prefs;
    }

    private async Task<GroupWelcomeSettings> GetOrCreateWelcome(int groupId)
    {
        var settings = await _db.GroupWelcomeSettings.FirstOrDefaultAsync(w => w.TenantId == TenantId() && w.GroupId == groupId);
        if (settings != null) return settings;
        settings = new GroupWelcomeSettings { TenantId = TenantId(), GroupId = groupId, Message = "Welcome to the group." };
        _db.GroupWelcomeSettings.Add(settings);
        await _db.SaveChangesAsync();
        return settings;
    }

    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");

    private IActionResult InviteResult(GroupInviteResult result) => result.Succeeded
        ? Ok(new { data = result.Data })
        : StatusCode(result.Error!.Status, new { error = new { code = result.Error.Code, message = result.Error.Message } });

    private async Task<bool> IsGroupMemberOrCreator(int groupId)
    {
        var userId = UserId();
        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId);
        if (group?.CreatedById == userId) return true;

        return await _db.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);
    }

    private async Task<bool> IsGroupAdminOrCreator(int groupId)
    {
        var userId = UserId();
        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId);
        if (group?.CreatedById == userId) return true;

        return await _db.GroupMembers.AnyAsync(m =>
            m.GroupId == groupId &&
            m.UserId == userId &&
            (m.Role == Group.Roles.Owner || m.Role == Group.Roles.Admin));
    }

    private async Task<List<StoredGroupTask>> ReadStoredGroupTasksAsync()
    {
        var tenantId = TenantId();
        var configs = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(GroupTaskKeyPrefix))
            .ToListAsync();

        return configs
            .Select(ParseStoredGroupTask)
            .Where(task => task != null)
            .Cast<StoredGroupTask>()
            .ToList();
    }

    private static StoredGroupTask? ParseStoredGroupTask(TenantConfig config)
    {
        if (string.IsNullOrWhiteSpace(config.Value)) return null;

        try
        {
            using var document = JsonDocument.Parse(config.Value);
            var root = document.RootElement;
            var groupId = Int(root, "group_id");
            if (groupId == null) return null;

            return new StoredGroupTask(
                config.Id,
                groupId.Value,
                Str(root, "title") ?? "Untitled task",
                Str(root, "description"),
                Int(root, "assigned_to"),
                Str(root, "status") ?? "todo",
                Str(root, "priority") ?? "medium",
                Str(root, "due_date"),
                Int(root, "created_by") ?? 0,
                Date(root, "created_at") ?? config.CreatedAt,
                Date(root, "updated_at") ?? config.UpdatedAt,
                Date(root, "completed_at"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object ToLaravelTeamTaskDto(StoredGroupTask task) => new
    {
        id = task.Id,
        group_id = task.GroupId,
        title = task.Title,
        description = task.Description,
        assigned_to = task.AssignedTo,
        status = task.Status,
        priority = task.Priority,
        due_date = task.DueDate,
        created_by = task.CreatedBy,
        created_at = task.CreatedAt,
        updated_at = task.UpdatedAt,
        completed_at = task.CompletedAt
    };

    private static object ToLaravelTeamDocumentDto(GroupFile document) => new
    {
        id = document.Id,
        group_id = document.GroupId,
        user_id = document.UploadedById,
        filename = Path.GetFileName(document.FileUrl),
        original_name = document.FileName,
        mime_type = document.ContentType,
        size = document.FileSizeBytes,
        url = document.FileUrl,
        created_at = document.CreatedAt,
        uploader = document.UploadedBy == null
            ? null
            : new
            {
                id = document.UploadedBy.Id,
                name = $"{document.UploadedBy.FirstName} {document.UploadedBy.LastName}".Trim(),
                avatar_url = document.UploadedBy.AvatarUrl
            }
    };

    private async Task<StoredChatroom?> FindStoredChatroomAsync(int chatroomId)
    {
        var config = await _db.TenantConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.Id == chatroomId && c.Key.StartsWith(GroupChatroomKeyPrefix));
        return config == null ? null : ParseStoredChatroom(config);
    }

    private async Task<StoredChatroomMessage?> FindStoredChatroomMessageAsync(int messageId)
    {
        var config = await _db.TenantConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.Id == messageId && c.Key.StartsWith(GroupChatroomMessageKeyPrefix));
        return config == null ? null : ParseStoredChatroomMessage(config);
    }

    private async Task<List<StoredChatroom>> ReadStoredChatroomsAsync()
    {
        var tenantId = TenantId();
        var configs = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(GroupChatroomKeyPrefix))
            .ToListAsync();

        return configs
            .Select(ParseStoredChatroom)
            .Where(chatroom => chatroom != null)
            .Cast<StoredChatroom>()
            .ToList();
    }

    private async Task<List<StoredChatroomMessage>> ReadStoredChatroomMessagesAsync()
    {
        var tenantId = TenantId();
        var configs = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(GroupChatroomMessageKeyPrefix))
            .ToListAsync();

        return configs
            .Select(ParseStoredChatroomMessage)
            .Where(message => message != null)
            .Cast<StoredChatroomMessage>()
            .ToList();
    }

    private static StoredChatroom? ParseStoredChatroom(TenantConfig config)
    {
        if (string.IsNullOrWhiteSpace(config.Value)) return null;

        try
        {
            using var document = JsonDocument.Parse(config.Value);
            var root = document.RootElement;
            var groupId = Int(root, "group_id");
            if (groupId == null) return null;

            return new StoredChatroom(
                config.Id,
                groupId.Value,
                Str(root, "name") ?? "general",
                Str(root, "description"),
                Str(root, "category"),
                Bool(root, "is_default") ?? false,
                Bool(root, "is_private") ?? false,
                Int(root, "created_by") ?? 0,
                Date(root, "created_at") ?? config.CreatedAt);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static StoredChatroomMessage? ParseStoredChatroomMessage(TenantConfig config)
    {
        if (string.IsNullOrWhiteSpace(config.Value)) return null;

        try
        {
            using var document = JsonDocument.Parse(config.Value);
            var root = document.RootElement;
            var groupId = Int(root, "group_id");
            var chatroomId = Int(root, "chatroom_id");
            var userId = Int(root, "user_id");
            if (groupId == null || chatroomId == null || userId == null) return null;

            return new StoredChatroomMessage(
                config.Id,
                groupId.Value,
                chatroomId.Value,
                userId.Value,
                Str(root, "body") ?? string.Empty,
                Date(root, "created_at") ?? config.CreatedAt,
                Date(root, "updated_at") ?? config.UpdatedAt);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object ToLaravelChatroomDto(StoredChatroom chatroom, int messagesCount) => new
    {
        id = chatroom.Id,
        group_id = chatroom.GroupId,
        name = chatroom.Name,
        description = chatroom.Description,
        category = chatroom.Category,
        is_default = chatroom.IsDefault,
        is_private = chatroom.IsPrivate,
        messages_count = messagesCount,
        created_by = chatroom.CreatedBy,
        created_at = chatroom.CreatedAt
    };

    private object ToLaravelChatroomMessageDto(StoredChatroomMessage message)
    {
        var author = _db.Users.AsNoTracking().FirstOrDefault(u => u.Id == message.UserId);
        return new
        {
            id = message.Id,
            chatroom_id = message.ChatroomId,
            user_id = message.UserId,
            body = message.Body,
            created_at = message.CreatedAt,
            updated_at = message.UpdatedAt,
            author = new
            {
                id = message.UserId,
                name = author == null ? string.Empty : $"{author.FirstName} {author.LastName}".Trim(),
                avatar_url = author?.AvatarUrl
            }
        };
    }

    private object ToLaravelPinnedMessageDto(StoredChatroomMessage message, int pinnedBy, DateTime pinnedAt)
    {
        var author = _db.Users.AsNoTracking().FirstOrDefault(u => u.Id == message.UserId);
        return new
        {
            id = message.Id,
            chatroom_id = message.ChatroomId,
            user_id = message.UserId,
            body = message.Body,
            created_at = message.CreatedAt,
            author = new
            {
                id = message.UserId,
                name = author == null ? string.Empty : $"{author.FirstName} {author.LastName}".Trim(),
                avatar_url = author?.AvatarUrl
            },
            pinned_by = pinnedBy,
            pinned_at = pinnedAt
        };
    }

    private int QueryInt(string name, int fallback, int min, int max) =>
        QueryInt(name, (int?)fallback, min, max)!.Value;

    private int? QueryInt(string name, int? fallback, int min, int max)
    {
        if (!int.TryParse(Request.Query[name].FirstOrDefault(), out var value))
            return fallback;

        return Math.Clamp(value, min, max);
    }

    private static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static string? Raw(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v.GetRawText() : null;
    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;
    private static bool? Bool(JsonElement e, string name) => bool.TryParse(Str(e, name), out var value) ? value : null;
    private static DateTime? Date(JsonElement e, string name) => DateTime.TryParse(Str(e, name), out var value) ? value : null;
    private static string Required(string? value, string name) => string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"{name} is required") : value;
    private static string Token() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    private static string Slug(string value) => string.Join("-", value.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    private static string Csv(string? value) => "\"" + (value ?? string.Empty).Replace("\"", "\"\"") + "\"";
    private static object MapGroup(Group g) => new { g.Id, g.Name, g.Description, g.IsPrivate, g.ImageUrl, g.CreatedAt };
    private static object? MapUser(User? u) => u == null ? null : new { u.Id, u.Email, u.FirstName, u.LastName };

    private sealed record StoredGroupTask(
        int Id,
        int GroupId,
        string Title,
        string? Description,
        int? AssignedTo,
        string Status,
        string Priority,
        string? DueDate,
        int CreatedBy,
        DateTime CreatedAt,
        DateTime? UpdatedAt,
        DateTime? CompletedAt);

    private sealed record StoredChatroom(
        int Id,
        int GroupId,
        string Name,
        string? Description,
        string? Category,
        bool IsDefault,
        bool IsPrivate,
        int CreatedBy,
        DateTime CreatedAt);

    private sealed record StoredChatroomMessage(
        int Id,
        int GroupId,
        int ChatroomId,
        int UserId,
        string Body,
        DateTime CreatedAt,
        DateTime? UpdatedAt);
}
