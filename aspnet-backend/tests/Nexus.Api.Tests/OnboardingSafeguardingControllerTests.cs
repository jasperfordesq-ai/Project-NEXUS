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
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class OnboardingSafeguardingControllerTests : IntegrationTestBase
{
    public OnboardingSafeguardingControllerTests(NexusWebApplicationFactory factory)
        : base(factory)
    {
    }

    [Fact]
    public void RouteTable_HasOneDedicatedOwnerForEachCanonicalOnboardingSafeguardingRoute()
    {
        var routes = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var action = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                if (action is null || methods is null)
                {
                    return Array.Empty<(string Method, string Template, string Controller, string Action)>();
                }
                var template = (endpoint.RoutePattern.RawText ?? string.Empty)
                    .Trim().TrimStart('/').ToLowerInvariant();
                return methods.Select(method => (
                    Method: method.ToUpperInvariant(),
                    Template: template,
                    Controller: action.ControllerName,
                    Action: action.ActionName));
            })
            .ToArray();

        var getOwner = routes.Where(route => route.Method == "GET"
                && route.Template == "api/v2/onboarding/safeguarding-options")
            .Should().ContainSingle().Which;
        getOwner.Controller.Should().Be("OnboardingSafeguarding");
        getOwner.Action.Should().Be("Options");
        var postOwner = routes.Where(route => route.Method == "POST"
                && route.Template == "api/v2/onboarding/safeguarding")
            .Should().ContainSingle().Which;
        postOwner.Controller.Should().Be("OnboardingSafeguarding");
        postOwner.Action.Should().Be("Save");
    }

    [Fact]
    public async Task ReactFlow_GetPostMyPreferencesAndInteractionGate_UsesPersistedConsentRows()
    {
        await ConfigureJurisdictionAsync("england_wales");
        await AuthenticateAsMemberAsync();

        SafeguardingInteractionDecision before = null!;
        await WithServicesAsync(async services =>
        {
            before = await services.GetRequiredService<SafeguardingInteractionPolicy>()
                .EvaluateLocalContactAsync(
                    TestData.AdminUser.Id,
                    TestData.MemberUser.Id,
                    TestData.Tenant1.Id);
        });
        before.IsAllowed.Should().BeTrue();

        using var optionsResponse = await Client.GetAsync("/api/v2/onboarding/safeguarding-options");
        optionsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertV2Headers(optionsResponse);
        using var optionsDocument = JsonDocument.Parse(await optionsResponse.Content.ReadAsStringAsync());
        var root = optionsDocument.RootElement;
        root.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "data", "meta" });
        root.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var options = root.GetProperty("data").EnumerateArray().ToArray();
        options.Should().NotBeEmpty();
        options.Should().OnlyContain(option =>
            option.EnumerateObject().Select(property => property.Name).ToHashSet().SetEquals(new[]
            {
                "id", "option_key", "option_type", "label", "description", "help_url",
                "is_required", "select_options"
            }));
        options.Should().OnlyContain(option =>
            option.EnumerateObject().All(property => property.Name != "triggers"));
        var selected = options.Single(option =>
            option.GetProperty("option_key").GetString() == "requires_vetted_partners");
        selected.GetProperty("label").GetString().Should()
            .Be("I would prefer to only interact with members who have been appropriately vetted");
        var optionId = selected.GetProperty("id").GetInt32();

        using var saved = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = new[] { new { option_id = optionId, value = "1" } }
        });
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertV2Headers(saved);
        var savedJson = await saved.Content.ReadFromJsonAsync<JsonElement>();
        savedJson.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("Safeguarding preferences saved");
        savedJson.GetProperty("data").GetProperty("preferences_count").GetInt32().Should().Be(1);

        using var myPreferences = await Client.GetAsync("/api/v2/safeguarding/my-preferences");
        myPreferences.StatusCode.Should().Be(HttpStatusCode.OK);
        var preference = (await myPreferences.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("preferences").EnumerateArray()
            .Should().ContainSingle().Subject;
        preference.GetProperty("option_id").GetInt32().Should().Be(optionId);
        preference.GetProperty("selected_value").GetString().Should().Be("1");
        preference.GetProperty("activations").GetProperty("requires_vetted_interaction")
            .GetBoolean().Should().BeTrue();

        SafeguardingInteractionDecision after = null!;
        await WithServicesAsync(async services =>
        {
            after = await services.GetRequiredService<SafeguardingInteractionPolicy>()
                .EvaluateLocalContactAsync(
                    TestData.AdminUser.Id,
                    TestData.MemberUser.Id,
                    TestData.Tenant1.Id);
        });
        after.IsDenied.Should().BeTrue();
        after.Code.Should().Be("VETTING_REQUIRED");

        await WithDbAsync(async db =>
        {
            var stored = await db.UserSafeguardingPreferences.IgnoreQueryFilters()
                .SingleAsync(preference => preference.TenantId == TestData.Tenant1.Id
                    && preference.UserId == TestData.MemberUser.Id
                    && preference.OptionId == optionId);
            stored.RevokedAt.Should().BeNull();
            stored.ConsentGivenAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromMinutes(1));
            (await db.AuditLogs.IgnoreQueryFilters().AnyAsync(audit =>
                audit.TenantId == TestData.Tenant1.Id
                && audit.UserId == TestData.MemberUser.Id
                && audit.Action == "safeguarding_preferences_updated")).Should().BeTrue();
            (await db.AuditLogs.IgnoreQueryFilters().AnyAsync(audit =>
                audit.TenantId == TestData.Tenant1.Id
                && audit.UserId == TestData.MemberUser.Id
                && audit.Action == "safeguarding_triggers_activated")).Should().BeTrue();
            var bell = await db.Notifications.IgnoreQueryFilters().SingleAsync(notification =>
                notification.TenantId == TestData.Tenant1.Id
                && notification.UserId == TestData.AdminUser.Id
                && notification.Type == "safeguarding_flag");
            bell.Title.Should().Contain("Member User");
            bell.Title.Should().Contain("appropriately vetted");
            bell.Link.Should().Be($"/broker/safeguarding?user={TestData.MemberUser.Id}");
        });
    }

    [Fact]
    public async Task Options_LocalizeManagedPresetCopyWithoutChangingBrokerAuthoredText()
    {
        await ConfigureJurisdictionAsync("ireland");
        await WithDbAsync(async db =>
        {
            var custom = await db.SafeguardingOptions.IgnoreQueryFilters().SingleAsync(option =>
                option.TenantId == TestData.Tenant1.Id && option.OptionKey == "no_home_visits");
            custom.Label = "Broker-authored support wording";
            await db.SaveChangesAsync();
        });
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.AcceptLanguage.Clear();
        Client.DefaultRequestHeaders.AcceptLanguage.Add(new StringWithQualityHeaderValue("ga-IE"));

        using var response = await Client.GetAsync("/api/v2/onboarding/safeguarding-options");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var vetted = data.EnumerateArray().Single(option =>
            option.GetProperty("option_key").GetString() == "requires_vetted_partners");
        vetted.GetProperty("label").GetString().Should()
            .Be("B’fhearr liom gan idirghníomhú ach le baill a ndearnadh grinnfhiosrúchán cuí orthu");
        vetted.GetProperty("description").GetString().Should().Contain("Grinnfhiosrúchán an Gharda Síochána");
        var custom = data.EnumerateArray().Single(option =>
            option.GetProperty("option_key").GetString() == "no_home_visits");
        custom.GetProperty("label").GetString().Should().Be("Broker-authored support wording");
    }

    [Fact]
    public async Task Save_RejectsEmptyMissingAndForeignSelectionsWithoutWritingRows()
    {
        await AuthenticateAsMemberAsync();

        using var empty = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = Array.Empty<object>()
        });
        await AssertValidationAsync(
            empty,
            "preferences must be a non-empty array of {option_id, value}");

        using var missing = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = new[] { new { value = "1" } }
        });
        await AssertValidationAsync(missing, "preferences[0].option_id is required");

        int foreignOptionId = 0;
        await WithDbAsync(async db =>
        {
            var foreign = new SafeguardingOption
            {
                TenantId = TestData.Tenant2.Id,
                OptionKey = "foreign_support",
                OptionType = "checkbox",
                Label = "Other tenant only",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.SafeguardingOptions.Add(foreign);
            await db.SaveChangesAsync();
            foreignOptionId = foreign.Id;
        });

        using var foreignResponse = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = new[] { new { option_id = foreignOptionId, value = "1" } }
        });
        await AssertValidationAsync(foreignResponse, "One or more safeguarding options are invalid.");
        await WithDbAsync(async db =>
            (await db.UserSafeguardingPreferences.IgnoreQueryFilters().CountAsync())
                .Should().Be(0));
    }

    [Fact]
    public async Task Save_EnforcesRequiredAndSelectValuesServerSide()
    {
        int optionalId = 0;
        int requiredId = 0;
        int selectId = 0;
        await WithDbAsync(async db =>
        {
            var required = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = "required_support",
                OptionType = "checkbox",
                Label = "Required support response",
                IsRequired = true,
                IsActive = true,
                SortOrder = 10,
                CreatedAt = DateTime.UtcNow
            };
            var optional = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = "optional_support",
                OptionType = "checkbox",
                Label = "Optional support response",
                IsActive = true,
                SortOrder = 20,
                CreatedAt = DateTime.UtcNow
            };
            var select = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = "support_level",
                OptionType = "select",
                Label = "Support level",
                SelectOptionsJson = "[{\"value\":\"low\",\"label\":\"Low\"},{\"value\":\"high\",\"label\":\"High\"}]",
                IsActive = true,
                SortOrder = 30,
                CreatedAt = DateTime.UtcNow
            };
            db.SafeguardingOptions.AddRange(required, optional, select);
            await db.SaveChangesAsync();
            requiredId = required.Id;
            optionalId = optional.Id;
            selectId = select.Id;
        });
        await AuthenticateAsMemberAsync();

        using var requiredMissing = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = new[] { new { option_id = optionalId, value = "1" } }
        });
        await AssertValidationAsync(
            requiredMissing,
            "Please respond to the required safeguarding option 'Required support response'.");

        using var invalidSelect = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = new[]
            {
                new { option_id = requiredId, value = "1" },
                new { option_id = selectId, value = "forged" }
            }
        });
        await AssertValidationAsync(invalidSelect, "The selected safeguarding value is invalid.");
    }

    [Fact]
    public async Task Save_IsIdempotentAndReconsentsTheExistingOptionRow()
    {
        int optionId = 0;
        var originalConsent = DateTime.UtcNow.AddDays(-2);
        await WithDbAsync(async db =>
        {
            var option = new SafeguardingOption
            {
                TenantId = TestData.Tenant1.Id,
                OptionKey = "reconsent_support",
                OptionType = "checkbox",
                Label = "Re-consent support",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            db.SafeguardingOptions.Add(option);
            await db.SaveChangesAsync();
            optionId = option.Id;
            db.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                OptionId = option.Id,
                SelectedValue = "1",
                ConsentGivenAt = originalConsent,
                RevokedAt = DateTime.UtcNow.AddDays(-1),
                PolicyReviewRequiredAt = DateTime.UtcNow.AddHours(-1),
                PolicyReviewReasonCode = "jurisdiction_changed",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            });
            await db.SaveChangesAsync();
        });
        await AuthenticateAsMemberAsync();
        var payload = new { preferences = new[] { new { option_id = optionId, value = "1" } } };

        using var first = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", payload);
        using var second = await Client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", payload);
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);

        await WithDbAsync(async db =>
        {
            var rows = await db.UserSafeguardingPreferences.IgnoreQueryFilters()
                .Where(preference => preference.TenantId == TestData.Tenant1.Id
                    && preference.UserId == TestData.MemberUser.Id
                    && preference.OptionId == optionId)
                .ToListAsync();
            rows.Should().ContainSingle();
            rows[0].RevokedAt.Should().BeNull();
            rows[0].PolicyReviewRequiredAt.Should().BeNull();
            rows[0].PolicyReviewReasonCode.Should().BeNull();
            rows[0].ConsentGivenAt.Should().BeAfter(originalConsent);
        });
    }

    private async Task ConfigureJurisdictionAsync(string jurisdiction)
    {
        await WithServicesAsync(async services =>
        {
            await services.GetRequiredService<SafeguardingJurisdictionService>()
                .ConfigureAsync(TestData.Tenant1.Id, jurisdiction, TestData.AdminUser.Id);
        });
    }

    private async Task WithDbAsync(Func<NexusDbContext, Task> operation)
    {
        using var scope = Factory.Services.CreateScope();
        await operation(scope.ServiceProvider.GetRequiredService<NexusDbContext>());
    }

    private async Task WithServicesAsync(Func<IServiceProvider, Task> operation)
    {
        using var scope = Factory.Services.CreateScope();
        await operation(scope.ServiceProvider);
    }

    private static void AssertV2Headers(HttpResponseMessage response)
    {
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Should().ContainSingle();
    }

    private static async Task AssertValidationAsync(HttpResponseMessage response, string message)
    {
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = json.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be(message);
        error.GetProperty("field").GetString().Should().Be("preferences");
    }
}

[Collection("Integration")]
public sealed class OnboardingSafeguardingRateLimitingRuntimeTests : IntegrationTestBase
{
    public OnboardingSafeguardingRateLimitingRuntimeTests(NexusWebApplicationFactory factory)
        : base(factory)
    {
    }

    [Fact]
    public async Task ConfiguredWindowLimit_ReturnsTheExactLaravel429Envelope()
    {
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:SafeguardingVetting:OnboardingPermitLimit"] = "1",
                    ["RateLimiting:SafeguardingVetting:OnboardingWindowSeconds"] = "60"
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

        using (var accepted = await client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
               {
                   preferences = Array.Empty<object>()
               }))
        {
            accepted.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        }

        using var rejected = await client.PostAsJsonAsync("/api/v2/onboarding/safeguarding", new
        {
            preferences = Array.Empty<object>()
        });
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        var retryAfter = int.Parse(
            rejected.Headers.GetValues("Retry-After").Should().ContainSingle().Which,
            CultureInfo.InvariantCulture);
        retryAfter.Should().BeGreaterThan(0);

        using var document = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync());
        var root = document.RootElement;
        root.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "errors" });
        var error = root.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "code", "message" });
        error.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
        error.GetProperty("message").GetString()
            .Should().Be("Rate limit exceeded. Please try again later.");
    }
}
