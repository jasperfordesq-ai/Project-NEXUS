// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class DirectMessageTypingParityTests : IntegrationTestBase
{
    public DirectMessageTypingParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Typing_FirstContact_PublishesCanonicalRecipientEventWithoutCreatingConversation()
    {
        var publisher = new RecordingPusherPublisher();
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var factory = WithPublisher(publisher);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.AdminUser.Id,
            is_typing = false
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.EnumerateObject().Select(property => property.Name).Should().Equal("sent");
        publisher.Events.Should().ContainSingle();
        var sent = publisher.Events.Single();
        sent.Channel.Should().Be($"private-tenant.{TestData.Tenant1.Id}.user.{TestData.AdminUser.Id}");
        sent.Name.Should().Be("typing");
        var payload = JsonSerializer.SerializeToElement(sent.Payload);
        payload.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        payload.GetProperty("is_typing").GetBoolean().Should().BeFalse();
        using var scope = Factory.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<NexusDbContext>().Conversations
            .IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Typing_BlockAndSafeguardingRestriction_PreventEventDisclosure()
    {
        var publisher = new RecordingPusherPublisher();
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var factory = WithPublisher(publisher);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserBlocks.Add(new UserBlock
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                BlockedUserId = TestData.MemberUser.Id,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        using var blocked = await client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.AdminUser.Id,
            is_typing = true
        });
        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ErrorAsync(blocked)).GetProperty("code").GetString().Should().Be("BLOCKED");
        publisher.Events.Should().BeEmpty();
    }

    [Fact]
    public async Task Typing_SafeguardingRestriction_PreventsEvent()
    {
        await ConfigureRestrictedRecipientAsync();
        var publisher = new RecordingPusherPublisher();
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var factory = WithPublisher(publisher);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.AdminUser.Id,
            is_typing = true
        });
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ErrorAsync(response)).GetProperty("code").GetString()
            .Should().Be("SAFEGUARDING_CONTACT_RESTRICTED");
        publisher.Events.Should().BeEmpty();
    }

    [Fact]
    public async Task Typing_SelfAndCrossTenant_ReturnExactPreflightFailures()
    {
        await AuthenticateAsMemberAsync();
        using var self = await Client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.MemberUser.Id,
            is_typing = true
        });
        self.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ErrorAsync(self)).GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");

        using var crossTenant = await Client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.OtherTenantUser.Id,
            is_typing = true
        });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ErrorAsync(crossTenant)).GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task Typing_UsesIndependentLaravelSixtyPerMinuteBucket()
    {
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var factory = Factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:TypingPermitLimit"] = "1",
                    ["RateLimiting:Messages:TypingWindowSeconds"] = "60"
                })));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var accepted = await client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.AdminUser.Id,
            is_typing = true
        });
        accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        using var rejected = await client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.AdminUser.Id,
            is_typing = false
        });
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    private WebApplicationFactory<Program> WithPublisher(RecordingPusherPublisher publisher)
        => Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IPusherEventPublisher>();
            services.AddSingleton<IPusherEventPublisher>(publisher);
        }));

    private async Task ConfigureRestrictedRecipientAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var option = await db.SafeguardingOptions.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
            row.TenantId == TestData.Tenant1.Id && row.OptionKey == "requires_coordinator_contact");
        if (option == null)
        {
            option = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = "requires_coordinator_contact",
                OptionType = "checkbox",
                Label = "Coordinator contact required",
                TriggersJson = "{\"restricts_messaging\":true}",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.SafeguardingOptions.Add(option);
            await db.SaveChangesAsync();
        }
        db.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            OptionId = option.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private static async Task<JsonElement> ErrorAsync(HttpResponseMessage response)
        => (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").EnumerateArray().Single();

    private sealed class RecordingPusherPublisher : IPusherEventPublisher
    {
        public List<(string Channel, string Name, object Payload)> Events { get; } = [];

        public Task<bool> TriggerAsync(
            string channel,
            string eventName,
            object payload,
            CancellationToken cancellationToken = default)
        {
            Events.Add((channel, eventName, payload));
            return Task.FromResult(true);
        }
    }
}
