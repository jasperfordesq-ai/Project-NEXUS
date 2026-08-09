// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Owns Laravel-compatible volunteer-organisation persistence and the two
/// opportunity-management policies. The generic Organisation tables are not
/// consulted because they represent a different product lifecycle.
/// </summary>
public sealed partial class VolunteerOrganisationService
{
    private static readonly HashSet<string> SiteManagerRoles =
        new(StringComparer.Ordinal) { "super_admin", "admin", "tenant_admin" };

    private readonly NexusDbContext _db;
    private readonly ILogger<VolunteerOrganisationService> _logger;

    public VolunteerOrganisationService(
        NexusDbContext db,
        ILogger<VolunteerOrganisationService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct = default)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId
                && row.Key == AdminVolunteerApprovalService.FeatureConfigKey)
            .Select(row => row.Value)
            .SingleOrDefaultAsync(ct);

        return string.IsNullOrWhiteSpace(raw)
            || raw.Trim().Trim('"').ToLowerInvariant()
                is not ("0" or "false" or "no" or "off" or "disabled");
    }

    public async Task<VolunteerOrganisationMutationResult> CreateAsync(
        int tenantId,
        int ownerUserId,
        VolunteerOrganisationCreateCommand command,
        bool activate,
        CancellationToken ct = default)
    {
        var validation = ValidateCreate(command);
        if (validation is not null)
        {
            return VolunteerOrganisationMutationResult.Failed(validation);
        }

        var name = command.Name!.Trim();
        var description = command.Description!.Trim();
        var contactEmail = command.ContactEmail!.Trim();
        var website = NullIfWhiteSpace(command.Website);

        if (!await IsActiveTenantUserAsync(ownerUserId, tenantId, ct))
        {
            return VolunteerOrganisationMutationResult.Failed(
                new("FORBIDDEN", "Invalid organization owner", null));
        }

        var duplicate = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(org => org.TenantId == tenantId
                && org.Status != "declined"
                && org.Name.ToLower() == name.ToLower(), ct);
        if (duplicate)
        {
            return VolunteerOrganisationMutationResult.Failed(
                new("ALREADY_EXISTS", "An organisation with this name already exists", "name"));
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            ct);
        try
        {
            // Recheck inside the transaction so concurrent registrations cannot
            // both pass the application-level Laravel duplicate-name rule.
            duplicate = await _db.VolunteerOrganisations
                .IgnoreQueryFilters()
                .AnyAsync(org => org.TenantId == tenantId
                    && org.Status != "declined"
                    && org.Name.ToLower() == name.ToLower(), ct);
            if (duplicate)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationMutationResult.Failed(
                    new("ALREADY_EXISTS", "An organisation with this name already exists", "name"));
            }

            var now = DateTime.UtcNow;
            var organisation = new VolunteerOrganisation
            {
                TenantId = tenantId,
                OwnerUserId = ownerUserId,
                Name = name,
                Slug = await GenerateUniqueSlugAsync(name, tenantId, ct),
                Description = description,
                ContactEmail = contactEmail,
                Website = website,
                Status = activate ? "active" : "pending",
                OrgType = NullIfWhiteSpace(command.OrgType) ?? "organisation",
                MeetingSchedule = NullIfWhiteSpace(command.MeetingSchedule),
                CreatedAt = now,
                UpdatedAt = activate ? now : null
            };
            organisation.Members.Add(new VolunteerOrganisationMember
            {
                TenantId = tenantId,
                UserId = ownerUserId,
                OrgType = "volunteer",
                Role = "owner",
                Status = "active",
                CreatedAt = now
            });

            _db.VolunteerOrganisations.Add(organisation);
            await _db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            return VolunteerOrganisationMutationResult.Succeeded(
                MapView(organisation, opportunityCount: 0, volunteerCount: 0, totalHours: 0m));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            _logger.LogError(
                exception,
                "Failed to create volunteer organisation for tenant {TenantId}",
                tenantId);
            return VolunteerOrganisationMutationResult.Failed(
                new("SERVER_ERROR", "Failed to register organisation", null));
        }
    }

    public async Task<VolunteerOrganisationView?> GetAsync(
        int id,
        int tenantId,
        bool includeNonPublic,
        CancellationToken ct = default)
    {
        var organisation = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(org => org.Id == id && org.TenantId == tenantId, ct);
        if (organisation is null
            || (!includeNonPublic && organisation.Status is not ("approved" or "active")))
        {
            return null;
        }

        var opportunityCount = await _db.VolunteerOpportunities
            .IgnoreQueryFilters()
            .CountAsync(opportunity => opportunity.TenantId == tenantId
                && opportunity.VolunteerOrganisationId == id
                && opportunity.Status == OpportunityStatus.Published, ct);
        var volunteerCount = await (
            from application in _db.VolunteerApplications.IgnoreQueryFilters().AsNoTracking()
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { application.OpportunityId, application.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            where application.TenantId == tenantId
                && opportunity.VolunteerOrganisationId == id
                && application.Status == ApplicationStatus.Approved
            select application.UserId)
            .Distinct()
            .CountAsync(ct);
        var totalHours = (await GetHoursSummaryAsync(tenantId, id, ct)).ApprovedTotal;
        var reviewSummary = await GetReviewSummaryAsync(tenantId, id, ct);

        return MapView(
            organisation,
            opportunityCount,
            volunteerCount,
            totalHours,
            reviewSummary.ReviewCount,
            reviewSummary.AverageRating);
    }

    public async Task<IReadOnlyList<VolunteerOrganisationAdminView>> ListAdminAsync(
        int tenantId,
        CancellationToken ct = default)
    {
        var organisations = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(org => org.TenantId == tenantId)
            .OrderBy(org => org.Name)
            .Take(100)
            .ToListAsync(ct);
        var ids = organisations.Select(org => org.Id).ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        var memberCounts = await _db.VolunteerOrganisationMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(member => member.TenantId == tenantId
                && ids.Contains(member.VolunteerOrganisationId)
                && member.OrgType == "volunteer"
                && member.Status == "active")
            .GroupBy(member => member.VolunteerOrganisationId)
            .Select(group => new { Id = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.Id, row => row.Count, ct);
        var opportunityCounts = await _db.VolunteerOpportunities
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(opportunity => opportunity.TenantId == tenantId
                && opportunity.VolunteerOrganisationId.HasValue
                && ids.Contains(opportunity.VolunteerOrganisationId.Value)
                && opportunity.Status == OpportunityStatus.Published)
            .GroupBy(opportunity => opportunity.VolunteerOrganisationId!.Value)
            .Select(group => new { Id = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.Id, row => row.Count, ct);
        var hours = new Dictionary<int, decimal>();
        if (await TableExistsAsync("vol_logs", ct))
        {
            hours = await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(log => log.TenantId == tenantId
                    && log.OrganizationId.HasValue
                    && ids.Contains(log.OrganizationId.Value)
                    && log.Status == "approved")
                .GroupBy(log => log.OrganizationId!.Value)
                .Select(group => new { Id = group.Key, Total = group.Sum(log => log.Hours) })
                .ToDictionaryAsync(row => row.Id, row => row.Total, ct);
        }
        var transactionTotals = await _db.VolunteerOrganisationTransactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(transaction => transaction.TenantId == tenantId
                && ids.Contains(transaction.VolunteerOrganisationId))
            .GroupBy(transaction => transaction.VolunteerOrganisationId)
            .Select(group => new
            {
                Id = group.Key,
                TotalIn = group.Sum(transaction => transaction.Amount > 0m ? transaction.Amount : 0m),
                TotalOut = group.Sum(transaction => transaction.Amount < 0m ? -transaction.Amount : 0m)
            })
            .ToDictionaryAsync(row => row.Id, ct);

        return organisations.Select(org =>
        {
            transactionTotals.TryGetValue(org.Id, out var totals);
            return new VolunteerOrganisationAdminView(
                org.Id,
                org.Name,
                org.Description,
                org.ContactEmail,
                org.Website,
                org.OrgType,
                org.MeetingSchedule,
                org.Status,
                org.CreatedAt,
                org.Balance,
                memberCounts.GetValueOrDefault(org.Id),
                opportunityCounts.GetValueOrDefault(org.Id),
                hours.GetValueOrDefault(org.Id),
                totals?.TotalIn ?? 0m,
                totals?.TotalOut ?? 0m);
        }).ToList();
    }

    public async Task<VolunteerOrganisationMutationResult> UpdateStatusAsync(
        int id,
        int tenantId,
        string? status,
        CancellationToken ct = default)
    {
        if (status is not ("active" or "suspended"))
        {
            return VolunteerOrganisationMutationResult.Failed(
                new("VALIDATION_ERROR", "Status must be active or suspended", "status"));
        }

        var isRelational = _db.Database.IsRelational();
        await using var ownedTransaction = isRelational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        if (isRelational)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({tenantId}, {-id})",
                ct);
        }

        var organisation = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(org => org.Id == id && org.TenantId == tenantId, ct);
        if (organisation is null)
        {
            return VolunteerOrganisationMutationResult.Failed(
                new("NOT_FOUND", "Organization not found", null));
        }

        try
        {
            organisation.Status = status;
            organisation.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            if (ownedTransaction is not null)
            {
                await ownedTransaction.CommitAsync(ct);
            }
            return VolunteerOrganisationMutationResult.Succeeded(
                MapView(organisation, opportunityCount: 0, volunteerCount: 0, totalHours: 0m));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Failed to update volunteer organisation {OrganisationId} status for tenant {TenantId}",
                id,
                tenantId);
            return VolunteerOrganisationMutationResult.Failed(
                new("SERVER_ERROR", "Failed to update organization status", null));
        }
    }

    public async Task<VolunteerOrganisationMutationResult> UpdateAsync(
        int id,
        int tenantId,
        VolunteerOrganisationUpdateCommand command,
        bool adminSurface,
        CancellationToken ct = default)
    {
        if (!command.HasAnyValue)
        {
            return VolunteerOrganisationMutationResult.Failed(
                new("VALIDATION_ERROR", "No fields to update", null));
        }

        var organisation = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(org => org.Id == id && org.TenantId == tenantId, ct);
        if (organisation is null)
        {
            return VolunteerOrganisationMutationResult.Failed(
                new("NOT_FOUND", "Organization not found", null));
        }

        if (command.HasName)
        {
            var name = command.Name?.Trim() ?? string.Empty;
            var length = UnicodeLength(name);
            if (length < 3 || length > 200)
            {
                return VolunteerOrganisationMutationResult.Failed(new(
                    "VALIDATION_ERROR",
                    length < 3
                        ? "Organisation name must be at least 3 characters"
                        : "Organisation name must be under 200 characters",
                    "name"));
            }

            var duplicate = await _db.VolunteerOrganisations
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(org => org.TenantId == tenantId
                    && org.Id != id
                    && org.Status != "declined"
                    && org.Name.ToLower() == name.ToLower(), ct);
            if (duplicate)
            {
                return VolunteerOrganisationMutationResult.Failed(
                    new("ALREADY_EXISTS", "An organisation with this name already exists", "name"));
            }

            organisation.Name = name;
        }

        if (command.HasDescription)
        {
            var description = command.Description?.Trim() ?? string.Empty;
            if (!adminSurface && description.Length == 0)
            {
                return VolunteerOrganisationMutationResult.Failed(
                    new("VALIDATION_ERROR", "Description is required", "description"));
            }
            if (UnicodeLength(description) > 5000)
            {
                return VolunteerOrganisationMutationResult.Failed(new(
                    "VALIDATION_ERROR",
                    "The description field must not be greater than 5000 characters.",
                    "description"));
            }
            organisation.Description = NullIfWhiteSpace(description);
        }

        if (command.HasContactEmail)
        {
            var email = command.ContactEmail?.Trim() ?? string.Empty;
            if ((!adminSurface && email.Length == 0)
                || (email.Length > 0
                    && (email.Length > 255 || !new EmailAddressAttribute().IsValid(email))))
            {
                return VolunteerOrganisationMutationResult.Failed(
                    new("VALIDATION_ERROR", "Please enter a valid email address", "contact_email"));
            }
            organisation.ContactEmail = NullIfWhiteSpace(email);
        }

        if (command.HasWebsite)
        {
            var website = command.Website?.Trim() ?? string.Empty;
            if (website.Length > 0
                && (website.Length > 500
                    || !Uri.TryCreate(website, UriKind.Absolute, out var uri)
                    || uri.Scheme is not ("http" or "https")))
            {
                return VolunteerOrganisationMutationResult.Failed(
                    new("VALIDATION_ERROR", "Please enter a valid URL", "website"));
            }
            organisation.Website = NullIfWhiteSpace(website);
        }

        if (adminSurface && command.HasOrgType)
        {
            var orgType = NullIfWhiteSpace(command.OrgType);
            if (orgType?.Length > 50)
            {
                return VolunteerOrganisationMutationResult.Failed(
                    new("VALIDATION_ERROR", "The org type field must not be greater than 50 characters.", "org_type"));
            }
            organisation.OrgType = orgType;
        }
        if (adminSurface && command.HasMeetingSchedule)
        {
            var meetingSchedule = NullIfWhiteSpace(command.MeetingSchedule);
            if (meetingSchedule?.Length > 255)
            {
                return VolunteerOrganisationMutationResult.Failed(new(
                    "VALIDATION_ERROR",
                    "The meeting schedule field must not be greater than 255 characters.",
                    "meeting_schedule"));
            }
            organisation.MeetingSchedule = meetingSchedule;
        }

        try
        {
            organisation.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return VolunteerOrganisationMutationResult.Succeeded(
                MapView(organisation, opportunityCount: 0, volunteerCount: 0, totalHours: 0m));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Failed to update volunteer organisation {OrganisationId} for tenant {TenantId}",
                id,
                tenantId);
            return VolunteerOrganisationMutationResult.Failed(
                new("SERVER_ERROR", "Failed to update volunteer organisation", null));
        }
    }

    /// <summary>
    /// Evaluates recurring-pattern access. Set includeCreator=false for the
    /// narrower organizer application-decision contract.
    /// </summary>
    public async Task<VolunteerOpportunityAccessResult> EvaluateOpportunityAccessAsync(
        int opportunityId,
        int userId,
        int tenantId,
        bool includeCreator,
        CancellationToken ct = default)
    {
        var opportunity = await _db.VolunteerOpportunities
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.Id == opportunityId && row.TenantId == tenantId)
            .Select(row => new { row.OrganizerId, row.VolunteerOrganisationId })
            .SingleOrDefaultAsync(ct);
        if (opportunity is null)
        {
            return new(false, false);
        }

        if (!await IsActiveTenantUserAsync(userId, tenantId, ct))
        {
            return new(true, false);
        }

        if (includeCreator && opportunity.OrganizerId == userId)
        {
            return new(true, true);
        }

        if (opportunity.VolunteerOrganisationId.HasValue
            && await IsOrganisationManagerAsync(
                opportunity.VolunteerOrganisationId.Value,
                userId,
                tenantId,
                ct))
        {
            return new(true, true);
        }

        return new(true, await IsSiteManagerAsync(userId, tenantId, ct));
    }

    public async Task<bool> IsOrganisationManagerAsync(
        int organisationId,
        int userId,
        int tenantId,
        CancellationToken ct = default)
    {
        if (!await IsActiveTenantUserAsync(userId, tenantId, ct))
        {
            return false;
        }

        var directOwner = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(org => org.Id == organisationId
                && org.TenantId == tenantId
                && org.OwnerUserId == userId, ct);
        if (directOwner)
        {
            return true;
        }

        return await _db.VolunteerOrganisationMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(member => member.TenantId == tenantId
                && member.VolunteerOrganisationId == organisationId
                && member.OrgType == "volunteer"
                && member.UserId == userId
                && member.Status == "active"
                && (member.Role == "owner" || member.Role == "admin"), ct);
    }

    public async Task<bool> CanManageOrganisationAsync(
        int organisationId,
        int userId,
        int tenantId,
        CancellationToken ct = default) =>
        await IsOrganisationManagerAsync(organisationId, userId, tenantId, ct)
        || await IsSiteManagerAsync(userId, tenantId, ct);

    public async Task<bool> CanManageDashboardAsync(
        int organisationId,
        int userId,
        int tenantId,
        CancellationToken ct = default)
    {
        var ownerUserId = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(org => org.Id == organisationId && org.TenantId == tenantId)
            .Select(org => (int?)org.OwnerUserId)
            .SingleOrDefaultAsync(ct);
        if (!ownerUserId.HasValue)
        {
            return false;
        }

        var actor = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == userId && user.TenantId == tenantId && user.IsActive)
            .Select(user => new
            {
                user.Role,
                user.IsSuperAdmin,
                user.IsTenantSuperAdmin,
                user.IsGod
            })
            .SingleOrDefaultAsync(ct);
        if (actor is null)
        {
            return false;
        }

        if (ownerUserId.Value == userId)
        {
            return true;
        }

        if (await _db.VolunteerOrganisationMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(member => member.TenantId == tenantId
                && member.VolunteerOrganisationId == organisationId
                && member.OrgType == "volunteer"
                && member.UserId == userId
                && member.Status == "active"
                && (member.Role == "owner" || member.Role == "admin"), ct))
        {
            return true;
        }

        return actor.IsSuperAdmin
            || actor.IsTenantSuperAdmin
            || actor.IsGod
            || actor.Role is "admin" or "tenant_admin" or "tenant_super_admin" or "super_admin" or "god";
    }

    public async Task<VolunteerOrganisationHoursSummary> GetHoursSummaryAsync(
        int tenantId,
        int organisationId,
        CancellationToken ct = default)
    {
        if (!await TableExistsAsync("vol_logs", ct))
        {
            return new(0, 0m);
        }

        var summary = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId
                && log.OrganizationId == organisationId)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                PendingCount = group.Count(log => log.Status == "pending"),
                ApprovedTotal = group.Sum(log => log.Status == "approved" ? log.Hours : 0m)
            })
            .SingleOrDefaultAsync(ct);

        return summary is null
            ? new(0, 0m)
            : new(summary.PendingCount, summary.ApprovedTotal);
    }

    public async Task<IReadOnlyDictionary<int, decimal>> GetApprovedHoursByUserAsync(
        int tenantId,
        int organisationId,
        IReadOnlyCollection<int> userIds,
        CancellationToken ct = default)
    {
        if (userIds.Count == 0 || !await TableExistsAsync("vol_logs", ct))
        {
            return new Dictionary<int, decimal>();
        }

        return await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId
                && log.OrganizationId == organisationId
                && userIds.Contains(log.UserId)
                && log.Status == "approved")
            .GroupBy(log => log.UserId)
            .Select(group => new { UserId = group.Key, Total = group.Sum(log => log.Hours) })
            .ToDictionaryAsync(row => row.UserId, row => row.Total, ct);
    }

    private async Task<VolunteerOrganisationReviewSummary> GetReviewSummaryAsync(
        int tenantId,
        int organisationId,
        CancellationToken ct)
    {
        if (!await TableExistsAsync("vol_reviews", ct))
        {
            return new(0, 0m);
        }

        var row = await _db.Database.SqlQueryRaw<VolunteerOrganisationReviewSummaryRow>(
                """
                SELECT COUNT(*)::int AS "ReviewCount",
                       COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::numeric AS "AverageRating"
                FROM vol_reviews
                WHERE tenant_id = {0}
                  AND target_type = 'organization'
                  AND target_id = {1}
                """,
                tenantId,
                organisationId)
            .SingleAsync(ct);
        return new(row.ReviewCount, row.AverageRating);
    }

    private Task<bool> TableExistsAsync(string tableName, CancellationToken ct) =>
        _db.Database
            .SqlQueryRaw<bool>(
                "SELECT to_regclass({0}) IS NOT NULL AS \"Value\"",
                $"public.{tableName}")
            .SingleAsync(ct);

    private async Task<bool> IsSiteManagerAsync(
        int userId,
        int tenantId,
        CancellationToken ct)
    {
        var role = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == userId && user.TenantId == tenantId && user.IsActive)
            .Select(user => user.Role)
            .SingleOrDefaultAsync(ct);
        return role is not null && SiteManagerRoles.Contains(role);
    }

    private Task<bool> IsActiveTenantUserAsync(
        int userId,
        int tenantId,
        CancellationToken ct) =>
        _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user => user.Id == userId
                && user.TenantId == tenantId
                && user.IsActive, ct);

    private async Task<string> GenerateUniqueSlugAsync(
        string name,
        int tenantId,
        CancellationToken ct)
    {
        var root = Slugify(name);
        var candidate = root;
        var suffix = 1;
        while (await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AnyAsync(org => org.TenantId == tenantId && org.Slug == candidate, ct))
        {
            candidate = $"{root}-{suffix++}";
        }

        return candidate;
    }

    private static VolunteerOrganisationValidationError? ValidateCreate(
        VolunteerOrganisationCreateCommand command)
    {
        var name = command.Name?.Trim() ?? string.Empty;
        var nameLength = UnicodeLength(name);
        if (nameLength == 0)
            return new("VALIDATION_ERROR", "Organisation name is required", "name");
        if (nameLength < 3)
            return new("VALIDATION_ERROR", "Organisation name must be at least 3 characters", "name");
        if (nameLength > 200)
            return new("VALIDATION_ERROR", "Organisation name must be under 200 characters", "name");

        var description = command.Description?.Trim() ?? string.Empty;
        var descriptionLength = UnicodeLength(description);
        if (descriptionLength == 0)
            return new("VALIDATION_ERROR", "Description is required", "description");
        if (descriptionLength < 20)
            return new("VALIDATION_ERROR", "Description must be at least 20 characters", "description");
        if (descriptionLength > 5000)
            return new("VALIDATION_ERROR", "The description field must not be greater than 5000 characters.", "description");

        var email = command.ContactEmail?.Trim() ?? string.Empty;
        if (email.Length == 0)
            return new("VALIDATION_ERROR", "Contact email is required", "contact_email");
        if (email.Length > 255 || !new EmailAddressAttribute().IsValid(email))
            return new("VALIDATION_ERROR", "Please enter a valid email address", "contact_email");

        var website = command.Website?.Trim();
        if (!string.IsNullOrEmpty(website)
            && (website.Length > 500
                || !Uri.TryCreate(website, UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https")))
        {
            return new("VALIDATION_ERROR", "Please enter a valid URL", "website");
        }

        return null;
    }

    private static VolunteerOrganisationView MapView(
        VolunteerOrganisation org,
        int opportunityCount,
        int volunteerCount,
        decimal totalHours,
        int reviewCount = 0,
        decimal averageRating = 0m) => new(
            org.Id,
            org.Name,
            org.Description,
            org.LogoUrl,
            org.Website,
            org.ContactEmail,
            org.Location,
            org.CreatedAt,
            org.Status,
            opportunityCount,
            totalHours,
            volunteerCount,
            reviewCount,
            averageRating);

    private static string? NullIfWhiteSpace(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Slugify(string value)
    {
        var slug = NonSlugCharacters().Replace(
            value.ToLowerInvariant(),
            "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "organisation" : slug;
    }

    private static int UnicodeLength(string value) => value.EnumerateRunes().Count();

    [GeneratedRegex("[^a-z0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonSlugCharacters();
}

public sealed record VolunteerOrganisationCreateCommand(
    string? Name,
    string? Description,
    string? ContactEmail,
    string? Website,
    string? OrgType = null,
    string? MeetingSchedule = null);

public sealed record VolunteerOrganisationUpdateCommand(
    bool HasName,
    string? Name,
    bool HasDescription,
    string? Description,
    bool HasContactEmail,
    string? ContactEmail,
    bool HasWebsite,
    string? Website,
    bool HasOrgType = false,
    string? OrgType = null,
    bool HasMeetingSchedule = false,
    string? MeetingSchedule = null)
{
    public bool HasAnyValue => HasName
        || HasDescription
        || HasContactEmail
        || HasWebsite
        || HasOrgType
        || HasMeetingSchedule;
}

public sealed record VolunteerOrganisationValidationError(
    string Code,
    string Message,
    string? Field);

public sealed record VolunteerOrganisationMutationResult(
    VolunteerOrganisationView? Data,
    VolunteerOrganisationValidationError? Error)
{
    public bool Success => Data is not null && Error is null;

    public static VolunteerOrganisationMutationResult Succeeded(VolunteerOrganisationView? data) =>
        data is null
            ? Failed(new("SERVER_ERROR", "Failed to load volunteer organisation", null))
            : new(data, null);

    public static VolunteerOrganisationMutationResult Failed(VolunteerOrganisationValidationError error) =>
        new(null, error);
}

public sealed record VolunteerOpportunityAccessResult(bool Exists, bool Allowed);

public sealed record VolunteerOrganisationHoursSummary(int PendingCount, decimal ApprovedTotal);

public sealed record VolunteerOrganisationReviewSummary(int ReviewCount, decimal AverageRating);

internal sealed class VolunteerOrganisationReviewSummaryRow
{
    public int ReviewCount { get; set; }
    public decimal AverageRating { get; set; }
}

public sealed record VolunteerOrganisationView(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("logo_url")] string? LogoUrl,
    [property: JsonPropertyName("website")] string? Website,
    [property: JsonPropertyName("contact_email")] string? ContactEmail,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("opportunity_count")] int OpportunityCount,
    [property: JsonPropertyName("total_hours")] decimal TotalHours,
    [property: JsonPropertyName("volunteer_count")] int VolunteerCount,
    [property: JsonPropertyName("review_count")] int ReviewCount,
    [property: JsonPropertyName("average_rating")] decimal AverageRating)
{
    [JsonPropertyName("opportunities_count")]
    public int OpportunitiesCount => OpportunityCount;

    [JsonPropertyName("total_volunteers")]
    public int TotalVolunteers => VolunteerCount;

    [JsonPropertyName("stats")]
    public object Stats => new
    {
        opportunity_count = OpportunityCount,
        volunteer_count = VolunteerCount,
        total_hours_logged = TotalHours,
        total_hours = TotalHours,
        review_count = ReviewCount,
        average_rating = AverageRating
    };
}

public sealed record VolunteerOrganisationAdminView(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("contact_email")] string? ContactEmail,
    [property: JsonPropertyName("website")] string? Website,
    [property: JsonPropertyName("org_type")] string? OrgType,
    [property: JsonPropertyName("meeting_schedule")] string? MeetingSchedule,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("balance")] decimal Balance,
    [property: JsonPropertyName("member_count")] int MemberCount,
    [property: JsonPropertyName("opportunity_count")] int OpportunityCount,
    [property: JsonPropertyName("total_hours")] decimal TotalHours,
    [property: JsonPropertyName("total_in")] decimal TotalIn,
    [property: JsonPropertyName("total_out")] decimal TotalOut)
{
    [JsonPropertyName("org_id")]
    public int OrganizationId => Id;

    [JsonPropertyName("org_name")]
    public string OrganizationName => Name;

    // Retained as a harmless compatibility extra used by the current React
    // admin table; Laravel's canonical SQL exposes member_count.
    [JsonPropertyName("volunteer_count")]
    public int VolunteerCount => MemberCount;
}
