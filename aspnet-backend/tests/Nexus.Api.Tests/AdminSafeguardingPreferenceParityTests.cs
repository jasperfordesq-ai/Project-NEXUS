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

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AdminSafeguardingPreferenceParityTests : IntegrationTestBase
{
    public AdminSafeguardingPreferenceParityTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public async Task MemberPreferences_ProjectsRealSelections_AuditsAccess_AndAllowsBroker()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var brokerEmail = $"safeguarding-broker-{suffix}@test.com";
        int brokerId = 0;
        int protectedMemberId = 0;
        int declinedMemberId = 0;
        int protectedOptionId = 0;
        int declinedOptionId = 0;
        int legacyVettingId = 0;
        long reviewRequestId = 0;
        var baselinePendingReviews = 0;
        var createdDeclinedOption = false;
        var originalDeclinedActive = true;
        string? originalDeclinedTriggers = null;

        try
        {
            using (var seed = Factory.Services.CreateScope())
            {
                var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
                var broker = NewUser(brokerEmail, "broker", "Safeguarding", "Broker", withPassword: true);
                var protectedMember = NewUser($"protected-{suffix}@test.com", "member", "Protected", "Member");
                var declinedMember = NewUser($"declined-{suffix}@test.com", "member", "Declined", "Member");
                db.Users.AddRange(broker, protectedMember, declinedMember);

                var protectedOption = new SafeguardingOption
                {
                    TenantId = TestData.Tenant1.Id,
                    OptionKey = $"requires_coordinator_contact_{suffix}",
                    OptionType = "checkbox",
                    Label = "Coordinator-arranged contact",
                    TriggersJson = "{\"restricts_messaging\":true}",
                    IsActive = true,
                    SortOrder = 1,
                    CreatedAt = DateTime.UtcNow
                };
                var declinedOption = await db.SafeguardingOptions.IgnoreQueryFilters()
                    .SingleOrDefaultAsync(option =>
                        option.TenantId == TestData.Tenant1.Id
                        && option.OptionKey == "none_apply");
                if (declinedOption == null)
                {
                    declinedOption = new SafeguardingOption
                    {
                        TenantId = TestData.Tenant1.Id,
                        OptionKey = "none_apply",
                        OptionType = "checkbox",
                        Label = "safeguarding.presets.common.options.none_apply.label",
                        TriggersJson = "{}",
                        IsActive = true,
                        SortOrder = 2,
                        CreatedAt = DateTime.UtcNow
                    };
                    db.SafeguardingOptions.Add(declinedOption);
                    createdDeclinedOption = true;
                }
                else
                {
                    originalDeclinedActive = declinedOption.IsActive;
                    originalDeclinedTriggers = declinedOption.TriggersJson;
                    declinedOption.IsActive = true;
                    declinedOption.TriggersJson = "{}";
                }
                db.SafeguardingOptions.Add(protectedOption);
                await db.SaveChangesAsync();

                brokerId = broker.Id;
                protectedMemberId = protectedMember.Id;
                declinedMemberId = declinedMember.Id;
                protectedOptionId = protectedOption.Id;
                declinedOptionId = declinedOption.Id;
                db.UserSafeguardingPreferences.AddRange(
                    new UserSafeguardingPreference
                    {
                        TenantId = TestData.Tenant1.Id,
                        UserId = protectedMemberId,
                        OptionId = protectedOptionId,
                        SelectedValue = "true",
                        ConsentGivenAt = DateTime.UtcNow.AddMinutes(-2),
                        CreatedAt = DateTime.UtcNow.AddMinutes(-2)
                    },
                    new UserSafeguardingPreference
                    {
                        TenantId = TestData.Tenant1.Id,
                        UserId = declinedMemberId,
                        OptionId = declinedOptionId,
                        SelectedValue = "true",
                        ConsentGivenAt = DateTime.UtcNow.AddMinutes(-1),
                        CreatedAt = DateTime.UtcNow.AddMinutes(-1)
                    });
                baselinePendingReviews = await db.SafeguardingVettingReviewRequests.CountAsync(review =>
                    review.Status == SafeguardingVettingReviewRequest.PendingStatus);
                var legacyVetting = new VettingRecord
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = protectedMemberId,
                    VettingType = "dbs_enhanced",
                    Status = "pending",
                    ReferenceNumber = "legacy-must-not-count",
                    CreatedAt = DateTime.UtcNow
                };
                var reviewRequest = new SafeguardingVettingReviewRequest
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = protectedMemberId,
                    Jurisdiction = "england_wales",
                    SchemeCode = "dbs_england_wales",
                    AttestationCode = "dbs_enhanced",
                    PurposeCode = "safeguarded_member_contact",
                    ScopeType = "tenant",
                    ScopeIdentifier = TestData.Tenant1.Id.ToString(),
                    PolicyVersion = "test-policy",
                    Status = SafeguardingVettingReviewRequest.PendingStatus,
                    RequestSource = SafeguardingVettingReviewRequest.MemberRequestSource,
                    RequestedByUserId = protectedMemberId,
                    RequestedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                };
                db.VettingRecords.Add(legacyVetting);
                db.SafeguardingVettingReviewRequests.Add(reviewRequest);
                await db.SaveChangesAsync();
                legacyVettingId = legacyVetting.Id;
                reviewRequestId = reviewRequest.Id;
            }

            await AuthenticateAsAdminAsync();
            var adminResponse = await Client.GetAsync("/api/v2/admin/safeguarding/member-preferences");
            adminResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var adminData = (await adminResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            AssertMemberProjection(adminData, protectedMemberId, hasTriggers: true, declinationOnly: false);
            AssertMemberProjection(adminData, declinedMemberId, hasTriggers: false, declinationOnly: true);

            SetAuthToken(await GetAccessTokenAsync(brokerEmail, TestData.Tenant1.Slug));
            var brokerResponse = await Client.GetAsync("/api/v2/admin/safeguarding/member-preferences");
            brokerResponse.StatusCode.Should().Be(HttpStatusCode.OK);

            var brokerDashboard = await Client.GetAsync("/api/v2/admin/broker/dashboard");
            brokerDashboard.StatusCode.Should().Be(HttpStatusCode.OK);
            var brokerDashboardData = (await brokerDashboard.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            brokerDashboardData.GetProperty("vetting_pending").GetInt32()
                .Should().Be(baselinePendingReviews + 1,
                    "legacy document-era vetting rows must never appear as current review workload");

            using var verify = Factory.Services.CreateScope();
            var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await verifyDb.AuditLogs.CountAsync(log =>
                log.TenantId == TestData.Tenant1.Id
                && log.Action == "safeguarding_preferences_list_viewed"
                && (log.UserId == TestData.AdminUser.Id || log.UserId == brokerId)))
                .Should().Be(2);
        }
        finally
        {
            ClearAuthToken();
            using var cleanup = Factory.Services.CreateScope();
            var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
            var userIds = new[] { brokerId, protectedMemberId, declinedMemberId }.Where(id => id > 0).ToArray();
            var optionIds = new[]
            {
                protectedOptionId,
                createdDeclinedOption ? declinedOptionId : 0
            }.Where(id => id > 0).ToArray();
            if (userIds.Length > 0)
            {
                if (reviewRequestId > 0)
                {
                    await db.SafeguardingVettingReviewRequests.IgnoreQueryFilters()
                        .Where(review => review.Id == reviewRequestId)
                        .ExecuteDeleteAsync();
                }
                if (legacyVettingId > 0)
                {
                    await db.VettingRecords.IgnoreQueryFilters()
                        .Where(record => record.Id == legacyVettingId)
                        .ExecuteDeleteAsync();
                }
                await db.AuditLogs.IgnoreQueryFilters()
                    .Where(log => log.Action == "safeguarding_preferences_list_viewed" && userIds.Contains(log.UserId ?? 0))
                    .ExecuteDeleteAsync();
                await db.RefreshTokens.IgnoreQueryFilters().Where(token => userIds.Contains(token.UserId)).ExecuteDeleteAsync();
                await db.UserSafeguardingPreferences.IgnoreQueryFilters()
                    .Where(preference => userIds.Contains(preference.UserId))
                    .ExecuteDeleteAsync();
            }
            if (optionIds.Length > 0)
            {
                await db.SafeguardingOptions.IgnoreQueryFilters().Where(option => optionIds.Contains(option.Id)).ExecuteDeleteAsync();
            }
            if (!createdDeclinedOption && declinedOptionId > 0)
            {
                var declinedOption = await db.SafeguardingOptions.IgnoreQueryFilters()
                    .SingleOrDefaultAsync(option => option.Id == declinedOptionId);
                if (declinedOption != null)
                {
                    declinedOption.IsActive = originalDeclinedActive;
                    declinedOption.TriggersJson = originalDeclinedTriggers;
                    await db.SaveChangesAsync();
                }
            }
            if (userIds.Length > 0)
            {
                await db.Users.IgnoreQueryFilters().Where(user => userIds.Contains(user.Id)).ExecuteDeleteAsync();
            }
        }
    }

    private User NewUser(string email, string role, string firstName, string lastName, bool withPassword = false)
        => new()
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = withPassword
                ? BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword)
                : BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N")),
            FirstName = firstName,
            LastName = lastName,
            Role = role,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

    private static void AssertMemberProjection(
        JsonElement data,
        int userId,
        bool hasTriggers,
        bool declinationOnly)
    {
        var member = data.EnumerateArray().Single(item => item.GetProperty("user_id").GetInt32() == userId);
        member.GetProperty("options").GetArrayLength().Should().Be(1);
        member.GetProperty("has_triggers").GetBoolean().Should().Be(hasTriggers);
        member.GetProperty("is_declination_only").GetBoolean().Should().Be(declinationOnly);
        member.GetProperty("consent_given_at").ValueKind.Should().Be(JsonValueKind.String);
    }
}
