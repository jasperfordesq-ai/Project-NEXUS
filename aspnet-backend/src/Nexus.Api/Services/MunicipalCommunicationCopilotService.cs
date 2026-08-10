// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class MunicipalCommunicationCopilotService
{
    public const string SettingKey = "caring.municipal_copilot.proposals";
    public const int MaxProposals = 50;

    private static readonly string[] ToneValues = ["too_formal", "too_informal", "condescending", "ok"];
    private static readonly string[] Audiences =
    [
        "all_members",
        "caregivers",
        "care_recipients",
        "volunteers",
        "coordinators",
        "verified_only",
        "sub_region"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;
    private readonly CaringEmergencyAlertService _alerts;

    public MunicipalCommunicationCopilotService(
        NexusDbContext db,
        TenantContext tenantContext,
        CaringEmergencyAlertService alerts)
    {
        _db = db;
        _alerts = alerts;
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

    public async Task<MunicipalCopilotListRow> ListProposalsAsync(
        int tenantId,
        int? limit,
        CancellationToken ct)
    {
        var clamped = ClampLimit(limit ?? 20);
        var items = await LoadItemsAsync(tenantId, ct);
        return new MunicipalCopilotListRow(items.Take(clamped).ToArray(), clamped);
    }

    public async Task<MunicipalCopilotProposal> GenerateProposalAsync(
        int tenantId,
        int adminUserId,
        string draft,
        string? audienceHint,
        string? subRegionId,
        CancellationToken ct)
    {
        var analysis = AnalyseDraft(draft);
        var now = IsoNow();
        var proposal = new MunicipalCopilotProposal
        {
            Id = GenerateId(),
            DraftText = draft,
            PolishedText = analysis.PolishedText,
            ToneAssessment = analysis.ToneAssessment,
            ClarityWarnings = analysis.ClarityWarnings,
            AudienceSuggestion = analysis.AudienceSuggestion,
            AudienceHint = audienceHint ?? string.Empty,
            SubRegionId = subRegionId,
            ModerationFlags = analysis.ModerationFlags,
            ModelUsed = analysis.ModelUsed,
            CreatedBy = adminUserId,
            CreatedAt = now,
            Status = "proposed",
            UpdatedAt = now
        };

        var items = (await LoadItemsAsync(tenantId, ct)).ToList();
        items.Insert(0, proposal);
        if (items.Count > MaxProposals)
        {
            items = items.Take(MaxProposals).ToList();
        }

        await SaveAsync(tenantId, items, ct);
        return proposal;
    }

    public async Task<MunicipalCopilotProposal?> AcceptAndPublishAsync(
        int tenantId,
        string proposalId,
        MunicipalCopilotAcceptFields? editedFields,
        int adminUserId,
        CancellationToken ct)
    {
        var existing = await GetProposalAsync(tenantId, proposalId, ct);
        if (existing is null)
        {
            return null;
        }

        if (string.Equals(existing.Status, "published", StringComparison.Ordinal))
        {
            return existing;
        }

        var accepted = await AcceptProposalAsync(tenantId, proposalId, editedFields, adminUserId, ct);
        if (accepted is null)
        {
            return null;
        }

        return await PublishAcceptedProposalAsync(tenantId, proposalId, adminUserId, ct) ?? accepted;
    }

    public async Task<MunicipalCopilotProposal?> RejectProposalAsync(
        int tenantId,
        string proposalId,
        string reason,
        int adminUserId,
        CancellationToken ct)
    {
        var items = (await LoadItemsAsync(tenantId, ct)).ToList();
        var index = items.FindIndex(item => string.Equals(item.Id, proposalId, StringComparison.Ordinal));
        if (index < 0)
        {
            return null;
        }

        var existing = items[index];
        var now = IsoNow();
        existing.Status = "rejected";
        existing.RejectedAt = now;
        existing.AcceptedAt = null;
        existing.RejectionReason = reason.Trim();
        existing.RejectedBy = adminUserId;
        existing.UpdatedAt = now;

        items[index] = existing;
        await SaveAsync(tenantId, items, ct);
        return existing;
    }

    public static int ClampLimit(int limit)
    {
        if (limit < 1)
        {
            return 1;
        }

        return limit > MaxProposals ? MaxProposals : limit;
    }

    private async Task<MunicipalCopilotProposal?> GetProposalAsync(
        int tenantId,
        string proposalId,
        CancellationToken ct)
    {
        var items = await LoadItemsAsync(tenantId, ct);
        return items.FirstOrDefault(item => string.Equals(item.Id, proposalId, StringComparison.Ordinal));
    }

    private async Task<MunicipalCopilotProposal?> AcceptProposalAsync(
        int tenantId,
        string proposalId,
        MunicipalCopilotAcceptFields? editedFields,
        int adminUserId,
        CancellationToken ct)
    {
        var items = (await LoadItemsAsync(tenantId, ct)).ToList();
        var index = items.FindIndex(item => string.Equals(item.Id, proposalId, StringComparison.Ordinal));
        if (index < 0)
        {
            return null;
        }

        var existing = items[index];
        if (string.Equals(existing.Status, "published", StringComparison.Ordinal))
        {
            return existing;
        }

        if (!string.IsNullOrEmpty(editedFields?.EditedPolishedText))
        {
            existing.PolishedText = editedFields.EditedPolishedText;
        }

        if (!string.IsNullOrEmpty(editedFields?.EditedAudience))
        {
            existing.AudienceSuggestion = editedFields.EditedAudience;
        }

        var now = IsoNow();
        existing.Status = "accepted";
        existing.AcceptedAt = now;
        existing.RejectedAt = null;
        existing.RejectionReason = null;
        existing.AcceptedBy = adminUserId;
        existing.UpdatedAt = now;

        items[index] = existing;
        await SaveAsync(tenantId, items, ct);
        return existing;
    }

    private async Task<MunicipalCopilotProposal?> PublishAcceptedProposalAsync(
        int tenantId,
        string proposalId,
        int adminUserId,
        CancellationToken ct)
    {
        var proposal = await GetProposalAsync(tenantId, proposalId, ct);
        if (proposal is null)
        {
            return null;
        }

        if (string.Equals(proposal.Status, "published", StringComparison.Ordinal))
        {
            return proposal;
        }

        if (!string.Equals(proposal.Status, "accepted", StringComparison.Ordinal))
        {
            return proposal;
        }

        var body = (proposal.PolishedText ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(body))
        {
            body = (proposal.DraftText ?? string.Empty).Trim();
        }

        if (string.IsNullOrWhiteSpace(body))
        {
            return proposal;
        }

        CaringEmergencyAlertRow alert;
        try
        {
            alert = await _alerts.CreateAsync(tenantId, adminUserId, new CaringEmergencyAlertRequest
            {
                Title = DeriveAnnouncementTitle(body),
                Body = body,
                Severity = "info"
            }, ct);
        }
        catch (CaringEmergencyAlertValidationException)
        {
            return proposal;
        }

        return await MarkPublishedAsync(tenantId, proposalId, alert.Id, adminUserId, ct);
    }

    private async Task<MunicipalCopilotProposal?> MarkPublishedAsync(
        int tenantId,
        string proposalId,
        int sourceAnnouncementId,
        int publishedBy,
        CancellationToken ct)
    {
        var items = (await LoadItemsAsync(tenantId, ct)).ToList();
        var index = items.FindIndex(item => string.Equals(item.Id, proposalId, StringComparison.Ordinal));
        if (index < 0)
        {
            return null;
        }

        var existing = items[index];
        var now = IsoNow();
        existing.Status = "published";
        existing.SourceAnnouncementId = sourceAnnouncementId;
        existing.PublishedAt = now;
        existing.PublishedBy = publishedBy;
        existing.UpdatedAt = now;

        items[index] = existing;
        await SaveAsync(tenantId, items, ct);
        return existing;
    }

    private async Task<IReadOnlyList<MunicipalCopilotProposal>> LoadItemsAsync(int tenantId, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
        {
            return [];
        }

        try
        {
            var decoded = JsonSerializer.Deserialize<StoredMunicipalCopilotEnvelope>(row.Value, JsonOptions);
            return decoded?.Items
                .Where(item => !string.IsNullOrWhiteSpace(item.Id))
                .Select(NormalizeProposal)
                .ToArray() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SaveAsync(
        int tenantId,
        IReadOnlyList<MunicipalCopilotProposal> items,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var payload = JsonSerializer.Serialize(new StoredMunicipalCopilotEnvelope
        {
            Items = items.Select(NormalizeProposal).ToList(),
            UpdatedAt = now.ToString("O")
        }, JsonOptions);

        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (existing is null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = SettingKey,
                Value = payload,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            existing.Value = payload;
            existing.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
    }

    private static MunicipalCopilotAnalysis AnalyseDraft(string draft)
    {
        return new MunicipalCopilotAnalysis(
            PolishedText: draft,
            ToneAssessment: "ok",
            ClarityWarnings: [],
            AudienceSuggestion: "all_members",
            ModerationFlags: [],
            ModelUsed: "stub");
    }

    private static MunicipalCopilotProposal NormalizeProposal(MunicipalCopilotProposal proposal)
    {
        proposal.DraftText ??= string.Empty;
        proposal.PolishedText ??= proposal.DraftText;
        proposal.ToneAssessment = ToneValues.Contains(proposal.ToneAssessment, StringComparer.Ordinal)
            ? proposal.ToneAssessment
            : "ok";
        proposal.ClarityWarnings = NormalizeStringList(proposal.ClarityWarnings);
        proposal.AudienceSuggestion = Audiences.Contains(proposal.AudienceSuggestion, StringComparer.Ordinal)
            ? proposal.AudienceSuggestion
            : "all_members";
        proposal.AudienceHint ??= string.Empty;
        proposal.ModerationFlags = NormalizeStringList(proposal.ModerationFlags);
        proposal.ModelUsed = string.IsNullOrWhiteSpace(proposal.ModelUsed) ? "stub" : proposal.ModelUsed;
        proposal.Status = string.IsNullOrWhiteSpace(proposal.Status) ? "proposed" : proposal.Status;
        proposal.CreatedAt = string.IsNullOrWhiteSpace(proposal.CreatedAt) ? IsoNow() : proposal.CreatedAt;
        proposal.UpdatedAt = string.IsNullOrWhiteSpace(proposal.UpdatedAt) ? proposal.CreatedAt : proposal.UpdatedAt;
        return proposal;
    }

    private static string[] NormalizeStringList(IReadOnlyList<string>? value)
    {
        if (value is null)
        {
            return [];
        }

        return value
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item.Trim().Length > 280 ? item.Trim()[..280] : item.Trim())
            .Take(12)
            .ToArray();
    }

    private static string DeriveAnnouncementTitle(string body)
    {
        var firstLine = body
            .Split(["\r\n", "\n", "\r"], StringSplitOptions.None)
            .Select(line => line.Trim())
            .FirstOrDefault(line => !string.IsNullOrWhiteSpace(line)) ?? body.Trim();

        if (firstLine.Length <= 120)
        {
            return firstLine;
        }

        var cut = firstLine[..120];
        var lastSpace = cut.LastIndexOf(' ');
        if (lastSpace > 60)
        {
            cut = cut[..lastSpace];
        }

        return cut.TrimEnd() + "...";
    }

    private static string GenerateId()
    {
        Span<byte> bytes = stackalloc byte[8];
        RandomNumberGenerator.Fill(bytes);
        return "prop_" + Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string IsoNow()
    {
        return DateTime.UtcNow.ToString("O");
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

public sealed class MunicipalCopilotGenerateRequest
{
    [JsonPropertyName("draft")] public string? Draft { get; set; }
    [JsonPropertyName("audience_hint")] public string? AudienceHint { get; set; }
    [JsonPropertyName("sub_region_id")] public string? SubRegionId { get; set; }
}

public sealed class MunicipalCopilotAcceptRequest
{
    [JsonPropertyName("edited_polished_text")] public string? EditedPolishedText { get; set; }
    [JsonPropertyName("edited_audience")] public string? EditedAudience { get; set; }
}

public sealed class MunicipalCopilotRejectRequest
{
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

public sealed record MunicipalCopilotListRow(
    [property: JsonPropertyName("items")] IReadOnlyList<MunicipalCopilotProposal> Items,
    [property: JsonPropertyName("limit")] int Limit);

public sealed class MunicipalCopilotProposal
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("draft_text")] public string DraftText { get; set; } = string.Empty;
    [JsonPropertyName("polished_text")] public string PolishedText { get; set; } = string.Empty;
    [JsonPropertyName("tone_assessment")] public string ToneAssessment { get; set; } = "ok";
    [JsonPropertyName("clarity_warnings")] public string[] ClarityWarnings { get; set; } = [];
    [JsonPropertyName("audience_suggestion")] public string AudienceSuggestion { get; set; } = "all_members";
    [JsonPropertyName("audience_hint")] public string AudienceHint { get; set; } = string.Empty;
    [JsonPropertyName("sub_region_id")] public string? SubRegionId { get; set; }
    [JsonPropertyName("moderation_flags")] public string[] ModerationFlags { get; set; } = [];
    [JsonPropertyName("model_used")] public string ModelUsed { get; set; } = "stub";
    [JsonPropertyName("created_by")] public int CreatedBy { get; set; }
    [JsonPropertyName("created_at")] public string CreatedAt { get; set; } = string.Empty;
    [JsonPropertyName("status")] public string Status { get; set; } = "proposed";
    [JsonPropertyName("accepted_at")] public string? AcceptedAt { get; set; }
    [JsonPropertyName("rejected_at")] public string? RejectedAt { get; set; }
    [JsonPropertyName("rejection_reason")] public string? RejectionReason { get; set; }
    [JsonPropertyName("source_announcement_id")] public int? SourceAnnouncementId { get; set; }
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; set; } = string.Empty;
    [JsonPropertyName("accepted_by")] public int? AcceptedBy { get; set; }
    [JsonPropertyName("rejected_by")] public int? RejectedBy { get; set; }
    [JsonPropertyName("published_at")] public string? PublishedAt { get; set; }
    [JsonPropertyName("published_by")] public int? PublishedBy { get; set; }
}

public sealed record MunicipalCopilotAcceptFields(
    string? EditedPolishedText,
    string? EditedAudience);

internal sealed record MunicipalCopilotAnalysis(
    string PolishedText,
    string ToneAssessment,
    string[] ClarityWarnings,
    string AudienceSuggestion,
    string[] ModerationFlags,
    string ModelUsed);

internal sealed class StoredMunicipalCopilotEnvelope
{
    [JsonPropertyName("items")] public List<MunicipalCopilotProposal> Items { get; set; } = [];
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
}
