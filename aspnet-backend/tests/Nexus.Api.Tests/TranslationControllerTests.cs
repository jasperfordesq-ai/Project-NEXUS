// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for Translation/i18n endpoints.
/// </summary>
[Collection("Integration")]
public class TranslationControllerTests : IntegrationTestBase
{
    public TranslationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetLocales_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/i18n/locales");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task GetTranslations_ForLocale_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/i18n/translations/en");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetMyLocale_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/i18n/my-locale");

        // Could be 200 (locale set) or 404 (no locale set)
        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task SetMyLocale_ValidLocale_Succeeds()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync("/api/i18n/my-locale", new
        {
            locale = "en"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminCreateTranslation_AsAdmin_Succeeds()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/admin/i18n/translations", new
        {
            locale = "en",
            key = "test.greeting",
            value = "Hello!"
        });

        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task AdminCreateTranslation_AsMember_Fails()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/admin/i18n/translations", new
        {
            locale = "en",
            key = "test.key",
            value = "test"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminAddLocale_AsAdmin_Succeeds()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/admin/i18n/locales", new
        {
            locale = "ga",
            name = "Irish",
            native_name = "Gaeilge",
            is_default = false
        });

        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }
}
