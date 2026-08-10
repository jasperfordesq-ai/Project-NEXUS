// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class RecurringShiftGenerationTests : IntegrationTestBase
{
    public RecurringShiftGenerationTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task WeeklyPatterns_UseIsoSundayAndEmptyDaysGenerateEveryDay()
    {
        var today = UtcToday();
        int sundayPatternId;
        int emptyPatternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            sundayPatternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "weekly",
                daysOfWeek: "[7]",
                startDate: today.AddDays(-30));
            emptyPatternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "weekly",
                daysOfWeek: null,
                startDate: today.AddDays(-30));
        }

        using (var act = Factory.Services.CreateScope())
        {
            SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
            var service = act.ServiceProvider.GetRequiredService<ShiftManagementService>();
            var sundayExpected = Enumerable.Range(0, 8)
                .Select(today.AddDays)
                .Count(date => date.DayOfWeek == DayOfWeek.Sunday);

            (await service.GenerateOccurrencesAsync(sundayPatternId, 7)).Should().Be(sundayExpected);
            (await service.GenerateOccurrencesAsync(emptyPatternId, 7)).Should().Be(8);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var shifts = await verifyDb.VolunteerShifts
            .IgnoreQueryFilters()
            .Where(shift => shift.RecurringPatternId == sundayPatternId
                || shift.RecurringPatternId == emptyPatternId)
            .OrderBy(shift => shift.StartsAt)
            .Select(shift => new { shift.RecurringPatternId, shift.StartsAt })
            .ToListAsync();

        shifts.Where(shift => shift.RecurringPatternId == sundayPatternId)
            .Select(shift => DateOnly.FromDateTime(shift.StartsAt))
            .Should().OnlyContain(date => date.DayOfWeek == DayOfWeek.Sunday);
        shifts.Where(shift => shift.RecurringPatternId == emptyPatternId)
            .Select(shift => DateOnly.FromDateTime(shift.StartsAt))
            .Should().Equal(Enumerable.Range(0, 8).Select(today.AddDays));
    }

    [Theory]
    [InlineData("[8]")]
    [InlineData("[\"1\"]")]
    public async Task WeeklyPattern_NonEmptyInvalidIsoDaysDoNotCollapseToEveryDay(string daysOfWeek)
    {
        var today = UtcToday();
        int patternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            patternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "weekly",
                daysOfWeek,
                startDate: today.AddDays(-30));
        }

        using var act = Factory.Services.CreateScope();
        SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
        var service = act.ServiceProvider.GetRequiredService<ShiftManagementService>();

        (await service.GenerateOccurrencesAsync(patternId, 7)).Should().Be(0);
    }

    [Theory]
    [InlineData("WEEKLY")]
    [InlineData("quarterly")]
    public async Task ProcessAllPatterns_InvalidFrequencyRecordsPatternError(string frequency)
    {
        var today = UtcToday();
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency,
                daysOfWeek: null,
                startDate: today,
                endDate: today);
        }

        using var act = Factory.Services.CreateScope();
        SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
        var result = await act.ServiceProvider
            .GetRequiredService<ShiftManagementService>()
            .ProcessAllPatternsAsync(daysAhead: 0);

        result.Processed.Should().Be(0);
        result.Generated.Should().Be(0);
        result.Errors.Should().Be(1);
    }

    [Fact]
    public async Task DatabaseConstraint_RejectsNegativeMaxOccurrences()
    {
        var today = UtcToday();
        using var arrange = Factory.Services.CreateScope();
        var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();

        Func<Task> persist = async () =>
        {
            await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "daily",
                daysOfWeek: null,
                startDate: today,
                maxOccurrences: -1);
        };

        await persist.Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task BiweeklyPattern_UsesOriginalAnchorWeekParity()
    {
        var today = UtcToday();
        var isoToday = ToIsoDayOfWeek(today.DayOfWeek);
        int patternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            patternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "biweekly",
                daysOfWeek: $"[{isoToday}]",
                startDate: today.AddDays(-7));
        }

        using (var act = Factory.Services.CreateScope())
        {
            SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
            var service = act.ServiceProvider.GetRequiredService<ShiftManagementService>();
            (await service.GenerateOccurrencesAsync(patternId, 8)).Should().Be(1);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var dates = (await verifyDb.VolunteerShifts
                .IgnoreQueryFilters()
                .Where(shift => shift.RecurringPatternId == patternId)
                .OrderBy(shift => shift.StartsAt)
                .Select(shift => shift.StartsAt)
                .ToListAsync())
            .Select(DateOnly.FromDateTime);

        dates.Should().Equal(today.AddDays(7));
        dates.Should().NotContain(today);
    }

    [Fact]
    public async Task MonthlyDay31Pattern_ClampsToLastValidDayOfShortMonth()
    {
        var today = UtcToday();
        var firstOfCurrentMonth = new DateOnly(today.Year, today.Month, 1);
        var futureMonths = Enumerable.Range(0, 18)
            .Select(firstOfCurrentMonth.AddMonths)
            .ToList();
        var shortMonth = futureMonths.First(month =>
            DateTime.DaysInMonth(month.Year, month.Month) < 31
            && LastDayOfMonth(month) >= today);
        var thirtyOneDayMonth = futureMonths.First(month =>
            DateTime.DaysInMonth(month.Year, month.Month) == 31
            && LastDayOfMonth(month) >= today);
        var shortMonthTarget = LastDayOfMonth(shortMonth);
        var thirtyOneDayTarget = LastDayOfMonth(thirtyOneDayMonth);
        var horizon = Math.Max(
            shortMonthTarget.DayNumber - today.DayNumber,
            thirtyOneDayTarget.DayNumber - today.DayNumber);
        int patternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            patternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "monthly",
                daysOfWeek: null,
                startDate: new DateOnly(today.Year - 1, 1, 31));
        }

        using (var act = Factory.Services.CreateScope())
        {
            SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
            var service = act.ServiceProvider.GetRequiredService<ShiftManagementService>();
            (await service.GenerateOccurrencesAsync(patternId, horizon)).Should().BeGreaterThan(0);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var starts = await verifyDb.VolunteerShifts
            .IgnoreQueryFilters()
            .Where(shift => shift.RecurringPatternId == patternId)
            .Select(shift => shift.StartsAt)
            .ToListAsync();
        var dates = starts.Select(DateOnly.FromDateTime).ToList();

        dates.Should().Contain(shortMonthTarget);
        dates.Should().Contain(thirtyOneDayTarget);
        starts.Where(start => DateOnly.FromDateTime(start) == shortMonthTarget)
            .Should().ContainSingle(start => start.Hour == 9);
    }

    [Fact]
    public async Task Generation_RespectsEndDateMaxOccurrencesAndRetryIsIdempotent()
    {
        var today = UtcToday();
        int endBoundedPatternId;
        int maxBoundedPatternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            endBoundedPatternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "daily",
                daysOfWeek: null,
                startDate: today.AddDays(-10),
                endDate: today.AddDays(1));
            maxBoundedPatternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "daily",
                daysOfWeek: null,
                startDate: today.AddDays(-10),
                maxOccurrences: 2);
        }

        using (var act = Factory.Services.CreateScope())
        {
            SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
            var service = act.ServiceProvider.GetRequiredService<ShiftManagementService>();

            (await service.GenerateOccurrencesAsync(endBoundedPatternId, 10)).Should().Be(2);
            (await service.GenerateOccurrencesAsync(endBoundedPatternId, 10)).Should().Be(0);
            (await service.GenerateOccurrencesAsync(maxBoundedPatternId, 10)).Should().Be(2);
            (await service.GenerateOccurrencesAsync(maxBoundedPatternId, 10)).Should().Be(0);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == endBoundedPatternId))
            .Should().Be(2);
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == maxBoundedPatternId))
            .Should().Be(2);
        var counters = await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .Where(pattern => pattern.Id == endBoundedPatternId || pattern.Id == maxBoundedPatternId)
            .ToDictionaryAsync(pattern => pattern.Id, pattern => pattern.OccurrencesGenerated);
        counters[endBoundedPatternId].Should().Be(2);
        counters[maxBoundedPatternId].Should().Be(2);
    }

    [Fact]
    public async Task ConcurrentGeneration_HasOneWinnerAndAccurateOccurrenceCount()
    {
        var today = UtcToday();
        int patternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            patternId = await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "daily",
                daysOfWeek: null,
                startDate: today,
                maxOccurrences: 1);
        }

        async Task<int> GenerateInIndependentScopeAsync()
        {
            using var scope = Factory.Services.CreateScope();
            SetTenant(scope.ServiceProvider, TestData.Tenant1.Id);
            return await scope.ServiceProvider
                .GetRequiredService<ShiftManagementService>()
                .GenerateOccurrencesAsync(patternId, 0);
        }

        var results = await Task.WhenAll(
            GenerateInIndependentScopeAsync(),
            GenerateInIndependentScopeAsync());

        results.Order().Should().Equal(0, 1);
        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == patternId))
            .Should().Be(1);
        (await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .Where(pattern => pattern.Id == patternId)
            .Select(pattern => pattern.OccurrencesGenerated)
            .SingleAsync())
            .Should().Be(1);
    }

    [Fact]
    public async Task ProcessAllPatterns_UsesCurrentTenantActiveNonEndedPatternsOnly()
    {
        var today = UtcToday();
        int livePatternId;
        int maxedPatternId;
        int inactivePatternId;
        int endedPatternId;
        int otherTenantPatternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            livePatternId = await AddPatternAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "daily", null, today.AddDays(-5));
            maxedPatternId = await AddPatternAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "daily", null, today.AddDays(-5),
                maxOccurrences: 1,
                occurrencesGenerated: 1);
            inactivePatternId = await AddPatternAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "daily", null, today.AddDays(-5),
                isActive: false);
            endedPatternId = await AddPatternAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "daily", null, today.AddDays(-5),
                endDate: today.AddDays(-1));
            otherTenantPatternId = await AddPatternAsync(
                db, TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "daily", null, today.AddDays(-5));
        }

        RecurringShiftGenerationResult result;
        using (var act = Factory.Services.CreateScope())
        {
            SetTenant(act.ServiceProvider, TestData.Tenant1.Id);
            result = await act.ServiceProvider
                .GetRequiredService<ShiftManagementService>()
                .ProcessAllPatternsAsync(daysAhead: 2);
        }

        result.Processed.Should().Be(2, "the active live and already-maxed patterns are both eligible for processing");
        result.Generated.Should().Be(3);
        result.Errors.Should().Be(0);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == livePatternId))
            .Should().Be(3);
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == maxedPatternId
                || shift.RecurringPatternId == inactivePatternId
                || shift.RecurringPatternId == endedPatternId
                || shift.RecurringPatternId == otherTenantPatternId))
            .Should().Be(0);
    }

    [Fact]
    public async Task RegisteredManualJob_GeneratesForActiveTenantsAndPersistsSuccessfulRun()
    {
        var today = UtcToday();
        int firstTenantPatternId;
        int secondTenantPatternId;
        int inactiveTenantPatternId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            firstTenantPatternId = await AddPatternAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "daily", null, today, endDate: today);
            secondTenantPatternId = await AddPatternAsync(
                db, TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "daily", null, today, endDate: today);

            var inactiveTenant = new Tenant
            {
                Slug = $"inactive-recurring-{Guid.NewGuid():N}",
                Name = "Inactive recurring shift tenant",
                IsActive = false,
                CreatedAt = DateTime.UtcNow
            };
            db.Tenants.Add(inactiveTenant);
            await db.SaveChangesAsync();
            var inactiveUser = new User
            {
                TenantId = inactiveTenant.Id,
                Email = $"inactive-recurring-{Guid.NewGuid():N}@test.local",
                PasswordHash = "not-used",
                FirstName = "Inactive",
                LastName = "Tenant",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(inactiveUser);
            await db.SaveChangesAsync();
            inactiveTenantPatternId = await AddPatternAsync(
                db, inactiveTenant.Id, inactiveUser.Id, "daily", null, today, endDate: today);
        }

        var registered = Factory.Services.GetServices<IHostedService>()
            .OfType<VolunteerRecurringShiftGenerationJob>()
            .ToList();
        var job = registered.Should().ContainSingle().Which;
        job.Name.Should().Be("VolunteerRecurringShiftGeneration");
        job.ResolvedInterval.Should().Be(TimeSpan.FromDays(1));

        var run = await job.RunNowAsync();
        run.Outcome.Should().Be(ScheduledJobExecutionOutcome.Success);
        run.Persisted.Should().BeTrue();

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == firstTenantPatternId))
            .Should().Be(1);
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == secondTenantPatternId))
            .Should().Be(1);
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .CountAsync(shift => shift.RecurringPatternId == inactiveTenantPatternId))
            .Should().Be(0);
        var runRow = await verifyDb.ScheduledJobRuns
            .SingleAsync(row => row.Id == run.RunRecordId);
        runRow.JobName.Should().Be("VolunteerRecurringShiftGeneration");
        runRow.Status.Should().Be(ScheduledJobRunStatus.Success);
    }

    [Fact]
    public async Task RegisteredManualJob_WhenPatternGenerationErrors_PersistsFailedRun()
    {
        var today = UtcToday();
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            await AddPatternAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                frequency: "daily",
                daysOfWeek: null,
                startDate: today,
                endDate: today,
                startTime: TimeSpan.FromHours(25));
        }

        var job = Factory.Services.GetServices<IHostedService>()
            .OfType<VolunteerRecurringShiftGenerationJob>()
            .Should().ContainSingle().Which;
        var run = await job.RunNowAsync();

        run.Outcome.Should().Be(ScheduledJobExecutionOutcome.Failed);
        run.Persisted.Should().BeTrue();
        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var runRow = await verifyDb.ScheduledJobRuns
            .SingleAsync(row => row.Id == run.RunRecordId);
        runRow.Status.Should().Be(ScheduledJobRunStatus.Failed);
        runRow.ErrorMessage.Should().NotBeNullOrWhiteSpace();
    }

    private static void SetTenant(IServiceProvider services, int tenantId) =>
        services.GetRequiredService<TenantContext>().SetTenant(tenantId);

    private static DateOnly UtcToday() => DateOnly.FromDateTime(DateTime.UtcNow);

    private static int ToIsoDayOfWeek(DayOfWeek day) =>
        day == DayOfWeek.Sunday ? 7 : (int)day;

    private static DateOnly LastDayOfMonth(DateOnly month) =>
        new(month.Year, month.Month, DateTime.DaysInMonth(month.Year, month.Month));

    private static async Task<int> AddPatternAsync(
        NexusDbContext db,
        int tenantId,
        int createdBy,
        string frequency,
        string? daysOfWeek,
        DateOnly startDate,
        DateOnly? endDate = null,
        int? maxOccurrences = null,
        int occurrencesGenerated = 0,
        bool isActive = true,
        TimeSpan? startTime = null)
    {
        var opportunity = new VolunteerOpportunity
        {
            TenantId = tenantId,
            OrganizerId = createdBy,
            Title = $"Recurring generation {Guid.NewGuid():N}",
            Description = "Recurring shift generation integration test",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 3,
            IsRecurring = true,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();

        var pattern = new RecurringShiftPattern
        {
            TenantId = tenantId,
            OpportunityId = opportunity.Id,
            CreatedBy = createdBy,
            Title = $"Pattern {Guid.NewGuid():N}",
            Frequency = frequency,
            DaysOfWeek = daysOfWeek,
            StartTime = startTime ?? TimeSpan.FromHours(9),
            EndTime = TimeSpan.FromHours(11),
            Capacity = 3,
            StartDate = startDate,
            EndDate = endDate,
            MaxOccurrences = maxOccurrences,
            OccurrencesGenerated = occurrencesGenerated,
            IsActive = isActive,
            CreatedAt = DateTime.UtcNow
        };
        db.RecurringShiftPatterns.Add(pattern);
        await db.SaveChangesAsync();
        return pattern.Id;
    }
}
