// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for the GROUPED help-FAQ contract.
///
/// 🔴 WHY THIS EXISTS. This endpoint returned FLAT rows
/// (`[{id, category, question, answer}]`) while Laravel's `HelpService::getFaqs`
/// returns groups (`[{category, faqs: [{id, question, answer}]}]`) — and BOTH
/// frontends consume the grouped shape: web-uk reads `row.faqs` and filters out
/// groups with none (`support.js:44-57`), React types it as `FaqGroup[]`
/// (`HelpCenterPage.tsx:44-47`). Result: every FAQ silently vanished from the help
/// page on both frontends while the endpoint answered 200 with well-formed rows.
/// Found by the committed web-uk page-pair instrument on its FIRST run — the manual
/// page comparison had missed it.
/// </summary>
[Collection("Integration")]
public sealed class HelpFaqsGroupedContractTests : IntegrationTestBase
{
    public HelpFaqsGroupedContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task SeedFaqsAsync()
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        if (db.Faqs.Any(f => f.Question == "Grouped contract probe A"))
        {
            return;
        }

        db.Faqs.AddRange(
            new Faq
            {
                TenantId = TestData.Tenant1.Id,
                Category = "Getting started",
                Question = "Grouped contract probe A",
                Answer = "First answer",
                SortOrder = 2,
                IsPublished = true,
            },
            new Faq
            {
                TenantId = TestData.Tenant1.Id,
                Category = "Getting started",
                Question = "Grouped contract probe B",
                Answer = "Second answer",
                SortOrder = 1,
                IsPublished = true,
            },
            new Faq
            {
                TenantId = TestData.Tenant1.Id,
                Category = "Security",
                Question = "Grouped contract probe C",
                Answer = "Security answer",
                SortOrder = 1,
                IsPublished = true,
            },
            new Faq
            {
                TenantId = TestData.Tenant1.Id,
                Category = "Security",
                Question = "Unpublished probe never appears",
                Answer = "Hidden",
                SortOrder = 0,
                IsPublished = false,
            });
        await db.SaveChangesAsync();
    }

    private async Task<JsonDocument> GetAsync(string path)
    {
        using var response = await Client.GetAsync(path);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/api/help/faqs")]
    [InlineData("/api/v2/help/faqs")]
    public async Task Faqs_are_grouped_by_category_with_the_keys_both_frontends_read(string path)
    {
        await AuthenticateAsMemberAsync();
        await SeedFaqsAsync();

        using var document = await GetAsync(path);
        var groups = document.RootElement.GetProperty("data").EnumerateArray().ToList();
        groups.Should().NotBeEmpty();

        foreach (var group in groups)
        {
            // The exact group keys Laravel emits — a flat row here re-breaks both frontends.
            group.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(new[] { "category", "faqs" });
            foreach (var faq in group.GetProperty("faqs").EnumerateArray())
            {
                faq.EnumerateObject().Select(p => p.Name)
                    .Should().BeEquivalentTo(new[] { "id", "question", "answer" });
            }
        }

        var gettingStarted = groups.Single(g => g.GetProperty("category").GetString() == "Getting started");
        var questions = gettingStarted.GetProperty("faqs").EnumerateArray()
            .Select(f => f.GetProperty("question").GetString())
            .Where(t => t!.StartsWith("Grouped contract probe", StringComparison.Ordinal))
            .ToList();
        questions.Should().ContainInOrder("Grouped contract probe B", "Grouped contract probe A");

        var allQuestions = groups.SelectMany(g => g.GetProperty("faqs").EnumerateArray())
            .Select(f => f.GetProperty("question").GetString()).ToList();
        allQuestions.Should().NotContain("Unpublished probe never appears");
    }

    [Fact]
    public async Task Q_filters_on_question_and_answer_text()
    {
        await AuthenticateAsMemberAsync();
        await SeedFaqsAsync();

        using var document = await GetAsync("/api/v2/help/faqs?q=" + Uri.EscapeDataString("Security answer"));
        var groups = document.RootElement.GetProperty("data").EnumerateArray().ToList();

        groups.Should().HaveCount(1);
        groups[0].GetProperty("category").GetString().Should().Be("Security");
    }

    [Fact]
    public async Task Category_id_matches_the_category_varchar_exactly_as_laravel_does()
    {
        // 🔴 Laravel's parameter is NAMED category_id but is matched against the CATEGORY
        // string ("help_faqs has no category_id column", HelpService.php:30-33). Renaming
        // or int-parsing it here would be a divergence.
        await AuthenticateAsMemberAsync();
        await SeedFaqsAsync();

        using var document = await GetAsync("/api/v2/help/faqs?category_id=Security");
        var groups = document.RootElement.GetProperty("data").EnumerateArray().ToList();

        groups.Should().HaveCount(1);
        groups[0].GetProperty("category").GetString().Should().Be("Security");
        groups[0].GetProperty("faqs").GetArrayLength().Should().Be(1, "the unpublished row stays hidden");
    }
}
