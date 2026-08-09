// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Mail;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class ExternalIntegrationBacklogService
{
    public const string SettingKey = "caring.external_integrations";

    private static readonly string[] Statuses = ["proposed", "scoping", "blocked", "sandbox", "live", "deprecated"];
    private static readonly string[] DsaStatuses = ["not_required", "drafting", "in_review", "signed"];
    private static readonly string[] Categories =
    [
        "banking",
        "payment",
        "identity_verification",
        "professional_care",
        "municipal_data",
        "postal",
        "ahv",
        "healthcare",
        "other"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public ExternalIntegrationBacklogService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
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

    public Task<ExternalIntegrationBacklogEnvelope> ListAsync(int tenantId, CancellationToken ct)
    {
        return LoadEnvelopeAsync(tenantId, ct);
    }

    public async Task<ExternalIntegrationSeedResult> SeedDefaultsAsync(int tenantId, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        if (envelope.Items.Count > 0)
        {
            return new ExternalIntegrationSeedResult(AlreadySeeded: true);
        }

        var now = IsoNow();
        var items = new[]
        {
            MakeItem(new ExternalIntegrationRequest
            {
                Name = "AHV submission gateway",
                Category = "ahv",
                OwnerName = "",
                OwnerEmail = "",
                Status = "proposed",
                InterfaceSpecUrl = "",
                DsaStatus = "not_required",
                SandboxUrl = "",
                Notes = "Official channel for AHV-relevant volunteer-hour reports. Awaiting confirmation of canonical submission interface."
            }, now),
            MakeItem(new ExternalIntegrationRequest
            {
                Name = "Spitex care-coordination handoff",
                Category = "professional_care",
                OwnerName = "",
                OwnerEmail = "",
                Status = "proposed",
                InterfaceSpecUrl = "",
                DsaStatus = "not_required",
                SandboxUrl = "",
                Notes = "Bi-directional handoff with cantonal Spitex providers for care-recipient circles. Needs DSA + interface spec from each cantonal Spitex."
            }, now),
            MakeItem(new ExternalIntegrationRequest
            {
                Name = "Cantonal master-data feed",
                Category = "municipal_data",
                OwnerName = "",
                OwnerEmail = "",
                Status = "proposed",
                InterfaceSpecUrl = "",
                DsaStatus = "not_required",
                SandboxUrl = "",
                Notes = "Subscribed feed of address/household master data from cantonal registry to keep care-recipient profiles current."
            }, now),
            MakeItem(new ExternalIntegrationRequest
            {
                Name = "PostFinance payment integration",
                Category = "payment",
                OwnerName = "",
                OwnerEmail = "",
                Status = "proposed",
                InterfaceSpecUrl = "",
                DsaStatus = "not_required",
                SandboxUrl = "",
                Notes = "Swiss banking partner for cash-out / treasury operations. Requires merchant agreement."
            }, now),
            MakeItem(new ExternalIntegrationRequest
            {
                Name = "Twint payment",
                Category = "payment",
                OwnerName = "",
                OwnerEmail = "",
                Status = "proposed",
                InterfaceSpecUrl = "",
                DsaStatus = "not_required",
                SandboxUrl = "",
                Notes = "Twint acceptance for membership fees and donations. Requires Twint merchant onboarding via partner bank."
            }, now),
            MakeItem(new ExternalIntegrationRequest
            {
                Name = "Postal-address verification",
                Category = "postal",
                OwnerName = "",
                OwnerEmail = "",
                Status = "proposed",
                InterfaceSpecUrl = "",
                DsaStatus = "not_required",
                SandboxUrl = "",
                Notes = "Address normalisation and validation against Swiss Post directory."
            }, now)
        };

        var saved = await SaveAsync(tenantId, items, ct);
        return new ExternalIntegrationSeedResult(saved.Items, saved.LastUpdatedAt);
    }

    public async Task<ExternalIntegrationMutationResult> CreateAsync(
        int tenantId,
        ExternalIntegrationRequest request,
        CancellationToken ct)
    {
        var errors = Validate(request, isPartial: false);
        if (errors.Count > 0)
        {
            return new ExternalIntegrationMutationResult(Errors: errors);
        }

        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var items = envelope.Items.ToList();
        var item = MakeItem(request, IsoNow());
        items.Add(item);
        await SaveAsync(tenantId, items, ct);
        return new ExternalIntegrationMutationResult(Item: item);
    }

    public async Task<ExternalIntegrationMutationResult> UpdateAsync(
        int tenantId,
        string itemId,
        ExternalIntegrationRequest request,
        CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var items = envelope.Items.ToList();
        var index = items.FindIndex(item => string.Equals(item.Id, itemId, StringComparison.Ordinal));
        if (index < 0)
        {
            return new ExternalIntegrationMutationResult(NotFound: true);
        }

        var errors = Validate(request, isPartial: true);
        if (errors.Count > 0)
        {
            return new ExternalIntegrationMutationResult(Errors: errors);
        }

        var existing = items[index];
        var updated = existing with
        {
            Name = request.Name is null ? existing.Name : request.Name.Trim(),
            Category = request.Category is null ? existing.Category : request.Category,
            OwnerName = request.OwnerName is null ? existing.OwnerName : request.OwnerName.Trim(),
            OwnerEmail = request.OwnerEmail is null ? existing.OwnerEmail : request.OwnerEmail.Trim(),
            Status = request.Status is null ? existing.Status : request.Status,
            InterfaceSpecUrl = request.InterfaceSpecUrl is null ? existing.InterfaceSpecUrl : request.InterfaceSpecUrl.Trim(),
            DsaStatus = request.DsaStatus is null ? existing.DsaStatus : request.DsaStatus,
            SandboxUrl = request.SandboxUrl is null ? existing.SandboxUrl : request.SandboxUrl.Trim(),
            Notes = request.Notes is null ? existing.Notes : request.Notes,
            UpdatedAt = IsoNow()
        };

        items[index] = updated;
        await SaveAsync(tenantId, items, ct);
        return new ExternalIntegrationMutationResult(Item: updated);
    }

    public async Task<ExternalIntegrationDeleteResult> DeleteAsync(int tenantId, string itemId, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var items = envelope.Items.ToList();
        var index = items.FindIndex(item => string.Equals(item.Id, itemId, StringComparison.Ordinal));
        if (index < 0)
        {
            return new ExternalIntegrationDeleteResult(NotFound: true);
        }

        items.RemoveAt(index);
        await SaveAsync(tenantId, items, ct);
        return new ExternalIntegrationDeleteResult(Ok: true);
    }

    private async Task<ExternalIntegrationBacklogEnvelope> LoadEnvelopeAsync(int tenantId, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
        {
            return new ExternalIntegrationBacklogEnvelope([], null);
        }

        try
        {
            var decoded = JsonSerializer.Deserialize<StoredExternalIntegrationEnvelope>(row.Value, JsonOptions);
            if (decoded is null)
            {
                return new ExternalIntegrationBacklogEnvelope([], row.UpdatedAt?.ToUniversalTime().ToString("O"));
            }

            var items = decoded.Items
                .Where(item => !string.IsNullOrWhiteSpace(item.Id))
                .Select(NormalizeItem)
                .ToArray();

            var updatedAt = string.IsNullOrWhiteSpace(decoded.UpdatedAt)
                ? row.UpdatedAt?.ToUniversalTime().ToString("O")
                : decoded.UpdatedAt;

            return new ExternalIntegrationBacklogEnvelope(items, updatedAt);
        }
        catch (JsonException)
        {
            return new ExternalIntegrationBacklogEnvelope([], row.UpdatedAt?.ToUniversalTime().ToString("O"));
        }
    }

    private async Task<ExternalIntegrationBacklogEnvelope> SaveAsync(
        int tenantId,
        IReadOnlyList<ExternalIntegrationBacklogItem> items,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var updatedAt = now.ToString("O");
        var envelope = new StoredExternalIntegrationEnvelope
        {
            Items = items.Select(NormalizeItem).ToList(),
            UpdatedAt = updatedAt
        };
        var payload = JsonSerializer.Serialize(envelope, JsonOptions);

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
        return new ExternalIntegrationBacklogEnvelope(envelope.Items, updatedAt);
    }

    private static ExternalIntegrationBacklogItem MakeItem(ExternalIntegrationRequest request, string now)
    {
        return new ExternalIntegrationBacklogItem(
            Id: GenerateId(),
            Name: (request.Name ?? string.Empty).Trim(),
            Category: request.Category ?? "other",
            OwnerName: (request.OwnerName ?? string.Empty).Trim(),
            OwnerEmail: (request.OwnerEmail ?? string.Empty).Trim(),
            Status: request.Status ?? "proposed",
            InterfaceSpecUrl: (request.InterfaceSpecUrl ?? string.Empty).Trim(),
            DsaStatus: request.DsaStatus ?? "not_required",
            SandboxUrl: (request.SandboxUrl ?? string.Empty).Trim(),
            Notes: request.Notes ?? string.Empty,
            CreatedAt: now,
            UpdatedAt: now);
    }

    private static ExternalIntegrationBacklogItem NormalizeItem(ExternalIntegrationBacklogItem item)
    {
        return item with
        {
            Name = item.Name ?? string.Empty,
            Category = string.IsNullOrWhiteSpace(item.Category) ? "other" : item.Category,
            OwnerName = item.OwnerName ?? string.Empty,
            OwnerEmail = item.OwnerEmail ?? string.Empty,
            Status = string.IsNullOrWhiteSpace(item.Status) ? "proposed" : item.Status,
            InterfaceSpecUrl = item.InterfaceSpecUrl ?? string.Empty,
            DsaStatus = string.IsNullOrWhiteSpace(item.DsaStatus) ? "not_required" : item.DsaStatus,
            SandboxUrl = item.SandboxUrl ?? string.Empty,
            Notes = item.Notes ?? string.Empty,
            CreatedAt = item.CreatedAt ?? string.Empty,
            UpdatedAt = item.UpdatedAt ?? item.CreatedAt ?? string.Empty
        };
    }

    private static IReadOnlyList<ExternalIntegrationValidationError> Validate(ExternalIntegrationRequest request, bool isPartial)
    {
        var errors = new List<ExternalIntegrationValidationError>();

        if (!isPartial || request.Name is not null)
        {
            var name = request.Name?.Trim() ?? string.Empty;
            if (name.Length == 0)
            {
                errors.Add(new ExternalIntegrationValidationError(
                    "VALIDATION_REQUIRED",
                    "Name is required.",
                    "name"));
            }
            else if (name.Length > 200)
            {
                errors.Add(new ExternalIntegrationValidationError(
                    "VALIDATION_LENGTH",
                    "Name is too long.",
                    "name"));
            }
        }

        if (!isPartial || request.Category is not null)
        {
            if (!IsAllowed(request.Category, Categories))
            {
                errors.Add(new ExternalIntegrationValidationError(
                    "VALIDATION_ENUM",
                    "Category is invalid.",
                    "category"));
            }
        }

        if (!isPartial || request.Status is not null)
        {
            if (!IsAllowed(request.Status, Statuses))
            {
                errors.Add(new ExternalIntegrationValidationError(
                    "VALIDATION_ENUM",
                    "Status is invalid.",
                    "status"));
            }
        }

        if (!isPartial || request.DsaStatus is not null)
        {
            if (!IsAllowed(request.DsaStatus, DsaStatuses))
            {
                errors.Add(new ExternalIntegrationValidationError(
                    "VALIDATION_ENUM",
                    "DSA status is invalid.",
                    "dsa_status"));
            }
        }

        if (request.OwnerEmail is not null && !IsEmptyOrEmail(request.OwnerEmail))
        {
            errors.Add(new ExternalIntegrationValidationError(
                "VALIDATION_EMAIL",
                "Owner email is invalid.",
                "owner_email"));
        }

        if (request.InterfaceSpecUrl is not null && !IsEmptyOrUrl(request.InterfaceSpecUrl))
        {
            errors.Add(new ExternalIntegrationValidationError(
                "VALIDATION_URL",
                "Interface specification URL is invalid.",
                "interface_spec_url"));
        }

        if (request.SandboxUrl is not null && !IsEmptyOrUrl(request.SandboxUrl))
        {
            errors.Add(new ExternalIntegrationValidationError(
                "VALIDATION_URL",
                "Sandbox URL is invalid.",
                "sandbox_url"));
        }

        return errors;
    }

    private static bool IsAllowed(string? value, IReadOnlyList<string> allowed)
    {
        return !string.IsNullOrWhiteSpace(value)
            && allowed.Contains(value, StringComparer.Ordinal);
    }

    private static bool IsEmptyOrEmail(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length == 0)
        {
            return true;
        }

        try
        {
            var address = new MailAddress(trimmed);
            return string.Equals(address.Address, trimmed, StringComparison.OrdinalIgnoreCase);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool IsEmptyOrUrl(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 || Uri.TryCreate(trimmed, UriKind.Absolute, out _);
    }

    private static string GenerateId()
    {
        return "intg_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
    }

    private static string IsoNow() => DateTimeOffset.UtcNow.ToString("O");

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

public sealed class ExternalIntegrationRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("owner_name")] public string? OwnerName { get; set; }
    [JsonPropertyName("owner_email")] public string? OwnerEmail { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("interface_spec_url")] public string? InterfaceSpecUrl { get; set; }
    [JsonPropertyName("dsa_status")] public string? DsaStatus { get; set; }
    [JsonPropertyName("sandbox_url")] public string? SandboxUrl { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

public sealed record ExternalIntegrationBacklogEnvelope(
    [property: JsonPropertyName("items")] IReadOnlyList<ExternalIntegrationBacklogItem> Items,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record ExternalIntegrationBacklogItem(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("category")] string Category,
    [property: JsonPropertyName("owner_name")] string OwnerName,
    [property: JsonPropertyName("owner_email")] string OwnerEmail,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("interface_spec_url")] string InterfaceSpecUrl,
    [property: JsonPropertyName("dsa_status")] string DsaStatus,
    [property: JsonPropertyName("sandbox_url")] string SandboxUrl,
    [property: JsonPropertyName("notes")] string Notes,
    [property: JsonPropertyName("created_at")] string? CreatedAt,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt);

public sealed record ExternalIntegrationValidationError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("field")] string Field);

public sealed record ExternalIntegrationMutationResult(
    ExternalIntegrationBacklogItem? Item = null,
    IReadOnlyList<ExternalIntegrationValidationError>? Errors = null,
    bool NotFound = false);

public sealed record ExternalIntegrationSeedResult(
    IReadOnlyList<ExternalIntegrationBacklogItem>? Items = null,
    string? LastUpdatedAt = null,
    bool AlreadySeeded = false);

public sealed record ExternalIntegrationDeleteResult(bool Ok = false, bool NotFound = false);

internal sealed class StoredExternalIntegrationEnvelope
{
    [JsonPropertyName("items")] public List<ExternalIntegrationBacklogItem> Items { get; set; } = [];
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
}
