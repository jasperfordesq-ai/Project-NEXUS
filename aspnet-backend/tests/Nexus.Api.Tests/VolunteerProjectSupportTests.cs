// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Backing a community project (R-28, last of the write-only stores that had a
/// clear owner).
///
/// 🔴 The feature was entirely cosmetic. Supporting a project wrote an opaque
/// blob into tenant config, and the project list returned raw records carrying
/// neither <c>supporter_count</c> nor <c>has_supported</c> — the two fields the
/// screen displays. So the tap nudged a number the client had invented, the
/// server filed the fact where nothing read it, and the next page load showed
/// no supporters at all.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerProjectSupportTests : IntegrationTestBase
{
    public VolunteerProjectSupportTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedProjectAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var project = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant1.Id,
            // A project needs an organiser; the FK is (TenantId, OrganizerId).
            OrganizerId = TestData.AdminUser.Id,
            Title = $"Community project {Guid.NewGuid():N}"[..24],
            Description = "Somewhere to plant things",
            CreatedAt = DateTime.UtcNow,
        };
        db.VolunteerOpportunities.Add(project);
        await db.SaveChangesAsync();
        return project.Id;
    }

    private async Task<JsonElement> ProjectAsync(int id)
    {
        var response = await Client.GetAsync("/api/volunteering/community-projects");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        return data.EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);
    }

    [Fact]
    public async Task SupportingAProject_SurvivesAReload()
    {
        var projectId = await SeedProjectAsync();
        await AuthenticateAsMemberAsync();

        var before = await ProjectAsync(projectId);
        before.GetProperty("supporter_count").GetInt32().Should().Be(0, "control: nobody has backed it yet");
        before.GetProperty("has_supported").GetBoolean().Should().BeFalse();

        var support = await Client.PostAsJsonAsync(
            $"/api/volunteering/community-projects/{projectId}/support", new { });
        support.StatusCode.Should().Be(HttpStatusCode.OK);

        var after = await ProjectAsync(projectId);
        after.GetProperty("supporter_count").GetInt32().Should().Be(1,
            "the list carried no supporter_count at all before, so the count reset on every reload");
        after.GetProperty("has_supported").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task WithdrawingSupport_TakesTheCountBackDown()
    {
        var projectId = await SeedProjectAsync();
        await AuthenticateAsMemberAsync();

        await Client.PostAsJsonAsync($"/api/volunteering/community-projects/{projectId}/support", new { });
        var withdraw = await Client.DeleteAsync($"/api/volunteering/community-projects/{projectId}/support");
        withdraw.StatusCode.Should().Be(HttpStatusCode.OK);

        var after = await ProjectAsync(projectId);
        after.GetProperty("supporter_count").GetInt32().Should().Be(0);
        after.GetProperty("has_supported").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task SupportingTwice_CountsOnce()
    {
        var projectId = await SeedProjectAsync();
        await AuthenticateAsMemberAsync();

        await Client.PostAsJsonAsync($"/api/volunteering/community-projects/{projectId}/support", new { });
        var second = await Client.PostAsJsonAsync(
            $"/api/volunteering/community-projects/{projectId}/support", new { });

        second.StatusCode.Should().Be(HttpStatusCode.OK,
            "the screen updates optimistically, so a double tap must not read as a failure");

        (await ProjectAsync(projectId)).GetProperty("supporter_count").GetInt32()
            .Should().Be(1, "one member is one supporter, however many times they tap");
    }

    [Fact]
    public async Task WithdrawingWhenNotSupporting_IsNotAnError()
    {
        var projectId = await SeedProjectAsync();
        await AuthenticateAsMemberAsync();

        (await Client.DeleteAsync($"/api/volunteering/community-projects/{projectId}/support"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await ProjectAsync(projectId)).GetProperty("supporter_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task HasSupported_IsPerMember()
    {
        var projectId = await SeedProjectAsync();

        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/volunteering/community-projects/{projectId}/support", new { });

        await AuthenticateAsAdminAsync();
        var theirView = await ProjectAsync(projectId);

        theirView.GetProperty("supporter_count").GetInt32().Should().Be(1,
            "the count is the project's, so everyone sees it");
        theirView.GetProperty("has_supported").GetBoolean().Should().BeFalse(
            "but whether YOU backed it is yours alone");
    }

    [Fact]
    public async Task SupportingAProjectThatDoesNotExist_Is404()
    {
        await AuthenticateAsMemberAsync();

        (await Client.PostAsJsonAsync("/api/volunteering/community-projects/2147483600/support", new { }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
