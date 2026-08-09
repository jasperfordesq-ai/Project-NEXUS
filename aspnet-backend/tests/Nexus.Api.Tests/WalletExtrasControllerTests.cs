// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class WalletExtrasControllerTests : IntegrationTestBase
{
    public WalletExtrasControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GrantStartingBalance_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.PostAsJsonAsync("/api/wallet/grant-starting-balance", new
        {
            user_id = TestData.MemberUser.Id,
            amount = 10
        });
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GrantStartingBalance_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/wallet/grant-starting-balance", new
        {
            user_id = TestData.MemberUser.Id,
            amount = 10
        });
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CheckStartingBalance_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync($"/api/wallet/check-starting-balance/{TestData.MemberUser.Id}");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GrantStartingBalance_AsAdminCreatesOneSystemCredit()
    {
        await AuthenticateAsAdminAsync();

        var first = await Client.PostAsJsonAsync("/api/wallet/grant-starting-balance", new
        {
            user_id = TestData.MemberUser.Id,
            amount = 4m
        });
        var retry = await Client.PostAsJsonAsync("/api/wallet/grant-starting-balance", new
        {
            user_id = TestData.MemberUser.Id,
            amount = 4m
        });

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        retry.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rows = await db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.ReceiverId == TestData.MemberUser.Id
                && row.TransactionType == "starting_balance")
            .ToListAsync();

        rows.Should().ContainSingle();
        rows[0].SenderId.Should().BeNull();
        rows[0].Amount.Should().Be(4m);
        rows[0].Description.Should().Be("Starting balance credit");
        rows[0].Status.Should().Be(TransactionStatus.Completed);
    }
}
