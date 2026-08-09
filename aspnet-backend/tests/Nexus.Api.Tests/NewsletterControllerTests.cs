// Copyright © 2024–2026 Jasper Ford
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
/// Integration tests for the NewsletterController.
/// Tests public subscribe/unsubscribe and admin newsletter management.
/// </summary>
[Collection("Integration")]
public class NewsletterControllerTests : IntegrationTestBase
{
    public NewsletterControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Public Subscribe/Unsubscribe

    [Fact]
    public async Task Subscribe_ValidEmail_ReturnsOk()
    {
        // Arrange - authenticate to provide tenant context (required by middleware)
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/newsletter/subscribe", new
        {
            email = "subscriber@example.com",
            source = "website"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("message").GetString().Should().Contain("Successfully subscribed");
        content.GetProperty("email").GetString().Should().Be("subscriber@example.com");
    }

    [Fact]
    public async Task Subscribe_EmptyEmail_ReturnsBadRequest()
    {
        // Arrange - authenticate to provide tenant context
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/newsletter/subscribe", new
        {
            email = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Email is required");
    }

    [Fact]
    public async Task Unsubscribe_NotSubscribed_ReturnsNotFound()
    {
        // Arrange - authenticate to provide tenant context
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/newsletter/unsubscribe", new
        {
            email = "nonexistent@example.com"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Subscription not found");
    }

    [Fact]
    public async Task SubscribeThenUnsubscribe_ReturnsOk()
    {
        // Arrange - authenticate to provide tenant context
        await AuthenticateAsMemberAsync();
        var email = "roundtrip@example.com";

        await Client.PostAsJsonAsync("/api/newsletter/subscribe", new { email });

        // Act
        var response = await Client.PostAsJsonAsync("/api/newsletter/unsubscribe", new { email });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("message").GetString().Should().Contain("unsubscribed");
    }

    [Fact]
    public async Task Unsubscribe_EmptyEmail_ReturnsBadRequest()
    {
        // Arrange - authenticate to provide tenant context
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/newsletter/unsubscribe", new
        {
            email = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Email is required");
    }

    #endregion

    #region Admin - Auth Checks

    [Fact]
    public async Task ListNewsletters_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/admin/newsletter");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListNewsletters_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/newsletter");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region Admin - Newsletter CRUD

    [Fact]
    public async Task CreateNewsletter_AsAdmin_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/newsletter", new
        {
            subject = "Weekly Community Update",
            content_html = "<h1>Weekly Update</h1><p>Here is what happened this week.</p>",
            content_text = "Weekly Update: Here is what happened this week."
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("subject").GetString().Should().Be("Weekly Community Update");
        content.GetProperty("status").GetString().Should().Be("draft");
    }

    [Fact]
    public async Task CreateNewsletter_MissingSubject_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/newsletter", new
        {
            subject = "",
            content_html = "<p>Content without subject</p>"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Subject is required");
    }

    [Fact]
    public async Task CreateNewsletter_MissingContentHtml_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/newsletter", new
        {
            subject = "Newsletter without content",
            content_html = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Content HTML is required");
    }

    [Fact]
    public async Task ListNewsletters_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a newsletter first
        await Client.PostAsJsonAsync("/api/admin/newsletter", new
        {
            subject = "Newsletter for listing",
            content_html = "<p>Content</p>"
        });

        // Act
        var response = await Client.GetAsync("/api/admin/newsletter");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("newsletters").ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetNewsletter_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/newsletter/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Admin - Subscribers & Stats

    [Fact]
    public async Task ListSubscribers_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/newsletter/subscribers");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("subscribers").ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetStats_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/newsletter/stats");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("total", out _).Should().BeTrue();
        content.TryGetProperty("active", out _).Should().BeTrue();
        content.TryGetProperty("unsubscribed", out _).Should().BeTrue();
    }

    #endregion
}
