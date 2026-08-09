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
/// Integration tests for the EventsController.
/// Tests event CRUD operations, RSVPs, and tenant isolation.
/// </summary>
[Collection("Integration")]
public class EventsControllerTests : IntegrationTestBase
{
    public EventsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Create Event

    [Fact]
    public async Task CreateEvent_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var startsAt = DateTime.UtcNow.AddDays(7);
        var endsAt = startsAt.AddHours(2);

        // Act
        var response = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Community Meetup",
            description = "A test community event",
            location = "Community Center",
            starts_at = startsAt,
            ends_at = endsAt,
            max_attendees = 50
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var evt = content.GetProperty("event");
        evt.GetProperty("title").GetString().Should().Be("Community Meetup");
        evt.GetProperty("location").GetString().Should().Be("Community Center");
        evt.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task CreateEvent_MissingTitle_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/events", new
        {
            description = "An event without a title",
            starts_at = DateTime.UtcNow.AddDays(1)
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateEvent_Unauthenticated_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Unauthorized Event"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Get Events

    [Fact]
    public async Task GetEvents_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create an event first
        await Client.PostAsJsonAsync("/api/events", new
        {
            title = "List Test Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });

        // Act
        var response = await Client.GetAsync("/api/events");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray().Should().NotBeEmpty();
    }

    [Fact]
    public async Task GetMyEvents_ReturnsOnlyRsvpdEvents()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create an event and RSVP
        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "My RSVP Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // RSVP to the event
        await Client.PostAsJsonAsync($"/api/events/{eventId}/rsvp", new { status = "going" });

        // Act
        var response = await Client.GetAsync("/api/events/my");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var events = content.GetProperty("data").EnumerateArray().ToList();
        events.Should().Contain(e => e.GetProperty("title").GetString() == "My RSVP Event");
    }

    #endregion

    #region Event Details

    [Fact]
    public async Task GetEvent_ExistingEvent_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Detail Test Event",
            description = "Testing event details",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Act
        var response = await Client.GetAsync($"/api/events/{eventId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("event").GetProperty("title").GetString().Should().Be("Detail Test Event");
    }

    [Fact]
    public async Task GetEvent_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/events/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Update Event

    [Fact]
    public async Task UpdateEvent_AsCreator_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Update Test Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/events/{eventId}", new
        {
            title = "Updated Event Title",
            description = "Updated description"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("event").GetProperty("title").GetString().Should().Be("Updated Event Title");
    }

    [Fact]
    public async Task UpdateEvent_NotCreator_ReturnsForbidden()
    {
        // Arrange - Create event as admin
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Admin's Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Switch to member user
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/events/{eventId}", new
        {
            title = "Hijacked Title"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region RSVP

    [Fact]
    public async Task RsvpToEvent_ValidRequest_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "RSVP Test Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Switch to member
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/events/{eventId}/rsvp", new
        {
            status = "going"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task RemoveRsvp_ExistingRsvp_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Remove RSVP Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // RSVP first
        await Client.PostAsJsonAsync($"/api/events/{eventId}/rsvp", new { status = "going" });

        // Act
        var response = await Client.DeleteAsync($"/api/events/{eventId}/rsvp");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetEventRsvps_ReturnsAttendees()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "RSVP List Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // RSVP
        await Client.PostAsJsonAsync($"/api/events/{eventId}/rsvp", new { status = "going" });

        // Act
        var response = await Client.GetAsync($"/api/events/{eventId}/rsvps");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray().Should().NotBeEmpty();
    }

    #endregion

    #region Cancel Event

    [Fact]
    public async Task CancelEvent_AsCreator_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Cancel Test Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsync($"/api/events/{eventId}/cancel", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    #endregion

    #region Tenant Isolation

    [Fact]
    public async Task GetEvent_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange - Create event in test-tenant
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Tenant Isolated Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Switch to other-tenant user
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.GetAsync($"/api/events/{eventId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RsvpToEvent_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange - Create event in test-tenant
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Cross-Tenant RSVP Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Switch to other-tenant user
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/events/{eventId}/rsvp", new { status = "going" });

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    #endregion

    #region Input Validation

    [Fact]
    public async Task CreateEvent_WithInvalidImageUrl_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Test Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2),
            image_url = "not-a-valid-url"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateEvent_WithValidImageUrl_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Event With Image",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2),
            image_url = "https://example.com/event-banner.png"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var evt = content.GetProperty("event");
        evt.GetProperty("imageUrl").GetString().Should().Be("https://example.com/event-banner.png");
    }

    [Fact]
    public async Task UpdateEvent_WithInvalidImageUrl_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/events", new
        {
            title = "Update Test Event",
            starts_at = DateTime.UtcNow.AddDays(1),
            ends_at = DateTime.UtcNow.AddDays(1).AddHours(2)
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = createContent.GetProperty("event").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/events/{eventId}", new
        {
            image_url = "invalid-url"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion
}
