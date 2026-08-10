// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactSafeguardingCompatibilityTests : IntegrationTestBase
{
    public LaravelReactSafeguardingCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task MemberSafeguardingV2Aliases_ReturnPreferencesAndSoftRevokeByOptionId()
    {
        int optionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var option = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = "public-first-meeting",
                OptionType = "checkbox",
                Label = "First meeting in a public venue",
                Description = "Recommended for first-time exchanges.",
                SortOrder = 10,
                IsActive = true,
                TriggersJson = """
                {
                  "requires_broker_approval": true,
                  "restricts_messaging": true,
                  "restricts_matching": true,
                  "requires_vetted_interaction": true,
                  "vetting_type_required": "enhanced"
                }
                """,
                CreatedAt = DateTime.UtcNow.AddDays(-7)
            };
            db.SafeguardingOptions.Add(option);
            await db.SaveChangesAsync();
            optionId = option.Id;

            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO user_safeguarding_preferences
                    ("TenantId", "UserId", "OptionId", "SelectedValue", "ConsentGivenAt", "CreatedAt", "ReviewReminderSentAt")
                VALUES
                    ({TestData.Tenant1.Id}, {TestData.MemberUser.Id}, {optionId}, {"true"}, {DateTime.UtcNow.AddDays(-2)}, {DateTime.UtcNow.AddDays(-2)}, {DateTime.UtcNow.AddDays(-1)})
                """);
        }

        await AuthenticateAsMemberAsync();

        var list = await Client.GetAsync("/api/v2/safeguarding/my-preferences");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listData = (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        listData.GetProperty("count").GetInt32().Should().Be(1);
        var pref = listData.GetProperty("preferences").EnumerateArray().Single();
        pref.GetProperty("preference_id").GetInt32().Should().BeGreaterThan(0);
        pref.GetProperty("option_id").GetInt32().Should().Be(optionId);
        pref.GetProperty("option_key").GetString().Should().Be("public-first-meeting");
        pref.GetProperty("label").GetString().Should().Be("First meeting in a public venue");
        pref.GetProperty("description").GetString().Should().Be("Recommended for first-time exchanges.");
        pref.GetProperty("selected_value").GetString().Should().Be("true");
        pref.GetProperty("consent_given_at").GetString().Should().NotBeNullOrWhiteSpace();
        pref.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
        var activations = pref.GetProperty("activations");
        activations.GetProperty("requires_broker_approval").GetBoolean().Should().BeTrue();
        activations.GetProperty("restricts_messaging").GetBoolean().Should().BeTrue();
        activations.GetProperty("restricts_matching").GetBoolean().Should().BeTrue();
        activations.GetProperty("requires_vetted_interaction").GetBoolean().Should().BeTrue();
        activations.GetProperty("vetting_type_required").GetString().Should().Be("enhanced");

        var revoke = await Client.PostAsJsonAsync("/api/v2/safeguarding/revoke", new
        {
            option_id = optionId
        });

        revoke.StatusCode.Should().Be(HttpStatusCode.OK);
        var revokeData = (await revoke.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        revokeData.GetProperty("revoked").GetBoolean().Should().BeTrue();
        revokeData.GetProperty("option_id").GetInt32().Should().Be(optionId);

        var after = await Client.GetAsync("/api/v2/safeguarding/my-preferences");

        after.StatusCode.Should().Be(HttpStatusCode.OK);
        var afterData = (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        afterData.GetProperty("count").GetInt32().Should().Be(0);
        afterData.GetProperty("preferences").EnumerateArray().Should().BeEmpty();

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var revokedAt = await verifyDb.Database
            .SqlQueryRaw<DateTime?>("""
                SELECT "RevokedAt" AS "Value"
                FROM user_safeguarding_preferences
                WHERE "TenantId" = {0} AND "UserId" = {1} AND "OptionId" = {2}
                """, TestData.Tenant1.Id, TestData.MemberUser.Id, optionId)
            .SingleAsync();
        revokedAt.Should().NotBeNull();
    }
}
