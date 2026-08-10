// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminPrerenderCompatibilityTests : IntegrationTestBase
{
    public AdminPrerenderCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var admin = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Email == "admin@test.com");
        admin.IsSuperAdmin = true;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task ReadEndpoints_ReturnLaravelReactPrerenderShapes()
    {
        await AuthenticateAsAdminAsync();

        var summary = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/summary"));
        summary.GetProperty("cache_readable").GetBoolean().Should().BeTrue();
        summary.GetProperty("expected_routes").EnumerateArray().Should().NotBeEmpty();
        summary.GetProperty("realtime_channel").GetString().Should().Be("private-admin-prerender");
        summary.GetProperty("realtime_event").GetString().Should().Be("job.updated");

        var inventory = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/inventory?tenant=test-tenant"));
        inventory.GetProperty("cache_path").GetString().Should().NotBeNullOrWhiteSpace();
        inventory.GetProperty("items").ValueKind.Should().Be(JsonValueKind.Array);

        var coverage = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/coverage"));
        coverage.GetProperty("expected_routes").EnumerateArray().Should().NotBeEmpty();
        var coverageRow = coverage.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("slug").GetString() == "test-tenant");
        coverageRow.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);

        var health = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/health"));
        health.GetProperty("status").GetString().Should().Be("green");
        health.GetProperty("checks").EnumerateArray().Should().NotBeEmpty();

        var realtime = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/realtime-channel"));
        realtime.GetProperty("channel").GetString().Should().Be("private-admin-prerender");
        realtime.GetProperty("event").GetString().Should().Be("job.updated");
    }

    [Fact]
    public async Task JobLifecycle_MatchesLaravelReactAdminContract()
    {
        await AuthenticateAsAdminAsync();

        var enqueue = await Client.PostAsJsonAsync("/api/v2/admin/prerender/jobs", new
        {
            tenant_slug = "test-tenant",
            routes = "/about,/jobs",
            dry_run = true,
            force = true,
            priority = 9
        });
        var enqueueData = await ReadDataAsync(enqueue);
        var jobId = enqueueData.GetProperty("job_id").GetInt32();
        enqueueData.GetProperty("job").GetProperty("tenant_slug").GetString().Should().Be("test-tenant");
        enqueueData.GetProperty("job").GetProperty("priority").GetInt32().Should().Be(9);

        var list = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/jobs?status=queued&limit=10"));
        list.GetProperty("items").EnumerateArray().Should().Contain(item => item.GetProperty("id").GetInt32() == jobId);

        var show = await ReadDataAsync(await Client.GetAsync($"/api/v2/admin/prerender/jobs/{jobId}"));
        show.GetProperty("status").GetString().Should().Be("queued");

        var cancel = await ReadDataAsync(await Client.PostAsJsonAsync($"/api/v2/admin/prerender/jobs/{jobId}/cancel", new { }));
        cancel.GetProperty("cancelled").GetBoolean().Should().BeTrue();
        cancel.GetProperty("id").GetInt32().Should().Be(jobId);

        var retry = await ReadDataAsync(await Client.PostAsJsonAsync($"/api/v2/admin/prerender/jobs/{jobId}/retry", new { }));
        retry.GetProperty("retried_from_job_id").GetInt32().Should().Be(jobId);
        retry.GetProperty("job").GetProperty("status").GetString().Should().Be("queued");
    }

    [Fact]
    public async Task OperationsAndExports_ReturnLaravelReactShapes()
    {
        await AuthenticateAsAdminAsync();

        var purge = await ReadDataAsync(await Client.PostAsJsonAsync("/api/v2/admin/prerender/purge", new
        {
            pattern = "/about",
            tenant_slug = "test-tenant",
            dry_run = true,
            recache = false
        }));
        purge.GetProperty("pattern").GetString().Should().Be("/about");
        purge.GetProperty("dry_run").GetBoolean().Should().BeTrue();

        var cacheRoot = Path.Combine(Path.GetTempPath(), "nexus-prerender-integration-cache");
        var bundle = Path.Combine(cacheRoot, "test-tenant.localhost", "about");
        Directory.CreateDirectory(bundle);
        await File.WriteAllTextAsync(Path.Combine(bundle, "index.html"), "<h1>stale</h1>");

        var invalidate = await ReadDataAsync(await Client.PostAsJsonAsync("/api/v2/admin/prerender/invalidate", new
        {
            tenant_id = TestData.Tenant1.Id,
            routes = new[] { "/about" },
            recache = true
        }));
        invalidate.GetProperty("invalidated").GetInt32().Should().Be(1);
        invalidate.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        Directory.Exists(bundle).Should().BeFalse();

        var autoRecache = await ReadDataAsync(await Client.PostAsJsonAsync("/api/v2/admin/prerender/auto-recache", new { apply = false }));
        autoRecache.GetProperty("applied").GetBoolean().Should().BeFalse();
        autoRecache.GetProperty("exit_code").GetInt32().Should().Be(0);

        var detectDrift = await ReadDataAsync(await Client.PostAsJsonAsync("/api/v2/admin/prerender/detect-drift", new { apply = false }));
        detectDrift.GetProperty("applied").GetBoolean().Should().BeFalse();

        var unexpected = await ReadDataAsync(await Client.PostAsJsonAsync("/api/v2/admin/prerender/purge-unexpected", new { apply = false }));
        unexpected.GetProperty("dry_run").GetBoolean().Should().BeTrue();

        var ttl = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/ttl-inspector?route=%2Fabout"));
        ttl.GetProperty("route").GetString().Should().Be("/about");
        ttl.GetProperty("ttl_seconds").GetInt32().Should().BeGreaterThan(0);

        var sitemap = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/sitemap-explorer?tenant=test-tenant"));
        sitemap.GetProperty("tenant_slug").GetString().Should().Be("test-tenant");
        sitemap.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);

        var metrics = await Client.GetAsync("/api/v2/admin/prerender/metrics");
        metrics.StatusCode.Should().Be(HttpStatusCode.OK);
        (await metrics.Content.ReadAsStringAsync()).Should().Contain("nexus_prerender_health_status");

        var csv = await Client.GetAsync("/api/v2/admin/prerender/export/jobs.csv");
        csv.StatusCode.Should().Be(HttpStatusCode.OK);
        (await csv.Content.ReadAsStringAsync()).Should().StartWith("id,status,priority");
    }

    [Fact]
    public async Task ExternalInvalidate_AcceptsBearerAndOneTimeHmac_ButRejectsReplay()
    {
        ClearAuthToken();
        const string token = "nexus-prerender-test-webhook-token";
        var bearer = new HttpRequestMessage(HttpMethod.Post, "/api/v2/prerender/invalidate")
        {
            Content = JsonContent.Create(new { tenant_id = TestData.Tenant1.Id, routes = new[] { "/about/", "/about" }, recache = false })
        };
        bearer.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var bearerData = await ReadDataAsync(await Client.SendAsync(bearer));
        bearerData.GetProperty("routes").EnumerateArray().Select(row => row.GetString()).Should().Equal("/about");
        bearerData.GetProperty("job_id").ValueKind.Should().Be(JsonValueKind.Null);

        var raw = JsonSerializer.Serialize(new { tenant_id = TestData.Tenant1.Id, routes = new[] { "/jobs" }, recache = true });
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var signature = Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(token),
            Encoding.UTF8.GetBytes($"{timestamp}.{raw}"))).ToLowerInvariant();

        HttpRequestMessage SignedRequest()
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/v2/prerender/invalidate")
            {
                Content = new StringContent(raw, Encoding.UTF8, "application/json")
            };
            request.Headers.Add("X-Nexus-Timestamp", timestamp);
            request.Headers.Add("X-Nexus-Signature", signature);
            return request;
        }

        using var first = SignedRequest();
        var firstResponse = await Client.SendAsync(first);
        firstResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstData = await ReadDataAsync(firstResponse);
        firstData.GetProperty("job_id").GetInt32().Should().BeGreaterThan(0);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.TenantConfigs.IgnoreQueryFilters().CountAsync(row =>
                row.TenantId == TestData.Tenant1.Id &&
                row.Key.StartsWith("admin_prerender.webhook_nonce."))).Should().Be(1);
        }

        using var replay = SignedRequest();
        var replayResponse = await Client.SendAsync(replay);
        replayResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var replayJson = await replayResponse.Content.ReadFromJsonAsync<JsonElement>();
        replayJson.GetProperty("code").GetString().Should().Be("UNAUTHENTICATED");
    }

    [Fact]
    public async Task ResetAll_RequiresConfirmation_ThenFencesJobsAndReturnsAcceptedPlan()
    {
        await AuthenticateAsAdminAsync();

        await Client.PostAsJsonAsync("/api/v2/admin/prerender/jobs", new
        {
            tenant_slug = "test-tenant",
            routes = "/about",
            dry_run = false,
            force = false,
            priority = 5
        });

        var invalid = await Client.PostAsJsonAsync("/api/v2/admin/prerender/reset-all", new { confirmation = "reset" });
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var reset = await Client.PostAsJsonAsync("/api/v2/admin/prerender/reset-all", new { confirmation = "RESET ALL SNAPSHOTS" });
        reset.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var json = await reset.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("cancelled_jobs").GetInt32().Should().Be(1);
        data.GetProperty("tenant_count").GetInt32().Should().Be(2);
        data.GetProperty("planned_routes").GetInt32().Should().Be(10);

        var jobs = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/jobs?limit=20"));
        jobs.GetProperty("items").EnumerateArray().Should().Contain(row =>
            row.GetProperty("id").GetInt32() == data.GetProperty("job_id").GetInt32() &&
            row.GetProperty("status").GetString() == "queued" &&
            row.GetProperty("force").GetBoolean());

        var audit = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/prerender/audit?action=reset_all"));
        audit.GetProperty("items").EnumerateArray().Should().ContainSingle(row => row.GetProperty("outcome").GetString() == "ok");
    }

    [Fact]
    public async Task ControlPlane_RejectsTenantAdminAndUnsignedExternalCaller()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var admin = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Email == "admin@test.com");
            admin.IsSuperAdmin = false;
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/v2/admin/prerender/summary")).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        ClearAuthToken();
        var unsigned = await Client.PostAsJsonAsync("/api/v2/prerender/invalidate", new
        {
            tenant_id = TestData.Tenant1.Id,
            routes = new[] { "/about" }
        });
        unsigned.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var json = await unsigned.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("code").GetString().Should().Be("UNAUTHENTICATED");
    }

    [Fact]
    public async Task InvalidRequests_ReturnLaravelErrorEnvelope()
    {
        await AuthenticateAsAdminAsync();

        var missingInspect = await Client.GetAsync("/api/v2/admin/prerender/inspect");
        missingInspect.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var missingInspectJson = await missingInspect.Content.ReadFromJsonAsync<JsonElement>();
        missingInspectJson.GetProperty("success").GetBoolean().Should().BeFalse();
        missingInspectJson.GetProperty("code").GetString().Should().Be("VALIDATION_REQUIRED_FIELD");

        var invalidPurge = await Client.PostAsJsonAsync("/api/v2/admin/prerender/purge", new { pattern = "bad" });
        invalidPurge.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var invalidPurgeJson = await invalidPurge.Content.ReadFromJsonAsync<JsonElement>();
        invalidPurgeJson.GetProperty("code").GetString().Should().Be("VALIDATION_INVALID");

        var missingJob = await Client.GetAsync("/api/v2/admin/prerender/jobs/99999");
        missingJob.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var missingJobJson = await missingJob.Content.ReadFromJsonAsync<JsonElement>();
        missingJobJson.GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    private static async Task<JsonElement> ReadDataAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        return json.GetProperty("data");
    }
}
