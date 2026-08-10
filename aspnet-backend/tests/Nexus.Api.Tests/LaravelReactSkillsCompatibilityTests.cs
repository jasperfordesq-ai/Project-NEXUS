// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactSkillsCompatibilityTests : IntegrationTestBase
{
    public LaravelReactSkillsCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task UserSkillsV2Aliases_AcceptSkillNamePayloadAndReturnLaravelReactListShape()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/users/me/skills", new
        {
            skill_name = "Listening support",
            proficiency_level = "advanced",
            is_offering = true,
            is_requesting = false
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdSkills = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        createdSkills.ValueKind.Should().Be(JsonValueKind.Array);
        var created = createdSkills.EnumerateArray().Single();
        var userSkillId = created.GetProperty("id").GetInt32();
        created.GetProperty("skill_name").GetString().Should().Be("Listening support");
        created.GetProperty("proficiency_level").GetString().Should().Be("advanced");
        created.GetProperty("is_offering").GetBoolean().Should().BeTrue();
        created.GetProperty("is_requesting").GetBoolean().Should().BeFalse();
        created.GetProperty("endorsement_count").GetInt32().Should().Be(0);

        var list = await Client.GetAsync("/api/v2/users/me/skills");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listed = (await list.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single();
        listed.GetProperty("id").GetInt32().Should().Be(userSkillId);
        listed.GetProperty("skill_name").GetString().Should().Be("Listening support");

        var update = await Client.PutAsJsonAsync($"/api/v2/users/me/skills/{userSkillId}", new
        {
            proficiency_level = "expert",
            is_requesting = true
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single();
        updated.GetProperty("id").GetInt32().Should().Be(userSkillId);
        updated.GetProperty("proficiency_level").GetString().Should().Be("expert");

        var remove = await Client.DeleteAsync($"/api/v2/users/me/skills/{userSkillId}");

        remove.StatusCode.Should().Be(HttpStatusCode.OK);
        var removeData = (await remove.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        removeData.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var afterRemove = await Client.GetAsync("/api/v2/users/me/skills");

        afterRemove.StatusCode.Should().Be(HttpStatusCode.OK);
        (await afterRemove.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Should()
            .BeEmpty();
    }
}
