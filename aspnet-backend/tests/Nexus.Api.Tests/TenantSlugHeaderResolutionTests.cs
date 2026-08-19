// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Regression tests for X-Tenant-Slug resolution on UNAUTHENTICATED requests.
 *
 * 🔴 What this fixes. The accessible frontend (web-uk) identifies a community by SLUG,
 * not id, whenever there is no bearer token — `web-uk/src/lib/api.js:124-136` attaches
 * `X-Tenant-Slug` to every signed-out request. Until 2026-08-19 TenantResolutionMiddleware
 * understood only the integer `X-Tenant-ID`, so it answered 400 "Tenant context required"
 * to all of them. Observed as `/blog` and `/help` returning 400 while the SAME pages
 * returned 200 against Laravel; the fault was general to the entire signed-out surface,
 * and those two pages were simply the ones probed. Laravel resolves the same header
 * (app/Core/TenantContext.php), so a frontend that works there was unusable here for a
 * reason unrelated to the endpoint being called.
 *
 * 🔴 The security property that must not regress. Slug resolution is a FALLBACK for
 * unauthenticated requests only. Once a caller is signed in, the JWT `tenant_id` claim is
 * the sole tenant source — otherwise a header could override a signed-in user's own
 * tenant, which is a cross-tenant escalation. `SignedIn_SlugHeaderCannotOverrideJwtTenant`
 * pins that; do not relax it.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class TenantSlugHeaderResolutionTests : IntegrationTestBase
{
    public TenantSlugHeaderResolutionTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<HttpResponseMessage> GetWithHeaderAsync(string path, string? name, string? value)
    {
        ClearAuthToken();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (name is not null && value is not null)
        {
            request.Headers.Add(name, value);
        }
        return await Client.SendAsync(request);
    }

    [Fact]
    public async Task SignedOut_SlugHeaderResolvesTheTenant()
    {
        // The exact shape of a web-uk signed-out page render.
        var response = await GetWithHeaderAsync("/api/v2/blog", "X-Tenant-Slug", "test-tenant");

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "web-uk sends X-Tenant-Slug on every signed-out request; refusing it made the "
            + "whole accessible frontend unusable against this backend");
    }

    [Fact]
    public async Task SignedOut_IdHeaderStillResolvesTheTenant()
    {
        // The slug support is ADDITIVE — the integer header must keep working.
        var response = await GetWithHeaderAsync("/api/v2/blog", "X-Tenant-ID", "1");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SignedOut_UnknownSlugIsStillRefused()
    {
        var response = await GetWithHeaderAsync("/api/v2/blog", "X-Tenant-Slug", "no-such-community");

        // 🔴 The point of the middleware is that a request without a resolvable tenant is
        // BLOCKED — EF's global query filters go permissive without one. An unknown slug
        // must fail exactly as an unknown id does, or this fix would have opened a hole.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("message").GetString().Should().Contain("X-Tenant-Slug",
            "the error should name both accepted headers now that both are accepted");
    }

    [Fact]
    public async Task SignedOut_NoTenantHeaderAtAllIsStillRefused()
    {
        var response = await GetWithHeaderAsync("/api/v2/blog", null, null);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task SignedIn_SlugHeaderCannotOverrideJwtTenant()
    {
        // 🔴 The security guard. A signed-in caller's tenant comes from the JWT claim and
        // nothing else. If this ever starts passing a different tenant's data back, slug
        // resolution has been wired into the authenticated path and must be reverted.
        await AuthenticateAsMemberAsync();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v2/users/me");
        request.Headers.Add("X-Tenant-Slug", "no-such-community");

        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "an unresolvable slug on an authenticated request must be ignored, not fatal — "
            + "the JWT claim already carries the tenant");
    }
}
