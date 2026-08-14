// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Support.Safeguarding;

namespace Nexus.Api.Services;

/// <summary>
/// Represent-tier proxy execution — Laravel parity for SubAccountService's
/// createListingForChild / attachListingImageForChild / transferForChild /
/// getChildWalletSummary. A carer holding the REPRESENT tier acts directly,
/// without per-action approval; co_decide deliberately does NOT authorise
/// acting alone (its path is the support-action workflow). Every act keeps the
/// supported member as owner/sender and stamps the carer as ActingUserId, and
/// every act is audited and notified to the supported member.
/// </summary>
public class SubAccountProxyService
{
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly PersonalWalletLedgerService _wallet;
    private readonly GamificationService _gamification;
    private readonly FileUploadService _files;
    private readonly AuditLogService _audit;
    private readonly ILogger<SubAccountProxyService> _logger;
    private readonly List<object> _errors = [];

    public SubAccountProxyService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        PersonalWalletLedgerService wallet,
        GamificationService gamification,
        FileUploadService files,
        AuditLogService audit,
        ILogger<SubAccountProxyService> logger)
    {
        _db = db;
        _safeguarding = safeguarding;
        _wallet = wallet;
        _gamification = gamification;
        _files = files;
        _audit = audit;
        _logger = logger;
    }

    public IReadOnlyList<object> Errors => _errors;

    /// <summary>201 payload is just the new listing id, exactly as Laravel.</summary>
    public async Task<int?> CreateListingForChildAsync(
        int parentUserId, int childUserId, JsonElement body, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await AuthorizeAsync(
            parentUserId, childUserId, "listings", "subaccount_manage_listings", ct);
        if (relationship is null) return null;

        var title = GetString(body, "title");
        if (string.IsNullOrWhiteSpace(title) || title.Length > 255)
        {
            _errors.Add(new { code = "VALIDATION_ERROR", message = "A listing needs a title" });
            return null;
        }

        var listing = new Listing
        {
            TenantId = relationship.TenantId,
            UserId = childUserId,
            ActingUserId = parentUserId,
            Title = title.Trim(),
            Description = GetString(body, "description"),
            Type = Enum.TryParse<ListingType>(GetString(body, "type"), true, out var type)
                ? type : ListingType.Offer,
            Status = ListingStatus.Active,
            Location = GetString(body, "location"),
            EstimatedHours = body.ValueKind == JsonValueKind.Object
                && body.TryGetProperty("estimated_hours", out var hours)
                && hours.ValueKind == JsonValueKind.Number ? hours.GetDecimal() : null,
            CreatedAt = DateTime.UtcNow
        };

        // The audit row commits with the listing or not at all — a proxy act
        // that cannot be attributed must not happen (fail-closed, as Laravel).
        await using (var transaction = await _db.Database.BeginTransactionAsync(ct))
        {
            _db.Listings.Add(listing);
            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(parentUserId, "subaccount_listing_created",
                "listing", listing.Id, null, null, null, null,
                JsonSerializer.Serialize(new { target_user_id = childUserId, listing_id = listing.Id }));
            await transaction.CommitAsync(ct);
        }

        try
        {
            await _gamification.AwardXpAsync(childUserId, XpLog.Amounts.ListingCreated,
                XpLog.Sources.ListingCreated, listing.Id, $"Created listing: {listing.Title}");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[SubAccountProxy] listing XP award failed");
        }

        await NotifyChildAsync(relationship.TenantId, childUserId, "sub_account_proxy_listing",
            "A listing was created for you",
            "Someone who supports you created a listing on your behalf.",
            $"/listings/{listing.Id}", ct);
        return listing.Id;
    }

    public async Task<string?> AttachListingImageForChildAsync(
        int parentUserId, int childUserId, int listingId, IFormFile? file, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await AuthorizeAsync(
            parentUserId, childUserId, "listings", "subaccount_manage_listings", ct);
        if (relationship is null) return null;

        var listing = await _db.Listings
            .FirstOrDefaultAsync(l => l.Id == listingId && l.UserId == childUserId, ct);
        if (listing is null)
        {
            _errors.Add(new { code = "NOT_FOUND", message = "Listing not found" });
            return null;
        }

        if (file is null || file.Length == 0)
        {
            _errors.Add(new { code = "VALIDATION_ERROR", message = "No image uploaded" });
            return null;
        }

        var allowed = new[] { "image/jpeg", "image/png", "image/webp", "image/gif" };
        if (!allowed.Contains(file.ContentType, StringComparer.OrdinalIgnoreCase))
        {
            _errors.Add(new { code = "VALIDATION_ERROR", message = "The image must be a JPEG, PNG, WebP or GIF" });
            return null;
        }

        try
        {
            await using var stream = file.OpenReadStream();
            var (upload, error) = await _files.UploadAsync(
                stream, file.FileName, file.ContentType, file.Length,
                childUserId, relationship.TenantId, FileCategory.Listing, listingId, "listing", ct);
            if (upload is null || error is not null)
            {
                _errors.Add(new { code = "UPLOAD_FAILED", message = error ?? "The image could not be saved" });
                return null;
            }

            var imageUrl = _files.GetDownloadUrl(upload);
            listing.ImageUrl = imageUrl;
            listing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(parentUserId, "subaccount_listing_image_added",
                "listing", listingId, null, null, null, null,
                JsonSerializer.Serialize(new { target_user_id = childUserId, listing_id = listingId }));
            return imageUrl;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[SubAccountProxy] listing image upload failed");
            _errors.Add(new { code = "UPLOAD_FAILED", message = "The image could not be saved" });
            return null;
        }
    }

    /// <summary>
    /// Moves the SUPPORTED MEMBER's credits (never the carer's) through the
    /// canonical wallet ledger, then stamps the carer on the ledger row.
    /// Returns the Laravel formatTransaction shape.
    /// </summary>
    public async Task<object?> TransferForChildAsync(
        int parentUserId, int childUserId, JsonElement body, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await AuthorizeAsync(
            parentUserId, childUserId, "credits", "subaccount_transact", ct);
        if (relationship is null) return null;

        var recipient = GetString(body, "recipient")
            ?? (body.ValueKind == JsonValueKind.Object
                && body.TryGetProperty("recipient", out var r)
                && r.ValueKind == JsonValueKind.Number ? r.GetInt32().ToString() : null);
        var amount = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("amount", out var a)
            && a.ValueKind == JsonValueKind.Number ? a.GetDecimal() : 0m;

        var result = await _wallet.TransferAsync(
            relationship.TenantId, childUserId, recipient, amount,
            GetString(body, "description"), GetString(body, "idempotency_key"), ct);
        if (!result.Success)
        {
            _errors.Add(new
            {
                code = "TRANSFER_FAILED",
                message = result.ErrorMessage ?? "The transfer could not be completed"
            });
            return null;
        }

        if (result.TransactionId is { } transactionId)
        {
            await _db.Transactions
                .IgnoreQueryFilters()
                .Where(t => t.Id == transactionId)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.ActingUserId, parentUserId), ct);
        }

        await _audit.LogAsync(parentUserId, "subaccount_transfer_sent",
            "transaction", result.TransactionId, null, null, null, null,
            JsonSerializer.Serialize(new
            {
                target_user_id = childUserId,
                transaction_id = result.TransactionId,
                amount = result.Amount
            }));
        await NotifyChildAsync(relationship.TenantId, childUserId, "sub_account_proxy_transfer",
            "Credits were sent for you",
            "Someone who supports you sent credits from your balance.", "/wallet", ct);

        // Laravel formatTransaction(), from the supported member's viewpoint.
        return new
        {
            id = result.TransactionId,
            type = "debit",
            status = "completed",
            amount = result.Amount.HasValue ? (double)result.Amount.Value : 0d,
            description = result.Description,
            transaction_type = "transfer",
            sender = new
            {
                id = result.SenderId,
                name = $"{result.SenderFirstName} {result.SenderLastName}".Trim(),
                avatar = result.SenderAvatarUrl
            },
            receiver = new
            {
                id = result.ReceiverId,
                name = $"{result.ReceiverFirstName} {result.ReceiverLastName}".Trim(),
                avatar = result.ReceiverAvatarUrl
            },
            other_user = new
            {
                id = result.ReceiverId,
                name = $"{result.ReceiverFirstName} {result.ReceiverLastName}".Trim(),
                avatar = result.ReceiverAvatarUrl
            },
            balance_after = (double?)null,
            created_at = (result.CreatedAt ?? DateTime.UtcNow).ToString("yyyy-MM-dd'T'HH:mm:ssK")
        };
    }

    /// <summary>
    /// Gated on the CREDITS tier, deliberately not activity: the balance is
    /// only needed to decide how much can be sent, so the permission that
    /// grants it is the one that permits sending.
    /// </summary>
    public async Task<object?> GetChildWalletSummaryAsync(
        int parentUserId, int childUserId, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await AuthorizeAsync(
            parentUserId, childUserId, "credits", "subaccount_transact", ct);
        if (relationship is null) return null;

        var childExists = await _db.Users
            .IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(u => u.Id == childUserId && u.TenantId == relationship.TenantId, ct);
        if (!childExists)
        {
            _errors.Add(new { code = "NOT_FOUND", message = "User not found" });
            return null;
        }

        var received = await _db.Transactions.AsNoTracking()
            .Where(t => t.ReceiverId == childUserId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount, ct) ?? 0m;
        var sent = await _db.Transactions.AsNoTracking()
            .Where(t => t.SenderId == childUserId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount, ct) ?? 0m;
        return new { balance = (double)(received - sent) };
    }

    /// <summary>
    /// Represent-tier gate + use-time safeguarding check. co_decide never
    /// authorises acting alone — that is what the consent workflow is for.
    /// </summary>
    private async Task<AccountRelationship?> AuthorizeAsync(
        int parentUserId, int childUserId, string capability, string safeguardingChannel,
        CancellationToken ct)
    {
        var relationship = await _db.AccountRelationships
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.ParentUserId == parentUserId
                && r.ChildUserId == childUserId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null
            || !SupportTiers.AtLeast(
                AccountRelationshipService.ResolvedTiers(relationship),
                capability, SupportTiers.Represent))
        {
            _errors.Add(new
            {
                code = "FORBIDDEN",
                message = "You do not have permission to do this for that account"
            });
            return null;
        }

        try
        {
            await _safeguarding.AssertLocalContactAllowedAsync(
                parentUserId, childUserId, relationship.TenantId, safeguardingChannel, ct);
        }
        catch (Exception ex)
        {
            _errors.Add(new { code = "FORBIDDEN", message = ex.Message });
            return null;
        }

        return relationship;
    }

    private async Task NotifyChildAsync(
        int tenantId, int childUserId, string type, string title, string body, string link,
        CancellationToken ct)
    {
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = childUserId,
            Type = type,
            Title = title,
            Body = body,
            Link = link,
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        };
        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _db.Entry(notification).State = EntityState.Detached;
            _logger.LogWarning(ex, "[SubAccountProxy] notification failed for user {UserId}", childUserId);
        }
    }

    private static string? GetString(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object
        && body.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
