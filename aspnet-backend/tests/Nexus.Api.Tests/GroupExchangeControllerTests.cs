// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class GroupExchangeControllerTests : IntegrationTestBase
{
    public GroupExchangeControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public void ModelMatchesLaravelEnumDomainsAndWeightPrecision()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var designModel = db.GetService<IDesignTimeModel>().Model;
        var exchange = designModel.FindEntityType(typeof(GroupExchange))
            ?? throw new InvalidOperationException("GroupExchange is not mapped");
        var participant = designModel.FindEntityType(typeof(GroupExchangeParticipant))
            ?? throw new InvalidOperationException("GroupExchangeParticipant is not mapped");

        exchange.GetCheckConstraints()
            .Single(item => item.Name == "CK_group_exchanges_Status")
            .Sql.Should().Be(
                "\"Status\" IN ('draft', 'pending_participants', 'pending_broker', 'active', 'pending_confirmation', 'completed', 'cancelled', 'disputed')");
        exchange.GetCheckConstraints()
            .Single(item => item.Name == "CK_group_exchanges_SplitType")
            .Sql.Should().Be("\"SplitType\" IN ('equal', 'custom', 'weighted')");
        participant.GetCheckConstraints()
            .Single(item => item.Name == "CK_group_exchange_participants_Role")
            .Sql.Should().Be("\"Role\" IN ('provider', 'receiver')");

        var weight = participant.FindProperty(nameof(GroupExchangeParticipant.Weight));
        weight.Should().NotBeNull();
        weight!.GetPrecision().Should().Be(5);
        weight.GetScale().Should().Be(2);
    }

    [Fact]
    public async Task CanonicalRoutes_RequireAuthentication_AndReturnLaravelEnvelopes()
    {
        ClearAuthToken();
        using var unauthorizedRequest = new HttpRequestMessage(
            HttpMethod.Get,
            "/api/v2/group-exchanges");
        unauthorizedRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var unauthorized = await Client.SendAsync(unauthorizedRequest);
        unauthorized.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var unauthorizedJson = await JsonAsync(unauthorized);
        unauthorizedJson.GetProperty("success").GetBoolean().Should().BeFalse();
        unauthorizedJson.GetProperty("error").GetString().Should().Be("Authentication required");
        unauthorizedJson.GetProperty("code").GetString().Should().Be("AUTH_REQUIRED");
        unauthorizedJson.TryGetProperty("errors", out _).Should().BeFalse();

        await AuthenticateAsAdminAsync();
        var phpEmptyTitle = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "0",
            total_hours = 1m
        });
        phpEmptyTitle.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await JsonAsync(phpEmptyTitle)).GetProperty("errors")[0].GetProperty("field").GetString()
            .Should().Be("title");

        var created = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Neighbourhood rota",
            description = "A shared Saturday rota",
            split_type = "equal",
            total_hours = 6m,
            participants = new object[]
            {
                new { user_id = TestData.AdminUser.Id, role = "provider", hours = 0m, weight = 1m },
                new { user_id = TestData.MemberUser.Id, role = "receiver", hours = 0m, weight = 1m }
            }
        });

        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await JsonAsync(created);
        createJson.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var createdData = createJson.GetProperty("data");
        createdData.GetProperty("organizer_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        createdData.GetProperty("participant_count").GetInt32().Should().Be(2);
        createdData.TryGetProperty("calculated_split", out _).Should().BeFalse();
        var exchangeId = createdData.GetProperty("id").GetInt32();

        var v2Show = await Client.GetAsync($"/api/v2/group-exchanges/{exchangeId}");
        var v1Show = await Client.GetAsync($"/api/group-exchanges/{exchangeId}");
        v2Show.StatusCode.Should().Be(HttpStatusCode.OK);
        v1Show.StatusCode.Should().Be(HttpStatusCode.OK);

        var showData = (await JsonAsync(v2Show)).GetProperty("data");
        showData.GetProperty("calculated_split").EnumerateArray()
            .Select(item => item.GetProperty("hours").GetDecimal())
            .Should().Equal(6m, 6m);

        var listJson = await JsonAsync(await Client.GetAsync("/api/v2/group-exchanges?limit=1&offset=0"));
        listJson.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        listJson.GetProperty("data").GetArrayLength().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task RoundedSubCentHours_ArePersistedWithDatabasePrecisionLikeLaravel()
    {
        await AuthenticateAsAdminAsync();
        var roundedZeroTitle = $"Rounded zero {Guid.NewGuid():N}";
        var create = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = roundedZeroTitle,
            split_type = "equal",
            total_hours = 0.001m
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        (await JsonAsync(create)).GetProperty("data").GetProperty("total_hours").GetDecimal()
            .Should().Be(0m);

        var exchangeId = await CreateExchangeAsync(
            $"Custom rounded participant {Guid.NewGuid():N}",
            1m,
            "custom",
            Array.Empty<object>());
        var add = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new
            {
                user_id = TestData.MemberUser.Id,
                role = "provider",
                hours = 0.001m,
                weight = 1m
            });

        add.StatusCode.Should().Be(HttpStatusCode.OK);
        using var finalScope = Factory.Services.CreateScope();
        var finalDb = finalScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await finalDb.GroupExchangeParticipants.AsNoTracking()
            .SingleAsync(item => item.GroupExchangeId == exchangeId
                && item.UserId == TestData.MemberUser.Id)).Hours
            .Should().Be(0m);
    }

    [Fact]
    public async Task AuthorizationAndTenantIsolation_AreOrganizerOrParticipantOnly()
    {
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Private exchange",
            3m,
            "equal",
            new[]
            {
                Participant(TestData.MemberUser.Id, "receiver"),
                Participant(TestData.AdminUser.Id, "provider")
            });

        await AuthenticateAsMemberAsync();
        (await Client.GetAsync($"/api/v2/group-exchanges/{exchangeId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        var forbiddenUpdate = await Client.PutAsJsonAsync($"/api/v2/group-exchanges/{exchangeId}", new
        {
            title = "Participant cannot rename"
        });
        forbiddenUpdate.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(forbiddenUpdate)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FORBIDDEN");

        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/group-exchanges/{exchangeId}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherList = await JsonAsync(await Client.GetAsync("/api/v2/group-exchanges"));
        otherList.GetProperty("data").GetArrayLength().Should().Be(0);

        await AuthenticateAsAdminAsync();
        var crossTenantAdd = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.OtherTenantUser.Id, role = "provider", hours = 1m, weight = 1m });
        crossTenantAdd.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task FullLifecycle_ConservesLedger_IsParallelIdempotent_AndEmitsNotifications()
    {
        await SetEmailTransactionsPreferenceAsync(TestData.MemberUser.Id, enabled: false);
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Community repair day",
            6m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(TestData.MemberUser.Id, "receiver")
            });

        var start = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null);
        start.StatusCode.Should().Be(HttpStatusCode.OK);
        (await JsonAsync(start)).GetProperty("data").GetProperty("status").GetString()
            .Should().Be("pending_confirmation");

        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsMemberAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await AuthenticateAsAdminAsync();
        var firstCompletion = Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null);
        var concurrentCompletion = Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null);
        var completionResponses = await Task.WhenAll(firstCompletion, concurrentCompletion);

        completionResponses.Count(response => response.StatusCode == HttpStatusCode.OK).Should().Be(1);
        completionResponses.Count(response => response.StatusCode == HttpStatusCode.BadRequest).Should().Be(1);
        var success = completionResponses.Single(response => response.StatusCode == HttpStatusCode.OK);
        (await JsonAsync(success)).GetProperty("data").GetProperty("transaction_ids").GetArrayLength()
            .Should().Be(1);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var settlementRows = await db.Transactions.AsNoTracking()
            .Where(item => item.TenantId == TestData.Tenant1.Id &&
                           item.Description == "Group exchange: Community repair day")
            .ToListAsync();
        settlementRows.Should().ContainSingle();
        settlementRows[0].SenderId.Should().Be(TestData.AdminUser.Id);
        settlementRows[0].ReceiverId.Should().Be(TestData.AdminUser.Id);
        settlementRows[0].Amount.Should().Be(6m);
        settlementRows[0].TransactionType.Should().Be("exchange");

        var balanceAdapters = await db.Transactions.AsNoTracking()
            .Where(item => item.TenantId == TestData.Tenant1.Id &&
                           item.Description == $"Group exchange balance adapter: {exchangeId}")
            .ToListAsync();
        balanceAdapters.Should().HaveCount(2);
        balanceAdapters.Should().OnlyContain(item => item.TransactionType == "group_exchange_balance_adapter");
        balanceAdapters.Should().ContainSingle(item => item.ReceiverId == TestData.AdminUser.Id &&
                                                       item.SenderId == null &&
                                                       item.DeletedForReceiver);
        balanceAdapters.Should().ContainSingle(item => item.SenderId == TestData.MemberUser.Id &&
                                                       item.ReceiverId == null &&
                                                       item.DeletedForSender);

        var adminBalance = await BalanceAsync(db, TestData.AdminUser.Id);
        var memberBalance = await BalanceAsync(db, TestData.MemberUser.Id);
        adminBalance.Should().Be(-4m);
        memberBalance.Should().Be(4m);
        (adminBalance + memberBalance).Should().Be(0m);

        var notifications = await db.Notifications.AsNoTracking()
            .Where(item => item.UserId == TestData.AdminUser.Id || item.UserId == TestData.MemberUser.Id)
            .ToListAsync();
        notifications.Should().Contain(item => item.Type == "group_exchange" && item.Data!.Contains($"/group-exchanges/{exchangeId}"));
        notifications.Should().Contain(item => item.Type == "transaction" && item.Data!.Contains("/wallet"));

        var memberCompletionEmails = await db.Set<EmailLog>().AsNoTracking()
            .CountAsync(item => item.UserId == TestData.MemberUser.Id && item.TemplateKey == "group_exchange_completed");
        memberCompletionEmails.Should().Be(0);
    }

    [Fact]
    public async Task CompletionRejectsUnconfirmedAndUsesCanonicalServerErrorForInsufficientBalance()
    {
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Rollback proof",
            11m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(TestData.MemberUser.Id, "receiver")
            });
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var unconfirmed = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null);
        unconfirmed.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await JsonAsync(unconfirmed)).GetProperty("errors")[0].GetProperty("message").GetString()
            .Should().Be("1 participant(s) still need to confirm");

        await AuthenticateAsMemberAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsAdminAsync();

        var insufficient = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null);
        insufficient.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
        var insufficientJson = await JsonAsync(insufficient);
        insufficientJson.GetProperty("errors")[0].GetProperty("message").GetString()
            .Should().Be("An unexpected error occurred.");
        insufficientJson.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SERVER_ERROR");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var persisted = await db.GroupExchanges.AsNoTracking().SingleAsync(item => item.Id == exchangeId);
        persisted.Status.Should().Be("pending_confirmation");
        persisted.CompletedAt.Should().BeNull();
        (await db.Transactions.CountAsync(item => item.Description == "Group exchange: Rollback proof"))
            .Should().Be(0);
        (await BalanceAsync(db, TestData.MemberUser.Id)).Should().Be(10m);
    }

    [Fact]
    public async Task ListFiltersStatusAndImplementsLimitOffsetHasMore()
    {
        await AuthenticateAsAdminAsync();
        var firstDraft = await CreateExchangeAsync(
            "First draft",
            1m,
            "equal",
            Array.Empty<object>());
        var secondDraft = await CreateExchangeAsync(
            "Second draft",
            1m,
            "equal",
            Array.Empty<object>());
        var pendingId = await CreateExchangeAsync(
            "Waiting for participants",
            1m,
            "equal",
            Array.Empty<object>(),
            status: "pending_participants");
        var pendingCreated = (await JsonAsync(await Client.GetAsync(
            $"/api/v2/group-exchanges/{pendingId}"))).GetProperty("data");
        pendingCreated.GetProperty("status").GetString().Should().Be("pending_participants");

        var firstPage = await JsonAsync(await Client.GetAsync(
            "/api/v2/group-exchanges?status=draft&limit=1&offset=0"));
        firstPage.GetProperty("data").GetArrayLength().Should().Be(1);
        firstPage.GetProperty("data")[0].GetProperty("id").GetInt32().Should().Be(secondDraft);
        firstPage.GetProperty("data")[0].GetProperty("status").GetString().Should().Be("draft");
        firstPage.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeTrue();

        var secondPage = await JsonAsync(await Client.GetAsync(
            "/api/v2/group-exchanges?status=draft&limit=1&offset=1"));
        secondPage.GetProperty("data").GetArrayLength().Should().Be(1);
        secondPage.GetProperty("data")[0].GetProperty("id").GetInt32().Should().Be(firstDraft);
        secondPage.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();

        var pendingOnly = await JsonAsync(await Client.GetAsync(
            "/api/v2/group-exchanges?status=pending_participants&limit=100&offset=0"));
        pendingOnly.GetProperty("data").GetArrayLength().Should().Be(1);
        pendingOnly.GetProperty("data")[0].GetProperty("title").GetString()
            .Should().Be("Waiting for participants");

        // PHP empty("0") is true, so status=0 means no filter in Laravel.
        var zeroStatus = await JsonAsync(await Client.GetAsync(
            "/api/v2/group-exchanges?status=0&limit=100&offset=0"));
        zeroStatus.GetProperty("data").GetArrayLength().Should().Be(3);
    }

    [Fact]
    public async Task SplitModes_AreRoundedPerRole_AndCustomImbalanceCannotStart()
    {
        var (providerTwo, receiverTwo) = await AddSameTenantUsersAsync();
        await AuthenticateAsAdminAsync();

        var weightedId = await CreateExchangeAsync(
            "Weighted rota",
            10m,
            "weighted",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider", weight: 1m),
                Participant(providerTwo, "provider", weight: 2m),
                Participant(TestData.MemberUser.Id, "receiver", weight: 1m),
                Participant(receiverTwo, "receiver", weight: 3m)
            });

        var weighted = (await JsonAsync(await Client.GetAsync($"/api/v2/group-exchanges/{weightedId}")))
            .GetProperty("data").GetProperty("calculated_split").EnumerateArray()
            .Select(item => new
            {
                Role = item.GetProperty("role").GetString(),
                Hours = item.GetProperty("hours").GetDecimal()
            }).ToList();
        weighted.Where(item => item.Role == "provider").Select(item => item.Hours)
            .Should().Equal(3.33m, 6.67m);
        weighted.Where(item => item.Role == "receiver").Select(item => item.Hours)
            .Should().Equal(2.5m, 7.5m);
        weighted.Where(item => item.Role == "provider").Sum(item => item.Hours).Should().Be(10m);
        weighted.Where(item => item.Role == "receiver").Sum(item => item.Hours).Should().Be(10m);

        var zeroWeightId = await CreateExchangeAsync(
            "Laravel zero-weight fallback",
            10m,
            "weighted",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider", weight: 1m),
                Participant(providerTwo, "provider", weight: 0m),
                Participant(TestData.MemberUser.Id, "receiver", weight: 1m),
                Participant(receiverTwo, "receiver", weight: 0m)
            });
        var zeroWeightSplit = (await JsonAsync(await Client.GetAsync(
                $"/api/v2/group-exchanges/{zeroWeightId}")))
            .GetProperty("data").GetProperty("calculated_split").EnumerateArray()
            .ToDictionary(
                item => item.GetProperty("user_id").GetInt32(),
                item => item.GetProperty("hours").GetDecimal());
        zeroWeightSplit[TestData.AdminUser.Id].Should().Be(10m);
        zeroWeightSplit[providerTwo].Should().Be(0m);
        zeroWeightSplit[TestData.MemberUser.Id].Should().Be(10m);
        zeroWeightSplit[receiverTwo].Should().Be(0m);
        (await Client.PostAsync($"/api/v2/group-exchanges/{zeroWeightId}/start", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var customId = await CreateExchangeAsync(
            "Unbalanced custom rota",
            5m,
            "custom",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider", hours: 5m),
                Participant(TestData.MemberUser.Id, "receiver", hours: 4m)
            });
        var rejected = await Client.PostAsync($"/api/v2/group-exchanges/{customId}/start", null);
        rejected.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await JsonAsync(rejected)).GetProperty("errors")[0].GetProperty("message").GetString()
            .Should().Contain("cannot create or destroy time credits");

        var zeroId = await CreateExchangeAsync(
            "Legacy zero custom rota",
            5m,
            "custom",
            Array.Empty<object>());
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.GroupExchangeParticipants.AddRange(
                new GroupExchangeParticipant
                {
                    GroupExchangeId = zeroId,
                    UserId = TestData.AdminUser.Id,
                    Role = "provider",
                    Hours = 10m,
                    Weight = 1m,
                    IsConfirmed = true,
                    ConfirmedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                },
                new GroupExchangeParticipant
                {
                    GroupExchangeId = zeroId,
                    UserId = TestData.MemberUser.Id,
                    Role = "receiver",
                    Hours = 5m,
                    Weight = 1m,
                    IsConfirmed = true,
                    ConfirmedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                },
                new GroupExchangeParticipant
                {
                    GroupExchangeId = zeroId,
                    UserId = providerTwo,
                    Role = "provider",
                    Hours = -5m,
                    Weight = 1m,
                    IsConfirmed = true,
                    ConfirmedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                });
            await db.GroupExchanges
                .Where(item => item.Id == zeroId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Status, "pending_confirmation"));
            await db.SaveChangesAsync();
        }

        (await Client.PostAsync($"/api/v2/group-exchanges/{zeroId}/complete", null))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.GroupExchanges.AsNoTracking().SingleAsync(item => item.Id == zeroId))
                .Status.Should().Be("pending_confirmation");
            (await db.Transactions.AsNoTracking()
                .CountAsync(item => item.Description == "Group exchange: Legacy zero custom rota"))
                .Should().Be(0);
        }


        var roundedZeroId = await CreateExchangeAsync(
            "Rounded zero equal rota",
            0.01m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(providerTwo, "provider"),
                Participant(TestData.MemberUser.Id, "receiver"),
                Participant(receiverTwo, "receiver")
            });
        var roundedZeroStart = await Client.PostAsync(
            $"/api/v2/group-exchanges/{roundedZeroId}/start",
            null);
        roundedZeroStart.StatusCode.Should().Be(HttpStatusCode.OK);

        var invalidTransitionId = await CreateExchangeAsync(
            "Invalid custom transition",
            2m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(TestData.MemberUser.Id, "receiver")
            });
        (await Client.PutAsJsonAsync(
            $"/api/v2/group-exchanges/{invalidTransitionId}",
            new { split_type = "custom" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task OrganizerMutationsUseCanonicalUserRolePairSemantics()
    {
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Editable exchange",
            2m,
            "equal",
            Array.Empty<object>());

        var addProvider = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.MemberUser.Id, role = "provider", hours = 1m, weight = 1m });
        addProvider.StatusCode.Should().Be(HttpStatusCode.OK);

        // Laravel's unique key is (exchange, user, role): the same member may
        // occupy both roles, while an exact role duplicate is rejected.
        var addReceiver = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.MemberUser.Id, role = "receiver", hours = 1m, weight = 1m });
        addReceiver.StatusCode.Should().Be(HttpStatusCode.OK);

        var duplicateRole = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.MemberUser.Id, role = "provider", hours = 1m, weight = 1m });
        duplicateRole.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var zeroRole = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.AdminUser.Id, role = "0", hours = 1m, weight = 1m });
        zeroRole.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var unsupportedRole = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.AdminUser.Id, role = "coordinator", hours = 1m, weight = 1m });
        unsupportedRole.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
        (await JsonAsync(unsupportedRole)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SERVER_ERROR");

        var updated = await Client.PutAsJsonAsync($"/api/v2/group-exchanges/{exchangeId}", new
        {
            title = "Renamed exchange",
            status = "completed",
            total_hours = 4m
        });
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedData = (await JsonAsync(updated)).GetProperty("data");
        updatedData.GetProperty("title").GetString().Should().Be("Renamed exchange");
        updatedData.GetProperty("status").GetString().Should().Be("draft");
        updatedData.GetProperty("participant_count").GetInt32().Should().Be(2);

        var invalidSplit = await Client.PutAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}",
            new { split_type = "invalid" });
        invalidSplit.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
        (await JsonAsync(invalidSplit)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SERVER_ERROR");

        var removed = await Client.DeleteAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants/{TestData.MemberUser.Id}");
        removed.StatusCode.Should().Be(HttpStatusCode.OK);
        (await JsonAsync(removed)).GetProperty("data").GetProperty("participant_count").GetInt32()
            .Should().Be(0);

        var cancelled = await Client.DeleteAsync($"/api/v2/group-exchanges/{exchangeId}");
        cancelled.StatusCode.Should().Be(HttpStatusCode.OK);
        (await JsonAsync(cancelled)).GetProperty("data").GetProperty("message").GetString()
            .Should().Be("Exchange cancelled");
    }

    [Fact]
    public async Task StoreOverwritesExactPairDuplicatesAndKeepsDualRoles()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Composite participant identity",
            split_type = "equal",
            total_hours = 3m,
            participants = new[]
            {
                new { user_id = TestData.MemberUser.Id, role = "provider", hours = 1m, weight = 1m },
                new { user_id = TestData.MemberUser.Id, role = "provider", hours = 2m, weight = 3m },
                new { user_id = TestData.MemberUser.Id, role = "receiver", hours = 3m, weight = 1m }
            }
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await JsonAsync(response)).GetProperty("data");
        data.GetProperty("participant_count").GetInt32().Should().Be(2);
        var participants = data.GetProperty("participants").EnumerateArray().ToArray();
        participants.Should().ContainSingle(item => item.GetProperty("role").GetString() == "provider" &&
                                                    item.GetProperty("hours").GetDecimal() == 2m &&
                                                    item.GetProperty("weight").GetDecimal() == 3m);
        participants.Should().ContainSingle(item => item.GetProperty("role").GetString() == "receiver" &&
                                                    item.GetProperty("hours").GetDecimal() == 3m);
        var exchangeId = data.GetProperty("id").GetInt32();
        (await Client.PostAsync(
            $"/api/v2/group-exchanges/{exchangeId}/start",
            null)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task StoreUsesCanonicalInternalErrorForInvalidInlineParticipantAndRollsBack()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Atomic participant validation",
            status = "pending_broker",
            split_type = "weighted",
            total_hours = 2m,
            participants = new[]
            {
                new { user_id = TestData.OtherTenantUser.Id, role = "provider", hours = 2m, weight = 1m },
                new { user_id = TestData.MemberUser.Id, role = "receiver", hours = 2m, weight = 1m }
            }
        });

        response.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
        (await JsonAsync(response)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("INTERNAL_ERROR");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupExchanges.AsNoTracking()
                .AnyAsync(item => item.Title == "Atomic participant validation"))
            .Should().BeFalse();

        var invalidStatus = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Invalid database status",
            status = "invalid",
            total_hours = 1m
        });
        invalidStatus.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
        (await JsonAsync(invalidStatus)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SERVER_ERROR");
        (await db.GroupExchanges.AsNoTracking()
                .AnyAsync(item => item.Title == "Invalid database status"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task BrokerApprovalIsAddOnlyAndPrecedesContactPolicy()
    {
        await AddSafeguardingPreferenceAsync(
            TestData.MemberUser.Id,
            "broker-approval-only",
            "{\"requires_broker_approval\":true}");

        await AuthenticateAsAdminAsync();
        var inline = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Broker approval inline",
            split_type = "equal",
            total_hours = 1m,
            participants = new[] { Participant(TestData.MemberUser.Id, "receiver", 1m) }
        });
        inline.StatusCode.Should().Be(HttpStatusCode.Created);
        (await JsonAsync(inline)).GetProperty("data").GetProperty("participant_count").GetInt32()
            .Should().Be(1);

        await AddSafeguardingPreferenceAsync(
            TestData.MemberUser.Id,
            "unavailable-vetting-after-broker",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");

        var exchangeId = await CreateExchangeAsync(
            "Broker approval explicit",
            1m,
            "equal",
            Array.Empty<object>());

        var explicitAdd = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.MemberUser.Id, role = "receiver", hours = 1m, weight = 1m });
        explicitAdd.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await JsonAsync(explicitAdd)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VALIDATION_ERROR");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupExchanges.AsNoTracking().AnyAsync(item => item.Title == "Broker approval inline"))
            .Should().BeTrue();
        (await db.GroupExchangeParticipants.AsNoTracking()
                .AnyAsync(item => item.GroupExchangeId == exchangeId && item.UserId == TestData.MemberUser.Id))
            .Should().BeFalse();
    }

    [Fact]
    public async Task LegacyVettingNeverAuthorizes_ButExactAttestationAllows_AndRevocationClosesStart()
    {
        await ConfigureEnglandWalesPolicyAsync();
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Vetting-gated exchange",
            2m,
            "custom",
            Array.Empty<object>());

        await AddSafeguardingPreferenceAsync(
            TestData.MemberUser.Id,
            "participant-dbs",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");

        var participantRequest = new
        {
            user_id = TestData.MemberUser.Id,
            role = "receiver",
            hours = 2m,
            weight = 1m
        };
        (await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            participantRequest)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await AddLegacyVerifiedVettingAsync(TestData.AdminUser.Id, "dbs_enhanced");
        var legacyStillBlocked = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            participantRequest);
        legacyStillBlocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(legacyStillBlocked)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");

        await ConfirmCurrentAttestationAsync(TestData.AdminUser.Id);
        var allowed = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            participantRequest);
        allowed.StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = TestData.AdminUser.Id, role = "provider", hours = 2m, weight = 1m }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await RevokeCurrentAttestationAsync(TestData.AdminUser.Id);
        var start = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null);
        start.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(start)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupExchanges.AsNoTracking().SingleAsync(item => item.Id == exchangeId)).Status
            .Should().Be("draft");
    }

    [Fact]
    public async Task UnavailablePolicy_FailsClosedBeforeInlineExchangePersistence()
    {
        await AddSafeguardingPreferenceAsync(
            TestData.MemberUser.Id,
            "unconfigured-vetting",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Unavailable policy exchange",
            split_type = "equal",
            total_hours = 1m,
            participants = new[] { Participant(TestData.MemberUser.Id, "receiver", 1m) }
        });

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await JsonAsync(response)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SAFEGUARDING_POLICY_UNAVAILABLE");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupExchanges.AsNoTracking().AnyAsync(item => item.Title == "Unavailable policy exchange"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task AllPairGate_RechecksExistingParticipants_WhenAddingAnotherMember()
    {
        await ConfigureEnglandWalesPolicyAsync();
        var (protectedUserId, unconfirmedSenderId) = await AddSameTenantUsersAsync();
        var extraUser = await AddSameTenantUserAsync("extra-pair@test.com", "Extra");
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "All-pairs protection",
            3m,
            "custom",
            new[]
            {
                Participant(protectedUserId, "provider", 3m),
                Participant(unconfirmedSenderId, "receiver", 3m)
            });

        await AddSafeguardingPreferenceAsync(
            protectedUserId,
            "protected-after-create",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");
        await ConfirmCurrentAttestationAsync(TestData.AdminUser.Id);

        var blocked = await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = extraUser, role = "provider", hours = 3m, weight = 1m });
        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(blocked)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");

        await ConfirmCurrentAttestationAsync(unconfirmedSenderId);
        await ConfirmCurrentAttestationAsync(extraUser);
        (await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = extraUser, role = "provider", hours = 3m, weight = 1m }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AllPairGate_PreservesCallerOrderForFirstDenialWhileLockingDeterministically()
    {
        await ConfigureEnglandWalesPolicyAsync();
        var (lowerIdVettedMember, higherIdContactRestrictedMember) = await AddSameTenantUsersAsync();
        lowerIdVettedMember.Should().BeLessThan(higherIdContactRestrictedMember);

        await AddSafeguardingPreferenceAsync(
            higherIdContactRestrictedMember,
            "caller-first-contact-restriction",
            "{\"restricts_messaging\":true}");
        await AddSafeguardingPreferenceAsync(
            lowerIdVettedMember,
            "sorted-first-vetting-restriction",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title = "Caller ordered denial",
            split_type = "equal",
            total_hours = 1m,
            participants = new[]
            {
                Participant(higherIdContactRestrictedMember, "provider", 1m),
                Participant(lowerIdVettedMember, "receiver", 1m)
            }
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(response)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("SAFEGUARDING_CONTACT_RESTRICTED");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupExchanges.AsNoTracking().AnyAsync(item => item.Title == "Caller ordered denial"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task StartConfirmAndComplete_RecheckCurrentAttestationBeforeEachMutation()
    {
        await ConfigureEnglandWalesPolicyAsync();
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Lifecycle safeguarding recheck",
            2m,
            "custom",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider", 2m),
                Participant(TestData.MemberUser.Id, "receiver", 2m)
            });

        await AddSafeguardingPreferenceAsync(
            TestData.MemberUser.Id,
            "lifecycle-protected-member",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");

        var blockedStart = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null);
        blockedStart.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(blockedStart)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");

        await ConfirmCurrentAttestationAsync(TestData.AdminUser.Id);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await RevokeCurrentAttestationAsync(TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();
        var blockedConfirm = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null);
        blockedConfirm.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(blockedConfirm)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");

        await ConfirmCurrentAttestationAsync(TestData.AdminUser.Id);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsAdminAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await RevokeCurrentAttestationAsync(TestData.AdminUser.Id);
        var blockedComplete = await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null);
        blockedComplete.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await JsonAsync(blockedComplete)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VETTING_REQUIRED");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupExchanges.AsNoTracking().SingleAsync(item => item.Id == exchangeId)).Status
            .Should().Be("pending_confirmation");
        (await db.Transactions.AsNoTracking()
                .AnyAsync(item => item.Description == "Group exchange: Lifecycle safeguarding recheck"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task ConcurrentRevocationSerializesCreateAndCompleteBeforeMutation()
    {
        await ConfigureEnglandWalesPolicyAsync();
        await AddSafeguardingPreferenceAsync(
            TestData.MemberUser.Id,
            "transaction-boundary-vetting",
            "{\"requires_vetted_interaction\":true,\"vetting_type_required\":\"dbs_enhanced\"}");
        await ConfirmCurrentAttestationAsync(TestData.AdminUser.Id);
        await AuthenticateAsAdminAsync();

        var blockedCreateTitle = $"Blocked concurrent create {Guid.NewGuid():N}";
        await using (var blockingScope = Factory.Services.CreateAsyncScope())
        {
            var blockingDb = blockingScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await using var blockingTransaction = await blockingDb.Database.BeginTransactionAsync();
            var attestations = blockingScope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
            await attestations.RevokeForCurrentPolicyAsync(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                TestData.MemberUser.Id);
            var blockingPid = await blockingDb.Database
                .SqlQueryRaw<int>("SELECT pg_backend_pid() AS \"Value\"")
                .SingleAsync();

            var createTask = Client.PostAsJsonAsync("/api/v2/group-exchanges", new
            {
                title = blockedCreateTitle,
                split_type = "equal",
                total_hours = 1m,
                participants = new[]
                {
                    Participant(TestData.AdminUser.Id, "provider"),
                    Participant(TestData.MemberUser.Id, "receiver")
                }
            });
            await WaitUntilBlockedByBackendAsync(blockingPid, createTask);
            await blockingTransaction.CommitAsync();

            var blockedCreate = await createTask;
            blockedCreate.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await JsonAsync(blockedCreate)).GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("VETTING_REQUIRED");
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.GroupExchanges.AsNoTracking().AnyAsync(item => item.Title == blockedCreateTitle))
                .Should().BeFalse();
        }

        await ConfirmCurrentAttestationAsync(TestData.AdminUser.Id);
        var exchangeId = await CreateExchangeAsync(
            "Blocked concurrent completion",
            1m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(TestData.MemberUser.Id, "receiver")
            });
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsMemberAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsAdminAsync();

        await using (var blockingScope = Factory.Services.CreateAsyncScope())
        {
            var blockingDb = blockingScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await using var blockingTransaction = await blockingDb.Database.BeginTransactionAsync();
            var attestations = blockingScope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
            await attestations.RevokeForCurrentPolicyAsync(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                TestData.MemberUser.Id);
            var blockingPid = await blockingDb.Database
                .SqlQueryRaw<int>("SELECT pg_backend_pid() AS \"Value\"")
                .SingleAsync();

            var completeTask = Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null);
            await WaitUntilBlockedByBackendAsync(blockingPid, completeTask);
            await blockingTransaction.CommitAsync();

            var blockedComplete = await completeTask;
            blockedComplete.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await JsonAsync(blockedComplete)).GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("VETTING_REQUIRED");
        }

        using var finalScope = Factory.Services.CreateScope();
        var finalDb = finalScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await finalDb.GroupExchanges.AsNoTracking().SingleAsync(item => item.Id == exchangeId)).Status
            .Should().Be("pending_confirmation");
        (await finalDb.Transactions.AsNoTracking()
                .AnyAsync(item => item.Description == "Group exchange: Blocked concurrent completion"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task CallerStatusAndLifecycleMutationsMatchLaravel()
    {
        var (additionalUserId, _) = await AddSameTenantUsersAsync();
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Canonical lifecycle revision",
            2m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(TestData.MemberUser.Id, "receiver")
            });

        // Laravel start changes only status; an existing confirmation is retained.
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.GroupExchangeParticipants
                .Where(item => item.GroupExchangeId == exchangeId && item.UserId == TestData.AdminUser.Id)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(item => item.IsConfirmed, true)
                    .SetProperty(item => item.ConfirmedAt, DateTime.UtcNow));
        }

        (await Client.PutAsJsonAsync($"/api/v2/group-exchanges/{exchangeId}", new { total_hours = 0m }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/start", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var frozen = (await JsonAsync(await Client.GetAsync($"/api/v2/group-exchanges/{exchangeId}")))
            .GetProperty("data");
        frozen.GetProperty("status").GetString().Should().Be("pending_confirmation");
        frozen.GetProperty("participants").EnumerateArray()
            .Single(item => item.GetProperty("user_id").GetInt32() == TestData.AdminUser.Id)
            .GetProperty("confirmed").GetBoolean().Should().BeTrue();

        (await Client.PutAsJsonAsync($"/api/v2/group-exchanges/{exchangeId}", new { total_hours = 9m }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants",
            new { user_id = additionalUserId, role = "provider", hours = 1m, weight = 1m }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.DeleteAsync(
            $"/api/v2/group-exchanges/{exchangeId}/participants/{TestData.MemberUser.Id}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var completedId = await CreateExchangeAsync(
            "Caller supplied completed state",
            1m,
            "equal",
            new[] { Participant(TestData.AdminUser.Id, "provider") },
            status: "completed");
        var completed = (await JsonAsync(await Client.GetAsync($"/api/v2/group-exchanges/{completedId}")))
            .GetProperty("data");
        completed.GetProperty("status").GetString().Should().Be("completed");
        (await Client.PostAsync($"/api/v2/group-exchanges/{completedId}/start", null))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Client.PostAsJsonAsync(
            $"/api/v2/group-exchanges/{completedId}/participants",
            new { user_id = TestData.MemberUser.Id, role = "receiver", hours = 1m, weight = 1m }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsMemberAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{completedId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsAdminAsync();
        (await Client.DeleteAsync(
            $"/api/v2/group-exchanges/{completedId}/participants/{TestData.MemberUser.Id}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        // Removing a missing participant is also a successful no-op in Laravel.
        (await Client.DeleteAsync(
            $"/api/v2/group-exchanges/{completedId}/participants/{TestData.MemberUser.Id}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // Laravel destroy always writes cancelled, including from completed.
        (await Client.DeleteAsync($"/api/v2/group-exchanges/{completedId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        var cancelled = (await JsonAsync(await Client.GetAsync($"/api/v2/group-exchanges/{completedId}")))
            .GetProperty("data");
        cancelled.GetProperty("status").GetString().Should().Be("cancelled");
    }

    [Fact]
    public async Task ConfirmAndCompleteDoNotRequirePendingConfirmationStatus()
    {
        await AuthenticateAsAdminAsync();
        var exchangeId = await CreateExchangeAsync(
            "Active exchange completion",
            1m,
            "equal",
            new[]
            {
                Participant(TestData.AdminUser.Id, "provider"),
                Participant(TestData.MemberUser.Id, "receiver")
            },
            status: "active");

        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsMemberAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/confirm", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsAdminAsync();
        (await Client.PostAsync($"/api/v2/group-exchanges/{exchangeId}/complete", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var completed = (await JsonAsync(await Client.GetAsync($"/api/v2/group-exchanges/{exchangeId}")))
            .GetProperty("data");
        completed.GetProperty("status").GetString().Should().Be("completed");
    }

    private async Task<int> CreateExchangeAsync(
        string title,
        decimal totalHours,
        string splitType,
        IReadOnlyCollection<object> participants,
        string? status = null)
    {
        var response = await Client.PostAsJsonAsync("/api/v2/group-exchanges", new
        {
            title,
            description = (string?)null,
            status,
            split_type = splitType,
            total_hours = totalHours,
            participants
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await JsonAsync(response)).GetProperty("data").GetProperty("id").GetInt32();
    }

    private static object Participant(int userId, string role, decimal hours = 0m, decimal weight = 1m) =>
        new { user_id = userId, role, hours, weight };

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<decimal> BalanceAsync(NexusDbContext db, int userId)
    {
        var received = await db.Transactions.AsNoTracking()
            .Where(item => item.ReceiverId == userId && item.Status == TransactionStatus.Completed)
            .SumAsync(item => (decimal?)item.Amount) ?? 0m;
        var sent = await db.Transactions.AsNoTracking()
            .Where(item => item.SenderId == userId && item.Status == TransactionStatus.Completed)
            .SumAsync(item => (decimal?)item.Amount) ?? 0m;
        return received - sent;
    }

    private async Task WaitUntilBlockedByBackendAsync(int blockingPid, Task requestTask)
    {
        using var observerScope = Factory.Services.CreateScope();
        var observerDb = observerScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        for (var attempt = 0; attempt < 100; attempt++)
        {
            requestTask.IsCompleted.Should().BeFalse(
                "the mutation must wait for the safeguarding transaction instead of committing from stale state");
            var isBlocked = await observerDb.Database.SqlQueryRaw<bool>(
                    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity AS activity " +
                    "WHERE {0} = ANY(pg_blocking_pids(activity.pid))) AS \"Value\"",
                    blockingPid)
                .SingleAsync();
            if (isBlocked)
            {
                return;
            }
            await Task.Delay(25);
        }

        throw new TimeoutException(
            $"No HTTP mutation was observed waiting on safeguarding backend {blockingPid}.");
    }

    private async Task<(int ProviderId, int ReceiverId)> AddSameTenantUsersAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var hash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword);
        var provider = NewUser("provider-two@test.com", "Provider", hash);
        var receiver = NewUser("receiver-two@test.com", "Receiver", hash);
        db.Users.AddRange(provider, receiver);
        await db.SaveChangesAsync();
        return (provider.Id, receiver.Id);
    }

    private async Task<int> AddSameTenantUserAsync(string email, string firstName)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = NewUser(
            email,
            firstName,
            BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword));
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private User NewUser(string email, string firstName, string passwordHash) => new()
    {
        TenantId = TestData.Tenant1.Id,
        Email = email,
        PasswordHash = passwordHash,
        FirstName = firstName,
        LastName = "User",
        Role = "member",
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };

    private async Task AddSafeguardingPreferenceAsync(int userId, string key, string triggersJson)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var option = new SafeguardingOption
        {
            TenantId = TestData.Tenant1.Id,
            OptionKey = key,
            OptionType = "checkbox",
            Label = key,
            IsActive = true,
            TriggersJson = triggersJson,
            CreatedAt = DateTime.UtcNow
        };
        db.SafeguardingOptions.Add(option);
        await db.SaveChangesAsync();
        db.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
        {
            TenantId = TestData.Tenant1.Id,
            UserId = userId,
            OptionId = option.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task ConfigureEnglandWalesPolicyAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        await service.ConfigureAsync(
            TestData.Tenant1.Id,
            "england_wales",
            TestData.AdminUser.Id);
    }

    private async Task ConfirmCurrentAttestationAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
        var actorUserId = userId == TestData.AdminUser.Id
            ? TestData.MemberUser.Id
            : TestData.AdminUser.Id;
        await service.ConfirmForCurrentPolicyAsync(
            TestData.Tenant1.Id,
            userId,
            actorUserId);
    }

    private async Task RevokeCurrentAttestationAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
        var actorUserId = userId == TestData.AdminUser.Id
            ? TestData.MemberUser.Id
            : TestData.AdminUser.Id;
        await service.RevokeForCurrentPolicyAsync(
            TestData.Tenant1.Id,
            userId,
            actorUserId);
    }

    private async Task AddLegacyVerifiedVettingAsync(int userId, string type)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.Set<VettingRecord>().Add(new VettingRecord
        {
            TenantId = TestData.Tenant1.Id,
            UserId = userId,
            VettingType = type,
            Status = "verified",
            IssuedAt = DateTime.UtcNow.AddDays(-1),
            ExpiresAt = DateTime.UtcNow.AddDays(30),
            VerifiedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task SetEmailTransactionsPreferenceAsync(int userId, bool enabled)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = await db.Users.FirstAsync(item => item.Id == userId);
        user.NotificationPreferences = JsonSerializer.Serialize(new { email_transactions = enabled });
        await db.SaveChangesAsync();
    }
}
