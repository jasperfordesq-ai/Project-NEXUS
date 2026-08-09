// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class KissTreffenService
{
    private static readonly string[] QuorumStatuses = ["going", "attended"];
    private static readonly HashSet<string> TreffenTypes = new(StringComparer.Ordinal)
    {
        "monthly_stamm",
        "annual_general_assembly",
        "governance_circle",
        "cooperative_workshop",
        "other"
    };

    private readonly NexusDbContext _db;

    public KissTreffenService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _ = tenantContext;
    }

    public Task<bool> IsAvailableAsync(CancellationToken ct)
    {
        _ = ct;
        return Task.FromResult(true);
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

    public async Task<IReadOnlyList<KissTreffenRow>> ListAsync(
        int tenantId,
        int perPage,
        CancellationToken ct)
    {
        var limit = Math.Clamp(perPage, 1, 100);
        var rows = await _db.CaringKissTreffen
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.EventId != null)
            .ToListAsync(ct);

        var eventIds = rows
            .Select(row => row.EventId!.Value)
            .Distinct()
            .ToArray();

        var events = await _db.Events
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && eventIds.Contains(row.Id) && !row.IsCancelled)
            .ToDictionaryAsync(row => row.Id, ct);

        var users = await LoadUsersAsync(tenantId, events.Values.Select(row => row.CreatedById), ct);
        var quorum = await LoadQuorumCountsAsync(tenantId, events.Keys, ct);

        return rows
            .Where(row => row.EventId != null && events.ContainsKey(row.EventId.Value))
            .OrderBy(row => events[row.EventId!.Value].StartsAt)
            .Take(limit)
            .Select(row => Map(row, events[row.EventId!.Value], users, quorum))
            .ToArray();
    }

    public async Task<KissTreffenRow?> GetByEventIdAsync(
        int tenantId,
        int eventId,
        CancellationToken ct)
    {
        var row = await _db.CaringKissTreffen
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.EventId == eventId, ct);

        if (row is null)
        {
            return null;
        }

        var eventRow = await _db.Events
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.Id == eventId, ct);

        if (eventRow is null)
        {
            return null;
        }

        var users = await LoadUsersAsync(tenantId, [eventRow.CreatedById], ct);
        var quorum = await LoadQuorumCountsAsync(tenantId, [eventId], ct);
        return Map(row, eventRow, users, quorum);
    }

    public async Task<KissTreffenRow> UpsertAsync(
        int tenantId,
        int eventId,
        string? treffenType,
        bool? membersOnly,
        int? quorumRequired,
        string? fondationHeader,
        string? minutesDocumentUrl,
        string? coordinatorNotes,
        CancellationToken ct)
    {
        var eventExists = await _db.Events
            .IgnoreQueryFilters()
            .AnyAsync(item => item.TenantId == tenantId && item.Id == eventId, ct);

        if (!eventExists)
        {
            throw new InvalidOperationException("Event not found.");
        }

        var type = string.IsNullOrEmpty(treffenType) ? "monthly_stamm" : treffenType;
        if (!TreffenTypes.Contains(type))
        {
            throw new ArgumentException("Invalid Caring Community Treffen type.", nameof(treffenType));
        }

        if (quorumRequired is < 0)
        {
            throw new ArgumentException("Invalid integer field: quorum_required.", nameof(quorumRequired));
        }

        var row = await _db.CaringKissTreffen
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.EventId == eventId, ct);

        var now = DateTime.UtcNow;
        if (row is null)
        {
            row = new CaringKissTreffen
            {
                TenantId = tenantId,
                EventId = eventId,
                CreatedAt = now
            };
            _db.CaringKissTreffen.Add(row);
        }

        row.TreffenType = type;
        row.MembersOnly = membersOnly ?? true;
        row.QuorumRequired = quorumRequired;
        row.FondationHeader = OptionalString(fondationHeader, 255);
        row.MinutesDocumentUrl = OptionalString(minutesDocumentUrl, 512);
        row.CoordinatorNotes = OptionalString(coordinatorNotes, 2000);
        row.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);

        var mapped = await GetByEventIdAsync(tenantId, eventId, ct);
        if (mapped is null)
        {
            throw new InvalidOperationException("Caring Community Treffen meeting record not found.");
        }

        return mapped;
    }

    public async Task<KissTreffenRow?> RecordMinutesAsync(
        int tenantId,
        int eventId,
        int actorId,
        string? minutesDocumentUrl,
        string? coordinatorNotes,
        CancellationToken ct)
    {
        var minutesUrl = OptionalString(minutesDocumentUrl, 512);
        if (minutesUrl is null)
        {
            throw new ArgumentException("Minutes document URL is required.", nameof(minutesDocumentUrl));
        }

        var row = await _db.CaringKissTreffen
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.EventId == eventId, ct);

        if (row is null)
        {
            throw new InvalidOperationException("Caring Community Treffen meeting record not found.");
        }

        var now = DateTime.UtcNow;
        row.MinutesDocumentUrl = minutesUrl;
        row.MinutesUploadedAt = now;
        row.MinutesUploadedBy = actorId;
        row.CoordinatorNotes = OptionalString(coordinatorNotes, 2000);
        row.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);

        var mapped = await GetByEventIdAsync(tenantId, eventId, ct);
        if (mapped is null)
        {
            throw new InvalidOperationException("Caring Community Treffen meeting record not found.");
        }

        return mapped;
    }

    private async Task<IReadOnlyDictionary<int, User>> LoadUsersAsync(
        int tenantId,
        IEnumerable<int> userIds,
        CancellationToken ct)
    {
        var ids = userIds.Where(id => id > 0).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return new Dictionary<int, User>();
        }

        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && ids.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, ct);
    }

    private async Task<IReadOnlyDictionary<int, int>> LoadQuorumCountsAsync(
        int tenantId,
        IEnumerable<int> eventIds,
        CancellationToken ct)
    {
        var ids = eventIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return new Dictionary<int, int>();
        }

        var rows = await _db.EventRsvps
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId
                && ids.Contains(row.EventId)
                && QuorumStatuses.Contains(row.Status))
            .ToListAsync(ct);

        return rows
            .GroupBy(row => row.EventId)
            .ToDictionary(group => group.Key, group => group.Count());
    }

    private static KissTreffenRow Map(
        CaringKissTreffen row,
        Event eventRow,
        IReadOnlyDictionary<int, User> users,
        IReadOnlyDictionary<int, int> quorumCounts)
    {
        users.TryGetValue(eventRow.CreatedById, out var organizer);
        quorumCounts.TryGetValue(eventRow.Id, out var current);

        return new KissTreffenRow(
            Id: row.Id,
            TenantId: row.TenantId,
            EventId: eventRow.Id,
            TreffenType: row.TreffenType,
            MembersOnly: row.MembersOnly,
            FondationHeader: row.FondationHeader,
            MinutesDocumentUrl: row.MinutesDocumentUrl,
            MinutesUploadedAt: row.MinutesUploadedAt,
            MinutesUploadedBy: row.MinutesUploadedBy,
            CoordinatorNotes: row.CoordinatorNotes,
            Event: new KissTreffenEventRow(
                Id: eventRow.Id,
                Title: eventRow.Title,
                Description: eventRow.Description ?? string.Empty,
                Location: eventRow.Location,
                StartTime: eventRow.StartsAt,
                EndTime: eventRow.EndsAt,
                Status: eventRow.IsCancelled ? "cancelled" : "active",
                OrganizerName: DisplayName(organizer)),
            Quorum: new KissTreffenQuorumRow(
                Required: row.QuorumRequired,
                Current: current,
                Met: row.QuorumRequired is null ? null : current >= row.QuorumRequired.Value));
    }

    private static string? DisplayName(User? user)
    {
        if (user is null)
        {
            return null;
        }

        return $"{user.FirstName} {user.LastName}".Trim();
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

    private static string? OptionalString(string? value, int maxLength)
    {
        if (value is null)
        {
            return null;
        }

        var trimmed = value.Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }
}

public sealed record KissTreffenRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("event_id")] int EventId,
    [property: JsonPropertyName("treffen_type")] string TreffenType,
    [property: JsonPropertyName("members_only")] bool MembersOnly,
    [property: JsonPropertyName("fondation_header")] string? FondationHeader,
    [property: JsonPropertyName("minutes_document_url")] string? MinutesDocumentUrl,
    [property: JsonPropertyName("minutes_uploaded_at")] DateTime? MinutesUploadedAt,
    [property: JsonPropertyName("minutes_uploaded_by")] int? MinutesUploadedBy,
    [property: JsonPropertyName("coordinator_notes")] string? CoordinatorNotes,
    [property: JsonPropertyName("event")] KissTreffenEventRow Event,
    [property: JsonPropertyName("quorum")] KissTreffenQuorumRow Quorum);

public sealed record KissTreffenEventRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("start_time")] DateTime StartTime,
    [property: JsonPropertyName("end_time")] DateTime? EndTime,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("organizer_name")] string? OrganizerName);

public sealed record KissTreffenQuorumRow(
    [property: JsonPropertyName("required")] int? Required,
    [property: JsonPropertyName("current")] int Current,
    [property: JsonPropertyName("met")] bool? Met);
