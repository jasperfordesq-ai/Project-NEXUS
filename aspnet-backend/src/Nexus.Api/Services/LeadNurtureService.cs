// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class LeadNurtureService
{
    public const string SettingKey = "caring.lead_nurture.contacts";
    private const int MaxContacts = 5000;

    private static readonly string[] Segments = ["municipality", "investor", "business", "resident", "partner"];
    private static readonly string[] Stages =
    [
        "captured", "contacted", "engaged", "qualified", "converted", "dormant", "unsubscribed"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly NexusDbContext _db;

    public LeadNurtureService(NexusDbContext db)
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

    public async Task<LeadNurtureListResponse> ListContactsAsync(
        int tenantId,
        string? segmentFilter,
        string? stageFilter,
        int? limit,
        CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        IEnumerable<LeadNurtureContact> items = envelope.Items;

        if (!string.IsNullOrWhiteSpace(segmentFilter))
        {
            items = items.Where(contact => contact.Segment == segmentFilter.Trim());
        }

        if (!string.IsNullOrWhiteSpace(stageFilter))
        {
            items = items.Where(contact => contact.Stage == stageFilter.Trim());
        }

        var filtered = items
            .OrderByDescending(contact => contact.CreatedAt ?? string.Empty, StringComparer.Ordinal)
            .ToList();

        var take = Math.Clamp(limit ?? 200, 1, 1000);
        return new LeadNurtureListResponse(
            filtered.Take(take).ToArray(),
            filtered.Count,
            envelope.UpdatedAt);
    }

    public async Task<LeadNurtureCaptureResult> CaptureAsync(
        int tenantId,
        LeadCaptureRequest request,
        string? sourceIp,
        CancellationToken ct)
    {
        var errors = ValidateCapture(request);
        if (errors.Count > 0)
        {
            return new LeadNurtureCaptureResult(Errors: errors);
        }

        var email = request.Email!.Trim();
        var segment = string.IsNullOrWhiteSpace(request.Segment) ? "resident" : request.Segment.Trim();
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var existing = envelope.Items.FirstOrDefault(contact =>
            string.Equals(contact.Email, email, StringComparison.OrdinalIgnoreCase));

        if (existing is not null)
        {
            return new LeadNurtureCaptureResult(Contact: existing, Duplicate: true);
        }

        var now = DateTime.UtcNow.ToString("O");
        var contact = new LeadNurtureContact
        {
            Id = "lead_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant(),
            Name = TrimNullable(request.Name, 200),
            Email = email,
            Phone = TrimNullable(request.Phone, 50),
            Organisation = TrimNullable(request.Organisation, 200),
            Segment = segment,
            Source = TrimNullable(request.Source, 100),
            Locale = TrimNullable(request.Locale, 10),
            Interests = NormaliseList(request.Interests, 20),
            Stage = "captured",
            Consent = true,
            ConsentAt = now,
            ConsentIp = sourceIp,
            FollowUpAt = null,
            LastContactedAt = null,
            Notes = null,
            CreatedAt = now,
            UpdatedAt = now
        };

        envelope.Items.Insert(0, contact);
        if (envelope.Items.Count > MaxContacts)
        {
            envelope.Items = envelope.Items.Take(MaxContacts).ToList();
        }

        envelope.UpdatedAt = now;
        await SaveEnvelopeAsync(tenantId, envelope, ct);

        return new LeadNurtureCaptureResult(Contact: contact, Duplicate: false);
    }

    public async Task<LeadNurtureMutationResult> UpdateAsync(
        int tenantId,
        string contactId,
        JsonElement payload,
        CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var index = envelope.Items.FindIndex(contact => contact.Id == contactId);
        if (index < 0)
        {
            return LeadNurtureMutationResult.NotFound();
        }

        var contact = envelope.Items[index];
        if (payload.ValueKind is JsonValueKind.Object && payload.TryGetProperty("stage", out var stageValue))
        {
            var stage = ElementToNullableString(stageValue) ?? string.Empty;
            if (!IsAllowed(stage, Stages))
            {
                return LeadNurtureMutationResult.SingleError(
                    "VALIDATION_ERROR",
                    "invalid stage",
                    "stage");
            }

            contact.Stage = stage;
        }

        if (payload.ValueKind is JsonValueKind.Object && payload.TryGetProperty("notes", out var notesValue))
        {
            contact.Notes = TrimNullable(ElementToNullableString(notesValue), 2000);
        }

        if (payload.ValueKind is JsonValueKind.Object && payload.TryGetProperty("follow_up_at", out var followUpValue))
        {
            contact.FollowUpAt = TrimNullable(ElementToNullableString(followUpValue), 40);
        }

        if (payload.ValueKind is JsonValueKind.Object
            && payload.TryGetProperty("last_contacted_at", out var lastContactedValue))
        {
            contact.LastContactedAt = TrimNullable(ElementToNullableString(lastContactedValue), 40);
        }

        var now = DateTime.UtcNow.ToString("O");
        contact.UpdatedAt = now;
        envelope.Items[index] = contact;
        envelope.UpdatedAt = now;
        await SaveEnvelopeAsync(tenantId, envelope, ct);

        return new LeadNurtureMutationResult(Contact: contact);
    }

    public Task<LeadNurtureMutationResult> UnsubscribeAsync(int tenantId, string contactId, CancellationToken ct)
    {
        using var document = JsonDocument.Parse("""{"stage":"unsubscribed"}""");
        return UpdateAsync(tenantId, contactId, document.RootElement.Clone(), ct);
    }

    public async Task<LeadNurtureSummaryResponse> SummaryAsync(int tenantId, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var bySegment = envelope.Items
            .GroupBy(contact => string.IsNullOrWhiteSpace(contact.Segment) ? "resident" : contact.Segment)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
        var byStage = envelope.Items
            .GroupBy(contact => string.IsNullOrWhiteSpace(contact.Stage) ? "captured" : contact.Stage)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

        return new LeadNurtureSummaryResponse(
            envelope.Items.Count,
            bySegment,
            byStage,
            envelope.UpdatedAt);
    }

    public async Task<string> ExportCsvAsync(int tenantId, string? segmentFilter, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        IEnumerable<LeadNurtureContact> rows = envelope.Items;
        if (!string.IsNullOrWhiteSpace(segmentFilter))
        {
            rows = rows.Where(contact => contact.Segment == segmentFilter.Trim());
        }

        var builder = new StringBuilder();
        AppendCsvRow(builder,
        [
            "id", "name", "email", "phone", "organisation", "segment", "source", "locale", "stage",
            "interests", "consent_at", "last_contacted_at", "follow_up_at", "notes", "created_at"
        ]);

        foreach (var contact in rows)
        {
            AppendCsvRow(builder,
            [
                contact.Id,
                contact.Name ?? string.Empty,
                contact.Email,
                contact.Phone ?? string.Empty,
                contact.Organisation ?? string.Empty,
                contact.Segment,
                contact.Source ?? string.Empty,
                contact.Locale ?? string.Empty,
                contact.Stage,
                string.Join('|', contact.Interests),
                contact.ConsentAt ?? string.Empty,
                contact.LastContactedAt ?? string.Empty,
                contact.FollowUpAt ?? string.Empty,
                (contact.Notes ?? string.Empty).Replace('\r', ' ').Replace('\n', ' '),
                contact.CreatedAt ?? string.Empty
            ]);
        }

        return builder.ToString();
    }

    private async Task<LeadNurtureEnvelope> LoadEnvelopeAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == SettingKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(raw))
        {
            return LeadNurtureEnvelope.Empty();
        }

        try
        {
            var envelope = JsonSerializer.Deserialize<LeadNurtureEnvelope>(raw, JsonOptions);
            return envelope?.Normalise() ?? LeadNurtureEnvelope.Empty();
        }
        catch (JsonException)
        {
            return LeadNurtureEnvelope.Empty();
        }
    }

    private async Task SaveEnvelopeAsync(int tenantId, LeadNurtureEnvelope envelope, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var value = JsonSerializer.Serialize(envelope.Normalise(), JsonOptions);
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = SettingKey,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = value;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private static List<LaravelErrorRow> ValidateCapture(LeadCaptureRequest request)
    {
        var errors = new List<LaravelErrorRow>();
        var email = request.Email?.Trim() ?? string.Empty;
        if (email.Length == 0 || !MailAddress.TryCreate(email, out _))
        {
            errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "must be a valid email", "email"));
        }

        var segment = string.IsNullOrWhiteSpace(request.Segment) ? "resident" : request.Segment.Trim();
        if (!IsAllowed(segment, Segments))
        {
            errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "invalid segment", "segment"));
        }

        if (!request.Consent)
        {
            errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "consent is required", "consent"));
        }

        return errors;
    }

    private static string? ElementToNullableString(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => value.GetString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => value.ToString()
        };
    }

    private static string? TrimNullable(string? value, int max)
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

        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    private static List<string> NormaliseList(IReadOnlyList<string>? values, int max)
    {
        if (values is null)
        {
            return [];
        }

        var output = new List<string>();
        foreach (var value in values)
        {
            var trimmed = value.Trim();
            if (trimmed.Length > 0)
            {
                output.Add(trimmed.Length <= 100 ? trimmed : trimmed[..100]);
            }

            if (output.Count >= max)
            {
                break;
            }
        }

        return output;
    }

    private static bool IsAllowed(string? value, IReadOnlyCollection<string> allowed)
    {
        return !string.IsNullOrWhiteSpace(value) && allowed.Contains(value, StringComparer.Ordinal);
    }

    private static void AppendCsvRow(StringBuilder builder, IReadOnlyList<string> cells)
    {
        for (var i = 0; i < cells.Count; i++)
        {
            if (i > 0)
            {
                builder.Append(',');
            }

            builder.Append(EscapeCsvCell(SanitizeCsvCell(cells[i])));
        }

        builder.Append('\n');
    }

    private static string SanitizeCsvCell(string raw)
    {
        for (var i = 0; i < raw.Length; i++)
        {
            if (!char.IsWhiteSpace(raw[i]) && !char.IsControl(raw[i]))
            {
                return "=+-@".Contains(raw[i], StringComparison.Ordinal) ? "'" + raw : raw;
            }
        }

        return raw;
    }

    private static string EscapeCsvCell(string raw)
    {
        return raw.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + raw.Replace("\"", "\"\"") + "\""
            : raw;
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

public sealed class LeadCaptureRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("organisation")] public string? Organisation { get; set; }
    [JsonPropertyName("segment")] public string? Segment { get; set; }
    [JsonPropertyName("source")] public string? Source { get; set; }
    [JsonPropertyName("locale")] public string? Locale { get; set; }
    [JsonPropertyName("interests")] public List<string>? Interests { get; set; }
    [JsonPropertyName("consent")] public bool Consent { get; set; }
}

public sealed class LeadNurtureContact
{
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("email")] public string Email { get; set; } = string.Empty;
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("organisation")] public string? Organisation { get; set; }
    [JsonPropertyName("segment")] public string Segment { get; set; } = "resident";
    [JsonPropertyName("source")] public string? Source { get; set; }
    [JsonPropertyName("locale")] public string? Locale { get; set; }
    [JsonPropertyName("interests")] public List<string> Interests { get; set; } = [];
    [JsonPropertyName("stage")] public string Stage { get; set; } = "captured";
    [JsonPropertyName("consent")] public bool Consent { get; set; }
    [JsonPropertyName("consent_at")] public string? ConsentAt { get; set; }
    [JsonPropertyName("consent_ip")] public string? ConsentIp { get; set; }
    [JsonPropertyName("follow_up_at")] public string? FollowUpAt { get; set; }
    [JsonPropertyName("last_contacted_at")] public string? LastContactedAt { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
}

public sealed class LeadNurtureEnvelope
{
    [JsonPropertyName("items")] public List<LeadNurtureContact> Items { get; set; } = [];
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }

    public static LeadNurtureEnvelope Empty() => new();

    public LeadNurtureEnvelope Normalise()
    {
        Items ??= [];
        foreach (var item in Items)
        {
            item.Id ??= string.Empty;
            item.Email ??= string.Empty;
            item.Segment = string.IsNullOrWhiteSpace(item.Segment) ? "resident" : item.Segment;
            item.Stage = string.IsNullOrWhiteSpace(item.Stage) ? "captured" : item.Stage;
            item.Interests ??= [];
        }

        return this;
    }
}

public sealed record LeadNurtureListResponse(
    [property: JsonPropertyName("items")] IReadOnlyList<LeadNurtureContact> Items,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record LeadNurtureSummaryResponse(
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("by_segment")] IReadOnlyDictionary<string, int> BySegment,
    [property: JsonPropertyName("by_stage")] IReadOnlyDictionary<string, int> ByStage,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record LeadNurtureCaptureResult(
    LeadNurtureContact? Contact = null,
    bool Duplicate = false,
    IReadOnlyList<LaravelErrorRow>? Errors = null);

public sealed record LeadNurtureMutationResult(
    LeadNurtureContact? Contact = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null)
{
    public static LeadNurtureMutationResult NotFound()
    {
        return SingleError("NOT_FOUND", "Not found.");
    }

    public static LeadNurtureMutationResult SingleError(string code, string message, string? field = null)
    {
        return new LeadNurtureMutationResult(Errors: [new LaravelErrorRow(code, message, field)]);
    }
}
