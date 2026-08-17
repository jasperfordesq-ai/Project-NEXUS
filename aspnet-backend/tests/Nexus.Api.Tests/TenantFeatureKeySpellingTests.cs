// Copyright (c) 2024-2026 Jasper Ford
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
using Nexus.Api.Support;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the fix for a split that made a community's feature switches invisible
/// to half the backend.
///
/// 🔴 What went wrong. Tenant feature flags live in <c>tenant_configs</c>, and
/// this backend had grown TWO spellings for the same flag:
/// <c>features.{flag}</c>, written by the seeders and read by the gates that
/// enforce access, and <c>feature.{flag}</c>, read by
/// <c>/api/v2/tenant/bootstrap</c> for all forty flags it publishes.
///
/// Bootstrap is how the React frontend learns which features a community has.
/// So the switch and the display were reading different rows. Reproduced on the
/// running dev API before the fix: with <c>features.public_events = true</c>
/// stored, <c>GET /api/v2/public/events</c> returned 200 while the same
/// tenant's bootstrap reported <c>public_events = false</c> — the backend
/// serving a feature the frontend had been told did not exist. The reverse is
/// worse: switching a default-on feature OFF left the frontend advertising it
/// and sending members to a screen the backend refuses.
///
/// These tests assert that BOTH spellings are honoured, in both directions, so
/// no stored value is silently discarded. They are written against
/// <c>/tenant/bootstrap</c> because that is the surface the frontend reads and
/// the one that was wrong.
/// </summary>
[Collection("Integration")]
public class TenantFeatureKeySpellingTests : IntegrationTestBase
{
    public TenantFeatureKeySpellingTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Theory]
    [InlineData("features.explore")] // canonical — what seeders and gates write
    [InlineData("feature.explore")]  // legacy — still present in stored rows
    public async Task Bootstrap_HonoursFeatureFlag_UnderEitherStoredSpelling(string storedKey)
    {
        await WithStoredFlagAsync(storedKey, "false", async () =>
        {
            ClearAuthToken();
            var response = await Client.GetAsync("/api/tenant/bootstrap?slug=test-tenant");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var content = await response.Content.ReadFromJsonAsync<JsonElement>();

            content.GetProperty("features").GetProperty("explore").GetBoolean()
                .Should().BeFalse(
                    "a community that switched `explore` off must be reported off to the "
                    + "frontend whichever spelling the row was stored under — reading only "
                    + $"one meant '{storedKey}' was silently ignored");
        });
    }

    [Fact]
    public async Task Bootstrap_PrefersCanonicalSpelling_WhenBothRowsExist()
    {
        // A tenant carrying both rows is the realistic migration state. The
        // canonical spelling is the one new writes use, so it must win.
        await WithStoredFlagAsync("feature.explore", "true", async () =>
        {
            await WithStoredFlagAsync("features.explore", "false", async () =>
            {
                ClearAuthToken();
                var response = await Client.GetAsync("/api/tenant/bootstrap?slug=test-tenant");

                response.StatusCode.Should().Be(HttpStatusCode.OK);
                var content = await response.Content.ReadFromJsonAsync<JsonElement>();
                content.GetProperty("features").GetProperty("explore").GetBoolean()
                    .Should().BeFalse("the canonical `features.` row is authoritative");
            });
        });
    }

    [Fact]
    public void TenantFeatureKeys_ReadsCanonicalFirst_ThenLegacy_ThenDefault()
    {
        var canonicalOnly = new Dictionary<string, string> { ["features.demo"] = "true" };
        var legacyOnly = new Dictionary<string, string> { ["feature.demo"] = "true" };
        var both = new Dictionary<string, string>
        {
            ["features.demo"] = "false",
            ["feature.demo"] = "true"
        };

        TenantFeatureKeys.Read(canonicalOnly, "demo", false).Should().BeTrue();
        TenantFeatureKeys.Read(legacyOnly, "demo", false).Should().BeTrue();
        TenantFeatureKeys.Read(both, "demo", true).Should().BeFalse("canonical wins");
        TenantFeatureKeys.Read(new Dictionary<string, string>(), "demo", true).Should().BeTrue("falls back");

        // A blank stored value is "unset", not "off" — otherwise an empty row
        // would silently turn a default-on feature off.
        var blank = new Dictionary<string, string> { ["features.demo"] = "  " };
        TenantFeatureKeys.Read(blank, "demo", true).Should().BeTrue();
    }

    /// <summary>
    /// Stores <paramref name="key"/> = <paramref name="value"/> for the test
    /// tenant, runs the assertion, then restores exactly what was there before.
    /// </summary>
    private async Task WithStoredFlagAsync(string key, string value, Func<Task> assert)
    {
        string? originalValue = null;
        bool existedBefore;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var existing = await db.TenantConfigs.IgnoreQueryFilters().FirstOrDefaultAsync(
                config => config.TenantId == TestData.Tenant1.Id && config.Key == key);

            existedBefore = existing is not null;
            originalValue = existing?.Value;

            if (existing is null)
            {
                db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = key,
                    Value = value
                });
            }
            else
            {
                existing.Value = value;
                existing.UpdatedAt = DateTime.UtcNow;
            }

            await db.SaveChangesAsync();
        }

        try
        {
            await assert();
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.TenantConfigs.IgnoreQueryFilters().SingleAsync(
                config => config.TenantId == TestData.Tenant1.Id && config.Key == key);

            if (!existedBefore)
            {
                db.TenantConfigs.Remove(stored);
            }
            else
            {
                stored.Value = originalValue!;
                stored.UpdatedAt = DateTime.UtcNow;
            }

            await db.SaveChangesAsync();
        }
    }
}
