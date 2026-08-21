// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Honest-501 tests for the two GDPR endpoints in MiscParityController.
 *
 * These endpoints used to fake success while doing no work at all:
 * POST /api/gdpr/delete-account answered 200 {queued:true} without queuing
 * anything (a member's erasure request was silently discarded), and
 * POST /api/gdpr/request answered 200 {status:"pending"} without writing a
 * row. That is a statutory exposure. Until the real implementation lands
 * (docs/JOURNEY_CERTIFICATION_LEDGER.md, Tier 5 staff journeys), both must
 * return an honest 501 — these tests pin that, and pin that they can never
 * regress to a fake 200.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class MiscParityGdprStubTests : IntegrationTestBase
{
    public MiscParityGdprStubTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GdprDeleteAccount_Authenticated_Returns501NotFake200()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/gdpr/delete-account", new { });

        response.StatusCode.Should().Be(
            HttpStatusCode.NotImplemented,
            "a fake 200 here silently discards a member's statutory erasure request");
        response.StatusCode.Should().NotBe(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeFalse();
        content.GetProperty("code").GetString().Should().Be("GDPR_NOT_IMPLEMENTED");
        content.GetProperty("error").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("operation").GetString().Should().Be("account-erasure");
    }

    [Fact]
    public async Task GdprRequest_Authenticated_Returns501NotFake200()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/gdpr/request", new { type = "export" });

        response.StatusCode.Should().Be(
            HttpStatusCode.NotImplemented,
            "a fake 200 {status:pending} here invents a subject-access request that exists nowhere");
        response.StatusCode.Should().NotBe(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeFalse();
        content.GetProperty("code").GetString().Should().Be("GDPR_NOT_IMPLEMENTED");
        content.GetProperty("error").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("operation").GetString().Should().Be("data-request");
    }

    [Fact]
    public async Task GdprDeleteAccount_Unauthenticated_ReturnsUnauthorized()
    {
        ClearAuthToken();

        var response = await Client.PostAsJsonAsync("/api/gdpr/delete-account", new { });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GdprRequest_Unauthenticated_ReturnsUnauthorized()
    {
        ClearAuthToken();

        var response = await Client.PostAsJsonAsync("/api/gdpr/request", new { type = "export" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
