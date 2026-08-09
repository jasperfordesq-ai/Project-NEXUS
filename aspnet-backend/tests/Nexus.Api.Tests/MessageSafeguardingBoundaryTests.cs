// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class MessageSafeguardingBoundaryTests : IntegrationTestBase
{
    public MessageSafeguardingBoundaryTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public async Task RequestCoordinator_RestrictedRecipient_DeliversOnceAuditsEveryRequest()
    {
        await ConfigureRecipientOptionAsync("requires_coordinator_contact");
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        var transport = new RecordingEmailService();
        using var factory = Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(transport);
        }));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var first = await client.PostAsJsonAsync(
            $"/api/v2/messages/{TestData.AdminUser.Id}/request-coordinator", new { });
        using var second = await client.PostAsJsonAsync(
            $"/api/v2/messages/{TestData.AdminUser.Id}/request-coordinator", new { });

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
            .GetProperty("code").GetString().Should().Be("SAFEGUARDING_CONTACT_RESTRICTED");
        transport.Messages.Should().ContainSingle("a successful delivery is suppressed for ten minutes");
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Notifications.IgnoreQueryFilters().CountAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.Type == "safeguarding_coordination_requested")).Should().Be(1);
        (await db.AuditLogs.IgnoreQueryFilters().CountAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.UserId == TestData.MemberUser.Id
            && row.EntityId == TestData.AdminUser.Id
            && row.Action == "safeguarding_coordination_requested")).Should().Be(2);
    }

    [Fact]
    public async Task RequestCoordinator_UnrestrictedOrCrossTenant_ReturnsLaravel422WithoutDelivery()
    {
        await AuthenticateAsMemberAsync();

        using var unrestricted = await Client.PostAsJsonAsync(
            $"/api/v2/messages/{TestData.AdminUser.Id}/request-coordinator", new { });
        unrestricted.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadSingleErrorAsync(unrestricted)).GetProperty("code").GetString()
            .Should().Be("SAFEGUARDING_NOT_RESTRICTED");

        using var crossTenant = await Client.PostAsJsonAsync(
            $"/api/v2/messages/{TestData.OtherTenantUser.Id}/request-coordinator", new { });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadSingleErrorAsync(crossTenant)).GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task RequestCoordinator_UsesIndependentLaravelFivePerFiveMinuteBucket()
    {
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:RequestCoordinatorPermitLimit"] = "1",
                    ["RateLimiting:Messages:RequestCoordinatorWindowSeconds"] = "300"
                }));
        });
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var accepted = await client.PostAsJsonAsync(
            $"/api/v2/messages/{TestData.AdminUser.Id}/request-coordinator", new { });
        accepted.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        using var rejected = await client.PostAsJsonAsync(
            $"/api/v2/messages/{TestData.AdminUser.Id}/request-coordinator", new { });
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task V2Send_LegacyVerifiedVettingCannotAuthorize_ReturnsExactVettingErrorWithoutWrites()
    {
        await ConfigureRecipientOptionAsync("requires_vetted_partners", addLegacyVerifiedRecord: true);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "This must remain unsent"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("VETTING_REQUIRED");
        error.GetProperty("title").GetString().Should().Be("Safeguarding check needed");
        error.GetProperty("message").GetString().Should().Be(
            "This conversation is paused by a community safeguarding rule. Your community must have recorded a current Enhanced DBS confirmation for you before you can message this member. Ask your broker or community administrator to record this metadata-only status. Do not send or upload any vetting document.");
        error.GetProperty("detail").GetString().Should().Be(
            "This member can only be contacted for this type of interaction by members whose community has recorded a current Enhanced DBS status. The record is metadata only; no document should be sent or uploaded.");
        error.GetProperty("action_label").GetString().Should().Be("Open help");
        error.GetProperty("required_vetting_types").EnumerateArray()
            .Select(item => item.GetString()).Should().Equal("dbs_enhanced");
        error.GetProperty("required_vetting_labels").EnumerateArray()
            .Select(item => item.GetString()).Should().Equal("Enhanced DBS");
        await AssertNoMessageWriteSideEffectsAsync();
        (await CountSafeguardingBlockedAlertsAsync()).Should().Be(1);
    }

    [Fact]
    public async Task V2Conversation_ProjectsRestrictionWithoutRecordingAContactAttempt()
    {
        await ConfigureRecipientOptionAsync("requires_coordinator_contact");
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync($"/api/v2/messages/{TestData.AdminUser.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var safeguarding = json.GetProperty("meta")
            .GetProperty("conversation")
            .GetProperty("safeguarding");
        safeguarding.GetProperty("restricted").GetBoolean().Should().BeTrue();
        safeguarding.GetProperty("code").GetString().Should().Be("SAFEGUARDING_CONTACT_RESTRICTED");
        safeguarding.GetProperty("title").GetString().Should().Be("Coordinator arrangement needed");
        safeguarding.GetProperty("message").GetString().Should().Be(
            "This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.");
        safeguarding.GetProperty("required_vetting_types").GetArrayLength().Should().Be(0);
        safeguarding.GetProperty("required_vetting_labels").GetArrayLength().Should().Be(0);
        safeguarding.GetProperty("can_request_coordinator").GetBoolean().Should().BeTrue();
        await AssertNoMessageWriteSideEffectsAsync();
        (await CountSafeguardingBlockedAlertsAsync()).Should().Be(0,
            "opening a conversation is a read-only policy projection");
    }

    [Fact]
    public async Task V2Send_UnavailablePolicy_ReturnsExactRetryable503WithoutWrites()
    {
        await ConfigureRecipientOptionAsync("requires_vetted_partners", makePolicyUnavailable: true);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Fail closed"
        });

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("SAFEGUARDING_POLICY_UNAVAILABLE");
        error.GetProperty("message").GetString().Should().Be(
            "We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.");
        error.GetProperty("title").GetString().Should().Be("Safeguarding check temporarily unavailable");
        error.GetProperty("detail").GetString().Should().Be(
            "Project NEXUS could not safely evaluate the contact policy, so this interaction has been paused.");
        error.GetProperty("action_label").GetString().Should().Be("Check again");
        error.GetProperty("retryable").GetBoolean().Should().BeTrue();
        await AssertNoMessageWriteSideEffectsAsync();
    }

    [Fact]
    public async Task LegacySend_UsesTheSameSafeguardingBoundary()
    {
        await ConfigureRecipientOptionAsync("requires_coordinator_contact");
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Legacy route must not bypass the policy"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("SAFEGUARDING_CONTACT_RESTRICTED");
        await AssertNoMessageWriteSideEffectsAsync();
    }

    [Fact]
    public async Task V2Send_BlockCheckPrecedesSafeguardingAndDoesNotDisclosePolicy()
    {
        await ConfigureRecipientOptionAsync("requires_vetted_partners");
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserBlocks.Add(new UserBlock
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                BlockedUserId = TestData.MemberUser.Id,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Do not disclose the protected member's policy"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("BLOCKED");
        error.TryGetProperty("title", out _).Should().BeFalse();
        error.TryGetProperty("required_vetting_types", out _).Should().BeFalse();
        await AssertNoMessageWriteSideEffectsAsync();
    }

    [Fact]
    public async Task V2Send_CrossTenantRecipientIsOpaqueNotFound()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.OtherTenantUser.Id,
            body = "Cross-tenant target"
        });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("NOT_FOUND");
        error.GetProperty("message").GetString().Should().Be("Recipient not found");
        await AssertNoMessageWriteSideEffectsAsync();
    }

    [Fact]
    public async Task V2Send_PreservesLaravelRecipientBodyAndLengthContracts()
    {
        await AuthenticateAsMemberAsync();

        var missingRecipient = await Client.PostAsJsonAsync("/api/v2/messages", new { body = "hello" });
        missingRecipient.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var missingRecipientError = await ReadSingleErrorAsync(missingRecipient);
        missingRecipientError.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        missingRecipientError.GetProperty("message").GetString().Should().Be("recipient_id is required");
        missingRecipientError.GetProperty("field").GetString().Should().Be("recipient_id");

        var empty = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = ""
        });
        empty.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadSingleErrorAsync(empty)).GetProperty("message").GetString()
            .Should().Be("Message body or voice message is required");

        var tooLong = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = new string('x', 10_001)
        });
        tooLong.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadSingleErrorAsync(tooLong)).GetProperty("message").GetString()
            .Should().Be("Message is too long (max 10000 characters)");

        await AssertNoMessageWriteSideEffectsAsync();
    }

    [Fact]
    public async Task V2Send_AdministrativeMessagingDisablePrecedesSafeguarding()
    {
        await ConfigureRecipientOptionAsync("requires_vetted_partners");
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserMonitoringRestrictions.Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                MessagingDisabled = true,
                UnderMonitoring = false,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Administrative disable must win"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("MESSAGING_DISABLED");
        error.GetProperty("message").GetString()
            .Should().Be("Your messaging has been restricted by an administrator");
        error.TryGetProperty("required_vetting_types", out _).Should().BeFalse();
        await AssertNoMessageWriteSideEffectsAsync();
    }

    [Fact]
    public async Task V2RestrictionStatus_ProjectsLiveRestrictionAndPersistentlyClearsExpiry()
    {
        await AuthenticateAsMemberAsync();
        try
        {
            using (var seed = Factory.Services.CreateScope())
            {
                var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.UserMonitoringRestrictions.IgnoreQueryFilters()
                    .Where(row => row.TenantId == TestData.Tenant1.Id
                        && row.UserId == TestData.MemberUser.Id)
                    .ExecuteDeleteAsync();
                db.UserMonitoringRestrictions.Add(new UserMonitoringRestriction
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = TestData.MemberUser.Id,
                    UnderMonitoring = true,
                    MessagingDisabled = true,
                    Reason = "Coordinator safety review",
                    MonitoringExpiresAt = DateTime.UtcNow.AddHours(1),
                    CreatedAt = DateTime.UtcNow
                });
                await db.SaveChangesAsync();
            }

            var activeResponse = await Client.GetAsync("/api/v2/messages/restriction-status");
            activeResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var active = (await activeResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            active.GetProperty("messaging_disabled").GetBoolean().Should().BeTrue();
            active.GetProperty("under_monitoring").GetBoolean().Should().BeTrue();
            active.GetProperty("restriction_reason").GetString().Should().Be("Coordinator safety review");

            using (var expire = Factory.Services.CreateScope())
            {
                var db = expire.ServiceProvider.GetRequiredService<NexusDbContext>();
                var row = await db.UserMonitoringRestrictions.SingleAsync(item =>
                    item.TenantId == TestData.Tenant1.Id
                    && item.UserId == TestData.MemberUser.Id);
                row.MonitoringExpiresAt = DateTime.UtcNow.AddMinutes(-1);
                await db.SaveChangesAsync();
            }

            var expiredResponse = await Client.GetAsync("/api/v2/messages/restriction-status");
            expiredResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var expired = (await expiredResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            expired.GetProperty("messaging_disabled").GetBoolean().Should().BeFalse();
            expired.GetProperty("under_monitoring").GetBoolean().Should().BeFalse();
            expired.GetProperty("restriction_reason").GetString().Should().Be("Coordinator safety review");

            using var verify = Factory.Services.CreateScope();
            var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await verifyDb.UserMonitoringRestrictions.SingleAsync(item =>
                item.TenantId == TestData.Tenant1.Id
                && item.UserId == TestData.MemberUser.Id);
            stored.UnderMonitoring.Should().BeFalse();
            stored.MessagingDisabled.Should().BeFalse();
            stored.MonitoringExpiresAt.Should().BeNull();
        }
        finally
        {
            using var cleanup = Factory.Services.CreateScope();
            var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.UserMonitoringRestrictions.IgnoreQueryFilters()
                .Where(row => row.TenantId == TestData.Tenant1.Id
                    && row.UserId == TestData.MemberUser.Id)
                .ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task V2RestrictionStatus_UsesIndependentLaravelThirtyPerMinuteBucket()
    {
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:RestrictionStatusPermitLimit"] = "1",
                    ["RateLimiting:Messages:RestrictionStatusWindowSeconds"] = "60"
                }));
            builder.ConfigureServices(services =>
            {
                foreach (var hostedService in services
                             .Where(descriptor => descriptor.ServiceType == typeof(IHostedService)
                                 && descriptor.ImplementationType?.Assembly == typeof(Program).Assembly)
                             .ToList())
                {
                    services.Remove(hostedService);
                }
            });
        });
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        using (var accepted = await client.GetAsync("/api/v2/messages/restriction-status"))
        {
            accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using var rejected = await client.GetAsync("/api/v2/messages/restriction-status");
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        rejected.Headers.GetValues("X-RateLimit-Limit").Should().ContainSingle().Which.Should().Be("1");
        rejected.Headers.GetValues("X-RateLimit-Remaining").Should().ContainSingle().Which.Should().Be("0");
        rejected.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        rejected.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString());

        using var document = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync());
        document.RootElement.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "success", "error", "code" });
        document.RootElement.GetProperty("success").GetBoolean().Should().BeFalse();
        document.RootElement.GetProperty("error").GetString()
            .Should().Be("Rate limit exceeded. Please try again later.");
        document.RootElement.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
    }

    [Fact]
    public async Task V2Send_InvalidAttachmentLeavesNoDatabaseOrStoredFileSideEffects()
    {
        await AuthenticateAsMemberAsync();
        var filesBefore = SnapshotStoredFiles();
        using var form = MessageForm(
            TestData.AdminUser.Id,
            "Attachment validation",
            "blocked.exe",
            "application/x-msdownload",
            [0x4d, 0x5a]);

        var response = await Client.PostAsync("/api/v2/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("field").GetString().Should().Be("attachments");
        await AssertNoMessageWriteSideEffectsAsync();
        SnapshotStoredFiles().Should().BeEquivalentTo(filesBefore);
    }

    [Fact]
    public async Task V2Send_LockedRecheckRejectsPolicyRaceAndDeletesStagedUpload()
    {
        var benignPreference = await ConfigureRecipientOptionAsync("none_apply", addLegacyVerifiedRecord: true);
        int requiredOptionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            requiredOptionId = await db.SafeguardingOptions.IgnoreQueryFilters()
                .Where(option => option.TenantId == TestData.Tenant1.Id
                    && option.OptionKey == "requires_vetted_partners")
                .Select(option => option.Id)
                .SingleAsync();
        }
        await AuthenticateAsMemberAsync();

        using var lockScope = Factory.Services.CreateScope();
        var lockDb = lockScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var lockTransaction = await lockDb.Database.BeginTransactionAsync();
        await lockDb.Database.ExecuteSqlRawAsync(
            "SELECT \"Id\" FROM user_safeguarding_preferences WHERE \"Id\" = {0} FOR UPDATE",
            benignPreference.PreferenceId);

        var filename = $"policy-race-{Guid.NewGuid():N}.png";
        using var form = MessageForm(
            TestData.AdminUser.Id,
            "The definitive check must win",
            filename,
            "image/png",
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        var sendTask = Client.PostAsync("/api/v2/messages", form);

        FileUpload? stagedUpload = null;
        // File staging normally completes immediately, but a shared Docker
        // Desktop host can spend several seconds scheduling PostgreSQL while
        // other disposable suites are active. Keep polling the observable
        // boundary without weakening the locked-policy assertions below.
        for (var attempt = 0; attempt < 800 && stagedUpload == null; attempt++)
        {
            using var pollScope = Factory.Services.CreateScope();
            var pollDb = pollScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            stagedUpload = await pollDb.FileUploads.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(upload => upload.TenantId == TestData.Tenant1.Id
                    && upload.OriginalFilename == filename);
            if (stagedUpload == null)
            {
                await Task.Delay(25);
            }
        }
        stagedUpload.Should().NotBeNull("the upload is committed before the definitive locked decision");
        var stagedPath = lockScope.ServiceProvider.GetRequiredService<FileUploadService>()
            .GetFullPath(stagedUpload!);
        File.Exists(stagedPath).Should().BeTrue();

        await lockDb.Database.ExecuteSqlRawAsync(
            "UPDATE user_safeguarding_preferences SET \"OptionId\" = {0}, \"UpdatedAt\" = now() WHERE \"Id\" = {1}",
            requiredOptionId,
            benignPreference.PreferenceId);
        await lockTransaction.CommitAsync();

        var response = await sendTask.WaitAsync(TimeSpan.FromSeconds(60));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await ReadSingleErrorAsync(response);
        error.GetProperty("code").GetString().Should().Be("VETTING_REQUIRED");
        await AssertNoMessageWriteSideEffectsAsync();
        File.Exists(stagedPath).Should().BeFalse("a locked denial cleans the staged bytes");
        (await CountSafeguardingBlockedAlertsAsync()).Should().Be(1,
            "a denial discovered only at the definitive lock is still an actual POST attempt");
    }

    [Fact]
    public async Task V2Send_CurrentAttestationAllowsThenRevocationBlocksFurtherMessages()
    {
        await ConfigureRecipientOptionAsync("requires_vetted_partners", confirmCurrentAttestation: true);
        await AuthenticateAsMemberAsync();

        var allowed = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Current metadata-only confirmation allows this"
        });
        allowed.StatusCode.Should().Be(HttpStatusCode.Created);

        using (var scope = Factory.Services.CreateScope())
        {
            var attestations = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
            await attestations.RevokeForCurrentPolicyAsync(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                TestData.AdminUser.Id);
        }

        var denied = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Revocation must take effect immediately"
        });

        denied.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadSingleErrorAsync(denied)).GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(1);
        (await verifyDb.Conversations.IgnoreQueryFilters().CountAsync()).Should().Be(1);
    }

    private async Task<(int PreferenceId, int OptionId)> ConfigureRecipientOptionAsync(
        string optionKey,
        bool addLegacyVerifiedRecord = false,
        bool confirmCurrentAttestation = false,
        bool makePolicyUnavailable = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var jurisdictions = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        await jurisdictions.ConfigureAsync(
            TestData.Tenant1.Id,
            "england_wales",
            TestData.AdminUser.Id);
        var option = await db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id && row.OptionKey == optionKey);
        var preference = new UserSafeguardingPreference
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            OptionId = option.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.UserSafeguardingPreferences.Add(preference);
        if (addLegacyVerifiedRecord)
        {
            db.VettingRecords.Add(new VettingRecord
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                VettingType = "dbs_enhanced",
                Status = "verified",
                VerifiedById = TestData.AdminUser.Id,
                VerifiedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });
        }
        await db.SaveChangesAsync();

        if (confirmCurrentAttestation)
        {
            var attestations = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
            await attestations.ConfirmForCurrentPolicyAsync(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                TestData.AdminUser.Id);
        }
        if (makePolicyUnavailable)
        {
            await jurisdictions.ConfigureAsync(
                TestData.Tenant1.Id,
                "custom",
                TestData.AdminUser.Id);
        }

        return (preference.Id, option.Id);
    }

    private async Task AssertNoMessageWriteSideEffectsAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Conversations.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.MessageAttachments.CountAsync()).Should().Be(0);
        (await db.FileUploads.IgnoreQueryFilters().CountAsync(upload => upload.Category == FileCategory.Message))
            .Should().Be(0);
    }

    private async Task<int> CountSafeguardingBlockedAlertsAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.Type == "safeguarding_contact_blocked");
    }

    private static async Task<JsonElement> ReadSingleErrorAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("errors").EnumerateArray().Single();
    }

    private static MultipartFormDataContent MessageForm(
        int recipientId,
        string body,
        string filename,
        string contentType,
        byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(recipientId.ToString()), "recipient_id");
        form.Add(new StringContent(body), "body");
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "attachments[]", filename);
        return form;
    }

    private static string[] SnapshotStoredFiles()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "uploads");
        return Directory.Exists(root)
            ? Directory.GetFiles(root, "*", SearchOption.AllDirectories)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray()
            : [];
    }

    private sealed class RecordingEmailService : IEmailService
    {
        public List<string> Messages { get; } = [];

        public Task<bool> SendEmailAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken ct = default)
        {
            Messages.Add(to);
            return Task.FromResult(true);
        }

        public Task<bool> SendPasswordResetEmailAsync(
            string to,
            string resetToken,
            string userName,
            string resetUrl,
            CancellationToken ct = default) => Task.FromResult(true);

        public Task<bool> SendWelcomeEmailAsync(
            string to,
            string userName,
            string tenantName,
            CancellationToken ct = default) => Task.FromResult(true);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(true);
    }
}
