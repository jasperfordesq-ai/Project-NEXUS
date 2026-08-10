// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Tenant-safe guardian-consent lifecycle plus the safeguarding gate shared by
/// every workflow that can place a volunteer on a shift.
/// </summary>
public sealed class VolunteerGuardianConsentService
{
    public const string RequiredCode = "GUARDIAN_CONSENT_REQUIRED";
    public const string RequiredMessage =
        "A parent or guardian needs to approve your participation before you can volunteer. Please send a consent request first.";

    public const string GuardianConsentRequiredConfigKey = "volunteering.guardian_consent_required";
    private const string VolunteeringModuleConfigKey = "admin_explicit.module_config.volunteering";
    private const int ConsentExpiryDays = 365;
    private const string NotificationType = "guardian_consent";
    private const string VolunteeringLink = "/volunteering";

    private static readonly HashSet<string> ValidRelationships = new(StringComparer.Ordinal)
    {
        "parent",
        "guardian",
        "legal_guardian",
        "carer"
    };

    private readonly NexusDbContext _db;
    private readonly ILogger<VolunteerGuardianConsentService> _logger;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;

    public VolunteerGuardianConsentService(
        NexusDbContext db,
        ILogger<VolunteerGuardianConsentService> logger,
        IEmailService emailService,
        IConfiguration configuration)
    {
        _db = db;
        _logger = logger;
        _emailService = emailService;
        _configuration = configuration;
    }

    public async Task<IReadOnlyList<GuardianConsentView>> ListForMinorAsync(
        int minorUserId,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        var rows = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent => consent.TenantId == tenantId && consent.MinorUserId == minorUserId)
            .OrderByDescending(consent => consent.CreatedAt)
            .ThenByDescending(consent => consent.Id)
            .Select(consent => new
            {
                consent.Id,
                consent.MinorUserId,
                consent.GuardianName,
                consent.GuardianEmail,
                consent.GuardianPhone,
                consent.GuardianRelationship,
                consent.OpportunityId,
                consent.Status,
                consent.ConsentedAt,
                consent.RevokedAt,
                consent.ExpiresAt,
                consent.CreatedAt
            })
            .ToListAsync(cancellationToken);

        // Deliberately project only public fields. In particular, neither the
        // email credential nor its hash/IP may reach the minor.
        return rows.Select(row => new GuardianConsentView(
                row.Id,
                row.MinorUserId,
                row.GuardianName,
                row.GuardianEmail,
                row.GuardianPhone,
                row.GuardianRelationship,
                row.OpportunityId,
                ToContractStatus(row.Status),
                row.ConsentedAt,
                row.RevokedAt,
                row.ExpiresAt,
                row.CreatedAt))
            .ToList();
    }

    public async Task<GuardianConsentView> RequestConsentAsync(
        int minorUserId,
        int tenantId,
        GuardianConsentRequest request,
        CancellationToken cancellationToken = default)
    {
        var guardianName = request.GuardianName?.Trim() ?? string.Empty;
        var guardianEmail = request.GuardianEmail?.Trim() ?? string.Empty;
        var relationship = request.Relationship?.Trim() ?? string.Empty;
        var guardianPhone = NullIfWhiteSpace(request.GuardianPhone);

        if (guardianName.Length == 0)
        {
            throw new GuardianConsentValidationException("Guardian name is required.", "guardian_name");
        }

        if (guardianName.Length > 255)
        {
            throw new GuardianConsentValidationException("Guardian name must not exceed 255 characters.", "guardian_name");
        }

        if (guardianEmail.Length == 0)
        {
            throw new GuardianConsentValidationException("Guardian email is required.", "guardian_email");
        }

        if (guardianEmail.Length > 255 || !IsValidEmail(guardianEmail))
        {
            throw new GuardianConsentValidationException("Invalid guardian email address.", "guardian_email");
        }

        if (relationship.Length == 0)
        {
            throw new GuardianConsentValidationException("Relationship is required.", "relationship");
        }

        if (!ValidRelationships.Contains(relationship))
        {
            throw new GuardianConsentValidationException(
                "Invalid relationship type. Must be one of: parent, guardian, legal_guardian, carer",
                "relationship");
        }

        if (guardianPhone is { Length: > 50 })
        {
            throw new GuardianConsentValidationException("Guardian phone must not exceed 50 characters.", "guardian_phone");
        }

        if (!await IsMinorAsync(minorUserId, tenantId, cancellationToken))
        {
            throw new GuardianConsentValidationException(
                "User is not a minor and does not require guardian consent.");
        }

        if (request.OpportunityId.HasValue)
        {
            var opportunityExists = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(opportunity =>
                    opportunity.Id == request.OpportunityId.Value
                    && opportunity.TenantId == tenantId,
                    cancellationToken);
            if (!opportunityExists)
            {
                throw new GuardianConsentValidationException("Opportunity not found.", "opportunity_id");
            }
        }

        var now = DateTime.UtcNow;
        var rawToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var consent = new VolunteerGuardianConsent
        {
            TenantId = tenantId,
            MinorUserId = minorUserId,
            OpportunityId = request.OpportunityId,
            GuardianName = guardianName,
            GuardianEmail = guardianEmail,
            GuardianPhone = guardianPhone,
            GuardianRelationship = relationship,
            ConsentTokenHash = HashToken(rawToken),
            Status = VolunteerGuardianConsentStatus.Pending,
            ExpiresAt = now.AddDays(ConsentExpiryDays),
            CreatedAt = now
        };

        _db.VolunteerGuardianConsents.Add(consent);
        await _db.SaveChangesAsync(cancellationToken);

        // Persistence is authoritative. Match Laravel's non-fatal delivery
        // behavior: a transport failure does not fabricate a failed write or
        // expose the credential to the minor as a fallback.
        await TrySendConsentRequestEmailAsync(consent, rawToken);

        return ToView(consent);
    }

    public async Task<bool> GrantConsentAsync(
        string token,
        string ipAddress,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        if (!IsTokenShapeValid(token))
        {
            return false;
        }

        var tokenHash = HashToken(token);
        var now = DateTime.UtcNow;

        var candidate = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent =>
                consent.TenantId == tenantId
                && consent.ConsentTokenHash == tokenHash
                && consent.Status == VolunteerGuardianConsentStatus.Pending
                && (consent.ExpiresAt == null || consent.ExpiresAt > now))
            .Select(consent => new { consent.Id, consent.MinorUserId })
            .SingleOrDefaultAsync(cancellationToken);
        if (candidate is null)
        {
            return false;
        }

        var consentIp = string.IsNullOrWhiteSpace(ipAddress)
            ? "0.0.0.0"
            : ipAddress.Trim()[..Math.Min(ipAddress.Trim().Length, 45)];
        var updateNow = DateTime.UtcNow;
        var affected = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .Where(consent =>
                consent.Id == candidate.Id
                && consent.TenantId == tenantId
                && consent.ConsentTokenHash == tokenHash
                && consent.Status == VolunteerGuardianConsentStatus.Pending
                && (consent.ExpiresAt == null || consent.ExpiresAt > updateNow))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(consent => consent.Status, VolunteerGuardianConsentStatus.Active)
                .SetProperty(consent => consent.ConsentedAt, updateNow)
                .SetProperty(consent => consent.ConsentIp, consentIp)
                .SetProperty(consent => consent.UpdatedAt, updateNow),
                cancellationToken);
        if (affected != 1)
        {
            return false;
        }

        const string title = "Guardian consent";
        const string body = "Your guardian has approved consent for your volunteering activities.";
        await TryCreateNotificationAsync(NewNotification(
            tenantId,
            candidate.MinorUserId,
            candidate.Id,
            title,
            body,
            updateNow), candidate.Id);
        return true;
    }

    public async Task<GuardianConsentTokenStatus?> GetConsentStatusByTokenAsync(
        string token,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        if (!IsTokenShapeValid(token))
            return null;

        var now = DateTime.UtcNow;
        var row = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent => consent.TenantId == tenantId && consent.ConsentTokenHash == HashToken(token))
            .Select(consent => new { consent.Status, consent.ExpiresAt })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
            return null;

        var expired = row.ExpiresAt.HasValue && row.ExpiresAt.Value < now;
        var status = expired && row.Status == VolunteerGuardianConsentStatus.Pending
            ? "expired"
            : row.Status.ToString().ToLowerInvariant();
        return new GuardianConsentTokenStatus(
            status,
            row.Status == VolunteerGuardianConsentStatus.Pending && !expired);
    }

    public async Task<bool> WithdrawConsentAsync(
        int consentId,
        int actorUserId,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        var candidate = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent =>
                consent.Id == consentId
                && consent.TenantId == tenantId
                && consent.Status == VolunteerGuardianConsentStatus.Active)
            .Select(consent => new { consent.Id, consent.MinorUserId })
            .SingleOrDefaultAsync(cancellationToken);
        if (candidate is null)
        {
            return false;
        }

        var actor = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == actorUserId && user.TenantId == tenantId, cancellationToken);
        var actorIsMinor = candidate.MinorUserId == actorUserId;
        if (!actorIsMinor && (actor is null || !NexusUserAccessEvaluator.HasAdminAccess(actor)))
        {
            _logger.LogWarning(
                "Guardian consent {ConsentId} withdrawal denied for user {UserId} in tenant {TenantId}",
                consentId,
                actorUserId,
                tenantId);
            return false;
        }

        var now = DateTime.UtcNow;
        var affected = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .Where(consent =>
                consent.Id == consentId
                && consent.TenantId == tenantId
                && consent.Status == VolunteerGuardianConsentStatus.Active)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(consent => consent.Status, VolunteerGuardianConsentStatus.Withdrawn)
                .SetProperty(consent => consent.RevokedAt, now)
                .SetProperty(consent => consent.UpdatedAt, now),
                cancellationToken);
        if (affected != 1)
        {
            return false;
        }

        const string title = "Guardian consent";
        var body = actorIsMinor
            ? "Guardian consent has been withdrawn from your volunteering activities."
            : "Guardian consent has been withdrawn by an administrator.";
        await TryCreateNotificationAsync(NewNotification(
            tenantId,
            candidate.MinorUserId,
            consentId,
            title,
            body,
            now), consentId);
        return true;
    }

    public async Task<GuardianConsentAdminPage> GetAdminPageAsync(
        int tenantId,
        string? status,
        int? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, 200);
        VolunteerGuardianConsentStatus? statusFilter = null;
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!TryParseContractStatus(status, out var parsed))
            {
                return new GuardianConsentAdminPage([], null, false);
            }

            statusFilter = parsed;
        }

        var query = _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent => consent.TenantId == tenantId);
        if (statusFilter.HasValue)
        {
            query = query.Where(consent => consent.Status == statusFilter.Value);
        }

        if (cursor is > 0)
        {
            query = query.Where(consent => consent.Id < cursor.Value);
        }

        var rows = await query
            .OrderByDescending(consent => consent.Id)
            .Take(limit + 1)
            .Select(consent => new
            {
                consent.Id,
                consent.MinorUserId,
                consent.GuardianName,
                consent.GuardianEmail,
                consent.GuardianPhone,
                consent.GuardianRelationship,
                consent.OpportunityId,
                consent.Status,
                consent.ConsentedAt,
                consent.RevokedAt,
                consent.ExpiresAt,
                consent.CreatedAt,
                MinorFirstName = _db.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == consent.MinorUserId && user.TenantId == tenantId)
                    .Select(user => user.FirstName)
                    .FirstOrDefault(),
                MinorLastName = _db.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == consent.MinorUserId && user.TenantId == tenantId)
                    .Select(user => user.LastName)
                    .FirstOrDefault(),
                MinorEmail = _db.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == consent.MinorUserId && user.TenantId == tenantId)
                    .Select(user => user.Email)
                    .FirstOrDefault(),
                OpportunityTitle = consent.OpportunityId == null
                    ? null
                    : _db.VolunteerOpportunities.IgnoreQueryFilters()
                        .Where(opportunity =>
                            opportunity.Id == consent.OpportunityId
                            && opportunity.TenantId == tenantId)
                        .Select(opportunity => opportunity.Title)
                        .FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        var hasMore = rows.Count > limit;
        if (hasMore)
        {
            rows.RemoveAt(rows.Count - 1);
        }

        var items = rows.Select(row => new GuardianConsentAdminItem(
                row.Id,
                row.MinorUserId,
                JoinName(row.MinorFirstName, row.MinorLastName),
                row.MinorEmail ?? string.Empty,
                row.GuardianName,
                row.GuardianEmail,
                row.GuardianPhone,
                row.GuardianRelationship,
                row.OpportunityId,
                row.OpportunityTitle ?? string.Empty,
                ToContractStatus(row.Status),
                row.ConsentedAt,
                row.RevokedAt,
                row.ExpiresAt,
                row.CreatedAt,
                row.ConsentedAt ?? row.CreatedAt))
            .ToList();

        return new GuardianConsentAdminPage(
            items,
            items.Count == 0 ? null : items[^1].Id,
            hasMore);
    }

    public async Task<int> ExpireOldConsentsAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        return await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .Where(consent =>
                (consent.Status == VolunteerGuardianConsentStatus.Pending
                    || consent.Status == VolunteerGuardianConsentStatus.Active)
                && consent.ExpiresAt != null
                && consent.ExpiresAt < now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(consent => consent.Status, VolunteerGuardianConsentStatus.Expired)
                .SetProperty(consent => consent.UpdatedAt, now),
                cancellationToken);
    }

    public async Task<bool> IsBlockedAsync(
        int userId,
        int tenantId,
        int? opportunityId,
        CancellationToken cancellationToken = default)
    {
        if (!await IsGuardianConsentRequiredAsync(tenantId, cancellationToken)
            || !await IsMinorAsync(userId, tenantId, cancellationToken))
        {
            return false;
        }

        var now = DateTime.UtcNow;
        var hasActiveConsent = await _db.VolunteerGuardianConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(consent =>
                consent.TenantId == tenantId
                && consent.MinorUserId == userId
                && consent.Status == VolunteerGuardianConsentStatus.Active
                && consent.RevokedAt == null
                && (consent.ExpiresAt == null || consent.ExpiresAt > now)
                && (opportunityId == null
                    || consent.OpportunityId == null
                    || consent.OpportunityId == opportunityId),
                cancellationToken);
        return !hasActiveConsent;
    }

    public async Task<bool> IsVolunteeringEnabledAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config =>
                config.TenantId == tenantId
                && config.Key == AdminVolunteerApprovalService.FeatureConfigKey)
            .Select(config => config.Value)
            .SingleOrDefaultAsync(cancellationToken);

        return string.IsNullOrWhiteSpace(value)
            || value.Trim().Trim('"').ToLowerInvariant()
                is not ("0" or "false" or "no" or "off" or "disabled");
    }

    internal static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    internal static string ToContractStatus(VolunteerGuardianConsentStatus status) => status switch
    {
        VolunteerGuardianConsentStatus.Pending => "pending",
        VolunteerGuardianConsentStatus.Active => "active",
        VolunteerGuardianConsentStatus.Withdrawn => "withdrawn",
        VolunteerGuardianConsentStatus.Expired => "expired",
        _ => "pending"
    };

    private async Task<bool> IsGuardianConsentRequiredAsync(
        int tenantId,
        CancellationToken cancellationToken)
    {
        var configured = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config =>
                config.TenantId == tenantId
                && (config.Key == GuardianConsentRequiredConfigKey || config.Key == VolunteeringModuleConfigKey))
            .Select(config => new { config.Key, config.Value })
            .ToListAsync(cancellationToken);

        // The direct key is authoritative. Admin module-config writes mirror
        // into it; the blob remains a fallback for rows saved before that
        // convergence was introduced.
        var directConfig = configured
            .FirstOrDefault(config => config.Key == GuardianConsentRequiredConfigKey);
        if (directConfig is not null)
        {
            return IsEnabledText(directConfig.Value);
        }

        var moduleConfig = configured
            .FirstOrDefault(config => config.Key == VolunteeringModuleConfigKey)
            ?.Value;
        if (!string.IsNullOrWhiteSpace(moduleConfig))
        {
            try
            {
                using var document = JsonDocument.Parse(moduleConfig);
                if (document.RootElement.ValueKind == JsonValueKind.Object
                    && document.RootElement.TryGetProperty(GuardianConsentRequiredConfigKey, out var value))
                {
                    return IsEnabledJsonValue(value);
                }
            }
            catch (JsonException exception)
            {
                _logger.LogWarning(
                    exception,
                    "Could not read volunteering module configuration for tenant {TenantId}",
                    tenantId);
            }
        }

        return false;
    }

    private async Task<bool> IsMinorAsync(
        int userId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var profileJson = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == userId && user.TenantId == tenantId)
            .Select(user => user.NotificationPreferences)
            .SingleOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(profileJson))
        {
            return false;
        }

        DateOnly dateOfBirth;
        try
        {
            using var profile = JsonDocument.Parse(profileJson);
            if (!profile.RootElement.TryGetProperty("date_of_birth", out var value)
                || value.ValueKind != JsonValueKind.String
                || !DateTime.TryParse(
                    value.GetString(),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AllowWhiteSpaces,
                    out var parsed))
            {
                return false;
            }

            dateOfBirth = DateOnly.FromDateTime(parsed);
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(
                exception,
                "Could not read date of birth while checking guardian consent for user {UserId}",
                userId);
            return false;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var age = today.Year - dateOfBirth.Year;
        if (dateOfBirth > today.AddYears(-age))
        {
            age--;
        }

        return age < 18;
    }

    private async Task TrySendConsentRequestEmailAsync(
        VolunteerGuardianConsent consent,
        string rawToken)
    {
        const string subject = "Guardian Consent Request — Project NEXUS";
        var emailLog = new EmailLog
        {
            TenantId = consent.TenantId,
            UserId = null,
            ToEmail = consent.GuardianEmail,
            Subject = subject,
            TemplateKey = "guardian_consent",
            Status = EmailSendStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };
        var logPersisted = false;
        try
        {
            _db.EmailLogs.Add(emailLog);
            await _db.SaveChangesAsync(CancellationToken.None);
            logPersisted = true;
        }
        catch (Exception exception)
        {
            _db.Entry(emailLog).State = EntityState.Detached;
            _logger.LogWarning(
                exception,
                "Could not persist guardian consent email audit for consent {ConsentId} in tenant {TenantId}",
                consent.Id,
                consent.TenantId);
        }

        var sent = false;
        string? error = null;
        try
        {
            var verifyUrl = await BuildVerifyUrlAsync(consent.TenantId, rawToken);
            var safeName = WebUtility.HtmlEncode(consent.GuardianName);
            var safeRelationship = WebUtility.HtmlEncode(consent.GuardianRelationship);
            var safeUrl = WebUtility.HtmlEncode(verifyUrl);
            var html =
                $"<p>Hello {safeName},</p>" +
                "<p>You have been asked to approve a minor's participation in community volunteering.</p>" +
                $"<p><strong>Relationship:</strong> {safeRelationship}<br>" +
                $"<strong>Link expires:</strong> {ConsentExpiryDays} days</p>" +
                $"<p><a href=\"{safeUrl}\">Review and confirm guardian consent</a></p>" +
                "<p>If you did not expect this request, you can ignore this email.</p>";
            var text =
                $"Hello {consent.GuardianName},\n\n" +
                "You have been asked to approve a minor's participation in community volunteering.\n" +
                $"Review and confirm guardian consent: {verifyUrl}\n\n" +
                "If you did not expect this request, you can ignore this email.";

            sent = await _emailService.SendEmailAsync(
                consent.GuardianEmail,
                subject,
                html,
                text,
                CancellationToken.None);
            if (!sent)
            {
                error = "Email provider returned failure";
                _logger.LogWarning(
                    "Guardian consent email transport returned false for consent {ConsentId} in tenant {TenantId}",
                    consent.Id,
                    consent.TenantId);
            }
        }
        catch (Exception exception)
        {
            error = "Guardian consent delivery failed";
            _logger.LogWarning(
                exception,
                "Guardian consent email delivery failed for consent {ConsentId} in tenant {TenantId}",
                consent.Id,
                consent.TenantId);
        }

        if (!logPersisted)
        {
            return;
        }

        try
        {
            emailLog.Status = sent ? EmailSendStatus.Sent : EmailSendStatus.Failed;
            emailLog.ErrorMessage = sent ? null : error;
            emailLog.SentAt = sent ? DateTime.UtcNow : null;
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            _db.Entry(emailLog).State = EntityState.Detached;
            _logger.LogWarning(
                exception,
                "Could not finalize guardian consent email audit {EmailLogId} for consent {ConsentId}",
                emailLog.Id,
                consent.Id);
        }
    }

    private async Task TryCreateNotificationAsync(Notification notification, int consentId)
    {
        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            _db.Entry(notification).State = EntityState.Detached;
            _logger.LogWarning(
                exception,
                "Guardian consent notification failed for consent {ConsentId} in tenant {TenantId}",
                consentId,
                notification.TenantId);
        }
    }

    private async Task<string> BuildVerifyUrlAsync(int tenantId, string rawToken)
    {
        var tenant = await _db.Tenants
            .AsNoTracking()
            .Where(candidate => candidate.Id == tenantId)
            .Select(candidate => new { candidate.Id, candidate.Slug, candidate.Domain })
            .SingleAsync();

        string origin;
        string tenantPrefix;
        if (tenant.Id > 1 && !string.IsNullOrWhiteSpace(tenant.Domain))
        {
            origin = NormalizeOrigin(tenant.Domain!);
            tenantPrefix = string.Empty;
        }
        else
        {
            origin = (_configuration["App:FrontendUrl"] ?? "https://app.project-nexus.ie").TrimEnd('/');
            tenantPrefix = string.IsNullOrWhiteSpace(tenant.Slug)
                ? string.Empty
                : "/" + Uri.EscapeDataString(tenant.Slug);
        }

        return $"{origin}{tenantPrefix}/volunteering/guardian-consent/verify/{rawToken}";
    }

    private static Notification NewNotification(
        int tenantId,
        int minorUserId,
        int consentId,
        string title,
        string body,
        DateTime now) => new()
    {
        TenantId = tenantId,
        UserId = minorUserId,
        Type = NotificationType,
        Title = title,
        Body = body,
        Link = VolunteeringLink,
        Data = JsonSerializer.Serialize(new
        {
            consent_id = consentId,
            url = VolunteeringLink
        }),
        IsRead = false,
        CreatedAt = now
    };

    private static GuardianConsentView ToView(VolunteerGuardianConsent consent) => new(
        consent.Id,
        consent.MinorUserId,
        consent.GuardianName,
        consent.GuardianEmail,
        consent.GuardianPhone,
        consent.GuardianRelationship,
        consent.OpportunityId,
        ToContractStatus(consent.Status),
        consent.ConsentedAt,
        consent.RevokedAt,
        consent.ExpiresAt,
        consent.CreatedAt);

    private static bool TryParseContractStatus(
        string value,
        out VolunteerGuardianConsentStatus status)
    {
        status = value.Trim().ToLowerInvariant() switch
        {
            "pending" => VolunteerGuardianConsentStatus.Pending,
            "active" or "granted" => VolunteerGuardianConsentStatus.Active,
            "withdrawn" or "revoked" => VolunteerGuardianConsentStatus.Withdrawn,
            "expired" => VolunteerGuardianConsentStatus.Expired,
            _ => (VolunteerGuardianConsentStatus)(-1)
        };
        return (int)status >= 0;
    }

    private static bool IsValidEmail(string value) =>
        MailAddress.TryCreate(value, out var address)
        && string.Equals(address.Address, value, StringComparison.OrdinalIgnoreCase);

    private static bool IsTokenShapeValid(string token) =>
        token.Length == 64 && token.All(Uri.IsHexDigit);

    private static bool IsEnabledJsonValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => IsEnabledText(value.GetString()),
        JsonValueKind.Number => value.TryGetInt32(out var number) && number == 1,
        _ => false
    };

    private static bool IsEnabledText(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Trim().Trim('"').ToLowerInvariant()
            is "1" or "true" or "yes" or "on" or "enabled";

    private static string? NullIfWhiteSpace(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string JoinName(string? firstName, string? lastName) =>
        string.Join(' ', new[] { firstName, lastName }.Where(value => !string.IsNullOrWhiteSpace(value)));

    private static string NormalizeOrigin(string domain)
    {
        var trimmed = domain.Trim().TrimEnd('/');
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https"
                ? absolute.ToString().TrimEnd('/')
                : $"https://{trimmed}";
    }
}

public sealed record GuardianConsentRequest(
    string? GuardianName,
    string? GuardianEmail,
    string? Relationship,
    string? GuardianPhone,
    int? OpportunityId);

public sealed record GuardianConsentTokenStatus(string Status, bool Valid);

public sealed record GuardianConsentView(
    int Id,
    int MinorUserId,
    string GuardianName,
    string GuardianEmail,
    string? GuardianPhone,
    string Relationship,
    int? OpportunityId,
    string Status,
    DateTime? ConsentedAt,
    DateTime? WithdrawnAt,
    DateTime? ExpiresAt,
    DateTime CreatedAt);

public sealed record GuardianConsentAdminItem(
    int Id,
    int MinorUserId,
    string MinorName,
    string MinorEmail,
    string GuardianName,
    string GuardianEmail,
    string? GuardianPhone,
    string Relationship,
    int? OpportunityId,
    string OpportunityTitle,
    string Status,
    DateTime? ConsentedAt,
    DateTime? WithdrawnAt,
    DateTime? ExpiresAt,
    DateTime CreatedAt,
    DateTime ConsentDate);

public sealed record GuardianConsentAdminPage(
    IReadOnlyList<GuardianConsentAdminItem> Items,
    int? Cursor,
    bool HasMore);

public sealed class GuardianConsentValidationException : Exception
{
    public GuardianConsentValidationException(string message, string? field = null)
        : base(message)
    {
        Field = field;
    }

    public string? Field { get; }
}
