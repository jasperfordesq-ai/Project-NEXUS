// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringRecipientCircleService
{
    private static readonly string[] ClosedHelpRequestStatuses = ["matched", "cancelled", "closed"];

    private readonly NexusDbContext _db;

    public CaringRecipientCircleService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<RecipientCircleEnvelope?> GetCircleAsync(
        int tenantId,
        int recipientUserId,
        CancellationToken ct)
    {
        var recipient = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.Id == recipientUserId && user.TenantId == tenantId, ct);

        if (recipient is null)
        {
            return null;
        }

        var relationshipRows = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(relationship =>
                relationship.TenantId == tenantId
                && relationship.RecipientId == recipientUserId
                && relationship.Status == "active")
            .Join(
                _db.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.TenantId == tenantId),
                relationship => relationship.SupporterId,
                supporter => supporter.Id,
                (relationship, supporter) => new { relationship, supporter })
            .OrderBy(row => row.relationship.Id)
            .ToListAsync(ct);

        var relationshipIds = relationshipRows
            .Select(row => row.relationship.Id)
            .ToArray();

        var hoursByRelationship = relationshipIds.Length == 0
            ? new Dictionary<int, decimal>()
            : await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(log =>
                    log.TenantId == tenantId
                    && log.Status == "approved"
                    && log.CaringSupportRelationshipId.HasValue
                    && relationshipIds.Contains(log.CaringSupportRelationshipId.Value))
                .GroupBy(log => log.CaringSupportRelationshipId!.Value)
                .Select(group => new
                {
                    RelationshipId = group.Key,
                    Hours = group.Sum(log => log.Hours)
                })
                .ToDictionaryAsync(row => row.RelationshipId, row => row.Hours, ct);

        var relationships = relationshipRows
            .Select(row =>
            {
                var hours = hoursByRelationship.TryGetValue(row.relationship.Id, out var logged)
                    ? logged
                    : 0m;
                return new RecipientCircleRelationship(
                    Id: row.relationship.Id,
                    Supporter: new RecipientCircleSupporter(
                        Id: row.supporter.Id,
                        Name: DisplayName(row.supporter),
                        TrustTier: row.supporter.TrustTier),
                    Type: row.relationship.Frequency,
                    HoursLogged: hours,
                    LastActivityAt: Iso8601OrNull(row.relationship.LastLoggedAt),
                    Status: row.relationship.Status);
            })
            .ToArray();

        var openHelpRequests = await _db.CaringHelpRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(request =>
                request.TenantId == tenantId
                && request.UserId == recipientUserId
                && !ClosedHelpRequestStatuses.Contains(request.Status), ct);

        var safeguardingFlags = await _db.SafeguardingReports
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(report =>
                report.TenantId == tenantId
                && report.SubjectUserId == recipientUserId, ct);

        return new RecipientCircleEnvelope(
            Recipient: new RecipientCircleRecipient(
                Id: recipient.Id,
                Name: DisplayName(recipient),
                TrustTier: recipient.TrustTier,
                MemberSince: recipient.CreatedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            SupportRelationships: relationships,
            TotalHoursReceived: relationships.Sum(row => row.HoursLogged),
            OpenHelpRequests: openHelpRequests,
            SafeguardingFlags: safeguardingFlags);
    }

    private static string DisplayName(User user)
    {
        return string.Join(' ', new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    private static string? Iso8601OrNull(DateTime? value)
    {
        if (value is null)
        {
            return null;
        }

        var utc = value.Value.Kind == DateTimeKind.Utc
            ? value.Value
            : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc).ToUniversalTime();

        return utc.ToString("yyyy-MM-dd'T'HH:mm:ss+00:00", CultureInfo.InvariantCulture);
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }
}

public sealed record RecipientCircleEnvelope(
    [property: JsonPropertyName("recipient")] RecipientCircleRecipient Recipient,
    [property: JsonPropertyName("support_relationships")] IReadOnlyList<RecipientCircleRelationship> SupportRelationships,
    [property: JsonPropertyName("total_hours_received")] decimal TotalHoursReceived,
    [property: JsonPropertyName("open_help_requests")] int OpenHelpRequests,
    [property: JsonPropertyName("safeguarding_flags")] int SafeguardingFlags);

public sealed record RecipientCircleRecipient(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("trust_tier")] int TrustTier,
    [property: JsonPropertyName("member_since")] string MemberSince);

public sealed record RecipientCircleRelationship(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("supporter")] RecipientCircleSupporter Supporter,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("hours_logged")] decimal HoursLogged,
    [property: JsonPropertyName("last_activity_at")] string? LastActivityAt,
    [property: JsonPropertyName("status")] string Status);

public sealed record RecipientCircleSupporter(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("trust_tier")] int TrustTier);
