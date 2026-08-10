// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing volunteer opportunities, shifts, applications, and check-ins.
/// </summary>
public class VolunteerService
{
    private static readonly bool CoordinatorAttendanceWorkflowAvailable = false;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<VolunteerService> _logger;
    private readonly AdminVolunteerApprovalService _approvalDecisions;
    private readonly VolunteerGuardianConsentService _guardianConsent;
    private readonly VolunteerOrganisationService _volunteerOrganisations;
    private readonly PushNotificationService? _pushNotifications;

    public VolunteerService(
        NexusDbContext db,
        TenantContext tenantContext,
        GamificationService gamification,
        ILogger<VolunteerService> logger,
        AdminVolunteerApprovalService approvalDecisions,
        VolunteerGuardianConsentService guardianConsent,
        VolunteerOrganisationService volunteerOrganisations,
        PushNotificationService? pushNotifications = null)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamification = gamification;
        _logger = logger;
        _approvalDecisions = approvalDecisions;
        _guardianConsent = guardianConsent;
        _volunteerOrganisations = volunteerOrganisations;
        _pushNotifications = pushNotifications;
    }

    // === Opportunities ===

    /// <summary>
    /// Create a new volunteer opportunity (starts in Draft status).
    /// </summary>
    public async Task<(VolunteerOpportunity? Opportunity, string? Error)> CreateOpportunityAsync(
        int organizerId, string title, string? description, int? groupId, string? location,
        int? categoryId, int requiredVolunteers, bool isRecurring, DateTime? startsAt,
        DateTime? endsAt, DateTime? applicationDeadline, string? skillsRequired, decimal? creditReward,
        int? volunteerOrganisationId)
    {
        if (string.IsNullOrWhiteSpace(title))
            return (null, "Title is required");

        if (requiredVolunteers < 1)
            return (null, "At least one volunteer is required");

        if (startsAt.HasValue && endsAt.HasValue && endsAt <= startsAt)
            return (null, "End date must be after start date");

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (!volunteerOrganisationId.HasValue || volunteerOrganisationId.Value <= 0)
            return (null, "Organisation is required");

        var organisation = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(org => org.Id == volunteerOrganisationId.Value
                && org.TenantId == tenantId);
        if (organisation is null || organisation.Status is not ("approved" or "active"))
            return (null, "Organization not found");

        if (!await _volunteerOrganisations.CanManageOrganisationAsync(
            organisation.Id,
            organizerId,
            tenantId))
        {
            return (null, "You do not have permission to manage this organisation");
        }

        // Validate group exists if specified
        if (groupId.HasValue)
        {
            var groupExists = await _db.Groups.AnyAsync(g => g.Id == groupId.Value);
            if (!groupExists)
                return (null, "Group not found");
        }

        // Validate category exists if specified
        if (categoryId.HasValue)
        {
            var categoryExists = await _db.Categories.AnyAsync(c => c.Id == categoryId.Value);
            if (!categoryExists)
                return (null, "Category not found");
        }

        var opportunity = new VolunteerOpportunity
        {
            TenantId = tenantId,
            Title = title.Trim(),
            Description = description?.Trim(),
            OrganizerId = organizerId,
            VolunteerOrganisationId = organisation.Id,
            GroupId = groupId,
            Location = location?.Trim(),
            CategoryId = categoryId,
            Status = OpportunityStatus.Draft,
            RequiredVolunteers = requiredVolunteers,
            IsRecurring = isRecurring,
            StartsAt = startsAt,
            EndsAt = endsAt,
            ApplicationDeadline = applicationDeadline,
            SkillsRequired = skillsRequired?.Trim(),
            CreditReward = creditReward,
            CreatedAt = DateTime.UtcNow
        };

        _db.VolunteerOpportunities.Add(opportunity);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Volunteer opportunity {OpportunityId} created by user {UserId}",
            opportunity.Id, organizerId);

        return (opportunity, null);
    }

    /// <summary>
    /// Update an existing volunteer opportunity. Only the organizer can update.
    /// </summary>
    public async Task<(VolunteerOpportunity? Opportunity, string? Error)> UpdateOpportunityAsync(
        int opportunityId, int userId, string? title, string? description, string? location,
        int? categoryId, int? requiredVolunteers, bool? isRecurring, DateTime? startsAt,
        DateTime? endsAt, DateTime? applicationDeadline, string? skillsRequired, decimal? creditReward)
    {
        var opportunity = await _db.VolunteerOpportunities
            .FirstOrDefaultAsync(o => o.Id == opportunityId);

        if (opportunity == null)
            return (null, "Opportunity not found");

        if (opportunity.OrganizerId != userId)
            return (null, "Only the organizer can update this opportunity");

        if (opportunity.Status == OpportunityStatus.Cancelled)
            return (null, "Cannot update a cancelled opportunity");

        if (title != null)
        {
            if (string.IsNullOrWhiteSpace(title))
                return (null, "Title cannot be empty");
            opportunity.Title = title.Trim();
        }

        if (description != null) opportunity.Description = description.Trim();
        if (location != null) opportunity.Location = location.Trim();
        if (categoryId.HasValue) opportunity.CategoryId = categoryId.Value;
        if (requiredVolunteers.HasValue)
        {
            if (requiredVolunteers.Value < 1)
                return (null, "At least one volunteer is required");
            opportunity.RequiredVolunteers = requiredVolunteers.Value;
        }
        if (isRecurring.HasValue) opportunity.IsRecurring = isRecurring.Value;
        if (startsAt.HasValue) opportunity.StartsAt = startsAt.Value;
        if (endsAt.HasValue) opportunity.EndsAt = endsAt.Value;
        if (applicationDeadline.HasValue) opportunity.ApplicationDeadline = applicationDeadline.Value;
        if (skillsRequired != null) opportunity.SkillsRequired = skillsRequired.Trim();
        if (creditReward.HasValue) opportunity.CreditReward = creditReward.Value;

        opportunity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Volunteer opportunity {OpportunityId} updated by user {UserId}",
            opportunityId, userId);

        return (opportunity, null);
    }

    /// <summary>
    /// Publish a draft opportunity so it becomes visible and accepts applications.
    /// </summary>
    public async Task<(VolunteerOpportunity? Opportunity, string? Error)> PublishOpportunityAsync(
        int opportunityId, int userId)
    {
        var opportunity = await _db.VolunteerOpportunities
            .FirstOrDefaultAsync(o => o.Id == opportunityId);

        if (opportunity == null)
            return (null, "Opportunity not found");

        if (opportunity.OrganizerId != userId)
            return (null, "Only the organizer can publish this opportunity");

        if (opportunity.Status != OpportunityStatus.Draft)
            return (null, $"Cannot publish an opportunity with status {opportunity.Status}");

        opportunity.Status = OpportunityStatus.Published;
        opportunity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Volunteer opportunity {OpportunityId} published by user {UserId}",
            opportunityId, userId);

        return (opportunity, null);
    }

    /// <summary>
    /// Close an opportunity so it no longer accepts applications.
    /// </summary>
    public async Task<(VolunteerOpportunity? Opportunity, string? Error)> CloseOpportunityAsync(
        int opportunityId, int userId)
    {
        var opportunity = await _db.VolunteerOpportunities
            .FirstOrDefaultAsync(o => o.Id == opportunityId);

        if (opportunity == null)
            return (null, "Opportunity not found");

        if (opportunity.OrganizerId != userId)
            return (null, "Only the organizer can close this opportunity");

        if (opportunity.Status != OpportunityStatus.Published)
            return (null, $"Cannot close an opportunity with status {opportunity.Status}");

        opportunity.Status = OpportunityStatus.Closed;
        opportunity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Volunteer opportunity {OpportunityId} closed by user {UserId}",
            opportunityId, userId);

        return (opportunity, null);
    }

    // === Applications ===

    /// <summary>
    /// Apply to a published volunteer opportunity.
    /// </summary>
    public async Task<VolunteerApplicationApplyResult> ApplyToOpportunityAsync(
        int opportunityId,
        int userId,
        string? message,
        int? shiftId = null,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        if (!await IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return VolunteerApplicationApplyResult.Failure(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community",
                "Volunteering module is not enabled for this community");
        }

        if (message?.Length > 2000)
        {
            return VolunteerApplicationApplyResult.Failure(
                422,
                "VALIDATION_ERROR",
                "The message field must not be greater than 2000 characters.",
                "Message must not exceed 2000 characters",
                "message");
        }

        if (shiftId.HasValue && shiftId.Value <= 0)
        {
            return VolunteerApplicationApplyResult.Failure(
                422,
                "VALIDATION_ERROR",
                "The shift id field must be at least 1.",
                "Shift id must be at least 1",
                "shift_id");
        }

        VolunteerApplication application;
        int organizerId;
        string opportunityTitle;
        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            // Laravel uses a keyed cache lock because historical declined and
            // withdrawn rows make a natural-key unique index invalid. Locking
            // the tenant opportunity row gives the database-backed equivalent:
            // duplicate-check and insert are serialized without deleting history.
            if (!await LockOpportunityAsync(opportunityId, tenantId, cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return VolunteerApplicationApplyResult.Failure(
                    404,
                    "NOT_FOUND",
                    "Opportunity not found or is not active",
                    "Opportunity not found");
            }

            var opportunity = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(candidate => candidate.Id == opportunityId && candidate.TenantId == tenantId)
                .Select(candidate => new
                {
                    candidate.Id,
                    candidate.OrganizerId,
                    candidate.Title,
                    candidate.Status,
                    candidate.ApplicationDeadline
                })
                .SingleAsync(cancellationToken);

            if (opportunity.Status != OpportunityStatus.Published)
            {
                await transaction.RollbackAsync(cancellationToken);
                return VolunteerApplicationApplyResult.Failure(
                    404,
                    "NOT_FOUND",
                    "Opportunity not found or is not active",
                    "This opportunity is not accepting applications");
            }

            if (await _guardianConsent.IsBlockedAsync(
                userId,
                tenantId,
                opportunityId,
                cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return VolunteerApplicationApplyResult.Failure(
                    StatusCodes.Status403Forbidden,
                    VolunteerGuardianConsentService.RequiredCode,
                    VolunteerGuardianConsentService.RequiredMessage,
                    VolunteerGuardianConsentService.RequiredMessage);
            }

            if (opportunity.OrganizerId == userId)
            {
                await transaction.RollbackAsync(cancellationToken);
                return VolunteerApplicationApplyResult.Failure(
                    422,
                    "VALIDATION_ERROR",
                    "You cannot apply to your own opportunity",
                    "Cannot apply to your own opportunity");
            }

            organizerId = opportunity.OrganizerId;
            opportunityTitle = opportunity.Title;

            // Preserve the existing .NET deadline guard. Laravel normally closes
            // expired opportunities asynchronously, but a stale published row
            // must not accept an application in the interim.
            if (opportunity.ApplicationDeadline.HasValue
                && DateTime.UtcNow > opportunity.ApplicationDeadline.Value)
            {
                await transaction.RollbackAsync(cancellationToken);
                return VolunteerApplicationApplyResult.Failure(
                    422,
                    "VALIDATION_ERROR",
                    "The application deadline has passed",
                    "The application deadline has passed");
            }

            var activeApplicationExists = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(candidate =>
                    candidate.TenantId == tenantId
                    && candidate.OpportunityId == opportunityId
                    && candidate.UserId == userId
                    && (candidate.Status == ApplicationStatus.Pending
                        || candidate.Status == ApplicationStatus.Approved),
                    cancellationToken);
            if (activeApplicationExists)
            {
                await transaction.RollbackAsync(cancellationToken);
                return VolunteerApplicationApplyResult.Failure(
                    409,
                    "ALREADY_EXISTS",
                    "You have already applied to this opportunity",
                    "You already have an active application for this opportunity");
            }

            if (shiftId.HasValue)
            {
                // This is the same tenant-scoped shift lock used by admin
                // approval, direct signup, and group reservation capacity writers.
                if (!await LockShiftAsync(shiftId.Value, tenantId, cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return VolunteerApplicationApplyResult.Failure(
                        404,
                        "NOT_FOUND",
                        "Shift not found",
                        "Shift not found");
                }

                var shift = await _db.VolunteerShifts
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(candidate => candidate.Id == shiftId.Value && candidate.TenantId == tenantId)
                    .Select(candidate => new
                    {
                        candidate.OpportunityId,
                        candidate.StartsAt,
                        candidate.MaxVolunteers
                    })
                    .SingleAsync(cancellationToken);

                if (shift.OpportunityId != opportunityId)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return VolunteerApplicationApplyResult.Failure(
                        404,
                        "NOT_FOUND",
                        "Shift not found",
                        "Shift not found");
                }

                if (shift.StartsAt < DateTime.UtcNow)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return VolunteerApplicationApplyResult.Failure(
                        422,
                        "VALIDATION_ERROR",
                        "This shift has already started",
                        "This shift has already started");
                }

                if (shift.MaxVolunteers > 0)
                {
                    var approvedApplications = await _db.VolunteerApplications
                        .IgnoreQueryFilters()
                        .AsNoTracking()
                        .LongCountAsync(candidate =>
                            candidate.TenantId == tenantId
                            && candidate.ShiftId == shiftId.Value
                            && candidate.Status == ApplicationStatus.Approved,
                            cancellationToken);

                    var activeReservedSlots = await _db.ShiftGroupReservations
                        .IgnoreQueryFilters()
                        .AsNoTracking()
                        .Where(reservation =>
                            reservation.TenantId == tenantId
                            && reservation.ShiftId == shiftId.Value
                            && reservation.Status == "active")
                        .SumAsync(
                            reservation => reservation.ReservedSlots > 0
                                ? (long)reservation.ReservedSlots
                                : 0L,
                            cancellationToken);

                    if (approvedApplications + activeReservedSlots >= shift.MaxVolunteers)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return VolunteerApplicationApplyResult.Failure(
                            422,
                            "VALIDATION_ERROR",
                            "This shift is at capacity",
                            "This shift is at capacity");
                    }
                }
            }

            var autoApprove = await AutoApproveApplicationsAsync(tenantId, cancellationToken);
            var now = DateTime.UtcNow;
            application = new VolunteerApplication
            {
                TenantId = tenantId,
                OpportunityId = opportunityId,
                ShiftId = shiftId,
                UserId = userId,
                Status = autoApprove ? ApplicationStatus.Approved : ApplicationStatus.Pending,
                Message = message?.Trim() ?? string.Empty,
                CreatedAt = now,
                UpdatedAt = now
            };

            _db.VolunteerApplications.Add(application);
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(
                exception,
                "Failed to apply user {UserId} to volunteer opportunity {OpportunityId} for tenant {TenantId}",
                userId,
                opportunityId,
                tenantId);
            return VolunteerApplicationApplyResult.Failure(
                500,
                "SERVER_ERROR",
                "Failed to submit volunteer application",
                "Failed to submit volunteer application");
        }

        _logger.LogInformation(
            "User {UserId} applied to volunteer opportunity {OpportunityId} with status {Status}",
            userId,
            opportunityId,
            application.Status);

        try
        {
            await DispatchApplicationReceivedNotificationAsync(
                application,
                organizerId,
                opportunityTitle,
                userId,
                tenantId);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Failed to dispatch organizer notification for committed volunteer application {ApplicationId}",
                application.Id);
        }

        // The application transaction is already committed. Every XP failure is
        // non-critical and must not turn a durable application into an apparent
        // failed request that the client may dangerously retry.
        try
        {
            await _gamification.AwardXpAsync(
                userId,
                5,
                "volunteer_applied",
                application.Id,
                "Applied to a volunteer opportunity");
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Failed to award XP for committed volunteer application {ApplicationId}",
                application.Id);
        }

        return VolunteerApplicationApplyResult.Success(application);
    }

    private async Task<bool> LockOpportunityAsync(
        int opportunityId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM volunteer_opportunities " +
            "WHERE \"Id\" = @opportunity_id AND \"TenantId\" = @tenant_id FOR UPDATE";

        var opportunityParameter = command.CreateParameter();
        opportunityParameter.ParameterName = "opportunity_id";
        opportunityParameter.Value = opportunityId;
        command.Parameters.Add(opportunityParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private async Task<bool> LockShiftAsync(
        int shiftId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM volunteer_shifts " +
            "WHERE \"Id\" = @shift_id AND \"TenantId\" = @tenant_id FOR UPDATE";

        var shiftParameter = command.CreateParameter();
        shiftParameter.ParameterName = "shift_id";
        shiftParameter.Value = shiftId;
        command.Parameters.Add(shiftParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private async Task<bool> AutoApproveApplicationsAsync(
        int tenantId,
        CancellationToken cancellationToken)
    {
        const string key = "volunteering.auto_approve_applications";
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == key)
            .Select(config => config.Value)
            .SingleOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return value.Trim().Trim('"').ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";
    }

    private async Task<bool> IsVolunteeringEnabledAsync(
        int tenantId,
        CancellationToken cancellationToken)
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

    private async Task DispatchApplicationReceivedNotificationAsync(
        VolunteerApplication application,
        int organizerId,
        string opportunityTitle,
        int applicantId,
        int tenantId)
    {
        if (organizerId == applicantId)
        {
            return;
        }

        var applicantName = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == applicantId && user.TenantId == tenantId)
            .Select(user => (user.FirstName + " " + user.LastName).Trim())
            .SingleOrDefaultAsync(CancellationToken.None);
        applicantName = string.IsNullOrWhiteSpace(applicantName) ? "Someone" : applicantName;

        const string title = "New volunteer application";
        var body = $"{applicantName} applied for your volunteer opportunity: {opportunityTitle}";
        var data = JsonSerializer.Serialize(new
        {
            application_id = application.Id,
            opportunity_id = application.OpportunityId,
            url = $"/volunteering/opportunities/{application.OpportunityId}"
        });
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = organizerId,
            Type = "vol_application_received",
            Title = title,
            Body = body,
            Data = data,
            Link = $"/volunteering/opportunities/{application.OpportunityId}",
            CreatedAt = DateTime.UtcNow
        };

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
                "Failed to create organizer notification for committed volunteer application {ApplicationId}",
                application.Id);
        }

        if (_pushNotifications is null)
        {
            return;
        }

        try
        {
            await _pushNotifications.SendPushAsync(organizerId, title, body, data);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Failed to queue organizer push for committed volunteer application {ApplicationId}",
                application.Id);
        }
    }

    /// <summary>
    /// Review (approve or decline) a volunteer application. Only the organizer can review.
    /// </summary>
    public async Task<(VolunteerApplication? Application, string? Error)> ReviewApplicationAsync(
        int applicationId, int reviewerId, bool approved, string? reason)
    {
        var application = await _db.VolunteerApplications
            .Include(a => a.Opportunity)
            .FirstOrDefaultAsync(a => a.Id == applicationId);

        if (application == null)
            return (null, "Application not found");

        if (application.Opportunity == null)
            return (null, "Opportunity not found");

        if (application.Opportunity.OrganizerId != reviewerId)
            return (null, "Only the organizer can review applications");

        if (application.Status != ApplicationStatus.Pending)
            return (null, $"Cannot review an application with status {application.Status}");

        var result = await _approvalDecisions.DecideForOrganizerAsync(
            applicationId,
            _tenantContext.GetTenantIdOrThrow(),
            reviewerId,
            approved,
            reason);

        if (!result.Succeeded)
            return (null, result.Message ?? "The volunteer application could not be reviewed");

        await _db.Entry(application).ReloadAsync();
        return (application, null);
    }

    /// <summary>
    /// Withdraw a volunteer application. Only the applicant can withdraw.
    /// </summary>
    public async Task<VolunteerApplicationWithdrawResult> WithdrawApplicationAsync(
        int applicationId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        if (!await IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return VolunteerApplicationWithdrawResult.Failure(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community",
                "Volunteering module is not enabled for this community");
        }

        var application = await _db.VolunteerApplications
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate =>
                candidate.Id == applicationId
                && candidate.TenantId == tenantId,
                cancellationToken);

        if (application == null)
        {
            return VolunteerApplicationWithdrawResult.Failure(
                StatusCodes.Status404NotFound,
                "NOT_FOUND",
                "Application not found",
                "Application not found");
        }

        if (application.UserId != userId)
        {
            return VolunteerApplicationWithdrawResult.Failure(
                StatusCodes.Status403Forbidden,
                "FORBIDDEN",
                "This is not your application",
                "This is not your application");
        }

        if (application.Status == ApplicationStatus.Approved)
        {
            return VolunteerApplicationWithdrawResult.Failure(
                StatusCodes.Status400BadRequest,
                "VALIDATION_ERROR",
                "You cannot withdraw an approved application. Please contact the organisation directly.",
                "You cannot withdraw an approved application. Please contact the organisation directly.");
        }

        try
        {
            var affected = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .Where(candidate =>
                    candidate.Id == applicationId
                    && candidate.TenantId == tenantId
                    && candidate.UserId == userId
                    && candidate.Status != ApplicationStatus.Approved)
                .ExecuteDeleteAsync(cancellationToken);

            if (affected == 1)
            {
                _logger.LogInformation(
                    "Volunteer application {ApplicationId} withdrawn by user {UserId}",
                    applicationId,
                    userId);
                return VolunteerApplicationWithdrawResult.Success();
            }

            var currentStatus = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(candidate =>
                    candidate.Id == applicationId
                    && candidate.TenantId == tenantId
                    && candidate.UserId == userId)
                .Select(candidate => (ApplicationStatus?)candidate.Status)
                .SingleOrDefaultAsync(cancellationToken);

            return currentStatus == ApplicationStatus.Approved
                ? VolunteerApplicationWithdrawResult.Failure(
                    StatusCodes.Status400BadRequest,
                    "VALIDATION_ERROR",
                    "You cannot withdraw an approved application. Please contact the organisation directly.",
                    "You cannot withdraw an approved application. Please contact the organisation directly.")
                : VolunteerApplicationWithdrawResult.Failure(
                    StatusCodes.Status404NotFound,
                    "NOT_FOUND",
                    "Application not found",
                    "Application not found");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(
                exception,
                "Failed to withdraw volunteer application {ApplicationId} for tenant {TenantId}",
                applicationId,
                tenantId);
            return VolunteerApplicationWithdrawResult.Failure(
                StatusCodes.Status400BadRequest,
                "SERVER_ERROR",
                "Failed to withdraw application",
                "Failed to withdraw application");
        }
    }

    // === Shifts ===

    /// <summary>
    /// Create a new shift for a volunteer opportunity.
    /// </summary>
    public async Task<(VolunteerShift? Shift, string? Error)> CreateShiftAsync(
        int opportunityId, int userId, string? title, DateTime startsAt, DateTime endsAt,
        int maxVolunteers, string? location, string? notes)
    {
        var opportunity = await _db.VolunteerOpportunities
            .FirstOrDefaultAsync(o => o.Id == opportunityId);

        if (opportunity == null)
            return (null, "Opportunity not found");

        if (opportunity.OrganizerId != userId)
            return (null, "Only the organizer can create shifts");

        if (opportunity.Status == OpportunityStatus.Cancelled)
            return (null, "Cannot create shifts for a cancelled opportunity");

        if (endsAt <= startsAt)
            return (null, "End time must be after start time");

        if (maxVolunteers < 1)
            return (null, "At least one volunteer slot is required");

        var shift = new VolunteerShift
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            OpportunityId = opportunityId,
            Title = title?.Trim(),
            StartsAt = startsAt,
            EndsAt = endsAt,
            MaxVolunteers = maxVolunteers,
            Location = location?.Trim(),
            Notes = notes?.Trim(),
            Status = ShiftStatus.Scheduled,
            CreatedAt = DateTime.UtcNow
        };

        _db.VolunteerShifts.Add(shift);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Shift {ShiftId} created for opportunity {OpportunityId} by user {UserId}",
            shift.Id, opportunityId, userId);

        return (shift, null);
    }

    // === Check-ins ===

    /// <summary>
    /// Check in a volunteer to a shift. User must have an approved application.
    /// </summary>
    public async Task<(VolunteerCheckIn? CheckIn, string? Error)> CheckInAsync(
        int shiftId, int userId)
    {
        if (!CoordinatorAttendanceWorkflowAvailable)
        {
            return (null,
                "Volunteer attendance must be recorded through the coordinator-approved workflow, which is not available on this endpoint.");
        }

        var shift = await _db.VolunteerShifts
            .Include(s => s.Opportunity)
            .Include(s => s.CheckIns)
            .FirstOrDefaultAsync(s => s.Id == shiftId);

        if (shift == null)
            return (null, "Shift not found");

        if (shift.Opportunity == null)
            return (null, "Opportunity not found");

        if (shift.Status == ShiftStatus.Cancelled)
            return (null, "This shift has been cancelled");

        if (shift.Status == ShiftStatus.Completed)
            return (null, "This shift has already been completed");

        // Verify user has an approved application (or is the organizer)
        if (shift.Opportunity.OrganizerId != userId)
        {
            var hasApprovedApplication = await _db.VolunteerApplications
                .AnyAsync(a => a.OpportunityId == shift.OpportunityId
                    && a.UserId == userId
                    && a.Status == ApplicationStatus.Approved);

            if (!hasApprovedApplication)
                return (null, "You must have an approved application to check in");
        }

        // Check if already checked in (without checkout)
        var existingCheckIn = shift.CheckIns
            .FirstOrDefault(c => c.UserId == userId && c.Status == "checked_in");

        if (existingCheckIn != null)
            return (null, "You are already checked in to this shift");

        // Check if shift is full
        var activeCheckIns = shift.CheckIns.Count(c => c.Status == "checked_in");
        if (activeCheckIns >= shift.MaxVolunteers)
            return (null, "This shift is full");

        var checkIn = new VolunteerCheckIn
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            ShiftId = shiftId,
            UserId = userId,
            CheckedInAt = DateTime.UtcNow,
            Status = "checked_in",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.VolunteerCheckIns.Add(checkIn);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} checked in to shift {ShiftId}", userId, shiftId);

        return (checkIn, null);
    }

    /// <summary>
    /// Check out a volunteer from a shift and optionally award credits.
    /// </summary>
    public async Task<(VolunteerCheckIn? CheckIn, string? Error)> CheckOutAsync(
        int shiftId, int userId, decimal? hoursLogged)
    {
        if (!CoordinatorAttendanceWorkflowAvailable)
        {
            return (null,
                "Volunteer checkout and rewards require coordinator-approved attendance evidence, which is not available on this endpoint.");
        }

        var shift = await _db.VolunteerShifts
            .Include(s => s.Opportunity)
            .FirstOrDefaultAsync(s => s.Id == shiftId);

        if (shift == null)
            return (null, "Shift not found");

        var checkIn = await _db.VolunteerCheckIns
            .FirstOrDefaultAsync(c =>
                c.ShiftId == shiftId
                && c.UserId == userId
                && c.Status == "checked_in");

        if (checkIn == null)
            return (null, "No active check-in found for this shift");

        checkIn.CheckedOutAt = DateTime.UtcNow;
        checkIn.Status = "checked_out";
        checkIn.UpdatedAt = DateTime.UtcNow;

        // Calculate hours: use provided value, or calculate from check-in/check-out times
        if (hoursLogged.HasValue && hoursLogged.Value > 0)
        {
            checkIn.HoursLogged = hoursLogged.Value;
        }
        else
        {
            var duration = checkIn.CheckedOutAt.Value
                - (checkIn.CheckedInAt ?? checkIn.CreatedAt);
            checkIn.HoursLogged = Math.Round((decimal)duration.TotalHours, 2);
        }

        // Award credits if the opportunity has a CreditReward set
        if (shift.Opportunity?.CreditReward.HasValue == true && shift.Opportunity.CreditReward.Value > 0)
        {
            await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
            try
            {
                // Advisory lock on the organizer (who pays credits)
                await _db.Database.ExecuteSqlRawAsync(
                    "SELECT pg_advisory_xact_lock({0})",
                    shift.Opportunity.OrganizerId);

                // Check organizer's balance
                var received = await _db.Transactions
                    .Where(t => t.ReceiverId == shift.Opportunity.OrganizerId && t.Status == TransactionStatus.Completed)
                    .SumAsync(t => t.Amount);
                var sent = await _db.Transactions
                    .Where(t => t.SenderId == shift.Opportunity.OrganizerId && t.Status == TransactionStatus.Completed)
                    .SumAsync(t => t.Amount);
                var balance = received - sent;

                if (balance >= shift.Opportunity.CreditReward.Value)
                {
                    var transaction = new Transaction
                    {
                        TenantId = checkIn.TenantId,
                        SenderId = shift.Opportunity.OrganizerId,
                        ReceiverId = userId,
                        Amount = shift.Opportunity.CreditReward.Value,
                        Description = $"Volunteer shift: {shift.Title ?? shift.Opportunity.Title}",
                        TransactionType = "volunteer_shift_reward",
                        Status = TransactionStatus.Completed,
                        CreatedAt = DateTime.UtcNow
                    };

                    _db.Transactions.Add(transaction);
                    await _db.SaveChangesAsync();

                    checkIn.TransactionId = transaction.Id;

                    _logger.LogInformation(
                        "Credit reward {Amount} transferred from organizer {OrganizerId} to volunteer {UserId} for shift {ShiftId}",
                        shift.Opportunity.CreditReward.Value, shift.Opportunity.OrganizerId, userId, shiftId);
                }
                else
                {
                    _logger.LogWarning(
                        "Organizer {OrganizerId} has insufficient balance ({Balance}) for credit reward ({Reward}) on shift {ShiftId}",
                        shift.Opportunity.OrganizerId, balance, shift.Opportunity.CreditReward.Value, shiftId);
                }

                await _db.SaveChangesAsync();
                await dbTransaction.CommitAsync();
            }
            catch (DbUpdateConcurrencyException ex)
            {
                await dbTransaction.RollbackAsync();
                _logger.LogError(ex, "Failed to process credit reward for shift {ShiftId}, user {UserId}", shiftId, userId);
                // Still save the checkout even if credit transfer fails
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                await dbTransaction.RollbackAsync();
                _logger.LogError(ex, "Failed to process credit reward for shift {ShiftId}, user {UserId}", shiftId, userId);
                // Still save the checkout even if credit transfer fails
                await _db.SaveChangesAsync();
            }
            catch (InvalidOperationException ex)
            {
                await dbTransaction.RollbackAsync();
                _logger.LogError(ex, "Failed to process credit reward for shift {ShiftId}, user {UserId}", shiftId, userId);
                // Still save the checkout even if credit transfer fails
                await _db.SaveChangesAsync();
            }
            catch (OperationCanceledException ex)
            {
                await dbTransaction.RollbackAsync();
                _logger.LogError(ex, "Failed to process credit reward for shift {ShiftId}, user {UserId}", shiftId, userId);
                // Still save the checkout even if credit transfer fails
                await _db.SaveChangesAsync();
            }
        }
        else
        {
            await _db.SaveChangesAsync();
        }

        _logger.LogInformation("User {UserId} checked out of shift {ShiftId}, hours logged: {Hours}",
            userId, shiftId, checkIn.HoursLogged);

        // Award XP for volunteering (non-critical)
        try
        {
            var xpAmount = (int)Math.Max(10, Math.Round(checkIn.HoursLogged.Value * 15));
            await _gamification.AwardXpAsync(userId, xpAmount, "volunteer_shift_completed", checkIn.Id,
                $"Completed volunteer shift ({checkIn.HoursLogged:F1}h)");
            await _gamification.CheckAndAwardBadgesAsync(userId, "volunteer_shift_completed");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for volunteer check-out {CheckInId}", checkIn.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for volunteer check-out {CheckInId}", checkIn.Id);
        }

        return (checkIn, null);
    }

    // === Stats ===

    /// <summary>
    /// Get volunteer statistics for a user.
    /// </summary>
    public async Task<object> GetVolunteerStatsAsync(int userId)
    {
        var totalCheckIns = await _db.VolunteerCheckIns
            .CountAsync(c => c.UserId == userId && c.CheckedOutAt != null);

        var totalHours = await _db.VolunteerCheckIns
            .Where(c => c.UserId == userId && c.CheckedOutAt != null && c.HoursLogged.HasValue)
            .SumAsync(c => c.HoursLogged!.Value);

        var opportunitiesApplied = await _db.VolunteerApplications
            .Where(a => a.UserId == userId)
            .Select(a => a.OpportunityId)
            .Distinct()
            .CountAsync();

        var opportunitiesApproved = await _db.VolunteerApplications
            .Where(a => a.UserId == userId && a.Status == ApplicationStatus.Approved)
            .Select(a => a.OpportunityId)
            .Distinct()
            .CountAsync();

        var activeCheckIns = await _db.VolunteerCheckIns
            .CountAsync(c => c.UserId == userId && c.Status == "checked_in");

        var creditsEarned = await _db.VolunteerCheckIns
            .Where(c => c.UserId == userId && c.TransactionId != null)
            .Join(_db.Transactions, c => c.TransactionId, t => t.Id, (c, t) => t.Amount)
            .SumAsync();

        return new
        {
            total_shifts_completed = totalCheckIns,
            total_hours = Math.Round(totalHours, 2),
            opportunities_applied = opportunitiesApplied,
            opportunities_approved = opportunitiesApproved,
            active_check_ins = activeCheckIns,
            credits_earned = Math.Round(creditsEarned, 2)
        };
    }
}

public sealed record VolunteerApplicationApplyError(
    int StatusCode,
    string Code,
    string Message,
    string LegacyMessage,
    string? Field);

public sealed record VolunteerApplicationApplyResult(
    VolunteerApplication? Application,
    VolunteerApplicationApplyError? Error)
{
    public bool Succeeded => Application is not null && Error is null;

    public static VolunteerApplicationApplyResult Success(VolunteerApplication application) =>
        new(application, null);

    public static VolunteerApplicationApplyResult Failure(
        int statusCode,
        string code,
        string message,
        string legacyMessage,
        string? field = null) =>
        new(null, new VolunteerApplicationApplyError(statusCode, code, message, legacyMessage, field));
}

public sealed record VolunteerApplicationWithdrawResult(
    bool Succeeded,
    VolunteerApplicationApplyError? Error)
{
    public static VolunteerApplicationWithdrawResult Success() => new(true, null);

    public static VolunteerApplicationWithdrawResult Failure(
        int statusCode,
        string code,
        string message,
        string legacyMessage) =>
        new(false, new VolunteerApplicationApplyError(statusCode, code, message, legacyMessage, null));
}
