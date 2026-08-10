// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Middleware;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

public sealed class SafeguardingVettingRateLimitingContractTests
{
    [Fact]
    public void NamedPolicies_HaveExactLaravelCeilingsAndOneMinuteWindows()
    {
        var contracts = RateLimitingExtensions.SafeguardingVettingRateLimitContracts;

        contracts.Select(contract => contract.PolicyName)
            .Should().OnlyHaveUniqueItems();
        contracts.Should().HaveCount(6);

        contracts.Should().ContainSingle(contract =>
            contract.PolicyName == RateLimitingExtensions.SafeguardingVettingPolicyUpdatePolicy
            && contract.PermitLimitConfigurationKey == "RateLimiting:SafeguardingVetting:PolicyUpdatePermitLimit"
            && contract.DefaultPermitLimit == 20
            && contract.WindowSecondsConfigurationKey == "RateLimiting:SafeguardingVetting:PolicyUpdateWindowSeconds"
            && contract.DefaultWindowSeconds == 60);
        contracts.Should().ContainSingle(contract =>
            contract.PolicyName == RateLimitingExtensions.SafeguardingVettingPolicyRotationPolicy
            && contract.PermitLimitConfigurationKey == "RateLimiting:SafeguardingVetting:PolicyRotationPermitLimit"
            && contract.DefaultPermitLimit == 5
            && contract.WindowSecondsConfigurationKey == "RateLimiting:SafeguardingVetting:PolicyRotationWindowSeconds"
            && contract.DefaultWindowSeconds == 60);
        contracts.Should().ContainSingle(contract =>
            contract.PolicyName == RateLimitingExtensions.SafeguardingVettingDecisionPolicy
            && contract.PermitLimitConfigurationKey == "RateLimiting:SafeguardingVetting:DecisionPermitLimit"
            && contract.DefaultPermitLimit == 60
            && contract.WindowSecondsConfigurationKey == "RateLimiting:SafeguardingVetting:DecisionWindowSeconds"
            && contract.DefaultWindowSeconds == 60);
        contracts.Should().ContainSingle(contract =>
            contract.PolicyName == RateLimitingExtensions.SafeguardingVettingMemberMutationPolicy
            && contract.PermitLimitConfigurationKey == "RateLimiting:SafeguardingVetting:MemberMutationPermitLimit"
            && contract.DefaultPermitLimit == 10
            && contract.WindowSecondsConfigurationKey == "RateLimiting:SafeguardingVetting:MemberMutationWindowSeconds"
            && contract.DefaultWindowSeconds == 60);
        contracts.Should().ContainSingle(contract =>
            contract.PolicyName == RateLimitingExtensions.SafeguardingOnboardingMutationPolicy
            && contract.PermitLimitConfigurationKey == "RateLimiting:SafeguardingVetting:OnboardingPermitLimit"
            && contract.DefaultPermitLimit == 5
            && contract.WindowSecondsConfigurationKey == "RateLimiting:SafeguardingVetting:OnboardingWindowSeconds"
            && contract.DefaultWindowSeconds == 60);
        contracts.Should().ContainSingle(contract =>
            contract.PolicyName == RateLimitingExtensions.SafeguardingOptionMutationPolicy
            && contract.PermitLimitConfigurationKey == "RateLimiting:SafeguardingVetting:OptionMutationPermitLimit"
            && contract.DefaultPermitLimit == 60
            && contract.WindowSecondsConfigurationKey == "RateLimiting:SafeguardingVetting:OptionMutationWindowSeconds"
            && contract.DefaultWindowSeconds == 60);
    }

    [Fact]
    public void Contracts_ResolveConfiguredOverridesFromTheirOwnKeys()
    {
        var values = RateLimitingExtensions.SafeguardingVettingRateLimitContracts
            .SelectMany((contract, index) => new[]
            {
                new KeyValuePair<string, string?>(
                    contract.PermitLimitConfigurationKey,
                    (101 + index).ToString()),
                new KeyValuePair<string, string?>(
                    contract.WindowSecondsConfigurationKey,
                    (11 + index).ToString())
            });
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();

        for (var index = 0;
             index < RateLimitingExtensions.SafeguardingVettingRateLimitContracts.Count;
             index++)
        {
            var contract = RateLimitingExtensions.SafeguardingVettingRateLimitContracts[index];
            contract.ResolvePermitLimit(configuration).Should().Be(101 + index);
            contract.ResolveWindow(configuration).Should().Be(TimeSpan.FromSeconds(11 + index));
        }
    }

    [Fact]
    public void AuthenticatedPartition_IsTenantAndUserScopedRatherThanRoleOrClientScoped()
    {
        var first = Context(userId: 17, tenantId: 3, role: "broker");
        var sameUserDifferentRole = Context(userId: 17, tenantId: 3, role: "admin");
        var sameUserDifferentTenant = Context(userId: 17, tenantId: 4, role: "broker");
        var differentUser = Context(userId: 18, tenantId: 3, role: "broker");

        RateLimitingExtensions.GetAuthenticatedUserPartitionKey(first)
            .Should().Be("user:3:17");
        RateLimitingExtensions.GetAuthenticatedUserPartitionKey(sameUserDifferentRole)
            .Should().Be("user:3:17");
        RateLimitingExtensions.GetAuthenticatedUserPartitionKey(sameUserDifferentTenant)
            .Should().Be("user:4:17");
        RateLimitingExtensions.GetAuthenticatedUserPartitionKey(differentUser)
            .Should().Be("user:3:18");
        RateLimitingExtensions.GetAuthenticatedUserPartitionKey(new DefaultHttpContext())
            .Should().BeNull();
    }

    private static DefaultHttpContext Context(int userId, int tenantId, string role)
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim("sub", userId.ToString()),
                new Claim("tenant_id", tenantId.ToString()),
                new Claim("role", role)
            ], "vetting-rate-test"))
        };
        return context;
    }
}

[Collection("Integration")]
public sealed class SafeguardingVettingRateLimitingRuntimeTests : IntegrationTestBase
{
    private const string MemberMutationPath = "/api/v2/safeguarding/confirm-policy-review";

    public SafeguardingVettingRateLimitingRuntimeTests(NexusWebApplicationFactory factory)
        : base(factory)
    {
    }

    [Fact]
    public async Task MemberMutationLimit_ReturnsExactLaravelV2EnvelopeInsteadOfGenericFallback()
    {
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:SafeguardingVetting:MemberMutationPermitLimit"] = "1",
                    ["RateLimiting:SafeguardingVetting:MemberMutationWindowSeconds"] = "60"
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
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        using (var accepted = await client.PostAsync(MemberMutationPath, content: null))
        {
            accepted.StatusCode.Should().NotBe(HttpStatusCode.TooManyRequests);
        }

        using var rejected = await client.PostAsync(MemberMutationPath, content: null);
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        rejected.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        rejected.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString(CultureInfo.InvariantCulture));

        var retryAfter = int.Parse(
            rejected.Headers.GetValues("Retry-After").Should().ContainSingle().Which,
            CultureInfo.InvariantCulture);
        retryAfter.Should().BeGreaterThan(0);

        using var document = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync());
        var root = document.RootElement;
        root.EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(
            new[] { "errors", "success", "retry_after" });
        root.GetProperty("success").GetBoolean().Should().BeFalse();
        root.GetProperty("retry_after").GetInt32().Should().Be(retryAfter);

        var errors = root.GetProperty("errors");
        errors.GetArrayLength().Should().Be(1);
        var error = errors[0];
        error.EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(
            new[] { "code", "message" });
        error.GetProperty("code").GetString().Should().Be("rate_limited");
        error.GetProperty("message").GetString()
            .Should().Be("Rate limit exceeded. Please try again later.");

        root.TryGetProperty("error", out _).Should().BeFalse();
        root.TryGetProperty("message", out _).Should().BeFalse();
        root.TryGetProperty("retry_after_seconds", out _).Should().BeFalse();
    }
}
