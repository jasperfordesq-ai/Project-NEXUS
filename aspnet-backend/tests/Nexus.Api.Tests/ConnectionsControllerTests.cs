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
/// Integration tests for connections endpoints.
/// Tests connection requests, accepting, declining, listing, and removal.
/// </summary>
[Collection("Integration")]
public class ConnectionsControllerTests : IntegrationTestBase
{
    public ConnectionsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Send Connection Request Tests

    [Fact]
    public async Task SendConnectionRequest_ReturnsCreatedWithPendingConnection()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("message").GetString().Should().Contain("Connection request sent");
        content.GetProperty("connection").GetProperty("status").GetString().Should().Be("pending");
    }

    [Fact]
    public async Task SendConnectionRequest_ToSelf_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.MemberUser.Id
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("yourself");
    }

    [Fact]
    public async Task SendConnectionRequest_ToCrossTenantUser_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act - OtherTenantUser is in tenant2, current user is in tenant1
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.OtherTenantUser.Id
        });

        // Assert - Tenant isolation means user is not found
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("User not found");
    }

    [Fact]
    public async Task SendConnectionRequest_Duplicate_ReturnsBadRequest()
    {
        // Arrange - Send a request first
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Act - Send same request again
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("already pending");
    }

    [Fact]
    public async Task SendConnectionRequest_MutualRequest_AutoAccepts()
    {
        // Arrange - Admin sends request to Member
        await AuthenticateAsAdminAsync();
        await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.MemberUser.Id
        });

        // Act - Member sends request to Admin (mutual)
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Assert - Should auto-accept
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("message").GetString().Should().Contain("mutual");
        content.GetProperty("connection").GetProperty("status").GetString().Should().Be("accepted");
    }

    #endregion

    #region List Connections Tests

    [Fact]
    public async Task GetConnections_NoConnections_ReturnsEmptyList()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/connections?status=accepted");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("connections").GetArrayLength().Should().Be(0);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task GetConnections_AfterAccept_ReturnsAcceptedConnection()
    {
        // Arrange - Create and accept a connection
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Accept as admin (the addressee)
        await AuthenticateAsAdminAsync();
        await Client.PutAsJsonAsync($"/api/connections/{connectionId}/accept", new { });

        // Act - List accepted connections as member
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/connections?status=accepted");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("connections").GetArrayLength().Should().Be(1);

        var connection = content.GetProperty("connections")[0];
        connection.GetProperty("status").GetString().Should().Be("accepted");
    }

    #endregion

    #region Pending Requests Tests

    [Fact]
    public async Task GetPendingRequests_ReturnsPendingConnection()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Act - Admin checks pending requests (incoming)
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/connections/pending");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("incoming").GetArrayLength().Should().Be(1);

        var incoming = content.GetProperty("incoming")[0];
        incoming.GetProperty("from_user").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
    }

    [Fact]
    public async Task GetPendingRequests_ReturnsOutgoingRequests()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Act - Member checks pending requests (outgoing)
        var response = await Client.GetAsync("/api/connections/pending");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("outgoing").GetArrayLength().Should().Be(1);

        var outgoing = content.GetProperty("outgoing")[0];
        outgoing.GetProperty("to_user").GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);
    }

    #endregion

    #region Accept Connection Tests

    [Fact]
    public async Task AcceptConnection_AsAddressee_ReturnsOk()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Act - Admin (addressee) accepts
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/connections/{connectionId}/accept", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("message").GetString().Should().Contain("accepted");
        content.GetProperty("connection").GetProperty("status").GetString().Should().Be("accepted");
    }

    [Fact]
    public async Task AcceptConnection_AsRequester_ReturnsForbidden()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Act - Member (requester) tries to accept their own request
        var response = await Client.PutAsJsonAsync($"/api/connections/{connectionId}/accept", new { });

        // Assert - Only the addressee can accept
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("addressee");
    }

    [Fact]
    public async Task AcceptConnection_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/connections/99999/accept", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Decline Connection Tests

    [Fact]
    public async Task DeclineConnection_AsAddressee_ReturnsOk()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Act - Admin (addressee) declines
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/connections/{connectionId}/decline", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("message").GetString().Should().Contain("declined");
    }

    [Fact]
    public async Task DeclineConnection_AsRequester_ReturnsForbidden()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Act - Member (requester) tries to decline their own request
        var response = await Client.PutAsJsonAsync($"/api/connections/{connectionId}/decline", new { });

        // Assert - Only the addressee can decline
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("addressee");
    }

    #endregion

    #region Remove Connection Tests

    [Fact]
    public async Task RemoveConnection_AcceptedConnection_ReturnsOk()
    {
        // Arrange - Create and accept a connection
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Accept as admin
        await AuthenticateAsAdminAsync();
        await Client.PutAsJsonAsync($"/api/connections/{connectionId}/accept", new { });

        // Act - Member removes the accepted connection
        await AuthenticateAsMemberAsync();
        var response = await Client.DeleteAsync($"/api/connections/{connectionId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("message").GetString().Should().Contain("removed");
    }

    [Fact]
    public async Task RemoveConnection_PendingAsRequester_ReturnsOk()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Act - Member (requester) cancels the pending request
        var response = await Client.DeleteAsync($"/api/connections/{connectionId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task RemoveConnection_PendingAsAddressee_ReturnsBadRequest()
    {
        // Arrange - Member sends request to Admin
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Act - Admin (addressee) tries to remove/cancel the pending request
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync($"/api/connections/{connectionId}");

        // Assert - Addressee should use decline for pending requests
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("decline");
    }

    [Fact]
    public async Task RemoveConnection_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync("/api/connections/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Re-send After Decline Tests

    [Fact]
    public async Task SendConnectionRequest_AfterDecline_AllowsResend()
    {
        // Arrange - Send and decline a request
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var connectionId = createContent.GetProperty("connection").GetProperty("id").GetInt32();

        // Admin declines
        await AuthenticateAsAdminAsync();
        await Client.PutAsJsonAsync($"/api/connections/{connectionId}/decline", new { });

        // Act - Member re-sends request after decline
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            user_id = TestData.AdminUser.Id
        });

        // Assert - Should succeed (re-send allowed after decline)
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("connection").GetProperty("status").GetString().Should().Be("pending");
    }

    #endregion
}
