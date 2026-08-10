// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AdminSafeguardingOptionParityTests : IntegrationTestBase
{
    private const string Path = "/api/v2/admin/safeguarding/options";

    public AdminSafeguardingOptionParityTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public async Task CrudAndReorder_MatchLaravelEnvelopeSanitizationImmutabilityAndAudit()
    {
        await AuthenticateAsAdminAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var rawKey = $"Parity option-{suffix}!";
        var expectedKey = $"parity_option_{suffix}_";
        var optionId = 0;
        try
        {
            using var created = await Client.PostAsJsonAsync(Path, new
            {
                option_key = rawKey,
                label = " <strong>Needs support</strong> ",
                description = "<em>Coordinator follow-up</em>",
                help_url = "http://unsafe.example.test/help",
                sort_order = "12items",
                is_active = "yes",
                is_required = "on",
                triggers = new { requires_broker_approval = true }
            });
            created.StatusCode.Should().Be(HttpStatusCode.Created);
            AssertV2Headers(created);
            var createdRoot = await created.Content.ReadFromJsonAsync<JsonElement>();
            createdRoot.EnumerateObject().Select(property => property.Name)
                .Should().BeEquivalentTo(new[] { "data", "meta" });
            createdRoot.GetProperty("meta").GetProperty("base_url").GetString()
                .Should().NotBeNullOrWhiteSpace();
            var data = createdRoot.GetProperty("data");
            optionId = data.GetProperty("id").GetInt32();
            data.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
            data.GetProperty("option_key").GetString().Should().Be(expectedKey);
            data.GetProperty("label").GetString().Should().Be("Needs support");
            data.GetProperty("description").GetString().Should().Be("Coordinator follow-up");
            data.GetProperty("help_url").ValueKind.Should().Be(JsonValueKind.Null);
            data.GetProperty("sort_order").GetInt32().Should().Be(12);
            data.GetProperty("is_active").GetBoolean().Should().BeTrue();
            data.GetProperty("is_required").GetBoolean().Should().BeTrue();
            data.GetProperty("triggers").GetProperty("requires_broker_approval")
                .GetBoolean().Should().BeTrue();

            using var updated = await Client.PutAsJsonAsync($"{Path}/{optionId}", new
            {
                option_key = "immutable_key_attempt",
                label = "<b>Renamed support</b>",
                triggers = new { requires_broker_approval = true }
            });
            updated.StatusCode.Should().Be(HttpStatusCode.OK);
            (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
                .GetProperty("message").GetString().Should().Be("Option updated");

            using var reordered = await Client.PutAsJsonAsync($"{Path}/reorder", new
            {
                order = new Dictionary<string, int>
                {
                    [optionId.ToString(CultureInfo.InvariantCulture)] = 93
                }
            });
            reordered.StatusCode.Should().Be(HttpStatusCode.OK);
            (await reordered.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
                .GetProperty("message").GetString().Should().Be("Options reordered");

            using var deleted = await Client.DeleteAsync($"{Path}/{optionId}");
            deleted.StatusCode.Should().Be(HttpStatusCode.OK);
            (await deleted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
                .GetProperty("message").GetString().Should().Be("Option deactivated");

            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.SafeguardingOptions.IgnoreQueryFilters()
                .SingleAsync(option => option.Id == optionId);
            stored.OptionKey.Should().Be(expectedKey);
            stored.Label.Should().Be("Renamed support");
            stored.SortOrder.Should().Be(93);
            stored.IsActive.Should().BeFalse();
            var actions = await db.AuditLogs.IgnoreQueryFilters()
                .Where(log => log.TenantId == TestData.Tenant1.Id
                    && (log.EntityId == optionId || log.Action == "safeguarding_options_reordered"))
                .Select(log => log.Action)
                .ToListAsync();
            actions.Should().Contain(new[]
            {
                "safeguarding_option_created",
                "safeguarding_option_updated",
                "safeguarding_options_reordered",
                "safeguarding_option_deleted"
            });
        }
        finally
        {
            if (optionId > 0)
            {
                using var cleanup = Factory.Services.CreateScope();
                var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.AuditLogs.IgnoreQueryFilters()
                    .Where(log => log.TenantId == TestData.Tenant1.Id
                        && (log.EntityId == optionId || log.Action == "safeguarding_options_reordered"))
                    .ExecuteDeleteAsync();
                await db.SafeguardingOptions.IgnoreQueryFilters()
                    .Where(option => option.Id == optionId)
                    .ExecuteDeleteAsync();
            }
        }
    }

    [Fact]
    public async Task ValidationAndTenantScope_ReturnExactLaravelErrors()
    {
        await AuthenticateAsAdminAsync();
        var suffix = Guid.NewGuid().ToString("N");

        await AssertErrorAsync(
            await Client.PostAsJsonAsync(Path, new { label = "Missing key" }),
            HttpStatusCode.UnprocessableEntity,
            "VALIDATION_ERROR",
            "option_key is required",
            "option_key");
        await AssertErrorAsync(
            await Client.PostAsJsonAsync(Path, new
            {
                option_key = $"bad_trigger_{suffix}",
                label = "Bad trigger",
                triggers = new { unsafe_custom_trigger = true }
            }),
            HttpStatusCode.UnprocessableEntity,
            "VALIDATION_ERROR",
            "Unknown trigger key 'unsafe_custom_trigger'",
            "triggers");
        await AssertErrorAsync(
            await Client.PostAsJsonAsync(Path, new
            {
                option_key = $"bad_select_{suffix}",
                label = "Bad select",
                option_type = "select",
                select_options = Array.Empty<object>()
            }),
            HttpStatusCode.UnprocessableEntity,
            "VALIDATION_ERROR",
            "select_options must be a non-empty array for select type",
            "select_options");
        await AssertErrorAsync(
            await Client.PostAsJsonAsync(Path, new
            {
                option_key = $"bad_vetting_{suffix}",
                label = "Bad vetting",
                triggers = new { vetting_type_required = "arbitrary_certificate" }
            }),
            HttpStatusCode.UnprocessableEntity,
            "INVALID_VETTING_REQUIREMENT",
            "Choose a controlled vetting requirement for this safeguarding option.",
            "triggers.vetting_type_required");

        int foreignOptionId;
        using (var seed = Factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
            var foreign = new SafeguardingOption
            {
                TenantId = TestData.Tenant2.Id,
                OptionKey = $"foreign_{suffix}",
                OptionType = "checkbox",
                Label = "Foreign tenant option",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.SafeguardingOptions.Add(foreign);
            await db.SaveChangesAsync();
            foreignOptionId = foreign.Id;
        }
        try
        {
            await AssertErrorAsync(
                await Client.PutAsJsonAsync($"{Path}/{foreignOptionId}", new { label = "Cross tenant" }),
                HttpStatusCode.NotFound,
                "NOT_FOUND",
                "Option not found",
                null);
        }
        finally
        {
            using var cleanup = Factory.Services.CreateScope();
            await cleanup.ServiceProvider.GetRequiredService<NexusDbContext>()
                .SafeguardingOptions.IgnoreQueryFilters()
                .Where(option => option.Id == foreignOptionId)
                .ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task ActiveProtectedSelection_CannotBeWeakenedOrDeactivated()
    {
        var suffix = Guid.NewGuid().ToString("N");
        int optionId;
        int preferenceId;
        using (var seed = Factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
            var option = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = $"protected_{suffix}",
                OptionType = "checkbox",
                Label = "Protected option",
                IsActive = true,
                TriggersJson = "{\"requires_broker_approval\":true}",
                CreatedAt = DateTime.UtcNow
            };
            db.SafeguardingOptions.Add(option);
            await db.SaveChangesAsync();
            optionId = option.Id;
            var preference = new UserSafeguardingPreference
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                OptionId = optionId,
                SelectedValue = "1",
                ConsentGivenAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            };
            db.UserSafeguardingPreferences.Add(preference);
            await db.SaveChangesAsync();
            preferenceId = preference.Id;
        }

        try
        {
            await AuthenticateAsAdminAsync();
            await AssertErrorAsync(
                await Client.PutAsJsonAsync($"{Path}/{optionId}", new
                {
                    triggers = new { requires_broker_approval = false }
                }),
                HttpStatusCode.ServiceUnavailable,
                "SAFEGUARDING_POLICY_UNAVAILABLE",
                "The safeguarding policy is not available for this action.",
                null);
            await AssertErrorAsync(
                await Client.DeleteAsync($"{Path}/{optionId}"),
                HttpStatusCode.ServiceUnavailable,
                "SAFEGUARDING_POLICY_UNAVAILABLE",
                "The safeguarding policy is not available for this action.",
                null);

            using var verify = Factory.Services.CreateScope();
            var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.SafeguardingOptions.IgnoreQueryFilters().SingleAsync(option => option.Id == optionId))
                .IsActive.Should().BeTrue();
            (await db.UserSafeguardingPreferences.IgnoreQueryFilters()
                    .SingleAsync(preference => preference.Id == preferenceId))
                .RevokedAt.Should().BeNull();
        }
        finally
        {
            using var cleanup = Factory.Services.CreateScope();
            var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.UserSafeguardingPreferences.IgnoreQueryFilters()
                .Where(preference => preference.Id == preferenceId)
                .ExecuteDeleteAsync();
            await db.SafeguardingOptions.IgnoreQueryFilters()
                .Where(option => option.Id == optionId)
                .ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task BrokerCanListOptions()
    {
        var email = $"option-broker-{Guid.NewGuid():N}@test.com";
        var brokerId = 0;
        try
        {
            using (var seed = Factory.Services.CreateScope())
            {
                var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
                var broker = new User
                {
                    TenantId = TestData.Tenant1.Id,
                    Email = email,
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                    FirstName = "Option",
                    LastName = "Broker",
                    Role = "broker",
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };
                db.Users.Add(broker);
                await db.SaveChangesAsync();
                brokerId = broker.Id;
            }

            SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant1.Slug));
            using var response = await Client.GetAsync(Path);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            AssertV2Headers(response);
        }
        finally
        {
            ClearAuthToken();
            if (brokerId > 0)
            {
                using var cleanup = Factory.Services.CreateScope();
                var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.RefreshTokens.IgnoreQueryFilters()
                    .Where(token => token.UserId == brokerId)
                    .ExecuteDeleteAsync();
                await db.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == brokerId)
                    .ExecuteDeleteAsync();
            }
        }
    }

    [Fact]
    public async Task MutationRateLimit_IsSixtyPerMinuteAndUsesLaravelV2Envelope()
    {
        var token = await GetAccessTokenAsync("admin@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:SafeguardingVetting:OptionMutationPermitLimit"] = "1",
                    ["RateLimiting:SafeguardingVetting:OptionMutationWindowSeconds"] = "60"
                }));
            builder.ConfigureServices(services =>
            {
                foreach (var hostedService in services
                             .Where(descriptor => descriptor.ServiceType == typeof(IHostedService)
                                 && descriptor.ImplementationType?.Assembly == typeof(Program).Assembly)
                             .ToList())
                {
                    services.Remove(hostedService);
                }
            });
        });
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using (var first = await client.PostAsJsonAsync(Path, new { label = "Missing key" }))
        {
            first.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        }
        using var rejected = await client.PostAsJsonAsync(Path, new { label = "Missing key" });
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        rejected.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        rejected.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString(CultureInfo.InvariantCulture));
        var root = await rejected.Content.ReadFromJsonAsync<JsonElement>();
        root.GetProperty("success").GetBoolean().Should().BeFalse();
        root.GetProperty("retry_after").GetInt32().Should().BeGreaterThan(0);
        root.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("rate_limited");
        root.GetProperty("errors")[0].GetProperty("message").GetString()
            .Should().Be("Rate limit exceeded. Please try again later.");
    }

    private static async Task AssertErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode status,
        string code,
        string message,
        string? field)
    {
        using (response)
        {
            response.StatusCode.Should().Be(status);
            var root = await response.Content.ReadFromJsonAsync<JsonElement>();
            var error = root.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
            error.GetProperty("code").GetString().Should().Be(code);
            error.GetProperty("message").GetString().Should().Be(message);
            if (field is null)
            {
                error.TryGetProperty("field", out _).Should().BeFalse();
            }
            else
            {
                error.GetProperty("field").GetString().Should().Be(field);
            }
        }
    }

    private void AssertV2Headers(HttpResponseMessage response)
    {
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString(CultureInfo.InvariantCulture));
    }
}
