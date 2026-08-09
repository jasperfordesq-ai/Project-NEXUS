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
public sealed class LaravelReactBlockedUsersCompatibilityTests : IntegrationTestBase
{
    public LaravelReactBlockedUsersCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task BlockedUsersV2Aliases_PersistAndReturnLaravelReactShape()
    {
        int targetUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var target = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"blocked-target-{Guid.NewGuid():N}@test.com",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Blocked",
                LastName = "Target",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(target);
            await db.SaveChangesAsync();
            targetUserId = target.Id;
        }

        await AuthenticateAsMemberAsync();

        var block = await Client.PostAsJsonAsync($"/api/v2/users/{targetUserId}/block", new
        {
            reason = "No longer a good match"
        });

        block.StatusCode.Should().Be(HttpStatusCode.OK);
        var blockJson = await block.Content.ReadFromJsonAsync<JsonElement>();
        var blockData = blockJson.GetProperty("data");
        blockData.GetProperty("success").GetBoolean().Should().BeTrue();
        blockData.GetProperty("blocked_user_id").GetInt32().Should().Be(targetUserId);

        var list = await Client.GetAsync("/api/v2/users/blocked");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var row = listJson.GetProperty("data").EnumerateArray().Single();
        row.GetProperty("block_id").GetInt32().Should().BeGreaterThan(0);
        row.GetProperty("user_id").GetInt32().Should().Be(targetUserId);
        var firstName = row.GetProperty("first_name").GetString();
        var lastName = row.GetProperty("last_name").GetString();
        firstName.Should().Be("Blocked");
        lastName.Should().NotBeNull();
        row.GetProperty("name").GetString().Should().Be($"{firstName} {lastName}".Trim());
        row.GetProperty("reason").GetString().Should().Be("No longer a good match");
        row.GetProperty("blocked_at").GetString().Should().NotBeNullOrWhiteSpace();

        var status = await Client.GetAsync($"/api/v2/users/{targetUserId}/block-status");

        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusData = (await status.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statusData.GetProperty("is_blocked").GetBoolean().Should().BeTrue();
        statusData.GetProperty("is_blocked_by").GetBoolean().Should().BeFalse();

        var unblock = await Client.DeleteAsync($"/api/v2/users/{targetUserId}/block");

        unblock.StatusCode.Should().Be(HttpStatusCode.OK);
        var unblockData = (await unblock.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        unblockData.GetProperty("success").GetBoolean().Should().BeTrue();
        unblockData.GetProperty("unblocked_user_id").GetInt32().Should().Be(targetUserId);

        var repeatedUnblock = await Client.DeleteAsync($"/api/v2/users/{targetUserId}/block");

        repeatedUnblock.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = (await repeatedUnblock.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors")
            .EnumerateArray()
            .Single();
        error.GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }
}
