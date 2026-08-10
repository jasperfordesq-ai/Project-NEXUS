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

public sealed partial class CareProviderDirectoryService
{
    private const int PerPage = 20;

    private static readonly string[] ValidTypes =
    [
        "spitex",
        "tagesst\u00e4tte",
        "tagesstaette",
        "private",
        "verein",
        "volunteer"
    ];

    private static readonly string[] ValidStatuses = ["active", "inactive"];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public CareProviderDirectoryService(NexusDbContext db, TenantContext tenantContext)
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

    public Task<CaringCareProviderPage> ListAsync(
        int tenantId,
        string? type,
        string? search,
        int? subRegionId,
        bool verifiedOnly,
        int page,
        CancellationToken ct)
    {
        var query = BaseQuery(tenantId)
            .Where(provider => provider.Status == "active");

        if (!string.IsNullOrWhiteSpace(type))
        {
            var typeFilter = type.Trim();
            query = query.Where(provider => provider.Type == typeFilter);
        }

        if (subRegionId is > 0)
        {
            query = query.Where(provider => provider.SubRegionId == subRegionId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(provider =>
                provider.Name.ToLower().Contains(term)
                || (provider.Description != null && provider.Description.ToLower().Contains(term)));
        }

        if (verifiedOnly)
        {
            query = query.Where(provider => provider.IsVerified);
        }

        return PageAsync(
            query
                .OrderByDescending(provider => provider.IsVerified)
                .ThenBy(provider => provider.Name),
            page,
            ct);
    }

    public Task<CaringCareProviderPage> AdminListAsync(int tenantId, int page, CancellationToken ct)
    {
        return PageAsync(
            BaseQuery(tenantId).OrderByDescending(provider => provider.CreatedAt),
            page,
            ct);
    }

    public async Task<CaringCareProviderRow?> GetAsync(int tenantId, int id, CancellationToken ct)
    {
        var provider = await BaseQuery(tenantId)
            .FirstOrDefaultAsync(row => row.Id == id, ct);

        return provider is null ? null : Map(provider);
    }

    public async Task<CaringCareProviderRow?> GetActiveAsync(int tenantId, int id, CancellationToken ct)
    {
        var provider = await BaseQuery(tenantId)
            .FirstOrDefaultAsync(row => row.Id == id && row.Status == "active", ct);

        return provider is null ? null : Map(provider);
    }

    public async Task<CaringCareProviderMutationResult> CreateAsync(
        int tenantId,
        CaringCareProviderRequest request,
        int adminUserId,
        CancellationToken ct)
    {
        var validationError = Validate(request, create: true);
        if (validationError is not null)
        {
            return new CaringCareProviderMutationResult(ErrorCode: "VALIDATION_ERROR", ErrorMessage: validationError);
        }

        var subRegionResult = await NormalizeSubRegionIdAsync(tenantId, request.SubRegionId, ct);
        if (subRegionResult.ErrorMessage is not null)
        {
            return subRegionResult;
        }

        var now = DateTime.UtcNow;
        var provider = new CaringCareProvider
        {
            TenantId = tenantId,
            Name = request.Name!.Trim(),
            Type = request.Type!.Trim(),
            Description = request.Description,
            Categories = EncodeJson(request.Categories),
            Address = request.Address,
            SubRegionId = subRegionResult.SubRegionId,
            ContactPhone = request.ContactPhone,
            ContactEmail = request.ContactEmail,
            WebsiteUrl = request.WebsiteUrl,
            OpeningHours = EncodeJson(request.OpeningHours),
            IsVerified = false,
            Status = IsValidStatus(request.Status) ? request.Status!.Trim() : "active",
            CreatedBy = adminUserId,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringCareProviders.Add(provider);
        await _db.SaveChangesAsync(ct);
        return new CaringCareProviderMutationResult(Row: await GetAsync(tenantId, provider.Id, ct));
    }

    public async Task<CaringCareProviderMutationResult> UpdateAsync(
        int tenantId,
        int id,
        CaringCareProviderRequest request,
        CancellationToken ct)
    {
        var validationError = Validate(request, create: false);
        if (validationError is not null)
        {
            return new CaringCareProviderMutationResult(ErrorCode: "VALIDATION_ERROR", ErrorMessage: validationError);
        }

        var provider = await _db.CaringCareProviders
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);
        if (provider is null)
        {
            return new CaringCareProviderMutationResult(NotFound: true);
        }

        if (request.Name is not null) provider.Name = request.Name.Trim();
        if (request.Type is not null) provider.Type = request.Type.Trim();
        if (request.Description is not null) provider.Description = request.Description;
        if (request.Address is not null) provider.Address = request.Address;
        if (request.ContactPhone is not null) provider.ContactPhone = request.ContactPhone;
        if (request.ContactEmail is not null) provider.ContactEmail = request.ContactEmail;
        if (request.WebsiteUrl is not null) provider.WebsiteUrl = request.WebsiteUrl;
        if (request.Status is not null) provider.Status = request.Status.Trim();
        if (request.CategoriesSpecified) provider.Categories = EncodeJson(request.Categories);
        if (request.OpeningHoursSpecified) provider.OpeningHours = EncodeJson(request.OpeningHours);
        if (request.SubRegionIdSpecified)
        {
            var subRegionResult = await NormalizeSubRegionIdAsync(tenantId, request.SubRegionId, ct);
            if (subRegionResult.ErrorMessage is not null)
            {
                return subRegionResult;
            }

            provider.SubRegionId = subRegionResult.SubRegionId;
        }

        provider.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaringCareProviderMutationResult(Row: await GetAsync(tenantId, id, ct));
    }

    public async Task<CaringCareProviderMutationResult> DeleteAsync(int tenantId, int id, CancellationToken ct)
    {
        var provider = await _db.CaringCareProviders
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);
        if (provider is null)
        {
            return new CaringCareProviderMutationResult(NotFound: true);
        }

        provider.Status = "inactive";
        provider.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaringCareProviderMutationResult(Row: await GetAsync(tenantId, id, ct));
    }

    public async Task<CaringCareProviderMutationResult> VerifyAsync(int tenantId, int id, CancellationToken ct)
    {
        var provider = await _db.CaringCareProviders
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);
        if (provider is null)
        {
            return new CaringCareProviderMutationResult(NotFound: true);
        }

        provider.IsVerified = true;
        provider.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaringCareProviderMutationResult(Row: await GetAsync(tenantId, id, ct));
    }

    public async Task<CaringCareProviderDuplicateReport> FindPotentialDuplicatesAsync(
        int tenantId,
        decimal threshold,
        CancellationToken ct)
    {
        var effectiveThreshold = Math.Clamp((double)threshold, 0.30d, 0.95d);
        var providers = await _db.CaringCareProviders
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(provider => provider.TenantId == tenantId && provider.Status == "active")
            .OrderBy(provider => provider.Id)
            .ToListAsync(ct);

        var pairs = new List<CaringCareProviderDuplicatePair>();
        for (var i = 0; i < providers.Count; i++)
        {
            for (var j = i + 1; j < providers.Count; j++)
            {
                var comparison = Compare(providers[i], providers[j]);
                if (comparison.Score >= effectiveThreshold)
                {
                    pairs.Add(new CaringCareProviderDuplicatePair(
                        Summary(providers[i]),
                        Summary(providers[j]),
                        Math.Round(comparison.Score, 3),
                        comparison.Signals));
                }
            }
        }

        var ordered = pairs
            .OrderByDescending(pair => pair.Score)
            .Take(50)
            .ToArray();

        return new CaringCareProviderDuplicateReport(ordered, pairs.Count, providers.Count);
    }

    private IQueryable<CaringCareProvider> BaseQuery(int tenantId)
    {
        return _db.CaringCareProviders
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(provider => provider.TenantId == tenantId);
    }

    private async Task<CaringCareProviderPage> PageAsync(
        IOrderedQueryable<CaringCareProvider> query,
        int page,
        CancellationToken ct)
    {
        page = Math.Max(1, page);
        var total = await query.CountAsync(ct);
        var providers = await query
            .Skip((page - 1) * PerPage)
            .Take(PerPage)
            .ToListAsync(ct);

        return new CaringCareProviderPage(
            providers.Select(Map).ToArray(),
            total,
            PerPage,
            page);
    }

    private CaringCareProviderRow Map(CaringCareProvider provider)
    {
        return new CaringCareProviderRow(
            provider.Id,
            provider.TenantId,
            provider.Name,
            provider.Type,
            provider.Description,
            DecodeJson(provider.Categories),
            provider.Address,
            provider.SubRegionId,
            LoadSubRegion(provider),
            provider.ContactPhone,
            provider.ContactEmail,
            provider.WebsiteUrl,
            DecodeJson(provider.OpeningHours),
            provider.IsVerified,
            provider.Status,
            provider.CreatedBy,
            provider.CreatedAt,
            provider.UpdatedAt);
    }

    private CaringCareProviderSubRegionSummary? LoadSubRegion(CaringCareProvider provider)
    {
        if (provider.SubRegionId is null)
        {
            return null;
        }

        var subRegion = _db.CaringSubRegions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefault(row => row.TenantId == provider.TenantId && row.Id == provider.SubRegionId.Value);

        return subRegion is null
            ? null
            : new CaringCareProviderSubRegionSummary(
                subRegion.Id,
                subRegion.Name,
                subRegion.Slug,
                subRegion.Type);
    }

    private async Task<CaringCareProviderMutationResult> NormalizeSubRegionIdAsync(
        int tenantId,
        int? subRegionId,
        CancellationToken ct)
    {
        if (subRegionId is null)
        {
            return new CaringCareProviderMutationResult(SubRegionId: null);
        }

        if (subRegionId <= 0)
        {
            return InvalidSubRegion();
        }

        var exists = await _db.CaringSubRegions
            .IgnoreQueryFilters()
            .AnyAsync(row => row.TenantId == tenantId && row.Id == subRegionId.Value, ct);

        return exists
            ? new CaringCareProviderMutationResult(SubRegionId: subRegionId)
            : InvalidSubRegion();
    }

    private static CaringCareProviderMutationResult InvalidSubRegion()
    {
        return new CaringCareProviderMutationResult(
            ErrorCode: "VALIDATION_ERROR",
            ErrorMessage: "Caring sub-region not found.",
            ErrorField: "sub_region_id");
    }

    private static string? Validate(CaringCareProviderRequest request, bool create)
    {
        if (create && string.IsNullOrWhiteSpace(request.Name))
        {
            return "name is required.";
        }

        if (create && string.IsNullOrWhiteSpace(request.Type))
        {
            return "type is required.";
        }

        if (request.Name is not null && (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 255))
        {
            return "name must be a non-empty string with at most 255 characters.";
        }

        if (request.Type is not null && !IsValidType(request.Type))
        {
            return "type must be one of spitex, tagesst\u00e4tte, private, verein, or volunteer.";
        }

        if (request.Address is { Length: > 255 })
        {
            return "address must be at most 255 characters.";
        }

        if (request.ContactPhone is { Length: > 50 })
        {
            return "contact_phone must be at most 50 characters.";
        }

        if (request.ContactEmail is not null
            && (request.ContactEmail.Length > 255 || !request.ContactEmail.Contains('@', StringComparison.Ordinal)))
        {
            return "contact_email must be a valid email address.";
        }

        if (request.WebsiteUrl is not null
            && (request.WebsiteUrl.Length > 255 || !Uri.TryCreate(request.WebsiteUrl, UriKind.Absolute, out _)))
        {
            return "website_url must be a valid URL.";
        }

        if (request.Status is not null && !IsValidStatus(request.Status))
        {
            return "status must be active or inactive.";
        }

        return null;
    }

    private static bool IsValidType(string type)
    {
        return ValidTypes.Contains(type.Trim(), StringComparer.Ordinal);
    }

    private static bool IsValidStatus(string? status)
    {
        return !string.IsNullOrWhiteSpace(status)
            && ValidStatuses.Contains(status.Trim(), StringComparer.Ordinal);
    }

    private static string? EncodeJson(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is JsonElement element)
        {
            return element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
                ? null
                : element.GetRawText();
        }

        return JsonSerializer.Serialize(value, JsonOptions);
    }

    private static object? DecodeJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<JsonElement>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static DuplicateComparison Compare(CaringCareProvider a, CaringCareProvider b)
    {
        var signals = new List<string>();
        var score = 0d;

        var nameSimilarity = StringSimilarity(NormalizeName(a.Name), NormalizeName(b.Name));
        if (nameSimilarity >= 0.85d)
        {
            signals.Add("name_match");
            score += 0.45d;
        }
        else if (nameSimilarity >= 0.70d)
        {
            signals.Add("name_similar");
            score += 0.25d;
        }

        var emailA = (a.ContactEmail ?? string.Empty).Trim().ToLowerInvariant();
        var emailB = (b.ContactEmail ?? string.Empty).Trim().ToLowerInvariant();
        if (emailA.Length > 0 && emailA == emailB)
        {
            signals.Add("email_match");
            score += 0.30d;
        }

        var phoneA = NonDigitsRegex().Replace(a.ContactPhone ?? string.Empty, string.Empty);
        var phoneB = NonDigitsRegex().Replace(b.ContactPhone ?? string.Empty, string.Empty);
        if (phoneA.Length >= 7 && phoneA == phoneB)
        {
            signals.Add("phone_match");
            score += 0.25d;
        }

        var domainA = ExtractDomain(a.WebsiteUrl);
        var domainB = ExtractDomain(b.WebsiteUrl);
        if (domainA.Length > 0 && domainA == domainB)
        {
            signals.Add("website_match");
            score += 0.25d;
        }

        var sharedTokens = AddressTokens(a.Address).Intersect(AddressTokens(b.Address)).Count();
        if (sharedTokens >= 2)
        {
            signals.Add("address_overlap");
            score += 0.15d;
        }

        if (a.Type == b.Type)
        {
            score += 0.05d;
        }

        return new DuplicateComparison(Math.Min(score, 1d), signals.ToArray());
    }

    private static string NormalizeName(string name)
    {
        var value = name.ToLowerInvariant();
        value = OrgNoiseRegex().Replace(value, " ");
        value = NonWordRegex().Replace(value, " ");
        return WhitespaceRegex().Replace(value, " ").Trim();
    }

    private static double StringSimilarity(string a, string b)
    {
        if (a.Length == 0 || b.Length == 0)
        {
            return 0d;
        }

        if (a == b)
        {
            return 1d;
        }

        var distance = LevenshteinDistance(a, b);
        return 1d - ((double)distance / Math.Max(a.Length, b.Length));
    }

    private static int LevenshteinDistance(string a, string b)
    {
        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];

        for (var j = 0; j <= b.Length; j++)
        {
            previous[j] = j;
        }

        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(
                    Math.Min(current[j - 1] + 1, previous[j] + 1),
                    previous[j - 1] + cost);
            }

            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }

    private static string ExtractDomain(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return string.Empty;
        }

        var value = url.Trim();
        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            value = "http://" + value;
        }

        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            ? uri.Host.ToLowerInvariant().Replace("www.", string.Empty, StringComparison.Ordinal)
            : string.Empty;
    }

    private static string[] AddressTokens(string? address)
    {
        if (string.IsNullOrWhiteSpace(address))
        {
            return [];
        }

        return WhitespaceRegex()
            .Split(NonWordRegex().Replace(address.ToLowerInvariant(), " ").Trim())
            .Where(token => token.Length >= 4)
            .ToArray();
    }

    private static CaringCareProviderDuplicateSummary Summary(CaringCareProvider provider)
    {
        return new CaringCareProviderDuplicateSummary(
            provider.Id,
            provider.Name,
            provider.Type,
            provider.IsVerified);
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    [GeneratedRegex("[^0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonDigitsRegex();

    [GeneratedRegex(@"\b(ag|gmbh|sa|s\u00e0rl|sarl|verein|genossenschaft|cooperative|association|kiss|spitex)\b", RegexOptions.CultureInvariant)]
    private static partial Regex OrgNoiseRegex();

    [GeneratedRegex(@"[^\p{L}\p{N}\s]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonWordRegex();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex WhitespaceRegex();

    private sealed record DuplicateComparison(double Score, IReadOnlyList<string> Signals);
}

public sealed class CaringCareProviderRequest
{
    private object? _categories;
    private object? _openingHours;
    private int? _subRegionId;

    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }

    [JsonPropertyName("categories")]
    public object? Categories
    {
        get => _categories;
        set
        {
            _categories = value;
            CategoriesSpecified = true;
        }
    }

    [JsonIgnore] public bool CategoriesSpecified { get; private set; }

    [JsonPropertyName("address")] public string? Address { get; set; }

    [JsonPropertyName("sub_region_id")]
    public int? SubRegionId
    {
        get => _subRegionId;
        set
        {
            _subRegionId = value;
            SubRegionIdSpecified = true;
        }
    }

    [JsonIgnore] public bool SubRegionIdSpecified { get; private set; }

    [JsonPropertyName("contact_phone")] public string? ContactPhone { get; set; }
    [JsonPropertyName("contact_email")] public string? ContactEmail { get; set; }
    [JsonPropertyName("website_url")] public string? WebsiteUrl { get; set; }

    [JsonPropertyName("opening_hours")]
    public object? OpeningHours
    {
        get => _openingHours;
        set
        {
            _openingHours = value;
            OpeningHoursSpecified = true;
        }
    }

    [JsonIgnore] public bool OpeningHoursSpecified { get; private set; }

    [JsonPropertyName("status")] public string? Status { get; set; }
}

public sealed record CaringCareProviderPage(
    [property: JsonPropertyName("data")] IReadOnlyList<CaringCareProviderRow> Data,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("per_page")] int PerPage,
    [property: JsonPropertyName("current_page")] int CurrentPage);

public sealed record CaringCareProviderRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("categories")] object? Categories,
    [property: JsonPropertyName("address")] string? Address,
    [property: JsonPropertyName("sub_region_id")] int? SubRegionId,
    [property: JsonPropertyName("sub_region")] CaringCareProviderSubRegionSummary? SubRegion,
    [property: JsonPropertyName("contact_phone")] string? ContactPhone,
    [property: JsonPropertyName("contact_email")] string? ContactEmail,
    [property: JsonPropertyName("website_url")] string? WebsiteUrl,
    [property: JsonPropertyName("opening_hours")] object? OpeningHours,
    [property: JsonPropertyName("is_verified")] bool IsVerified,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("created_by")] int? CreatedBy,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record CaringCareProviderSubRegionSummary(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("type")] string Type);

public sealed record CaringCareProviderDuplicateReport(
    [property: JsonPropertyName("pairs")] IReadOnlyList<CaringCareProviderDuplicatePair> Pairs,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("scanned")] int Scanned);

public sealed record CaringCareProviderDuplicatePair(
    [property: JsonPropertyName("provider_a")] CaringCareProviderDuplicateSummary ProviderA,
    [property: JsonPropertyName("provider_b")] CaringCareProviderDuplicateSummary ProviderB,
    [property: JsonPropertyName("score")] double Score,
    [property: JsonPropertyName("signals")] IReadOnlyList<string> Signals);

public sealed record CaringCareProviderDuplicateSummary(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("is_verified")] bool IsVerified);

public sealed record CaringCareProviderMutationResult(
    CaringCareProviderRow? Row = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    string? ErrorField = null,
    bool NotFound = false,
    int? SubRegionId = null);
