// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Regression tests for GET /api/v2/connections/suggestions.
 *
 * 🔴 WHY THIS FILE EXISTS. The action was
 * `Ok(new { data = await _db.Users...ToListAsync() })` — the whole User entity,
 * to any signed-in ordinary member. Verified live on 2026-08-17: every suggested
 * member carried `passwordHash` (a bcrypt hash, crackable offline),
 * `totpSecretEncrypted` (the second factor), `emailVerificationCode`, `email`,
 * every admin flag and `suspensionReason`.
 *
 * The defect class is returning an EF entity directly: the response then publishes
 * whatever the entity happens to hold, so the disclosure GROWS SILENTLY every time
 * a column is added. `users/search` had already taught this once. The first test
 * below therefore asserts on the FULL response text rather than on named fields
 * only, so a future column cannot leak past it.
 *
 * The shape assertions come from the live Laravel and from
 * app/Http/Controllers/Api/ConnectionSuggestionController.php, not from this
 * backend's previous behaviour — ~122 tests in this suite were once named for
 * Laravel parity while pinning ASP.NET's own shape.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ConnectionSuggestionsDisclosureTests : IntegrationTestBase
{
    public ConnectionSuggestionsDisclosureTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/v2/connections/suggestions";

    /// <summary>
    /// Field names that must never appear anywhere in this response. Asserted
    /// against the raw JSON text, so a nested object or a newly added entity
    /// column cannot slip through a property-by-property check.
    /// </summary>
    private static readonly string[] MustNeverAppear =
    {
        "passwordHash", "password_hash",
        "totpSecret", "totp_secret",
        "emailVerificationCode", "email_verification_code",
        "authenticationInvalidatedAt",
        "suspensionReason", "suspension_reason",
        "isSuperAdmin", "is_super_admin",
        "isTenantSuperAdmin", "isGod", "is_god",
        "notificationPreferences",
        "email",
    };

    [Fact]
    public async Task Suggestions_NeverExposeCredentialsOrPrivateUserColumns()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(Path);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var raw = await response.Content.ReadAsStringAsync();

        foreach (var forbidden in MustNeverAppear)
        {
            raw.Should().NotContain(
                forbidden,
                $"'{forbidden}' is a private user column and this endpoint is readable by any signed-in "
                + "member; it leaked here because the action serialised the User entity directly");
        }
    }

    [Fact]
    public async Task Suggestions_UseTheLaravelEnvelopeAndFieldSet()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(Path);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        // 🔴 `data` is an OBJECT holding `suggestions`, NOT a bare list. Laravel
        // answers through respondWithData(['suggestions' => …]), so a client
        // reading data[0] finds nothing on the production backend.
        body.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Object, "Laravel wraps these in data.suggestions");

        data.TryGetProperty("suggestions", out var suggestions).Should().BeTrue();
        suggestions.ValueKind.Should().Be(JsonValueKind.Array);

        // The demo seed has several other members, so this must not be empty —
        // an empty list would make the row assertions below pass vacuously.
        suggestions.EnumerateArray().Should().NotBeEmpty(
            "the demo tenant has other active members, so there is something to suggest");

        var expected = new[]
        {
            "id", "name", "avatar_url", "bio",
            "mutual_connections_count", "shared_skills", "connection_status",
        };

        foreach (var row in suggestions.EnumerateArray())
        {
            row.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                expected,
                "Laravel sends exactly these seven keys — extra keys are how the "
                + "entity-serialisation leak got in, and missing keys break the card");

            row.GetProperty("name").ValueKind.Should().Be(
                JsonValueKind.String, "Laravel emits `$candidate->name ?: ''`, never null");
            row.GetProperty("shared_skills").ValueKind.Should().Be(JsonValueKind.Array);

            // Laravel hard-codes both of these (ConnectionSuggestionController.php:227,229).
            row.GetProperty("mutual_connections_count").GetInt32().Should().Be(0);
            row.GetProperty("connection_status").GetString().Should().Be("none");
        }
    }

    [Fact]
    public async Task Suggestions_HonourTheLaravelLimitDefaultAndCeiling()
    {
        await AuthenticateAsMemberAsync();

        // Laravel: queryInt('limit', 5, 1, 20) — default 5, clamped to 1..20.
        // A limit above the ceiling clamps rather than erroring, and a nonsense
        // value falls back to the default rather than returning everything.
        foreach (var (query, ceiling) in new[] { ("", 5), ("?limit=2", 2), ("?limit=999", 20), ("?limit=abc", 5) })
        {
            var response = await Client.GetAsync($"{Path}{query}");
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"limit query '{query}' must not error");

            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("data").GetProperty("suggestions").GetArrayLength()
                .Should().BeLessThanOrEqualTo(ceiling, $"limit query '{query}' must clamp to {ceiling}");
        }
    }

    [Fact]
    public async Task Suggestions_RejectAnonymousCallers()
    {
        ClearAuthToken();

        var response = await Client.GetAsync(Path);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "this returns member profiles, so it must stay behind the login on both backends");
    }
}
