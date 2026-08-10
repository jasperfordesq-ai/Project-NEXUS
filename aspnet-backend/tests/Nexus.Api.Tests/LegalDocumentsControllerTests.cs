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
public class LegalDocumentsControllerTests : IntegrationTestBase
{
    public LegalDocumentsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListDocuments_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/legal/documents");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CreateDocument_AsAdmin_ReturnsCreated()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/legal/documents", new
        {
            title = "Terms of Service",
            slug = "tos-" + Guid.NewGuid().ToString("N")[..8],
            content = "These are the terms of service.",
            version = "1.0",
            is_active = true,
            requires_acceptance = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task GetDocumentBySlug_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/legal/documents/nonexistent-slug-xyz");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateDocument_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/legal/documents", new
        {
            title = "Unauthorized",
            slug = "unauth",
            content = "Not allowed",
            version = "1.0"
        });
        response.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
    }
}
