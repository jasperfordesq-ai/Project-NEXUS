// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// PurgeBrokerMessageCopiesJob (R-6, Laravel <c>safeguarding:purge-message-copies</c>).
///
/// 🔴 With nothing running, a copy of every message a broker ever reviewed was
/// kept for ever — a safeguarding control turning into an indefinite archive of
/// members' private messages.
///
/// Most of these cases are NEGATIVE on purpose. A purge job that deletes too
/// eagerly destroys safeguarding evidence, which is far worse than one that
/// keeps rows too long, so the tests spend their weight on what must survive:
/// an unreviewed row of any age, a recently cleared row, and a flagged row that
/// has not yet reached the longer legal-retention period.
/// </summary>
[Collection("Integration")]
public sealed class PurgeBrokerMessageCopiesJobTests : IntegrationTestBase
{
    public PurgeBrokerMessageCopiesJobTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Resolve the REGISTERED instance, so this also proves the job is wired
    /// into the host. A job that exists but is never registered is the same as
    /// no job at all.
    /// </summary>
    private static T ResolveJob<T>(IServiceProvider services) where T : ScheduledHostedService
        => services.GetServices<IHostedService>().OfType<T>().Single();

    private static async Task RunAsync(ScheduledHostedService job, IServiceProvider services, int tenantId)
    {
        var method = typeof(ScheduledHostedService).GetMethod(
            "RunForTenantAsync",
            System.Reflection.BindingFlags.Instance
                | System.Reflection.BindingFlags.NonPublic
                | System.Reflection.BindingFlags.Public)!;
        await (Task)method.Invoke(job, [services, tenantId, CancellationToken.None])!;
    }

    /// <summary>
    /// A review points at a real message by foreign key, so each case needs a
    /// message in a conversation between two real members. Invented ids are
    /// rejected by the database — which is the schema doing its job.
    /// </summary>
    private async Task<(int ConversationId, int SenderId, int RecipientId)> SeedThreadAsync(int tenantId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var sender = NewUser(tenantId);
        var recipient = NewUser(tenantId);
        db.Users.AddRange(sender, recipient);
        await db.SaveChangesAsync();

        var conversation = new Conversation
        {
            TenantId = tenantId,
            Participant1Id = sender.Id,
            Participant2Id = recipient.Id,
            CreatedAt = DateTime.UtcNow.AddYears(-6),
        };
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync();

        return (conversation.Id, sender.Id, recipient.Id);
    }

    private static User NewUser(int tenantId) => new()
    {
        TenantId = tenantId,
        Email = $"purge-job-{Guid.NewGuid():N}@test.com",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
        FirstName = "Purge",
        LastName = "Subject",
        Role = "member",
        IsActive = true,
        RegistrationStatus = RegistrationStatus.Active,
        CreatedAt = DateTime.UtcNow,
    };

    private async Task<int> SeedReviewAsync(
        (int ConversationId, int SenderId, int RecipientId) thread,
        bool flagged,
        bool reviewed,
        int ageInDays,
        int? tenantId = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var effectiveTenant = tenantId ?? TestData.Tenant1.Id;
        var createdAt = DateTime.UtcNow.AddDays(-ageInDays);

        var message = new Message
        {
            TenantId = effectiveTenant,
            ConversationId = thread.ConversationId,
            SenderId = thread.SenderId,
            Content = "purge job fixture",
            CreatedAt = createdAt,
        };
        db.Messages.Add(message);
        await db.SaveChangesAsync();

        var review = new SafeguardingMessageReview
        {
            TenantId = effectiveTenant,
            MessageId = message.Id,
            SenderId = thread.SenderId,
            RecipientId = thread.RecipientId,
            Severity = "low",
            FlagReason = "purge_job_test",
            IsFlagged = flagged,
            ReviewedByUserId = reviewed ? thread.RecipientId : null,
            ReviewedAt = reviewed ? createdAt.AddHours(1) : null,
            CreatedAt = createdAt,
        };
        db.Set<SafeguardingMessageReview>().Add(review);
        await db.SaveChangesAsync();
        return review.Id;
    }

    private async Task<bool> StillExistsAsync(int id)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<SafeguardingMessageReview>().IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(r => r.Id == id);
    }

    [Fact]
    public async Task AnOldClearedReview_IsPurged_ButARecentOneIsKept()
    {
        var thread = await SeedThreadAsync(TestData.Tenant1.Id);
        var old = await SeedReviewAsync(thread, flagged: false, reviewed: true, ageInDays: 200);
        var recent = await SeedReviewAsync(thread, flagged: false, reviewed: true, ageInDays: 3);

        using var scope = Factory.Services.CreateScope();
        var job = ResolveJob<PurgeBrokerMessageCopiesJob>(Factory.Services);
        await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);

        (await StillExistsAsync(old)).Should().BeFalse(
            "a cleared review past its retention period is exactly what this job is for");
        (await StillExistsAsync(recent)).Should().BeTrue(
            "the retention period has not passed");
    }

    [Fact]
    public async Task AnUnreviewedConcern_IsNeverPurged_HoweverOld()
    {
        // Five years old, and still nobody has looked at it.
        var thread = await SeedThreadAsync(TestData.Tenant1.Id);
        var neglected = await SeedReviewAsync(thread, flagged: true, reviewed: false, ageInDays: 1825);
        var neglectedUnflagged = await SeedReviewAsync(thread, flagged: false, reviewed: false, ageInDays: 1825);

        using var scope = Factory.Services.CreateScope();
        var job = ResolveJob<PurgeBrokerMessageCopiesJob>(Factory.Services);
        await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);

        (await StillExistsAsync(neglected)).Should().BeTrue(
            "deleting an unreviewed row silently discards a safeguarding concern nobody has read");
        (await StillExistsAsync(neglectedUnflagged)).Should().BeTrue(
            "the unreviewed rule does not depend on the flag");
    }

    [Fact]
    public async Task AFlaggedReview_IsKeptFarLongerThanAClearedOne()
    {
        // 200 days: past the 90-day cleared period, well inside the 365-day
        // flagged one. This is the pair of rows that proves the two periods are
        // genuinely different rather than one rule applied twice.
        var thread = await SeedThreadAsync(TestData.Tenant1.Id);
        var flagged = await SeedReviewAsync(thread, flagged: true, reviewed: true, ageInDays: 200);
        var veryOldFlagged = await SeedReviewAsync(thread, flagged: true, reviewed: true, ageInDays: 400);

        using var scope = Factory.Services.CreateScope();
        var job = ResolveJob<PurgeBrokerMessageCopiesJob>(Factory.Services);
        await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);

        (await StillExistsAsync(flagged)).Should().BeTrue(
            "a flagged review is potential evidence and is retained for a year");
        (await StillExistsAsync(veryOldFlagged)).Should().BeFalse(
            "past a year even a flagged review goes");
    }

    [Fact]
    public async Task AnotherCommunitysReviews_AreNotTouched()
    {
        var otherThread = await SeedThreadAsync(TestData.Tenant2.Id);
        var otherTenantReview = await SeedReviewAsync(
            otherThread, flagged: false, reviewed: true, ageInDays: 200,
            tenantId: TestData.Tenant2.Id);

        using var runScope = Factory.Services.CreateScope();
        var job = ResolveJob<PurgeBrokerMessageCopiesJob>(Factory.Services);
        await RunAsync(job, runScope.ServiceProvider, TestData.Tenant1.Id);

        (await StillExistsAsync(otherTenantReview)).Should().BeTrue(
            "a job that runs per community must not reach into another one's safeguarding records");
    }
}
