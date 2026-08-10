// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Buffers.Binary;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Npgsql;

namespace Nexus.Api.Services;

/// <summary>
/// Canonical Laravel-compatible volunteer-hours ledger. QR check-ins remain
/// attendance evidence only; every reviewed hour, payout, and reconciliation
/// row flows through <c>vol_logs</c> and this service.
/// </summary>
public sealed class VolunteerHoursService
{
    public const string MaxHoursConfigKey = "volunteering.max_hours_per_shift";
    public const string RequireVerificationConfigKey = "volunteering.hours_require_verification";
    public const string CaringApprovalRequiredConfigKey = "caring_community.workflow.approval_required";
    public const string CaringAutoApproveTrustedConfigKey = "caring_community.workflow.auto_approve_trusted_reviewers";
    public const string CaringAllowSelfLogConfigKey = "caring_community.workflow.allow_member_self_log";
    public const string VolunteerPaymentType = "volunteer_payment";
    public const string PersonalTransactionType = "volunteer";

    private static readonly HashSet<string> AdminRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "admin",
        "tenant_admin",
        "super_admin"
    };

    private readonly NexusDbContext _db;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly ILogger<VolunteerHoursService> _logger;
    private readonly PushNotificationService? _pushNotifications;
    private readonly GamificationService? _gamification;
    private readonly EmailNotificationService? _emailNotifications;
    private readonly FeedActivityService? _feedActivity;

    public VolunteerHoursService(NexusDbContext db)
        : this(
            db,
            new PersonalWalletLedgerService(
                db,
                NullLogger<PersonalWalletLedgerService>.Instance),
            NullLogger<VolunteerHoursService>.Instance)
    {
    }

    public VolunteerHoursService(
        NexusDbContext db,
        PersonalWalletLedgerService personalWallet,
        ILogger<VolunteerHoursService> logger,
        PushNotificationService? pushNotifications = null,
        GamificationService? gamification = null,
        EmailNotificationService? emailNotifications = null,
        FeedActivityService? feedActivity = null)
    {
        _db = db;
        _personalWallet = personalWallet;
        _logger = logger;
        _pushNotifications = pushNotifications;
        _gamification = gamification;
        _emailNotifications = emailNotifications;
        _feedActivity = feedActivity;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct = default)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId
                && config.Key == AdminVolunteerApprovalService.FeatureConfigKey)
            .Select(config => config.Value)
            .SingleOrDefaultAsync(ct);

        return !IsExplicitlyDisabled(raw);
    }

    public async Task<string> ResolveCaringRelationshipStatusAsync(
        int tenantId,
        int coordinatorId,
        CancellationToken ct = default)
    {
        var settings = await LoadSettingsAsync(tenantId, ct);
        if (!settings.ApprovalRequired)
            return "approved";

        var coordinator = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == coordinatorId, ct);
        if (coordinator is null)
            return "pending";

        if (IsAdminTier(coordinator)
            || coordinator.Role.Equals("broker", StringComparison.OrdinalIgnoreCase))
        {
            return "approved";
        }

        return settings.AutoApproveTrustedReviewers
            && await HasHoursReviewPermissionAsync(coordinator, tenantId, ct)
                ? "approved"
                : "pending";
    }

    public async Task<VolunteerHourMutationResult> LogAsync(
        int tenantId,
        int userId,
        VolunteerHourLogCommand command,
        CancellationToken ct = default)
    {
        var validation = ValidateLogCommand(command, out var date);
        if (validation is not null)
            return VolunteerHourMutationResult.Failed(validation);

        var hours = decimal.Round(command.Hours!.Value, 2, MidpointRounding.AwayFromZero);
        var settings = await LoadSettingsAsync(tenantId, ct);
        if (hours > settings.MaxHours)
        {
            return VolunteerHourMutationResult.Failed(
                400,
                "VALIDATION_ERROR",
                $"Hours cannot exceed {settings.MaxHours} for one entry.",
                "hours");
        }

        var actor = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == userId
                && user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null, ct);
        if (actor is null)
        {
            return VolunteerHourMutationResult.Failed(
                404,
                "NOT_FOUND",
                "User not found.");
        }

        var hasReviewPermission = await HasHoursReviewPermissionAsync(actor, tenantId, ct);
        if (!settings.AllowMemberSelfLog
            && !IsAdminTier(actor)
            && !hasReviewPermission)
        {
            return VolunteerHourMutationResult.Failed(
                403,
                "FORBIDDEN",
                "Members cannot log their own hours for this community.",
                "hours");
        }

        var organisation = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(org => org.Id == command.OrganizationId
                && org.TenantId == tenantId, ct);
        if (organisation is null || !IsApprovedOrganisation(organisation.Status))
        {
            return VolunteerHourMutationResult.Failed(
                404,
                "NOT_FOUND",
                "Organisation not found.",
                "organization_id");
        }

        var relationshipError = await ValidateVolunteerRelationshipAsync(
            tenantId,
            userId,
            organisation.Id,
            command.OpportunityId,
            ct);
        if (relationshipError is not null)
            return VolunteerHourMutationResult.Failed(relationshipError);

        var status = !settings.RequireVerification
            || !settings.ApprovalRequired
            || (settings.AutoApproveTrustedReviewers && hasReviewPermission)
                ? "approved"
                : "pending";

        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            ct);
        try
        {
            await AcquireDuplicateLockAsync(
                tenantId,
                userId,
                organisation.Id,
                date,
                command.OpportunityId,
                ct);

            var duplicate = await ActiveDuplicateQuery(
                    tenantId,
                    userId,
                    organisation.Id,
                    date,
                    command.OpportunityId)
                .AnyAsync(ct);
            if (duplicate)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerHourMutationResult.Failed(
                    409,
                    "ALREADY_EXISTS",
                    "Hours have already been logged for this organisation, date, and opportunity.");
            }

            var now = DateTime.UtcNow;
            var log = new VolunteerLog
            {
                TenantId = tenantId,
                UserId = userId,
                OrganizationId = organisation.Id,
                OpportunityId = command.OpportunityId,
                DateLogged = date,
                Hours = hours,
                Description = command.Description?.Trim() ?? string.Empty,
                Status = status,
                CreatedAt = now,
                UpdatedAt = now
            };
            _db.VolunteerLogs.Add(log);
            await _db.SaveChangesAsync(ct);

            string? paymentOutcome = null;
            if (status == "approved")
            {
                paymentOutcome = await ApplyApprovalEffectsAsync(
                    log,
                    caringProfile: false,
                    awardXp: true,
                    ct);
                await _db.SaveChangesAsync(ct);
            }

            await transaction.CommitAsync(ct);
            await transaction.DisposeAsync();
            if (status == "approved")
            {
                await TryDispatchApprovalSideEffectsAsync(
                    tenantId,
                    log.Id,
                    log.UserId,
                    CancellationToken.None);
            }
            return VolunteerHourMutationResult.Succeeded(
                log.Id,
                status,
                paymentOutcome,
                status == "approved"
                    ? "Hours logged and approved."
                    : "Hours logged successfully, pending verification.");
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            await SafeRollbackAsync(transaction);
            _db.ChangeTracker.Clear();
            return VolunteerHourMutationResult.Failed(
                409,
                "ALREADY_EXISTS",
                "Hours have already been logged for this organisation, date, and opportunity.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await SafeRollbackAsync(transaction);
            throw;
        }
        catch (Exception exception)
        {
            await SafeRollbackAsync(transaction);
            _db.ChangeTracker.Clear();
            _logger.LogError(
                exception,
                "Volunteer hour submission failed for tenant {TenantId}, user {UserId}, organisation {OrganisationId}",
                tenantId,
                userId,
                command.OrganizationId);
            return VolunteerHourMutationResult.Failed(
                500,
                "SERVER_ERROR",
                "Volunteer hours could not be logged.");
        }
    }

    public async Task<VolunteerHourMutationResult> VerifyAsync(
        int tenantId,
        int reviewerId,
        int logId,
        string action,
        bool tenantAdministrator,
        CancellationToken ct = default)
    {
        if (action is not ("approve" or "decline"))
        {
            return VolunteerHourMutationResult.Failed(
                422,
                "VALIDATION_ERROR",
                "Action must be approve or decline.",
                "action");
        }

        var memberPreviewValidated = false;
        if (!tenantAdministrator)
        {
            var preview = await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(row => row.Id == logId && row.TenantId == tenantId, ct);
            if (preview is null)
            {
                return VolunteerHourMutationResult.Failed(
                    404,
                    "NOT_FOUND",
                    "Volunteer log not found.");
            }
            if (!string.Equals(preview.Status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                return VolunteerHourMutationResult.Failed(
                    400,
                    "VALIDATION_ERROR",
                    "Only pending hours can be verified.");
            }
            if (preview.UserId == reviewerId)
            {
                return VolunteerHourMutationResult.Failed(
                    403,
                    "FORBIDDEN",
                    "You cannot verify your own volunteer hours.");
            }

            var previewOrganisation = preview.OrganizationId is int previewOrganisationId
                ? await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .SingleOrDefaultAsync(org => org.Id == previewOrganisationId
                        && org.TenantId == tenantId, ct)
                : null;
            if (previewOrganisation is null
                || !await CanReviewOrganisationAsync(
                    tenantId,
                    reviewerId,
                    previewOrganisation.Id,
                    previewOrganisation.OwnerUserId,
                    ct))
            {
                return VolunteerHourMutationResult.Failed(
                    403,
                    "FORBIDDEN",
                    "You do not have permission to verify hours for this organisation.");
            }
            if (action == "approve" && !IsApprovedOrganisation(previewOrganisation.Status))
            {
                return VolunteerHourMutationResult.Failed(
                    400,
                    "ORG_NOT_ACTIVE",
                    "Organisation is not active.");
            }

            memberPreviewValidated = true;
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            ct);
        VolunteerLog? log = null;
        try
        {
            log = await _db.VolunteerLogs
                .FromSqlInterpolated(
                    $"SELECT * FROM vol_logs WHERE id = {logId} AND tenant_id = {tenantId} FOR UPDATE")
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(ct);
            if (log is null)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerHourMutationResult.Failed(
                    404,
                    "NOT_FOUND",
                    "Volunteer log not found.");
            }

            if (!string.Equals(log.Status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                await transaction.RollbackAsync(ct);
                if (!tenantAdministrator && memberPreviewValidated)
                {
                    return VolunteerHourMutationResult.Succeeded(
                        log.Id,
                        action == "approve" ? "approved" : "declined",
                        "already_processed",
                        "Hours were already verified by another request.");
                }

                return VolunteerHourMutationResult.Failed(
                    tenantAdministrator ? 422 : 400,
                    "VALIDATION_ERROR",
                    "Only pending hours can be verified.");
            }

            if (log.UserId == reviewerId)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerHourMutationResult.Failed(
                    403,
                    "FORBIDDEN",
                    "You cannot verify your own volunteer hours.");
            }

            VolunteerOrganisation? organisation = null;
            if (log.OrganizationId is int organisationId)
            {
                organisation = await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .SingleOrDefaultAsync(org => org.Id == organisationId
                        && org.TenantId == tenantId, ct);
            }

            if (!tenantAdministrator)
            {
                if (organisation is null
                    || !await CanReviewOrganisationAsync(
                        tenantId,
                        reviewerId,
                        organisation.Id,
                        organisation.OwnerUserId,
                        ct))
                {
                    await transaction.RollbackAsync(ct);
                    return VolunteerHourMutationResult.Failed(
                        403,
                        "FORBIDDEN",
                        "You do not have permission to verify hours for this organisation.");
                }
            }

            if (action == "approve"
                && organisation is not null
                && !IsApprovedOrganisation(organisation.Status))
            {
                await transaction.RollbackAsync(ct);
                return VolunteerHourMutationResult.Failed(
                    400,
                    "ORG_NOT_ACTIVE",
                    "Organisation is not active.");
            }

            log.Status = action == "approve" ? "approved" : "declined";
            log.UpdatedAt = DateTime.UtcNow;
            string? paymentOutcome = null;
            if (action == "approve")
                paymentOutcome = await ApplyApprovalEffectsAsync(
                    log,
                    caringProfile: false,
                    awardXp: true,
                    ct);

            await _db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            await transaction.DisposeAsync();

            if (action == "approve")
            {
                await TryDispatchApprovalSideEffectsAsync(
                    tenantId,
                    log.Id,
                    log.UserId,
                    CancellationToken.None);
            }

            await DispatchReviewNotificationAsync(
                tenantId,
                log,
                paymentOutcome,
                CancellationToken.None);
            await TrySendVolunteerHoursDecisionEmailAsync(
                tenantId,
                log,
                paymentOutcome);

            return VolunteerHourMutationResult.Succeeded(
                log.Id,
                log.Status,
                paymentOutcome,
                action == "approve" ? "Hours approved." : "Hours declined.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await SafeRollbackAsync(transaction);
            throw;
        }
        catch (Exception exception)
        {
            await SafeRollbackAsync(transaction);
            _db.ChangeTracker.Clear();
            _logger.LogError(
                exception,
                "Volunteer hour verification failed for tenant {TenantId}, log {LogId}, reviewer {ReviewerId}",
                tenantId,
                logId,
                reviewerId);
            return VolunteerHourMutationResult.Failed(
                500,
                "SERVER_ERROR",
                "Volunteer hours could not be verified.");
        }
    }

    public async Task<VolunteerHourMutationResult> VerifyCaringAsync(
        int tenantId,
        int reviewerId,
        int logId,
        string action,
        CancellationToken ct = default)
    {
        if (action is not ("approve" or "decline"))
        {
            return VolunteerHourMutationResult.Failed(
                422,
                "VALIDATION_ERROR",
                "Action must be approve or decline.",
                "action");
        }

        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        VolunteerLog? log = null;
        try
        {
            log = _db.Database.IsRelational()
                ? await _db.VolunteerLogs
                    .FromSqlInterpolated(
                        $"SELECT * FROM vol_logs WHERE id = {logId} AND tenant_id = {tenantId} FOR UPDATE")
                    .IgnoreQueryFilters()
                    .SingleOrDefaultAsync(ct)
                : await _db.VolunteerLogs
                    .IgnoreQueryFilters()
                    .SingleOrDefaultAsync(row => row.Id == logId && row.TenantId == tenantId, ct);
            if (log is null
                || !string.Equals(log.Status, "pending", StringComparison.OrdinalIgnoreCase)
                || log.UserId == reviewerId)
            {
                await SafeRollbackAsync(transaction);
                return VolunteerHourMutationResult.Failed(
                    log is null ? 404 : 422,
                    log is null ? "NOT_FOUND" : "VALIDATION_ERROR",
                    log is null
                        ? "Volunteer log not found."
                        : "The pending review cannot be decided.");
            }

            VolunteerOrganisation? organisation = null;
            if (log.OrganizationId is int organisationId)
            {
                organisation = await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .SingleOrDefaultAsync(org => org.Id == organisationId
                        && org.TenantId == tenantId, ct);
            }

            if (action == "approve"
                && organisation is not null
                && !IsApprovedOrganisation(organisation.Status))
            {
                await SafeRollbackAsync(transaction);
                return VolunteerHourMutationResult.Failed(
                    400,
                    "ORG_NOT_ACTIVE",
                    "Organisation is not active.");
            }

            log.Status = action == "approve" ? "approved" : "declined";
            log.UpdatedAt = DateTime.UtcNow;
            string? paymentOutcome = null;
            if (action == "approve")
                paymentOutcome = await ApplyApprovalEffectsAsync(
                    log,
                    caringProfile: true,
                    awardXp: true,
                    ct);

            await _db.SaveChangesAsync(ct);
            if (transaction is not null)
            {
                await transaction.CommitAsync(ct);
                await transaction.DisposeAsync();
            }

            if (action == "approve")
            {
                await TryDispatchApprovalSideEffectsAsync(
                    tenantId,
                    log.Id,
                    log.UserId,
                    CancellationToken.None);
            }

            return VolunteerHourMutationResult.Succeeded(
                log.Id,
                log.Status,
                paymentOutcome,
                action == "approve" ? "Hours approved." : "Hours declined.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await SafeRollbackAsync(transaction);
            throw;
        }
        catch (Exception exception)
        {
            await SafeRollbackAsync(transaction);
            _db.ChangeTracker.Clear();
            _logger.LogError(
                exception,
                "Caring volunteer-hour verification failed for tenant {TenantId}, log {LogId}, reviewer {ReviewerId}",
                tenantId,
                logId,
                reviewerId);
            return VolunteerHourMutationResult.Failed(
                500,
                "SERVER_ERROR",
                "Volunteer hours could not be verified.");
        }
    }

    public async Task<CaringVolunteerHourLogResult> LogCaringRelationshipAsync(
        int tenantId,
        int relationshipId,
        DateOnly date,
        decimal hours,
        string? description,
        string status,
        CancellationToken ct = default)
    {
        if (hours is <= 0m or > 24m || status is not ("pending" or "approved"))
            return CaringVolunteerHourLogResult.Failed("VALIDATION_ERROR");
        var approvalHours = hours;
        var storedHours = decimal.Round(hours, 2, MidpointRounding.AwayFromZero);

        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        try
        {
            var relationship = _db.Database.IsRelational()
                ? await _db.CaringSupportRelationships
                    .FromSqlInterpolated(
                        $"SELECT * FROM caring_support_relationships WHERE id = {relationshipId} AND tenant_id = {tenantId} FOR UPDATE")
                    .IgnoreQueryFilters()
                    .SingleOrDefaultAsync(ct)
                : await _db.CaringSupportRelationships
                    .IgnoreQueryFilters()
                    .SingleOrDefaultAsync(row => row.Id == relationshipId && row.TenantId == tenantId, ct);
            if (relationship is null)
            {
                await SafeRollbackAsync(transaction);
                return CaringVolunteerHourLogResult.Failed("NOT_FOUND");
            }
            if (!string.Equals(relationship.Status, "active", StringComparison.Ordinal))
            {
                await SafeRollbackAsync(transaction);
                return CaringVolunteerHourLogResult.Failed("RELATIONSHIP_INACTIVE");
            }

            var duplicate = await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .AnyAsync(log => log.TenantId == tenantId
                    && log.UserId == relationship.SupporterId
                    && log.CaringSupportRelationshipId == relationshipId
                    && log.DateLogged == date
                    && log.Status != "declined"
                    && log.Status != "rejected", ct);
            if (duplicate)
            {
                await SafeRollbackAsync(transaction);
                return CaringVolunteerHourLogResult.Failed("ALREADY_EXISTS");
            }

            var now = DateTime.UtcNow;
            var cleanedDescription = NullIfWhiteSpace(description) ?? relationship.Title;
            if (cleanedDescription.Length > 2000)
                cleanedDescription = cleanedDescription[..2000];
            var log = new VolunteerLog
            {
                TenantId = tenantId,
                UserId = relationship.SupporterId,
                OrganizationId = relationship.OrganizationId,
                CaringSupportRelationshipId = relationshipId,
                SupportRecipientId = relationship.RecipientId,
                DateLogged = date,
                Hours = storedHours,
                Description = cleanedDescription,
                Status = status,
                CreatedAt = now,
                UpdatedAt = now
            };
            _db.VolunteerLogs.Add(log);
            relationship.LastLoggedAt = now;
            relationship.NextCheckInAt = NextCaringCheckIn(date, relationship.Frequency);
            relationship.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);

            string? paymentOutcome = null;
            if (status == "approved")
            {
                paymentOutcome = await ApplyApprovalEffectsAsync(
                    log,
                    caringProfile: true,
                    awardXp: false,
                    ct,
                    approvalHours);
                await _db.SaveChangesAsync(ct);
            }

            if (transaction is not null)
                await transaction.CommitAsync(ct);

            return CaringVolunteerHourLogResult.Succeeded(
                log,
                relationship,
                paymentOutcome);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            await SafeRollbackAsync(transaction);
            _db.ChangeTracker.Clear();
            return CaringVolunteerHourLogResult.Failed("ALREADY_EXISTS");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await SafeRollbackAsync(transaction);
            throw;
        }
        catch (Exception exception)
        {
            await SafeRollbackAsync(transaction);
            _db.ChangeTracker.Clear();
            _logger.LogError(
                exception,
                "Caring volunteer-hour submission failed for tenant {TenantId}, relationship {RelationshipId}",
                tenantId,
                relationshipId);
            return CaringVolunteerHourLogResult.Failed("SERVER_ERROR");
        }
    }

    public async Task<VolunteerHoursPage> ListMyHoursAsync(
        int tenantId,
        int userId,
        int perPage,
        string? cursor,
        CancellationToken ct = default)
    {
        perPage = Math.Clamp(perPage, 1, 50);
        var cursorId = DecodeCursor(cursor, base64Encoded: true);
        var query = _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(log => log.Organization)
            .Include(log => log.Opportunity)
            .Where(log => log.TenantId == tenantId && log.UserId == userId);
        if (cursorId is int id)
            query = query.Where(log => log.Id < id);

        var rows = await query
            .OrderByDescending(log => log.Id)
            .Take(perPage + 1)
            .ToListAsync(ct);
        var hasMore = rows.Count > perPage;
        if (hasMore)
            rows.RemoveAt(rows.Count - 1);

        var items = rows.Select(log => (object)new
        {
            id = log.Id,
            tenant_id = log.TenantId,
            user_id = log.UserId,
            organization_id = log.OrganizationId,
            opportunity_id = log.OpportunityId,
            caring_support_relationship_id = log.CaringSupportRelationshipId,
            support_recipient_id = log.SupportRecipientId,
            date_logged = $"{log.DateLogged:yyyy-MM-dd}T00:00:00.000000Z",
            hours = log.Hours.ToString("0.00", CultureInfo.InvariantCulture),
            description = log.Description,
            feedback = log.Feedback,
            status = NormalizeStatus(log.Status),
            assigned_to = log.AssignedTo,
            assigned_at = LaravelTimestamp(log.AssignedAt),
            escalated_at = LaravelTimestamp(log.EscalatedAt),
            escalation_note = log.EscalationNote,
            created_at = LaravelTimestamp(log.CreatedAt),
            updated_at = LaravelTimestamp(log.UpdatedAt),
            organization = log.Organization is null
                ? null
                : new
                {
                    id = log.Organization.Id,
                    name = log.Organization.Name
                },
            opportunity = log.Opportunity is null
                ? null
                : new
                {
                    id = log.Opportunity.Id,
                    title = log.Opportunity.Title
                }
        }).ToArray();
        return new VolunteerHoursPage(
            items,
            hasMore && rows.Count > 0 ? EncodeCursor(rows[^1].Id) : null,
            hasMore,
            perPage);
    }

    public async Task<object> SummaryAsync(
        int tenantId,
        int userId,
        CancellationToken ct = default)
    {
        var logs = _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId && log.UserId == userId);
        var totalVerified = await logs
            .Where(log => log.Status == "approved")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
        var totalPending = await logs
            .Where(log => log.Status == "pending")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
        var totalDeclined = await logs
            .Where(log => log.Status == "declined" || log.Status == "rejected")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
        var totalEntries = await logs.CountAsync(ct);
        var monthStart = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var thisMonth = await logs
            .Where(log => log.Status == "approved" && log.DateLogged >= monthStart)
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;

        var byOrganisation = await (
                from log in logs
                join organisation in _db.VolunteerOrganisations.IgnoreQueryFilters().AsNoTracking()
                    on new { log.TenantId, Id = log.OrganizationId }
                    equals new { organisation.TenantId, Id = (int?)organisation.Id }
                where log.Status == "approved"
                group log by new { organisation.Id, organisation.Name }
                into grouped
                orderby grouped.Key.Name
                select new
                {
                    name = grouped.Key.Name,
                    hours = grouped.Sum(row => row.Hours)
                })
            .ToListAsync(ct);

        var byMonthRows = await logs
            .Where(log => log.Status == "approved")
            .GroupBy(log => new { log.DateLogged.Year, log.DateLogged.Month })
            .Select(grouped => new
            {
                grouped.Key.Year,
                grouped.Key.Month,
                Hours = grouped.Sum(log => log.Hours)
            })
            .OrderBy(row => row.Year)
            .ThenBy(row => row.Month)
            .ToListAsync(ct);
        var byMonth = byMonthRows.Select(row => new
        {
            month = $"{row.Year:0000}-{row.Month:00}",
            hours = decimal.Round(row.Hours, 2, MidpointRounding.AwayFromZero)
        }).ToArray();

        return new
        {
            total_verified = decimal.Round(totalVerified, 2, MidpointRounding.AwayFromZero),
            total_pending = decimal.Round(totalPending, 2, MidpointRounding.AwayFromZero),
            total_declined = decimal.Round(totalDeclined, 2, MidpointRounding.AwayFromZero),
            by_organization = byOrganisation,
            by_month = byMonth,
            total_approved_hours = decimal.Round(totalVerified, 2, MidpointRounding.AwayFromZero),
            pending_hours = decimal.Round(totalPending, 2, MidpointRounding.AwayFromZero),
            this_month_hours = decimal.Round(thisMonth, 2, MidpointRounding.AwayFromZero),
            total_entries = totalEntries
        };
    }

    public async Task<VolunteerHoursPage> PendingForReviewerAsync(
        int tenantId,
        int reviewerId,
        int perPage,
        string? cursor,
        CancellationToken ct = default)
    {
        var owned = _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(org => org.TenantId == tenantId && org.OwnerUserId == reviewerId)
            .Select(org => org.Id);
        var member = _db.VolunteerOrganisationMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId
                && row.UserId == reviewerId
                && row.Status == "active"
                && (row.Role == "owner" || row.Role == "admin"))
            .Select(row => row.VolunteerOrganisationId);
        var organisationIds = await owned.Union(member).ToArrayAsync(ct);
        return await PendingPageAsync(
            tenantId,
            organisationIds,
            perPage,
            cursor,
            base64Cursor: true,
            includeOrganisation: true,
            ct);
    }

    public async Task<VolunteerHoursPageResult> PendingForOrganisationAsync(
        int tenantId,
        int reviewerId,
        int organisationId,
        int perPage,
        string? cursor,
        bool tenantAdministrator,
        CancellationToken ct = default)
    {
        var organisation = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(org => org.TenantId == tenantId && org.Id == organisationId, ct);
        if (organisation is null
            || (!tenantAdministrator
                && !await CanReviewOrganisationAsync(
                    tenantId,
                    reviewerId,
                    organisationId,
                    organisation.OwnerUserId,
                    ct)))
        {
            return VolunteerHoursPageResult.Failed(
                403,
                "FORBIDDEN",
                "Access denied.");
        }

        return VolunteerHoursPageResult.Succeeded(await PendingPageAsync(
            tenantId,
            [organisationId],
            perPage,
            cursor,
            base64Cursor: false,
            includeOrganisation: false,
            ct));
    }

    public async Task<VolunteerHoursAdminPage> AdminListAsync(
        int tenantId,
        int perPage,
        string? cursor,
        string? status,
        CancellationToken ct = default)
    {
        perPage = Math.Clamp(perPage, 1, 50);
        var cursorId = DecodeCursor(cursor, base64Encoded: true);
        var selectedStatus = status?.Trim();
        if (selectedStatus is not ("pending" or "approved" or "declined"))
            selectedStatus = null;

        var allLogs = _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId);
        var totalHours = await allLogs.SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
        var approvedHours = await allLogs.Where(log => log.Status == "approved")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
        var pendingHours = await allLogs.Where(log => log.Status == "pending")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
        var stats = new
        {
            total_hours = decimal.Round(totalHours, 1, MidpointRounding.AwayFromZero),
            approved_hours = decimal.Round(approvedHours, 1, MidpointRounding.AwayFromZero),
            pending_hours = decimal.Round(pendingHours, 1, MidpointRounding.AwayFromZero),
            total_paid = decimal.Round(
                await _db.VolunteerOrganisationTransactions
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(row => row.TenantId == tenantId
                        && row.Type == VolunteerPaymentType
                        && row.VolunteerLogId != null)
                    .SumAsync(row => (decimal?)Math.Abs(row.Amount), ct) ?? 0m,
                2,
                MidpointRounding.AwayFromZero)
        };

        var query = allLogs;
        if (selectedStatus is not null)
            query = query.Where(log => log.Status == selectedStatus);
        if (cursorId is int id)
            query = query.Where(log => log.Id < id);

        var logs = await query
            .OrderByDescending(log => log.CreatedAt)
            .ThenByDescending(log => log.Id)
            .Take(perPage + 1)
            .ToListAsync(ct);
        var hasMore = logs.Count > perPage;
        if (hasMore)
            logs.RemoveAt(logs.Count - 1);

        var userIds = logs.Select(log => log.UserId).Distinct().ToArray();
        var organisationIds = logs.Where(log => log.OrganizationId.HasValue)
            .Select(log => log.OrganizationId!.Value)
            .Distinct()
            .ToArray();
        var logIds = logs.Select(log => log.Id).ToArray();
        var users = userIds.Length == 0
            ? new Dictionary<int, User>()
            : await _db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(user => user.TenantId == tenantId && userIds.Contains(user.Id))
                .ToDictionaryAsync(user => user.Id, ct);
        var organisations = organisationIds.Length == 0
            ? new Dictionary<int, VolunteerOrganisation>()
            : await _db.VolunteerOrganisations.IgnoreQueryFilters().AsNoTracking()
                .Where(org => org.TenantId == tenantId && organisationIds.Contains(org.Id))
                .ToDictionaryAsync(org => org.Id, ct);
        var paymentRows = logIds.Length == 0
            ? []
            : await _db.VolunteerOrganisationTransactions.IgnoreQueryFilters().AsNoTracking()
                .Where(row => row.TenantId == tenantId
                    && row.Type == VolunteerPaymentType
                    && row.VolunteerLogId.HasValue
                    && logIds.Contains(row.VolunteerLogId.Value))
                .GroupBy(row => row.VolunteerLogId!.Value)
                .Select(grouped => new VolunteerHourPaymentRow(
                    grouped.Key,
                    grouped.Sum(row => Math.Abs(row.Amount))))
                .ToArrayAsync(ct);
        var payments = paymentRows.ToDictionary(row => row.LogId, row => row.Amount);

        var items = logs.Select(log =>
        {
            users.TryGetValue(log.UserId, out var user);
            var org = log.OrganizationId.HasValue
                && organisations.TryGetValue(log.OrganizationId.Value, out var foundOrg)
                    ? foundOrg
                    : null;
            var hasPayment = payments.TryGetValue(log.Id, out var paidAmount);
            return (object)new
            {
                id = log.Id,
                hours = log.Hours.ToString("0.00", CultureInfo.InvariantCulture),
                status = log.Status,
                created_at = log.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                paid = hasPayment ? 1 : 0,
                paid_amount = paidAmount.ToString("0.00", CultureInfo.InvariantCulture),
                first_name = user?.FirstName,
                last_name = user?.LastName,
                org_name = org?.Name
            };
        }).ToArray();
        var nextCursor = hasMore && logs.Count > 0 ? EncodeCursor(logs[^1].Id) : null;
        var meta = new
        {
            per_page = perPage,
            has_more = hasMore,
            next_cursor = nextCursor
        };
        return new VolunteerHoursAdminPage(items, stats, meta, nextCursor, hasMore, perPage);
    }

    private async Task<VolunteerHoursPage> PendingPageAsync(
        int tenantId,
        IReadOnlyCollection<int> organisationIds,
        int perPage,
        string? cursor,
        bool base64Cursor,
        bool includeOrganisation,
        CancellationToken ct)
    {
        perPage = Math.Clamp(perPage, 1, 50);
        var cursorId = DecodeCursor(cursor, base64Cursor);
        if (organisationIds.Count == 0)
            return new VolunteerHoursPage([], null, false, perPage);

        var query = _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(log => log.User)
            .Include(log => log.Organization)
            .Include(log => log.Opportunity)
            .Where(log => log.TenantId == tenantId
                && log.Status == "pending"
                && log.OrganizationId.HasValue
                && organisationIds.Contains(log.OrganizationId.Value));
        if (cursorId is int id)
            query = query.Where(log => log.Id < id);

        var orderedQuery = includeOrganisation
            ? query.OrderByDescending(log => log.CreatedAt).ThenByDescending(log => log.Id)
            : query.OrderByDescending(log => log.Id);
        var rows = await orderedQuery
            .Take(perPage + 1)
            .ToListAsync(ct);
        var hasMore = rows.Count > perPage;
        if (hasMore)
            rows.RemoveAt(rows.Count - 1);

        var items = rows.Select(log =>
        {
            var item = new Dictionary<string, object?>
            {
                ["id"] = log.Id,
                ["hours"] = log.Hours,
                ["date"] = log.DateLogged.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["description"] = log.Description,
                ["status"] = NormalizeStatus(log.Status),
                ["created_at"] = log.CreatedAt.ToString(
                    "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture),
                ["user"] = new
                {
                    id = log.UserId,
                    name = log.User is null
                        ? string.Empty
                        : (log.User.FirstName + " " + log.User.LastName).Trim(),
                    avatar_url = log.User?.AvatarUrl
                }
            };
            if (includeOrganisation)
            {
                item["organization"] = log.Organization is null
                    ? null
                    : new
                    {
                        id = log.Organization.Id,
                        name = log.Organization.Name,
                        logo_url = log.Organization.LogoUrl
                    };
            }

            item["opportunity"] = log.Opportunity is null
                ? null
                : new
                {
                    id = log.Opportunity.Id,
                    title = log.Opportunity.Title
                };
            return (object)item;
        }).ToArray();
        var nextCursor = hasMore && rows.Count > 0
            ? base64Cursor ? EncodeCursor(rows[^1].Id) : rows[^1].Id.ToString(CultureInfo.InvariantCulture)
            : null;
        return new VolunteerHoursPage(items, nextCursor, hasMore, perPage);
    }

    private async Task<string?> ApplyApprovalEffectsAsync(
        VolunteerLog log,
        bool caringProfile,
        bool awardXp,
        CancellationToken ct,
        decimal? approvalHours = null)
    {
        VolunteerOrganisation? organisation = null;
        if (log.OrganizationId is int organisationId)
        {
            var organisationExists = await _db.VolunteerOrganisations
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(org => org.Id == organisationId
                    && org.TenantId == log.TenantId, ct);
            if (organisationExists)
            {
                if (_db.Database.IsRelational())
                {
                    await _personalWallet.AcquireSpendLockAsync(log.UserId, ct);
                    await _db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT pg_advisory_xact_lock({log.TenantId}, {-organisationId})",
                        ct);
                }

                organisation = await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .SingleAsync(org => org.Id == organisationId
                        && org.TenantId == log.TenantId, ct);
            }
        }

        if (awardXp)
        {
            var volunteer = await _db.Users
                .IgnoreQueryFilters()
                .SingleAsync(user => user.Id == log.UserId && user.TenantId == log.TenantId, ct);
            await AwardVolunteerHourXpAsync(log, volunteer, ct);
        }

        if (organisation is null)
            return caringProfile ? null : "no_org";

        var wholeHours = decimal.ToInt32(decimal.Floor(approvalHours ?? log.Hours));
        var amount = (decimal)wholeHours;
        var existingPayments = await _db.VolunteerOrganisationTransactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == log.TenantId && row.VolunteerLogId == log.Id)
            .ToListAsync(ct);
        var existingPersonalMints = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == log.TenantId && row.VolunteerLogId == log.Id)
            .ToListAsync(ct);
        if (existingPayments.Count != existingPersonalMints.Count
            || existingPayments.Count > 1)
        {
            throw new InvalidOperationException(
                $"Volunteer log {log.Id} has incomplete payout evidence.");
        }

        if (existingPayments.Count == 1)
        {
            var organisationPayment = existingPayments[0];
            var personalMint = existingPersonalMints[0];
            if (wholeHours <= 0
                || organisationPayment.VolunteerOrganisationId != organisation.Id
                || organisationPayment.UserId != log.UserId
                || organisationPayment.Type != VolunteerPaymentType
                || organisationPayment.Amount != -amount
                || personalMint.SenderId is not null
                || personalMint.ReceiverId != log.UserId
                || personalMint.Amount != amount
                || personalMint.TransactionType != PersonalTransactionType
                || personalMint.Status != TransactionStatus.Completed)
            {
                throw new InvalidOperationException(
                    $"Volunteer log {log.Id} has invalid payout evidence.");
            }

            return "already_paid";
        }

        if (wholeHours <= 0)
            return caringProfile ? "no_payable_hours" : "no_whole_hours";

        organisation.Balance -= amount;
        organisation.UpdatedAt = DateTime.UtcNow;
        var description = $"Volunteer payment for {wholeHours} approved hour{(wholeHours == 1 ? string.Empty : "s")}.";

        _db.VolunteerOrganisationTransactions.Add(new VolunteerOrganisationTransaction
        {
            TenantId = log.TenantId,
            VolunteerOrganisationId = organisation.Id,
            UserId = log.UserId,
            VolunteerLogId = log.Id,
            Type = VolunteerPaymentType,
            Amount = -amount,
            BalanceAfter = organisation.Balance,
            Description = description,
            CreatedAt = DateTime.UtcNow
        });
        _db.Transactions.Add(new Transaction
        {
            TenantId = log.TenantId,
            SenderId = null,
            ReceiverId = log.UserId,
            Amount = amount,
            Description = description,
            TransactionType = PersonalTransactionType,
            VolunteerLogId = log.Id,
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });

        return "paid";
    }

    private async Task AwardVolunteerHourXpAsync(
        VolunteerLog log,
        User volunteer,
        CancellationToken ct)
    {
        var expectedXp = decimal.ToInt32(decimal.Round(
            log.Hours * XpLog.Amounts.VolunteerHour,
            0,
            MidpointRounding.AwayFromZero));
        var existingAwards = await _db.XpLogs
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == log.TenantId
                && row.Source == XpLog.Sources.VolunteerHour
                && row.ReferenceId == log.Id)
            .ToListAsync(ct);
        if (existingAwards.Count > 1
            || (existingAwards.Count == 1
                && (existingAwards[0].UserId != log.UserId
                    || existingAwards[0].Amount != expectedXp)))
        {
            throw new InvalidOperationException(
                $"Volunteer log {log.Id} has invalid XP evidence.");
        }
        if (existingAwards.Count == 1)
            return;

        if (expectedXp <= 0)
            return;

        _db.XpLogs.Add(new XpLog
        {
            TenantId = log.TenantId,
            UserId = log.UserId,
            Amount = expectedXp,
            Source = XpLog.Sources.VolunteerHour,
            ReferenceId = log.Id,
            Description = $"Volunteer hours approved ({log.Hours:0.00}h) [vol_log:{log.Id}]",
            CreatedAt = DateTime.UtcNow
        });
        volunteer.TotalXp += expectedXp;
        volunteer.Level = User.CalculateLevelFromXp(volunteer.TotalXp);
        volunteer.UpdatedAt = DateTime.UtcNow;
    }

    private async Task DispatchReviewNotificationAsync(
        int tenantId,
        VolunteerLog log,
        string? paymentOutcome,
        CancellationToken ct)
    {
        var approved = string.Equals(log.Status, "approved", StringComparison.OrdinalIgnoreCase);
        var paid = paymentOutcome == "paid";
        var link = paid ? "/wallet" : "/volunteering?tab=hours";
        var title = approved ? "Volunteer hours approved" : "Volunteer hours declined";
        var body = approved
            ? paid
                ? $"Your {log.Hours:0.##} volunteer hours were approved and time credits were added to your wallet."
                : paymentOutcome == "no_whole_hours"
                    ? $"Your {log.Hours:0.##} h were approved, but that is under an hour so no time credit was added."
                    : $"Your {log.Hours:0.##} volunteer hours were approved."
            : $"Your {log.Hours:0.##} volunteer hours were declined.";
        var data = JsonSerializer.Serialize(new
        {
            vol_log_id = log.Id,
            hours = log.Hours,
            status = log.Status,
            payment_result = paymentOutcome,
            url = link
        });
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = log.UserId,
            Type = approved ? "vol_hours_approved" : "vol_hours_declined",
            Title = title,
            Body = body,
            Data = data,
            Link = link,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception)
        {
            _db.Entry(notification).State = EntityState.Detached;
            _logger.LogWarning(
                exception,
                "Failed to create volunteer-hours notification for log {LogId}",
                log.Id);
        }

        if (_pushNotifications is null)
            return;

        var existingPushEntries = _db.ChangeTracker
            .Entries<PushNotificationLog>()
            .Select(entry => entry.Entity)
            .ToHashSet(ReferenceEqualityComparer.Instance);
        try
        {
            await _pushNotifications.SendPushAsync(log.UserId, title, body, data);
        }
        catch (Exception exception)
        {
            foreach (var entry in _db.ChangeTracker.Entries<PushNotificationLog>()
                .Where(entry => !existingPushEntries.Contains(entry.Entity)))
            {
                entry.State = EntityState.Detached;
            }

            _logger.LogWarning(
                exception,
                "Failed to queue volunteer-hours push for log {LogId}",
                log.Id);
        }
    }

    private async Task TryDispatchApprovalSideEffectsAsync(
        int tenantId,
        int logId,
        int userId,
        CancellationToken ct)
    {
        if (_gamification is not null)
        {
            try
            {
                await _gamification.RunAllBadgeChecksAsync(tenantId, userId, ct);
            }
            catch (Exception exception)
            {
                // The core status, payment and volunteer-hour XP transaction has
                // already committed. Discard any rolled-back tracked badge state so
                // a later notification SaveChanges cannot accidentally persist it.
                _db.ChangeTracker.Clear();
                _logger.LogWarning(
                    exception,
                    "Failed to run post-approval badge checks for tenant {TenantId}, log {LogId}, user {UserId}",
                    tenantId,
                    logId,
                    userId);
            }
        }

        if (_feedActivity is null)
            return;

        try
        {
            var log = await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Id == logId, ct);
            if (log is null)
                return;

            var showPublicly = await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(user => user.TenantId == tenantId && user.Id == userId)
                .Select(user => user.ShowOnLeaderboard)
                .SingleOrDefaultAsync(ct);
            if (showPublicly == false)
                return;

            var organisationName = log.OrganizationId is int organisationId
                ? await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(org => org.TenantId == tenantId && org.Id == organisationId)
                    .Select(org => org.Name)
                    .SingleOrDefaultAsync(ct)
                : null;

            await _feedActivity.RecordVolunteerHoursAsync(
                tenantId,
                userId,
                logId,
                log.Hours,
                log.OrganizationId,
                organisationName,
                log.OpportunityId,
                ct);
        }
        catch (Exception exception)
        {
            _db.ChangeTracker.Clear();
            _logger.LogWarning(
                exception,
                "Failed to publish approved volunteer hours for tenant {TenantId}, log {LogId}, user {UserId}",
                tenantId,
                logId,
                userId);
        }
    }

    private async Task TrySendVolunteerHoursDecisionEmailAsync(
        int tenantId,
        VolunteerLog log,
        string? paymentOutcome)
    {
        if (_emailNotifications is null)
            return;

        try
        {
            // Laravel treats an approval as a critical instant email, while a
            // decline follows the member's global notification frequency and
            // defaults to off. ASP does not yet have Laravel's digest queue, so
            // never turn a daily/monthly/off preference into an unsolicited
            // immediate decline email.
            if (string.Equals(log.Status, "declined", StringComparison.OrdinalIgnoreCase))
            {
                var frequency = await _db.TenantConfigs
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(config => config.TenantId == tenantId
                        && config.Key == $"notification_settings.{log.UserId}.global.0")
                    .Select(config => config.Value)
                    .SingleOrDefaultAsync(CancellationToken.None);
                if (!string.Equals(frequency?.Trim(), "instant", StringComparison.OrdinalIgnoreCase))
                    return;
            }

            var organisationName = log.OrganizationId is int organisationId
                ? await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(org => org.TenantId == tenantId && org.Id == organisationId)
                    .Select(org => org.Name)
                    .SingleOrDefaultAsync(CancellationToken.None)
                : null;
            var sent = await _emailNotifications.SendVolunteerHoursDecisionEmailAsync(
                log.UserId,
                tenantId,
                string.Equals(log.Status, "approved", StringComparison.OrdinalIgnoreCase)
                    ? "approved"
                    : "declined",
                log.Hours,
                organisationName ?? "the organisation",
                paymentOutcome);
            if (!sent)
            {
                _logger.LogWarning(
                    "Volunteer-hours decision email was not sent for tenant {TenantId}, log {LogId}, user {UserId}",
                    tenantId,
                    log.Id,
                    log.UserId);
            }
        }
        catch (Exception exception)
        {
            _db.ChangeTracker.Clear();
            _logger.LogWarning(
                exception,
                "Failed to send volunteer-hours decision email for tenant {TenantId}, log {LogId}, user {UserId}",
                tenantId,
                log.Id,
                log.UserId);
        }
    }

    private async Task<VolunteerHoursError?> ValidateVolunteerRelationshipAsync(
        int tenantId,
        int userId,
        int organisationId,
        int? opportunityId,
        CancellationToken ct)
    {
        if (opportunityId is int selectedOpportunityId)
        {
            var opportunityExists = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(opportunity => opportunity.Id == selectedOpportunityId
                    && opportunity.TenantId == tenantId
                    && opportunity.VolunteerOrganisationId == organisationId, ct);
            if (!opportunityExists)
            {
                return new VolunteerHoursError(
                    404,
                    "NOT_FOUND",
                    "Opportunity not found.",
                    "opportunity_id");
            }

            var approvedApplication = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(application => application.TenantId == tenantId
                    && application.UserId == userId
                    && application.OpportunityId == selectedOpportunityId
                    && application.Status == ApplicationStatus.Approved, ct);
            return approvedApplication
                ? null
                : new VolunteerHoursError(
                    403,
                    "FORBIDDEN",
                    "An approved application is required for this opportunity.",
                    "opportunity_id");
        }

        var ownsOrBelongs = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(org => org.Id == organisationId
                && org.TenantId == tenantId
                && (org.OwnerUserId == userId
                    || _db.VolunteerOrganisationMembers.IgnoreQueryFilters().Any(member =>
                        member.TenantId == tenantId
                        && member.VolunteerOrganisationId == organisationId
                        && member.UserId == userId
                        && member.Status == "active")), ct);
        if (ownsOrBelongs)
            return null;

        var hasApprovedApplication = await _db.VolunteerApplications
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(application => application.TenantId == tenantId
                && application.UserId == userId
                && application.Status == ApplicationStatus.Approved
                && _db.VolunteerOpportunities.IgnoreQueryFilters().Any(opportunity =>
                    opportunity.Id == application.OpportunityId
                    && opportunity.TenantId == tenantId
                    && opportunity.VolunteerOrganisationId == organisationId), ct);
        return hasApprovedApplication
            ? null
            : new VolunteerHoursError(
                403,
                "FORBIDDEN",
                "An approved application or active organisation relationship is required.",
                "organization_id");
    }

    private async Task<bool> CanReviewOrganisationAsync(
        int tenantId,
        int reviewerId,
        int organisationId,
        int ownerId,
        CancellationToken ct)
    {
        if (reviewerId == ownerId)
            return true;

        return await _db.VolunteerOrganisationMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(member => member.TenantId == tenantId
                && member.VolunteerOrganisationId == organisationId
                && member.UserId == reviewerId
                && member.Status == "active"
                && (member.Role == "owner" || member.Role == "admin"), ct);
    }

    private async Task<bool> HasHoursReviewPermissionAsync(
        User user,
        int tenantId,
        CancellationToken ct)
    {
        var permissionsJson = await _db.Roles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(role => role.TenantId == tenantId && role.Name == user.Role)
            .Select(role => role.Permissions)
            .SingleOrDefaultAsync(ct);
        if (string.IsNullOrWhiteSpace(permissionsJson))
            return false;

        try
        {
            return JsonSerializer.Deserialize<string[]>(permissionsJson)
                ?.Contains("volunteering.hours.review", StringComparer.Ordinal)
                == true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task<VolunteerHourSettings> LoadSettingsAsync(
        int tenantId,
        CancellationToken ct)
    {
        var keys = new[]
        {
            MaxHoursConfigKey,
            RequireVerificationConfigKey,
            CaringApprovalRequiredConfigKey,
            CaringAutoApproveTrustedConfigKey,
            CaringAllowSelfLogConfigKey
        };
        var values = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && keys.Contains(config.Key))
            .ToDictionaryAsync(config => config.Key, config => config.Value, ct);

        var maxHours = values.TryGetValue(MaxHoursConfigKey, out var rawMax)
            && int.TryParse(CleanConfig(rawMax), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMax)
            && parsedMax is > 0 and <= 24
                ? parsedMax
                : 24;
        return new VolunteerHourSettings(
            maxHours,
            ConfigBool(values, RequireVerificationConfigKey, true),
            ConfigBool(values, CaringApprovalRequiredConfigKey, true),
            ConfigBool(values, CaringAutoApproveTrustedConfigKey, false),
            ConfigBool(values, CaringAllowSelfLogConfigKey, true));
    }

    private IQueryable<VolunteerLog> ActiveDuplicateQuery(
        int tenantId,
        int userId,
        int organisationId,
        DateOnly date,
        int? opportunityId)
    {
        return _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(log => log.TenantId == tenantId
                && log.UserId == userId
                && log.OrganizationId == organisationId
                && log.DateLogged == date
                && log.OpportunityId == opportunityId
                && log.Status != "declined"
                && log.Status != "rejected");
    }

    private async Task AcquireDuplicateLockAsync(
        int tenantId,
        int userId,
        int organisationId,
        DateOnly date,
        int? opportunityId,
        CancellationToken ct)
    {
        var keyMaterial = string.Create(
            CultureInfo.InvariantCulture,
            $"{tenantId}:{userId}:{organisationId}:{date:yyyy-MM-dd}:{opportunityId?.ToString(CultureInfo.InvariantCulture) ?? "none"}");
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(keyMaterial));
        var key = BinaryPrimitives.ReadInt32BigEndian(digest.AsSpan(0, sizeof(int)));
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({tenantId}, {key})",
            ct);
    }

    private static VolunteerHoursError? ValidateLogCommand(
        VolunteerHourLogCommand command,
        out DateOnly date)
    {
        date = default;
        if (command.OrganizationId is null)
            return new(422, "VALIDATION_ERROR", "Organisation is required.", "organization_id");
        if (command.OrganizationId == 0)
            return new(400, "VALIDATION_ERROR", "Organisation is required.", "organization_id");
        if (!TryParseLaravelDate(command.Date, out date))
        {
            return new(422, "VALIDATION_ERROR", "A valid date is required.", "date");
        }

        if (date > DateOnly.FromDateTime(DateTime.UtcNow))
            return new(422, "VALIDATION_ERROR", "Date cannot be in the future.", "date");
        if (command.Hours is null || command.Hours < 0.25m || command.Hours > 24m)
            return new(422, "VALIDATION_ERROR", "Hours must be between 0.25 and 24.", "hours");
        if (command.Description?.Length > 1000)
            return new(422, "VALIDATION_ERROR", "Description cannot exceed 1000 characters.", "description");
        return null;
    }

    private static bool TryParseLaravelDate(string? raw, out DateOnly date)
    {
        date = default;
        raw = raw?.Trim();
        if (string.IsNullOrEmpty(raw))
            return false;

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (raw.Equals("today", StringComparison.OrdinalIgnoreCase))
        {
            date = today;
            return true;
        }
        if (raw.Equals("yesterday", StringComparison.OrdinalIgnoreCase))
        {
            date = today.AddDays(-1);
            return true;
        }
        if (raw.Equals("tomorrow", StringComparison.OrdinalIgnoreCase))
        {
            date = today.AddDays(1);
            return true;
        }

        if (DateOnly.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces,
                out date))
        {
            return true;
        }

        if (!DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeUniversal,
                out var timestamp))
        {
            return false;
        }

        date = DateOnly.FromDateTime(timestamp.DateTime);
        return true;
    }

    private static bool IsAdminTier(User user) =>
        AdminRoles.Contains(user.Role)
        || user.IsAdmin
        || user.IsSuperAdmin
        || user.IsTenantSuperAdmin
        || user.IsGod;

    private static bool IsApprovedOrganisation(string? status) =>
        status is not null
        && (status.Equals("active", StringComparison.OrdinalIgnoreCase)
            || status.Equals("approved", StringComparison.OrdinalIgnoreCase));

    private static bool ConfigBool(
        IReadOnlyDictionary<string, string> values,
        string key,
        bool defaultValue)
    {
        if (!values.TryGetValue(key, out var raw))
            return defaultValue;
        var value = CleanConfig(raw).ToLowerInvariant();
        return value switch
        {
            "1" or "true" or "yes" or "on" or "enabled" => true,
            "0" or "false" or "no" or "off" or "disabled" => false,
            _ => defaultValue
        };
    }

    private static bool IsExplicitlyDisabled(string? raw)
    {
        var value = CleanConfig(raw).ToLowerInvariant();
        return value is "0" or "false" or "no" or "off" or "disabled";
    }

    private static string CleanConfig(string? raw) => raw?.Trim().Trim('"') ?? string.Empty;

    private static DateTime NextCaringCheckIn(DateOnly loggedDate, string frequency)
    {
        var date = frequency switch
        {
            "fortnightly" => loggedDate.AddDays(14),
            "monthly" => loggedDate.AddMonths(1),
            "ad_hoc" => loggedDate.AddDays(30),
            _ => loggedDate.AddDays(7)
        };
        return DateTime.SpecifyKind(date.ToDateTime(new TimeOnly(9, 0)), DateTimeKind.Utc);
    }

    private static string? NullIfWhiteSpace(string? value)
    {
        value = value?.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string NormalizeStatus(string status) =>
        status.Equals("rejected", StringComparison.OrdinalIgnoreCase)
            ? "declined"
            : status.ToLowerInvariant();

    private static string? LaravelTimestamp(DateTime? value)
    {
        if (value is null)
            return null;

        var utc = value.Value.Kind == DateTimeKind.Local
            ? value.Value.ToUniversalTime()
            : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
        return utc.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture);
    }

    private static string EncodeCursor(int id) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString(CultureInfo.InvariantCulture)));

    private static int? DecodeCursor(string? cursor, bool base64Encoded)
    {
        if (string.IsNullOrWhiteSpace(cursor))
            return null;

        try
        {
            var raw = base64Encoded
                ? Encoding.UTF8.GetString(Convert.FromBase64String(cursor))
                : cursor;
            return int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                && id > 0
                    ? id
                    : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static bool IsUniqueViolation(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
                return true;
        }

        return false;
    }

    private static async Task SafeRollbackAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction)
    {
        if (transaction is null)
            return;

        try
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }
        catch
        {
            // The provider may already have rolled back the transaction.
        }
    }

    private sealed record VolunteerHourSettings(
        int MaxHours,
        bool RequireVerification,
        bool ApprovalRequired,
        bool AutoApproveTrustedReviewers,
        bool AllowMemberSelfLog);

    private sealed record VolunteerHourPaymentRow(int LogId, decimal Amount);
}

public sealed record VolunteerHourLogCommand(
    int? OrganizationId,
    int? OpportunityId,
    string? Date,
    decimal? Hours,
    string? Description);

public sealed record VolunteerHoursError(
    int StatusCode,
    string Code,
    string Message,
    string? Field = null);

public sealed record VolunteerHourMutationValue(
    int Id,
    string Status,
    string? PaymentOutcome,
    string Message);

public sealed record VolunteerHourMutationResult(
    bool IsSuccess,
    VolunteerHourMutationValue? Value,
    VolunteerHoursError? Error)
{
    public static VolunteerHourMutationResult Succeeded(
        int id,
        string status,
        string? paymentOutcome,
        string message) =>
        new(true, new(id, status, paymentOutcome, message), null);

    public static VolunteerHourMutationResult Failed(VolunteerHoursError error) =>
        new(false, null, error);

    public static VolunteerHourMutationResult Failed(
        int statusCode,
        string code,
        string message,
        string? field = null) =>
        Failed(new VolunteerHoursError(statusCode, code, message, field));
}

public sealed record VolunteerHoursPage(
    IReadOnlyList<object> Items,
    string? Cursor,
    bool HasMore,
    int PerPage);

public sealed record VolunteerHoursPageResult(
    bool IsSuccess,
    VolunteerHoursPage? Page,
    VolunteerHoursError? Error)
{
    public static VolunteerHoursPageResult Succeeded(VolunteerHoursPage page) =>
        new(true, page, null);

    public static VolunteerHoursPageResult Failed(
        int statusCode,
        string code,
        string message,
        string? field = null) =>
        new(false, null, new(statusCode, code, message, field));
}

public sealed record VolunteerHoursAdminPage(
    IReadOnlyList<object> Items,
    object Stats,
    object Meta,
    string? NextCursor,
    bool HasMore,
    int PerPage);

public sealed record CaringVolunteerHourLogResult(
    bool IsSuccess,
    VolunteerLog? Log,
    CaringSupportRelationship? Relationship,
    string? PaymentOutcome,
    string? ErrorCode)
{
    public static CaringVolunteerHourLogResult Succeeded(
        VolunteerLog log,
        CaringSupportRelationship relationship,
        string? paymentOutcome) =>
        new(true, log, relationship, paymentOutcome, null);

    public static CaringVolunteerHourLogResult Failed(string errorCode) =>
        new(false, null, null, null, errorCode);
}
