// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class JobsControllerTests : IntegrationTestBase
{
    public JobsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListJobs_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/jobs");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task CreateJob_AsAuthenticated_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/jobs", new
        {
            title = "Test Job Vacancy",
            description = "A test job for integration testing",
            category = "technology",
            job_type = "volunteer",
            is_remote = true,
            time_credits_per_hour = 2.0
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        content.GetProperty("title").GetString().Should().Be("Test Job Vacancy");
    }

    [Fact]
    public async Task GetJob_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/jobs/99999");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ApplyToJob_AsAuthenticated_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();

        // Create a job first
        var createResponse = await Client.PostAsJsonAsync("/api/jobs", new
        {
            title = "Apply Test Job",
            description = "Job to apply to",
            category = "services",
            job_type = "one-off",
            status = "active"
        });
        var job = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var jobId = job.GetProperty("id").GetInt32();

        // Apply as admin (different user)
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync($"/api/jobs/{jobId}/apply", new
        {
            cover_letter = "I am interested in this opportunity"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task SaveJob_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        // Create a job
        var createResponse = await Client.PostAsJsonAsync("/api/jobs", new
        {
            title = "Save Test Job",
            category = "community",
            job_type = "volunteer"
        });
        var job = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var jobId = job.GetProperty("id").GetInt32();

        // Save it
        var response = await Client.PostAsync($"/api/jobs/{jobId}/save", null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ListJobs_Unauthenticated_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/jobs");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
