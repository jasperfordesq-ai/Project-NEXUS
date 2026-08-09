// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/stories")]
[Authorize]
public class StoriesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public StoriesController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [HttpGet]
    public async Task<IActionResult> Index() => Ok(new { data = await _db.Stories.Where(s => s.ExpiresAt > DateTime.UtcNow).OrderByDescending(s => s.CreatedAt).ToListAsync() });

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] JsonElement body)
    {
        var story = new Story
        {
            TenantId = TenantId(),
            UserId = UserId(),
            MediaUrl = Required(Str(body, "media_url") ?? Str(body, "url"), "media_url"),
            MediaType = Str(body, "media_type") ?? "image",
            Caption = Str(body, "caption"),
            Visibility = Str(body, "visibility") ?? "public",
            ExpiresAt = DateTime.UtcNow.AddHours(Int(body, "ttl_hours") ?? 24)
        };
        _db.Stories.Add(story);
        await _db.SaveChangesAsync();
        return Ok(new { data = story });
    }

    [HttpDelete("{storyId:int}")]
    public async Task<IActionResult> Destroy(int storyId)
    {
        var story = await _db.Stories.FirstOrDefaultAsync(s => s.TenantId == TenantId() && s.Id == storyId && s.UserId == UserId());
        if (story != null) _db.Stories.Remove(story);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("archive")]
    public async Task<IActionResult> Archive() => Ok(new { data = await _db.Stories.Where(s => s.TenantId == TenantId() && s.UserId == UserId() && s.ExpiresAt <= DateTime.UtcNow).ToListAsync() });

    [HttpGet("user/{userId:int}")]
    public async Task<IActionResult> UserStories(int userId) => Ok(new { data = await _db.Stories.Where(s => s.TenantId == TenantId() && s.UserId == userId && s.ExpiresAt > DateTime.UtcNow).ToListAsync() });

    [HttpPost("{storyId:int}/view")]
    public async Task<IActionResult> View(int storyId)
    {
        if (!await _db.StoryViews.AnyAsync(v => v.TenantId == TenantId() && v.StoryId == storyId && v.UserId == UserId()))
            _db.StoryViews.Add(new StoryView { TenantId = TenantId(), StoryId = storyId, UserId = UserId() });
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpGet("{storyId:int}/viewers")]
    public async Task<IActionResult> Viewers(int storyId) => Ok(new { data = await _db.StoryViews.Where(v => v.TenantId == TenantId() && v.StoryId == storyId).ToListAsync() });

    [HttpPost("{storyId:int}/react")]
    public async Task<IActionResult> React(int storyId, [FromBody] JsonElement body)
    {
        var reaction = new StoryReaction { TenantId = TenantId(), StoryId = storyId, UserId = UserId(), Reaction = Str(body, "reaction") ?? "like" };
        _db.StoryReactions.Add(reaction);
        await _db.SaveChangesAsync();
        return Ok(new { data = reaction });
    }

    [HttpPost("{storyId:int}/reply")]
    public async Task<IActionResult> Reply(int storyId, [FromBody] JsonElement body)
    {
        var reply = new StoryReaction { TenantId = TenantId(), StoryId = storyId, UserId = UserId(), Reaction = "reply", Reply = Required(Str(body, "message") ?? Str(body, "reply"), "reply") };
        _db.StoryReactions.Add(reply);
        await _db.SaveChangesAsync();
        return Ok(new { data = reply });
    }

    [HttpPost("{storyId:int}/stickers")]
    public async Task<IActionResult> SaveStickers(int storyId, [FromBody] JsonElement body)
    {
        var story = await _db.Stories.FirstOrDefaultAsync(s => s.TenantId == TenantId() && s.Id == storyId && s.UserId == UserId());
        if (story == null) return NotFound(new { error = "Story not found" });
        story.StickersJson = body.GetRawText();
        await _db.SaveChangesAsync();
        return Ok(new { data = story });
    }

    [HttpPost("{storyId:int}/poll/vote")]
    public IActionResult PollVote(int storyId, [FromBody] JsonElement body) => Ok(new { data = new { story_id = storyId, option = Str(body, "option"), voted = true } });

    [HttpGet("{storyId:int}/analytics")]
    public async Task<IActionResult> Analytics(int storyId)
    {
        return Ok(new { data = new { views = await _db.StoryViews.CountAsync(v => v.TenantId == TenantId() && v.StoryId == storyId), reactions = await _db.StoryReactions.CountAsync(r => r.TenantId == TenantId() && r.StoryId == storyId) } });
    }

    [HttpPost("{storyId:int}/analytics")]
    public IActionResult TrackAnalytics(int storyId, [FromBody] JsonElement body) => Ok(new { data = new { story_id = storyId, event_type = Str(body, "event_type") ?? "impression", tracked = true } });

    [HttpGet("close-friends")]
    public async Task<IActionResult> CloseFriends() => Ok(new { data = await _db.StoryCloseFriends.Where(f => f.TenantId == TenantId() && f.UserId == UserId()).ToListAsync() });

    [HttpPost("close-friends")]
    public async Task<IActionResult> AddCloseFriend([FromBody] JsonElement body)
    {
        var friendId = Int(body, "user_id") ?? Int(body, "friend_user_id") ?? 0;
        if (friendId <= 0) return BadRequest(new { error = "user_id is required" });
        if (!await _db.StoryCloseFriends.AnyAsync(f => f.TenantId == TenantId() && f.UserId == UserId() && f.FriendUserId == friendId))
            _db.StoryCloseFriends.Add(new StoryCloseFriend { TenantId = TenantId(), UserId = UserId(), FriendUserId = friendId });
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("close-friends/{friendUserId:int}")]
    public async Task<IActionResult> RemoveCloseFriend(int friendUserId)
    {
        var row = await _db.StoryCloseFriends.FirstOrDefaultAsync(f => f.TenantId == TenantId() && f.UserId == UserId() && f.FriendUserId == friendUserId);
        if (row != null) _db.StoryCloseFriends.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("highlights")]
    public async Task<IActionResult> CreateHighlight([FromBody] JsonElement body)
    {
        var h = new StoryHighlight { TenantId = TenantId(), UserId = UserId(), Title = Required(Str(body, "title"), "title"), CoverUrl = Str(body, "cover_url") };
        _db.StoryHighlights.Add(h);
        await _db.SaveChangesAsync();
        return Ok(new { data = h });
    }

    [HttpGet("highlights/{highlightId:int}")]
    public async Task<IActionResult> Highlight(int highlightId)
    {
        var h = await _db.StoryHighlights.FirstOrDefaultAsync(x => x.TenantId == TenantId() && x.Id == highlightId);
        return h == null ? NotFound(new { error = "Highlight not found" }) : Ok(new { data = h });
    }

    [HttpPut("highlights/{highlightId:int}")]
    public async Task<IActionResult> UpdateHighlight(int highlightId, [FromBody] JsonElement body)
    {
        var h = await _db.StoryHighlights.FirstOrDefaultAsync(x => x.TenantId == TenantId() && x.Id == highlightId && x.UserId == UserId());
        if (h == null) return NotFound(new { error = "Highlight not found" });
        h.Title = Str(body, "title") ?? h.Title;
        h.CoverUrl = Str(body, "cover_url") ?? h.CoverUrl;
        h.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = h });
    }

    [HttpDelete("highlights/{highlightId:int}")]
    public async Task<IActionResult> DeleteHighlight(int highlightId)
    {
        var h = await _db.StoryHighlights.FirstOrDefaultAsync(x => x.TenantId == TenantId() && x.Id == highlightId && x.UserId == UserId());
        if (h != null) _db.StoryHighlights.Remove(h);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("highlights/reorder")]
    public IActionResult ReorderHighlights([FromBody] JsonElement body) => Ok(new { success = true });

    [HttpPost("highlights/{highlightId:int}/items")]
    public async Task<IActionResult> AddHighlightItem(int highlightId, [FromBody] JsonElement body)
    {
        var item = new StoryHighlightItem { TenantId = TenantId(), HighlightId = highlightId, StoryId = Int(body, "story_id") ?? 0 };
        _db.StoryHighlightItems.Add(item);
        await _db.SaveChangesAsync();
        return Ok(new { data = item });
    }

    [HttpDelete("highlights/{highlightId:int}/items/{itemId:int}")]
    public async Task<IActionResult> RemoveHighlightItem(int highlightId, int itemId)
    {
        var item = await _db.StoryHighlightItems.FirstOrDefaultAsync(i => i.TenantId == TenantId() && i.HighlightId == highlightId && i.Id == itemId);
        if (item != null) _db.StoryHighlightItems.Remove(item);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("highlights/{highlightId:int}/stories")]
    public async Task<IActionResult> HighlightStories(int highlightId)
    {
        var storyIds = await _db.StoryHighlightItems.Where(i => i.TenantId == TenantId() && i.HighlightId == highlightId).Select(i => i.StoryId).ToListAsync();
        return Ok(new { data = await _db.Stories.Where(s => storyIds.Contains(s.Id)).ToListAsync() });
    }

    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");
    private static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;
    private static string Required(string? value, string name) => string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"{name} is required") : value;
}
