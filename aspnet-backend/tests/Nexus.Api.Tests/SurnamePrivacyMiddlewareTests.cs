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
/// SurnamePrivacyMiddleware rewrites the body of every JSON response on /api,
/// and had no tests of any kind until 2026-08-16.
///
/// 🔴 The bug these pin. The middleware decides an object is a person when it
/// carries a composite `name` next to an "avatar/email/handle" signal, and then
/// chops that name at the first space so a surname cannot leak. A group
/// conversation carries both `name` and `avatar_url`, so the group list renamed
/// "Alpha Bravo Charlie" to "Alpha". The stored value, the SQL, and the create
/// response were all correct — only the listed name was wrong, which is why it
/// read as a truncation bug somewhere near the database.
///
/// Two accidents hid it: the create response carries no avatar_url, so it looked
/// right; and a group whose conversation id happens to equal the viewer's user
/// id is treated as "self" and passes through untouched, so some groups listed
/// correctly and some did not.
///
/// The second test is the control. Vetoing the heuristic must not switch the
/// privacy feature off, so it asserts a real surname is still hidden — and first
/// asserts the record was actually in the response, because a search that
/// returns nothing would make the privacy assertion pass vacuously.
/// </summary>
[Collection("Integration")]
public sealed class SurnamePrivacyMiddlewareTests : IntegrationTestBase
{
    public SurnamePrivacyMiddlewareTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task AGroupName_IsNotChoppedAtTheFirstSpace()
    {
        var members = await SeedMembersAsync(3, "Group", i => $"Member{i}");
        await AuthenticateAsMemberAsync();

        var created = await Client.PostAsJsonAsync("/api/v2/conversations/groups", new
        {
            name = "Alpha Bravo Charlie",
            member_ids = members,
        });
        created.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await Client.GetAsync("/api/v2/conversations/groups");
        var body = await list.Content.ReadAsStringAsync();

        body.Should().Contain("Alpha Bravo Charlie",
            "a group is not a person — its name must survive the surname scrubber intact");
        body.Should().NotContain("\"name\":\"Alpha\"",
            "the middleware treated `name` + `avatar_url` as a member and hid the "
            + "non-existent surname by cutting everything after the first space");
    }

    [Fact]
    public async Task AMembersSurname_IsStillHiddenFromOtherMembers()
    {
        // Distinctive strings so neither assertion can match unrelated JSON.
        await SeedMembersAsync(1, "Zephyrine", _ => "Quibblesworth");
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/members?q=Zephyrine");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        body.Should().Contain("Zephyrine",
            "if the search returned nobody, the privacy assertion below would pass "
            + "without testing anything");
        body.Should().NotContain("Quibblesworth",
            "vetoing the user-shape heuristic must not switch surname privacy off");
    }

    private async Task<int[]> SeedMembersAsync(int count, string firstName, Func<int, string> lastName)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var ids = new List<int>();
        for (var i = 0; i < count; i++)
        {
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"surname-privacy-{Guid.NewGuid():N}@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = firstName,
                LastName = lastName(i),
                Role = "member",
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            ids.Add(user.Id);
        }
        return ids.ToArray();
    }
}
