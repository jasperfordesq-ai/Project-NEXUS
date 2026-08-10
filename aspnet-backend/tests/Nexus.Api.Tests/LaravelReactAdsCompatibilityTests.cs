// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactAdsCompatibilityTests : IntegrationTestBase
{
    public LaravelReactAdsCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ActiveAdsV2_ReturnsLaravelReactFeedAdCardShape()
    {
        await AuthenticateAsAdminAsync();

        var campaign = await Client.PostAsJsonAsync("/api/v2/me/ad-campaigns", new
        {
            name = "Feed ad active contract",
            advertiser_type = "verein",
            budget_cents = 5000,
            placement = "feed",
            start_date = "2026-07-01",
            end_date = "2026-12-31"
        });
        campaign.StatusCode.Should().Be(HttpStatusCode.Created);
        var campaignData = (await campaign.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var campaignId = campaignData.GetProperty("id").GetInt32();

        var creative = await Client.PostAsJsonAsync($"/api/v2/me/ad-campaigns/{campaignId}/creatives", new
        {
            headline = "Community garden help",
            body = "Join neighbours for a sponsored weekend gardening push.",
            cta_text = "Volunteer now",
            destination_url = "https://example.test/garden",
            image_url = "/uploads/ads/garden.jpg"
        });
        creative.StatusCode.Should().Be(HttpStatusCode.Created);
        var creativeId = (await creative.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var approve = await Client.PostAsync($"/api/v2/admin/ad-campaigns/{campaignId}/approve", null);
        approve.StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsMemberAsync();

        var active = await Client.GetAsync("/api/v2/ads/active?placement=feed&limit=3");

        active.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await active.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var rows = json.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().ContainSingle(row => row.GetProperty("campaign_id").GetInt32() == campaignId);

        var ad = rows.Single(row => row.GetProperty("campaign_id").GetInt32() == campaignId);
        ad.GetProperty("creative_id").GetInt32().Should().Be(creativeId);
        ad.GetProperty("advertiser_name").GetString().Should().Be("Admin User");
        ad.GetProperty("title").GetString().Should().Be("Community garden help");
        ad.GetProperty("body").GetString().Should().Be("Join neighbours for a sponsored weekend gardening push.");
        ad.GetProperty("image_url").GetString().Should().Be("/uploads/ads/garden.jpg");
        ad.GetProperty("cta_url").GetString().Should().Be("https://example.test/garden");
        ad.GetProperty("cta_label").GetString().Should().Be("Volunteer now");
        ad.GetProperty("tracking_token").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task FeedAdTrackingV2_UsesLaravelReactImpressionAndClickEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var impression = await Client.PostAsJsonAsync("/api/v2/ads/impression", new
        {
            creative_id = 10,
            placement = "feed"
        });

        impression.StatusCode.Should().Be(HttpStatusCode.OK);
        var impressionJson = await impression.Content.ReadFromJsonAsync<JsonElement>();
        var impressionId = impressionJson
            .GetProperty("data")
            .GetProperty("impression_id")
            .GetInt32();

        impressionId.Should().BeGreaterThan(0);

        var click = await Client.PostAsync($"/api/v2/ads/impression/{impressionId}/click", null);

        click.StatusCode.Should().Be(HttpStatusCode.OK);
        var clickJson = await click.Content.ReadFromJsonAsync<JsonElement>();
        clickJson.GetProperty("data").GetProperty("ok").GetBoolean().Should().BeTrue();
    }
}
