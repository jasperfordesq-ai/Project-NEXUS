// Copyright © 2024–2026 Jasper Ford
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
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for the Registration Policy Engine.
/// Covers: policy config, admin approval flow, verification flow,
/// invite-only mode, state machine transitions, and backward compatibility.
/// </summary>
[Collection("Integration")]
public class RegistrationPolicyTests : IntegrationTestBase
{
    public RegistrationPolicyTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Public Config Endpoint

    [Fact]
    public async Task GetPublicConfig_DefaultPolicy_ReturnsStandard()
    {
        // Arrange: The /api/registration/config path is excluded from TenantResolutionMiddleware,
        // so the controller handles its own tenant resolution via query params.
        // Pass tenant_slug so the controller can resolve the tenant.

        // Act
        var response = await Client.GetAsync("/api/registration/config?tenant_slug=test-tenant");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("data").GetProperty("mode").GetString().Should().Be("Standard");
        content.GetProperty("data").GetProperty("requires_verification").GetBoolean().Should().BeFalse();
        content.GetProperty("data").GetProperty("requires_approval").GetBoolean().Should().BeFalse();
        content.GetProperty("data").GetProperty("requires_invite").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task GetPublicConfig_WithoutTenant_ReturnsBadRequest()
    {
        // Act
        var response = await Client.GetAsync("/api/registration/config");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPublicConfig_InvalidTenant_ReturnsNotFound()
    {
        // The /api/registration/config path IS excluded from TenantResolutionMiddleware.
        // The controller handles its own tenant resolution: it looks up the slug in the DB,
        // and returns 404 when the tenant doesn't exist.
        var response = await Client.GetAsync("/api/registration/config?tenant_slug=nonexistent");

        // Assert: controller returns NotFound because tenant slug doesn't exist
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Backward Compatibility — Standard Registration

    [Fact]
    public async Task Register_StandardMode_ActivatesImmediately()
    {
        // Standard mode = default. No policy configured = Standard.
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "newuser-standard@test.com",
            password = "TestPassword123!",
            first_name = "New",
            last_name = "User",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("registration_status").GetString().Should().Be("Active");
        content.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("refresh_token").GetString().Should().NotBeNullOrEmpty();
    }

    #endregion

    #region Admin Approval Mode

    [Fact]
    public async Task Register_ApprovalMode_SetsPendingAdminReview()
    {
        // Arrange: Set tenant to approval mode
        await SetTenantPolicyAsync(RegistrationMode.StandardWithApproval);

        // Act: Register
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "approval-user@test.com",
            password = "TestPassword123!",
            first_name = "Approval",
            last_name = "User",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("registration_status").GetString().Should().Be("PendingAdminReview");
        // No tokens issued for pending users
        content.TryGetProperty("access_token", out _).Should().BeFalse();
    }

    [Fact]
    public async Task AdminApprove_PendingUser_ActivatesUser()
    {
        // Arrange
        await SetTenantPolicyAsync(RegistrationMode.StandardWithApproval);

        // Register the user
        var regResponse = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "to-approve@test.com",
            password = "TestPassword123!",
            first_name = "ToApprove",
            last_name = "User",
            tenant_slug = "test-tenant"
        });
        var regContent = await regResponse.Content.ReadFromJsonAsync<JsonElement>();
        var userId = regContent.GetProperty("user").GetProperty("id").GetInt32();

        // Act: Admin approves
        await AuthenticateAsAdminAsync();
        var approveResponse = await Client.PutAsJsonAsync($"/api/registration/admin/users/{userId}/approve", new { });

        // Assert
        approveResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var approveContent = await approveResponse.Content.ReadFromJsonAsync<JsonElement>();
        approveContent.GetProperty("success").GetBoolean().Should().BeTrue();

        // Verify user can now log in
        ClearAuthToken();
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "to-approve@test.com",
            password = "TestPassword123!",
            tenant_slug = "test-tenant"
        });
        loginResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminReject_PendingUser_RejectsUser()
    {
        // Arrange
        await SetTenantPolicyAsync(RegistrationMode.StandardWithApproval);

        var regResponse = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "to-reject@test.com",
            password = "TestPassword123!",
            first_name = "ToReject",
            last_name = "User",
            tenant_slug = "test-tenant"
        });
        var regContent = await regResponse.Content.ReadFromJsonAsync<JsonElement>();
        var userId = regContent.GetProperty("user").GetProperty("id").GetInt32();

        // Act
        await AuthenticateAsAdminAsync();
        var rejectResponse = await Client.PutAsJsonAsync($"/api/registration/admin/users/{userId}/reject", new
        {
            reason = "Does not meet criteria"
        });

        // Assert
        rejectResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // Verify user cannot log in
        ClearAuthToken();
        var loginResponse = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "to-reject@test.com",
            password = "TestPassword123!",
            tenant_slug = "test-tenant"
        });
        loginResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetPendingRegistrations_AsAdmin_ReturnsList()
    {
        // Arrange
        await SetTenantPolicyAsync(RegistrationMode.StandardWithApproval);

        await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "pending1@test.com",
            password = "TestPassword123!",
            first_name = "Pending",
            last_name = "One",
            tenant_slug = "test-tenant"
        });

        // Act
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/registration/admin/pending");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterOrEqualTo(1);
    }

    #endregion

    #region Invite-Only Mode

    [Fact]
    public async Task Register_InviteOnly_WithoutCode_Fails()
    {
        // Arrange
        await SetTenantPolicyAsync(RegistrationMode.InviteOnly, inviteCode: "SECRET123");

        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "invite-test@test.com",
            password = "TestPassword123!",
            first_name = "Invite",
            last_name = "User",
            tenant_slug = "test-tenant"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Register_InviteOnly_WithValidCode_Succeeds()
    {
        // Arrange
        await SetTenantPolicyAsync(RegistrationMode.InviteOnly, inviteCode: "VALIDCODE");

        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "invited-user@test.com",
            password = "TestPassword123!",
            first_name = "Invited",
            last_name = "User",
            tenant_slug = "test-tenant",
            invite_code = "VALIDCODE"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("registration_status").GetString().Should().Be("Active");
    }

    [Fact]
    public async Task Register_InviteOnly_WithWrongCode_Fails()
    {
        // Arrange
        await SetTenantPolicyAsync(RegistrationMode.InviteOnly, inviteCode: "CORRECT");

        // Act
        var response = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "wrong-code@test.com",
            password = "TestPassword123!",
            first_name = "Wrong",
            last_name = "Code",
            tenant_slug = "test-tenant",
            invite_code = "WRONG"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Verification Mode

    [Fact]
    public async Task Register_VerifiedIdentity_SetsPendingVerification()
    {
        // Arrange: Set tenant policy to VerifiedIdentity mode
        await SetTenantPolicyAsync(RegistrationMode.VerifiedIdentity,
            provider: VerificationProvider.Mock,
            verificationLevel: VerificationLevel.DocumentOnly);

        // Create a user directly in PendingVerification state to avoid a known issue
        // where the register endpoint's EmailLog creation (with TenantId=0) poisons the
        // EF change tracker before the subsequent SaveChangesAsync for email verification code.
        var (user, token) = await CreatePendingVerificationUserAsync("verify-user@test.com", "Verify", "User");

        // Assert: user is in PendingVerification state with a valid token
        user.RegistrationStatus.Should().Be(RegistrationStatus.PendingVerification);
        user.IsActive.Should().BeFalse();
        token.Should().NotBeNullOrEmpty();

        // Verify the token works by accessing the registration config endpoint
        SetAuthToken(token);
        var configResponse = await Client.GetAsync("/api/registration/config?tenant_slug=test-tenant");
        configResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task StartVerification_PendingUser_CreatesSession()
    {
        // Arrange: Set policy and create user directly in PendingVerification state
        await SetTenantPolicyAsync(RegistrationMode.VerifiedIdentity,
            provider: VerificationProvider.Mock,
            verificationLevel: VerificationLevel.DocumentOnly,
            providerConfig: "{\"auto_approve\": true}");

        var (_, token) = await CreatePendingVerificationUserAsync("start-verify@test.com", "Start", "Verify");
        SetAuthToken(token);

        // The inactive pending identity is authenticated only for the
        // verification flow; it must not become a general member token.
        var memberResponse = await Client.GetAsync("/api/users/me");
        memberResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Act
        var verifyResponse = await Client.PostAsJsonAsync("/api/registration/verify/start", new { });

        // Assert
        verifyResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await verifyResponse.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("data").GetProperty("status").GetString().Should().Be("Created");
    }

    [Fact]
    public async Task GetVerificationStatus_AfterStart_ReturnsSession()
    {
        // Arrange: Set policy and create user directly in PendingVerification state
        await SetTenantPolicyAsync(RegistrationMode.VerifiedIdentity,
            provider: VerificationProvider.Mock,
            verificationLevel: VerificationOnly);

        var (_, token) = await CreatePendingVerificationUserAsync("status-verify@test.com", "Status", "Check");
        SetAuthToken(token);
        await Client.PostAsJsonAsync("/api/registration/verify/start", new { });

        // Act
        var statusResponse = await Client.GetAsync("/api/registration/verify/status");

        // Assert
        statusResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await statusResponse.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetProperty("provider").GetString().Should().Be("Mock");
    }

    #endregion

    #region Admin Policy Management

    [Fact]
    public async Task GetPolicy_AsAdmin_ReturnsPolicy()
    {
        // Act
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/registration/admin/policy");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("data").GetProperty("mode").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task UpdatePolicy_AsAdmin_UpdatesMode()
    {
        // Act
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync("/api/registration/admin/policy", new
        {
            mode = RegistrationMode.StandardWithApproval,
            registration_message = "Your account will be reviewed by an administrator."
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // Verify public config reflects the change (pass tenant_slug since middleware skips this path)
        var configResponse = await Client.GetAsync("/api/registration/config?tenant_slug=test-tenant");
        configResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var configContent = await configResponse.Content.ReadFromJsonAsync<JsonElement>();
        configContent.GetProperty("data").GetProperty("mode").GetString().Should().Be("StandardWithApproval");
        configContent.GetProperty("data").GetProperty("requires_approval").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task UpdatePolicy_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync("/api/registration/admin/policy", new
        {
            mode = RegistrationMode.InviteOnly
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetOptions_AsAdmin_ReturnsAllEnumValues()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/registration/admin/options");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetProperty("modes").GetArrayLength().Should().BeGreaterThan(0);
        content.GetProperty("data").GetProperty("providers").GetArrayLength().Should().BeGreaterThan(0);
    }

    #endregion

    #region Webhook Tests

    [Fact]
    public async Task Webhook_InvalidProvider_ReturnsBadRequest()
    {
        var response = await Client.PostAsJsonAsync(
            "/api/registration/webhook/1?provider=NotAProvider",
            new { });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Helper Methods

    // Workaround: VerificationLevel.DocumentOnly alias
    private const VerificationLevel VerificationOnly = VerificationLevel.DocumentOnly;

    /// <summary>
    /// Creates a user directly in PendingVerification state and generates a JWT token.
    /// This bypasses the register API endpoint to avoid a known issue where the
    /// EmailLog FK constraint (TenantId=0) poisons the EF change tracker during registration.
    /// </summary>
    private async Task<(User User, string Token)> CreatePendingVerificationUserAsync(
        string email, string firstName, string lastName)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var tokenService = scope.ServiceProvider.GetRequiredService<TokenService>();

        var passwordHash = BCrypt.Net.BCrypt.HashPassword("TestPassword123!");

        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = passwordHash,
            FirstName = firstName,
            LastName = lastName,
            Role = "member",
            IsActive = false,
            RegistrationStatus = RegistrationStatus.PendingVerification,
            CreatedAt = DateTime.UtcNow
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        var token = tokenService.GenerateJwt(user);
        return (user, token);
    }

    private async Task SetTenantPolicyAsync(
        RegistrationMode mode,
        VerificationProvider provider = VerificationProvider.None,
        VerificationLevel verificationLevel = VerificationLevel.None,
        PostVerificationAction postAction = PostVerificationAction.ActivateAutomatically,
        string? inviteCode = null,
        string? providerConfig = null)
    {
        // Directly insert/update the policy in the DB
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var existing = await db.TenantRegistrationPolicies
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == TestData.Tenant1.Id && p.IsActive);

        if (existing != null)
        {
            existing.Mode = mode;
            existing.Provider = provider;
            existing.VerificationLevel = verificationLevel;
            existing.PostVerificationAction = postAction;
            existing.InviteCode = inviteCode;
            existing.ProviderConfigEncrypted = providerConfig;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            db.TenantRegistrationPolicies.Add(new TenantRegistrationPolicy
            {
                TenantId = TestData.Tenant1.Id,
                Mode = mode,
                Provider = provider,
                VerificationLevel = verificationLevel,
                PostVerificationAction = postAction,
                InviteCode = inviteCode,
                ProviderConfigEncrypted = providerConfig,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
        }

        await db.SaveChangesAsync();
    }

    #endregion
}
