// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Mail;
using System.Net.Sockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public interface IPublicOidcEndpointValidator
{
    Task<IReadOnlyList<IPAddress>> ResolvePublicHttpsAsync(Uri endpoint, CancellationToken ct);
}

public sealed class PublicOidcEndpointValidator : IPublicOidcEndpointValidator
{
    public async Task<IReadOnlyList<IPAddress>> ResolvePublicHttpsAsync(Uri endpoint, CancellationToken ct)
    {
        if (!endpoint.IsAbsoluteUri
            || endpoint.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(endpoint.UserInfo))
            throw new SsoAuthenticationException("SSO endpoint must be public HTTPS.");

        if (endpoint.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || endpoint.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
            throw new SsoAuthenticationException("SSO endpoint must be public HTTPS.");

        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(endpoint.DnsSafeHost, ct);
        }
        catch (Exception ex) when (ex is SocketException or ArgumentException)
        {
            throw new SsoAuthenticationException("SSO endpoint host could not be resolved.", ex);
        }

        if (addresses.Length == 0 || addresses.Any(IsNonPublic))
            throw new SsoAuthenticationException("SSO endpoint resolved to a non-public address.");
        return addresses;
    }

    private static bool IsNonPublic(IPAddress address)
    {
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))
            return true;

        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
            return bytes[0] is 0 or 10 or 127
                || bytes[0] == 169 && bytes[1] == 254
                || bytes[0] == 172 && bytes[1] is >= 16 and <= 31
                || bytes[0] == 192 && bytes[1] == 168
                || bytes[0] >= 224;

        return address.IsIPv6LinkLocal
            || address.IsIPv6Multicast
            || address.IsIPv6SiteLocal
            || bytes[0] is 0xfc or 0xfd
            || address.Equals(IPAddress.IPv6Loopback);
    }
}

public interface ISsoOidcHttpTransport
{
    Task ValidateDestinationAsync(Uri endpoint, CancellationToken ct);
    Task<string> GetAsync(Uri endpoint, CancellationToken ct);
    Task<string> PostFormAsync(Uri endpoint, IReadOnlyDictionary<string, string> fields, CancellationToken ct);
}

/// <summary>
/// Resolves and validates the destination once, then connects the exact request
/// to those public addresses while TLS still authenticates the original host.
/// This closes DNS-rebinding time-of-check/time-of-use gaps.
/// </summary>
public sealed class PinnedSsoOidcHttpTransport(IPublicOidcEndpointValidator validator) : ISsoOidcHttpTransport
{
    private const int MaximumResponseBytes = 1024 * 1024;

    public async Task ValidateDestinationAsync(Uri endpoint, CancellationToken ct) =>
        _ = await validator.ResolvePublicHttpsAsync(endpoint, ct);

    public Task<string> GetAsync(Uri endpoint, CancellationToken ct) =>
        SendAsync(endpoint, HttpMethod.Get, null, ct);

    public Task<string> PostFormAsync(
        Uri endpoint,
        IReadOnlyDictionary<string, string> fields,
        CancellationToken ct) =>
        SendAsync(endpoint, HttpMethod.Post, new FormUrlEncodedContent(fields), ct);

    private async Task<string> SendAsync(
        Uri endpoint,
        HttpMethod method,
        HttpContent? content,
        CancellationToken ct)
    {
        var addresses = await validator.ResolvePublicHttpsAsync(endpoint, ct);
        var port = endpoint.IsDefaultPort ? 443 : endpoint.Port;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectTimeout = TimeSpan.FromSeconds(10),
            PooledConnectionLifetime = TimeSpan.FromMinutes(1),
            ConnectCallback = async (_, token) =>
            {
                Exception? last = null;
                foreach (var address in addresses)
                {
                    var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                    try
                    {
                        await socket.ConnectAsync(address, port, token);
                        return new NetworkStream(socket, ownsSocket: true);
                    }
                    catch (Exception ex) when (ex is SocketException or OperationCanceledException)
                    {
                        last = ex;
                        socket.Dispose();
                        if (ex is OperationCanceledException) throw;
                    }
                }
                throw new HttpRequestException("No validated OIDC address accepted the connection.", last);
            }
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
        using var request = new HttpRequestMessage(method, endpoint) { Content = content };
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if ((int)response.StatusCode is >= 300 and < 400 || !response.IsSuccessStatusCode)
            throw new SsoAuthenticationException("SSO provider request failed.");
        if (response.Content.Headers.ContentLength is > MaximumResponseBytes)
            throw new SsoAuthenticationException("SSO provider response is too large.");
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        if (bytes.Length > MaximumResponseBytes)
            throw new SsoAuthenticationException("SSO provider response is too large.");
        return Encoding.UTF8.GetString(bytes);
    }
}

/// <summary>
/// Laravel-compatible tenant OIDC flow and browser-bound callback exchange.
/// State, PKCE, OIDC nonce, provider identity and final token issuance form one
/// fail-closed security transaction; no provider token is returned to a browser.
/// </summary>
public sealed class SsoOidcAuthenticationService
{
    private static readonly Regex BrowserChallengePattern =
        new("^[A-Za-z0-9_-]{43}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex BrowserVerifierPattern =
        new("^[A-Za-z0-9._~-]{43,128}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex CallbackCodePattern =
        new("^[A-Za-z0-9]{40,128}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly TimeSpan FlowLifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan CallbackLifetime = TimeSpan.FromMinutes(5);
    private static readonly char[] Alphanumeric =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    private readonly NexusDbContext _db;
    private readonly ISsoOidcHttpTransport _http;
    private readonly IDataProtector _flowProtector;
    private readonly IDataProtector _providerSecretProtector;
    private readonly IDataProtector _identityProtector;
    private readonly TokenService _tokens;
    private readonly IConfiguration _configuration;

    public SsoOidcAuthenticationService(
        NexusDbContext db,
        ISsoOidcHttpTransport http,
        IDataProtectionProvider dataProtection,
        TokenService tokens,
        IConfiguration configuration)
    {
        _db = db;
        _http = http;
        _flowProtector = dataProtection.CreateProtector("Nexus.Sso.OidcFlow.v1");
        _providerSecretProtector = dataProtection.CreateProtector("Nexus.Sso.ProviderSecrets.v1");
        _identityProtector = dataProtection.CreateProtector("Nexus.Sso.PendingIdentity.v1");
        _tokens = tokens;
        _configuration = configuration;
    }

    public async Task<SsoAuthorizationRequest> BeginAsync(
        int tenantId,
        string providerKey,
        string? browserChallenge,
        string redirectUri,
        CancellationToken ct)
    {
        browserChallenge = RequireBrowserChallenge(browserChallenge);
        var provider = await EnabledProviderAsync(tenantId, providerKey, ct);
        var discovery = await DiscoverAsync(provider.IssuerUrl, ct);
        await _http.ValidateDestinationAsync(discovery.AuthorizationEndpoint, ct);

        var stateNonce = Base64Url(RandomNumberGenerator.GetBytes(32));
        var oidcNonce = Base64Url(RandomNumberGenerator.GetBytes(32));
        var codeVerifier = Base64Url(RandomNumberGenerator.GetBytes(72));
        var now = DateTime.UtcNow;
        var statePayload = new SsoStatePayload(
            tenantId,
            provider.ProviderKey,
            stateNonce,
            new DateTimeOffset(now).ToUnixTimeSeconds(),
            browserChallenge);
        var state = SignState(statePayload);

        _db.SsoOidcFlows.Add(new SsoOidcFlow
        {
            TenantId = tenantId,
            ProviderKey = provider.ProviderKey,
            StateNonceHash = HexHash(stateNonce),
            CodeVerifierCiphertext = _flowProtector.Protect(codeVerifier),
            OidcNonce = oidcNonce,
            BrowserChallenge = browserChallenge,
            RedirectUri = redirectUri,
            AuthenticationStartedAt = now,
            ExpiresAt = now.Add(FlowLifetime),
            CreatedAt = now
        });
        await _db.SaveChangesAsync(ct);

        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = provider.ClientId,
            ["redirect_uri"] = redirectUri,
            ["scope"] = string.IsNullOrWhiteSpace(provider.Scopes) ? "openid profile email" : provider.Scopes,
            ["state"] = state,
            ["nonce"] = oidcNonce,
            ["code_challenge"] = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier))),
            ["code_challenge_method"] = "S256"
        };
        return new SsoAuthorizationRequest(AppendQuery(discovery.AuthorizationEndpoint, query), state);
    }

    public int? TenantIdFromState(string? state)
    {
        try { return VerifyState(state).TenantId; }
        catch (SsoAuthenticationException) { return null; }
    }

    public async Task<SsoCallbackResult> HandleCallbackAsync(string state, string code, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new SsoAuthenticationException("SSO callback is missing an authorization code.");
        var payload = VerifyState(state);
        var now = DateTime.UtcNow;
        var nonceHash = HexHash(payload.StateNonce);
        var flow = await _db.SsoOidcFlows.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.StateNonceHash == nonceHash, ct)
            ?? throw new SsoAuthenticationException("SSO flow state expired or already used.");
        if (flow.TenantId != payload.TenantId
            || flow.ProviderKey != payload.ProviderKey
            || flow.BrowserChallenge != payload.BrowserChallenge
            || flow.ExpiresAt <= now
            || flow.ConsumedAt is not null)
            throw new SsoAuthenticationException("SSO flow state expired or already used.");

        var consumed = await ConsumeFlowAsync(flow.Id, now, ct);
        if (!consumed)
            throw new SsoAuthenticationException("SSO flow state expired or already used.");

        var provider = await EnabledProviderAsync(payload.TenantId, payload.ProviderKey, ct);
        var discovery = await DiscoverAsync(provider.IssuerUrl, ct);
        var claims = await ExchangeAndValidateAsync(
            provider,
            discovery,
            code,
            _flowProtector.Unprotect(flow.CodeVerifierCiphertext),
            flow.RedirectUri,
            flow.OidcNonce,
            ct);
        var resolved = await ResolveAccountAsync(provider, claims, flow.AuthenticationStartedAt, ct);
        var callbackCode = await IssueCallbackGrantAsync(
            resolved.User,
            provider,
            resolved.PendingIdentity,
            resolved.IsNew,
            flow.AuthenticationStartedAt,
            flow.BrowserChallenge,
            ct);
        return new SsoCallbackResult(
            callbackCode,
            $"sso:{provider.ProviderKey}",
            payload.TenantId,
            flow.BrowserChallenge,
            resolved.IsNew);
    }

    public async Task<OAuthExchangeResult> ExchangeAsync(
        string? code,
        string? browserVerifier,
        string? remoteIp,
        CancellationToken ct)
    {
        if (code is null || !CallbackCodePattern.IsMatch(code))
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
        var codeHash = HexHash(code);
        var grant = await _db.OAuthCallbackGrants.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.CodeHash == codeHash, ct)
            ?? throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
        if (grant.ExpiresAt <= DateTime.UtcNow || grant.ConsumedAt is not null
            || !VerifierMatches(grant.BrowserChallenge, browserVerifier))
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");

        var now = DateTime.UtcNow;
        if (!await ConsumeGrantAsync(grant.Id, now, ct))
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");

        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(ct)
            : null;
        if (_db.Database.IsRelational())
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM users WHERE \"Id\" = {grant.UserId} AND \"TenantId\" = {grant.TenantId} FOR UPDATE",
                ct);
        var user = await _db.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.Id == grant.UserId && x.TenantId == grant.TenantId, ct)
            ?? throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
        var tenantActive = await _db.Tenants.IgnoreQueryFilters()
            .AnyAsync(x => x.Id == grant.TenantId && x.IsActive, ct);
        if (!tenantActive
            || !CanSignIn(user)
            || user.TwoFactorEnabled
            || user.AuthenticationInvalidatedAt is not null
                && user.AuthenticationInvalidatedAt >= grant.AuthenticationStartedAt)
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");

        if (!string.IsNullOrWhiteSpace(grant.PendingIdentityCiphertext))
        {
            var pending = JsonSerializer.Deserialize<PendingSsoIdentity>(
                _identityProtector.Unprotect(grant.PendingIdentityCiphertext))
                ?? throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
            await LinkIdentityAsync(user, pending, now, ct);
        }

        var accessToken = _tokens.GenerateJwt(user, "sso");
        var (refreshToken, refreshHash) = TokenService.GenerateRefreshToken();
        _db.RefreshTokens.Add(new RefreshToken
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            TokenHash = refreshHash,
            ExpiresAt = now.AddDays(7),
            ClientType = "sso",
            CreatedByIp = remoteIp,
            CreatedAt = now
        });
        user.LastLoginAt = now;
        await _db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return new OAuthExchangeResult(
            accessToken,
            refreshToken,
            _tokens.AccessTokenExpirySeconds,
            7 * 24 * 60 * 60,
            grant.Provider,
            grant.IsNew,
            grant.TenantId);
    }

    public async Task<string> FrontendCallbackBaseAsync(int tenantId, CancellationToken ct)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(x => x.Id == tenantId, ct);
        if (tenant.Id > 1 && !string.IsNullOrWhiteSpace(tenant.Domain))
        {
            var domain = tenant.Domain.Trim().TrimEnd('/');
            return domain.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                ? domain
                : domain.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    ? "https://" + domain[7..]
                    : "https://" + domain;
        }
        var root = (_configuration["App:FrontendUrl"] ?? "http://localhost:5173").TrimEnd('/');
        return string.IsNullOrWhiteSpace(tenant.Slug) ? root : $"{root}/{Uri.EscapeDataString(tenant.Slug)}";
    }

    private async Task<bool> ConsumeFlowAsync(long id, DateTime now, CancellationToken ct)
    {
        if (_db.Database.IsRelational())
            return await _db.SsoOidcFlows.IgnoreQueryFilters()
                .Where(x => x.Id == id && x.ConsumedAt == null && x.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ConsumedAt, now), ct) == 1;
        var row = await _db.SsoOidcFlows.IgnoreQueryFilters().SingleAsync(x => x.Id == id, ct);
        if (row.ConsumedAt is not null || row.ExpiresAt <= now) return false;
        row.ConsumedAt = now;
        await _db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<bool> ConsumeGrantAsync(long id, DateTime now, CancellationToken ct)
    {
        if (_db.Database.IsRelational())
            return await _db.OAuthCallbackGrants.IgnoreQueryFilters()
                .Where(x => x.Id == id && x.ConsumedAt == null && x.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ConsumedAt, now), ct) == 1;
        var row = await _db.OAuthCallbackGrants.IgnoreQueryFilters().SingleAsync(x => x.Id == id, ct);
        if (row.ConsumedAt is not null || row.ExpiresAt <= now) return false;
        row.ConsumedAt = now;
        await _db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<TenantSsoProvider> EnabledProviderAsync(int tenantId, string key, CancellationToken ct)
    {
        key = key.Trim().ToLowerInvariant();
        return await _db.TenantSsoProviders.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.ProviderKey == key && x.IsEnabled, ct)
            ?? throw new SsoAuthenticationException("SSO provider is not available.");
    }

    private async Task<OidcDiscovery> DiscoverAsync(string issuer, CancellationToken ct)
    {
        var issuerUri = RequireHttpsUri(issuer);
        await _http.ValidateDestinationAsync(issuerUri, ct);
        var discoveryUri = new Uri(issuerUri.ToString().TrimEnd('/') + "/.well-known/openid-configuration");
        using var document = JsonDocument.Parse(await _http.GetAsync(discoveryUri, ct));
        var root = document.RootElement;
        var discoveredIssuer = Required(root, "issuer");
        if (!string.Equals(discoveredIssuer.TrimEnd('/'), issuerUri.ToString().TrimEnd('/'), StringComparison.Ordinal))
            throw new SsoAuthenticationException("OIDC discovery issuer mismatch.");
        var result = new OidcDiscovery(
            discoveredIssuer,
            RequireHttpsUri(Required(root, "authorization_endpoint")),
            RequireHttpsUri(Required(root, "token_endpoint")),
            RequireHttpsUri(Required(root, "jwks_uri")));
        await _http.ValidateDestinationAsync(result.AuthorizationEndpoint, ct);
        await _http.ValidateDestinationAsync(result.TokenEndpoint, ct);
        await _http.ValidateDestinationAsync(result.JwksUri, ct);
        return result;
    }

    private async Task<ClaimsPrincipal> ExchangeAndValidateAsync(
        TenantSsoProvider provider,
        OidcDiscovery discovery,
        string code,
        string codeVerifier,
        string redirectUri,
        string expectedNonce,
        CancellationToken ct)
    {
        await _http.ValidateDestinationAsync(discovery.TokenEndpoint, ct);
        var fields = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["client_id"] = provider.ClientId,
            ["code_verifier"] = codeVerifier
        };
        if (!string.IsNullOrWhiteSpace(provider.ClientSecretEncrypted))
            fields["client_secret"] = _providerSecretProtector.Unprotect(provider.ClientSecretEncrypted);
        using var tokenDocument = JsonDocument.Parse(await _http.PostFormAsync(discovery.TokenEndpoint, fields, ct));
        var idToken = Required(tokenDocument.RootElement, "id_token");

        await _http.ValidateDestinationAsync(discovery.JwksUri, ct);
        var jwks = new JsonWebKeySet(await _http.GetAsync(discovery.JwksUri, ct));
        var parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = jwks.Keys,
            ValidateIssuer = true,
            ValidIssuer = discovery.Issuer,
            ValidateAudience = true,
            ValidAudience = provider.ClientId,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ClockSkew = TimeSpan.FromSeconds(60),
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256, SecurityAlgorithms.RsaSsaPssSha256]
        };
        var principal = new JwtSecurityTokenHandler { MapInboundClaims = false }
            .ValidateToken(idToken, parameters, out _);
        if (!FixedEquals(expectedNonce, principal.FindFirst("nonce")?.Value))
            throw new SsoAuthenticationException("OIDC nonce validation failed.");
        return principal;
    }

    private async Task<ResolvedSsoAccount> ResolveAccountAsync(
        TenantSsoProvider provider,
        ClaimsPrincipal claims,
        DateTime authenticationStartedAt,
        CancellationToken ct)
    {
        var subject = Claim(claims, JwtRegisteredClaimNames.Sub)
            ?? throw new SsoAuthenticationException("OIDC subject is missing.");
        var email = Claim(claims, JwtRegisteredClaimNames.Email) ?? Claim(claims, ClaimTypes.Email);
        if (email is not null && (!MailAddress.TryCreate(email, out _) || email.Length > 191)) email = null;
        var emailVerified = bool.TryParse(Claim(claims, "email_verified"), out var verified) && verified;
        email = email?.Trim().ToLowerInvariant();
        // Laravel applies the configured domain guard on every SSO login, not
        // only while provisioning a new account.
        AssertAllowedDomain(provider.AllowedEmailDomains, email, emailVerified);
        var qualifiedProvider = $"sso:{provider.TenantId}:{provider.ProviderKey}";
        var identity = await _db.OAuthIdentities.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.Provider == qualifiedProvider && x.ProviderUserId == subject, ct);
        User? user = identity is null ? null : await _db.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.Id == identity.UserId && x.TenantId == provider.TenantId, ct);
        var isNew = false;

        if (user is null)
        {
            if (string.IsNullOrWhiteSpace(email) || !emailVerified)
                throw new SsoAuthenticationException("SSO requires a verified email address.");
            user = await _db.Users.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == provider.TenantId && x.Email.ToLower() == email, ct);
            if (user is not null && !user.EmailVerified)
                throw new SsoAuthenticationException("The matching local account is not verified.");
            if (user is null)
            {
                if (!provider.AutoProvision)
                    throw new SsoAuthenticationException("SSO account provisioning is disabled.");
                user = new User
                {
                    TenantId = provider.TenantId,
                    Email = email,
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword(RandomAlphanumeric(64)),
                    FirstName = Claim(claims, JwtRegisteredClaimNames.GivenName)
                        ?? Claim(claims, ClaimTypes.GivenName)
                        ?? "Member",
                    LastName = Claim(claims, JwtRegisteredClaimNames.FamilyName)
                        ?? Claim(claims, ClaimTypes.Surname)
                        ?? string.Empty,
                    Role = "member",
                    IsActive = true,
                    IsApproved = true,
                    EmailVerified = true,
                    EmailVerifiedAt = DateTime.UtcNow,
                    RegistrationStatus = RegistrationStatus.Active,
                    CreatedAt = DateTime.UtcNow
                };
                _db.Users.Add(user);
                await _db.SaveChangesAsync(ct);
                isNew = true;
            }
        }

        if (!CanSignIn(user))
            throw new SsoAuthenticationException("SSO account is not permitted to sign in.");
        if (user.TenantId != provider.TenantId)
            throw new SsoAuthenticationException("SSO identity tenant mismatch.");
        var raw = claims.Claims
            .GroupBy(x => x.Type, StringComparer.Ordinal)
            .ToDictionary(x => x.Key, x => x.Last().Value, StringComparer.Ordinal);
        var pending = new PendingSsoIdentity(
            qualifiedProvider,
            subject,
            emailVerified ? email : null,
            emailVerified ? Claim(claims, "picture") : null,
            emailVerified ? JsonSerializer.Serialize(raw) : null,
            authenticationStartedAt);
        return new ResolvedSsoAccount(user, pending, isNew);
    }

    private async Task<string> IssueCallbackGrantAsync(
        User user,
        TenantSsoProvider provider,
        PendingSsoIdentity identity,
        bool isNew,
        DateTime authenticationStartedAt,
        string browserChallenge,
        CancellationToken ct)
    {
        var code = RandomAlphanumeric(64);
        _db.OAuthCallbackGrants.Add(new OAuthCallbackGrant
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            CodeHash = HexHash(code),
            Provider = $"sso:{provider.ProviderKey}",
            IsNew = isNew,
            BrowserChallenge = browserChallenge,
            AuthenticationStartedAt = authenticationStartedAt,
            PendingIdentityCiphertext = _identityProtector.Protect(JsonSerializer.Serialize(identity)),
            ExpiresAt = DateTime.UtcNow.Add(CallbackLifetime),
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
        return code;
    }

    private async Task LinkIdentityAsync(User user, PendingSsoIdentity pending, DateTime now, CancellationToken ct)
    {
        if (user.TenantId < 1 || pending.AuthenticationStartedAt == default)
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
        var identity = await _db.OAuthIdentities.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.Provider == pending.Provider && x.ProviderUserId == pending.ProviderUserId, ct);
        if (identity is not null && (identity.UserId != user.Id || identity.TenantId != user.TenantId))
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
        var userProviderIdentity = await _db.OAuthIdentities.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.UserId == user.Id && x.Provider == pending.Provider, ct);
        if (userProviderIdentity is not null && userProviderIdentity.ProviderUserId != pending.ProviderUserId)
            throw new SsoAuthenticationException("OAuth callback code is invalid or expired.");
        identity ??= userProviderIdentity;
        if (identity is null)
        {
            identity = new OAuthIdentity
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                Provider = pending.Provider,
                ProviderUserId = pending.ProviderUserId,
                LinkedAt = now,
                CreatedAt = now
            };
            _db.OAuthIdentities.Add(identity);
        }
        if (pending.ProviderEmail is not null)
        {
            identity.ProviderEmail = pending.ProviderEmail;
            identity.AvatarUrl = pending.AvatarUrl;
            identity.RawPayload = pending.RawPayload;
        }
        identity.LastUsedAt = now;
        identity.UpdatedAt = now;
    }

    private string SignState(SsoStatePayload payload)
    {
        var body = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload));
        using var hmac = new HMACSHA256(StateKey());
        return body + "." + Base64Url(hmac.ComputeHash(Encoding.ASCII.GetBytes(body)));
    }

    private SsoStatePayload VerifyState(string? state)
    {
        var parts = state?.Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (parts is not { Length: 2 })
            throw new SsoAuthenticationException("SSO state is invalid.");
        using var hmac = new HMACSHA256(StateKey());
        var expected = Base64Url(hmac.ComputeHash(Encoding.ASCII.GetBytes(parts[0])));
        if (!FixedEquals(expected, parts[1]))
            throw new SsoAuthenticationException("SSO state is invalid.");
        SsoStatePayload payload;
        try
        {
            payload = JsonSerializer.Deserialize<SsoStatePayload>(Base64UrlDecode(parts[0]))
                ?? throw new JsonException();
        }
        catch (Exception ex) when (ex is JsonException or FormatException)
        {
            throw new SsoAuthenticationException("SSO state is invalid.", ex);
        }
        var started = DateTimeOffset.FromUnixTimeSeconds(payload.AuthenticationStartedAt).UtcDateTime;
        if (payload.TenantId < 1
            || string.IsNullOrWhiteSpace(payload.ProviderKey)
            || string.IsNullOrWhiteSpace(payload.StateNonce)
            || !BrowserChallengePattern.IsMatch(payload.BrowserChallenge)
            || started > DateTime.UtcNow.AddMinutes(1)
            || started.Add(FlowLifetime) <= DateTime.UtcNow)
            throw new SsoAuthenticationException("SSO state is invalid or expired.");
        return payload;
    }

    private byte[] StateKey()
    {
        var value = _configuration["App:Key"] ?? _configuration["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(value) || Encoding.UTF8.GetByteCount(value) < 32)
            throw new SsoAuthenticationException("SSO state signing key is not configured securely.");
        return SHA256.HashData(Encoding.UTF8.GetBytes(value));
    }

    private static bool CanSignIn(User user)
    {
        if (!user.IsActive
            || user.SuspendedAt is not null
            || user.RegistrationStatus is RegistrationStatus.Rejected
                or RegistrationStatus.PendingAdminReview
                or RegistrationStatus.VerificationFailed)
            return false;
        var privileged = user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod
            || user.Role is "admin" or "tenant_admin" or "super_admin" or "god";
        return privileged || user.IsApproved;
    }

    private static string RequireBrowserChallenge(string? challenge) =>
        challenge is not null && BrowserChallengePattern.IsMatch(challenge)
            ? challenge
            : throw new SsoAuthenticationException("OAuth browser challenge is invalid.");

    private static bool VerifierMatches(string challenge, string? verifier)
    {
        if (!BrowserChallengePattern.IsMatch(challenge)
            || verifier is null
            || !BrowserVerifierPattern.IsMatch(verifier))
            return false;
        var actual = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(verifier)));
        return FixedEquals(challenge, actual);
    }

    private static void AssertAllowedDomain(string? json, string? email, bool emailVerified)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        string[] domains;
        try { domains = JsonSerializer.Deserialize<string[]>(json) ?? []; }
        catch (JsonException) { throw new SsoAuthenticationException("SSO email domain is not allowed."); }
        if (domains.Length == 0) return;
        if (!emailVerified || email is null)
            throw new SsoAuthenticationException("SSO email domain is not allowed.");
        var at = email.LastIndexOf('@');
        var domain = at >= 0 ? email[(at + 1)..].ToLowerInvariant() : string.Empty;
        if (!domains.Any(x => string.Equals(x.Trim().TrimStart('@'), domain, StringComparison.OrdinalIgnoreCase)))
            throw new SsoAuthenticationException("SSO email domain is not allowed.");
    }

    private static Uri RequireHttpsUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new SsoAuthenticationException("OIDC endpoint is invalid.");
        return uri;
    }

    private static string Required(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(value.GetString())
                ? value.GetString()!
                : throw new SsoAuthenticationException($"OIDC response is missing {name}.");

    private static string? Claim(ClaimsPrincipal principal, string type) =>
        principal.Claims.FirstOrDefault(x => x.Type == type)?.Value;

    private static string AppendQuery(Uri endpoint, IReadOnlyDictionary<string, string> query) =>
        endpoint + "?" + string.Join("&", query.Select(x =>
            $"{Uri.EscapeDataString(x.Key)}={Uri.EscapeDataString(x.Value)}"));

    private static string RandomAlphanumeric(int length)
    {
        var bytes = RandomNumberGenerator.GetBytes(length);
        var chars = new char[length];
        for (var i = 0; i < length; i++) chars[i] = Alphanumeric[bytes[i] % Alphanumeric.Length];
        return new string(chars);
    }

    private static string HexHash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string Base64Url(byte[] value) => Base64UrlEncoder.Encode(value);
    private static byte[] Base64UrlDecode(string value) => Base64UrlEncoder.DecodeBytes(value);
    private static bool FixedEquals(string? left, string? right)
    {
        if (left is null || right is null) return false;
        var a = Encoding.UTF8.GetBytes(left);
        var b = Encoding.UTF8.GetBytes(right);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }
}

public sealed class SsoAuthenticationException : Exception
{
    public SsoAuthenticationException(string message) : base(message) { }
    public SsoAuthenticationException(string message, Exception inner) : base(message, inner) { }
}

public sealed record SsoAuthorizationRequest(string Url, string State);
public sealed record SsoCallbackResult(string CallbackCode, string Provider, int TenantId, string BrowserChallenge, bool IsNew);
public sealed record OAuthExchangeResult(string Token, string RefreshToken, int ExpiresIn, int RefreshExpiresIn, string Provider, bool IsNew, int TenantId);
internal sealed record OidcDiscovery(string Issuer, Uri AuthorizationEndpoint, Uri TokenEndpoint, Uri JwksUri);
internal sealed record ResolvedSsoAccount(User User, PendingSsoIdentity PendingIdentity, bool IsNew);
internal sealed record PendingSsoIdentity(
    string Provider,
    string ProviderUserId,
    string? ProviderEmail,
    string? AvatarUrl,
    string? RawPayload,
    DateTime AuthenticationStartedAt);
internal sealed record SsoStatePayload(
    [property: JsonPropertyName("t")] int TenantId,
    [property: JsonPropertyName("p")] string ProviderKey,
    [property: JsonPropertyName("n")] string StateNonce,
    [property: JsonPropertyName("x")] long AuthenticationStartedAt,
    [property: JsonPropertyName("b")] string BrowserChallenge);
