// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public class FederationExternalPartnerService
{
    private static readonly string[] ValidStatuses = ["pending", "active", "suspended", "failed"];
    private static readonly string[] ValidAuthMethods = ["api_key", "hmac", "oauth2"];
    private static readonly string[] ValidProtocols = ["nexus", "timeoverflow", "komunitin", "credit_commons"];
    private static readonly string[] AllowedFeatureFlags =
    [
        "allow_member_search",
        "allow_listing_search",
        "allow_messaging",
        "allow_transactions",
        "allow_events",
        "allow_groups",
        "allow_connections",
        "allow_volunteering",
        "allow_member_sync"
    ];

    private readonly NexusDbContext _db;
    private readonly FederationExternalApiClient _client;
    private readonly IDataProtector _protector;
    private readonly ILogger<FederationExternalPartnerService> _logger;

    public FederationExternalPartnerService(
        NexusDbContext db,
        FederationExternalApiClient client,
        IDataProtectionProvider dataProtectionProvider,
        ILogger<FederationExternalPartnerService> logger)
    {
        _db = db;
        _client = client;
        _protector = dataProtectionProvider.CreateProtector("Nexus.Federation.ExternalPartnerCredentials.v1");
        _logger = logger;
    }

    public async Task<List<FederationExternalPartner>> GetAllAsync(int tenantId)
    {
        return await _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId)
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();
    }

    public async Task<List<FederationExternalPartner>> GetActivePartnersAsync(int tenantId)
    {
        return await _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId && p.Status == "active")
            .OrderBy(p => p.Name)
            .AsNoTracking()
            .ToListAsync();
    }

    public async Task<List<FederationExternalPartner>> GetActivePartnersForListingsAsync(int tenantId)
    {
        return await _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId && p.Status == "active" && p.AllowListingSearch)
            .OrderBy(p => p.Name)
            .AsNoTracking()
            .ToListAsync();
    }

    public async Task<List<FederationExternalPartner>> GetActivePartnersWithFlagAsync(int tenantId, string allowFlag)
    {
        if (!AllowedFeatureFlags.Contains(allowFlag, StringComparer.OrdinalIgnoreCase))
            return [];

        var query = _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId && p.Status == "active");

        query = allowFlag.ToLowerInvariant() switch
        {
            "allow_member_search" => query.Where(p => p.AllowMemberSearch),
            "allow_listing_search" => query.Where(p => p.AllowListingSearch),
            "allow_messaging" => query.Where(p => p.AllowMessaging),
            "allow_transactions" => query.Where(p => p.AllowTransactions),
            "allow_events" => query.Where(p => p.AllowEvents),
            "allow_groups" => query.Where(p => p.AllowGroups),
            "allow_connections" => query.Where(p => p.AllowConnections),
            "allow_volunteering" => query.Where(p => p.AllowVolunteering),
            "allow_member_sync" => query.Where(p => p.AllowMemberSync),
            _ => query.Where(_ => false)
        };

        return await query.OrderBy(p => p.Name).AsNoTracking().ToListAsync();
    }

    public async Task<FederationExternalPartner?> GetAsync(int tenantId, int id)
    {
        return await _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id);
    }

    public async Task<(FederationExternalPartner? Partner, string? Error)> UpsertAsync(
        int tenantId,
        int userId,
        FederationExternalPartnerRequest request,
        int? id = null)
    {
        var error = Validate(request);
        if (error != null) return (null, error);

        var urlError = await ValidateBaseUrlAsync(request.BaseUrl);
        if (urlError != null) return (null, urlError);

        var normalizedBaseUrl = request.BaseUrl.TrimEnd('/');
        var duplicate = await _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .AnyAsync(p => p.TenantId == tenantId && p.BaseUrl == normalizedBaseUrl && (!id.HasValue || p.Id != id.Value));
        if (duplicate) return (null, "A partner with this URL already exists for this tenant");

        FederationExternalPartner partner;
        var isCreate = !id.HasValue;
        if (id.HasValue)
        {
            partner = await GetAsync(tenantId, id.Value) ?? null!;
            if (partner == null) return (null, "Partner not found");
            partner.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            partner = new FederationExternalPartner
            {
                TenantId = tenantId,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow
            };
            _db.FederationExternalPartners.Add(partner);
        }

        partner.Name = request.Name.Trim();
        partner.Description = request.Description;
        partner.BaseUrl = normalizedBaseUrl;
        partner.ApiPath = string.IsNullOrWhiteSpace(request.ApiPath) ? "/api/v1/federation" : request.ApiPath;
        partner.AuthMethod = (request.AuthMethod ?? "api_key").ToLowerInvariant();
        partner.ProtocolType = (request.ProtocolType ?? "nexus").ToLowerInvariant();
        partner.ApiKey = string.IsNullOrWhiteSpace(request.ApiKey) ? partner.ApiKey : ProtectCredential(request.ApiKey);
        partner.SigningSecret = string.IsNullOrWhiteSpace(request.SigningSecret) ? partner.SigningSecret : ProtectCredential(request.SigningSecret);
        partner.OAuthClientId = request.OAuthClientId;
        partner.OAuthClientSecret = string.IsNullOrWhiteSpace(request.OAuthClientSecret) ? partner.OAuthClientSecret : ProtectCredential(request.OAuthClientSecret);
        partner.OAuthTokenUrl = request.OAuthTokenUrl;
        partner.Status = isCreate ? "pending" : request.Status ?? partner.Status;
        partner.AllowMemberSearch = request.AllowMemberSearch;
        partner.AllowListingSearch = request.AllowListingSearch;
        partner.AllowMessaging = request.AllowMessaging;
        partner.AllowTransactions = request.AllowTransactions;
        partner.AllowEvents = request.AllowEvents;
        partner.AllowGroups = request.AllowGroups;
        partner.AllowConnections = request.AllowConnections;
        partner.AllowVolunteering = request.AllowVolunteering;
        partner.AllowMemberSync = request.AllowMemberSync;

        await _db.SaveChangesAsync();
        return (partner, null);
    }

    public async Task<(FederationExternalPartner? Partner, string? Error)> UpdateStatusAsync(int tenantId, int id, string status)
    {
        if (!ValidStatuses.Contains(status, StringComparer.OrdinalIgnoreCase))
            return (null, "Invalid status. Must be one of: " + string.Join(", ", ValidStatuses));

        var partner = await GetAsync(tenantId, id);
        if (partner == null) return (null, "Partner not found");

        partner.Status = status.ToLowerInvariant();
        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (partner, null);
    }

    public async Task<(bool Success, string? Error)> DeleteAsync(int tenantId, int id)
    {
        var partner = await GetAsync(tenantId, id);
        if (partner == null) return (false, "Partner not found");
        _db.FederationExternalPartners.Remove(partner);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool Healthy, int StatusCode, int ResponseTimeMs, string? Error)> HealthCheckAsync(int tenantId, int id)
    {
        var partner = await GetAsync(tenantId, id);
        if (partner == null) return (false, 404, 0, "Partner not found");

        var started = DateTime.UtcNow;
        try
        {
            var result = await _client.GetHealthAsync(partner.BaseUrl);
            var elapsed = (int)(DateTime.UtcNow - started).TotalMilliseconds;
            var healthy = result.HasValue;
            JsonElement? timebankInfo = null;
            if (healthy && !string.IsNullOrWhiteSpace(partner.ApiKey))
            {
                timebankInfo = await _client.GetTimebanksAsync(partner.BaseUrl, UnprotectCredential(partner.ApiKey));
            }

            partner.LastSyncAt = DateTime.UtcNow;
            partner.VerifiedAt = healthy ? DateTime.UtcNow : partner.VerifiedAt;
            partner.ErrorCount = healthy ? 0 : partner.ErrorCount + 1;
            partner.LastError = healthy ? null : "Health check failed";
            partner.Status = healthy && partner.Status == "pending" ? "active" : partner.Status;
            SyncPartnerMetadata(partner, result, timebankInfo);

            _db.FederationExternalPartnerLogs.Add(new FederationExternalPartnerLog
            {
                PartnerId = partner.Id,
                Endpoint = "/api/v1/federation/health",
                Method = "GET",
                ResponseCode = healthy ? 200 : 0,
                ResponseTimeMs = elapsed,
                Success = healthy,
                ErrorMessage = healthy ? null : "No JSON response"
            });
            await _db.SaveChangesAsync();

            return (healthy, healthy ? 200 : 0, elapsed, healthy ? null : "Health check failed");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Federation external partner health check failed for {PartnerId}", id);
            return (false, 0, (int)(DateTime.UtcNow - started).TotalMilliseconds, ex.Message);
        }
    }

    public async Task<List<FederationExternalPartnerLog>> GetLogsAsync(int tenantId, int id)
    {
        var ownsPartner = await _db.FederationExternalPartners
            .IgnoreQueryFilters()
            .AnyAsync(p => p.TenantId == tenantId && p.Id == id);
        if (!ownsPartner) return [];

        return await _db.FederationExternalPartnerLogs
            .Where(l => l.PartnerId == id)
            .OrderByDescending(l => l.CreatedAt)
            .Take(100)
            .AsNoTracking()
            .ToListAsync();
    }

    public async Task EnableTenantFederationAsync(int tenantId, int? adminId = null)
    {
        var control = await _db.FederationSystemControls.FirstOrDefaultAsync();
        if (control == null)
        {
            _db.FederationSystemControls.Add(new FederationSystemControl());
        }
        else
        {
            control.FederationEnabled = true;
            control.EmergencyLockdown = false;
            control.UpdatedAt = DateTime.UtcNow;
        }

        if (!await _db.FederationTenantWhitelists.IgnoreQueryFilters().AnyAsync(w => w.TenantId == tenantId))
        {
            _db.FederationTenantWhitelists.Add(new FederationTenantWhitelist
            {
                TenantId = tenantId,
                IsEnabled = true,
                ApprovedByUserId = adminId,
                Notes = "Federation enabled from V1.5 parity setup"
            });
        }

        foreach (var feature in new[] { "profiles", "members", "listings", "messages", "transactions", "reviews", "events", "groups", "connections", "volunteering", "member_sync" })
        {
            var existing = await _db.FederationTenantFeatures
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(f => f.TenantId == tenantId && f.Feature == feature);
            if (existing == null)
            {
                _db.FederationTenantFeatures.Add(new FederationTenantFeature { TenantId = tenantId, Feature = feature, IsEnabled = true });
            }
            else
            {
                existing.IsEnabled = true;
                existing.UpdatedAt = DateTime.UtcNow;
            }
        }

        var settings = await _db.FederationUserSettings
            .IgnoreQueryFilters()
            .Where(s => s.TenantId == tenantId)
            .ToDictionaryAsync(s => s.UserId);
        var users = await _db.Users.IgnoreQueryFilters().Where(u => u.TenantId == tenantId && u.IsActive).ToListAsync();
        foreach (var user in users)
        {
            if (!settings.TryGetValue(user.Id, out var setting))
            {
                _db.FederationUserSettings.Add(new FederationUserSetting
                {
                    TenantId = tenantId,
                    UserId = user.Id,
                    FederationOptIn = true,
                    ProfileVisible = true,
                    ListingsVisible = true
                });
            }
            else
            {
                setting.FederationOptIn = true;
                setting.ProfileVisible = true;
                setting.ListingsVisible = true;
            }
        }

        await _db.SaveChangesAsync();
    }

    private static string? Validate(FederationExternalPartnerRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return "Partner name is required";
        if (string.IsNullOrWhiteSpace(request.BaseUrl)) return "Base URL is required";
        if (!ValidAuthMethods.Contains(request.AuthMethod ?? "api_key", StringComparer.OrdinalIgnoreCase)) return "Invalid auth_method. Must be one of: " + string.Join(", ", ValidAuthMethods);
        if (!ValidProtocols.Contains(request.ProtocolType ?? "nexus", StringComparer.OrdinalIgnoreCase)) return "Invalid protocol_type. Must be one of: " + string.Join(", ", ValidProtocols);
        if (!ValidStatuses.Contains(request.Status ?? "pending", StringComparer.OrdinalIgnoreCase)) return "Invalid status. Must be one of: " + string.Join(", ", ValidStatuses);
        return null;
    }

    private static async Task<string?> ValidateBaseUrlAsync(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Host.Length == 0)
            return "Invalid URL format";
        if (uri.Scheme is not ("http" or "https"))
            return "URL scheme must be http or https";
        if (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return "URL host is not allowed (internal/reserved hostname)";
        if (uri.Host.Equals("metadata.google.internal", StringComparison.OrdinalIgnoreCase) ||
            uri.Host.Equals("metadata.google", StringComparison.OrdinalIgnoreCase) ||
            uri.Host.Equals("kubernetes.default", StringComparison.OrdinalIgnoreCase))
            return "URL host is not allowed (internal/reserved hostname)";

        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(uri.Host);
        }
        catch (Exception ex) when (ex is SocketException or ArgumentException)
        {
            return "URL hostname could not be resolved (DNS lookup failed)";
        }

        foreach (var address in addresses)
        {
            var bytes = address.GetAddressBytes();
            if (IPAddress.IsLoopback(address)) return "URL resolves to loopback";
            if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                (bytes[0] == 0 ||
                 bytes[0] == 10 ||
                 bytes[0] == 127 ||
                 (bytes[0] == 100 && bytes[1] is >= 64 and <= 127) ||
                 (bytes[0] == 169 && bytes[1] == 254) ||
                 (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) ||
                 (bytes[0] == 192 && bytes[1] == 168)))
                return "URL resolves to private/internal IP address";
            if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 &&
                (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || bytes[0] == 0xfd || bytes[0] == 0xfc))
                return "URL resolves to private/internal IP address";
        }
        return null;
    }

    private string ProtectCredential(string value) => _protector.Protect(value);

    private string UnprotectCredential(string value)
    {
        try
        {
            return _protector.Unprotect(value);
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException)
        {
            return value;
        }
    }

    private static void SyncPartnerMetadata(FederationExternalPartner partner, JsonElement? health, JsonElement? timebanks)
    {
        if (health.HasValue)
        {
            var h = health.Value;
            partner.PartnerVersion =
                TryGetString(h, "version") ??
                TryGetString(h, "api_version") ??
                TryGetString(h, "platform_version") ??
                TryGetString(h, "platform") ??
                partner.PartnerVersion;
        }

        var firstTimebank = FirstDataObject(timebanks);
        if (!firstTimebank.HasValue) return;

        var tb = firstTimebank.Value;
        partner.PartnerName = TryGetString(tb, "name") ?? partner.PartnerName;
        partner.PartnerMemberCount = TryGetInt(tb, "member_count") ?? partner.PartnerMemberCount;

        var metadata = new Dictionary<string, object?>();
        foreach (var field in new[] { "location", "country", "currency", "timezone", "language", "features", "description", "tagline" })
        {
            if (tb.TryGetProperty(field, out var property))
                metadata[field] = property.ValueKind == JsonValueKind.String ? property.GetString() : JsonSerializer.Deserialize<object>(property.GetRawText());
        }

        if (metadata.Count > 0)
            partner.PartnerMetadata = JsonSerializer.Serialize(metadata);
    }

    private static JsonElement? FirstDataObject(JsonElement? element)
    {
        if (!element.HasValue) return null;
        var root = element.Value;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data))
            root = data;
        if (root.ValueKind == JsonValueKind.Array)
            return root.EnumerateArray().FirstOrDefault();
        return root.ValueKind == JsonValueKind.Object ? root : null;
    }

    private static string? TryGetString(JsonElement element, string name)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(name, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static int? TryGetInt(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
            return null;
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value))
            return value;
        if (property.ValueKind == JsonValueKind.String && int.TryParse(property.GetString(), out var parsed))
            return parsed;
        return null;
    }
}

public class FederationExternalPartnerRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description")]
    public string? Description { get; set; }
    [JsonPropertyName("base_url")]
    public string BaseUrl { get; set; } = string.Empty;
    [JsonPropertyName("api_path")]
    public string ApiPath { get; set; } = "/api/v1/federation";
    [JsonPropertyName("api_key")]
    public string? ApiKey { get; set; }
    [JsonPropertyName("auth_method")]
    public string? AuthMethod { get; set; } = "api_key";
    [JsonPropertyName("protocol_type")]
    public string? ProtocolType { get; set; } = "nexus";
    [JsonPropertyName("signing_secret")]
    public string? SigningSecret { get; set; }
    [JsonPropertyName("oauth_client_id")]
    public string? OAuthClientId { get; set; }
    [JsonPropertyName("oauth_client_secret")]
    public string? OAuthClientSecret { get; set; }
    [JsonPropertyName("oauth_token_url")]
    public string? OAuthTokenUrl { get; set; }
    [JsonPropertyName("status")]
    public string? Status { get; set; } = "pending";
    [JsonPropertyName("allow_member_search")]
    public bool AllowMemberSearch { get; set; } = true;
    [JsonPropertyName("allow_listing_search")]
    public bool AllowListingSearch { get; set; } = true;
    [JsonPropertyName("allow_messaging")]
    public bool AllowMessaging { get; set; } = true;
    [JsonPropertyName("allow_transactions")]
    public bool AllowTransactions { get; set; } = true;
    [JsonPropertyName("allow_events")]
    public bool AllowEvents { get; set; }
    [JsonPropertyName("allow_groups")]
    public bool AllowGroups { get; set; }
    [JsonPropertyName("allow_connections")]
    public bool AllowConnections { get; set; }
    [JsonPropertyName("allow_volunteering")]
    public bool AllowVolunteering { get; set; }
    [JsonPropertyName("allow_member_sync")]
    public bool AllowMemberSync { get; set; }
}
