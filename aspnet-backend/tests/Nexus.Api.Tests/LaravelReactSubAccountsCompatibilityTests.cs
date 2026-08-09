// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactSubAccountsCompatibilityTests : IntegrationTestBase
{
    public LaravelReactSubAccountsCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SubAccountsV2Aliases_FollowLaravelReactLinkedAccountsFlow()
    {
        var childEmail = $"linked-child-{Guid.NewGuid():N}@test.com";
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Users.Add(new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = childEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Linked",
                LastName = "Child",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/users/me/sub-accounts", new
        {
            email = childEmail,
            relationship_type = "guardian",
            permissions = new
            {
                can_view_activity = true,
                can_manage_listings = false,
                can_transact = false,
                can_view_messages = false
            }
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createData = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var pendingChild = createData.EnumerateArray().Single();
        var relationshipId = pendingChild.GetProperty("relationship_id").GetInt32();
        pendingChild.GetProperty("relationship_type").GetString().Should().Be("guardian");
        pendingChild.GetProperty("status").GetString().Should().Be("pending");
        pendingChild.GetProperty("user_id").GetInt32().Should().BeGreaterThan(0);
        pendingChild.GetProperty("first_name").GetString().Should().Be("Linked");
        pendingChild.GetProperty("last_name").ValueKind.Should().BeOneOf(JsonValueKind.String, JsonValueKind.Null);
        pendingChild.GetProperty("email").GetString().Should().Be(childEmail);
        pendingChild.GetProperty("permissions").GetProperty("can_view_activity").GetBoolean().Should().BeTrue();
        pendingChild.GetProperty("permissions").GetProperty("can_transact").GetBoolean().Should().BeFalse();

        var parentList = await Client.GetAsync("/api/v2/users/me/sub-accounts");
        parentList.StatusCode.Should().Be(HttpStatusCode.OK);
        (await parentList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single()
            .GetProperty("relationship_id")
            .GetInt32()
            .Should()
            .Be(relationshipId);

        ClearAuthToken();
        SetAuthToken(await GetAccessTokenAsync(childEmail, "test-tenant"));

        var managerList = await Client.GetAsync("/api/v2/users/me/parent-accounts");
        managerList.StatusCode.Should().Be(HttpStatusCode.OK);
        var pendingParent = (await managerList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single();
        pendingParent.GetProperty("relationship_id").GetInt32().Should().Be(relationshipId);
        pendingParent.GetProperty("status").GetString().Should().Be("pending");
        pendingParent.GetProperty("email").GetString().Should().Be("member@test.com");

        var approve = await Client.PutAsync($"/api/v2/users/me/sub-accounts/{relationshipId}/approve", null);
        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        var approvedParent = (await approve.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single();
        approvedParent.GetProperty("status").GetString().Should().Be("active");

        ClearAuthToken();
        await AuthenticateAsMemberAsync();

        var updatePermissions = await Client.PutAsJsonAsync($"/api/v2/users/me/sub-accounts/{relationshipId}/permissions", new
        {
            permissions = new
            {
                can_transact = true,
                can_view_messages = true
            }
        });

        updatePermissions.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await updatePermissions.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single();
        var permissions = updated.GetProperty("permissions");
        permissions.GetProperty("can_transact").GetBoolean().Should().BeTrue();
        permissions.GetProperty("can_view_messages").GetBoolean().Should().BeTrue();

        var remove = await Client.DeleteAsync($"/api/v2/users/me/sub-accounts/{relationshipId}");

        remove.StatusCode.Should().Be(HttpStatusCode.OK);
        var removeData = (await remove.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        removeData.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var afterRemove = await Client.GetAsync("/api/v2/users/me/sub-accounts");
        afterRemove.StatusCode.Should().Be(HttpStatusCode.OK);
        (await afterRemove.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Should()
            .BeEmpty();
    }
}
