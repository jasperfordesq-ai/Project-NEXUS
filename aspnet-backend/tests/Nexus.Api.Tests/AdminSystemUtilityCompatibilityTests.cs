// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AdminSystemUtilityCompatibilityTests : IntegrationTestBase
{
    public AdminSystemUtilityCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task RegistrationBreaker_ReturnsLaravelReactEnvelopeAndCanResume()
    {
        await AuthenticateAsAdminAsync();

        var status = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/registration/breaker"));
        status.GetProperty("tripped").GetBoolean().Should().BeFalse();
        status.GetProperty("count_in_current_hour").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        status.GetProperty("threshold").GetInt32().Should().BeGreaterThan(0);
        status.GetProperty("auto_resume_in_seconds").ValueKind.Should().Be(JsonValueKind.Null);

        var resumed = await ReadDataAsync(await Client.PostAsJsonAsync("/api/v2/admin/registration/resume-signups", new { }));
        resumed.GetProperty("resumed").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task RetentionPolicies_ReadUpdateAndListRunsWithLaravelReactShape()
    {
        await AuthenticateAsAdminAsync();

        var policies = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/retention/policies"));
        policies.GetProperty("limits").GetProperty("min_days").GetInt32().Should().Be(30);
        policies.GetProperty("limits").GetProperty("max_days").GetInt32().Should().Be(3650);
        policies.GetProperty("limits").GetProperty("actions").EnumerateArray().Select(x => x.GetString()).Should().Contain("delete");
        policies.GetProperty("policies").EnumerateArray().Should().Contain(x => x.GetProperty("data_type").GetString() == "activity_log");

        var update = await ReadDataAsync(await Client.PutAsJsonAsync("/api/v2/admin/retention/policies/activity_log", new
        {
            retention_days = 120,
            is_enabled = true,
            action = "delete"
        }));
        var policy = update.GetProperty("policy");
        policy.GetProperty("data_type").GetString().Should().Be("activity_log");
        policy.GetProperty("retention_days").GetInt32().Should().Be(120);
        policy.GetProperty("is_enabled").GetBoolean().Should().BeTrue();
        policy.GetProperty("action").GetString().Should().Be("delete");

        var runs = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/retention/runs?limit=25"));
        runs.GetProperty("runs").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task BrandingUploadsHeaderColorsAndVerificationEmail_MatchLaravelReactShape()
    {
        await AuthenticateAsGodAsync();

        var colors = await ReadDataAsync(await Client.PutAsJsonAsync("/api/v2/admin/settings/header-colors", new
        {
            bg_color = "123",
            accent_color = "#445566"
        }));
        colors.GetProperty("header_bg_color").GetString().Should().Be("#112233");
        colors.GetProperty("header_accent_color").GetString().Should().Be("#445566");

        var light = await ReadDataAsync(await Client.PostAsync("/api/v2/admin/settings/powered-by-image-light", LogoForm("light.svg")));
        light.GetProperty("url").GetString().Should().NotBeNullOrWhiteSpace();

        var dark = await ReadDataAsync(await Client.PostAsync("/api/v2/admin/settings/powered-by-image-dark", LogoForm("dark.svg")));
        dark.GetProperty("url").GetString().Should().NotBeNullOrWhiteSpace();

        var verification = await ReadDataAsync(await Client.PostAsJsonAsync($"/api/v2/admin/users/{TestData.MemberUser.Id}/send-verification-email", new { }));
        verification.GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        verification.GetProperty("already_verified").GetBoolean().Should().BeFalse();
        verification.GetProperty("sent").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task SuperTenantPurgePreviewAndPurgeExposeSafeCompatibilityContract()
    {
        await AuthenticateAsGodAsync();

        var preview = await ReadDataAsync(await Client.GetAsync($"/api/v2/admin/super/tenants/{TestData.Tenant2.Id}/purge-preview"));
        preview.GetProperty("success").GetBoolean().Should().BeTrue();
        preview.GetProperty("dry_run").GetBoolean().Should().BeTrue();
        preview.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant2.Id);
        preview.GetProperty("resources").ValueKind.Should().Be(JsonValueKind.Array);

        var purgeResponse = await Client.PostAsJsonAsync($"/api/v2/admin/super/tenants/{TestData.Tenant2.Id}/purge", new { confirm = false });
        purgeResponse.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var purgeJson = await purgeResponse.Content.ReadFromJsonAsync<JsonElement>();
        purgeJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var purge = purgeJson.GetProperty("data");
        purge.GetProperty("purge_started").GetBoolean().Should().BeTrue();
        purge.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant2.Id);
        purge.GetProperty("queued").GetBoolean().Should().BeTrue();
    }

    private static MultipartFormDataContent LogoForm(string fileName)
    {
        var content = new ByteArrayContent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg>"u8.ToArray());
        content.Headers.ContentType = new MediaTypeHeaderValue("image/svg+xml");

        var form = new MultipartFormDataContent();
        form.Add(content, "logo", fileName);
        return form;
    }

    private static async Task<JsonElement> ReadDataAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        return json.GetProperty("data");
    }
}
