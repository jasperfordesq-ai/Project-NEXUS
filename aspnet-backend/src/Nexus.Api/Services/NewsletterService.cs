// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for newsletter management and subscription handling.
/// Phase 31: Newsletter system.
/// </summary>
public class NewsletterService
{
    private static readonly Regex ScriptLikeBlockRegex = new(
        "<(script|iframe|frame|frameset|object|embed|applet|form|select|textarea|button)\\b[^>]*>.*?</\\1\\s*>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex ScriptLikeTagRegex = new(
        "</?(script|iframe|frame|frameset|object|embed|applet|form|select|textarea|button|base|input)\\b[^>]*/?>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex EventHandlerRegex = new(
        "\\s+on[a-z]+\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex DangerousHrefRegex = new(
        "(href|src|action|background|poster|formaction|xlink:href)\\s*=\\s*([\"']?)\\s*(javascript:|vbscript:|data:text/html)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HtmlTagRegex = new("<[^>]+>", RegexOptions.Compiled);
    private static readonly HashSet<string> PreviewContentFormats = new(StringComparer.OrdinalIgnoreCase)
    {
        "plaintext",
        "richtext",
        "html",
        "builder"
    };
    private const int MaxPreviewContentBytes = 524_288;

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<NewsletterService> _logger;

    public NewsletterService(
        NexusDbContext db,
        TenantContext tenantContext,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<NewsletterService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Create a new newsletter draft.
    /// </summary>
    public async Task<Newsletter> CreateNewsletterAsync(
        int adminId,
        string subject,
        string contentHtml,
        string? contentText = null,
        DateTime? scheduledAt = null)
    {
        var newsletter = new Newsletter
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            Subject = subject,
            ContentHtml = contentHtml,
            ContentText = contentText,
            Status = scheduledAt.HasValue ? NewsletterStatus.Scheduled : NewsletterStatus.Draft,
            ScheduledAt = scheduledAt,
            CreatedById = adminId,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<Newsletter>().Add(newsletter);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Newsletter {NewsletterId} created by admin {AdminId} in tenant {TenantId}",
            newsletter.Id, adminId, newsletter.TenantId);

        return newsletter;
    }

    /// <summary>
    /// Update a newsletter (only if Draft or Scheduled).
    /// </summary>
    public async Task<Newsletter?> UpdateNewsletterAsync(
        int id,
        string? subject = null,
        string? contentHtml = null,
        string? contentText = null,
        DateTime? scheduledAt = null)
    {
        var newsletter = await _db.Set<Newsletter>()
            .FirstOrDefaultAsync(n => n.Id == id);

        if (newsletter == null) return null;

        if (newsletter.Status != NewsletterStatus.Draft && newsletter.Status != NewsletterStatus.Scheduled)
        {
            throw new InvalidOperationException(
                $"Cannot update newsletter in {newsletter.Status} status. Only Draft or Scheduled newsletters can be edited.");
        }

        if (subject != null) newsletter.Subject = subject;
        if (contentHtml != null) newsletter.ContentHtml = contentHtml;
        if (contentText != null) newsletter.ContentText = contentText;

        if (scheduledAt.HasValue)
        {
            newsletter.ScheduledAt = scheduledAt;
            newsletter.Status = NewsletterStatus.Scheduled;
        }

        newsletter.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Newsletter {NewsletterId} updated", id);
        return newsletter;
    }

    /// <summary>
    /// List newsletters with optional status filter and pagination.
    /// </summary>
    public async Task<(List<Newsletter> Items, int Total)> GetNewslettersAsync(
        NewsletterStatus? status = null,
        int page = 1,
        int limit = 20)
    {
        var query = _db.Set<Newsletter>()
            .AsNoTracking()
            .Include(n => n.CreatedBy)
            .AsQueryable();

        if (status.HasValue)
        {
            query = query.Where(n => n.Status == status.Value);
        }

        var total = await query.CountAsync();

        var items = await query
            .OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (items, total);
    }

    /// <summary>
    /// Get a single newsletter by ID.
    /// </summary>
    public async Task<Newsletter?> GetNewsletterAsync(int id)
    {
        return await _db.Set<Newsletter>()
            .AsNoTracking()
            .Include(n => n.CreatedBy)
            .FirstOrDefaultAsync(n => n.Id == id);
    }

    /// <summary>
    /// Send a newsletter. Marks as Sending and counts active subscribers as recipients.
    /// </summary>
    public async Task<Newsletter?> SendNewsletterAsync(int id)
    {
        var newsletter = await _db.Set<Newsletter>()
            .FirstOrDefaultAsync(n => n.Id == id);

        if (newsletter == null) return null;

        if (newsletter.Status != NewsletterStatus.Draft && newsletter.Status != NewsletterStatus.Scheduled)
        {
            throw new InvalidOperationException(
                $"Cannot send newsletter in {newsletter.Status} status. Only Draft or Scheduled newsletters can be sent.");
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var recipientCount = await _db.Set<NewsletterSubscription>()
            .CountAsync(s => s.TenantId == tenantId && s.IsSubscribed);

        await QueueNewsletterLogsAsync(newsletter);

        newsletter.Status = NewsletterStatus.Queued;
        newsletter.RecipientCount = recipientCount;
        newsletter.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        if (GetEmailProviderStatus().Configured)
        {
            await ProcessQueuedNewsletterLogsAsync(newsletter.Id);
            await _db.Entry(newsletter).ReloadAsync();
        }

        _logger.LogInformation(
            "Newsletter {NewsletterId} queued for {RecipientCount} recipients in tenant {TenantId}",
            id, recipientCount, tenantId);

        return newsletter;
    }

    /// <summary>
    /// Queue a previously queued/sent newsletter for another dispatch attempt.
    /// </summary>
    public async Task<Newsletter?> ResendNewsletterAsync(int id)
    {
        var newsletter = await _db.Set<Newsletter>()
            .FirstOrDefaultAsync(n => n.Id == id);

        if (newsletter == null) return null;

        if (newsletter.Status is NewsletterStatus.Draft or NewsletterStatus.Scheduled or NewsletterStatus.Cancelled)
        {
            throw new InvalidOperationException(
                $"Cannot resend newsletter in {newsletter.Status} status. Send it once before resending.");
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var recipientCount = await CountRecipientsAsync(true);

        await QueueNewsletterLogsAsync(newsletter);

        newsletter.Status = NewsletterStatus.Queued;
        newsletter.RecipientCount = recipientCount;
        newsletter.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        if (GetEmailProviderStatus().Configured)
        {
            await ProcessQueuedNewsletterLogsAsync(newsletter.Id);
            await _db.Entry(newsletter).ReloadAsync();
        }

        _logger.LogInformation(
            "Newsletter {NewsletterId} re-queued for {RecipientCount} recipients in tenant {TenantId}",
            id, recipientCount, tenantId);

        return newsletter;
    }

    /// <summary>
    /// Cancel a scheduled newsletter.
    /// </summary>
    public async Task<Newsletter?> CancelNewsletterAsync(int id)
    {
        var newsletter = await _db.Set<Newsletter>()
            .FirstOrDefaultAsync(n => n.Id == id);

        if (newsletter == null) return null;

        if (newsletter.Status != NewsletterStatus.Draft && newsletter.Status != NewsletterStatus.Scheduled)
        {
            throw new InvalidOperationException(
                $"Cannot cancel newsletter in {newsletter.Status} status.");
        }

        newsletter.Status = NewsletterStatus.Cancelled;
        newsletter.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Newsletter {NewsletterId} cancelled", id);
        return newsletter;
    }

    /// <summary>
    /// Subscribe an email to the newsletter.
    /// If the email already exists, re-subscribes it.
    /// </summary>
    public async Task<NewsletterSubscription> SubscribeAsync(
        string email,
        int? userId = null,
        string? source = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var normalizedEmail = email.Trim().ToLowerInvariant();

        var existing = await _db.Set<NewsletterSubscription>()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Email == normalizedEmail);

        if (existing != null)
        {
            if (!existing.IsSubscribed)
            {
                existing.IsSubscribed = true;
                existing.SubscribedAt = DateTime.UtcNow;
                existing.UnsubscribedAt = null;
                existing.Source = source ?? existing.Source;
                if (userId.HasValue) existing.UserId = userId;
                await _db.SaveChangesAsync();

                _logger.LogInformation(
                    "Email {Email} re-subscribed to newsletter in tenant {TenantId}",
                    normalizedEmail, tenantId);
            }
            return existing;
        }

        var subscription = new NewsletterSubscription
        {
            TenantId = tenantId,
            UserId = userId,
            Email = normalizedEmail,
            IsSubscribed = true,
            SubscribedAt = DateTime.UtcNow,
            Source = source ?? "manual",
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<NewsletterSubscription>().Add(subscription);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Email {Email} subscribed to newsletter in tenant {TenantId}",
            normalizedEmail, tenantId);

        return subscription;
    }

    /// <summary>
    /// Unsubscribe an email from the newsletter.
    /// </summary>
    public async Task<bool> UnsubscribeAsync(string email)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var normalizedEmail = email.Trim().ToLowerInvariant();

        var subscription = await _db.Set<NewsletterSubscription>()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Email == normalizedEmail);

        if (subscription == null) return false;

        subscription.IsSubscribed = false;
        subscription.UnsubscribedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Email {Email} unsubscribed from newsletter in tenant {TenantId}",
            normalizedEmail, tenantId);

        return true;
    }

    /// <summary>
    /// List newsletter subscribers with pagination.
    /// </summary>
    public async Task<(List<NewsletterSubscription> Items, int Total)> GetSubscribersAsync(
        int page = 1,
        int limit = 20,
        bool? subscribedOnly = null)
    {
        var query = _db.Set<NewsletterSubscription>()
            .AsNoTracking()
            .AsQueryable();

        if (subscribedOnly == true)
        {
            query = query.Where(s => s.IsSubscribed);
        }
        else if (subscribedOnly == false)
        {
            query = query.Where(s => !s.IsSubscribed);
        }

        var total = await query.CountAsync();

        var items = await query
            .OrderByDescending(s => s.SubscribedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (items, total);
    }

    public async Task<ImportSubscribersResult> ImportSubscribersAsync(IEnumerable<ImportSubscriberInput> subscribers)
    {
        var result = new ImportSubscribersResult();

        foreach (var subscriber in subscribers)
        {
            var email = subscriber.Email?.Trim();
            if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            {
                result.Skipped++;
                continue;
            }

            var before = await _db.Set<NewsletterSubscription>()
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Email == email.ToLowerInvariant());

            await SubscribeAsync(email, subscriber.UserId, subscriber.Source ?? "import");

            if (before == null)
                result.Imported++;
            else
                result.Updated++;
        }

        return result;
    }

    public async Task<List<NewsletterSubscriberExport>> ExportSubscribersAsync(bool? subscribed = null)
    {
        var query = _db.Set<NewsletterSubscription>()
            .AsNoTracking()
            .AsQueryable();

        if (subscribed.HasValue)
            query = query.Where(s => s.IsSubscribed == subscribed.Value);

        return await query
            .OrderBy(s => s.Email)
            .Select(s => new NewsletterSubscriberExport
            {
                Id = s.Id,
                Email = s.Email,
                UserId = s.UserId,
                IsSubscribed = s.IsSubscribed,
                Source = s.Source,
                SubscribedAt = s.SubscribedAt,
                UnsubscribedAt = s.UnsubscribedAt
            })
            .ToListAsync();
    }

    public async Task<SyncSubscribersResult> SyncMembersAsSubscribersAsync()
    {
        var users = await _db.Set<User>()
            .AsNoTracking()
            .Where(u => u.IsActive && u.Email != "")
            .Select(u => new { u.Id, u.Email })
            .ToListAsync();

        var result = new SyncSubscribersResult { EligibleMembers = users.Count };

        foreach (var user in users)
        {
            var existing = await _db.Set<NewsletterSubscription>()
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Email == user.Email.ToLowerInvariant());

            await SubscribeAsync(user.Email, user.Id, "member_sync");

            if (existing == null)
                result.Created++;
            else
                result.Updated++;
        }

        return result;
    }

    public async Task<int> CountRecipientsAsync(bool activeOnly = true)
    {
        var query = _db.Set<NewsletterSubscription>().AsNoTracking();
        if (activeOnly)
            query = query.Where(s => s.IsSubscribed);
        return await query.CountAsync();
    }

    public async Task<NewsletterPreviewRenderResult> RenderPreviewAsync(
        int? adminUserId,
        string subject,
        string previewText,
        string content,
        string contentFormat,
        CancellationToken ct = default)
    {
        if (!PreviewContentFormats.Contains(contentFormat))
            throw new ArgumentException("invalid_content_format", nameof(contentFormat));

        if (System.Text.Encoding.UTF8.GetByteCount(content) > MaxPreviewContentBytes)
            throw new ArgumentException("newsletter_content_too_large", nameof(content));

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var tenantName = await _db.Set<Tenant>()
            .AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => t.Name)
            .FirstOrDefaultAsync(ct) ?? "Community";

        var admin = adminUserId.HasValue
            ? await _db.Set<User>()
                .AsNoTracking()
                .Where(u => u.Id == adminUserId.Value && u.TenantId == tenantId)
                .Select(u => new { u.Email, u.FirstName, u.LastName })
                .FirstOrDefaultAsync(ct)
            : null;

        var firstName = string.IsNullOrWhiteSpace(admin?.FirstName) ? "there" : admin.FirstName;
        var lastName = admin?.LastName ?? string.Empty;
        var name = string.Join(' ', new[] { admin?.FirstName, admin?.LastName }.Where(v => !string.IsNullOrWhiteSpace(v)));
        if (string.IsNullOrWhiteSpace(name)) name = "Member";

        var sanitized = SanitizePreviewContent(content, contentFormat);
        var personalized = PersonalizePreviewContent(sanitized, tenantName, firstName, lastName, name, contentFormat);
        var htmlBody = contentFormat.Equals("plaintext", StringComparison.OrdinalIgnoreCase)
            ? $"<p>{WebUtility.HtmlEncode(personalized).Replace("\n", "<br />", StringComparison.Ordinal)}</p>"
            : personalized;

        var html = RenderPreviewHtml(subject, previewText, tenantName, htmlBody);
        var text = RenderPreviewText(subject, previewText, tenantName, personalized, contentFormat);

        return new NewsletterPreviewRenderResult(html, text, subject);
    }

    private static string RenderPreviewHtml(string subject, string previewText, string tenantName, string htmlBody)
    {
        var preheader = string.IsNullOrWhiteSpace(previewText)
            ? string.Empty
            : $"<div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;\">{WebUtility.HtmlEncode(previewText)}</div>";

        return $"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{WebUtility.HtmlEncode(subject)}</title>
</head>
<body>
  {preheader}
  <main>
    {htmlBody}
  </main>
  <footer>
    <p>{WebUtility.HtmlEncode(tenantName)}</p>
    <p><a href="/newsletter/unsubscribe?token=preview-token">Unsubscribe</a></p>
  </footer>
</body>
</html>
""";
    }

    private static string RenderPreviewText(
        string subject,
        string previewText,
        string tenantName,
        string content,
        string contentFormat)
    {
        var body = contentFormat.Equals("plaintext", StringComparison.OrdinalIgnoreCase)
            ? content
            : WebUtility.HtmlDecode(HtmlTagRegex.Replace(content, " "));

        var lines = new[]
        {
            subject,
            previewText,
            NormalizeWhitespace(body),
            tenantName,
            "Unsubscribe: /newsletter/unsubscribe?token=preview-token"
        };

        return string.Join("\n\n", lines.Where(line => !string.IsNullOrWhiteSpace(line))).Trim();
    }

    private static string PersonalizePreviewContent(
        string content,
        string tenantName,
        string firstName,
        string lastName,
        string name,
        string contentFormat)
    {
        string Escape(string value) => contentFormat.Equals("plaintext", StringComparison.OrdinalIgnoreCase)
            ? value
            : WebUtility.HtmlEncode(value);

        return content
            .Replace("{{first_name}}", Escape(firstName), StringComparison.Ordinal)
            .Replace("{{last_name}}", Escape(lastName), StringComparison.Ordinal)
            .Replace("{{name}}", Escape(name), StringComparison.Ordinal)
            .Replace("{{tenant_name}}", Escape(tenantName), StringComparison.Ordinal)
            .Replace("{{unsubscribe_link}}", contentFormat.Equals("plaintext", StringComparison.OrdinalIgnoreCase)
                ? "/newsletter/unsubscribe?token=preview-token"
                : "<a href=\"/newsletter/unsubscribe?token=preview-token\">Unsubscribe</a>", StringComparison.Ordinal)
            .Replace("{{unsubscribe_url}}", "/newsletter/unsubscribe?token=preview-token", StringComparison.Ordinal);
    }

    private static string SanitizePreviewContent(string content, string contentFormat)
    {
        if (contentFormat.Equals("plaintext", StringComparison.OrdinalIgnoreCase))
            return content;

        var sanitized = ScriptLikeBlockRegex.Replace(content, string.Empty);
        sanitized = ScriptLikeTagRegex.Replace(sanitized, string.Empty);
        sanitized = EventHandlerRegex.Replace(sanitized, string.Empty);
        sanitized = DangerousHrefRegex.Replace(sanitized, "$1=$2#");
        sanitized = Regex.Replace(sanitized, "expression\\s*\\(", "blocked(", RegexOptions.IgnoreCase);
        return sanitized;
    }

    private static string NormalizeWhitespace(string value)
    {
        return Regex.Replace(value, "\\s+", " ").Trim();
    }

    public async Task<NewsletterDispatchStatus?> GetDispatchStatusAsync(int newsletterId)
    {
        var newsletter = await _db.Set<Newsletter>()
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == newsletterId);

        if (newsletter == null) return null;

        var logPrefix = NewsletterTemplateKey(newsletterId);
        var logs = await _db.Set<EmailLog>()
            .AsNoTracking()
            .Where(l => l.TemplateKey == logPrefix || l.TemplateKey.StartsWith(logPrefix + ":"))
            .ToListAsync();
        var provider = GetEmailProviderStatus();

        return new NewsletterDispatchStatus
        {
            NewsletterId = newsletter.Id,
            Status = newsletter.Status,
            RecipientCount = newsletter.RecipientCount,
            SentAt = newsletter.SentAt,
            ScheduledAt = newsletter.ScheduledAt,
            UpdatedAt = newsletter.UpdatedAt,
            Queued = newsletter.Status is NewsletterStatus.Queued or NewsletterStatus.Sending,
            PendingLogs = logs.Count(l => l.Status == EmailSendStatus.Pending),
            SentLogs = logs.Count(l => l.Status == EmailSendStatus.Sent),
            FailedLogs = logs.Count(l => l.Status == EmailSendStatus.Failed),
            ProviderConfigured = provider.Configured,
            Provider = provider.Provider,
            Message = newsletter.Status == NewsletterStatus.Queued
                ? provider.Configured
                    ? "Newsletter has queued email logs. Use the explicit queue processor to retry pending delivery."
                    : "Newsletter is queued locally; provider_not_configured."
                : "Newsletter status is persisted locally."
        };
    }

    public async Task<EmailLog?> QueueTestEmailLogAsync(int newsletterId, string toEmail, int? userId = null)
    {
        var newsletter = await _db.Set<Newsletter>()
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == newsletterId);

        if (newsletter == null) return null;

        var log = new EmailLog
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            ToEmail = toEmail.Trim().ToLowerInvariant(),
            Subject = $"[Test] {newsletter.Subject}",
            TemplateKey = $"newsletter:{newsletter.Id}:test",
            Status = EmailSendStatus.Pending,
            ErrorMessage = GetEmailProviderStatus().Configured
                ? null
                : "provider_not_configured",
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<EmailLog>().Add(log);
        await _db.SaveChangesAsync();

        if (GetEmailProviderStatus().Configured)
        {
            await ProcessEmailLogAsync(log, newsletter);
            await _db.SaveChangesAsync();
        }

        return log;
    }

    public async Task<NewsletterDispatchProcessResult?> ProcessQueuedNewsletterLogsAsync(
        int newsletterId,
        int maxLogs = 100,
        CancellationToken ct = default)
    {
        var newsletter = await _db.Set<Newsletter>()
            .FirstOrDefaultAsync(n => n.Id == newsletterId, ct);

        if (newsletter == null) return null;

        var logPrefix = NewsletterTemplateKey(newsletterId);
        var logs = await _db.Set<EmailLog>()
            .Where(l => l.Status == EmailSendStatus.Pending)
            .Where(l => l.TemplateKey == logPrefix || l.TemplateKey.StartsWith(logPrefix + ":"))
            .OrderBy(l => l.CreatedAt)
            .Take(Math.Clamp(maxLogs, 1, 500))
            .ToListAsync(ct);

        var provider = GetEmailProviderStatus();
        var result = new NewsletterDispatchProcessResult
        {
            NewsletterId = newsletterId,
            Provider = provider.Provider,
            ProviderConfigured = provider.Configured,
            Attempted = logs.Count
        };

        if (logs.Count == 0)
            return result;

        newsletter.Status = NewsletterStatus.Sending;
        newsletter.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        if (!provider.Configured)
        {
            foreach (var log in logs)
            {
                log.Status = EmailSendStatus.Failed;
                log.ErrorMessage = "provider_not_configured";
                log.RetryCount++;
                result.Failed++;
            }

            newsletter.Status = NewsletterStatus.Queued;
            newsletter.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return result;
        }

        foreach (var log in logs)
        {
            if (await ProcessEmailLogAsync(log, newsletter, ct))
                result.Sent++;
            else
                result.Failed++;
        }

        await _db.SaveChangesAsync(ct);

        var remainingPending = await _db.Set<EmailLog>()
            .AnyAsync(l =>
                l.Status == EmailSendStatus.Pending &&
                (l.TemplateKey == logPrefix || l.TemplateKey.StartsWith(logPrefix + ":")), ct);

        if (!remainingPending && result.Failed == 0)
        {
            newsletter.Status = NewsletterStatus.Sent;
            newsletter.SentAt = DateTime.UtcNow;
        }
        else
        {
            newsletter.Status = NewsletterStatus.Queued;
        }

        newsletter.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return result;
    }

    /// <summary>
    /// Background-friendly queue processor for due scheduled newsletters and pending
    /// newsletter email logs. This method is safe for a hosted worker or admin job:
    /// it queues due scheduled newsletters, then attempts only persisted pending logs.
    /// </summary>
    public async Task<NewsletterQueueProcessResult> ProcessDueNewsletterQueueAsync(
        int maxNewsletters = 25,
        int maxLogsPerNewsletter = 100,
        CancellationToken ct = default)
    {
        maxNewsletters = Math.Clamp(maxNewsletters, 1, 100);
        maxLogsPerNewsletter = Math.Clamp(maxLogsPerNewsletter, 1, 500);

        var provider = GetEmailProviderStatus();
        var result = new NewsletterQueueProcessResult
        {
            Provider = provider.Provider,
            ProviderConfigured = provider.Configured
        };

        var now = DateTime.UtcNow;
        var dueScheduled = await _db.Set<Newsletter>()
            .Where(n => n.Status == NewsletterStatus.Scheduled)
            .Where(n => n.ScheduledAt != null && n.ScheduledAt <= now)
            .OrderBy(n => n.ScheduledAt)
            .Take(maxNewsletters)
            .ToListAsync(ct);

        foreach (var newsletter in dueScheduled)
        {
            if (!await HasNewsletterLogsAsync(newsletter.Id, ct))
            {
                await QueueNewsletterLogsAsync(newsletter, ct);
            }

            newsletter.Status = NewsletterStatus.Queued;
            newsletter.RecipientCount = await CountActiveSubscribersAsync(ct);
            newsletter.UpdatedAt = DateTime.UtcNow;
            result.QueuedNewsletters++;
        }

        if (dueScheduled.Count > 0)
        {
            await _db.SaveChangesAsync(ct);
        }

        var candidateIds = await _db.Set<Newsletter>()
            .AsNoTracking()
            .Where(n => n.Status == NewsletterStatus.Queued || n.Status == NewsletterStatus.Sending)
            .OrderBy(n => n.UpdatedAt ?? n.CreatedAt)
            .Take(maxNewsletters)
            .Select(n => n.Id)
            .ToListAsync(ct);

        foreach (var newsletterId in candidateIds.Distinct())
        {
            var processed = await ProcessQueuedNewsletterLogsAsync(newsletterId, maxLogsPerNewsletter, ct);
            if (processed == null)
                continue;

            result.ProcessedNewsletters++;
            result.Attempted += processed.Attempted;
            result.Sent += processed.Sent;
            result.Failed += processed.Failed;
        }

        return result;
    }

    /// <summary>
    /// Get subscription statistics: total, active, unsubscribed counts.
    /// </summary>
    public async Task<SubscriptionStats> GetSubscriptionStatsAsync()
    {
        var stats = await _db.Set<NewsletterSubscription>()
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new SubscriptionStats
            {
                Total = g.Count(),
                Active = g.Count(s => s.IsSubscribed),
                Unsubscribed = g.Count(s => !s.IsSubscribed)
            })
            .FirstOrDefaultAsync() ?? new SubscriptionStats();

        return stats;
    }

    private async Task QueueNewsletterLogsAsync(Newsletter newsletter, CancellationToken ct = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var subscribers = await _db.Set<NewsletterSubscription>()
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.IsSubscribed)
            .Select(s => new { s.Email, s.UserId })
            .ToListAsync(ct);

        var provider = GetEmailProviderStatus();

        foreach (var subscriber in subscribers)
        {
            _db.Set<EmailLog>().Add(new EmailLog
            {
                TenantId = tenantId,
                UserId = subscriber.UserId,
                ToEmail = subscriber.Email,
                Subject = newsletter.Subject,
                TemplateKey = NewsletterTemplateKey(newsletter.Id),
                Status = EmailSendStatus.Pending,
                ErrorMessage = provider.Configured ? null : "provider_not_configured",
                CreatedAt = DateTime.UtcNow
            });
        }
    }

    private async Task<bool> HasNewsletterLogsAsync(int newsletterId, CancellationToken ct)
    {
        var logPrefix = NewsletterTemplateKey(newsletterId);
        return await _db.Set<EmailLog>()
            .AsNoTracking()
            .AnyAsync(l => l.TemplateKey == logPrefix || l.TemplateKey.StartsWith(logPrefix + ":"), ct);
    }

    private async Task<int> CountActiveSubscribersAsync(CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        return await _db.Set<NewsletterSubscription>()
            .AsNoTracking()
            .CountAsync(s => s.TenantId == tenantId && s.IsSubscribed, ct);
    }

    private async Task<bool> ProcessEmailLogAsync(
        EmailLog log,
        Newsletter newsletter,
        CancellationToken ct = default)
    {
        try
        {
            var sent = await _emailService.SendEmailAsync(
                log.ToEmail,
                log.Subject,
                newsletter.ContentHtml,
                newsletter.ContentText,
                ct);

            log.RetryCount++;

            if (sent)
            {
                log.Status = EmailSendStatus.Sent;
                log.SentAt = DateTime.UtcNow;
                log.ErrorMessage = null;
                return true;
            }

            log.Status = EmailSendStatus.Failed;
            log.ErrorMessage = "provider_send_failed";
            return false;
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            log.RetryCount++;
            log.Status = EmailSendStatus.Failed;
            log.ErrorMessage = "provider_send_failed";
            _logger.LogWarning(ex, "Newsletter email log {EmailLogId} failed during provider dispatch", log.Id);
            return false;
        }
    }

    private (string Provider, bool Configured) GetEmailProviderStatus()
    {
        var sendGridApiKey = _configuration["SendGrid:ApiKey"];
        if (_configuration.GetValue("SendGrid:Enabled", false) || !string.IsNullOrWhiteSpace(sendGridApiKey))
        {
            return ("sendgrid", !string.IsNullOrWhiteSpace(sendGridApiKey));
        }

        var gmailEnabled = _configuration.GetValue("Gmail:Enabled", false);
        var gmailConfigured =
            !string.IsNullOrWhiteSpace(_configuration["Gmail:ClientId"]) &&
            !string.IsNullOrWhiteSpace(_configuration["Gmail:ClientSecret"]) &&
            !string.IsNullOrWhiteSpace(_configuration["Gmail:RefreshToken"]) &&
            !string.IsNullOrWhiteSpace(_configuration["Gmail:SenderEmail"]);

        return gmailEnabled || gmailConfigured
            ? ("gmail", gmailEnabled && gmailConfigured)
            : ("none", false);
    }

    private static string NewsletterTemplateKey(int newsletterId) => $"newsletter:{newsletterId}";
}

public class SubscriptionStats
{
    public int Total { get; set; }
    public int Active { get; set; }
    public int Unsubscribed { get; set; }
}

public sealed record NewsletterPreviewRenderResult(string Html, string Text, string Subject);

public class ImportSubscriberInput
{
    public string? Email { get; set; }
    public int? UserId { get; set; }
    public string? Source { get; set; }
}

public class ImportSubscribersResult
{
    public int Imported { get; set; }
    public int Updated { get; set; }
    public int Skipped { get; set; }
}

public class SyncSubscribersResult
{
    public int EligibleMembers { get; set; }
    public int Created { get; set; }
    public int Updated { get; set; }
}

public class NewsletterSubscriberExport
{
    public int Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public int? UserId { get; set; }
    public bool IsSubscribed { get; set; }
    public string? Source { get; set; }
    public DateTime SubscribedAt { get; set; }
    public DateTime? UnsubscribedAt { get; set; }
}

public class NewsletterDispatchStatus
{
    public int NewsletterId { get; set; }
    public NewsletterStatus Status { get; set; }
    public int RecipientCount { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? ScheduledAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public bool Queued { get; set; }
    public int PendingLogs { get; set; }
    public int SentLogs { get; set; }
    public int FailedLogs { get; set; }
    public bool ProviderConfigured { get; set; }
    public string Provider { get; set; } = "none";
    public string Message { get; set; } = string.Empty;
}

public class NewsletterDispatchProcessResult
{
    public int NewsletterId { get; set; }
    public int Attempted { get; set; }
    public int Sent { get; set; }
    public int Failed { get; set; }
    public bool ProviderConfigured { get; set; }
    public string Provider { get; set; } = "none";
}

public class NewsletterQueueProcessResult
{
    public int QueuedNewsletters { get; set; }
    public int ProcessedNewsletters { get; set; }
    public int Attempted { get; set; }
    public int Sent { get; set; }
    public int Failed { get; set; }
    public bool ProviderConfigured { get; set; }
    public string Provider { get; set; } = "none";
}
