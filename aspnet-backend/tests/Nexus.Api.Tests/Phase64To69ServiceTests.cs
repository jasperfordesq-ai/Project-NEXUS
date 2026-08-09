// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Consolidated tests for the new Phase 64 / 68 / 69 / 72 services that the
 * 2026-05-09 audit flagged as untested:
 *
 *   - EmailTemplateService (Phase 64) — versioning + render
 *   - MoneyDonationService (Phase 72) — Stripe webhook idempotency
 *   - HourTransferReconciliationService (Phase 68) — partner-config gate
 *   - AiProviderFactory (Phase 69) — provider selection
 *
 * HTTP-dependent providers (Anthropic / OpenAI / Gemini / Stripe checkout)
 * are exercised via the IsConfigured flag rather than mocking HTTP — that
 * gives confident DI wiring coverage without a deep HttpMessageHandler harness.
 * Webhook idempotency is tested by calling ApplyWebhookAsync directly with
 * crafted JsonElement payloads.
 */

using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Services.Ai;
using Nexus.Api.Services.Federation;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class Phase64To69ServiceTests : IntegrationTestBase
{
    public Phase64To69ServiceTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ─── EmailTemplateService (Phase 64) ───────────────────────────────────

    [Fact]
    public async Task EmailTemplate_CreateThreeVersions_OnlyOneActive()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<EmailTemplateService>();

        var key = $"welcome_phase64_{Guid.NewGuid():N}";
        var v1 = await svc.CreateVersionAsync(key, "Hi {{ user.name }}", "<p>v1</p>", null, "v1", null, activate: true);
        var v2 = await svc.CreateVersionAsync(key, "Hi {{ user.name }}", "<p>v2</p>", null, "v2", null, activate: true);
        var v3 = await svc.CreateVersionAsync(key, "Hi {{ user.name }}", "<p>v3</p>", null, "v3", null, activate: false);

        v1.Version.Should().Be(1);
        v2.Version.Should().Be(2);
        v3.Version.Should().Be(3);

        var all = await svc.ListAllVersionsAsync(key);
        all.Should().HaveCount(3);
        all.Where(t => t.IsActive).Should().ContainSingle().Which.Version.Should().Be(2);
    }

    [Fact]
    public async Task EmailTemplate_ActivateOlderVersion_DeactivatesNewer()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<EmailTemplateService>();

        var key = $"rollback_test_{Guid.NewGuid():N}";
        var v1 = await svc.CreateVersionAsync(key, "subject v1", "<p>v1</p>", null, null, null, activate: true);
        var v2 = await svc.CreateVersionAsync(key, "subject v2", "<p>v2</p>", null, null, null, activate: true);

        var rolled = await svc.ActivateVersionAsync(v1.Id);
        rolled!.IsActive.Should().BeTrue();

        var active = await svc.GetActiveAsync(key);
        active!.Id.Should().Be(v1.Id);
    }

    [Fact]
    public void EmailTemplate_Interpolate_ReplacesVarsAndKeepsUnknownsBlank()
    {
        var rendered = EmailTemplateService.Interpolate(
            "Hello {{ user.name }}, welcome to {{ tenant }}. {{ unknown }}.",
            new Dictionary<string, string?> { ["user.name"] = "Alice", ["tenant"] = "Nexus" });
        rendered.Should().Be("Hello Alice, welcome to Nexus. .");
    }

    [Fact]
    public async Task EmailTemplate_DeleteActiveVersion_Rejected()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<EmailTemplateService>();

        var v = await svc.CreateVersionAsync("active_lock", "subject", "<p>x</p>", null, null, null, activate: true);
        var (deleted, error) = await svc.DeleteVersionAsync(v.Id);
        deleted.Should().BeFalse();
        error.Should().Be("cannot_delete_active_version");
    }

    // ─── MoneyDonationService webhook idempotency (Phase 72) ───────────────

    [Fact]
    public async Task Donation_Webhook_CheckoutCompleted_TransitionsPendingToSucceeded()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var donation = new MoneyDonation
        {
            TenantId = TestData.Tenant1.Id,
            DonorEmail = "donor@test.com",
            AmountMinorUnits = 1000,
            Currency = "EUR",
            Status = MoneyDonationStatus.Pending,
            StripeCheckoutSessionId = "cs_test_phase72_a",
            CreatedAt = DateTime.UtcNow
        };
        db.MoneyDonations.Add(donation);
        await db.SaveChangesAsync();

        var svc = scope.ServiceProvider.GetRequiredService<MoneyDonationService>();
        var payload = JsonDocument.Parse($$"""
        {
          "id": "cs_test_phase72_a",
          "client_reference_id": "{{donation.Id}}",
          "payment_intent": "pi_test_phase72_a"
        }
        """).RootElement;

        var ok1 = await svc.ApplyWebhookAsync("checkout.session.completed", payload);
        ok1.Should().BeTrue();

        var refreshed = await db.MoneyDonations.IgnoreQueryFilters().FirstAsync(d => d.Id == donation.Id);
        refreshed.Status.Should().Be(MoneyDonationStatus.Succeeded);
        refreshed.StripePaymentIntentId.Should().Be("pi_test_phase72_a");
        refreshed.CompletedAt.Should().NotBeNull();

        // Idempotency: second delivery of the same event must NOT re-trigger
        // a transition (Status is already Succeeded; the production code only
        // promotes from Pending).
        var completedAtBefore = refreshed.CompletedAt;
        var ok2 = await svc.ApplyWebhookAsync("checkout.session.completed", payload);
        ok2.Should().BeTrue();
        var afterReplay = await db.MoneyDonations.IgnoreQueryFilters().FirstAsync(d => d.Id == donation.Id);
        afterReplay.Status.Should().Be(MoneyDonationStatus.Succeeded);
        afterReplay.CompletedAt.Should().Be(completedAtBefore);
    }

    [Fact]
    public async Task Donation_Webhook_PaymentFailed_TransitionsPendingToFailed()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var donation = new MoneyDonation
        {
            TenantId = TestData.Tenant1.Id,
            DonorEmail = "donor2@test.com",
            AmountMinorUnits = 500,
            Currency = "EUR",
            Status = MoneyDonationStatus.Pending,
            StripePaymentIntentId = "pi_failed_phase72",
            CreatedAt = DateTime.UtcNow
        };
        db.MoneyDonations.Add(donation);
        await db.SaveChangesAsync();

        var svc = scope.ServiceProvider.GetRequiredService<MoneyDonationService>();
        var payload = JsonDocument.Parse($$"""
        {
          "id": "pi_failed_phase72",
          "last_payment_error": { "message": "card_declined" }
        }
        """).RootElement;

        var ok = await svc.ApplyWebhookAsync("payment_intent.payment_failed", payload);
        ok.Should().BeTrue();

        var refreshed = await db.MoneyDonations.IgnoreQueryFilters().FirstAsync(d => d.Id == donation.Id);
        refreshed.Status.Should().Be(MoneyDonationStatus.Failed);
        refreshed.FailureReason.Should().Be("card_declined");
    }

    [Fact]
    public async Task Donation_Webhook_UnknownReference_NoOp()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<MoneyDonationService>();

        var payload = JsonDocument.Parse("""{ "id": "cs_does_not_exist" }""").RootElement;
        var ok = await svc.ApplyWebhookAsync("checkout.session.completed", payload);
        ok.Should().BeFalse();
    }

    // ─── HourTransferReconciliationService (Phase 68) ──────────────────────

    [Fact]
    public async Task HourTransferReconciliation_NoPendingTransfers_NoChange()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<HourTransferReconciliationService>();

        var result = await svc.ReconcileTenantAsync(TestData.Tenant1.Id, batchSize: 25, ct: default);
        result.Advanced.Should().Be(0);
        result.Failed.Should().Be(0);
        result.GivenUp.Should().Be(0);
    }

    [Fact]
    public async Task HourTransferReconciliation_WhenSagaDisabled_DoesNotClaimOrMutatePendingTransfer()
    {
        using var scope = Factory.Services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        await db.FederationPartners.IgnoreQueryFilters()
            .Where(p => p.TenantId == TestData.Tenant1.Id && p.PartnerTenantId == TestData.Tenant2.Id)
            .ExecuteDeleteAsync();
        var partner = new FederationPartner
        {
            TenantId = TestData.Tenant1.Id,
            PartnerTenantId = TestData.Tenant2.Id,
            Status = PartnerStatus.Active,
            RequestedById = TestData.AdminUser.Id,
            CreatedAt = DateTime.UtcNow
        };
        db.FederationPartners.Add(partner);
        await db.SaveChangesAsync();

        var transfer = new FederatedHourTransfer
        {
            TenantId = TestData.Tenant1.Id,
            PartnerId = partner.Id,
            Direction = FederatedTransferDirection.Outbound,
            LocalUserId = TestData.MemberUser.Id,
            Amount = 2.0m,
            Protocol = "credit-commons",
            Status = FederatedTransferStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };
        db.FederatedHourTransfers.Add(transfer);
        await db.SaveChangesAsync();

        var svc = scope.ServiceProvider.GetRequiredService<HourTransferReconciliationService>();
        var result = await svc.ReconcileTenantAsync(TestData.Tenant1.Id, batchSize: 10, ct: default);

        var refreshed = await db.FederatedHourTransfers.IgnoreQueryFilters().FirstAsync(t => t.Id == transfer.Id);
        result.Advanced.Should().Be(0);
        result.Failed.Should().Be(0);
        result.GivenUp.Should().Be(0);
        refreshed.RetryCount.Should().Be(0);
        refreshed.LastReconcileAttemptAt.Should().BeNull();
        refreshed.FailureReason.Should().BeNull();
    }

    // ─── AiProviderFactory (Phase 69) ──────────────────────────────────────

    [Fact]
    public void AiProviderFactory_DefaultProvider_IsOllama()
    {
        // No AI provider configured in test environment → factory should
        // resolve to the Ollama default (which has no API key requirement).
        using var scope = Factory.Services.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<IAiProviderFactory>();
        var resolved = factory.Resolve();
        resolved.Name.Should().Be("ollama");
    }

    [Fact]
    public void AiProviderFactory_ListsAllFourProviders()
    {
        using var scope = Factory.Services.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<IAiProviderFactory>();
        factory.All.Select(p => p.Name).Should().BeEquivalentTo(new[] { "ollama", "anthropic", "openai", "gemini" });
    }

    [Fact]
    public void AiProvider_Anthropic_NotConfigured_WhenApiKeyAbsent()
    {
        using var scope = Factory.Services.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<IAiProviderFactory>();
        factory.All.First(p => p.Name == "anthropic").IsConfigured.Should().BeFalse();
        factory.All.First(p => p.Name == "openai").IsConfigured.Should().BeFalse();
        factory.All.First(p => p.Name == "gemini").IsConfigured.Should().BeFalse();
    }

    [Fact]
    public async Task AiProvider_Anthropic_ChatThrowsAiProviderException_WhenApiKeyMissing()
    {
        using var scope = Factory.Services.CreateScope();
        var anthropic = scope.ServiceProvider.GetRequiredService<AnthropicAiProvider>();
        var act = async () => await anthropic.ChatAsync("system", "user");
        await act.Should().ThrowAsync<AiProviderException>().Where(ex => ex.Message.Contains("api_key_missing"));
    }

    // ─── Stripe webhook signature verification (Item 4) ────────────────────

    [Fact]
    public void StripeSignatureVerification_ValidSignature_Accepted()
    {
        const string secret = "whsec_test_phase73";
        const string body = "{\"id\":\"evt_test\"}";
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(secret));
        var sig = Convert.ToHexString(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{ts}.{body}"))).ToLowerInvariant();

        var (ok, reason) = Nexus.Api.Controllers.StripeWebhookController.VerifyStripeSignature(
            body, $"t={ts},v1={sig}", secret);
        ok.Should().BeTrue();
        reason.Should().BeNull();
    }

    [Fact]
    public void StripeSignatureVerification_TamperedBody_Rejected()
    {
        const string secret = "whsec_test_phase73";
        const string body = "{\"id\":\"evt_test\"}";
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(secret));
        var sig = Convert.ToHexString(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{ts}.{body}"))).ToLowerInvariant();

        // Verify against a DIFFERENT body using the same signature → must fail.
        var (ok, reason) = Nexus.Api.Controllers.StripeWebhookController.VerifyStripeSignature(
            "{\"id\":\"evt_evil\"}", $"t={ts},v1={sig}", secret);
        ok.Should().BeFalse();
        reason.Should().Be("no_v1_signature_match");
    }

    [Fact]
    public void StripeSignatureVerification_OldTimestamp_Rejected()
    {
        const string secret = "whsec_test_phase73";
        const string body = "{\"id\":\"evt_old\"}";
        var ts = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds(); // > 300s tolerance
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(secret));
        var sig = Convert.ToHexString(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{ts}.{body}"))).ToLowerInvariant();

        var (ok, reason) = Nexus.Api.Controllers.StripeWebhookController.VerifyStripeSignature(
            body, $"t={ts},v1={sig}", secret);
        ok.Should().BeFalse();
        reason.Should().Be("timestamp_outside_tolerance");
    }

    [Fact]
    public void StripeSignatureVerification_MissingHeader_Rejected()
    {
        var (ok, reason) = Nexus.Api.Controllers.StripeWebhookController.VerifyStripeSignature(
            "{}", null, "whsec_x");
        ok.Should().BeFalse();
        reason.Should().Be("missing_signature_header");
    }
}
