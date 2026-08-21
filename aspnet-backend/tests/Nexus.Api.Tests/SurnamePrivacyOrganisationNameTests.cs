// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Middleware;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// 🔴 The defect these pin. <see cref="SurnamePrivacyMiddleware"/> rewrites the
/// body of every /api JSON response for a non-admin viewer, and it had no
/// concept of an organisation. An organisation profile carries a composed
/// <c>name</c> alongside <c>first_name</c>/<c>last_name</c>, so the scrubber
/// replaced the organisation's name with its contact's first name:
/// "Bristol Community Trust" was displayed as "Priya".
///
/// Laravel does not do that. At every one of the four projections where it hides
/// a surname it unsets the surname UNCONDITIONALLY, then rewrites the composite
/// <c>name</c> to the first name ONLY when the profile is not an organisation:
///
///   app/Services/UserService.php:147-155
///   app/Http/Controllers/Api/UsersController.php:1583-1592 and :1740-1749
///       unset($profile['last_name']);
///       if (($user->profile_type ?? 'individual') !== 'organisation') {
///           $profile['name'] = $user->first_name ?? '';
///       }
///   app/Http/Controllers/Api/UsersController.php:188-202  (surname only)
///   app/Support/Events/PublicEventProjection.php:112-126
///
/// These are unit tests, not integration tests, on purpose. The middleware is a
/// pure JSON body rewriter, and the only ASP.NET projection that composes an
/// organisation display name today is
/// <c>UsersController.BuildEnrichedUserResponse</c> (UsersController.cs:405),
/// reachable only through <c>/api/users/me</c> and <c>PUT /api/users/me</c> —
/// which the middleware skips as "self". So no HTTP route can currently show a
/// third party an organisation name, and an integration test would pass
/// vacuously. Driving the middleware directly proves the rule itself, and keeps
/// the pin honest for the moment a directory projection is made
/// organisation-aware for Laravel parity (Laravel's already is —
/// UsersController.php:1497).
/// </summary>
public sealed class SurnamePrivacyOrganisationNameTests
{
    private const string ViewerIsSomeoneElse = "99";

    [Fact]
    public async Task AnOrganisationName_IsNotReplacedWithTheContactsFirstName()
    {
        var body = await ScrubAsync(
            "{" +
            "\"id\": 7," +
            "\"email\": \"hello@bristolcommunitytrust.test\"," +
            "\"first_name\": \"Priya\"," +
            "\"last_name\": \"Nandakumar\"," +
            "\"name\": \"Bristol Community Trust\"," +
            "\"profile_type\": \"organisation\"," +
            "\"organization_name\": \"Bristol Community Trust\"" +
            "}");

        body["name"]!.GetValue<string>().Should().Be("Bristol Community Trust",
            "an organisation is not a person — Laravel skips the composite-name "
            + "rewrite when profile_type is 'organisation', so the trust must not "
            + "be renamed after its contact");
        body["organization_name"]!.GetValue<string>().Should().Be("Bristol Community Trust",
            "organization_name is not a composite person name and was never in scope");
        body["last_name"]!.GetValue<string>().Should().BeEmpty(
            "the exemption covers the NAME rewrite only — Laravel still unsets "
            + "last_name on an organisation profile, so it must stay hidden here");
    }

    /// <summary>
    /// The control. If this ever passes with the surname intact, the organisation
    /// exemption has widened into a privacy hole.
    /// </summary>
    [Fact]
    public async Task APersonsName_IsStillCutBackToTheirFirstName()
    {
        var body = await ScrubAsync(
            "{" +
            "\"id\": 7," +
            "\"email\": \"priya@example.test\"," +
            "\"first_name\": \"Priya\"," +
            "\"last_name\": \"Nandakumar\"," +
            "\"name\": \"Priya Nandakumar\"," +
            "\"profile_type\": \"individual\"," +
            "\"organization_name\": null" +
            "}");

        body["name"]!.GetValue<string>().Should().Be("Priya",
            "surname privacy must still apply to an individual profile");
        body["last_name"]!.GetValue<string>().Should().BeEmpty();
    }

    /// <summary>
    /// The deliberate decision for the ABSENT signal, recorded as a test.
    ///
    /// Most ASP.NET projections do not emit profile_type at all. Treating an
    /// unknown profile type as a PERSON is what Laravel itself does
    /// (<c>$u['profile_type'] ?? 'individual'</c>), and it is the
    /// privacy-preserving direction: guessing "organisation" would publish a real
    /// member's surname through a composed name, while guessing "individual"
    /// costs at worst a cosmetically shortened organisation name.
    /// </summary>
    [Fact]
    public async Task WithNoProfileType_TheObjectIsTreatedAsAPerson()
    {
        var body = await ScrubAsync(
            "{" +
            "\"id\": 7," +
            "\"email\": \"priya@example.test\"," +
            "\"first_name\": \"Priya\"," +
            "\"last_name\": \"Nandakumar\"," +
            "\"name\": \"Priya Nandakumar\"" +
            "}");

        body["name"]!.GetValue<string>().Should().Be("Priya",
            "an absent profile_type must default to 'individual', exactly as "
            + "Laravel's `?? 'individual'` does");
        body["last_name"]!.GetValue<string>().Should().BeEmpty();
    }

    /// <summary>
    /// organization_name alone is NOT an organisation signal. Laravel reads
    /// profile_type and nothing else, and organization_name appears on plenty of
    /// non-profile objects in ASP.NET (ShiftManagementController.cs:744-752,
    /// MunicipalityEventsCalendarController.cs:127), so widening the signal would
    /// exempt objects Laravel scrubs.
    /// </summary>
    [Fact]
    public async Task OrganizationNameAlone_DoesNotEarnTheExemption()
    {
        var body = await ScrubAsync(
            "{" +
            "\"id\": 7," +
            "\"email\": \"priya@example.test\"," +
            "\"first_name\": \"Priya\"," +
            "\"last_name\": \"Nandakumar\"," +
            "\"name\": \"Priya Nandakumar\"," +
            "\"organization_name\": \"Bristol Community Trust\"" +
            "}");

        body["name"]!.GetValue<string>().Should().Be("Priya",
            "only profile_type == 'organisation' earns the exemption");
    }

    private static async Task<JsonObject> ScrubAsync(string json)
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, ViewerIsSomeoneElse),
                    new Claim(ClaimTypes.Role, "member"),
                },
                "Test")),
        };
        context.Request.Path = "/api/v2/users/7";

        using var output = new MemoryStream();
        context.Response.Body = output;

        var middleware = new SurnamePrivacyMiddleware(
            async ctx =>
            {
                ctx.Response.ContentType = "application/json";
                var bytes = Encoding.UTF8.GetBytes(json);
                await ctx.Response.Body.WriteAsync(bytes, 0, bytes.Length);
            },
            NullLogger<SurnamePrivacyMiddleware>.Instance);

        await middleware.InvokeAsync(context);

        output.Position = 0;
        var rewritten = await new StreamReader(output, Encoding.UTF8).ReadToEndAsync();
        rewritten.Should().NotBeNullOrWhiteSpace(
            "if the middleware wrote nothing, every assertion below would pass vacuously");

        return JsonNode.Parse(rewritten)!.AsObject();
    }
}
