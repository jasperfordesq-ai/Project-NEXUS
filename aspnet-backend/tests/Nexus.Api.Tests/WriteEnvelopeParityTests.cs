// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Regression tests for the WRITE envelope, measured 2026-08-19.
 *
 * 🔴 Why these exist now and not earlier. Until this week nothing in the repo had
 * ever compared a write response between the two backends, so the shared envelope
 * filter was deliberately restricted to GET/HEAD. `scripts/compare-live-writes.mjs`
 * now measures them. Signed in against the disposable Laravel:
 *
 *     2xx Laravel writes carrying a `data` key    : 11
 *     ...of those, also carrying meta.base_url    : 11
 *     ...of those, carrying a top-level `success` :  0
 *     counter-examples in either direction        :  0
 *
 * Eight are member-facing, three are admin (registration resume-signups, a
 * retention-policy update, a header-colours update), measured signed in as the
 * disposable Laravel's own admin account.
 *
 * 🔴 That count justified ONE HALF of the change, and the other half was reverted.
 * Read this before extending anything here:
 *
 *   * ADDING meta.base_url to writes shipped. It is additive — a wrong guess leaves
 *     an unused extra key, it cannot take away something a caller depends on.
 *   * REMOVING a top-level `success` from writes did NOT ship. Applied as a blanket
 *     rule it turned 82 tests red in a single run, and checking the score showed it
 *     bought nothing: writes moved 6 -> 10 of 18 on the meta addition and the
 *     per-endpoint fixes alone. Eleven samples establish that those eleven Laravel
 *     writes omit `success`; they do not license stripping it from every write in
 *     this backend. The read-side strip keeps its own 41-to-0 count across 170 GETs.
 *
 * So Laravel omitting `success` on those three admin writes is a REAL, still-open
 * divergence — recorded in docs/CURRENT_ASPNET_CONTRACT_STATUS.md, to be closed per
 * endpoint against a live read, not by widening a filter.
 *
 * 🔴 Every expectation below was read from the RUNNING Laravel, never inferred
 * from this backend's behaviour. That distinction is not pedantry here: eight
 * assertions in this suite were previously found pinning ASP.NET's own shape
 * under a Laravel-parity name.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class WriteEnvelopeParityTests : IntegrationTestBase
{
    public WriteEnvelopeParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task V2Write_CarriesMetaBaseUrl_AndThisEndpointSendsNoTopLevelSuccess()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsync("/api/v2/notifications/read-all", null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrEmpty();
        // 🔴 Absent because THIS HANDLER stopped sending it, not because the filter
        // strips it from writes — it does not, deliberately. Do not generalise this
        // assertion to other write endpoints without measuring them.
        body.TryGetProperty("success", out _).Should()
            .BeFalse("mark-all-read was reshaped to Laravel's data + meta envelope");
    }

    [Fact]
    public async Task MarkAllRead_UsesLaravelFieldNames_InsideData()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsync("/api/v2/notifications/read-all", null);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        // Live Laravel: {"data":{"marked_all_read":true,"marked_read":0},"meta":{…}}
        data.GetProperty("marked_all_read").GetBoolean().Should().BeTrue();
        data.GetProperty("marked_read").ValueKind.Should().Be(JsonValueKind.Number);
        data.TryGetProperty("marked_count", out _).Should()
            .BeFalse("marked_count was this backend's own name for it, not Laravel's");
    }

    [Fact]
    public async Task NonV2MarkAllRead_IsLeftAlone()
    {
        await AuthenticateAsMemberAsync();

        // 🔴 A DIFFERENT handler (NotificationsController) on a path Laravel serves
        // through its non-v2 helpers, which emit a different envelope. This test
        // exists to stop the v2 fix being propagated onto it by resemblance.
        var response = await Client.PutAsync("/api/notifications/read-all", null);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        body.TryGetProperty("marked_count", out _).Should().BeTrue();
    }

    [Fact]
    public async Task LegalShortRoutes_EmitTheirOwnMeta_BecauseTheFilterIsV2Only()
    {
        await AuthenticateAsMemberAsync();

        // Live Laravel: both carry {"meta":{"base_url":"http://127.0.0.1"}} despite
        // being non-v2 paths, so the filter cannot supply it and the controller must.
        var status = await Client.GetAsync("/api/legal/status");
        (await status.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrEmpty();

        var acceptAll = await Client.PostAsync("/api/legal/accept-all", null);
        (await acceptAll.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrEmpty();
    }
}
