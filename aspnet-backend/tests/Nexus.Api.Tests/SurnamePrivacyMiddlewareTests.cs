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

    /// <summary>
    /// 🔴 The money-path defect. The wallet recipient search returned
    /// last_name:"" and name:"Maya", so the credit-transfer confirmation card
    /// could not identify who was about to receive the credits.
    ///
    /// Laravel does not hide the surname here. WalletService::searchUsers
    /// (app/Services/WalletService.php:868-907) selects and returns first_name,
    /// last_name and a composed name with no viewer check, because Laravel
    /// applies surname privacy at four member-DISCOVERY projections only — the
    /// public profile, the member search and the member directory (plus public
    /// events) — and deliberately not to the transfer recipient picker.
    ///
    /// The React transfer flow composes the label client-side from
    /// first_name + last_name (TransferModal.tsx:330, 336, 414, 419 and the
    /// confirm step at 518), so a blanked surname is visible to the member.
    /// </summary>
    [Fact]
    public async Task WalletRecipientSearch_KeepsTheSurname_SoTheRecipientCanBeIdentified()
    {
        // Distinctive strings so no assertion can match unrelated JSON.
        await SeedMembersAsync(1, "Maya", _ => "Quibblesworth");
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/wallet/user-search?q=Maya");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        body.Should().Contain("Maya",
            "if the search returned nobody, every assertion below would pass "
            + "without testing anything");
        body.Should().Contain("Quibblesworth",
            "Laravel returns the real surname on this endpoint — a member about "
            + "to send time credits must be able to tell two people with the "
            + "same first name apart");
        body.Should().NotContain("\"last_name\":\"\"",
            "the surname middleware blanked last_name on the money path");
        body.Should().Contain("Maya Quibblesworth",
            "the composed `name` is what the mobile client renders, and it was "
            + "being cut down to the first name");
    }

    /// <summary>
    /// The control for the exemption above. Exempting the wallet picker must not
    /// switch surname privacy off, and must not leak to endpoints that only look
    /// similar. The member directory is one of the projections Laravel really
    /// does scrub (UsersController.php:1583-1592 and 1740-1749), so it must
    /// still scrub here.
    /// </summary>
    [Fact]
    public async Task MemberDirectory_StillHidesTheSurname_AfterTheWalletExemption()
    {
        await SeedMembersAsync(1, "Thessaly", _ => "Wintergreen");
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/users?limit=100");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        body.Should().Contain("Thessaly",
            "if the directory did not list the seeded member, the privacy "
            + "assertion below would pass vacuously");
        body.Should().NotContain("Wintergreen",
            "the wallet exemption must be exact — the member directory is a "
            + "discovery surface Laravel does scrub, so it must stay scrubbed");
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
