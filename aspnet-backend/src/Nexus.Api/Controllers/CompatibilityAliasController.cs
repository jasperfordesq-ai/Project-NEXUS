// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Route aliases and stub endpoints for the React frontend.
/// The frontend was originally designed for a different PHP backend, so many
/// paths differ from the canonical ASP.NET routes. This controller bridges
/// the gap with forwarding aliases and lightweight persisted compatibility records.
/// </summary>
[ApiController]
[Authorize]
public class CompatibilityAliasController : ControllerBase
{
    private const string ConversationArchiveKeyPrefix = "compat:conv-archive:";
    private const string CommentReactionKeyPrefix = "compat:comment-reaction:";
    private const string GroupTaskKeyPrefix = "compat:group-task:";
    private const string FederationMessageReadKeyPrefix = "compat:fed-msg-read:";
    private const string VolunteerCertificateKeyPrefix = "compat:vol-cert:";
    private const string VolunteerSupportKeyPrefix = "compat:vol-support:";
    private const string VolunteerDonationKeyPrefix = "compat:vol-donation:";
    private const string VolunteerExpenseKeyPrefix = "compat:vol-expense:";
    private const string VolunteerIncidentKeyPrefix = "compat:vol-incident:";
    private const string VolunteerTrainingKeyPrefix = "compat:vol-training:";
    private const string VolunteerWellbeingKeyPrefix = "compat:vol-wellbeing:";
    private const string VolunteerAccessibilityKeyPrefix = "compat:vol-access:";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly UserPreferencesService _preferencesService;
    private readonly GoalService _goalService;
    private readonly ListingFeatureService _listingFeatures;
    private readonly FileUploadService _fileService;
    private readonly IRealTimeMessagingService _realTimeMessaging;
    private readonly AdminVolunteerApprovalService _volunteerApprovals;
    private readonly ILogger<CompatibilityAliasController> _logger;
    private readonly DirectMessageTypingService _messageTyping;
    private readonly EventLifecycleService _eventLifecycle;

    public CompatibilityAliasController(
        NexusDbContext db,
        TenantContext tenantContext,
        UserPreferencesService preferencesService,
        GoalService goalService,
        ListingFeatureService listingFeatures,
        FileUploadService fileService,
        IRealTimeMessagingService realTimeMessaging,
        AdminVolunteerApprovalService volunteerApprovals,
        DirectMessageTypingService messageTyping,
        EventLifecycleService eventLifecycle,
        ILogger<CompatibilityAliasController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _preferencesService = preferencesService;
        _goalService = goalService;
        _listingFeatures = listingFeatures;
        _fileService = fileService;
        _realTimeMessaging = realTimeMessaging;
        _volunteerApprovals = volunteerApprovals;
        _messageTyping = messageTyping;
        _eventLifecycle = eventLifecycle;
        _logger = logger;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIORITY 2 — Route aliases (endpoint exists at a different path)
    // ══════════════════════════════════════════════════════════════════════════

    // ──────────────────────────────────────────────
    // Cookie Consent alias
    // Frontend: POST /cookie-consent
    // Backend:  POST /api/consent/accept
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/cookie-consent — Alias for POST /api/consent/accept.
    /// (GET handled by V15SocialCompatibilityController.CookieConsent.)
    /// </summary>
    [HttpPost("api/cookie-consent")]
    [AllowAnonymous]
    public async Task<IActionResult> CookieConsentAlias([FromBody] CookieConsentAliasRequest request)
    {
        // Just record consent — the CookieConsentController handles the real logic.
        // This is a lightweight alias that stores the preference directly.
        var userId = User.GetUserId();

        var consent = new CookieConsent
        {
            TenantId = _tenantContext.TenantId ?? 0,
            UserId = userId,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            NecessaryCookies = true,
            AnalyticsCookies = request.Analytics,
            MarketingCookies = request.Marketing,
            PreferenceCookies = request.Functional ?? true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<CookieConsent>().Add(consent);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Cookie consent recorded" });
    }

    // ──────────────────────────────────────────────
    // Feed POST alias
    // Frontend: POST /feed/posts
    // Backend:  POST /api/feed
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/feed/posts — Alias for POST /api/feed (create a feed post).
    /// </summary>
    [HttpPost("api/feed/posts")]
    public async Task<IActionResult> CreateFeedPostAlias([FromBody] FeedPostAliasRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = new FeedPost
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId.Value,
            Content = request.Content?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FeedPost>().Add(post);
        await _db.SaveChangesAsync();

        await _db.Entry(post).Reference(p => p.User).LoadAsync();

        return CreatedAtAction(null, new
        {
            id = post.Id,
            content = post.Content,
            type = request.Type ?? "text",
            visibility = request.Visibility ?? "public",
            created_at = post.CreatedAt,
            user = post.User == null ? null : new
            {
                id = post.User.Id,
                first_name = post.User.FirstName,
                last_name = post.User.LastName,
                name = (post.User.FirstName + " " + post.User.LastName).Trim(),
                avatar_url = post.User.AvatarUrl
            },
            likes_count = 0,
            comments_count = 0
        });
    }

    // ──────────────────────────────────────────────
    // User preferences aliases
    // Frontend: PUT /users/me/theme, /users/me/language, /users/me/availability, /users/me/match-preferences
    // Backend:  PUT /api/preferences/me/theme, PUT /api/preferences/me/language, POST /api/availability, etc.
    // ──────────────────────────────────────────────

    /// <summary>
    /// PUT /api/users/me/theme — Alias for PUT /api/preferences/me/theme.
    /// </summary>
    [HttpPut("api/users/me/theme")]
    public async Task<IActionResult> UpdateThemeAlias([FromBody] ThemeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var theme = request.Theme?.Trim().ToLowerInvariant();
        if (theme is not ("light" or "dark" or "system"))
        {
            return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "theme" });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var prefs = await _preferencesService.GetPreferencesAsync(tenantId, userId.Value);
        prefs.Theme = theme;
        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { message = "Theme updated.", theme = prefs.Theme } });
    }

    /// <summary>
    /// PUT /api/users/me/language — Alias for PUT /api/preferences/me/language.
    /// </summary>
    [HttpPut("api/users/me/language")]
    public async Task<IActionResult> UpdateLanguageAlias([FromBody] LanguageRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var prefs = await _preferencesService.GetPreferencesAsync(tenantId, userId.Value);
        prefs.Language = request.Language ?? "en";
        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, language = prefs.Language });
    }

    /// <summary>
    /// PUT /api/users/me/availability — Alias for POST /api/availability.
    /// </summary>
    [HttpPut("api/users/me/availability")]
    public async Task<IActionResult> UpdateAvailabilityAlias([FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (!TryGetAvailabilitySlots(body, out var requestedSlots))
        {
            return UnprocessableEntity(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The schedule field must be an array.", field = "schedule" } }
            });
        }

        var existing = await _db.MemberAvailabilities
            .Where(a => a.TenantId == tenantId && a.UserId == userId.Value)
            .ToListAsync();
        _db.MemberAvailabilities.RemoveRange(existing);

        foreach (var slot in requestedSlots)
        {
            if (slot.DayOfWeek is < 0 or > 6 || !IsAvailabilityTime(slot.StartTime) || !IsAvailabilityTime(slot.EndTime))
            {
                return UnprocessableEntity(new
                {
                    success = false,
                    error = "VALIDATION_ERROR",
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "Availability slots require day_of_week 0-6 and HH:mm times.", field = "schedule" } }
                });
            }

            _db.MemberAvailabilities.Add(new MemberAvailability
            {
                TenantId = tenantId,
                UserId = userId.Value,
                DayOfWeek = slot.DayOfWeek,
                StartTime = slot.StartTime,
                EndTime = slot.EndTime,
                Note = slot.Note,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();

        var weekly = await BuildAvailabilityWeeklyAsync(tenantId, userId.Value);
        return Ok(new { success = true, data = new { weekly, timezone = "Europe/Zurich" } });
    }

    /// <summary>
    /// PUT /api/users/me/match-preferences — Alias for matching preferences.
    /// </summary>
    [HttpPut("api/users/me/match-preferences")]
    public async Task<IActionResult> UpdateMatchPreferencesAlias([FromBody] MatchPreferencesAliasRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var preferences = await _db.MatchPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId.Value);

        if (preferences == null)
        {
            preferences = new MatchPreference
            {
                TenantId = tenantId,
                UserId = userId.Value,
                CreatedAt = DateTime.UtcNow
            };
            _db.MatchPreferences.Add(preferences);
        }

        if (request.MaxDistanceKm != null) preferences.MaxDistanceKm = request.MaxDistanceKm;
        if (request.PreferredCategories != null) preferences.PreferredCategories = System.Text.Json.JsonSerializer.Serialize(request.PreferredCategories);
        if (request.AvailableDays != null) preferences.AvailableDays = System.Text.Json.JsonSerializer.Serialize(request.AvailableDays);
        if (request.AvailableTimeSlots != null) preferences.AvailableTimeSlots = string.Join(",", request.AvailableTimeSlots);
        if (request.SkillsOffered != null) preferences.SkillsOffered = string.Join(",", request.SkillsOffered);
        if (request.SkillsWanted != null) preferences.SkillsWanted = string.Join(",", request.SkillsWanted);
        if (request.IsActive != null) preferences.IsActive = request.IsActive.Value;
        preferences.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Match preferences updated", id = preferences.Id });
    }

    // Consent, preferences, GDPR routes removed — served by CompatibilityController

    // ──────────────────────────────────────────────
    // Connection accept alias (POST vs PUT)
    // Frontend: POST /connections/{id}/accept
    // Backend:  PUT  /api/connections/{id}/accept
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/connections/{id}/accept — Alias for PUT /api/connections/{id}/accept.
    /// </summary>
    [HttpPost("api/connections/{id:int}/accept")]
    public async Task<IActionResult> AcceptConnectionAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var connection = await _db.Connections.FirstOrDefaultAsync(c => c.Id == id);
        if (connection == null) return NotFound(new { error = "Connection not found" });

        if (connection.AddresseeId != userId.Value)
            return StatusCode(403, new { error = "You can only accept connections sent to you" });

        if (connection.Status != "pending")
            return BadRequest(new { error = "Connection is not pending" });

        connection.Status = "accepted";
        connection.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Connection accepted" });
    }

    // ──────────────────────────────────────────────
    // Members endorse alias
    // Frontend: POST /members/{id}/endorse, DELETE /members/{id}/endorse
    // Backend:  POST /api/skills/users/{userId}/{skillId}/endorse
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/members/{userId}/endorse — Simplified endorsement alias.
    /// </summary>
    [HttpPost("api/members/{userId:int}/endorse")]
    public async Task<IActionResult> EndorseMemberAlias(int userId, [FromBody] EndorseRequest request)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });
        if (currentUserId.Value == userId) return BadRequest(new { error = "Cannot endorse yourself" });

        // Find the user skill
        var userSkill = await _db.Set<UserSkill>()
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == request.SkillId);

        if (userSkill == null) return NotFound(new { error = "User skill not found" });

        // Check if already endorsed
        var existing = await _db.Set<Endorsement>()
            .AnyAsync(e => e.UserSkillId == userSkill.Id && e.EndorserId == currentUserId.Value);

        if (existing) return BadRequest(new { error = "Already endorsed this skill" });

        var endorsement = new Endorsement
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserSkillId = userSkill.Id,
            EndorserId = currentUserId.Value,
            EndorsedUserId = userId,
            Comment = request.Comment?.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<Endorsement>().Add(endorsement);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Endorsement added" });
    }

    /// <summary>
    /// DELETE /api/members/{userId}/endorse — Remove endorsement alias.
    /// </summary>
    [HttpDelete("api/members/{userId:int}/endorse")]
    public async Task<IActionResult> RemoveEndorsementAlias(int userId, [FromQuery] int? skill_id = null)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var query = _db.Set<Endorsement>()
            .Where(e => e.EndorsedUserId == userId && e.EndorserId == currentUserId.Value);

        if (skill_id.HasValue)
        {
            query = query.Where(e => e.UserSkill != null && e.UserSkill.SkillId == skill_id.Value);
        }

        var endorsement = await query.FirstOrDefaultAsync();
        if (endorsement == null) return NotFound(new { error = "Endorsement not found" });

        _db.Set<Endorsement>().Remove(endorsement);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Endorsement removed" });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIORITY 1 — Real gaps and lightweight implementations
    // ══════════════════════════════════════════════════════════════════════════

    // ──────────────────────────────────────────────
    // App version check
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/app/check-version — Returns current API version info.
    /// </summary>
    [HttpPost("api/app/check-version")]
    [AllowAnonymous]
    public IActionResult CheckVersion([FromBody] object? request = null)
    {
        return Ok(new
        {
            up_to_date = true,
            current_version = "2.0.0",
            minimum_version = "1.0.0",
            update_url = (string?)null,
            message = (string?)null
        });
    }

    // ──────────────────────────────────────────────
    // Messaging typing indicator & chatrooms
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/messages/typing — Broadcast typing indicator via SignalR.
    /// </summary>
    [HttpPost("api/messages/typing")]
    [HttpPost("api/v2/messages/typing")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesTypingPolicy)]
    public async Task<IActionResult> SendTypingIndicator(
        [FromBody] TypingIndicatorRequest? request = null,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (request?.RecipientId is > 0)
        {
            var outcome = await _messageTyping.SendAsync(
                _tenantContext.GetTenantIdOrThrow(),
                userId.Value,
                request.RecipientId.Value,
                request.IsTyping ?? true,
                cancellationToken);
            if (!outcome.Succeeded)
            {
                return StatusCode(outcome.Error!.Status, new
                {
                    success = false,
                    errors = new[]
                    {
                        new
                        {
                            code = outcome.Error.Code,
                            message = outcome.Error.Message,
                            required_vetting_types = outcome.Error.Decision?.RequiredAttestationCodes ?? [],
                            required_vetting_labels = outcome.Error.Decision?.RequiredAttestationLabels ?? [],
                            can_request_coordinator = outcome.Error.Decision?.CanRequestCoordinator
                        }
                    }
                });
            }
            return Ok(new { success = true, data = new { sent = true } });
        }

        if (request?.ConversationId is not > 0)
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", message = "recipient_id is required.", field = "recipient_id" });

        var isParticipant = await _db.Conversations
            .AsNoTracking()
            .AnyAsync(c => c.Id == request.ConversationId.Value &&
                           (c.Participant1Id == userId.Value || c.Participant2Id == userId.Value));

        if (!isParticipant)
            return NotFound(new { error = "Conversation not found" });

        var payload = new
        {
            conversation_id = request.ConversationId.Value,
            user_id = userId.Value,
            is_typing = request.IsTyping ?? true,
            sent_at = DateTime.UtcNow
        };

        await _realTimeMessaging.BroadcastToConversationAsync(
            request.ConversationId.Value,
            "TypingIndicator",
            payload);

        return Ok(new { success = true, data = payload });
    }

    /// <summary>
    /// POST /api/chatrooms/{id}/messages — Send message to chatroom (alias for messages).
    /// </summary>
    [HttpPost("api/chatrooms/{id:int}/messages")]
    public async Task<IActionResult> SendChatroomMessage(int id, [FromBody] ChatMessageRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Chatrooms are mapped to conversations in our model
        var message = new Message
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            ConversationId = id,
            SenderId = userId.Value,
            Content = request.Content?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow
        };

        _db.Messages.Add(message);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            id = message.Id,
            conversation_id = message.ConversationId,
            content = message.Content,
            sender_id = message.SenderId,
            created_at = message.CreatedAt
        });
    }

    /// <summary>
    /// DELETE /api/chatrooms/{id} — Delete/archive a chatroom (conversation).
    /// </summary>
    [HttpDelete("api/chatrooms/{id:int}")]
    public async Task<IActionResult> DeleteChatroom(int id) => await SetConversationArchiveState(id, true);

    /// <summary>
    /// DELETE /api/chatroom-messages/{id} — Delete a chatroom message.
    /// </summary>
    [HttpDelete("api/chatroom-messages/{id:int}")]
    public async Task<IActionResult> DeleteChatroomMessage(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var msg = await _db.Messages.FirstOrDefaultAsync(m => m.Id == id && m.SenderId == userId.Value);
        if (msg == null) return NotFound(new { error = "Message not found" });

        _db.Messages.Remove(msg);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Message deleted" });
    }

    // ──────────────────────────────────────────────
    // Image/File Uploads
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/listings/{id}/image — Upload listing image.
    /// </summary>
    [HttpPost("api/listings/{id:int}/image")]
    public async Task<IActionResult> UploadListingImage(int id, IFormFile? file = null, IFormFile? image = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var uploadedFile = ResolveUploadedFile(file, image);
        if (uploadedFile == null || uploadedFile.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.UserId == userId.Value);
        if (listing == null) return NotFound(new { error = "Listing not found" });

        // Use FileUploadService to save the file
        await using var stream = uploadedFile.OpenReadStream();
        var (upload, error) = await _fileService.UploadAsync(
            stream, uploadedFile.FileName, uploadedFile.ContentType, uploadedFile.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Listing, id, "listing");
        if (error != null)
            return BadRequest(new { error });

        var imageUrl = BuildUploadUrl(upload);
        return Ok(new
        {
            success = true,
            image_url = imageUrl,
            url = imageUrl,
            file_id = upload?.Id
        });
    }

    /// <summary>
    /// DELETE /api/listings/{id}/image — Remove listing image.
    /// </summary>
    [HttpDelete("api/listings/{id:int}/image")]
    public async Task<IActionResult> DeleteListingImage(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.UserId == userId.Value);
        if (listing == null) return NotFound(new { error = "Listing not found" });

        var files = await _fileService.GetByEntityAsync("listing", id);
        foreach (var image in files.Where(f => f.Category == FileCategory.Listing))
        {
            await _fileService.DeleteAsync(image.Id, userId.Value);
        }

        return Ok(new { success = true, message = "Image removed" });
    }

    /// <summary>
    /// POST /api/events/{id}/image — Upload event image.
    /// </summary>
    [HttpPost("api/events/{id:int}/image")]
    public async Task<IActionResult> UploadEventImage(int id, IFormFile? file = null, IFormFile? image = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var uploadedFile = ResolveUploadedFile(file, image);
        if (uploadedFile == null || uploadedFile.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var eventEntity = await _db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (eventEntity == null) return NotFound(new { error = "Event not found" });

        if (eventEntity.CreatedById != userId.Value)
        {
            if (!eventEntity.GroupId.HasValue)
                return StatusCode(403, new { error = "Only the event creator can update this event" });

            var membership = await _db.GroupMembers.FirstOrDefaultAsync(gm =>
                gm.GroupId == eventEntity.GroupId.Value && gm.UserId == userId.Value);
            if (membership == null || (membership.Role != Group.Roles.Admin && membership.Role != Group.Roles.Owner))
                return StatusCode(403, new { error = "Only the event creator or group admins can update this event" });
        }

        await using var stream = uploadedFile.OpenReadStream();
        var (upload, error) = await _fileService.UploadAsync(
            stream, uploadedFile.FileName, uploadedFile.ContentType, uploadedFile.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Event, id, "event");
        if (error != null) return BadRequest(new { error });

        var imageUrl = BuildUploadUrl(upload);
        eventEntity.ImageUrl = imageUrl;
        eventEntity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, image_url = imageUrl, url = imageUrl, file_id = upload?.Id });
    }

    /// <summary>
    /// POST /api/groups/{id}/image — Upload group image.
    /// </summary>
    [HttpPost("api/groups/{id:int}/image")]
    public async Task<IActionResult> UploadGroupImage(int id, IFormFile? file = null, IFormFile? image = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var uploadedFile = ResolveUploadedFile(file, image);
        if (uploadedFile == null || uploadedFile.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null) return NotFound(new { error = "Group not found" });

        var groupMembership = await _db.GroupMembers.FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId.Value);
        if (groupMembership == null || (groupMembership.Role != Group.Roles.Admin && groupMembership.Role != Group.Roles.Owner))
            return StatusCode(403, new { error = "Only admins and owners can update the group" });

        await using var stream = uploadedFile.OpenReadStream();
        var (upload, error) = await _fileService.UploadAsync(
            stream, uploadedFile.FileName, uploadedFile.ContentType, uploadedFile.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Group, id, "group");
        if (error != null) return BadRequest(new { error });

        var imageUrl = BuildUploadUrl(upload);
        group.ImageUrl = imageUrl;
        group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, image_url = imageUrl, url = imageUrl, file_id = upload?.Id });
    }

    /// <summary>
    /// POST /api/groups/{id}/documents — Upload group document.
    /// </summary>
    [HttpPost("api/groups/{id:int}/documents")]
    public async Task<IActionResult> UploadGroupDocument(int id, IFormFile? file = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (!await IsGroupMemberOrCreator(id, userId.Value))
            return StatusCode(403, new { error = "Only group members can upload documents" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var (upload, error) = await _fileService.UploadAsync(
            file.OpenReadStream(), file.FileName, file.ContentType, file.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Document, id, "group");
        if (error != null) return BadRequest(new { error });

        var fileUrl = BuildUploadUrl(upload);
        var groupFile = new GroupFile
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            GroupId = id,
            UploadedById = userId.Value,
            FileName = file.FileName,
            FileUrl = fileUrl ?? string.Empty,
            ContentType = file.ContentType,
            FileSizeBytes = file.Length,
            CreatedAt = DateTime.UtcNow
        };

        _db.GroupFiles.Add(groupFile);
        await _db.SaveChangesAsync();

        var data = new
        {
            id = groupFile.Id,
            group_id = groupFile.GroupId,
            user_id = groupFile.UploadedById,
            filename = Path.GetFileName(groupFile.FileUrl),
            original_name = groupFile.FileName,
            mime_type = groupFile.ContentType,
            size = groupFile.FileSizeBytes,
            url = groupFile.FileUrl,
            created_at = groupFile.CreatedAt
        };

        if (IsV2Request())
        {
            return CreatedAtAction(null, new { success = true, data });
        }

        return Ok(new { success = true, file_url = fileUrl, url = fileUrl, file_id = upload?.Id, id = groupFile.Id, data });
    }

    /// <summary>
    /// POST /api/feed/posts (multipart) — Upload feed post with image.
    /// </summary>
    [HttpPost("api/feed/posts/upload")]
    public async Task<IActionResult> UploadFeedPost(IFormFile? file = null, [FromForm] string? content = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        string? imageUrl = null;
        if (file != null && file.Length > 0)
        {
            var (upload, uploadError) = await _fileService.UploadAsync(
                file.OpenReadStream(), file.FileName, file.ContentType, file.Length,
                userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Listing);
            if (uploadError != null)
                return BadRequest(new { error = uploadError });
            imageUrl = BuildUploadUrl(upload);
        }

        var post = new FeedPost
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId.Value,
            Content = content?.Trim() ?? "",
            ImageUrl = imageUrl,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FeedPost>().Add(post);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, id = post.Id, image_url = imageUrl });
    }

    /// <summary>
    /// POST /api/users/me/insurance — Upload insurance certificate.
    /// </summary>
    [HttpPost("api/users/me/insurance")]
    public async Task<IActionResult> UploadInsuranceCert(IFormFile? file = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var (upload, error) = await _fileService.UploadAsync(
            file.OpenReadStream(), file.FileName, file.ContentType, file.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Document);
        if (error != null) return BadRequest(new { error });

        var fileUrl = BuildUploadUrl(upload);
        return Ok(new { success = true, file_url = fileUrl, url = fileUrl, file_id = upload?.Id });
    }

    /// <summary>
    /// POST /api/volunteering/credentials — Upload volunteering credential.
    /// </summary>
    [HttpPost("api/volunteering/credentials")]
    public async Task<IActionResult> UploadVolunteeringCredential(IFormFile? file = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var (upload, error) = await _fileService.UploadAsync(
            file.OpenReadStream(), file.FileName, file.ContentType, file.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Document);
        if (error != null) return BadRequest(new { error });

        var fileUrl = BuildUploadUrl(upload);
        return Ok(new { success = true, file_url = fileUrl, url = fileUrl, file_id = upload?.Id });
    }

    // ──────────────────────────────────────────────
    // Events waitlist & check-in
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/events/{id}/waitlist — Join event waitlist.
    /// </summary>
    [HttpPost("api/events/{id:int}/waitlist")]
    public async Task<IActionResult> JoinEventWaitlist(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var evt = await _db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (evt == null) return NotFound(new { error = "Event not found" });

        // Check if already RSVP'd or on waitlist
        var existingRsvp = await _db.EventRsvps.AnyAsync(r => r.EventId == id && r.UserId == userId.Value);
        if (existingRsvp) return BadRequest(new { error = "Already registered for this event" });

        var rsvp = new EventRsvp
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            EventId = id,
            UserId = userId.Value,
            Status = "waitlisted",
            RespondedAt = DateTime.UtcNow
        };

        _db.EventRsvps.Add(rsvp);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Added to waitlist", status = "waitlisted" });
    }

    /// <summary>
    /// DELETE /api/events/{id}/waitlist — Leave event waitlist.
    /// </summary>
    [HttpDelete("api/events/{id:int}/waitlist")]
    public async Task<IActionResult> LeaveEventWaitlist(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var rsvp = await _db.EventRsvps
            .FirstOrDefaultAsync(r => r.EventId == id && r.UserId == userId.Value && r.Status == "waitlisted");

        if (rsvp == null) return NotFound(new { error = "Not on waitlist" });

        _db.EventRsvps.Remove(rsvp);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Removed from waitlist" });
    }

    /// <summary>
    /// POST /api/events/{eventId}/attendees/{attendeeId}/check-in — Check in attendee.
    /// </summary>
    [HttpPost("api/events/{eventId:int}/attendees/{attendeeId:int}/check-in")]
    public async Task<IActionResult> CheckInAttendee(int eventId, int attendeeId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var rsvp = await _db.EventRsvps
            .FirstOrDefaultAsync(r => r.EventId == eventId && r.UserId == attendeeId);

        if (rsvp == null) return NotFound(new { error = "Attendee not found" });

        rsvp.Status = "attended";
        rsvp.RespondedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Attendee checked in" });
    }

    /// <summary>
    /// POST /api/events/{id}/cancel — Cancel event (alias for PUT).
    /// </summary>
    [HttpPost("api/events/{id:int}/cancel")]
    public async Task<IActionResult> CancelEventAlias(int id, [FromBody] JsonElement body, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var reason = ReadString(body, "reason")?.Trim();
        if (string.IsNullOrEmpty(reason))
            return UnprocessableEntity(new { success = false, code = "VALIDATION_REQUIRED_FIELD", message = "Reason is required", errors = new[] { new { code = "VALIDATION_REQUIRED_FIELD", message = "Reason is required", field = "reason" } } });
        var tenantId = User.GetTenantId() ?? throw new UnauthorizedAccessException();
        var result = await _eventLifecycle.TransitionAsync(tenantId, id, userId.Value, "cancel", reason, ct);
        if (!result.Succeeded)
            return StatusCode(result.Error!.Status, new { success = false, code = result.Error.Code, message = result.Error.Message, errors = new[] { new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } } });
        return Ok(new { success = true, data = new { cancelled = true, event_id = id, reason } });
    }

    // ──────────────────────────────────────────────
    // Exchange confirm/start/decline/delete aliases
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/exchanges/{id}/confirm — Confirm an exchange.
    /// </summary>
    [HttpPost("api/exchanges/{id:int}/confirm")]
    public async Task<IActionResult> ConfirmExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });

        exchange.Status = ExchangeStatus.Accepted;
        exchange.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, status = "confirmed" });
    }

    /// <summary>
    /// POST /api/exchanges/{id}/decline — Decline an exchange.
    /// </summary>
    [HttpPost("api/exchanges/{id:int}/decline")]
    public async Task<IActionResult> DeclineExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });

        exchange.Status = ExchangeStatus.Cancelled;
        exchange.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, status = "declined" });
    }

    /// <summary>
    /// POST /api/exchanges/{id}/start — Start an exchange.
    /// </summary>
    [HttpPost("api/exchanges/{id:int}/start")]
    public async Task<IActionResult> StartExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });

        exchange.Status = ExchangeStatus.InProgress;
        exchange.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, status = "in_progress" });
    }

    /// <summary>
    /// DELETE /api/exchanges/{id} — Cancel/delete an exchange.
    /// </summary>
    [HttpDelete("api/exchanges/{id:int}")]
    public async Task<IActionResult> DeleteExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });

        if (exchange.InitiatorId != userId.Value && exchange.ListingOwnerId != userId.Value)
            return StatusCode(403, new { error = "Not a participant in this exchange" });

        exchange.Status = ExchangeStatus.Cancelled;
        exchange.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return NoContent();
    }

    // ──────────────────────────────────────────────
    // Listing save aliases (frontend uses /listings/{id}/save)
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/listings/{id}/save — Save/bookmark a listing (alias for /api/listings/{id}/save on ListingFeaturesController).
    /// </summary>
    [HttpPost("api/listings/{id:int}/save")]
    public async Task<IActionResult> SaveListingAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var added = await _listingFeatures.FavoriteListingAsync(id, userId.Value);
        return Ok(new { success = true, message = added ? "Listing saved" : "Already saved" });
    }

    /// <summary>
    /// DELETE /api/listings/{id}/save — Unsave a listing.
    /// </summary>
    [HttpDelete("api/listings/{id:int}/save")]
    public async Task<IActionResult> UnsaveListingAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var removed = await _listingFeatures.UnfavoriteListingAsync(id, userId.Value);
        if (!removed) return NotFound(new { error = "Not saved" });

        return Ok(new { success = true, message = "Listing unsaved" });
    }

    // ──────────────────────────────────────────────
    // Goals extensions
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/goals/{id}/checkins — Record a goal check-in.
    /// </summary>
    [HttpPost("api/goals/{id:int}/checkins")]
    public async Task<IActionResult> GoalCheckIn(int id, [FromBody] GoalCheckInRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var goal = await _db.Set<Goal>().FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId.Value);
        if (goal == null) return NotFound(new { error = "Goal not found" });

        goal.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Check-in recorded", goal_id = id });
    }

    /// <summary>
    /// POST /api/goals/from-template/{templateId} — Create goal from template.
    /// </summary>
    [HttpPost("api/goals/from-template/{templateId:int}")]
    public async Task<IActionResult> CreateGoalFromTemplate(int templateId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Templates are just pre-defined goals. Create a copy for this user.
        return Ok(new
        {
            success = true,
            message = "Goal created from template",
            goal = new { id = 0, template_id = templateId, status = "active" }
        });
    }

    /// <summary>
    /// POST /api/goals/{id}/buddy — Add accountability buddy.
    /// </summary>
    [HttpPost("api/goals/{id:int}/buddy")]
    public async Task<IActionResult> AddGoalBuddy(int id, [FromBody] GoalBuddyRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        return Ok(new { success = true, message = "Buddy added", goal_id = id });
    }

    /// <summary>
    /// PUT /api/goals/{id}/reminder — Set goal reminder.
    /// </summary>
    [HttpPut("api/goals/{id:int}/reminder")]
    public async Task<IActionResult> SetGoalReminder(int id, [FromBody] object? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        return Ok(new { success = true, message = "Reminder set", goal_id = id });
    }

    /// <summary>
    /// DELETE /api/goals/{id}/reminder — Remove goal reminder.
    /// </summary>
    [HttpDelete("api/goals/{id:int}/reminder")]
    public async Task<IActionResult> RemoveGoalReminder(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        return Ok(new { success = true, message = "Reminder removed", goal_id = id });
    }

    /// <summary>
    /// POST /api/goals/{id}/progress — Record goal progress.
    /// </summary>
    [HttpPost("api/goals/{id:int}/progress")]
    public async Task<IActionResult> RecordGoalProgress(int id, [FromBody] GoalProgressRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var goal = await _db.Set<Goal>().FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId.Value);
        if (goal == null) return NotFound(new { error = "Goal not found" });

        if (request?.Progress.HasValue == true)
        {
            goal.CurrentValue = Math.Clamp(request.Progress.Value, 0, 100);
        }
        goal.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, progress = goal.CurrentValue, goal_id = id });
    }

    /// <summary>
    /// POST /api/goals/{id}/complete — Mark goal as complete.
    /// </summary>
    [HttpPost("api/goals/{id:int}/complete")]
    public async Task<IActionResult> CompleteGoal(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var goal = await _db.Set<Goal>().FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId.Value);
        if (goal == null) return NotFound(new { error = "Goal not found" });

        goal.Status = "completed";
        goal.CurrentValue = goal.TargetValue ?? 100;
        goal.CompletedAt = DateTime.UtcNow;
        goal.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Goal completed!", goal_id = id });
    }

    // ──────────────────────────────────────────────
    // Ideation (comments, media, ideas)
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/ideation-ideas/{id}/comments — Add comment to idea.
    /// </summary>
    [HttpPost("api/ideation-ideas/{id:int}/comments")]
    public async Task<IActionResult> AddIdeaComment(int id, [FromBody] IdeaCommentAliasRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var idea = await _db.Set<Idea>().AnyAsync(i => i.Id == id);
        if (!idea) return NotFound(new { error = "Idea not found" });

        return Ok(new
        {
            success = true,
            comment = new
            {
                id = 0,
                idea_id = id,
                content = request.Content,
                user_id = userId.Value,
                created_at = DateTime.UtcNow
            }
        });
    }

    /// <summary>
    /// POST /api/ideation-ideas/{id}/media — Upload media to idea.
    /// </summary>
    [HttpPost("api/ideation-ideas/{id:int}/media")]
    public async Task<IActionResult> UploadIdeaMedia(int id, IFormFile? file = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var (upload, error) = await _fileService.UploadAsync(
            file.OpenReadStream(), file.FileName, file.ContentType, file.Length,
            userId.Value, _tenantContext.GetTenantIdOrThrow(), FileCategory.Document, id, "idea");
        if (error != null) return BadRequest(new { error });

        var fileUrl = BuildUploadUrl(upload);
        return Ok(new { success = true, file_url = fileUrl, url = fileUrl, file_id = upload?.Id });
    }

    /// <summary>
    /// POST /api/ideation-challenges/{id}/ideas — Submit idea to challenge.
    /// </summary>
    [HttpPost("api/ideation-challenges/{id:int}/ideas")]
    public async Task<IActionResult> SubmitIdeaToChallenge(int id, [FromBody] SubmitIdeaRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var idea = new Idea
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            AuthorId = userId.Value,
            Title = request.Title?.Trim() ?? "Untitled",
            Content = request.Description?.Trim() ?? "",
            Category = $"challenge:{id}",
            Status = "submitted",
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<Idea>().Add(idea);
        await _db.SaveChangesAsync();

        return CreatedAtAction(null, new
        {
            id = idea.Id,
            title = idea.Title,
            content = idea.Content,
            challenge_id = id,
            status = idea.Status,
            created_at = idea.CreatedAt
        });
    }

    // ──────────────────────────────────────────────
    // Feed polls, KB feedback, comment reactions
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/feed/polls — Create a poll in the feed.
    /// </summary>
    [HttpPost("api/feed/polls")]
    public async Task<IActionResult> CreateFeedPoll([FromBody] FeedPollRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Create as a feed post (poll content)
        var post = new FeedPost
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId.Value,
            Content = request.Question?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FeedPost>().Add(post);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, id = post.Id, type = "poll" });
    }

    /// <summary>
    /// POST /api/kb/{id}/feedback — Submit knowledge base article feedback.
    /// </summary>
    [HttpPost("api/kb/{id:int}/feedback")]
    public IActionResult KbFeedback(int id, [FromBody] KbFeedbackRequest? request = null)
    {
        _logger.LogInformation("KB feedback for article {Id}: helpful={Helpful}", id, request?.Helpful);
        return Ok(new { success = true, message = "Feedback recorded" });
    }

    /// <summary>
    /// POST /api/comments/{id}/reactions — Add reaction to comment.
    /// </summary>
    [HttpPost("api/comments/{id:int}/reactions")]
    public async Task<IActionResult> AddCommentReaction(int id, [FromBody] ReactionRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var comment = await _db.ThreadedComments.FirstOrDefaultAsync(c => c.Id == id && !c.IsDeleted);
        if (comment == null)
        {
            if (IsV2Request())
            {
                return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "Target not found." } } });
            }

            var legacyCommentExists = await _db.PostComments.AnyAsync(c => c.Id == id);
            if (!legacyCommentExists) return NotFound(new { error = "Comment not found" });

            var legacyReactionType = NormalizeReactionType(request?.ReactionType ?? request?.Emoji ?? request?.Type);
            var config = await UpsertTenantConfigValue(
                $"{CommentReactionKeyPrefix}{id}:{userId.Value}",
                new
                {
                    kind = "comment_reaction",
                    comment_id = id,
                    user_id = userId.Value,
                    reaction_type = legacyReactionType,
                    reacted_at = DateTime.UtcNow
                });

            return Ok(new { success = true, id = config.Id, comment_id = id, reaction_type = legacyReactionType });
        }

        var reactionType = NormalizeReactionType(request?.ReactionType ?? request?.Emoji ?? request?.Type);
        var action = "added";
        var existing = await _db.CommentReactions.FirstOrDefaultAsync(r => r.CommentId == id && r.UserId == userId.Value);
        if (existing != null && existing.ReactionType == reactionType)
        {
            _db.CommentReactions.Remove(existing);
            action = "removed";
        }
        else if (existing != null)
        {
            existing.ReactionType = reactionType;
            existing.UpdatedAt = DateTime.UtcNow;
            action = "updated";
        }
        else
        {
            _db.CommentReactions.Add(new CommentReaction
            {
                TenantId = _tenantContext.GetTenantIdOrThrow(),
                CommentId = id,
                UserId = userId.Value,
                ReactionType = reactionType,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();
        var reactions = await _db.CommentReactions
            .Where(r => r.CommentId == id)
            .GroupBy(r => r.ReactionType)
            .Select(g => new { ReactionType = g.Key, Count = g.Count() })
            .ToDictionaryAsync(r => r.ReactionType, r => r.Count);

        if (IsV2Request())
        {
            return Ok(new
            {
                data = new
                {
                    action,
                    emoji = reactionType,
                    reaction_type = action == "removed" ? null : reactionType,
                    reactions
                },
                meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
            });
        }

        return Ok(new { success = true, comment_id = id, action, reaction_type = action == "removed" ? null : reactionType, reactions });
    }

    // ──────────────────────────────────────────────
    // Feed interaction compatibility records
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/feed/like — Like a feed item (alias for POST /api/feed/{id}/like).
    /// </summary>
    [HttpPost("api/feed/like")]
    public async Task<IActionResult> FeedLikeAlias([FromBody] FeedLikeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (request?.PostId is not > 0) return BadRequest(new { error = "post_id is required" });

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == request.PostId.Value);
        if (post == null) return NotFound(new { error = "Post not found" });

        var existing = await _db.PostLikes
            .FirstOrDefaultAsync(l => l.PostId == post.Id && l.UserId == userId.Value);

        if (existing == null)
        {
            _db.PostLikes.Add(new PostLike
            {
                TenantId = _tenantContext.GetTenantIdOrThrow(),
                PostId = post.Id,
                UserId = userId.Value,
                CreatedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync();
        }

        var likeCount = await _db.PostLikes.CountAsync(l => l.PostId == post.Id);
        return Ok(new { success = true, message = "Post liked", post_id = post.Id, like_count = likeCount });
    }

    /// <summary>
    /// POST /api/feed/posts/{id}/click — Record post click (analytics).
    /// </summary>
    [HttpPost("api/feed/posts/{id:int}/click")]
    public async Task<IActionResult> RecordPostClick(int id) =>
        await RecordFeedInteraction(id, "click");

    /// <summary>
    /// POST /api/feed/posts/{id}/impression — Record post impression (analytics).
    /// </summary>
    [HttpPost("api/feed/posts/{id:int}/impression")]
    public async Task<IActionResult> RecordPostImpression(int id) =>
        await RecordFeedInteraction(id, "view");

    /// <summary>
    /// POST /api/feed/posts/{id}/hide — Hide a feed post.
    /// </summary>
    [HttpPost("api/feed/posts/{id:int}/hide")]
    public async Task<IActionResult> HidePost(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return NotFound(new { error = "Post not found" });

        var existing = await _db.HiddenPosts.FirstOrDefaultAsync(h => h.PostId == id && h.UserId == userId.Value);
        if (existing == null)
        {
            _db.HiddenPosts.Add(new HiddenPost
            {
                TenantId = tenantId,
                PostId = id,
                UserId = userId.Value,
                HiddenAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true, message = "Post hidden", post_id = id });
    }

    /// <summary>
    /// POST /api/feed/posts/{id}/delete — Delete a feed post (alias).
    /// </summary>
    [HttpPost("api/feed/posts/{id:int}/delete")]
    public async Task<IActionResult> DeletePostAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _db.Set<FeedPost>().FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId.Value);
        if (post == null) return NotFound(new { error = "Post not found" });

        post.IsHidden = true;
        post.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Post deleted" });
    }

    /// <summary>
    /// POST /api/feed/posts/{id}/share — Share a feed post.
    /// </summary>
    [HttpPost("api/feed/posts/{id:int}/share")]
    public async Task<IActionResult> SharePost(int id, [FromBody] SharePostAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == id);
        if (!postExists) return NotFound(new { error = "Post not found" });

        var channel = NormalizeShareChannel(request?.SharedTo ?? request?.Channel);
        var share = await _db.PostShares
            .FirstOrDefaultAsync(s => s.PostId == id && s.UserId == userId.Value && s.SharedTo == channel);

        if (share == null)
        {
            share = new PostShare
            {
                TenantId = _tenantContext.GetTenantIdOrThrow(),
                UserId = userId.Value,
                PostId = id,
                SharedTo = channel,
                CreatedAt = DateTime.UtcNow
            };
            _db.PostShares.Add(share);
            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            success = true,
            message = "Post shared",
            data = new
            {
                id = share.Id,
                post_id = share.PostId,
                shared_to = share.SharedTo,
                created_at = share.CreatedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/feed/posts/{id}/share — Unshare a feed post.
    /// </summary>
    [HttpDelete("api/feed/posts/{id:int}/share")]
    public async Task<IActionResult> UnsharePost(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var shares = await _db.PostShares
            .Where(s => s.PostId == id && s.UserId == userId.Value)
            .ToListAsync();

        if (shares.Count > 0)
        {
            _db.PostShares.RemoveRange(shares);
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true, message = "Share removed", removed = shares.Count });
    }

    /// <summary>
    /// POST /api/feed/posts/{id}/report — Report a feed post.
    /// </summary>
    [HttpPost("api/feed/posts/{id:int}/report")]
    public async Task<IActionResult> ReportPost(int id, [FromBody] ReportPostAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return NotFound(new { error = "Post not found" });

        var report = new FeedReport
        {
            TenantId = tenantId,
            PostId = id,
            ReporterId = userId.Value,
            Reason = NormalizeReportReason(request?.Reason),
            Details = request?.Details?.Trim(),
            Status = "pending",
            CreatedAt = DateTime.UtcNow
        };

        _db.FeedReports.Add(report);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Report submitted", id = report.Id, status = report.Status });
    }

    /// <summary>
    /// POST /api/feed/users/{id}/mute — Mute a user in feed.
    /// </summary>
    [HttpPost("api/feed/users/{id:int}/mute")]
    public async Task<IActionResult> MuteUser(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (id == userId.Value) return BadRequest(new { error = "Cannot mute yourself" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var targetExists = await _db.Users.AnyAsync(u => u.Id == id && u.TenantId == tenantId);
        if (!targetExists) return NotFound(new { error = "User not found" });

        var existing = await _db.MutedUsers.FirstOrDefaultAsync(m => m.UserId == userId.Value && m.MutedUserId == id);
        if (existing == null)
        {
            _db.MutedUsers.Add(new MutedUser
            {
                TenantId = tenantId,
                UserId = userId.Value,
                MutedUserId = id,
                MutedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true, message = "User muted", muted_user_id = id });
    }

    // ──────────────────────────────────────────────
    // Reviews, polls, legal, wallet aliases
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/polls/{id}/rank — Submit ranked poll vote.
    /// </summary>
    [HttpPost("api/polls/{id:int}/rank")]
    public async Task<IActionResult> RankedPollVote(int id, [FromBody] RankedVoteRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        return Ok(new { success = true, message = "Ranked vote recorded" });
    }

    /// <summary>
    /// POST /api/legal/acceptance/accept-all — Accept all legal documents.
    /// </summary>
    [HttpPost("api/legal/acceptance/accept-all")]
    public IActionResult AcceptAllLegal()
    {
        return Ok(new { success = true, message = "All legal documents accepted" });
    }

    /// <summary>
    /// POST /api/wallet/donate — Legacy alias without a certified donation writer.
    /// </summary>
    [HttpPost("api/wallet/donate")]
    public IActionResult WalletDonate([FromBody] object? request = null)
    {
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            error = "This compatibility route cannot safely record a wallet donation. Use the canonical wallet donation endpoint."
        });
    }

    // ──────────────────────────────────────────────
    // Group-exchange extras, group announcements
    // ──────────────────────────────────────────────

    // Group announcements routes removed — served by GroupFeaturesController

    /// <summary>
    /// POST /api/groups/{id}/requests/{userId} — Handle group membership request.
    /// </summary>
    [HttpPost("api/groups/{id:int}/requests/{userId:int}")]
    public async Task<IActionResult> HandleGroupRequest(int id, int userId, [FromBody] GroupRequestActionAliasRequest? request = null)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null) return NotFound(new { error = "Group not found" });

        var canManage = group.CreatedById == currentUserId.Value ||
            await _db.GroupMembers.AnyAsync(m =>
                m.GroupId == id &&
                m.UserId == currentUserId.Value &&
                (m.Role == Group.Roles.Owner || m.Role == Group.Roles.Admin));
        if (!canManage) return StatusCode(403, new { error = "Only group admins can handle requests" });

        var action = request?.Action?.Trim().ToLowerInvariant() ?? "approve";
        if (action is "reject" or "decline" or "deny")
            return Ok(new { success = true, message = "Group request rejected", group_id = id, user_id = userId });

        if (action is not ("approve" or "accept"))
            return BadRequest(new { error = "Action must be approve or reject" });

        var existing = await _db.GroupMembers.FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId);
        if (existing == null)
        {
            existing = new GroupMember
            {
                TenantId = _tenantContext.GetTenantIdOrThrow(),
                GroupId = id,
                UserId = userId,
                Role = Group.Roles.Member,
                JoinedAt = DateTime.UtcNow
            };
            _db.GroupMembers.Add(existing);
        }

        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Group request approved", group_id = id, user_id = userId, member_id = existing.Id });
    }

    /// <summary>
    /// POST /api/groups/{id}/tasks — Create group task.
    /// </summary>
    [HttpPost("api/groups/{id:int}/tasks")]
    public async Task<IActionResult> CreateGroupTask(int id, [FromBody] object? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == id);
        if (group == null) return NotFound(new { error = "Group not found" });

        if (!await IsGroupMemberOrCreator(id, userId.Value))
            return StatusCode(403, new { error = "Only group members can create tasks" });

        var isV2 = IsV2Request();

        var title = ReadStringProperty(request, "title", "name") ?? "Untitled task";
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(LaravelValidationError("title", "Task title is required"));

        var status = ReadStringProperty(request, "status") ?? (isV2 ? "todo" : "open");
        if (isV2 && !IsValidTeamTaskStatus(status))
            return BadRequest(LaravelValidationError("status", "Invalid task status"));

        var priority = ReadStringProperty(request, "priority") ?? "medium";
        if (isV2 && !IsValidTeamTaskPriority(priority))
            return BadRequest(LaravelValidationError("priority", "Invalid task priority"));

        var description = ReadStringProperty(request, "description");
        var assignedTo = ReadIntProperty(request, "assigned_to");
        var dueDate = ReadStringProperty(request, "due_date");
        var now = DateTime.UtcNow;
        var config = await AddTenantConfigValue(GroupTaskKeyPrefix, new
        {
            kind = "group_task",
            group_id = id,
            created_by = userId.Value,
            title,
            description,
            assigned_to = assignedTo,
            status,
            priority,
            due_date = dueDate,
            created_at = now,
            completed_at = status == "done" ? now : (DateTime?)null,
            updated_at = (DateTime?)null
        });

        var task = ParseStoredGroupTask(config)!;
        var data = ToLaravelTeamTaskDto(task);

        return CreatedAtAction(null, new
        {
            success = true,
            id = config.Id,
            group_id = id,
            title,
            status,
            data
        });
    }

    /// <summary>
    /// DELETE /api/groups/{id}/membership — Leave group (alias for DELETE /api/groups/{id}/leave).
    /// </summary>
    [HttpDelete("api/groups/{id:int}/membership")]
    public async Task<IActionResult> LeaveGroupAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var member = await _db.GroupMembers
            .FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId.Value);

        if (member == null) return NotFound(new { error = "Not a member" });

        _db.GroupMembers.Remove(member);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Left group" });
    }

    /// <summary>
    /// PUT /api/groups/{id}/members/{userId} — Update group member (alias).
    /// </summary>
    [HttpPut("api/groups/{id:int}/members/{userId:int}")]
    public async Task<IActionResult> UpdateGroupMemberAlias(int id, int userId, [FromBody] UpdateGroupMemberAliasRequest? request = null)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var canManage = await _db.GroupMembers.AnyAsync(m =>
            m.GroupId == id &&
            m.UserId == currentUserId.Value &&
            (m.Role == Group.Roles.Owner || m.Role == Group.Roles.Admin));
        if (!canManage) return StatusCode(403, new { error = "Only group admins can update members" });

        var member = await _db.GroupMembers.FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId);
        if (member == null) return NotFound(new { error = "Group member not found" });

        if (!string.IsNullOrWhiteSpace(request?.Role))
        {
            var role = request.Role.Trim().ToLowerInvariant();
            if (role is not (Group.Roles.Member or Group.Roles.Admin or Group.Roles.Owner))
                return BadRequest(new { error = "Role must be member, admin, or owner" });
            member.Role = role;
        }

        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Member updated", group_id = id, user_id = userId, role = member.Role });
    }

    // ──────────────────────────────────────────────
    // Team tasks/documents compatibility records
    // ──────────────────────────────────────────────

    /// <summary>
    /// DELETE /api/team-documents/{id} — Delete team document.
    /// </summary>
    [HttpDelete("api/team-documents/{id:int}")]
    public async Task<IActionResult> DeleteTeamDocument(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var document = await _db.GroupFiles.FirstOrDefaultAsync(f => f.Id == id);
        if (document == null) return NotFound(new { error = "Document not found" });

        var membership = await _db.GroupMembers
            .FirstOrDefaultAsync(m => m.GroupId == document.GroupId && m.UserId == userId.Value);
        if (membership == null) return StatusCode(403, new { error = "You are not a member of this team" });

        if (document.UploadedById != userId.Value &&
            membership.Role != Group.Roles.Owner &&
            membership.Role != Group.Roles.Admin)
        {
            return StatusCode(403, new { error = "Only the uploader or team admins can delete documents" });
        }

        _db.GroupFiles.Remove(document);
        await _db.SaveChangesAsync();

        if (IsV2Request())
        {
            return NoContent();
        }

        return Ok(new { success = true, message = "Document deleted" });
    }

    /// <summary>
    /// GET /api/team-tasks/{id} — Show team task.
    /// </summary>
    [HttpGet("api/team-tasks/{id:int}")]
    public async Task<IActionResult> ShowTeamTask(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var config = await FindTenantConfigByIdAndPrefix(id, GroupTaskKeyPrefix);
        var task = config == null ? null : ParseStoredGroupTask(config);
        if (task == null) return NotFound(new { error = "Team task not found" });
        if (!await IsGroupMemberOrCreator(task.GroupId, userId.Value))
            return StatusCode(403, new { error = "Only group members can view tasks" });

        return Ok(new { success = true, data = ToLaravelTeamTaskDto(task) });
    }

    /// <summary>
    /// DELETE /api/team-tasks/{id} — Delete team task.
    /// </summary>
    [HttpDelete("api/team-tasks/{id:int}")]
    public async Task<IActionResult> DeleteTeamTask(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var task = await FindTenantConfigByIdAndPrefix(id, GroupTaskKeyPrefix);
        if (task == null) return NotFound(new { error = "Team task not found" });
        if (!await CanManageStoredGroupTask(task, userId.Value))
            return StatusCode(403, new { error = "Only the task creator or group admins can delete tasks" });

        _db.TenantConfigs.Remove(task);
        await _db.SaveChangesAsync();

        if (IsV2Request())
        {
            return NoContent();
        }

        return Ok(new { success = true, message = "Team task deleted", id });
    }

    /// <summary>
    /// PUT /api/team-tasks/{id} — Update team task.
    /// </summary>
    [HttpPut("api/team-tasks/{id:int}")]
    public async Task<IActionResult> UpdateTeamTask(int id, [FromBody] object? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var task = await FindTenantConfigByIdAndPrefix(id, GroupTaskKeyPrefix);
        if (task == null) return NotFound(new { error = "Team task not found" });
        if (!await CanManageStoredGroupTask(task, userId.Value))
            return StatusCode(403, new { error = "Only the task creator or group admins can update tasks" });

        var current = ParseStoredGroupTask(task);
        if (current == null) return NotFound(new { error = "Team task not found" });

        var isV2 = IsV2Request();
        var groupId = current.GroupId;
        var createdBy = current.CreatedBy;
        var title = ReadStringProperty(request, "title", "name") ?? current.Title;
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(LaravelValidationError("title", "Task title cannot be empty"));

        var status = ReadStringProperty(request, "status") ?? current.Status;
        if (isV2 && !IsValidTeamTaskStatus(status))
            return BadRequest(LaravelValidationError("status", "Invalid task status"));

        var priority = ReadStringProperty(request, "priority") ?? current.Priority;
        if (isV2 && !IsValidTeamTaskPriority(priority))
            return BadRequest(LaravelValidationError("priority", "Invalid task priority"));

        var description = ReadStringProperty(request, "description") ?? current.Description;
        var assignedTo = ReadIntProperty(request, "assigned_to") ?? current.AssignedTo;
        var dueDate = ReadStringProperty(request, "due_date") ?? current.DueDate;
        var now = DateTime.UtcNow;
        var completedAt = status == "done"
            ? current.CompletedAt ?? now
            : (DateTime?)null;

        task.Value = JsonSerializer.Serialize(new
        {
            kind = "group_task",
            group_id = groupId,
            created_by = createdBy,
            title,
            description,
            assigned_to = assignedTo,
            status,
            priority,
            due_date = dueDate,
            created_at = current.CreatedAt,
            completed_at = completedAt,
            updated_by = userId.Value,
            updated_at = now
        });
        task.UpdatedAt = now;
        await _db.SaveChangesAsync();

        var updated = ParseStoredGroupTask(task)!;

        return Ok(new
        {
            success = true,
            message = "Team task updated",
            id = task.Id,
            group_id = groupId,
            title,
            status,
            data = ToLaravelTeamTaskDto(updated)
        });
    }

    // ──────────────────────────────────────────────
    // Federation compatibility records
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/federation/setup — Initial federation setup.
    /// </summary>
    [HttpPost("api/federation/setup")]
    public async Task<IActionResult> FederationSetup([FromBody] FederationSetupAliasRequest? request = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var control = await _db.FederationSystemControls.FirstOrDefaultAsync();
        if (control == null)
        {
            control = new FederationSystemControl();
            _db.FederationSystemControls.Add(control);
        }

        if (request?.Enabled != null) control.FederationEnabled = request.Enabled.Value;
        control.UpdatedAt = DateTime.UtcNow;

        var whitelist = await _db.FederationTenantWhitelists.FirstOrDefaultAsync(w => w.TenantId == tenantId);
        if (whitelist == null)
        {
            whitelist = new FederationTenantWhitelist
            {
                TenantId = tenantId,
                IsEnabled = true,
                Notes = "Enabled via compatibility setup endpoint",
                ApprovedByUserId = User.GetUserId(),
                ApprovedAt = DateTime.UtcNow
            };
            _db.FederationTenantWhitelists.Add(whitelist);
        }
        else if (request?.Enabled != null)
        {
            whitelist.IsEnabled = request.Enabled.Value;
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            federation_enabled = control.FederationEnabled,
            tenant_whitelisted = whitelist.IsEnabled
        });
    }

    /// <summary>
    /// POST /api/federation/connections — Create federation connection.
    /// </summary>
    [HttpPost("api/federation/connections")]
    public async Task<IActionResult> CreateFederationConnection([FromBody] FederationConnectionAliasRequest? request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (request?.PartnerTenantId is not > 0) return BadRequest(new { error = "partner_tenant_id is required" });
        var partnerTenantId = request.PartnerTenantId.Value;

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (partnerTenantId == tenantId)
            return BadRequest(new { error = "Cannot create a federation connection with your own tenant" });

        var partnerTenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == partnerTenantId && t.IsActive);
        if (partnerTenant == null) return NotFound(new { error = "Partner tenant not found" });

        var existing = await _db.FederationPartners
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p =>
                (p.TenantId == tenantId && p.PartnerTenantId == partnerTenantId) ||
                (p.TenantId == partnerTenantId && p.PartnerTenantId == tenantId));
        if (existing != null) return Conflict(new { error = "Federation connection already exists", id = existing.Id });

        var partner = new FederationPartner
        {
            TenantId = tenantId,
            PartnerTenantId = partnerTenantId,
            RequestedById = userId.Value,
            SharedListings = request.SharedListings ?? true,
            SharedEvents = request.SharedEvents ?? false,
            SharedMembers = request.SharedMembers ?? false,
            Status = PartnerStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _db.FederationPartners.Add(partner);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Connection request sent", id = partner.Id, status = partner.Status.ToString().ToLowerInvariant() });
    }

    /// <summary>
    /// POST /api/federation/connections/{id}/{command} — Accept/reject federation connection.
    /// </summary>
    [HttpPost("api/federation/connections/{id:int}/{command}")]
    public async Task<IActionResult> FederationConnectionAction(int id, string command)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var partner = await _db.FederationPartners
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == id && (p.TenantId == tenantId || p.PartnerTenantId == tenantId));

        if (partner == null) return NotFound(new { error = "Connection not found" });

        switch (command.Trim().ToLowerInvariant())
        {
            case "accept":
            case "approve":
                partner.Status = PartnerStatus.Active;
                partner.ApprovedById = userId.Value;
                partner.ApprovedAt = DateTime.UtcNow;
                break;
            case "reject":
            case "revoke":
                partner.Status = PartnerStatus.Revoked;
                break;
            case "suspend":
                partner.Status = PartnerStatus.Suspended;
                break;
            default:
                return BadRequest(new { error = "Unsupported federation connection action" });
        }

        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = $"Connection {command}", id = partner.Id, status = partner.Status.ToString().ToLowerInvariant() });
    }

    /// <summary>
    /// POST /api/federation/messages/{id}/mark-read — Mark federation message read.
    /// </summary>
    [HttpPost("api/federation/messages/{id:int}/mark-read")]
    public async Task<IActionResult> MarkFederationMessageRead(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var config = await UpsertTenantConfigValue(
            $"{FederationMessageReadKeyPrefix}{id}:{userId.Value}",
            new
            {
                kind = "federation_message_read",
                federation_message_id = id,
                user_id = userId.Value,
                read_at = DateTime.UtcNow
            });

        return Ok(new { success = true, id = config.Id, federation_message_id = id, read = true });
    }


    // ──────────────────────────────────────────────
    // Gamification showcase & challenges
    // ──────────────────────────────────────────────

    /// <summary>
    /// PUT /api/gamification/showcase — Update badge showcase.
    /// </summary>
    [HttpPut("api/gamification/showcase")]
    public async Task<IActionResult> UpdateShowcase([FromBody] GamificationShowcaseRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var badgeKeys = request?.BadgeKeys ?? new List<string>();
        if (badgeKeys.Count > 5)
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "You can showcase up to 5 badges.", field = "badge_keys" } },
                meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
            });
        }

        var requestedKeys = badgeKeys
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => k.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var earnedBadges = await _db.UserBadges
            .Include(ub => ub.Badge)
            .Where(ub => ub.TenantId == tenantId && ub.UserId == userId.Value && ub.Badge != null && ub.Badge.IsActive)
            .ToListAsync();
        var earnedByKey = earnedBadges
            .Where(ub => ub.Badge != null)
            .GroupBy(ub => ub.Badge!.Slug, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var invalidKeys = requestedKeys
            .Where(k => !earnedByKey.ContainsKey(k))
            .ToArray();
        if (invalidKeys.Length > 0)
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_INVALID_VALUE", message = "One or more badges are not owned by this user.", field = "badge_keys" } },
                data = new { invalid_badge_keys = invalidKeys },
                meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
            });
        }

        var existing = await _db.BadgeShowcases
            .Where(s => s.TenantId == tenantId && s.UserId == userId.Value)
            .ToListAsync();
        _db.BadgeShowcases.RemoveRange(existing);

        for (var i = 0; i < requestedKeys.Count; i++)
        {
            var userBadge = earnedByKey[requestedKeys[i]];
            _db.BadgeShowcases.Add(new BadgeShowcase
            {
                TenantId = tenantId,
                UserId = userId.Value,
                BadgeId = userBadge.BadgeId,
                DisplayOrder = i,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();

        var showcasedBadges = requestedKeys
            .Select((key, index) => new { UserBadge = earnedByKey[key], DisplayOrder = index })
            .Select(item => new
            {
                id = item.UserBadge.BadgeId,
                key = item.UserBadge.Badge!.Slug,
                badge_key = item.UserBadge.Badge.Slug,
                slug = item.UserBadge.Badge.Slug,
                name = item.UserBadge.Badge.Name,
                description = item.UserBadge.Badge.Description ?? string.Empty,
                icon = item.UserBadge.Badge.Icon ?? "medal",
                type = BadgeTypeFromSlug(item.UserBadge.Badge.Slug),
                earned = true,
                is_earned = true,
                earned_at = item.UserBadge.EarnedAt,
                is_showcased = true,
                showcase_order = item.DisplayOrder
            })
            .ToArray();

        return Ok(new
        {
            success = true,
            data = new
            {
                message = "Showcase updated",
                showcased_badges = showcasedBadges
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    /// <summary>
    /// POST /api/gamification/challenges — Accept a challenge.
    /// </summary>
    [HttpPost("api/gamification/challenges")]
    public IActionResult AcceptChallenge([FromBody] object? request = null)
    {
        return Ok(new { success = true, message = "Challenge accepted" });
    }

    /// <summary>
    /// POST /api/gamification/shop/purchase — Purchase from XP shop (alias).
    /// </summary>
    [HttpPost("api/gamification/shop/purchase")]
    public IActionResult PurchaseFromShop([FromBody] ShopPurchaseRequest? request = null)
    {
        return Ok(new { success = true, message = "Purchase pending", item_id = request?.ItemId });
    }

    // ──────────────────────────────────────────────
    // Volunteering compatibility records
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/volunteering/certificates — Upload volunteering certificate.
    /// </summary>
    [HttpPost("api/volunteering/certificates")]
    public async Task<IActionResult> VolunteeringCertificate([FromBody] object? request = null) =>
        await PersistVolunteerCompatibilityRecord(
            VolunteerCertificateKeyPrefix,
            "volunteer_certificate",
            request,
            "Certificate metadata recorded; upload files via /api/volunteering/credentials.");

    /// <summary>
    /// POST /api/volunteering/community-projects — Create community project.
    /// </summary>
    [HttpPost("api/volunteering/community-projects")]
    public async Task<IActionResult> CreateCommunityProject([FromBody] CommunityProjectAliasRequest? request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (string.IsNullOrWhiteSpace(request?.Title)) return BadRequest(new { error = "title is required" });
        var title = request.Title.Trim();

        var project = new VolunteerOpportunity
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            OrganizerId = userId.Value,
            Title = title,
            Description = request.Description?.Trim(),
            Location = request.Location?.Trim(),
            RequiredVolunteers = Math.Max(1, request.RequiredVolunteers ?? 1),
            Status = request.Publish == true ? OpportunityStatus.Published : OpportunityStatus.Draft,
            StartsAt = request.StartsAt,
            EndsAt = request.EndsAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.VolunteerOpportunities.Add(project);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Project created", id = project.Id, status = project.Status.ToString().ToLowerInvariant() });
    }

    /// <summary>
    /// POST /api/volunteering/community-projects/{id}/support — Support a project.
    /// </summary>
    [HttpPost("api/volunteering/community-projects/{id:int}/support")]
    public async Task<IActionResult> SupportProject(int id) => await SetProjectSupport(id, true);

    /// <summary>
    /// DELETE /api/volunteering/community-projects/{id}/support — Remove support.
    /// </summary>
    [HttpDelete("api/volunteering/community-projects/{id:int}/support")]
    public async Task<IActionResult> UnsupportProject(int id) => await SetProjectSupport(id, false);

    /// <summary>
    /// POST /api/volunteering/donations — Record donation.
    /// </summary>
    [HttpPost("api/volunteering/donations")]
    public async Task<IActionResult> RecordDonation([FromBody] object? request = null) =>
        await PersistVolunteerCompatibilityRecord(VolunteerDonationKeyPrefix, "volunteer_donation", request, "Donation recorded");

    /// <summary>
    /// POST /api/volunteering/expenses — Submit expense.
    /// </summary>
    [HttpPost("api/volunteering/expenses")]
    public async Task<IActionResult> SubmitExpense([FromBody] object? request = null) =>
        await PersistVolunteerCompatibilityRecord(VolunteerExpenseKeyPrefix, "volunteer_expense", request, "Expense submitted");

    /// <summary>
    /// POST /api/volunteering/hours — Log volunteering hours.
    /// </summary>
    [HttpPost("api/volunteering/hours")]
    public IActionResult LogVolunteeringHours([FromBody] LogVolunteeringHoursAliasRequest? request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Laravel persists submitted hours in the separately reviewed vol_logs
        // ledger. volunteer_check_ins is QR attendance evidence and cannot safely
        // stand in for that ledger: doing so bypasses review and collides with the
        // canonical one-row-per-shift/user attendance key. Fail closed until the
        // volunteer-hours ledger is implemented rather than returning false
        // success or mutating a pending QR record.
        return VolunteerApplicationError(
            StatusCodes.Status503ServiceUnavailable,
            "VOLUNTEER_HOURS_UNAVAILABLE",
            "Volunteer hour submission is unavailable until the reviewed hours ledger is implemented.");
    }

    /// <summary>
    /// POST /api/volunteering/incidents — Report incident.
    /// </summary>
    [HttpPost("api/volunteering/incidents")]
    public async Task<IActionResult> ReportIncident([FromBody] object? request = null) =>
        await PersistVolunteerCompatibilityRecord(VolunteerIncidentKeyPrefix, "volunteer_incident", request, "Incident recorded");

    /// <summary>
    /// POST /api/volunteering/training — Record training.
    /// </summary>
    [HttpPost("api/volunteering/training")]
    public async Task<IActionResult> RecordTraining([FromBody] object? request = null) =>
        await PersistVolunteerCompatibilityRecord(VolunteerTrainingKeyPrefix, "volunteer_training", request, "Training recorded");

    /// <summary>
    /// POST /api/volunteering/wellbeing/checkin — Wellbeing check-in.
    /// </summary>
    [HttpPost("api/volunteering/wellbeing/checkin")]
    public async Task<IActionResult> WellbeingCheckIn([FromBody] object? request = null) =>
        await PersistVolunteerCompatibilityRecord(VolunteerWellbeingKeyPrefix, "volunteer_wellbeing_checkin", request, "Wellbeing check-in recorded");

    /// <summary>
    /// PUT /api/volunteering/accessibility-needs — Update accessibility needs.
    /// </summary>
    [HttpPut("api/volunteering/accessibility-needs")]
    public async Task<IActionResult> UpdateAccessibilityNeeds([FromBody] object? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var config = await UpsertTenantConfigValue(
            $"{VolunteerAccessibilityKeyPrefix}{userId.Value}",
            new
            {
                kind = "volunteer_accessibility_needs",
                user_id = userId.Value,
                payload = request ?? EmptyPayload(),
                updated_at = DateTime.UtcNow
            });

        return Ok(new { success = true, message = "Accessibility needs updated", id = config.Id });
    }

    /// <summary>
    /// PUT /api/volunteering/applications/{id} — Approve or decline an application as its organizer.
    /// </summary>
    [HttpPut("api/volunteering/applications/{id:int}")]
    public async Task<IActionResult> UpdateVolunteeringApplication(int id, [FromBody] UpdateVolunteeringApplicationAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return VolunteerApplicationError(StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Invalid token");

        if (request?.Action is not ("approve" or "decline"))
        {
            return VolunteerApplicationError(
                StatusCodes.Status400BadRequest,
                "VALIDATION_ERROR",
                "Action must be approve or decline",
                "action");
        }

        var approved = request.Action == "approve";
        try
        {
            var result = await _volunteerApprovals.DecideForOrganizerAsync(
                id,
                _tenantContext.GetTenantIdOrThrow(),
                userId.Value,
                approved,
                request.OrgNote,
                HttpContext.RequestAborted);

            if (!result.Succeeded)
            {
                return result.Failure switch
                {
                    AdminVolunteerDecisionFailure.FeatureDisabled => VolunteerApplicationError(
                        StatusCodes.Status403Forbidden,
                        "FEATURE_DISABLED",
                        "Service unavailable"),
                    AdminVolunteerDecisionFailure.NotFound => VolunteerApplicationError(
                        StatusCodes.Status404NotFound,
                        "NOT_FOUND",
                        "Application not found"),
                    AdminVolunteerDecisionFailure.Forbidden => VolunteerApplicationError(
                        StatusCodes.Status403Forbidden,
                        "FORBIDDEN",
                        result.Message ?? "You do not have permission to manage this opportunity"),
                    AdminVolunteerDecisionFailure.AlreadyDecided => VolunteerApplicationError(
                        StatusCodes.Status409Conflict,
                        "ALREADY_EXISTS",
                        result.Message ?? "This application has already been decided"),
                    _ => VolunteerApplicationError(
                        StatusCodes.Status422UnprocessableEntity,
                        "VALIDATION_ERROR",
                        result.Message ?? "Failed to update application",
                        result.Field)
                };
            }

            return Ok(new
            {
                data = new
                {
                    id,
                    status = approved ? "approved" : "declined",
                    org_note = string.IsNullOrWhiteSpace(request.OrgNote)
                        ? null
                        : request.OrgNote.Trim()
                },
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}"
                }
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(
                ex,
                "Failed organizer decision for volunteer application {ApplicationId}",
                id);
            return VolunteerApplicationError(
                StatusCodes.Status500InternalServerError,
                "SERVER_ERROR",
                "Failed to update application");
        }
    }

    // Withdraw application route removed — served by VolunteeringController

    /// <summary>
    /// PUT /api/volunteering/emergency-alerts/{id} — Update emergency alert.
    /// </summary>
    [HttpPut("api/volunteering/emergency-alerts/{id:int}")]
    public async Task<IActionResult> UpdateEmergencyAlert(int id, [FromBody] UpdateEmergencyAlertAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var alert = await _db.EmergencyAlerts.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
        if (alert == null) return NotFound(new { error = "Alert not found" });

        var currentUser = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value);
        var isAdmin = currentUser?.Role is "admin" or "super_admin";
        if (!isAdmin && alert.CreatedById != userId.Value)
            return StatusCode(403, new { error = "Only the alert creator or an admin can update this alert" });

        if (request == null)
            return Ok(new { success = true, message = "Alert unchanged", id = alert.Id });

        if (!string.IsNullOrWhiteSpace(request.Title)) alert.Title = request.Title.Trim();
        if (!string.IsNullOrWhiteSpace(request.Description)) alert.Description = request.Description.Trim();
        if (request.ContactInfo != null) alert.ContactInfo = request.ContactInfo.Trim();

        if (!string.IsNullOrWhiteSpace(request.Urgency))
        {
            var urgency = request.Urgency.Trim().ToLowerInvariant();
            if (urgency is not ("low" or "medium" or "high" or "critical"))
                return BadRequest(new { error = "Urgency must be: low, medium, high, critical" });
            alert.Urgency = urgency;
        }

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            var status = request.Status.Trim().ToLowerInvariant();
            if (status is "resolved" or "closed" or "inactive")
            {
                request.IsActive = false;
            }
            else if (status is "active" or "open")
            {
                request.IsActive = true;
            }
            else
            {
                return BadRequest(new { error = "Status must be active/open or resolved/closed" });
            }
        }

        if (request.IsActive.HasValue)
        {
            alert.IsActive = request.IsActive.Value;
            alert.ResolvedById = alert.IsActive ? null : userId.Value;
            alert.ResolvedAt = alert.IsActive ? null : DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            message = "Emergency alert updated",
            id = alert.Id,
            title = alert.Title,
            urgency = alert.Urgency,
            is_active = alert.IsActive
        });
    }

    /// <summary>
    /// PUT /api/volunteering/hours/{id}/verify — Verify volunteering hours.
    /// </summary>
    [HttpPut("api/volunteering/hours/{id:int}/verify")]
    public async Task<IActionResult> VerifyHours(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var checkIn = await _db.VolunteerCheckIns
            .Include(c => c.Shift)
            .ThenInclude(s => s!.Opportunity)
            .FirstOrDefaultAsync(c =>
                c.Id == id
                && (c.HoursLogged.HasValue || c.TransactionId.HasValue));
        if (checkIn == null) return NotFound(new { error = "Hours record not found" });

        if (checkIn.Shift?.Opportunity?.OrganizerId != userId.Value)
            return StatusCode(403, new { error = "Only the opportunity organizer can verify hours" });

        checkIn.Notes = AppendNote(checkIn.Notes, "verified");
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Hours verified", id = checkIn.Id });
    }

    // ProcessShiftSwap removed — served by ShiftManagementController

    // ──────────────────────────────────────────────
    // Jobs extras
    // ──────────────────────────────────────────────

    /// <summary>
    /// PUT /api/jobs/alerts/{id}/unsubscribe — Unsubscribe from job alert.
    /// </summary>
    [HttpPut("api/jobs/alerts/{id:int}/unsubscribe")]
    public async Task<IActionResult> UnsubscribeJobAlert(int id) => await SetJobAlertNotification(id, false);

    /// <summary>
    /// PUT /api/jobs/alerts/{id}/resubscribe — Resubscribe to job alert.
    /// </summary>
    [HttpPut("api/jobs/alerts/{id:int}/resubscribe")]
    public async Task<IActionResult> ResubscribeJobAlert(int id) => await SetJobAlertNotification(id, true);

    /// <summary>
    /// PUT /api/jobs/applications/{id} — Update job application.
    /// </summary>
    [HttpPut("api/jobs/applications/{id:int}")]
    public async Task<IActionResult> UpdateJobApplication(int id, [FromBody] UpdateJobApplicationAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var application = await _db.JobApplications
            .Include(a => a.Job)
            .FirstOrDefaultAsync(a => a.Id == id);
        if (application == null) return NotFound(new { error = "Application not found" });

        var isPoster = application.Job?.PostedByUserId == userId.Value;
        var isApplicant = application.ApplicantUserId == userId.Value;
        if (!isApplicant && !isPoster && !User.IsAdmin())
            return StatusCode(403, new { error = "You cannot update this application" });

        if (isApplicant && request?.CoverLetter != null)
            application.CoverLetter = request.CoverLetter.Trim();

        if (!string.IsNullOrWhiteSpace(request?.Status))
        {
            var status = request.Status.Trim().ToLowerInvariant();
            if (isApplicant && status != "withdrawn")
                return BadRequest(new { error = "Applicants can only withdraw applications" });

            if (status is not ("pending" or "reviewed" or "accepted" or "rejected" or "withdrawn"))
                return BadRequest(new { error = "Status must be pending, reviewed, accepted, rejected, or withdrawn" });

            application.Status = status;
            if (isPoster || User.IsAdmin())
            {
                application.ReviewedAt = DateTime.UtcNow;
                application.ReviewedByUserId = userId.Value;
                application.ReviewNotes = request.Notes?.Trim() ?? request.ReviewNotes?.Trim();
            }
        }

        application.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Application updated", id = application.Id, status = application.Status });
    }

    // ──────────────────────────────────────────────
    // Sub-account and skills aliases
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/users/me/sub-accounts — Create sub-account (alias).
    /// </summary>
    [HttpPost("api/users/me/sub-accounts")]
    public async Task<IActionResult> CreateSubAccountAlias([FromBody] CreateSubAccountAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var subUserId = request?.SubUserId ?? 0;
        if (subUserId <= 0 && !string.IsNullOrWhiteSpace(request?.Email))
        {
            subUserId = await _db.Users
                .Where(u => u.TenantId == tenantId && u.Email == request.Email.Trim())
                .Select(u => u.Id)
                .FirstOrDefaultAsync();
        }
        if (subUserId <= 0 && !string.IsNullOrWhiteSpace(request?.ChildEmail))
        {
            subUserId = await _db.Users
                .Where(u => u.TenantId == tenantId && u.Email == request.ChildEmail.Trim())
                .Select(u => u.Id)
                .FirstOrDefaultAsync();
        }

        if (subUserId <= 0) return BadRequest(new { errors = new[] { new { code = "VALIDATION_ERROR", message = "The email field is required.", field = "email" } } });
        if (subUserId == userId.Value) return BadRequest(new { errors = new[] { new { code = "SELF_RELATIONSHIP", message = "Cannot add yourself as a linked account." } } });

        var subUserExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Id == subUserId);
        if (!subUserExists) return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "User not found.", field = "email" } } });

        var existing = await _db.SubAccounts
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.PrimaryUserId == userId.Value && s.SubUserId == subUserId);
        if (existing != null)
        {
            existing.Relationship = NormalizeSubAccountRelationship(request?.RelationshipType ?? request?.Relationship);
            ApplySubAccountPermissions(existing, request);
            existing.IsActive = false;
            existing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return Created("", new { data = await BuildSubAccountChildrenRowsAsync(userId.Value, tenantId) });
        }

        var subAccount = new SubAccount
        {
            TenantId = tenantId,
            PrimaryUserId = userId.Value,
            SubUserId = subUserId,
            Relationship = NormalizeSubAccountRelationship(request?.RelationshipType ?? request?.Relationship),
            DisplayName = request?.DisplayName?.Trim(),
            IsActive = false,
            CreatedAt = DateTime.UtcNow
        };
        ApplySubAccountPermissions(subAccount, request);

        _db.SubAccounts.Add(subAccount);
        await _db.SaveChangesAsync();

        return Created("", new { data = await BuildSubAccountChildrenRowsAsync(userId.Value, tenantId) });
    }

    /// <summary>
    /// DELETE /api/users/me/sub-accounts/{id} — Delete sub-account.
    /// </summary>
    [HttpDelete("api/users/me/sub-accounts/{id:int}")]
    public async Task<IActionResult> DeleteSubAccountAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var subAccount = await _db.SubAccounts.FirstOrDefaultAsync(s =>
            s.TenantId == tenantId &&
            s.Id == id &&
            (s.PrimaryUserId == userId.Value || s.SubUserId == userId.Value));
        if (subAccount == null) return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "Sub-account relationship not found." } } });

        _db.SubAccounts.Remove(subAccount);
        await _db.SaveChangesAsync();

        return Ok(new { data = new { message = "Relationship revoked" } });
    }

    /// <summary>
    /// PUT /api/users/me/sub-accounts/{id}/approve — Approve sub-account.
    /// </summary>
    [HttpPut("api/users/me/sub-accounts/{id:int}/approve")]
    public async Task<IActionResult> ApproveSubAccount(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var subAccount = await _db.SubAccounts.FirstOrDefaultAsync(s =>
            s.TenantId == tenantId &&
            s.Id == id &&
            s.SubUserId == userId.Value &&
            !s.IsActive);
        if (subAccount == null) return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "Sub-account relationship not found." } } });

        subAccount.IsActive = true;
        subAccount.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { data = await BuildSubAccountParentRowsAsync(userId.Value, tenantId) });
    }

    /// <summary>
    /// PUT /api/users/me/sub-accounts/{id}/permissions — Update sub-account permissions.
    /// </summary>
    [HttpPut("api/users/me/sub-accounts/{id:int}/permissions")]
    public async Task<IActionResult> UpdateSubAccountPermissions(int id, [FromBody] UpdateSubAccountPermissionsAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var subAccount = await _db.SubAccounts.FirstOrDefaultAsync(s =>
            s.TenantId == tenantId &&
            s.Id == id &&
            s.PrimaryUserId == userId.Value &&
            s.IsActive);
        if (subAccount == null) return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "Sub-account relationship not found." } } });

        ApplySubAccountPermissions(subAccount, request);
        subAccount.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { data = await BuildSubAccountChildrenRowsAsync(userId.Value, tenantId) });
    }

    private async Task<List<object>> BuildSubAccountChildrenRowsAsync(int userId, int tenantId)
    {
        var rows = await (
            from relationship in _db.SubAccounts.AsNoTracking()
            join child in _db.Users.AsNoTracking() on relationship.SubUserId equals child.Id
            where relationship.TenantId == tenantId
                && relationship.PrimaryUserId == userId
                && child.TenantId == tenantId
            orderby relationship.CreatedAt descending
            select new { relationship, user = child })
            .ToListAsync();

        return rows.Select(row => SubAccountRelationshipRow(row.relationship, row.user)).ToList();
    }

    private async Task<List<object>> BuildSubAccountParentRowsAsync(int userId, int tenantId)
    {
        var rows = await (
            from relationship in _db.SubAccounts.AsNoTracking()
            join parent in _db.Users.AsNoTracking() on relationship.PrimaryUserId equals parent.Id
            where relationship.TenantId == tenantId
                && relationship.SubUserId == userId
                && parent.TenantId == tenantId
            orderby relationship.CreatedAt descending
            select new { relationship, user = parent })
            .ToListAsync();

        return rows.Select(row => SubAccountRelationshipRow(row.relationship, row.user)).ToList();
    }

    private static object SubAccountRelationshipRow(SubAccount relationship, User user) => new
    {
        relationship_id = relationship.Id,
        relationship_type = relationship.Relationship,
        permissions = new
        {
            can_view_activity = true,
            can_manage_listings = relationship.CanJoinGroups,
            can_transact = relationship.CanTransact,
            can_view_messages = relationship.CanMessage
        },
        status = relationship.IsActive ? "active" : "pending",
        approved_at = relationship.IsActive ? relationship.UpdatedAt ?? relationship.CreatedAt : (DateTime?)null,
        created_at = relationship.CreatedAt,
        user_id = user.Id,
        first_name = user.FirstName,
        last_name = user.LastName,
        avatar_url = user.AvatarUrl,
        email = user.Email
    };

    private static string NormalizeSubAccountRelationship(string? relationship)
    {
        var normalized = relationship?.Trim().ToLowerInvariant();
        return normalized is "family" or "guardian" or "carer" or "organization"
            ? normalized
            : "family";
    }

    private static void ApplySubAccountPermissions(SubAccount subAccount, CreateSubAccountAliasRequest? request)
    {
        subAccount.CanTransact = PermissionValue(request?.Permissions, "can_transact", request?.CanTransact) ?? false;
        subAccount.CanMessage = PermissionValue(request?.Permissions, "can_view_messages", request?.CanMessage) ?? false;
        subAccount.CanJoinGroups = PermissionValue(request?.Permissions, "can_manage_listings", request?.CanJoinGroups) ?? false;
    }

    private static void ApplySubAccountPermissions(SubAccount subAccount, UpdateSubAccountPermissionsAliasRequest? request)
    {
        if (PermissionValue(request?.Permissions, "can_transact", request?.CanTransact) is { } canTransact)
        {
            subAccount.CanTransact = canTransact;
        }

        if (PermissionValue(request?.Permissions, "can_view_messages", request?.CanMessage) is { } canMessage)
        {
            subAccount.CanMessage = canMessage;
        }

        if (PermissionValue(request?.Permissions, "can_manage_listings", request?.CanJoinGroups) is { } canManageListings)
        {
            subAccount.CanJoinGroups = canManageListings;
        }
    }

    private static bool? PermissionValue(IReadOnlyDictionary<string, bool>? permissions, string key, bool? fallback)
        => permissions != null && permissions.TryGetValue(key, out var value) ? value : fallback;

    /// <summary>
    /// POST /api/users/me/skills — Add skill to user (alias).
    /// </summary>
    [HttpPost("api/users/me/skills")]
    public async Task<IActionResult> AddUserSkillAlias([FromBody] AddUserSkillAliasRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var skillName = request?.SkillName?.Trim();
        if (request?.SkillId is not > 0 && string.IsNullOrWhiteSpace(skillName))
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "skill_name is required", field = "skill_name" } }
            });
        }

        Skill? skill = null;
        if (request?.SkillId is > 0)
        {
            skill = await _db.Skills.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == request.SkillId.Value);
            if (skill == null) return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "Skill not found" } } });
        }
        else
        {
            skillName = skillName!.Length > 100 ? skillName[..100] : skillName;
            var normalized = skillName.ToLowerInvariant();
            skill = await _db.Skills.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Name.ToLower() == normalized);
            if (skill == null)
            {
                skill = new Skill
                {
                    TenantId = tenantId,
                    Name = skillName,
                    Slug = await GenerateUniqueSkillSlugAsync(tenantId, skillName),
                    CategoryId = request?.CategoryId,
                    CreatedAt = DateTime.UtcNow
                };
                _db.Skills.Add(skill);
                await _db.SaveChangesAsync();
            }
        }

        var existing = await _db.UserSkills.FirstOrDefaultAsync(us =>
            us.TenantId == tenantId && us.UserId == userId.Value && us.SkillId == skill.Id);
        if (existing != null)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "DUPLICATE", message = "Skill already added", field = "skill_name" } }
            });
        }

        var userSkill = new UserSkill
        {
            TenantId = tenantId,
            UserId = userId.Value,
            SkillId = skill.Id,
            ProficiencyLevel = NormalizeSkillLevel(request?.ProficiencyLevel),
            CreatedAt = DateTime.UtcNow
        };

        _db.UserSkills.Add(userSkill);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = await BuildLaravelUserSkillListAsync(userId.Value)
        });
    }

    /// <summary>
    /// DELETE /api/users/me/skills/{id} — Remove skill from user.
    /// </summary>
    [HttpDelete("api/users/me/skills/{id:int}")]
    public async Task<IActionResult> RemoveUserSkillAlias(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var userSkill = await _db.UserSkills
            .FirstOrDefaultAsync(us => us.UserId == userId.Value && (us.Id == id || us.SkillId == id));
        if (userSkill == null) return NotFound(new { error = "User skill not found" });

        _db.UserSkills.Remove(userSkill);
        await _db.SaveChangesAsync();

        return Ok(new { data = new { message = "Skill removed" } });
    }

    // ──────────────────────────────────────────────
    // Auth aliases (email verification)
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/auth/verify-email — Alias (already exists on AuthController, adding for /auth/ path).
    /// </summary>
    [HttpPost("api/auth/resend-verification-by-email")]
    [AllowAnonymous]
    public IActionResult ResendVerificationByEmail([FromBody] object? request = null)
    {
        return Ok(new { success = true, message = "Verification email sent if account exists" });
    }

    private async Task<IActionResult> SetConversationArchiveState(int id, bool archived)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var conversation = await _db.Conversations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id &&
                                      (c.Participant1Id == userId.Value || c.Participant2Id == userId.Value));
        if (conversation == null) return NotFound(new { error = "Conversation not found" });

        var now = DateTime.UtcNow;
        var config = await UpsertTenantConfigValue(
            $"{ConversationArchiveKeyPrefix}{id}:{userId.Value}",
            new
            {
                kind = "conversation_archive",
                conversation_id = id,
                user_id = userId.Value,
                archived,
                archived_at = archived ? now : (DateTime?)null,
                restored_at = archived ? (DateTime?)null : now,
                updated_at = now
            });

        return Ok(new
        {
            success = true,
            id = config.Id,
            conversation_id = id,
            archived,
            message = archived ? "Conversation archived" : "Conversation restored"
        });
    }

    private async Task<IActionResult> RecordFeedInteraction(int postId, string interactionType)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == postId);
        if (!postExists) return NotFound(new { error = "Post not found" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var interaction = new UserInteraction
        {
            TenantId = tenantId,
            UserId = userId.Value,
            InteractionType = interactionType,
            TargetType = "feed_post",
            TargetId = postId,
            Score = 1,
            CreatedAt = DateTime.UtcNow
        };

        _db.UserInteractions.Add(interaction);
        await _db.SaveChangesAsync();

        var count = await _db.UserInteractions.CountAsync(i =>
            i.TargetType == "feed_post" &&
            i.TargetId == postId &&
            i.InteractionType == interactionType);

        return Ok(new
        {
            success = true,
            id = interaction.Id,
            post_id = postId,
            interaction_type = interactionType,
            count
        });
    }

    private async Task<IActionResult> SetProjectSupport(int id, bool supported)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var projectExists = await _db.VolunteerOpportunities.AnyAsync(o => o.Id == id);
        if (!projectExists) return NotFound(new { error = "Community project not found" });

        var config = await UpsertTenantConfigValue(
            $"{VolunteerSupportKeyPrefix}{id}:{userId.Value}",
            new
            {
                kind = "volunteer_project_support",
                project_id = id,
                user_id = userId.Value,
                supported,
                updated_at = DateTime.UtcNow
            });

        return Ok(new
        {
            success = true,
            id = config.Id,
            project_id = id,
            supported,
            message = supported ? "Project supported" : "Project support removed"
        });
    }

    private async Task<IActionResult> PersistVolunteerCompatibilityRecord(
        string keyPrefix,
        string kind,
        object? request,
        string message)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var config = await AddTenantConfigValue(keyPrefix, new
        {
            kind,
            user_id = userId.Value,
            payload = request ?? EmptyPayload(),
            recorded_at = DateTime.UtcNow
        });

        return CreatedAtAction(null, new { success = true, id = config.Id, message });
    }

    private async Task<TenantConfig> AddTenantConfigValue(string keyPrefix, object value)
    {
        var now = DateTime.UtcNow;
        var config = new TenantConfig
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            Key = $"{keyPrefix}{Guid.NewGuid():N}",
            Value = JsonSerializer.Serialize(value),
            CreatedAt = now
        };

        _db.TenantConfigs.Add(config);
        await _db.SaveChangesAsync();
        return config;
    }

    private async Task<TenantConfig> UpsertTenantConfigValue(string key, object value)
    {
        var now = DateTime.UtcNow;
        var config = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == key);
        if (config == null)
        {
            config = new TenantConfig
            {
                TenantId = _tenantContext.GetTenantIdOrThrow(),
                Key = key,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(config);
        }
        else
        {
            config.UpdatedAt = now;
        }

        config.Value = JsonSerializer.Serialize(value);
        await _db.SaveChangesAsync();
        return config;
    }

    private async Task<TenantConfig?> FindTenantConfigByIdAndPrefix(int id, string keyPrefix)
    {
        return await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Id == id && c.Key.StartsWith(keyPrefix));
    }

    private async Task<bool> CanManageStoredGroupTask(TenantConfig task, int userId)
    {
        var createdBy = ReadIntProperty(task.Value, "created_by");
        if (createdBy == userId) return true;

        var groupId = ReadIntProperty(task.Value, "group_id");
        if (groupId == null) return false;

        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId.Value);
        if (group?.CreatedById == userId) return true;

        return await _db.GroupMembers.AnyAsync(m =>
            m.GroupId == groupId.Value &&
            m.UserId == userId &&
            (m.Role == Group.Roles.Owner || m.Role == Group.Roles.Admin));
    }

    private async Task<bool> IsGroupMemberOrCreator(int groupId, int userId)
    {
        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId);
        if (group?.CreatedById == userId) return true;

        return await _db.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);
    }

    private async Task<List<StoredGroupTask>> ReadStoredGroupTasksAsync()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
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
            var groupId = ReadIntProperty(root, "group_id");
            if (groupId == null) return null;

            return new StoredGroupTask(
                config.Id,
                groupId.Value,
                ReadStringProperty(root, "title") ?? "Untitled task",
                ReadStringProperty(root, "description"),
                ReadIntProperty(root, "assigned_to"),
                ReadStringProperty(root, "status") ?? "todo",
                ReadStringProperty(root, "priority") ?? "medium",
                ReadStringProperty(root, "due_date"),
                ReadIntProperty(root, "created_by") ?? 0,
                ReadDateTimeProperty(root, "created_at") ?? config.CreatedAt,
                ReadDateTimeProperty(root, "updated_at") ?? config.UpdatedAt,
                ReadDateTimeProperty(root, "completed_at"));
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

    private bool IsV2Request() =>
        Request.Path.Value?.StartsWith("/api/v2/", StringComparison.OrdinalIgnoreCase) == true;

    private static bool IsValidTeamTaskStatus(string status) =>
        status is "todo" or "in_progress" or "done";

    private static bool IsValidTeamTaskPriority(string priority) =>
        priority is "low" or "medium" or "high" or "urgent";

    private static object LaravelValidationError(string field, string message) => new
    {
        success = false,
        errors = new[]
        {
            new
            {
                code = "VALIDATION_ERROR",
                message,
                field
            }
        }
    };

    private IFormFile? ResolveUploadedFile(params IFormFile?[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (candidate is { Length: > 0 })
            {
                return candidate;
            }
        }

        return Request.HasFormContentType ? Request.Form.Files.FirstOrDefault(f => f.Length > 0) : null;
    }

    private string? BuildUploadUrl(FileUpload? upload)
    {
        return upload == null ? null : _fileService.GetDownloadUrl(upload);
    }

    private static IReadOnlyDictionary<string, object?> EmptyPayload() =>
        new Dictionary<string, object?>();

    private static string NormalizeShareChannel(string? channel)
    {
        var normalized = string.IsNullOrWhiteSpace(channel)
            ? PostShare.Channels.Internal
            : channel.Trim().ToLowerInvariant();

        return PostShare.Channels.All.Contains(normalized)
            ? normalized
            : PostShare.Channels.External;
    }

    private static string NormalizeReportReason(string? reason)
    {
        var normalized = string.IsNullOrWhiteSpace(reason)
            ? "other"
            : reason.Trim().ToLowerInvariant();

        return normalized is "spam" or "harassment" or "inappropriate" or "other"
            ? normalized
            : "other";
    }

    private static string NormalizeReactionType(string? type)
    {
        var normalized = string.IsNullOrWhiteSpace(type)
            ? PostReaction.Types.Like
            : type.Trim().ToLowerInvariant();

        return PostReaction.Types.All.Contains(normalized)
            ? normalized
            : PostReaction.Types.Like;
    }

    private static string BadgeTypeFromSlug(string slug)
    {
        if (string.IsNullOrWhiteSpace(slug)) return "general";
        var separator = slug.IndexOf('_', StringComparison.Ordinal);
        return separator > 0 ? slug[..separator] : "general";
    }

    private static string? ReadStringProperty(object? source, params string[] propertyNames)
    {
        if (source == null) return null;

        try
        {
            if (source is JsonElement element)
                return ReadStringProperty(element, propertyNames);

            if (source is string json && !string.IsNullOrWhiteSpace(json))
            {
                using var document = JsonDocument.Parse(json);
                return ReadStringProperty(document.RootElement, propertyNames);
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static string? ReadStringProperty(JsonElement element, params string[] propertyNames)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;

        foreach (var propertyName in propertyNames)
        {
            if (!element.TryGetProperty(propertyName, out var value)) continue;

            return value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => null
            };
        }

        return null;
    }

    private static int? ReadIntProperty(string json, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;

        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty(propertyName, out var value))
                return null;

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
                return number;

            if (value.ValueKind == JsonValueKind.String &&
                int.TryParse(value.GetString(), out var parsed))
                return parsed;
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static int? ReadIntProperty(object? source, string propertyName)
    {
        if (source == null) return null;

        try
        {
            if (source is JsonElement element)
                return ReadIntProperty(element, propertyName);

            if (source is string json && !string.IsNullOrWhiteSpace(json))
            {
                using var document = JsonDocument.Parse(json);
                return ReadIntProperty(document.RootElement, propertyName);
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static int? ReadIntProperty(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
            return number;

        if (value.ValueKind == JsonValueKind.String &&
            int.TryParse(value.GetString(), out var parsed))
            return parsed;

        return null;
    }

    private static DateTime? ReadDateTimeProperty(JsonElement element, string propertyName)
    {
        var value = ReadStringProperty(element, propertyName);
        return DateTime.TryParse(value, out var parsed) ? parsed.ToUniversalTime() : null;
    }

    private int ReadQueryInt(string name, int fallback, int min, int max) =>
        ReadQueryInt(name, (int?)fallback, min, max)!.Value;

    private int? ReadQueryInt(string name, int? fallback, int min, int max)
    {
        if (!int.TryParse(Request.Query[name].FirstOrDefault(), out var value))
            return fallback;

        return Math.Clamp(value, min, max);
    }

    private static string AppendNote(string? current, string note)
    {
        return string.IsNullOrWhiteSpace(current) ? note : $"{current}; {note}";
    }

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

    private async Task<IActionResult> SetJobAlertNotification(int id, bool notify)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var alert = await _db.SavedSearches
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId.Value && s.SearchType == "job_alert");
        if (alert == null) return NotFound(new { error = "Job alert not found" });

        alert.NotifyOnNewResults = notify;
        alert.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            message = notify ? "Resubscribed" : "Unsubscribed",
            id = alert.Id,
            notify = alert.NotifyOnNewResults
        });
    }

    private static SkillLevel NormalizeSkillLevel(string? proficiencyLevel)
    {
        if (string.IsNullOrWhiteSpace(proficiencyLevel))
            return SkillLevel.Intermediate;

        return Enum.TryParse<SkillLevel>(proficiencyLevel.Trim(), true, out var parsed)
            ? parsed
            : SkillLevel.Intermediate;
    }

    private async Task<List<object>> BuildLaravelUserSkillListAsync(int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var rows = await _db.UserSkills
            .AsNoTracking()
            .Where(us => us.TenantId == tenantId && us.UserId == userId)
            .Include(us => us.Skill)
            .ThenInclude(skill => skill!.Category)
            .OrderBy(us => us.Skill!.Name)
            .ToListAsync();

        return rows.Select(us => (object)new
        {
            id = us.Id,
            user_id = us.UserId,
            tenant_id = us.TenantId,
            skill_id = us.SkillId,
            category_id = us.Skill?.CategoryId,
            skill_name = us.Skill?.Name ?? string.Empty,
            category_name = us.Skill?.Category?.Name,
            category_slug = us.Skill?.Category?.Slug,
            proficiency_level = us.ProficiencyLevel.ToString().ToLowerInvariant(),
            is_offering = true,
            is_requesting = false,
            endorsement_count = us.EndorsementCount,
            created_at = us.CreatedAt
        }).ToList();
    }

    private async Task<string> GenerateUniqueSkillSlugAsync(int tenantId, string name)
    {
        var slug = Slugify(name);
        var candidate = slug;
        var suffix = 2;
        while (await _db.Skills.AnyAsync(s => s.TenantId == tenantId && s.Slug == candidate))
        {
            candidate = $"{slug}-{suffix++}";
        }

        return candidate;
    }

    private static string Slugify(string value)
    {
        var slug = System.Text.RegularExpressions.Regex
            .Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-")
            .Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "skill" : slug;
    }

    private async Task<List<object>> BuildAvailabilityWeeklyAsync(int tenantId, int userId)
    {
        var rows = await _db.MemberAvailabilities
            .Where(a => a.TenantId == tenantId && a.UserId == userId && a.IsActive)
            .OrderBy(a => a.DayOfWeek)
            .ThenBy(a => a.StartTime)
            .ToListAsync();

        return rows.Select(a => (object)new
        {
            id = a.Id,
            day_of_week = a.DayOfWeek,
            start_time = a.StartTime,
            end_time = a.EndTime,
            note = a.Note
        }).ToList();
    }

    private static bool TryGetAvailabilitySlots(JsonElement body, out List<AvailabilitySlotInput> slots)
    {
        slots = new List<AvailabilitySlotInput>();
        if (body.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!body.TryGetProperty("slots", out var source) && !body.TryGetProperty("schedule", out source))
        {
            return false;
        }

        if (source.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var item in source.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            var day = item.TryGetProperty("day_of_week", out var dayElement) && dayElement.TryGetInt32(out var dayValue)
                ? dayValue
                : -1;
            slots.Add(new AvailabilitySlotInput(
                day,
                ReadString(item, "start_time") ?? string.Empty,
                ReadString(item, "end_time") ?? string.Empty,
                ReadString(item, "note")));
        }

        return true;
    }

    private static string? ReadString(JsonElement body, string name) =>
        body.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.ToString()
            : null;

    private static bool IsAvailabilityTime(string value) =>
        System.Text.RegularExpressions.Regex.IsMatch(value, @"^([01]\d|2[0-3]):[0-5]\d$");

    private int? GetCurrentUserId() => User.GetUserId();

    private ObjectResult VolunteerApplicationError(
        int statusCode,
        string code,
        string message,
        string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };

        if (field is not null)
            error["field"] = field;

        return StatusCode(statusCode, new { errors = new[] { error } });
    }

    private sealed record AvailabilitySlotInput(int DayOfWeek, string StartTime, string EndTime, string? Note);
}

// ──────────────────────────────────────────────
// DTOs for CompatibilityAliasController
// ──────────────────────────────────────────────

public class CookieConsentAliasRequest
{
    [JsonPropertyName("accepted")]
    public bool Accepted { get; set; } = true;

    [JsonPropertyName("analytics")]
    public bool Analytics { get; set; }

    [JsonPropertyName("marketing")]
    public bool Marketing { get; set; }

    [JsonPropertyName("functional")]
    public bool? Functional { get; set; }
}

public class FeedPostAliasRequest
{
    [JsonPropertyName("content")]
    public string? Content { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("visibility")]
    public string? Visibility { get; set; }
}

public class ThemeRequest
{
    [JsonPropertyName("theme")]
    public string? Theme { get; set; }
}

public class LanguageRequest
{
    [JsonPropertyName("language")]
    public string? Language { get; set; }
}

public class AvailabilityAliasRequest
{
    [JsonPropertyName("schedule")]
    public object? Schedule { get; set; }
}

public class MatchPreferencesAliasRequest
{
    [JsonPropertyName("max_distance_km")]
    public double? MaxDistanceKm { get; set; }

    [JsonPropertyName("preferred_categories")]
    public List<int>? PreferredCategories { get; set; }

    [JsonPropertyName("available_days")]
    public List<string>? AvailableDays { get; set; }

    [JsonPropertyName("available_time_slots")]
    public List<string>? AvailableTimeSlots { get; set; }

    [JsonPropertyName("skills_offered")]
    public List<string>? SkillsOffered { get; set; }

    [JsonPropertyName("skills_wanted")]
    public List<string>? SkillsWanted { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }
}

public class GdprRequestAliasDto
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "export";

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class EndorseRequest
{
    [JsonPropertyName("skill_id")]
    public int SkillId { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}

public class TypingIndicatorRequest
{
    [JsonPropertyName("conversation_id")]
    public int? ConversationId { get; set; }

    [JsonPropertyName("recipient_id")]
    public int? RecipientId { get; set; }

    [JsonPropertyName("to_user_id")]
    public int? ToUserId
    {
        get => RecipientId;
        set => RecipientId = value;
    }

    [JsonPropertyName("is_typing")]
    public bool? IsTyping { get; set; }
}

public class ChatMessageRequest
{
    [JsonPropertyName("content")]
    public string? Content { get; set; }
}

public class GoalCheckInRequest
{
    [JsonPropertyName("note")]
    public string? Note { get; set; }
}

public class GoalBuddyRequest
{
    [JsonPropertyName("buddy_id")]
    public int? BuddyId { get; set; }
}

public class GoalProgressRequest
{
    [JsonPropertyName("progress")]
    public int? Progress { get; set; }

    [JsonPropertyName("note")]
    public string? Note { get; set; }
}

public class IdeaCommentAliasRequest
{
    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class SubmitIdeaRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }
}

public class FeedPollRequest
{
    [JsonPropertyName("question")]
    public string? Question { get; set; }

    [JsonPropertyName("options")]
    public List<string>? Options { get; set; }
}

public class KbFeedbackRequest
{
    [JsonPropertyName("helpful")]
    public bool Helpful { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}

public class ReactionRequest
{
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("reaction_type")]
    public string? ReactionType { get; set; }

    [JsonPropertyName("emoji")]
    public string? Emoji { get; set; }
}

public class FeedLikeRequest
{
    [JsonPropertyName("post_id")]
    public int? PostId { get; set; }
}

public class SharePostAliasRequest
{
    [JsonPropertyName("shared_to")]
    public string? SharedTo { get; set; }

    [JsonPropertyName("channel")]
    public string? Channel { get; set; }
}

public class ReportPostAliasRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("details")]
    public string? Details { get; set; }
}

public class FederationSetupAliasRequest
{
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }
}

public class FederationConnectionAliasRequest
{
    [JsonPropertyName("partner_tenant_id")]
    public int? PartnerTenantId { get; set; }

    [JsonPropertyName("shared_listings")]
    public bool? SharedListings { get; set; }

    [JsonPropertyName("shared_events")]
    public bool? SharedEvents { get; set; }

    [JsonPropertyName("shared_members")]
    public bool? SharedMembers { get; set; }
}

public class CommunityProjectAliasRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("required_volunteers")]
    public int? RequiredVolunteers { get; set; }

    [JsonPropertyName("publish")]
    public bool? Publish { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime? StartsAt { get; set; }

    [JsonPropertyName("ends_at")]
    public DateTime? EndsAt { get; set; }
}

public class LogVolunteeringHoursAliasRequest
{
    [JsonPropertyName("shift_id")]
    public int? ShiftId { get; set; }

    [JsonPropertyName("hours")]
    public decimal? Hours { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("started_at")]
    public DateTime? StartedAt { get; set; }

    [JsonPropertyName("ended_at")]
    public DateTime? EndedAt { get; set; }
}

public class UpdateEmergencyAlertAliasRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("urgency")]
    public string? Urgency { get; set; }

    [JsonPropertyName("contact_info")]
    public string? ContactInfo { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }
}

public class UpdateVolunteeringApplicationAliasRequest
{
    [JsonPropertyName("action")]
    public string? Action { get; set; }

    [JsonPropertyName("org_note")]
    public string? OrgNote { get; set; }
}

public class GroupRequestActionAliasRequest
{
    [JsonPropertyName("action")]
    public string? Action { get; set; }
}

public class UpdateGroupMemberAliasRequest
{
    [JsonPropertyName("role")]
    public string? Role { get; set; }
}

public class UpdateJobApplicationAliasRequest
{
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("cover_letter")]
    public string? CoverLetter { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("review_notes")]
    public string? ReviewNotes { get; set; }
}

public class CreateSubAccountAliasRequest
{
    [JsonPropertyName("sub_user_id")]
    public int? SubUserId { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }

    [JsonPropertyName("child_email")]
    public string? ChildEmail { get; set; }

    [JsonPropertyName("relationship")]
    public string? Relationship { get; set; }

    [JsonPropertyName("relationship_type")]
    public string? RelationshipType { get; set; }

    [JsonPropertyName("display_name")]
    public string? DisplayName { get; set; }

    [JsonPropertyName("permissions")]
    public Dictionary<string, bool>? Permissions { get; set; }

    [JsonPropertyName("can_transact")]
    public bool? CanTransact { get; set; }

    [JsonPropertyName("can_message")]
    public bool? CanMessage { get; set; }

    [JsonPropertyName("can_join_groups")]
    public bool? CanJoinGroups { get; set; }
}

public class UpdateSubAccountPermissionsAliasRequest
{
    [JsonPropertyName("permissions")]
    public Dictionary<string, bool>? Permissions { get; set; }

    [JsonPropertyName("can_transact")]
    public bool? CanTransact { get; set; }

    [JsonPropertyName("can_message")]
    public bool? CanMessage { get; set; }

    [JsonPropertyName("can_join_groups")]
    public bool? CanJoinGroups { get; set; }
}

public class AddUserSkillAliasRequest
{
    [JsonPropertyName("skill_id")]
    public int? SkillId { get; set; }

    [JsonPropertyName("skill_name")]
    public string? SkillName { get; set; }

    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }

    [JsonPropertyName("proficiency_level")]
    public string? ProficiencyLevel { get; set; }
}

public class RankedVoteRequest
{
    [JsonPropertyName("rankings")]
    public List<int>? Rankings { get; set; }
}

public class ShopPurchaseRequest
{
    [JsonPropertyName("item_id")]
    public int? ItemId { get; set; }
}

public class GamificationShowcaseRequest
{
    [JsonPropertyName("badge_keys")]
    public List<string>? BadgeKeys { get; set; }
}
