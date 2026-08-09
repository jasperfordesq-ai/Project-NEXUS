using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for health check endpoints.
/// Tests liveness and readiness probes.
/// </summary>
[Collection("Integration")]
public class HealthControllerTests
{
    private readonly HttpClient _client;

    public HealthControllerTests(NexusWebApplicationFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task LivenessCheck_ReturnsHealthy()
    {
        // Act - no auth required
        var response = await _client.GetAsync("/health");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("healthy");
    }

    [Fact]
    public async Task LivenessCheck_LiveRoute_ReturnsHealthy()
    {
        // Act
        var response = await _client.GetAsync("/health/live");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("healthy");
    }

    [Fact]
    public async Task ReadinessCheck_WithDatabase_ReturnsOk()
    {
        // Act
        var response = await _client.GetAsync("/health/ready");

        // Assert
        // Should be OK since we have a Testcontainer PostgreSQL running
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        // Updated contract (2026-05-11 observability fix): status is capitalized
        // (Healthy|Degraded|Unhealthy) and postgres replaces the old `database` key.
        // Optional probes (sendgrid, stripe) are "skipped" when keys are unset, so
        // the overall status is "Healthy" in the integration test environment.
        content.GetProperty("status").GetString().Should().Be("Healthy");
        content.GetProperty("checks").GetProperty("postgres").GetString().Should().Be("healthy");
    }
}
