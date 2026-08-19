// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Regression tests for four of the nine genuine route gaps, closed 2026-08-19:
 *
 *     GET  /api/legal/status
 *     POST /api/legal/accept
 *     POST /api/legal/accept-all
 *     POST /api/csp-report
 *
 * 🔴 Why these four first. A browser session hits the legal-acceptance gate before
 * it can do anything else, and posts CSP violation reports unprompted. Until
 * 2026-08-19 this backend answered 404 for the status route, 405 for both legal
 * POSTs and 404 for csp-report — so the first React-against-ASP.NET run would have
 * stalled at the gate with no way to accept, while every CSP report was discarded.
 *
 * Every expectation here was read from the RUNNING disposable Laravel, not from this
 * backend's behaviour. 🔴 That distinction matters: eight assertions in this suite
 * have already been found pinning ASP.NET's own shape under a Laravel-parity name.
 *
 * 🔴 NON-v2 paths only. Laravel registers just the bare forms
 * (routes/api.php:4013-4015) and answers 404/405 on the v2 spellings, so testing
 * a v2 path here would pin a route Laravel does not have.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class LegalShortRoutesAndCspReportTests : IntegrationTestBase
{
    public LegalShortRoutesAndCspReportTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ── GET /api/legal/status ────────────────────────────────────────────────

    [Fact]
    public async Task LegalStatus_UsesLaravelShape_WithSuccessInsideData()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/legal/status");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = body.GetProperty("data");

        // 🔴 Laravel puts `success` INSIDE data on this route — verified live:
        // {"data":{"success":true,"documents":[],"has_pending":false},"meta":{...}}.
        // LaravelDataEnvelopeFilter strips a TOP-LEVEL success, so this one survives,
        // which is exactly right.
        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("documents").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("has_pending").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
        body.TryGetProperty("success", out _).Should().BeFalse("a top-level success is not Laravel's here");
    }

    [Fact]
    public async Task LegalStatus_RejectsAnonymousCallers()
    {
        ClearAuthToken();
        var response = await Client.GetAsync("/api/legal/status");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── POST /api/legal/accept ───────────────────────────────────────────────

    [Fact]
    public async Task LegalAccept_WithoutIds_ReturnsLaravelValidationEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/legal/accept", new { });

        // Verified live: 400 with {"errors":[{"code":"VALIDATION_ERROR",
        // "message":"Missing document_id or version_id"}]} and NO `data`.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var first = body.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        first.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        body.TryGetProperty("data", out _).Should().BeFalse();
    }

    [Fact]
    public async Task LegalAccept_WithUnknownVersion_Returns404NotFound()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(
            "/api/legal/accept",
            new { document_id = 987654, version_id = 987654 });

        // 🔴 Laravel resolves the VERSION first and 404s when it cannot, BEFORE it
        // looks at whether the version is current. The order of the ladder is part of
        // the contract, not an implementation detail.
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("errors").EnumerateArray().Should()
            .ContainSingle().Subject.GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task LegalAccept_RejectsAnonymousCallers()
    {
        ClearAuthToken();
        var response = await Client.PostAsJsonAsync("/api/legal/accept", new { document_id = 1, version_id = 1 });
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── POST /api/legal/accept-all ───────────────────────────────────────────

    [Fact]
    public async Task LegalAcceptAll_ReturnsLaravelMessageAndClearsPending()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsync("/api/legal/accept-all", null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // Verified live: {"data":{"message":"All legal documents accepted"},"meta":{...}}
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("All legal documents accepted");

        // Accepting everything must actually clear the pending flag — the point of the
        // endpoint. This is what a member does to get past the acceptance gate, and a
        // hardcoded success here is what left them locked out before.
        var after = await Client.GetAsync("/api/legal/status");
        var status = await after.Content.ReadFromJsonAsync<JsonElement>();
        status.GetProperty("data").GetProperty("has_pending").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task LegalAcceptAll_IsIdempotent()
    {
        await AuthenticateAsMemberAsync();

        (await Client.PostAsync("/api/legal/accept-all", null)).StatusCode.Should().Be(HttpStatusCode.OK);
        // A second call must not duplicate acceptance rows or error.
        (await Client.PostAsync("/api/legal/accept-all", null)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ── POST /api/csp-report ─────────────────────────────────────────────────

    private HttpContent CspBody(string json) =>
        new StringContent(json, Encoding.UTF8, "application/json");

    [Fact]
    public async Task CspReport_AcceptsTheLegacyWrapper_Anonymously_With204()
    {
        ClearAuthToken();

        var response = await Client.PostAsync("/api/csp-report", CspBody(
            """{"csp-report":{"document-uri":"https://app.example/page?token=secret","violated-directive":"script-src"}}"""));

        // 🔴 Anonymous by necessity: the browser posts this with no credentials.
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task CspReport_AcceptsTheReportingApiWrapperAndArrayForm()
    {
        ClearAuthToken();

        var wrapped = await Client.PostAsync("/api/csp-report", CspBody(
            """{"body":{"documentURL":"https://app.example/x","effectiveDirective":"img-src"}}"""));
        wrapped.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Browsers differ; some post a list of reports.
        var asList = await Client.PostAsync("/api/csp-report", CspBody(
            """[{"body":{"documentURL":"https://app.example/y","effectiveDirective":"img-src"}}]"""));
        asList.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task CspReport_TreatsAnUnparseableBodyAsNoContent_NotAnError()
    {
        ClearAuthToken();

        var response = await Client.PostAsync("/api/csp-report", CspBody("this is not json"));

        // 🔴 Laravel answers 204 rather than 4xx. A browser cannot act on an error
        // here, and failing loudly would turn a diagnostics channel into an alert
        // source.
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task CspReport_RefusesAnOversizedReport()
    {
        ClearAuthToken();

        // Laravel's cap is 32 KB.
        var padding = new string('x', 33 * 1024);
        var response = await Client.PostAsync("/api/csp-report", CspBody(
            $"{{\"csp-report\":{{\"document-uri\":\"https://app.example/{padding}\"}}}}"));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
    }
}
