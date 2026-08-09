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
public class JobsParityControllerTests : IntegrationTestBase
{
    public JobsParityControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SavedProfile_UpsertAndGet_ReturnsProfile()
    {
        await AuthenticateAsMemberAsync();

        var update = await Client.PutAsJsonAsync("/api/jobs/saved-profile", new
        {
            headline = "Community gardener",
            skills = "gardening, mentoring",
            visible_to_employers = true
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var get = await Client.GetAsync("/api/jobs/saved-profile");
        get.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await get.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetProperty("headline").GetString().Should().Be("Community gardener");
    }

    [Fact]
    public async Task Templates_CreateAndList_ReturnsTemplate()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/jobs/templates", new
        {
            title = "Volunteer shift template",
            category = "community",
            job_type = "volunteer",
            required_skills = "welcome desk",
            is_public = true
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await Client.GetAsync("/api/jobs/templates");
        list.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await list.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray().Should().Contain(e => e.GetProperty("title").GetString() == "Volunteer shift template");
    }

    [Fact]
    public async Task InterviewWorkflow_CreateAcceptAndCalendar_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var createJob = await Client.PostAsJsonAsync("/api/jobs", new
        {
            title = "Interview parity job",
            description = "Testing richer job workflows",
            category = "community",
            job_type = "volunteer",
            status = "active"
        });
        var job = await createJob.Content.ReadFromJsonAsync<JsonElement>();
        var jobId = job.GetProperty("id").GetInt32();

        await AuthenticateAsAdminAsync();
        var apply = await Client.PostAsJsonAsync($"/api/jobs/{jobId}/apply", new { cover_letter = "I can help with this." });
        var application = await apply.Content.ReadFromJsonAsync<JsonElement>();
        var applicationId = application.GetProperty("id").GetInt32();

        await AuthenticateAsMemberAsync();
        var createInterview = await Client.PostAsJsonAsync($"/api/jobs/applications/{applicationId}/interview", new
        {
            starts_at = DateTime.UtcNow.AddDays(3),
            location = "Community hub"
        });

        createInterview.StatusCode.Should().Be(HttpStatusCode.OK);
        var interview = await createInterview.Content.ReadFromJsonAsync<JsonElement>();
        var interviewId = interview.GetProperty("data").GetProperty("id").GetInt32();

        var accept = await Client.PutAsync($"/api/jobs/interviews/{interviewId}/accept", null);
        accept.StatusCode.Should().Be(HttpStatusCode.OK);

        var calendar = await Client.GetAsync($"/api/jobs/interviews/{interviewId}/calendar-links");
        calendar.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
