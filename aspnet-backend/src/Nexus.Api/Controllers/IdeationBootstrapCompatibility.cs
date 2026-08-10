// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;

namespace Nexus.Api.Controllers;

internal static class IdeationBootstrapCompatibility
{
    private static readonly DateTime ReviewedAt = new(2026, 7, 8, 0, 0, 0, DateTimeKind.Utc);

    public static readonly IdeationCategoryContract[] Categories =
    [
        new(1, "Community Impact", "community-impact", "Users", "#2563eb", 10, ReviewedAt, ReviewedAt),
        new(2, "Service Improvement", "service-improvement", "Sparkles", "#16a34a", 20, ReviewedAt, ReviewedAt),
        new(3, "Accessibility", "accessibility", "Accessibility", "#7c3aed", 30, ReviewedAt, ReviewedAt)
    ];

    public static readonly IdeationTagContract[] Tags =
    [
        new(1, "community", "community", "general", ReviewedAt, ReviewedAt),
        new(2, "accessibility", "accessibility", "general", ReviewedAt, ReviewedAt),
        new(3, "events", "events", "general", ReviewedAt, ReviewedAt),
        new(4, "volunteering", "volunteering", "skill", ReviewedAt, ReviewedAt),
        new(5, "timebanking", "timebanking", "interest", ReviewedAt, ReviewedAt)
    ];

    public static readonly IdeationPopularTagContract[] PopularTags =
    [
        new("community", 5),
        new("accessibility", 4),
        new("events", 3),
        new("volunteering", 2),
        new("timebanking", 1)
    ];

    public static readonly IdeationTemplateContract[] Templates =
    [
        new(
            1,
            "Community project",
            "Launch a resident-led project with clear community benefit.",
            ["community", "volunteering"],
            1,
            "Community Impact",
            ["impact", "feasibility", "inclusion"],
            "Recognition and practical support for the winning proposal.",
            3,
            new IdeationTemplateCreatorContract(1, "Nexus Admin"),
            ReviewedAt,
            ReviewedAt),
        new(
            2,
            "Service improvement",
            "Collect ideas for improving a platform or local service journey.",
            ["accessibility"],
            2,
            "Service Improvement",
            ["user benefit", "delivery effort", "measurability"],
            "Implementation support for selected improvements.",
            5,
            new IdeationTemplateCreatorContract(1, "Nexus Admin"),
            ReviewedAt,
            ReviewedAt)
    ];

    public static IdeationTemplateContract? FindTemplate(int id) =>
        Templates.FirstOrDefault(template => template.Id == id);

    public static IdeationTemplateDataContract? FindTemplateData(int id)
    {
        var template = FindTemplate(id);
        return template == null
            ? null
            : new IdeationTemplateDataContract(
                template.Title,
                template.Description,
                template.DefaultCategoryId,
                template.DefaultTags,
                template.EvaluationCriteria,
                template.PrizeDescription,
                template.MaxIdeasPerUser);
    }
}

internal sealed record IdeationCategoryContract(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("icon")] string Icon,
    [property: JsonPropertyName("color")] string Color,
    [property: JsonPropertyName("sort_order")] int SortOrder,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime UpdatedAt);

internal sealed record IdeationTagContract(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("tag_type")] string TagType,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime UpdatedAt);

internal sealed record IdeationPopularTagContract(
    [property: JsonPropertyName("tag")] string Tag,
    [property: JsonPropertyName("count")] int Count);

internal sealed record IdeationTemplateCreatorContract(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name);

internal sealed record IdeationTemplateContract(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("default_tags")] string[] DefaultTags,
    [property: JsonPropertyName("default_category_id")] int DefaultCategoryId,
    [property: JsonPropertyName("category_name")] string CategoryName,
    [property: JsonPropertyName("evaluation_criteria")] string[] EvaluationCriteria,
    [property: JsonPropertyName("prize_description")] string PrizeDescription,
    [property: JsonPropertyName("max_ideas_per_user")] int MaxIdeasPerUser,
    [property: JsonPropertyName("creator")] IdeationTemplateCreatorContract Creator,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime UpdatedAt);

internal sealed record IdeationTemplateDataContract(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("category_id")] int CategoryId,
    [property: JsonPropertyName("tags")] string[] Tags,
    [property: JsonPropertyName("evaluation_criteria")] string[] EvaluationCriteria,
    [property: JsonPropertyName("prize_description")] string PrizeDescription,
    [property: JsonPropertyName("max_ideas_per_user")] int MaxIdeasPerUser);
