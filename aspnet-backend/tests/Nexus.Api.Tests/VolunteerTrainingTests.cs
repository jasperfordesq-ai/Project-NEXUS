// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Volunteer training.
///
/// 🔴 The endpoint returned an empty array while both tables were mapped and
/// migrated. A volunteer saw no training at all — including anything marked
/// REQUIRED — and nobody could tell who had completed what.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerTrainingTests : IntegrationTestBase
{
    public VolunteerTrainingTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<(int RequiredId, int OptionalId)> SeedCoursesAsync(bool completeRequired)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var required = new VolunteerTrainingCourse
        {
            TenantId = TestData.Tenant1.Id,
            Title = $"Safeguarding basics {Guid.NewGuid():N}"[..28],
            Description = "Required before working with young people",
            DurationMinutes = 45,
            IsRequired = true,
            Active = true,
        };
        var optional = new VolunteerTrainingCourse
        {
            TenantId = TestData.Tenant1.Id,
            Title = $"Optional first aid {Guid.NewGuid():N}"[..26],
            DurationMinutes = 90,
            IsRequired = false,
            Active = true,
        };
        var inactive = new VolunteerTrainingCourse
        {
            TenantId = TestData.Tenant1.Id,
            Title = "Retired course",
            DurationMinutes = 10,
            Active = false,
        };
        db.VolunteerTrainingCourses.AddRange(required, optional, inactive);
        await db.SaveChangesAsync();

        if (completeRequired)
        {
            db.VolunteerTrainingCompletions.Add(new VolunteerTrainingCompletion
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                CourseId = required.Id,
                CompletedAt = DateTime.UtcNow.AddDays(-3),
                Score = 88,
            });
            await db.SaveChangesAsync();
        }

        return (required.Id, optional.Id);
    }

    [Fact]
    public async Task TrainingCourses_AreListed_WithCompletionState()
    {
        var (requiredId, optionalId) = await SeedCoursesAsync(completeRequired: true);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/volunteering/training");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = (await response.Content.ReadFromJsonAsync<JsonElement>())
            // 🔴 Laravel wraps these in `data.items` with cursor pagination beside
            // them — verified live: {"data":{"items":[…],"cursor":null,
            // "has_more":false}} — not a bare list under `data`. This backend
            // returned the bare list until 2026-08-17, so a client looping over
            // `data` got nothing from the production backend.
            .GetProperty("data").GetProperty("items").EnumerateArray().ToList();

        var required = items.Single(x => x.GetProperty("id").GetInt32() == requiredId);
        required.GetProperty("is_required").GetBoolean().Should().BeTrue();
        required.GetProperty("completed").GetBoolean().Should().BeTrue(
            "the volunteer has completed it and must be able to see that");
        required.GetProperty("score").GetInt32().Should().Be(88);

        var optional = items.Single(x => x.GetProperty("id").GetInt32() == optionalId);
        optional.GetProperty("completed").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task RetiredCourses_AreNotOffered()
    {
        await SeedCoursesAsync(completeRequired: false);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/volunteering/training");
        var raw = await response.Content.ReadAsStringAsync();

        raw.Should().NotContain("Retired course",
            "an inactive course must not be presented as available");
    }

    [Fact]
    public async Task AnotherVolunteersCompletion_DoesNotShowAsMine()
    {
        var (requiredId, _) = await SeedCoursesAsync(completeRequired: false);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.VolunteerTrainingCompletions.Add(new VolunteerTrainingCompletion
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                CourseId = requiredId,
                CompletedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/volunteering/training");
        var items = (await response.Content.ReadFromJsonAsync<JsonElement>())
            // 🔴 Laravel wraps these in `data.items` with cursor pagination beside
            // them — verified live: {"data":{"items":[…],"cursor":null,
            // "has_more":false}} — not a bare list under `data`. This backend
            // returned the bare list until 2026-08-17, so a client looping over
            // `data` got nothing from the production backend.
            .GetProperty("data").GetProperty("items").EnumerateArray().ToList();

        items.Single(x => x.GetProperty("id").GetInt32() == requiredId)
            .GetProperty("completed").GetBoolean().Should().BeFalse(
                "completion is per volunteer — showing someone else's would be worse than showing none");
    }
}
