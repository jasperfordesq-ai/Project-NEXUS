// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for insurance certificate tracking and verification.
/// </summary>
public class InsuranceService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<InsuranceService> _logger;

    public InsuranceService(NexusDbContext db, TenantContext tenantContext, ILogger<InsuranceService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<List<InsuranceCertificate>> GetUserCertificatesAsync(int userId)
    {
        return await _db.Set<InsuranceCertificate>()
            .Where(c => c.UserId == userId)
            .OrderByDescending(c => c.ExpiryDate)
            .ToListAsync();
    }

    public async Task<InsuranceCertificate?> GetByIdAsync(int id)
    {
        return await _db.Set<InsuranceCertificate>()
            .Include(c => c.User)
            .Include(c => c.VerifiedBy)
            .FirstOrDefaultAsync(c => c.Id == id);
    }

    public async Task<(InsuranceCertificate? Cert, string? Error)> CreateAsync(
        int userId, string type, string? provider, string? policyNumber,
        decimal? coverAmount, DateTime startDate, DateTime expiryDate, string? documentUrl,
        string status = "pending")
    {
        if (expiryDate <= startDate) return (null, "Expiry date must be after start date");

        var cert = new InsuranceCertificate
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            Type = type,
            Provider = provider,
            PolicyNumber = policyNumber,
            CoverAmount = coverAmount,
            StartDate = startDate,
            ExpiryDate = expiryDate,
            DocumentUrl = documentUrl,
            Status = status
        };

        _db.Set<InsuranceCertificate>().Add(cert);
        await _db.SaveChangesAsync();
        return (cert, null);
    }

    public async Task<(InsuranceCertificate? Cert, string? Error)> UpdateAsync(
        int id, int userId, string? type, string? provider, string? policyNumber,
        decimal? coverAmount, DateTime? startDate, DateTime? expiryDate, string? documentUrl)
    {
        var cert = await _db.Set<InsuranceCertificate>().FirstOrDefaultAsync(x => x.Id == id);
        if (cert == null) return (null, "Certificate not found");
        if (cert.UserId != userId) return (null, "Not authorized");

        if (type != null) cert.Type = type;
        if (provider != null) cert.Provider = provider;
        if (policyNumber != null) cert.PolicyNumber = policyNumber;
        if (coverAmount.HasValue) cert.CoverAmount = coverAmount;
        if (startDate.HasValue) cert.StartDate = startDate.Value;
        if (expiryDate.HasValue) cert.ExpiryDate = expiryDate.Value;
        if (documentUrl != null) cert.DocumentUrl = documentUrl;

        cert.UpdatedAt = DateTime.UtcNow;
        cert.Status = "pending"; // Re-verification needed on update
        await _db.SaveChangesAsync();
        return (cert, null);
    }

    public async Task<string?> DeleteAsync(int id, int userId)
    {
        var cert = await _db.Set<InsuranceCertificate>().FirstOrDefaultAsync(x => x.Id == id);
        if (cert == null) return "Certificate not found";
        if (cert.UserId != userId) return "Not authorized";

        _db.Set<InsuranceCertificate>().Remove(cert);
        await _db.SaveChangesAsync();
        return null;
    }

    // Admin operations
    public async Task<List<InsuranceCertificate>> AdminListPendingAsync()
    {
        return await _db.Set<InsuranceCertificate>()
            .Where(c => c.Status == "pending")
            .Include(c => c.User)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();
    }

    public async Task<List<InsuranceCertificate>> AdminListExpiringAsync(int daysAhead = 30)
    {
        var cutoff = DateTime.UtcNow.AddDays(daysAhead);
        return await _db.Set<InsuranceCertificate>()
            .Where(c => c.Status == "verified" && c.ExpiryDate <= cutoff)
            .Include(c => c.User)
            .OrderBy(c => c.ExpiryDate)
            .ToListAsync();
    }

    public async Task<(InsuranceCertificate? Cert, string? Error)> AdminVerifyAsync(int id, int verifiedById)
    {
        var cert = await _db.Set<InsuranceCertificate>().FirstOrDefaultAsync(x => x.Id == id);
        if (cert == null) return (null, "Certificate not found");

        cert.Status = "verified";
        cert.VerifiedById = verifiedById;
        cert.VerifiedAt = DateTime.UtcNow;
        cert.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (cert, null);
    }

    public async Task<(InsuranceCertificate? Cert, string? Error)> AdminRejectAsync(int id, int verifiedById)
    {
        var cert = await _db.Set<InsuranceCertificate>().FirstOrDefaultAsync(x => x.Id == id);
        if (cert == null) return (null, "Certificate not found");

        cert.Status = "rejected";
        cert.VerifiedById = verifiedById;
        cert.VerifiedAt = DateTime.UtcNow;
        cert.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (cert, null);
    }
}
