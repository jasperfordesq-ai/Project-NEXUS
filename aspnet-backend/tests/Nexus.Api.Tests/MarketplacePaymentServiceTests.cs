// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Controllers;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Xunit;

namespace Nexus.Api.Tests;

public sealed class MarketplacePaymentServiceTests
{
    [Fact]
    public async Task CreateAndConfirm_UsesProviderBoundEconomicsAndPersistsExactlyOnce()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);

        var created = await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None);

        created.Succeeded.Should().BeTrue();
        gateway.CreateCalls.Should().Be(1);
        gateway.AmountMinor.Should().Be(2599);
        gateway.PlatformFeeMinor.Should().Be(130);
        gateway.ConnectedAccountId.Should().Be("acct_real_seller");
        gateway.IdempotencyKey.Should().Be($"market-order-42-{order.Id}");
        gateway.Metadata.Should().Contain(new KeyValuePair<string, string>("nexus_seller_payout_minor", "2469"));
        order.PaymentIntentId.Should().Be("pi_marketplace_1");
        order.Status.Should().Be("pending_payment");

        gateway.Retrieved = gateway.Created! with { Status = "succeeded", AmountReceivedMinor = 2599, LatestChargeId = "ch_1" };
        var confirmed = await service.ConfirmAsync(42, 11, "pi_marketplace_1", CancellationToken.None);
        var replay = await service.ConfirmAsync(42, 11, "pi_marketplace_1", CancellationToken.None);

        confirmed.Succeeded.Should().BeTrue();
        replay.Succeeded.Should().BeTrue();
        gateway.RetrieveCalls.Should().Be(2, "replays must revalidate the provider before returning local evidence");
        order.Status.Should().Be("paid");
        var payment = await db.MarketplacePayments.SingleAsync();
        payment.Amount.Should().Be(25.99m);
        payment.PlatformFee.Should().Be(1.30m);
        payment.SellerPayout.Should().Be(24.69m);
        payment.Status.Should().Be("succeeded");
        payment.PayoutStatus.Should().Be("paid");
        payment.StripeChargeId.Should().Be("ch_1");
    }

    [Fact]
    public async Task EscrowCapture_DelaysPayoutUntilBuyerWindowAndReleasesExactlyOnce()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Marketplace:PlatformFeePercent"] = "5",
            ["Marketplace:EscrowEnabled"] = "true",
            ["Marketplace:EscrowAutoReleaseDays"] = "14",
            ["Marketplace:EscrowDisputeWindowDays"] = "14"
        }).Build();
        var service = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance);
        var order = SeedPayableOrder(db);

        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.FundsFlow.Should().Be("separate_charge_transfer");
        gateway.Created!.ApplicationFeeMinor.Should().BeNull();
        gateway.Created.DestinationAccountId.Should().BeNull();
        gateway.Metadata["nexus_funds_flow"].Should().Be("separate_charge_transfer");
        gateway.Retrieved = gateway.Created with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_escrow_1"
        };

        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();

        var payment = await db.MarketplacePayments.SingleAsync();
        var escrow = await db.MarketplaceEscrows.SingleAsync();
        payment.FundsFlow.Should().Be("separate_charge_transfer");
        payment.PayoutStatus.Should().Be("pending");
        payment.PayoutId.Should().BeNull();
        escrow.Status.Should().Be("held");
        escrow.Amount.Should().Be(24.69m);
        gateway.TransferCalls.Should().Be(0);

        (await service.ConfirmDeliveryAsync(42, 22, order.Id, CancellationToken.None))
            .Error!.Code.Should().Be("FORBIDDEN");
        (await service.ConfirmDeliveryAsync(42, 11, order.Id, CancellationToken.None))
            .Succeeded.Should().BeTrue();
        order.Status.Should().Be("delivered");
        order.BuyerConfirmedAt.Should().NotBeNull();
        order.AutoCompleteAt.Should().BeAfter(order.BuyerConfirmedAt!.Value);
        gateway.TransferCalls.Should().Be(0, "delivery confirmation starts the dispute window");

        escrow.ReleaseAfter = DateTime.UtcNow.AddMinutes(-1);
        order.AutoCompleteAt = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();

        (await service.ProcessEligibleEscrowReleasesAsync(CancellationToken.None)).Should().Be(1);
        (await service.ReleaseEscrowAsync(42, escrow.Id, "auto_timeout", CancellationToken.None))
            .Succeeded.Should().BeTrue();

        gateway.TransferCalls.Should().Be(1);
        payment.PayoutStatus.Should().Be("paid");
        payment.PayoutId.Should().Be("tr_marketplace_1");
        escrow.Status.Should().Be("released");
        escrow.ReleaseTrigger.Should().Be("auto_timeout");
        order.Status.Should().Be("completed");
        order.EscrowReleasedAt.Should().NotBeNull();
        var payoutBell = await db.Notifications.SingleAsync(row => row.Type == "marketplace_payout");
        payoutBell.UserId.Should().Be(22);
        payoutBell.Body.Should().Be($"Deine Auszahlung von 24.69 für Bestellung #{order.Id} wurde freigegeben.");
        payoutBell.Link.Should().Be($"/marketplace/orders/{order.Id}");
        (await db.MarketplaceOrderNotificationDeliveries.CountAsync(row => row.Event == "payout_released"))
            .Should().Be(1);
    }

    [Fact]
    public async Task Refund_PartialThenFull_UsesStableProviderEconomicsAndDurableLedger()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var email = new RecordingEmailService();
        var service = CreateService(db, gateway, email);
        var order = SeedPayableOrder(db);
        var listing = await db.MarketplaceListings.SingleAsync();
        var originalQuantity = listing.Quantity;

        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_refund_1"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        email.Calls.Clear();
        email.RejectAddress = "seller@example.test";

        (await service.ProcessRefundAsync(42, order.Id, 5m, "partial settlement", CancellationToken.None))
            .Succeeded.Should().BeTrue();
        var payment = await db.MarketplacePayments.SingleAsync();
        payment.Status.Should().Be("partially_refunded");
        payment.RefundAmount.Should().Be(5m);
        payment.PlatformFee.Should().Be(1.05m);
        payment.SellerPayout.Should().Be(19.94m);
        order.Status.Should().Be("paid");
        listing.Quantity.Should().Be(originalQuantity);
        gateway.RefundAmountMinor.Should().Be(500);
        gateway.RefundReverseTransfer.Should().BeTrue();
        gateway.RefundApplicationFee.Should().BeTrue();
        email.Calls.Should().HaveCount(2);
        email.Calls.Single(call => call.To == "buyer@example.test").Subject
            .Should().Be($"Partial refund processed \u2014 {order.OrderNumber}");
        email.Calls.Single(call => call.To == "seller@example.test").Subject
            .Should().Be($"Teilweise R\u00fcckerstattung ausgestellt \u2013 {order.OrderNumber} bestellen");
        (await db.MarketplaceOrderNotificationDeliveries.SingleAsync(row =>
            row.Event == "refund" && row.UserId == 22 && row.Channel == "email")).Status.Should().Be("failed");

        email.RejectAddress = null;
        (await service.ProcessRefundAsync(42, order.Id, null, "full settlement", CancellationToken.None))
            .Succeeded.Should().BeTrue();
        payment.Status.Should().Be("refunded");
        payment.RefundAmount.Should().Be(25.99m);
        payment.PlatformFee.Should().Be(0);
        payment.SellerPayout.Should().Be(0);
        order.Status.Should().Be("refunded");
        listing.Quantity.Should().Be(originalQuantity + 1);
        gateway.RefundCalls.Should().Be(2);
        (await db.MarketplacePaymentRefunds.CountAsync()).Should().Be(2);
        (await db.MarketplacePaymentRefunds.SumAsync(x => x.Amount)).Should().Be(25.99m);
        email.Calls.Should().HaveCount(3, "the evidenced buyer email is not repeated and the failed seller email heals");
        email.Calls.Last().To.Should().Be("seller@example.test");
        email.Calls.Last().Subject.Should().Be($"Refund issued \u2014 Order {order.OrderNumber}");
        (await db.Notifications.AsNoTracking().ToListAsync())
            .Count(row => (row.Body ?? string.Empty).Contains("refund", StringComparison.OrdinalIgnoreCase)).Should().Be(4);
        var refundDeliveries = await db.MarketplaceOrderNotificationDeliveries
            .Where(row => row.Event.StartsWith("refund_")).ToListAsync();
        refundDeliveries.Should().HaveCount(4, "each distinct partial/full bell message is delivered to both users");
        refundDeliveries.Should().OnlyContain(row => row.Status == "delivered" && row.Channel == "bell");
        var refundEmails = await db.MarketplaceOrderNotificationDeliveries
            .Where(row => row.Event == "refund").ToListAsync();
        refundEmails.Should().HaveCount(2);
        refundEmails.Should().OnlyContain(row => row.Status == "delivered");
        refundEmails.Single(row => row.UserId == 22).Attempts.Should().Be(2);

        (await service.ProcessRefundAsync(42, order.Id, null, "full settlement", CancellationToken.None))
            .Succeeded.Should().BeTrue();
        email.Calls.Should().HaveCount(3, "delivered refund channels must not be repeated");
        (await db.MarketplacePaymentRefunds.CountAsync()).Should().Be(2, "delivery replay must not repeat money movement");
        refundDeliveries = await db.MarketplaceOrderNotificationDeliveries
            .Where(row => row.Event.StartsWith("refund_")).ToListAsync();
        refundDeliveries.Should().OnlyContain(row => row.Status == "delivered");
    }

    [Fact]
    public async Task Refund_AfterEscrowPayout_ReversesOnlyTheSellerTransferShare()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Marketplace:PlatformFeePercent"] = "5",
            ["Marketplace:EscrowEnabled"] = "true"
        }).Build();
        var service = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance);
        var order = SeedPayableOrder(db);

        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_refund_escrow"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        var escrow = await db.MarketplaceEscrows.SingleAsync();
        escrow.ReleaseAfter = DateTime.UtcNow.AddMinutes(-1);
        order.Status = "delivered";
        order.AutoCompleteAt = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        (await service.ReleaseEscrowAsync(42, escrow.Id, "auto_timeout", CancellationToken.None)).Succeeded.Should().BeTrue();

        (await service.ProcessRefundAsync(42, order.Id, null, "buyer refunded", CancellationToken.None))
            .Succeeded.Should().BeTrue();

        gateway.RefundReverseTransfer.Should().BeFalse();
        gateway.RefundApplicationFee.Should().BeFalse();
        gateway.TransferReversalCalls.Should().Be(1);
        gateway.TransferReversalAmountMinor.Should().Be(2469);
        (await db.MarketplacePayments.SingleAsync()).PayoutStatus.Should().Be("failed");
        (await db.MarketplaceEscrows.SingleAsync()).Status.Should().Be("refunded");
    }

    [Fact]
    public async Task ChargeRefunded_ReconcilesProviderEvidenceAndReplaysExactlyOnce()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var email = new RecordingEmailService();
        var service = CreateService(db, gateway, email);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_external_refund"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        email.Calls.Clear();
        MarketplaceStripeRefund[] refunds =
        [
            new("re_external_1", 200, "EUR", "succeeded", TransferReversed: true,
                ApplicationFeeRefunded: true),
            new("re_external_2", 300, "EUR", "succeeded", TransferReversed: true,
                ApplicationFeeRefunded: true)
        ];

        (await service.ReconcileChargeRefundedAsync(
            gateway.Created.Id, "ch_external_refund", 500, refunds, "evt_refund_1", CancellationToken.None))
            .Succeeded.Should().BeTrue();
        (await service.ReconcileChargeRefundedAsync(
            gateway.Created.Id, "ch_external_refund", 500, refunds, "evt_refund_1", CancellationToken.None))
            .Succeeded.Should().BeTrue();

        var payment = await db.MarketplacePayments.SingleAsync();
        payment.Status.Should().Be("partially_refunded");
        payment.RefundAmount.Should().Be(5m);
        (await db.MarketplacePaymentRefunds.CountAsync()).Should().Be(2);
        (await db.WebhookEvents.CountAsync(x => x.ExternalEventId == "evt_refund_1")).Should().Be(1);
        gateway.RefundCalls.Should().Be(0, "the provider already created an external refund");
        email.Calls.Should().HaveCount(2, "a multi-refund webhook emits one cumulative notification per recipient");
        email.Calls.Should().OnlyContain(call => call.Subject.Contains("Partial refund processed", StringComparison.Ordinal) ||
                                                call.Subject.Contains("Teilweise R\u00fcckerstattung", StringComparison.Ordinal));
        (await db.Notifications.CountAsync(row => row.Type == "marketplace_order" &&
                                                   (row.Body ?? string.Empty).Contains("5.00 EUR"))).Should().Be(2);
    }

    [Fact]
    public async Task ChargeRefunded_DestinationChargeFailsClosedWithoutReversalEvidence()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_external_unsafe"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();

        var result = await service.ReconcileChargeRefundedAsync(
            gateway.Created.Id, "ch_external_unsafe", 500,
            [new MarketplaceStripeRefund("re_external_unsafe", 500, "EUR", "succeeded")],
            "evt_refund_unsafe", CancellationToken.None);

        result.Error!.Code.Should().Be("RESOLUTION_FAILED");
        (await db.MarketplacePaymentRefunds.CountAsync()).Should().Be(0);
        (await db.WebhookEvents.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task ChargeDispute_HeldEscrowWon_RestoresOrderAndReleaseEligibility()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Marketplace:PlatformFeePercent"] = "5",
            ["Marketplace:EscrowEnabled"] = "true"
        }).Build();
        var service = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded", AmountReceivedMinor = 2599, LatestChargeId = "ch_dispute_won"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();

        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.created", "dp_held_won", "ch_dispute_won", "needs_response", 2599,
            "evt_dp_created", CancellationToken.None)).Succeeded.Should().BeTrue();
        order.Status.Should().Be("disputed");
        (await db.MarketplaceEscrows.SingleAsync()).Status.Should().Be("disputed");

        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.closed", "dp_held_won", "ch_dispute_won", "won", 2599,
            "evt_dp_won", CancellationToken.None)).Succeeded.Should().BeTrue();
        order.Status.Should().Be("paid");
        var escrow = await db.MarketplaceEscrows.SingleAsync();
        escrow.Status.Should().Be("held");
        escrow.ReleaseAfter.Should().BeOnOrBefore(DateTime.UtcNow);
        (await db.MarketplacePaymentRefunds.CountAsync()).Should().Be(0);
        (await db.WebhookEvents.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task ChargeDispute_HeldEscrowLost_RefundsOrderWithoutTransferMovement()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Marketplace:PlatformFeePercent"] = "5",
            ["Marketplace:EscrowEnabled"] = "true"
        }).Build();
        var service = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded", AmountReceivedMinor = 2599, LatestChargeId = "ch_dispute_lost"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.created", "dp_held_lost", "ch_dispute_lost", "needs_response", 2599,
            "evt_dp_lost_created", CancellationToken.None)).Succeeded.Should().BeTrue();

        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.closed", "dp_held_lost", "ch_dispute_lost", "lost", 2599,
            "evt_dp_lost", CancellationToken.None)).Succeeded.Should().BeTrue();

        var payment = await db.MarketplacePayments.SingleAsync();
        payment.Status.Should().Be("refunded");
        payment.StripeDisputeStatus.Should().Be("lost");
        order.Status.Should().Be("refunded");
        (await db.MarketplaceEscrows.SingleAsync()).Status.Should().Be("refunded");
        var ledger = await db.MarketplacePaymentRefunds.SingleAsync();
        ledger.StripeRefundId.Should().Be("dispute:dp_held_lost");
        ledger.Reason.Should().Be("stripe_dispute_lost");
        gateway.TransferReversalCalls.Should().Be(0);
    }

    [Fact]
    public async Task ChargeDispute_PaidSeparateChargeWon_ReversesThenReimbursesExactSellerShare()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Marketplace:PlatformFeePercent"] = "5",
            ["Marketplace:EscrowEnabled"] = "true"
        }).Build();
        var service = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded", AmountReceivedMinor = 2599, LatestChargeId = "ch_paid_dispute_won"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        var escrow = await db.MarketplaceEscrows.SingleAsync();
        escrow.ReleaseAfter = DateTime.UtcNow.AddMinutes(-1);
        order.Status = "delivered";
        order.AutoCompleteAt = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        (await service.ReleaseEscrowAsync(42, escrow.Id, "auto_timeout", CancellationToken.None)).Succeeded.Should().BeTrue();

        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.created", "dp_paid_won", "ch_paid_dispute_won", "needs_response", 2599,
            "evt_paid_dp_created", CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.TransferReversalCalls.Should().Be(1);
        gateway.TransferReversalAmountMinor.Should().Be(2469);
        var payment = await db.MarketplacePayments.SingleAsync();
        payment.SellerPayout.Should().Be(0);

        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.closed", "dp_paid_won", "ch_paid_dispute_won", "won", 2599,
            "evt_paid_dp_won", CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.TransferCalls.Should().Be(2, "the second transfer reimburses the reversed seller share");
        payment.SellerPayout.Should().Be(24.69m);
        payment.PayoutStatus.Should().Be("paid");
        (await db.MarketplacePaymentRefunds.SingleAsync()).Reason.Should().Be("stripe_dispute_won");
    }

    [Fact]
    public async Task ChargeDispute_DestinationChargeLost_RetrievesAndReversesProviderTransfer()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true, ChargeTransferId = "tr_destination_charge" };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded", AmountReceivedMinor = 2599, LatestChargeId = "ch_destination_dispute"
        };
        (await service.ConfirmAsync(42, 11, gateway.Created.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.created", "dp_destination_lost", "ch_destination_dispute", "needs_response", 2599,
            "evt_destination_created", CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.TransferReversalCalls.Should().Be(0, "destination transfer reversal waits for a provider loss");

        (await service.ReconcileChargeDisputeAsync(
            "charge.dispute.closed", "dp_destination_lost", "ch_destination_dispute", "lost", 2599,
            "evt_destination_lost", CancellationToken.None)).Succeeded.Should().BeTrue();

        gateway.ChargeRetrieveCalls.Should().Be(1);
        gateway.TransferReversalCalls.Should().Be(1);
        gateway.TransferReversalAmountMinor.Should().Be(2469);
        var payment = await db.MarketplacePayments.SingleAsync();
        payment.Status.Should().Be("refunded");
        payment.SellerPayout.Should().Be(0);
        order.Status.Should().Be("refunded");
        var ledger = await db.MarketplacePaymentRefunds.SingleAsync();
        ledger.Reason.Should().Be("stripe_dispute_lost");
        ledger.SellerPayoutReversal.Should().Be(24.69m);
    }

    [Fact]
    public async Task StripeGateway_SeparateChargeOmitsDestinationAndApplicationFee()
    {
        var handler = new RecordingHandler();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stripe:SecretKey"] = "sk_test_redacted",
            ["Stripe:ApiBaseUrl"] = "https://stripe.test"
        }).Build();
        var gateway = new MarketplaceStripeGateway(new SingleClientFactory(new HttpClient(handler)), configuration,
            NullLogger<MarketplaceStripeGateway>.Instance);
        var metadata = new Dictionary<string, string> { ["nexus_order_id"] = "77", ["nexus_tenant_id"] = "42" };

        await gateway.CreateIntentAsync(2599, "EUR", "acct_123", 130, "separate_charge_transfer", metadata,
            "market-order-42-77", CancellationToken.None);

        handler.Body.Should().Contain("transfer_group=marketplace_order_77");
        handler.Body.Should().NotContain("application_fee_amount");
        handler.Body.Should().NotContain("transfer_data%5Bdestination%5D");
    }

    [Fact]
    public async Task StripeGateway_CreatesSourceBoundTransferWithStableIdempotency()
    {
        var handler = new RecordingHandler();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stripe:SecretKey"] = "sk_test_redacted",
            ["Stripe:ApiBaseUrl"] = "https://stripe.test"
        }).Build();
        var gateway = new MarketplaceStripeGateway(new SingleClientFactory(new HttpClient(handler)), configuration,
            NullLogger<MarketplaceStripeGateway>.Instance);

        var transfer = await gateway.CreateTransferAsync(
            2469,
            "EUR",
            "acct_123",
            "ch_escrow_1",
            "marketplace_order_77",
            new Dictionary<string, string> { ["nexus_order_id"] = "77", ["nexus_type"] = "marketplace_payout" },
            "marketplace-payout-42-9",
            CancellationToken.None);

        transfer.Should().Be(new MarketplaceStripeTransfer("tr_provider_77", 2469, "EUR", "acct_123", "ch_escrow_1"));
        handler.Uri.Should().Be("https://stripe.test/v1/transfers");
        handler.IdempotencyKey.Should().Be("marketplace-payout-42-9");
        handler.Body.Should().Contain("amount=2469");
        handler.Body.Should().Contain("destination=acct_123");
        handler.Body.Should().Contain("source_transaction=ch_escrow_1");
        handler.Body.Should().Contain("transfer_group=marketplace_order_77");
        handler.Body.Should().Contain("metadata%5Bnexus_type%5D=marketplace_payout");
    }

    [Fact]
    public async Task ConfirmPaid_DeliversLocalizedBuyerAndSellerEmailAndBellExactlyOnce()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var email = new RecordingEmailService();
        var service = CreateService(db, gateway, email);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_paid_notifications"
        };

        (await service.ConfirmAsync(42, 11, gateway.Created!.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        (await service.ConfirmAsync(42, 11, gateway.Created!.Id, CancellationToken.None)).Succeeded.Should().BeTrue();

        email.Calls.Should().HaveCount(2);
        email.Calls.Single(call => call.To == "buyer@example.test").Subject
            .Should().Be($"Payment received — {order.OrderNumber}");
        email.Calls.Single(call => call.To == "seller@example.test").Subject
            .Should().Be($"Bestellung bezahlt – {order.OrderNumber}");
        email.Calls.Single(call => call.To == "seller@example.test").HtmlBody
            .Should().Contain("Provider &amp; Seller").And.Contain("25.99 EUR");

        var bells = await db.Notifications.OrderBy(row => row.UserId).ToListAsync();
        bells.Should().HaveCount(2);
        bells.Single(row => row.UserId == 11).Should().Match<Notification>(row =>
            row.TenantId == 42 && row.Type == "marketplace_order" &&
            row.Title == "Marketplace order" &&
            row.Body == $"Payment received for order #{order.OrderNumber}: 25.99 EUR" &&
            row.Link == $"/marketplace/orders/{order.Id}");
        bells.Single(row => row.UserId == 22).Body
            .Should().Be($"Bestellung Nr. {order.OrderNumber} wurde bezahlt: 25.99 EUR");

        var deliveries = await db.MarketplaceOrderNotificationDeliveries
            .OrderBy(row => row.UserId).ThenBy(row => row.Channel).ToListAsync();
        deliveries.Should().HaveCount(4);
        deliveries.Should().OnlyContain(row => row.Event == "paid" && row.Status == "delivered" && row.Attempts == 1);
        deliveries.Where(row => row.Channel == "bell").Should().OnlyContain(row => !string.IsNullOrWhiteSpace(row.EvidenceId));
        deliveries.Where(row => row.Channel == "email").Should().OnlyContain(row => row.EvidenceId!.StartsWith("mail-"));
    }

    [Fact]
    public async Task ConfirmPaid_EmailFailureDoesNotRollbackPaymentOrSuppressBells()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var email = new RecordingEmailService { RejectAddress = "seller@example.test" };
        var service = CreateService(db, gateway, email);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with { Status = "succeeded", AmountReceivedMinor = 2599 };

        var result = await service.ConfirmAsync(42, 11, gateway.Created!.Id, CancellationToken.None);

        result.Succeeded.Should().BeTrue();
        order.Status.Should().Be("paid");
        (await db.MarketplacePayments.CountAsync()).Should().Be(1);
        (await db.Notifications.CountAsync()).Should().Be(2);
        var sellerEmail = await db.MarketplaceOrderNotificationDeliveries.SingleAsync(row =>
            row.UserId == 22 && row.Channel == "email");
        sellerEmail.Status.Should().Be("failed");
        sellerEmail.LastError.Should().Be("email_provider_rejected");
        (await db.MarketplaceOrderNotificationDeliveries.CountAsync(row => row.Status == "delivered")).Should().Be(3);

        email.RejectAddress = null;
        (await service.ConfirmAsync(42, 11, gateway.Created!.Id, CancellationToken.None)).Succeeded.Should().BeTrue();

        email.Calls.Should().HaveCount(3, "only the failed seller email should be retried");
        (await db.Notifications.CountAsync()).Should().Be(2);
        await db.Entry(sellerEmail).ReloadAsync();
        sellerEmail.Status.Should().Be("delivered");
        sellerEmail.Attempts.Should().Be(2);
    }

    [Fact]
    public async Task MissingProviderAndMismatchedEconomics_FailClosedWithoutLocalPaymentEvidence()
    {
        await using var db = CreateDb();
        var order = SeedPayableOrder(db);
        var disabled = CreateService(db, new FakeGateway());

        var disabledResult = await disabled.CreateIntentAsync(42, 11, order.Id, CancellationToken.None);
        disabledResult.Error!.Code.Should().Be("FEATURE_DISABLED");
        order.PaymentIntentId.Should().BeNull();

        var gateway = new FakeGateway { Configured = true, CorruptCreateMetadata = true };
        var service = CreateService(db, gateway);
        var mismatch = await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None);

        mismatch.Error!.Code.Should().Be("PAYMENT_ERROR");
        order.PaymentIntentId.Should().BeNull();
        order.Status.Should().Be("pending_payment");
        (await db.MarketplacePayments.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task StripeGateway_SendsConnectDestinationChargeAndStableIdempotencyKey()
    {
        var handler = new RecordingHandler();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stripe:SecretKey"] = "sk_test_redacted",
            ["Stripe:ApiBaseUrl"] = "https://stripe.test"
        }).Build();
        var gateway = new MarketplaceStripeGateway(new SingleClientFactory(new HttpClient(handler)), configuration,
            NullLogger<MarketplaceStripeGateway>.Instance);
        var metadata = new Dictionary<string, string> { ["nexus_order_id"] = "77", ["nexus_tenant_id"] = "42" };

        var result = await gateway.CreateIntentAsync(2599, "EUR", "acct_123", 130, "destination_charge", metadata, "market-order-42-77", CancellationToken.None);

        result.Id.Should().Be("pi_provider_77");
        handler.Method.Should().Be(HttpMethod.Post);
        handler.Uri.Should().Be("https://stripe.test/v1/payment_intents");
        handler.Authorization.Should().Be("Bearer sk_test_redacted");
        handler.IdempotencyKey.Should().Be("market-order-42-77");
        handler.Body.Should().Contain("amount=2599");
        handler.Body.Should().Contain("application_fee_amount=130");
        handler.Body.Should().Contain("transfer_data%5Bdestination%5D=acct_123");
        handler.Body.Should().Contain("metadata%5Bnexus_order_id%5D=77");
    }

    [Fact]
    public async Task StripeGateway_CreatesRetrievesAndLinksExpressAccountWithCanonicalFields()
    {
        var handler = new ConnectRecordingHandler();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stripe:SecretKey"] = "sk_test_redacted",
            ["Stripe:ApiBaseUrl"] = "https://stripe.test"
        }).Build();
        var gateway = new MarketplaceStripeGateway(new SingleClientFactory(new HttpClient(handler)), configuration,
            NullLogger<MarketplaceStripeGateway>.Instance);

        var created = await gateway.CreateExpressAccountAsync(
            "seller@example.test", 42, 11, "marketplace-connect-account-42-11", CancellationToken.None);
        var retrieved = await gateway.RetrieveAccountAsync(created.Id, CancellationToken.None);
        var link = await gateway.CreateAccountLinkAsync(
            created.Id,
            "https://app.test/acme/marketplace/seller/onboard?refresh=1",
            "https://app.test/acme/marketplace/seller/onboard?complete=1",
            CancellationToken.None);

        created.Id.Should().Be("acct_connect_42");
        retrieved.Should().Be(new MarketplaceStripeAccount("acct_connect_42", true, true, true));
        link.Should().Be("https://connect.stripe.test/setup/acct_connect_42");
        handler.Requests[0].IdempotencyKey.Should().Be("marketplace-connect-account-42-11");
        handler.Requests[0].Body.Should().Contain("type=express");
        handler.Requests[0].Body.Should().Contain("metadata%5Bnexus_user_id%5D=11");
        handler.Requests[0].Body.Should().Contain("capabilities%5Bcard_payments%5D%5Brequested%5D=true");
        handler.Requests[2].Body.Should().Contain("type=account_onboarding");
        handler.Requests[2].Body.Should().Contain("refresh_url=https%3A%2F%2Fapp.test%2Facme%2Fmarketplace%2Fseller%2Fonboard%3Frefresh%3D1");
    }

    [Fact]
    public async Task Confirm_RejectsTamperedIdentityCurrencyAndDestinationEconomics()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        var created = gateway.Created!;

        gateway.Retrieved = created with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            Metadata = created.Metadata.ToDictionary(x => x.Key, x => x.Key == "nexus_buyer_id" ? "999" : x.Value)
        };
        (await service.ConfirmAsync(42, 11, created.Id, CancellationToken.None)).Error!.Code.Should().Be("PAYMENT_ERROR");

        gateway.Retrieved = created with { Status = "succeeded", AmountReceivedMinor = 2599, Currency = "USD" };
        (await service.ConfirmAsync(42, 11, created.Id, CancellationToken.None)).Error!.Code.Should().Be("PAYMENT_ERROR");

        gateway.Retrieved = created with { Status = "succeeded", AmountReceivedMinor = 2599, DestinationAccountId = "acct_other" };
        (await service.ConfirmAsync(42, 11, created.Id, CancellationToken.None)).Error!.Code.Should().Be("PAYMENT_ERROR");
        (await db.MarketplacePayments.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task SellerPayoutsAndBalance_AreTenantSellerScopedAndCurrencyAware()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with { Status = "succeeded", AmountReceivedMinor = 2599, LatestChargeId = "ch_1" };
        (await service.ConfirmAsync(42, 11, gateway.Created!.Id, CancellationToken.None)).Succeeded.Should().BeTrue();

        var payouts = await service.SellerPayoutsAsync(42, 22, 1, 20, CancellationToken.None);
        var balance = await service.SellerBalanceAsync(42, 22, CancellationToken.None);
        var otherSeller = await service.SellerPayoutsAsync(42, 999, 1, 20, CancellationToken.None);

        payouts.Total.Should().Be(1);
        payouts.Items.Single().SellerPayout.Should().Be(24.69m);
        balance.Currency.Should().Be("EUR");
        balance.Pending.Should().Be(0m);
        balance.Available.Should().Be(24.69m);
        balance.TotalEarned.Should().Be(24.69m);
        balance.BalancesByCurrency.Should().ContainSingle();
        otherSeller.Total.Should().Be(0);
    }

    [Fact]
    public async Task CreateIntent_UsesZeroDecimalCurrencyAndRejectsUnsupportedCurrency()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);
        order.Currency = "JPY";
        order.TotalAmount = 2500m;
        await db.SaveChangesAsync();

        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.AmountMinor.Should().Be(2500);
        gateway.PlatformFeeMinor.Should().Be(125);

        order.PaymentIntentId = null;
        order.Currency = "ZZZ";
        await db.SaveChangesAsync();
        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Error!.Code.Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task CreateIntent_AllowsConfiguredZeroPercentPlatformFee()
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Marketplace:PlatformFeePercent"] = "0",
            ["Marketplace:EscrowEnabled"] = "false"
        }).Build();
        var service = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance);
        var order = SeedPayableOrder(db);

        (await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.PlatformFeeMinor.Should().Be(0);
        gateway.Metadata.Should().Contain(new KeyValuePair<string, string>("nexus_seller_payout_minor", "2599"));
    }

    [Theory]
    [InlineData(true, null)]
    [InlineData(false, "checkout_session")]
    public async Task CreateIntent_RejectsExpiredOrDifferentlyClaimedCheckout(bool expired, string? checkoutMode)
    {
        await using var db = CreateDb();
        var gateway = new FakeGateway { Configured = true };
        var service = CreateService(db, gateway);
        var order = SeedPayableOrder(db);
        order.PaymentExpiresAt = expired ? DateTime.UtcNow.AddMinutes(-1) : DateTime.UtcNow.AddMinutes(10);
        order.StripeCheckoutMode = checkoutMode;
        await db.SaveChangesAsync();

        var result = await service.CreateIntentAsync(42, 11, order.Id, CancellationToken.None);

        result.Error!.Code.Should().Be("VALIDATION_ERROR");
        gateway.CreateCalls.Should().Be(0);
        order.PaymentIntentId.Should().BeNull();
    }

    [Fact]
    public async Task ConnectOnboarding_CreatesOnceReusesAccountAndReturnsBothUrlAliases()
    {
        await using var db = CreateDb();
        SeedConnectIdentity(db);
        var gateway = new FakeGateway
        {
            Configured = true,
            ConnectCreated = new("acct_connect_42", false, false, false),
            AccountLink = "https://connect.stripe.test/setup/acct_connect_42"
        };
        var service = CreateService(db, gateway);

        var first = await service.StartConnectOnboardingAsync(42, 11, CancellationToken.None);
        var second = await service.StartConnectOnboardingAsync(42, 11, CancellationToken.None);

        first.Succeeded.Should().BeTrue();
        second.Succeeded.Should().BeTrue();
        gateway.ConnectCreateCalls.Should().Be(1);
        gateway.AccountLinkCalls.Should().Be(2);
        gateway.ConnectIdempotencyKey.Should().Be("marketplace-connect-account-42-11");
        gateway.RefreshUrl.Should().Be("http://localhost:5173/acme/marketplace/seller/onboard?refresh=1");
        gateway.ReturnUrl.Should().Be("http://localhost:5173/acme/marketplace/seller/onboard?complete=1");
        var data = JsonSerializer.SerializeToElement(first.Data);
        data.GetProperty("account_id").GetString().Should().Be("acct_connect_42");
        data.GetProperty("onboarding_url").GetString().Should().Be(gateway.AccountLink);
        data.GetProperty("url").GetString().Should().Be(gateway.AccountLink);
        (await db.MarketplaceSellerProfiles.SingleAsync()).StripeAccountId.Should().Be("acct_connect_42");
    }

    [Fact]
    public async Task ConnectStatusAndWebhook_TransitionExactlyOnceAndLocalizeBell()
    {
        await using var db = CreateDb();
        SeedConnectIdentity(db, "acct_connect_42");
        var gateway = new FakeGateway
        {
            Configured = true,
            ConnectRetrieved = new("acct_connect_42", true, true, true)
        };
        var service = CreateService(db, gateway);

        var status = await service.ConnectOnboardingStatusAsync(42, 11, CancellationToken.None);
        var replay = await service.ReconcileConnectAccountAsync(
            new("acct_connect_42", true, true, true), "evt_account_1", CancellationToken.None);
        var duplicate = await service.ReconcileConnectAccountAsync(
            new("acct_connect_42", true, true, true), "evt_account_1", CancellationToken.None);

        status.Succeeded.Should().BeTrue();
        JsonSerializer.SerializeToElement(status.Data).GetProperty("stripe_onboarding_complete").GetBoolean().Should().BeTrue();
        replay.Succeeded.Should().BeTrue();
        duplicate.Succeeded.Should().BeTrue();
        (await db.MarketplaceSellerProfiles.SingleAsync()).StripeOnboardingComplete.Should().BeTrue();
        var notification = await db.Notifications.SingleAsync();
        notification.Type.Should().Be("marketplace_payout");
        notification.Title.Should().Contain("Verkäuferkonto");
        (await db.WebhookEvents.CountAsync()).Should().Be(1);

        await service.ReconcileConnectAccountAsync(
            new("acct_connect_42", true, false, true), "evt_account_2", CancellationToken.None);
        (await db.MarketplaceSellerProfiles.SingleAsync()).StripeOnboardingComplete.Should().BeFalse();
        (await db.Notifications.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task MarketplaceWebhook_VerifiesSignatureAndAppliesAccountUpdatedOnce()
    {
        await using var db = CreateDb();
        SeedConnectIdentity(db, "acct_connect_42");
        const string secret = "whsec_marketplace_connect_test";
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stripe:WebhookSecret_Marketplace"] = secret,
            ["Marketplace:PlatformFeePercent"] = "5"
        }).Build();
        var paymentService = new MarketplacePaymentService(
            db,
            new FakeGateway { Configured = true },
            configuration,
            NullLogger<MarketplacePaymentService>.Instance);
        var controller = new MarketplaceController(
            new MarketplaceService(db, NullLogger<MarketplaceService>.Instance),
            db,
            paymentService: paymentService,
            configuration: configuration);
        const string body = """
            {"id":"evt_connect_signed_1","type":"account.updated","data":{"object":{"id":"acct_connect_42","details_submitted":true,"charges_enabled":true,"payouts_enabled":true}}}
            """;
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var signature = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}"))).ToLowerInvariant();
        var http = new DefaultHttpContext();
        http.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        http.Request.ContentLength = Encoding.UTF8.GetByteCount(body);
        http.Request.Headers["Stripe-Signature"] = $"t={timestamp},v1={signature}";
        controller.ControllerContext = new ControllerContext { HttpContext = http };

        var result = await controller.StripeWebhook(CancellationToken.None);
        http.Request.Body.Position = 0;
        var replay = await controller.StripeWebhook(CancellationToken.None);

        result.Should().BeOfType<OkObjectResult>();
        replay.Should().BeOfType<OkObjectResult>();
        (await db.MarketplaceSellerProfiles.SingleAsync()).StripeOnboardingComplete.Should().BeTrue();
        (await db.Notifications.CountAsync()).Should().Be(1);
        (await db.WebhookEvents.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task MarketplaceWebhook_PaymentSucceededSettlesAndNotifiesUnchangedFrontendFlowOnce()
    {
        await using var db = CreateDb();
        const string secret = "whsec_marketplace_payment_test";
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stripe:WebhookSecret_Marketplace"] = secret,
            ["Marketplace:PlatformFeePercent"] = "5",
            ["Marketplace:EscrowEnabled"] = "false",
            ["App:FrontendUrl"] = "https://app.example.test"
        }).Build();
        var gateway = new FakeGateway { Configured = true };
        var email = new RecordingEmailService();
        var paymentService = new MarketplacePaymentService(
            db, gateway, configuration, NullLogger<MarketplacePaymentService>.Instance, emailService: email);
        var order = SeedPayableOrder(db);
        (await paymentService.CreateIntentAsync(42, 11, order.Id, CancellationToken.None)).Succeeded.Should().BeTrue();
        gateway.Retrieved = gateway.Created! with
        {
            Status = "succeeded",
            AmountReceivedMinor = 2599,
            LatestChargeId = "ch_webhook_paid"
        };
        var controller = new MarketplaceController(
            new MarketplaceService(db, NullLogger<MarketplaceService>.Instance),
            db,
            paymentService: paymentService,
            configuration: configuration);
        var body = JsonSerializer.Serialize(new
        {
            id = "evt_payment_signed_1",
            type = "payment_intent.succeeded",
            data = new { @object = new { id = gateway.Created!.Id } }
        });
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var signature = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}"))).ToLowerInvariant();
        var http = new DefaultHttpContext();
        http.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        http.Request.ContentLength = Encoding.UTF8.GetByteCount(body);
        http.Request.Headers["Stripe-Signature"] = $"t={timestamp},v1={signature}";
        controller.ControllerContext = new ControllerContext { HttpContext = http };

        (await controller.StripeWebhook(CancellationToken.None)).Should().BeOfType<OkObjectResult>();
        http.Request.Body.Position = 0;
        (await controller.StripeWebhook(CancellationToken.None)).Should().BeOfType<OkObjectResult>();

        order.Status.Should().Be("paid");
        (await db.MarketplacePayments.CountAsync()).Should().Be(1);
        (await db.WebhookEvents.CountAsync(row => row.EventType == "payment_intent.succeeded")).Should().Be(1);
        (await db.Notifications.CountAsync()).Should().Be(2);
        (await db.MarketplaceOrderNotificationDeliveries.CountAsync()).Should().Be(4);
        email.Calls.Should().HaveCount(2);
    }

    private static NexusDbContext CreateDb()
    {
        var tenant = new TenantContext();
        tenant.SetTenant(42);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new NexusDbContext(options, tenant);
    }

    private static MarketplaceOrder SeedPayableOrder(NexusDbContext db)
    {
        db.Tenants.Add(new Tenant { Id = 42, Slug = "acme", Name = "Acme" });
        db.Users.AddRange(
            new User
            {
                Id = 11, TenantId = 42, Email = "buyer@example.test", FirstName = "Buyer",
                LastName = "Example", PreferredLanguage = "en"
            },
            new User
            {
                Id = 22, TenantId = 42, Email = "seller@example.test", FirstName = "Seller",
                LastName = "Example", PreferredLanguage = "de"
            });
        db.MarketplaceListings.Add(new MarketplaceListing
        {
            Id = 100,
            TenantId = 42,
            UserId = 22,
            Title = "Provider & Seller",
            Description = "Payment notification fixture",
            Status = "active",
            ModerationStatus = "approved"
        });
        var seller = new MarketplaceSellerProfile
        {
            TenantId = 42,
            UserId = 22,
            DisplayName = "Provider Seller",
            StripeAccountId = "acct_real_seller",
            StripeOnboardingComplete = true
        };
        var order = new MarketplaceOrder
        {
            TenantId = 42,
            MarketplaceListingId = 100,
            BuyerUserId = 11,
            SellerUserId = 22,
            TotalAmount = 25.99m,
            TimeCreditTotal = 0,
            Currency = "EUR",
            Status = "pending_payment"
        };
        db.MarketplaceSellerProfiles.Add(seller);
        db.MarketplaceOrders.Add(order);
        db.SaveChanges();
        return order;
    }

    private static void SeedConnectIdentity(NexusDbContext db, string? accountId = null)
    {
        db.Tenants.Add(new Tenant { Id = 42, Slug = "acme", Name = "Acme" });
        db.Users.Add(new User
        {
            Id = 11,
            TenantId = 42,
            Email = "seller@example.test",
            FirstName = "Seller",
            LastName = "Example",
            PreferredLanguage = "de"
        });
        db.MarketplaceSellerProfiles.Add(new MarketplaceSellerProfile
        {
            TenantId = 42,
            UserId = 11,
            DisplayName = "Seller Example",
            StripeAccountId = accountId
        });
        db.SaveChanges();
    }

    private static IConfiguration Configuration() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["App:FrontendUrl"] = "http://localhost:5173",
        ["Marketplace:PlatformFeePercent"] = "5",
        ["Marketplace:EscrowEnabled"] = "false"
    }).Build();

    private static MarketplacePaymentService CreateService(
        NexusDbContext db,
        IMarketplaceStripeGateway gateway,
        IEmailService? email = null) =>
        new(db, gateway, Configuration(), NullLogger<MarketplacePaymentService>.Instance, emailService: email);

    private sealed class RecordingEmailService : IEmailService
    {
        public List<EmailCall> Calls { get; } = [];
        public string? RejectAddress { get; set; }

        public Task<bool> SendEmailAsync(string to, string subject, string htmlBody, string? textBody = null,
            CancellationToken ct = default) =>
            Task.FromResult(!string.Equals(to, RejectAddress, StringComparison.OrdinalIgnoreCase));

        public Task<EmailDeliveryResult> SendEmailWithEvidenceAsync(string to, string subject, string htmlBody,
            string? textBody = null, string? idempotencyKey = null, CancellationToken ct = default)
        {
            Calls.Add(new(to, subject, htmlBody, textBody, idempotencyKey));
            var accepted = !string.Equals(to, RejectAddress, StringComparison.OrdinalIgnoreCase);
            return Task.FromResult(new EmailDeliveryResult(
                accepted,
                "test-mail",
                accepted ? $"mail-{Calls.Count}" : null,
                accepted ? null : "email_provider_rejected"));
        }

        public Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl,
            CancellationToken ct = default) => Task.FromResult(true);
        public Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName,
            CancellationToken ct = default) => Task.FromResult(true);
        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(true);
    }

    private sealed record EmailCall(
        string To,
        string Subject,
        string HtmlBody,
        string? TextBody,
        string? IdempotencyKey);

    private sealed class FakeGateway : IMarketplaceStripeGateway
    {
        public bool Configured { get; init; }
        public bool CorruptCreateMetadata { get; init; }
        public bool IsConfigured => Configured;
        public int CreateCalls { get; private set; }
        public int RetrieveCalls { get; private set; }
        public long AmountMinor { get; private set; }
        public long PlatformFeeMinor { get; private set; }
        public string? ConnectedAccountId { get; private set; }
        public string? IdempotencyKey { get; private set; }
        public IReadOnlyDictionary<string, string> Metadata { get; private set; } = new Dictionary<string, string>();
        public MarketplaceStripeIntent? Created { get; private set; }
        public MarketplaceStripeIntent? Retrieved { get; set; }
        public MarketplaceStripeAccount? ConnectCreated { get; init; }
        public MarketplaceStripeAccount? ConnectRetrieved { get; set; }
        public string AccountLink { get; init; } = "https://connect.stripe.test/setup/default";
        public int ConnectCreateCalls { get; private set; }
        public int AccountLinkCalls { get; private set; }
        public string? ConnectIdempotencyKey { get; private set; }
        public string? RefreshUrl { get; private set; }
        public string? ReturnUrl { get; private set; }
        public string? FundsFlow { get; private set; }
        public int TransferCalls { get; private set; }
        public MarketplaceStripeTransfer? Transfer { get; set; }
        public int RefundCalls { get; private set; }
        public int TransferReversalCalls { get; private set; }
        public MarketplaceStripeRefund? Refund { get; set; }
        public long RefundAmountMinor { get; private set; }
        public bool RefundReverseTransfer { get; private set; }
        public bool RefundApplicationFee { get; private set; }
        public long TransferReversalAmountMinor { get; private set; }
        public string? ChargeTransferId { get; set; }
        public int ChargeRetrieveCalls { get; private set; }

        public Task<MarketplaceStripeIntent> CreateIntentAsync(long amountMinor, string currency, string connectedAccountId,
            long platformFeeMinor, string fundsFlow, IReadOnlyDictionary<string, string> metadata, string idempotencyKey, CancellationToken ct)
        {
            CreateCalls++;
            AmountMinor = amountMinor;
            PlatformFeeMinor = platformFeeMinor;
            ConnectedAccountId = connectedAccountId;
            IdempotencyKey = idempotencyKey;
            FundsFlow = fundsFlow;
            Metadata = new Dictionary<string, string>(metadata);
            if (CorruptCreateMetadata) Metadata = Metadata.Where(x => x.Key != "nexus_order_id").ToDictionary();
            Created = new("pi_marketplace_1", "pi_marketplace_1_secret", "requires_payment_method", amountMinor, 0,
                currency, null, "card", Metadata,
                fundsFlow == "destination_charge" ? platformFeeMinor : null,
                fundsFlow == "destination_charge" ? connectedAccountId : null);
            return Task.FromResult(Created);
        }

        public Task<MarketplaceStripeIntent> RetrieveIntentAsync(string paymentIntentId, CancellationToken ct)
        {
            RetrieveCalls++;
            return Task.FromResult(Retrieved ?? throw new InvalidOperationException("No provider result configured."));
        }

        public Task CancelIntentAsync(string paymentIntentId, string idempotencyKey, CancellationToken ct) => Task.CompletedTask;

        public Task<MarketplaceStripeTransfer> CreateTransferAsync(
            long amountMinor, string currency, string connectedAccountId, string sourceTransactionId,
            string transferGroup, IReadOnlyDictionary<string, string> metadata, string idempotencyKey,
            CancellationToken ct)
        {
            TransferCalls++;
            return Task.FromResult(Transfer ?? new MarketplaceStripeTransfer(
                "tr_marketplace_1", amountMinor, currency, connectedAccountId, sourceTransactionId));
        }

        public Task<MarketplaceStripeRefund> CreateRefundAsync(
            string paymentIntentId, long amountMinor, bool reverseTransfer, bool refundApplicationFee,
            IReadOnlyDictionary<string, string> metadata, string idempotencyKey, CancellationToken ct)
        {
            RefundCalls++;
            RefundAmountMinor = amountMinor;
            RefundReverseTransfer = reverseTransfer;
            RefundApplicationFee = refundApplicationFee;
            return Task.FromResult(Refund ?? new MarketplaceStripeRefund(
                $"re_marketplace_{RefundCalls}", amountMinor, "EUR", "succeeded"));
        }

        public Task ReverseTransferAsync(
            string transferId, long amountMinor, string idempotencyKey, CancellationToken ct)
        {
            TransferReversalCalls++;
            TransferReversalAmountMinor = amountMinor;
            return Task.CompletedTask;
        }

        public Task<string?> RetrieveChargeTransferIdAsync(string chargeId, CancellationToken ct)
        {
            ChargeRetrieveCalls++;
            return Task.FromResult(ChargeTransferId);
        }

        public Task<MarketplaceStripeAccount> CreateExpressAccountAsync(
            string email, int tenantId, int userId, string idempotencyKey, CancellationToken ct)
        {
            ConnectCreateCalls++;
            ConnectIdempotencyKey = idempotencyKey;
            return Task.FromResult(ConnectCreated ?? throw new InvalidOperationException("No Connect account configured."));
        }

        public Task<MarketplaceStripeAccount> RetrieveAccountAsync(string accountId, CancellationToken ct) =>
            Task.FromResult(ConnectRetrieved ?? throw new InvalidOperationException("No Connect account status configured."));

        public Task<string> CreateAccountLinkAsync(
            string accountId, string refreshUrl, string returnUrl, CancellationToken ct)
        {
            AccountLinkCalls++;
            RefreshUrl = refreshUrl;
            ReturnUrl = returnUrl;
            return Task.FromResult(AccountLink);
        }
    }

    private sealed class SingleClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public HttpMethod? Method { get; private set; }
        public string? Uri { get; private set; }
        public string? Authorization { get; private set; }
        public string? IdempotencyKey { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Method = request.Method;
            Uri = request.RequestUri?.ToString();
            Authorization = request.Headers.Authorization?.ToString();
            IdempotencyKey = request.Headers.TryGetValues("Idempotency-Key", out var values) ? values.Single() : null;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            var json = request.RequestUri?.AbsolutePath == "/v1/transfers"
                ? """
                {
                  "id":"tr_provider_77",
                  "amount":2469,
                  "currency":"eur",
                  "destination":"acct_123",
                  "source_transaction":"ch_escrow_1"
                }
                """
                : """
                {
                  "id":"pi_provider_77",
                  "client_secret":"pi_provider_77_secret",
                  "status":"requires_payment_method",
                  "amount":2599,
                  "amount_received":0,
                  "currency":"eur",
                  "application_fee_amount":130,
                  "transfer_data":{"destination":"acct_123"},
                  "latest_charge":null,
                  "payment_method_types":["card"],
                  "metadata":{"nexus_order_id":"77","nexus_tenant_id":"42"}
                }
                """;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        }
    }

    private sealed class ConnectRecordingHandler : HttpMessageHandler
    {
        public List<(HttpMethod Method, string Uri, string? IdempotencyKey, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add((
                request.Method,
                request.RequestUri?.ToString() ?? string.Empty,
                request.Headers.TryGetValues("Idempotency-Key", out var values) ? values.Single() : null,
                body));
            var json = request.RequestUri?.AbsolutePath switch
            {
                "/v1/accounts" => """{"id":"acct_connect_42","details_submitted":false,"charges_enabled":false,"payouts_enabled":false}""",
                "/v1/accounts/acct_connect_42" => """{"id":"acct_connect_42","details_submitted":true,"charges_enabled":true,"payouts_enabled":true}""",
                "/v1/account_links" => """{"url":"https://connect.stripe.test/setup/acct_connect_42"}""",
                _ => throw new InvalidOperationException("Unexpected Stripe test path.")
            };
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        }
    }
}
