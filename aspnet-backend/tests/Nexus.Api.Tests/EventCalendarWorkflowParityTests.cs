// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventCalendarWorkflowParityTests : IntegrationTestBase
{
    public EventCalendarWorkflowParityTests(NexusWebApplicationFactory factory):base(factory){}

    [Fact]
    public async Task CalendarProjectionActionsAndIcs_ShareIdentityFreeLifecycleData()
    {
        var id=await EventAsync();await AuthenticateAsMemberAsync();var from=DateTime.UtcNow.AddDays(1).ToString("yyyy-MM-dd");var to=DateTime.UtcNow.AddDays(10).ToString("yyyy-MM-dd");var response=await Client.GetAsync($"/api/v2/events/calendar?from={from}&to={to}");response.StatusCode.Should().Be(HttpStatusCode.OK);var json=await response.Content.ReadFromJsonAsync<JsonElement>();var item=json.GetProperty("data")[0];item.GetProperty("id").GetInt32().Should().Be(id);item.GetProperty("calendar_status").GetString().Should().Be("confirmed");item.ToString().ToLowerInvariant().Should().NotContain("location").And.NotContain("meeting").And.NotContain("email");json.GetProperty("meta").GetProperty("identity_free").GetBoolean().Should().BeTrue();var actions=await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{id}/calendar-actions");actions.GetProperty("data").GetProperty("google_url").GetString().Should().StartWith("https://calendar.google.com/");actions.GetProperty("data").GetProperty("download_path").GetString().Should().Be($"/v2/events/{id}/calendar.ics");var ics=await Client.GetAsync($"/api/v2/events/{id}/calendar.ics");ics.Content.Headers.ContentType!.MediaType.Should().Be("text/calendar");var body=await ics.Content.ReadAsStringAsync();body.Should().Contain("BEGIN:VEVENT").And.Contain("UID:").And.Contain("SEQUENCE:").And.NotContain("Secret venue");ics.Headers.CacheControl!.NoStore.Should().BeTrue();
    }

    [Fact]
    public async Task FeedToken_IsOneTimeHashedOwnerScopedAndRevocable()
    {
        var id=await EventAsync(seedRegistration:true);await AuthenticateAsMemberAsync();var created=await Client.PostAsJsonAsync("/api/v2/events/calendar/feed-tokens",new{label="Phone"});created.StatusCode.Should().Be(HttpStatusCode.Created);var data=(await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");var tokenId=data.GetProperty("id").GetInt64();var secret=data.GetProperty("secret").GetString()!;secret.Should().StartWith("nxc_").And.HaveLength(68);var feedUrl=data.GetProperty("feed_url").GetString()!;using(var scope=Factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var row=await db.EventCalendarFeedTokens.IgnoreQueryFilters().SingleAsync(x=>x.Id==tokenId);row.TokenHash.Should().Be(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant());row.TokenHash.Should().NotContain(secret);}
        var list=await Client.GetFromJsonAsync<JsonElement>("/api/v2/events/calendar/feed-tokens");list.GetProperty("data")[0].TryGetProperty("secret",out _).Should().BeFalse();var personal=await Client.GetAsync(new Uri(feedUrl).PathAndQuery);personal.StatusCode.Should().Be(HttpStatusCode.OK);(await personal.Content.ReadAsStringAsync()).Should().Contain($"/events/{id}");var revoked=await Client.DeleteAsync($"/api/v2/events/calendar/feed-tokens/{tokenId}");revoked.StatusCode.Should().Be(HttpStatusCode.OK);(await Client.GetAsync(new Uri(feedUrl).PathAndQuery)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task PersonalFeed_IncludesOnlyConfirmedRegistrations()
    {
        var included=await EventAsync(seedRegistration:true);var excluded=await EventAsync();await AuthenticateAsMemberAsync();var created=await Client.PostAsJsonAsync("/api/v2/events/calendar/feed-tokens",new{label=(string?)null});var url=(await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("feed_url").GetString()!;var body=await Client.GetStringAsync(new Uri(url).PathAndQuery);body.Should().Contain($"/events/{included}").And.NotContain($"/events/{excluded}");
    }

    [Fact]
    public async Task RangeTenantAndTokenOwnershipBoundaries_FailClosed()
    {
        var id=await EventAsync();await AuthenticateAsMemberAsync();(await Client.GetAsync("/api/v2/events/calendar?from=2026-01-01")).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);var created=await Client.PostAsJsonAsync("/api/v2/events/calendar/feed-tokens",new{label="Owner"});var tokenId=(await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt64();await AuthenticateAsOtherTenantUserAsync();(await Client.GetAsync($"/api/v2/events/{id}/calendar.ics")).StatusCode.Should().Be(HttpStatusCode.NotFound);(await Client.DeleteAsync($"/api/v2/events/calendar/feed-tokens/{tokenId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<int> EventAsync(bool seedRegistration=false){using var scope=Factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var start=DateTime.UtcNow.AddDays(4);var evt=new Event{TenantId=TestData.Tenant1.Id,CreatedById=TestData.AdminUser.Id,Title="Calendar event",Description="Private description",Location="Secret venue",StartsAt=start,EndsAt=start.AddHours(2),Timezone="Europe/Dublin",Status="active",PublicationStatus="published",OperationalStatus="scheduled",CalendarSequence=2,LifecycleVersion=3};db.Events.Add(evt);await db.SaveChangesAsync();if(seedRegistration){db.EventRegistrations.Add(new EventRegistration{TenantId=TestData.Tenant1.Id,EventId=evt.Id,UserId=TestData.MemberUser.Id,RegistrationState="confirmed",ConfirmedAt=DateTime.UtcNow,StateChangedAt=DateTime.UtcNow,StateChangedBy=TestData.MemberUser.Id});await db.SaveChangesAsync();}return evt.Id;}
}
