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
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AuthenticationConfigurationLifecycleTests : IntegrationTestBase
{
    public AuthenticationConfigurationLifecycleTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task PlatformSuperAdmin_CanReadValidatePersistAndDriveAuthenticationBehavior()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/v2/admin/config/authentication"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await PromoteAdminToPlatformSuperAdminAsync();
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/authentication");
        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialBody = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var config = initialBody.GetProperty("data").GetProperty("config");
        config.GetProperty(AuthenticationConfigurationService.TwoFactorBackupCodeCount).GetInt32().Should().Be(10);
        config.GetProperty(AuthenticationConfigurationService.PasskeysEnrollmentEnabled).GetBoolean().Should().BeTrue();
        initialBody.GetProperty("data").GetProperty("defaults")
            .GetProperty(AuthenticationConfigurationService.PasskeysMaxCredentials).GetInt32().Should().Be(10);

        var invalid = await Client.PutAsJsonAsync("/api/v2/admin/config/authentication/bulk", new
        {
            settings = new Dictionary<string, object> { [AuthenticationConfigurationService.PasskeysMaxCredentials] = 21 }
        });
        await AssertValidationErrorAsync(invalid, AuthenticationConfigurationService.PasskeysMaxCredentials);

        var unknown = await Client.PutAsJsonAsync("/api/v2/admin/config/authentication/bulk", new
        {
            settings = new { invented = true }
        });
        await AssertValidationErrorAsync(unknown, "invented");

        var updated = await Client.PutAsJsonAsync("/api/v2/admin/config/authentication/bulk", new
        {
            settings = new Dictionary<string, object>
            {
                [AuthenticationConfigurationService.TwoFactorBackupCodeCount] = 3,
                [AuthenticationConfigurationService.PasskeysEnrollmentEnabled] = false,
                [AuthenticationConfigurationService.PasskeysMaxCredentials] = 4
            }
        });
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedBody = await updated.Content.ReadFromJsonAsync<JsonElement>();
        updatedBody.GetProperty("data").GetProperty("updated")
            .GetProperty(AuthenticationConfigurationService.TwoFactorBackupCodeCount).GetInt32().Should().Be(3);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var member = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == TestData.MemberUser.Id);
        member.TwoFactorEnabled = true;
        await db.SaveChangesAsync();

        var totp = scope.ServiceProvider.GetRequiredService<TotpService>();
        var generated = await totp.GenerateBackupCodesAsync(member.Id, member.TenantId);
        generated.Error.Should().BeNull();
        generated.Codes.Should().HaveCount(3);

        var passkeys = scope.ServiceProvider.GetRequiredService<PasskeyService>();
        var enrollment = async () => await passkeys.BeginRegistrationAsync(member);
        await enrollment.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*disabled*");

        var otherTenant = await scope.ServiceProvider.GetRequiredService<AuthenticationConfigurationService>()
            .GetAllAsync(TestData.Tenant2.Id);
        otherTenant[AuthenticationConfigurationService.TwoFactorBackupCodeCount].Should().Be(10);

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id && row.Key == "authentication_config");
        stored.Value.Should().Contain("two_factor.backup_code_count");
    }

    private async Task PromoteAdminToPlatformSuperAdminAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var admin = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == TestData.AdminUser.Id);
        admin.IsSuperAdmin = true;
        await db.SaveChangesAsync();
        ClearAuthToken();
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("error").GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        body.GetProperty("error").GetProperty("field").GetString().Should().Be(field);
    }
}
