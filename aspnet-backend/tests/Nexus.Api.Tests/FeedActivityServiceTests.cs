// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

public sealed class FeedActivityContractTests
{
    [Fact]
    public void CanonicalSourceTypes_MatchLaravelAndKeepVolunteerHoursDistinct()
    {
        FeedActivitySourceTypes.All.Should().Equal(
            "post",
            "listing",
            "event",
            "poll",
            "goal",
            "review",
            "job",
            "challenge",
            "volunteer",
            "volunteer_hours",
            "blog",
            "discussion",
            "badge_earned",
            "level_up",
            "course",
            "podcast_show",
            "podcast_episode");
        FeedActivitySourceTypes.VolunteerHours
            .Should().NotBe(FeedActivitySourceTypes.Volunteer);
        FeedActivitySourceTypes.IsSupported("Volunteer_Hours").Should().BeFalse(
            "Laravel source types are exact lowercase values");
    }

    [Fact]
    public void ModelMapping_UsesCanonicalTableColumnsAndTenantSourceUniqueness()
    {
        using var db = CreateRelationalModelDb(tenantId: 42);
        var entity = db.Model.FindEntityType(typeof(FeedActivity));

        entity.Should().NotBeNull();
        var feedEntity = entity!;
        feedEntity.GetTableName().Should().Be("feed_activity");
        feedEntity.FindProperty(nameof(FeedActivity.SourceType))!.GetMaxLength().Should().Be(20);
        feedEntity.FindProperty(nameof(FeedActivity.Title))!.GetMaxLength().Should().Be(500);
        feedEntity.FindProperty(nameof(FeedActivity.ImageUrl))!.GetMaxLength().Should().Be(500);
        feedEntity.FindProperty(nameof(FeedActivity.Metadata))!.GetColumnType().Should().Be("jsonb");
        feedEntity.GetQueryFilter().Should().NotBeNull();

        var sourceKey = feedEntity.GetIndexes().Single(index =>
            index.Properties.Select(property => property.Name).SequenceEqual(
                new[]
                {
                    nameof(FeedActivity.TenantId),
                    nameof(FeedActivity.SourceType),
                    nameof(FeedActivity.SourceId)
                }));
        sourceKey.IsUnique.Should().BeTrue();
        sourceKey.GetDatabaseName().Should().Be("uq_tenant_source");
    }

    [Fact]
    public async Task VolunteerHoursGenericContract_RejectsFreeTextBeforeWriting()
    {
        await using var db = CreateInMemoryDb(tenantId: 42);
        var tenant = new TenantContext();
        tenant.SetTenant(42);
        var service = new FeedActivityService(
            db,
            tenant,
            NullLogger<FeedActivityService>.Instance);

        Func<Task> action = () => service.RecordActivityAsync(
            tenantId: 42,
            userId: 7,
            sourceType: FeedActivitySourceTypes.VolunteerHours,
            sourceId: 99,
            data: new FeedActivityData
            {
                Title = "Safe derived title",
                Content = "Private note intended only for the organisation"
            });

        await action.Should().ThrowAsync<ArgumentException>()
            .WithMessage("*cannot contain free-text content*");
    }

    [Fact]
    public async Task UnsupportedSourceType_MatchesLaravelSilentNoOp()
    {
        await using var db = CreateInMemoryDb(tenantId: 42);
        var tenant = new TenantContext();
        tenant.SetTenant(42);
        var service = new FeedActivityService(
            db,
            tenant,
            NullLogger<FeedActivityService>.Instance);

        await service.RecordActivityAsync(
            tenantId: 42,
            userId: 7,
            sourceType: "not_a_real_type",
            sourceId: 99);

        (await db.FeedActivities.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task ResolvedTenantContext_RejectsCrossTenantWriteBeforeWriting()
    {
        await using var db = CreateInMemoryDb(tenantId: 42);
        var tenant = new TenantContext();
        tenant.SetTenant(42);
        var service = new FeedActivityService(
            db,
            tenant,
            NullLogger<FeedActivityService>.Instance);

        Func<Task> action = () => service.RecordActivityAsync(
            tenantId: 7,
            userId: 8,
            sourceType: FeedActivitySourceTypes.Post,
            sourceId: 9);

        await action.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*does not match the resolved tenant context*");
    }

    private static NexusDbContext CreateInMemoryDb(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new NexusDbContext(options, tenant);
    }

    private static NexusDbContext CreateRelationalModelDb(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql(
                "Host=127.0.0.1;Port=1;Database=nexus_model_only;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, tenant);
    }
}

[Collection("Integration")]
public sealed class FeedActivityServiceIntegrationTests : IntegrationTestBase
{
    public FeedActivityServiceIntegrationTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE feed_activity RESTART IDENTITY");
    }

    [Fact]
    public async Task RecordActivity_UpsertsCanonicalFieldsAndPreservesModerationState()
    {
        using var scope = CreateTenantScope(TestData.Tenant1.Id);
        var service = scope.ServiceProvider.GetRequiredService<FeedActivityService>();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var firstCreatedAt = DateTime.UtcNow.AddMinutes(-5);

        await service.RecordActivityAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            FeedActivitySourceTypes.Post,
            sourceId: 81001,
            new FeedActivityData
            {
                Title = "Original title",
                Content = "Original content",
                ImageUrl = "https://example.test/first.png",
                GroupId = 0,
                Metadata = new Dictionary<string, object?> { ["version"] = 1 },
                CreatedAt = firstCreatedAt
            });

        await db.FeedActivities
            .Where(activity => activity.SourceType == FeedActivitySourceTypes.Post
                && activity.SourceId == 81001)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(activity => activity.IsVisible, false)
                .SetProperty(activity => activity.IsHidden, true));

        var secondCreatedAt = DateTime.UtcNow;
        await service.RecordActivityAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            FeedActivitySourceTypes.Post,
            sourceId: 81001,
            new FeedActivityData
            {
                Title = "Updated title",
                Content = "Updated content",
                ImageUrl = "https://example.test/updated.png",
                GroupId = null,
                Metadata = new Dictionary<string, object?> { ["version"] = 2 },
                CreatedAt = secondCreatedAt
            });

        db.ChangeTracker.Clear();
        var rows = await db.FeedActivities
            .AsNoTracking()
            .Where(activity => activity.SourceType == FeedActivitySourceTypes.Post
                && activity.SourceId == 81001)
            .ToListAsync();

        rows.Should().ContainSingle();
        var row = rows.Single();
        row.TenantId.Should().Be(TestData.Tenant1.Id);
        row.UserId.Should().Be(TestData.AdminUser.Id);
        row.GroupId.Should().BeNull();
        row.Title.Should().Be("Updated title");
        row.Content.Should().Be("Updated content");
        row.ImageUrl.Should().Be("https://example.test/updated.png");
        row.CreatedAt.Should().BeCloseTo(secondCreatedAt, TimeSpan.FromSeconds(1));
        row.IsVisible.Should().BeFalse("Laravel conflict updates preserve hidden visibility state");
        row.IsHidden.Should().BeTrue("Laravel conflict updates preserve moderation state");

        using var metadata = JsonDocument.Parse(row.Metadata!);
        metadata.RootElement.GetProperty("version").GetInt32().Should().Be(2);
    }

    [Fact]
    public async Task RecordVolunteerHours_UsesVolLogSourceAndCannotLeakDescriptionText()
    {
        using var scope = CreateTenantScope(TestData.Tenant1.Id);
        var service = scope.ServiceProvider.GetRequiredService<FeedActivityService>();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        await service.RecordVolunteerHoursAsync(
            tenantId: TestData.Tenant1.Id,
            userId: TestData.MemberUser.Id,
            volunteerLogId: 82001,
            hours: 1.25m,
            organisationId: 42,
            organisationName: "Community Kitchen",
            opportunityId: 314);

        var row = await db.FeedActivities.AsNoTracking().SingleAsync();
        row.SourceType.Should().Be("volunteer_hours");
        row.SourceType.Should().NotBe("volunteer");
        row.SourceId.Should().Be(82001);
        row.Title.Should().Be("Volunteered 1.25 hours");
        row.Content.Should().BeNull();
        row.IsVisible.Should().BeTrue();
        row.IsHidden.Should().BeFalse();

        using var metadata = JsonDocument.Parse(row.Metadata!);
        metadata.RootElement.GetProperty("vol_log_id").GetInt32().Should().Be(82001);
        metadata.RootElement.GetProperty("organization_id").GetInt32().Should().Be(42);
        metadata.RootElement.GetProperty("organization").GetString()
            .Should().Be("Community Kitchen");
        metadata.RootElement.GetProperty("opportunity_id").GetInt32().Should().Be(314);
        metadata.RootElement.GetProperty("hours").GetDecimal().Should().Be(1.25m);
        metadata.RootElement.TryGetProperty("description", out _).Should().BeFalse();

        typeof(FeedActivityService)
            .GetMethod(nameof(FeedActivityService.RecordVolunteerHoursAsync))!
            .GetParameters()
            .Select(parameter => parameter.Name)
            .Should().NotContain(name => name == "description" || name == "content");
    }

    [Fact]
    public async Task SameSourceTuple_IsIndependentPerTenantAndFilteredPerScope()
    {
        using (var tenantOneScope = CreateTenantScope(TestData.Tenant1.Id))
        {
            var service = tenantOneScope.ServiceProvider.GetRequiredService<FeedActivityService>();
            await service.RecordActivityAsync(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                FeedActivitySourceTypes.Listing,
                sourceId: 83001,
                new FeedActivityData { Title = "Tenant one" });
        }

        using (var tenantTwoScope = CreateTenantScope(TestData.Tenant2.Id))
        {
            var service = tenantTwoScope.ServiceProvider.GetRequiredService<FeedActivityService>();
            await service.RecordActivityAsync(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                FeedActivitySourceTypes.Listing,
                sourceId: 83001,
                new FeedActivityData { Title = "Tenant two" });
        }

        using var scopedRead = CreateTenantScope(TestData.Tenant1.Id);
        var db = scopedRead.ServiceProvider.GetRequiredService<NexusDbContext>();
        var visible = await db.FeedActivities.AsNoTracking().ToListAsync();
        var all = await db.FeedActivities.IgnoreQueryFilters().AsNoTracking().ToListAsync();

        visible.Should().ContainSingle();
        visible.Single().Title.Should().Be("Tenant one");
        all.Should().HaveCount(2);
        all.Select(activity => activity.TenantId).Should().BeEquivalentTo(
            new[] { TestData.Tenant1.Id, TestData.Tenant2.Id });
    }

    private IServiceScope CreateTenantScope(int tenantId)
    {
        var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
        return scope;
    }
}
