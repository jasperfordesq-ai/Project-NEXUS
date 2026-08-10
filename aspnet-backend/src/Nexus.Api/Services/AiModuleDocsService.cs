// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class AiModuleDocsService
{
    public const string ConfigKeyPrefix = "ai_module_docs.";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly Regex SlugPattern = new("^[a-z0-9_-]{1,64}$", RegexOptions.Compiled);

    private readonly NexusDbContext _db;

    public AiModuleDocsService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<AiModuleDocDto>> ListForTenantAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key.StartsWith(ConfigKeyPrefix))
            .ToListAsync(ct);

        return rows
            .Select(ToDto)
            .Where(doc => doc is not null)
            .Cast<AiModuleDocDto>()
            .OrderBy(doc => doc.ModuleSlug, StringComparer.Ordinal)
            .ToArray();
    }

    public async Task<AiModuleDocDto> UpsertAsync(
        int tenantId,
        int userId,
        AiModuleDocRequest request,
        CancellationToken ct)
    {
        var normalized = Normalize(request);
        var key = ConfigKeyPrefix + normalized.ModuleSlug;
        var now = DateTime.UtcNow;
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == key, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        var existing = row.Id == 0 ? null : Decode(row.Value);
        row.Value = JsonSerializer.Serialize(new StoredAiModuleDoc
        {
            ModuleSlug = normalized.ModuleSlug,
            Title = normalized.Title,
            Body = normalized.Body,
            Keywords = normalized.Keywords,
            IsActive = normalized.IsActive,
            CreatedBy = existing?.CreatedBy ?? userId,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now
        }, JsonOptions);
        row.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        return ToDto(row)!;
    }

    public async Task<AiModuleDocDto> UpdateAsync(
        int tenantId,
        int id,
        int userId,
        AiModuleDocRequest request,
        CancellationToken ct)
    {
        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(config =>
                config.TenantId == tenantId
                && config.Id == id
                && config.Key.StartsWith(ConfigKeyPrefix),
                ct);

        if (existing is null)
        {
            throw new AiModuleDocsNotFoundException("Doc not found");
        }

        var stored = Decode(existing.Value) ?? throw new AiModuleDocsNotFoundException("Doc not found");
        request.ModuleSlug = stored.ModuleSlug;
        return await UpsertAsync(tenantId, userId, request, ct);
    }

    public async Task<bool> DeleteAsync(int tenantId, int id, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config =>
                config.TenantId == tenantId
                && config.Id == id
                && config.Key.StartsWith(ConfigKeyPrefix),
                ct);

        if (row is null)
        {
            return false;
        }

        _db.TenantConfigs.Remove(row);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<int> SeedDefaultsForTenantAsync(int tenantId, int userId, CancellationToken ct)
    {
        var inserted = 0;
        foreach (var item in DefaultSeed())
        {
            var key = ConfigKeyPrefix + item.ModuleSlug;
            var exists = await _db.TenantConfigs
                .IgnoreQueryFilters()
                .AnyAsync(config => config.TenantId == tenantId && config.Key == key, ct);

            if (exists)
            {
                continue;
            }

            var now = DateTime.UtcNow;
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = JsonSerializer.Serialize(item with
                {
                    CreatedBy = userId,
                    CreatedAt = now,
                    UpdatedAt = now
                }, JsonOptions),
                CreatedAt = now,
                UpdatedAt = now
            });
            inserted++;
        }

        if (inserted > 0)
        {
            await _db.SaveChangesAsync(ct);
        }

        return inserted;
    }

    private static AiModuleDocDto? ToDto(TenantConfig row)
    {
        var stored = Decode(row.Value);
        if (stored is null || string.IsNullOrWhiteSpace(stored.ModuleSlug))
        {
            return null;
        }

        return new AiModuleDocDto(
            row.Id,
            stored.ModuleSlug,
            stored.Title,
            stored.Body,
            stored.Keywords,
            stored.IsActive,
            stored.UpdatedAt == default ? row.UpdatedAt : stored.UpdatedAt);
    }

    private static StoredAiModuleDoc Normalize(AiModuleDocRequest request)
    {
        var slug = (request.ModuleSlug ?? string.Empty).Trim();
        var title = (request.Title ?? string.Empty).Trim();
        var body = (request.Body ?? string.Empty).Trim();
        var keywords = request.Keywords?
            .Select(keyword => keyword?.Trim() ?? string.Empty)
            .Where(keyword => keyword.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray() ?? [];

        if (slug.Length == 0 || title.Length == 0 || body.Length == 0)
        {
            throw new AiModuleDocsValidationException("module_slug, title, and body are required");
        }

        if (!SlugPattern.IsMatch(slug))
        {
            throw new AiModuleDocsValidationException(
                "module_slug must be 1-64 chars, lowercase letters, numbers, underscores or dashes");
        }

        return new StoredAiModuleDoc
        {
            ModuleSlug = slug,
            Title = title,
            Body = body,
            Keywords = keywords,
            IsActive = request.IsActive ?? true
        };
    }

    private static StoredAiModuleDoc? Decode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<StoredAiModuleDoc>(value, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IReadOnlyList<StoredAiModuleDoc> DefaultSeed()
    {
        return
        [
            new()
            {
                ModuleSlug = "overview",
                Title = "Platform overview - what this is",
                Body = "This is a community timebanking platform. Members exchange help and services using time credits, and each community runs as its own tenant with its own members, listings, events, groups, and rules.",
                Keywords = ["platform", "overview", "getting started", "community"],
                IsActive = true
            },
            new()
            {
                ModuleSlug = "timebanking",
                Title = "Timebanking basics",
                Body = "One hour helping someone earns one time credit, and one hour of help received spends one time credit. Negative balances are acceptable for new members and encourage paying help forward later.",
                Keywords = ["timebank", "timebanking", "time credit", "hours"],
                IsActive = true
            },
            new()
            {
                ModuleSlug = "listings",
                Title = "Listings - offers and requests",
                Body = "Listings are offers or requests for help. Members create a title, description, category, location, and estimated hours, then message each other to agree details before recording an exchange.",
                Keywords = ["listing", "listings", "offer", "request"],
                IsActive = true
            },
            new()
            {
                ModuleSlug = "wallet",
                Title = "Wallet and time credit balance",
                Body = "The wallet shows the member's time credit balance and transaction history. Completed exchanges transfer time credits after confirmation.",
                Keywords = ["wallet", "balance", "credits", "transaction"],
                IsActive = true
            },
            new()
            {
                ModuleSlug = "ai_chat",
                Title = "AI assistant - the chat button",
                Body = "The AI assistant answers questions about the platform and tenant-specific policies. Admin module docs ground its answers in local terminology, workflows, and FAQs.",
                Keywords = ["ai", "ai chat", "assistant", "module docs"],
                IsActive = true
            }
        ];
    }
}

public sealed class AiModuleDocRequest
{
    [JsonPropertyName("module_slug")] public string? ModuleSlug { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("body")] public string? Body { get; set; }
    [JsonPropertyName("keywords")] public string[]? Keywords { get; set; }
    [JsonPropertyName("is_active")] public bool? IsActive { get; set; }
}

public sealed record AiModuleDocDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("module_slug")] string ModuleSlug,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("body")] string Body,
    [property: JsonPropertyName("keywords")] IReadOnlyList<string> Keywords,
    [property: JsonPropertyName("is_active")] bool IsActive,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record StoredAiModuleDoc
{
    [JsonPropertyName("module_slug")] public string ModuleSlug { get; init; } = string.Empty;
    [JsonPropertyName("title")] public string Title { get; init; } = string.Empty;
    [JsonPropertyName("body")] public string Body { get; init; } = string.Empty;
    [JsonPropertyName("keywords")] public string[] Keywords { get; init; } = [];
    [JsonPropertyName("is_active")] public bool IsActive { get; init; } = true;
    [JsonPropertyName("created_by")] public int? CreatedBy { get; init; }
    [JsonPropertyName("created_at")] public DateTime CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTime UpdatedAt { get; init; }
}

public sealed class AiModuleDocsValidationException : Exception
{
    public AiModuleDocsValidationException(string message) : base(message) { }
}

public sealed class AiModuleDocsNotFoundException : Exception
{
    public AiModuleDocsNotFoundException(string message) : base(message) { }
}
