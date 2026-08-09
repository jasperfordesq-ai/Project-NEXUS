// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Manages email templates, sending, logging, and digest preferences.
/// </summary>
public class EmailNotificationService
{
    private readonly NexusDbContext _db;
    private readonly IEmailService _emailService;
    private readonly ILogger<EmailNotificationService> _logger;

    public EmailNotificationService(NexusDbContext db, IEmailService emailService, ILogger<EmailNotificationService> logger)
    {
        _db = db;
        _emailService = emailService;
        _logger = logger;
    }

    /// <summary>
    /// Send a templated email to a user.
    /// </summary>
    public async Task<bool> SendTemplatedEmailAsync(
        int userId,
        string templateKey,
        Dictionary<string, string> placeholders,
        int? tenantId = null)
    {
        IQueryable<User> users = _db.Users;
        if (tenantId.HasValue)
        {
            users = users
                .IgnoreQueryFilters()
                .Where(user => user.TenantId == tenantId.Value);
        }

        var user = await users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return false;

        IQueryable<EmailTemplate> templates = _db.Set<EmailTemplate>();
        if (tenantId.HasValue)
        {
            templates = templates
                .IgnoreQueryFilters()
                .Where(template => template.TenantId == tenantId.Value);
        }

        var template = await templates
            .FirstOrDefaultAsync(t => t.Key == templateKey && t.IsActive);

        string subject;
        string body;

        if (template != null)
        {
            subject = ReplacePlaceholders(template.Subject, placeholders);
            body = ReplacePlaceholders(template.BodyHtml, placeholders);
        }
        else
        {
            var volunteerFallback = await BuildVolunteerFallbackAsync(user, templateKey, placeholders);
            if (volunteerFallback is not null)
            {
                subject = volunteerFallback.Subject;
                body = volunteerFallback.HtmlBody;
            }
            else
            {
                subject = $"Notification: {templateKey}";
                body = string.Join("<br>", placeholders.Select(p => $"{p.Key}: {p.Value}"));
            }
        }

        var log = new EmailLog
        {
            TenantId = user.TenantId,
            UserId = userId,
            ToEmail = user.Email,
            Subject = subject,
            TemplateKey = templateKey,
            Status = EmailSendStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<EmailLog>().Add(log);
        await _db.SaveChangesAsync();

        try
        {
            await _emailService.SendEmailAsync(user.Email, subject, body);
            log.Status = EmailSendStatus.Sent;
            log.SentAt = DateTime.UtcNow;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            log.Status = EmailSendStatus.Failed;
            log.ErrorMessage = ex.Message;
            log.RetryCount++;
            _logger.LogError(ex, "Failed to send email {TemplateKey} to user {UserId}", templateKey, userId);
        }

        await _db.SaveChangesAsync();
        return log.Status == EmailSendStatus.Sent;
    }

    /// <summary>
    /// Sends the immediate email for a reviewed volunteer-hours entry. Active
    /// tenant templates take precedence over the built-in Laravel-compatible
    /// fallbacks. Approved entries use <paramref name="paymentOutcome"/> to
    /// distinguish a paid approval, a sub-hour approval with no credit, and a
    /// credit-neutral generic approval.
    /// </summary>
    public async Task<bool> SendVolunteerHoursDecisionEmailAsync(
        int userId,
        int tenantId,
        string decision,
        decimal hours,
        string organizationName,
        string? paymentOutcome = null)
    {
        var normalizedDecision = decision.Trim().ToLowerInvariant();
        if (normalizedDecision is not ("approved" or "declined"))
        {
            throw new ArgumentOutOfRangeException(
                nameof(decision),
                decision,
                "Volunteer-hours email decision must be approved or declined.");
        }

        var userName = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == userId && user.TenantId == tenantId)
            .Select(user => user.FirstName)
            .SingleOrDefaultAsync();
        if (userName is null)
        {
            return false;
        }

        var normalizedHours = decimal.Round(hours, 2, MidpointRounding.AwayFromZero);
        var hoursText = normalizedHours.ToString("0.##", CultureInfo.InvariantCulture);
        var creditedHoursText = decimal.Floor(normalizedHours)
            .ToString("0", CultureInfo.InvariantCulture);
        var hoursUrl = await ResolveTenantUrlAsync(tenantId, "/volunteering?tab=hours");
        var walletUrl = await ResolveTenantUrlAsync(tenantId, "/wallet");

        var templateKey = normalizedDecision == "declined"
            ? "vol_hours_declined"
            : paymentOutcome == "paid"
                ? "vol_hours_approved_paid"
                : paymentOutcome is "no_whole_hours" or "no_payable_hours"
                    ? "vol_hours_approved_no_credit"
                    : "vol_hours_approved";
        var actionUrl = templateKey == "vol_hours_approved_paid" ? walletUrl : hoursUrl;

        return await SendTemplatedEmailAsync(
            userId,
            templateKey,
            new Dictionary<string, string>
            {
                ["user_name"] = WebUtility.HtmlEncode(
                    string.IsNullOrWhiteSpace(userName) ? "Volunteer" : userName),
                ["organization_name"] = WebUtility.HtmlEncode(
                    string.IsNullOrWhiteSpace(organizationName) ? "the organisation" : organizationName),
                ["org_name"] = WebUtility.HtmlEncode(
                    string.IsNullOrWhiteSpace(organizationName) ? "the organisation" : organizationName),
                ["hours"] = hoursText,
                ["credited_hours"] = creditedHoursText,
                ["decision"] = normalizedDecision,
                ["payment_outcome"] = paymentOutcome ?? string.Empty,
                ["action_url"] = actionUrl,
                ["volunteering_url"] = hoursUrl,
                ["wallet_url"] = walletUrl
            },
            tenantId);
    }

    /// <summary>
    /// Send exchange-related notification.
    /// </summary>
    public async Task SendExchangeNotificationAsync(int userId, string action, int exchangeId, string listingTitle, string otherUserName)
    {
        await SendTemplatedEmailAsync(userId, $"exchange_{action}", new Dictionary<string, string>
        {
            ["user_name"] = (await _db.Users.FirstOrDefaultAsync(x => x.Id == userId))?.FirstName ?? "User",
            ["exchange_id"] = exchangeId.ToString(),
            ["listing_title"] = listingTitle,
            ["other_user"] = otherUserName,
            ["action"] = action
        });
    }

    // === Templates ===

    public async Task<List<EmailTemplate>> GetTemplatesAsync()
    {
        return await _db.Set<EmailTemplate>()
            .OrderBy(t => t.Key)
            .ToListAsync();
    }

    public async Task<EmailTemplate?> GetTemplateAsync(string key)
    {
        return await _db.Set<EmailTemplate>()
            .FirstOrDefaultAsync(t => t.Key == key);
    }

    public async Task<EmailTemplate> UpsertTemplateAsync(string key, string subject, string bodyHtml, string? bodyText)
    {
        var existing = await _db.Set<EmailTemplate>()
            .FirstOrDefaultAsync(t => t.Key == key);

        if (existing != null)
        {
            existing.Subject = subject;
            existing.BodyHtml = bodyHtml;
            existing.BodyText = bodyText;
            existing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return existing;
        }

        var template = new EmailTemplate
        {
            Key = key,
            Subject = subject,
            BodyHtml = bodyHtml,
            BodyText = bodyText,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<EmailTemplate>().Add(template);
        await _db.SaveChangesAsync();
        return template;
    }

    // === Digest Preferences ===

    public async Task<DigestPreference> GetDigestPreferenceAsync(int userId)
    {
        var pref = await _db.Set<DigestPreference>()
            .FirstOrDefaultAsync(p => p.UserId == userId);

        if (pref != null) return pref;

        // Return default
        return new DigestPreference
        {
            UserId = userId,
            Frequency = DigestFrequency.Weekly
        };
    }

    public async Task<DigestPreference> UpdateDigestPreferenceAsync(
        int userId, DigestFrequency frequency, bool? newListings, bool? exchangeUpdates,
        bool? groupActivity, bool? eventReminders, bool? communityHighlights)
    {
        var pref = await _db.Set<DigestPreference>()
            .FirstOrDefaultAsync(p => p.UserId == userId);

        if (pref == null)
        {
            pref = new DigestPreference { UserId = userId };
            _db.Set<DigestPreference>().Add(pref);
        }

        pref.Frequency = frequency;
        if (newListings.HasValue) pref.IncludeNewListings = newListings.Value;
        if (exchangeUpdates.HasValue) pref.IncludeExchangeUpdates = exchangeUpdates.Value;
        if (groupActivity.HasValue) pref.IncludeGroupActivity = groupActivity.Value;
        if (eventReminders.HasValue) pref.IncludeEventReminders = eventReminders.Value;
        if (communityHighlights.HasValue) pref.IncludeCommunityHighlights = communityHighlights.Value;
        pref.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return pref;
    }

    // === Email Logs ===

    public async Task<(List<EmailLog> Logs, int Total)> GetEmailLogsAsync(int? userId, string? templateKey, int page, int limit)
    {
        var query = _db.Set<EmailLog>().AsQueryable();

        if (userId.HasValue) query = query.Where(l => l.UserId == userId.Value);
        if (!string.IsNullOrEmpty(templateKey)) query = query.Where(l => l.TemplateKey == templateKey);

        var total = await query.CountAsync();

        var logs = await query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (logs, total);
    }

    private static string ReplacePlaceholders(string template, Dictionary<string, string> placeholders)
    {
        var result = template;
        foreach (var (key, value) in placeholders)
        {
            result = result.Replace($"{{{{{key}}}}}", value);
        }
        return result;
    }

    private async Task<VolunteerFallbackContent?> BuildVolunteerFallbackAsync(
        User user,
        string templateKey,
        IReadOnlyDictionary<string, string> placeholders)
    {
        var approved = templateKey is "volunteer_application_approved" or "vol_application_approved";
        var declined = templateKey == "vol_application_declined";
        var waitlistSpot = templateKey == "vol_waitlist_spot";
        var hoursApprovedPaid = templateKey == "vol_hours_approved_paid";
        var hoursApprovedNoCredit = templateKey == "vol_hours_approved_no_credit";
        var hoursApproved = templateKey == "vol_hours_approved";
        var hoursDeclined = templateKey == "vol_hours_declined";
        var badgeEarned = templateKey == "badge_earned";
        if (!approved
            && !declined
            && !waitlistSpot
            && !hoursApprovedPaid
            && !hoursApprovedNoCredit
            && !hoursApproved
            && !hoursDeclined
            && !badgeEarned)
        {
            return null;
        }

        var userName = SafeHtml(ValueOrDefault(
            placeholders,
            "user_name",
            string.IsNullOrWhiteSpace(user.FirstName) ? "Volunteer" : user.FirstName));
        var opportunityTitle = SafeHtml(ValueOrDefault(placeholders, "opportunity_title", "the opportunity"));
        var requestedLink = ValueOrDefault(placeholders, "volunteering_url", "/volunteering");
        var volunteeringUrl = await ResolveTenantUrlAsync(user.TenantId, requestedLink);
        var safeUrl = WebUtility.HtmlEncode(volunteeringUrl);
        var organizationNote = SafeHtml(ValueOrDefault(placeholders, "org_note", string.Empty));

        if (badgeEarned)
        {
            var badgeName = SafeHtml(ValueOrDefault(placeholders, "badge_name", "Achievement"));
            var badgeIcon = SafeHtml(ValueOrDefault(placeholders, "badge_icon", string.Empty));
            var profileUrl = await ResolveTenantUrlAsync(
                user.TenantId,
                ValueOrDefault(placeholders, "profile_url", "/profile"));
            return new VolunteerFallbackContent(
                $"Badge earned: {badgeName}",
                $"<p>Hello {userName},</p>" +
                $"<p>{badgeIcon} You earned the <strong>{badgeName}</strong> badge.</p>" +
                $"<p><a href=\"{WebUtility.HtmlEncode(profileUrl)}\">View my profile</a></p>");
        }

        if (hoursApprovedPaid || hoursApprovedNoCredit || hoursApproved || hoursDeclined)
        {
            var organizationName = SafeHtml(ValueOrDefault(
                placeholders,
                "organization_name",
                ValueOrDefault(placeholders, "org_name", "the organisation")));
            var hours = SafeHtml(ValueOrDefault(placeholders, "hours", "0"));
            var creditedHours = SafeHtml(ValueOrDefault(placeholders, "credited_hours", "0"));
            var actionUrl = await ResolveTenantUrlAsync(
                user.TenantId,
                ValueOrDefault(
                    placeholders,
                    "action_url",
                    hoursApprovedPaid ? "/wallet" : "/volunteering?tab=hours"));
            var safeActionUrl = WebUtility.HtmlEncode(actionUrl);

            if (hoursApprovedPaid)
            {
                var creditLabel = creditedHours == "1" ? "time credit" : "time credits";
                return new VolunteerFallbackContent(
                    "Volunteer hours approved and credits paid",
                    $"<p>Hello {userName},</p>" +
                    $"<p>Your volunteer hours with <strong>{organizationName}</strong> have been verified and approved.</p>" +
                    $"<p><strong>{hours}h</strong> approved; <strong>{creditedHours}</strong> {creditLabel} added to your wallet.</p>" +
                    $"<p><a href=\"{safeActionUrl}\">View my wallet</a></p>");
            }

            if (hoursApprovedNoCredit)
            {
                return new VolunteerFallbackContent(
                    "Volunteer hours approved",
                    $"<p>Hello {userName},</p>" +
                    $"<p>Your <strong>{hours}h</strong> volunteering log with <strong>{organizationName}</strong> has been verified and approved.</p>" +
                    "<p>As this was under a whole hour, no time credit was added to your wallet.</p>" +
                    $"<p><a href=\"{safeActionUrl}\">View my hours</a></p>");
            }

            if (hoursApproved)
            {
                return new VolunteerFallbackContent(
                    "Volunteer hours approved",
                    $"<p>Hello {userName},</p>" +
                    $"<p>Your <strong>{hours}h</strong> volunteering log with <strong>{organizationName}</strong> has been verified and approved.</p>" +
                    "<p>Thank you for your valuable contribution to the community.</p>" +
                    $"<p><a href=\"{safeActionUrl}\">View my hours</a></p>");
            }

            return new VolunteerFallbackContent(
                "Update on your volunteer hours",
                $"<p>Hello {userName},</p>" +
                $"<p>Your <strong>{hours}h</strong> volunteering log with <strong>{organizationName}</strong> was not approved.</p>" +
                "<p>This may be due to a discrepancy in the hours recorded. If you believe this is an error, please contact the organisation directly to discuss.</p>" +
                $"<p><a href=\"{safeActionUrl}\">View my hours</a></p>");
        }

        if (waitlistSpot)
        {
            return new VolunteerFallbackContent(
                "Volunteer shift spot available",
                $"<p>Hello {userName},</p>" +
                "<p>A place has opened on a volunteer shift you joined the waitlist for. " +
                "Claim it soon, before the offer expires.</p>" +
                $"<p><a href=\"{safeUrl}\">Claim your volunteer shift place</a></p>");
        }

        // These explicit English fallbacks prevent production emails from
        // degrading to a debug key/value dump when tenant templates are absent.
        // Localized built-in fallbacks remain a documented localization residual;
        // tenant-authored active templates still take precedence above.
        if (approved)
        {
            return new VolunteerFallbackContent(
                "Your volunteer application was approved",
                $"<p>Hello {userName},</p>" +
                $"<p>Your volunteer application for <strong>{opportunityTitle}</strong> has been approved.</p>" +
                $"<p><a href=\"{safeUrl}\">View volunteering details</a></p>");
        }

        var noteParagraph = string.IsNullOrWhiteSpace(organizationNote)
            ? string.Empty
            : $"<p><strong>Note from the organiser:</strong> {organizationNote}</p>";
        return new VolunteerFallbackContent(
            "Update on your volunteer application",
            $"<p>Hello {userName},</p>" +
            $"<p>Your volunteer application for <strong>{opportunityTitle}</strong> was not accepted.</p>" +
            noteParagraph +
            $"<p><a href=\"{safeUrl}\">View volunteering details</a></p>");
    }

    private async Task<string> ResolveTenantUrlAsync(int tenantId, string requestedLink)
    {
        if (Uri.TryCreate(requestedLink, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https")
        {
            return absolute.ToString();
        }

        var tenant = await _db.Tenants
            .AsNoTracking()
            .Where(candidate => candidate.Id == tenantId)
            .Select(candidate => new { candidate.Slug, candidate.Domain })
            .SingleOrDefaultAsync();

        var origin = !string.IsNullOrWhiteSpace(tenant?.Domain)
            ? NormalizeTenantDomain(tenant!.Domain!)
            : !string.IsNullOrWhiteSpace(tenant?.Slug)
                ? $"https://app.project-nexus.ie/{Uri.EscapeDataString(tenant!.Slug)}"
                : "https://app.project-nexus.ie";

        return $"{origin.TrimEnd('/')}/{requestedLink.TrimStart('/')}";
    }

    private static string NormalizeTenantDomain(string domain)
    {
        var trimmed = domain.Trim().TrimEnd('/');
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https"
                ? absolute.ToString().TrimEnd('/')
                : $"https://{trimmed}";
    }

    private static string ValueOrDefault(
        IReadOnlyDictionary<string, string> values,
        string key,
        string fallback) =>
        values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : fallback;

    private static string SafeHtml(string value) =>
        WebUtility.HtmlEncode(WebUtility.HtmlDecode(value));

    private sealed record VolunteerFallbackContent(string Subject, string HtmlBody);
}
