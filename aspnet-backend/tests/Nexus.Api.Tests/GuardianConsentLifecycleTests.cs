// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
public sealed class GuardianConsentLifecycleTests : IntegrationTestBase
{
    private const string DirectConsentConfigKey = "volunteering.guardian_consent_required";

    public GuardianConsentLifecycleTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Request_ValidatesPersistsRedactsLogsEmailAndHonoursModuleConfigBlob()
    {
        await ConfigureMinorAsync();
        await AuthenticateAsAdminAsync();

        var configUpdate = await Client.PutAsJsonAsync(
            "/api/v2/admin/config/volunteering/bulk",
            new
            {
                settings = new Dictionary<string, object>
                {
                    [DirectConsentConfigKey] = true
                }
            });
        configUpdate.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var configScope = Factory.Services.CreateScope())
        {
            var db = configScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var directValue = await db.TenantConfigs.IgnoreQueryFilters()
                .Where(config =>
                    config.TenantId == TestData.Tenant1.Id
                    && config.Key == DirectConsentConfigKey)
                .Select(config => config.Value)
                .SingleAsync();
            directValue.Should().Be("true", "the React admin blob write must mirror the gate's authoritative direct key");
        }

        await AuthenticateAsMemberAsync();

        var invalid = await Client.PostAsJsonAsync(
            "/api/v2/volunteering/guardian-consents",
            new
            {
                guardian_email = "guardian@example.test",
                relationship = "parent"
            });

        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var invalidBody = await ReadJsonAsync(invalid);
        invalidBody.TryGetProperty("meta", out _).Should().BeFalse();
        var invalidError = invalidBody.GetProperty("errors")[0];
        invalidError.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        invalidError.GetProperty("message").GetString().Should().Be("Guardian name is required.");
        invalidError.TryGetProperty("field", out _).Should().BeFalse();

        using (var gateScope = Factory.Services.CreateScope())
        {
            var gate = gateScope.ServiceProvider.GetRequiredService<VolunteerGuardianConsentService>();
            (await gate.IsBlockedAsync(
                TestData.MemberUser.Id,
                TestData.Tenant1.Id,
                opportunityId: null))
                .Should().BeTrue("the React admin toggle mirrors into the guardian gate's authoritative direct key");
        }

        var requestedAfter = DateTime.UtcNow;
        var response = await Client.PostAsJsonAsync(
            "/api/v2/volunteering/guardian-consents",
            new
            {
                guardian_name = "  Casey Guardian  ",
                guardian_email = "guardian@example.test",
                guardian_phone = "  +353 1 555 0100  ",
                relationship = "parent"
            });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var responseText = await response.Content.ReadAsStringAsync();
        using var responseDocument = JsonDocument.Parse(responseText);
        var body = responseDocument.RootElement;
        AssertBaseMeta(body);
        var data = body.GetProperty("data");
        var consentId = data.GetProperty("id").GetInt32();
        data.GetProperty("minor_user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("guardian_name").GetString().Should().Be("Casey Guardian");
        data.GetProperty("guardian_email").GetString().Should().Be("guardian@example.test");
        data.GetProperty("guardian_phone").GetString().Should().Be("+353 1 555 0100");
        data.GetProperty("relationship").GetString().Should().Be("parent");
        data.GetProperty("status").GetString().Should().Be("pending");
        data.GetProperty("consent_given_at").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("consent_withdrawn_at").ValueKind.Should().Be(JsonValueKind.Null);
        var wireExpiry = data.GetProperty("expires_at").GetDateTime();
        wireExpiry.Should().BeAfter(requestedAfter.AddDays(364));
        wireExpiry.Should().BeBefore(DateTime.UtcNow.AddDays(366));
        responseText.Should().NotContain("consent_token", "the email credential and its hash are server-only");
        responseText.Should().NotContain("consent_ip");

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.VolunteerGuardianConsents.IgnoreQueryFilters()
                .SingleAsync(consent => consent.Id == consentId);
            stored.TenantId.Should().Be(TestData.Tenant1.Id);
            stored.MinorUserId.Should().Be(TestData.MemberUser.Id);
            stored.Status.Should().Be(VolunteerGuardianConsentStatus.Pending);
            stored.ConsentTokenHash.Should().MatchRegex("^[0-9a-f]{64}$");
            stored.ConsentIp.Should().BeNull();
            stored.ConsentedAt.Should().BeNull();
            responseText.Should().NotContain(stored.ConsentTokenHash!);

            var emailLog = await db.EmailLogs.IgnoreQueryFilters()
                .SingleAsync(log => log.TemplateKey == "guardian_consent");
            emailLog.TenantId.Should().Be(TestData.Tenant1.Id);
            emailLog.ToEmail.Should().Be("guardian@example.test");
            emailLog.Subject.Should().Be("Guardian Consent Request — Project NEXUS");

            stored.Status = VolunteerGuardianConsentStatus.Active;
            stored.ConsentedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        using (var gateScope = Factory.Services.CreateScope())
        {
            var gate = gateScope.ServiceProvider.GetRequiredService<VolunteerGuardianConsentService>();
            (await gate.IsBlockedAsync(
                TestData.MemberUser.Id,
                TestData.Tenant1.Id,
                opportunityId: null))
                .Should().BeFalse("an active unexpired consent unblocks the blob-configured gate");
        }
    }

    [Fact]
    public async Task AnonymousLookup_IsReadOnlyAndPostVerifyIsTenantScopedSingleUse()
    {
        var rawToken = RawToken("tenant-scoped-single-use");
        int consentId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var consent = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Pending,
                rawToken);
            db.VolunteerGuardianConsents.Add(consent);
            await db.SaveChangesAsync();
            consentId = consent.Id;
        }

        using var wrongTenantClient = AnonymousTenantClient(TestData.Tenant2.Id);
        var wrongTenant = await wrongTenantClient.GetAsync(VerifyPath(rawToken));
        await AssertErrorAsync(wrongTenant, HttpStatusCode.BadRequest, "INVALID_TOKEN");

        using var correctTenantClient = AnonymousTenantClient(TestData.Tenant1.Id);
        var lookup = await correctTenantClient.GetAsync(VerifyPath(rawToken));
        lookup.StatusCode.Should().Be(HttpStatusCode.OK);
        var lookupBody = await ReadJsonAsync(lookup);
        AssertBaseMeta(lookupBody);
        lookupBody.GetProperty("data").GetProperty("status").GetString().Should().Be("pending");
        lookupBody.GetProperty("data").GetProperty("valid").GetBoolean().Should().BeTrue();

        using (var readOnlyCheck = Factory.Services.CreateScope())
        {
            var readOnlyDb = readOnlyCheck.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await readOnlyDb.VolunteerGuardianConsents.IgnoreQueryFilters()
                .SingleAsync(consent => consent.Id == consentId)).Status
                .Should().Be(VolunteerGuardianConsentStatus.Pending);
            (await readOnlyDb.Notifications.IgnoreQueryFilters().CountAsync(notification =>
                notification.Type == "guardian_consent"
                && notification.Data != null
                && notification.Data.Contains($"\"consent_id\":{consentId}")))
                .Should().Be(0);
        }

        var granted = await correctTenantClient.PostAsync(VerifyPath(rawToken), null);
        granted.StatusCode.Should().Be(HttpStatusCode.OK);
        var grantedBody = await ReadJsonAsync(granted);
        AssertBaseMeta(grantedBody);
        grantedBody.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();
        grantedBody.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("Guardian consent has been granted successfully.");
        grantedBody.ToString().Should().NotContain(rawToken);

        var completedLookup = await correctTenantClient.GetAsync(VerifyPath(rawToken));
        completedLookup.StatusCode.Should().Be(HttpStatusCode.OK);
        var completedBody = await ReadJsonAsync(completedLookup);
        completedBody.GetProperty("data").GetProperty("status").GetString().Should().Be("active");
        completedBody.GetProperty("data").GetProperty("valid").GetBoolean().Should().BeFalse();

        var retry = await correctTenantClient.PostAsync(VerifyPath(rawToken), null);
        await AssertErrorAsync(retry, HttpStatusCode.BadRequest, "INVALID_TOKEN");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.VolunteerGuardianConsents.IgnoreQueryFilters()
            .SingleAsync(consent => consent.Id == consentId);
        stored.Status.Should().Be(VolunteerGuardianConsentStatus.Active);
        stored.ConsentedAt.Should().NotBeNull();
        stored.ConsentIp.Should().NotBeNullOrWhiteSpace();
        (await verifyDb.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.Type == "guardian_consent"
            && notification.Data != null
            && notification.Data.Contains($"\"consent_id\":{consentId}")))
            .Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentAnonymousVerify_HasExactlyOneWinnerAndOneNotification()
    {
        var rawToken = RawToken("concurrent-one-winner");
        int consentId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var consent = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Pending,
                rawToken);
            db.VolunteerGuardianConsents.Add(consent);
            await db.SaveChangesAsync();
            consentId = consent.Id;
        }

        using var firstClient = AnonymousTenantClient(TestData.Tenant1.Id);
        using var secondClient = AnonymousTenantClient(TestData.Tenant1.Id);
        var responses = await Task.WhenAll(
            firstClient.PostAsync(VerifyPath(rawToken), null),
            secondClient.PostAsync(VerifyPath(rawToken), null));

        responses.Select(response => response.StatusCode).Should().BeEquivalentTo(
            new[] { HttpStatusCode.OK, HttpStatusCode.BadRequest });
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.BadRequest);
        await AssertErrorAsync(loser, HttpStatusCode.BadRequest, "INVALID_TOKEN");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerGuardianConsents.IgnoreQueryFilters()
            .SingleAsync(consent => consent.Id == consentId))
            .Status.Should().Be(VolunteerGuardianConsentStatus.Active);
        (await verifyDb.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.Type == "guardian_consent"
            && notification.Data != null
            && notification.Data.Contains($"\"consent_id\":{consentId}")))
            .Should().Be(1);
    }

    [Fact]
    public async Task Withdraw_AllowsOwnerAndAdminButHidesCrossTenantConsent()
    {
        int ownerConsentId;
        int adminConsentId;
        int crossTenantTargetId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var ownerConsent = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Active,
                RawToken("owner-withdraw"));
            var adminConsent = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Active,
                RawToken("admin-withdraw"));
            var crossTenantTarget = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Active,
                RawToken("cross-tenant-withdraw"));
            db.VolunteerGuardianConsents.AddRange(ownerConsent, adminConsent, crossTenantTarget);
            await db.SaveChangesAsync();
            ownerConsentId = ownerConsent.Id;
            adminConsentId = adminConsent.Id;
            crossTenantTargetId = crossTenantTarget.Id;
        }

        await AuthenticateAsMemberAsync();
        var ownerResponse = await Client.DeleteAsync(ConsentPath(ownerConsentId));
        ownerResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var ownerBody = await ReadJsonAsync(ownerResponse);
        AssertBaseMeta(ownerBody);
        ownerBody.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        await AuthenticateAsAdminAsync();
        var adminResponse = await Client.DeleteAsync(ConsentPath(adminConsentId));
        adminResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertBaseMeta(await ReadJsonAsync(adminResponse));

        await AuthenticateAsOtherTenantUserAsync();
        var crossTenantResponse = await Client.DeleteAsync(ConsentPath(crossTenantTargetId));
        await AssertErrorAsync(crossTenantResponse, HttpStatusCode.NotFound, "NOT_FOUND");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rows = await verifyDb.VolunteerGuardianConsents.IgnoreQueryFilters()
            .Where(consent => consent.Id == ownerConsentId
                || consent.Id == adminConsentId
                || consent.Id == crossTenantTargetId)
            .ToDictionaryAsync(consent => consent.Id);
        rows[ownerConsentId].Status.Should().Be(VolunteerGuardianConsentStatus.Withdrawn);
        rows[ownerConsentId].RevokedAt.Should().NotBeNull();
        rows[adminConsentId].Status.Should().Be(VolunteerGuardianConsentStatus.Withdrawn);
        rows[adminConsentId].RevokedAt.Should().NotBeNull();
        rows[crossTenantTargetId].Status.Should().Be(VolunteerGuardianConsentStatus.Active);
        rows[crossTenantTargetId].RevokedAt.Should().BeNull();

        var withdrawalNotifications = await verifyDb.Notifications.IgnoreQueryFilters()
            .Where(notification => notification.Type == "guardian_consent")
            .ToListAsync();
        withdrawalNotifications.Should().HaveCount(2);
        withdrawalNotifications.Single(notification =>
                notification.Data!.Contains($"\"consent_id\":{ownerConsentId}"))
            .Body.Should().Be("Guardian consent has been withdrawn from your volunteering activities.");
        withdrawalNotifications.Single(notification =>
                notification.Data!.Contains($"\"consent_id\":{adminConsentId}"))
            .Body.Should().Be("Guardian consent has been withdrawn by an administrator.");
    }

    [Fact]
    public async Task MemberAndAdminReads_RedactSecretsAndAdminStatusCursorIsTenantScoped()
    {
        int[] localPendingIds;
        int localActiveId;
        int otherTenantId;
        string[] secretHashes;
        string opportunityTitle;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id);
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            opportunityTitle = opportunity.Title;

            var pending = Enumerable.Range(1, 3)
                .Select(index => NewConsent(
                    TestData.Tenant1.Id,
                    TestData.MemberUser.Id,
                    VolunteerGuardianConsentStatus.Pending,
                    RawToken($"admin-page-pending-{index}"),
                    opportunityId: opportunity.Id,
                    createdAt: DateTime.UtcNow.AddMinutes(-index)))
                .ToArray();
            var active = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Active,
                RawToken("admin-page-active"),
                opportunityId: opportunity.Id);
            var otherTenant = NewConsent(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                VolunteerGuardianConsentStatus.Pending,
                RawToken("admin-page-other-tenant"));
            db.VolunteerGuardianConsents.AddRange(pending.Concat(new[] { active, otherTenant }));
            await db.SaveChangesAsync();

            localPendingIds = pending.Select(consent => consent.Id).OrderByDescending(id => id).ToArray();
            localActiveId = active.Id;
            otherTenantId = otherTenant.Id;
            secretHashes = pending.Append(active).Append(otherTenant)
                .Select(consent => consent.ConsentTokenHash!)
                .ToArray();
        }

        await AuthenticateAsMemberAsync();
        var memberResponse = await Client.GetAsync("/api/v2/volunteering/guardian-consents");
        memberResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var memberText = await memberResponse.Content.ReadAsStringAsync();
        using (var memberDocument = JsonDocument.Parse(memberText))
        {
            AssertBaseMeta(memberDocument.RootElement);
            var memberIds = memberDocument.RootElement.GetProperty("data")
                .EnumerateArray()
                .Select(item => item.GetProperty("id").GetInt32())
                .ToArray();
            memberIds.Should().BeEquivalentTo(localPendingIds.Append(localActiveId));
            memberIds.Should().NotContain(otherTenantId);
        }
        AssertSecretsRedacted(memberText, secretHashes);

        await AuthenticateAsAdminAsync();
        var firstResponse = await Client.GetAsync(
            "/api/v2/admin/volunteering/guardian-consents?status=pending&limit=2");
        firstResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstText = await firstResponse.Content.ReadAsStringAsync();
        using var firstDocument = JsonDocument.Parse(firstText);
        var firstBody = firstDocument.RootElement;
        AssertBaseMeta(firstBody);
        var firstPage = firstBody.GetProperty("data");
        var firstItems = firstPage.GetProperty("items").EnumerateArray().ToList();
        firstItems.Select(item => item.GetProperty("id").GetInt32())
            .Should().Equal(localPendingIds.Take(2));
        firstPage.GetProperty("has_more").GetBoolean().Should().BeTrue();
        var cursor = firstPage.GetProperty("cursor").GetInt32();
        cursor.Should().Be(localPendingIds[1]);
        var firstItem = firstItems[0];
        firstItem.GetProperty("minor_name").GetString().Should().Be("Member User");
        firstItem.GetProperty("minor_email").GetString().Should().Be(TestData.MemberUser.Email);
        firstItem.GetProperty("opportunity_title").GetString().Should().Be(opportunityTitle);
        firstItem.GetProperty("status").GetString().Should().Be("pending");
        firstItem.GetProperty("consent_date").GetString().Should().NotBeNullOrWhiteSpace();
        firstItem.GetProperty("expires_date").GetString().Should().NotBeNullOrWhiteSpace();
        AssertSecretsRedacted(firstText, secretHashes);

        var secondResponse = await Client.GetAsync(
            $"/api/v2/admin/volunteering/guardian-consents?status=pending&limit=2&cursor={cursor}");
        secondResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondText = await secondResponse.Content.ReadAsStringAsync();
        using var secondDocument = JsonDocument.Parse(secondText);
        var secondPage = secondDocument.RootElement.GetProperty("data");
        secondPage.GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("id").GetInt32())
            .Should().Equal(localPendingIds.Skip(2));
        secondPage.GetProperty("has_more").GetBoolean().Should().BeFalse();
        secondPage.GetProperty("cursor").GetInt32().Should().Be(localPendingIds[2]);
        AssertSecretsRedacted(secondText, secretHashes);
    }

    [Fact]
    public async Task RegisteredGlobalExpiryJob_ExpiresOnlyOverduePendingAndActiveRowsAcrossTenants()
    {
        int overduePendingId;
        int overdueActiveId;
        int freshPendingId;
        int withdrawnId;
        int alreadyExpiredId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var overduePending = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Pending,
                RawToken("expiry-pending"),
                expiresAt: DateTime.UtcNow.AddDays(-1));
            var overdueActive = NewConsent(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                VolunteerGuardianConsentStatus.Active,
                RawToken("expiry-active-other-tenant"),
                expiresAt: DateTime.UtcNow.AddMinutes(-1));
            var freshPending = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Pending,
                RawToken("expiry-fresh"),
                expiresAt: DateTime.UtcNow.AddDays(10));
            var withdrawn = NewConsent(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                VolunteerGuardianConsentStatus.Withdrawn,
                RawToken("expiry-withdrawn"),
                expiresAt: DateTime.UtcNow.AddDays(-2));
            var alreadyExpired = NewConsent(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                VolunteerGuardianConsentStatus.Expired,
                RawToken("expiry-already-expired"),
                expiresAt: DateTime.UtcNow.AddDays(-3));
            db.VolunteerGuardianConsents.AddRange(
                overduePending,
                overdueActive,
                freshPending,
                withdrawn,
                alreadyExpired);
            await db.SaveChangesAsync();
            overduePendingId = overduePending.Id;
            overdueActiveId = overdueActive.Id;
            freshPendingId = freshPending.Id;
            withdrawnId = withdrawn.Id;
            alreadyExpiredId = alreadyExpired.Id;
        }

        var registered = Factory.Services.GetServices<IHostedService>()
            .OfType<VolunteerGuardianConsentExpiryJob>()
            .ToList();
        var job = registered.Should().ContainSingle().Which;
        job.Name.Should().Be("VolunteerGuardianConsentExpiry");
        job.ResolvedInterval.Should().Be(TimeSpan.FromDays(1));

        var run = await job.RunNowAsync();
        run.Outcome.Should().Be(ScheduledJobExecutionOutcome.Success);
        run.Persisted.Should().BeTrue();
        run.Output.Should().Be("VolunteerGuardianConsentExpiry manual run completed successfully.");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rows = await verifyDb.VolunteerGuardianConsents.IgnoreQueryFilters()
            .Where(consent => consent.Id == overduePendingId
                || consent.Id == overdueActiveId
                || consent.Id == freshPendingId
                || consent.Id == withdrawnId
                || consent.Id == alreadyExpiredId)
            .ToDictionaryAsync(consent => consent.Id);
        rows[overduePendingId].Status.Should().Be(VolunteerGuardianConsentStatus.Expired);
        rows[overdueActiveId].Status.Should().Be(VolunteerGuardianConsentStatus.Expired);
        rows[freshPendingId].Status.Should().Be(VolunteerGuardianConsentStatus.Pending);
        rows[withdrawnId].Status.Should().Be(VolunteerGuardianConsentStatus.Withdrawn);
        rows[alreadyExpiredId].Status.Should().Be(VolunteerGuardianConsentStatus.Expired);

        var runRow = await verifyDb.ScheduledJobRuns
            .SingleAsync(row => row.Id == run.RunRecordId);
        runRow.JobName.Should().Be("VolunteerGuardianConsentExpiry");
        runRow.Status.Should().Be(ScheduledJobRunStatus.Success);
    }

    [Fact]
    public async Task LegacyAdminMutationRoutes_AreRetiredInsteadOfBypassingGuardianVerification()
    {
        await AuthenticateAsAdminAsync();

        var paths = new[]
        {
            "/api/admin/volunteer/guardian-consents",
            "/api/admin/volunteer/guardian-consents/123/approve",
            "/api/admin/volunteer/guardian-consents/123/reject",
            "/api/admin/volunteer/guardian-consents/123/revoke"
        };

        foreach (var path in paths)
        {
            var response = await Client.PostAsJsonAsync(path, new
            {
                minor_user_id = TestData.MemberUser.Id,
                guardian_name = "Legacy Guardian",
                guardian_email = "guardian@example.test",
                guardian_relationship = "parent",
                note = "must not mutate consent"
            });

            response.StatusCode.Should().Be(HttpStatusCode.Gone, path);
            var body = await ReadJsonAsync(response);
            var errors = body.GetProperty("errors").EnumerateArray().ToList();
            errors.Should().ContainSingle();
            errors[0].GetProperty("code").GetString().Should().Be("ENDPOINT_RETIRED");
            errors[0].GetProperty("message").GetString().Should().Contain("secure email verification link");
        }
    }

    private async Task ConfigureMinorAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var dateOfBirth = DateTime.UtcNow.AddYears(-15).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var profile = JsonSerializer.Serialize(new { date_of_birth = dateOfBirth });
        await db.Users.IgnoreQueryFilters()
            .Where(user => user.Id == TestData.MemberUser.Id && user.TenantId == TestData.Tenant1.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(
                user => user.NotificationPreferences,
                profile));

        await db.SaveChangesAsync();
    }

    private static VolunteerGuardianConsent NewConsent(
        int tenantId,
        int minorUserId,
        VolunteerGuardianConsentStatus status,
        string rawToken,
        int? opportunityId = null,
        DateTime? expiresAt = null,
        DateTime? createdAt = null)
    {
        var now = DateTime.UtcNow;
        return new VolunteerGuardianConsent
        {
            TenantId = tenantId,
            MinorUserId = minorUserId,
            OpportunityId = opportunityId,
            GuardianName = "Test Guardian",
            GuardianEmail = "guardian@example.test",
            GuardianPhone = "+353 1 555 0100",
            GuardianRelationship = "parent",
            ConsentTokenHash = Sha256(rawToken),
            Status = status,
            ConsentedAt = status == VolunteerGuardianConsentStatus.Active ? now.AddHours(-1) : null,
            ConsentIp = status == VolunteerGuardianConsentStatus.Active ? "203.0.113.7" : null,
            RevokedAt = status == VolunteerGuardianConsentStatus.Withdrawn ? now.AddHours(-1) : null,
            ExpiresAt = expiresAt ?? now.AddDays(30),
            CreatedAt = createdAt ?? now.AddDays(-1)
        };
    }

    private static VolunteerOpportunity NewOpportunity(int tenantId, int organizerId) => new()
    {
        TenantId = tenantId,
        OrganizerId = organizerId,
        Title = $"Guardian consent opportunity {Guid.NewGuid():N}",
        Description = "Guardian consent lifecycle integration test",
        Status = OpportunityStatus.Published,
        RequiredVolunteers = 2,
        CreatedAt = DateTime.UtcNow
    };

    private HttpClient AnonymousTenantClient(int tenantId)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-ID", tenantId.ToString(CultureInfo.InvariantCulture));
        return client;
    }

    private static string ConsentPath(int consentId) =>
        $"/api/v2/volunteering/guardian-consents/{consentId}";

    private static string VerifyPath(string token) =>
        $"/api/v2/volunteering/guardian-consents/verify/{token}";

    private static string RawToken(string seed) => Sha256($"raw:{seed}");

    private static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static async Task AssertErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode expectedStatus,
        string expectedCode)
    {
        response.StatusCode.Should().Be(expectedStatus);
        var body = await ReadJsonAsync(response);
        body.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(expectedCode);
    }

    private static void AssertBaseMeta(JsonElement body) =>
        body.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();

    private static void AssertSecretsRedacted(string responseText, IEnumerable<string> hashes)
    {
        responseText.Should().NotContain("consent_token");
        responseText.Should().NotContain("consent_ip");
        foreach (var hash in hashes)
        {
            responseText.Should().NotContain(hash);
        }
    }
}
