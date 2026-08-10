// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using System.Security.Cryptography;

namespace Nexus.Api.Services;

/// <summary>
/// Phase 65 — operations for the volunteer long-tail subsystem
/// (expenses, wellbeing, certificates, emergency alerts).
///
/// Tenant scoping is enforced via the global query filter on each entity.
/// All write paths assume the caller has already authorized the user.
/// </summary>
public class VolunteerLongTailService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<VolunteerLongTailService> _logger;

    public VolunteerLongTailService(NexusDbContext db, TenantContext tenant, ILogger<VolunteerLongTailService> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    // ─── Expenses ──────────────────────────────────────────────────────────

    public async Task<VolunteerExpense> SubmitExpenseAsync(
        int userId, int? shiftId, decimal amount, string currency, string category, string description, string? receiptUrl)
    {
        if (amount <= 0) throw new ArgumentException("Amount must be positive", nameof(amount));
        if (string.IsNullOrWhiteSpace(category)) throw new ArgumentException("Category required", nameof(category));
        if (string.IsNullOrWhiteSpace(description)) throw new ArgumentException("Description required", nameof(description));

        var entity = new VolunteerExpense
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = userId,
            ShiftId = shiftId,
            Amount = amount,
            Currency = currency,
            Category = category,
            Description = description,
            ReceiptUrl = receiptUrl,
            Status = VolunteerExpenseStatus.Submitted,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.VolunteerExpenses.Add(entity);
        await _db.SaveChangesAsync();
        return entity;
    }

    public Task<List<VolunteerExpense>> ListExpensesForUserAsync(int userId) =>
        _db.VolunteerExpenses.Where(e => e.UserId == userId).OrderByDescending(e => e.CreatedAt).ToListAsync();

    public Task<List<VolunteerExpense>> ListExpensesByStatusAsync(VolunteerExpenseStatus status) =>
        _db.VolunteerExpenses.Where(e => e.Status == status).OrderBy(e => e.CreatedAt).ToListAsync();

    public Task<VolunteerExpense?> GetExpenseAsync(int id) =>
        _db.VolunteerExpenses.FirstOrDefaultAsync(e => e.Id == id);

    public async Task<VolunteerExpense?> ReviewExpenseAsync(int id, int reviewerUserId, bool approve, string? note)
    {
        var entity = await _db.VolunteerExpenses.FirstOrDefaultAsync(e => e.Id == id);
        if (entity == null) return null;
        if (entity.Status == VolunteerExpenseStatus.Reimbursed)
            return entity; // immutable once reimbursed

        entity.Status = approve ? VolunteerExpenseStatus.Approved : VolunteerExpenseStatus.Rejected;
        entity.ReviewerNote = note;
        entity.ReviewedByUserId = reviewerUserId;
        entity.ReviewedAt = DateTime.UtcNow;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Expense {Id} {Action} by user {ReviewerId}", id, approve ? "approved" : "rejected", reviewerUserId);
        return entity;
    }

    public async Task<VolunteerExpense?> MarkReimbursedAsync(int id)
    {
        var entity = await _db.VolunteerExpenses.FirstOrDefaultAsync(e => e.Id == id);
        if (entity == null) return null;
        if (entity.Status != VolunteerExpenseStatus.Approved) return entity;
        entity.Status = VolunteerExpenseStatus.Reimbursed;
        entity.ReimbursedAt = DateTime.UtcNow;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return entity;
    }

    // ─── Wellbeing ─────────────────────────────────────────────────────────

    public async Task<VolunteerWellbeing> SubmitWellbeingAsync(int userId, int? shiftId, int score, string? note, bool requiresFollowUp)
    {
        if (score < 1 || score > 5) throw new ArgumentException("Score must be 1–5", nameof(score));
        var entity = new VolunteerWellbeing
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = userId,
            ShiftId = shiftId,
            Score = score,
            Note = note,
            RequiresFollowUp = requiresFollowUp,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.VolunteerWellbeings.Add(entity);
        await _db.SaveChangesAsync();
        return entity;
    }

    public Task<List<VolunteerWellbeing>> ListUnresolvedFollowUpsAsync() =>
        _db.VolunteerWellbeings
            .Where(w => w.RequiresFollowUp && !w.IsResolved)
            .OrderBy(w => w.CreatedAt)
            .ToListAsync();

    public async Task<VolunteerWellbeing?> ResolveWellbeingAsync(int id, int resolverUserId, string? resolutionNote)
    {
        var entity = await _db.VolunteerWellbeings.FirstOrDefaultAsync(w => w.Id == id);
        if (entity == null) return null;
        entity.IsResolved = true;
        entity.ResolvedByUserId = resolverUserId;
        entity.ResolvedAt = DateTime.UtcNow;
        entity.ResolutionNote = resolutionNote;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return entity;
    }

    // ─── Certificates ──────────────────────────────────────────────────────

    public async Task<VolunteerCertificate> IssueCertificateAsync(
        int userId, string title, string? description, decimal? hoursRecognised,
        string? issuedBy, DateTime? expiresAt, bool isPubliclyVerifiable)
    {
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("Title required", nameof(title));
        var entity = new VolunteerCertificate
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = userId,
            Title = title,
            Description = description,
            HoursRecognised = hoursRecognised,
            IssuedBy = issuedBy,
            IssuedAt = DateTime.UtcNow,
            ExpiresAt = expiresAt,
            VerificationCode = GenerateVerificationCode(),
            IsPubliclyVerifiable = isPubliclyVerifiable,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.VolunteerCertificates.Add(entity);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Certificate issued: id={Id} user={UserId} code={Code}", entity.Id, userId, entity.VerificationCode);
        return entity;
    }

    public Task<List<VolunteerCertificate>> ListCertificatesForUserAsync(int userId) =>
        _db.VolunteerCertificates.Where(c => c.UserId == userId).OrderByDescending(c => c.IssuedAt).ToListAsync();

    /// <summary>
    /// Public-facing verification: returns metadata if the code matches an
    /// active, publicly-verifiable, non-revoked certificate. Bypasses the
    /// tenant filter intentionally because verification is by code.
    /// </summary>
    public async Task<VolunteerCertificate?> VerifyByCodeAsync(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        return await _db.VolunteerCertificates
            .IgnoreQueryFilters()
            .Where(c => c.VerificationCode == code && c.IsPubliclyVerifiable && !c.IsRevoked)
            .Where(c => c.ExpiresAt == null || c.ExpiresAt > DateTime.UtcNow)
            .FirstOrDefaultAsync();
    }

    public async Task<VolunteerCertificate?> RevokeCertificateAsync(int id, string reason)
    {
        var entity = await _db.VolunteerCertificates.FirstOrDefaultAsync(c => c.Id == id);
        if (entity == null) return null;
        entity.IsRevoked = true;
        entity.RevocationReason = reason;
        entity.RevokedAt = DateTime.UtcNow;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return entity;
    }

    private static string GenerateVerificationCode()
    {
        // 16-byte URL-safe random ⇒ ~22 chars. Sufficient entropy for
        // verification, short enough to print on a certificate.
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
    }

    // ─── Emergency Alerts ──────────────────────────────────────────────────

    public async Task<VolunteerEmergencyAlert> CreateAlertAsync(
        int createdByUserId, string title, string body, VolunteerEmergencyAlertSeverity severity,
        int? opportunityId, int? shiftId)
    {
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("Title required", nameof(title));
        if (string.IsNullOrWhiteSpace(body)) throw new ArgumentException("Body required", nameof(body));
        var entity = new VolunteerEmergencyAlert
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            CreatedByUserId = createdByUserId,
            Title = title,
            Body = body,
            Severity = severity,
            OpportunityId = opportunityId,
            ShiftId = shiftId,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.VolunteerEmergencyAlerts.Add(entity);
        await _db.SaveChangesAsync();
        _logger.LogWarning("Volunteer emergency alert created: id={Id} severity={Severity} title={Title}", entity.Id, severity, title);
        return entity;
    }

    public Task<List<VolunteerEmergencyAlert>> ListActiveAlertsAsync() =>
        _db.VolunteerEmergencyAlerts.Where(a => a.IsActive).OrderByDescending(a => a.CreatedAt).ToListAsync();

    public async Task<VolunteerEmergencyAlert?> AcknowledgeAlertAsync(int id)
    {
        var entity = await _db.VolunteerEmergencyAlerts.FirstOrDefaultAsync(a => a.Id == id);
        if (entity == null) return null;
        entity.IsActive = false;
        entity.AcknowledgedAt = DateTime.UtcNow;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return entity;
    }
}
