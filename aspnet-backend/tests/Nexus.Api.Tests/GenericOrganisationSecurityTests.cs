// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class GenericOrganisationSecurityTests : IntegrationTestBase
{
    public GenericOrganisationSecurityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Theory]
    [InlineData("pending")]
    [InlineData("suspended")]
    public async Task NonVerifiedOrganisation_DonationTransferAndGrant_WriteNothing(string status)
    {
        var organisationId = await CreateOrganisationAsync(status, isPublic: true, balance: 9m);
        await AuthenticateAsMemberAsync();

        using (var donation = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/wallet/donate",
                   new { amount = 1m, description = $"blocked-{status}-donation" }))
        {
            donation.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var transfer = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/wallet/transfer",
                   new
                   {
                       to_user_id = TestData.AdminUser.Id,
                       amount = 1m,
                       description = $"blocked-{status}-transfer"
                   }))
        {
            transfer.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        await AuthenticateAsAdminAsync();
        using (var grant = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/wallet/grant",
                   new { amount = 1m, description = $"blocked-{status}-grant" }))
        {
            grant.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var wallet = await db.OrgWallets.IgnoreQueryFilters()
            .SingleAsync(row => row.OrganisationId == organisationId);
        wallet.Balance.Should().Be(9m);
        wallet.TotalReceived.Should().Be(0m);
        wallet.TotalSpent.Should().Be(0m);
        (await db.OrgWalletTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.OrgWalletId == wallet.Id)).Should().Be(0);
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.Description != null
                && row.Description.StartsWith($"blocked-{status}"))).Should().Be(0);
    }

    [Fact]
    public async Task WalletAliases_RequireMembershipAndNeverFabricateMissingWallet()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: true, balance: 4m);
        var noWalletOrganisationId = await CreateOrganisationAsync(
            "verified",
            isPublic: true,
            createWallet: false);
        var outsider = await CreateUserAsync("wallet-outsider", isActive: true);
        SetAuthToken(await GetAccessTokenAsync(outsider.Email, "test-tenant"));

        var forbiddenPaths = new[]
        {
            $"/api/organizations/{organisationId}/wallet/balance",
            $"/api/organisations/{organisationId}/wallet/balance",
            $"/api/organizations/{organisationId}/wallet/transactions",
            $"/api/organisations/{organisationId}/wallet/transactions",
            $"/api/organisations/{organisationId}/wallet"
        };

        foreach (var path in forbiddenPaths)
        {
            using var response = await Client.GetAsync(path);
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, path);
        }

        await AuthenticateAsMemberAsync();
        using var missing = await Client.GetAsync(
            $"/api/organizations/{noWalletOrganisationId}/wallet/balance");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WalletAliases_ReturnOnlySanitizedLedgerProjections()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: true, balance: 4m);
        int walletId;
        using (var seed = Factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
            walletId = await db.OrgWallets.IgnoreQueryFilters()
                .Where(row => row.OrganisationId == organisationId)
                .Select(row => row.Id)
                .SingleAsync();
            db.OrgWalletTransactions.Add(new OrgWalletTransaction
            {
                TenantId = TestData.Tenant1.Id,
                OrgWalletId = walletId,
                Type = "credit",
                Amount = 4m,
                BalanceAfter = 4m,
                Category = "donation",
                Description = "projection-test",
                InitiatedById = TestData.AdminUser.Id
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        using (var balance = await Client.GetAsync(
                   $"/api/organizations/{organisationId}/wallet/balance"))
        {
            balance.StatusCode.Should().Be(HttpStatusCode.OK);
            var json = await ReadJsonAsync(balance);
            var data = json.GetProperty("data");
            data.GetProperty("organisation_id").GetInt32().Should().Be(organisationId);
            data.TryGetProperty("tenant_id", out _).Should().BeFalse();
            data.TryGetProperty("organisation", out _).Should().BeFalse();
        }

        using (var transactions = await Client.GetAsync(
                   $"/api/organizations/{organisationId}/wallet/transactions"))
        {
            transactions.StatusCode.Should().Be(HttpStatusCode.OK);
            var raw = await transactions.Content.ReadAsStringAsync();
            raw.Should().NotContain("admin@test.com");
            raw.Should().NotContain("tenant_id");
            raw.Should().NotContain("org_wallet_id");
            raw.Should().Contain("projection-test");
        }
    }

    [Fact]
    public async Task ProfileAndRosterAliases_HidePrivatePendingAndSuspendedOrganisations()
    {
        var publicVerified = await CreateOrganisationAsync("verified", isPublic: true);
        var privateVerified = await CreateOrganisationAsync("verified", isPublic: false);
        var publicPending = await CreateOrganisationAsync("pending", isPublic: true);
        var publicSuspended = await CreateOrganisationAsync("suspended", isPublic: true);
        var outsider = await CreateUserAsync("profile-outsider", isActive: true);
        SetAuthToken(await GetAccessTokenAsync(outsider.Email, "test-tenant"));

        foreach (var spelling in new[] { "organisations", "organizations" })
        {
            foreach (var suffix in new[] { string.Empty, "/members" })
            {
                using var visible = await Client.GetAsync(
                    $"/api/{spelling}/{publicVerified}{suffix}");
                visible.StatusCode.Should().Be(HttpStatusCode.OK);

                foreach (var hiddenId in new[] { privateVerified, publicPending, publicSuspended })
                {
                    using var hidden = await Client.GetAsync(
                        $"/api/{spelling}/{hiddenId}{suffix}");
                    hidden.StatusCode.Should().Be(HttpStatusCode.NotFound,
                        $"{spelling}/{hiddenId}{suffix} must not reveal hidden organisation existence");
                }
            }
        }

        await AuthenticateAsOtherTenantUserAsync();
        foreach (var path in new[]
                 {
                     $"/api/organisations/{publicVerified}",
                     $"/api/organizations/{publicVerified}",
                     $"/api/organisations/{publicVerified}/members",
                     $"/api/organizations/{publicVerified}/members"
                 })
        {
            using var crossTenant = await Client.GetAsync(path);
            crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound, path);
        }
    }

    [Fact]
    public async Task PrivateProfileAndRoster_RemainVisibleToOwnerMemberAndDatabaseAdmin()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: false);
        var member = await CreateUserAsync("private-member", isActive: true);
        await AddMembershipDirectAsync(organisationId, member.Id, "member");

        foreach (var actor in new[]
                 {
                     (TestData.MemberUser.Email, "owner"),
                     (member.Email, "member"),
                     (TestData.AdminUser.Email, "database admin")
                 })
        {
            SetAuthToken(await GetAccessTokenAsync(actor.Email, "test-tenant"));
            foreach (var path in new[]
                     {
                         $"/api/organisations/{organisationId}",
                         $"/api/organizations/{organisationId}",
                         $"/api/organisations/{organisationId}/members",
                         $"/api/organizations/{organisationId}/members"
                     })
            {
                using var response = await Client.GetAsync(path);
                response.StatusCode.Should().Be(HttpStatusCode.OK, $"{actor.Item2}: {path}");
            }
        }
    }

    [Fact]
    public async Task MemberMutations_RejectForeignInactiveInvalidAndOwnerEscalation()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: false);
        var inactive = await CreateUserAsync("inactive-candidate", isActive: false);
        var active = await CreateUserAsync("active-candidate", isActive: true);
        await AuthenticateAsMemberAsync();

        foreach (var attempt in new[]
                 {
                     (TestData.OtherTenantUser.Id, "member"),
                     (inactive.Id, "member"),
                     (active.Id, "owner"),
                     (active.Id, "manager")
                 })
        {
            using var response = await Client.PostAsJsonAsync(
                $"/api/organisations/{organisationId}/members",
                new { user_id = attempt.Item1, role = attempt.Item2 });
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var ownerDemotion = await Client.PutAsJsonAsync(
                   $"/api/organisations/{organisationId}/members/{TestData.MemberUser.Id}/role",
                   new { role = "member" }))
        {
            ownerDemotion.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var validElevation = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/members",
                   new { user_id = active.Id, role = "admin" }))
        {
            validElevation.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var owner = await db.OrganisationMembers.IgnoreQueryFilters()
            .SingleAsync(row => row.OrganisationId == organisationId
                && row.UserId == TestData.MemberUser.Id);
        owner.Role.Should().Be("owner");
        (await db.OrganisationMembers.IgnoreQueryFilters()
            .SingleAsync(row => row.OrganisationId == organisationId
                && row.UserId == active.Id)).Role.Should().Be("admin");
        (await db.OrganisationMembers.IgnoreQueryFilters()
            .AnyAsync(row => row.OrganisationId == organisationId
                && (row.UserId == inactive.Id
                    || row.UserId == TestData.OtherTenantUser.Id))).Should().BeFalse();
    }

    [Fact]
    public async Task OrganisationAdmin_CannotGrantOrRevokeElevatedRoles()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: false);
        var orgAdmin = await CreateUserAsync("org-admin", isActive: true);
        var existingAdmin = await CreateUserAsync("existing-admin", isActive: true);
        var candidate = await CreateUserAsync("ordinary-candidate", isActive: true);
        await AddMembershipDirectAsync(organisationId, orgAdmin.Id, "admin");
        await AddMembershipDirectAsync(organisationId, existingAdmin.Id, "admin");
        SetAuthToken(await GetAccessTokenAsync(orgAdmin.Email, "test-tenant"));

        using (var elevate = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/members",
                   new { user_id = candidate.Id, role = "admin" }))
        {
            elevate.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var removeAdmin = await Client.DeleteAsync(
                   $"/api/organisations/{organisationId}/members/{existingAdmin.Id}"))
        {
            removeAdmin.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var addMember = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/members",
                   new { user_id = candidate.Id, role = "member" }))
        {
            addMember.StatusCode.Should().Be(HttpStatusCode.Created);
        }
    }

    [Fact]
    public async Task NonCanonicalOwnerMembership_CannotTransferOrEditOrganisation()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: true, balance: 5m);
        var rogueOwner = await CreateUserAsync("rogue-owner", isActive: true);
        await AddMembershipDirectAsync(organisationId, rogueOwner.Id, "owner");
        SetAuthToken(await GetAccessTokenAsync(rogueOwner.Email, "test-tenant"));

        using (var transfer = await Client.PostAsJsonAsync(
                   $"/api/organisations/{organisationId}/wallet/transfer",
                   new
                   {
                       to_user_id = TestData.AdminUser.Id,
                       amount = 1m,
                       description = "rogue-owner-transfer"
                   }))
        {
            transfer.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var update = await Client.PutAsJsonAsync(
                   $"/api/organisations/{organisationId}",
                   new { name = "Rogue owner rewrite", is_public = false }))
        {
            update.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = await db.Organisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == organisationId);
        organisation.Name.Should().NotBe("Rogue owner rewrite");
        organisation.IsPublic.Should().BeTrue();
        (await db.OrgWallets.IgnoreQueryFilters()
            .Where(row => row.OrganisationId == organisationId)
            .Select(row => row.Balance)
            .SingleAsync()).Should().Be(5m);
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.Description == "rogue-owner-transfer")).Should().Be(0);
    }

    [Fact]
    public async Task TransferWaitingBehindCommittedSuspension_SeesSuspendedStateAndWritesNothing()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: true, balance: 5m);
        var token = await GetAccessTokenAsync(TestData.MemberUser.Email, "test-tenant");
        using var transferClient = Factory.CreateClient();
        transferClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        using var writerScope = Factory.Services.CreateScope();
        var writerDb = writerScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var writerTransaction = await writerDb.Database.BeginTransactionAsync();
        await writerDb.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})",
            organisationId + int.MaxValue / 2);
        var organisation = await writerDb.Organisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == organisationId);
        organisation.Status = "suspended";
        await writerDb.SaveChangesAsync();

        var transferTask = transferClient.PostAsJsonAsync(
            $"/api/organisations/{organisationId}/wallet/transfer",
            new
            {
                to_user_id = TestData.AdminUser.Id,
                amount = 1m,
                description = "must-see-committed-suspension"
            });
        await Task.Delay(150);
        await writerTransaction.CommitAsync();

        using var response = await transferTask;
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.Description == "must-see-committed-suspension")).Should().Be(0);
        var wallet = await verifyDb.OrgWallets.IgnoreQueryFilters()
            .SingleAsync(row => row.OrganisationId == organisationId);
        wallet.Balance.Should().Be(5m);
    }

    [Fact]
    public async Task AdminSuspend_WaitsForTheSharedOrganisationLifecycleLock()
    {
        var organisationId = await CreateOrganisationAsync("verified", isPublic: true, balance: 5m);
        using var blockerScope = Factory.Services.CreateScope();
        var blockerDb = blockerScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var blocker = await blockerDb.Database.BeginTransactionAsync();
        await blockerDb.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})",
            organisationId + int.MaxValue / 2);

        using var suspendScope = Factory.Services.CreateScope();
        var tenant = suspendScope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetTenant(TestData.Tenant1.Id);
        var service = suspendScope.ServiceProvider.GetRequiredService<OrganisationService>();
        var suspendTask = service.AdminSuspendAsync(organisationId);

        await Task.Delay(150);
        suspendTask.IsCompleted.Should().BeFalse(
            "suspension must wait behind in-flight organisation wallet/lifecycle writes");
        await blocker.RollbackAsync();

        var result = await suspendTask;
        result.Error.Should().BeNull();
        result.Org!.Status.Should().Be("suspended");
    }

    [Fact]
    public async Task Delete_WaitsForWalletWriteAndRefusesToEraseFinancialEvidence()
    {
        var organisationId = await CreateOrganisationAsync(
            "verified",
            isPublic: true,
            balance: 0m);
        await AuthenticateAsMemberAsync();

        using var writerScope = Factory.Services.CreateScope();
        var writerDb = writerScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var writerTransaction = await writerDb.Database.BeginTransactionAsync();
        await writerDb.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})",
            organisationId + int.MaxValue / 2);

        var wallet = await writerDb.OrgWallets.IgnoreQueryFilters()
            .SingleAsync(row => row.OrganisationId == organisationId);
        wallet.Balance = 2m;
        wallet.TotalReceived = 2m;
        writerDb.OrgWalletTransactions.Add(new OrgWalletTransaction
        {
            TenantId = TestData.Tenant1.Id,
            OrgWalletId = wallet.Id,
            Type = "credit",
            Amount = 2m,
            BalanceAfter = 2m,
            Category = "donation",
            Description = "delete-race-evidence",
            InitiatedById = TestData.MemberUser.Id,
            FromUserId = TestData.MemberUser.Id
        });
        await writerDb.SaveChangesAsync();

        var deleteTask = Client.DeleteAsync($"/api/organisations/{organisationId}");
        await Task.Delay(150);
        deleteTask.IsCompleted.Should().BeFalse(
            "deletion must wait behind in-flight organisation wallet writes");

        await writerTransaction.CommitAsync();
        using var response = await deleteTask;
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Organisations.IgnoreQueryFilters()
            .AnyAsync(row => row.Id == organisationId)).Should().BeTrue();
        var persistedWallet = await verifyDb.OrgWallets.IgnoreQueryFilters()
            .SingleAsync(row => row.OrganisationId == organisationId);
        persistedWallet.Balance.Should().Be(2m);
        persistedWallet.TotalReceived.Should().Be(2m);
        (await verifyDb.OrgWalletTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.OrgWalletId == persistedWallet.Id
                && row.Description == "delete-race-evidence")).Should().Be(1);
    }

    [Fact]
    public void OrganisationPrivacyRoutes_HaveOneCanonicalOwnerPerVerbAndTemplate()
    {
        var owned = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    ?? Array.Empty<string>();
                var template = (endpoint.RoutePattern.RawText ?? string.Empty)
                    .Trim().TrimStart('/');
                var action = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
                return methods.Select(method => new
                {
                    Method = method.ToUpperInvariant(),
                    Template = template,
                    Controller = action?.ControllerName,
                    Action = action?.ActionName
                });
            })
            .ToList();

        var expected = new Dictionary<string, (string Controller, string Action)>
        {
            ["api/organizations/{id:int}/wallet/balance"] = ("V15MemberParity", "V2OrganisationWallet"),
            ["api/organisations/{id:int}/wallet/balance"] = ("V15MemberParity", "V2OrganisationWallet"),
            ["api/organizations/{id:int}/wallet/transactions"] = ("V15MemberParity", "V2OrganisationWalletTransactions"),
            ["api/organisations/{orgId}/wallet/transactions"] = ("OrgWallet", "GetTransactions"),
            ["api/organizations/{id:int}/members"] = ("V15MemberParity", "V2OrganisationMembers"),
            ["api/organisations/{id:int}/members"] = ("Organisations", "GetMembers"),
            ["api/organizations/{id:int}"] = ("Organisations", "GetOrganisation"),
            ["api/organisations/{id:int}"] = ("Organisations", "GetOrganisation")
        };

        foreach (var (template, owner) in expected)
        {
            var match = owned.Where(endpoint => endpoint.Method == "GET"
                    && endpoint.Template == template)
                .Should().ContainSingle($"GET {template} must have one route owner")
                .Which;
            match.Controller.Should().Be(owner.Controller);
            match.Action.Should().Be(owner.Action);
        }
    }

    private async Task<int> CreateOrganisationAsync(
        string status,
        bool isPublic,
        decimal balance = 0m,
        bool createWallet = true)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        var organisation = new Organisation
        {
            TenantId = TestData.Tenant1.Id,
            Name = $"Generic organisation {suffix}",
            Slug = $"generic-{suffix}",
            OwnerId = TestData.MemberUser.Id,
            Status = status,
            IsPublic = isPublic,
            VerifiedAt = status == "verified" ? DateTime.UtcNow : null
        };
        db.Organisations.Add(organisation);
        await db.SaveChangesAsync();
        db.OrganisationMembers.Add(new OrganisationMember
        {
            TenantId = TestData.Tenant1.Id,
            OrganisationId = organisation.Id,
            UserId = TestData.MemberUser.Id,
            Role = "owner"
        });
        if (createWallet)
        {
            db.OrgWallets.Add(new OrgWallet
            {
                TenantId = TestData.Tenant1.Id,
                OrganisationId = organisation.Id,
                Balance = balance
            });
        }
        await db.SaveChangesAsync();
        return organisation.Id;
    }

    private async Task<User> CreateUserAsync(string label, bool isActive)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"{label}-{suffix}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = label,
            LastName = "User",
            Role = "member",
            IsActive = isActive,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private async Task AddMembershipDirectAsync(int organisationId, int userId, string role)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.OrganisationMembers.Add(new OrganisationMember
        {
            TenantId = TestData.Tenant1.Id,
            OrganisationId = organisationId,
            UserId = userId,
            Role = role
        });
        await db.SaveChangesAsync();
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
