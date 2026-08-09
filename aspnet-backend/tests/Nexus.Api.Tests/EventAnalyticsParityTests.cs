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
using Nexus.Api.Tests.Fixtures;
using Npgsql;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventAnalyticsParityTests : IntegrationTestBase
{
    public EventAnalyticsParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Summary_DerivesIdentityFreeCanonicalLedgerCountsAndPrivacySuppression()
    {
        var eventId = await SeedAnalyticsEventAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/v2/events/{eventId}/analytics");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Headers.Vary.Should().Contain(["Authorization", "Cookie", "X-Tenant-ID"]);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("contract_version").GetInt32().Should().Be(1);
        data.GetProperty("event_title").GetString().Should().Be("=Formula event");
        data.GetProperty("privacy_threshold").GetInt32().Should().Be(5);
        data.GetProperty("registration").GetProperty("confirmed").GetInt32().Should().Be(1);
        data.GetProperty("registration").GetProperty("pending").GetInt32().Should().Be(1);
        data.GetProperty("registration").GetProperty("remaining").GetInt32().Should().Be(9);
        data.GetProperty("invitation").GetProperty("issued").GetInt32().Should().Be(2);
        data.GetProperty("invitation").GetProperty("accepted").GetInt32().Should().Be(1);
        data.GetProperty("waitlist").GetProperty("current_waiting").GetInt32().Should().Be(1);
        data.GetProperty("attendance").GetProperty("checked_out").GetInt32().Should().Be(1);
        data.GetProperty("credits").GetProperty("completed_amount").GetString().Should().Be("1.50");
        data.GetProperty("communications").GetProperty("delivered").GetInt32().Should().Be(1);
        data.GetProperty("communications").GetProperty("pending").GetInt32().Should().Be(1);
        data.GetProperty("tickets").GetProperty("redacted").GetBoolean().Should().BeFalse();
        data.GetProperty("tickets").GetProperty("confirmed_credit_value").GetString().Should().Be("0.00");
        var funnel = data.GetProperty("optional_funnel");
        funnel.GetProperty("event_views").GetProperty("suppressed").GetBoolean().Should().BeTrue();
        funnel.GetProperty("event_views").GetProperty("value").ValueKind.Should().Be(JsonValueKind.Null);
        funnel.GetProperty("registration_starts").GetProperty("value").GetInt32().Should().Be(5);
        data.GetProperty("safeguarding").GetProperty("guardian_consents").GetProperty("suppressed").GetBoolean().Should().BeTrue();
        data.ToString().ToLowerInvariant().Should().NotContain("email_address").And.NotContain("first_name").And.NotContain("last_name");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var audit = await db.EventAnalyticsAccessAudits.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId);
        audit.AccessScope.Should().Be("organizer_summary");
        audit.PurposeCode.Should().Be("dashboard_view");
        audit.QueryHash.Should().MatchRegex("^[0-9a-f]{64}$");
        audit.SuppressedCount.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Csv_IsLocalizedFormulaSafePrivateAndSeparatelyAudited()
    {
        var eventId = await SeedAnalyticsEventAsync();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var admin = await db.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == TestData.AdminUser.Id);
            admin.PreferredLanguage = "ga";
            await db.SaveChangesAsync();
        }
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/events/{eventId}/analytics/export.csv");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("text/csv");
        response.Content.Headers.ContentDisposition!.FileNameStar.Should().Be($"event-{eventId}-analytics.csv");
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Headers.GetValues("X-Content-Type-Options").Should().Contain("nosniff");
        var csv = await response.Content.ReadAsStringAsync();
        csv.Should().StartWith("M\u00E9adrach,Luach,Faoi cheilt").And.Contain("event_title,'=Formula event,0");
        csv.Should().Contain("optional_funnel.event_views,,1");

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var audit = await assertDb.EventAnalyticsAccessAudits.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId);
        audit.AccessScope.Should().Be("csv_export");
        audit.PurposeCode.Should().Be("csv_export");
    }

    [Fact]
    public async Task Access_HidesCrossTenantAndNonManagerExistenceAndRedactsFinanceForCoOrganizer()
    {
        var eventId = await SeedAnalyticsEventAsync(addCoOrganizer: true);
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/analytics")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync($"/api/v2/events/{eventId}/analytics");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var tickets = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("tickets");
        tickets.GetProperty("available").GetBoolean().Should().BeTrue();
        tickets.GetProperty("redacted").GetBoolean().Should().BeTrue();
        tickets.GetProperty("confirmed_units").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task AnalyticsEvidence_IsAppendOnlyAtTheDatabaseBoundary()
    {
        var eventId = await SeedAnalyticsEventAsync();
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/analytics")).EnsureSuccessStatusCode();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var auditId = await db.EventAnalyticsAccessAudits.IgnoreQueryFilters().Where(x => x.EventId == eventId).Select(x => x.Id).SingleAsync();
        var factId = await db.EventAnalyticsOptionalFacts.IgnoreQueryFilters().Where(x => x.EventId == eventId).Select(x => x.Id).FirstAsync();
        var mutateAudit = async () => await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE event_analytics_access_audits SET \"ResultCount\" = {999} WHERE \"Id\" = {auditId}");
        var deleteFact = async () => await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM event_analytics_optional_facts WHERE \"Id\" = {factId}");
        await mutateAudit.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
        await deleteFact.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
    }

    private async Task<int> SeedAnalyticsEventAsync(bool addCoOrganizer = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var seedKey = Guid.NewGuid().ToString("N");
        var evt = new Event
        {
            Id = System.Security.Cryptography.RandomNumberGenerator.GetInt32(100_000_000, int.MaxValue),
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.AdminUser.Id,
            Title = "=Formula event",
            MaxAttendees = 10,
            StartsAt = now.AddDays(2),
            EndsAt = now.AddDays(2).AddHours(2),
            Status = "active",
            PublicationStatus = "published",
            OperationalStatus = "scheduled"
        };
        db.Events.Add(evt);
        await db.SaveChangesAsync();

        if (addCoOrganizer)
        {
            db.EventStaffAssignments.Add(new EventStaffAssignment { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, Role = "co_organizer", Status = "active", GrantedBy = TestData.AdminUser.Id });
        }

        var confirmed = new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, RegistrationState = "confirmed", ConfirmedAt = now, StateChangedAt = now };
        var pending = new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.AdminUser.Id, RegistrationState = "pending", PendingAt = now, StateChangedAt = now };
        db.EventRegistrations.AddRange(confirmed, pending);
        await db.SaveChangesAsync();
        db.EventRegistrationHistory.AddRange(
            new EventRegistrationHistory { TenantId = TestData.Tenant1.Id, EventId = evt.Id, RegistrationId = confirmed.Id, UserId = confirmed.UserId, RegistrationVersion = 1, Action = "confirmed", ToState = "confirmed", IdempotencyKey = $"analytics-reg-confirmed-{evt.Id}", Metadata = "{}" },
            new EventRegistrationHistory { TenantId = TestData.Tenant1.Id, EventId = evt.Id, RegistrationId = pending.Id, UserId = pending.UserId, RegistrationVersion = 1, Action = "pending", ToState = "pending", IdempotencyKey = $"analytics-reg-pending-{evt.Id}", Metadata = "{}" });
        var wait = new EventWaitlistEntry { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.AdminUser.Id, QueueState = "waiting", QueueSequence = 1, StateChangedAt = now };
        db.EventWaitlistEntries.Add(wait);
        await db.SaveChangesAsync();
        db.EventWaitlistEntryHistory.Add(new EventWaitlistEntryHistory { TenantId = TestData.Tenant1.Id, EventId = evt.Id, WaitlistEntryId = wait.Id, UserId = wait.UserId, QueueVersion = 1, QueueSequence = 1, Action = "joined", ToState = "waiting", IdempotencyKey = $"analytics-wait-{evt.Id}", Metadata = "{}" });
        db.EventAttendance.Add(new EventAttendance { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, AttendanceStatus = "checked_out", CheckedInAt = now, CheckedOutAt = now.AddHours(1), StatusChangedAt = now });
        db.EventAttendanceCreditClaims.AddRange(
            new EventAttendanceCreditClaim { TenantId = TestData.Tenant1.Id, EventId = evt.Id, AttendanceId = 1, UserId = TestData.MemberUser.Id, ClaimType = "attendance", IdempotencyKey = $"analytics-credit-complete-{seedKey}", FundingSourceType = "event", Amount = 1.5m, Status = "completed", Metadata = "{}", CompletedAt = now },
            new EventAttendanceCreditClaim { TenantId = TestData.Tenant1.Id, EventId = evt.Id, AttendanceId = 1, UserId = TestData.AdminUser.Id, ClaimType = "attendance", IdempotencyKey = $"analytics-credit-pending-{seedKey}", FundingSourceType = "event", Amount = 2m, Status = "pending", Metadata = "{}" });
        var ticketType = new EventTicketType { TenantId = TestData.Tenant1.Id, EventId = evt.Id, OccurrenceKey = $"event:{evt.Id}", Name = "Free ticket", Kind = "free", Status = "active", AllocationLimit = 10, PerMemberLimit = 2, UnitPriceCredits = 0m, SalesOpensAt = now.AddDays(-1), SalesClosesAt = now.AddDays(1), EventStartsAtSnapshot = evt.StartsAt, EventTimezoneSnapshot = "UTC", EligibilityPolicy = "{}", CreatedBy = TestData.AdminUser.Id, UpdatedBy = TestData.AdminUser.Id, ActivatedBy = TestData.AdminUser.Id, ActivatedAt = now };
        db.EventTicketTypes.Add(ticketType);
        await db.SaveChangesAsync();
        db.EventTicketEntitlements.Add(new EventTicketEntitlement { TenantId = TestData.Tenant1.Id, EventId = evt.Id, TicketTypeId = ticketType.Id, RegistrationId = confirmed.Id, UserId = confirmed.UserId, Units = 1, TicketKindSnapshot = "free", UnitPriceCreditsSnapshot = 0m, TotalPriceCreditsSnapshot = 0m, CreatedBy = TestData.AdminUser.Id, AllocationIdempotencyHash = Hash($"ticket-{evt.Id}"), AllocationRequestHash = Hash($"ticket-request-{evt.Id}") });
        var campaign = new EventInvitationCampaign { TenantId = TestData.Tenant1.Id, EventId = evt.Id, CampaignType = "member", Status = "issued", Source = "{}", SourceHash = Hash($"source-{evt.Id}"), SegmentCriteriaSummary = "{}", PreviewErrors = "[]", DefaultLocale = "en", PreviewCount = 2, ValidCount = 2, CreatedBy = TestData.AdminUser.Id, UpdatedBy = TestData.AdminUser.Id, CreateIdempotencyHash = Hash($"campaign-{evt.Id}"), CreateRequestHash = Hash($"campaign-request-{evt.Id}"), StartedAt = now, CompletedAt = now, IssuedAt = now };
        db.EventInvitationCampaigns.Add(campaign);
        await db.SaveChangesAsync();
        db.EventInvitations.AddRange(
            new EventInvitation { TenantId = TestData.Tenant1.Id, EventId = evt.Id, CampaignId = campaign.Id, UserId = TestData.MemberUser.Id, TokenHash = Hash($"accepted-{evt.Id}"), TokenPrefix = "accepted", Status = "accepted", AcceptedAt = now, AcceptedBy = TestData.MemberUser.Id, TokenExpiresAt = now.AddDays(1) },
            new EventInvitation { TenantId = TestData.Tenant1.Id, EventId = evt.Id, CampaignId = campaign.Id, UserId = TestData.AdminUser.Id, TokenHash = Hash($"revoked-{evt.Id}"), TokenPrefix = "revoked01", Status = "revoked", RevokedAt = now, RevokedBy = TestData.AdminUser.Id, RevocationReason = "Fixture revocation", TokenExpiresAt = now.AddDays(1) });
        var outbox = new EventDomainOutbox { TenantId = TestData.Tenant1.Id, EventId = evt.Id, AggregateStream = $"analytics:{evt.Id}", AggregateVersion = 1, Action = "event.analytics.fixture", IdempotencyKey = $"analytics-outbox-{evt.Id}", Payload = "{}", Status = "pending", AvailableAt = now, CreatedAt = now, UpdatedAt = now };
        db.EventDomainOutbox.Add(outbox);
        await db.SaveChangesAsync();
        db.EventNotificationDeliveries.AddRange(
            new EventNotificationDelivery { TenantId = TestData.Tenant1.Id, OutboxId = outbox.Id, RecipientUserId = TestData.MemberUser.Id, Channel = "email", DeliveryKey = Hash($"delivery-1-{evt.Id}"), Status = "delivered" },
            new EventNotificationDelivery { TenantId = TestData.Tenant1.Id, OutboxId = outbox.Id, RecipientUserId = TestData.AdminUser.Id, Channel = "in_app", DeliveryKey = Hash($"delivery-2-{evt.Id}"), Status = "retrying" });
        for (var index = 0; index < 4; index++) db.EventAnalyticsOptionalFacts.Add(Fact(evt.Id, "event_viewed", index, now));
        for (var index = 0; index < 5; index++) db.EventAnalyticsOptionalFacts.Add(Fact(evt.Id, "registration_started", index + 10, now));
        db.EventGuardianConsents.Add(new EventGuardianConsent { TenantId = TestData.Tenant1.Id, EventId = evt.Id, RequirementsId = 1, RequirementsVersionId = 1, RequirementsVersionNumber = 1, MinorUserId = TestData.MemberUser.Id, GuardianEmailCiphertext = "protected", GuardianIdentityCiphertext = "protected", GuardianEmailBlindHash = Hash($"guardian-{evt.Id}"), GuardianLocale = "en", RelationshipCode = "parent", ConsentTextHash = Hash("consent"), PolicyBindingHash = Hash("policy"), TokenHash = Hash($"guardian-token-{evt.Id}"), Status = "active", RequestedByUserId = TestData.AdminUser.Id, RequestIdempotencyHash = Hash($"guardian-request-{evt.Id}"), RequestHash = Hash($"guardian-body-{evt.Id}"), ExpiresAt = now.AddDays(1), GrantedAt = now });
        await db.SaveChangesAsync();
        return evt.Id;
    }

    private EventAnalyticsOptionalFact Fact(int eventId, string metric, int suffix, DateTime now) => new()
    {
        TenantId = TestData.Tenant1.Id,
        EventId = eventId,
        Metric = metric,
        DeduplicationHash = Hash($"{eventId}:{metric}:{suffix}"),
        RequestHash = Hash($"request:{eventId}:{metric}:{suffix}"),
        SubjectHash = Hash($"subject:{eventId}:{suffix}"),
        PseudonymKeyVersion = "0123456789abcdef",
        ConsentRecordId = suffix + 1,
        ConsentVersion = "v1",
        SourceSurface = "event_detail",
        ClientPlatform = "react_web",
        Dimensions = "{\"source_surface\":\"event_detail\",\"client_platform\":\"react_web\"}",
        OccurredAt = now.AddMinutes(-1),
        ReceivedAt = now,
        RetentionDueAt = now.AddDays(30)
    };

    private static string Hash(string value) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
