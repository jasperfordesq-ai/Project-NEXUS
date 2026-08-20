// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for the cookie-consent contract.
///
/// 🔴 WHY THIS EXISTS. TWO controllers owned POST /api/cookie-consent, so EVERY consent
/// save from the browser threw AmbiguousMatchException — a 500 whose error response
/// carries no CORS headers, which every browser reported as "blocked by CORS policy".
/// The smoke logged it as a CORS miss on every run; the real fault was routing. The
/// first test here is the one that matters: the POST must not 500, ever — an
/// AmbiguousMatchException would fail it before any shape assertion runs.
///
/// The shapes are Laravel's, captured live: POST accepts the React client's exact
/// payload {functional, analytics, marketing} (the old reader looked for a
/// "preferences" key the client never sends, so every consent stored functional=false
/// regardless of the member's choice) and returns data.{id, consent:{essential,
/// functional, analytics, marketing, created_at}}; GET returns the caller's newest row
/// snake_case, or data:null; both carry meta.base_url — this route is NOT under /api/v2
/// so the envelope filter deliberately leaves it alone and the actions emit meta
/// themselves.
/// </summary>
[Collection("Integration")]
public sealed class CookieConsentContractTests : IntegrationTestBase
{
    public CookieConsentContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Posting_consent_succeeds_with_laravels_shape_and_never_500s()
    {
        await AuthenticateAsMemberAsync();

        using var response = await Client.PostAsJsonAsync("/api/cookie-consent", new
        {
            functional = true,
            analytics = true,
            marketing = false,
            source = "web",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "a 500 here is the AmbiguousMatchException regression — two owners on one route");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().BeGreaterThan(0);

        var consent = data.GetProperty("consent");
        consent.GetProperty("essential").GetBoolean().Should().BeTrue();
        consent.GetProperty("functional").GetBoolean().Should().BeTrue(
            "the client's key is `functional` — the old `preferences` reader silently stored false");
        consent.GetProperty("analytics").GetBoolean().Should().BeTrue();
        consent.GetProperty("marketing").GetBoolean().Should().BeFalse();
        consent.GetProperty("created_at").GetString().Should().NotBeNullOrEmpty();

        document.RootElement.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrEmpty("Laravel's respondWithData seeds base_url on every surface");
    }

    [Fact]
    public async Task Getting_consent_returns_the_callers_newest_row_snake_case()
    {
        await AuthenticateAsMemberAsync();

        using var post = await Client.PostAsJsonAsync("/api/cookie-consent", new
        {
            functional = false,
            analytics = true,
            marketing = false,
        });
        post.StatusCode.Should().Be(HttpStatusCode.OK);

        using var response = await Client.GetAsync("/api/cookie-consent");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var data = document.RootElement.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Object, "this member just consented");

        // The exact snake_case keys — the old GET serialized the raw EF entity camelCase,
        // so a Laravel-shaped reader found none of these.
        var keys = data.EnumerateObject().Select(p => p.Name).ToList();
        keys.Should().Contain(new[]
        {
            "id", "session_id", "user_id", "tenant_id",
            "essential", "analytics", "marketing", "functional",
            "created_at", "updated_at",
        });
        data.GetProperty("analytics").GetBoolean().Should().BeTrue();
        data.GetProperty("functional").GetBoolean().Should().BeFalse(
            "the newest row wins — this member's latest save had functional=false");
        keys.Should().NotContain("necessaryCookies", "raw EF property names must never serialize");
    }

    [Fact]
    public async Task An_anonymous_visitor_with_no_record_gets_data_null_not_an_error()
    {
        using var response = await Client.GetAsync("/api/cookie-consent?session_id=never-seen");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        document.RootElement.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Null);
        document.RootElement.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrEmpty();
    }
}
