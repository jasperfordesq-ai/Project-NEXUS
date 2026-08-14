// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the Laravel legal-acceptance enforcement contract
/// (EnsureLegalAcceptance, shipped 2026-08-11): a member with a pending
/// enforceable legal document is refused the gated write actions with 403 and
/// errors[0].code == "LEGAL_ACCEPTANCE_REQUIRED", never 401; report mode never
/// blocks but stamps X-Legal-Acceptance-Pending; the default AND any invalid
/// mode are both enforcing; admins pass; accept-all genuinely records and
/// unblocks; and the status endpoint publishes the flags the React
/// useLegalGate hook and mobile depend on.
/// </summary>
[Collection("Integration")]
public class LegalAcceptanceGateTests : IntegrationTestBase
{
    private const string GatedRoute = "/api/v2/comments";
    private const string LegalCode = "LEGAL_ACCEPTANCE_REQUIRED";

    public LegalAcceptanceGateTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedEnforceableDocumentAsync(int? tenantId = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var document = new LegalDocument
        {
            TenantId = tenantId ?? TestData.Tenant1.Id,
            Title = "Community Terms",
            Slug = "terms",
            Content = "The standard terms.",
            Version = "1.0",
            IsActive = true,
            RequiresAcceptance = true,
            CreatedAt = DateTime.UtcNow
        };
        db.LegalDocuments.Add(document);
        await db.SaveChangesAsync();
        return document.Id;
    }

    private async Task AcceptAsync(int documentId, int userId, int tenantId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.LegalDocumentAcceptances.Add(new LegalDocumentAcceptance
        {
            TenantId = tenantId,
            UserId = userId,
            LegalDocumentId = documentId,
            AcceptedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private HttpClient CreateClientWithMode(string mode, string token)
    {
        var factory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Legal:EnforcementMode"] = mode
                }));
            builder.ConfigureServices(services =>
            {
                foreach (var hostedService in services
                             .Where(descriptor => descriptor.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService)
                                 && descriptor.ImplementationType?.Assembly == typeof(Program).Assembly)
                             .ToList())
                {
                    services.Remove(hostedService);
                }
            });
        });
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(body);
    }

    [Fact]
    public async Task PendingDocument_BlocksGatedWriteWithMachineCodeAnd403()
    {
        await SeedEnforceableDocumentAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(GatedRoute, new { });

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "the gate must answer 403, never 401");
        var json = await ReadJsonAsync(response);
        json.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(LegalCode);
        json.GetProperty("success").GetBoolean().Should().BeFalse();
        response.Headers.TryGetValues("API-Version", out var versions).Should().BeTrue();
        versions!.Should().Contain("2.0");
    }

    [Fact]
    public async Task AcceptedMember_IsNotBlocked()
    {
        var documentId = await SeedEnforceableDocumentAsync();
        await AcceptAsync(documentId, TestData.MemberUser.Id, TestData.Tenant1.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(GatedRoute, new { });

        if (response.StatusCode == HttpStatusCode.Forbidden)
        {
            var json = await ReadJsonAsync(response);
            json.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().NotBe(LegalCode, "an accepted member must pass the legal gate");
        }
    }

    [Fact]
    public async Task Admin_BypassesTheGate()
    {
        await SeedEnforceableDocumentAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(GatedRoute, new { });

        if (response.StatusCode == HttpStatusCode.Forbidden)
        {
            var json = await ReadJsonAsync(response);
            json.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().NotBe(LegalCode, "admins are exempt from the legal gate");
        }
    }

    [Fact]
    public async Task OtherTenantsDocument_DoesNotBlockThisTenant()
    {
        await SeedEnforceableDocumentAsync(TestData.Tenant2.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(GatedRoute, new { });

        if (response.StatusCode == HttpStatusCode.Forbidden)
        {
            var json = await ReadJsonAsync(response);
            json.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().NotBe(LegalCode, "legal documents are strictly per-tenant");
        }
    }

    [Fact]
    public async Task OffMode_NeverBlocks()
    {
        await SeedEnforceableDocumentAsync();
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var client = CreateClientWithMode("off", token);

        var response = await client.PostAsJsonAsync(GatedRoute, new { });

        if (response.StatusCode == HttpStatusCode.Forbidden)
        {
            var json = await ReadJsonAsync(response);
            json.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().NotBe(LegalCode, "mode off disables enforcement entirely");
        }
    }

    [Fact]
    public async Task InvalidMode_FallsBackToEnforcingWrite()
    {
        await SeedEnforceableDocumentAsync();
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var client = CreateClientWithMode("wrtie", token);

        var response = await client.PostAsJsonAsync(GatedRoute, new { });

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "an unrecognised mode must fall back to write, never to off");
        var json = await ReadJsonAsync(response);
        json.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(LegalCode);
    }

    [Fact]
    public async Task ReportMode_PassesThroughAndStampsThePendingHeader()
    {
        await SeedEnforceableDocumentAsync();
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var client = CreateClientWithMode("report", token);

        var response = await client.PostAsJsonAsync(GatedRoute, new { });

        if (response.StatusCode == HttpStatusCode.Forbidden)
        {
            var json = await ReadJsonAsync(response);
            json.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().NotBe(LegalCode, "report mode never blocks");
        }
        response.Headers.TryGetValues("X-Legal-Acceptance-Pending", out var pending)
            .Should().BeTrue("report mode stamps the pending header for observability");
        pending!.Should().Contain("1");
    }

    [Fact]
    public async Task ReportMode_NoHeaderWhenNothingIsPending()
    {
        var documentId = await SeedEnforceableDocumentAsync();
        await AcceptAsync(documentId, TestData.MemberUser.Id, TestData.Tenant1.Id);
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var client = CreateClientWithMode("report", token);

        var response = await client.PostAsJsonAsync(GatedRoute, new { });

        response.Headers.TryGetValues("X-Legal-Acceptance-Pending", out _)
            .Should().BeFalse("the header appears only when the member is actually pending");
    }

    [Fact]
    public async Task ShellRoutes_AreNeverGated()
    {
        await SeedEnforceableDocumentAsync();
        await AuthenticateAsMemberAsync();

        foreach (var route in new[]
                 {
                     "/api/v2/users/me",
                     "/api/v2/legal/acceptance/status"
                 })
        {
            var response = await Client.GetAsync(route);
            response.StatusCode.Should().Be(
                HttpStatusCode.OK,
                $"a blocked member must still be able to load {route} to see and clear the gate");
        }
    }

    [Fact]
    public async Task AcceptAll_RecordsAcceptancesAndUnblocksImmediately()
    {
        var documentId = await SeedEnforceableDocumentAsync();
        await AuthenticateAsMemberAsync();

        var blocked = await Client.PostAsJsonAsync(GatedRoute, new { });
        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var accept = await Client.PostAsJsonAsync("/api/v2/legal/acceptance/accept-all", new { });
        accept.StatusCode.Should().Be(HttpStatusCode.OK);
        var acceptJson = await ReadJsonAsync(accept);
        acceptJson.GetProperty("data").GetProperty("accepted").GetArrayLength()
            .Should().BeGreaterThan(0, "accept-all must report what it accepted");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var recorded = await db.LegalDocumentAcceptances
                .IgnoreQueryFilters()
                .AnyAsync(a => a.UserId == TestData.MemberUser.Id
                    && a.LegalDocumentId == documentId);
            recorded.Should().BeTrue(
                "accept-all must genuinely persist the acceptance, not fake success");
        }

        var retry = await Client.PostAsJsonAsync(GatedRoute, new { });
        if (retry.StatusCode == HttpStatusCode.Forbidden)
        {
            var json = await ReadJsonAsync(retry);
            json.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().NotBe(LegalCode, "accepting must unblock the very next request");
        }
    }

    [Fact]
    public async Task AcceptAll_WithNothingPending_ReportsNoDocuments()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/legal/acceptance/accept-all", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await ReadJsonAsync(response);
        json.GetProperty("data").GetProperty("accepted").GetArrayLength().Should().Be(0);
        json.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("No documents require acceptance");
    }

    [Fact]
    public async Task StatusEndpoint_PublishesTheFlagsTheReactGateReads()
    {
        await SeedEnforceableDocumentAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/legal/acceptance/status");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("has_pending").GetBoolean().Should().BeTrue();
        data.GetProperty("enforcement_blocking").GetBoolean().Should().BeTrue(
            "the shipped default mode is write, which blocks");
        data.GetProperty("blocking_pending").GetBoolean().Should().BeTrue();
        var document = data.GetProperty("documents")[0];
        document.GetProperty("document_id").GetInt32().Should().BeGreaterThan(0);
        document.GetProperty("document_type").GetString().Should().Be("terms");
        document.GetProperty("title").GetString().Should().Be("Community Terms");
        document.GetProperty("acceptance_status").GetString().Should().Be("not_accepted");
    }

    [Fact]
    public async Task StatusEndpoint_ReportMode_StandsDownEnforcementBlocking()
    {
        await SeedEnforceableDocumentAsync();
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var client = CreateClientWithMode("report", token);

        var response = await client.GetAsync("/api/v2/legal/acceptance/status");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("has_pending").GetBoolean().Should().BeTrue();
        data.GetProperty("enforcement_blocking").GetBoolean().Should().BeFalse(
            "report mode surfaces pending documents without blocking");
    }

    [Fact]
    public async Task StatusEndpoint_AcceptedMember_ReportsCurrent()
    {
        var documentId = await SeedEnforceableDocumentAsync();
        await AcceptAsync(documentId, TestData.MemberUser.Id, TestData.Tenant1.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/legal/acceptance/status");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("has_pending").GetBoolean().Should().BeFalse();
        data.GetProperty("blocking_pending").GetBoolean().Should().BeFalse();
        data.GetProperty("documents")[0].GetProperty("acceptance_status").GetString()
            .Should().Be("current");
    }
}
