// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.Json;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Volunteer expense claims.
///
/// 🔴 Both endpoints were stubs sitting on top of a real store: the list
/// returned an empty array, so a volunteer could never see their own claims,
/// and the detail endpoint echoed back ANY id with a fabricated "pending"
/// status — which also confirmed that other people's claims existed. The same
/// pattern as the membership-dues stub.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerExpenseVisibilityTests : IntegrationTestBase
{
    public VolunteerExpenseVisibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedExpenseAsync(int userId, decimal amount = 12.50m)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var expense = new VolunteerExpense
        {
            TenantId = TestData.Tenant1.Id,
            UserId = userId,
            Amount = amount,
            Currency = "EUR",
            Category = "travel",
            Description = "Bus fare to the community garden",
            Status = VolunteerExpenseStatus.Submitted,
            CreatedAt = DateTime.UtcNow,
        };
        db.VolunteerExpenses.Add(expense);
        await db.SaveChangesAsync();
        return expense.Id;
    }

    [Fact]
    public async Task AVolunteerSeesTheirOwnClaims()
    {
        var expenseId = await SeedExpenseAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/volunteering/expenses");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt32()).ToList();

        ids.Should().Contain(expenseId,
            "the stub returned an empty array, so a volunteer's own claims were invisible");
    }

    [Fact]
    public async Task ClaimDetailReturnsTheRealRecord()
    {
        var expenseId = await SeedExpenseAsync(TestData.MemberUser.Id, 33.75m);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync($"/api/v2/volunteering/expenses/{expenseId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("amount").GetDecimal().Should().Be(33.75m,
            "the stub invented a status and no amount at all");
        data.GetProperty("status").GetString().Should().Be("submitted");
    }

    [Fact]
    public async Task AnotherVolunteersClaim_IsNotReadable()
    {
        var otherExpenseId = await SeedExpenseAsync(TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync($"/api/v2/volunteering/expenses/{otherExpenseId}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the stub echoed back any id, confirming other people's claims existed");
    }

    [Fact]
    public async Task AnUnknownClaimId_IsNotFound()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/volunteering/expenses/99999999");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
