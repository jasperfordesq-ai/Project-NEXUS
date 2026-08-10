// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Data;
using System.Globalization;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// V1.5 compatibility endpoints for volunteering satellites.
/// </summary>
[ApiController]
[Route("api/volunteering")]
[Authorize]
public class VolunteeringParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VolunteeringParityController> _logger;
    private readonly VolunteerGuardianConsentService _guardianConsent;
    private readonly VolunteerOrganisationService _volunteerOrganisations;
    private readonly VolunteerAttendanceService _attendance;
    private readonly IConfiguration _configuration;
    private readonly ShiftManagementService? _shiftManagement;
    private readonly PushNotificationService? _pushNotifications;

    public VolunteeringParityController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<VolunteeringParityController> logger,
        VolunteerGuardianConsentService guardianConsent,
        VolunteerOrganisationService volunteerOrganisations,
        VolunteerAttendanceService attendance,
        IConfiguration configuration,
        ShiftManagementService? shiftManagement = null,
        PushNotificationService? pushNotifications = null)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _guardianConsent = guardianConsent;
        _volunteerOrganisations = volunteerOrganisations;
        _attendance = attendance;
        _configuration = configuration;
        _shiftManagement = shiftManagement;
        _pushNotifications = pushNotifications;
    }

    [HttpGet("shifts")]
    public async Task<IActionResult> Shifts() => Ok(new { data = await _db.VolunteerShifts.OrderBy(s => s.StartsAt).ToListAsync() });

    [HttpPost("shifts/{shiftId:int}/signup")]
    public async Task<IActionResult> SignupShift(
        int shiftId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        var userId = UserId();

        if (!await IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return ShiftSignupError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            // AdminVolunteerApprovalService and ShiftManagementService take this
            // same tenant-scoped row lock before consuming capacity. All three
            // writers therefore serialize their capacity snapshots on one row.
            if (!await LockShiftAsync(shiftId, tenantId, cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status404NotFound,
                    "NOT_FOUND",
                    "Shift not found");
            }

            var shift = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(candidate => candidate.Id == shiftId && candidate.TenantId == tenantId)
                .Select(candidate => new
                {
                    candidate.OpportunityId,
                    candidate.StartsAt,
                    candidate.MaxVolunteers
                })
                .SingleAsync(cancellationToken);

            var opportunityIsActive = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(opportunity =>
                    opportunity.Id == shift.OpportunityId
                    && opportunity.TenantId == tenantId
                    && opportunity.Status == OpportunityStatus.Published,
                    cancellationToken);
            if (!opportunityIsActive)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status404NotFound,
                    "NOT_FOUND",
                    "Opportunity not found or is not active");
            }

            if (await _guardianConsent.IsBlockedAsync(
                userId,
                tenantId,
                shift.OpportunityId,
                cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status403Forbidden,
                    VolunteerGuardianConsentService.RequiredCode,
                    VolunteerGuardianConsentService.RequiredMessage);
            }

            var application = await LockApprovedApplicationAsync(
                shift.OpportunityId,
                userId,
                tenantId,
                cancellationToken);
            if (application is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status403Forbidden,
                    "FORBIDDEN",
                    "You must have an approved application to sign up for shifts");
            }

            if (shift.StartsAt < DateTime.UtcNow)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status400BadRequest,
                    "VALIDATION_ERROR",
                    "This shift has already started");
            }

            // Laravel's capacity check includes every approved assignment,
            // including this caller when they retry an already-selected shift.
            if (shift.MaxVolunteers > 0)
            {
                var approvedApplications = await _db.VolunteerApplications
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .LongCountAsync(candidate =>
                        candidate.TenantId == tenantId
                        && candidate.ShiftId == shiftId
                        && candidate.Status == ApplicationStatus.Approved,
                        cancellationToken);

                var activeReservedSlots = await _db.ShiftGroupReservations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(reservation =>
                        reservation.TenantId == tenantId
                        && reservation.ShiftId == shiftId
                        && reservation.Status == "active")
                    .SumAsync(
                        reservation => reservation.ReservedSlots > 0
                            ? (long)reservation.ReservedSlots
                            : 0L,
                        cancellationToken);

                if (approvedApplications + activeReservedSlots >= shift.MaxVolunteers)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return ShiftSignupError(
                        StatusCodes.Status400BadRequest,
                        "VALIDATION_ERROR",
                        "This shift is at capacity");
                }
            }

            var previousShiftId = application.ShiftId;
            var now = DateTime.UtcNow;
            var affected = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .Where(candidate =>
                    candidate.Id == application.Id
                    && candidate.TenantId == tenantId
                    && candidate.OpportunityId == shift.OpportunityId
                    && candidate.UserId == userId
                    && candidate.Status == ApplicationStatus.Approved
                    && candidate.ShiftId == application.ShiftId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(candidate => candidate.ShiftId, shiftId)
                    .SetProperty(candidate => candidate.UpdatedAt, now),
                    cancellationToken);

            if (affected != 1)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status403Forbidden,
                    "FORBIDDEN",
                    "You must have an approved application to sign up for shifts");
            }

            await transaction.CommitAsync(cancellationToken);
            await transaction.DisposeAsync();

            if (previousShiftId.HasValue && previousShiftId.Value != shiftId)
            {
                await TryNotifyNextWaitlistedVolunteerAsync(previousShiftId.Value, tenantId);
            }

            return Ok(new
            {
                data = new
                {
                    shift_id = shiftId,
                    message = "Successfully signed up for shift"
                },
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}"
                }
            });
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(
                exception,
                "Failed to sign user {UserId} up for volunteer shift {ShiftId} in tenant {TenantId}",
                userId,
                shiftId,
                tenantId);
            return ShiftSignupError(
                StatusCodes.Status400BadRequest,
                "SERVER_ERROR",
                "Failed to sign up for shift");
        }
    }

    [HttpDelete("shifts/{shiftId:int}/signup")]
    public async Task<IActionResult> CancelShiftSignup(
        int shiftId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        var userId = UserId();

        if (!await IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return ShiftSignupError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            // Signup, approval, reservation, waitlist claim, and cancellation all
            // serialize on this tenant-scoped row. A cancellation can therefore
            // only clear an assignment that existed after the preceding capacity
            // writer committed; it never races a concurrent signup update.
            if (!await LockShiftAsync(shiftId, tenantId, cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status404NotFound,
                    "NOT_FOUND",
                    "Shift not found");
            }

            var shift = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(candidate => candidate.Id == shiftId && candidate.TenantId == tenantId)
                .Select(candidate => new { candidate.OpportunityId, candidate.StartsAt })
                .SingleAsync(cancellationToken);

            if (shift.StartsAt < DateTime.UtcNow)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status400BadRequest,
                    "VALIDATION_ERROR",
                    "Cannot cancel a shift that has already started");
            }

            var cancellationDeadlineHours = await GetCancellationDeadlineHoursAsync(
                tenantId,
                cancellationToken);
            if (cancellationDeadlineHours > 0
                && shift.StartsAt - DateTime.UtcNow < TimeSpan.FromHours(cancellationDeadlineHours))
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status400BadRequest,
                    "VALIDATION_ERROR",
                    $"This shift can no longer be cancelled. Cancellations close {cancellationDeadlineHours} hours before the shift starts.");
            }

            // Clear only the selected shift. The approved application remains
            // approved and reusable for another rota slot. Laravel reports a
            // retry as NOT_FOUND because there is no longer a matching signup.
            var affected = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .Where(application =>
                    application.TenantId == tenantId
                    && application.OpportunityId == shift.OpportunityId
                    && application.UserId == userId
                    && application.ShiftId == shiftId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(application => application.ShiftId, (int?)null),
                    cancellationToken);

            if (affected == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return ShiftSignupError(
                    StatusCodes.Status404NotFound,
                    "NOT_FOUND",
                    "You are not signed up for this shift");
            }

            await transaction.CommitAsync(cancellationToken);
            await transaction.DisposeAsync();

            await TryDispatchShiftCancellationNotificationAsync(userId, shiftId, tenantId);
            await TryNotifyNextWaitlistedVolunteerAsync(shiftId, tenantId);

            return NoContent();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(
                exception,
                "Failed to cancel volunteer shift signup for user {UserId}, shift {ShiftId}, tenant {TenantId}",
                userId,
                shiftId,
                tenantId);
            return ShiftSignupError(
                StatusCodes.Status400BadRequest,
                "SERVER_ERROR",
                "Failed to cancel shift signup");
        }
    }

    [HttpGet("shifts/{shiftId:int}/checkin")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerAttendanceTokenPolicy)]
    public async Task<IActionResult> MyCheckin(
        int shiftId,
        CancellationToken cancellationToken = default)
    {
        var result = await _attendance.GetOrCreatePersonalTokenAsync(
            TenantId(),
            UserId(),
            shiftId,
            cancellationToken);
        if (!result.IsSuccess)
        {
            return AttendanceError(result.Error!);
        }

        var row = result.Value!;
        var qrUrl = await BuildAttendanceQrUrlAsync(
            TenantId(),
            row.QrToken,
            cancellationToken);
        return Ok(new
        {
            data = new
            {
                id = row.Id,
                qr_token = row.QrToken,
                qr_url = qrUrl,
                status = row.Status,
                checked_in_at = AttendanceDate(row.CheckedInAt),
                checked_out_at = AttendanceDate(row.CheckedOutAt)
            },
            meta = AttendanceMeta()
        });
    }

    [HttpGet("shifts/{shiftId:int}/checkins")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerAttendanceRosterPolicy)]
    public async Task<IActionResult> ShiftCheckins(
        int shiftId,
        CancellationToken cancellationToken = default)
    {
        var result = await _attendance.GetRosterAsync(
            TenantId(),
            UserId(),
            shiftId,
            cancellationToken);
        if (!result.IsSuccess)
        {
            return AttendanceError(result.Error!);
        }

        return Ok(new
        {
            data = new
            {
                checkins = result.Value!.Select(row => new
                {
                    id = row.Id,
                    user = new
                    {
                        id = row.User.Id,
                        name = row.User.Name,
                        avatar_url = row.User.AvatarUrl
                    },
                    status = row.Status,
                    checked_in_at = AttendanceDate(row.CheckedInAt),
                    checked_out_at = AttendanceDate(row.CheckedOutAt)
                })
            },
            meta = AttendanceMeta()
        });
    }

    [HttpPost("checkin/verify/{token}")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerAttendanceVerifyPolicy)]
    public async Task<IActionResult> VerifyCheckin(
        string token,
        CancellationToken cancellationToken = default)
    {
        var result = await _attendance.VerifyAsync(
            TenantId(),
            UserId(),
            token,
            cancellationToken);
        if (!result.IsSuccess)
        {
            return AttendanceError(result.Error!);
        }

        var row = result.Value!;
        return Ok(new
        {
            data = new
            {
                status = row.Status,
                checked_in_at = AttendanceDate(row.CheckedInAt),
                user = new
                {
                    id = row.User.Id,
                    name = row.User.Name,
                    avatar_url = row.User.AvatarUrl
                },
                shift = new
                {
                    id = row.Shift.Id,
                    start_time = AttendanceDate(row.Shift.StartsAt),
                    end_time = AttendanceDate(row.Shift.EndsAt)
                }
            },
            meta = AttendanceMeta()
        });
    }

    [HttpPost("checkin/checkout/{token}")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerAttendanceCheckoutPolicy)]
    public async Task<IActionResult> Checkout(
        string token,
        CancellationToken cancellationToken = default)
    {
        var result = await _attendance.CheckOutAsync(
            TenantId(),
            UserId(),
            token,
            cancellationToken);
        if (!result.IsSuccess)
        {
            return AttendanceError(result.Error!);
        }

        return Ok(new
        {
            data = new { message = result.Value!.Message },
            meta = AttendanceMeta()
        });
    }

    [HttpGet("hours")]
    public async Task<IActionResult> Hours()
    {
        var hours = await _db.VolunteerCheckIns.Where(c => c.UserId == UserId()).SumAsync(c => c.HoursLogged ?? 0);
        return Ok(new { data = new { user_id = UserId(), hours } });
    }

    [HttpGet("certificates")]
    public async Task<IActionResult> Certificates()
    {
        var hours = await _db.VolunteerCheckIns.Where(c => c.UserId == UserId()).SumAsync(c => c.HoursLogged ?? 0);
        return Ok(new { data = new[] { new { id = UserId(), certificate_number = $"VOL-{TenantId()}-{UserId()}", hours } } });
    }

    [HttpGet("certificates/{certificateId:int}/html")]
    public IActionResult CertificateHtml(int certificateId) => Content($"<html><body><h1>Volunteer Certificate #{certificateId}</h1></body></html>", "text/html", Encoding.UTF8);

    [HttpGet("certificates/verify/{code}")]
    public IActionResult VerifyCertificate(string code) => Ok(new { data = new { code, valid = true } });

    [HttpGet("credentials")]
    public IActionResult Credentials() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("credentials/{credentialId:int}/download")]
    public IActionResult DownloadCredential(int credentialId) => File(Encoding.UTF8.GetBytes($"Credential {credentialId}"), "text/plain", $"credential-{credentialId}.txt");

    [HttpDelete("credentials/{credentialId:int}")]
    public IActionResult DeleteCredential(int credentialId) => NoContent();

    [HttpGet("expenses")]
    public IActionResult Expenses() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("expenses/{expenseId:int}")]
    public IActionResult Expense(int expenseId) => Ok(new { data = new { id = expenseId, status = "pending" } });

    [HttpGet("donations")]
    public IActionResult Donations() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("accessibility-needs")]
    public IActionResult AccessibilityNeeds() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("custom-fields")]
    public IActionResult CustomFields() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("community-projects")]
    public async Task<IActionResult> CommunityProjects() => Ok(new { data = await _db.VolunteerOpportunities.OrderByDescending(o => o.CreatedAt).Take(50).ToListAsync() });

    [HttpGet("community-projects/{projectId:int}")]
    public async Task<IActionResult> CommunityProject(int projectId)
    {
        var project = await _db.VolunteerOpportunities.FirstOrDefaultAsync(o => o.Id == projectId);
        return project == null ? NotFound(new { error = "Project not found" }) : Ok(new { data = project });
    }

    [HttpPut("community-projects/{projectId:int}")]
    public async Task<IActionResult> UpdateCommunityProject(int projectId, [FromBody] JsonElement body)
    {
        var project = await _db.VolunteerOpportunities.FirstOrDefaultAsync(o => o.Id == projectId);
        if (project == null) return NotFound(new { error = "Project not found" });
        project.Title = Str(body, "title") ?? project.Title;
        project.Description = Str(body, "description") ?? project.Description;
        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = project });
    }

    [HttpGet("giving-days/{dayId:int}/stats")]
    public IActionResult GivingDayStats(int dayId) => Ok(new { data = new { id = dayId, volunteers = 0, hours = 0 } });

    [HttpGet("guardian-consents")]
    [EnableRateLimiting(RateLimitingExtensions.GuardianConsentListPolicy)]
    public async Task<IActionResult> GuardianConsents(CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        if (!await _guardianConsent.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return GuardianConsentError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        var consents = await _guardianConsent.ListForMinorAsync(
            UserId(),
            tenantId,
            cancellationToken);
        return Ok(new
        {
            data = consents.Select(MapGuardianConsent),
            meta = new { base_url = BaseUrl() }
        });
    }

    [HttpPost("guardian-consents")]
    [EnableRateLimiting(RateLimitingExtensions.GuardianConsentRequestPolicy)]
    public async Task<IActionResult> CreateGuardianConsent(
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        if (!await _guardianConsent.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return GuardianConsentError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        int? opportunityId = null;
        if (body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("opportunity_id", out var opportunityValue)
            && opportunityValue.ValueKind is not JsonValueKind.Null)
        {
            if (!int.TryParse(opportunityValue.ToString(), out var parsedOpportunityId)
                || parsedOpportunityId <= 0)
            {
                return GuardianConsentError(
                    StatusCodes.Status422UnprocessableEntity,
                    "VALIDATION_ERROR",
                    "Opportunity ID must be a positive integer.");
            }

            opportunityId = parsedOpportunityId;
        }

        try
        {
            var consent = await _guardianConsent.RequestConsentAsync(
                UserId(),
                tenantId,
                new GuardianConsentRequest(
                    Str(body, "guardian_name"),
                    Str(body, "guardian_email"),
                    Str(body, "relationship"),
                    Str(body, "guardian_phone"),
                    opportunityId),
                cancellationToken);
            return StatusCode(
                StatusCodes.Status201Created,
                new
                {
                    data = MapGuardianConsent(consent),
                    meta = new { base_url = BaseUrl() }
                });
        }
        catch (GuardianConsentValidationException exception)
        {
            return GuardianConsentError(
                StatusCodes.Status422UnprocessableEntity,
                "VALIDATION_ERROR",
                exception.Message);
        }
    }

    [AllowAnonymous]
    [HttpGet("guardian-consents/verify/{token}")]
    [EnableRateLimiting(RateLimitingExtensions.GuardianConsentVerifyLookupPolicy)]
    public async Task<IActionResult> ShowGuardianConsentVerification(
        string token,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        if (!await _guardianConsent.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return GuardianConsentError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        var status = await _guardianConsent.GetConsentStatusByTokenAsync(
            token,
            tenantId,
            cancellationToken);
        if (status is null)
        {
            return GuardianConsentError(
                StatusCodes.Status400BadRequest,
                "INVALID_TOKEN",
                "Consent token is invalid or expired");
        }

        return Ok(new
        {
            data = new
            {
                status = status.Status,
                valid = status.Valid
            },
            meta = new { base_url = BaseUrl() }
        });
    }

    [AllowAnonymous]
    [HttpPost("guardian-consents/verify/{token}")]
    [EnableRateLimiting(RateLimitingExtensions.GuardianConsentVerifyPolicy)]
    public async Task<IActionResult> VerifyGuardianConsent(
        string token,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        if (!await _guardianConsent.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return GuardianConsentError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
        var granted = await _guardianConsent.GrantConsentAsync(
            token,
            ipAddress,
            tenantId,
            cancellationToken);
        if (!granted)
        {
            return GuardianConsentError(
                StatusCodes.Status400BadRequest,
                "INVALID_TOKEN",
                "Consent token is invalid or expired");
        }

        return Ok(new
        {
            data = new
            {
                success = true,
                message = "Guardian consent has been granted successfully."
            },
            meta = new { base_url = BaseUrl() }
        });
    }

    [HttpDelete("guardian-consents/{consentId:int}")]
    [EnableRateLimiting(RateLimitingExtensions.GuardianConsentWithdrawPolicy)]
    public async Task<IActionResult> DeleteGuardianConsent(
        int consentId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        if (!await _guardianConsent.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return GuardianConsentError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        var withdrawn = await _guardianConsent.WithdrawConsentAsync(
            consentId,
            UserId(),
            tenantId,
            cancellationToken);
        if (!withdrawn)
        {
            return GuardianConsentError(
                StatusCodes.Status404NotFound,
                "NOT_FOUND",
                "Consent not found");
        }

        return Ok(new
        {
            data = new { success = true },
            meta = new { base_url = BaseUrl() }
        });
    }

    [HttpPost("organisations")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOrganisationCreatePolicy)]
    public async Task<IActionResult> CreateOrganisation(
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
        {
            return VolunteerOrganisationError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        var requestValidation = ValidateOrganisationCreateRequest(body);
        if (requestValidation.Count > 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new
            {
                errors = new[]
                {
                    new
                    {
                        code = "validation_failed",
                        message = "Validation failed",
                        details = requestValidation
                    }
                },
                success = false
            });
        }

        var result = await _volunteerOrganisations.CreateAsync(
            tenantId,
            UserId(),
            new VolunteerOrganisationCreateCommand(
                Str(body, "name"),
                Str(body, "description"),
                Str(body, "contact_email"),
                Str(body, "website")),
            activate: false,
            cancellationToken);
        if (!result.Success)
        {
            var error = result.Error!;
            var statusCode = error.Code switch
            {
                "ALREADY_EXISTS" => StatusCodes.Status409Conflict,
                "FORBIDDEN" => StatusCodes.Status403Forbidden,
                "SERVER_ERROR" => StatusCodes.Status400BadRequest,
                _ => StatusCodes.Status400BadRequest
            };
            return VolunteerOrganisationError(statusCode, error.Code, error.Message, error.Field);
        }

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = result.Data,
            meta = new { base_url = await BaseUrlAsync(tenantId, cancellationToken) }
        });
    }

    [HttpPut("organisations/{organisationId:int}")]
    public async Task<IActionResult> UpdateOrganisation(
        int organisationId,
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Volunteering module is not enabled for this community");
        if (!await _volunteerOrganisations.CanManageDashboardAsync(
            organisationId, UserId(), tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FORBIDDEN", "Access denied");

        var result = await _volunteerOrganisations.UpdateAsync(
            organisationId,
            tenantId,
            UpdateCommand(body, includeAdminFields: false),
            adminSurface: false,
            cancellationToken);
        if (!result.Success)
        {
            var error = result.Error!;
            var statusCode = error.Code switch
            {
                "NOT_FOUND" => StatusCodes.Status404NotFound,
                "SERVER_ERROR" => StatusCodes.Status500InternalServerError,
                _ when error.Message == "No fields to update" => StatusCodes.Status400BadRequest,
                _ => StatusCodes.Status422UnprocessableEntity
            };
            return VolunteerOrganisationError(statusCode, error.Code, error.Message, error.Field);
        }

        return Ok(new
        {
            data = result.Data,
            meta = new { base_url = await BaseUrlAsync(tenantId, cancellationToken) }
        });
    }

    [HttpGet("organisations/{organisationId:int}/applications")]
    public async Task<IActionResult> OrganisationApplications(
        int organisationId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Volunteering module is not enabled for this community");
        if (!await _volunteerOrganisations.CanManageDashboardAsync(
            organisationId, UserId(), tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FORBIDDEN", "Access denied");

        var limit = Math.Clamp(IntQuery("per_page", 20), 1, 50);
        var cursor = IntQuery("cursor", 0);
        var status = Request.Query["status"].FirstOrDefault();
        ApplicationStatus? statusFilter = status?.ToLowerInvariant() switch
        {
            "pending" => ApplicationStatus.Pending,
            "approved" => ApplicationStatus.Approved,
            "declined" => ApplicationStatus.Declined,
            _ => null
        };

        var query =
            from application in _db.VolunteerApplications.IgnoreQueryFilters().AsNoTracking()
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { application.OpportunityId, application.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            join user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                on new { application.UserId, application.TenantId }
                equals new { UserId = user.Id, user.TenantId }
            join shift in _db.VolunteerShifts.IgnoreQueryFilters().AsNoTracking()
                on new { ShiftId = application.ShiftId, application.TenantId }
                equals new { ShiftId = (int?)shift.Id, shift.TenantId } into shifts
            from shift in shifts.DefaultIfEmpty()
            where application.TenantId == tenantId
                && opportunity.VolunteerOrganisationId == organisationId
                && (!statusFilter.HasValue || application.Status == statusFilter.Value)
                && (cursor <= 0 || application.Id < cursor)
            orderby application.Id descending
            select new
            {
                application.Id,
                application.Status,
                application.Message,
                application.OrgNote,
                application.CreatedAt,
                application.ShiftId,
                UserId = user.Id,
                UserName = (user.FirstName + " " + user.LastName).Trim(),
                user.AvatarUrl,
                user.Email,
                OpportunityId = opportunity.Id,
                OpportunityTitle = opportunity.Title,
                ShiftStartsAt = shift == null ? (DateTime?)null : shift.StartsAt,
                ShiftEndsAt = shift == null ? (DateTime?)null : shift.EndsAt
            };
        var rows = await query.Take(limit + 1).ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        if (hasMore) rows.RemoveAt(rows.Count - 1);
        var data = rows.Select(row => new
        {
            id = row.Id,
            status = row.Status.ToString().ToLowerInvariant(),
            message = row.Message,
            org_note = row.OrgNote,
            created_at = row.CreatedAt,
            user = new
            {
                id = row.UserId,
                name = row.UserName,
                avatar_url = row.AvatarUrl,
                email = row.Email
            },
            opportunity = new { id = row.OpportunityId, title = row.OpportunityTitle },
            shift = row.ShiftId.HasValue
                ? new { start_time = row.ShiftStartsAt, end_time = row.ShiftEndsAt }
                : null
        }).ToList();

        return Ok(new
        {
            data,
            meta = new
            {
                base_url = await BaseUrlAsync(tenantId, cancellationToken),
                cursor = hasMore && data.Count > 0 ? data[^1].id.ToString() : null,
                per_page = limit,
                has_more = hasMore
            }
        });
    }

    [HttpGet("organisations/{organisationId:int}/hours/pending")]
    public IActionResult PendingHours(int organisationId) => Ok(new { data = Array.Empty<object>() });

    [HttpGet("organisations/{organisationId:int}/stats")]
    public async Task<IActionResult> OrganisationStats(
        int organisationId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Volunteering module is not enabled for this community");
        if (!await _volunteerOrganisations.CanManageDashboardAsync(
            organisationId, UserId(), tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FORBIDDEN", "Access denied");

        var organisation = await _db.VolunteerOrganisations.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(org => org.Id == organisationId && org.TenantId == tenantId, cancellationToken);
        if (organisation is null)
            return VolunteerOrganisationError(403, "FORBIDDEN", "Access denied");
        var opportunityIds = _db.VolunteerOpportunities.IgnoreQueryFilters()
            .Where(opportunity => opportunity.TenantId == tenantId
                && opportunity.VolunteerOrganisationId == organisationId)
            .Select(opportunity => opportunity.Id);
        var totalVolunteers = await _db.VolunteerApplications.IgnoreQueryFilters()
            .Where(application => application.TenantId == tenantId
                && opportunityIds.Contains(application.OpportunityId)
                && application.Status == ApplicationStatus.Approved)
            .Select(application => application.UserId)
            .Distinct()
            .CountAsync(cancellationToken);
        var pendingApplications = await _db.VolunteerApplications.IgnoreQueryFilters()
            .CountAsync(application => application.TenantId == tenantId
                && opportunityIds.Contains(application.OpportunityId)
                && application.Status == ApplicationStatus.Pending, cancellationToken);
        var hoursSummary = await _volunteerOrganisations.GetHoursSummaryAsync(
            tenantId,
            organisationId,
            cancellationToken);
        var activeOpportunities = await _db.VolunteerOpportunities.IgnoreQueryFilters()
            .CountAsync(opportunity => opportunity.TenantId == tenantId
                && opportunity.VolunteerOrganisationId == organisationId
                && opportunity.Status == OpportunityStatus.Published, cancellationToken);

        return Ok(new
        {
            data = new
            {
                total_volunteers = totalVolunteers,
                pending_applications = pendingApplications,
                pending_hours = hoursSummary.PendingCount,
                total_approved_hours = hoursSummary.ApprovedTotal,
                active_opportunities = activeOpportunities,
                wallet_balance = organisation.Balance,
                auto_pay_enabled = organisation.AutoPayEnabled,
                org_name = organisation.Name
            },
            meta = new { base_url = await BaseUrlAsync(tenantId, cancellationToken) }
        });
    }

    [HttpGet("organisations/{organisationId:int}/volunteers")]
    public async Task<IActionResult> OrganisationVolunteers(
        int organisationId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Volunteering module is not enabled for this community");
        if (!await _volunteerOrganisations.CanManageDashboardAsync(
            organisationId, UserId(), tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FORBIDDEN", "Access denied");

        var limit = Math.Clamp(IntQuery("per_page", 20), 1, 50);
        var cursor = IntQuery("cursor", 0);
        var volunteers = await (
            from application in _db.VolunteerApplications.IgnoreQueryFilters().AsNoTracking()
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { application.OpportunityId, application.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            join user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                on new { application.UserId, application.TenantId }
                equals new { UserId = user.Id, user.TenantId }
            where application.TenantId == tenantId
                && opportunity.VolunteerOrganisationId == organisationId
                && application.Status == ApplicationStatus.Approved
                && (cursor <= 0 || user.Id < cursor)
            group application by new
            {
                user.Id,
                user.FirstName,
                user.LastName,
                user.AvatarUrl,
                user.Email
            } into applications
            orderby applications.Key.Id descending
            select new
            {
                applications.Key.Id,
                Name = (applications.Key.FirstName + " " + applications.Key.LastName).Trim(),
                applications.Key.AvatarUrl,
                applications.Key.Email,
                AppliedAt = applications.Max(application => application.CreatedAt),
                ApplicationsCount = applications.Count()
            })
            .Take(limit + 1)
            .ToListAsync(cancellationToken);
        var hasMore = volunteers.Count > limit;
        if (hasMore) volunteers.RemoveAt(volunteers.Count - 1);
        var userIds = volunteers.Select(volunteer => volunteer.Id).ToArray();
        var hours = await _volunteerOrganisations.GetApprovedHoursByUserAsync(
            tenantId,
            organisationId,
            userIds,
            cancellationToken);
        var data = volunteers.Select(volunteer => new
        {
            id = volunteer.Id,
            name = volunteer.Name,
            avatar_url = volunteer.AvatarUrl,
            email = volunteer.Email,
            total_hours = hours.GetValueOrDefault(volunteer.Id),
            applications_count = volunteer.ApplicationsCount,
            applied_at = volunteer.AppliedAt
        }).ToList();

        return Ok(new
        {
            data,
            meta = new
            {
                base_url = await BaseUrlAsync(tenantId, cancellationToken),
                cursor = hasMore && data.Count > 0 ? data[^1].id.ToString() : null,
                per_page = limit,
                has_more = hasMore
            }
        });
    }

    [HttpGet("admin/swaps")]
    [Authorize(Policy = "AdminOnly")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerSwapAdminListPolicy)]
    public async Task<IActionResult> AdminSwaps(CancellationToken cancellationToken = default)
    {
        SetSwapHeaders();
        if (_shiftManagement is null)
            return SwapWorkflowError("Shift swap service is unavailable");
        if (!await _shiftManagement.IsVolunteeringEnabledAsync(cancellationToken))
            return ShiftSignupError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");

        var swaps = await _shiftManagement.GetAdminPendingSwapsAsync();
        return Ok(new
        {
            data = swaps.Select(swap =>
                ShiftManagementController.SwapPayload(
                    swap,
                    UserId(),
                    includeDirection: false)),
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}",
                total = swaps.Count
            }
        });
    }

    [HttpPut("admin/swaps/{swapId:int}")]
    [Authorize(Policy = "AdminOnly")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerSwapAdminDecidePolicy)]
    public async Task<IActionResult> UpdateSwap(
        int swapId,
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        SetSwapHeaders();
        if (_shiftManagement is null)
            return SwapWorkflowError("Shift swap service is unavailable");
        if (!await _shiftManagement.IsVolunteeringEnabledAsync(cancellationToken))
            return ShiftSignupError(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");

        var action = Str(body, "action")?.Trim().ToLowerInvariant();
        if (action is not ("approve" or "reject"))
        {
            return StatusCode(StatusCodes.Status400BadRequest, new
            {
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_ERROR",
                        message = "Action must be approve or reject",
                        field = "action"
                    }
                }
            });
        }

        var (swap, error) = await _shiftManagement.AdminDecideSwapAsync(
            swapId,
            UserId(),
            approve: action == "approve");
        if (error is not null)
            return SwapWorkflowError(error);

        return Ok(new
        {
            data = new { id = swap!.Id, status = swap.Status },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpGet("incidents")]
    public IActionResult Incidents() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("incidents/{incidentId:int}")]
    public IActionResult Incident(int incidentId) => Ok(new { data = new { id = incidentId, status = "open" } });

    [HttpPost("emergency-alerts")]
    public IActionResult EmergencyAlert([FromBody] JsonElement body) => Ok(new { data = new { id = Math.Abs(HashCode.Combine(Str(body, "message"), DateTime.UtcNow.Ticks)), status = "sent" } });

    [HttpDelete("emergency-alerts/{alertId:int}")]
    public IActionResult DeleteEmergencyAlert(int alertId) => NoContent();

    [HttpGet("training")]
    public IActionResult Training() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("wellbeing/my-status")]
    public IActionResult MyWellbeingStatus() => Ok(new { data = new { user_id = UserId(), status = "ok" } });

    [HttpPost("reviews")]
    public IActionResult CreateReview([FromBody] JsonElement body) => Ok(new { data = new { id = Math.Abs(HashCode.Combine(UserId(), Str(body, "reviewee_type"), Str(body, "reviewee_id"))), rating = Int(body, "rating") ?? 5 } });

    [HttpGet("reviews/{revieweeType}/{revieweeId:int}")]
    public IActionResult Reviews(string revieweeType, int revieweeId) => Ok(new { data = Array.Empty<object>(), reviewee_type = revieweeType, reviewee_id = revieweeId });

    [HttpDelete("opportunities/{id:int}")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOpportunityDeletePolicy)]
    public async Task<IActionResult> DeleteOpportunity(
        int id,
        CancellationToken cancellationToken = default)
    {
        var tenantId = TenantId();
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, cancellationToken))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Volunteering module is not enabled for this community");

        var opportunity = await _db.VolunteerOpportunities
            .IgnoreQueryFilters()
            .Where(row => row.Id == id
                && row.TenantId == tenantId
                && row.VolunteerOrganisationId.HasValue
                && _db.VolunteerOrganisations
                    .IgnoreQueryFilters()
                    .Any(org => org.Id == row.VolunteerOrganisationId.Value
                        && org.TenantId == tenantId))
            .SingleOrDefaultAsync(cancellationToken);
        if (opportunity is null)
            return VolunteerOrganisationError(404, "NOT_FOUND", "Opportunity not found");

        var access = await _volunteerOrganisations.EvaluateOpportunityAccessAsync(
            id,
            UserId(),
            tenantId,
            includeCreator: false,
            cancellationToken);
        if (!access.Exists)
            return VolunteerOrganisationError(404, "NOT_FOUND", "Opportunity not found");
        if (!access.Allowed)
            return VolunteerOrganisationError(403, "FORBIDDEN", "You do not have permission to manage this opportunity");

        opportunity.Status = OpportunityStatus.Cancelled;
        opportunity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
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

    private async Task<ApprovedApplicationLock?> LockApprovedApplicationAsync(
        int opportunityId,
        int userId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\", \"ShiftId\" FROM volunteer_applications " +
            "WHERE \"OpportunityId\" = @opportunity_id " +
            "AND \"UserId\" = @user_id " +
            "AND \"TenantId\" = @tenant_id " +
            "AND \"Status\" = @approved_status FOR UPDATE";

        var opportunityParameter = command.CreateParameter();
        opportunityParameter.ParameterName = "opportunity_id";
        opportunityParameter.Value = opportunityId;
        command.Parameters.Add(opportunityParameter);

        var userParameter = command.CreateParameter();
        userParameter.ParameterName = "user_id";
        userParameter.Value = userId;
        command.Parameters.Add(userParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        var statusParameter = command.CreateParameter();
        statusParameter.ParameterName = "approved_status";
        statusParameter.Value = ApplicationStatus.Approved.ToString();
        command.Parameters.Add(statusParameter);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new ApprovedApplicationLock(
            reader.GetInt32(0),
            reader.IsDBNull(1) ? null : reader.GetInt32(1));
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

    private async Task<int> GetCancellationDeadlineHoursAsync(
        int tenantId,
        CancellationToken cancellationToken)
    {
        const string key = "volunteering.cancellation_deadline_hours";
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == key)
            .Select(config => config.Value)
            .SingleOrDefaultAsync(cancellationToken);

        return int.TryParse(value?.Trim().Trim('"'), out var hours) && hours > 0
            ? hours
            : 0;
    }

    private async Task TryDispatchShiftCancellationNotificationAsync(
        int userId,
        int shiftId,
        int tenantId)
    {
        const string title = "Volunteer shift signup cancelled";
        const string body = "Your volunteer shift signup has been cancelled";
        var data = JsonSerializer.Serialize(new
        {
            shift_id = shiftId,
            url = "/volunteering"
        });
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = "volunteer_shift",
            Title = title,
            Body = body,
            Data = data,
            Link = "/volunteering",
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
                "Failed to create cancellation notification for volunteer shift {ShiftId}, user {UserId}",
                shiftId,
                userId);
        }

        if (_pushNotifications is null)
        {
            return;
        }

        try
        {
            await _pushNotifications.SendPushAsync(userId, title, body, data);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Failed to queue cancellation push for volunteer shift {ShiftId}, user {UserId}",
                shiftId,
                userId);
        }
    }

    private async Task TryNotifyNextWaitlistedVolunteerAsync(int shiftId, int tenantId)
    {
        if (_shiftManagement is null)
        {
            return;
        }

        try
        {
            await _shiftManagement.NotifyNextWaitlistedVolunteerAsync(
                shiftId,
                tenantId,
                CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Failed to notify the next waitlisted volunteer for shift {ShiftId}, tenant {TenantId}",
                shiftId,
                tenantId);
        }
    }

    private ObjectResult ShiftSignupError(int statusCode, string code, string message) =>
        StatusCode(statusCode, new
        {
            errors = new[]
            {
                new { code, message }
            }
        });

    private ObjectResult SwapWorkflowError(string message)
    {
        var (statusCode, code) = message switch
        {
            "Shift swap service is unavailable" =>
                (StatusCodes.Status503ServiceUnavailable, "SERVICE_UNAVAILABLE"),
            "Swap request not found" or
            "Swap request not found or already processed" or
            "Swap request not found or not cancellable" =>
                (StatusCodes.Status404NotFound, "NOT_FOUND"),
            "Not authorized" or "You are not assigned to this shift" =>
                (StatusCodes.Status403Forbidden, "FORBIDDEN"),
            "A matching swap request is already pending" =>
                (StatusCodes.Status409Conflict, "ALREADY_EXISTS"),
            _ when message.StartsWith("Failed to ", StringComparison.Ordinal) =>
                (StatusCodes.Status500InternalServerError, "SERVER_ERROR"),
            _ => (StatusCodes.Status400BadRequest, "VALIDATION_ERROR")
        };
        return StatusCode(statusCode, new
        {
            errors = new[] { new { code, message } }
        });
    }

    private ObjectResult GuardianConsentError(
        int statusCode,
        string code,
        string message,
        string? field = null)
    {
        if (field is null)
        {
            return StatusCode(statusCode, new
            {
                errors = new[]
                {
                    new { code, message }
                }
            });
        }

        return StatusCode(statusCode, new
        {
            errors = new[]
            {
                new { code, message, field }
            }
        });
    }

    private ObjectResult VolunteerOrganisationError(
        int statusCode,
        string code,
        string message,
        string? field = null)
    {
        if (field is null)
        {
            return StatusCode(statusCode, new
            {
                errors = new[] { new { code, message } }
            });
        }

        return StatusCode(statusCode, new
        {
            errors = new[] { new { code, message, field } }
        });
    }

    private ObjectResult AttendanceError(VolunteerAttendanceError error)
    {
        if (error.Field is null)
        {
            return StatusCode(error.StatusCode, new
            {
                errors = new[]
                {
                    new { code = error.Code, message = error.Message }
                }
            });
        }

        return StatusCode(error.StatusCode, new
        {
            errors = new[]
            {
                new { code = error.Code, message = error.Message, field = error.Field }
            }
        });
    }

    private void SetSwapHeaders()
    {
        Response.Headers["API-Version"] = "2.0";
        var tenantId = User.FindFirst("tenant_id")?.Value;
        if (!string.IsNullOrWhiteSpace(tenantId))
        {
            Response.Headers["X-Tenant-ID"] = tenantId;
        }
    }

    private object AttendanceMeta() => new
    {
        base_url = $"{Request.Scheme}://{Request.Host}"
    };

    private async Task<string> BuildAttendanceQrUrlAsync(
        int tenantId,
        string token,
        CancellationToken cancellationToken)
    {
        var tenant = await _db.Tenants
            .AsNoTracking()
            .Where(candidate => candidate.Id == tenantId)
            .Select(candidate => new { candidate.Id, candidate.Slug, candidate.Domain })
            .SingleAsync(cancellationToken);

        string origin;
        string tenantPrefix;
        if (tenant.Id > 1 && !string.IsNullOrWhiteSpace(tenant.Domain))
        {
            origin = NormalizeAttendanceOrigin(tenant.Domain!);
            tenantPrefix = string.Empty;
        }
        else
        {
            origin = (_configuration["App:FrontendUrl"]
                ?? $"{Request.Scheme}://{Request.Host}").TrimEnd('/');
            tenantPrefix = string.IsNullOrWhiteSpace(tenant.Slug)
                ? string.Empty
                : "/" + Uri.EscapeDataString(tenant.Slug);
        }

        return $"{origin}{tenantPrefix}/volunteering/checkin/{Uri.EscapeDataString(token)}";
    }

    private static string NormalizeAttendanceOrigin(string domain)
    {
        var trimmed = domain.Trim().TrimEnd('/');
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https"
                ? absolute.ToString().TrimEnd('/')
                : $"https://{trimmed}";
    }

    private static string? AttendanceDate(DateTime? value) =>
        value?.ToUniversalTime().ToString(
            "yyyy-MM-dd HH:mm:ss",
            CultureInfo.InvariantCulture);

    private static object MapGuardianConsent(GuardianConsentView consent) => new
    {
        consent.Id,
        minor_user_id = consent.MinorUserId,
        guardian_name = consent.GuardianName,
        guardian_email = consent.GuardianEmail,
        guardian_phone = consent.GuardianPhone,
        relationship = consent.Relationship,
        opportunity_id = consent.OpportunityId,
        status = consent.Status,
        consent_given_at = consent.ConsentedAt,
        consent_withdrawn_at = consent.WithdrawnAt,
        expires_at = consent.ExpiresAt,
        created_at = consent.CreatedAt
    };

    private sealed record ApprovedApplicationLock(int Id, int? ShiftId);

    private static VolunteerOrganisationUpdateCommand UpdateCommand(
        JsonElement body,
        bool includeAdminFields)
    {
        var (hasName, name) = OptionalString(body, "name");
        var (hasDescription, description) = OptionalString(body, "description");
        var (hasContactEmail, contactEmail) = OptionalString(body, "contact_email");
        var (hasWebsite, website) = OptionalString(body, "website");
        var (hasOrgType, orgType) = includeAdminFields
            ? OptionalString(body, "org_type")
            : (false, null);
        var (hasMeetingSchedule, meetingSchedule) = includeAdminFields
            ? OptionalString(body, "meeting_schedule")
            : (false, null);
        return new(
            hasName,
            name,
            hasDescription,
            description,
            hasContactEmail,
            contactEmail,
            hasWebsite,
            website,
            hasOrgType,
            orgType,
            hasMeetingSchedule,
            meetingSchedule);
    }

    private static Dictionary<string, string[]> ValidateOrganisationCreateRequest(JsonElement body)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var name = Str(body, "name")?.Trim();
        var description = Str(body, "description")?.Trim();
        var email = Str(body, "contact_email")?.Trim();
        var website = Str(body, "website")?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            errors["name"] = ["The name field is required."];
        else if (name.Length > 255)
            errors["name"] = ["The name field must not be greater than 255 characters."];
        if (string.IsNullOrWhiteSpace(description))
            errors["description"] = ["The description field is required."];
        else if (description.Length > 5000)
            errors["description"] = ["The description field must not be greater than 5000 characters."];
        if (string.IsNullOrWhiteSpace(email))
            errors["contact_email"] = ["The contact email field is required."];
        else if (email.Length > 255 || !new EmailAddressAttribute().IsValid(email))
            errors["contact_email"] = ["The contact email field must be a valid email address."];
        if (!string.IsNullOrWhiteSpace(website)
            && (website.Length > 500
                || !Uri.TryCreate(website, UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https")))
        {
            errors["website"] = ["The website field must be a valid URL."];
        }

        return errors;
    }

    private static (bool HasValue, string? Value) OptionalString(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty(name, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return (false, null);
        }

        return (true, value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString());
    }

    private int IntQuery(string name, int fallback) =>
        int.TryParse(Request.Query[name].FirstOrDefault(), out var value) ? value : fallback;

    private void SetVolunteerOrganisationHeaders(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString();
    }

    private async Task<string> BaseUrlAsync(int tenantId, CancellationToken cancellationToken)
    {
        var domain = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(cancellationToken);
        return string.IsNullOrWhiteSpace(domain)
            ? BaseUrl().TrimEnd('/')
            : domain.TrimEnd('/');
    }

    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");
    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}";
    private static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;
    private static bool? Bool(JsonElement e, string name) => bool.TryParse(Str(e, name), out var value) ? value : null;
    private static decimal? Decimal(JsonElement e, string name) => decimal.TryParse(Str(e, name), out var value) ? value : null;
}
