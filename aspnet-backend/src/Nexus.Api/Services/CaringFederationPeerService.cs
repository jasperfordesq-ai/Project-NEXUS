// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed partial class CaringFederationPeerService
{
    private static readonly string[] ValidStatuses = ["pending", "active", "suspended"];

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public CaringFederationPeerService(NexusDbContext db, TenantContext tenantContext)
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

    public async Task<IReadOnlyList<CaringFederationPeerRow>> ListForTenantAsync(int tenantId, CancellationToken ct)
    {
        var peers = await _db.CaringFederationPeers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(peer => peer.TenantId == tenantId)
            .OrderBy(peer => peer.DisplayName)
            .ToListAsync(ct);

        return peers.Select(peer => Map(peer, redactSecret: true)).ToArray();
    }

    public async Task<IReadOnlyList<CaringFederationDirectoryPeerRow>> ListDiscoverableAsync(
        int tenantId,
        CancellationToken ct)
    {
        var peers = await _db.CaringFederationPeers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(peer => peer.TenantId == tenantId && peer.Status == "active")
            .OrderBy(peer => peer.DisplayName)
            .ToListAsync(ct);

        return peers.Select(peer => new CaringFederationDirectoryPeerRow(
            peer.Id,
            peer.PeerSlug,
            peer.DisplayName,
            peer.BaseUrl,
            Region: null,
            MemberCountBucket: null,
            AcceptsInboundTransfers: true)).ToArray();
    }

    public async Task<CaringFederationPeerMutationResult> CreateAsync(
        int tenantId,
        CaringFederationPeerRequest request,
        CancellationToken ct)
    {
        var validationError = ValidateCreate(request);
        if (validationError is not null)
        {
            return new CaringFederationPeerMutationResult(ErrorCode: "VALIDATION_ERROR", ErrorMessage: validationError);
        }

        var peerSlug = request.PeerSlug!.Trim();
        var exists = await _db.CaringFederationPeers
            .IgnoreQueryFilters()
            .AnyAsync(peer => peer.TenantId == tenantId && peer.PeerSlug == peerSlug, ct);
        if (exists)
        {
            return new CaringFederationPeerMutationResult(
                ErrorCode: "VALIDATION_ERROR",
                ErrorMessage: "A peer with that slug is already registered.");
        }

        var sharedSecret = string.IsNullOrWhiteSpace(request.SharedSecret)
            ? GenerateSecret()
            : request.SharedSecret!.Trim();

        var now = DateTime.UtcNow;
        var peer = new CaringFederationPeer
        {
            TenantId = tenantId,
            PeerSlug = peerSlug,
            DisplayName = request.DisplayName!.Trim(),
            BaseUrl = NormalizeBaseUrl(request.BaseUrl!),
            SharedSecret = sharedSecret,
            Status = IsValidStatus(request.Status) ? request.Status! : "pending",
            Notes = request.Notes,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringFederationPeers.Add(peer);
        await _db.SaveChangesAsync(ct);
        return new CaringFederationPeerMutationResult(Row: Map(peer, redactSecret: false));
    }

    public async Task<CaringFederationPeerMutationResult> UpdateStatusAsync(
        int tenantId,
        int id,
        string? status,
        CancellationToken ct)
    {
        if (!IsValidStatus(status))
        {
            return new CaringFederationPeerMutationResult(
                ErrorCode: "VALIDATION_ERROR",
                ErrorMessage: "Invalid status.");
        }

        var peer = await _db.CaringFederationPeers
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);
        if (peer is null)
        {
            return new CaringFederationPeerMutationResult(NotFound: true);
        }

        peer.Status = status!;
        peer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaringFederationPeerMutationResult(Row: Map(peer, redactSecret: true));
    }

    public async Task<CaringFederationPeerMutationResult> RotateSecretAsync(int tenantId, int id, CancellationToken ct)
    {
        var peer = await _db.CaringFederationPeers
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);
        if (peer is null)
        {
            return new CaringFederationPeerMutationResult(NotFound: true);
        }

        peer.SharedSecret = GenerateSecret();
        peer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaringFederationPeerMutationResult(Row: Map(peer, redactSecret: false));
    }

    public async Task DeleteAsync(int tenantId, int id, CancellationToken ct)
    {
        var peer = await _db.CaringFederationPeers
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);
        if (peer is null)
        {
            return;
        }

        _db.CaringFederationPeers.Remove(peer);
        await _db.SaveChangesAsync(ct);
    }

    private static CaringFederationPeerRow Map(CaringFederationPeer peer, bool redactSecret)
    {
        return new CaringFederationPeerRow(
            peer.Id,
            peer.TenantId,
            peer.PeerSlug,
            peer.DisplayName,
            peer.BaseUrl,
            redactSecret ? null : peer.SharedSecret,
            !string.IsNullOrWhiteSpace(peer.SharedSecret),
            peer.Status,
            peer.Notes,
            peer.LastHandshakeAt,
            peer.CreatedAt,
            peer.UpdatedAt);
    }

    private static string? ValidateCreate(CaringFederationPeerRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.PeerSlug)
            || string.IsNullOrWhiteSpace(request.DisplayName)
            || string.IsNullOrWhiteSpace(request.BaseUrl))
        {
            return "peer_slug, display_name, and base_url are required.";
        }

        if (!PeerSlugRegex().IsMatch(request.PeerSlug.Trim()))
        {
            return "peer_slug must be lowercase alphanumeric with hyphens.";
        }

        if (!IsSafeHttpsUrl(request.BaseUrl))
        {
            return "base_url must be a valid HTTPS URL.";
        }

        if (!string.IsNullOrWhiteSpace(request.SharedSecret))
        {
            var secretLength = request.SharedSecret.Trim().Length;
            if (secretLength is < 32 or > 128)
            {
                return "shared_secret must be between 32 and 128 characters when provided.";
            }
        }

        if (request.Status is not null && !IsValidStatus(request.Status))
        {
            return "Invalid status.";
        }

        return null;
    }

    private static bool IsValidStatus(string? status)
    {
        return !string.IsNullOrWhiteSpace(status)
            && ValidStatuses.Contains(status, StringComparer.Ordinal);
    }

    private static bool IsSafeHttpsUrl(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri))
        {
            return false;
        }

        return string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(uri.UserInfo)
            && !string.IsNullOrWhiteSpace(uri.Host);
    }

    private static string NormalizeBaseUrl(string value)
    {
        return value.Trim().TrimEnd('/');
    }

    private static string GenerateSecret()
    {
        return Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
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

    [GeneratedRegex("^[a-z0-9][a-z0-9\\-]{1,99}$", RegexOptions.CultureInvariant)]
    private static partial Regex PeerSlugRegex();
}

public sealed class CaringFederationPeerRequest
{
    [JsonPropertyName("peer_slug")] public string? PeerSlug { get; set; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; set; }
    [JsonPropertyName("base_url")] public string? BaseUrl { get; set; }
    [JsonPropertyName("shared_secret")] public string? SharedSecret { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

public sealed class CaringFederationPeerStatusRequest
{
    [JsonPropertyName("status")] public string? Status { get; set; }
}

public sealed record CaringFederationPeerRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("peer_slug")] string PeerSlug,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("base_url")] string BaseUrl,
    [property: JsonPropertyName("shared_secret")] string? SharedSecret,
    [property: JsonPropertyName("shared_secret_set")] bool SharedSecretSet,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("last_handshake_at")] DateTime? LastHandshakeAt,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record CaringFederationDirectoryPeerRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("base_url")] string BaseUrl,
    [property: JsonPropertyName("region")] string? Region,
    [property: JsonPropertyName("member_count_bucket")] string? MemberCountBucket,
    [property: JsonPropertyName("accepts_inbound_transfers")] bool AcceptsInboundTransfers);

public sealed record CaringFederationPeerMutationResult(
    CaringFederationPeerRow? Row = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    bool NotFound = false);
