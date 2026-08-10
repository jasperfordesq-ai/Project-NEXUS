// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for vetting/DBS record management and verification.
/// </summary>
public class VettingService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<VettingService> _logger;

    public static readonly string[] ValidVettingTypes = new[]
    {
        "dbs_basic", "dbs_standard", "dbs_enhanced", "dbs_enhanced_barred",
        "access_ni", "garda_vetting", "police_check", "working_with_children",
        "reference_check", "identity_check", "right_to_work", "other"
    };

    public VettingService(NexusDbContext db, ILogger<VettingService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<VettingRecord>> GetRecordsAsync(
        int? userId = null, string? status = null, string? type = null)
    {
        var query = _db.Set<VettingRecord>()
            .Include(r => r.User)
            .Include(r => r.VerifiedBy)
            .AsQueryable();

        if (userId.HasValue)
            query = query.Where(r => r.UserId == userId.Value);

        if (!string.IsNullOrEmpty(status))
            query = query.Where(r => r.Status == status);

        if (!string.IsNullOrEmpty(type))
            query = query.Where(r => r.VettingType == type);

        return await query.OrderByDescending(r => r.CreatedAt).ToListAsync();
    }

    public async Task<VettingRecord?> GetRecordAsync(int id)
    {
        return await _db.Set<VettingRecord>()
            .Include(r => r.User)
            .Include(r => r.VerifiedBy)
            .FirstOrDefaultAsync(r => r.Id == id);
    }

    public async Task<(VettingRecord? Record, string? Error)> CreateRecordAsync(
        int tenantId, int userId, string type, string? reference,
        DateTime? issuedAt, DateTime? expiresAt, string? documentUrl)
    {
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user == null) return (null, "User not found");

        if (!ValidVettingTypes.Contains(type))
            return (null, "Invalid vetting type");

        if (expiresAt.HasValue && issuedAt.HasValue && expiresAt.Value <= issuedAt.Value)
            return (null, "Expiry date must be after issued date");

        var record = new VettingRecord
        {
            TenantId = tenantId,
            UserId = userId,
            VettingType = type,
            ReferenceNumber = reference,
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
            DocumentUrl = documentUrl,
            Status = "pending"
        };

        _db.Set<VettingRecord>().Add(record);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Vetting record {Id} created for user {UserId}, type {Type}", record.Id, userId, type);
        return (record, null);
    }

    public async Task<(VettingRecord? Record, string? Error)> UpdateRecordAsync(
        int id, string? type, string? reference, DateTime? issuedAt,
        DateTime? expiresAt, string? documentUrl, string? notes)
    {
        var record = await _db.Set<VettingRecord>().FirstOrDefaultAsync(x => x.Id == id);
        if (record == null) return (null, "Record not found");

        if (type != null)
        {
            if (!ValidVettingTypes.Contains(type))
                return (null, "Invalid vetting type");
            record.VettingType = type;
        }

        if (reference != null) record.ReferenceNumber = reference;
        if (issuedAt.HasValue) record.IssuedAt = issuedAt.Value;
        if (expiresAt.HasValue) record.ExpiresAt = expiresAt.Value;
        if (documentUrl != null) record.DocumentUrl = documentUrl;
        if (notes != null) record.Notes = notes;

        record.UpdatedAt = DateTime.UtcNow;
        record.Status = "pending";

        await _db.SaveChangesAsync();
        return (record, null);
    }

    public async Task<(VettingRecord? Record, string? Error)> VerifyRecordAsync(int id, int verifiedById)
    {
        var record = await _db.Set<VettingRecord>().FirstOrDefaultAsync(x => x.Id == id);
        if (record == null) return (null, "Record not found");

        record.Status = "verified";
        record.VerifiedById = verifiedById;
        record.VerifiedAt = DateTime.UtcNow;
        record.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Vetting record {Id} verified by {VerifiedById}", id, verifiedById);
        return (record, null);
    }

    public async Task<(VettingRecord? Record, string? Error)> RejectRecordAsync(int id, int verifiedById, string? notes)
    {
        var record = await _db.Set<VettingRecord>().FirstOrDefaultAsync(x => x.Id == id);
        if (record == null) return (null, "Record not found");

        record.Status = "rejected";
        record.VerifiedById = verifiedById;
        record.VerifiedAt = DateTime.UtcNow;
        record.UpdatedAt = DateTime.UtcNow;
        if (notes != null) record.Notes = notes;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Vetting record {Id} rejected by {VerifiedById}", id, verifiedById);
        return (record, null);
    }

    public async Task<List<VettingRecord>> GetExpiringRecordsAsync(int tenantId, int daysBefore = 30)
    {
        var cutoff = DateTime.UtcNow.AddDays(daysBefore);
        return await _db.Set<VettingRecord>()
            .Where(r => r.Status == "verified" && r.ExpiresAt != null && r.ExpiresAt <= cutoff && r.ExpiresAt > DateTime.UtcNow)
            .Include(r => r.User)
            .OrderBy(r => r.ExpiresAt)
            .ToListAsync();
    }

    public async Task<List<VettingRecord>> GetExpiredRecordsAsync()
    {
        return await _db.Set<VettingRecord>()
            .Where(r => r.ExpiresAt != null && r.ExpiresAt <= DateTime.UtcNow)
            .Include(r => r.User)
            .OrderBy(r => r.ExpiresAt)
            .ToListAsync();
    }

    public async Task<List<VettingRecord>> GetUserRecordsAsync(int userId)
    {
        return await _db.Set<VettingRecord>()
            .Where(r => r.UserId == userId)
            .Include(r => r.VerifiedBy)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();
    }

    public async Task<string?> DeleteRecordAsync(int id)
    {
        var record = await _db.Set<VettingRecord>().FirstOrDefaultAsync(x => x.Id == id);
        if (record == null) return "Record not found";

        _db.Set<VettingRecord>().Remove(record);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<(VettingRecord? Record, string? Error)> RenewRecordAsync(int id, int defaultMonths = 12)
    {
        var record = await _db.Set<VettingRecord>().FirstOrDefaultAsync(x => x.Id == id);
        if (record == null) return (null, "Record not found");

        var baseDate = record.ExpiresAt ?? DateTime.UtcNow;
        if (baseDate < DateTime.UtcNow) baseDate = DateTime.UtcNow;
        record.ExpiresAt = baseDate.AddMonths(defaultMonths);
        record.Status = "verified";
        record.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Vetting record {Id} renewed, new expiry {ExpiresAt}", id, record.ExpiresAt);
        return (record, null);
    }

    public async Task<List<(VettingRecord Record, string? Error)>> BulkVerifyAsync(int[] recordIds, int verifiedById)
    {
        var results = new List<(VettingRecord Record, string? Error)>();
        foreach (var id in recordIds)
        {
            var (record, error) = await VerifyRecordAsync(id, verifiedById);
            results.Add((record!, error));
        }
        return results;
    }

    public async Task<object> GetStatsAsync()
    {
        var total = await _db.Set<VettingRecord>().CountAsync();
        var pending = await _db.Set<VettingRecord>().CountAsync(r => r.Status == "pending");
        var verified = await _db.Set<VettingRecord>().CountAsync(r => r.Status == "verified");
        var rejected = await _db.Set<VettingRecord>().CountAsync(r => r.Status == "rejected");

        var cutoff = DateTime.UtcNow.AddDays(30);
        var expiringSoon = await _db.Set<VettingRecord>()
            .CountAsync(r => r.Status == "verified" && r.ExpiresAt != null && r.ExpiresAt <= cutoff && r.ExpiresAt > DateTime.UtcNow);
        var expired = await _db.Set<VettingRecord>()
            .CountAsync(r => r.ExpiresAt != null && r.ExpiresAt <= DateTime.UtcNow);

        var byType = await _db.Set<VettingRecord>()
            .GroupBy(r => r.VettingType)
            .Select(g => new { type = g.Key, count = g.Count() })
            .ToListAsync();

        return new
        {
            total,
            pending,
            verified,
            rejected,
            expiring_soon = expiringSoon,
            expired,
            by_type = byType
        };
    }
}
