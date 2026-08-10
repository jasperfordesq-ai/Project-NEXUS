// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Phase 73 follow-up — tests for the 5 new scheduled hosted services added
/// after the 2026-05-11 production-readiness audit:
///   - JobVacancyExpiryJob
///   - FeaturedExpiryJob
///   - ListingExpiryJob
///   - OnboardingNurtureJob
///   - ExpiredTokenCleanupJob
///
/// Pattern mirrors Phase63ScheduledJobsTests: a test-only subclass exposes the
/// protected per-tenant / global tick, and we verify observable side effects
/// (state change + notification creation) plus idempotency on a second run.
/// </summary>
[Collection("Integration")]
public class Phase73NewScheduledJobsTests : IntegrationTestBase
{
    private readonly HashSet<int> _syntheticPlatformSuperAdminIds = [];

    public Phase73NewScheduledJobsTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_syntheticPlatformSuperAdminIds.Count > 0)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.RefreshTokens
                    .IgnoreQueryFilters()
                    .Where(token => _syntheticPlatformSuperAdminIds.Contains(token.UserId))
                    .ExecuteDeleteAsync();
                await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => _syntheticPlatformSuperAdminIds.Contains(user.Id))
                    .ExecuteDeleteAsync();
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    // ─── Test-only subclasses ──────────────────────────────────────────────

    private sealed class TestableJobVacancyExpiryJob : JobVacancyExpiryJob
    {
        public TestableJobVacancyExpiryJob(IServiceScopeFactory s, IConfiguration c, ILogger<JobVacancyExpiryJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableFeaturedExpiryJob : FeaturedExpiryJob
    {
        public TestableFeaturedExpiryJob(IServiceScopeFactory s, IConfiguration c, ILogger<FeaturedExpiryJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableListingExpiryJob : ListingExpiryJob
    {
        public TestableListingExpiryJob(IServiceScopeFactory s, IConfiguration c, ILogger<ListingExpiryJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableOnboardingNurtureJob : OnboardingNurtureJob
    {
        public TestableOnboardingNurtureJob(IServiceScopeFactory s, IConfiguration c, ILogger<OnboardingNurtureJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableExpiredTokenCleanupJob : ExpiredTokenCleanupJob
    {
        public TestableExpiredTokenCleanupJob(IServiceScopeFactory s, IConfiguration c, ILogger<ExpiredTokenCleanupJob> l) : base(s, c, l) { }
        public Task RunGlobalPublic(IServiceProvider sp, CancellationToken ct = default) => RunGlobalAsync(sp, ct);
    }

    private sealed class ThrowingManualJob : ScheduledHostedService
    {
        public ThrowingManualJob(
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration,
            ILogger<ThrowingManualJob> logger)
            : base(scopeFactory, configuration, logger) { }

        protected override string JobName => "ManualFailureProbe";
        protected override TimeSpan DefaultInterval => TimeSpan.FromDays(1);
        protected override bool PerTenant => false;

        protected override Task RunGlobalAsync(IServiceProvider services, CancellationToken ct) =>
            throw new InvalidOperationException("intentional manual scheduled-job failure");
    }

    private sealed class BlockingScheduledJob : ScheduledHostedService
    {
        private readonly TaskCompletionSource<bool> _entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _bodyCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly object _concurrencyLock = new();
        private int _active;

        public BlockingScheduledJob(
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration,
            ILogger<BlockingScheduledJob> logger)
            : base(scopeFactory, configuration, logger) { }

        protected override string JobName => "ManualConcurrencyProbe";
        protected override TimeSpan DefaultInterval => TimeSpan.FromDays(1);
        protected override TimeSpan StartupDelay => TimeSpan.Zero;
        protected override bool PerTenant => false;

        public Task Entered => _entered.Task;
        public Task BodyCompleted => _bodyCompleted.Task;
        public int MaxConcurrent { get; private set; }
        public void Release() => _release.TrySetResult(true);

        protected override async Task RunGlobalAsync(IServiceProvider services, CancellationToken ct)
        {
            var active = Interlocked.Increment(ref _active);
            lock (_concurrencyLock)
                MaxConcurrent = Math.Max(MaxConcurrent, active);
            _entered.TrySetResult(true);
            try
            {
                await _release.Task.WaitAsync(ct);
            }
            finally
            {
                Interlocked.Decrement(ref _active);
                _bodyCompleted.TrySetResult(true);
            }
        }
    }

    private sealed class TenantRecordingJob : ScheduledHostedService
    {
        public TenantRecordingJob(
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration,
            ILogger<TenantRecordingJob> logger)
            : base(scopeFactory, configuration, logger) { }

        protected override string JobName => "ActiveTenantProbe";
        protected override TimeSpan DefaultInterval => TimeSpan.FromDays(1);
        public List<int> VisitedTenantIds { get; } = [];

        protected override Task RunForTenantAsync(
            IServiceProvider services,
            int tenantId,
            CancellationToken ct)
        {
            VisitedTenantIds.Add(tenantId);
            return Task.CompletedTask;
        }
    }

    // ─── 1. JobVacancyExpiryJob ────────────────────────────────────────────

    [Fact]
    public async Task JobVacancyExpiry_PastExpiresAt_MarkedExpired()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = "Already expired",
            Category = "Test",
            Status = "active",
            ExpiresAt = DateTime.UtcNow.AddDays(-1),
            CreatedAt = DateTime.UtcNow.AddDays(-30)
        };
        arrangeDb.JobVacancies.Add(job);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableJobVacancyExpiryJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.JobVacancies.IgnoreQueryFilters().FirstAsync(j => j.Id == job.Id);
        refreshed.Status.Should().Be("expired");
    }

    [Fact]
    public async Task JobVacancyExpiry_OneDayWindow_CreatesReminderOnce()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = "Closing tomorrow",
            Category = "Test",
            Status = "active",
            ExpiresAt = DateTime.UtcNow.AddHours(20),
            CreatedAt = DateTime.UtcNow.AddDays(-5)
        };
        arrangeDb.JobVacancies.Add(job);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableJobVacancyExpiryJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id); // idempotent: second run must not double-send

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var notes = await assertDb.Notifications.IgnoreQueryFilters()
            .Where(n => n.TenantId == TestData.Tenant1.Id
                && n.UserId == TestData.AdminUser.Id
                && n.Type == "job_vacancy_expiring"
                && n.Data!.Contains($"\"job_id\":{job.Id}"))
            .CountAsync();
        notes.Should().Be(1, "the 7d/1d bucket dedupe must prevent a second reminder");
    }

    // ─── 2. FeaturedExpiryJob ─────────────────────────────────────────────

    [Fact]
    public async Task FeaturedExpiry_PastFeaturedUntil_UnsetsIsFeatured()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = "Was featured",
            Category = "Test",
            Status = "active",
            IsFeatured = true,
            FeaturedUntil = DateTime.UtcNow.AddHours(-1),
            CreatedAt = DateTime.UtcNow.AddDays(-2)
        };
        arrangeDb.JobVacancies.Add(job);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableFeaturedExpiryJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.JobVacancies.IgnoreQueryFilters().FirstAsync(j => j.Id == job.Id);
        refreshed.IsFeatured.Should().BeFalse();
    }

    [Fact]
    public async Task FeaturedExpiry_FutureFeaturedUntil_LeavesAlone()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = "Still featured",
            Category = "Test",
            Status = "active",
            IsFeatured = true,
            FeaturedUntil = DateTime.UtcNow.AddDays(3),
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };
        arrangeDb.JobVacancies.Add(job);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableFeaturedExpiryJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.JobVacancies.IgnoreQueryFilters().FirstAsync(j => j.Id == job.Id);
        refreshed.IsFeatured.Should().BeTrue();
    }

    // ─── 3. ListingExpiryJob ──────────────────────────────────────────────

    [Fact]
    public async Task ListingExpiry_PastExpiresAt_MarkedExpiredAndNotifiesOwner()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = new Listing
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Title = "Stale listing",
            Type = ListingType.Offer,
            Status = ListingStatus.Active,
            ExpiresAt = DateTime.UtcNow.AddHours(-2),
            CreatedAt = DateTime.UtcNow.AddDays(-30)
        };
        arrangeDb.Listings.Add(listing);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableListingExpiryJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.Listings.IgnoreQueryFilters().FirstAsync(l => l.Id == listing.Id);
        refreshed.Status.Should().Be(ListingStatus.Expired);

        var note = await assertDb.Notifications.IgnoreQueryFilters()
            .FirstOrDefaultAsync(n => n.UserId == TestData.MemberUser.Id
                && n.Type == "listing_expired"
                && n.Data!.Contains($"\"listing_id\":{listing.Id}"));
        note.Should().NotBeNull();
    }

    [Fact]
    public async Task ListingExpiry_AlreadyExpired_NotPickedUpAgain()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = new Listing
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Title = "Already expired",
            Type = ListingType.Offer,
            Status = ListingStatus.Expired,
            ExpiresAt = DateTime.UtcNow.AddDays(-10),
            CreatedAt = DateTime.UtcNow.AddDays(-60)
        };
        arrangeDb.Listings.Add(listing);
        await arrangeDb.SaveChangesAsync();
        var notifsBefore = await arrangeDb.Notifications.IgnoreQueryFilters()
            .Where(n => n.UserId == TestData.MemberUser.Id && n.Type == "listing_expired").CountAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableListingExpiryJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var notifsAfter = await assertDb.Notifications.IgnoreQueryFilters()
            .Where(n => n.UserId == TestData.MemberUser.Id && n.Type == "listing_expired").CountAsync();
        notifsAfter.Should().Be(notifsBefore, "expired listings must not be re-notified");
    }

    [Fact]
    public async Task AdminCronRun_MappedJob_AsOrdinaryAdmin_ReturnsForbiddenWithoutRunLog()
    {
        await AuthenticateAsAdminAsync();
        var numericId = await GetCronNumericIdAsync("listing-expiry");
        var before = await CountRunRowsAsync("ListingExpiry");

        var response = await Client.PostAsync($"/api/v2/admin/system/cron-jobs/{numericId}/run", null);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = payload.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("forbidden");
        (await CountRunRowsAsync("ListingExpiry")).Should().Be(before);
    }

    [Fact]
    public async Task AdminCronRun_ListingExpiry_ExecutesDomainJobAndPersistsMatchingOutcome()
    {
        var startedAfter = DateTime.UtcNow;
        int listingId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var listing = new Listing
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Title = "Manual cron expiry",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                ExpiresAt = DateTime.UtcNow.AddHours(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-5)
            };
            db.Listings.Add(listing);
            await db.SaveChangesAsync();
            listingId = listing.Id;
        }

        await AuthenticateAsSyntheticPlatformSuperAdminAsync();
        var numericId = await GetCronNumericIdAsync("listing-expiry");
        var response = await Client.PostAsync($"/api/v2/admin/system/cron-jobs/{numericId}/run", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = payload.GetProperty("data");
        data.GetProperty("triggered").GetBoolean().Should().BeTrue();
        data.GetProperty("job_slug").GetString().Should().Be("listing-expiry");
        data.GetProperty("job_name").GetString().Should().Be("Listing Expiry Processing");
        data.GetProperty("status").GetString().Should().Be("success");
        data.GetProperty("duration").GetDouble().Should().BeGreaterThanOrEqualTo(0);
        var output = data.GetProperty("output").GetString();
        output.Should().Be("ListingExpiry manual run completed successfully.");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listingStatus = await verifyDb.Listings.IgnoreQueryFilters()
            .Where(l => l.Id == listingId)
            .Select(l => l.Status)
            .SingleAsync();
        listingStatus.Should().Be(ListingStatus.Expired);

        var run = await verifyDb.ScheduledJobRuns
            .Where(r => r.JobName == "ListingExpiry" && r.StartedAt >= startedAfter)
            .OrderByDescending(r => r.StartedAt)
            .FirstAsync();
        run.Status.Should().Be(ScheduledJobRunStatus.Success);
        run.CompletedAt.Should().NotBeNull();
        run.ErrorMessage.Should().Be(output);
        run.ErrorType.Should().BeNull();

        var health = Factory.Services.GetRequiredService<ScheduledJobsRegistry>()
            .Snapshot()
            .Single(h => h.JobName == "ListingExpiry");
        health.Status.Should().Be("idle");
        health.LastSucceededAt.Should().NotBeNull();
    }

    [Fact]
    public async Task AdminCronRun_JobVacancyExpiry_ExecutesMappedDomainJob()
    {
        int vacancyId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var vacancy = new JobVacancy
            {
                TenantId = TestData.Tenant1.Id,
                PostedByUserId = TestData.AdminUser.Id,
                Title = "Manual vacancy expiry",
                Category = "Test",
                Status = "active",
                ExpiresAt = DateTime.UtcNow.AddHours(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-5)
            };
            db.JobVacancies.Add(vacancy);
            await db.SaveChangesAsync();
            vacancyId = vacancy.Id;
        }

        await AuthenticateAsSyntheticPlatformSuperAdminAsync();
        var numericId = await GetCronNumericIdAsync("job-expiry");
        var response = await Client.PostAsync($"/api/v2/admin/system/cron-jobs/{numericId}/run", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("triggered").GetBoolean().Should().BeTrue();
        data.GetProperty("job_slug").GetString().Should().Be("job-expiry");
        data.GetProperty("status").GetString().Should().Be("success");
        data.GetProperty("output").GetString().Should().Be("JobVacancyExpiry manual run completed successfully.");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var status = await verifyDb.JobVacancies.IgnoreQueryFilters()
            .Where(j => j.Id == vacancyId)
            .Select(j => j.Status)
            .SingleAsync();
        status.Should().Be("expired");
    }

    [Fact]
    public async Task AdminCronRun_UnmappedJob_AsPlatformSuperAdmin_ReturnsExplicitUnsupportedWithoutSuccessLog()
    {
        await AuthenticateAsSyntheticPlatformSuperAdminAsync();
        var before = await CountRunRowsAsync("run-all");

        var response = await Client.PostAsync("/api/v2/admin/system/cron-jobs/1/run", null);

        response.StatusCode.Should().Be(HttpStatusCode.NotImplemented);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = payload.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("UNSUPPORTED_OPERATION");
        (await CountRunRowsAsync("run-all")).Should().Be(before);
    }

    // ─── 4. OnboardingNurtureJob ──────────────────────────────────────────

    [Fact]
    public async Task OnboardingNurture_NewUserAtDay2_ReceivesDay2NurtureOnly()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var u = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"nurture-{Guid.NewGuid():N}@test.local",
            FirstName = "Nur",
            LastName = "Ture",
            PasswordHash = "x",
            Role = "member",
            CreatedAt = DateTime.UtcNow.AddDays(-2.5)
        };
        arrangeDb.Users.Add(u);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableOnboardingNurtureJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id); // idempotent

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var types = await assertDb.Notifications.IgnoreQueryFilters()
            .Where(n => n.UserId == u.Id && n.Type.StartsWith("onboarding_nurture_"))
            .Select(n => n.Type)
            .ToListAsync();
        types.Should().ContainSingle().Which.Should().Be("onboarding_nurture_day2");
    }

    [Fact]
    public async Task OnboardingNurture_NewUserAtDay7_ReceivesAllThreeNurtures()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var u = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"nurture-day7-{Guid.NewGuid():N}@test.local",
            FirstName = "Day",
            LastName = "Seven",
            PasswordHash = "x",
            Role = "member",
            CreatedAt = DateTime.UtcNow.AddDays(-7.5)
        };
        arrangeDb.Users.Add(u);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableOnboardingNurtureJob>(act.ServiceProvider);
        await sut.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var types = await assertDb.Notifications.IgnoreQueryFilters()
            .Where(n => n.UserId == u.Id && n.Type.StartsWith("onboarding_nurture_"))
            .Select(n => n.Type)
            .OrderBy(t => t)
            .ToListAsync();
        types.Should().BeEquivalentTo(new[] { "onboarding_nurture_day2", "onboarding_nurture_day5", "onboarding_nurture_day7" });
    }

    // ─── 5. ExpiredTokenCleanupJob ────────────────────────────────────────

    [Fact]
    public async Task ExpiredTokenCleanup_DeletesExpiredAndRevoked_KeepsValid()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var expired = new RefreshToken
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            TokenHash = $"expired-{Guid.NewGuid():N}",
            ExpiresAt = DateTime.UtcNow.AddDays(-1)
        };
        var revoked = new RefreshToken
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            TokenHash = $"revoked-{Guid.NewGuid():N}",
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            RevokedAt = DateTime.UtcNow.AddHours(-2)
        };
        var valid = new RefreshToken
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            TokenHash = $"valid-{Guid.NewGuid():N}",
            ExpiresAt = DateTime.UtcNow.AddDays(14)
        };
        arrangeDb.RefreshTokens.AddRange(expired, revoked, valid);
        await arrangeDb.SaveChangesAsync();
        var expiredId = expired.Id;
        var revokedId = revoked.Id;
        var validId = valid.Id;

        using var act = Factory.Services.CreateScope();
        var sut = ActivatorUtilities.CreateInstance<TestableExpiredTokenCleanupJob>(act.ServiceProvider);
        await sut.RunGlobalPublic(act.ServiceProvider);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var remaining = await assertDb.RefreshTokens.IgnoreQueryFilters()
            .Where(t => t.Id == expiredId || t.Id == revokedId || t.Id == validId)
            .Select(t => t.Id)
            .ToListAsync();
        remaining.Should().BeEquivalentTo(new[] { validId });
    }

    [Fact]
    public async Task ManualRun_Failure_PersistsFailedOutcomeAndRegistryFailure()
    {
        var runner = new ThrowingManualJob(
            Factory.Services.GetRequiredService<IServiceScopeFactory>(),
            Factory.Services.GetRequiredService<IConfiguration>(),
            Factory.Services.GetRequiredService<ILogger<ThrowingManualJob>>());

        var result = await runner.RunNowAsync();

        result.Outcome.Should().Be(ScheduledJobExecutionOutcome.Failed);
        result.Persisted.Should().BeTrue();
        result.RunRecordId.Should().NotBeNull();
        result.Output.Should().Contain("intentional manual scheduled-job failure");

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var run = await db.ScheduledJobRuns.SingleAsync(r => r.Id == result.RunRecordId);
        run.Status.Should().Be(ScheduledJobRunStatus.Failed);
        run.ErrorMessage.Should().Be(result.Output);
        run.ErrorType.Should().Be(nameof(InvalidOperationException));

        var health = Factory.Services.GetRequiredService<ScheduledJobsRegistry>()
            .Snapshot()
            .Single(h => h.JobName == "ManualFailureProbe");
        health.Status.Should().Be("failing");
        health.LastFailureMessage.Should().Contain("intentional manual scheduled-job failure");
    }

    [Fact]
    public async Task NaturalAndManualRuns_CannotOverlap_AndBusyAttemptIsPersistedAsSkipped()
    {
        var configuration = new ConfigurationBuilder()
            .AddConfiguration(Factory.Services.GetRequiredService<IConfiguration>())
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["BackgroundServices:SuppressAutomaticExecution"] = "false"
            })
            .Build();
        var runner = new BlockingScheduledJob(
            Factory.Services.GetRequiredService<IServiceScopeFactory>(),
            configuration,
            Factory.Services.GetRequiredService<ILogger<BlockingScheduledJob>>());

        await runner.StartAsync(CancellationToken.None);
        try
        {
            await runner.Entered.WaitAsync(TimeSpan.FromSeconds(10));

            var busy = await runner.RunNowAsync();

            busy.Outcome.Should().Be(ScheduledJobExecutionOutcome.Busy);
            busy.Persisted.Should().BeTrue();
            busy.RunRecordId.Should().NotBeNull();
            busy.Output.Should().Contain("already running");
            runner.MaxConcurrent.Should().Be(1);

            using (var busyScope = Factory.Services.CreateScope())
            {
                var db = busyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var busyRun = await db.ScheduledJobRuns.SingleAsync(r => r.Id == busy.RunRecordId);
                busyRun.Status.Should().Be(ScheduledJobRunStatus.Skipped);
                busyRun.ErrorType.Should().Be("JobAlreadyRunning");
                busyRun.ErrorMessage.Should().Be(busy.Output);
            }

            runner.Release();
            await runner.BodyCompleted.WaitAsync(TimeSpan.FromSeconds(10));

            ScheduledJobRun? naturalRun = null;
            for (var attempt = 0; attempt < 50 && naturalRun is null; attempt++)
            {
                using var naturalScope = Factory.Services.CreateScope();
                var db = naturalScope.ServiceProvider.GetRequiredService<NexusDbContext>();
                naturalRun = await db.ScheduledJobRuns
                    .Where(r => r.JobName == "ManualConcurrencyProbe" && r.Status == ScheduledJobRunStatus.Success)
                    .OrderByDescending(r => r.StartedAt)
                    .FirstOrDefaultAsync();
                if (naturalRun is null)
                    await Task.Delay(20);
            }

            naturalRun.Should().NotBeNull();
            naturalRun!.ErrorMessage.Should().Be("ManualConcurrencyProbe scheduled run completed successfully.");
            runner.MaxConcurrent.Should().Be(1);
        }
        finally
        {
            runner.Release();
            await runner.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task ManualPerTenantRun_ExcludesInactiveTenants()
    {
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var inactiveTenant = await db.Tenants.SingleAsync(tenant => tenant.Id == TestData.Tenant2.Id);
            inactiveTenant.IsActive = false;
            await db.SaveChangesAsync();
        }

        try
        {
            var runner = new TenantRecordingJob(
                Factory.Services.GetRequiredService<IServiceScopeFactory>(),
                Factory.Services.GetRequiredService<IConfiguration>(),
                Factory.Services.GetRequiredService<ILogger<TenantRecordingJob>>());

            var result = await runner.RunNowAsync();

            result.Outcome.Should().Be(ScheduledJobExecutionOutcome.Success);
            runner.VisitedTenantIds.Should().Contain(TestData.Tenant1.Id);
            runner.VisitedTenantIds.Should().NotContain(TestData.Tenant2.Id);
        }
        finally
        {
            using var restore = Factory.Services.CreateScope();
            var db = restore.ServiceProvider.GetRequiredService<NexusDbContext>();
            var inactiveTenant = await db.Tenants.SingleAsync(tenant => tenant.Id == TestData.Tenant2.Id);
            inactiveTenant.IsActive = true;
            await db.SaveChangesAsync();
        }
    }

    private async Task<int> GetCronNumericIdAsync(string slug)
    {
        var response = await Client.GetAsync("/api/v2/admin/system/cron-jobs");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        return payload.GetProperty("data")
            .EnumerateArray()
            .Single(job => job.GetProperty("slug").GetString() == slug)
            .GetProperty("id")
            .GetInt32();
    }

    private async Task AuthenticateAsSyntheticPlatformSuperAdminAsync()
    {
        var email = $"cron-platform-super-{Guid.NewGuid():N}@test.local";
        int userId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Cron",
                LastName = "Platform Super",
                Role = "member",
                IsAdmin = false,
                IsSuperAdmin = true,
                IsTenantSuperAdmin = false,
                IsGod = false,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        _syntheticPlatformSuperAdminIds.Add(userId);
        SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant1.Slug));
    }

    private async Task<int> CountRunRowsAsync(string jobName)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.ScheduledJobRuns.CountAsync(r => r.JobName == jobName);
    }
}
