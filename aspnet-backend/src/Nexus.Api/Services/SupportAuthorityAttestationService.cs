// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Registration;
using Nexus.Api.Support.Safeguarding;

namespace Nexus.Api.Services;

/// <summary>
/// Authority attestations — Laravel parity for
/// App\Services\SupportAuthorityAttestationService. Staff record that they
/// SIGHTED a formal authority document for a represent-tier relationship.
/// An attestation is a record, never authorisation: revoking one does not
/// touch the relationship's tiers. Free text is encrypted at rest, capped at
/// 2000 chars; an undecryptable value must read as absent, never ciphertext;
/// private notes are never returned.
/// </summary>
public class SupportAuthorityAttestationService
{
    private readonly NexusDbContext _db;
    private readonly ProviderConfigEncryption _encryption;
    private readonly AuditLogService _audit;
    private readonly ILogger<SupportAuthorityAttestationService> _logger;
    private readonly List<object> _errors = [];

    public SupportAuthorityAttestationService(
        NexusDbContext db,
        ProviderConfigEncryption encryption,
        AuditLogService audit,
        ILogger<SupportAuthorityAttestationService> logger)
    {
        _db = db;
        _encryption = encryption;
        _audit = audit;
        _logger = logger;
    }

    public IReadOnlyList<object> Errors => _errors;

    /// <summary>
    /// The 200 most recent ACTIVE relationships, of which those holding the
    /// represent tier anywhere — deliberately not restricted to
    /// staff-proposed rows, and limited BEFORE the tier filter, as Laravel.
    /// </summary>
    public async Task<List<object>> ListRepresentRelationshipsAsync(CancellationToken ct)
    {
        var relationships = await _db.AccountRelationships
            .AsNoTracking()
            .Include(r => r.ParentUser)
            .Include(r => r.ChildUser)
            .Where(r => r.Status == AccountRelationship.StatusActive)
            .OrderByDescending(r => r.CreatedAt)
            .Take(200)
            .ToListAsync(ct);

        var represent = relationships
            .Select(r => (Relationship: r, Tiers: AccountRelationshipService.ResolvedTiers(r)))
            .Where(pair => pair.Tiers.Values.Contains(SupportTiers.Represent))
            .ToList();
        if (represent.Count == 0) return [];

        var ids = represent.Select(pair => pair.Relationship.Id).ToArray();
        var attestations = await _db.SupportAuthorityAttestations
            .AsNoTracking()
            .Where(a => ids.Contains(a.RelationshipId))
            .OrderBy(a => a.Id)
            .ToListAsync(ct);
        var grouped = attestations.GroupBy(a => a.RelationshipId)
            .ToDictionary(g => g.Key, g => g.ToList());

        return represent.Select(pair => (object)new
        {
            relationship_id = pair.Relationship.Id,
            supporter_name = pair.Relationship.ParentUser is null
                ? null
                : $"{pair.Relationship.ParentUser.FirstName} {pair.Relationship.ParentUser.LastName}".Trim(),
            supported_name = pair.Relationship.ChildUser is null
                ? null
                : $"{pair.Relationship.ChildUser.FirstName} {pair.Relationship.ChildUser.LastName}".Trim(),
            relationship_type = pair.Relationship.RelationshipType,
            tiers = pair.Tiers,
            attestations = (grouped.TryGetValue(pair.Relationship.Id, out var rows) ? rows : [])
                .Select(a => (object)new
                {
                    id = a.Id,
                    authority_type = a.AuthorityType,
                    decision = a.Decision,
                    scope_summary = Decrypt(a.ScopeSummaryEncrypted),
                    attested_at = a.AttestedAt?.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
                    revoked_at = a.RevokedAt?.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
                    revocation_reason_code = a.RevocationReasonCode,
                    policy_version = a.PolicyVersion
                    // private_notes is NEVER returned.
                }).ToList()
        }).ToList();
    }

    public async Task<object?> AttestAsync(
        int staffUserId, int relationshipId, string authorityType, bool acknowledgedSighted,
        string? scopeSummary, string? privateNotes, CancellationToken ct)
    {
        _errors.Clear();
        if (!SupportAuthorityAttestation.AuthorityTypes.Contains(authorityType))
        {
            _errors.Add(new { code = "VALIDATION_ERROR", message = "Choose a recognised authority type" });
            return null;
        }

        if (!acknowledgedSighted)
        {
            _errors.Add(new
            {
                code = "VALIDATION_ERROR",
                message = "You must confirm you have sighted the authority"
            });
            return null;
        }

        var relationship = await _db.AccountRelationships
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == relationshipId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null)
        {
            _errors.Add(new { code = "NOT_FOUND", message = "Relationship not found, or not active" });
            return null;
        }

        var now = DateTime.UtcNow;
        var existing = await _db.SupportAuthorityAttestations
            .FirstOrDefaultAsync(a => a.RelationshipId == relationshipId
                && a.AuthorityType == authorityType, ct);
        var eventType = existing is null ? "attested" : "re_attested";
        var decisionBefore = existing?.Decision;

        var row = existing ?? new SupportAuthorityAttestation
        {
            TenantId = relationship.TenantId,
            RelationshipId = relationshipId,
            SupportedUserId = relationship.ChildUserId,
            AuthorityType = authorityType,
            CreatedAt = now
        };
        row.AcknowledgedSighted = true;
        row.ScopeSummaryEncrypted = EncryptOrNull(scopeSummary);
        row.PrivateNotesEncrypted = EncryptOrNull(privateNotes);
        row.Decision = "active";
        row.AttestedBy = staffUserId;
        row.AttestedAt = now;
        row.RevokedBy = null;              // cleared on re-attest
        row.RevokedAt = null;
        row.RevocationReasonCode = null;
        row.PolicyVersion = SupportAuthorityAttestation.PolicyVersionCurrent;
        row.UpdatedAt = now;
        if (existing is null) _db.SupportAuthorityAttestations.Add(row);
        await _db.SaveChangesAsync(ct);

        await WriteEventAsync(row, eventType, decisionBefore, "active", null, staffUserId, ct);
        await AuditAsync(staffUserId, row.SupportedUserId, "support_authority_attested",
            new { attestation_id = row.Id, relationship_id = relationshipId, authority_type = authorityType });
        return new { id = row.Id, decision = row.Decision, authority_type = row.AuthorityType };
    }

    public async Task<bool> RevokeAsync(
        int staffUserId, long attestationId, string reasonCode, CancellationToken ct)
    {
        _errors.Clear();
        if (!SupportAuthorityAttestation.RevocationReasonCodes.Contains(reasonCode))
        {
            _errors.Add(new { code = "VALIDATION_ERROR", message = "Choose a revocation reason from the list" });
            return false;
        }

        var row = await _db.SupportAuthorityAttestations
            .FirstOrDefaultAsync(a => a.Id == attestationId && a.Decision == "active", ct);
        if (row is null)
        {
            _errors.Add(new { code = "NOT_FOUND", message = "Relationship not found, or not active" });
            return false;
        }

        var now = DateTime.UtcNow;
        row.Decision = "revoked";
        row.RevokedBy = staffUserId;
        row.RevokedAt = now;
        row.RevocationReasonCode = reasonCode;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        // The row is never deleted; re-attesting flips it back to active.
        // Revocation does NOT touch the relationship's tiers — the record is
        // not the authorisation.
        await WriteEventAsync(row, "revoked", "active", "revoked", reasonCode, staffUserId, ct);
        await AuditAsync(staffUserId, row.SupportedUserId, "support_authority_revoked",
            new { attestation_id = row.Id, reason_code = reasonCode });
        return true;
    }

    private string? EncryptOrNull(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        if (trimmed.Length > 2000) trimmed = trimmed[..2000];
        return _encryption.Encrypt(trimmed);
    }

    /// <summary>An undecryptable value must read as absent, never as ciphertext.</summary>
    private string? Decrypt(string? encrypted)
    {
        if (string.IsNullOrEmpty(encrypted)) return null;
        try
        {
            return _encryption.Decrypt(encrypted);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[AuthorityAttestation] decryption failed; presenting as absent");
            return null;
        }
    }

    private async Task WriteEventAsync(
        SupportAuthorityAttestation attestation, string eventType, string? decisionBefore,
        string decisionAfter, string? reasonCode, int actorUserId, CancellationToken ct)
    {
        var record = new SupportAuthorityAttestationEvent
        {
            TenantId = attestation.TenantId,
            AttestationId = attestation.Id,
            RelationshipId = attestation.RelationshipId,
            SupportedUserId = attestation.SupportedUserId,
            EventType = eventType,
            DecisionBefore = decisionBefore,
            DecisionAfter = decisionAfter,
            ReasonCode = reasonCode,
            ActorUserId = actorUserId,
            PolicyVersion = attestation.PolicyVersion,
            CreatedAt = DateTime.UtcNow
        };
        try
        {
            _db.SupportAuthorityAttestationEvents.Add(record);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _db.Entry(record).State = EntityState.Detached;
            _logger.LogWarning(ex, "[AuthorityAttestation] event append failed");
        }
    }

    private async Task AuditAsync(int actorUserId, int targetUserId, string action, object details)
    {
        try
        {
            await _audit.LogAsync(actorUserId, action, "support_authority_attestation", null,
                null, null, null, null,
                JsonSerializer.Serialize(new { target_user_id = targetUserId, details }));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[AuthorityAttestation] audit write failed for {Action}", action);
        }
    }
}
