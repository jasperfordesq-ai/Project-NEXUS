// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing legal documents (Terms of Service, Privacy Policy, etc.)
/// and tracking user acceptances.
/// </summary>
public class LegalDocumentService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<LegalDocumentService> _logger;

    public LegalDocumentService(NexusDbContext db, TenantContext tenantContext, ILogger<LegalDocumentService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// List all active legal documents for the current tenant.
    /// </summary>
    public async Task<List<LegalDocument>> GetActiveDocumentsAsync(int tenantId)
    {
        return await _db.LegalDocuments
            .AsNoTracking()
            .Where(d => d.IsActive)
            .OrderBy(d => d.Title)
            .ToListAsync();
    }

    /// <summary>
    /// Get a specific legal document by slug (returns the active version).
    /// </summary>
    public async Task<LegalDocument?> GetDocumentBySlugAsync(int tenantId, string slug)
    {
        return await _db.LegalDocuments
            .AsNoTracking()
            .Where(d => d.Slug == slug && d.IsActive)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Record a user's acceptance of a legal document.
    /// </summary>
    public async Task<LegalDocumentAcceptance> AcceptDocumentAsync(
        int tenantId, int userId, int documentId, string? ipAddress, string? userAgent)
    {
        // Verify document exists and is active
        var document = await _db.LegalDocuments
            .FirstOrDefaultAsync(d => d.Id == documentId && d.IsActive);

        if (document == null)
        {
            throw new InvalidOperationException("Document not found or is not active.");
        }

        // Check for existing acceptance
        var existing = await _db.LegalDocumentAcceptances
            .FirstOrDefaultAsync(a => a.UserId == userId && a.LegalDocumentId == documentId);

        if (existing != null)
        {
            // Already accepted — update timestamp
            existing.AcceptedAt = DateTime.UtcNow;
            existing.IpAddress = ipAddress;
            existing.UserAgent = userAgent;
            await _db.SaveChangesAsync();

            _logger.LogInformation("User {UserId} re-accepted legal document {DocumentId}", userId, documentId);
            return existing;
        }

        var acceptance = new LegalDocumentAcceptance
        {
            TenantId = tenantId,
            UserId = userId,
            LegalDocumentId = documentId,
            AcceptedAt = DateTime.UtcNow,
            IpAddress = ipAddress,
            UserAgent = userAgent
        };

        _db.LegalDocumentAcceptances.Add(acceptance);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} accepted legal document {DocumentId}", userId, documentId);

        return acceptance;
    }

    /// <summary>
    /// Get all acceptances for a user.
    /// </summary>
    public async Task<List<LegalDocumentAcceptance>> GetUserAcceptancesAsync(int tenantId, int userId)
    {
        return await _db.LegalDocumentAcceptances
            .AsNoTracking()
            .Include(a => a.LegalDocument)
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.AcceptedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get active documents that require acceptance but the user hasn't accepted yet.
    /// </summary>
    public async Task<List<LegalDocument>> GetPendingDocumentsAsync(int tenantId, int userId)
    {
        var acceptedDocumentIds = await _db.LegalDocumentAcceptances
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .Select(a => a.LegalDocumentId)
            .ToListAsync();

        return await _db.LegalDocuments
            .AsNoTracking()
            .Where(d => d.IsActive && d.RequiresAcceptance && !acceptedDocumentIds.Contains(d.Id))
            .OrderBy(d => d.Title)
            .ToListAsync();
    }

    /// <summary>
    /// Create a new legal document or create a new version (deactivating previous versions of the same slug).
    /// </summary>
    public async Task<LegalDocument> CreateOrUpdateDocumentAsync(
        int tenantId, string title, string slug, string content, string version, bool requiresAcceptance)
    {
        // Deactivate previous versions of the same slug
        var previousVersions = await _db.LegalDocuments
            .Where(d => d.Slug == slug && d.IsActive)
            .ToListAsync();

        foreach (var prev in previousVersions)
        {
            prev.IsActive = false;
            prev.UpdatedAt = DateTime.UtcNow;
        }

        var document = new LegalDocument
        {
            TenantId = tenantId,
            Title = title,
            Slug = slug,
            Content = content,
            Version = version,
            IsActive = true,
            RequiresAcceptance = requiresAcceptance,
            CreatedAt = DateTime.UtcNow
        };

        _db.LegalDocuments.Add(document);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Legal document '{Slug}' version {Version} created for tenant {TenantId}. " +
            "{DeactivatedCount} previous version(s) deactivated.",
            slug, version, tenantId, previousVersions.Count);

        return document;
    }
}
