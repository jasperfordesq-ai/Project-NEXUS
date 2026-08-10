// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class AdminSsoProvidersControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelAdminSsoProviderRoutes()
    {
        typeof(AdminSsoProvidersController).GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/sso/providers");

        typeof(AdminSsoProvidersController).GetMethod(nameof(AdminSsoProvidersController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()
            ?.Template.Should().BeNull();
        typeof(AdminSsoProvidersController).GetMethod(nameof(AdminSsoProvidersController.Upsert))
            ?.GetCustomAttribute<HttpPutAttribute>()
            ?.Template.Should().Be("{providerKey}");
        typeof(AdminSsoProvidersController).GetMethod(nameof(AdminSsoProvidersController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()
            ?.Template.Should().Be("{providerKey}");
        typeof(AdminSsoProvidersController).GetMethod(nameof(AdminSsoProvidersController.Test))
            ?.GetCustomAttribute<HttpPostAttribute>()
            ?.Template.Should().Be("{providerKey}/test");
    }

    [Fact]
    public async Task Index_ReturnsCurrentTenantProvidersWithPresetsAndNoSecret()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        db.TenantSsoProviders.AddRange(
            new TenantSsoProvider
            {
                TenantId = 42,
                ProviderKey = "entra",
                DisplayName = "Entra ID",
                Preset = "entra",
                IssuerUrl = "https://login.example.test",
                ClientId = "client-42",
                ClientSecretEncrypted = "protected-secret",
                Scopes = "openid profile email",
                AllowedEmailDomains = """["example.test"]""",
                AutoProvision = true,
                IsEnabled = true,
                UpdatedAt = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)
            },
            new TenantSsoProvider
            {
                TenantId = 7,
                ProviderKey = "entra",
                DisplayName = "Other Entra",
                Preset = "entra",
                IssuerUrl = "https://other.example.test",
                ClientId = "client-7",
                Scopes = "openid",
                IsEnabled = true
            });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("presets").EnumerateArray().Select(p => p.GetString())
            .Should().Equal("generic", "entra", "hivebrite");
        var providers = data.GetProperty("providers").EnumerateArray().ToArray();
        providers.Should().HaveCount(1);
        providers[0].GetProperty("provider_key").GetString().Should().Be("entra");
        providers[0].GetProperty("has_client_secret").GetBoolean().Should().BeTrue();
        providers[0].TryGetProperty("client_secret", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Upsert_StoresTenantScopedProviderAndMasksSecret()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Upsert("Entra", new SsoProviderUpsertRequest
        {
            DisplayName = "Entra ID",
            Preset = "entra",
            IssuerUrl = "https://login.example.test/",
            ClientId = "client-id",
            ClientSecret = "very-secret",
            Scopes = "openid profile email",
            AllowedEmailDomains = ["Example.Test", "@members.example.test"],
            AutoProvision = true,
            IsEnabled = true
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var provider = document.RootElement.GetProperty("data").GetProperty("provider");
        provider.GetProperty("provider_key").GetString().Should().Be("entra");
        provider.GetProperty("issuer_url").GetString().Should().Be("https://login.example.test");
        provider.GetProperty("has_client_secret").GetBoolean().Should().BeTrue();
        provider.TryGetProperty("client_secret", out _).Should().BeFalse();

        var stored = await db.TenantSsoProviders.IgnoreQueryFilters()
            .SingleAsync(p => p.TenantId == 42 && p.ProviderKey == "entra");
        stored.ClientSecretEncrypted.Should().NotBeNullOrWhiteSpace();
        stored.ClientSecretEncrypted.Should().NotBe("very-secret");
        stored.UpdatedBy.Should().Be(1001);
        stored.AllowedEmailDomains.Should().Be("""["example.test","members.example.test"]""");

        var audit = await db.AuditLogs.IgnoreQueryFilters()
            .SingleAsync(a => a.TenantId == 42 && a.Action == "sso_provider_updated");
        audit.Metadata.Should().Contain("\"provider_key\":\"entra\"");
        audit.Metadata.Should().NotContain("very-secret");
    }

    [Fact]
    public async Task Upsert_RejectsInvalidProviderInputWithLaravelError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant);

        var result = await controller.Upsert("bad key", new SsoProviderUpsertRequest
        {
            IssuerUrl = "http://internal.example.test",
            ClientId = "client-id"
        }, CancellationToken.None);

        var invalid = result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("field").GetString().Should().Be("provider");
    }

    [Fact]
    public async Task Destroy_RemovesOnlyCurrentTenantProvider()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        db.TenantSsoProviders.AddRange(
            Provider(42, "entra"),
            Provider(7, "entra"));
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Destroy("entra", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();

        (await db.TenantSsoProviders.IgnoreQueryFilters()
                .AnyAsync(p => p.TenantId == 42 && p.ProviderKey == "entra"))
            .Should().BeFalse();
        (await db.TenantSsoProviders.IgnoreQueryFilters()
                .AnyAsync(p => p.TenantId == 7 && p.ProviderKey == "entra"))
            .Should().BeTrue();
    }

    [Fact]
    public async Task Test_ReturnsOidcDiscoveryResultForStoredProvider()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        db.TenantSsoProviders.Add(Provider(42, "entra"));
        await db.SaveChangesAsync();

        var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""
                {
                  "issuer": "https://login.example.test",
                  "authorization_endpoint": "https://login.example.test/oauth2/v2.0/authorize",
                  "token_endpoint": "https://login.example.test/oauth2/v2.0/token",
                  "jwks_uri": "https://login.example.test/discovery/v2.0/keys"
                }
                """, Encoding.UTF8, "application/json")
        });
        var controller = CreateController(db, tenant, handler: handler);

        var result = await controller.Test("entra", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("ok").GetBoolean().Should().BeTrue();
        data.GetProperty("issuer").GetString().Should().Be("https://login.example.test");
        data.GetProperty("authorization_endpoint").GetString()
            .Should().Be("https://login.example.test/oauth2/v2.0/authorize");
        handler.LastRequest?.RequestUri?.ToString()
            .Should().Be("https://login.example.test/.well-known/openid-configuration");
    }

    private static TenantSsoProvider Provider(int tenantId, string key) => new()
    {
        TenantId = tenantId,
        ProviderKey = key,
        DisplayName = "Entra ID",
        Preset = "entra",
        IssuerUrl = "https://login.example.test",
        ClientId = "client-id",
        Scopes = "openid profile email",
        AutoProvision = true,
        IsEnabled = true
    };

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static AdminSsoProvidersController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId = 1000,
        StubHttpHandler? handler = null)
    {
        var service = new TenantSsoProviderService(
            db,
            tenant,
            new EphemeralDataProtectionProvider(),
            new StubHttpClientFactory(handler ?? new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))),
            NullLogger<TenantSsoProviderService>.Instance);

        return new AdminSsoProvidersController(
            service,
            tenant,
            NullLogger<AdminSsoProvidersController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim("tenant_id", tenant.GetTenantIdOrThrow().ToString()),
                        new Claim(ClaimTypes.Role, "admin")
                    ], "Test"))
                }
            }
        };
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;

        public StubHttpClientFactory(HttpMessageHandler handler) => _handler = handler;

        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private sealed class StubHttpHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

        public StubHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(_responder(request));
        }
    }
}
