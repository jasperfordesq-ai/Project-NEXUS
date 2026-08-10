// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class SsoOidcAuthenticationServiceTests
{
    private const string Issuer = "https://idp.example.test";
    private const string ClientId = "nexus-sso-client";
    private const string Verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

    [Fact]
    public async Task OidcFlow_IsSignedPkceBoundSingleUseAndIssuesTenantCredentials()
    {
        await using var fixture = await Fixture.CreateAsync();
        var challenge = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(Verifier)));

        var authorization = await fixture.Service.BeginAsync(
            42,
            "entra",
            challenge,
            "https://api.example.test/api/v2/auth/sso/callback",
            CancellationToken.None);

        var uri = new Uri(authorization.Url);
        var query = ParseQuery(uri.Query);
        query["response_type"].Should().Be("code");
        query["client_id"].Should().Be(ClientId);
        query["code_challenge_method"].Should().Be("S256");
        query["code_challenge"].Should().HaveLength(43);
        query["nonce"].Should().HaveLength(43);
        query["state"].Should().Be(authorization.State);
        authorization.State.Should().NotContain("tenant:42");

        var flow = await fixture.Db.SsoOidcFlows.IgnoreQueryFilters().SingleAsync();
        flow.StateNonceHash.Should().HaveLength(64);
        flow.CodeVerifierCiphertext.Should().NotContain(query["code_challenge"]);
        fixture.Handler.Nonce = flow.OidcNonce;

        var callback = await fixture.Service.HandleCallbackAsync(
            authorization.State,
            "upstream-code",
            CancellationToken.None);
        callback.Provider.Should().Be("sso:entra");
        callback.TenantId.Should().Be(42);
        callback.BrowserChallenge.Should().Be(challenge);
        callback.CallbackCode.Should().MatchRegex("^[A-Za-z0-9]{64}$");

        var grant = await fixture.Db.OAuthCallbackGrants.IgnoreQueryFilters().SingleAsync();
        grant.CodeHash.Should().NotBe(callback.CallbackCode);
        grant.PendingIdentityCiphertext.Should().NotContain("oidc-subject-42");

        var wrongBrowser = () => fixture.Service.ExchangeAsync(
            callback.CallbackCode,
            new string('x', 64),
            "203.0.113.10",
            CancellationToken.None);
        await wrongBrowser.Should().ThrowAsync<SsoAuthenticationException>();
        (await fixture.Db.OAuthCallbackGrants.IgnoreQueryFilters().SingleAsync()).ConsumedAt.Should().BeNull();

        var exchanged = await fixture.Service.ExchangeAsync(
            callback.CallbackCode,
            Verifier,
            "203.0.113.10",
            CancellationToken.None);
        exchanged.Token.Should().NotBeNullOrWhiteSpace();
        exchanged.RefreshToken.Should().NotBeNullOrWhiteSpace();
        exchanged.Provider.Should().Be("sso:entra");
        exchanged.TenantId.Should().Be(42);
        exchanged.IsNew.Should().BeTrue();
        new JwtSecurityTokenHandler().ReadJwtToken(exchanged.Token).Claims
            .Should().Contain(x => x.Type == "tenant_id" && x.Value == "42");

        var user = await fixture.Db.Users.IgnoreQueryFilters().SingleAsync(x => x.TenantId == 42);
        user.Email.Should().Be("member@example.test");
        user.LastLoginAt.Should().NotBeNull();
        var identity = await fixture.Db.OAuthIdentities.IgnoreQueryFilters().SingleAsync();
        identity.UserId.Should().Be(user.Id);
        identity.Provider.Should().Be("sso:42:entra");
        identity.ProviderUserId.Should().Be("oidc-subject-42");
        (await fixture.Db.RefreshTokens.IgnoreQueryFilters().SingleAsync()).CreatedByIp.Should().Be("203.0.113.10");

        var replay = () => fixture.Service.ExchangeAsync(
            callback.CallbackCode,
            Verifier,
            null,
            CancellationToken.None);
        await replay.Should().ThrowAsync<SsoAuthenticationException>();
        fixture.Db.RefreshTokens.IgnoreQueryFilters().Should().HaveCount(1);
    }

    [Fact]
    public async Task OidcFlow_RejectsTamperedStateAndUnverifiedOrWrongDomainIdentity()
    {
        await using var fixture = await Fixture.CreateAsync();
        var challenge = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(Verifier)));
        var authorization = await fixture.Service.BeginAsync(
            42,
            "entra",
            challenge,
            "https://api.example.test/api/v2/auth/sso/callback",
            CancellationToken.None);
        fixture.Handler.Nonce = (await fixture.Db.SsoOidcFlows.IgnoreQueryFilters().SingleAsync()).OidcNonce;

        fixture.Service.TenantIdFromState(authorization.State + "x").Should().BeNull();
        var tampered = () => fixture.Service.HandleCallbackAsync(
            authorization.State + "x",
            "upstream-code",
            CancellationToken.None);
        await tampered.Should().ThrowAsync<SsoAuthenticationException>();

        fixture.Handler.Email = "member@outside.test";
        var wrongDomain = () => fixture.Service.HandleCallbackAsync(
            authorization.State,
            "upstream-code",
            CancellationToken.None);
        await wrongDomain.Should().ThrowAsync<SsoAuthenticationException>();
        fixture.Db.Users.IgnoreQueryFilters().Should().BeEmpty();

        var replay = () => fixture.Service.HandleCallbackAsync(
            authorization.State,
            "upstream-code",
            CancellationToken.None);
        await replay.Should().ThrowAsync<SsoAuthenticationException>();
    }

    [Fact]
    public async Task OidcFlow_ExistingSubjectPreservesTrustedIdentityWhenEmailClaimIsUnverified()
    {
        await using var fixture = await Fixture.CreateAsync();
        var provider = await fixture.Db.TenantSsoProviders.IgnoreQueryFilters().SingleAsync();
        provider.AllowedEmailDomains = null;
        var user = new User
        {
            Id = 700,
            TenantId = 42,
            Email = "trusted@example.test",
            PasswordHash = "not-used",
            FirstName = "Existing",
            LastName = "Member",
            IsActive = true,
            IsApproved = true,
            EmailVerified = true,
            RegistrationStatus = RegistrationStatus.Active
        };
        fixture.Db.Users.Add(user);
        fixture.Db.OAuthIdentities.Add(new OAuthIdentity
        {
            TenantId = 42,
            UserId = 700,
            Provider = "sso:42:entra",
            ProviderUserId = "oidc-subject-42",
            ProviderEmail = "trusted@example.test",
            RawPayload = "{\"trusted\":true}"
        });
        await fixture.Db.SaveChangesAsync();
        fixture.Handler.Email = "attacker-controlled@example.test";
        fixture.Handler.EmailVerified = false;
        var challenge = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(Verifier)));
        var authorization = await fixture.Service.BeginAsync(
            42, "entra", challenge, "https://api.example.test/api/v2/auth/sso/callback", CancellationToken.None);
        fixture.Handler.Nonce = (await fixture.Db.SsoOidcFlows.IgnoreQueryFilters().SingleAsync()).OidcNonce;

        var callback = await fixture.Service.HandleCallbackAsync(authorization.State, "upstream-code", CancellationToken.None);
        var exchange = await fixture.Service.ExchangeAsync(callback.CallbackCode, Verifier, null, CancellationToken.None);

        exchange.IsNew.Should().BeFalse();
        var identity = await fixture.Db.OAuthIdentities.IgnoreQueryFilters().SingleAsync();
        identity.ProviderEmail.Should().Be("trusted@example.test");
        identity.RawPayload.Should().Be("{\"trusted\":true}");
        identity.LastUsedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task OidcExchange_FailsAfterLogoutAllInvalidatesTheStartedCeremony()
    {
        await using var fixture = await Fixture.CreateAsync();
        var challenge = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(Verifier)));
        var authorization = await fixture.Service.BeginAsync(
            42, "entra", challenge, "https://api.example.test/api/v2/auth/sso/callback", CancellationToken.None);
        fixture.Handler.Nonce = (await fixture.Db.SsoOidcFlows.IgnoreQueryFilters().SingleAsync()).OidcNonce;
        var callback = await fixture.Service.HandleCallbackAsync(authorization.State, "upstream-code", CancellationToken.None);
        var user = await fixture.Db.Users.IgnoreQueryFilters().SingleAsync();
        user.AuthenticationInvalidatedAt = DateTime.UtcNow;
        await fixture.Db.SaveChangesAsync();

        var exchange = () => fixture.Service.ExchangeAsync(
            callback.CallbackCode, Verifier, null, CancellationToken.None);
        await exchange.Should().ThrowAsync<SsoAuthenticationException>();
        fixture.Db.RefreshTokens.IgnoreQueryFilters().Should().BeEmpty();
        (await fixture.Db.OAuthCallbackGrants.IgnoreQueryFilters().SingleAsync()).ConsumedAt.Should().NotBeNull();
    }

    private static Dictionary<string, string> ParseQuery(string query) => query
        .TrimStart('?')
        .Split('&', StringSplitOptions.RemoveEmptyEntries)
        .Select(part => part.Split('=', 2))
        .ToDictionary(part => Uri.UnescapeDataString(part[0]), part => Uri.UnescapeDataString(part[1]));

    private static string Base64Url(byte[] bytes) => Base64UrlEncoder.Encode(bytes);

    private sealed class Fixture : IAsyncDisposable
    {
        private readonly RSA _rsa;
        public NexusDbContext Db { get; }
        public FakeOidcHandler Handler { get; }
        public SsoOidcAuthenticationService Service { get; }

        private Fixture(NexusDbContext db, FakeOidcHandler handler, SsoOidcAuthenticationService service, RSA rsa)
        {
            Db = db;
            Handler = handler;
            Service = service;
            _rsa = rsa;
        }

        public static async Task<Fixture> CreateAsync()
        {
            var tenantContext = new TenantContext();
            var options = new DbContextOptionsBuilder<NexusDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
                .Options;
            var db = new NexusDbContext(options, tenantContext);
            db.Tenants.Add(new Tenant { Id = 42, Slug = "acme", Name = "Acme", IsActive = true });
            db.TenantSsoProviders.Add(new TenantSsoProvider
            {
                TenantId = 42,
                ProviderKey = "entra",
                DisplayName = "Entra",
                Preset = "entra",
                IssuerUrl = Issuer,
                ClientId = ClientId,
                Scopes = "openid profile email",
                AllowedEmailDomains = "[\"example.test\"]",
                AutoProvision = true,
                IsEnabled = true
            });
            await db.SaveChangesAsync();

            var rsa = RSA.Create(2048);
            var handler = new FakeOidcHandler(rsa);
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["App:Key"] = "unit-test-sso-state-key-at-least-32-bytes-long",
                ["App:FrontendUrl"] = "https://app.example.test",
                ["Jwt:Secret"] = "unit-test-jwt-secret-at-least-32-bytes-long",
                ["Jwt:Issuer"] = "nexus-tests",
                ["Jwt:Audience"] = "nexus-tests"
            }).Build();
            var service = new SsoOidcAuthenticationService(
                db,
                new FakeOidcTransport(handler),
                new EphemeralDataProtectionProvider(),
                new TokenService(configuration),
                configuration);
            return new Fixture(db, handler, service, rsa);
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            _rsa.Dispose();
        }
    }

    private sealed class FakeOidcTransport(HttpMessageHandler handler) : ISsoOidcHttpTransport
    {
        private readonly HttpMessageInvoker _invoker = new(handler, disposeHandler: false);

        public Task ValidateDestinationAsync(Uri endpoint, CancellationToken ct) => Task.CompletedTask;

        public async Task<string> GetAsync(Uri endpoint, CancellationToken ct)
        {
            using var response = await _invoker.SendAsync(new HttpRequestMessage(HttpMethod.Get, endpoint), ct);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync(ct);
        }

        public async Task<string> PostFormAsync(
            Uri endpoint,
            IReadOnlyDictionary<string, string> fields,
            CancellationToken ct)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new FormUrlEncodedContent(fields)
            };
            using var response = await _invoker.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync(ct);
        }
    }

    private sealed class FakeOidcHandler(RSA rsa) : HttpMessageHandler
    {
        public string Nonce { get; set; } = string.Empty;
        public string Email { get; set; } = "member@example.test";
        public bool EmailVerified { get; set; } = true;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath;
            if (path == "/.well-known/openid-configuration")
                return Json(new
                {
                    issuer = Issuer,
                    authorization_endpoint = Issuer + "/authorize",
                    token_endpoint = Issuer + "/token",
                    jwks_uri = Issuer + "/jwks"
                });
            if (path == "/jwks")
            {
                var parameters = rsa.ExportParameters(false);
                return Json(new
                {
                    keys = new[]
                    {
                        new
                        {
                            kty = "RSA",
                            use = "sig",
                            kid = "test-key",
                            alg = "RS256",
                            n = Base64Url(parameters.Modulus!),
                            e = Base64Url(parameters.Exponent!)
                        }
                    }
                });
            }
            if (path == "/token")
                return Json(new { id_token = IdToken() });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private string IdToken()
        {
            var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
            var now = DateTime.UtcNow;
            return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
                issuer: Issuer,
                audience: ClientId,
                claims:
                [
                    new Claim(JwtRegisteredClaimNames.Sub, "oidc-subject-42"),
                    new Claim(JwtRegisteredClaimNames.Email, Email),
                    new Claim("email_verified", EmailVerified ? "true" : "false", ClaimValueTypes.Boolean),
                    new Claim(JwtRegisteredClaimNames.GivenName, "Ada"),
                    new Claim(JwtRegisteredClaimNames.FamilyName, "Lovelace"),
                    new Claim("nonce", Nonce)
                ],
                notBefore: now.AddSeconds(-5),
                expires: now.AddMinutes(5),
                signingCredentials: new SigningCredentials(key, SecurityAlgorithms.RsaSha256)));
        }

        private static Task<HttpResponseMessage> Json(object body) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        });
    }
}
