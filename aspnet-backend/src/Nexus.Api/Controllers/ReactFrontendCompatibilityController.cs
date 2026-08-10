// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using Nexus.Api.Services.Registration;

namespace Nexus.Api.Controllers;

/// <summary>
/// Compatibility endpoints for the copied React frontend.
/// These routes keep existing visible pages working while the frontend is
/// moved onto canonical ASP.NET API contracts.
/// </summary>
[ApiController]
public class ReactFrontendCompatibilityController : ControllerBase
{
    private const int DailyRewardBaseXp = 5;

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ProviderConfigEncryption _encryption;
    private readonly VolunteerOrganisationService _volunteerOrganisations;

    public ReactFrontendCompatibilityController(
        NexusDbContext db,
        TenantContext tenantContext,
        ProviderConfigEncryption encryption,
        VolunteerOrganisationService volunteerOrganisations)
    {
        _db = db;
        _tenantContext = tenantContext;
        _encryption = encryption;
        _volunteerOrganisations = volunteerOrganisations;
    }

    private static int DailyRewardMilestoneBonus(int streakDay) => streakDay switch
    {
        3 => 5,
        7 => 15,
        14 => 25,
        30 => 50,
        60 => 100,
        90 => 150,
        _ => 0
    };

    [HttpGet("api/health/ready")]
    [AllowAnonymous]
    public async Task<IActionResult> ApiReady()
    {
        var canConnect = await _db.Database.CanConnectAsync();
        return canConnect
            ? Ok(new { status = "healthy", checks = new { database = "healthy" }, timestamp = DateTime.UtcNow })
            : StatusCode(503, new { status = "unhealthy", checks = new { database = "unhealthy" }, timestamp = DateTime.UtcNow });
    }

    [HttpGet("api/categories")]
    [Authorize]
    public async Task<IActionResult> ListCategories()
    {
        var categories = await _db.Categories
            .Where(c => c.IsActive)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                description = c.Description,
                parent_category_id = c.ParentCategoryId,
                sort_order = c.SortOrder
            })
            .ToListAsync();

        return Ok(new { data = categories, categories });
    }

    [HttpGet("api/platform/stats")]
    [AllowAnonymous]
    public async Task<IActionResult> PlatformStats()
    {
        var hoursExchanged = await _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;

        var stats = new
        {
            scope = "tenant",
            members = await _db.Users.CountAsync(u => u.IsActive),
            hours_exchanged = hoursExchanged,
            listings = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Active),
            skills = await _db.Skills.CountAsync(),
            communities = await _db.Groups.CountAsync(),
            exchanges = await _db.Transactions
                .ExcludeInternalWalletAdapters()
                .CountAsync(t => t.Status == TransactionStatus.Completed),
            events = await _db.Set<Event>().CountAsync(e => !e.IsCancelled),
            volunteering_opportunities = await _db.VolunteerOpportunities.CountAsync(o => o.Status == OpportunityStatus.Published)
        };

        return Ok(new { data = stats, stats });
    }

    [HttpGet("api/menus")]
    [AllowAnonymous]
    public IActionResult Menus([FromQuery] string? location = null)
    {
        var menusByLocation = BuildDefaultMenusByLocation();

        if (!string.IsNullOrWhiteSpace(location))
        {
            var menus = menusByLocation.TryGetValue(location, out var locatedMenus)
                ? locatedMenus
                : Array.Empty<object>();

            return Ok(new { data = menus, menus });
        }

        return Ok(new { data = menusByLocation, menus = menusByLocation });
    }

    [HttpGet("api/menus/mobile")]
    [AllowAnonymous]
    public IActionResult MobileMenus()
    {
        var mobileMenus = BuildDefaultMenus("mobile", "Mobile navigation", "default-mobile-nav");
        return Ok(new { data = mobileMenus, menus = mobileMenus });
    }

    [HttpGet("api/metrics")]
    [AllowAnonymous]
    public async Task<IActionResult> Metrics()
    {
        return await PlatformStats();
    }

    [HttpGet("api/metrics/summary")]
    [Authorize]
    public async Task<IActionResult> MetricsSummary()
    {
        return await PlatformStats();
    }

    [HttpGet("api/exchanges/config")]
    [Authorize]
    public IActionResult ExchangeConfig()
    {
        return Ok(new
        {
            data = new
            {
                min_amount = 0.25m,
                max_amount = 24m,
                statuses = Enum.GetNames<TransactionStatus>().Select(s => s.ToLowerInvariant()),
                listing_types = Enum.GetNames<ListingType>().Select(s => s.ToLowerInvariant())
            }
        });
    }

    [HttpGet("api/exchanges/check")]
    [Authorize]
    public async Task<IActionResult> CheckExchange([FromQuery] int? listing_id, [FromQuery] int? listingId)
    {
        var id = listing_id ?? listingId;
        if (!id.HasValue)
            return Ok(new { can_exchange = true, reason = (string?)null });

        var userId = User.GetUserId();
        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id.Value && l.Status == ListingStatus.Active);
        var canExchange = listing != null && (!userId.HasValue || listing.UserId != userId.Value);

        return Ok(new
        {
            can_exchange = canExchange,
            reason = listing == null ? "Listing is unavailable" : canExchange ? null : "You cannot request an exchange with your own listing"
        });
    }

    [HttpGet("api/federation/status")]
    [Authorize]
    public async Task<IActionResult> FederationStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var settings = await GetOrCreateFederationSettingsAsync(userId.Value);
        var partnerCount = await _db.FederationPartners.CountAsync(p => p.Status == PartnerStatus.Active);

        return Ok(new
        {
            data = new
            {
                enabled = settings.FederationOptIn,
                profile_visible = settings.ProfileVisible,
                listings_visible = settings.ListingsVisible,
                transactions_enabled_federated = settings.TransactionsEnabled,
                active_partners = partnerCount
            }
        });
    }

    [HttpGet("api/federation/partners")]
    [Authorize]
    public async Task<IActionResult> FederationPartners()
    {
        var partners = await _db.FederationPartners
            .Include(p => p.PartnerTenant)
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new
            {
                id = p.Id,
                status = p.Status.ToString().ToLowerInvariant(),
                partner_tenant = p.PartnerTenant == null ? null : new
                {
                    id = p.PartnerTenant.Id,
                    name = p.PartnerTenant.Name,
                    slug = p.PartnerTenant.Slug
                },
                shared_listings = p.SharedListings,
                shared_events = p.SharedEvents,
                shared_members = p.SharedMembers,
                credit_exchange_rate = p.CreditExchangeRate,
                created_at = p.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = partners, partners });
    }

    [HttpGet("api/federation/members")]
    [Authorize]
    public async Task<IActionResult> FederationMembers()
    {
        var members = await _db.Users
            .Where(u => u.IsActive)
            .OrderBy(u => u.FirstName)
            .ThenBy(u => u.LastName)
            .Take(50)
            .Select(u => new
            {
                id = u.Id,
                name = (u.FirstName + " " + u.LastName).Trim(),
                first_name = u.FirstName,
                last_name = u.LastName,
                avatar_url = u.AvatarUrl,
                bio = u.Bio,
                level = u.Level,
                total_xp = u.TotalXp
            })
            .ToListAsync();

        return Ok(new { data = members, members });
    }

    [HttpGet("api/federation/events")]
    [Authorize]
    public async Task<IActionResult> FederationEvents()
    {
        var events = await _db.Set<Event>()
            .Where(e => !e.IsCancelled && e.StartsAt >= DateTime.UtcNow.AddDays(-1))
            .OrderBy(e => e.StartsAt)
            .Take(50)
            .Select(e => new
            {
                id = e.Id,
                title = e.Title,
                description = e.Description,
                location = e.Location,
                starts_at = e.StartsAt,
                ends_at = e.EndsAt,
                image_url = e.ImageUrl
            })
            .ToListAsync();

        return Ok(new { data = events, events });
    }

    [HttpGet("api/federation/messages")]
    [Authorize]
    public async Task<IActionResult> FederationMessages()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var messages = await _db.Messages
            .Include(m => m.Sender)
            .Where(m => m.SenderId == userId.Value || m.Conversation!.Participant1Id == userId.Value || m.Conversation!.Participant2Id == userId.Value)
            .OrderByDescending(m => m.CreatedAt)
            .Take(50)
            .Select(m => new
            {
                id = m.Id,
                conversation_id = m.ConversationId,
                sender_id = m.SenderId,
                sender_name = m.Sender == null ? null : (m.Sender.FirstName + " " + m.Sender.LastName).Trim(),
                content = m.Content,
                is_read = m.IsRead,
                created_at = m.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = messages, messages });
    }

    [HttpGet("api/federation/activity")]
    [Authorize]
    public async Task<IActionResult> FederationActivity()
    {
        var activity = await _db.FederationAuditLogs
            .OrderByDescending(a => a.CreatedAt)
            .Take(50)
            .Select(a => new
            {
                id = a.Id,
                action = a.Action,
                entity_type = a.EntityType,
                entity_id = a.EntityId,
                created_at = a.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = activity, activity });
    }

    [HttpPost("api/federation/opt-in")]
    [Authorize]
    public async Task<IActionResult> FederationOptIn()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var settings = await GetOrCreateFederationSettingsAsync(userId.Value);
        settings.FederationOptIn = true;
        settings.ProfileVisible = true;
        settings.ListingsVisible = true;
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, enabled = true });
    }

    [HttpPost("api/federation/opt-out")]
    [Authorize]
    public async Task<IActionResult> FederationOptOut()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var settings = await GetOrCreateFederationSettingsAsync(userId.Value);
        settings.FederationOptIn = false;
        settings.ProfileVisible = false;
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, enabled = false });
    }

    [HttpGet("api/feed/sidebar")]
    [Authorize]
    public async Task<IActionResult> FeedSidebar()
    {
        var now = DateTime.UtcNow;
        var data = new
        {
            stats = new
            {
                posts = await _db.FeedPosts.CountAsync(p => !p.IsHidden),
                comments = await _db.PostComments.CountAsync(),
                events = await _db.Set<Event>().CountAsync(e => !e.IsCancelled && e.StartsAt >= now)
            },
            pinned_posts = await _db.FeedPosts
                .Where(p => p.IsPinned && !p.IsHidden)
                .OrderByDescending(p => p.CreatedAt)
                .Take(5)
                .Select(p => new { id = p.Id, content = p.Content, created_at = p.CreatedAt })
                .ToListAsync()
        };

        return Ok(new { data });
    }

    [HttpPost("api/gamification/daily-reward")]
    [Authorize]
    public async Task<IActionResult> ClaimDailyReward()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var today = DateTime.UtcNow.Date;
        var alreadyClaimed = await _db.DailyRewards
            .AnyAsync(r => r.UserId == userId.Value && r.ClaimedAt >= today);

        if (alreadyClaimed)
        {
            return StatusCode(StatusCodes.Status409Conflict, new
            {
                errors = new[] { new { code = "RESOURCE_CONFLICT", message = "Daily reward already claimed" } },
                meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
            });
        }

        var previous = await _db.DailyRewards
            .Where(r => r.UserId == userId.Value)
            .OrderByDescending(r => r.ClaimedAt)
            .FirstOrDefaultAsync();

        var streakDay = previous != null && previous.ClaimedAt.Date == today.AddDays(-1)
            ? previous.Day + 1
            : 1;
        var milestoneBonus = DailyRewardMilestoneBonus(streakDay);
        var xp = DailyRewardBaseXp + milestoneBonus;

        _db.DailyRewards.Add(new DailyReward
        {
            TenantId = tenantId,
            UserId = userId.Value,
            Day = streakDay,
            XpAwarded = xp,
            ClaimedAt = DateTime.UtcNow
        });

        var user = await _db.Users.FindAsync(userId.Value);
        if (user != null)
        {
            user.TotalXp += xp;
            user.Level = Nexus.Api.Entities.User.CalculateLevelFromXp(user.TotalXp);
            user.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = new
            {
                claimed = true,
                reward = new
                {
                    xp_earned = xp,
                    base_xp = DailyRewardBaseXp,
                    milestone_bonus = milestoneBonus,
                    streak_day = streakDay,
                    longest_streak = streakDay
                }
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpGet("api/gamification/daily-reward")]
    [Authorize]
    public async Task<IActionResult> DailyRewardStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var today = DateTime.UtcNow.Date;
        var latest = await _db.DailyRewards
            .AsNoTracking()
            .Where(r => r.UserId == userId.Value)
            .OrderByDescending(r => r.ClaimedAt)
            .FirstOrDefaultAsync();

        var claimedToday = latest?.ClaimedAt.Date == today;
        var currentStreak = latest == null
            ? 0
            : latest.ClaimedAt.Date == today || latest.ClaimedAt.Date == today.AddDays(-1)
                ? latest.Day
                : 0;
        var rewardDay = claimedToday ? latest?.Day ?? 1 : currentStreak + 1;
        var rewardXp = claimedToday
            ? latest?.XpAwarded ?? DailyRewardBaseXp
            : DailyRewardBaseXp + DailyRewardMilestoneBonus(Math.Max(1, rewardDay));
        var nextRewardXp = DailyRewardBaseXp + DailyRewardMilestoneBonus(Math.Max(1, rewardDay + 1));
        var user = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId.Value)
            .Select(u => new { u.TotalXp })
            .FirstOrDefaultAsync();

        return Ok(new
        {
            data = new
            {
                claimed_today = claimedToday,
                claimed_at = latest?.ClaimedAt,
                xp_earned_today = claimedToday ? latest?.XpAwarded ?? 0 : 0,
                current_streak = currentStreak,
                longest_streak = currentStreak,
                total_xp = user?.TotalXp ?? 0,
                can_claim = !claimedToday,
                reward_xp = rewardXp,
                next_reward_xp = nextRewardXp,
                next_claim_at = claimedToday ? today.AddDays(1) : (DateTime?)null
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpGet("api/gamification/shop")]
    [Authorize]
    public async Task<IActionResult> GamificationShop()
    {
        var items = await _db.ShopItems
            .Where(i => i.IsActive)
            .OrderBy(i => i.XpCost)
            .Select(i => new
            {
                id = i.Id,
                name = i.Name,
                description = i.Description,
                cost = i.XpCost,
                xp_cost = i.XpCost,
                category = i.Type,
                type = i.Type,
                image_url = i.ImageUrl
            })
            .ToListAsync();

        return Ok(new { data = items, items });
    }

    [HttpGet("api/messages/restriction-status")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MessagesRestrictionStatusPolicy)]
    public async Task<IActionResult> MessageRestrictionStatus(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        if (!userId.HasValue)
        {
            return Unauthorized(new
            {
                errors = new[] { new { code = "AUTH_REQUIRED", message = "Authentication required" } }
            });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var restriction = await _db.UserMonitoringRestrictions
            .SingleOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.UserId == userId.Value,
                cancellationToken);

        var underMonitoring = restriction?.UnderMonitoring == true;
        var messagingDisabled = restriction?.MessagingDisabled == true;
        if (restriction is not null
            && underMonitoring
            && restriction.MonitoringExpiresAt.HasValue
            && restriction.MonitoringExpiresAt.Value <= DateTime.UtcNow)
        {
            // Laravel clears both controls when an active monitoring period
            // expires. Persist the transition so send-time and status reads
            // cannot disagree after this response.
            restriction.UnderMonitoring = false;
            restriction.MessagingDisabled = false;
            restriction.MonitoringExpiresAt = null;
            restriction.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
            underMonitoring = false;
            messagingDisabled = false;
        }

        return Ok(new
        {
            data = new
            {
                messaging_disabled = messagingDisabled,
                under_monitoring = underMonitoring,
                restriction_reason = restriction?.Reason
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpGet("api/messages/voice")]
    [Authorize]
    public async Task<IActionResult> VoiceMessages([FromQuery] int? conversation_id, [FromQuery] int? conversationId)
    {
        var id = conversation_id ?? conversationId;
        var query = _db.VoiceMessages.Include(v => v.Sender).AsQueryable();
        if (id.HasValue)
            query = query.Where(v => v.ConversationId == id.Value);

        var messages = await query
            .OrderByDescending(v => v.CreatedAt)
            .Take(50)
            .Select(v => new
            {
                id = v.Id,
                conversation_id = v.ConversationId,
                sender_id = v.SenderId,
                sender_name = v.Sender == null ? null : (v.Sender.FirstName + " " + v.Sender.LastName).Trim(),
                audio_url = v.AudioUrl,
                duration_seconds = v.DurationSeconds,
                file_size_bytes = v.FileSizeBytes,
                format = v.Format,
                transcription = v.Transcription,
                is_read = v.IsRead,
                created_at = v.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = messages, messages });
    }

    [HttpGet("api/volunteering/applications")]
    [Authorize]
    public async Task<IActionResult> MyVolunteerApplications()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var applications = await _db.VolunteerApplications
            .Include(a => a.Opportunity)
            .Where(a => a.UserId == userId.Value)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new
            {
                id = a.Id,
                status = a.Status.ToString().ToLowerInvariant(),
                message = a.Message,
                created_at = a.CreatedAt,
                opportunity = a.Opportunity == null ? null : new
                {
                    id = a.Opportunity.Id,
                    title = a.Opportunity.Title,
                    starts_at = a.Opportunity.StartsAt,
                    location = a.Opportunity.Location
                }
            })
            .ToListAsync();

        return Ok(new { data = applications, applications });
    }

    [HttpGet("api/volunteering/my-organisations")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOrganisationListPolicy)]
    public async Task<IActionResult> MyVolunteerOrganisations(
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString();
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[]
                {
                    new
                    {
                        code = "FEATURE_DISABLED",
                        message = "Volunteering module is not enabled for this community"
                    }
                }
            });
        }

        var limit = int.TryParse(Request.Query["per_page"].FirstOrDefault(), out var requestedLimit)
            ? Math.Clamp(requestedLimit, 1, 50)
            : 20;
        var cursor = DecodeVolunteerOrganisationCursor(
            Request.Query["cursor"].FirstOrDefault());
        var organisations = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(org => org.TenantId == tenantId
                && (org.OwnerUserId == userId.Value
                    || org.Members.Any(member => member.TenantId == tenantId
                        && member.OrgType == "volunteer"
                        && member.UserId == userId.Value
                        && member.Status == "active")))
            .Where(org => !cursor.HasValue || org.Id < cursor.Value)
            .OrderByDescending(org => org.Id)
            .Select(org => new
            {
                id = org.Id,
                name = org.Name,
                description = org.Description,
                status = org.Status,
                member_role = org.OwnerUserId == userId.Value
                    ? "owner"
                    : org.Members
                        .Where(member => member.TenantId == tenantId
                            && member.OrgType == "volunteer"
                            && member.UserId == userId.Value
                            && member.Status == "active")
                        .Select(member => member.Role)
                        .FirstOrDefault() ?? "member",
                logo_url = org.LogoUrl,
                contact_email = org.ContactEmail,
                website = org.Website,
                created_at = org.CreatedAt
            })
            .Take(limit + 1)
            .ToListAsync(cancellationToken);
        var hasMore = organisations.Count > limit;
        if (hasMore)
        {
            organisations.RemoveAt(organisations.Count - 1);
        }
        var nextCursor = hasMore && organisations.Count > 0
            ? Convert.ToBase64String(Encoding.UTF8.GetBytes(organisations[^1].id.ToString()))
            : null;

        return Ok(new
        {
            data = organisations,
            meta = new
            {
                base_url = await VolunteerOrganisationBaseUrlAsync(tenantId, cancellationToken),
                per_page = limit,
                has_more = hasMore,
                cursor = nextCursor
            }
        });
    }

    [HttpGet("api/volunteering/recommended-shifts")]
    [Authorize]
    public async Task<IActionResult> RecommendedShifts()
    {
        var shifts = await _db.VolunteerShifts
            .Include(s => s.Opportunity)
            .Where(s => s.Status == ShiftStatus.Scheduled && s.StartsAt >= DateTime.UtcNow)
            .OrderBy(s => s.StartsAt)
            .Take(20)
            .Select(s => new
            {
                id = s.Id,
                title = s.Title,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                location = s.Location,
                max_volunteers = s.MaxVolunteers,
                opportunity = s.Opportunity == null ? null : new { id = s.Opportunity.Id, title = s.Opportunity.Title }
            })
            .ToListAsync();

        return Ok(new { data = shifts, shifts });
    }

    [HttpGet("api/wallet/categories")]
    [Authorize]
    public async Task<IActionResult> WalletCategories()
    {
        var categories = await _db.TransactionCategories
            .OrderBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                description = c.Description,
                color = c.Color,
                icon = c.Icon,
                is_default = c.IsDefault
            })
            .ToListAsync();

        return Ok(new { data = categories, categories });
    }

    [HttpGet("api/wallet/user-search")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.PersonalWalletUserSearchPolicy)]
    public async Task<IActionResult> WalletUserSearch(
        [FromQuery] string? q = null,
        [FromQuery] string? search = null,
        [FromQuery] int limit = 10)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var term = (q ?? search ?? string.Empty).Trim().ToLowerInvariant();
        if (term.Length < 1)
            return Ok(new { data = Array.Empty<object>(), users = Array.Empty<object>() });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        limit = Math.Clamp(limit, 1, 20);
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId
                && u.Id != currentUserId.Value
                && u.IsActive
                && u.SuspendedAt == null
                && (u.FirstName.ToLower().Contains(term)
                    || u.LastName.ToLower().Contains(term)
                    || (u.FirstName + " " + u.LastName).ToLower().Contains(term)))
            .OrderBy(u => u.FirstName)
            .ThenBy(u => u.LastName)
            .Take(limit)
            .Select(u => new
            {
                id = u.Id,
                username = (string?)null,
                name = (u.FirstName + " " + u.LastName).Trim(),
                first_name = u.FirstName,
                last_name = u.LastName,
                avatar = u.AvatarUrl,
                avatar_url = u.AvatarUrl
            })
            .ToListAsync();

        return Ok(new { data = users, users });
    }

    [HttpGet("api/ideation-campaigns")]
    [Authorize]
    public async Task<IActionResult> IdeationCampaigns()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var campaigns = await LoadIdeationCampaignsAsync(tenantId);
        var status = Request.Query["status"].ToString();
        if (!string.IsNullOrWhiteSpace(status))
        {
            campaigns = campaigns
                .Where(c => string.Equals(c.Status, status, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        var data = campaigns
            .OrderByDescending(c => c.CreatedAt)
            .ThenByDescending(c => c.Id)
            .Select(c => ProjectIdeationCampaign(c, includeChallenges: false))
            .ToList();

        return Ok(new
        {
            success = true,
            data,
            campaigns = data,
            meta = new
            {
                current_page = 1,
                per_page = data.Count,
                total = data.Count,
                has_more = false,
                next_cursor = (string?)null
            }
        });
    }

    [HttpPost("api/ideation-campaigns")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> CreateIdeationCampaign([FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var title = ReadString(body, "title")?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            return BadRequest(new { success = false, errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "Title is required.", "title") } });
        }

        var now = DateTime.UtcNow;
        var campaign = new IdeationCampaignMetadata
        {
            Id = await NextIdeationCampaignIdAsync(tenantId),
            Title = title,
            Description = NormalizeNullable(ReadString(body, "description")),
            CoverImage = NormalizeNullable(ReadString(body, "cover_image")),
            Status = NormalizeIdeationCampaignStatus(ReadString(body, "status")),
            StartDate = ReadDateTime(body, "start_date"),
            EndDate = ReadDateTime(body, "end_date"),
            CreatedBy = User.GetUserId(),
            CreatedAt = now,
            UpdatedAt = now
        };

        await UpsertIdeationCampaignAsync(tenantId, campaign);
        await _db.SaveChangesAsync();

        var data = ProjectIdeationCampaign(campaign, includeChallenges: true);
        return Created($"/api/v2/ideation-campaigns/{campaign.Id}", new { success = true, data });
    }

    [HttpGet("api/ideation-tags/popular")]
    [Authorize]
    public IActionResult PopularIdeationTags()
    {
        var data = IdeationBootstrapCompatibility.PopularTags;
        return Ok(new { success = true, data });
    }

    [HttpGet("api/ideation-templates")]
    [Authorize]
    public IActionResult IdeationTemplates()
    {
        var data = IdeationBootstrapCompatibility.Templates
            .OrderBy(template => template.Title)
            .ToArray();

        return Ok(new { success = true, data });
    }

    [HttpGet("api/ideation-outcomes/dashboard")]
    [HttpGet("api/v2/ideation-outcomes/dashboard")]
    [Authorize]
    public async Task<IActionResult> IdeationOutcomesDashboard()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var prefix = "ideation.challenge.outcome.";
        var outcomeConfigs = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .ToListAsync();

        var outcomes = new List<IdeationDashboardOutcomeRow>();
        foreach (var config in outcomeConfigs)
        {
            IdeationChallengeOutcomeMetadata? outcome;
            try
            {
                outcome = JsonSerializer.Deserialize<IdeationChallengeOutcomeMetadata>(config.Value);
            }
            catch (JsonException)
            {
                continue;
            }

            if (outcome == null)
            {
                continue;
            }

            var challenge = await _db.Challenges
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == outcome.ChallengeId && c.TenantId == tenantId);
            if (challenge == null)
            {
                continue;
            }

            string? winningIdeaTitle = null;
            if (outcome.WinningIdeaId.HasValue)
            {
                winningIdeaTitle = await _db.Ideas
                    .AsNoTracking()
                    .Where(i => i.Id == outcome.WinningIdeaId.Value && i.TenantId == tenantId)
                    .Select(i => i.Title)
                    .FirstOrDefaultAsync();
            }

            var implementationStatus = outcome.ImplementationStatus ?? outcome.Status ?? "not_started";
            outcomes.Add(new IdeationDashboardOutcomeRow(
                challenge.Id,
                challenge.Title,
                winningIdeaTitle,
                implementationStatus,
                outcome.ImpactDescription,
                outcome.UpdatedAt));
        }

        var stats = new
        {
            total = outcomes.Count,
            implemented = outcomes.Count(o => o.ImplementationStatus == "implemented"),
            in_progress = outcomes.Count(o => o.ImplementationStatus == "in_progress"),
            not_started = outcomes.Count(o => o.ImplementationStatus == "not_started"),
            abandoned = outcomes.Count(o => o.ImplementationStatus == "abandoned")
        };

        var rows = outcomes.Select(o => new
        {
            challenge_id = o.ChallengeId,
            challenge_title = o.ChallengeTitle,
            winning_idea_title = o.WinningIdeaTitle,
            implementation_status = o.ImplementationStatus,
            status = o.ImplementationStatus,
            impact_description = o.ImpactDescription,
            updated_at = o.UpdatedAt
        }).ToArray();

        var data = new
        {
            stats.total,
            stats.implemented,
            stats.in_progress,
            stats.not_started,
            stats.abandoned,
            outcomes = rows,
            stats
        };

        return Ok(new { success = true, data });
    }

    [HttpGet("api/goals/discover")]
    [Authorize]
    public IActionResult DiscoverGoals()
    {
        var goals = new[]
        {
            new { id = "first-exchange", title = "Complete your first exchange", goal_type = "count", target_value = 1 },
            new { id = "five-hours", title = "Exchange five hours", goal_type = "hours", target_value = 5 }
        };
        return Ok(new { data = goals, goals });
    }

    [HttpGet("api/goals/templates")]
    [Authorize]
    public IActionResult GoalTemplates()
    {
        var templates = new[]
        {
            new { id = "hours-monthly", title = "Monthly hours goal", category = "timebanking", goal_type = "hours" },
            new { id = "community-helper", title = "Community helper", category = "volunteering", goal_type = "count" }
        };
        return Ok(new { data = templates, templates });
    }

    [HttpGet("api/goals/templates/categories")]
    [Authorize]
    public IActionResult GoalTemplateCategories()
    {
        var categories = new[] { "timebanking", "volunteering", "learning", "community" };
        return Ok(new { data = categories, categories });
    }

    [HttpGet("api/goals/mentoring")]
    [Authorize]
    public IActionResult GoalMentoring()
    {
        return Ok(new { data = Array.Empty<object>(), mentors = Array.Empty<object>() });
    }

    [HttpGet("api/help/faqs")]
    [AllowAnonymous]
    public async Task<IActionResult> HelpFaqs()
    {
        var faqs = await _db.Faqs
            .Where(f => f.IsPublished)
            .OrderBy(f => f.Category)
            .ThenBy(f => f.SortOrder)
            .Select(f => new
            {
                id = f.Id,
                category = f.Category,
                question = f.Question,
                answer = f.Answer
            })
            .ToListAsync();

        return Ok(new { data = faqs, faqs });
    }

    [HttpGet("api/kb/search")]
    [Authorize]
    public async Task<IActionResult> SearchKnowledgeBase([FromQuery] string? q = null)
    {
        var term = (q ?? string.Empty).Trim().ToLowerInvariant();
        var articles = await _db.KnowledgeArticles
            .Where(a => a.IsPublished && (term == string.Empty ||
                a.Title.ToLower().Contains(term) ||
                (a.Content != null && a.Content.ToLower().Contains(term))))
            .OrderBy(a => a.Title)
            .Take(20)
            .Select(a => new { id = a.Id, title = a.Title, slug = a.Slug, excerpt = a.Content.Length > 240 ? a.Content.Substring(0, 240) : a.Content })
            .ToListAsync();

        return Ok(new { data = articles, articles });
    }

    [HttpGet("api/polls/categories")]
    [Authorize]
    public IActionResult PollCategories()
    {
        var categories = new[] { "community", "events", "governance", "feedback" };
        return Ok(new { data = categories, categories });
    }

    [HttpGet("api/admin/config/registration-policy")]
    [HttpGet("api/v2/admin/config/registration-policy")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminRegistrationPolicyAlias()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var policy = await _db.TenantRegistrationPolicies
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.IsActive);
        return Ok(new { success = true, data = RegistrationPolicySettingsPayload(policy) });
    }

    [HttpPut("api/admin/config/registration-policy")]
    [HttpPut("api/v2/admin/config/registration-policy")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminUpdateRegistrationPolicyAlias(
        [FromBody] ReactRegistrationPolicyRequest request)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var policy = await _db.TenantRegistrationPolicies
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.IsActive);

        if (policy == null)
        {
            policy = new TenantRegistrationPolicy
            {
                TenantId = tenantId,
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            };
            _db.TenantRegistrationPolicies.Add(policy);
        }

        if (!string.IsNullOrWhiteSpace(request.RegistrationMode))
            policy.Mode = FromRegistrationModeKey(request.RegistrationMode);
        if (request.VerificationProvider != null)
            policy.Provider = FromVerificationProviderSlug(request.VerificationProvider);
        if (!string.IsNullOrWhiteSpace(request.VerificationLevel))
            policy.VerificationLevel = FromVerificationLevelKey(request.VerificationLevel);
        if (!string.IsNullOrWhiteSpace(request.PostVerification))
            policy.PostVerificationAction = FromPostVerificationKey(request.PostVerification);
        if (!string.IsNullOrWhiteSpace(request.FallbackMode))
            policy.FallbackMode = NormalizeFallbackMode(request.FallbackMode);
        if (request.RequireEmailVerify.HasValue)
            policy.RequireEmailVerify = request.RequireEmailVerify.Value;

        policy.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = RegistrationPolicySettingsPayload(policy)
        });
    }

    private static object RegistrationPolicySettingsPayload(TenantRegistrationPolicy? policy)
    {
        if (policy == null)
        {
            return new
            {
                registration_mode = "open",
                verification_provider = (string?)null,
                verification_level = "none",
                post_verification = "activate",
                fallback_mode = "none",
                require_email_verify = false,
                has_policy = false,
                is_closed = false
            };
        }

        return new
        {
            id = policy.Id,
            registration_mode = ToRegistrationModeKey(policy.Mode),
            verification_provider = ToVerificationProviderSlug(policy.Provider),
            verification_level = ToVerificationLevelKey(policy.VerificationLevel),
            post_verification = ToPostVerificationKey(policy.PostVerificationAction),
            fallback_mode = policy.FallbackMode,
            require_email_verify = policy.RequireEmailVerify,
            has_policy = true,
            is_closed = false,
            mode = policy.Mode.ToString(),
            provider = policy.Provider.ToString(),
            post_verification_action = policy.PostVerificationAction.ToString(),
            registration_message = policy.RegistrationMessage,
            invite_code = policy.InviteCode,
            max_invite_uses = policy.MaxInviteUses,
            invite_uses_count = policy.InviteUsesCount,
            updated_at = policy.UpdatedAt
        };
    }

    private static string ToRegistrationModeKey(RegistrationMode mode) => mode switch
    {
        RegistrationMode.Standard => "open",
        RegistrationMode.StandardWithApproval => "open_with_approval",
        RegistrationMode.VerifiedIdentity => "verified_identity",
        RegistrationMode.GovernmentId => "government_id",
        RegistrationMode.InviteOnly => "invite_only",
        _ => "open"
    };

    private static RegistrationMode FromRegistrationModeKey(string mode) => mode.Trim().ToLowerInvariant() switch
    {
        "open" => RegistrationMode.Standard,
        "standard" => RegistrationMode.Standard,
        "open_with_approval" => RegistrationMode.StandardWithApproval,
        "standard_with_approval" => RegistrationMode.StandardWithApproval,
        "verified_identity" => RegistrationMode.VerifiedIdentity,
        "government_id" => RegistrationMode.GovernmentId,
        "invite_only" => RegistrationMode.InviteOnly,
        _ => RegistrationMode.Standard
    };

    private static string? ToVerificationProviderSlug(VerificationProvider provider) => provider switch
    {
        VerificationProvider.None => null,
        VerificationProvider.Mock => "mock",
        VerificationProvider.StripeIdentity => "stripe_identity",
        VerificationProvider.UkCertified => "uk_certified",
        VerificationProvider.EudiWallet => "eudi_wallet",
        VerificationProvider.Idenfy => "idenfy",
        _ => provider.ToString().ToLowerInvariant()
    };

    private static VerificationProvider FromVerificationProviderSlug(string? provider)
    {
        if (string.IsNullOrWhiteSpace(provider)) return VerificationProvider.None;

        return provider.Trim().ToLowerInvariant() switch
        {
            "mock" => VerificationProvider.Mock,
            "stripe_identity" => VerificationProvider.StripeIdentity,
            "veriff" => VerificationProvider.Veriff,
            "jumio" => VerificationProvider.Jumio,
            "onfido" => VerificationProvider.Onfido,
            "idenfy" => VerificationProvider.Idenfy,
            "uk_certified" => VerificationProvider.UkCertified,
            "eudi_wallet" => VerificationProvider.EudiWallet,
            "custom" => VerificationProvider.Custom,
            _ => Enum.TryParse<VerificationProvider>(provider, true, out var parsed)
                ? parsed
                : VerificationProvider.None
        };
    }

    private static string ToVerificationLevelKey(VerificationLevel level) => level switch
    {
        VerificationLevel.None => "none",
        VerificationLevel.DocumentOnly => "document_only",
        VerificationLevel.DocumentAndSelfie => "document_selfie",
        VerificationLevel.ReusableDigitalId => "reusable_digital_id",
        VerificationLevel.ManualReviewFallback => "manual_review",
        VerificationLevel.AuthoritativeDataMatch => "document_selfie",
        _ => "none"
    };

    private static VerificationLevel FromVerificationLevelKey(string level) => level.Trim().ToLowerInvariant() switch
    {
        "none" => VerificationLevel.None,
        "document_only" => VerificationLevel.DocumentOnly,
        "document_selfie" => VerificationLevel.DocumentAndSelfie,
        "document_and_selfie" => VerificationLevel.DocumentAndSelfie,
        "reusable_digital_id" => VerificationLevel.ReusableDigitalId,
        "manual_review" => VerificationLevel.ManualReviewFallback,
        _ => VerificationLevel.None
    };

    private static string ToPostVerificationKey(PostVerificationAction action) => action switch
    {
        PostVerificationAction.ActivateAutomatically => "activate",
        PostVerificationAction.SendToAdminForApproval => "admin_approval",
        PostVerificationAction.GrantLimitedAccess => "limited_access",
        PostVerificationAction.RejectOnFailure => "reject_on_fail",
        _ => "activate"
    };

    private static PostVerificationAction FromPostVerificationKey(string action) => action.Trim().ToLowerInvariant() switch
    {
        "activate" => PostVerificationAction.ActivateAutomatically,
        "activate_automatically" => PostVerificationAction.ActivateAutomatically,
        "admin_approval" => PostVerificationAction.SendToAdminForApproval,
        "send_to_admin_for_approval" => PostVerificationAction.SendToAdminForApproval,
        "limited_access" => PostVerificationAction.GrantLimitedAccess,
        "grant_limited_access" => PostVerificationAction.GrantLimitedAccess,
        "reject_on_fail" => PostVerificationAction.RejectOnFailure,
        "reject_on_failure" => PostVerificationAction.RejectOnFailure,
        _ => PostVerificationAction.ActivateAutomatically
    };

    private static string NormalizeFallbackMode(string fallbackMode) => fallbackMode.Trim().ToLowerInvariant() switch
    {
        "admin_review" => "admin_review",
        "native_registration" => "native_registration",
        _ => "none"
    };

    [HttpGet("api/admin/cron")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminCronAlias()
    {
        var jobs = new[]
        {
            new { id = "email-digest", name = "Email digest", status = "configured", schedule = "daily" },
            new { id = "cleanup", name = "Cleanup jobs", status = "configured", schedule = "hourly" }
        };
        return Ok(new { data = jobs, jobs });
    }

    [HttpGet("api/admin/invite-codes")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminInviteCodes()
    {
        var codes = await _db.TenantRegistrationPolicies
            .Where(p => p.InviteCode != null)
            .Select(p => new
            {
                id = p.Id,
                code = p.InviteCode,
                max_uses = p.MaxInviteUses,
                uses_count = p.InviteUsesCount,
                active = p.IsActive
            })
            .ToListAsync();

        return Ok(new { data = codes, codes });
    }

    [HttpGet("api/admin/menu-items")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminMenuItems()
    {
        var pages = await _db.Pages
            .Where(p => p.IsPublished)
            .OrderBy(p => p.Title)
            .Select(p => new { id = p.Id, title = p.Title, path = "/page/" + p.Slug, type = "page" })
            .ToListAsync();

        return Ok(new { data = pages, items = pages });
    }

    [HttpGet("api/admin/moderation/settings")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminModerationSettings()
    {
        return Ok(new
        {
            data = new
            {
                auto_hide_report_threshold = 3,
                require_admin_review = true,
                allow_member_reports = true
            }
        });
    }

    [HttpGet("api/admin/moderation/queue")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminModerationQueue()
    {
        var reports = await _db.ContentReports
            .OrderByDescending(r => r.CreatedAt)
            .Take(50)
            .Select(r => new { id = r.Id, content_type = r.ContentType, content_id = r.ContentId, reason = r.Reason, status = r.Status, created_at = r.CreatedAt })
            .ToListAsync();

        return Ok(new { data = reports, reports });
    }

    [HttpGet("api/admin/moderation/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminModerationStats()
    {
        var data = new
        {
            open_reports = await _db.ContentReports.CountAsync(r => r.Status == ReportStatus.Pending),
            warnings = await _db.UserWarnings.CountAsync(),
            hidden_posts = await _db.FeedPosts.CountAsync(p => p.IsHidden)
        };
        return Ok(new { data });
    }

    [HttpGet("api/admin/reports/hours")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminHoursReport()
    {
        var data = new
        {
            completed_transactions = await _db.Transactions
                .ExcludeInternalWalletAdapters()
                .CountAsync(t => t.Status == TransactionStatus.Completed),
            total_hours = await _db.Transactions
                .ExcludeInternalWalletAdapters()
                .Where(t => t.Status == TransactionStatus.Completed)
                .SumAsync(t => (decimal?)t.Amount) ?? 0m
        };
        return Ok(new { data });
    }

    [HttpGet("api/admin/reports/members")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminMembersReport()
    {
        var data = new
        {
            active = await _db.Users.CountAsync(u => u.IsActive),
            suspended = await _db.Users.CountAsync(u => u.SuspendedAt != null),
            pending = await _db.Users.CountAsync(u => u.RegistrationStatus == RegistrationStatus.PendingAdminReview)
        };
        return Ok(new { data });
    }

    [HttpGet("api/admin/reports/social-value/config")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminSocialValueConfig()
    {
        return Ok(new { data = new { hourly_value = 15.0m, currency = "EUR" } });
    }

    [HttpGet("api/admin/goals")]
    [HttpGet("api/v2/admin/goals")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminGoals(
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 200);

        var query = _db.Goals
            .Include(g => g.User)
            .Include(g => g.Milestones)
            .AsNoTracking()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim().ToLowerInvariant();
            query = query.Where(g =>
                g.Title.ToLower().Contains(normalizedSearch) ||
                (g.Description != null && g.Description.ToLower().Contains(normalizedSearch)) ||
                (g.User != null &&
                    ((g.User.FirstName + " " + g.User.LastName).ToLower().Contains(normalizedSearch) ||
                     g.User.Email.ToLower().Contains(normalizedSearch))));
        }

        var total = await query.CountAsync();
        var goalRows = await query
            .OrderByDescending(g => g.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        var goals = goalRows.Select(MapAdminGoal).ToList();

        return Ok(new
        {
            success = true,
            data = goals,
            goals,
            meta = new
            {
                total,
                current_page = page,
                per_page = limit,
                total_pages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 0
            }
        });
    }

    [HttpGet("api/admin/ideation")]
    [HttpGet("api/v2/admin/ideation")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminIdeation(
        [FromQuery] string? search = null,
        [FromQuery] string? status = "all",
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 200);
        var now = DateTime.UtcNow;
        var normalizedStatus = string.IsNullOrWhiteSpace(status) ? "all" : status.Trim().ToLowerInvariant();

        var query = _db.Challenges
            .Include(c => c.Participants)
            .AsNoTracking()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim().ToLowerInvariant();
            query = query.Where(c =>
                c.Title.ToLower().Contains(normalizedSearch) ||
                (c.Description != null && c.Description.ToLower().Contains(normalizedSearch)));
        }

        query = normalizedStatus switch
        {
            "open" => query.Where(c => c.IsActive && c.StartsAt <= now && c.EndsAt >= now),
            "draft" => query.Where(c => !c.IsActive && c.StartsAt > now),
            "closed" or "archived" => query.Where(c => !c.IsActive || c.EndsAt < now),
            _ => query
        };

        var total = await query.CountAsync();
        var challengeRows = await query
            .OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        var challenges = challengeRows.Select(MapAdminIdeationChallenge).ToList();

        return Ok(new
        {
            success = true,
            data = challenges,
            ideation = challenges,
            meta = new
            {
                total,
                current_page = page,
                per_page = limit,
                total_pages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 0
            }
        });
    }

    [HttpGet("api/admin/polls")]
    [HttpGet("api/v2/admin/polls")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminPolls(
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 200);

        var query = _db.Polls
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .Include(p => p.CreatedBy)
            .AsNoTracking()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim().ToLowerInvariant();
            query = query.Where(p =>
                p.Title.ToLower().Contains(normalizedSearch) ||
                (p.Description != null && p.Description.ToLower().Contains(normalizedSearch)));
        }

        var total = await query.CountAsync();
        var pollRows = await query
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        var polls = pollRows.Select(MapAdminPoll).ToList();

        return Ok(new
        {
            success = true,
            data = polls,
            polls,
            meta = new
            {
                total,
                current_page = page,
                per_page = limit,
                last_page = (int)Math.Ceiling(total / (double)limit)
            }
        });
    }

    [HttpGet("api/admin/resources")]
    [HttpGet("api/v2/admin/resources")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminResources(
        [FromQuery] string? search = null,
        [FromQuery] string? status = "all",
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 200);
        var normalizedStatus = string.IsNullOrWhiteSpace(status) ? "all" : status.Trim().ToLowerInvariant();

        var query = _db.KnowledgeArticles
            .Include(a => a.CreatedBy)
            .AsNoTracking()
            .AsQueryable();

        if (normalizedStatus == "published")
        {
            query = query.Where(a => a.IsPublished);
        }
        else if (normalizedStatus == "draft")
        {
            query = query.Where(a => !a.IsPublished);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim().ToLowerInvariant();
            query = query.Where(a =>
                a.Title.ToLower().Contains(normalizedSearch) ||
                a.Content.ToLower().Contains(normalizedSearch));
        }

        var total = await query.CountAsync();
        var articleRows = await query
            .OrderByDescending(a => a.UpdatedAt ?? a.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        var resources = articleRows.Select(MapAdminResourceArticle).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                items = resources,
                meta = new
                {
                    page,
                    per_page = limit,
                    total,
                    total_pages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 0
                }
            },
            resources
        });
    }

    [HttpGet("api/auth/registration-info")]
    [HttpGet("api/v2/auth/registration-info")]
    [AllowAnonymous]
    public async Task<IActionResult> RegistrationInfo()
    {
        var policy = await _db.TenantRegistrationPolicies.FirstOrDefaultAsync(p => p.IsActive);
        var mode = policy?.Mode.ToString() ?? RegistrationMode.Standard.ToString();
        var requiresInvite = policy?.Mode == RegistrationMode.InviteOnly;
        var requiresVerification = policy?.Mode is RegistrationMode.VerifiedIdentity or RegistrationMode.GovernmentId;
        return Ok(new
        {
            data = new
            {
                mode,
                registration_mode = mode,
                provider = policy?.Provider.ToString() ?? VerificationProvider.None.ToString(),
                verification_level = policy?.VerificationLevel.ToString() ?? VerificationLevel.None.ToString(),
                message = policy?.RegistrationMessage,
                invite_required = requiresInvite,
                requires_invite_code = requiresInvite,
                requires_verification = requiresVerification,
                can_register = true,
                is_closed = false,
                is_waitlist = false
            }
        });
    }

    [HttpPost("api/auth/validate-invite")]
    [HttpPost("api/v2/auth/validate-invite")]
    [AllowAnonymous]
    public async Task<IActionResult> ValidateInvite([FromBody] ValidateInviteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { valid = false, error = "code is required" });

        var policy = await _db.TenantRegistrationPolicies.FirstOrDefaultAsync(p => p.InviteCode == request.Code && p.IsActive);
        var valid = policy != null && (!policy.MaxInviteUses.HasValue || policy.InviteUsesCount < policy.MaxInviteUses.Value);
        return Ok(new { valid });
    }

    [HttpPost("api/auth/start-verification")]
    [HttpPost("api/v2/auth/start-verification")]
    [Authorize]
    public async Task<IActionResult> StartVerificationAlias()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var session = new IdentityVerificationSession
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId.Value,
            Provider = VerificationProvider.Custom,
            Status = VerificationSessionStatus.Created,
            Level = VerificationLevel.DocumentOnly,
            ExpiresAt = DateTime.UtcNow.AddHours(1),
            CreatedAt = DateTime.UtcNow
        };
        _db.IdentityVerificationSessions.Add(session);
        await _db.SaveChangesAsync();

        return Ok(new { data = new { id = session.Id, status = session.Status.ToString().ToLowerInvariant() } });
    }

    [HttpGet("api/auth/verification-status")]
    [HttpGet("api/v2/auth/verification-status")]
    [Authorize]
    public async Task<IActionResult> VerificationStatusAlias()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var session = await _db.IdentityVerificationSessions
            .Where(s => s.UserId == userId.Value)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        return Ok(new
        {
            data = new
            {
                status = session?.Status.ToString().ToLowerInvariant() ?? "not_started",
                provider = session?.Provider.ToString(),
                created_at = session?.CreatedAt
            }
        });
    }

    [HttpGet("api/auth/admin-session")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminSession()
    {
        return Ok(new { data = new { active = true, user_id = User.GetUserId(), role = User.GetRole() } });
    }

    [HttpGet("api/config/algorithms")]
    [Authorize]
    public IActionResult AlgorithmConfig()
    {
        return Ok(new
        {
            data = new
            {
                feed_ranking = "recent_with_engagement",
                matching = "skills_location_availability",
                search = "postgres_text",
                moderation = "admin_review"
            }
        });
    }

    [HttpPost("api/connections/request")]
    [Authorize]
    public async Task<IActionResult> ConnectionRequestAlias([FromBody] ConnectionRequestAliasRequest request)
    {
        var requesterId = User.GetUserId();
        if (requesterId == null) return Unauthorized(new { error = "Invalid token" });

        var targetUserId = request.UserId ?? request.TargetUserId;
        if (!targetUserId.HasValue)
            return BadRequest(new { error = "user_id is required" });
        if (targetUserId.Value == requesterId.Value)
            return BadRequest(new { error = "Cannot send connection request to yourself" });

        var targetExists = await _db.Users.AnyAsync(u => u.Id == targetUserId.Value && u.IsActive);
        if (!targetExists)
            return NotFound(new { error = "User not found" });

        var existing = await _db.Connections.FirstOrDefaultAsync(c =>
            (c.RequesterId == requesterId.Value && c.AddresseeId == targetUserId.Value) ||
            (c.RequesterId == targetUserId.Value && c.AddresseeId == requesterId.Value));

        if (existing != null)
        {
            return Ok(new
            {
                success = true,
                connection = new { existing.Id, existing.Status, existing.CreatedAt, existing.UpdatedAt },
                message = existing.Status == Connection.Statuses.Accepted ? "Already connected" : "Connection request already exists"
            });
        }

        var connection = new Connection
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            RequesterId = requesterId.Value,
            AddresseeId = targetUserId.Value,
            Status = Connection.Statuses.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _db.Connections.Add(connection);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            message = "Connection request sent",
            connection = new { connection.Id, connection.Status, connection.CreatedAt }
        });
    }

    [HttpGet("api/gamification/collections")]
    [Authorize]
    public async Task<IActionResult> GamificationCollections()
    {
        var badges = await _db.Badges
            .OrderBy(b => b.SortOrder)
            .ThenBy(b => b.Name)
            .Select(b => new
            {
                id = b.Id,
                name = b.Name,
                description = b.Description,
                category = b.Slug.Contains("_") ? b.Slug.Substring(0, b.Slug.IndexOf("_")) : "general",
                icon = b.Icon
            })
            .ToListAsync();

        var collections = badges
            .GroupBy(b => b.category ?? "general")
            .Select(g => new { slug = g.Key, name = g.Key, badges = g.ToList(), count = g.Count() })
            .ToList();

        return Ok(new { data = collections, collections });
    }

    [HttpGet("api/jobs/my-postings")]
    [Authorize]
    public async Task<IActionResult> MyJobPostings()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var jobs = await _db.JobVacancies
            .Where(j => j.PostedByUserId == userId.Value)
            .OrderByDescending(j => j.CreatedAt)
            .Select(j => new
            {
                id = j.Id,
                title = j.Title,
                description = j.Description,
                status = j.Status,
                application_count = j.ApplicationCount,
                created_at = j.CreatedAt,
                expires_at = j.ExpiresAt
            })
            .ToListAsync();

        return Ok(new { data = jobs, jobs });
    }

    [HttpGet("api/legal/acceptance/status")]
    [Authorize]
    public async Task<IActionResult> LegalAcceptanceStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var requiredIds = await _db.LegalDocuments
            .Where(d => d.IsActive && d.RequiresAcceptance)
            .Select(d => d.Id)
            .ToListAsync();

        var acceptedIds = await _db.LegalDocumentAcceptances
            .Where(a => a.UserId == userId.Value && requiredIds.Contains(a.LegalDocumentId))
            .Select(a => a.LegalDocumentId)
            .ToListAsync();

        return Ok(new
        {
            data = new
            {
                accepted = requiredIds.All(acceptedIds.Contains),
                required_count = requiredIds.Count,
                accepted_count = acceptedIds.Count,
                pending_count = requiredIds.Count - acceptedIds.Count
            }
        });
    }

    [HttpGet("api/legal/versions/compare")]
    [HttpGet("api/v2/legal/versions/compare")]
    [AllowAnonymous]
    public async Task<IActionResult> CompareLegalVersions([FromQuery] string? slug, [FromQuery] string? from, [FromQuery] string? to)
    {
        var query = _db.LegalDocuments.AsQueryable();
        if (!string.IsNullOrWhiteSpace(slug))
            query = query.Where(d => d.Slug == slug);

        var documents = await query
            .OrderByDescending(d => d.CreatedAt)
            .Take(20)
            .Select(d => new { d.Id, d.Title, d.Slug, d.Version, d.Content, d.CreatedAt })
            .ToListAsync();

        return Ok(new
        {
            data = new
            {
                slug,
                from,
                to,
                versions = documents.Select(d => new { d.Id, d.Title, d.Slug, d.Version, d.CreatedAt }),
                comparison_available = documents.Count >= 2
            }
        });
    }

    [HttpGet("api/link-preview")]
    [HttpGet("api/v2/link-preview")]
    [Authorize]
    public IActionResult LinkPreview([FromQuery] string? url)
    {
        var decoded = string.IsNullOrWhiteSpace(url) ? null : Uri.UnescapeDataString(url);
        return BuildLinkPreviewResponse(decoded);
    }

    [HttpPost("api/v2/link-preview")]
    [Authorize]
    public IActionResult FetchLinkPreview([FromBody] JsonElement body)
    {
        return BuildLinkPreviewResponse(ReadString(body, "url"));
    }

    [HttpGet("api/listings/tags/popular")]
    [Authorize]
    public async Task<IActionResult> PopularListingTags()
    {
        var tags = await _db.ListingTags
            .GroupBy(t => t.Tag)
            .OrderByDescending(g => g.Count())
            .Take(25)
            .Select(g => new { tag = g.Key, count = g.Count() })
            .ToListAsync();

        return Ok(new { data = tags, tags });
    }

    [HttpGet("api/listings/tags/autocomplete")]
    [Authorize]
    public async Task<IActionResult> ListingTagsAutocomplete([FromQuery] string? q, [FromQuery] string? query)
    {
        var term = q ?? query ?? string.Empty;
        var tagsQuery = _db.ListingTags.AsQueryable();
        if (!string.IsNullOrWhiteSpace(term))
            tagsQuery = tagsQuery.Where(t => t.Tag.ToLower().Contains(term.ToLower()));

        var tags = await tagsQuery
            .GroupBy(t => t.Tag)
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => new { tag = g.Key, value = g.Key, count = g.Count() })
            .ToListAsync();

        return Ok(new { data = tags, tags });
    }

    [HttpGet("api/me/stats")]
    [Authorize]
    public async Task<IActionResult> MyStats()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        var offersCount = await _db.Listings.CountAsync(l =>
            l.TenantId == tenantId &&
            l.UserId == userId.Value &&
            l.Type == ListingType.Offer &&
            l.Status == ListingStatus.Active);
        var requestsCount = await _db.Listings.CountAsync(l =>
            l.TenantId == tenantId &&
            l.UserId == userId.Value &&
            l.Type == ListingType.Request &&
            l.Status == ListingStatus.Active);
        var completedTransactions = _db.Transactions
            .Where(t => t.TenantId == tenantId && t.Status == TransactionStatus.Completed);
        var rawGivenTotal = await completedTransactions
            .Where(t => t.TenantId == tenantId && t.SenderId == userId.Value && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var rawReceivedTotal = await completedTransactions
            .Where(t => t.TenantId == tenantId && t.ReceiverId == userId.Value && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var visibleTransactions = completedTransactions.ExcludeInternalWalletAdapters();
        var givenTotal = await visibleTransactions
            .Where(t => t.SenderId == userId.Value)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var receivedTotal = await visibleTransactions
            .Where(t => t.ReceiverId == userId.Value)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var walletBalance = Math.Round(rawReceivedTotal - rawGivenTotal, 2);

        var stats = new
        {
            listings_count = offersCount + requestsCount,
            given_count = Math.Round(givenTotal, 1),
            received_count = Math.Round(receivedTotal, 1),
            offers_count = offersCount,
            requests_count = requestsCount,
            wallet_balance = walletBalance,
            listings = offersCount + requestsCount,
            completed_exchanges = await _db.Transactions
                .ExcludeInternalWalletAdapters()
                .CountAsync(t => (t.SenderId == userId.Value || t.ReceiverId == userId.Value)
                    && t.Status == TransactionStatus.Completed),
            connections = await _db.Connections.CountAsync(c => (c.RequesterId == userId.Value || c.AddresseeId == userId.Value) && c.Status == Connection.Statuses.Accepted),
            reviews = await _db.Reviews.CountAsync(r => r.TargetUserId == userId.Value),
            volunteer_hours = await _db.VolunteerCheckIns.Where(c => c.UserId == userId.Value).SumAsync(c => c.HoursLogged) ?? 0m
        };

        return Ok(new { data = stats, stats });
    }

    [HttpGet("api/members/top-endorsed")]
    [Authorize]
    public async Task<IActionResult> TopEndorsedMembers([FromQuery] int limit = 20)
    {
        limit = Math.Clamp(limit, 1, 100);
        var members = await _db.UserSkills
            .Include(us => us.User)
            .Include(us => us.Skill)
            .Where(us => us.EndorsementCount > 0 && us.User != null)
            .OrderByDescending(us => us.EndorsementCount)
            .Take(limit)
            .Select(us => new
            {
                user_id = us.UserId,
                name = us.User == null ? null : (us.User.FirstName + " " + us.User.LastName).Trim(),
                skill = us.Skill == null ? null : us.Skill.Name,
                endorsement_count = us.EndorsementCount
            })
            .ToListAsync();

        return Ok(new { data = members, members });
    }

    [HttpGet("api/reviews")]
    [Authorize]
    public async Task<IActionResult> ReviewsIndex([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Reviews
            .Include(r => r.Reviewer)
            .OrderByDescending(r => r.CreatedAt);

        var total = await query.CountAsync();
        var reviews = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(r => new
            {
                id = r.Id,
                rating = r.Rating,
                comment = r.Comment,
                target_user_id = r.TargetUserId,
                target_listing_id = r.TargetListingId,
                created_at = r.CreatedAt,
                reviewer = r.Reviewer == null ? null : new { id = r.Reviewer.Id, first_name = r.Reviewer.FirstName, last_name = r.Reviewer.LastName }
            })
            .ToListAsync();

        return Ok(new { data = reviews, reviews, pagination = new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) } });
    }

    [HttpGet("api/skills/search")]
    [Authorize]
    public async Task<IActionResult> SearchSkills([FromQuery] string? q, [FromQuery] string? query, [FromQuery] int limit = 20)
    {
        var term = q ?? query ?? string.Empty;
        limit = Math.Clamp(limit, 1, 100);
        var skillsQuery = _db.Skills.AsQueryable();
        if (!string.IsNullOrWhiteSpace(term))
            skillsQuery = skillsQuery.Where(s => s.Name.ToLower().Contains(term.ToLower()) || (s.Description != null && s.Description.ToLower().Contains(term.ToLower())));

        var skills = await skillsQuery
            .OrderBy(s => s.Name)
            .Take(limit)
            .Select(s => new { id = s.Id, name = s.Name, slug = s.Slug, description = s.Description, category_id = s.CategoryId })
            .ToListAsync();

        return Ok(new { data = skills, skills });
    }

    [HttpGet("api/volunteering/emergency-alerts")]
    [Authorize]
    public async Task<IActionResult> VolunteerEmergencyAlerts()
    {
        var alerts = await _db.EmergencyAlerts
            .Where(a => a.IsActive)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new { id = a.Id, title = a.Title, description = a.Description, urgency = a.Urgency, contact_info = a.ContactInfo, created_at = a.CreatedAt })
            .ToListAsync();

        return Ok(new { data = alerts, alerts });
    }

    [HttpGet("api/volunteering/giving-days")]
    [Authorize]
    public async Task<IActionResult> VolunteerGivingDays()
    {
        var opportunities = await _db.VolunteerOpportunities
            .Where(o => o.Status == OpportunityStatus.Published)
            .OrderBy(o => o.StartsAt)
            .Take(25)
            .Select(o => new { id = o.Id, title = o.Title, starts_at = o.StartsAt, ends_at = o.EndsAt, location = o.Location, credit_reward = o.CreditReward })
            .ToListAsync();

        return Ok(new { data = opportunities, giving_days = opportunities });
    }

    [HttpGet("api/volunteering/giving-days/stats")]
    [Authorize]
    public async Task<IActionResult> VolunteerGivingDayStats()
    {
        var data = new
        {
            active_days = await _db.VolunteerOpportunities.CountAsync(o => o.Status == OpportunityStatus.Published),
            shifts = await _db.VolunteerShifts.CountAsync(),
            volunteers = await _db.VolunteerApplications.Select(a => a.UserId).Distinct().CountAsync()
        };

        return Ok(new { data });
    }

    [HttpGet("api/volunteering/hours/pending-review")]
    [Authorize]
    public async Task<IActionResult> VolunteerHoursPendingReview()
    {
        var checkIns = await _db.VolunteerCheckIns
            .Include(c => c.User)
            .Include(c => c.Shift)
            .Where(c => c.HoursLogged != null)
            .OrderByDescending(c => c.CreatedAt)
            .Take(100)
            .Select(c => new
            {
                id = c.Id,
                user_id = c.UserId,
                user_name = c.User == null ? null : (c.User.FirstName + " " + c.User.LastName).Trim(),
                shift_id = c.ShiftId,
                shift_title = c.Shift == null ? null : c.Shift.Title,
                hours_logged = c.HoursLogged,
                checked_in_at = c.CheckedInAt,
                checked_out_at = c.CheckedOutAt
            })
            .ToListAsync();

        return Ok(new { data = checkIns, hours = checkIns });
    }

    [HttpGet("api/volunteering/hours/summary")]
    [Authorize]
    public async Task<IActionResult> VolunteerHoursSummary()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var userHours = await _db.VolunteerCheckIns.Where(c => c.UserId == userId.Value).SumAsync(c => c.HoursLogged) ?? 0m;
        var totalHours = await _db.VolunteerCheckIns.SumAsync(c => c.HoursLogged) ?? 0m;

        return Ok(new { data = new { my_hours = userHours, total_hours = totalHours } });
    }

    [HttpGet("api/volunteering/wellbeing")]
    [Authorize]
    public async Task<IActionResult> VolunteerWellbeing()
    {
        var data = new
        {
            active_opportunities = await _db.VolunteerOpportunities.CountAsync(o => o.Status == OpportunityStatus.Published),
            upcoming_shifts = await _db.VolunteerShifts.CountAsync(s => s.StartsAt >= DateTime.UtcNow && s.Status == ShiftStatus.Scheduled),
            completed_hours = await _db.VolunteerCheckIns.SumAsync(c => c.HoursLogged) ?? 0m
        };

        return Ok(new { data });
    }

    [HttpGet("api/wallet/community-fund")]
    [Authorize]
    public async Task<IActionResult> CommunityFund()
    {
        var donations = await _db.Set<CreditDonation>()
            .Where(d => d.RecipientId == null)
            .OrderByDescending(d => d.CreatedAt)
            .Take(20)
            .Select(d => new { id = d.Id, amount = d.Amount, message = d.IsAnonymous ? null : d.Message, created_at = d.CreatedAt })
            .ToListAsync();

        var total = await _db.Set<CreditDonation>().Where(d => d.RecipientId == null).SumAsync(d => (decimal?)d.Amount) ?? 0m;
        return Ok(new { data = new { balance = total, total_donated = total, recent_donations = donations } });
    }

    [HttpGet("api/admin/federation/available-tenants")]
    [HttpGet("api/v2/admin/federation/available-tenants")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminFederationAvailableTenants()
    {
        var currentTenantId = User.GetTenantId() ?? _tenantContext.TenantId;
        var tenants = await _db.Tenants
            .Where(t => t.IsActive && (!currentTenantId.HasValue || t.Id != currentTenantId.Value))
            .OrderBy(t => t.Name)
            .Select(t => new { id = t.Id, name = t.Name, slug = t.Slug, domain = t.Domain })
            .ToListAsync();

        return Ok(new { success = true, data = tenants, tenants });
    }

    [HttpGet("api/admin/federation/credit-agreements")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminFederationCreditAgreements()
    {
        var agreements = await _db.FederationPartners
            .Include(p => p.PartnerTenant)
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new
            {
                id = p.Id,
                partner_tenant = p.PartnerTenant == null ? null : p.PartnerTenant.Name,
                status = p.Status.ToString().ToLowerInvariant(),
                credit_exchange_rate = p.CreditExchangeRate,
                created_at = p.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = agreements, agreements });
    }

    [HttpGet("api/admin/federation/neighborhoods")]
    [HttpGet("api/v2/admin/federation/neighborhoods")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminFederationNeighborhoods()
    {
        var neighborhoods = await _db.FederationNeighborhoods
            .OrderBy(t => t.Name)
            .ToListAsync();
        var payload = await FormatFederationNeighborhoods(neighborhoods);

        return Ok(new { success = true, data = payload, neighborhoods = payload });
    }

    [HttpPost("api/admin/federation/neighborhoods")]
    [HttpPost("api/v2/admin/federation/neighborhoods")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> CreateAdminFederationNeighborhood([FromBody] JsonElement input)
    {
        var name = TryReadString(input, "name")?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name))
        {
            return BadRequest(new { success = false, error = "Name is required", code = "VALIDATION_ERROR", field = "name" });
        }

        var now = DateTime.UtcNow;
        var neighborhood = new FederationNeighborhood
        {
            Name = name,
            Description = TryReadString(input, "description")?.Trim(),
            Region = TryReadString(input, "region")?.Trim(),
            CreatedBy = User.GetUserId(),
            CreatedAt = now
        };

        if (string.IsNullOrWhiteSpace(neighborhood.Description)) neighborhood.Description = null;
        if (string.IsNullOrWhiteSpace(neighborhood.Region)) neighborhood.Region = null;

        _db.FederationNeighborhoods.Add(neighborhood);
        await _db.SaveChangesAsync();

        var payload = (await FormatFederationNeighborhoods(new[] { neighborhood })).Single();
        return StatusCode(StatusCodes.Status201Created, new { success = true, data = payload });
    }

    [HttpGet("api/admin/identity/audit-log")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminIdentityAuditLog()
    {
        var events = await _db.IdentityVerificationEvents
            .OrderByDescending(e => e.CreatedAt)
            .Take(100)
            .Select(e => new { id = e.Id, session_id = e.SessionId, event_type = e.EventType, message = e.Metadata, created_at = e.CreatedAt })
            .ToListAsync();

        return Ok(new { data = events, events });
    }

    [HttpGet("api/admin/identity/provider-health")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminIdentityProviderHealth()
    {
        var recentFailures = await _db.IdentityVerificationSessions.CountAsync(s => s.Status == VerificationSessionStatus.Failed && s.CreatedAt >= DateTime.UtcNow.AddDays(-7));
        return Ok(new { data = new { status = recentFailures == 0 ? "healthy" : "degraded", recent_failures = recentFailures } });
    }

    [HttpGet("api/admin/identity/providers")]
    [HttpGet("api/v2/admin/identity/providers")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminIdentityProviders()
    {
        var configured = GetConfiguredProviderSlugs();
        var providers = ProviderCredentialOptions();

        var payload = providers
            .Select(p => p with
            {
                available = p.slug == "mock" || configured.Contains(p.slug),
                has_credentials = configured.Contains(p.slug)
            })
            .ToArray();

        return Ok(new { success = true, data = payload, providers = payload });
    }

    private static IdentityProviderOptionDto IdentityProviderOption(string slug, string name, params string[] levels)
    {
        return new IdentityProviderOptionDto(
            id: slug,
            slug: slug,
            name: name,
            levels: levels,
            available: slug == "mock",
            has_credentials: false,
            enabled: true);
    }

    private static IdentityProviderOptionDto[] ProviderCredentialOptions() =>
    [
        IdentityProviderOption("mock", "Mock Provider (Testing)",
            "document_only", "document_selfie", "reusable_digital_id", "manual_review"),
        IdentityProviderOption("stripe_identity", "Stripe Identity",
            "document_only", "document_selfie"),
        IdentityProviderOption("veriff", "Veriff",
            "document_only", "document_selfie", "manual_review"),
        IdentityProviderOption("jumio", "Jumio",
            "document_only", "document_selfie"),
        IdentityProviderOption("onfido", "Onfido",
            "document_only", "document_selfie"),
        IdentityProviderOption("idenfy", "iDenfy",
            "document_only", "document_selfie", "manual_review")
    ];

    private HashSet<string> GetConfiguredProviderSlugs()
    {
        if (_db == null)
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        return _db.TenantProviderCredentials
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.IsActive)
            .Select(c => c.ProviderSlug)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsKnownProviderSlug(string slug)
    {
        var normalized = NormalizeProviderSlug(slug);
        return ProviderCredentialOptions().Any(p => p.slug == normalized && normalized != "mock");
    }

    private static string NormalizeProviderSlug(string slug) => slug.Trim().ToLowerInvariant() switch
    {
        "stripeidentity" => "stripe_identity",
        "stripe_identity" => "stripe_identity",
        "idenfy" => "idenfy",
        "idenfyidentity" => "idenfy",
        _ => slug.Trim().ToLowerInvariant()
    };

    private Dictionary<string, string> DecryptCredentials(string encrypted)
    {
        try
        {
            var plaintext = _encryption.Decrypt(encrypted);
            return JsonSerializer.Deserialize<Dictionary<string, string>>(plaintext)
                ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    [HttpGet("api/admin/identity/sessions")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminIdentitySessions()
    {
        var sessions = await _db.IdentityVerificationSessions
            .OrderByDescending(s => s.CreatedAt)
            .Take(100)
            .Select(s => new { id = s.Id, user_id = s.UserId, provider = s.Provider, status = s.Status, created_at = s.CreatedAt, expires_at = s.ExpiresAt })
            .ToListAsync();

        return Ok(new { data = sessions, sessions });
    }

    [HttpGet("api/admin/members/inactive")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminInactiveMembers()
    {
        var cutoff = DateTime.UtcNow.AddDays(-90);
        var members = await _db.Users
            .Where(u => u.IsActive && (u.LastLoginAt == null || u.LastLoginAt < cutoff))
            .OrderBy(u => u.LastLoginAt ?? u.CreatedAt)
            .Take(100)
            .Select(u => new { id = u.Id, name = (u.FirstName + " " + u.LastName).Trim(), email = u.Email, last_login_at = u.LastLoginAt, created_at = u.CreatedAt })
            .ToListAsync();

        return Ok(new { data = members, members });
    }

    [HttpGet("api/admin/members/inactive/detect")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminDetectInactiveMembers()
    {
        var cutoff = DateTime.UtcNow.AddDays(-90);
        var count = await _db.Users.CountAsync(u => u.IsActive && (u.LastLoginAt == null || u.LastLoginAt < cutoff));
        return Ok(new { data = new { inactive_count = count, cutoff } });
    }

    [HttpPost("api/admin/members/inactive/notify")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminNotifyInactiveMembers()
    {
        return Ok(new { success = true, queued = 0, message = "Inactive member notifications are not enabled in local compatibility mode." });
    }

    // Safeguarding admin routes (dashboard / flagged-messages / assignments) are
    // owned by AdminSafeguardingController. Duplicate compat handlers were
    // removed because they collided with the canonical implementations and
    // produced AmbiguousMatchException -> 500 -> CORS errors at the browser.

    [HttpPost("api/feed/polls/{id:int}/vote")]
    [Authorize]
    public async Task<IActionResult> FeedPollVoteAlias(int id, [FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var poll = await _db.Polls.Include(p => p.Options).FirstOrDefaultAsync(p => p.Id == id);
        if (poll == null) return NotFound(new { error = "Poll not found" });

        var optionIds = ReadIntList(body, "option_ids", "optionIds", "option_id", "optionId");
        if (optionIds.Count == 0 && poll.Options.Count > 0)
            optionIds.Add(poll.Options.OrderBy(o => o.SortOrder).First().Id);

        var existing = await _db.PollVotes.Where(v => v.PollId == id && v.UserId == userId.Value).ToListAsync();
        _db.PollVotes.RemoveRange(existing);

        foreach (var optionId in optionIds.Distinct())
        {
            if (poll.Options.Any(o => o.Id == optionId))
            {
                _db.PollVotes.Add(new PollVote
                {
                    TenantId = _tenantContext.GetTenantIdOrThrow(),
                    PollId = id,
                    OptionId = optionId,
                    UserId = userId.Value
                });
            }
        }

        await _db.SaveChangesAsync();
        return Ok(new { success = true, message = "Vote recorded" });
    }

    [HttpGet("api/feed/polls/{id:int}")]
    [Authorize]
    public async Task<IActionResult> FeedPollAlias(int id)
    {
        var poll = await _db.Polls
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (poll == null) return NotFound(new { error = "Poll not found" });

        return Ok(new
        {
            data = new
            {
                id = poll.Id,
                title = poll.Title,
                description = poll.Description,
                poll_type = poll.PollType,
                status = poll.Status,
                options = poll.Options.OrderBy(o => o.SortOrder).Select(o => new
                {
                    id = o.Id,
                    text = o.Text,
                    vote_count = poll.Votes.Count(v => v.OptionId == o.Id)
                }),
                total_votes = poll.Votes.Count,
                closes_at = poll.ClosesAt,
                created_at = poll.CreatedAt
            }
        });
    }

    [HttpGet("api/ideation-challenges/{id:int}")]
    [HttpGet("api/v2/ideation-challenges/{id:int}")]
    [HttpPut("api/ideation-challenges/{id:int}")]
    [HttpPut("api/v2/ideation-challenges/{id:int}")]
    [HttpDelete("api/ideation-challenges/{id:int}")]
    [HttpDelete("api/v2/ideation-challenges/{id:int}")]
    [Authorize]
    public async Task<IActionResult> IdeationChallengeDetail(int id, [FromBody] JsonElement? body = null)
    {
        var challenge = await _db.Challenges
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == _tenantContext.GetTenantIdOrThrow());
        if (challenge == null) return NotFound(new { error = "Challenge not found" });

        if (HttpContext.Request.Method == HttpMethods.Delete)
        {
            _db.ChallengeParticipants.RemoveRange(challenge.Participants);
            _db.Challenges.Remove(challenge);
            await RemoveIdeationChallengeCompatibilityStateAsync(challenge.TenantId, challenge.Id);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        if (HttpContext.Request.Method == HttpMethods.Put && body.HasValue)
        {
            var validation = UpdateIdeationChallengeFromBody(challenge, body.Value);
            if (validation != null)
            {
                return validation;
            }

            await SaveIdeationChallengeMetadataAsync(challenge.TenantId, challenge.Id, body.Value);
            await _db.SaveChangesAsync();
        }

        var data = await ProjectIdeationChallengeAsync(challenge);
        return Ok(new { success = true, data, challenge = data });
    }

    [HttpGet("api/ideation-campaigns/{id:int}")]
    [HttpGet("api/v2/ideation-campaigns/{id:int}")]
    [HttpPut("api/ideation-campaigns/{id:int}")]
    [HttpPut("api/v2/ideation-campaigns/{id:int}")]
    [HttpDelete("api/ideation-campaigns/{id:int}")]
    [HttpDelete("api/v2/ideation-campaigns/{id:int}")]
    [Authorize]
    public async Task<IActionResult> IdeationCampaignDetail(int id, [FromBody] JsonElement? body = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var campaign = await LoadIdeationCampaignAsync(tenantId, id);
        if (campaign == null)
        {
            return NotFound(new { success = false, error = "Campaign not found" });
        }

        if (HttpContext.Request.Method == HttpMethods.Delete)
        {
            if (!User.IsInRole("admin") && !User.IsInRole("tenant_admin") && !User.IsInRole("tenant_super_admin") && !User.IsInRole("super_admin"))
            {
                return Forbid();
            }

            await RemoveIdeationCampaignAsync(tenantId, id);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        if (HttpContext.Request.Method == HttpMethods.Put && body.HasValue)
        {
            if (!User.IsInRole("admin") && !User.IsInRole("tenant_admin") && !User.IsInRole("tenant_super_admin") && !User.IsInRole("super_admin"))
            {
                return Forbid();
            }

            var title = ReadString(body.Value, "title")?.Trim();
            if (body.Value.TryGetProperty("title", out _) && string.IsNullOrWhiteSpace(title))
            {
                return BadRequest(new { success = false, errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "Title cannot be empty.", "title") } });
            }

            if (!string.IsNullOrWhiteSpace(title))
            {
                campaign.Title = title;
            }

            if (body.Value.TryGetProperty("description", out _))
            {
                campaign.Description = NormalizeNullable(ReadString(body.Value, "description"));
            }

            if (body.Value.TryGetProperty("cover_image", out _))
            {
                campaign.CoverImage = NormalizeNullable(ReadString(body.Value, "cover_image"));
            }

            if (body.Value.TryGetProperty("status", out _))
            {
                campaign.Status = NormalizeIdeationCampaignStatus(ReadString(body.Value, "status"), campaign.Status);
            }

            if (body.Value.TryGetProperty("start_date", out _))
            {
                campaign.StartDate = ReadDateTime(body.Value, "start_date");
            }

            if (body.Value.TryGetProperty("end_date", out _))
            {
                campaign.EndDate = ReadDateTime(body.Value, "end_date");
            }

            campaign.UpdatedAt = DateTime.UtcNow;
            await UpsertIdeationCampaignAsync(tenantId, campaign);
            await _db.SaveChangesAsync();
        }

        var data = await ProjectIdeationCampaignAsync(tenantId, campaign, includeChallenges: true);
        return Ok(new { success = true, data });
    }

    [HttpGet("api/ideation-campaigns/{id:int}/challenges")]
    [Authorize]
    public async Task<IActionResult> IdeationCampaignChallenges(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var campaign = await LoadIdeationCampaignAsync(tenantId, id);
        if (campaign == null) return NotFound(new { success = false, error = "Campaign not found" });
        var data = await ProjectIdeationCampaignChallengesAsync(tenantId, campaign);
        return Ok(new { data, challenges = data });
    }

    [HttpPost("api/ideation-campaigns/{id:int}/challenges")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> LinkIdeationCampaignChallenge(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var campaign = await LoadIdeationCampaignAsync(tenantId, id);
        if (campaign == null) return NotFound(new { success = false, errors = new[] { IdeationStatusError("RESOURCE_NOT_FOUND", "Campaign not found.") } });

        var challengeId = ReadInt(body, "challenge_id");
        if (!challengeId.HasValue || challengeId.Value <= 0)
        {
            return BadRequest(new { success = false, errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "challenge_id is required.", "challenge_id") } });
        }

        var exists = await _db.Challenges.AnyAsync(c => c.Id == challengeId.Value && c.TenantId == tenantId);
        if (!exists)
        {
            return NotFound(new { success = false, errors = new[] { IdeationStatusError("RESOURCE_NOT_FOUND", "Challenge not found.") } });
        }

        if (campaign.Challenges.All(link => link.ChallengeId != challengeId.Value))
        {
            campaign.Challenges.Add(new IdeationCampaignChallengeLink
            {
                ChallengeId = challengeId.Value,
                SortOrder = ReadInt(body, "sort_order") ?? 0
            });
        }
        else
        {
            foreach (var link in campaign.Challenges.Where(link => link.ChallengeId == challengeId.Value))
            {
                link.SortOrder = ReadInt(body, "sort_order") ?? link.SortOrder;
            }
        }

        campaign.UpdatedAt = DateTime.UtcNow;
        await UpsertIdeationCampaignAsync(tenantId, campaign);
        await _db.SaveChangesAsync();

        return Created($"/api/v2/ideation-campaigns/{id}/challenges/{challengeId.Value}", new { success = true, data = new { linked = true } });
    }

    [HttpDelete("api/ideation-campaigns/{id:int}/challenges/{challengeId:int}")]
    [HttpDelete("api/v2/ideation-campaigns/{id:int}/challenges/{challengeId:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> UnlinkIdeationCampaignChallenge(int id, int challengeId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var campaign = await LoadIdeationCampaignAsync(tenantId, id);
        if (campaign == null) return NotFound(new { success = false, errors = new[] { IdeationStatusError("RESOURCE_NOT_FOUND", "Campaign not found.") } });

        campaign.Challenges = campaign.Challenges
            .Where(link => link.ChallengeId != challengeId)
            .ToList();
        campaign.UpdatedAt = DateTime.UtcNow;
        await UpsertIdeationCampaignAsync(tenantId, campaign);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    [HttpGet("api/ideation-campaigns/{campaignId:int}/challenges/{challengeId:int}")]
    [Authorize]
    public async Task<IActionResult> IdeationCampaignChallengeDetail(int campaignId, int challengeId)
    {
        return await IdeationChallengeDetail(challengeId);
    }

    [HttpPost("api/ideation-challenges/{id:int}/favorite")]
    [HttpDelete("api/ideation-challenges/{id:int}/favorite")]
    [HttpPost("api/v2/ideation-challenges/{id:int}/favorite")]
    [HttpDelete("api/v2/ideation-challenges/{id:int}/favorite")]
    [Authorize]
    public async Task<IActionResult> IdeationChallengeFavorite(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { errors = new[] { IdeationStatusError("AUTH_REQUIRED", "Authentication required.") } });

        var exists = await _db.Challenges.AnyAsync(c => c.Id == id && c.TenantId == tenantId);
        if (!exists) return NotFound(new { errors = new[] { IdeationStatusError("NOT_FOUND", "Challenge not found.") } });

        var key = IdeationChallengeFavoriteKey(id, userId.Value);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        var favorited = HttpContext.Request.Method == HttpMethods.Delete ? false : existing == null;
        if (existing != null)
        {
            _db.TenantConfigs.Remove(existing);
        }
        else if (favorited)
        {
            var now = DateTime.UtcNow;
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = now.ToString("O"),
                CreatedAt = now,
                UpdatedAt = now
            });
        }

        await _db.SaveChangesAsync();
        var favoritesCount = await CountIdeationChallengeFavoritesAsync(tenantId, id);
        var data = new { favorited, favorites_count = favoritesCount };
        return Ok(new { success = true, data, favorited, favorites_count = favoritesCount });
    }

    [HttpGet("api/ideation-challenges/{id:int}/outcome")]
    [HttpGet("api/v2/ideation-challenges/{id:int}/outcome")]
    [Authorize]
    public async Task<IActionResult> IdeationChallengeOutcome(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var exists = await _db.Challenges.AnyAsync(c => c.Id == id && c.TenantId == tenantId);
        if (!exists) return NotFound(new { errors = new[] { IdeationStatusError("NOT_FOUND", "Challenge not found.") } });

        var data = await ProjectIdeationChallengeOutcomeAsync(tenantId, id);
        return Ok(new { success = true, data });
    }

    [HttpPut("api/v2/ideation-challenges/{id:int}/outcome")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> UpsertIdeationChallengeOutcome(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var exists = await _db.Challenges.AnyAsync(c => c.Id == id && c.TenantId == tenantId);
        if (!exists) return NotFound(new { errors = new[] { IdeationStatusError("RESOURCE_NOT_FOUND", "Challenge not found.") } });

        var status = (ReadString(body, "implementation_status") ?? ReadString(body, "status") ?? "not_started")
            .Trim()
            .ToLowerInvariant();
        if (status is not ("not_started" or "in_progress" or "implemented" or "abandoned"))
        {
            return UnprocessableEntity(new { errors = new[] { IdeationStatusError("VALIDATION_INVALID_VALUE", "Invalid outcome status.", "status") } });
        }

        var outcome = await LoadIdeationChallengeOutcomeAsync(tenantId, id) ?? new IdeationChallengeOutcomeMetadata();
        outcome.ChallengeId = id;
        outcome.WinningIdeaId = ReadInt(body, "winning_idea_id");
        outcome.ImplementationStatus = status;
        outcome.Status = status;
        outcome.ImpactDescription = ReadString(body, "impact_description")?.Trim();
        outcome.UpdatedAt = DateTime.UtcNow;
        outcome.CreatedAt ??= outcome.UpdatedAt;

        await UpsertIdeationChallengeOutcomeAsync(tenantId, id, outcome);
        await _db.SaveChangesAsync();

        var data = await ProjectIdeationChallengeOutcomeAsync(tenantId, id);
        return Ok(new { success = true, data });
    }

    [HttpPost("api/ideation-challenges/{id:int}/duplicate")]
    [HttpPost("api/v2/ideation-challenges/{id:int}/duplicate")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DuplicateIdeationChallenge(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { errors = new[] { IdeationStatusError("AUTH_REQUIRED", "Authentication required.") } });

        var source = await _db.Challenges.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
        if (source == null) return NotFound(new { errors = new[] { IdeationStatusError("NOT_FOUND", "Challenge not found.") } });

        var copy = new Challenge
        {
            TenantId = tenantId,
            Title = "[Copy] " + source.Title,
            Description = source.Description,
            ChallengeType = source.ChallengeType,
            TargetAction = source.TargetAction,
            TargetCount = source.TargetCount,
            XpReward = source.XpReward,
            StartsAt = DateTime.UtcNow,
            EndsAt = DateTime.UtcNow.AddDays(30),
            IsActive = false,
            Difficulty = source.Difficulty
        };
        _db.Challenges.Add(copy);
        await _db.SaveChangesAsync();

        var metadata = await LoadIdeationChallengeMetadataAsync(source.TenantId, source.Id);
        metadata.Status = "draft";
        metadata.SubmissionDeadline = null;
        metadata.VotingDeadline = null;
        await UpsertIdeationChallengeMetadataAsync(copy.TenantId, copy.Id, metadata);

        var now = DateTime.UtcNow;
        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = copy.TenantId,
            Key = $"admin.feed.author.challenge.{copy.Id}",
            Value = userId.Value.ToString(),
            CreatedAt = now,
            UpdatedAt = now
        });

        await _db.SaveChangesAsync();
        var data = await ProjectIdeationChallengeAsync(copy);
        return Created($"/api/v2/ideation-challenges/{copy.Id}", new { success = true, data, challenge = data });
    }

    [HttpPost("api/ideation-challenges/{id:int}/status")]
    [HttpPut("api/ideation-challenges/{id:int}/status")]
    [HttpPost("api/v2/ideation-challenges/{id:int}/status")]
    [HttpPut("api/v2/ideation-challenges/{id:int}/status")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> IdeationChallengeStatus(int id, [FromBody] JsonElement body)
    {
        var challenge = await _db.Challenges
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == _tenantContext.GetTenantIdOrThrow());
        if (challenge == null) return NotFound(new { error = "Challenge not found" });
        var status = ReadString(body, "status");
        if (string.IsNullOrWhiteSpace(status))
        {
            return BadRequest(new { errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "Status is required.", "status") } });
        }

        status = status.Trim().ToLowerInvariant();
        if (!IsLaravelIdeationStatus(status))
        {
            return UnprocessableEntity(new { errors = new[] { IdeationStatusError("VALIDATION_ERROR", "Invalid status value.", "status") } });
        }

        var metadata = await LoadIdeationChallengeMetadataAsync(challenge.TenantId, challenge.Id);
        var currentStatus = (metadata.Status ?? MapAdminIdeationStatus(challenge)).Trim().ToLowerInvariant();
        if (!CanTransitionIdeationStatus(currentStatus, status))
        {
            return StatusCode(StatusCodes.Status409Conflict, new
            {
                errors = new[]
                {
                    IdeationStatusError("CONFLICT", $"Invalid challenge status transition from {currentStatus} to {status}.")
                }
            });
        }

        challenge.IsActive = status is "open" or "voting" or "evaluating";
        await SaveIdeationChallengeMetadataAsync(challenge.TenantId, challenge.Id, body);
        challenge.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var data = await ProjectIdeationChallengeAsync(challenge);
        return Ok(new { success = true, data, challenge = data });
    }

    [HttpGet("api/ideation-challenges/{id:int}/ideas/drafts")]
    [HttpGet("api/v2/ideation-challenges/{id:int}/ideas/drafts")]
    [Authorize]
    public async Task<IActionResult> IdeationChallengeIdeaDrafts(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        var ideas = await _db.Ideas
            .Include(i => i.Author)
            .Include(i => i.Comments)
            .Where(i => i.TenantId == tenantId &&
                i.Category == IdeationChallengeIdeaCategory(id) &&
                i.Status == "draft" &&
                (!userId.HasValue || i.AuthorId == userId.Value))
            .OrderByDescending(i => i.UpdatedAt ?? i.CreatedAt)
            .ToListAsync();
        var data = ideas.Select(idea => ProjectIdea(idea)).ToList();
        return Ok(new { success = true, data, ideas = data });
    }

    [HttpGet("api/v2/ideation-challenges/{id:int}/ideas")]
    [Authorize]
    public async Task<IActionResult> IdeationChallengeIdeas(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var ideas = await _db.Ideas
            .Include(i => i.Author)
            .Include(i => i.Comments)
            .Where(i => i.TenantId == tenantId &&
                i.Category == IdeationChallengeIdeaCategory(id) &&
                i.Status != "draft")
            .OrderByDescending(i => i.UpvoteCount)
            .ThenByDescending(i => i.CreatedAt)
            .ToListAsync();
        var data = ideas.Select(idea => ProjectIdea(idea)).ToList();
        return Ok(new
        {
            success = true,
            data,
            ideas = data,
            meta = new { per_page = data.Count, has_more = false, next_cursor = (string?)null }
        });
    }

    [HttpPost("api/v2/ideation-challenges/{id:int}/ideas")]
    [Authorize]
    public async Task<IActionResult> SubmitIdeationChallengeIdea(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var challengeExists = await _db.Challenges.AnyAsync(c => c.Id == id && c.TenantId == tenantId);
        if (!challengeExists)
        {
            return NotFound(new { success = false, errors = new[] { IdeationStatusError("RESOURCE_NOT_FOUND", "Challenge not found.") } });
        }

        var title = ReadString(body, "title")?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            return BadRequest(new { success = false, errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "Title is required.", "title") } });
        }

        var description = ReadString(body, "description") ?? ReadString(body, "content") ?? string.Empty;
        var idea = new Idea
        {
            TenantId = tenantId,
            AuthorId = userId.Value,
            Title = title,
            Content = description.Trim(),
            Category = IdeationChallengeIdeaCategory(id),
            Status = ReadBool(body, "is_draft") == true ? "draft" : "submitted",
            CreatedAt = DateTime.UtcNow
        };

        _db.Ideas.Add(idea);
        await _db.SaveChangesAsync();

        return Created($"/api/v2/ideation-ideas/{idea.Id}", new { success = true, data = new { id = idea.Id } });
    }

    [HttpGet("api/ideation-ideas/{id:int}")]
    [HttpGet("api/v2/ideation-ideas/{id:int}")]
    [HttpPut("api/ideation-ideas/{id:int}")]
    [HttpPut("api/v2/ideation-ideas/{id:int}")]
    [HttpDelete("api/ideation-ideas/{id:int}")]
    [HttpDelete("api/v2/ideation-ideas/{id:int}")]
    [Authorize]
    public async Task<IActionResult> IdeationIdeaDetail(int id, [FromBody] JsonElement? body = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Ideas
            .Include(i => i.Author)
            .Include(i => i.Comments)
            .FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId);
        if (idea == null) return NotFound(new { success = false, error = "Idea not found" });

        if (HttpContext.Request.Method == HttpMethods.Delete)
        {
            _db.IdeaComments.RemoveRange(idea.Comments);
            _db.Ideas.Remove(idea);
            await RemoveIdeationIdeaMediaAsync(tenantId, id);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        if (HttpContext.Request.Method == HttpMethods.Put && body.HasValue)
        {
            var title = ReadString(body.Value, "title")?.Trim();
            if (!string.IsNullOrWhiteSpace(title))
            {
                idea.Title = title;
            }

            if (body.Value.TryGetProperty("description", out _) || body.Value.TryGetProperty("content", out _))
            {
                idea.Content = (ReadString(body.Value, "description") ?? ReadString(body.Value, "content") ?? string.Empty).Trim();
            }

            idea.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        var currentUserId = User.GetUserId();
        var hasVoted = currentUserId.HasValue &&
            await _db.IdeaVotes.AnyAsync(v => v.TenantId == tenantId && v.IdeaId == id && v.UserId == currentUserId.Value);
        var data = ProjectIdea(idea, hasVoted);
        return Ok(new { success = true, data, idea = data });
    }

    [HttpPut("api/ideation-ideas/{id:int}/draft")]
    [HttpPost("api/ideation-ideas/{id:int}/draft")]
    [HttpPut("api/v2/ideation-ideas/{id:int}/draft")]
    [HttpPost("api/v2/ideation-ideas/{id:int}/draft")]
    [Authorize]
    public async Task<IActionResult> IdeationIdeaDraft(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Ideas.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId);
        if (idea == null) return NotFound(new { success = false, error = "Idea not found" });
        idea.Title = ReadString(body, "title") ?? idea.Title;
        idea.Content = ReadString(body, "description") ?? ReadString(body, "content") ?? idea.Content;
        idea.Status = ReadBool(body, "publish") == true ? "submitted" : "draft";
        idea.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var data = ProjectIdea(idea);
        return Ok(new { success = true, data, idea = data });
    }

    [HttpPut("api/ideation-ideas/{id:int}/status")]
    [HttpPost("api/ideation-ideas/{id:int}/status")]
    [HttpPut("api/v2/ideation-ideas/{id:int}/status")]
    [HttpPost("api/v2/ideation-ideas/{id:int}/status")]
    [Authorize]
    public async Task<IActionResult> IdeationIdeaStatus(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Ideas.Include(i => i.Author).Include(i => i.Comments).FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId);
        if (idea == null) return NotFound(new { success = false, error = "Idea not found" });
        idea.Status = ReadString(body, "status") ?? idea.Status;
        idea.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var data = ProjectIdea(idea);
        return Ok(new { success = true, data, idea = data });
    }

    [HttpPost("api/v2/ideation-ideas/{id:int}/vote")]
    [Authorize]
    public async Task<IActionResult> VoteIdeationIdea(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var idea = await _db.Ideas.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId);
        if (idea == null) return NotFound(new { success = false, error = "Idea not found" });

        var existing = await _db.IdeaVotes.FirstOrDefaultAsync(v => v.TenantId == tenantId && v.IdeaId == id && v.UserId == userId.Value);
        var voted = existing == null;
        if (existing == null)
        {
            _db.IdeaVotes.Add(new IdeaVote
            {
                TenantId = tenantId,
                IdeaId = id,
                UserId = userId.Value,
                CreatedAt = DateTime.UtcNow
            });
            idea.UpvoteCount++;
        }
        else
        {
            _db.IdeaVotes.Remove(existing);
            idea.UpvoteCount = Math.Max(0, idea.UpvoteCount - 1);
        }

        idea.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { voted, votes_count = idea.UpvoteCount } });
    }

    [HttpPost("api/ideation-ideas/{id:int}/convert-to-group")]
    [HttpPost("api/v2/ideation-ideas/{id:int}/convert-to-group")]
    [Authorize]
    public async Task<IActionResult> IdeationIdeaConvertToGroup(int id, [FromBody] JsonElement? body = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Ideas.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId);
        if (idea == null) return NotFound(new { success = false, error = "Idea not found" });

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var groupName = body.HasValue ? NormalizeNullable(ReadString(body.Value, "name")) : null;
        var groupDescription = body.HasValue ? NormalizeNullable(ReadString(body.Value, "description")) : null;
        var visibility = body.HasValue ? NormalizeNullable(ReadString(body.Value, "visibility")) : null;
        var group = new Group
        {
            TenantId = tenantId,
            Name = groupName ?? idea.Title,
            Description = groupDescription ?? idea.Content,
            CreatedById = userId.Value,
            IsPrivate = string.Equals(visibility, "private", StringComparison.OrdinalIgnoreCase)
        };
        _db.Groups.Add(group);
        await _db.SaveChangesAsync();

        var data = new
        {
            id = group.Id,
            group_id = group.Id,
            name = group.Name,
            group_name = group.Name,
            description = group.Description,
            visibility = group.IsPrivate ? "private" : "public"
        };
        var isV2 = HttpContext.Request.Path.Value?.Contains("/api/v2/", StringComparison.OrdinalIgnoreCase) == true;
        return isV2
            ? Created($"/api/v2/groups/{group.Id}", new { success = true, data })
            : Ok(new { success = true, data, group_id = group.Id });
    }

    [HttpDelete("api/ideation-comments/{id:int}")]
    [HttpDelete("api/v2/ideation-comments/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteIdeationComment(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var comment = await _db.IdeaComments.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
        if (comment == null) return NotFound(new { success = false, error = "Comment not found" });
        var idea = await _db.Ideas.FirstOrDefaultAsync(i => i.Id == comment.IdeaId && i.TenantId == tenantId);
        if (idea != null)
        {
            idea.CommentCount = Math.Max(0, idea.CommentCount - 1);
            idea.UpdatedAt = DateTime.UtcNow;
        }

        _db.IdeaComments.Remove(comment);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("api/v2/ideation-ideas/{id:int}/comments")]
    [Authorize]
    public async Task<IActionResult> IdeationIdeaComments(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var comments = await _db.IdeaComments
            .Include(c => c.User)
            .Where(c => c.TenantId == tenantId && c.IdeaId == id)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();
        var data = comments.Select(ProjectIdeationComment).ToList();
        return Ok(new { success = true, data, comments = data, meta = new { per_page = data.Count, has_more = false, next_cursor = (string?)null } });
    }

    [HttpPost("api/v2/ideation-ideas/{id:int}/comments")]
    [Authorize]
    public async Task<IActionResult> AddIdeationIdeaComment(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var idea = await _db.Ideas.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId);
        if (idea == null) return NotFound(new { success = false, error = "Idea not found" });

        var content = ReadString(body, "body") ?? ReadString(body, "content");
        if (string.IsNullOrWhiteSpace(content))
        {
            return BadRequest(new { success = false, errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "Comment body is required.", "body") } });
        }

        var comment = new IdeaComment
        {
            TenantId = tenantId,
            IdeaId = id,
            UserId = userId.Value,
            Content = content.Trim(),
            CreatedAt = DateTime.UtcNow
        };
        _db.IdeaComments.Add(comment);
        idea.CommentCount++;
        idea.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        comment.User = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value);
        var data = ProjectIdeationComment(comment);
        return Created($"/api/v2/ideation-ideas/{id}/comments/{comment.Id}", new { success = true, data });
    }

    [HttpGet("api/v2/ideation-ideas/{id:int}/media")]
    [Authorize]
    public async Task<IActionResult> IdeationIdeaMedia(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var data = await LoadIdeationIdeaMediaAsync(tenantId, id);
        return Ok(new { success = true, data });
    }

    [HttpPost("api/v2/ideation-ideas/{id:int}/media")]
    [Authorize]
    public async Task<IActionResult> AddIdeationIdeaMedia(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var ideaExists = await _db.Ideas.AnyAsync(i => i.Id == id && i.TenantId == tenantId);
        if (!ideaExists) return NotFound(new { success = false, error = "Idea not found" });

        var url = ReadString(body, "url")?.Trim();
        if (string.IsNullOrWhiteSpace(url))
        {
            return BadRequest(new { success = false, errors = new[] { IdeationStatusError("VALIDATION_REQUIRED_FIELD", "Media URL is required.", "url") } });
        }

        var media = new IdeationIdeaMediaMetadata
        {
            Id = await NextIdeationIdeaMediaIdAsync(tenantId),
            IdeaId = id,
            MediaType = NormalizeNullable(ReadString(body, "media_type")) ?? "link",
            Url = url,
            Caption = NormalizeNullable(ReadString(body, "caption")),
            CreatedBy = userId.Value,
            CreatedAt = DateTime.UtcNow
        };
        await UpsertIdeationIdeaMediaAsync(tenantId, media);
        await _db.SaveChangesAsync();

        return Created($"/api/v2/ideation-media/{media.Id}", new { success = true, data = ProjectIdeationIdeaMedia(media) });
    }

    [HttpDelete("api/v2/ideation-media/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteIdeationIdeaMedia(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var rows = await _db.TenantConfigs
            .Where(c => c.TenantId == tenantId && c.Key == IdeationIdeaMediaKey(id))
            .ToListAsync();
        if (rows.Count == 0)
        {
            return NotFound(new { success = false, error = "Media not found" });
        }

        _db.TenantConfigs.RemoveRange(rows);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("api/federation/members/{id:int}")]
    [Authorize]
    public async Task<IActionResult> FederationMemberDetail(int id)
    {
        var member = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.IsActive);
        if (member == null) return NotFound(new { error = "Member not found" });

        return Ok(new
        {
            data = new
            {
                id = member.Id,
                name = (member.FirstName + " " + member.LastName).Trim(),
                first_name = member.FirstName,
                last_name = member.LastName,
                avatar_url = member.AvatarUrl,
                bio = member.Bio,
                level = member.Level,
                total_xp = member.TotalXp
            }
        });
    }

    [HttpGet("api/federation/connections/{id:int}")]
    [HttpPost("api/federation/connections/{id:int}")]
    [Authorize]
    public async Task<IActionResult> FederationConnection(int id)
    {
        var exists = await _db.Users.AnyAsync(u => u.Id == id && u.IsActive);
        if (!exists) return NotFound(new { error = "Member not found" });
        return Ok(new { data = new { member_id = id, status = "available" } });
    }

    [HttpGet("api/federation/connections/status/{memberId:int}/{tenantId:int}")]
    [Authorize]
    public IActionResult FederationConnectionStatus(int memberId, int tenantId)
    {
        return Ok(new { data = new { member_id = memberId, tenant_id = tenantId, status = "available" } });
    }

    [HttpGet("api/groups/{groupId:int}/discussions/{discussionId:int}/messages")]
    [Authorize]
    public async Task<IActionResult> GroupDiscussionMessages(int groupId, int discussionId)
    {
        var replies = await _db.GroupDiscussionReplies
            .Include(r => r.Author)
            .Where(r => r.DiscussionId == discussionId)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new
            {
                id = r.Id,
                content = r.Content,
                author = r.Author == null ? null : new { id = r.Author.Id, first_name = r.Author.FirstName, last_name = r.Author.LastName },
                created_at = r.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = replies, messages = replies });
    }

    [HttpGet("api/groups/{id:int}/requests")]
    [Authorize]
    public IActionResult GroupJoinRequests(int id)
    {
        return Ok(new { data = Array.Empty<object>(), requests = Array.Empty<object>() });
    }

    [HttpGet("api/groups/{id:int}/tasks/stats")]
    [Authorize]
    public IActionResult GroupTaskStats(int id)
    {
        return Ok(new { data = new { group_id = id, total = 0, open = 0, completed = 0 } });
    }

    [HttpGet("api/goals/{id:int}/history")]
    [Authorize]
    public async Task<IActionResult> GoalHistory(int id)
    {
        var goal = await _db.Goals
            .Include(g => g.Milestones)
            .FirstOrDefaultAsync(g => g.Id == id);
        if (goal == null) return NotFound(new { error = "Goal not found" });

        var history = goal.Milestones
            .OrderBy(m => m.SortOrder)
            .Select(m => new
            {
                id = m.Id,
                type = "milestone",
                title = m.Title,
                is_completed = m.IsCompleted,
                created_at = m.CreatedAt,
                completed_at = m.CompletedAt
            })
            .Cast<object>()
            .Prepend(new
            {
                id = goal.Id,
                type = "goal",
                title = goal.Title,
                is_completed = goal.Status == "completed",
                created_at = goal.CreatedAt,
                completed_at = goal.CompletedAt
            })
            .ToList();

        return Ok(new { data = history, history });
    }

    [HttpPut("api/goals/{id:int}")]
    [HttpDelete("api/goals/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GoalMutationAlias(int id, [FromBody] JsonElement body)
    {
        var goal = await _db.Goals.FirstOrDefaultAsync(g => g.Id == id);
        if (goal == null) return NotFound(new { error = "Goal not found" });

        if (HttpContext.Request.Method == HttpMethods.Delete)
        {
            goal.Status = "abandoned";
            goal.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return Ok(new { success = true });
        }

        goal.Title = ReadString(body, "title") ?? goal.Title;
        goal.Description = ReadString(body, "description") ?? goal.Description;
        goal.Status = ReadString(body, "status") ?? goal.Status;
        goal.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = new { goal.Id, goal.Title, goal.Description, goal.Status, goal.CurrentValue, goal.TargetValue } });
    }

    [HttpGet("api/jobs/applications/{id:int}/history")]
    [Authorize]
    public async Task<IActionResult> JobApplicationHistory(int id)
    {
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.Id == id);
        if (app == null) return NotFound(new { error = "Application not found" });
        var data = new[]
        {
            new { status = app.Status, notes = app.ReviewNotes, created_at = app.CreatedAt, reviewed_at = app.ReviewedAt }
        };
        return Ok(new { data, history = data });
    }

    [HttpGet("api/jobs/{id:int}/analytics")]
    [Authorize]
    public async Task<IActionResult> JobAnalytics(int id)
    {
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.Id == id);
        if (job == null) return NotFound(new { error = "Job not found" });
        return Ok(new { data = new { views = job.ViewCount, applications = job.ApplicationCount, is_featured = job.IsFeatured } });
    }

    [HttpGet("api/users/{id:int}/verification-badges")]
    [Authorize]
    public async Task<IActionResult> UserVerificationBadges(int id)
    {
        var badges = await _db.UserVerificationBadges
            .Include(b => b.BadgeType)
            .Where(b => b.UserId == id)
            .OrderByDescending(b => b.AwardedAt)
            .Select(b => new
            {
                id = b.Id,
                key = b.BadgeType == null ? null : b.BadgeType.Key,
                name = b.BadgeType == null ? null : b.BadgeType.Name,
                description = b.BadgeType == null ? null : b.BadgeType.Description,
                icon_url = b.BadgeType == null ? null : b.BadgeType.IconUrl,
                awarded_at = b.AwardedAt,
                expires_at = b.ExpiresAt
            })
            .ToListAsync();

        return Ok(new { data = badges, badges });
    }

    [HttpGet("api/users/{id:int}/availability")]
    [HttpGet("/api/v2/users/{id:int}/availability")]
    [Authorize]
    public async Task<IActionResult> UserAvailability(int id)
    {
        var tenantId = _tenantContext.TenantId ?? 0;
        var availability = await _db.MemberAvailabilities
            .Where(a => a.TenantId == tenantId && a.UserId == id && a.IsActive)
            .OrderBy(a => a.DayOfWeek)
            .ThenBy(a => a.StartTime)
            .Select(a => new { id = a.Id, day_of_week = a.DayOfWeek, start_time = a.StartTime, end_time = a.EndTime, note = a.Note })
            .ToListAsync();

        return Ok(new { success = true, data = new { weekly = availability, timezone = "Europe/Zurich" } });
    }

    [HttpGet("api/events/{id:int}/attendees")]
    [Authorize]
    public async Task<IActionResult> EventAttendees(int id)
    {
        var attendees = await _db.EventRsvps
            .Include(r => r.User)
            .Where(r => r.EventId == id)
            .OrderBy(r => r.RespondedAt)
            .Select(r => new
            {
                id = r.Id,
                status = r.Status,
                user = r.User == null ? null : new { id = r.User.Id, first_name = r.User.FirstName, last_name = r.User.LastName }
            })
            .ToListAsync();

        return Ok(new { data = attendees, attendees });
    }

    [HttpGet("api/exchanges/{id:int}/ratings")]
    [Authorize]
    public async Task<IActionResult> ExchangeRatings(int id)
    {
        var reviews = await _db.Reviews
            .Where(r => r.TargetListingId == id)
            .Select(r => new { id = r.Id, rating = r.Rating, comment = r.Comment, created_at = r.CreatedAt })
            .ToListAsync();
        return Ok(new { data = reviews, ratings = reviews });
    }

    [HttpGet("api/feed/hashtags/{id:int}")]
    [Authorize]
    public async Task<IActionResult> FeedHashtag(int id)
    {
        var hashtag = await _db.Hashtags.FirstOrDefaultAsync(h => h.Id == id);
        if (hashtag == null) return NotFound(new { error = "Hashtag not found" });
        return Ok(new { data = new { id = hashtag.Id, tag = hashtag.Tag, usage_count = hashtag.UsageCount } });
    }

    [HttpGet("api/messages/{id:int}/reactions")]
    [Authorize]
    public IActionResult MessageReactions(int id)
    {
        return Ok(new { data = Array.Empty<object>(), reactions = Array.Empty<object>() });
    }

    [HttpGet("api/polls/{id:int}/ranked-results")]
    [Authorize]
    public async Task<IActionResult> RankedPollResults(int id)
    {
        var poll = await _db.Polls.Include(p => p.Options).Include(p => p.Votes).FirstOrDefaultAsync(p => p.Id == id);
        if (poll == null) return NotFound(new { error = "Poll not found" });
        var results = poll.Options.Select(o => new
        {
            option_id = o.Id,
            text = o.Text,
            first_choice_votes = poll.Votes.Count(v => v.OptionId == o.Id && v.Rank == 1),
            total_votes = poll.Votes.Count(v => v.OptionId == o.Id)
        });
        return Ok(new { data = results, results });
    }

    [HttpGet("api/reviews/user/{id:int}")]
    [Authorize]
    public async Task<IActionResult> ReviewsForUserAlias(int id)
    {
        var reviews = await _db.Reviews
            .Where(r => r.TargetUserId == id)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new { id = r.Id, rating = r.Rating, comment = r.Comment, created_at = r.CreatedAt })
            .ToListAsync();
        return Ok(new { data = reviews, reviews });
    }

    [HttpGet("api/volunteering/reviews/organization/{id:int}")]
    [Authorize]
    public IActionResult VolunteeringOrganizationReviews(int id)
    {
        return Ok(new { data = Array.Empty<object>(), reviews = Array.Empty<object>() });
    }

    [HttpGet("api/legal/{id:int}")]
    [HttpGet("api/legal/version/{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> LegalDocumentById(int id)
    {
        var doc = await _db.LegalDocuments.FirstOrDefaultAsync(d => d.Id == id);
        if (doc == null) return NotFound(new { error = "Document not found" });
        return Ok(new { data = ProjectLegalDocument(doc), document = ProjectLegalDocument(doc) });
    }

    [HttpGet("api/legal/{id:int}/versions")]
    [AllowAnonymous]
    public async Task<IActionResult> LegalDocumentVersions(int id)
    {
        var doc = await _db.LegalDocuments.FirstOrDefaultAsync(d => d.Id == id);
        if (doc == null) return NotFound(new { error = "Document not found" });
        var versions = await _db.LegalDocuments
            .Where(d => d.Slug == doc.Slug)
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => ProjectLegalDocument(d))
            .ToListAsync();
        return Ok(new { data = versions, versions });
    }

    [HttpGet("api/ideation-templates/{id:int}/data")]
    [Authorize]
    public IActionResult IdeationTemplateData(int id)
    {
        var data = IdeationBootstrapCompatibility.FindTemplateData(id);
        return data == null
            ? NotFound(new
            {
                success = false,
                error = new
                {
                    code = "RESOURCE_NOT_FOUND",
                    message = "Template not found"
                }
            })
            : Ok(new { success = true, data });
    }

    [HttpGet("api/admin/crm/export/{id:int}")]
    [HttpPost("api/exchanges/{id:int}/accept")]
    [HttpPost("api/exchanges/{id:int}/complete")]
    [HttpPost("api/listings/{id:int}/renew")]
    [HttpPut("api/groups/{groupId:int}/announcements/{announcementId:int}")]
    [HttpDelete("api/polls/{id:int}")]
    [HttpGet("api/admin/reports/social-value")]
    [HttpGet("api/admin/newsletters/{id:int}/preview")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminEmptyData()
    {
        return Ok(new { data = Array.Empty<object>(), items = Array.Empty<object>() });
    }

    [HttpGet("api/admin/federation/neighborhoods/{id:int}")]
    [HttpGet("api/v2/admin/federation/neighborhoods/{id:int}")]
    [HttpPut("api/admin/federation/neighborhoods/{id:int}")]
    [HttpPut("api/v2/admin/federation/neighborhoods/{id:int}")]
    [HttpGet("api/admin/federation/partnerships/{id:int}")]
    [HttpDelete("api/admin/federation/partnerships/{id:int}")]
    [HttpPut("api/admin/federation/credit-agreements/{id:int}/{tenantId:int}")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminFederationNestedCompatibility()
    {
        return Ok(new { success = true, data = Array.Empty<object>() });
    }

    [HttpDelete("api/admin/federation/neighborhoods/{id:int}")]
    [HttpDelete("api/v2/admin/federation/neighborhoods/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DeleteAdminFederationNeighborhood(int id)
    {
        var neighborhood = await _db.FederationNeighborhoods.FindAsync(id);
        if (neighborhood == null)
        {
            return NotFound(new { success = false, error = "Neighborhood not found", code = "NOT_FOUND" });
        }

        _db.FederationNeighborhoods.Remove(neighborhood);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { success = true } });
    }

    [HttpGet("api/admin/federation/neighborhoods/{id:int}/tenants")]
    [HttpGet("api/v2/admin/federation/neighborhoods/{id:int}/tenants")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetAdminFederationNeighborhoodTenants(int id)
    {
        if (!await _db.FederationNeighborhoods.AnyAsync(n => n.Id == id))
        {
            return NotFound(new { success = false, error = "Neighborhood not found", code = "NOT_FOUND" });
        }

        var tenants = await _db.FederationNeighborhoodTenants
            .Where(nt => nt.NeighborhoodId == id)
            .Include(nt => nt.Tenant)
            .OrderBy(nt => nt.Tenant!.Name)
            .Select(nt => new
            {
                id = nt.TenantId,
                tenant_id = nt.TenantId,
                name = nt.Tenant == null ? string.Empty : nt.Tenant.Name,
                slug = nt.Tenant == null ? string.Empty : nt.Tenant.Slug
            })
            .ToListAsync();

        return Ok(new { success = true, data = tenants, tenants });
    }

    [HttpPost("api/admin/federation/neighborhoods/{id:int}/tenants")]
    [HttpPost("api/v2/admin/federation/neighborhoods/{id:int}/tenants")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AddAdminFederationNeighborhoodTenant(int id, [FromBody] JsonElement input)
    {
        var tenantId = TryReadInt(input, "tenant_id") ?? TryReadInt(input, "tenantId") ?? 0;
        if (tenantId <= 0)
        {
            return BadRequest(new { success = false, error = "Tenant id is required", code = "VALIDATION_ERROR", field = "tenant_id" });
        }

        if (!await _db.FederationNeighborhoods.AnyAsync(n => n.Id == id))
        {
            return NotFound(new { success = false, error = "Neighborhood not found", code = "NOT_FOUND" });
        }

        if (!await _db.Tenants.AnyAsync(t => t.Id == tenantId && t.IsActive))
        {
            return NotFound(new { success = false, error = "Tenant not found", code = "NOT_FOUND" });
        }

        var exists = await _db.FederationNeighborhoodTenants
            .AnyAsync(nt => nt.NeighborhoodId == id && nt.TenantId == tenantId);

        if (!exists)
        {
            _db.FederationNeighborhoodTenants.Add(new FederationNeighborhoodTenant
            {
                NeighborhoodId = id,
                TenantId = tenantId
            });
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true, data = new { success = true } });
    }

    [HttpDelete("api/admin/federation/neighborhoods/{id:int}/tenants/{tenantId:int}")]
    [HttpDelete("api/v2/admin/federation/neighborhoods/{id:int}/tenants/{tenantId:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> RemoveAdminFederationNeighborhoodTenant(int id, int tenantId)
    {
        var membership = await _db.FederationNeighborhoodTenants
            .FirstOrDefaultAsync(nt => nt.NeighborhoodId == id && nt.TenantId == tenantId);

        if (membership == null)
        {
            return NotFound(new { success = false, error = "Tenant not in neighborhood", code = "NOT_FOUND" });
        }

        _db.FederationNeighborhoodTenants.Remove(membership);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { success = true } });
    }

    private async Task<List<object>> FormatFederationNeighborhoods(IReadOnlyCollection<FederationNeighborhood> neighborhoods)
    {
        var neighborhoodIds = neighborhoods.Select(n => n.Id).ToArray();
        var memberships = neighborhoodIds.Length == 0
            ? new List<FederationNeighborhoodTenant>()
            : await _db.FederationNeighborhoodTenants
                .Where(nt => neighborhoodIds.Contains(nt.NeighborhoodId))
                .Include(nt => nt.Tenant)
                .ToListAsync();

        var tenantIds = memberships.Select(m => m.TenantId).Distinct().ToArray();
        var memberCounts = tenantIds.Length == 0
            ? new Dictionary<int, int>()
            : await _db.Users
                .IgnoreQueryFilters()
                .Where(u => tenantIds.Contains(u.TenantId) && u.IsActive)
                .GroupBy(u => u.TenantId)
                .Select(g => new { TenantId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(g => g.TenantId, g => g.Count);

        var eventCounts = tenantIds.Length == 0
            ? new Dictionary<int, int>()
            : await _db.Events
                .IgnoreQueryFilters()
                .Where(e => tenantIds.Contains(e.TenantId) && !e.IsCancelled)
                .GroupBy(e => e.TenantId)
                .Select(g => new { TenantId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(g => g.TenantId, g => g.Count);

        var membershipsByNeighborhood = memberships
            .GroupBy(m => m.NeighborhoodId)
            .ToDictionary(g => g.Key, g => g.OrderBy(m => m.Tenant?.Name ?? string.Empty).ToList());

        return neighborhoods
            .OrderBy(n => n.Name)
            .Select(n =>
            {
                var neighborhoodMemberships = membershipsByNeighborhood.GetValueOrDefault(n.Id) ?? new List<FederationNeighborhoodTenant>();
                var tenants = neighborhoodMemberships
                    .Where(m => m.Tenant != null)
                    .Select(m => new
                    {
                        id = m.TenantId,
                        tenant_id = m.TenantId,
                        name = m.Tenant!.Name,
                        slug = m.Tenant.Slug,
                        member_count = memberCounts.GetValueOrDefault(m.TenantId)
                    })
                    .ToList();

                return (object)new
                {
                    id = n.Id,
                    name = n.Name,
                    description = n.Description,
                    region = n.Region,
                    tenant_count = tenants.Count,
                    total_members = neighborhoodMemberships.Sum(m => memberCounts.GetValueOrDefault(m.TenantId)),
                    shared_events_count = neighborhoodMemberships.Sum(m => eventCounts.GetValueOrDefault(m.TenantId)),
                    created_by = n.CreatedBy,
                    created_by_name = (string?)null,
                    tenants,
                    created_at = n.CreatedAt,
                    updated_at = n.UpdatedAt
                };
            })
            .ToList();
    }

    private static string? TryReadString(JsonElement input, string propertyName)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.String => property.GetString(),
            JsonValueKind.Number => property.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private static int? TryReadInt(JsonElement input, string propertyName)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number))
        {
            return number;
        }

        if (property.ValueKind == JsonValueKind.String && int.TryParse(property.GetString(), out var parsed))
        {
            return parsed;
        }

        return null;
    }

    [HttpGet("api/admin/identity/provider-credentials")]
    [HttpGet("api/v2/admin/identity/provider-credentials")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminListProviderCredentials()
    {
        var configured = GetConfiguredProviderSlugs();
        var credentials = ProviderCredentialOptions()
            .Where(p => p.slug != "mock")
            .Select(p => new
            {
                provider_slug = p.slug,
                provider_name = p.name,
                has_credentials = configured.Contains(p.slug),
                required_fields = new[] { "api_key", "webhook_secret" }
            })
            .ToArray();

        return Ok(new { success = true, data = credentials });
    }

    [HttpGet("api/admin/identity/provider-credentials/{slug}")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminGetProviderCredentials(string slug)
    {
        if (!IsKnownProviderSlug(slug))
            return NotFound(new { success = false, error = "Unknown provider" });

        var normalizedSlug = NormalizeProviderSlug(slug);
        var hasCredentials = GetConfiguredProviderSlugs().Contains(normalizedSlug);
        return Ok(new
        {
            success = true,
            data = new
            {
                provider_slug = normalizedSlug,
                configured = hasCredentials,
                has_credentials = hasCredentials
            }
        });
    }

    [HttpPut("api/admin/identity/provider-credentials/{slug}")]
    [HttpPut("api/v2/admin/identity/provider-credentials/{slug}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminSaveProviderCredentials(
        string slug,
        [FromBody] ProviderCredentialRequest request)
    {
        if (!IsKnownProviderSlug(slug))
            return NotFound(new { success = false, error = "Unknown provider" });

        var normalizedSlug = NormalizeProviderSlug(slug);
        var incoming = new Dictionary<string, string>();
        if (!string.IsNullOrWhiteSpace(request.ApiKey))
            incoming["api_key"] = request.ApiKey;
        if (!string.IsNullOrWhiteSpace(request.WebhookSecret))
            incoming["webhook_secret"] = request.WebhookSecret;

        if (incoming.Count == 0)
            return UnprocessableEntity(new { success = false, error = "At least one credential field is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var existing = await _db.TenantProviderCredentials
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.ProviderSlug == normalizedSlug);

        var merged = existing == null
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : DecryptCredentials(existing.CredentialsEncrypted);

        foreach (var pair in incoming)
            merged[pair.Key] = pair.Value;

        var encrypted = _encryption.Encrypt(JsonSerializer.Serialize(merged));

        if (existing == null)
        {
            existing = new TenantProviderCredential
            {
                TenantId = tenantId,
                ProviderSlug = normalizedSlug,
                CreatedAt = DateTime.UtcNow
            };
            _db.TenantProviderCredentials.Add(existing);
        }

        existing.CredentialsEncrypted = encrypted;
        existing.IsActive = true;
        existing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                saved = true,
                provider_slug = normalizedSlug
            }
        });
    }

    [HttpDelete("api/admin/identity/provider-credentials/{slug}")]
    [HttpDelete("api/v2/admin/identity/provider-credentials/{slug}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminDeleteProviderCredentials(string slug)
    {
        if (!IsKnownProviderSlug(slug))
            return NotFound(new { success = false, error = "Unknown provider" });

        var normalizedSlug = NormalizeProviderSlug(slug);
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var existing = await _db.TenantProviderCredentials
            .Where(c => c.TenantId == tenantId && c.ProviderSlug == normalizedSlug)
            .ToListAsync();
        var deleted = existing.Count > 0;
        if (deleted)
        {
            _db.TenantProviderCredentials.RemoveRange(existing);
            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                deleted,
                provider_slug = normalizedSlug
            }
        });
    }

    [HttpPost("api/admin/identity/sessions/{id:int}/{action}")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminIdentityNestedCompatibility()
    {
        return Ok(new { success = true, data = new { configured = false } });
    }

    [HttpPost("api/admin/moderation/{id:int}/review")]
    [HttpPost("api/admin/safeguarding/assignments/{id:int}")]
    [HttpPut("api/admin/safeguarding/assignments/{id:int}")]
    [HttpGet("api/admin/volunteering/approvals/{id:int}")]
    [HttpPost("api/admin/volunteering/approvals/{id:int}/reject")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminReviewCompatibility()
    {
        return Ok(new { success = true });
    }

    [HttpGet("api/gamification/challenges/{id:int}")]
    [HttpPost("api/gamification/challenges/{id:int}/claim")]
    [Authorize]
    public async Task<IActionResult> GamificationChallengeCompatibility(int id)
    {
        var challenge = await _db.Challenges.Include(c => c.Participants).FirstOrDefaultAsync(c => c.Id == id);
        if (challenge == null) return NotFound(new { error = "Challenge not found" });
        return Ok(new { success = true, data = ProjectChallenge(challenge), challenge = ProjectChallenge(challenge) });
    }

    [HttpDelete("api/admin/newsletters/suppression-list/{email}")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminNewsletterSuppressionCompatibility()
    {
        return Ok(new { success = true });
    }

    [HttpGet("api/v2/admin/polls/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminPollDetail(int id)
    {
        var poll = await _db.Polls
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .Include(p => p.CreatedBy)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);

        return poll == null
            ? NotFound(new { success = false, error = "NOT_FOUND", message = "Poll not found." })
            : Ok(new { success = true, data = MapAdminPoll(poll) });
    }

    [HttpDelete("api/v2/admin/polls/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DeleteAdminPoll(int id)
    {
        var poll = await _db.Polls
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (poll == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Poll not found." });
        }

        _db.PollVotes.RemoveRange(poll.Votes);
        _db.PollOptions.RemoveRange(poll.Options);
        _db.Polls.Remove(poll);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpGet("api/v2/admin/resources/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminResourceDetail(int id)
    {
        var article = await _db.KnowledgeArticles
            .Include(a => a.CreatedBy)
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id);

        return article == null
            ? NotFound(new { success = false, error = "NOT_FOUND", message = "Article not found." })
            : Ok(new { success = true, data = MapAdminResourceArticleDetail(article) });
    }

    [HttpDelete("api/v2/admin/resources/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DeleteAdminResource(int id)
    {
        var article = await _db.KnowledgeArticles.FirstOrDefaultAsync(a => a.Id == id);
        if (article == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Article not found." });
        }

        _db.KnowledgeArticles.Remove(article);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpGet("api/v2/admin/ideation/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminIdeationDetail(int id)
    {
        var challenge = await _db.Challenges
            .Include(c => c.Participants)
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id);

        return challenge == null
            ? NotFound(new { success = false, error = "NOT_FOUND", message = "Challenge not found." })
            : Ok(new { success = true, data = MapAdminIdeationChallenge(challenge) });
    }

    [HttpDelete("api/v2/admin/ideation/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DeleteAdminIdeation(int id)
    {
        var challenge = await _db.Challenges
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (challenge == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Challenge not found." });
        }

        _db.ChallengeParticipants.RemoveRange(challenge.Participants);
        _db.Challenges.Remove(challenge);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpGet("api/v2/admin/goals/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminGoalDetail(int id)
    {
        var goal = await _db.Goals
            .Include(g => g.User)
            .Include(g => g.Milestones)
            .AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == id);

        return goal == null
            ? NotFound(new { success = false, error = "NOT_FOUND", message = "Goal not found." })
            : Ok(new { success = true, data = MapAdminGoal(goal) });
    }

    [HttpDelete("api/v2/admin/goals/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DeleteAdminGoal(int id)
    {
        var goal = await _db.Goals
            .Include(g => g.Milestones)
            .FirstOrDefaultAsync(g => g.Id == id);
        if (goal == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Goal not found." });
        }

        _db.GoalMilestones.RemoveRange(goal.Milestones);
        _db.Goals.Remove(goal);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpGet("api/admin/goals/{id:int}")]
    [HttpPut("api/admin/goals/{id:int}")]
    [HttpDelete("api/admin/goals/{id:int}")]
    [HttpGet("api/admin/ideation/{id:int}")]
    [HttpPut("api/admin/ideation/{id:int}")]
    [HttpDelete("api/admin/ideation/{id:int}")]
    [HttpPut("api/admin/ideation/{id:int}/status")]
    [HttpGet("api/admin/invite-codes/{id:int}")]
    [HttpPut("api/admin/invite-codes/{id:int}")]
    [HttpDelete("api/admin/invite-codes/{id:int}")]
    [HttpGet("api/admin/polls/{id:int}")]
    [HttpPut("api/admin/polls/{id:int}")]
    [HttpDelete("api/admin/polls/{id:int}")]
    [HttpGet("api/admin/resources/{id:int}")]
    [HttpPut("api/admin/resources/{id:int}")]
    [HttpDelete("api/admin/resources/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminCrudCompatibility()
    {
        return Ok(new { success = true, data = new { } });
    }

    [HttpGet("api/admin/jobs/{id:int}")]
    [HttpPut("api/admin/jobs/{id:int}")]
    [HttpDelete("api/admin/jobs/{id:int}")]
    [HttpGet("api/admin/jobs/{id:int}/applications")]
    [HttpPost("api/admin/jobs/{id:int}/unfeature")]
    [HttpGet("api/admin/jobs/applications/{id:int}")]
    [HttpPut("api/admin/jobs/applications/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public IActionResult AdminJobsCompatibility()
    {
        return Ok(new { success = true, data = Array.Empty<object>() });
    }

    private async Task<FederationUserSetting> GetOrCreateFederationSettingsAsync(int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var settings = await _db.FederationUserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
        if (settings != null)
            return settings;

        settings = new FederationUserSetting
        {
            TenantId = tenantId,
            UserId = userId,
            FederationOptIn = false,
            ProfileVisible = false,
            ListingsVisible = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.FederationUserSettings.Add(settings);
        await _db.SaveChangesAsync();
        return settings;
    }

    private async Task<object> ProjectIdeationChallengeAsync(Challenge challenge)
    {
        var metadata = await LoadIdeationChallengeMetadataAsync(challenge.TenantId, challenge.Id);
        var userId = User.GetUserId();
        var isFavorited = userId.HasValue &&
            await _db.TenantConfigs.AnyAsync(c =>
                c.TenantId == challenge.TenantId &&
                c.Key == IdeationChallengeFavoriteKey(challenge.Id, userId.Value));
        var favoritesCount = await CountIdeationChallengeFavoritesAsync(challenge.TenantId, challenge.Id);
        return new
        {
            id = challenge.Id,
            title = challenge.Title,
            description = challenge.Description,
            category = metadata.Category,
            prize_description = metadata.PrizeDescription,
            submission_deadline = metadata.SubmissionDeadline ?? challenge.EndsAt,
            voting_deadline = metadata.VotingDeadline ?? challenge.EndsAt,
            max_ideas_per_user = metadata.MaxIdeasPerUser,
            status = metadata.Status ?? MapAdminIdeationStatus(challenge),
            cover_image = metadata.CoverImage,
            tags = metadata.Tags,
            challenge_type = challenge.ChallengeType.ToString().ToLowerInvariant(),
            target_action = challenge.TargetAction,
            target_count = challenge.TargetCount,
            xp_reward = challenge.XpReward,
            is_active = challenge.IsActive,
            is_favorited = isFavorited,
            favorites_count = favoritesCount,
            difficulty = challenge.Difficulty.ToString().ToLowerInvariant(),
            participant_count = challenge.Participants?.Count ?? 0,
            starts_at = challenge.StartsAt,
            ends_at = challenge.EndsAt,
            created_at = challenge.CreatedAt,
            updated_at = challenge.UpdatedAt
        };
    }

    private IActionResult? UpdateIdeationChallengeFromBody(Challenge challenge, JsonElement body)
    {
        if (body.TryGetProperty("title", out _))
        {
            var title = ReadString(body, "title")?.Trim();
            if (string.IsNullOrWhiteSpace(title))
            {
                return UnprocessableEntity(new { success = false, error = new { code = "VALIDATION_ERROR", message = "Title cannot be empty", field = "title" } });
            }

            challenge.Title = title;
        }

        if (body.TryGetProperty("description", out _))
        {
            var description = ReadString(body, "description")?.Trim();
            if (string.IsNullOrWhiteSpace(description))
            {
                return UnprocessableEntity(new { success = false, error = new { code = "VALIDATION_ERROR", message = "Description cannot be empty", field = "description" } });
            }

            challenge.Description = description;
        }

        var submissionDeadline = ReadDateTime(body, "submission_deadline");
        var votingDeadline = ReadDateTime(body, "voting_deadline");
        if (votingDeadline.HasValue || submissionDeadline.HasValue)
        {
            challenge.EndsAt = votingDeadline ?? submissionDeadline!.Value;
        }

        var maxIdeasPerUser = ReadInt(body, "max_ideas_per_user");
        if (maxIdeasPerUser.HasValue)
        {
            challenge.TargetCount = Math.Max(maxIdeasPerUser.Value, 1);
        }

        challenge.UpdatedAt = DateTime.UtcNow;
        return null;
    }

    private async Task<IdeationChallengeMetadata> LoadIdeationChallengeMetadataAsync(int tenantId, int challengeId)
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == IdeationChallengeMetaKey(challengeId))
            .Select(c => c.Value)
            .FirstOrDefaultAsync();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new IdeationChallengeMetadata();
        }

        try
        {
            return JsonSerializer.Deserialize<IdeationChallengeMetadata>(raw) ?? new IdeationChallengeMetadata();
        }
        catch (JsonException)
        {
            return new IdeationChallengeMetadata();
        }
    }

    private async Task SaveIdeationChallengeMetadataAsync(int tenantId, int challengeId, JsonElement body)
    {
        var metadata = await LoadIdeationChallengeMetadataAsync(tenantId, challengeId);
        if (body.TryGetProperty("category", out _))
        {
            metadata.Category = ReadString(body, "category")?.Trim();
        }

        if (body.TryGetProperty("prize_description", out _))
        {
            metadata.PrizeDescription = ReadString(body, "prize_description")?.Trim();
        }

        if (body.TryGetProperty("submission_deadline", out _))
        {
            metadata.SubmissionDeadline = ReadDateTime(body, "submission_deadline");
        }

        if (body.TryGetProperty("voting_deadline", out _))
        {
            metadata.VotingDeadline = ReadDateTime(body, "voting_deadline");
        }

        if (body.TryGetProperty("max_ideas_per_user", out _))
        {
            metadata.MaxIdeasPerUser = ReadInt(body, "max_ideas_per_user");
        }

        if (body.TryGetProperty("status", out _))
        {
            metadata.Status = ReadString(body, "status")?.Trim();
        }

        if (body.TryGetProperty("cover_image", out _))
        {
            metadata.CoverImage = ReadString(body, "cover_image")?.Trim();
        }

        if (body.TryGetProperty("tags", out _))
        {
            metadata.Tags = ReadStringArray(body, "tags");
        }

        await UpsertIdeationChallengeMetadataAsync(tenantId, challengeId, metadata);
    }

    private async Task UpsertIdeationChallengeMetadataAsync(int tenantId, int challengeId, IdeationChallengeMetadata metadata)
    {
        var now = DateTime.UtcNow;
        var key = IdeationChallengeMetaKey(challengeId);
        var value = JsonSerializer.Serialize(metadata);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = now;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = now,
            UpdatedAt = now
        });
    }

    private async Task RemoveIdeationChallengeCompatibilityStateAsync(int tenantId, int challengeId)
    {
        var keys = new[]
        {
            IdeationChallengeMetaKey(challengeId),
            IdeationChallengeOutcomeKey(challengeId),
            $"admin.feed.author.challenge.{challengeId}",
            $"admin.feed.hidden.challenge.{challengeId}",
            $"admin.feed.deleted.challenge.{challengeId}"
        };
        var favoritePrefix = IdeationChallengeFavoritePrefix(challengeId);

        var rows = await _db.TenantConfigs
            .Where(c => c.TenantId == tenantId && (keys.Contains(c.Key) || c.Key.StartsWith(favoritePrefix)))
            .ToListAsync();
        _db.TenantConfigs.RemoveRange(rows);
    }

    private Task<int> CountIdeationChallengeFavoritesAsync(int tenantId, int challengeId)
    {
        var prefix = IdeationChallengeFavoritePrefix(challengeId);
        return _db.TenantConfigs.CountAsync(c => c.TenantId == tenantId && c.Key.StartsWith(prefix));
    }

    private async Task<object?> ProjectIdeationChallengeOutcomeAsync(int tenantId, int challengeId)
    {
        var outcome = await LoadIdeationChallengeOutcomeAsync(tenantId, challengeId);
        if (outcome == null)
        {
            return null;
        }

        string? winningIdeaTitle = null;
        object? winningIdea = null;
        if (outcome.WinningIdeaId.HasValue)
        {
            var idea = await _db.Ideas
                .Include(i => i.Author)
                .AsNoTracking()
                .FirstOrDefaultAsync(i => i.Id == outcome.WinningIdeaId.Value && i.TenantId == tenantId);
            if (idea != null)
            {
                winningIdeaTitle = idea.Title;
                winningIdea = new
                {
                    id = idea.Id,
                    title = idea.Title,
                    description = idea.Content,
                    author = idea.Author == null
                        ? string.Empty
                        : string.Join(" ", new[] { idea.Author.FirstName, idea.Author.LastName }.Where(part => !string.IsNullOrWhiteSpace(part)))
                };
            }
        }

        var implementationStatus = outcome.ImplementationStatus ?? outcome.Status ?? "not_started";
        return new
        {
            id = outcome.Id,
            challenge_id = challengeId,
            winning_idea_id = outcome.WinningIdeaId,
            winning_idea_title = winningIdeaTitle,
            winning_idea = winningIdea,
            implementation_status = implementationStatus,
            status = implementationStatus,
            impact_description = outcome.ImpactDescription,
            created_at = outcome.CreatedAt,
            updated_at = outcome.UpdatedAt
        };
    }

    private async Task<IdeationChallengeOutcomeMetadata?> LoadIdeationChallengeOutcomeAsync(int tenantId, int challengeId)
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == IdeationChallengeOutcomeKey(challengeId))
            .Select(c => c.Value)
            .FirstOrDefaultAsync();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<IdeationChallengeOutcomeMetadata>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task UpsertIdeationChallengeOutcomeAsync(int tenantId, int challengeId, IdeationChallengeOutcomeMetadata outcome)
    {
        var key = IdeationChallengeOutcomeKey(challengeId);
        outcome.Id = outcome.Id == 0 ? challengeId : outcome.Id;
        var value = JsonSerializer.Serialize(outcome);
        var now = DateTime.UtcNow;
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = now;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = now,
            UpdatedAt = now
        });
    }

    private async Task<List<IdeationCampaignMetadata>> LoadIdeationCampaignsAsync(int tenantId)
    {
        var prefix = IdeationCampaignPrefix();
        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .ToListAsync();

        var campaigns = new List<IdeationCampaignMetadata>();
        foreach (var row in rows)
        {
            if (!TryParseIdeationCampaignId(row.Key, out _))
            {
                continue;
            }

            try
            {
                var campaign = JsonSerializer.Deserialize<IdeationCampaignMetadata>(row.Value);
                if (campaign != null)
                {
                    campaigns.Add(campaign);
                }
            }
            catch (JsonException)
            {
                // Ignore malformed bridge rows rather than breaking the React page.
            }
        }

        return campaigns;
    }

    private async Task<IdeationCampaignMetadata?> LoadIdeationCampaignAsync(int tenantId, int id)
    {
        var value = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == IdeationCampaignKey(id))
            .Select(c => c.Value)
            .FirstOrDefaultAsync();
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<IdeationCampaignMetadata>(value);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<int> NextIdeationCampaignIdAsync(int tenantId)
    {
        var prefix = IdeationCampaignPrefix();
        var keys = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .Select(c => c.Key)
            .ToListAsync();

        var max = keys
            .Select(key => TryParseIdeationCampaignId(key, out var id) ? id : 0)
            .DefaultIfEmpty(0)
            .Max();
        return max + 1;
    }

    private async Task UpsertIdeationCampaignAsync(int tenantId, IdeationCampaignMetadata campaign)
    {
        var now = DateTime.UtcNow;
        campaign.UpdatedAt = campaign.UpdatedAt == default ? now : campaign.UpdatedAt;
        if (campaign.CreatedAt == default)
        {
            campaign.CreatedAt = now;
        }

        var key = IdeationCampaignKey(campaign.Id);
        var value = JsonSerializer.Serialize(campaign);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = now;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = now,
            UpdatedAt = now
        });
    }

    private async Task RemoveIdeationCampaignAsync(int tenantId, int id)
    {
        var rows = await _db.TenantConfigs
            .Where(c => c.TenantId == tenantId && c.Key == IdeationCampaignKey(id))
            .ToListAsync();
        _db.TenantConfigs.RemoveRange(rows);
    }

    private async Task<List<object>> LoadIdeationIdeaMediaAsync(int tenantId, int ideaId)
    {
        var prefix = IdeationIdeaMediaPrefix();
        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();

        var media = new List<IdeationIdeaMediaMetadata>();
        foreach (var row in rows)
        {
            if (!TryParseIdeationIdeaMediaId(row.Key, out _))
            {
                continue;
            }

            try
            {
                var item = JsonSerializer.Deserialize<IdeationIdeaMediaMetadata>(row.Value);
                if (item?.IdeaId == ideaId)
                {
                    media.Add(item);
                }
            }
            catch (JsonException)
            {
                // Ignore malformed bridge rows rather than breaking the React page.
            }
        }

        return media
            .OrderBy(item => item.CreatedAt)
            .Select(ProjectIdeationIdeaMedia)
            .ToList();
    }

    private async Task<int> NextIdeationIdeaMediaIdAsync(int tenantId)
    {
        var prefix = IdeationIdeaMediaPrefix();
        var keys = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .Select(c => c.Key)
            .ToListAsync();
        var max = keys
            .Select(key => TryParseIdeationIdeaMediaId(key, out var id) ? id : 0)
            .DefaultIfEmpty(0)
            .Max();
        return max + 1;
    }

    private async Task UpsertIdeationIdeaMediaAsync(int tenantId, IdeationIdeaMediaMetadata media)
    {
        var now = DateTime.UtcNow;
        var key = IdeationIdeaMediaKey(media.Id);
        var value = JsonSerializer.Serialize(media);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = now;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = now,
            UpdatedAt = now
        });
    }

    private async Task RemoveIdeationIdeaMediaAsync(int tenantId, int ideaId)
    {
        var prefix = IdeationIdeaMediaPrefix();
        var rows = await _db.TenantConfigs
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .ToListAsync();

        var remove = new List<TenantConfig>();
        foreach (var row in rows)
        {
            try
            {
                var media = JsonSerializer.Deserialize<IdeationIdeaMediaMetadata>(row.Value);
                if (media?.IdeaId == ideaId)
                {
                    remove.Add(row);
                }
            }
            catch (JsonException)
            {
                // Leave malformed rows for a later cleanup pass.
            }
        }

        _db.TenantConfigs.RemoveRange(remove);
    }

    private object ProjectIdeationCampaign(IdeationCampaignMetadata campaign, bool includeChallenges)
    {
        var challenges = includeChallenges
            ? Array.Empty<object>()
            : Array.Empty<object>();

        return new
        {
            id = campaign.Id,
            title = campaign.Title,
            description = campaign.Description,
            cover_image = campaign.CoverImage,
            status = campaign.Status,
            start_date = campaign.StartDate,
            end_date = campaign.EndDate,
            created_by = campaign.CreatedBy,
            creator = new
            {
                id = campaign.CreatedBy,
                name = string.Empty
            },
            challenge_count = campaign.Challenges.Count,
            challenges_count = campaign.Challenges.Count,
            challenges,
            created_at = campaign.CreatedAt,
            updated_at = campaign.UpdatedAt
        };
    }

    private async Task<object> ProjectIdeationCampaignAsync(int tenantId, IdeationCampaignMetadata campaign, bool includeChallenges)
    {
        var challenges = includeChallenges
            ? await ProjectIdeationCampaignChallengesAsync(tenantId, campaign)
            : [];

        return new
        {
            id = campaign.Id,
            title = campaign.Title,
            description = campaign.Description,
            cover_image = campaign.CoverImage,
            status = campaign.Status,
            start_date = campaign.StartDate,
            end_date = campaign.EndDate,
            created_by = campaign.CreatedBy,
            creator = new
            {
                id = campaign.CreatedBy,
                name = string.Empty
            },
            challenge_count = challenges.Count,
            challenges_count = challenges.Count,
            challenges,
            created_at = campaign.CreatedAt,
            updated_at = campaign.UpdatedAt
        };
    }

    private async Task<List<object>> ProjectIdeationCampaignChallengesAsync(int tenantId, IdeationCampaignMetadata campaign)
    {
        var links = campaign.Challenges
            .OrderBy(link => link.SortOrder)
            .ThenBy(link => link.ChallengeId)
            .ToList();
        if (links.Count == 0)
        {
            return [];
        }

        var challengeIds = links.Select(link => link.ChallengeId).ToArray();
        var challenges = await _db.Challenges
            .Include(c => c.Participants)
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && challengeIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id);

        var projected = new List<object>();
        foreach (var link in links)
        {
            if (!challenges.TryGetValue(link.ChallengeId, out var challenge))
            {
                continue;
            }

            var metadata = await LoadIdeationChallengeMetadataAsync(tenantId, challenge.Id);
            var favoritesCount = await CountIdeationChallengeFavoritesAsync(tenantId, challenge.Id);
            projected.Add(new
            {
                id = challenge.Id,
                title = challenge.Title,
                description = challenge.Description ?? string.Empty,
                status = metadata.Status ?? MapAdminIdeationStatus(challenge),
                ideas_count = challenge.Participants?.Count ?? 0,
                views_count = 0,
                favorites_count = favoritesCount,
                cover_image = metadata.CoverImage,
                tags = metadata.Tags,
                submission_deadline = metadata.SubmissionDeadline ?? challenge.EndsAt,
                prize_description = metadata.PrizeDescription,
                is_featured = false,
                sort_order = link.SortOrder
            });
        }

        return projected;
    }

    private static bool IsLaravelIdeationStatus(string status)
        => status is "draft" or "open" or "voting" or "evaluating" or "closed" or "archived";

    private static bool CanTransitionIdeationStatus(string currentStatus, string nextStatus)
        => currentStatus switch
        {
            "draft" => nextStatus is "open",
            "open" => nextStatus is "voting" or "evaluating" or "closed",
            "voting" => nextStatus is "evaluating" or "closed",
            "evaluating" => nextStatus is "closed",
            "closed" => nextStatus is "open" or "archived",
            "archived" => nextStatus is "closed",
            _ => false
        };

    private static object IdeationStatusError(string code, string message, string? field = null)
        => field == null
            ? new { code, message }
            : new { code, message, field };

    private static DateTime? ReadDateTime(JsonElement body, string propertyName)
    {
        return DateTime.TryParse(ReadString(body, propertyName), out var value) ? value.ToUniversalTime() : null;
    }

    private static int? ReadInt(JsonElement body, string propertyName)
    {
        return int.TryParse(ReadString(body, propertyName), out var value) ? value : null;
    }

    private static bool? ReadBool(JsonElement body, string propertyName)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(property.GetString(), out var value) => value,
            _ => null
        };
    }

    private static string[] ReadStringArray(JsonElement body, string propertyName)
    {
        if (body.ValueKind != JsonValueKind.Object ||
            !body.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return property
            .EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString()?.Trim())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!)
            .ToArray();
    }

    private static string IdeationChallengeMetaKey(int challengeId) => $"ideation.challenge.meta.{challengeId}";

    private static string IdeationChallengeOutcomeKey(int challengeId) => $"ideation.challenge.outcome.{challengeId}";

    private static string IdeationChallengeFavoritePrefix(int challengeId) => $"ideation.challenge.favorite.{challengeId}.";

    private static string IdeationChallengeFavoriteKey(int challengeId, int userId) => $"{IdeationChallengeFavoritePrefix(challengeId)}{userId}";

    private static string IdeationCampaignPrefix() => "ideation.campaign.";

    private static string IdeationCampaignKey(int campaignId) => $"{IdeationCampaignPrefix()}{campaignId}";

    private static bool TryParseIdeationCampaignId(string key, out int campaignId)
    {
        campaignId = 0;
        var prefix = IdeationCampaignPrefix();
        return key.StartsWith(prefix, StringComparison.Ordinal) &&
            int.TryParse(key[prefix.Length..], out campaignId);
    }

    private static string IdeationChallengeIdeaCategory(int challengeId) => $"challenge:{challengeId}";

    private static int? ChallengeIdFromIdea(Idea idea)
    {
        const string prefix = "challenge:";
        return idea.Category != null &&
            idea.Category.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) &&
            int.TryParse(idea.Category[prefix.Length..], out var challengeId)
                ? challengeId
                : null;
    }

    private static string IdeationIdeaMediaPrefix() => "ideation.idea.media.";

    private static string IdeationIdeaMediaKey(int mediaId) => $"{IdeationIdeaMediaPrefix()}{mediaId}";

    private static bool TryParseIdeationIdeaMediaId(string key, out int mediaId)
    {
        mediaId = 0;
        var prefix = IdeationIdeaMediaPrefix();
        return key.StartsWith(prefix, StringComparison.Ordinal) &&
            int.TryParse(key[prefix.Length..], out mediaId);
    }

    private static string NormalizeIdeationCampaignStatus(string? status, string fallback = "draft")
    {
        var normalized = status?.Trim().ToLowerInvariant();
        return normalized is "draft" or "active" or "completed" or "archived"
            ? normalized
            : fallback;
    }

    private static string? NormalizeNullable(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private sealed class IdeationCampaignMetadata
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("cover_image")] public string? CoverImage { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; } = "draft";
        [JsonPropertyName("start_date")] public DateTime? StartDate { get; set; }
        [JsonPropertyName("end_date")] public DateTime? EndDate { get; set; }
        [JsonPropertyName("created_by")] public int? CreatedBy { get; set; }
        [JsonPropertyName("created_at")] public DateTime CreatedAt { get; set; }
        [JsonPropertyName("updated_at")] public DateTime? UpdatedAt { get; set; }
        [JsonPropertyName("challenges")] public List<IdeationCampaignChallengeLink> Challenges { get; set; } = [];
    }

    private sealed class IdeationCampaignChallengeLink
    {
        [JsonPropertyName("challenge_id")] public int ChallengeId { get; set; }
        [JsonPropertyName("sort_order")] public int SortOrder { get; set; }
    }

    private sealed class IdeationIdeaMediaMetadata
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("idea_id")] public int IdeaId { get; set; }
        [JsonPropertyName("media_type")] public string MediaType { get; set; } = "link";
        [JsonPropertyName("url")] public string Url { get; set; } = string.Empty;
        [JsonPropertyName("caption")] public string? Caption { get; set; }
        [JsonPropertyName("created_by")] public int CreatedBy { get; set; }
        [JsonPropertyName("created_at")] public DateTime CreatedAt { get; set; }
    }

    private sealed class IdeationChallengeOutcomeMetadata
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("challenge_id")] public int ChallengeId { get; set; }
        [JsonPropertyName("winning_idea_id")] public int? WinningIdeaId { get; set; }
        [JsonPropertyName("implementation_status")] public string? ImplementationStatus { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("impact_description")] public string? ImpactDescription { get; set; }
        [JsonPropertyName("created_at")] public DateTime? CreatedAt { get; set; }
        [JsonPropertyName("updated_at")] public DateTime? UpdatedAt { get; set; }
    }

    private sealed record IdeationDashboardOutcomeRow(
        int ChallengeId,
        string ChallengeTitle,
        string? WinningIdeaTitle,
        string ImplementationStatus,
        string? ImpactDescription,
        DateTime? UpdatedAt);

    private sealed class IdeationChallengeMetadata
    {
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("prize_description")] public string? PrizeDescription { get; set; }
        [JsonPropertyName("submission_deadline")] public DateTime? SubmissionDeadline { get; set; }
        [JsonPropertyName("voting_deadline")] public DateTime? VotingDeadline { get; set; }
        [JsonPropertyName("max_ideas_per_user")] public int? MaxIdeasPerUser { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("cover_image")] public string? CoverImage { get; set; }
        [JsonPropertyName("tags")] public string[] Tags { get; set; } = [];
    }

    private static object ProjectChallenge(Challenge challenge) => new
    {
        id = challenge.Id,
        title = challenge.Title,
        description = challenge.Description,
        challenge_type = challenge.ChallengeType.ToString().ToLowerInvariant(),
        target_action = challenge.TargetAction,
        target_count = challenge.TargetCount,
        xp_reward = challenge.XpReward,
        is_active = challenge.IsActive,
        difficulty = challenge.Difficulty.ToString().ToLowerInvariant(),
        participant_count = challenge.Participants?.Count ?? 0,
        starts_at = challenge.StartsAt,
        ends_at = challenge.EndsAt,
        created_at = challenge.CreatedAt
    };

    private static object MapAdminIdeationChallenge(Challenge challenge)
    {
        var ideasCount = challenge.Participants?.Count ?? 0;
        var status = MapAdminIdeationStatus(challenge);

        return new
        {
            id = challenge.Id,
            title = challenge.Title,
            description = challenge.Description,
            creator_name = string.Empty,
            first_name = (string?)null,
            last_name = (string?)null,
            ideas_count = ideasCount,
            status,
            start_date = challenge.StartsAt,
            end_date = challenge.EndsAt,
            starts_at = challenge.StartsAt,
            ends_at = challenge.EndsAt,
            submission_deadline = challenge.EndsAt,
            voting_deadline = challenge.EndsAt,
            challenge_type = challenge.ChallengeType.ToString().ToLowerInvariant(),
            difficulty = challenge.Difficulty.ToString().ToLowerInvariant(),
            target_action = challenge.TargetAction,
            target_count = challenge.TargetCount,
            xp_reward = challenge.XpReward,
            is_active = challenge.IsActive,
            participant_count = ideasCount,
            created_at = challenge.CreatedAt,
            updated_at = challenge.UpdatedAt
        };
    }

    private static string MapAdminIdeationStatus(Challenge challenge)
    {
        var now = DateTime.UtcNow;
        if (challenge.IsActive && challenge.StartsAt <= now && challenge.EndsAt >= now)
        {
            return "open";
        }

        if (!challenge.IsActive && challenge.StartsAt > now)
        {
            return "draft";
        }

        return "closed";
    }

    private static object MapAdminPoll(Poll poll)
    {
        var totalVotes = poll.Votes?.Count ?? 0;
        var closesAt = poll.ClosesAt;
        var creatorName = poll.CreatedBy == null
            ? string.Empty
            : string.Join(" ", new[] { poll.CreatedBy.FirstName, poll.CreatedBy.LastName }
                .Where(part => !string.IsNullOrWhiteSpace(part)));

        return new
        {
            id = poll.Id,
            title = poll.Title,
            question = poll.Title,
            description = poll.Description,
            poll_type = poll.PollType,
            status = string.Equals(poll.Status, "closed", StringComparison.OrdinalIgnoreCase) ? "ended" : poll.Status,
            is_active = !string.Equals(poll.Status, "closed", StringComparison.OrdinalIgnoreCase),
            end_date = closesAt,
            closes_at = closesAt,
            options = poll.Options
                .OrderBy(o => o.SortOrder)
                .ThenBy(o => o.Id)
                .Select(o =>
                {
                    var voteCount = poll.Votes?.Count(v => v.OptionId == o.Id) ?? 0;
                    return new
                    {
                        id = o.Id,
                        text = o.Text,
                        vote_count = voteCount,
                        percentage = totalVotes == 0 ? 0 : Math.Round(voteCount * 100m / totalVotes, 2)
                    };
                })
                .ToList(),
            total_votes = totalVotes,
            user = poll.CreatedBy == null
                ? null
                : new
                {
                    id = poll.CreatedBy.Id,
                    first_name = poll.CreatedBy.FirstName,
                    last_name = poll.CreatedBy.LastName,
                    name = string.IsNullOrWhiteSpace(creatorName) ? poll.CreatedBy.Email : creatorName
                },
            created_at = poll.CreatedAt,
            updated_at = poll.UpdatedAt
        };
    }

    private static object MapAdminResourceArticle(KnowledgeArticle article)
    {
        var updatedAt = article.UpdatedAt ?? article.CreatedAt;
        return new
        {
            id = article.Id,
            title = article.Title,
            category = article.Category ?? string.Empty,
            author_name = DisplayName(article.CreatedBy, "System"),
            views = article.ViewCount,
            helpful_votes = 0,
            status = article.IsPublished ? "published" : "draft",
            updated_at = updatedAt
        };
    }

    private static object MapAdminResourceArticleDetail(KnowledgeArticle article)
    {
        var updatedAt = article.UpdatedAt ?? article.CreatedAt;
        return new
        {
            id = article.Id,
            title = article.Title,
            slug = article.Slug,
            content = article.Content,
            category = article.Category ?? string.Empty,
            tags = string.IsNullOrWhiteSpace(article.Tags)
                ? Array.Empty<string>()
                : article.Tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            content_type = "article",
            is_published = article.IsPublished,
            views_count = article.ViewCount,
            helpful_yes = 0,
            author_name = DisplayName(article.CreatedBy, "System"),
            created_at = article.CreatedAt,
            updated_at = updatedAt,
            attachments = Array.Empty<object>()
        };
    }

    private static object MapAdminGoal(Goal goal) => new
    {
        id = goal.Id,
        title = goal.Title,
        description = goal.Description,
        user_id = goal.UserId,
        mentor_id = (int?)null,
        buddy_id = (int?)null,
        goal_type = goal.GoalType,
        target_value = goal.TargetValue ?? 0m,
        current_value = goal.CurrentValue,
        category = goal.Category,
        status = goal.Status,
        target_date = goal.TargetDate,
        completed_at = goal.CompletedAt,
        user = goal.User == null
            ? null
            : new
            {
                id = goal.User.Id,
                first_name = goal.User.FirstName,
                last_name = goal.User.LastName,
                name = DisplayName(goal.User, "Member")
            },
        milestones = goal.Milestones
            .OrderBy(m => m.SortOrder)
            .ThenBy(m => m.Id)
            .Select(m => new
            {
                id = m.Id,
                title = m.Title,
                is_completed = m.IsCompleted,
                completed_at = m.CompletedAt,
                sort_order = m.SortOrder,
                created_at = m.CreatedAt
            })
            .ToList(),
        created_at = goal.CreatedAt,
        updated_at = goal.UpdatedAt
    };

    private static string DisplayName(User? user, string fallback)
    {
        if (user == null)
        {
            return fallback;
        }

        var name = string.Join(" ", new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static object ProjectIdeationComment(IdeaComment comment)
    {
        var authorName = comment.User == null
            ? string.Empty
            : string.Join(" ", new[] { comment.User.FirstName, comment.User.LastName }
                .Where(part => !string.IsNullOrWhiteSpace(part)));

        return new
        {
            id = comment.Id,
            idea_id = comment.IdeaId,
            body = comment.Content,
            content = comment.Content,
            user_id = comment.UserId,
            author_id = comment.UserId,
            author_name = string.IsNullOrWhiteSpace(authorName) ? comment.User?.Email : authorName,
            user = comment.User == null ? null : new
            {
                id = comment.User.Id,
                first_name = comment.User.FirstName,
                last_name = comment.User.LastName,
                name = string.IsNullOrWhiteSpace(authorName) ? comment.User.Email : authorName,
                avatar_url = comment.User.AvatarUrl
            },
            created_at = comment.CreatedAt
        };
    }

    private static object ProjectIdeationIdeaMedia(IdeationIdeaMediaMetadata media) => new
    {
        id = media.Id,
        idea_id = media.IdeaId,
        media_type = media.MediaType,
        url = media.Url,
        caption = media.Caption,
        created_by = media.CreatedBy,
        created_at = media.CreatedAt
    };

    private static object ProjectIdea(Idea idea, bool hasVoted = false) => new
    {
        id = idea.Id,
        challenge_id = ChallengeIdFromIdea(idea),
        title = idea.Title,
        description = idea.Content,
        content = idea.Content,
        category = idea.Category,
        status = idea.Status,
        upvote_count = idea.UpvoteCount,
        votes_count = idea.UpvoteCount,
        comment_count = idea.CommentCount,
        comments_count = idea.CommentCount,
        has_voted = hasVoted,
        author = idea.Author == null ? null : new { id = idea.Author.Id, first_name = idea.Author.FirstName, last_name = idea.Author.LastName },
        created_at = idea.CreatedAt,
        updated_at = idea.UpdatedAt
    };

    private static object ProjectLegalDocument(LegalDocument document) => new
    {
        id = document.Id,
        title = document.Title,
        slug = document.Slug,
        content = document.Content,
        version = document.Version,
        is_active = document.IsActive,
        requires_acceptance = document.RequiresAcceptance,
        created_at = document.CreatedAt,
        updated_at = document.UpdatedAt
    };

    private static IActionResult BuildLinkPreviewResponse(string? url)
    {
        var normalized = string.IsNullOrWhiteSpace(url) ? null : url.Trim();
        if (string.IsNullOrWhiteSpace(normalized) ||
            !Uri.TryCreate(normalized, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            return new BadRequestObjectResult(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "A valid HTTP or HTTPS URL is required.", field = "url" }
                }
            });
        }

        return new OkObjectResult(new
        {
            success = true,
            data = new
            {
                url = parsed.AbsoluteUri,
                title = parsed.Host,
                description = parsed.AbsoluteUri,
                site_name = parsed.Host,
                image = (string?)null
            }
        });
    }

    private static Dictionary<string, object[]> BuildDefaultMenusByLocation() => new()
    {
        ["header-main"] = BuildDefaultMenus("header-main", "Main navigation", "default-main-nav"),
        ["header-secondary"] = BuildDefaultMenus("header-secondary", "Secondary navigation", "default-secondary-nav"),
        ["footer"] = BuildDefaultMenus("footer", "Footer navigation", "default-footer-nav"),
        ["sidebar"] = BuildDefaultMenus("sidebar", "Sidebar navigation", "default-sidebar-nav"),
        ["mobile"] = BuildDefaultMenus("mobile", "Mobile navigation", "default-mobile-nav")
    };

    private static object[] BuildDefaultMenus(string location, string name, string slug) =>
    [
        new
        {
            id = slug,
            name,
            slug,
            location,
            is_active = 1,
            items = Array.Empty<object>()
        }
    ];

    private static string? ReadString(JsonElement body, string propertyName)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(propertyName, out var property))
            return null;
        return property.ValueKind == JsonValueKind.String ? property.GetString() : property.ToString();
    }

    private async Task<string> VolunteerOrganisationBaseUrlAsync(
        int tenantId,
        CancellationToken cancellationToken)
    {
        var domain = await _db.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(cancellationToken);
        return string.IsNullOrWhiteSpace(domain)
            ? $"{Request.Scheme}://{Request.Host}".TrimEnd('/')
            : domain.TrimEnd('/');
    }

    private static int? DecodeVolunteerOrganisationCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor))
        {
            return null;
        }

        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out var id) && id > 0 ? id : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static List<int> ReadIntList(JsonElement body, params string[] propertyNames)
    {
        var values = new List<int>();
        if (body.ValueKind != JsonValueKind.Object)
            return values;

        foreach (var name in propertyNames)
        {
            if (!body.TryGetProperty(name, out var property))
                continue;

            if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var single))
                values.Add(single);
            else if (property.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in property.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var value))
                        values.Add(value);
                }
            }
        }

        return values;
    }
}

public sealed record IdentityProviderOptionDto(
    string id,
    string slug,
    string name,
    string[] levels,
    bool available,
    bool has_credentials,
    bool enabled);

public class ReactRegistrationPolicyRequest
{
    [JsonPropertyName("registration_mode")]
    public string? RegistrationMode { get; set; }

    [JsonPropertyName("verification_provider")]
    public string? VerificationProvider { get; set; }

    [JsonPropertyName("verification_level")]
    public string? VerificationLevel { get; set; }

    [JsonPropertyName("post_verification")]
    public string? PostVerification { get; set; }

    [JsonPropertyName("fallback_mode")]
    public string? FallbackMode { get; set; }

    [JsonPropertyName("require_email_verify")]
    public bool? RequireEmailVerify { get; set; }
}

public class ProviderCredentialRequest
{
    [JsonPropertyName("api_key")]
    public string? ApiKey { get; set; }

    [JsonPropertyName("webhook_secret")]
    public string? WebhookSecret { get; set; }
}

public class ValidateInviteRequest
{
    [JsonPropertyName("code")]
    public string? Code { get; set; }
}

public class ConnectionRequestAliasRequest
{
    [JsonPropertyName("user_id")]
    public int? UserId { get; set; }

    [JsonPropertyName("target_user_id")]
    public int? TargetUserId { get; set; }
}
