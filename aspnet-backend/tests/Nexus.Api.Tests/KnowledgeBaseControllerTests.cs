// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class KnowledgeBaseControllerTests : IntegrationTestBase
{
    public KnowledgeBaseControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListArticles_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/knowledge/articles");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CreateArticle_AsAdmin_ReturnsCreated()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/knowledge/articles", new
        {
            title = "Getting Started Guide",
            slug = "getting-started-" + Guid.NewGuid().ToString("N")[..8],
            content = "# Welcome\n\nThis is the getting started guide.",
            category = "Getting Started",
            is_published = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task CreateArticle_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/knowledge/articles", new
        {
            title = "Unauthorized",
            slug = "unauthorized",
            content = "Not allowed"
        });

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetArticleBySlug_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/knowledge/articles/nonexistent-slug-xyz");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
