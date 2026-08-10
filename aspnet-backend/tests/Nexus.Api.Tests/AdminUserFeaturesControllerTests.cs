// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for AdminUserFeaturesController.
/// Covers: sessions management, saved searches admin, sub-accounts admin.
/// </summary>
[Collection("Integration")]
public class AdminUserFeaturesControllerTests : IntegrationTestBase
{
    public AdminUserFeaturesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Authorization

    [Fact]
    public async Task SessionEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r1 = await Client.GetAsync("/api/admin/sessions");
        r1.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var r2 = await Client.DeleteAsync("/api/admin/sessions/1");
        r2.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var r3 = await Client.DeleteAsync("/api/admin/sessions/user/1");
        r3.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SessionEndpoints_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r1 = await Client.GetAsync("/api/admin/sessions");
        r1.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var r2 = await Client.DeleteAsync("/api/admin/sessions/1");
        r2.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task SavedSearchesAdminEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r1 = await Client.GetAsync("/api/admin/saved-searches");
        r1.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var r2 = await Client.DeleteAsync("/api/admin/saved-searches/1");
        r2.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SavedSearchesAdminEndpoints_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r1 = await Client.GetAsync("/api/admin/saved-searches");
        r1.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var r2 = await Client.DeleteAsync("/api/admin/saved-searches/1");
        r2.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task SubAccountsAdminEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r1 = await Client.GetAsync("/api/admin/sub-accounts");
        r1.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var r2 = await Client.PutAsync("/api/admin/sub-accounts/1/deactivate", null);
        r2.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var r3 = await Client.DeleteAsync("/api/admin/sub-accounts/1");
        r3.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SubAccountsAdminEndpoints_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r1 = await Client.GetAsync("/api/admin/sub-accounts");
        r1.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var r2 = await Client.PutAsync("/api/admin/sub-accounts/1/deactivate", null);
        r2.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var r3 = await Client.DeleteAsync("/api/admin/sub-accounts/1");
        r3.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region Sessions (Admin)

    [Fact]
    public async Task GetSessions_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/sessions?page=1&limit=20");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetSessions_AllSessions_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/sessions?active_only=false");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task TerminateSession_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync("/api/admin/sessions/999999");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task TerminateUserSessions_NonExistentUser_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync("/api/admin/sessions/user/999999");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Saved Searches (Admin)

    [Fact]
    public async Task GetSavedSearches_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/saved-searches?page=1&limit=20");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task DeleteSavedSearch_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync("/api/admin/saved-searches/999999");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Sub-Accounts (Admin)

    [Fact]
    public async Task GetSubAccounts_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/sub-accounts?page=1&limit=20");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task DeactivateSubAccount_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsync("/api/admin/sub-accounts/999999/deactivate", null);
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteSubAccount_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync("/api/admin/sub-accounts/999999");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion
}
