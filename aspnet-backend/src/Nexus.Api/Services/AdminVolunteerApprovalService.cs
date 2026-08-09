// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Owns the canonical tenant-admin volunteer application decision workflow.
/// The conditional status update and shift-row lock make repeated and
/// concurrent decisions fail closed instead of producing duplicate effects.
/// </summary>
public sealed class AdminVolunteerApprovalService
{
    public const string FeatureConfigKey = "feature.volunteering";
    public const string RequireOrgNoteOnDeclineConfigKey = "volunteering.require_org_note_on_decline";
    public const int MaxOrganizationNoteLength = 2000;

    private readonly NexusDbContext _db;
    private readonly ILogger<AdminVolunteerApprovalService> _logger;
    private readonly VolunteerOrganisationService _volunteerOrganisations;
    private readonly PushNotificationService? _pushNotifications;
    private readonly EmailNotificationService? _emailNotifications;

    public AdminVolunteerApprovalService(
        NexusDbContext db,
        ILogger<AdminVolunteerApprovalService> logger,
        VolunteerOrganisationService volunteerOrganisations,
        PushNotificationService? pushNotifications = null,
        EmailNotificationService? emailNotifications = null)
    {
        _db = db;
        _logger = logger;
        _volunteerOrganisations = volunteerOrganisations;
        _pushNotifications = pushNotifications;
        _emailNotifications = emailNotifications;
    }

    /// <summary>
    /// Laravel enables volunteering by default. Only a stored false-like value
    /// disables the module for a tenant.
    /// </summary>
    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct = default)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == FeatureConfigKey)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return !IsExplicitlyDisabled(raw);
    }

    /// <summary>
    /// Returns the current tenant's latest 150 applications. Pending rows sort
    /// first, followed by the newest already-decided rows, matching the React
    /// admin page's client-side pending/approved/declined tabs.
    /// </summary>
    public async Task<IReadOnlyList<AdminVolunteerApprovalItem>> ListAsync(
        int tenantId,
        CancellationToken ct = default)
    {
        var rows = await (
            from application in _db.VolunteerApplications.IgnoreQueryFilters().AsNoTracking()
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { application.OpportunityId, application.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            join user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                on new { application.UserId, application.TenantId }
                equals new { UserId = user.Id, user.TenantId }
                into users
            from user in users.DefaultIfEmpty()
            where application.TenantId == tenantId && opportunity.TenantId == tenantId
            orderby application.Status == ApplicationStatus.Pending descending,
                application.CreatedAt descending
            select new ApprovalProjection(
                application.Id,
                application.TenantId,
                application.OpportunityId,
                application.UserId,
                application.ShiftId,
                application.Status,
                application.Message,
                application.OrgNote,
                application.ReviewedById,
                application.ReviewedAt,
                application.CreatedAt,
                application.UpdatedAt,
                user == null ? null : user.FirstName,
                user == null ? null : user.LastName,
                user == null ? null : user.Email,
                opportunity.Title))
            .Take(150)
            .ToListAsync(ct);

        return rows.Select(row => new AdminVolunteerApprovalItem(
            row.Id,
            row.TenantId,
            row.OpportunityId,
            row.UserId,
            row.ShiftId,
            row.Status.ToString().ToLowerInvariant(),
            row.Message,
            row.OrgNote,
            row.ReviewedById,
            row.ReviewedAt,
            row.CreatedAt,
            row.UpdatedAt,
            row.FirstName,
            row.LastName,
            row.Email,
            row.OpportunityTitle)).ToArray();
    }

    /// <summary>
    /// Approves or declines one current-tenant pending application. A successful
    /// return means the durable decision transaction has committed; all
    /// notifications happen afterwards and are deliberately best effort.
    /// </summary>
    public async Task<AdminVolunteerDecisionResult> DecideAsync(
        int applicationId,
        int tenantId,
        int reviewerId,
        bool approved,
        CancellationToken ct = default)
        => await DecideCoreAsync(
            applicationId,
            tenantId,
            reviewerId,
            approved,
            VolunteerDecisionSurface.Admin,
            organizationNote: null,
            ct);

    /// <summary>
    /// Runs the same durable decision transaction for the canonical organizer
    /// application endpoint while preserving its distinct authorization,
    /// conflict, response, and notification contract.
    /// </summary>
    public async Task<AdminVolunteerDecisionResult> DecideForOrganizerAsync(
        int applicationId,
        int tenantId,
        int reviewerId,
        bool approved,
        string? organizationNote = null,
        CancellationToken ct = default)
        => await DecideCoreAsync(
            applicationId,
            tenantId,
            reviewerId,
            approved,
            VolunteerDecisionSurface.Organizer,
            organizationNote,
            ct);

    private async Task<AdminVolunteerDecisionResult> DecideCoreAsync(
        int applicationId,
        int tenantId,
        int reviewerId,
        bool approved,
        VolunteerDecisionSurface surface,
        string? organizationNote,
        CancellationToken ct)
    {
        if (organizationNote?.Length > MaxOrganizationNoteLength)
        {
            return AdminVolunteerDecisionResult.Validation(
                "The org note field must not be greater than 2000 characters.",
                "org_note");
        }

        organizationNote = string.IsNullOrWhiteSpace(organizationNote)
            ? null
            : organizationNote.Trim();

        if (!await IsFeatureEnabledAsync(tenantId, ct))
        {
            return AdminVolunteerDecisionResult.FeatureDisabled();
        }

        var candidate = await (
            from application in _db.VolunteerApplications.IgnoreQueryFilters().AsNoTracking()
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { application.OpportunityId, application.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            where application.Id == applicationId
                && application.TenantId == tenantId
                && opportunity.TenantId == tenantId
            select new DecisionCandidate(
                application.Id,
                application.UserId,
                opportunity.Id,
                opportunity.VolunteerOrganisationId,
                application.ShiftId,
                application.Status,
                opportunity.Title))
            .SingleOrDefaultAsync(ct);

        if (candidate is null)
        {
            return AdminVolunteerDecisionResult.NotFound();
        }

        if (surface == VolunteerDecisionSurface.Organizer
            && (!candidate.VolunteerOrganisationId.HasValue
                || !await _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .AnyAsync(org => org.Id == candidate.VolunteerOrganisationId.Value
                        && org.TenantId == tenantId, ct)))
        {
            return AdminVolunteerDecisionResult.NotFound();
        }

        if (surface == VolunteerDecisionSurface.Organizer
            && !await CanManageOrganizerDecisionAsync(candidate, reviewerId, tenantId, ct))
        {
            return AdminVolunteerDecisionResult.Forbidden(
                "You do not have permission to manage this opportunity");
        }

        if (surface == VolunteerDecisionSurface.Organizer
            && !approved
            && organizationNote is null
            && await IsConfigEnabledAsync(tenantId, RequireOrgNoteOnDeclineConfigKey, ct))
        {
            return AdminVolunteerDecisionResult.Validation(
                "Missing required field: org_note",
                "org_note");
        }

        if (candidate.Status != ApplicationStatus.Pending)
        {
            if (surface == VolunteerDecisionSurface.Organizer)
            {
                return AdminVolunteerDecisionResult.AlreadyDecided(
                    "This application has already been decided");
            }

            return AdminVolunteerDecisionResult.Validation(
                approved
                    ? "Only pending partnerships can be approved (current: pending)"
                    : "Only pending partnerships can be rejected (current: pending)");
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

        if (approved && candidate.ShiftId.HasValue)
        {
            var shift = await LockShiftAsync(candidate.ShiftId.Value, tenantId, ct);
            if (shift is null)
            {
                await transaction.RollbackAsync(ct);
                return AdminVolunteerDecisionResult.Validation("Shift not found", "shift_id");
            }

            if (shift.MaxVolunteers > 0)
            {
                var approvedApplications = await _db.VolunteerApplications
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .LongCountAsync(application =>
                        application.TenantId == tenantId
                        && application.ShiftId == candidate.ShiftId.Value
                        && application.Status == ApplicationStatus.Approved,
                        ct);

                var activeReservedSlots = await _db.ShiftGroupReservations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(reservation =>
                        reservation.TenantId == tenantId
                        && reservation.ShiftId == candidate.ShiftId.Value
                        && reservation.Status == "active")
                    .SumAsync(
                        reservation => reservation.ReservedSlots > 0
                            ? (long)reservation.ReservedSlots
                            : 0L,
                        ct);

                if (approvedApplications + activeReservedSlots >= shift.MaxVolunteers)
                {
                    await transaction.RollbackAsync(ct);
                    return AdminVolunteerDecisionResult.Validation("This shift is at capacity", "shift_id");
                }
            }
        }

        var now = DateTime.UtcNow;
        var status = approved ? ApplicationStatus.Approved : ApplicationStatus.Declined;
        var affected = await _db.VolunteerApplications
            .IgnoreQueryFilters()
            .Where(application =>
                application.Id == applicationId
                && application.TenantId == tenantId
                && application.Status == ApplicationStatus.Pending)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(application => application.Status, status)
                .SetProperty(application => application.OrgNote, organizationNote)
                .SetProperty(application => application.ReviewedById, reviewerId)
                .SetProperty(application => application.ReviewedAt, now)
                .SetProperty(application => application.UpdatedAt, now),
                ct);

        if (affected != 1)
        {
            await transaction.RollbackAsync(ct);
            if (surface == VolunteerDecisionSurface.Organizer)
            {
                return AdminVolunteerDecisionResult.AlreadyDecided(
                    "This application has already been decided");
            }

            return AdminVolunteerDecisionResult.Validation(
                approved
                    ? "Only pending partnerships can be approved (current: pending)"
                    : "Only pending partnerships can be rejected (current: pending)");
        }

        await transaction.CommitAsync(ct);

        _logger.LogInformation(
            "Volunteer application {ApplicationId} was {Decision} by admin {ReviewerId} for tenant {TenantId}",
            applicationId,
            approved ? "approved" : "declined",
            reviewerId,
            tenantId);

        try
        {
            await DispatchDecisionNotificationsAsync(
                candidate,
                tenantId,
                approved,
                surface,
                organizationNote);
        }
        catch (Exception ex)
        {
            // The application decision is already committed. No provider,
            // lookup, or notification failure may turn it into an apparent
            // failed decision or invite a dangerous retry.
            _logger.LogWarning(
                ex,
                "Post-commit volunteer decision notifications failed for application {ApplicationId}",
                applicationId);
        }

        return AdminVolunteerDecisionResult.Success();
    }

    private async Task<LockedShift?> LockShiftAsync(int shiftId, int tenantId, CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"MaxVolunteers\" FROM volunteer_shifts " +
            "WHERE \"Id\" = @shift_id AND \"TenantId\" = @tenant_id FOR UPDATE";

        var shiftParameter = command.CreateParameter();
        shiftParameter.ParameterName = "shift_id";
        shiftParameter.Value = shiftId;
        command.Parameters.Add(shiftParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        var result = await command.ExecuteScalarAsync(ct);
        return result is null or DBNull
            ? null
            : new LockedShift(Convert.ToInt32(result, CultureInfo.InvariantCulture));
    }

    private async Task DispatchDecisionNotificationsAsync(
        DecisionCandidate application,
        int tenantId,
        bool approved,
        VolunteerDecisionSurface surface,
        string? organizationNote)
    {
        var applicant = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == application.UserId && user.TenantId == tenantId)
            .Select(user => new { user.Id, user.FirstName })
            .SingleOrDefaultAsync(CancellationToken.None);

        if (applicant is null)
        {
            _logger.LogWarning(
                "Skipped volunteer decision notifications for application {ApplicationId}: tenant-scoped applicant {UserId} was not found",
                application.Id,
                application.UserId);
            return;
        }

        var organizerDecision = surface == VolunteerDecisionSurface.Organizer;
        var title = organizerDecision
            ? approved ? "Application Approved" : "Application Declined"
            : "New Notification";
        var body = organizerDecision
            ? approved
                ? $"Your volunteer application for \"{application.OpportunityTitle}\" was accepted!"
                : $"Your volunteer application for \"{application.OpportunityTitle}\" was not accepted"
            : approved
                ? "Your volunteer application has been approved!"
                : "Your volunteer application was not accepted.";
        var type = organizerDecision
            ? approved ? "vol_application_approved" : "vol_application_declined"
            : "moderation";
        var link = organizerDecision
            ? $"/volunteering/opportunities/{application.OpportunityId}"
            : approved ? "/volunteering" : null;
        var data = organizerDecision
            ? JsonSerializer.Serialize(new
            {
                application_id = application.Id,
                opportunity_id = application.OpportunityId,
                url = link
            })
            : JsonSerializer.Serialize(new
            {
                application_id = application.Id,
                url = link
            });

        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = applicant.Id,
            Type = type,
            Title = title,
            Body = body,
            Data = data,
            Link = link,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _db.Entry(notification).State = EntityState.Detached;
            _logger.LogWarning(
                ex,
                "Failed to create in-app volunteer decision notification for application {ApplicationId}",
                application.Id);
        }

        if (_pushNotifications is not null)
        {
            var existingPushEntries = _db.ChangeTracker
                .Entries<PushNotificationLog>()
                .Select(entry => entry.Entity)
                .ToHashSet(ReferenceEqualityComparer.Instance);

            try
            {
                await _pushNotifications.SendPushAsync(
                    applicant.Id,
                    title,
                    body,
                    data);
            }
            catch (Exception ex)
            {
                foreach (var entry in _db.ChangeTracker.Entries<PushNotificationLog>()
                    .Where(entry => !existingPushEntries.Contains(entry.Entity)))
                {
                    entry.State = EntityState.Detached;
                }

                _logger.LogWarning(
                    ex,
                    "Failed to queue volunteer decision push for application {ApplicationId}",
                    application.Id);
            }
        }

        if ((approved || organizerDecision) && _emailNotifications is not null)
        {
            try
            {
                var templateKey = organizerDecision
                    ? approved ? "vol_application_approved" : "vol_application_declined"
                    : "volunteer_application_approved";
                await _emailNotifications.SendTemplatedEmailAsync(
                    applicant.Id,
                    templateKey,
                    new Dictionary<string, string>
                    {
                        ["user_name"] = WebUtility.HtmlEncode(applicant.FirstName),
                        ["opportunity_title"] = WebUtility.HtmlEncode(application.OpportunityTitle),
                        ["opportunity_id"] = application.OpportunityId.ToString(CultureInfo.InvariantCulture),
                        ["application_id"] = application.Id.ToString(CultureInfo.InvariantCulture),
                        ["volunteering_url"] = link ?? "/volunteering",
                        ["org_note"] = WebUtility.HtmlEncode(organizationNote ?? string.Empty)
                    });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Failed to queue volunteer approval email for application {ApplicationId}",
                    application.Id);
            }
        }
    }

    private static bool IsExplicitlyDisabled(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return value.Trim().ToLowerInvariant() is "0" or "false" or "no" or "off" or "disabled";
    }

    private async Task<bool> CanManageOrganizerDecisionAsync(
        DecisionCandidate application,
        int reviewerId,
        int tenantId,
        CancellationToken ct)
    {
        var access = await _volunteerOrganisations.EvaluateOpportunityAccessAsync(
            application.OpportunityId,
            reviewerId,
            tenantId,
            includeCreator: false,
            ct);
        return access.Allowed;
    }

    private async Task<bool> IsConfigEnabledAsync(
        int tenantId,
        string key,
        CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == key)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return !string.IsNullOrWhiteSpace(raw)
            && raw.Trim().Trim('"').ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";
    }

    private sealed record ApprovalProjection(
        int Id,
        int TenantId,
        int OpportunityId,
        int UserId,
        int? ShiftId,
        ApplicationStatus Status,
        string? Message,
        string? OrgNote,
        int? ReviewedById,
        DateTime? ReviewedAt,
        DateTime CreatedAt,
        DateTime? UpdatedAt,
        string? FirstName,
        string? LastName,
        string? Email,
        string OpportunityTitle);

    private sealed record DecisionCandidate(
        int Id,
        int UserId,
        int OpportunityId,
        int? VolunteerOrganisationId,
        int? ShiftId,
        ApplicationStatus Status,
        string OpportunityTitle);

    private sealed record LockedShift(int MaxVolunteers);

    private enum VolunteerDecisionSurface
    {
        Admin,
        Organizer
    }
}

public enum AdminVolunteerDecisionFailure
{
    None,
    FeatureDisabled,
    NotFound,
    Forbidden,
    AlreadyDecided,
    Validation
}

public sealed record AdminVolunteerDecisionResult(
    bool Succeeded,
    AdminVolunteerDecisionFailure Failure,
    string? Message,
    string? Field)
{
    public static AdminVolunteerDecisionResult Success() => new(true, AdminVolunteerDecisionFailure.None, null, null);

    public static AdminVolunteerDecisionResult FeatureDisabled() =>
        new(false, AdminVolunteerDecisionFailure.FeatureDisabled, "Service unavailable", null);

    public static AdminVolunteerDecisionResult NotFound() =>
        new(false, AdminVolunteerDecisionFailure.NotFound, "Application not found.", null);

    public static AdminVolunteerDecisionResult Forbidden(string message) =>
        new(false, AdminVolunteerDecisionFailure.Forbidden, message, null);

    public static AdminVolunteerDecisionResult AlreadyDecided(string message) =>
        new(false, AdminVolunteerDecisionFailure.AlreadyDecided, message, null);

    public static AdminVolunteerDecisionResult Validation(string message, string? field = null) =>
        new(false, AdminVolunteerDecisionFailure.Validation, message, field);
}

public sealed record AdminVolunteerApprovalItem(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("opportunity_id")] int OpportunityId,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("shift_id")] int? ShiftId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("message")] string? Message,
    [property: JsonPropertyName("org_note")] string? OrgNote,
    [property: JsonPropertyName("reviewed_by_id")] int? ReviewedById,
    [property: JsonPropertyName("reviewed_at")] DateTime? ReviewedAt,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("first_name")] string? FirstName,
    [property: JsonPropertyName("last_name")] string? LastName,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("opportunity_title")] string OpportunityTitle);
