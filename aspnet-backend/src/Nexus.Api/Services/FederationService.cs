// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing federation between tenants.
/// Handles partnerships, listing sync, and cross-tenant exchanges.
/// </summary>
public class FederationService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<FederationService> _logger;

    public FederationService(NexusDbContext db, TenantContext tenantContext, ILogger<FederationService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Request a new federation partnership with another tenant.
    /// Creates a Pending partnership that the partner must approve.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> RequestPartnershipAsync(
        int localTenantId, int partnerTenantId, int adminId,
        bool sharedListings = true,
        bool sharedEvents = false,
        bool sharedMembers = false,
        bool transactionsEnabled = false)
    {
        if (localTenantId == partnerTenantId)
            return (null, "Cannot create a partnership with your own tenant");

        // Verify partner tenant exists
        var partnerTenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == partnerTenantId && t.IsActive);

        if (partnerTenant == null)
            return (null, "Partner tenant not found or not active");

        // Check for existing partnership (in either direction)
        var existing = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .AnyAsync(fp =>
                (fp.TenantId == localTenantId && fp.PartnerTenantId == partnerTenantId) ||
                (fp.TenantId == partnerTenantId && fp.PartnerTenantId == localTenantId));

        if (existing)
            return (null, "A partnership already exists between these tenants");

        var partner = new FederationPartner
        {
            TenantId = localTenantId,
            PartnerTenantId = partnerTenantId,
            Status = PartnerStatus.Pending,
            SharedListings = sharedListings,
            SharedEvents = sharedEvents,
            SharedMembers = sharedMembers,
            TransactionsEnabled = transactionsEnabled,
            RequestedById = adminId,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FederationPartner>().Add(partner);

        // Create audit log entry
        var auditLog = new FederationAuditLog
        {
            TenantId = localTenantId,
            PartnerTenantId = partnerTenantId,
            Action = "partner.requested",
            EntityType = "FederationPartner",
            Details = JsonSerializer.Serialize(new
            {
                shared_listings = sharedListings,
                shared_events = sharedEvents,
                shared_members = sharedMembers,
                requested_by = adminId
            }),
            CreatedAt = DateTime.UtcNow
        };
        _db.Set<FederationAuditLog>().Add(auditLog);

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Federation partnership requested: Tenant {LocalTenantId} -> Tenant {PartnerTenantId} by admin {AdminId}",
            localTenantId, partnerTenantId, adminId);

        // Reload with navigation properties
        partner.PartnerTenant = partnerTenant;

        return (partner, null);
    }

    /// <summary>
    /// Approve a pending federation partnership.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> ApprovePartnershipAsync(int partnerId, int adminId)
    {
        if (!_tenantContext.IsResolved)
            return (null, "Tenant context not resolved");

        var result = await ApprovePartnershipForTenantAsync(
            partnerId,
            _tenantContext.GetTenantIdOrThrow(),
            adminId);

        return (result.Partner, result.Error);
    }

    /// <summary>
    /// Approve an incoming request on behalf of the explicit receiving tenant.
    /// The pending-state transition and its audit row are committed atomically.
    /// </summary>
    public Task<FederationPartnershipDecisionResult> ApprovePartnershipForTenantAsync(
        int partnerId,
        int receivingTenantId,
        int adminId,
        CancellationToken cancellationToken = default)
        => DecidePartnershipAsync(
            partnerId,
            receivingTenantId,
            adminId,
            approve: true,
            reason: null,
            cancellationToken);

    /// <summary>
    /// Reject an incoming request on behalf of the explicit receiving tenant.
    /// </summary>
    public Task<FederationPartnershipDecisionResult> RejectPartnershipForTenantAsync(
        int partnerId,
        int receivingTenantId,
        int adminId,
        string? reason,
        CancellationToken cancellationToken = default)
        => DecidePartnershipAsync(
            partnerId,
            receivingTenantId,
            adminId,
            approve: false,
            NormalizeRejectionReason(reason),
            cancellationToken);

    private async Task<FederationPartnershipDecisionResult> DecidePartnershipAsync(
        int partnerId,
        int receivingTenantId,
        int adminId,
        bool approve,
        string? reason,
        CancellationToken cancellationToken)
    {
        var partner = await _db.FederationPartners
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(fp => fp.Id == partnerId, cancellationToken);

        if (partner == null)
            return FederationPartnershipDecisionResult.NotFoundResult();

        var actionVerb = approve ? "approved" : "rejected";
        var actionInfinitive = approve ? "approve" : "reject";
        if (partner.PartnerTenantId != receivingTenantId)
        {
            return FederationPartnershipDecisionResult.ConflictResult(
                $"Only the receiving tenant can {actionInfinitive} a partnership request");
        }

        if (partner.Status != PartnerStatus.Pending)
            return FederationPartnershipDecisionResult.ConflictResult("Partnership is not pending approval");

        var changedAt = DateTime.UtcNow;
        var targetStatus = approve ? PartnerStatus.Active : PartnerStatus.Rejected;

        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

            var affected = approve
                ? await _db.FederationPartners
                    .IgnoreQueryFilters()
                    .Where(fp => fp.Id == partnerId
                        && fp.PartnerTenantId == receivingTenantId
                        && fp.Status == PartnerStatus.Pending)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(fp => fp.Status, PartnerStatus.Active)
                        .SetProperty(fp => fp.ApprovedById, adminId)
                        .SetProperty(fp => fp.ApprovedAt, changedAt)
                        .SetProperty(fp => fp.UpdatedAt, changedAt), cancellationToken)
                : await _db.FederationPartners
                    .IgnoreQueryFilters()
                    .Where(fp => fp.Id == partnerId
                        && fp.PartnerTenantId == receivingTenantId
                        && fp.Status == PartnerStatus.Pending)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(fp => fp.Status, PartnerStatus.Rejected)
                        .SetProperty(fp => fp.UpdatedAt, changedAt), cancellationToken);

            if (affected != 1)
                return FederationPartnershipDecisionResult.ConflictResult("Partnership is no longer pending approval");

            _db.FederationAuditLogs.Add(new FederationAuditLog
            {
                // Canonical audit direction is the receiver acting on the requester.
                TenantId = receivingTenantId,
                PartnerTenantId = partner.TenantId,
                Action = approve ? "partnership_approved" : "partnership_rejected",
                EntityType = "FederationPartner",
                EntityId = partner.Id,
                Details = approve
                    ? JsonSerializer.Serialize(new { approved_by = adminId })
                    : JsonSerializer.Serialize(new { rejected_by = adminId, reason }),
                CreatedAt = changedAt
            });

            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Failed to {Action} federation partnership {PartnerId} for receiving tenant {TenantId}",
                actionVerb,
                partnerId,
                receivingTenantId);
            return FederationPartnershipDecisionResult.ConflictResult($"Failed to {actionInfinitive} partnership");
        }

        partner.Status = targetStatus;
        partner.UpdatedAt = changedAt;
        if (approve)
        {
            partner.ApprovedById = adminId;
            partner.ApprovedAt = changedAt;
        }

        await NotifyInitiatingTenantAdminsBestEffortAsync(
            partner,
            receivingTenantId,
            approve,
            reason,
            CancellationToken.None);

        _logger.LogInformation(
            "Federation partnership {Action}: Partner {PartnerId}, receiver {ReceivingTenantId}, requester {RequestingTenantId}, admin {AdminId}",
            actionVerb,
            partnerId,
            receivingTenantId,
            partner.TenantId,
            adminId);

        return FederationPartnershipDecisionResult.SuccessResult(partner);
    }

    private async Task NotifyInitiatingTenantAdminsBestEffortAsync(
        FederationPartner partner,
        int receivingTenantId,
        bool approved,
        string? reason,
        CancellationToken cancellationToken)
    {
        try
        {
            var candidates = await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(user => user.TenantId == partner.TenantId && user.IsActive)
                .ToListAsync(cancellationToken);
            var adminIds = candidates
                .Where(NexusUserAccessEvaluator.HasAdminAccess)
                .Select(user => user.Id)
                .ToList();

            if (adminIds.Count == 0)
                return;

            var receivingTenantName = await _db.Tenants
                .AsNoTracking()
                .Where(tenant => tenant.Id == receivingTenantId)
                .Select(tenant => tenant.Name)
                .FirstOrDefaultAsync(cancellationToken) ?? "A partner community";
            var notificationType = approved
                ? "federation_partnership_approved"
                : "federation_partnership_rejected";
            var notificationTitle = approved
                ? "Federation partnership approved"
                : "Federation partnership rejected";
            var notificationBody = approved
                ? $"{receivingTenantName} has approved your federation partnership request."
                : $"{receivingTenantName} has rejected your federation partnership request.";
            var notificationData = JsonSerializer.Serialize(new
            {
                partnership_id = partner.Id,
                acting_tenant_id = receivingTenantId,
                reason
            });
            var createdAt = DateTime.UtcNow;

            _db.Notifications.AddRange(adminIds.Select(userId => new Notification
            {
                TenantId = partner.TenantId,
                UserId = userId,
                Type = notificationType,
                Title = notificationTitle,
                Body = notificationBody,
                Data = notificationData,
                IsRead = false,
                CreatedAt = createdAt
            }));
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // The state transition and audit are already committed. Notification
            // delivery must not turn that durable success into a false failure.
            _logger.LogWarning(
                ex,
                "Federation partnership {PartnerId} committed but initiating-tenant admin notification failed",
                partner.Id);
        }
    }

    private static string? NormalizeRejectionReason(string? reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
            return null;

        var trimmed = reason.Trim();
        return trimmed.Length <= 1000 ? trimmed : trimmed[..1000];
    }

    /// <summary>
    /// Suspend an active federation partnership.
    /// </summary>
    public async Task<(FederationPartner? Partner, string? Error)> SuspendPartnershipAsync(int partnerId, int adminId, string? reason)
    {
        var tenantId = _tenantContext.TenantId;
        var partner = await _db.Set<FederationPartner>()
            .Include(fp => fp.PartnerTenant)
            .FirstOrDefaultAsync(fp => fp.Id == partnerId && (tenantId == null || fp.TenantId == tenantId || fp.PartnerTenantId == tenantId));

        if (partner == null)
            return (null, "Partnership not found");

        if (partner.Status != PartnerStatus.Active)
            return (null, $"Partnership cannot be suspended from status '{partner.Status}'");

        partner.Status = PartnerStatus.Suspended;
        partner.UpdatedAt = DateTime.UtcNow;

        // Mark all federated listings from this partner as withdrawn (in both directions)
        var federatedListings = await _db.Set<FederatedListing>()
            .Where(fl =>
                (fl.SourceTenantId == partner.PartnerTenantId || fl.SourceTenantId == partner.TenantId) &&
                fl.Status == FederatedListingStatus.Active)
            .ToListAsync();

        foreach (var fl in federatedListings)
        {
            fl.Status = FederatedListingStatus.Withdrawn;
        }

        // Create audit log
        _db.Set<FederationAuditLog>().Add(new FederationAuditLog
        {
            TenantId = partner.TenantId,
            PartnerTenantId = partner.PartnerTenantId,
            Action = "partner.suspended",
            EntityType = "FederationPartner",
            EntityId = partner.Id,
            Details = JsonSerializer.Serialize(new { suspended_by = adminId, reason }),
            CreatedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Federation partnership suspended: Partner {PartnerId} by admin {AdminId}. Reason: {Reason}",
            partnerId, adminId, reason ?? "none");

        return (partner, null);
    }

    /// <summary>
    /// List all federation partnerships for a tenant.
    /// </summary>
    public async Task<List<FederationPartner>> GetPartnersAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        return await _db.Set<FederationPartner>()
            .Where(fp => fp.TenantId == tenantId)
            .Include(fp => fp.PartnerTenant)
            .Include(fp => fp.RequestedBy)
            .Include(fp => fp.ApprovedBy)
            .OrderByDescending(fp => fp.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// List incoming and outgoing partnerships for the Laravel-compatible admin view.
    /// This is deliberately separate from the legacy outgoing-only list contract.
    /// </summary>
    public async Task<List<FederationPartner>> GetAllPartnershipsForTenantAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        return await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .Where(fp => fp.TenantId == tenantId || fp.PartnerTenantId == tenantId)
            .Include(fp => fp.Tenant)
            .Include(fp => fp.PartnerTenant)
            .Include(fp => fp.RequestedBy)
            .Include(fp => fp.ApprovedBy)
            .OrderByDescending(fp => fp.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Sync active listings from the local tenant to a partner tenant.
    /// Creates or updates FederatedListing entries in the partner's scope.
    /// </summary>
    public async Task<(int SyncedCount, string? Error)> SyncListingsToPartnerAsync(int partnerId)
    {
        var tenantId = _tenantContext.TenantId;
        var partner = await _db.Set<FederationPartner>()
            .FirstOrDefaultAsync(fp => fp.Id == partnerId && (tenantId == null || fp.TenantId == tenantId));

        if (partner == null)
            return (0, "Partnership not found");

        if (partner.Status != PartnerStatus.Active)
            return (0, "Partnership is not active");

        if (!partner.SharedListings)
            return (0, "Listing sharing is not enabled for this partnership");

        // Get active listings from the local tenant
        var localListings = await _db.Listings
            .Where(l => l.Status == ListingStatus.Active)
            .Include(l => l.User)
            .AsNoTracking()
            .ToListAsync();

        // Get existing federated listings for this partner relationship
        var existingFederated = await _db.Set<FederatedListing>()
            .IgnoreQueryFilters()
            .Where(fl => fl.TenantId == partner.PartnerTenantId && fl.SourceTenantId == partner.TenantId)
            .ToListAsync();

        var existingBySourceId = existingFederated.ToDictionary(fl => fl.SourceListingId);
        var syncedCount = 0;

        foreach (var listing in localListings)
        {
            if (existingBySourceId.TryGetValue(listing.Id, out var existing))
            {
                // Update existing
                existing.Title = listing.Title;
                existing.Description = listing.Description;
                existing.ListingType = listing.Type.ToString().ToLowerInvariant();
                existing.OwnerDisplayName = listing.User != null
                    ? (listing.User.FirstName ?? "Unknown")
                    : "Unknown";
                existing.Status = FederatedListingStatus.Active;
                existing.SyncedAt = DateTime.UtcNow;
            }
            else
            {
                // Create new federated listing
                _db.Set<FederatedListing>().Add(new FederatedListing
                {
                    TenantId = partner.PartnerTenantId,
                    SourceTenantId = partner.TenantId,
                    SourceListingId = listing.Id,
                    Title = listing.Title,
                    Description = listing.Description,
                    ListingType = listing.Type.ToString().ToLowerInvariant(),
                    OwnerDisplayName = listing.User != null
                        ? $"{listing.User.FirstName} {listing.User.LastName}"
                        : "Unknown",
                    Status = FederatedListingStatus.Active,
                    SyncedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                });
            }
            syncedCount++;
        }

        // Mark listings that no longer exist in the source as expired
        var activeSourceIds = localListings.Select(l => l.Id).ToHashSet();
        foreach (var existing in existingFederated)
        {
            if (!activeSourceIds.Contains(existing.SourceListingId) && existing.Status == FederatedListingStatus.Active)
            {
                existing.Status = FederatedListingStatus.Expired;
            }
        }

        // Create audit log
        _db.Set<FederationAuditLog>().Add(new FederationAuditLog
        {
            TenantId = partner.TenantId,
            PartnerTenantId = partner.PartnerTenantId,
            Action = "listing.synced",
            EntityType = "FederationPartner",
            EntityId = partner.Id,
            Details = JsonSerializer.Serialize(new { synced_count = syncedCount }),
            CreatedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Synced {Count} listings from Tenant {SourceTenantId} to Tenant {TargetTenantId}",
            syncedCount, partner.TenantId, partner.PartnerTenantId);

        return (syncedCount, null);
    }

    /// <summary>
    /// Get federated listings visible to the current tenant.
    /// </summary>
    public async Task<(List<FederatedListing> Listings, int Total)> GetFederatedListingsAsync(
        int tenantId, int page, int limit)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<FederatedListing>()
            .Where(fl => fl.TenantId == tenantId && fl.Status == FederatedListingStatus.Active)
            .Include(fl => fl.SourceTenant)
            .OrderByDescending(fl => fl.SyncedAt)
            .AsNoTracking();

        var total = await query.CountAsync();
        var listings = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (listings, total);
    }

    /// <summary>
    /// Initiate a federated exchange based on a federated listing.
    /// </summary>
    public async Task<(FederatedExchange? Exchange, string? Error)> InitiateFederatedExchangeAsync(
        int localUserId, int federatedListingId, decimal agreedHours)
    {
        if (agreedHours <= 0)
            return (null, "Agreed hours must be greater than zero");

        var federatedListing = await _db.Set<FederatedListing>()
            .FirstOrDefaultAsync(fl => fl.Id == federatedListingId && fl.Status == FederatedListingStatus.Active);

        if (federatedListing == null)
            return (null, "Federated listing not found or not active");

        // Verify the user belongs to the tenant that can see this listing
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == localUserId);
        if (user == null)
            return (null, "User not found");

        if (user.TenantId != federatedListing.TenantId)
            return (null, "This listing is not available in your tenant");

        // Check that the partnership is still active
        var partnership = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(fp =>
                fp.Status == PartnerStatus.Active &&
                ((fp.TenantId == federatedListing.TenantId && fp.PartnerTenantId == federatedListing.SourceTenantId) ||
                 (fp.TenantId == federatedListing.SourceTenantId && fp.PartnerTenantId == federatedListing.TenantId)));

        if (partnership == null)
            return (null, "Federation partnership is not active");

        // Check for existing active exchange on this listing by this user
        var existingExchange = await _db.Set<FederatedExchange>()
            .AnyAsync(fe => fe.LocalUserId == localUserId
                && fe.SourceListingId == federatedListing.SourceListingId
                && fe.PartnerTenantId == federatedListing.SourceTenantId
                && fe.Status != ExchangeStatus.Declined
                && fe.Status != ExchangeStatus.Cancelled
                && fe.Status != ExchangeStatus.Completed
                && fe.Status != ExchangeStatus.Expired
                && fe.Status != ExchangeStatus.Resolved);

        if (existingExchange)
            return (null, "You already have an active exchange on this listing");

        var exchange = new FederatedExchange
        {
            TenantId = user.TenantId,
            PartnerTenantId = federatedListing.SourceTenantId,
            LocalUserId = localUserId,
            RemoteUserDisplayName = federatedListing.OwnerDisplayName,
            SourceListingId = federatedListing.SourceListingId,
            Status = ExchangeStatus.Requested,
            AgreedHours = agreedHours,
            CreditExchangeRate = partnership.CreditExchangeRate,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FederatedExchange>().Add(exchange);

        // Create audit log
        _db.Set<FederationAuditLog>().Add(new FederationAuditLog
        {
            TenantId = user.TenantId,
            PartnerTenantId = federatedListing.SourceTenantId,
            Action = "exchange.initiated",
            EntityType = "FederatedExchange",
            Details = JsonSerializer.Serialize(new
            {
                local_user_id = localUserId,
                source_listing_id = federatedListing.SourceListingId,
                agreed_hours = agreedHours
            }),
            CreatedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Federated exchange initiated: User {UserId} on listing {ListingId} from Tenant {SourceTenantId} ({Hours}h)",
            localUserId, federatedListing.SourceListingId, federatedListing.SourceTenantId, agreedHours);

        return (exchange, null);
    }

    /// <summary>
    /// Fail closed until a federated exchange has durable, authenticated remote
    /// settlement evidence. The member route must never mint external credits
    /// from caller-supplied hours or a locally mutable social status.
    /// </summary>
    public async Task<(FederatedExchange? Exchange, string? Error)> CompleteFederatedExchangeAsync(
        int exchangeId, int userId, decimal? actualHours)
    {
        var exchange = await _db.Set<FederatedExchange>()
            .Include(fe => fe.LocalUser)
            .FirstOrDefaultAsync(fe => fe.Id == exchangeId);

        if (exchange == null)
            return (null, "Exchange not found");

        if (exchange.LocalUserId != userId)
            return (null, "You are not a participant in this exchange");

        _logger.LogWarning(
            "Blocked member completion for federated exchange {ExchangeId}: authenticated remote settlement evidence is unavailable",
            exchangeId);
        return (null,
            "Federated exchange completion is unavailable until authenticated remote settlement evidence has been recorded.");
    }

    /// <summary>
    /// Get federated exchanges for a user.
    /// </summary>
    public async Task<(List<FederatedExchange> Exchanges, int Total)> GetFederatedExchangesAsync(
        int userId, int page, int limit)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<FederatedExchange>()
            .Where(fe => fe.LocalUserId == userId)
            .Include(fe => fe.PartnerTenant)
            .OrderByDescending(fe => fe.CreatedAt)
            .AsNoTracking();

        var total = await query.CountAsync();
        var exchanges = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (exchanges, total);
    }

    /// <summary>
    /// Get federation statistics for a tenant.
    /// </summary>
    public async Task<FederationStats> GetFederationStatsAsync(int tenantId)
    {
        var partnerCounts = await _db.Set<FederationPartner>()
            .Where(fp => fp.TenantId == tenantId)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Active = g.Count(fp => fp.Status == PartnerStatus.Active),
                Pending = g.Count(fp => fp.Status == PartnerStatus.Pending),
                Suspended = g.Count(fp => fp.Status == PartnerStatus.Suspended)
            })
            .FirstOrDefaultAsync() ?? new { Total = 0, Active = 0, Pending = 0, Suspended = 0 };

        var sharedListingsCount = await _db.Set<FederatedListing>()
            .Where(fl => fl.TenantId == tenantId && fl.Status == FederatedListingStatus.Active)
            .CountAsync();

        var exchangeCounts = await _db.Set<FederatedExchange>()
            .Where(fe => fe.TenantId == tenantId)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Completed = g.Count(fe => fe.Status == ExchangeStatus.Completed),
                Active = g.Count(fe => fe.Status != ExchangeStatus.Completed
                    && fe.Status != ExchangeStatus.Cancelled
                    && fe.Status != ExchangeStatus.Declined
                    && fe.Status != ExchangeStatus.Expired
                    && fe.Status != ExchangeStatus.Resolved)
            })
            .FirstOrDefaultAsync() ?? new { Total = 0, Completed = 0, Active = 0 };

        var totalHoursExchanged = await _db.Set<FederatedExchange>()
            .Where(fe => fe.TenantId == tenantId && fe.Status == ExchangeStatus.Completed && fe.ActualHours.HasValue)
            .SumAsync(fe => fe.ActualHours ?? 0);

        return new FederationStats
        {
            TotalPartners = partnerCounts.Total,
            ActivePartners = partnerCounts.Active,
            PendingPartners = partnerCounts.Pending,
            SuspendedPartners = partnerCounts.Suspended,
            SharedListingsReceived = sharedListingsCount,
            TotalExchanges = exchangeCounts.Total,
            CompletedExchanges = exchangeCounts.Completed,
            ActiveExchanges = exchangeCounts.Active,
            TotalHoursExchanged = totalHoursExchanged
        };
    }
}

/// <summary>
/// Federation statistics for a tenant.
/// </summary>
public class FederationStats
{
    public int TotalPartners { get; set; }
    public int ActivePartners { get; set; }
    public int PendingPartners { get; set; }
    public int SuspendedPartners { get; set; }
    public int SharedListingsReceived { get; set; }
    public int TotalExchanges { get; set; }
    public int CompletedExchanges { get; set; }
    public int ActiveExchanges { get; set; }
    public decimal TotalHoursExchanged { get; set; }
}

/// <summary>
/// Outcome of a canonical incoming partnership approval or rejection.
/// </summary>
public sealed record FederationPartnershipDecisionResult(
    bool Succeeded,
    bool NotFound,
    FederationPartner? Partner,
    string? Error)
{
    public static FederationPartnershipDecisionResult SuccessResult(FederationPartner partner)
        => new(true, false, partner, null);

    public static FederationPartnershipDecisionResult NotFoundResult()
        => new(false, true, null, "Partnership not found");

    public static FederationPartnershipDecisionResult ConflictResult(string error)
        => new(false, false, null, error);
}
