// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AdminUserRoleWriterParityTests : IntegrationTestBase
{
    private static readonly string[] RegularRoles = ["member", "admin", "broker"];
    private static readonly string[] RejectedWriterRoles =
        ["moderator", "newsletter_admin", "tenant_admin", "super_admin", "god"];

    private readonly HashSet<string> _createdEmails = new(StringComparer.OrdinalIgnoreCase);

    public AdminUserRoleWriterParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_createdEmails.Count > 0)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var userIds = await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => _createdEmails.Contains(user.Email))
                    .Select(user => user.Id)
                    .ToListAsync();

                if (userIds.Count > 0)
                {
                    await db.RefreshTokens
                        .IgnoreQueryFilters()
                        .Where(token => userIds.Contains(token.UserId))
                        .ExecuteDeleteAsync();
                    await db.Users
                        .IgnoreQueryFilters()
                        .Where(user => userIds.Contains(user.Id))
                        .ExecuteDeleteAsync();
                }
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    [Fact]
    public async Task V2CreateAndUpdate_AllowExactlyRegularRoles()
    {
        await AuthenticateAsAdminAsync();
        var createdIds = new List<int>();

        foreach (var role in RegularRoles)
        {
            var email = TrackEmail($"writer-create-{role}-{Guid.NewGuid():N}@test.com");
            var response = await Client.PostAsJsonAsync("/api/v2/admin/users", new
            {
                first_name = "Regular",
                last_name = "Writer",
                email,
                password = "Regular123!",
                role
            });

            response.StatusCode.Should().Be(HttpStatusCode.Created);
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
            payload.GetProperty("data").GetProperty("role").GetString().Should().Be(role);
            createdIds.Add(payload.GetProperty("data").GetProperty("id").GetInt32());
        }

        foreach (var role in RejectedWriterRoles)
        {
            var email = TrackEmail($"writer-reject-{role}-{Guid.NewGuid():N}@test.com");
            var response = await Client.PostAsJsonAsync("/api/v2/admin/users", new
            {
                first_name = "Rejected",
                last_name = "Writer",
                email,
                password = "Regular123!",
                role
            });

            await AssertLaravelErrorAsync(
                response,
                HttpStatusCode.UnprocessableEntity,
                "VALIDATION_ERROR",
                field: "role");
        }

        var updateId = createdIds[0];
        foreach (var role in RegularRoles)
        {
            var response = await Client.PutAsJsonAsync($"/api/v2/admin/users/{updateId}", new { role });
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
            payload.GetProperty("data").GetProperty("role").GetString().Should().Be(role);
        }

        foreach (var role in RejectedWriterRoles)
        {
            var response = await Client.PutAsJsonAsync($"/api/v2/admin/users/{updateId}", new { role });
            await AssertLaravelErrorAsync(
                response,
                HttpStatusCode.UnprocessableEntity,
                "VALIDATION_ERROR",
                field: "role");
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var persisted = await db.Users
            .IgnoreQueryFilters()
            .SingleAsync(user => user.Id == updateId);
        persisted.Role.Should().Be("broker");
        persisted.IsAdmin.Should().BeFalse();
        persisted.IsSuperAdmin.Should().BeFalse();
        persisted.IsTenantSuperAdmin.Should().BeFalse();
        persisted.IsGod.Should().BeFalse();
    }

    [Fact]
    public async Task V2Import_IsMultipartOnly_AndCannotMintPrivilegedRoles()
    {
        await AuthenticateAsAdminAsync();
        var rejectedJsonEmail = TrackEmail($"import-json-{Guid.NewGuid():N}@test.com");

        var jsonResponse = await Client.PostAsJsonAsync("/api/v2/admin/users/import", new
        {
            users = new[]
            {
                new
                {
                    email = rejectedJsonEmail,
                    first_name = "JSON",
                    last_name = "Rejected",
                    role = "super_admin"
                }
            }
        });
        await AssertLaravelErrorAsync(
            jsonResponse,
            HttpStatusCode.BadRequest,
            "VALIDATION_ERROR");

        var rows = new[]
        {
            ("moderator", "member"),
            ("newsletter_admin", "member"),
            ("tenant_admin", "member"),
            ("super_admin", "member"),
            ("god", "member"),
            ("broker", "broker"),
            ("", "member")
        };
        var csv = new StringBuilder("first_name,last_name,email,role\r\n");
        var importedEmails = new List<string>();
        for (var index = 0; index < rows.Length; index++)
        {
            var email = TrackEmail($"import-role-{index}-{Guid.NewGuid():N}@test.com");
            importedEmails.Add(email);
            csv.Append($"Import,Role{index},{email},{rows[index].Item1}\r\n");
        }

        using var form = new MultipartFormDataContent();
        using var csvContent = new ByteArrayContent(Encoding.UTF8.GetBytes(csv.ToString()));
        csvContent.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        form.Add(csvContent, "csv_file", "users.csv");
        form.Add(new StringContent("super_admin"), "default_role");

        var response = await Client.PostAsync("/api/v2/admin/users/import", form);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = payload.GetProperty("data");
        data.GetProperty("imported").GetInt32().Should().Be(rows.Length);
        data.GetProperty("skipped").GetInt32().Should().Be(0);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var imported = await db.Users
            .IgnoreQueryFilters()
            .Where(user => importedEmails.Contains(user.Email))
            .OrderBy(user => user.Email)
            .ToListAsync();
        imported.Should().HaveCount(rows.Length);

        for (var index = 0; index < importedEmails.Count; index++)
        {
            var user = imported.Single(candidate => candidate.Email == importedEmails[index]);
            user.Role.Should().Be(rows[index].Item2);
            user.IsAdmin.Should().BeFalse();
            user.IsSuperAdmin.Should().BeFalse();
            user.IsTenantSuperAdmin.Should().BeFalse();
            user.IsGod.Should().BeFalse();
        }

        (await db.Users.IgnoreQueryFilters().AnyAsync(user => user.Email == rejectedJsonEmail))
            .Should().BeFalse();
    }

    [Fact]
    public async Task V2ListVersusShowAndUpdate_SerializeCanonicalRawFlags()
    {
        var target = await AddUserAsync(
            "serializer-target",
            role: "admin",
            isSuperAdmin: true,
            isTenantSuperAdmin: false,
            isGod: true);
        await AuthenticateAsAdminAsync();

        var list = await Client.GetAsync("/api/v2/admin/users?limit=100");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listPayload = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listUser = listPayload.GetProperty("data")
            .EnumerateArray()
            .Single(user => user.GetProperty("id").GetInt32() == target.Id);
        listUser.GetProperty("is_super_admin").GetBoolean().Should().BeTrue();
        listUser.GetProperty("is_tenant_super_admin").GetBoolean().Should().BeFalse();
        listUser.TryGetProperty("is_god", out _).Should().BeFalse();
        listUser.TryGetProperty("is_admin", out _).Should().BeFalse();

        var show = await Client.GetAsync($"/api/v2/admin/users/{target.Id}");
        show.StatusCode.Should().Be(HttpStatusCode.OK);
        var showUser = (await show.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        AssertDetailFlags(showUser, isSuperAdmin: true, isTenantSuperAdmin: false, isGod: true, isAdmin: true);

        var update = await Client.PutAsJsonAsync(
            $"/api/v2/admin/users/{target.Id}",
            new { first_name = "Serialized" });
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedUser = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updatedUser.GetProperty("first_name").GetString().Should().Be("Serialized");
        AssertDetailFlags(updatedUser, isSuperAdmin: true, isTenantSuperAdmin: false, isGod: true, isAdmin: true);
    }

    [Fact]
    public async Task V2ProtectedTargets_UseRawSuperFlags_NotRegularOrLegacyAdminRoles()
    {
        var regularAdmin = await AddUserAsync("protected-regular-admin", role: "admin");
        var legacySuperRole = await AddUserAsync("protected-legacy-super", role: "super_admin");
        var tenantSuper = await AddUserAsync("protected-tenant-super", isTenantSuperAdmin: true);
        var platformSuper = await AddUserAsync("protected-platform-super", isSuperAdmin: true);
        await AuthenticateAsAdminAsync();

        (await Client.PostAsJsonAsync(
            $"/api/v2/admin/users/{regularAdmin.Id}/suspend",
            new { reason = "role-only admin remains manageable" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsJsonAsync(
            $"/api/v2/admin/users/{legacySuperRole.Id}/suspend",
            new { reason = "legacy alias alone is not target protection" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var tenantResponse = await Client.PostAsJsonAsync(
            $"/api/v2/admin/users/{tenantSuper.Id}/suspend",
            new { reason = "must be rejected" });
        await AssertLaravelErrorAsync(
            tenantResponse,
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");

        var platformResponse = await Client.PostAsJsonAsync(
            $"/api/v2/admin/users/{platformSuper.Id}/suspend",
            new { reason = "must be rejected" });
        await AssertLaravelErrorAsync(
            platformResponse,
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");
    }

    [Fact]
    public async Task V2Impersonate_RequiresPlatformSuper_AndHonorsTargetBoundaries()
    {
        var platformActor = await AddUserAsync("impersonate-platform", role: "super_admin");
        var tenantActor = await AddUserAsync("impersonate-tenant", role: "admin", isTenantSuperAdmin: true);
        var target = await AddUserAsync("impersonate-target");
        var inactive = await AddUserAsync("impersonate-inactive", isActive: false);
        var protectedTarget = await AddUserAsync("impersonate-protected", isTenantSuperAdmin: true);
        var crossTenant = await AddUserAsync(
            "impersonate-cross-tenant",
            tenantId: TestData.Tenant2.Id);

        await AuthenticateAsAdminAsync();
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{target.Id}/impersonate", null),
            HttpStatusCode.Forbidden,
            "forbidden");

        await AuthenticateAsync(tenantActor);
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{target.Id}/impersonate", null),
            HttpStatusCode.Forbidden,
            "forbidden");

        await AuthenticateAsync(platformActor);
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{platformActor.Id}/impersonate", null),
            HttpStatusCode.UnprocessableEntity,
            "VALIDATION_ERROR");
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{crossTenant.Id}/impersonate", null),
            HttpStatusCode.NotFound,
            "NOT_FOUND");
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{protectedTarget.Id}/impersonate", null),
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{inactive.Id}/impersonate", null),
            HttpStatusCode.Conflict,
            "CONFLICT");

        var success = await Client.PostAsync($"/api/v2/admin/users/{target.Id}/impersonate", null);
        success.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await success.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("token").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("user_id").GetInt32().Should().Be(target.Id);
        data.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        data.GetProperty("tenant_slug").GetString().Should().Be(TestData.Tenant1.Slug);
    }

    [Fact]
    public async Task V2ExplicitGodTarget_CannotBeDeletedSuspendedBannedResetOrImpersonated()
    {
        var platformActor = await AddUserAsync("protect-god-platform", role: "super_admin");
        var godTarget = await AddUserAsync("protect-explicit-god", isGod: true);

        await AuthenticateAsAdminAsync();
        await AssertLaravelErrorAsync(
            await Client.DeleteAsync($"/api/v2/admin/users/{godTarget.Id}"),
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");
        await AssertLaravelErrorAsync(
            await Client.PostAsJsonAsync(
                $"/api/v2/admin/users/{godTarget.Id}/suspend",
                new { reason = "must be rejected" }),
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");
        await AssertLaravelErrorAsync(
            await Client.PostAsJsonAsync(
                $"/api/v2/admin/users/{godTarget.Id}/ban",
                new { reason = "must be rejected" }),
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{godTarget.Id}/reset-2fa", null),
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");

        await AuthenticateAsync(platformActor);
        await AssertLaravelErrorAsync(
            await Client.PostAsync($"/api/v2/admin/users/{godTarget.Id}/impersonate", null),
            HttpStatusCode.Forbidden,
            "AUTH_INSUFFICIENT_PERMISSIONS");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var persisted = await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(user => user.Id == godTarget.Id);
        persisted.IsActive.Should().BeTrue();
        persisted.IsGod.Should().BeTrue();
    }

    [Fact]
    public async Task V2SuperToggles_ArePolicyGatedTenantScopedAndFlagBacked()
    {
        var platformActor = await AddUserAsync("toggle-platform", role: "super_admin");
        var tenantActor = await AddUserAsync("toggle-tenant", role: "admin", isTenantSuperAdmin: true);
        var godActor = await AddUserAsync("toggle-god", role: "god", isGod: true);
        var tenantTarget = await AddUserAsync("toggle-tenant-target");
        var globalTarget = await AddUserAsync("toggle-global-target", role: "broker");
        var crossTenant = await AddUserAsync(
            "toggle-cross-tenant",
            tenantId: TestData.Tenant2.Id);

        await AuthenticateAsAdminAsync();
        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{tenantTarget.Id}/super-admin",
                new { grant = true }),
            HttpStatusCode.Forbidden,
            "forbidden");

        await AuthenticateAsync(tenantActor);
        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{tenantTarget.Id}/super-admin",
                new { grant = true }),
            HttpStatusCode.Forbidden,
            "forbidden");

        await AuthenticateAsync(platformActor);
        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{platformActor.Id}/super-admin",
                new { grant = false }),
            HttpStatusCode.UnprocessableEntity,
            "VALIDATION_ERROR");
        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{crossTenant.Id}/super-admin",
                new { grant = true }),
            HttpStatusCode.NotFound,
            "NOT_FOUND");

        var tenantGrant = await Client.PutAsJsonAsync(
            $"/api/v2/admin/users/{tenantTarget.Id}/super-admin",
            new { grant = true });
        tenantGrant.StatusCode.Should().Be(HttpStatusCode.OK);
        (await tenantGrant.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("is_tenant_super_admin")
            .GetBoolean()
            .Should().BeTrue();
        await AssertPersistedRoleFlagsAsync(
            tenantTarget.Id,
            expectedRole: "admin",
            isSuperAdmin: false,
            isTenantSuperAdmin: true);

        var tenantRevoke = await Client.PutAsJsonAsync(
            $"/api/v2/admin/users/{tenantTarget.Id}/super-admin",
            new { grant = false });
        tenantRevoke.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertPersistedRoleFlagsAsync(
            tenantTarget.Id,
            expectedRole: "admin",
            isSuperAdmin: false,
            isTenantSuperAdmin: false);

        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{globalTarget.Id}/global-super-admin",
                new { grant = true }),
            HttpStatusCode.Forbidden,
            "forbidden");

        await AuthenticateAsync(godActor);
        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{godActor.Id}/global-super-admin",
                new { grant = false }),
            HttpStatusCode.UnprocessableEntity,
            "VALIDATION_ERROR");
        await AssertLaravelErrorAsync(
            await Client.PutAsJsonAsync(
                $"/api/v2/admin/users/{crossTenant.Id}/global-super-admin",
                new { grant = true }),
            HttpStatusCode.NotFound,
            "NOT_FOUND");

        var globalGrant = await Client.PutAsJsonAsync(
            $"/api/v2/admin/users/{globalTarget.Id}/global-super-admin",
            new { grant = true });
        globalGrant.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertPersistedRoleFlagsAsync(
            globalTarget.Id,
            expectedRole: "broker",
            isSuperAdmin: true,
            isTenantSuperAdmin: false);

        var globalRevoke = await Client.PutAsJsonAsync(
            $"/api/v2/admin/users/{globalTarget.Id}/global-super-admin",
            new { grant = false });
        globalRevoke.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertPersistedRoleFlagsAsync(
            globalTarget.Id,
            expectedRole: "broker",
            isSuperAdmin: false,
            isTenantSuperAdmin: false);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.TenantConfigs
            .IgnoreQueryFilters()
            .AnyAsync(config => config.Key == "super_admins.global_user_ids"))
            .Should().BeFalse();
    }

    private async Task<User> AddUserAsync(
        string prefix,
        int? tenantId = null,
        string role = "member",
        bool isSuperAdmin = false,
        bool isTenantSuperAdmin = false,
        bool isGod = false,
        bool isActive = true)
    {
        var email = TrackEmail($"{prefix}-{Guid.NewGuid():N}@test.com");
        var user = new User
        {
            TenantId = tenantId ?? TestData.Tenant1.Id,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Role",
            LastName = "Writer",
            Role = role,
            IsSuperAdmin = isSuperAdmin,
            IsTenantSuperAdmin = isTenantSuperAdmin,
            IsGod = isGod,
            IsActive = isActive,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private async Task AuthenticateAsync(User user)
    {
        var tenantSlug = user.TenantId == TestData.Tenant2.Id
            ? TestData.Tenant2.Slug
            : TestData.Tenant1.Slug;
        SetAuthToken(await GetAccessTokenAsync(user.Email, tenantSlug));
    }

    private string TrackEmail(string email)
    {
        _createdEmails.Add(email);
        return email;
    }

    private async Task AssertPersistedRoleFlagsAsync(
        int userId,
        string expectedRole,
        bool isSuperAdmin,
        bool isTenantSuperAdmin)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(candidate => candidate.Id == userId);
        user.Role.Should().Be(expectedRole);
        user.IsSuperAdmin.Should().Be(isSuperAdmin);
        user.IsTenantSuperAdmin.Should().Be(isTenantSuperAdmin);
    }

    private static async Task AssertLaravelErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode expectedStatus,
        string expectedCode,
        string? field = null)
    {
        response.StatusCode.Should().Be(expectedStatus);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = payload.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be(expectedCode);
        if (field is not null)
            error.GetProperty("field").GetString().Should().Be(field);
    }

    private static void AssertDetailFlags(
        JsonElement user,
        bool isSuperAdmin,
        bool isTenantSuperAdmin,
        bool isGod,
        bool isAdmin)
    {
        user.GetProperty("is_super_admin").GetBoolean().Should().Be(isSuperAdmin);
        user.GetProperty("is_tenant_super_admin").GetBoolean().Should().Be(isTenantSuperAdmin);
        user.GetProperty("is_god").GetBoolean().Should().Be(isGod);
        user.GetProperty("is_admin").GetBoolean().Should().Be(isAdmin);
    }
}
