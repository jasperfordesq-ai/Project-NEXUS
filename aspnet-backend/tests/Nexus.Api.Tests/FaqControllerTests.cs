// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class FaqControllerTests : IntegrationTestBase
{
    public FaqControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetFaqs_Anonymous_ReturnsOkOrBadRequest()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/faqs");
        // TenantResolutionMiddleware returns 400 for anonymous requests without tenant context
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetFaq_NonExistent_ReturnsNotFoundOrBadRequest()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/faqs/99999");
        // TenantResolutionMiddleware returns 400 for anonymous requests without tenant context
        r.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetFaqCategories_Anonymous_ReturnsOkOrBadRequest()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/faqs/categories");
        // TenantResolutionMiddleware returns 400 for anonymous requests without tenant context
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateFaq_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/faqs", new
        {
            question = "Test Question?",
            answer = "Test Answer",
            category = "general"
        });
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CreateFaq_AsAdmin_ReturnsOkOrCreated()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/faqs", new
        {
            question = "Test FAQ Question?",
            answer = "Test FAQ Answer",
            category = "general"
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task DeleteFaq_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/faqs/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
