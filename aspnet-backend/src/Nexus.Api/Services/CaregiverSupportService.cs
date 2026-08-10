// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaregiverSupportService
{
    private static readonly string[] RelationshipTypes = ["family", "friend", "neighbour", "professional"];
    private const decimal BurnoutThresholdHoursPerWeek = 20m;

    private readonly NexusDbContext _db;

    public CaregiverSupportService(NexusDbContext db, TenantContext tenantContext)
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

    public bool IsAvailable()
    {
        return _db.Model.FindEntityType(typeof(CaringCaregiverLink)) is not null;
    }

    public bool CoverRequestsAvailable()
    {
        return _db.Model.FindEntityType(typeof(CaringCoverRequest)) is not null;
    }

    public async Task<IReadOnlyList<CaregiverLinkRow>> GetLinksForCaregiverAsync(
        int tenantId,
        int caregiverId,
        CancellationToken ct)
    {
        var rows = await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(link =>
                link.TenantId == tenantId
                && link.CaregiverId == caregiverId
                && link.Status == "active")
            .Join(
                _db.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.TenantId == tenantId),
                link => link.CaredForId,
                user => user.Id,
                (link, user) => new { link, user })
            .OrderByDescending(row => row.link.IsPrimary)
            .ThenBy(row => row.link.StartDate)
            .ToListAsync(ct);

        return rows.Select(row => Map(row.link, row.user)).ToArray();
    }

    public async Task<CaregiverLinkMutationResult> CreateLinkAsync(
        int tenantId,
        int caregiverId,
        CaregiverLinkRequest request,
        CancellationToken ct)
    {
        if (request.CaredForId is null)
        {
            return new CaregiverLinkMutationResult(
                ErrorCode: "VALIDATION_ERROR",
                ErrorMessage: "Missing required field: cared_for_id.",
                ErrorField: "cared_for_id");
        }

        if (!IsAllowedRelationship(request.RelationshipType))
        {
            return new CaregiverLinkMutationResult(
                ErrorCode: "VALIDATION_ERROR",
                ErrorMessage: "Relationship type is invalid.",
                ErrorField: "relationship_type");
        }

        if (string.IsNullOrWhiteSpace(request.StartDate)
            || !DateOnly.TryParse(request.StartDate, out var startDate))
        {
            return new CaregiverLinkMutationResult(
                ErrorCode: "VALIDATION_ERROR",
                ErrorMessage: "Missing required field: start_date.",
                ErrorField: "start_date");
        }

        var caredForId = request.CaredForId.Value;
        if (caregiverId == caredForId)
        {
            return new CaregiverLinkMutationResult(
                ErrorCode: "CONFLICT",
                ErrorMessage: "A caregiver cannot link to themselves.");
        }

        if (!await UserBelongsToTenantAsync(caregiverId, tenantId, ct)
            || !await UserBelongsToTenantAsync(caredForId, tenantId, ct))
        {
            return new CaregiverLinkMutationResult(
                ErrorCode: "CONFLICT",
                ErrorMessage: "User was not found in this tenant.");
        }

        var existing = await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(link =>
                link.TenantId == tenantId
                && link.CaregiverId == caregiverId
                && link.CaredForId == caredForId
                && (link.Status == "pending" || link.Status == "active"), ct);
        if (existing)
        {
            return new CaregiverLinkMutationResult(
                ErrorCode: "CONFLICT",
                ErrorMessage: "Caregiver link already exists.");
        }

        var now = DateTime.UtcNow;
        var link = new CaringCaregiverLink
        {
            TenantId = tenantId,
            CaregiverId = caregiverId,
            CaredForId = caredForId,
            RelationshipType = request.RelationshipType!,
            IsPrimary = request.IsPrimary ?? false,
            StartDate = startDate,
            Notes = request.Notes,
            Status = "pending",
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringCaregiverLinks.Add(link);
        await _db.SaveChangesAsync(ct);
        return new CaregiverLinkMutationResult(Row: Map(link, null));
    }

    public async Task<CaregiverLinkDeleteResult> RemoveLinkAsync(
        int tenantId,
        int caregiverId,
        int linkId,
        CancellationToken ct)
    {
        var link = await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.CaregiverId == caregiverId
                && row.Id == linkId, ct);

        if (link is null)
        {
            return new CaregiverLinkDeleteResult(NotFound: true);
        }

        link.Status = "inactive";
        link.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaregiverLinkDeleteResult(Ok: true);
    }

    public async Task<bool> HasActiveLinkAsync(
        int tenantId,
        int caregiverId,
        int caredForId,
        CancellationToken ct)
    {
        return await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .AnyAsync(link =>
                link.TenantId == tenantId
                && link.CaregiverId == caregiverId
                && link.CaredForId == caredForId
                && link.Status == "active", ct);
    }

    public async Task<CaregiverBurnoutRisk> CheckBurnoutRiskAsync(
        int tenantId,
        int caregiverId,
        CancellationToken ct)
    {
        var since = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-7));
        var weeklyHours = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(log =>
                log.TenantId == tenantId
                && log.UserId == caregiverId
                && log.DateLogged >= since
                && (log.Status == "approved" || log.Status == "pending"))
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;

        var riskLevel = weeklyHours >= BurnoutThresholdHoursPerWeek
            ? "high"
            : weeklyHours >= BurnoutThresholdHoursPerWeek * 0.5m
                ? "moderate"
                : "none";

        return new CaregiverBurnoutRisk(
            WeeklyHours: weeklyHours,
            Threshold: BurnoutThresholdHoursPerWeek,
            AtRisk: weeklyHours >= BurnoutThresholdHoursPerWeek * 0.5m,
            RiskLevel: riskLevel);
    }

    public async Task<CaregiverHelpRequestMutationResult> CreateRequestOnBehalfAsync(
        int tenantId,
        int caregiverId,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct)
    {
        var caredForId = IntValue(data, "cared_for_id");
        if (caredForId <= 0)
        {
            return CaregiverHelpRequestMutationResult.Validation(
                "Missing required field: cared_for_id.",
                "cared_for_id");
        }

        var title = StringValue(data, "title").Trim();
        if (title.Length == 0)
        {
            return CaregiverHelpRequestMutationResult.Validation(
                "Missing required field: title.",
                "title");
        }

        var hasActiveLink = await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(link =>
                link.TenantId == tenantId
                && link.CaregiverId == caregiverId
                && link.CaredForId == caredForId
                && link.Status == "active", ct);
        if (!hasActiveLink)
        {
            return CaregiverHelpRequestMutationResult.Forbidden("Active caregiver link required.");
        }

        var description = StringValue(data, "description").Trim();
        var what = description.Length == 0 ? title : $"{title}\n\n{description}";
        var whenNeeded = StringValue(data, "when_needed").Trim();
        if (whenNeeded.Length == 0)
        {
            whenNeeded = "As soon as practical";
        }

        var now = DateTime.UtcNow;
        var request = new CaringHelpRequest
        {
            TenantId = tenantId,
            UserId = caredForId,
            RequestedById = caregiverId,
            IsOnBehalf = true,
            What = what,
            WhenNeeded = whenNeeded,
            ContactPreference = NormalizeContactPreference(StringValue(data, "contact_preference")),
            Status = "pending",
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringHelpRequests.Add(request);
        await _db.SaveChangesAsync(ct);

        return new CaregiverHelpRequestMutationResult(Row: MapHelpRequest(request));
    }

    public async Task<CaregiverScheduleDto> GetScheduleForCaredForAsync(
        int tenantId,
        int caredForId,
        CancellationToken ct)
    {
        var relationships = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(relationship =>
                relationship.TenantId == tenantId
                && relationship.RecipientId == caredForId
                && relationship.Status == "active")
            .Join(
                _db.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.TenantId == tenantId),
                relationship => relationship.SupporterId,
                user => user.Id,
                (relationship, user) => new { relationship, user })
            .OrderBy(row => row.relationship.NextCheckInAt)
            .ThenBy(row => row.relationship.Id)
            .ToListAsync(ct);

        var since = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30));
        var recentLogs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log =>
                log.TenantId == tenantId
                && log.SupportRecipientId == caredForId
                && log.DateLogged >= since)
            .Join(
                _db.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.TenantId == tenantId),
                log => log.UserId,
                user => user.Id,
                (log, user) => new { log, user })
            .OrderByDescending(row => row.log.DateLogged)
            .ThenByDescending(row => row.log.Id)
            .Take(20)
            .ToListAsync(ct);

        return new CaregiverScheduleDto(
            relationships.Select(row => new CaregiverScheduleRelationship(
                Id: row.relationship.Id,
                Title: row.relationship.Title,
                Frequency: row.relationship.Frequency,
                ExpectedHours: row.relationship.ExpectedHours,
                NextCheckInAt: row.relationship.NextCheckInAt,
                StartDate: row.relationship.StartDate,
                SupporterId: row.user.Id,
                SupporterName: FullName(row.user),
                SupporterAvatarUrl: row.user.AvatarUrl)).ToArray(),
            recentLogs.Select(row => new CaregiverScheduleLog(
                Id: row.log.Id,
                Date: row.log.DateLogged,
                Hours: row.log.Hours,
                Status: row.log.Status,
                SupporterId: row.user.Id,
                SupporterName: FullName(row.user),
                SupporterAvatarUrl: row.user.AvatarUrl)).ToArray());
    }

    public async Task<IReadOnlyList<CaregiverCoverRequestRow>> GetCoverRequestsForCaregiverAsync(
        int tenantId,
        int caregiverId,
        CancellationToken ct)
    {
        EnsureCoverRequestsAvailable();

        var requests = await _db.CaringCoverRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(request => request.TenantId == tenantId && request.CaregiverId == caregiverId)
            .ToListAsync(ct);

        var userIds = requests
            .SelectMany(request => new[] { request.CaredForId, request.MatchedSupporterId ?? 0 })
            .Where(id => id > 0)
            .Distinct()
            .ToArray();

        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user, ct);

        return requests
            .OrderBy(request => CoverStatusRank(request.Status))
            .ThenBy(request => request.StartsAt)
            .Select(request => MapCoverRequest(
                request,
                users.GetValueOrDefault(request.CaredForId),
                request.MatchedSupporterId is int supporterId ? users.GetValueOrDefault(supporterId) : null))
            .ToArray();
    }

    public async Task<CaregiverCoverRequestMutationResult> CreateCoverRequestAsync(
        int tenantId,
        int caregiverId,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct)
    {
        EnsureCoverRequestsAvailable();

        var caredForId = IntValue(data, "cared_for_id");
        if (caredForId <= 0)
        {
            return CaregiverCoverRequestMutationResult.Validation(
                "Missing required field: cared_for_id.",
                "cared_for_id");
        }

        var link = await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.CaregiverId == caregiverId
                && row.CaredForId == caredForId
                && row.Status == "active", ct);
        if (link is null)
        {
            return CaregiverCoverRequestMutationResult.Forbidden("Active caregiver link required.");
        }

        var title = StringValue(data, "title").Trim();
        if (title.Length == 0)
        {
            return CaregiverCoverRequestMutationResult.Validation(
                "Missing required field: title.",
                "title");
        }

        var startsAtRaw = StringValue(data, "starts_at").Trim();
        var endsAtRaw = StringValue(data, "ends_at").Trim();
        if (startsAtRaw.Length == 0 || endsAtRaw.Length == 0)
        {
            return CaregiverCoverRequestMutationResult.Validation("Cover request start and end dates are required.");
        }

        if (!TryParseDateTime(startsAtRaw, out var startsAt)
            || !TryParseDateTime(endsAtRaw, out var endsAt)
            || endsAt <= startsAt)
        {
            return CaregiverCoverRequestMutationResult.Validation("Cover request dates are invalid.");
        }

        var supportRelationshipId = IntNullable(data, "support_relationship_id");
        if (supportRelationshipId is int relationshipId)
        {
            var relationshipExists = await _db.CaringSupportRelationships
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(row =>
                    row.TenantId == tenantId
                    && row.Id == relationshipId
                    && row.RecipientId == caredForId, ct);
            if (!relationshipExists)
            {
                return CaregiverCoverRequestMutationResult.Validation("Cover request relationship was not found.");
            }
        }

        var requiredSkills = SkillsValue(data, "required_skills");
        var expectedHours = DecimalNullable(data, "expected_hours");
        if (expectedHours is decimal hours)
        {
            expectedHours = Math.Clamp(hours, 0.25m, 999.99m);
        }

        var minimumTrustTier = Math.Clamp(IntValue(data, "minimum_trust_tier", 1), 0, 5);
        var urgency = StringValue(data, "urgency").Trim();
        if (urgency is not ("planned" or "soon" or "urgent"))
        {
            urgency = "planned";
        }

        var now = DateTime.UtcNow;
        var request = new CaringCoverRequest
        {
            TenantId = tenantId,
            CaregiverLinkId = link.Id,
            CaregiverId = caregiverId,
            CaredForId = caredForId,
            SupportRelationshipId = supportRelationshipId,
            Title = title.Length <= 255 ? title : title[..255],
            Briefing = NullIfWhiteSpace(StringValue(data, "briefing")),
            RequiredSkillsJson = JsonSerializer.Serialize(requiredSkills),
            StartsAt = startsAt,
            EndsAt = endsAt,
            ExpectedHours = expectedHours,
            MinimumTrustTier = minimumTrustTier,
            Urgency = urgency,
            Status = "open",
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringCoverRequests.Add(request);
        await _db.SaveChangesAsync(ct);

        var caredFor = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.TenantId == tenantId && user.Id == caredForId, ct);

        return new CaregiverCoverRequestMutationResult(Row: MapCoverRequest(request, caredFor, null));
    }

    public async Task<CaregiverCoverCandidatesResult> SuggestCoverCandidatesAsync(
        int tenantId,
        int caregiverId,
        int coverRequestId,
        CancellationToken ct)
    {
        EnsureCoverRequestsAvailable();

        var request = await _db.CaringCoverRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.CaregiverId == caregiverId
                && row.Id == coverRequestId, ct);

        if (request is null)
        {
            return new CaregiverCoverCandidatesResult(NotFound: true);
        }

        var busySupporterIds = await _db.CaringCoverRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row =>
                row.TenantId == tenantId
                && row.MatchedSupporterId.HasValue
                && (row.Status == "matched" || row.Status == "accepted")
                && row.StartsAt < request.EndsAt
                && row.EndsAt > request.StartsAt)
            .Select(row => row.MatchedSupporterId!.Value)
            .Distinct()
            .ToListAsync(ct);

        var requiredSkills = ParseSkills(request.RequiredSkillsJson)
            .Select(skill => skill.ToLowerInvariant())
            .ToHashSet(StringComparer.Ordinal);

        var candidates = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user =>
                user.TenantId == tenantId
                && user.IsActive
                && user.Id != request.CaregiverId
                && user.Id != request.CaredForId
                && user.TrustTier >= request.MinimumTrustTier
                && !busySupporterIds.Contains(user.Id))
            .ToListAsync(ct);

        var rows = candidates
            .Select(candidate => MapCandidate(candidate, requiredSkills))
            .OrderByDescending(candidate => candidate.MatchScore)
            .ThenBy(candidate => candidate.Name, StringComparer.OrdinalIgnoreCase)
            .Take(12)
            .ToArray();

        return new CaregiverCoverCandidatesResult(Rows: rows);
    }

    public async Task<CaregiverCoverRequestMutationResult> AssignCoverCandidateAsync(
        int tenantId,
        int caregiverId,
        int coverRequestId,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct)
    {
        EnsureCoverRequestsAvailable();

        var supporterId = IntValue(data, "supporter_id");
        if (supporterId <= 0)
        {
            return CaregiverCoverRequestMutationResult.Validation(
                "Missing required field: supporter_id.",
                "supporter_id");
        }

        var candidates = await SuggestCoverCandidatesAsync(tenantId, caregiverId, coverRequestId, ct);
        if (candidates.NotFound)
        {
            return CaregiverCoverRequestMutationResult.NotFound("Cover request not found.");
        }

        if (candidates.Rows?.Any(row => row.Id == supporterId) != true)
        {
            return CaregiverCoverRequestMutationResult.Validation("Cover request candidate is invalid.");
        }

        var request = await _db.CaringCoverRequests
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.CaregiverId == caregiverId
                && row.Id == coverRequestId, ct);
        if (request is null)
        {
            return CaregiverCoverRequestMutationResult.NotFound("Cover request not found.");
        }

        var now = DateTime.UtcNow;
        request.MatchedSupporterId = supporterId;
        request.Status = "matched";
        request.MatchedAt = now;
        request.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        var userIds = new[] { request.CaredForId, supporterId };
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user, ct);

        return new CaregiverCoverRequestMutationResult(Row: MapCoverRequest(
            request,
            users.GetValueOrDefault(request.CaredForId),
            users.GetValueOrDefault(supporterId)));
    }

    private async Task<bool> UserBelongsToTenantAsync(int userId, int tenantId, CancellationToken ct)
    {
        return await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.Id == userId && user.TenantId == tenantId, ct);
    }

    private void EnsureCoverRequestsAvailable()
    {
        if (!CoverRequestsAvailable())
        {
            throw new InvalidOperationException("Caregiver cover requests are unavailable.");
        }
    }

    private static CaregiverCoverRequestRow MapCoverRequest(
        CaringCoverRequest request,
        User? caredFor,
        User? matchedSupporter)
    {
        return new CaregiverCoverRequestRow(
            Id: request.Id,
            TenantId: request.TenantId,
            CaregiverLinkId: request.CaregiverLinkId,
            CaregiverId: request.CaregiverId,
            CaredForId: request.CaredForId,
            CaredForName: caredFor is null ? string.Empty : FullName(caredFor),
            CaredForAvatarUrl: caredFor?.AvatarUrl,
            SupportRelationshipId: request.SupportRelationshipId,
            MatchedSupporterId: request.MatchedSupporterId,
            MatchedSupporterName: matchedSupporter is null ? null : FullName(matchedSupporter),
            MatchedSupporterAvatarUrl: matchedSupporter?.AvatarUrl,
            Title: request.Title,
            Briefing: request.Briefing,
            RequiredSkills: ParseSkills(request.RequiredSkillsJson),
            StartsAt: request.StartsAt,
            EndsAt: request.EndsAt,
            ExpectedHours: request.ExpectedHours,
            MinimumTrustTier: request.MinimumTrustTier,
            Urgency: request.Urgency,
            Status: request.Status,
            MatchedAt: request.MatchedAt,
            CreatedAt: request.CreatedAt,
            UpdatedAt: request.UpdatedAt);
    }

    private static CaregiverCoverCandidateRow MapCandidate(
        User user,
        IReadOnlySet<string> requiredSkills)
    {
        var skills = Array.Empty<string>();
        var skillMatches = skills.Count(skill => requiredSkills.Contains(skill.ToLowerInvariant()));
        const string verificationStatus = "unknown";
        var matchScore = (user.TrustTier * 10) + (skillMatches * 5);

        return new CaregiverCoverCandidateRow(
            Id: user.Id,
            Name: FullName(user),
            AvatarUrl: user.AvatarUrl,
            Location: null,
            TrustTier: user.TrustTier,
            VerificationStatus: verificationStatus,
            Skills: skills,
            SkillMatches: skillMatches,
            MatchScore: matchScore);
    }

    private static int CoverStatusRank(string status)
    {
        return status switch
        {
            "open" => 0,
            "matched" => 1,
            "accepted" => 2,
            _ => 3
        };
    }

    private static IReadOnlyList<string> ParseSkills(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(raw)
                ?.Where(skill => !string.IsNullOrWhiteSpace(skill))
                .Select(skill => skill.Trim())
                .ToArray()
                ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static IReadOnlyList<string> SkillsValue(
        IReadOnlyDictionary<string, object?> data,
        string key)
    {
        if (!data.TryGetValue(key, out var value) || value is null)
        {
            return [];
        }

        if (value is JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => SplitSkills(element.GetString()),
                JsonValueKind.Array => element.EnumerateArray()
                    .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
                    .Where(item => !string.IsNullOrWhiteSpace(item))
                    .Select(item => item!.Trim())
                    .ToArray(),
                _ => []
            };
        }

        if (value is string raw)
        {
            return SplitSkills(raw);
        }

        if (value is IEnumerable<string> strings)
        {
            return strings
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item.Trim())
                .ToArray();
        }

        if (value is IEnumerable<object?> objects)
        {
            return objects
                .Select(item => item?.ToString())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!.Trim())
                .ToArray();
        }

        return [];
    }

    private static IReadOnlyList<string> SplitSkills(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        return raw
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(skill => skill.Length > 0)
            .ToArray();
    }

    private static int IntValue(
        IReadOnlyDictionary<string, object?> data,
        string key,
        int defaultValue = 0)
    {
        return IntNullable(data, key) ?? defaultValue;
    }

    private static int? IntNullable(IReadOnlyDictionary<string, object?> data, string key)
    {
        if (!data.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            int typed => typed,
            long typed when typed >= int.MinValue && typed <= int.MaxValue => (int)typed,
            decimal typed when typed >= int.MinValue && typed <= int.MaxValue => (int)typed,
            double typed when typed >= int.MinValue && typed <= int.MaxValue => (int)typed,
            float typed when typed >= int.MinValue && typed <= int.MaxValue => (int)typed,
            string raw when int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            JsonElement element => IntFromJson(element),
            _ => null
        };
    }

    private static int? IntFromJson(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var parsed))
        {
            return parsed;
        }

        if (element.ValueKind == JsonValueKind.String
            && int.TryParse(element.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
        {
            return parsed;
        }

        return null;
    }

    private static decimal? DecimalNullable(IReadOnlyDictionary<string, object?> data, string key)
    {
        if (!data.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            decimal typed => typed,
            int typed => typed,
            long typed => typed,
            double typed => (decimal)typed,
            float typed => (decimal)typed,
            string raw when decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            JsonElement element => DecimalFromJson(element),
            _ => null
        };
    }

    private static decimal? DecimalFromJson(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out var parsed))
        {
            return parsed;
        }

        if (element.ValueKind == JsonValueKind.String
            && decimal.TryParse(element.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out parsed))
        {
            return parsed;
        }

        return null;
    }

    private static string StringValue(IReadOnlyDictionary<string, object?> data, string key)
    {
        if (!data.TryGetValue(key, out var value) || value is null)
        {
            return string.Empty;
        }

        return value is JsonElement element
            ? element.ValueKind == JsonValueKind.String ? element.GetString() ?? string.Empty : element.ToString()
            : value.ToString() ?? string.Empty;
    }

    private static bool TryParseDateTime(string raw, out DateTime value)
    {
        return DateTime.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out value);
    }

    private static string? NullIfWhiteSpace(string value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string NormalizeContactPreference(string value)
    {
        return value.Trim() switch
        {
            "phone" or "message" or "either" => value.Trim(),
            _ => "either"
        };
    }

    private static CaregiverHelpRequestRow MapHelpRequest(CaringHelpRequest request)
    {
        return new CaregiverHelpRequestRow(
            Id: request.Id,
            TenantId: request.TenantId,
            UserId: request.UserId,
            What: request.What,
            WhenNeeded: request.WhenNeeded,
            ContactPreference: request.ContactPreference,
            Status: request.Status,
            IsOnBehalf: request.IsOnBehalf,
            RequestedById: request.RequestedById,
            CreatedAt: request.CreatedAt,
            UpdatedAt: request.UpdatedAt);
    }

    private static CaregiverLinkRow Map(CaringCaregiverLink link, User? caredFor)
    {
        return new CaregiverLinkRow(
            Id: link.Id,
            TenantId: link.TenantId,
            CaregiverId: link.CaregiverId,
            CaredForId: link.CaredForId,
            RelationshipType: link.RelationshipType,
            IsPrimary: link.IsPrimary,
            StartDate: link.StartDate,
            Notes: link.Notes,
            Status: link.Status,
            ApprovedBy: link.ApprovedBy,
            CreatedAt: link.CreatedAt,
            UpdatedAt: link.UpdatedAt,
            CaredForName: caredFor is null ? null : FullName(caredFor),
            CaredForAvatarUrl: caredFor?.AvatarUrl);
    }

    private static bool IsAllowedRelationship(string? value)
    {
        return !string.IsNullOrWhiteSpace(value)
            && RelationshipTypes.Contains(value, StringComparer.Ordinal);
    }

    private static string FullName(User user)
    {
        return string.Join(' ', new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
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

public sealed class CaregiverLinkRequest
{
    [JsonPropertyName("cared_for_id")] public int? CaredForId { get; set; }
    [JsonPropertyName("relationship_type")] public string? RelationshipType { get; set; }
    [JsonPropertyName("start_date")] public string? StartDate { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
    [JsonPropertyName("is_primary")] public bool? IsPrimary { get; set; }
}

public sealed record CaregiverLinkRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("caregiver_id")] int CaregiverId,
    [property: JsonPropertyName("cared_for_id")] int CaredForId,
    [property: JsonPropertyName("relationship_type")] string RelationshipType,
    [property: JsonPropertyName("is_primary")] bool IsPrimary,
    [property: JsonPropertyName("start_date")] DateOnly StartDate,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("approved_by")] int? ApprovedBy,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("cared_for_name")] string? CaredForName,
    [property: JsonPropertyName("cared_for_avatar_url")] string? CaredForAvatarUrl);

public sealed record CaregiverLinkMutationResult(
    CaregiverLinkRow? Row = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    string? ErrorField = null);

public sealed record CaregiverLinkDeleteResult(bool Ok = false, bool NotFound = false);

public sealed record CaregiverHelpRequestMutationResult(
    CaregiverHelpRequestRow? Row = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    string? ErrorField = null)
{
    public static CaregiverHelpRequestMutationResult Validation(string message, string? field = null)
    {
        return new CaregiverHelpRequestMutationResult(
            ErrorCode: "VALIDATION_ERROR",
            ErrorMessage: message,
            ErrorField: field);
    }

    public static CaregiverHelpRequestMutationResult Forbidden(string message)
    {
        return new CaregiverHelpRequestMutationResult(
            ErrorCode: "FORBIDDEN",
            ErrorMessage: message);
    }
}

public sealed record CaregiverHelpRequestRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("what")] string What,
    [property: JsonPropertyName("when_needed")] string WhenNeeded,
    [property: JsonPropertyName("contact_preference")] string ContactPreference,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("is_on_behalf")] bool IsOnBehalf,
    [property: JsonPropertyName("requested_by_id")] int? RequestedById,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record CaregiverCoverRequestMutationResult(
    CaregiverCoverRequestRow? Row = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    string? ErrorField = null)
{
    public static CaregiverCoverRequestMutationResult Validation(string message, string? field = null)
    {
        return new CaregiverCoverRequestMutationResult(
            ErrorCode: "VALIDATION_ERROR",
            ErrorMessage: message,
            ErrorField: field);
    }

    public static CaregiverCoverRequestMutationResult Forbidden(string message)
    {
        return new CaregiverCoverRequestMutationResult(
            ErrorCode: "FORBIDDEN",
            ErrorMessage: message);
    }

    public static CaregiverCoverRequestMutationResult NotFound(string message)
    {
        return new CaregiverCoverRequestMutationResult(
            ErrorCode: "NOT_FOUND",
            ErrorMessage: message);
    }
}

public sealed record CaregiverBurnoutRisk(
    [property: JsonPropertyName("weekly_hours")] decimal WeeklyHours,
    [property: JsonPropertyName("threshold")] decimal Threshold,
    [property: JsonPropertyName("at_risk")] bool AtRisk,
    [property: JsonPropertyName("risk_level")] string RiskLevel);

public sealed record CaregiverScheduleDto(
    [property: JsonPropertyName("support_relationships")] IReadOnlyList<CaregiverScheduleRelationship> SupportRelationships,
    [property: JsonPropertyName("recent_logs")] IReadOnlyList<CaregiverScheduleLog> RecentLogs);

public sealed record CaregiverScheduleRelationship(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("frequency")] string Frequency,
    [property: JsonPropertyName("expected_hours")] decimal ExpectedHours,
    [property: JsonPropertyName("next_check_in_at")] DateTime? NextCheckInAt,
    [property: JsonPropertyName("start_date")] DateOnly StartDate,
    [property: JsonPropertyName("supporter_id")] int SupporterId,
    [property: JsonPropertyName("supporter_name")] string SupporterName,
    [property: JsonPropertyName("supporter_avatar_url")] string? SupporterAvatarUrl);

public sealed record CaregiverScheduleLog(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("date")] DateOnly Date,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("supporter_id")] int SupporterId,
    [property: JsonPropertyName("supporter_name")] string SupporterName,
    [property: JsonPropertyName("supporter_avatar_url")] string? SupporterAvatarUrl);

public sealed record CaregiverCoverRequestRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("caregiver_link_id")] int CaregiverLinkId,
    [property: JsonPropertyName("caregiver_id")] int CaregiverId,
    [property: JsonPropertyName("cared_for_id")] int CaredForId,
    [property: JsonPropertyName("cared_for_name")] string CaredForName,
    [property: JsonPropertyName("cared_for_avatar_url")] string? CaredForAvatarUrl,
    [property: JsonPropertyName("support_relationship_id")] int? SupportRelationshipId,
    [property: JsonPropertyName("matched_supporter_id")] int? MatchedSupporterId,
    [property: JsonPropertyName("matched_supporter_name")] string? MatchedSupporterName,
    [property: JsonPropertyName("matched_supporter_avatar_url")] string? MatchedSupporterAvatarUrl,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("briefing")] string? Briefing,
    [property: JsonPropertyName("required_skills")] IReadOnlyList<string> RequiredSkills,
    [property: JsonPropertyName("starts_at")] DateTime StartsAt,
    [property: JsonPropertyName("ends_at")] DateTime EndsAt,
    [property: JsonPropertyName("expected_hours")] decimal? ExpectedHours,
    [property: JsonPropertyName("minimum_trust_tier")] int MinimumTrustTier,
    [property: JsonPropertyName("urgency")] string Urgency,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("matched_at")] DateTime? MatchedAt,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record CaregiverCoverCandidatesResult(
    IReadOnlyList<CaregiverCoverCandidateRow>? Rows = null,
    bool NotFound = false);

public sealed record CaregiverCoverCandidateRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("avatar_url")] string? AvatarUrl,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("trust_tier")] int TrustTier,
    [property: JsonPropertyName("verification_status")] string VerificationStatus,
    [property: JsonPropertyName("skills")] IReadOnlyList<string> Skills,
    [property: JsonPropertyName("skill_matches")] int SkillMatches,
    [property: JsonPropertyName("match_score")] int MatchScore);
