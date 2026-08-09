// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AtomicNotificationSettingsParityTests : IntegrationTestBase
{
    public AtomicNotificationSettingsParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Update_PersistsAllThreeDomainsAtomicallyAndReturnsCanonicalValues()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync("/api/v2/users/me/notification-settings", Payload(match: "weekly", digest: "weekly", federation: false));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("notifications").GetProperty("email_messages").GetBoolean().Should().BeTrue();
        data.GetProperty("notifications").GetProperty("federation_notifications_enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("match_preferences").GetProperty("notification_frequency").GetString().Should().Be("monthly");
        data.GetProperty("digest_frequency").GetString().Should().Be("monthly");

        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = await db.Users.IgnoreQueryFilters().SingleAsync(x => x.TenantId == TestData.Tenant1.Id && x.Id == TestData.MemberUser.Id);
        user.FederationNotificationsEnabled.Should().BeFalse();
        var bag = JsonNode.Parse(user.NotificationPreferences!)!.AsObject();
        bag["push_enabled"]!.GetValue<bool>().Should().BeTrue();
        bag["federation_notifications_enabled"]!.GetValue<bool>().Should().BeFalse();
        bag["match_notification_frequency"]!.GetValue<string>().Should().Be("monthly");
        var match = await db.MatchPreferences.IgnoreQueryFilters().SingleAsync(x => x.TenantId == TestData.Tenant1.Id && x.UserId == TestData.MemberUser.Id);
        match.NotificationFrequency.Should().Be("monthly"); match.NotifyHotMatches.Should().BeTrue(); match.NotifyMutualMatches.Should().BeFalse();
        (await db.TenantConfigs.IgnoreQueryFilters().SingleAsync(x => x.TenantId == TestData.Tenant1.Id && x.Key == $"notification_settings.{TestData.MemberUser.Id}.global.0")).Value.Should().Be("monthly");
        (await db.MatchPreferences.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant2.Id)).Should().Be(0);
    }

    [Fact]
    public async Task Update_RejectsIncompleteOrInvalidPayloadWithoutPartialWrites()
    {
        await AuthenticateAsMemberAsync();
        var missing = Payload(); missing["notifications"]!.AsObject().Remove("email_messages");
        var response = await Client.PutAsJsonAsync("/api/v2/users/me/notification-settings", missing);
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await response.Content.ReadAsStringAsync()).Should().Contain("notifications.email_messages");
        var invalid = Payload(); invalid["digest_frequency"] = "sometimes";
        (await Client.PutAsJsonAsync("/api/v2/users/me/notification-settings", invalid)).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.MatchPreferences.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant1.Id && x.UserId == TestData.MemberUser.Id)).Should().Be(0);
        (await db.TenantConfigs.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant1.Id && x.Key == $"notification_settings.{TestData.MemberUser.Id}.global.0")).Should().Be(0);
    }

    private static JsonObject Payload(string match = "monthly", string digest = "off", bool federation = true) => new()
    {
        ["notifications"] = new JsonObject
        {
            ["email_messages"] = true, ["email_listings"] = true, ["email_digest"] = false,
            ["email_connections"] = true, ["email_transactions"] = true, ["email_reviews"] = true,
            ["email_events"] = true, ["email_gamification_digest"] = true,
            ["email_gamification_milestones"] = true, ["email_org_payments"] = true,
            ["email_org_transfers"] = true, ["email_org_membership"] = true,
            ["email_org_admin"] = true, ["caring_smart_nudges"] = true,
            ["push_enabled"] = true, ["push_campaigns_opted_in"] = false,
            ["federation_notifications_enabled"] = federation
        },
        ["match_preferences"] = new JsonObject { ["notification_frequency"] = match, ["notify_hot_matches"] = true, ["notify_mutual_matches"] = false },
        ["digest_frequency"] = digest
    };
}
