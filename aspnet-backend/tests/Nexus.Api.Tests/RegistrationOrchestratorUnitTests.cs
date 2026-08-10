// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Services.Registration;
using Nexus.Contracts.Events;
using Nexus.Messaging;

namespace Nexus.Api.Tests;

/// <summary>
/// Unit tests for the MockIdentityVerificationProvider.
/// These run without a database or HTTP server.
/// </summary>
public class MockProviderUnitTests
{
    private readonly MockIdentityVerificationProvider _provider = new();

    [Fact]
    public void ProviderType_IsMock()
    {
        _provider.ProviderType.Should().Be(VerificationProvider.Mock);
    }

    [Fact]
    public async Task CreateSession_ReturnsSessionWithId()
    {
        var result = await _provider.CreateSessionAsync(1, 1, VerificationLevel.DocumentOnly, "http://callback", null);

        result.ExternalSessionId.Should().StartWith("mock_");
        result.ExpiresAt.Should().BeAfter(DateTime.UtcNow);
    }

    [Fact]
    public async Task CreateSession_AutoApproveConfig_NoRedirectUrl()
    {
        var result = await _provider.CreateSessionAsync(
            1, 1, VerificationLevel.DocumentOnly, "http://callback",
            "{\"auto_approve\": true}");

        result.RedirectUrl.Should().BeNull();
    }

    [Fact]
    public async Task CreateSession_ManualConfig_HasRedirectUrl()
    {
        var result = await _provider.CreateSessionAsync(
            1, 1, VerificationLevel.DocumentOnly, "http://callback",
            "{\"auto_approve\": false}");

        result.RedirectUrl.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task GetSessionStatus_AutoApprove_ReturnsCompleted()
    {
        var result = await _provider.GetSessionStatusAsync("mock_123", "{\"auto_approve\": true}");

        result.Status.Should().Be(VerificationSessionStatus.Completed);
        result.Decision.Should().Be("approved");
        result.ConfidenceScore.Should().Be(1.0);
    }

    [Fact]
    public async Task GetSessionStatus_SimulateFailure_ReturnsFailed()
    {
        var result = await _provider.GetSessionStatusAsync("mock_123", "{\"simulate_failure\": true}");

        result.Status.Should().Be(VerificationSessionStatus.Failed);
        result.Decision.Should().Be("declined");
    }

    [Fact]
    public async Task GetSessionStatus_Manual_ReturnsInProgress()
    {
        var result = await _provider.GetSessionStatusAsync("mock_123", "{\"auto_approve\": false}");

        result.Status.Should().Be(VerificationSessionStatus.InProgress);
    }

    [Fact]
    public async Task ProcessWebhook_ApprovedBody_ReturnsCompleted()
    {
        var payload = new WebhookPayload { RawBody = "approved", Headers = new() };
        var result = await _provider.ProcessWebhookAsync(payload, null);

        result.Should().NotBeNull();
        result!.Status.Should().Be(VerificationSessionStatus.Completed);
        result.Decision.Should().Be("approved");
    }

    [Fact]
    public async Task ProcessWebhook_DeclinedBody_ReturnsFailed()
    {
        var payload = new WebhookPayload { RawBody = "declined", Headers = new() };
        var result = await _provider.ProcessWebhookAsync(payload, null);

        result.Should().NotBeNull();
        result!.Status.Should().Be(VerificationSessionStatus.Failed);
        result.Decision.Should().Be("declined");
    }

    [Fact]
    public async Task ProcessWebhook_InvalidBody_ReturnsNull()
    {
        var payload = new WebhookPayload { RawBody = "garbage", Headers = new() };
        var result = await _provider.ProcessWebhookAsync(payload, null);

        result.Should().BeNull();
    }

    [Fact]
    public async Task ProcessWebhook_CancelledBody_ReturnsNull()
    {
        // Mock provider only recognizes "approved" and "declined"
        var payload = new WebhookPayload { RawBody = "cancelled", Headers = new() };
        var result = await _provider.ProcessWebhookAsync(payload, null);

        result.Should().BeNull();
    }

    [Fact]
    public void VerifyWebhookSignature_NoSecret_ReturnsTrue()
    {
        var payload = new WebhookPayload { RawBody = "test", Headers = new() };
        _provider.VerifyWebhookSignature(payload, null).Should().BeTrue();
    }

    [Fact]
    public void VerifyWebhookSignature_CorrectSecret_ReturnsTrue()
    {
        var payload = new WebhookPayload
        {
            RawBody = "test",
            Headers = new Dictionary<string, string> { ["X-Mock-Secret"] = "mysecret" }
        };
        _provider.VerifyWebhookSignature(payload, "{\"webhook_secret\": \"mysecret\"}").Should().BeTrue();
    }

    [Fact]
    public void VerifyWebhookSignature_WrongSecret_ReturnsFalse()
    {
        var payload = new WebhookPayload
        {
            RawBody = "test",
            Headers = new Dictionary<string, string> { ["X-Mock-Secret"] = "wrong" }
        };
        _provider.VerifyWebhookSignature(payload, "{\"webhook_secret\": \"mysecret\"}").Should().BeFalse();
    }
}

/// <summary>
/// Unit tests for IdentityVerificationProviderFactory.
/// </summary>
public class ProviderFactoryUnitTests
{
    [Fact]
    public void GetProvider_RegisteredProvider_ReturnsProvider()
    {
        var mock = new MockIdentityVerificationProvider();
        var factory = new IdentityVerificationProviderFactory(new[] { mock });

        var result = factory.GetProvider(VerificationProvider.Mock);
        result.Should().BeSameAs(mock);
    }

    [Fact]
    public void GetProvider_UnregisteredProvider_Throws()
    {
        var factory = new IdentityVerificationProviderFactory(Array.Empty<IIdentityVerificationProvider>());

        var act = () => factory.GetProvider(VerificationProvider.Veriff);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void IsProviderRegistered_Mock_ReturnsTrue()
    {
        var factory = new IdentityVerificationProviderFactory(new[] { new MockIdentityVerificationProvider() });
        factory.IsProviderRegistered(VerificationProvider.Mock).Should().BeTrue();
        factory.IsProviderRegistered(VerificationProvider.Veriff).Should().BeFalse();
    }

    [Fact]
    public void GetRegisteredProviders_ReturnsAll()
    {
        var factory = new IdentityVerificationProviderFactory(new[] { new MockIdentityVerificationProvider() });
        factory.GetRegisteredProviders().Should().ContainSingle().Which.Should().Be(VerificationProvider.Mock);
    }
}

/// <summary>
/// Unit tests for the RegistrationEnums — state machine validation.
/// </summary>
public class RegistrationStateTests
{
    [Theory]
    [InlineData(RegistrationMode.Standard, RegistrationStatus.Active)]
    [InlineData(RegistrationMode.StandardWithApproval, RegistrationStatus.PendingAdminReview)]
    [InlineData(RegistrationMode.VerifiedIdentity, RegistrationStatus.PendingVerification)]
    [InlineData(RegistrationMode.GovernmentId, RegistrationStatus.PendingVerification)]
    [InlineData(RegistrationMode.InviteOnly, RegistrationStatus.Active)]
    public void RegistrationMode_MapsToExpectedInitialStatus(RegistrationMode mode, RegistrationStatus expectedStatus)
    {
        // This mirrors the logic in RegistrationOrchestrator.RegisterAsync
        var (status, _) = mode switch
        {
            RegistrationMode.Standard => (RegistrationStatus.Active, true),
            RegistrationMode.StandardWithApproval => (RegistrationStatus.PendingAdminReview, false),
            RegistrationMode.VerifiedIdentity => (RegistrationStatus.PendingVerification, false),
            RegistrationMode.GovernmentId => (RegistrationStatus.PendingVerification, false),
            RegistrationMode.InviteOnly => (RegistrationStatus.Active, true),
            _ => (RegistrationStatus.Active, true)
        };

        status.Should().Be(expectedStatus);
    }

    [Fact]
    public void AllRegistrationModes_AreCovered()
    {
        // Ensure no enum values are missed
        var modes = Enum.GetValues<RegistrationMode>();
        modes.Should().HaveCountGreaterOrEqualTo(5);
    }

    [Fact]
    public void AllVerificationProviders_AreDefined()
    {
        var providers = Enum.GetValues<VerificationProvider>();
        providers.Should().Contain(VerificationProvider.Mock);
        providers.Should().Contain(VerificationProvider.Veriff);
        providers.Should().Contain(VerificationProvider.Onfido);
        providers.Should().Contain(VerificationProvider.Jumio);
        providers.Should().Contain(VerificationProvider.Idenfy);
        providers.Should().Contain(VerificationProvider.EudiWallet);
        providers.Should().Contain(VerificationProvider.Custom);
    }
}

/// <summary>
/// Unit tests for non-Stripe identity providers ported from Laravel.
/// These cover local normalization/signature behavior and do not call provider APIs.
/// </summary>
public class NonStripeIdentityProviderUnitTests
{
    private static readonly IHttpClientFactory HttpFactory = new TestHttpClientFactory();

    [Fact]
    public void Factory_WithLaravelParityProviders_RegistersAllNonStripeProviders()
    {
        var providers = new IIdentityVerificationProvider[]
        {
            new MockIdentityVerificationProvider(),
            new VeriffIdentityProvider(HttpFactory, NullLogger<VeriffIdentityProvider>.Instance),
            new OnfidoIdentityProvider(HttpFactory, NullLogger<OnfidoIdentityProvider>.Instance),
            new JumioIdentityProvider(HttpFactory, NullLogger<JumioIdentityProvider>.Instance),
            new IdenfyIdentityProvider(HttpFactory, NullLogger<IdenfyIdentityProvider>.Instance)
        };

        var factory = new IdentityVerificationProviderFactory(providers);

        factory.IsProviderRegistered(VerificationProvider.Veriff).Should().BeTrue();
        factory.IsProviderRegistered(VerificationProvider.Onfido).Should().BeTrue();
        factory.IsProviderRegistered(VerificationProvider.Jumio).Should().BeTrue();
        factory.IsProviderRegistered(VerificationProvider.Idenfy).Should().BeTrue();
    }

    [Fact]
    public void AddNexusServices_RegistersLaravelParityIdentityProviders()
    {
        var services = new ServiceCollection();
        services.AddNexusServices(new ConfigurationBuilder().Build());

        var providerTypes = services
            .Where(d => d.ServiceType == typeof(IIdentityVerificationProvider))
            .Select(d => d.ImplementationType)
            .ToArray();

        providerTypes.Should().Contain(typeof(VeriffIdentityProvider));
        providerTypes.Should().Contain(typeof(OnfidoIdentityProvider));
        providerTypes.Should().Contain(typeof(JumioIdentityProvider));
        providerTypes.Should().Contain(typeof(IdenfyIdentityProvider));
    }

    [Fact]
    public void Veriff_VerifiesHmacSignature_AndNormalizesApprovedWebhook()
    {
        const string body = """
        {"verification":{"id":"veriff-session-1","status":"approved","vendorData":"{\"nexus_user_id\":1}","riskScore":0.12}}
        """;
        var provider = new VeriffIdentityProvider(HttpFactory, NullLogger<VeriffIdentityProvider>.Instance);
        var payload = SignedPayload(body, "secret", "X-HMAC-Signature");

        provider.VerifyWebhookSignature(payload, "{\"webhook_secret\":\"secret\"}").Should().BeTrue();

        var result = provider.ProcessWebhookAsync(payload, "{\"webhook_secret\":\"secret\"}")
            .GetAwaiter()
            .GetResult();

        result.Should().NotBeNull();
        result!.ExternalSessionId.Should().Be("veriff-session-1");
        result.Status.Should().Be(VerificationSessionStatus.Completed);
        result.Decision.Should().Be("approved");
        result.ConfidenceScore.Should().Be(0.12);
    }

    [Fact]
    public void Onfido_VerifiesHmacSignature_AndNormalizesFailedCheckWebhook()
    {
        const string body = """
        {"payload":{"resource_type":"check","action":"completed","object":{"applicant_id":"applicant-1","result":"consider"}}}
        """;
        var provider = new OnfidoIdentityProvider(HttpFactory, NullLogger<OnfidoIdentityProvider>.Instance);
        var payload = SignedPayload(body, "secret", "X-SHA2-Signature");

        provider.VerifyWebhookSignature(payload, "{\"webhook_secret\":\"secret\"}").Should().BeTrue();

        var result = provider.ProcessWebhookAsync(payload, "{\"webhook_secret\":\"secret\"}")
            .GetAwaiter()
            .GetResult();

        result.Should().NotBeNull();
        result!.ExternalSessionId.Should().Be("applicant-1");
        result.Status.Should().Be(VerificationSessionStatus.Failed);
        result.Decision.Should().Be("declined");
        result.DecisionReason.Should().Be("Identity check did not pass");
    }

    [Fact]
    public void Jumio_VerifiesHmacSignature_AndNormalizesApprovedWebhook()
    {
        const string body = """
        {"accountId":"jumio-account-1","decision":{"type":"APPROVED","riskScore":0.02}}
        """;
        var provider = new JumioIdentityProvider(HttpFactory, NullLogger<JumioIdentityProvider>.Instance);
        var payload = SignedPayload(body, "secret", "Jumio-Signature");

        provider.VerifyWebhookSignature(payload, "{\"webhook_secret\":\"secret\"}").Should().BeTrue();

        var result = provider.ProcessWebhookAsync(payload, "{\"webhook_secret\":\"secret\"}")
            .GetAwaiter()
            .GetResult();

        result.Should().NotBeNull();
        result!.ExternalSessionId.Should().Be("jumio-account-1");
        result.Status.Should().Be(VerificationSessionStatus.Completed);
        result.Decision.Should().Be("approved");
        result.ConfidenceScore.Should().Be(0.02);
    }

    [Fact]
    public void Idenfy_VerifiesHmacSignature_AndNormalizesDeniedWebhook()
    {
        const string body = """
        {"final":{"scanRef":"idenfy-scan-1","overall":"DENIED","suspicionReasons":["document_blurry","face_mismatch"]}}
        """;
        var provider = new IdenfyIdentityProvider(HttpFactory, NullLogger<IdenfyIdentityProvider>.Instance);
        var payload = SignedPayload(body, "secret", "Idenfy-Signature");

        provider.VerifyWebhookSignature(payload, "{\"webhook_secret\":\"secret\"}").Should().BeTrue();

        var result = provider.ProcessWebhookAsync(payload, "{\"webhook_secret\":\"secret\"}")
            .GetAwaiter()
            .GetResult();

        result.Should().NotBeNull();
        result!.ExternalSessionId.Should().Be("idenfy-scan-1");
        result.Status.Should().Be(VerificationSessionStatus.Failed);
        result.Decision.Should().Be("declined");
        result.DecisionReason.Should().Be("document_blurry, face_mismatch");
    }

    private static WebhookPayload SignedPayload(string body, string secret, string headerName)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var signature = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();

        return new WebhookPayload
        {
            RawBody = body,
            Headers = new Dictionary<string, string> { [headerName] = signature }
        };
    }

    private sealed class TestHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}

/// <summary>
/// Unit tests for React admin identity-provider compatibility contracts.
/// </summary>
public class ReactIdentityProviderCompatibilityUnitTests
{
    [Fact]
    public void AdminIdentityProviders_ReturnsRegistrationPolicySettingsContract()
    {
        var tenantContext = CreateTenantContext(1);
        using var db = CreateDbContext(tenantContext);
        var controller = CreateController(db, tenantContext);

        var response = controller.AdminIdentityProviders();

        var ok = response.Should().BeOfType<OkObjectResult>().Subject;
        var json = JsonSerializer.Serialize(ok.Value);
        using var document = JsonDocument.Parse(json);
        var providers = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        var slugs = providers.Select(p => p.GetProperty("slug").GetString()).ToArray();

        slugs.Should().Contain(new[]
        {
            "mock",
            "stripe_identity",
            "veriff",
            "onfido",
            "jumio",
            "idenfy"
        });

        foreach (var provider in providers)
        {
            provider.TryGetProperty("name", out _).Should().BeTrue();
            provider.TryGetProperty("levels", out var levels).Should().BeTrue();
            levels.ValueKind.Should().Be(JsonValueKind.Array);
            provider.TryGetProperty("available", out var available).Should().BeTrue();
            available.ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
            provider.TryGetProperty("has_credentials", out var hasCredentials).Should().BeTrue();
            hasCredentials.ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
        }

        providers.Single(p => p.GetProperty("slug").GetString() == "mock")
            .GetProperty("available")
            .GetBoolean()
            .Should()
            .BeTrue();
    }

    [Fact]
    public async Task AdminRegistrationPolicyAlias_WithoutPolicy_ReturnsLaravelDefaultPolicy()
    {
        var tenantContext = CreateTenantContext(1);
        await using var db = CreateDbContext(tenantContext);
        var controller = CreateController(db, tenantContext);

        var response = await controller.AdminRegistrationPolicyAlias();

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(
            response.Should().BeOfType<OkObjectResult>().Subject.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("registration_mode").GetString().Should().Be("open");
        data.GetProperty("verification_provider").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("verification_level").GetString().Should().Be("none");
        data.GetProperty("post_verification").GetString().Should().Be("activate");
        data.GetProperty("fallback_mode").GetString().Should().Be("none");
        data.GetProperty("require_email_verify").GetBoolean().Should().BeFalse();
        data.GetProperty("has_policy").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task AdminRegistrationPolicyAlias_WithPolicy_ReturnsRegistrationPolicySettingsContract()
    {
        var tenantContext = CreateTenantContext(1);
        await using var db = CreateDbContext(tenantContext);
        db.TenantRegistrationPolicies.Add(new TenantRegistrationPolicy
        {
            TenantId = 1,
            Mode = RegistrationMode.VerifiedIdentity,
            Provider = VerificationProvider.Onfido,
            VerificationLevel = VerificationLevel.DocumentAndSelfie,
            PostVerificationAction = PostVerificationAction.SendToAdminForApproval,
            IsActive = true
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext);

        var response = await controller.AdminRegistrationPolicyAlias();

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(
            response.Should().BeOfType<OkObjectResult>().Subject.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("registration_mode").GetString().Should().Be("verified_identity");
        data.GetProperty("verification_provider").GetString().Should().Be("onfido");
        data.GetProperty("verification_level").GetString().Should().Be("document_selfie");
        data.GetProperty("post_verification").GetString().Should().Be("admin_approval");
        data.GetProperty("fallback_mode").GetString().Should().Be("none");
        data.GetProperty("require_email_verify").GetBoolean().Should().BeFalse();
        data.GetProperty("has_policy").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminUpdateRegistrationPolicyAlias_UpsertsLaravelStylePolicyFields()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);
        var controller = CreateController(db, tenantContext);

        var response = await controller.AdminUpdateRegistrationPolicyAlias(new ReactRegistrationPolicyRequest
        {
            RegistrationMode = "verified_identity",
            VerificationProvider = "onfido",
            VerificationLevel = "document_selfie",
            PostVerification = "admin_approval",
            FallbackMode = "admin_review",
            RequireEmailVerify = true
        });

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(
            response.Should().BeOfType<OkObjectResult>().Subject.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("registration_mode").GetString().Should().Be("verified_identity");
        data.GetProperty("verification_provider").GetString().Should().Be("onfido");
        data.GetProperty("verification_level").GetString().Should().Be("document_selfie");
        data.GetProperty("post_verification").GetString().Should().Be("admin_approval");
        data.GetProperty("fallback_mode").GetString().Should().Be("admin_review");
        data.GetProperty("require_email_verify").GetBoolean().Should().BeTrue();

        var stored = await db.TenantRegistrationPolicies.SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.Mode.Should().Be(RegistrationMode.VerifiedIdentity);
        stored.Provider.Should().Be(VerificationProvider.Onfido);
        stored.VerificationLevel.Should().Be(VerificationLevel.DocumentAndSelfie);
        stored.PostVerificationAction.Should().Be(PostVerificationAction.SendToAdminForApproval);
        stored.FallbackMode.Should().Be("admin_review");
        stored.RequireEmailVerify.Should().BeTrue();
    }

    [Fact]
    public async Task AdminSaveProviderCredentials_StoresEncryptedCredentialsAndProviderListReflectsConfiguredState()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);
        var controller = CreateController(db, tenantContext);

        var response = await controller.AdminSaveProviderCredentials("veriff", new ProviderCredentialRequest
        {
            ApiKey = "api-key-1",
            WebhookSecret = "webhook-secret-1"
        });

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(
            response.Should().BeOfType<OkObjectResult>().Subject.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("saved").GetBoolean().Should().BeTrue();
        data.GetProperty("provider_slug").GetString().Should().Be("veriff");

        var stored = await db.TenantProviderCredentials.SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.ProviderSlug.Should().Be("veriff");
        stored.CredentialsEncrypted.Should().NotContain("api-key-1");
        stored.CredentialsEncrypted.Should().NotContain("webhook-secret-1");

        using var providerDocument = JsonDocument.Parse(JsonSerializer.Serialize(
            controller.AdminIdentityProviders().Should().BeOfType<OkObjectResult>().Subject.Value));
        var veriff = providerDocument.RootElement.GetProperty("data")
            .EnumerateArray()
            .Single(p => p.GetProperty("slug").GetString() == "veriff");
        veriff.GetProperty("has_credentials").GetBoolean().Should().BeTrue();
        veriff.GetProperty("available").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminIdentityProviders_DoesNotLeakConfiguredStateAcrossTenants()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);
        db.TenantProviderCredentials.Add(new TenantProviderCredential
        {
            TenantId = 7,
            ProviderSlug = "veriff",
            CredentialsEncrypted = "encrypted-other-tenant",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext);

        using var providerDocument = JsonDocument.Parse(JsonSerializer.Serialize(
            controller.AdminIdentityProviders().Should().BeOfType<OkObjectResult>().Subject.Value));
        var veriff = providerDocument.RootElement.GetProperty("data")
            .EnumerateArray()
            .Single(p => p.GetProperty("slug").GetString() == "veriff");

        veriff.GetProperty("has_credentials").GetBoolean().Should().BeFalse();
        veriff.GetProperty("available").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task AdminDeleteProviderCredentials_RemovesCredentialsAndProviderListReflectsMissingState()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);
        var controller = CreateController(db, tenantContext);
        await controller.AdminSaveProviderCredentials("veriff", new ProviderCredentialRequest
        {
            ApiKey = "api-key-1",
            WebhookSecret = "webhook-secret-1"
        });

        var response = await controller.AdminDeleteProviderCredentials("veriff");

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(
            response.Should().BeOfType<OkObjectResult>().Subject.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("deleted").GetBoolean().Should().BeTrue();
        data.GetProperty("provider_slug").GetString().Should().Be("veriff");
        (await db.TenantProviderCredentials.CountAsync()).Should().Be(0);

        using var providerDocument = JsonDocument.Parse(JsonSerializer.Serialize(
            controller.AdminIdentityProviders().Should().BeOfType<OkObjectResult>().Subject.Value));
        var veriff = providerDocument.RootElement.GetProperty("data")
            .EnumerateArray()
            .Single(p => p.GetProperty("slug").GetString() == "veriff");
        veriff.GetProperty("has_credentials").GetBoolean().Should().BeFalse();
    }

    private static NexusDbContext CreateDbContext(TenantContext? tenantContext = null)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext ?? new TenantContext());
    }

    private static ReactFrontendCompatibilityController CreateController(
        NexusDbContext db,
        TenantContext tenantContext)
    {
        var encryption = new ProviderConfigEncryption(
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Registration:EncryptionKey"] = "test-encryption-key"
                })
                .Build(),
            NullLogger<ProviderConfigEncryption>.Instance);

        var volunteerOrganisations = new VolunteerOrganisationService(
            db,
            NullLogger<VolunteerOrganisationService>.Instance);
        return new ReactFrontendCompatibilityController(
            db,
            tenantContext,
            encryption,
            volunteerOrganisations);
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(tenantId);
        return tenantContext;
    }
}

/// <summary>
/// Unit tests for registration orchestration parity with tenant provider credentials.
/// </summary>
public class RegistrationOrchestratorCredentialUnitTests
{
    [Fact]
    public async Task StartVerification_UsesTenantProviderCredentials_WhenPolicyConfigIsEmpty()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var encryption = CreateEncryption();

        var user = new User
        {
            TenantId = 42,
            Email = "verify@test.com",
            PasswordHash = "hash",
            FirstName = "Verify",
            LastName = "User",
            Role = "member",
            IsActive = false,
            RegistrationStatus = RegistrationStatus.PendingVerification,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        db.TenantRegistrationPolicies.Add(new TenantRegistrationPolicy
        {
            TenantId = 42,
            Mode = RegistrationMode.VerifiedIdentity,
            Provider = VerificationProvider.Veriff,
            VerificationLevel = VerificationLevel.DocumentOnly,
            IsActive = true
        });
        db.TenantProviderCredentials.Add(new TenantProviderCredential
        {
            TenantId = 42,
            ProviderSlug = "veriff",
            CredentialsEncrypted = encryption.Encrypt("""
            {"api_key":"tenant-api-key","webhook_secret":"tenant-webhook-secret"}
            """),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var provider = new RecordingIdentityProvider(VerificationProvider.Veriff);
        var orchestrator = new RegistrationOrchestrator(
            db,
            new IdentityVerificationProviderFactory(new[] { provider }),
            encryption,
            new NoopEventPublisher(),
            new EmailNotificationService(db, new NoopEmailService(), NullLogger<EmailNotificationService>.Instance),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["App:BaseUrl"] = "https://nexus.test"
            }).Build(),
            NullLogger<RegistrationOrchestrator>.Instance);

        var result = await orchestrator.StartVerificationAsync(user.Id, 42);

        result.IsSuccess.Should().BeTrue();
        provider.LastProviderConfig.Should().Contain("tenant-api-key");
        provider.LastProviderConfig.Should().Contain("tenant-webhook-secret");
    }

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }

    private static ProviderConfigEncryption CreateEncryption() =>
        new(
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Registration:EncryptionKey"] = "test-encryption-key"
                })
                .Build(),
            NullLogger<ProviderConfigEncryption>.Instance);

    private sealed class RecordingIdentityProvider : IIdentityVerificationProvider
    {
        public RecordingIdentityProvider(VerificationProvider providerType)
        {
            ProviderType = providerType;
        }

        public VerificationProvider ProviderType { get; }
        public string DisplayName => "Recording Provider";
        public string? LastProviderConfig { get; private set; }

        public Task<VerificationSessionResult> CreateSessionAsync(
            int userId,
            int tenantId,
            VerificationLevel level,
            string callbackUrl,
            string? providerConfig)
        {
            LastProviderConfig = providerConfig;
            return Task.FromResult(new VerificationSessionResult
            {
                ExternalSessionId = "recording-session",
                RedirectUrl = "https://provider.test/session",
                ExpiresAt = DateTime.UtcNow.AddHours(1)
            });
        }

        public Task<VerificationStatusResult> GetSessionStatusAsync(
            string externalSessionId,
            string? providerConfig) =>
            Task.FromResult(new VerificationStatusResult { Status = VerificationSessionStatus.InProgress });

        public Task<VerificationStatusResult?> ProcessWebhookAsync(
            WebhookPayload payload,
            string? providerConfig) =>
            Task.FromResult<VerificationStatusResult?>(null);

        public bool VerifyWebhookSignature(WebhookPayload payload, string? providerConfig) => true;
    }

    private sealed class NoopEventPublisher : IEventPublisher
    {
        public Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
            where TEvent : IntegrationEvent =>
            Task.CompletedTask;
    }

    private sealed class NoopEmailService : IEmailService
    {
        public Task<bool> SendEmailAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken ct = default) =>
            Task.FromResult(true);

        public Task<bool> SendPasswordResetEmailAsync(
            string to,
            string resetToken,
            string userName,
            string resetUrl,
            CancellationToken ct = default) =>
            Task.FromResult(true);

        public Task<bool> SendWelcomeEmailAsync(
            string to,
            string userName,
            string tenantName,
            CancellationToken ct = default) =>
            Task.FromResult(true);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(true);
    }
}

/// <summary>
/// Unit tests for state transition guard clauses.
/// </summary>
public class StateTransitionGuardTests
{
    [Theory]
    [InlineData(RegistrationStatus.PendingAdminReview, RegistrationStatus.Active, true)]
    [InlineData(RegistrationStatus.PendingAdminReview, RegistrationStatus.Rejected, true)]
    [InlineData(RegistrationStatus.PendingVerification, RegistrationStatus.Active, true)]
    [InlineData(RegistrationStatus.PendingVerification, RegistrationStatus.VerificationFailed, true)]
    [InlineData(RegistrationStatus.PendingVerification, RegistrationStatus.PendingAdminReview, true)]
    [InlineData(RegistrationStatus.PendingVerification, RegistrationStatus.LimitedAccess, true)]
    [InlineData(RegistrationStatus.VerificationFailed, RegistrationStatus.PendingVerification, true)]
    [InlineData(RegistrationStatus.LimitedAccess, RegistrationStatus.Active, true)]
    // Invalid transitions
    [InlineData(RegistrationStatus.Active, RegistrationStatus.Rejected, false)]
    [InlineData(RegistrationStatus.Active, RegistrationStatus.PendingVerification, false)]
    [InlineData(RegistrationStatus.Rejected, RegistrationStatus.Active, false)]
    [InlineData(RegistrationStatus.Rejected, RegistrationStatus.PendingAdminReview, false)]
    public void IsValidTransition_ReturnsExpected(RegistrationStatus from, RegistrationStatus to, bool expected)
    {
        RegistrationOrchestrator.IsValidTransition(from, to).Should().Be(expected);
    }

    [Fact]
    public void Active_IsTerminal()
    {
        // Active should not transition to any other status
        foreach (var status in Enum.GetValues<RegistrationStatus>())
        {
            if (status == RegistrationStatus.Active) continue;
            RegistrationOrchestrator.IsValidTransition(RegistrationStatus.Active, status).Should().BeFalse(
                $"Active should not transition to {status}");
        }
    }

    [Fact]
    public void Rejected_IsTerminal()
    {
        foreach (var status in Enum.GetValues<RegistrationStatus>())
        {
            if (status == RegistrationStatus.Rejected) continue;
            RegistrationOrchestrator.IsValidTransition(RegistrationStatus.Rejected, status).Should().BeFalse(
                $"Rejected should not transition to {status}");
        }
    }
}

/// <summary>
/// Unit tests for ProviderConfigEncryption.
/// </summary>
public class ProviderConfigEncryptionTests
{
    [Fact]
    public void Encrypt_Decrypt_RoundTrip()
    {
        var encryption = CreateEncryption("my-test-encryption-key-32chars!");
        var plaintext = "{\"secret_key\": \"sk_live_abc123\", \"webhook_secret\": \"whsec_xyz\"}";

        var encrypted = encryption.Encrypt(plaintext);
        encrypted.Should().NotBe(plaintext);

        var decrypted = encryption.Decrypt(encrypted);
        decrypted.Should().Be(plaintext);
    }

    [Fact]
    public void Encrypt_ProducesDifferentOutputEachTime()
    {
        var encryption = CreateEncryption("my-test-key");
        var plaintext = "test data";

        var encrypted1 = encryption.Encrypt(plaintext);
        var encrypted2 = encryption.Encrypt(plaintext);

        // Different nonces should produce different ciphertext
        encrypted1.Should().NotBe(encrypted2);

        // But both should decrypt to the same value
        encryption.Decrypt(encrypted1).Should().Be(plaintext);
        encryption.Decrypt(encrypted2).Should().Be(plaintext);
    }

    [Fact]
    public void NoKey_ReturnsPlaintext()
    {
        var encryption = CreateEncryption(null);
        encryption.IsEnabled.Should().BeFalse();

        var plaintext = "some config";
        encryption.Encrypt(plaintext).Should().Be(plaintext);
        encryption.Decrypt(plaintext).Should().Be(plaintext);
    }

    [Fact]
    public void Decrypt_NonBase64_ReturnsSameString()
    {
        var encryption = CreateEncryption("my-test-key");
        // Non-base64 string should be returned as-is (backward compat with pre-encryption data)
        var plaintext = "{\"auto_approve\": true}";
        encryption.Decrypt(plaintext).Should().Be(plaintext);
    }

    private static ProviderConfigEncryption CreateEncryption(string? key)
    {
        var configBuilder = new ConfigurationBuilder();
        if (key != null)
        {
            configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Registration:EncryptionKey"] = key
            });
        }
        return new ProviderConfigEncryption(
            configBuilder.Build(),
            NullLogger<ProviderConfigEncryption>.Instance);
    }
}
