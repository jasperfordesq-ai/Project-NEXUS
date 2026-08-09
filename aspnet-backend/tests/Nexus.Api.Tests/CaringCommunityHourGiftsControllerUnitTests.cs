// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityHourGiftsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelHourGiftRoutes()
    {
        var controllerType = ResolveControllerType();

        controllerType.Should().NotBeNull();
        var type = controllerType!;
        type.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/hour-gifts");
        type.GetMethod("Inbox")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("inbox");
        type.GetMethod("Sent")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("sent");
        type.GetMethod("Send")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("send");
        type.GetMethod("Accept")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id}/accept");
        type.GetMethod("Decline")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id}/decline");
        type.GetMethod("Revert")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id}/revert");
    }

    [Fact]
    public async Task Inbox_ReturnsPendingReceivedGiftsNewestFirstWithSenderPartner()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "alice@example.test", "Alice", "Blue", avatarUrl: "https://cdn.example.test/alice.png"),
            User(42, 20, "riley@example.test", "Riley", "Green"),
            User(7, 70, "other@example.test", "Other", "Tenant"));
        db.Add(CreateGift(42, senderId: 10, recipientId: 20, hours: 1.25m, status: "pending", createdAt: DateTime.UtcNow.AddHours(-1), message: "Tea time"));
        db.Add(CreateGift(42, senderId: 10, recipientId: 20, hours: 2.5m, status: "pending", createdAt: DateTime.UtcNow.AddHours(-3), message: null));
        db.Add(CreateGift(42, senderId: 10, recipientId: 20, hours: 9m, status: "accepted", createdAt: DateTime.UtcNow, message: "Not pending"));
        db.Add(CreateGift(42, senderId: 20, recipientId: 10, hours: 3m, status: "pending", createdAt: DateTime.UtcNow, message: "Sent by recipient"));
        db.Add(CreateGift(7, senderId: 70, recipientId: 20, hours: 8m, status: "pending", createdAt: DateTime.UtcNow, message: "Other tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 20);

        var result = await InvokeActionAsync(controller, "Inbox", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var items = document.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(2);
        items.Select(item => item.GetProperty("hours").GetDecimal())
            .Should().Equal(1.25m, 2.5m);
        items[0].GetProperty("message").GetString().Should().Be("Tea time");
        items[0].GetProperty("status").GetString().Should().Be("pending");
        var partner = items[0].GetProperty("partner");
        partner.GetProperty("id").GetInt32().Should().Be(10);
        partner.GetProperty("name").GetString().Should().Be("Alice Blue");
        partner.GetProperty("avatar_url").GetString().Should().Be("https://cdn.example.test/alice.png");
    }

    [Fact]
    public async Task Sent_ReturnsAllCurrentUserSentGiftsNewestFirstWithRecipientPartner()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "sender@example.test", "Sam", "Sender"),
            User(42, 20, "recipient@example.test", "Robin", "Recipient"),
            User(42, 30, "other@example.test", "Other", "Member"),
            User(7, 70, "foreign@example.test", "Foreign", "Tenant"));
        db.Add(CreateGift(42, senderId: 10, recipientId: 20, hours: 4m, status: "accepted", createdAt: DateTime.UtcNow.AddHours(-1), message: "Accepted"));
        db.Add(CreateGift(42, senderId: 10, recipientId: 30, hours: 1m, status: "declined", createdAt: DateTime.UtcNow.AddHours(-2), message: "Declined"));
        db.Add(CreateGift(42, senderId: 30, recipientId: 10, hours: 5m, status: "pending", createdAt: DateTime.UtcNow, message: "Inbox only"));
        db.Add(CreateGift(7, senderId: 10, recipientId: 70, hours: 8m, status: "pending", createdAt: DateTime.UtcNow, message: "Other tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var result = await InvokeActionAsync(controller, "Sent", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var items = document.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(2);
        items.Select(item => item.GetProperty("status").GetString())
            .Should().Equal("accepted", "declined");
        items[0].GetProperty("partner").GetProperty("id").GetInt32().Should().Be(20);
        items[0].GetProperty("partner").GetProperty("name").GetString().Should().Be("Robin Recipient");
    }

    [Fact]
    public async Task Inbox_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 20);

        var result = await InvokeActionAsync(controller, "Inbox", CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task Send_CreatesPendingGiftAndCompletedHiddenWalletReservation()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "sender@example.test", "Sam", "Sender"),
            User(42, 20, "recipient@example.test", "Robin", "Recipient"),
            User(7, 70, "other-recipient@example.test", "Other", "Tenant"));
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 8m);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);
        var request = CreateSendRequest(recipientUserId: 20, hours: 2.5m, message: "  For next week  ");

        var result = await InvokeActionAsync(controller, "Send", request, CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("gift_id").GetInt64().Should().BeGreaterThan(0);
        data.GetProperty("status").GetString().Should().Be("pending");
        data.GetProperty("success").GetBoolean().Should().BeTrue();

        var gift = await db.CaringHourGifts.IgnoreQueryFilters().SingleAsync();
        gift.TenantId.Should().Be(42);
        gift.SenderUserId.Should().Be(10);
        gift.RecipientUserId.Should().Be(20);
        gift.Hours.Should().Be(2.5m);
        gift.Message.Should().Be("For next week");
        gift.Status.Should().Be("pending");

        var hold = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Description == "Caring hour gift reservation");
        gift.ReservationTransactionId.Should().Be(hold.Id);
        hold.TenantId.Should().Be(42);
        hold.SenderId.Should().Be(10);
        hold.ReceiverId.Should().BeNull();
        hold.Amount.Should().Be(2.5m);
        hold.Status.Should().Be(TransactionStatus.Completed);
        hold.TransactionType.Should().Be(PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType);
    }

    [Fact]
    public async Task Accept_MarksPendingGiftAcceptedAndCreditsRecipientWallet()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "sender@example.test", "Sam", "Sender"),
            User(42, 20, "recipient@example.test", "Robin", "Recipient"));
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 8m);
        db.Add(CreateReservedGift(
            db,
            42,
            senderId: 10,
            recipientId: 20,
            hours: 2.75m,
            status: "pending",
            createdAt: DateTime.UtcNow.AddHours(-2),
            message: "For care travel",
            id: 100));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 20);

        var result = await InvokeActionAsync(controller, "Accept", 100L, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("success").GetBoolean()
            .Should().BeTrue();

        var gift = await db.CaringHourGifts.IgnoreQueryFilters().SingleAsync(g => g.Id == 100);
        gift.Status.Should().Be("accepted");
        gift.AcceptedAt.Should().NotBeNull();
        gift.UpdatedAt.Should().NotBeNull();
        gift.ReservationTransactionId.Should().NotBeNull();
        gift.SettlementTransactionId.Should().NotBeNull();

        var walletCredit = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Description == "Caring hour gift accepted");
        walletCredit.TenantId.Should().Be(42);
        walletCredit.SenderId.Should().BeNull();
        walletCredit.ReceiverId.Should().Be(20);
        walletCredit.Amount.Should().Be(2.75m);
        walletCredit.Status.Should().Be(TransactionStatus.Completed);
        walletCredit.Description.Should().Be("Caring hour gift accepted");
        walletCredit.TransactionType.Should().Be(PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType);

        var duplicate = await InvokeActionAsync(controller, "Accept", 100L, CancellationToken.None);
        var duplicateError = duplicate.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        duplicateError.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(t => t.Description == "Caring hour gift accepted"))
            .Should().Be(1);
    }

    [Fact]
    public async Task Accept_WhenReservationLinkMissing_FailsWithoutMintingCredit()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "sender@example.test", "Sam", "Sender"),
            User(42, 20, "recipient@example.test", "Robin", "Recipient"));
        db.Add(CreateGift(
            42,
            senderId: 10,
            recipientId: 20,
            hours: 2m,
            status: "pending",
            createdAt: DateTime.UtcNow.AddHours(-1),
            message: "Broken legacy reservation",
            id: 103));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 20);

        var result = await InvokeActionAsync(controller, "Accept", 103L, CancellationToken.None);

        var error = result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        error.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        (await db.CaringHourGifts.IgnoreQueryFilters().SingleAsync(gift => gift.Id == 103))
            .Status.Should().Be("pending");
        (await db.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Decline_MarksPendingGiftDeclinedStoresReasonAndRefundsSenderWallet()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "sender@example.test", "Sam", "Sender"),
            User(42, 20, "recipient@example.test", "Robin", "Recipient"));
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 8m);
        db.Add(CreateReservedGift(
            db,
            42,
            senderId: 10,
            recipientId: 20,
            hours: 3.5m,
            status: "pending",
            createdAt: DateTime.UtcNow.AddHours(-2),
            message: "Could you use these?",
            id: 101));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 20);
        var request = CreateDeclineRequest("  Not needed this week  ");

        var result = await InvokeActionAsync(controller, "Decline", 101L, request, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("success").GetBoolean()
            .Should().BeTrue();

        var gift = await db.CaringHourGifts.IgnoreQueryFilters().SingleAsync(g => g.Id == 101);
        gift.Status.Should().Be("declined");
        gift.DeclinedAt.Should().NotBeNull();
        gift.UpdatedAt.Should().NotBeNull();
        gift.DeclineReason.Should().Be("Not needed this week");

        gift.ReservationTransactionId.Should().NotBeNull();
        gift.SettlementTransactionId.Should().NotBeNull();
        var refund = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Description == "Caring hour gift declined refund");
        refund.TenantId.Should().Be(42);
        refund.SenderId.Should().BeNull();
        refund.ReceiverId.Should().Be(10);
        refund.Amount.Should().Be(3.5m);
        refund.Status.Should().Be(TransactionStatus.Completed);
        refund.Description.Should().Be("Caring hour gift declined refund");
        refund.TransactionType.Should().Be(PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType);
    }

    [Fact]
    public async Task Revert_MarksPendingGiftRevertedAndRefundsSenderWallet()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, 10, "sender@example.test", "Sam", "Sender"),
            User(42, 20, "recipient@example.test", "Robin", "Recipient"));
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 8m);
        db.Add(CreateReservedGift(
            db,
            42,
            senderId: 10,
            recipientId: 20,
            hours: 4.25m,
            status: "pending",
            createdAt: DateTime.UtcNow.AddHours(-2),
            message: "Withdraw before accepted",
            id: 102));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var result = await InvokeActionAsync(controller, "Revert", 102L, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("success").GetBoolean()
            .Should().BeTrue();

        var gift = await db.CaringHourGifts.IgnoreQueryFilters().SingleAsync(g => g.Id == 102);
        gift.Status.Should().Be("reverted");
        gift.RevertedAt.Should().NotBeNull();
        gift.UpdatedAt.Should().NotBeNull();

        gift.ReservationTransactionId.Should().NotBeNull();
        gift.SettlementTransactionId.Should().NotBeNull();
        var refund = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Description == "Caring hour gift reverted refund");
        refund.TenantId.Should().Be(42);
        refund.SenderId.Should().BeNull();
        refund.ReceiverId.Should().Be(10);
        refund.Amount.Should().Be(4.25m);
        refund.Status.Should().Be(TransactionStatus.Completed);
        refund.Description.Should().Be("Caring hour gift reverted refund");
        refund.TransactionType.Should().Be(PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType);
    }

    private static Type? ResolveControllerType()
    {
        return Type.GetType("Nexus.Api.Controllers.CaringCommunityHourGiftsController, Nexus.Api");
    }

    private static Type ResolveGiftType()
    {
        var type = Type.GetType("Nexus.Api.Entities.CaringHourGift, Nexus.Api");
        type.Should().NotBeNull();
        return type!;
    }

    private static Type ResolveServiceType()
    {
        var type = Type.GetType("Nexus.Api.Services.CaringHourGiftService, Nexus.Api");
        type.Should().NotBeNull();
        return type!;
    }

    private static object CreateGift(
        int tenantId,
        int senderId,
        int recipientId,
        decimal hours,
        string status,
        DateTime createdAt,
        string? message,
        long? id = null)
    {
        var type = ResolveGiftType();
        var gift = Activator.CreateInstance(type)!;
        if (id.HasValue)
        {
            Set(gift, "Id", id.Value);
        }
        Set(gift, "TenantId", tenantId);
        Set(gift, "SenderUserId", senderId);
        Set(gift, "RecipientUserId", recipientId);
        Set(gift, "Hours", hours);
        Set(gift, "Message", message);
        Set(gift, "Status", status);
        Set(gift, "CreatedAt", createdAt);
        Set(gift, "UpdatedAt", createdAt);
        return gift;
    }

    private static object CreateReservedGift(
        NexusDbContext db,
        int tenantId,
        int senderId,
        int recipientId,
        decimal hours,
        string status,
        DateTime createdAt,
        string? message,
        long? id = null)
    {
        var reservation = new Transaction
        {
            TenantId = tenantId,
            SenderId = senderId,
            ReceiverId = null,
            Amount = hours,
            Description = "Caring hour gift reservation",
            TransactionType = PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = createdAt
        };
        db.Transactions.Add(reservation);
        var gift = CreateGift(
            tenantId,
            senderId,
            recipientId,
            hours,
            status,
            createdAt,
            message,
            id);
        Set(gift, "ReservationTransaction", reservation);
        return gift;
    }

    private static object CreateDeclineRequest(string? reason)
    {
        var type = Type.GetType("Nexus.Api.Controllers.CaringHourGiftDeclineRequest, Nexus.Api");
        type.Should().NotBeNull();
        var request = Activator.CreateInstance(type!)!;
        Set(request, "Reason", reason);
        return request;
    }

    private static object CreateSendRequest(int recipientUserId, decimal hours, string? message)
    {
        var type = Type.GetType("Nexus.Api.Controllers.CaringHourGiftSendRequest, Nexus.Api");
        type.Should().NotBeNull();
        var request = Activator.CreateInstance(type!)!;
        Set(request, "RecipientUserId", recipientUserId);
        Set(request, "Hours", hours);
        Set(request, "Message", message);
        return request;
    }

    private static void SeedBalance(NexusDbContext db, int tenantId, int receiverId, decimal amount)
    {
        db.Transactions.Add(new Transaction
        {
            TenantId = tenantId,
            SenderId = null,
            ReceiverId = receiverId,
            Amount = amount,
            Description = "Seed grant",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow.AddDays(-7)
        });
    }

    private static void Set(object target, string propertyName, object? value)
    {
        var property = target.GetType().GetProperty(propertyName);
        property.Should().NotBeNull();
        property!.SetValue(target, value);
    }

    private static ControllerBase CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var controllerType = ResolveControllerType();
        controllerType.Should().NotBeNull();
        var service = Activator.CreateInstance(ResolveServiceType(), db, tenant);
        var controller = Activator.CreateInstance(controllerType!, service, tenant)
            .Should().BeAssignableTo<ControllerBase>().Subject;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static async Task<IActionResult> InvokeActionAsync(
        object controller,
        string actionName,
        params object?[] parameters)
    {
        var method = controller.GetType().GetMethod(actionName);
        method.Should().NotBeNull();
        var result = method!.Invoke(controller, parameters);
        return await result.Should().BeAssignableTo<Task<IActionResult>>().Subject;
    }

    private static User User(
        int tenantId,
        int id,
        string email,
        string firstName,
        string lastName,
        string? avatarUrl = null)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = email,
            PasswordHash = "test",
            FirstName = firstName,
            LastName = lastName,
            Role = "member",
            AvatarUrl = avatarUrl,
            IsActive = true
        };
    }

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, "member"),
                    new Claim("role", "member")
                ], "Test"))
            }
        };
    }
}
