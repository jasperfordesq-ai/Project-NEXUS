// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class TenantSsoProviderService
{
    public static readonly string[] Presets = ["generic", "entra", "hivebrite"];

    private static readonly Regex ProviderKeyPattern =
        new("^[a-z0-9][a-z0-9_-]{1,19}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IDataProtector _protector;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<TenantSsoProviderService> _logger;

    public TenantSsoProviderService(
        NexusDbContext db,
        TenantContext tenantContext,
        IDataProtectionProvider dataProtectionProvider,
        IHttpClientFactory httpFactory,
        ILogger<TenantSsoProviderService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _protector = dataProtectionProvider.CreateProtector("Nexus.Sso.ProviderSecrets.v1");
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public async Task<IReadOnlyList<SsoProviderAdminRow>> ListForAdminAsync(int tenantId, CancellationToken ct)
    {
        var providers = await _db.TenantSsoProviders
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId)
            .OrderBy(p => p.DisplayName)
            .AsNoTracking()
            .ToListAsync(ct);

        return providers.Select(MapForAdmin).ToArray();
    }

    public async Task<SsoProviderAdminRow> UpsertAsync(
        int tenantId,
        string providerKey,
        SsoProviderUpsertRequest request,
        int? adminUserId,
        CancellationToken ct)
    {
        var key = NormalizeProviderKey(providerKey);
        if (!ProviderKeyPattern.IsMatch(key))
        {
            throw new SsoProviderValidationException("Invalid SSO provider key.");
        }

        var issuer = NormalizeIssuer(request.IssuerUrl);
        if (issuer is null)
        {
            throw new SsoProviderValidationException("SSO issuer must be a valid public HTTPS URL.");
        }

        var clientId = (request.ClientId ?? string.Empty).Trim();
        if (clientId.Length == 0)
        {
            throw new SsoProviderValidationException("SSO client id is required.");
        }

        var preset = Presets.Contains(request.Preset, StringComparer.Ordinal)
            ? request.Preset!
            : "generic";
        var domains = NormalizeDomains(request.AllowedEmailDomains);
        var now = DateTime.UtcNow;

        var provider = await _db.TenantSsoProviders
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.ProviderKey == key, ct);

        if (provider is null)
        {
            provider = new TenantSsoProvider
            {
                TenantId = tenantId,
                ProviderKey = key,
                CreatedAt = now
            };
            _db.TenantSsoProviders.Add(provider);
        }

        provider.DisplayName = Truncate(
            string.IsNullOrWhiteSpace(request.DisplayName) ? key : request.DisplayName.Trim(),
            100);
        provider.Preset = preset;
        provider.IssuerUrl = issuer;
        provider.ClientId = clientId;
        provider.Scopes = Truncate(
            string.IsNullOrWhiteSpace(request.Scopes) ? "openid profile email" : request.Scopes.Trim(),
            255);
        provider.AllowedEmailDomains = domains.Length == 0 ? null : JsonSerializer.Serialize(domains);
        provider.AutoProvision = request.AutoProvision ?? true;
        provider.IsEnabled = request.IsEnabled ?? false;
        provider.UpdatedBy = adminUserId;
        provider.UpdatedAt = now;

        if (!string.IsNullOrWhiteSpace(request.ClientSecret))
        {
            provider.ClientSecretEncrypted = _protector.Protect(request.ClientSecret);
        }

        await _db.SaveChangesAsync(ct);
        await LogAuditAsync(tenantId, adminUserId, "sso_provider_updated", provider, ct);
        return MapForAdmin(provider);
    }

    public async Task DeleteAsync(int tenantId, string providerKey, int? adminUserId, CancellationToken ct)
    {
        var key = NormalizeProviderKey(providerKey);
        var provider = await _db.TenantSsoProviders
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.ProviderKey == key, ct);

        if (provider is not null)
        {
            _db.TenantSsoProviders.Remove(provider);
            await _db.SaveChangesAsync(ct);
        }

        var auditProvider = provider ?? new TenantSsoProvider
        {
            TenantId = tenantId,
            ProviderKey = key
        };
        await LogAuditAsync(tenantId, adminUserId, "sso_provider_deleted", auditProvider, ct);
    }

    public async Task<SsoProviderAdminRow?> FindForAdminAsync(int tenantId, string providerKey, CancellationToken ct)
    {
        var key = NormalizeProviderKey(providerKey);
        var provider = await _db.TenantSsoProviders
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.ProviderKey == key, ct);

        return provider is null ? null : MapForAdmin(provider);
    }

    public async Task<SsoDiscoveryResult> DiscoverAsync(string issuerUrl, CancellationToken ct)
    {
        var issuer = NormalizeIssuer(issuerUrl)
            ?? throw new InvalidOperationException("SSO issuer must be a valid public HTTPS URL.");
        var discoveryUrl = $"{issuer}/.well-known/openid-configuration";
        var client = _httpFactory.CreateClient("NexusSsoOidc");
        client.Timeout = TimeSpan.FromSeconds(10);

        using var response = await client.GetAsync(discoveryUrl, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OIDC discovery returned {(int)response.StatusCode}.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = document.RootElement;
        var result = new SsoDiscoveryResult(
            RequiredString(root, "issuer"),
            RequiredString(root, "authorization_endpoint"),
            RequiredString(root, "token_endpoint"),
            RequiredString(root, "jwks_uri"));

        if (!string.Equals(result.Issuer.TrimEnd('/'), issuer, StringComparison.Ordinal))
        {
            _logger.LogInformation("OIDC discovery issuer {DiscoveredIssuer} differs from configured {Issuer}", result.Issuer, issuer);
        }

        return result;
    }

    private async Task LogAuditAsync(
        int tenantId,
        int? adminUserId,
        string action,
        TenantSsoProvider provider,
        CancellationToken ct)
    {
        var metadata = JsonSerializer.Serialize(new
        {
            provider_key = provider.ProviderKey,
            issuer_url = provider.IssuerUrl,
            is_enabled = provider.IsEnabled,
            auto_provision = provider.AutoProvision
        });

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = adminUserId,
            Action = action,
            EntityType = "TenantSsoProvider",
            EntityId = provider.Id == 0 ? null : provider.Id,
            Metadata = metadata,
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
    }

    private static SsoProviderAdminRow MapForAdmin(TenantSsoProvider provider)
    {
        return new SsoProviderAdminRow(
            provider.Id,
            provider.ProviderKey,
            provider.DisplayName,
            provider.Preset,
            provider.IssuerUrl,
            provider.ClientId,
            !string.IsNullOrWhiteSpace(provider.ClientSecretEncrypted),
            provider.Scopes,
            ParseDomains(provider.AllowedEmailDomains),
            provider.AutoProvision,
            provider.IsEnabled,
            provider.UpdatedAt);
    }

    private static string NormalizeProviderKey(string providerKey) => providerKey.Trim().ToLowerInvariant();

    private static string? NormalizeIssuer(string? issuerUrl)
    {
        var issuer = (issuerUrl ?? string.Empty).Trim().TrimEnd('/');
        if (!issuer.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!Uri.TryCreate(issuer, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            IsInternalHost(uri.Host))
        {
            return null;
        }

        return uri.ToString().TrimEnd('/');
    }

    private static bool IsInternalHost(string host)
    {
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!IPAddress.TryParse(host, out var address))
        {
            return false;
        }

        if (IPAddress.IsLoopback(address))
        {
            return true;
        }

        var bytes = address.GetAddressBytes();
        return address.AddressFamily switch
        {
            System.Net.Sockets.AddressFamily.InterNetwork =>
                bytes[0] == 10 ||
                bytes[0] == 127 ||
                bytes[0] == 169 && bytes[1] == 254 ||
                bytes[0] == 172 && bytes[1] is >= 16 and <= 31 ||
                bytes[0] == 192 && bytes[1] == 168,
            System.Net.Sockets.AddressFamily.InterNetworkV6 =>
                address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || bytes[0] is 0xfc or 0xfd,
            _ => false
        };
    }

    private static string[] NormalizeDomains(IEnumerable<string>? domains)
    {
        if (domains is null)
        {
            return [];
        }

        return domains
            .Select(domain => domain.Trim().TrimStart('@').ToLowerInvariant())
            .Where(domain => Regex.IsMatch(domain, "^[a-z0-9.-]+\\.[a-z]{2,}$", RegexOptions.CultureInvariant))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static string[] ParseDomains(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string RequiredString(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var value) ||
            value.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new InvalidOperationException($"OIDC discovery document is missing {property}.");
        }

        return value.GetString()!;
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}

public sealed class SsoProviderValidationException : Exception
{
    public SsoProviderValidationException(string message) : base(message) { }
}

public sealed class SsoProviderUpsertRequest
{
    [JsonPropertyName("display_name")] public string? DisplayName { get; set; }
    [JsonPropertyName("preset")] public string? Preset { get; set; }
    [JsonPropertyName("issuer_url")] public string? IssuerUrl { get; set; }
    [JsonPropertyName("client_id")] public string? ClientId { get; set; }
    [JsonPropertyName("client_secret")] public string? ClientSecret { get; set; }
    [JsonPropertyName("scopes")] public string? Scopes { get; set; }
    [JsonPropertyName("allowed_email_domains")] public string[]? AllowedEmailDomains { get; set; }
    [JsonPropertyName("auto_provision")] public bool? AutoProvision { get; set; }
    [JsonPropertyName("is_enabled")] public bool? IsEnabled { get; set; }
}

public sealed record SsoProviderAdminRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("provider_key")] string ProviderKey,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("preset")] string Preset,
    [property: JsonPropertyName("issuer_url")] string IssuerUrl,
    [property: JsonPropertyName("client_id")] string ClientId,
    [property: JsonPropertyName("has_client_secret")] bool HasClientSecret,
    [property: JsonPropertyName("scopes")] string Scopes,
    [property: JsonPropertyName("allowed_email_domains")] string[] AllowedEmailDomains,
    [property: JsonPropertyName("auto_provision")] bool AutoProvision,
    [property: JsonPropertyName("is_enabled")] bool IsEnabled,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record SsoDiscoveryResult(
    [property: JsonPropertyName("issuer")] string Issuer,
    [property: JsonPropertyName("authorization_endpoint")] string AuthorizationEndpoint,
    [property: JsonPropertyName("token_endpoint")] string TokenEndpoint,
    [property: JsonPropertyName("jwks_uri")] string JwksUri);
