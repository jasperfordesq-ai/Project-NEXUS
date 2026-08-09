// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Member-owned Caring Community data export for GDPR/FADP portability parity.
/// </summary>
public sealed class CaringCommunityDataExportService
{
    private readonly NexusDbContext _db;

    public CaringCommunityDataExportService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<object> BuildAsync(int tenantId, int userId, CancellationToken ct)
    {
        var data = new Dictionary<string, object?>
        {
            ["profile"] = await ProfileAsync(tenantId, userId, ct),
            ["vol_logs"] = await VolunteerLogsAsync(tenantId, userId, ct),
            ["caring_support_relationships"] = await SupportRelationshipsAsync(tenantId, userId, ct),
            ["caring_help_requests"] = await HelpRequestsAsync(tenantId, userId, ct),
            ["caring_favours"] = await FavoursAsync(tenantId, userId, ct),
            ["caring_hour_gifts"] = await HourGiftsAsync(tenantId, userId, ct),
            ["caring_hour_transfers"] = await HourTransfersAsync(tenantId, userId, ct),
            ["caring_loyalty_redemptions"] = await LoyaltyRedemptionsAsync(tenantId, userId, ct),
            ["caring_regional_point_transactions"] = await RegionalPointTransactionsAsync(tenantId, userId, ct),
            ["caring_regional_point_account"] = await RegionalPointAccountAsync(tenantId, userId, ct),
            ["safeguarding_reports"] = await SafeguardingReportsAsync(tenantId, userId, ct),
            ["civic_digest_preferences"] = await CivicDigestPrefsAsync(tenantId, userId, ct)
        };

        return new Dictionary<string, object?>
        {
            ["exported_at"] = DateTimeOffset.UtcNow.ToString("O"),
            ["tenant_id"] = tenantId,
            ["user_id"] = userId,
            ["data"] = data
        };
    }

    private async Task<object?> ProfileAsync(int tenantId, int userId, CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.Id == userId)
            .FirstOrDefaultAsync(ct);

        if (user is null)
        {
            return null;
        }

        return new Dictionary<string, object?>
        {
            ["id"] = user.Id,
            ["tenant_id"] = user.TenantId,
            ["first_name"] = user.FirstName,
            ["last_name"] = user.LastName,
            ["email"] = user.Email,
            ["bio"] = user.Bio,
            ["avatar_url"] = user.AvatarUrl,
            ["trust_tier"] = user.TrustTier,
            ["created_at"] = user.CreatedAt,
            ["updated_at"] = user.UpdatedAt
        };
    }

    private async Task<IReadOnlyList<object>> VolunteerLogsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.UserId == userId)
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["user_id"] = row.UserId,
            ["organization_id"] = row.OrganizationId,
            ["opportunity_id"] = row.OpportunityId,
            ["caring_support_relationship_id"] = row.CaringSupportRelationshipId,
            ["support_recipient_id"] = row.SupportRecipientId,
            ["date_logged"] = row.DateLogged,
            ["hours"] = row.Hours,
            ["description"] = row.Description,
            ["status"] = row.Status,
            ["assigned_to"] = row.AssignedTo,
            ["assigned_at"] = row.AssignedAt,
            ["escalated_at"] = row.EscalatedAt,
            ["escalation_note"] = row.EscalationNote,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> SupportRelationshipsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && (row.SupporterId == userId || row.RecipientId == userId))
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["supporter_id"] = row.SupporterId,
            ["recipient_id"] = row.RecipientId,
            ["coordinator_id"] = row.CoordinatorId,
            ["organization_id"] = row.OrganizationId,
            ["category_id"] = row.CategoryId,
            ["title"] = row.Title,
            ["description"] = row.Description,
            ["frequency"] = row.Frequency,
            ["expected_hours"] = row.ExpectedHours,
            ["start_date"] = row.StartDate,
            ["end_date"] = row.EndDate,
            ["status"] = row.Status,
            ["last_logged_at"] = row.LastLoggedAt,
            ["next_check_in_at"] = row.NextCheckInAt,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> HelpRequestsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringHelpRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.UserId == userId)
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["user_id"] = row.UserId,
            ["what"] = row.What,
            ["when_needed"] = row.WhenNeeded,
            ["contact_preference"] = row.ContactPreference,
            ["status"] = row.Status,
            ["is_on_behalf"] = row.IsOnBehalf,
            ["requested_by_id"] = row.RequestedById,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt,
            ["deleted_at"] = row.DeletedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> FavoursAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringFavours
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row =>
                row.TenantId == tenantId
                && (row.OfferedByUserId == userId || row.ReceivedByUserId == userId))
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["offered_by_user_id"] = row.OfferedByUserId,
            ["received_by_user_id"] = row.ReceivedByUserId,
            ["category"] = row.Category,
            ["description"] = row.Description,
            ["favour_date"] = row.FavourDate,
            ["is_anonymous"] = row.IsAnonymous,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt,
            ["deleted_at"] = row.DeletedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> HourGiftsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringHourGifts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row =>
                row.TenantId == tenantId
                && (row.SenderUserId == userId || row.RecipientUserId == userId))
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["sender_user_id"] = row.SenderUserId,
            ["recipient_user_id"] = row.RecipientUserId,
            ["hours"] = row.Hours,
            ["message"] = row.Message,
            ["status"] = row.Status,
            ["decline_reason"] = row.DeclineReason,
            ["accepted_at"] = row.AcceptedAt,
            ["declined_at"] = row.DeclinedAt,
            ["reverted_at"] = row.RevertedAt,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> HourTransfersAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringHourTransfers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.MemberUserId == userId)
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["counterpart_tenant_slug"] = row.CounterpartTenantSlug,
            ["role"] = row.Role,
            ["member_user_id"] = row.MemberUserId,
            ["counterpart_member_email"] = row.CounterpartMemberEmail,
            ["hours_transferred"] = row.HoursTransferred,
            ["status"] = row.Status,
            ["reason"] = row.Reason,
            ["payload_json"] = row.PayloadJson,
            ["linked_transfer_id"] = row.LinkedTransferId,
            ["is_remote"] = row.IsRemote,
            ["remote_delivery_status"] = row.RemoteDeliveryStatus,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> LoyaltyRedemptionsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.MemberUserId == userId)
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["member_user_id"] = row.MemberUserId,
            ["merchant_user_id"] = row.MerchantUserId,
            ["marketplace_listing_id"] = row.MarketplaceListingId,
            ["marketplace_order_id"] = row.MarketplaceOrderId,
            ["credits_used"] = row.CreditsUsed,
            ["exchange_rate_chf"] = row.ExchangeRateChf,
            ["discount_chf"] = row.DiscountChf,
            ["order_total_chf"] = row.OrderTotalChf,
            ["status"] = row.Status,
            ["redeemed_at"] = row.RedeemedAt,
            ["reversed_at"] = row.ReversedAt,
            ["reversed_by"] = row.ReversedBy,
            ["reversal_reason"] = row.ReversalReason,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<IReadOnlyList<object>> RegionalPointTransactionsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.UserId == userId)
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["account_id"] = row.AccountId,
            ["user_id"] = row.UserId,
            ["actor_user_id"] = row.ActorUserId,
            ["type"] = row.Type,
            ["direction"] = row.Direction,
            ["points"] = row.Points,
            ["balance_after"] = row.BalanceAfter,
            ["reference_type"] = row.ReferenceType,
            ["reference_id"] = row.ReferenceId,
            ["description"] = row.Description,
            ["metadata"] = row.Metadata,
            ["created_at"] = row.CreatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<object?> RegionalPointAccountAsync(int tenantId, int userId, CancellationToken ct)
    {
        var row = await _db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(account => account.TenantId == tenantId && account.UserId == userId)
            .OrderBy(account => account.Id)
            .FirstOrDefaultAsync(ct);

        if (row is null)
        {
            return null;
        }

        return new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["user_id"] = row.UserId,
            ["balance"] = row.Balance,
            ["lifetime_earned"] = row.LifetimeEarned,
            ["lifetime_spent"] = row.LifetimeSpent,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        };
    }

    private async Task<IReadOnlyList<object>> SafeguardingReportsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var rows = await _db.SafeguardingReports
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.ReporterUserId == userId)
            .OrderByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(row => new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["tenant_id"] = row.TenantId,
            ["reporter_user_id"] = row.ReporterUserId,
            ["subject_user_id"] = row.SubjectUserId,
            ["subject_organisation_id"] = row.SubjectOrganisationId,
            ["category"] = row.Category,
            ["severity"] = row.Severity,
            ["description"] = row.Description,
            ["evidence_url"] = row.EvidenceUrl,
            ["status"] = row.Status,
            ["assigned_to_user_id"] = row.AssignedToUserId,
            ["review_due_at"] = row.ReviewDueAt,
            ["escalated"] = row.Escalated,
            ["escalated_at"] = row.EscalatedAt,
            ["resolution_notes"] = row.ResolutionNotes,
            ["resolved_at"] = row.ResolvedAt,
            ["created_at"] = row.CreatedAt,
            ["updated_at"] = row.UpdatedAt
        }).Cast<object>().ToArray();
    }

    private async Task<object> CivicDigestPrefsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var key = CivicDigestService.UserPrefsKeyPrefix + userId.ToString();
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.Key == key)
            .OrderBy(row => row.Id)
            .ToListAsync(ct);

        return new Dictionary<string, object?>
        {
            ["tenant_config"] = rows.Select(row => new Dictionary<string, object?>
            {
                ["id"] = row.Id,
                ["tenant_id"] = row.TenantId,
                ["key"] = row.Key,
                ["value"] = row.Value,
                ["created_at"] = row.CreatedAt,
                ["updated_at"] = row.UpdatedAt
            }).Cast<object>().ToArray()
        };
    }
}
