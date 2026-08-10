// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class VolunteerWaitlistOfferExpiryJobTests : IntegrationTestBase
{
    public VolunteerWaitlistOfferExpiryJobTests(NexusWebApplicationFactory factory) : base(factory) { }

    private sealed class TestableVolunteerWaitlistOfferExpiryJob : VolunteerWaitlistOfferExpiryJob
    {
        public TestableVolunteerWaitlistOfferExpiryJob(
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration,
            ILogger<VolunteerWaitlistOfferExpiryJob> logger)
            : base(scopeFactory, configuration, logger) { }

        public Task RunGlobalPublic(IServiceProvider services, CancellationToken ct = default) =>
            RunGlobalAsync(services, ct);
    }

    [Fact]
    public void Registration_UsesSingleGlobalThirtyMinuteJob()
    {
        var registered = Factory.Services
            .GetServices<IHostedService>()
            .OfType<VolunteerWaitlistOfferExpiryJob>()
            .ToList();

        registered.Should().ContainSingle();
        registered[0].Name.Should().Be("VolunteerWaitlistOfferExpiry");
        registered[0].ResolvedInterval.Should().Be(TimeSpan.FromMinutes(30));
    }

    [Fact]
    public async Task GlobalRun_ExpiresStaleOfferAndNotifiesNextVolunteer()
    {
        int staleId;
        int waitingId;

        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = new VolunteerOpportunity
            {
                TenantId = TestData.Tenant1.Id,
                OrganizerId = TestData.AdminUser.Id,
                Title = $"Scheduled waitlist expiry {Guid.NewGuid():N}",
                Description = "Scheduled waitlist expiry integration test",
                Status = OpportunityStatus.Published,
                RequiredVolunteers = 1,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();

            var shift = new VolunteerShift
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = opportunity.Id,
                Title = "Scheduled expiry shift",
                StartsAt = DateTime.UtcNow.AddDays(2),
                EndsAt = DateTime.UtcNow.AddDays(2).AddHours(2),
                MaxVolunteers = 1,
                Status = ShiftStatus.Scheduled,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var stale = new ShiftWaitlistEntry
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                UserId = TestData.MemberUser.Id,
                Position = 1,
                Status = "notified",
                NotifiedAt = DateTime.UtcNow.AddHours(-49),
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            var waiting = new ShiftWaitlistEntry
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                UserId = TestData.AdminUser.Id,
                Position = 2,
                Status = "waiting",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.ShiftWaitlistEntries.AddRange(stale, waiting);
            await db.SaveChangesAsync();
            staleId = stale.Id;
            waitingId = waiting.Id;
        }

        using (var act = Factory.Services.CreateScope())
        {
            var job = ActivatorUtilities.CreateInstance<TestableVolunteerWaitlistOfferExpiryJob>(
                act.ServiceProvider);
            await job.RunGlobalPublic(act.ServiceProvider);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var statuses = await verifyDb.ShiftWaitlistEntries
            .IgnoreQueryFilters()
            .Where(entry => entry.Id == staleId || entry.Id == waitingId)
            .ToDictionaryAsync(entry => entry.Id);

        statuses[staleId].Status.Should().Be("expired");
        statuses[waitingId].Status.Should().Be("notified");
        statuses[waitingId].NotifiedAt.Should().NotBeNull();
        (await verifyDb.Notifications.IgnoreQueryFilters().AnyAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.AdminUser.Id
            && notification.Type == "vol_waitlist_spot"
            && notification.Data != null
            && notification.Data.Contains($"\"waitlist_id\":{waitingId}")))
            .Should().BeTrue();
    }
}
