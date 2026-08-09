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
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class DirectMessageEditDeleteParityTests : IntegrationTestBase
{
    public DirectMessageEditDeleteParityTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public void Routes_HaveOneCanonicalOwnerAndIndependentLaravelRatePolicies()
    {
        var endpoints = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Distinct()
            .SelectMany(endpoint =>
            {
                var action = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                if (action == null || methods == null)
                {
                    return Array.Empty<(string Method, string Route, string Controller, string Action, string? Policy)>();
                }

                return methods.Select(method => (
                    Method: method.ToUpperInvariant(),
                    Route: (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/').ToLowerInvariant(),
                    Controller: action.ControllerName,
                    Action: action.ActionName,
                    Policy: endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName));
            })
            .ToArray();

        foreach (var prefix in new[] { "api/messages", "api/v2/messages" })
        {
            var edit = endpoints.Where(endpoint => endpoint.Method == "PUT"
                    && endpoint.Route == $"{prefix}/{{id:int}}")
                .Should().ContainSingle().Which;
            edit.Controller.Should().Be("DirectMessageMutations");
            edit.Action.Should().Be("EditMessage");
            edit.Policy.Should().Be(RateLimitingExtensions.MessagesEditPolicy);

            var delete = endpoints.Where(endpoint => endpoint.Method == "DELETE"
                    && endpoint.Route == $"{prefix}/{{id:int}}")
                .Should().ContainSingle().Which;
            delete.Controller.Should().Be("DirectMessageMutations");
            delete.Action.Should().Be("DeleteMessage");
            delete.Policy.Should().Be(RateLimitingExtensions.MessagesDeletePolicy);
        }

        foreach (var route in new[]
                 {
                     "api/messages/conversations/{otheruserid:int}",
                     "api/v2/messages/conversations/{otheruserid:int}"
                 })
        {
            var archive = endpoints.Where(endpoint => endpoint.Method == "DELETE"
                    && endpoint.Route == route)
                .Should().ContainSingle().Which;
            archive.Controller.Should().Be("Messages");
            archive.Action.Should().Be("ArchiveConversation");
            archive.Policy.Should().Be(RateLimitingExtensions.MessagesArchivePolicy);
        }

        var compactArchive = endpoints.Where(endpoint => endpoint.Method == "DELETE"
                && endpoint.Route == "api/v2/conversations/{otheruserid:int}")
            .Should().ContainSingle().Which;
        compactArchive.Controller.Should().Be("Messages");
        compactArchive.Action.Should().Be("ArchiveConversationAlias");
        compactArchive.Policy.Should().Be(RateLimitingExtensions.MessagesArchivePolicy);

        foreach (var route in new[]
                 {
                     "api/messages/conversations/{otheruserid:int}/restore",
                     "api/v2/messages/conversations/{otheruserid:int}/restore"
                 })
        {
            var restore = endpoints.Where(endpoint => endpoint.Method == "POST"
                    && endpoint.Route == route)
                .Should().ContainSingle().Which;
            restore.Controller.Should().Be("Messages");
            restore.Action.Should().Be("RestoreConversation");
            restore.Policy.Should().Be(RateLimitingExtensions.MessagesRestorePolicy);
        }
    }

    [Fact]
    public async Task Edit_TrimsCountsUnicodeStripsHtmlAndPersistsExactLaravelProjection()
    {
        var originalCreatedAt = DateTime.UtcNow.AddMinutes(-5);
        var messageId = await SeedMessageAsync(
            TestData.MemberUser.Id,
            "Original body",
            originalCreatedAt);
        await AuthenticateAsMemberAsync();

        using var response = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new
        {
            body = "  <strong>Hello 😀</strong>  "
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "data", "meta" });
        var data = json.GetProperty("data");
        data.EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(new[]
        {
            "id", "body", "is_edited", "sender_id", "created_at"
        });
        data.GetProperty("id").GetInt32().Should().Be(messageId);
        data.GetProperty("body").GetString().Should().Be("Hello 😀");
        data.GetProperty("is_edited").GetBoolean().Should().BeTrue();
        data.GetProperty("sender_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        json.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
        stored.Content.Should().Be("Hello 😀");
        stored.IsEdited.Should().BeTrue();
        stored.EditedAt.Should().NotBeNull();
        stored.CreatedAt.Should().BeCloseTo(originalCreatedAt, TimeSpan.FromMilliseconds(1));
    }

    [Theory]
    [InlineData("1 < 2 and 3 > 2", "1 < 2 and 3 > 2")]
    [InlineData("<strong>Hello</strong>", "Hello")]
    [InlineData("hello <broken", "hello ")]
    [InlineData("x <", "x ")]
    [InlineData("a<!--x-->b", "ab")]
    [InlineData("a<script>x</script>b", "axb")]
    [InlineData("x <> y", "x  y")]
    [InlineData("x <3 y", "x ")]
    [InlineData("x <img src=\"x>y\"> z", "x  z")]
    [InlineData("x <<b>>y", "x y")]
    public void PhpStripTagsOracle_PreservesLiteralComparisonsAndMatchesMalformedTags(
        string input,
        string expected)
    {
        PhpTextSanitizer.StripTags(input).Should().Be(expected);
    }

    [Fact]
    public async Task Edit_EnforcesBodyRuneLimitSenderTenantAndTwentyFourHourWindow()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Original");
        await AuthenticateAsMemberAsync();

        using (var noBodyRequest = new HttpRequestMessage(HttpMethod.Put, $"/api/v2/messages/{messageId}"))
        using (var noBody = await Client.SendAsync(noBodyRequest))
        {
            noBody.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(noBody, "VALIDATION_ERROR", "Message body is required", "body");
        }

        using (var empty = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "   " }))
        {
            empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(empty, "VALIDATION_ERROR", "Message body is required", "body");
        }

        using (var tooLong = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new
               {
                   body = string.Concat(Enumerable.Repeat("😀", 10_001))
               }))
        {
            tooLong.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(
                tooLong,
                "VALIDATION_ERROR",
                "Message is too long (max 10000 characters)",
                "body");
        }

        await AuthenticateAsAdminAsync();
        using (var receiver = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "No" }))
        {
            receiver.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await AssertErrorAsync(receiver, "FORBIDDEN", "You can only edit your own messages");
        }

        await AuthenticateAsOtherTenantUserAsync();
        using (var crossTenant = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "No" }))
        {
            crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
            await AssertErrorAsync(crossTenant, "NOT_FOUND", "Message not found");
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await db.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
            stored.CreatedAt = DateTime.UtcNow.AddHours(-25);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        using var expired = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "Too late" });
        expired.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(
            expired,
            "EDIT_EXPIRED",
            "Messages can only be edited within 24 hours of sending");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId))
            .Content.Should().Be("Original");
    }

    [Fact]
    public async Task Edit_RechecksCurrentRestrictionThenBlockWithoutChangingMessage()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Original");
        using (var setup = Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserMonitoringRestrictions.Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                UnderMonitoring = true,
                MessagingDisabled = true,
                Reason = "Current safety restriction",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        await AuthenticateAsMemberAsync();

        using (var restricted = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "Blocked" }))
        {
            restricted.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await AssertErrorAsync(
                restricted,
                "MESSAGING_DISABLED",
                "Your messaging has been restricted by an administrator");
        }

        using (var setup = Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.UserMonitoringRestrictions.IgnoreQueryFilters().ExecuteDeleteAsync();
            db.UserBlocks.Add(new UserBlock
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                BlockedUserId = TestData.MemberUser.Id,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        using (var blocked = await Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "Blocked" }))
        {
            blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await AssertErrorAsync(blocked, "BLOCKED", "You cannot send messages to this user");
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
        stored.Content.Should().Be("Original");
        stored.IsEdited.Should().BeFalse();
    }

    [Fact]
    public async Task Edit_WaitsForConcurrentBlockInsertAndRejectsAfterItCommits()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Original");
        await AuthenticateAsMemberAsync();

        using var writerScope = Factory.Services.CreateScope();
        var writerDb = writerScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var writerTransaction = await writerDb.Database.BeginTransactionAsync();
        writerDb.UserBlocks.Add(new UserBlock
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            BlockedUserId = TestData.MemberUser.Id,
            CreatedAt = DateTime.UtcNow
        });
        await writerDb.SaveChangesAsync();

        var editTask = Client.PutAsJsonAsync(
            $"/api/v2/messages/{messageId}",
            new { body = "Concurrent block must win" });
        await Task.Delay(150);
        editTask.IsCompleted.Should().BeFalse(
            "the edit's FOR UPDATE user lock must wait for the block insert's foreign-key lock");

        await writerTransaction.CommitAsync();
        using var response = await editTask.WaitAsync(TimeSpan.FromSeconds(60));
        var diagnosticBody = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "the concurrent block must be re-read after commit; response: {0}",
            diagnosticBody);
        await AssertErrorAsync(response, "BLOCKED", "You cannot send messages to this user");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == messageId);
        stored.Content.Should().Be("Original");
        stored.IsEdited.Should().BeFalse();
    }

    [Fact]
    public async Task Edit_LockedSafeguardingRecheckRejectsPreferenceRace()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Original");
        int optionId;
        using (var setup = Factory.Services.CreateScope())
        {
            var jurisdictions = setup.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
            await jurisdictions.ConfigureAsync(
                TestData.Tenant1.Id,
                "england_wales",
                TestData.AdminUser.Id);
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            optionId = await db.SafeguardingOptions.IgnoreQueryFilters()
                .Where(option => option.TenantId == TestData.Tenant1.Id
                    && option.OptionKey == "requires_coordinator_contact")
                .Select(option => option.Id)
                .SingleAsync();
        }
        await AuthenticateAsMemberAsync();

        using var lockScope = Factory.Services.CreateScope();
        var lockDb = lockScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var lockTransaction = await lockDb.Database.BeginTransactionAsync();
        await lockDb.Database.ExecuteSqlRawAsync(
            "SELECT \"Id\" FROM tenants WHERE \"Id\" = {0} FOR UPDATE",
            TestData.Tenant1.Id);

        var editTask = Client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "Race must lose" });
        await Task.Delay(150);
        editTask.IsCompleted.Should().BeFalse("the definitive edit check must wait for the tenant policy lock");

        lockDb.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            OptionId = optionId,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await lockDb.SaveChangesAsync();
        await lockTransaction.CommitAsync();

        using var response = await editTask.WaitAsync(TimeSpan.FromSeconds(60));
        var diagnosticBody = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "the committed safeguarding preference must be re-read after the lock wait; response: {0}",
            diagnosticBody);
        await AssertErrorAsync(
            response,
            "SAFEGUARDING_CONTACT_RESTRICTED",
            "This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
        stored.Content.Should().Be("Original");
        stored.IsEdited.Should().BeFalse();
        (await verifyDb.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.Type == "safeguarding_contact_blocked"))
            .Should().Be(1);
    }

    [Fact]
    public async Task DeleteSelf_HidesOnlyTheActingParticipant_WithQueryAndBodyContracts()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Keep for the other participant");
        await AuthenticateAsMemberAsync();

        using (var senderDelete = await Client.DeleteAsync($"/api/v2/messages/{messageId}?scope=self"))
        {
            senderDelete.StatusCode.Should().Be(HttpStatusCode.OK);
            await AssertDeleteSuccessAsync(senderDelete);
        }
        (await LoadThreadMessageIdsAsync(TestData.AdminUser.Id)).Should().NotContain(messageId);

        await AuthenticateAsAdminAsync();
        (await LoadThreadMessageIdsAsync(TestData.MemberUser.Id)).Should().Contain(messageId);

        using var receiverRequest = new HttpRequestMessage(HttpMethod.Delete, $"/api/v2/messages/{messageId}")
        {
            Content = JsonContent.Create(new { scope = "self" })
        };
        using (var receiverDelete = await Client.SendAsync(receiverRequest))
        {
            receiverDelete.StatusCode.Should().Be(HttpStatusCode.OK);
            await AssertDeleteSuccessAsync(receiverDelete);
        }
        (await LoadThreadMessageIdsAsync(TestData.MemberUser.Id)).Should().NotContain(messageId);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
        stored.IsDeletedSender.Should().BeTrue();
        stored.IsDeletedReceiver.Should().BeTrue();
        stored.IsDeleted.Should().BeFalse();
        stored.Content.Should().Be("Keep for the other participant");
    }

    [Fact]
    public async Task DeleteScope_JsonBodyPrecedesQuery_AndMalformedJsonFallsBackToQuery()
    {
        var bodyWinsId = await SeedMessageAsync(TestData.MemberUser.Id, "Body wins");
        var malformedFallsBackId = await SeedMessageAsync(TestData.MemberUser.Id, "Query fallback");
        var malformedDefaultsId = await SeedMessageAsync(TestData.MemberUser.Id, "Default fallback");
        var invalidBodyWinsId = await SeedMessageAsync(TestData.MemberUser.Id, "Invalid body wins");
        await AuthenticateAsMemberAsync();

        using (var bodyWinsRequest = new HttpRequestMessage(
                   HttpMethod.Delete,
                   $"/api/v2/messages/{bodyWinsId}?scope=everyone"))
        {
            bodyWinsRequest.Content = JsonContent.Create(new { scope = "self" });
            using var bodyWins = await Client.SendAsync(bodyWinsRequest);
            bodyWins.StatusCode.Should().Be(HttpStatusCode.OK);
            await AssertDeleteSuccessAsync(bodyWins);
        }

        using (var malformedRequest = new HttpRequestMessage(
                   HttpMethod.Delete,
                   $"/api/v2/messages/{malformedFallsBackId}?scope=self"))
        {
            malformedRequest.Content = new StringContent(
                "{\"scope\":",
                System.Text.Encoding.UTF8,
                "application/json");
            using var malformed = await Client.SendAsync(malformedRequest);
            malformed.StatusCode.Should().Be(HttpStatusCode.OK);
            await AssertDeleteSuccessAsync(malformed);
        }

        using (var malformedDefaultRequest = new HttpRequestMessage(
                   HttpMethod.Delete,
                   $"/api/v2/messages/{malformedDefaultsId}"))
        {
            malformedDefaultRequest.Content = new StringContent(
                "{\"scope\":",
                System.Text.Encoding.UTF8,
                "application/json");
            using var malformedDefault = await Client.SendAsync(malformedDefaultRequest);
            malformedDefault.StatusCode.Should().Be(HttpStatusCode.OK);
            await AssertDeleteSuccessAsync(malformedDefault);
        }

        using (var invalidBodyRequest = new HttpRequestMessage(
                   HttpMethod.Delete,
                   $"/api/v2/messages/{invalidBodyWinsId}?scope=self"))
        {
            invalidBodyRequest.Content = JsonContent.Create(new { scope = 1 });
            using var invalidBody = await Client.SendAsync(invalidBodyRequest);
            invalidBody.StatusCode.Should().Be(HttpStatusCode.OK);
            await AssertDeleteSuccessAsync(invalidBody);
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var bodyWinsMessage = await db.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == bodyWinsId);
        bodyWinsMessage.IsDeletedSender.Should().BeTrue();
        bodyWinsMessage.IsDeleted.Should().BeFalse();

        var malformedMessage = await db.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == malformedFallsBackId);
        malformedMessage.IsDeletedSender.Should().BeTrue();
        malformedMessage.IsDeleted.Should().BeFalse();

        var malformedDefaultMessage = await db.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == malformedDefaultsId);
        malformedDefaultMessage.IsDeleted.Should().BeTrue();
        malformedDefaultMessage.Content.Should().Be("[Message deleted]");

        var invalidBodyMessage = await db.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == invalidBodyWinsId);
        invalidBodyMessage.IsDeleted.Should().BeTrue();
        invalidBodyMessage.IsDeletedSender.Should().BeFalse();
    }

    [Fact]
    public async Task DeleteEveryone_DefaultPreservesAuditedPlaceholderForBothAndNormalizedReactions()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Delete for everyone");
        using (var setup = Factory.Services.CreateScope())
        {
            var setupDb = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            setupDb.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = $"message_reactions.{messageId}.{TestData.AdminUser.Id}.00ff",
                Value = JsonSerializer.Serialize(new
                {
                    message_id = messageId,
                    user_id = TestData.AdminUser.Id,
                    emoji = "👍"
                }),
                CreatedAt = DateTime.UtcNow
            });
            await setupDb.SaveChangesAsync();
        }
        await AuthenticateAsAdminAsync();

        using var response = await Client.DeleteAsync($"/api/v2/messages/{messageId}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertDeleteSuccessAsync(response);

        var receiverProjection = await LoadThreadMessageAsync(TestData.MemberUser.Id, messageId);
        receiverProjection.GetProperty("body").GetString().Should().Be("[Message deleted]");
        receiverProjection.GetProperty("is_deleted").GetBoolean().Should().BeTrue();

        using (var unreadResponse = await Client.GetAsync("/api/v2/messages/unread-count"))
        {
            unreadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var unread = await unreadResponse.Content.ReadFromJsonAsync<JsonElement>();
            unread.GetProperty("data").GetProperty("count").GetInt32().Should().Be(0);
        }

        await AuthenticateAsMemberAsync();
        var senderProjection = await LoadThreadMessageAsync(TestData.AdminUser.Id, messageId);
        senderProjection.GetProperty("body").GetString().Should().Be("[Message deleted]");
        senderProjection.GetProperty("is_deleted").GetBoolean().Should().BeTrue();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
        stored.Content.Should().Be("[Message deleted]");
        stored.IsDeleted.Should().BeTrue();
        stored.DeletedAt.Should().NotBeNull();
        stored.DeletedByUserId.Should().Be(TestData.AdminUser.Id);
        (await db.Messages.IgnoreQueryFilters().CountAsync(message => message.Id == messageId)).Should().Be(1);
        (await db.TenantConfigs.IgnoreQueryFilters().CountAsync(config =>
            config.TenantId == TestData.Tenant1.Id
            && config.Key.StartsWith($"message_reactions.{messageId}."))).Should().Be(1,
                "Laravel preserves normalized reaction rows when it clears only the legacy JSON aggregate");
    }

    [Fact]
    public async Task Delete_CrossTenantMessageIsTenantIsolatedAndNeverHardDeleted()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Tenant secret");
        await AuthenticateAsOtherTenantUserAsync();

        using var response = await Client.DeleteAsync($"/api/v2/messages/{messageId}");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertErrorAsync(response, "NOT_FOUND", "Message not found");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Messages.IgnoreQueryFilters().SingleAsync(message => message.Id == messageId);
        stored.Content.Should().Be("Tenant secret");
        stored.IsDeleted.Should().BeFalse();
    }

    [Fact]
    public async Task EditAndDelete_UseIndependentExactLaravelRateBuckets()
    {
        var messageId = await SeedMessageAsync(TestData.MemberUser.Id, "Rate limited");
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:EditPermitLimit"] = "1",
                    ["RateLimiting:Messages:EditWindowSeconds"] = "60",
                    ["RateLimiting:Messages:DeletePermitLimit"] = "1",
                    ["RateLimiting:Messages:DeleteWindowSeconds"] = "60"
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
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using (var acceptedEdit = await client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "One" }))
        {
            acceptedEdit.StatusCode.Should().Be(HttpStatusCode.OK);
        }
        using (var rejectedEdit = await client.PutAsJsonAsync($"/api/v2/messages/{messageId}", new { body = "Two" }))
        {
            await AssertRateLimitedAsync(rejectedEdit, "1");
        }

        using (var acceptedDelete = await client.DeleteAsync($"/api/v2/messages/{messageId}"))
        {
            acceptedDelete.StatusCode.Should().Be(HttpStatusCode.OK);
        }
        using (var rejectedDelete = await client.DeleteAsync($"/api/v2/messages/{messageId}"))
        {
            await AssertRateLimitedAsync(rejectedDelete, "1");
        }
    }

    private async Task<int> SeedMessageAsync(
        int senderId,
        string content,
        DateTime? createdAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var participant1Id = Math.Min(TestData.MemberUser.Id, TestData.AdminUser.Id);
        var participant2Id = Math.Max(TestData.MemberUser.Id, TestData.AdminUser.Id);
        var conversation = await db.Conversations.IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.Participant1Id == participant1Id
                && row.Participant2Id == participant2Id);
        if (conversation == null)
        {
            conversation = new Conversation
            {
                TenantId = TestData.Tenant1.Id,
                Participant1Id = participant1Id,
                Participant2Id = participant2Id,
                CreatedAt = DateTime.UtcNow.AddMinutes(-10),
                UpdatedAt = DateTime.UtcNow
            };
            db.Conversations.Add(conversation);
        }
        var message = new Message
        {
            TenantId = TestData.Tenant1.Id,
            Conversation = conversation,
            SenderId = senderId,
            Content = content,
            CreatedAt = createdAt ?? DateTime.UtcNow,
            IsRead = false
        };
        db.Messages.Add(message);
        await db.SaveChangesAsync();
        return message.Id;
    }

    private async Task<int[]> LoadThreadMessageIdsAsync(int otherUserId)
    {
        using var response = await Client.GetAsync($"/api/v2/messages/{otherUserId}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("data").EnumerateArray()
            .Select(message => message.GetProperty("id").GetInt32())
            .ToArray();
    }

    private async Task<JsonElement> LoadThreadMessageAsync(int otherUserId, int messageId)
    {
        using var response = await Client.GetAsync($"/api/v2/messages/{otherUserId}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("data").EnumerateArray()
            .Single(message => message.GetProperty("id").GetInt32() == messageId)
            .Clone();
    }

    private static async Task AssertDeleteSuccessAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "data", "meta" });
        var data = json.GetProperty("data");
        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("message").GetString().Should().Be("Message deleted");
        json.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
    }

    private static async Task AssertErrorAsync(
        HttpResponseMessage response,
        string code,
        string message,
        string? field = null)
    {
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = json.GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("code").GetString().Should().Be(code);
        error.GetProperty("message").GetString().Should().Be(message);
        if (field == null)
        {
            error.TryGetProperty("field", out _).Should().BeFalse();
        }
        else
        {
            error.GetProperty("field").GetString().Should().Be(field);
        }
    }

    private static async Task AssertRateLimitedAsync(HttpResponseMessage response, string expectedLimit)
    {
        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        response.Headers.GetValues("X-RateLimit-Limit").Should().ContainSingle().Which.Should().Be(expectedLimit);
        response.Headers.GetValues("X-RateLimit-Remaining").Should().ContainSingle().Which.Should().Be("0");
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.Contains("X-RateLimit-Reset").Should().BeTrue();
        response.Headers.Contains("Retry-After").Should().BeTrue();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "success", "error", "code" });
        json.GetProperty("success").GetBoolean().Should().BeFalse();
        json.GetProperty("error").GetString()
            .Should().Be("Rate limit exceeded. Please try again later.");
        json.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
    }
}
