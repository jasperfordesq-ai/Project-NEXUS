// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminExplicitParityControllerTests : IntegrationTestBase
{
    public AdminExplicitParityControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task AdminAdCampaignsV2_ReturnsLaravelReactListContract()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/ad-campaigns");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("error", out _).Should().BeFalse();
        json.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        json.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
    }

    [Fact]
    public async Task ListingsStats_ReturnsDatabaseBackedCounts()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/listings/stats");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("total").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("active").GetInt32().Should().BeGreaterThan(0);
        data.TryGetProperty("compatibility", out _).Should().BeFalse();
    }

    [Fact]
    public async Task StaticApiGap_VolunteeringExpenseReceiptV2_ReturnsTenantScopedReceiptDownload()
    {
        int expenseId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var fileUploadService = scope.ServiceProvider.GetRequiredService<FileUploadService>();
            await using var receiptStream = new MemoryStream(Encoding.UTF8.GetBytes("bus receipt"));
            var (upload, uploadError) = await fileUploadService.UploadAsync(
                receiptStream,
                "bus-receipt.txt",
                "text/plain",
                receiptStream.Length,
                TestData.MemberUser.Id,
                TestData.Tenant1.Id,
                FileCategory.Document,
                entityType: "volunteer_expense");

            uploadError.Should().BeNull();
            upload.Should().NotBeNull();

            var expense = new VolunteerExpense
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Amount = 12.50m,
                Currency = "GBP",
                Category = "travel",
                Description = "Bus fare to community shift",
                ReceiptUrl = fileUploadService.GetDownloadUrl(upload!),
                Status = VolunteerExpenseStatus.Submitted,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerExpenses.Add(expense);
            await db.SaveChangesAsync();
            expenseId = expense.Id;
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync($"/api/v2/admin/volunteering/expenses/{expenseId}/receipt");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("text/plain");
        response.Content.Headers.ContentDisposition?.FileNameStar.Should().Be("bus-receipt.txt");
        (await response.Content.ReadAsStringAsync()).Should().Be("bus receipt");

        var missing = await Client.GetAsync("/api/v2/admin/volunteering/expenses/999999/receipt");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var missingJson = await missing.Content.ReadFromJsonAsync<JsonElement>();
        missingJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersBulkApproveAndSuspend_ReturnLaravelReactBulkResultsAndUpdateTenantUsers()
    {
        int approveOneId;
        int approveTwoId;
        int suspendId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var approveOne = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"bulk-approve-one-{Guid.NewGuid():N}@example.test",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Bulk",
                LastName = "Approve One",
                Role = "member",
                IsActive = false,
                SuspendedAt = DateTime.UtcNow.AddDays(-2),
                SuspensionReason = "Pending approval",
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            var approveTwo = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"bulk-approve-two-{Guid.NewGuid():N}@example.test",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Bulk",
                LastName = "Approve Two",
                Role = "member",
                IsActive = false,
                SuspendedAt = DateTime.UtcNow.AddDays(-2),
                SuspensionReason = "Pending approval",
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            var suspend = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"bulk-suspend-{Guid.NewGuid():N}@example.test",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Bulk",
                LastName = "Suspend",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };
            var otherTenant = new User
            {
                TenantId = TestData.Tenant2.Id,
                Email = $"bulk-other-{Guid.NewGuid():N}@example.test",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Bulk",
                LastName = "Other",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            };

            db.Users.AddRange(approveOne, approveTwo, suspend, otherTenant);
            await db.SaveChangesAsync();
            approveOneId = approveOne.Id;
            approveTwoId = approveTwo.Id;
            suspendId = suspend.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsAdminAsync();

        var approveResponse = await Client.PostAsJsonAsync("/api/v2/admin/users/bulk-approve", new
        {
            user_ids = new[] { approveOneId, approveTwoId, otherTenantId, 999999 }
        });

        approveResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var approveJson = await approveResponse.Content.ReadFromJsonAsync<JsonElement>();
        approveJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        approveJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var approveData = approveJson.GetProperty("data");
        approveData.GetProperty("success").GetInt32().Should().Be(2);
        approveData.GetProperty("failed").GetInt32().Should().Be(2);
        approveData.GetProperty("skipped_ids").EnumerateArray().Select(x => x.GetInt32())
            .Should().BeEquivalentTo(new[] { otherTenantId, 999999 });

        var suspendResponse = await Client.PostAsJsonAsync("/api/v2/admin/users/bulk-suspend", new
        {
            user_ids = new[] { suspendId, TestData.AdminUser.Id, otherTenantId, 999998 },
            reason = "Bulk policy violation"
        });

        suspendResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var suspendJson = await suspendResponse.Content.ReadFromJsonAsync<JsonElement>();
        suspendJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        suspendJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var suspendData = suspendJson.GetProperty("data");
        suspendData.GetProperty("success").GetInt32().Should().Be(1);
        suspendData.GetProperty("failed").GetInt32().Should().Be(3);
        suspendData.GetProperty("skipped_ids").EnumerateArray().Select(x => x.GetInt32())
            .Should().BeEquivalentTo(new[] { TestData.AdminUser.Id, otherTenantId, 999998 });

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var approvedUsers = await verifyDb.Users
            .IgnoreQueryFilters()
            .Where(u => u.Id == approveOneId || u.Id == approveTwoId)
            .ToListAsync();
        approvedUsers.Should().OnlyContain(u => u.IsActive && u.SuspendedAt == null && u.SuspensionReason == null);

        var suspended = await verifyDb.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == suspendId);
        suspended.IsActive.Should().BeFalse();
        suspended.SuspendedAt.Should().NotBeNull();
        suspended.SuspensionReason.Should().Be("Bulk policy violation");

        var otherTenantUser = await verifyDb.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == otherTenantId);
        otherTenantUser.IsActive.Should().BeTrue();
        otherTenantUser.SuspensionReason.Should().BeNull();
    }

    [Fact]
    public async Task AdminUsersSingleStatusActions_ReturnLaravelDataEnvelopesAndUpdateTenantUsers()
    {
        int approveId;
        int suspendId;
        int banId;
        int reactivateId;
        int reset2faId;
        int deleteId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var approve = NewAdminParityUser("single-approve", isActive: false);
            var suspend = NewAdminParityUser("single-suspend");
            var ban = NewAdminParityUser("single-ban");
            var reactivate = NewAdminParityUser("single-reactivate", isActive: false);
            reactivate.SuspendedAt = DateTime.UtcNow.AddDays(-3);
            reactivate.SuspensionReason = "Previous suspension";
            var reset2fa = NewAdminParityUser("single-reset-2fa");
            reset2fa.TwoFactorEnabled = true;
            reset2fa.TotpSecretEncrypted = "encrypted-secret";
            reset2fa.TwoFactorEnabledAt = DateTime.UtcNow.AddDays(-7);
            var delete = NewAdminParityUser("single-delete");
            var otherTenant = NewAdminParityUser("single-other-tenant", tenantId: TestData.Tenant2.Id);

            db.Users.AddRange(approve, suspend, ban, reactivate, reset2fa, delete, otherTenant);
            await db.SaveChangesAsync();
            db.TotpBackupCodes.Add(new TotpBackupCode
            {
                TenantId = TestData.Tenant1.Id,
                UserId = reset2fa.Id,
                CodeHash = "hashed-backup-code",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            });
            await db.SaveChangesAsync();

            approveId = approve.Id;
            suspendId = suspend.Id;
            banId = ban.Id;
            reactivateId = reactivate.Id;
            reset2faId = reset2fa.Id;
            deleteId = delete.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsAdminAsync();

        var approveResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{approveId}/approve", new { });
        approveResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var approveJson = await approveResponse.Content.ReadFromJsonAsync<JsonElement>();
        approveJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        approveJson.GetProperty("data").GetProperty("approved").GetBoolean().Should().BeTrue();
        approveJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(approveId);

        var suspendResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{suspendId}/suspend", new { reason = "Policy review" });
        suspendResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var suspendJson = await suspendResponse.Content.ReadFromJsonAsync<JsonElement>();
        suspendJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        suspendJson.GetProperty("data").GetProperty("suspended").GetBoolean().Should().BeTrue();
        suspendJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(suspendId);

        var banResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{banId}/ban", new { reason = "Spam" });
        banResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var banJson = await banResponse.Content.ReadFromJsonAsync<JsonElement>();
        banJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        banJson.GetProperty("data").GetProperty("banned").GetBoolean().Should().BeTrue();
        banJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(banId);

        var reactivateResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{reactivateId}/reactivate", new { });
        reactivateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var reactivateJson = await reactivateResponse.Content.ReadFromJsonAsync<JsonElement>();
        reactivateJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        reactivateJson.GetProperty("data").GetProperty("reactivated").GetBoolean().Should().BeTrue();
        reactivateJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(reactivateId);

        var reset2faResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{reset2faId}/reset-2fa", new { reason = "Lost phone" });
        reset2faResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var reset2faJson = await reset2faResponse.Content.ReadFromJsonAsync<JsonElement>();
        reset2faJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        reset2faJson.GetProperty("data").GetProperty("reset").GetBoolean().Should().BeTrue();
        reset2faJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(reset2faId);

        var deleteResponse = await Client.DeleteAsync($"/api/v2/admin/users/{deleteId}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await deleteResponse.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(deleteId);

        var otherTenantResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{otherTenantId}/suspend", new { reason = "Wrong tenant" });
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var users = await verifyDb.Users
            .IgnoreQueryFilters()
            .Where(u => new[] { approveId, suspendId, banId, reactivateId, reset2faId, otherTenantId }.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        users[approveId].IsActive.Should().BeTrue();
        users[approveId].SuspendedAt.Should().BeNull();
        users[suspendId].IsActive.Should().BeFalse();
        users[suspendId].SuspensionReason.Should().Be("Policy review");
        users[banId].IsActive.Should().BeFalse();
        users[banId].SuspensionReason.Should().Be("Spam");
        users[reactivateId].IsActive.Should().BeTrue();
        users[reactivateId].SuspendedAt.Should().BeNull();
        users[reset2faId].TwoFactorEnabled.Should().BeFalse();
        users[reset2faId].TotpSecretEncrypted.Should().BeNull();
        users[otherTenantId].IsActive.Should().BeTrue();

        var backupCodesRemain = await verifyDb.TotpBackupCodes
            .IgnoreQueryFilters()
            .AnyAsync(c => c.UserId == reset2faId);
        backupCodesRemain.Should().BeFalse();

        var deletedExists = await verifyDb.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.Id == deleteId);
        deletedExists.Should().BeFalse();
    }

    [Fact]
    public async Task AdminUsersListDetailAndUpdateV2_ReturnLaravelReactEnvelopesAndTenantScopedRows()
    {
        int userOneId;
        int userTwoId;
        int otherTenantId;
        var marker = Guid.NewGuid().ToString("N")[..10];
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var userOne = NewAdminParityUser($"list-one-{marker}");
            userOne.FirstName = "List";
            userOne.LastName = "One";
            userOne.Email = $"list-one-{marker}@example.test";
            userOne.Bio = "Seeded for Laravel React list/detail parity.";
            userOne.TwoFactorEnabled = true;
            var userTwo = NewAdminParityUser($"list-two-{marker}", isActive: false);
            userTwo.FirstName = "List";
            userTwo.LastName = "Two";
            userTwo.Email = $"list-two-{marker}@example.test";
            var otherTenant = NewAdminParityUser($"list-other-{marker}", tenantId: TestData.Tenant2.Id);
            otherTenant.Email = $"list-other-{marker}@example.test";

            db.Users.AddRange(userOne, userTwo, otherTenant);
            await db.SaveChangesAsync();
            userOneId = userOne.Id;
            userTwoId = userTwo.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsAdminAsync();

        var listResponse = await Client.GetAsync($"/api/v2/admin/users?search={marker}&page=1&limit=10&sort=email&order=asc");
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        listJson.TryGetProperty("pagination", out _).Should().BeFalse();
        var listData = listJson.GetProperty("data").EnumerateArray().ToArray();
        listData.Select(row => row.GetProperty("id").GetInt32()).Should().BeEquivalentTo(new[] { userOneId, userTwoId });
        listData.Should().OnlyContain(row => HasProperty(row, "name")
            && HasProperty(row, "status")
            && HasProperty(row, "balance")
            && HasProperty(row, "has_2fa_enabled")
            && row.GetProperty("tenant_id").GetInt32() == TestData.Tenant1.Id);
        var listMeta = listJson.GetProperty("meta");
        listMeta.GetProperty("current_page").GetInt32().Should().Be(1);
        listMeta.GetProperty("per_page").GetInt32().Should().Be(10);
        listMeta.GetProperty("total").GetInt32().Should().Be(2);
        listMeta.GetProperty("total_pages").GetInt32().Should().Be(1);
        listMeta.GetProperty("has_more").GetBoolean().Should().BeFalse();

        var detailResponse = await Client.GetAsync($"/api/v2/admin/users/{userOneId}");
        detailResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detailResponse.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.TryGetProperty("user", out _).Should().BeFalse();
        var detail = detailJson.GetProperty("data");
        detail.GetProperty("id").GetInt32().Should().Be(userOneId);
        detail.GetProperty("name").GetString().Should().Be("List One");
        detail.GetProperty("bio").GetString().Should().Be("Seeded for Laravel React list/detail parity.");
        detail.GetProperty("has_2fa_enabled").GetBoolean().Should().BeTrue();
        detail.GetProperty("badges").ValueKind.Should().Be(JsonValueKind.Array);
        detail.GetProperty("roles").ValueKind.Should().Be(JsonValueKind.Array);

        var updateResponse = await Client.PutAsJsonAsync($"/api/v2/admin/users/{userOneId}", new
        {
            first_name = "Updated",
            last_name = "Member",
            email = $"updated-{marker}@example.test",
            role = "broker"
        });
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await updateResponse.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.TryGetProperty("success", out _).Should().BeFalse();
        var updated = updateJson.GetProperty("data");
        updated.GetProperty("id").GetInt32().Should().Be(userOneId);
        updated.GetProperty("name").GetString().Should().Be("Updated Member");
        updated.GetProperty("email").GetString().Should().Be($"updated-{marker}@example.test");
        updated.GetProperty("role").GetString().Should().Be("broker");

        var otherTenantResponse = await Client.GetAsync($"/api/v2/admin/users/{otherTenantId}");
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersCreateV2_ReturnsLaravelCreatedEnvelopeAndValidationErrors()
    {
        await AuthenticateAsAdminAsync();
        var marker = Guid.NewGuid().ToString("N")[..10];
        var email = $"created-{marker}@example.test";

        var createResponse = await Client.PostAsJsonAsync("/api/v2/admin/users", new
        {
            first_name = "Created",
            last_name = "Member",
            email,
            password = "Created123!",
            role = "broker",
            send_welcome_email = false
        });

        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        createJson.TryGetProperty("success", out _).Should().BeFalse();
        var data = createJson.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("name").GetString().Should().Be("Created Member");
        data.GetProperty("email").GetString().Should().Be(email);
        data.GetProperty("role").GetString().Should().Be("broker");
        data.GetProperty("status").GetString().Should().Be("active");
        createJson.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var created = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Email == email);
            created.TenantId.Should().Be(TestData.Tenant1.Id);
            created.FirstName.Should().Be("Created");
            created.LastName.Should().Be("Member");
            created.Role.Should().Be("broker");
            created.IsActive.Should().BeTrue();
            created.PasswordHash.Should().NotBe("NEEDS_RESET");
        }

        var duplicateResponse = await Client.PostAsJsonAsync("/api/v2/admin/users", new
        {
            first_name = "Created",
            last_name = "Duplicate",
            email,
            password = "Created123!",
            role = "member"
        });
        duplicateResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var duplicateJson = await duplicateResponse.Content.ReadFromJsonAsync<JsonElement>();
        duplicateJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        duplicateJson.GetProperty("errors")[0].GetProperty("field").GetString().Should().Be("email");

        var invalidResponse = await Client.PostAsJsonAsync("/api/v2/admin/users", new
        {
            first_name = "",
            last_name = "",
            email = "not-an-email",
            password = "short",
            role = "god"
        });
        invalidResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var invalidJson = await invalidResponse.Content.ReadFromJsonAsync<JsonElement>();
        invalidJson.GetProperty("errors").GetArrayLength().Should().BeGreaterThan(1);
    }

    [Fact]
    public async Task AdminUsersPasswordAndEmailHelpersV2_ReturnLaravelDataEnvelopesAndTenantScopedErrors()
    {
        int userId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = NewAdminParityUser("password-helper");
            var otherTenant = NewAdminParityUser("password-helper-other", tenantId: TestData.Tenant2.Id);
            db.Users.AddRange(user, otherTenant);
            await db.SaveChangesAsync();
            userId = user.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsAdminAsync();

        var passwordResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{userId}/password", new
        {
            password = "Changed123!"
        });
        passwordResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var passwordJson = await passwordResponse.Content.ReadFromJsonAsync<JsonElement>();
        passwordJson.TryGetProperty("success", out _).Should().BeFalse();
        passwordJson.GetProperty("data").GetProperty("password_set").GetBoolean().Should().BeTrue();
        passwordJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(userId);

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var updated = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            BCrypt.Net.BCrypt.Verify("Changed123!", updated.PasswordHash).Should().BeTrue();
        }

        var shortPasswordResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{userId}/password", new
        {
            password = "short"
        });
        shortPasswordResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var shortPasswordJson = await shortPasswordResponse.Content.ReadFromJsonAsync<JsonElement>();
        shortPasswordJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        shortPasswordJson.GetProperty("errors")[0].GetProperty("field").GetString().Should().Be("password");

        var resetResponse = await Client.PostAsync($"/api/v2/admin/users/{userId}/send-password-reset", null);
        resetResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var resetJson = await resetResponse.Content.ReadFromJsonAsync<JsonElement>();
        resetJson.TryGetProperty("success", out _).Should().BeFalse();
        resetJson.GetProperty("data").GetProperty("sent").GetBoolean().Should().BeTrue();
        resetJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(userId);

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var hasResetToken = await db.PasswordResetTokens.IgnoreQueryFilters()
                .AnyAsync(t => t.UserId == userId && t.UsedAt == null);
            hasResetToken.Should().BeTrue();
        }

        var welcomeResponse = await Client.PostAsync($"/api/v2/admin/users/{userId}/send-welcome-email", null);
        welcomeResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var welcomeJson = await welcomeResponse.Content.ReadFromJsonAsync<JsonElement>();
        welcomeJson.TryGetProperty("success", out _).Should().BeFalse();
        welcomeJson.GetProperty("data").GetProperty("sent").GetBoolean().Should().BeTrue();
        welcomeJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(userId);

        var otherTenantResponse = await Client.PostAsync($"/api/v2/admin/users/{otherTenantId}/send-password-reset", null);
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersConsentsV2_ReturnLaravelDataEnvelopeAndTenantScopedRows()
    {
        int userId;
        int otherTenantId;
        var grantedAt = DateTime.UtcNow.AddDays(-4);
        var revokedAt = DateTime.UtcNow.AddDays(-1);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = NewAdminParityUser("consents");
            var otherTenant = NewAdminParityUser("consents-other", tenantId: TestData.Tenant2.Id);
            db.Users.AddRange(user, otherTenant);
            await db.SaveChangesAsync();
            userId = user.Id;
            otherTenantId = otherTenant.Id;

            db.ConsentRecords.AddRange(
                new ConsentRecord
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = userId,
                    ConsentType = "terms_of_service",
                    IsGranted = true,
                    GrantedAt = grantedAt,
                    CreatedAt = grantedAt
                },
                new ConsentRecord
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = userId,
                    ConsentType = "marketing_emails",
                    IsGranted = false,
                    GrantedAt = grantedAt.AddDays(-2),
                    RevokedAt = revokedAt,
                    CreatedAt = grantedAt.AddDays(-2),
                    UpdatedAt = revokedAt
                },
                new ConsentRecord
                {
                    TenantId = TestData.Tenant2.Id,
                    UserId = otherTenantId,
                    ConsentType = "privacy_policy",
                    IsGranted = true,
                    GrantedAt = grantedAt,
                    CreatedAt = grantedAt
                });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/v2/admin/users/{userId}/consents");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("user_id", out _).Should().BeFalse();
        var data = json.GetProperty("data").EnumerateArray().ToArray();
        data.Should().HaveCount(2);
        data.Select(row => row.GetProperty("consent_type").GetString())
            .Should().BeEquivalentTo(new[] { "terms_of_service", "marketing_emails" });
        data.Should().OnlyContain(row => HasProperty(row, "name")
            && HasProperty(row, "description")
            && HasProperty(row, "category")
            && HasProperty(row, "is_required")
            && HasProperty(row, "consent_given")
            && HasProperty(row, "consent_version")
            && HasProperty(row, "given_at")
            && HasProperty(row, "withdrawn_at"));
        data.Single(row => row.GetProperty("consent_type").GetString() == "terms_of_service")
            .GetProperty("consent_given").GetBoolean().Should().BeTrue();
        data.Single(row => row.GetProperty("consent_type").GetString() == "marketing_emails")
            .GetProperty("consent_given").GetBoolean().Should().BeFalse();

        var otherTenantResponse = await Client.GetAsync($"/api/v2/admin/users/{otherTenantId}/consents");
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersImportV2_AcceptsLaravelReactMultipartCsvAndReturnsDataEnvelope()
    {
        await AuthenticateAsAdminAsync();
        var marker = Guid.NewGuid().ToString("N")[..10];
        var validEmail = $"csv-import-{marker}@example.test";
        var csv = string.Join("\n", new[]
        {
            "first_name,last_name,email,phone,role",
            $"Csv,Imported,{validEmail},+15551234567,broker",
            "Broken,Row,not-an-email,,member"
        });
        using var form = new MultipartFormDataContent();
        using var file = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        file.Headers.ContentType = new("text/csv");
        form.Add(file, "csv_file", "users.csv");
        form.Add(new StringContent("member"), "default_role");

        var response = await Client.PostAsync("/api/v2/admin/users/import", form);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("imported", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.GetProperty("imported").GetInt32().Should().Be(1);
        data.GetProperty("skipped").GetInt32().Should().Be(1);
        data.GetProperty("total_rows").GetInt32().Should().Be(2);
        data.GetProperty("errors").EnumerateArray().Select(e => e.GetString())
            .Should().Contain(e => e!.Contains("Invalid email", StringComparison.OrdinalIgnoreCase));

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var imported = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Email == validEmail);
        imported.TenantId.Should().Be(TestData.Tenant1.Id);
        imported.FirstName.Should().Be("Csv");
        imported.LastName.Should().Be("Imported");
        imported.Role.Should().Be("broker");
        imported.IsActive.Should().BeTrue();
    }

    [Fact]
    public async Task AdminUsersBadgeRecheckV2_ReturnsLaravelDataEnvelopeWithBadges()
    {
        int userId;
        int otherTenantId;
        string badgeSlug;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = NewAdminParityUser("badge-recheck");
            var otherTenant = NewAdminParityUser("badge-recheck-other", tenantId: TestData.Tenant2.Id);
            var badge = new Badge
            {
                TenantId = TestData.Tenant1.Id,
                Slug = $"manual_recheck_{Guid.NewGuid():N}",
                Name = "Manual Recheck",
                Description = "Seeded for admin badge recheck parity.",
                Icon = "award",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.Users.AddRange(user, otherTenant);
            db.Badges.Add(badge);
            await db.SaveChangesAsync();

            db.UserBadges.Add(new UserBadge
            {
                TenantId = TestData.Tenant1.Id,
                UserId = user.Id,
                BadgeId = badge.Id,
                EarnedAt = DateTime.UtcNow.AddDays(-1)
            });
            await db.SaveChangesAsync();
            userId = user.Id;
            otherTenantId = otherTenant.Id;
            badgeSlug = badge.Slug;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsync($"/api/v2/admin/users/{userId}/badges/recheck", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("badges_awarded", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.GetProperty("rechecked").GetBoolean().Should().BeTrue();
        data.GetProperty("user_id").GetInt32().Should().Be(userId);
        var badges = data.GetProperty("badges").EnumerateArray().ToArray();
        badges.Should().Contain(row =>
            row.GetProperty("slug").GetString() == badgeSlug
            && row.GetProperty("name").GetString() == "Manual Recheck"
            && row.GetProperty("awarded_at").ValueKind != JsonValueKind.Null);

        var otherTenantResponse = await Client.PostAsync($"/api/v2/admin/users/{otherTenantId}/badges/recheck", null);
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersBadgeAddRemoveV2_ReturnLaravelDataEnvelopesAndTenantScopedErrors()
    {
        int userId;
        int otherTenantId;
        string badgeSlug;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = NewAdminParityUser("badge-add-remove");
            var otherTenant = NewAdminParityUser("badge-add-remove-other", tenantId: TestData.Tenant2.Id);
            var badge = new Badge
            {
                TenantId = TestData.Tenant1.Id,
                Slug = $"manual_add_{Guid.NewGuid():N}",
                Name = "Manual Add",
                Description = "Seeded for admin badge add/remove parity.",
                Icon = "award",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.Users.AddRange(user, otherTenant);
            db.Badges.Add(badge);
            await db.SaveChangesAsync();
            userId = user.Id;
            otherTenantId = otherTenant.Id;
            badgeSlug = badge.Slug;
        }

        await AuthenticateAsAdminAsync();

        var addResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{userId}/badges", new
        {
            badge_slug = badgeSlug
        });

        addResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var addJson = await addResponse.Content.ReadFromJsonAsync<JsonElement>();
        addJson.TryGetProperty("success", out _).Should().BeFalse();
        var addData = addJson.GetProperty("data");
        addData.GetProperty("awarded").GetBoolean().Should().BeTrue();
        addData.GetProperty("user_id").GetInt32().Should().Be(userId);
        addData.GetProperty("badge_slug").GetString().Should().Be(badgeSlug);

        int userBadgeId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            userBadgeId = await db.UserBadges
                .IgnoreQueryFilters()
                .Where(ub => ub.UserId == userId && ub.Badge!.Slug == badgeSlug)
                .Select(ub => ub.Id)
                .SingleAsync();
        }

        var removeResponse = await Client.DeleteAsync($"/api/v2/admin/users/{userId}/badges/{userBadgeId}");
        removeResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var removeJson = await removeResponse.Content.ReadFromJsonAsync<JsonElement>();
        removeJson.TryGetProperty("success", out _).Should().BeFalse();
        var removeData = removeJson.GetProperty("data");
        removeData.GetProperty("removed").GetBoolean().Should().BeTrue();
        removeData.GetProperty("user_id").GetInt32().Should().Be(userId);
        removeData.GetProperty("badge_id").GetInt32().Should().Be(userBadgeId);

        var otherTenantResponse = await Client.PostAsJsonAsync($"/api/v2/admin/users/{otherTenantId}/badges", new
        {
            badge_slug = badgeSlug
        });
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersImpersonateV2_ReturnsLaravelDataTokenAndTenantScopedErrors()
    {
        int userId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = NewAdminParityUser("impersonate-v2");
            var otherTenant = NewAdminParityUser("impersonate-v2-other", tenantId: TestData.Tenant2.Id);
            db.Users.AddRange(user, otherTenant);
            await db.SaveChangesAsync();
            userId = user.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsPlatformSuperAdminAsync();

        var response = await Client.PostAsync($"/api/v2/admin/users/{userId}/impersonate", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("access_token", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.GetProperty("token").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("user_id").GetInt32().Should().Be(userId);
        data.GetProperty("user_name").GetString().Should().Be("Admin Parity");
        data.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        data.GetProperty("tenant_slug").GetString().Should().NotBeNullOrWhiteSpace();

        var otherTenantResponse = await Client.PostAsync($"/api/v2/admin/users/{otherTenantId}/impersonate", null);
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminUsersSuperAdminTogglesV2_ReturnLaravelDataEnvelopesAndTenantScopedErrors()
    {
        int userId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = NewAdminParityUser("super-admin-toggle");
            var otherTenant = NewAdminParityUser("super-admin-toggle-other", tenantId: TestData.Tenant2.Id);
            db.Users.AddRange(user, otherTenant);
            await db.SaveChangesAsync();
            userId = user.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsGodAsync();

        var grantTenant = await Client.PutAsJsonAsync($"/api/v2/admin/users/{userId}/super-admin", new { grant = true });
        grantTenant.StatusCode.Should().Be(HttpStatusCode.OK);
        var grantTenantJson = await grantTenant.Content.ReadFromJsonAsync<JsonElement>();
        grantTenantJson.TryGetProperty("success", out _).Should().BeFalse();
        var grantTenantData = grantTenantJson.GetProperty("data");
        grantTenantData.GetProperty("id").GetInt32().Should().Be(userId);
        grantTenantData.GetProperty("is_tenant_super_admin").GetBoolean().Should().BeTrue();

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await verifyDb.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            user.Role.Should().Be("admin");
            user.IsTenantSuperAdmin.Should().BeTrue();
        }

        var revokeTenant = await Client.PutAsJsonAsync($"/api/v2/admin/users/{userId}/super-admin", new { grant = false });
        revokeTenant.StatusCode.Should().Be(HttpStatusCode.OK);
        var revokeTenantJson = await revokeTenant.Content.ReadFromJsonAsync<JsonElement>();
        revokeTenantJson.GetProperty("data").GetProperty("is_tenant_super_admin").GetBoolean().Should().BeFalse();

        var grantGlobal = await Client.PutAsJsonAsync($"/api/v2/admin/users/{userId}/global-super-admin", new { grant = true });
        grantGlobal.StatusCode.Should().Be(HttpStatusCode.OK);
        var grantGlobalJson = await grantGlobal.Content.ReadFromJsonAsync<JsonElement>();
        grantGlobalJson.TryGetProperty("success", out _).Should().BeFalse();
        var grantGlobalData = grantGlobalJson.GetProperty("data");
        grantGlobalData.GetProperty("id").GetInt32().Should().Be(userId);
        grantGlobalData.GetProperty("is_super_admin").GetBoolean().Should().BeTrue();

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await verifyDb.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            user.IsSuperAdmin.Should().BeTrue();
        }

        var revokeGlobal = await Client.PutAsJsonAsync($"/api/v2/admin/users/{userId}/global-super-admin", new { grant = false });
        revokeGlobal.StatusCode.Should().Be(HttpStatusCode.OK);
        var revokeGlobalJson = await revokeGlobal.Content.ReadFromJsonAsync<JsonElement>();
        revokeGlobalJson.GetProperty("data").GetProperty("is_super_admin").GetBoolean().Should().BeFalse();

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await verifyDb.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            user.IsSuperAdmin.Should().BeFalse();
        }

        var otherTenantResponse = await Client.PutAsJsonAsync($"/api/v2/admin/users/{otherTenantId}/super-admin", new { grant = true });
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var otherTenantJson = await otherTenantResponse.Content.ReadFromJsonAsync<JsonElement>();
        otherTenantJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AdminListingsDeleteV2_RemovesTenantListingWithLaravelReactContract()
    {
        int listingId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var listing = new Listing
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Title = "Parity listing to delete",
                Description = "Listing seeded for Laravel React admin delete parity.",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                CreatedAt = DateTime.UtcNow.AddDays(-2),
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            };
            db.Listings.Add(listing);
            await db.SaveChangesAsync();
            listingId = listing.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.DeleteAsync($"/api/v2/admin/listings/{listingId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.GetProperty("deleted").GetBoolean().Should().BeTrue();
        data.GetProperty("id").GetInt32().Should().Be(listingId);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var deleted = await verifyDb.Listings
            .IgnoreQueryFilters()
            .AnyAsync(l => l.TenantId == TestData.Tenant1.Id && l.Id == listingId);
        deleted.Should().BeFalse();
        var notification = await verifyDb.Notifications
            .IgnoreQueryFilters()
            .SingleAsync(n => n.TenantId == TestData.Tenant1.Id
                              && n.UserId == TestData.MemberUser.Id
                              && n.Type == "listing_removed");
        notification.Link.Should().Be("/listings");
        notification.Body.Should().Contain("Parity listing to delete");
        var audit = await verifyDb.AuditLogs
            .IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                                && row.Action == "admin_delete_listing"
                                && row.EntityId == listingId);
        audit.UserId.Should().Be(TestData.AdminUser.Id);
    }

    [Fact]
    public async Task AdminEventsDeleteV2_ArchivesTenantEventWithLaravelReactContract()
    {
        int eventId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evt = new Event
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.MemberUser.Id,
                Title = "Parity event to delete",
                Description = "Event seeded for Laravel React admin delete parity.",
                Location = "Community Hall",
                StartsAt = DateTime.UtcNow.AddDays(5),
                EndsAt = DateTime.UtcNow.AddDays(5).AddHours(2),
                CreatedAt = DateTime.UtcNow.AddDays(-2),
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            };
            db.Events.Add(evt);
            await db.SaveChangesAsync();
            eventId = evt.Id;

            db.EventRsvps.Add(new EventRsvp
            {
                TenantId = TestData.Tenant1.Id,
                EventId = eventId,
                UserId = TestData.MemberUser.Id,
                Status = Event.RsvpStatus.Going,
                RespondedAt = DateTime.UtcNow.AddDays(-1)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/api/v2/admin/events/{eventId}")
        {
            Content = JsonContent.Create(new { reason = "Archived by contract test" })
        };
        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().Be(eventId);
        data.GetProperty("publication_state").GetString().Should().Be("archived");
        data.GetProperty("operational_state").GetString().Should().Be("cancelled");
        data.GetProperty("transition").GetProperty("action").GetString().Should().Be("archive");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var archived = await verifyDb.Events
            .IgnoreQueryFilters()
            .SingleAsync(e => e.TenantId == TestData.Tenant1.Id && e.Id == eventId);
        archived.PublicationStatus.Should().Be("archived");
        archived.OperationalStatus.Should().Be("cancelled");
        archived.IsCancelled.Should().BeTrue();
        var rsvp = await verifyDb.EventRsvps
            .IgnoreQueryFilters()
            .SingleAsync(r => r.TenantId == TestData.Tenant1.Id && r.EventId == eventId);
        rsvp.Status.Should().Be("cancelled");
    }

    [Fact]
    public async Task AdminGroupsUpdateV2_UpdatesTenantGroupWithLaravelReactContract()
    {
        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var group = new Group
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                Name = "Parity group before update",
                Description = "Before update",
                IsPrivate = false,
                ImageUrl = "https://groups.example.test/before.png",
                CreatedAt = DateTime.UtcNow.AddDays(-4),
                UpdatedAt = DateTime.UtcNow.AddDays(-2)
            };
            db.Groups.Add(group);
            await db.SaveChangesAsync();
            groupId = group.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync($"/api/v2/admin/groups/{groupId}", new
        {
            name = "Parity group after update",
            description = "After update",
            visibility = "private",
            cover_image_url = "https://groups.example.test/after.png"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().Be(groupId);
        data.GetProperty("updated").GetBoolean().Should().BeTrue();

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var updated = await verifyDb.Groups
            .IgnoreQueryFilters()
            .SingleAsync(g => g.TenantId == TestData.Tenant1.Id && g.Id == groupId);
        updated.Name.Should().Be("Parity group after update");
        updated.Description.Should().Be("After update");
        updated.IsPrivate.Should().BeTrue();
        updated.ImageUrl.Should().Be("https://groups.example.test/after.png");
        updated.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task AdminGroupsDeleteV2_RemovesTenantGroupWithLaravelReactContract()
    {
        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var group = new Group
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                Name = "Parity group to delete",
                Description = "Group seeded for Laravel React admin delete parity.",
                CreatedAt = DateTime.UtcNow.AddDays(-3),
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            };
            db.Groups.Add(group);
            await db.SaveChangesAsync();
            groupId = group.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.DeleteAsync($"/api/v2/admin/groups/{groupId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        var data = json.GetProperty("data");
        data.GetProperty("deleted").GetBoolean().Should().BeTrue();
        data.GetProperty("id").GetInt32().Should().Be(groupId);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var groupExists = await verifyDb.Groups
            .IgnoreQueryFilters()
            .AnyAsync(g => g.TenantId == TestData.Tenant1.Id && g.Id == groupId);
        groupExists.Should().BeFalse();
    }

    [Fact]
    public async Task InviteCodesV2_GenerateListAndDeactivateUseLaravelReactContract()
    {
        await AuthenticateAsAdminAsync();

        var generate = await Client.PostAsJsonAsync("/api/v2/admin/invite-codes", new
        {
            count = 2,
            max_uses = 3,
            expires_at = DateTime.UtcNow.AddDays(7).ToString("O"),
            note = "Laravel React invite-code compatibility"
        });

        generate.StatusCode.Should().Be(HttpStatusCode.OK);
        var generateJson = await generate.Content.ReadFromJsonAsync<JsonElement>();
        generateJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var generateData = generateJson.GetProperty("data");
        generateData.GetProperty("count").GetInt32().Should().Be(2);
        var generatedCodes = generateData.GetProperty("codes")
            .EnumerateArray()
            .Select(code => code.GetString())
            .ToArray();
        generatedCodes.Should().HaveCount(2);
        generatedCodes.Should().OnlyContain(code => !string.IsNullOrWhiteSpace(code));

        var list = await Client.GetAsync("/api/v2/admin/invite-codes?limit=10&offset=0");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var listData = listJson.GetProperty("data");
        listData.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(2);
        var items = listData.GetProperty("items").EnumerateArray().ToArray();
        items.Select(item => item.GetProperty("code").GetString())
            .Should().Contain(generatedCodes);

        var firstGenerated = items.First(item => item.GetProperty("code").GetString() == generatedCodes[0]);
        firstGenerated.GetProperty("max_uses").GetInt32().Should().Be(3);
        firstGenerated.GetProperty("uses_count").GetInt32().Should().Be(0);
        firstGenerated.GetProperty("is_active").GetBoolean().Should().BeTrue();
        firstGenerated.GetProperty("note").GetString().Should().Be("Laravel React invite-code compatibility");

        var deactivate = await Client.DeleteAsync($"/api/v2/admin/invite-codes/{firstGenerated.GetProperty("id").GetInt32()}");

        deactivate.StatusCode.Should().Be(HttpStatusCode.OK);
        var deactivateJson = await deactivate.Content.ReadFromJsonAsync<JsonElement>();
        deactivateJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        deactivateJson.GetProperty("data").GetProperty("deactivated").GetBoolean().Should().BeTrue();

        var relist = await Client.GetAsync("/api/v2/admin/invite-codes?limit=10&offset=0");
        var relistJson = await relist.Content.ReadFromJsonAsync<JsonElement>();
        var deactivated = relistJson.GetProperty("data").GetProperty("items")
            .EnumerateArray()
            .First(item => item.GetProperty("id").GetInt32() == firstGenerated.GetProperty("id").GetInt32());
        deactivated.GetProperty("is_active").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task ModerationSettingsV2_GetPutAndReloadUseLaravelReactContract()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/moderation/settings");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("enabled").ValueKind.Should().Be(JsonValueKind.False);
        initialData.GetProperty("require_post").ValueKind.Should().Be(JsonValueKind.False);
        initialData.GetProperty("require_listing").ValueKind.Should().Be(JsonValueKind.False);
        initialData.GetProperty("require_event").ValueKind.Should().Be(JsonValueKind.False);
        initialData.GetProperty("require_comment").ValueKind.Should().Be(JsonValueKind.False);
        initialData.GetProperty("auto_filter").ValueKind.Should().Be(JsonValueKind.False);

        var update = await Client.PutAsJsonAsync("/api/v2/admin/moderation/settings", new
        {
            enabled = true,
            require_post = true,
            require_listing = false,
            require_event = true,
            require_comment = false,
            auto_filter = true,
            ignored_key = true
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var updateData = updateJson.GetProperty("data");
        updateData.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        var updatedSettings = updateData.GetProperty("settings");
        updatedSettings.GetProperty("enabled").GetBoolean().Should().BeTrue();
        updatedSettings.GetProperty("require_post").GetBoolean().Should().BeTrue();
        updatedSettings.GetProperty("require_listing").GetBoolean().Should().BeFalse();
        updatedSettings.GetProperty("require_event").GetBoolean().Should().BeTrue();
        updatedSettings.GetProperty("require_comment").GetBoolean().Should().BeFalse();
        updatedSettings.GetProperty("auto_filter").GetBoolean().Should().BeTrue();
        updatedSettings.TryGetProperty("ignored_key", out _).Should().BeFalse();

        var reloaded = await Client.GetAsync("/api/v2/admin/moderation/settings");

        reloaded.StatusCode.Should().Be(HttpStatusCode.OK);
        var reloadedJson = await reloaded.Content.ReadFromJsonAsync<JsonElement>();
        var reloadedData = reloadedJson.GetProperty("data");
        reloadedData.GetProperty("enabled").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("require_post").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("require_listing").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("require_event").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("require_comment").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("auto_filter").GetBoolean().Should().BeTrue();
        reloadedData.TryGetProperty("ignored_key", out _).Should().BeFalse();
    }

    [Fact]
    public async Task VolunteeringOrganizationsV2_ReturnsTenantOrganisationsWithLaravelReactShape()
    {
        int organisationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var now = DateTime.UtcNow;
            var seededOrganisation = new VolunteerOrganisation
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Parity Volunteer Hub",
                Slug = "parity-volunteer-hub-" + Guid.NewGuid().ToString("N"),
                Description = "Volunteer hub exposed through the Laravel React admin API.",
                Website = "https://volunteer.example.test",
                ContactEmail = "volunteer-hub@example.test",
                OrgType = "charity",
                Status = "active",
                OwnerUserId = TestData.AdminUser.Id,
                Balance = 42.5m,
                CreatedAt = now.AddDays(-4),
                UpdatedAt = now.AddDays(-1)
            };
            db.VolunteerOrganisations.Add(seededOrganisation);
            await db.SaveChangesAsync();

            organisationId = seededOrganisation.Id;
            db.VolunteerOrganisationMembers.Add(new VolunteerOrganisationMember
            {
                TenantId = TestData.Tenant1.Id,
                VolunteerOrganisationId = organisationId,
                UserId = TestData.MemberUser.Id,
                Role = "member",
                Status = "active",
                CreatedAt = now.AddDays(-3)
            });
            db.VolunteerOrganisationTransactions.AddRange(
                new VolunteerOrganisationTransaction
                {
                    TenantId = TestData.Tenant1.Id,
                    VolunteerOrganisationId = organisationId,
                    UserId = TestData.AdminUser.Id,
                    Type = "deposit",
                    Amount = 55m,
                    BalanceAfter = 55m,
                    CreatedAt = now.AddDays(-2)
                },
                new VolunteerOrganisationTransaction
                {
                    TenantId = TestData.Tenant1.Id,
                    VolunteerOrganisationId = organisationId,
                    UserId = TestData.AdminUser.Id,
                    Type = "withdrawal",
                    Amount = -12.5m,
                    BalanceAfter = 42.5m,
                    CreatedAt = now.AddDays(-1)
                });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/volunteering/organizations");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        var organisation = json.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == organisationId);
        organisation.GetProperty("org_id").GetInt32().Should().Be(organisationId);
        organisation.GetProperty("name").GetString().Should().Be("Parity Volunteer Hub");
        organisation.GetProperty("org_name").GetString().Should().Be("Parity Volunteer Hub");
        organisation.GetProperty("description").GetString().Should().Be("Volunteer hub exposed through the Laravel React admin API.");
        organisation.GetProperty("contact_email").GetString().Should().Be("volunteer-hub@example.test");
        organisation.GetProperty("website").GetString().Should().Be("https://volunteer.example.test");
        organisation.GetProperty("org_type").GetString().Should().Be("charity");
        organisation.GetProperty("status").GetString().Should().Be("active");
        organisation.GetProperty("balance").GetDecimal().Should().Be(42.5m);
        organisation.GetProperty("member_count").GetInt32().Should().Be(1);
        organisation.GetProperty("volunteer_count").GetInt32().Should().Be(1);
        organisation.GetProperty("opportunity_count").GetInt32().Should().Be(0);
        organisation.GetProperty("total_hours").GetDecimal().Should().Be(0m);
        organisation.GetProperty("total_in").GetDecimal().Should().Be(55m);
        organisation.GetProperty("total_out").GetDecimal().Should().Be(12.5m);
        json.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task BillingSnapshot_UsesSubscriptionPlanStorage()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Explicit Parity Test Plan",
                Price = 12.34m,
                Currency = "EUR",
                Features = "[]",
                IsActive = true,
                IsPublic = false
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();

            db.UserSubscriptions.Add(new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = plan.Id,
                Status = SubscriptionStatus.Active,
                StartedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsGodAsync();

        var response = await Client.GetAsync("/api/v2/admin/super/billing/snapshot");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("active_subscriptions").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("monthly_recurring_revenue").GetDecimal().Should().BeGreaterThanOrEqualTo(12.34m);
        data.TryGetProperty("compatibility", out _).Should().BeFalse();
    }

    [Fact]
    public async Task BillingSubscription_ReturnsLatestLaravelReactSubscriptionDetailsObject()
    {
        int subscriptionId;
        int planId;
        var periodStart = DateTime.UtcNow.AddDays(-4);
        var periodEnd = DateTime.UtcNow.AddDays(26);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Laravel React Subscription Plan",
                Price = 29.99m,
                Currency = "EUR",
                Features = "[]",
                IsActive = true,
                IsPublic = true
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;

            var olderSubscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = plan.Id,
                Status = SubscriptionStatus.Active,
                StartedAt = periodStart.AddMonths(-2),
                CreatedAt = periodStart.AddMonths(-2),
                NextBillingDate = periodEnd.AddMonths(-2)
            };
            var latestSubscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = plan.Id,
                Status = SubscriptionStatus.PastDue,
                StartedAt = periodStart,
                CreatedAt = periodStart.AddMinutes(1),
                NextBillingDate = periodEnd,
                StripeSubscriptionId = "sub_laravel_react_contract"
            };
            db.UserSubscriptions.AddRange(olderSubscription, latestSubscription);
            await db.SaveChangesAsync();
            subscriptionId = latestSubscription.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/billing/subscription");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Object);
        data.GetProperty("id").GetInt32().Should().Be(subscriptionId);
        data.GetProperty("plan_id").GetInt32().Should().Be(planId);
        data.GetProperty("plan_name").GetString().Should().Be("Laravel React Subscription Plan");
        data.GetProperty("plan_tier_level").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("status").GetString().Should().Be("past_due");
        data.GetProperty("billing_interval").GetString().Should().Be("monthly");
        data.GetProperty("current_period_start").GetDateTime().Should().BeCloseTo(periodStart, TimeSpan.FromSeconds(2));
        data.GetProperty("current_period_end").GetDateTime().Should().BeCloseTo(periodEnd, TimeSpan.FromSeconds(2));
        data.GetProperty("trial_ends_at").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("cancel_at_period_end").GetBoolean().Should().BeFalse();
        data.GetProperty("stripe_subscription_id").GetString().Should().Be("sub_laravel_react_contract");
        json.TryGetProperty("meta", out _).Should().BeFalse();
    }

    [Fact]
    public async Task BillingCheckout_ActivatesFreePlanWithLaravelReactEnvelope()
    {
        int planId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Free Laravel React Checkout Plan",
                Description = "Free plan activated without Stripe",
                Price = 0m,
                Currency = "EUR",
                Features = "[]",
                IsActive = true,
                IsPublic = true
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/billing/checkout", new
        {
            plan_id = planId,
            billing_interval = "monthly"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("checkout_url").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("activated").GetBoolean().Should().BeTrue();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var subscription = await verifyDb.UserSubscriptions
            .IgnoreQueryFilters()
            .SingleAsync(s => s.TenantId == TestData.Tenant1.Id && s.PlanId == planId);
        subscription.Status.Should().Be(SubscriptionStatus.Active);
        subscription.StripeSubscriptionId.Should().BeNull();
    }

    [Fact]
    public async Task BillingCheckout_PaidPlanReturnsLaravelReactCheckoutSessionEnvelope()
    {
        int planId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Paid Laravel React Checkout Plan",
                Description = "Paid plan that should return a checkout redirect",
                Price = 19.99m,
                Currency = "EUR",
                Features = "[]",
                IsActive = true,
                IsPublic = true
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/billing/checkout", new
        {
            plan_id = planId,
            billing_interval = "yearly"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("activated").GetBoolean().Should().BeFalse();
        data.GetProperty("checkout_url").GetString().Should().Contain("/admin/billing/checkout-return?session_id=");
        data.GetProperty("session_id").GetString().Should().StartWith("cs_local_");
        json.TryGetProperty("compatibility", out _).Should().BeFalse();

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var activeSubscription = await verifyDb.UserSubscriptions
            .IgnoreQueryFilters()
            .AnyAsync(s => s.TenantId == TestData.Tenant1.Id && s.PlanId == planId && s.Status == SubscriptionStatus.Active);
        activeSubscription.Should().BeFalse();
    }

    [Fact]
    public async Task BillingPortal_WithoutStripeCustomerReturnsLaravelNoSubscriptionError()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsync("/api/v2/admin/billing/portal", null);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = json.GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("code").GetString().Should().Be("NO_SUBSCRIPTION");
        error.GetProperty("message").GetString().Should().Be("No active subscription. Subscribe to a plan first to manage payment methods.");
        json.TryGetProperty("data", out _).Should().BeFalse();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
    }

    [Fact]
    public async Task BillingUpgradeRequest_ReturnsSentAndWritesAuditLog()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/billing/upgrade-request", new
        {
            message = "Please move us to a larger plan."
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").GetProperty("sent").GetBoolean().Should().BeTrue();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var audit = await db.AuditLogs.IgnoreQueryFilters()
            .SingleAsync(a => a.TenantId == TestData.Tenant1.Id && a.Action == "billing.upgrade_requested");
        audit.UserId.Should().Be(TestData.AdminUser.Id);
        audit.EntityType.Should().Be("Tenant");
        audit.EntityId.Should().Be(TestData.Tenant1.Id);
        audit.NewValues.Should().Contain("Please move us to a larger plan.");

        var compatibilityRows = await db.CompatibilityAuditEntries.IgnoreQueryFilters()
            .CountAsync(a => a.TenantId == TestData.Tenant1.Id && a.Endpoint == "/api/v2/admin/billing/upgrade-request");
        compatibilityRows.Should().Be(0);
    }

    [Fact]
    public async Task BillingInvoices_ReturnsSubscriptionBackedInvoices()
    {
        int subscriptionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Explicit Invoice Test Plan",
                Price = 45.67m,
                Currency = "EUR",
                Features = "[]",
                IsActive = true,
                IsPublic = false
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();

            var subscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = plan.Id,
                Status = SubscriptionStatus.Active,
                StartedAt = DateTime.UtcNow.AddDays(-3),
                NextBillingDate = DateTime.UtcNow.AddDays(27)
            };
            db.UserSubscriptions.Add(subscription);
            await db.SaveChangesAsync();
            subscriptionId = subscription.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/billing/invoices");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").EnumerateArray()
            .Should().Contain(item =>
                item.GetProperty("subscription_id").GetInt32() == subscriptionId &&
                item.GetProperty("number").GetString() == $"SUB-{subscriptionId:D6}" &&
                item.GetProperty("date").ValueKind == JsonValueKind.String &&
                item.GetProperty("amount").GetDecimal() == 45.67m &&
                item.GetProperty("currency").GetString() == "EUR" &&
                item.GetProperty("status").GetString() == "paid" &&
                item.GetProperty("hosted_invoice_url").ValueKind == JsonValueKind.Null &&
                item.GetProperty("invoice_pdf").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task GdprConsentTypes_ReturnsPersistedConsentTypes()
    {
        var key = "explicit-parity-" + Guid.NewGuid().ToString("N");
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.GdprConsentTypes.Add(new GdprConsentType
            {
                TenantId = TestData.Tenant1.Id,
                Key = key,
                Name = "Explicit Parity Consent",
                Description = "Test consent type",
                IsRequired = false,
                IsActive = true
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/enterprise/gdpr/consent-types");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").EnumerateArray()
            .Select(item => item.GetProperty("slug").GetString())
            .Should().Contain(key);
    }

    [Fact]
    public async Task FederationTopicSubscriptions_PersistInTenantConfig()
    {
        await AuthenticateAsAdminAsync();

        var put = await Client.PutAsJsonAsync("/api/v2/admin/federation/topics/mine", new
        {
            topics = new[] { "listings.shared", "webhooks.delivery" },
            delivery_enabled = true
        });

        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var mine = await Client.GetAsync("/api/v2/admin/federation/topics/mine");
        mine.StatusCode.Should().Be(HttpStatusCode.OK);
        var mineJson = await mine.Content.ReadFromJsonAsync<JsonElement>();
        mineJson.GetProperty("data").GetProperty("topics").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Contain(new[] { "listings.shared", "webhooks.delivery" });

        var topics = await Client.GetAsync("/api/v2/admin/federation/topics");
        topics.StatusCode.Should().Be(HttpStatusCode.OK);
        var topicsJson = await topics.Content.ReadFromJsonAsync<JsonElement>();
        topicsJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == "listings.shared")
            .GetProperty("subscribed").GetBoolean().Should().BeTrue();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var config = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == "admin_explicit.federation.topic_subscriptions");
        config.Value.Should().Contain("webhooks.delivery");
    }

    [Fact]
    public async Task FederationCreditAgreementsV2_CreateListAndActionUseLaravelReactContract()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/federation/credit-agreements");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        initialJson.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var create = await Client.PostAsJsonAsync("/api/v2/admin/federation/credit-agreements", new
        {
            partner_tenant_id = TestData.Tenant2.Id,
            exchange_rate = 1.25m,
            monthly_limit = 250
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var created = createJson.GetProperty("data");
        created.GetProperty("from_tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        created.GetProperty("to_tenant_id").GetInt32().Should().Be(TestData.Tenant2.Id);
        created.GetProperty("exchange_rate").GetDecimal().Should().Be(1.25m);
        created.GetProperty("max_monthly_credits").GetDecimal().Should().Be(250m);
        created.GetProperty("monthly_limit").GetDecimal().Should().Be(250m);
        created.GetProperty("status").GetString().Should().Be("pending");
        var agreementId = created.GetProperty("id").GetInt32();

        var list = await Client.GetAsync("/api/v2/admin/federation/credit-agreements");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == agreementId);
        listed.GetProperty("from_tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("to_tenant_name").GetString().Should().Be(TestData.Tenant2.Name);
        listed.GetProperty("to_tenant_slug").GetString().Should().Be(TestData.Tenant2.Slug);

        var approve = await Client.PostAsJsonAsync($"/api/v2/admin/federation/credit-agreements/{agreementId}/approve", new { });

        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        var approveJson = await approve.Content.ReadFromJsonAsync<JsonElement>();
        approveJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var afterApprove = await Client.GetAsync("/api/v2/admin/federation/credit-agreements");
        var afterApproveJson = await afterApprove.Content.ReadFromJsonAsync<JsonElement>();
        afterApproveJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == agreementId)
            .GetProperty("status").GetString().Should().Be("active");
    }

    [Fact]
    public async Task FederationWebhooks_PersistCrudAndTestLogs()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/federation/webhooks", new
        {
            name = "Parity federation webhook",
            url = "https://example.test/federation",
            events = new[] { "listings.shared" }
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = createdJson.GetProperty("data").GetProperty("id").GetInt32();

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/federation/webhooks/{id}", new
        {
            name = "Updated parity federation webhook",
            enabled = false
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await Client.GetAsync("/api/v2/admin/federation/webhooks");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var webhook = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == id);
        webhook.GetProperty("name").GetString().Should().Be("Updated parity federation webhook");
        // enabled:false maps to the Paused state, which renders as "paused".
        webhook.GetProperty("status").GetString().Should().Be("paused");

        var test = await Client.PostAsJsonAsync($"/api/v2/admin/federation/webhooks/{id}/test", new { sample = true });
        test.StatusCode.Should().Be(HttpStatusCode.OK);

        var logs = await Client.GetAsync($"/api/v2/admin/federation/webhooks/{id}/logs");
        logs.StatusCode.Should().Be(HttpStatusCode.OK);
        var logsJson = await logs.Content.ReadFromJsonAsync<JsonElement>();
        logsJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("action").GetString() == "test");

        var delete = await Client.DeleteAsync($"/api/v2/admin/federation/webhooks/{id}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);

        var afterDelete = await Client.GetAsync("/api/v2/admin/federation/webhooks");
        var afterDeleteJson = await afterDelete.Content.ReadFromJsonAsync<JsonElement>();
        afterDeleteJson.GetProperty("data").EnumerateArray()
            .Should().NotContain(item => item.GetProperty("id").GetInt32() == id);
    }

    [Fact]
    public async Task MemberPremiumAdminTiers_ReturnsLaravelReactTierListEnvelope()
    {
        var now = DateTime.UtcNow;
        int activePlanId;
        int inactivePlanId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id
                    && (p.Name == "Admin Member Premium Tier" || p.Name == "Admin Hidden Premium Tier"))
                .ToListAsync();
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();

            var activePlan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Admin Member Premium Tier",
                Description = "Admin tier visible to Laravel React",
                Price = 8.75m,
                Currency = "EUR",
                Features = """["priority_support","premium_badge"]""",
                IsActive = true,
                IsPublic = true,
                CreatedAt = now.AddDays(-5),
                UpdatedAt = now.AddDays(-1)
            };
            var inactivePlan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Admin Hidden Premium Tier",
                Description = "Inactive admin tier still visible to admins",
                Price = 21.00m,
                Currency = "EUR",
                Features = """["archive_access"]""",
                IsActive = false,
                IsPublic = false,
                CreatedAt = now.AddDays(-4),
                UpdatedAt = now.AddDays(-1)
            };
            db.SubscriptionPlans.AddRange(activePlan, inactivePlan);
            await db.SaveChangesAsync();

            db.UserSubscriptions.Add(new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = activePlan.Id,
                Status = SubscriptionStatus.Active,
                StartedAt = now.AddDays(-2),
                NextBillingDate = now.AddMonths(1),
                CreatedAt = now.AddDays(-2),
                UpdatedAt = now.AddDays(-1)
            });
            await db.SaveChangesAsync();

            activePlanId = activePlan.Id;
            inactivePlanId = inactivePlan.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/member-premium/tiers");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var tiers = json.GetProperty("data").GetProperty("tiers").EnumerateArray().ToList();
        var activeTier = tiers.Single(t => t.GetProperty("id").GetInt32() == activePlanId);
        activeTier.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        activeTier.GetProperty("slug").GetString().Should().Be("admin-member-premium-tier");
        activeTier.GetProperty("name").GetString().Should().Be("Admin Member Premium Tier");
        activeTier.GetProperty("description").GetString().Should().Be("Admin tier visible to Laravel React");
        activeTier.GetProperty("monthly_price_cents").GetInt32().Should().Be(875);
        activeTier.GetProperty("yearly_price_cents").GetInt32().Should().Be(10500);
        activeTier.GetProperty("stripe_price_id_monthly").ValueKind.Should().Be(JsonValueKind.Null);
        activeTier.GetProperty("stripe_price_id_yearly").ValueKind.Should().Be(JsonValueKind.Null);
        activeTier.GetProperty("stripe_price_account_id").ValueKind.Should().Be(JsonValueKind.Null);
        activeTier.GetProperty("features").EnumerateArray().Select(v => v.GetString())
            .Should().Equal("priority_support", "premium_badge");
        activeTier.GetProperty("sort_order").ValueKind.Should().Be(JsonValueKind.Number);
        activeTier.GetProperty("is_active").GetBoolean().Should().BeTrue();
        activeTier.GetProperty("active_subscriber_count").GetInt32().Should().Be(1);

        var inactiveTier = tiers.Single(t => t.GetProperty("id").GetInt32() == inactivePlanId);
        inactiveTier.GetProperty("is_active").GetBoolean().Should().BeFalse();
        inactiveTier.GetProperty("active_subscriber_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task MemberPremiumAdminTierDetail_ReturnsLaravelReactTierEnvelope()
    {
        var createdAt = new DateTime(2026, 7, 1, 10, 15, 0, DateTimeKind.Utc);
        var updatedAt = new DateTime(2026, 7, 2, 11, 30, 0, DateTimeKind.Utc);
        int planId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id && p.Name == "Admin Detail Premium Tier")
                .ToListAsync();
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();

            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Admin Detail Premium Tier",
                Description = "Admin detail tier from Laravel React contract",
                Price = 13.40m,
                Currency = "EUR",
                Features = """["detail_feature","priority_support"]""",
                IsActive = true,
                IsPublic = false,
                CreatedAt = createdAt,
                UpdatedAt = updatedAt
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/v2/admin/member-premium/tiers/{planId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var tier = json.GetProperty("data").GetProperty("tier");
        tier.GetProperty("id").GetInt32().Should().Be(planId);
        tier.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        tier.GetProperty("slug").GetString().Should().Be("admin-detail-premium-tier");
        tier.GetProperty("name").GetString().Should().Be("Admin Detail Premium Tier");
        tier.GetProperty("description").GetString().Should().Be("Admin detail tier from Laravel React contract");
        tier.GetProperty("monthly_price_cents").GetInt32().Should().Be(1340);
        tier.GetProperty("yearly_price_cents").GetInt32().Should().Be(16080);
        tier.GetProperty("stripe_price_id_monthly").ValueKind.Should().Be(JsonValueKind.Null);
        tier.GetProperty("stripe_price_id_yearly").ValueKind.Should().Be(JsonValueKind.Null);
        tier.GetProperty("stripe_price_account_id").ValueKind.Should().Be(JsonValueKind.Null);
        tier.GetProperty("features").EnumerateArray().Select(v => v.GetString())
            .Should().Equal("detail_feature", "priority_support");
        tier.GetProperty("sort_order").ValueKind.Should().Be(JsonValueKind.Number);
        tier.GetProperty("is_active").GetBoolean().Should().BeTrue();
        tier.GetProperty("created_at").GetDateTime().Should().Be(createdAt);
        tier.GetProperty("updated_at").GetDateTime().Should().Be(updatedAt);
    }

    [Fact]
    public async Task MemberPremiumAdminTierDetail_ReturnsLaravelNotFoundEnvelope()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/member-premium/tiers/99999999");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("error").GetString().Should().Be("TIER_NOT_FOUND");
    }

    [Fact]
    public async Task MemberPremiumAdminTierCreate_ReturnsLaravelReactCreatedTierAndPersistsMetadata()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id && p.Name == "Founding Circle")
                .ToListAsync();
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/tiers", new
        {
            slug = "founding-circle",
            name = "Founding Circle",
            description = "Founding supporter recognition tier",
            monthly_price_cents = 1234,
            yearly_price_cents = 12000,
            features = new[] { "founder_badge", "priority_support" },
            sort_order = 7,
            is_active = false
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var tier = json.GetProperty("data").GetProperty("tier");
        var id = tier.GetProperty("id").GetInt32();
        tier.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        tier.GetProperty("slug").GetString().Should().Be("founding-circle");
        tier.GetProperty("name").GetString().Should().Be("Founding Circle");
        tier.GetProperty("description").GetString().Should().Be("Founding supporter recognition tier");
        tier.GetProperty("monthly_price_cents").GetInt32().Should().Be(1234);
        tier.GetProperty("yearly_price_cents").GetInt32().Should().Be(12000);
        tier.GetProperty("features").EnumerateArray().Select(v => v.GetString())
            .Should().Equal("founder_badge", "priority_support");
        tier.GetProperty("sort_order").GetInt32().Should().Be(7);
        tier.GetProperty("is_active").GetBoolean().Should().BeFalse();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = await db.SubscriptionPlans.IgnoreQueryFilters().SingleAsync(p => p.Id == id);
            plan.TenantId.Should().Be(TestData.Tenant1.Id);
            plan.Price.Should().Be(12.34m);
            plan.IsActive.Should().BeFalse();
            plan.Features.Should().Contain("founder_badge");
        }

        var detailResponse = await Client.GetAsync($"/api/v2/admin/member-premium/tiers/{id}");
        detailResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detailResponse.Content.ReadFromJsonAsync<JsonElement>();
        var detailTier = detailJson.GetProperty("data").GetProperty("tier");
        detailTier.GetProperty("slug").GetString().Should().Be("founding-circle");
        detailTier.GetProperty("yearly_price_cents").GetInt32().Should().Be(12000);
        detailTier.GetProperty("sort_order").GetInt32().Should().Be(7);
    }

    [Fact]
    public async Task MemberPremiumAdminTierUpdate_ReturnsLaravelReactTierAndPersistsMetadata()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id
                    && (p.Name == "Steward Circle" || p.Name == "Steward Circle Plus"))
                .ToListAsync();
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/tiers", new
        {
            slug = "steward-circle",
            name = "Steward Circle",
            monthly_price_cents = 2500,
            yearly_price_cents = 24000,
            features = new[] { "old_feature" },
            sort_order = 3,
            is_active = true
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = createJson.GetProperty("data").GetProperty("tier").GetProperty("id").GetInt32();

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/member-premium/tiers/{id}", new
        {
            slug = "steward-circle-plus",
            name = "Steward Circle Plus",
            description = "Updated stewardship recognition",
            monthly_price_cents = 3000,
            yearly_price_cents = 30000,
            features = new[] { "new_feature", "priority_support" },
            sort_order = 4,
            is_active = false
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var tier = updateJson.GetProperty("data").GetProperty("tier");
        tier.GetProperty("id").GetInt32().Should().Be(id);
        tier.GetProperty("slug").GetString().Should().Be("steward-circle-plus");
        tier.GetProperty("name").GetString().Should().Be("Steward Circle Plus");
        tier.GetProperty("description").GetString().Should().Be("Updated stewardship recognition");
        tier.GetProperty("monthly_price_cents").GetInt32().Should().Be(3000);
        tier.GetProperty("yearly_price_cents").GetInt32().Should().Be(30000);
        tier.GetProperty("features").EnumerateArray().Select(v => v.GetString())
            .Should().Equal("new_feature", "priority_support");
        tier.GetProperty("sort_order").GetInt32().Should().Be(4);
        tier.GetProperty("is_active").GetBoolean().Should().BeFalse();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = await db.SubscriptionPlans.IgnoreQueryFilters().SingleAsync(p => p.Id == id);
            plan.Name.Should().Be("Steward Circle Plus");
            plan.Description.Should().Be("Updated stewardship recognition");
            plan.Price.Should().Be(30.00m);
            plan.IsActive.Should().BeFalse();
            plan.Features.Should().Contain("new_feature");
        }

        var detail = await Client.GetAsync($"/api/v2/admin/member-premium/tiers/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var detailTier = detailJson.GetProperty("data").GetProperty("tier");
        detailTier.GetProperty("slug").GetString().Should().Be("steward-circle-plus");
        detailTier.GetProperty("yearly_price_cents").GetInt32().Should().Be(30000);
        detailTier.GetProperty("sort_order").GetInt32().Should().Be(4);
    }

    [Fact]
    public async Task MemberPremiumAdminTierDelete_ReturnsLaravelDeletedEnvelopeAndProtectsActiveSubscribers()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id
                    && (p.Name == "Archive Circle" || p.Name == "Protected Circle"))
                .ToListAsync();
            var stalePlanIds = stalePlans.Select(p => p.Id).ToList();
            var staleSubscriptions = await db.UserSubscriptions
                .Where(s => s.TenantId == TestData.Tenant1.Id && stalePlanIds.Contains(s.PlanId))
                .ToListAsync();
            db.UserSubscriptions.RemoveRange(staleSubscriptions);
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var protectedCreate = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/tiers", new
        {
            slug = "protected-circle",
            name = "Protected Circle",
            monthly_price_cents = 500,
            yearly_price_cents = 5000,
            features = Array.Empty<string>(),
            sort_order = 1,
            is_active = true
        });
        protectedCreate.StatusCode.Should().Be(HttpStatusCode.Created);
        var protectedJson = await protectedCreate.Content.ReadFromJsonAsync<JsonElement>();
        var protectedId = protectedJson.GetProperty("data").GetProperty("tier").GetProperty("id").GetInt32();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserSubscriptions.Add(new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = protectedId,
                Status = SubscriptionStatus.Active,
                StartedAt = DateTime.UtcNow.AddDays(-3),
                NextBillingDate = DateTime.UtcNow.AddDays(27),
                Notes = "member-premium-delete-protected",
                CreatedAt = DateTime.UtcNow.AddDays(-3),
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            });
            await db.SaveChangesAsync();
        }

        var protectedDelete = await Client.DeleteAsync($"/api/v2/admin/member-premium/tiers/{protectedId}");
        protectedDelete.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var protectedDeleteJson = await protectedDelete.Content.ReadFromJsonAsync<JsonElement>();
        protectedDeleteJson.GetProperty("error").GetString().Should().Be("DELETE_FAILED");
        protectedDeleteJson.GetProperty("message").GetString()
            .Should().Contain("Cannot delete a tier with active subscribers");

        var removableCreate = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/tiers", new
        {
            slug = "archive-circle",
            name = "Archive Circle",
            monthly_price_cents = 700,
            yearly_price_cents = 7000,
            features = new[] { "archive_badge" },
            sort_order = 2,
            is_active = false
        });
        removableCreate.StatusCode.Should().Be(HttpStatusCode.Created);
        var removableJson = await removableCreate.Content.ReadFromJsonAsync<JsonElement>();
        var removableId = removableJson.GetProperty("data").GetProperty("tier").GetProperty("id").GetInt32();

        var delete = await Client.DeleteAsync($"/api/v2/admin/member-premium/tiers/{removableId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.SubscriptionPlans.IgnoreQueryFilters().AnyAsync(p => p.Id == removableId))
                .Should().BeFalse();
        }
    }

    [Fact]
    public async Task MemberPremiumAdminSubscribers_ReturnsLaravelReactPaginatedRows()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id && p.Name == "Subscriber Circle")
                .ToListAsync();
            var stalePlanIds = stalePlans.Select(p => p.Id).ToList();
            var staleSubscriptions = await db.UserSubscriptions
                .Where(s => s.TenantId == TestData.Tenant1.Id && stalePlanIds.Contains(s.PlanId))
                .ToListAsync();
            db.UserSubscriptions.RemoveRange(staleSubscriptions);
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/tiers", new
        {
            slug = "subscriber-circle",
            name = "Subscriber Circle",
            monthly_price_cents = 900,
            yearly_price_cents = 9000,
            features = new[] { "subscriber_badge" },
            sort_order = 5,
            is_active = true
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var tierId = createJson.GetProperty("data").GetProperty("tier").GetProperty("id").GetInt32();
        int activeSubscriptionId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var activeSubscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = tierId,
                Status = SubscriptionStatus.Active,
                StartedAt = DateTime.UtcNow.AddDays(-10),
                NextBillingDate = DateTime.UtcNow.AddDays(20),
                Notes = "member-premium-subscriber-list-active",
                CreatedAt = DateTime.UtcNow.AddDays(-10),
                UpdatedAt = DateTime.UtcNow.AddDays(-2)
            };
            var cancelledSubscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = tierId,
                Status = SubscriptionStatus.Cancelled,
                StartedAt = DateTime.UtcNow.AddDays(-30),
                CancelledAt = DateTime.UtcNow.AddDays(-1),
                Notes = "member-premium-subscriber-list-cancelled",
                CreatedAt = DateTime.UtcNow.AddDays(-30),
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            };
            db.UserSubscriptions.AddRange(activeSubscription, cancelledSubscription);
            await db.SaveChangesAsync();
            activeSubscriptionId = activeSubscription.Id;
        }

        var response = await Client.GetAsync("/api/v2/admin/member-premium/subscribers?page=1&per_page=1&status=active");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("total").GetInt32().Should().Be(1);
        data.GetProperty("page").GetInt32().Should().Be(1);
        data.GetProperty("per_page").GetInt32().Should().Be(1);
        var row = data.GetProperty("rows").EnumerateArray().Single();
        row.GetProperty("id").GetInt32().Should().Be(activeSubscriptionId);
        row.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        row.GetProperty("tier_id").GetInt32().Should().Be(tierId);
        row.GetProperty("status").GetString().Should().Be("active");
        row.GetProperty("billing_interval").GetString().Should().Be("monthly");
        row.GetProperty("tier_name").GetString().Should().Be("Subscriber Circle");
        row.GetProperty("tier_slug").GetString().Should().Be("subscriber-circle");
        row.GetProperty("email").GetString().Should().Be(TestData.MemberUser.Email);
        row.GetProperty("user_name").GetString().Should().NotBeNullOrWhiteSpace();
        row.GetProperty("first_name").GetString().Should().NotBeNullOrWhiteSpace();
        row.GetProperty("current_period_end").GetDateTime().Should().BeAfter(DateTime.UtcNow);
        row.GetProperty("canceled_at").ValueKind.Should().Be(JsonValueKind.Null);
        row.GetProperty("created_at").ValueKind.Should().Be(JsonValueKind.String);
    }

    [Fact]
    public async Task MemberPremiumAdminTierSyncStripe_ReturnsLaravelReactTierAndPersistsPriceMetadata()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id && p.Name == "Stripe Sync Circle")
                .ToListAsync();
            db.SubscriptionPlans.RemoveRange(stalePlans);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/tiers", new
        {
            slug = "stripe-sync-circle",
            name = "Stripe Sync Circle",
            description = "Stripe sync compatibility tier",
            monthly_price_cents = 1900,
            yearly_price_cents = 19000,
            features = new[] { "stripe_sync_badge" },
            sort_order = 6,
            is_active = true
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = createJson.GetProperty("data").GetProperty("tier").GetProperty("id").GetInt32();

        var response = await Client.PostAsJsonAsync($"/api/v2/admin/member-premium/tiers/{id}/sync-stripe", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var tier = json.GetProperty("data").GetProperty("tier");
        tier.GetProperty("id").GetInt32().Should().Be(id);
        tier.GetProperty("slug").GetString().Should().Be("stripe-sync-circle");
        tier.GetProperty("stripe_price_id_monthly").GetString().Should().StartWith("price_local_");
        tier.GetProperty("stripe_price_id_yearly").GetString().Should().StartWith("price_local_");
        tier.GetProperty("stripe_price_account_id").GetString().Should().Be("platform_default");

        var detail = await Client.GetAsync($"/api/v2/admin/member-premium/tiers/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var detailTier = detailJson.GetProperty("data").GetProperty("tier");
        detailTier.GetProperty("stripe_price_id_monthly").GetString().Should().Be(tier.GetProperty("stripe_price_id_monthly").GetString());
        detailTier.GetProperty("stripe_price_id_yearly").GetString().Should().Be(tier.GetProperty("stripe_price_id_yearly").GetString());
        detailTier.GetProperty("stripe_price_account_id").GetString().Should().Be("platform_default");
    }

    [Fact]
    public async Task MemberPremiumSettings_PersistStripeConnectAccountAndReturnLaravelEnvelope()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/member-premium/settings");
        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var initialSettings = initialJson.GetProperty("data").GetProperty("settings");
        initialSettings.GetProperty("stripe_connect_account_id").GetString().Should().BeEmpty();
        initialSettings.GetProperty("payment_route").GetString().Should().Be("platform_default");
        initialSettings.GetProperty("configured_payment_route").GetString().Should().Be("platform_default");
        initialSettings.GetProperty("account_status").GetProperty("state").GetString().Should().Be("not_connected");

        var update = await Client.PutAsJsonAsync("/api/v2/admin/member-premium/settings", new
        {
            stripe_connect_account_id = "acct_testTenant123"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        var settings = updateJson.GetProperty("data").GetProperty("settings");
        settings.GetProperty("stripe_connect_account_id").GetString().Should().Be("acct_testTenant123");
        settings.GetProperty("configured_payment_route").GetString().Should().Be("tenant_connect");
        settings.GetProperty("payment_route").GetString().Should().Be("platform_default");
        settings.GetProperty("fallback_reason").GetString().Should().Be("stripe_connect_not_ready");

        var reload = await Client.GetAsync("/api/v2/admin/member-premium/settings");
        var reloadJson = await reload.Content.ReadFromJsonAsync<JsonElement>();
        reloadJson.GetProperty("data").GetProperty("settings")
            .GetProperty("stripe_connect_account_id").GetString().Should().Be("acct_testTenant123");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == "donations.stripe_connect_account_id");
        stored.Value.Should().Be("acct_testTenant123");
    }

    [Fact]
    public async Task MemberPremiumSettings_RejectInvalidStripeConnectAccount()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync("/api/v2/admin/member-premium/settings", new
        {
            stripe_connect_account_id = "not-a-connect-account"
        });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("error").GetString().Should().Be("VALIDATION_ERROR");
        json.GetProperty("field").GetString().Should().Be("stripe_connect_account_id");
    }

    [Fact]
    public async Task MemberPremiumConnectOnboarding_ReturnsSettingsAndCompatibilityUrl()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/member-premium/connect/onboarding", new
        {
            return_url = "https://app.example.test/admin/member-premium?stripe_connect=return",
            refresh_url = "https://app.example.test/admin/member-premium?stripe_connect=refresh"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("settings").GetProperty("stripe_connect_account_id").GetString()
            .Should().StartWith("acct_");
        data.GetProperty("onboarding_url").GetString()
            .Should().StartWith("https://connect.stripe.com/setup/");
    }

    [Fact]
    public async Task MemberPremiumFinance_ReturnsLaravelOverviewAndDisputeEnvelopes()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.MoneyDonations.AddRange(
                new MoneyDonation
                {
                    TenantId = TestData.Tenant1.Id,
                    DonorUserId = TestData.MemberUser.Id,
                    DonorDisplayName = "Active donor",
                    DonorEmail = "donor@example.test",
                    AmountMinorUnits = 2500,
                    Currency = "GBP",
                    Status = MoneyDonationStatus.Succeeded,
                    CompletedAt = DateTime.UtcNow.AddDays(-1),
                    CreatedAt = DateTime.UtcNow.AddDays(-1)
                },
                new MoneyDonation
                {
                    TenantId = TestData.Tenant1.Id,
                    DonorDisplayName = "Pending donor",
                    DonorEmail = "pending@example.test",
                    AmountMinorUnits = 1200,
                    Currency = "GBP",
                    Status = MoneyDonationStatus.Pending,
                    CreatedAt = DateTime.UtcNow
                },
                new MoneyDonation
                {
                    TenantId = TestData.Tenant1.Id,
                    DonorDisplayName = "Refunded donor",
                    DonorEmail = "refunded@example.test",
                    AmountMinorUnits = 900,
                    Currency = "GBP",
                    Status = MoneyDonationStatus.Refunded,
                    CreatedAt = DateTime.UtcNow
                });
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = "donations.disputes",
                Value = """
                    [
                      {
                        "id": 7,
                        "stripe_dispute_id": "dp_test_123",
                        "payment_intent_id": "pi_test_123",
                        "amount": 2500,
                        "currency": "gbp",
                        "status": "needs_response",
                        "reason": "fraudulent",
                        "evidence_due_at": null,
                        "payment_route": "platform_default",
                        "stripe_account_id": null,
                        "created_at": "2026-07-05T12:00:00Z"
                      }
                    ]
                    """
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var overviewResponse = await Client.GetAsync("/api/v2/admin/member-premium/finance/overview");
        overviewResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var overviewJson = await overviewResponse.Content.ReadFromJsonAsync<JsonElement>();
        var overview = overviewJson.GetProperty("data").GetProperty("overview");
        overview.GetProperty("totals").GetProperty("completed_cents").GetInt64().Should().BeGreaterThanOrEqualTo(2500);
        overview.GetProperty("totals").GetProperty("pending_cents").GetInt64().Should().BeGreaterThanOrEqualTo(1200);
        overview.GetProperty("routing").GetProperty("platform_fallback_count").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var disputesResponse = await Client.GetAsync("/api/v2/admin/member-premium/finance/disputes?limit=1");
        disputesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var disputesJson = await disputesResponse.Content.ReadFromJsonAsync<JsonElement>();
        var dispute = disputesJson.GetProperty("data").GetProperty("items").EnumerateArray().Single();
        dispute.GetProperty("stripe_dispute_id").GetString().Should().Be("dp_test_123");
    }

    [Fact]
    public async Task MemberPremiumFinanceExports_ReturnCsvDownloads()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = TestData.Tenant1.Id,
                DonorUserId = TestData.MemberUser.Id,
                DonorDisplayName = "Receipt donor",
                DonorEmail = "receipt@example.test",
                AmountMinorUnits = 3456,
                Currency = "GBP",
                Status = MoneyDonationStatus.Succeeded,
                CompletedAt = new DateTime(2026, 3, 14, 9, 30, 0, DateTimeKind.Utc),
                CreatedAt = new DateTime(2026, 3, 14, 9, 30, 0, DateTimeKind.Utc)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var giftAid = await Client.GetAsync("/api/v2/admin/member-premium/finance/gift-aid-export");
        giftAid.StatusCode.Should().Be(HttpStatusCode.OK);
        giftAid.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        (await giftAid.Content.ReadAsStringAsync()).Should().Contain("donation_id,donor_name,donor_email,amount,currency");

        var receipts = await Client.GetAsync("/api/v2/admin/member-premium/finance/annual-receipts?year=2026");
        receipts.StatusCode.Should().Be(HttpStatusCode.OK);
        receipts.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        var body = await receipts.Content.ReadAsStringAsync();
        body.Should().Contain("donation_id,user_id,donor_name,donor_email,amount,currency,status");
        body.Should().Contain("Receipt donor");
        body.Should().Contain("34.56");
    }

    [Fact]
    public async Task SupportReports_ReturnLaravelListDetailStatsAndAssignees()
    {
        await SeedSupportReportsAsync();
        await AuthenticateAsAdminAsync();

        var list = await Client.GetAsync("/api/v2/admin/support-reports?status=open&impact=blocked&search=checkout&page=1&limit=10");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var report = listJson.GetProperty("data").EnumerateArray().Single();
        report.GetProperty("reference").GetString().Should().Be("NXR-260705-BLOCK1");
        report.GetProperty("summary").GetString().Should().Contain("Checkout");
        report.TryGetProperty("diagnostics", out _).Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("total_pages").GetInt32().Should().Be(1);

        var stats = await Client.GetAsync("/api/v2/admin/support-reports/stats");
        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsJson = await stats.Content.ReadFromJsonAsync<JsonElement>();
        var statsData = statsJson.GetProperty("data");
        statsData.GetProperty("total").GetInt32().Should().Be(2);
        statsData.GetProperty("open").GetInt32().Should().Be(1);
        statsData.GetProperty("triaged").GetInt32().Should().Be(1);
        statsData.GetProperty("blocked").GetInt32().Should().Be(1);
        statsData.GetProperty("major").GetInt32().Should().Be(1);
        statsData.GetProperty("unassigned").GetInt32().Should().Be(1);

        var assignees = await Client.GetAsync("/api/v2/admin/support-reports/assignees");
        assignees.StatusCode.Should().Be(HttpStatusCode.OK);
        var assigneesJson = await assignees.Content.ReadFromJsonAsync<JsonElement>();
        assigneesJson.GetProperty("data").GetProperty("assignees").EnumerateArray()
            .Should().Contain(item =>
                item.GetProperty("id").GetInt32() == TestData.AdminUser.Id &&
                item.GetProperty("name").GetString() == "Admin User" &&
                item.GetProperty("email").GetString() == "admin@test.com" &&
                item.GetProperty("role").GetString() == "admin");

        var detail = await Client.GetAsync("/api/v2/admin/support-reports/101");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("diagnostics").GetProperty("browser").GetString().Should().Be("chromium");
        detailData.GetProperty("reporter").GetProperty("email").GetString().Should().Be("member@test.com");
    }

    [Fact]
    public async Task SupportReports_UpdatePersistsLaravelFields()
    {
        await SeedSupportReportsAsync();
        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync("/api/v2/admin/support-reports/101", new
        {
            status = "resolved",
            assigned_user_id = TestData.AdminUser.Id,
            triage_notes = "Reproduced and linked to Sentry.",
            sentry_issue_url = "https://sentry.example.test/issues/123"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await update.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("status").GetString().Should().Be("resolved");
        data.GetProperty("assigned_user_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        data.GetProperty("triage_notes").GetString().Should().Be("Reproduced and linked to Sentry.");
        data.GetProperty("sentry_issue_url").GetString().Should().Be("https://sentry.example.test/issues/123");
        data.GetProperty("resolved_at").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("assignee").GetProperty("name").GetString().Should().Be("Admin User");

        var reload = await Client.GetAsync("/api/v2/admin/support-reports/101");
        var reloadJson = await reload.Content.ReadFromJsonAsync<JsonElement>();
        reloadJson.GetProperty("data").GetProperty("status").GetString().Should().Be("resolved");
    }

    [Fact]
    public async Task CompatibilityOnlyPost_PersistsCompatibilityRecord()
    {
        await AuthenticateAsAdminAsync();

        const string endpoint = "/api/v2/admin/agents/42/run-now";
        var response = await Client.PostAsJsonAsync(endpoint, new
        {
            reason = "explicit parity test"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").GetProperty("status").GetString().Should().Be("recorded");
        json.GetProperty("compatibility").GetProperty("side_effect").GetString().Should().Be("recorded_only");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        // Compatibility writes now land in the typed CompatibilityAuditEntry
        // table, not TenantConfig (CLAUDE.md path-to-1000 item 12 — the legacy
        // TenantConfig JSON dual-write was removed).
        var audit = await db.CompatibilityAuditEntries.IgnoreQueryFilters()
            .Where(e => e.TenantId == TestData.Tenant1.Id
                && e.Endpoint == endpoint)
            .OrderByDescending(e => e.Id)
            .FirstAsync();
        audit.RequestBody.Should().Contain("explicit parity test");
    }

    private User NewAdminParityUser(string prefix, int? tenantId = null, bool isActive = true)
        => new()
        {
            TenantId = tenantId ?? TestData.Tenant1.Id,
            Email = $"{prefix}-{Guid.NewGuid():N}@example.test",
            PasswordHash = TestDataSeeder.TestPasswordHash,
            FirstName = "Admin",
            LastName = "Parity",
            Role = "member",
            IsActive = isActive,
            CreatedAt = DateTime.UtcNow.AddDays(-3)
        };

    private static bool HasProperty(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out _);

    private async Task SeedSupportReportsAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = TestData.Tenant1.Id,
            Key = "admin_explicit.support_reports",
            Value = JsonSerializer.Serialize(new object[]
            {
                new Dictionary<string, object?>
                {
                    ["id"] = 101,
                    ["tenant_id"] = TestData.Tenant1.Id,
                    ["user_id"] = TestData.MemberUser.Id,
                    ["assigned_user_id"] = null,
                    ["reference"] = "NXR-260705-BLOCK1",
                    ["source"] = "in_app",
                    ["summary"] = "Checkout blocks card payment",
                    ["description"] = "The checkout submit button never completes.",
                    ["impact"] = "blocked",
                    ["status"] = "open",
                    ["module"] = "donations",
                    ["route"] = "/admin/member-premium",
                    ["page_url"] = "https://app.example.test/admin/member-premium",
                    ["sentry_event_id"] = null,
                    ["sentry_issue_url"] = null,
                    ["diagnostics"] = new Dictionary<string, object?>
                    {
                        ["browser"] = "chromium",
                        ["viewport"] = "1440x900"
                    },
                    ["user_agent"] = "Playwright",
                    ["triage_notes"] = null,
                    ["triaged_at"] = null,
                    ["resolved_at"] = null,
                    ["closed_at"] = null,
                    ["created_at"] = "2026-07-05T09:00:00Z",
                    ["updated_at"] = "2026-07-05T09:00:00Z"
                },
                new Dictionary<string, object?>
                {
                    ["id"] = 102,
                    ["tenant_id"] = TestData.Tenant1.Id,
                    ["user_id"] = TestData.MemberUser.Id,
                    ["assigned_user_id"] = TestData.AdminUser.Id,
                    ["reference"] = "NXR-260705-MAJOR2",
                    ["source"] = "in_app",
                    ["summary"] = "Profile save is slow",
                    ["description"] = "Saving profile preferences takes several seconds.",
                    ["impact"] = "major",
                    ["status"] = "triaged",
                    ["module"] = "profile",
                    ["route"] = "/profile/settings",
                    ["page_url"] = "https://app.example.test/profile/settings",
                    ["sentry_event_id"] = "evt_test_123",
                    ["sentry_issue_url"] = null,
                    ["diagnostics"] = null,
                    ["user_agent"] = "Playwright",
                    ["triage_notes"] = "Investigating.",
                    ["triaged_at"] = "2026-07-05T10:00:00Z",
                    ["resolved_at"] = null,
                    ["closed_at"] = null,
                    ["created_at"] = "2026-07-05T08:00:00Z",
                    ["updated_at"] = "2026-07-05T10:00:00Z"
                }
            }, JsonOptions)
        });
        await db.SaveChangesAsync();
    }
}
