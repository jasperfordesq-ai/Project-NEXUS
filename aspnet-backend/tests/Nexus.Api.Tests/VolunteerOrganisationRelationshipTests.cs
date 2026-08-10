// Copyright (c) 2024-2026 Jasper Ford
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

[Collection("Integration")]
public sealed class VolunteerOrganisationRelationshipTests : IntegrationTestBase
{
    public VolunteerOrganisationRelationshipTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task MemberCreate_PersistsPendingOrganisationAndActiveOwnerMembershipAtomically()
    {
        await AuthenticateAsMemberAsync();
        var name = $"Neighbourhood Helpers {Guid.NewGuid():N}";

        using var response = await Client.PostAsJsonAsync(
            "/api/v2/volunteering/organisations",
            ValidCreate(name));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.GetValues("API-Version").Single().Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Single().Should().Be(TestData.Tenant1.Id.ToString());
        var body = await ReadJsonAsync(response);
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var data = body.GetProperty("data");
        data.GetProperty("name").GetString().Should().Be(name);
        data.GetProperty("status").GetString().Should().Be("pending");
        data.GetProperty("opportunity_count").GetInt32().Should().Be(0);
        var organisationId = data.GetProperty("id").GetInt32();
        var updatedName = name + " Updated";

        using (var update = await Client.PutAsJsonAsync(
                   $"/api/v2/volunteering/organisations/{organisationId}",
                   new
                   {
                       name = updatedName,
                       description = "An updated volunteer organisation description.",
                       contact_email = "updated-coordinator@example.test",
                       website = "https://updated-helpers.example.test"
                   }))
        {
            update.StatusCode.Should().Be(HttpStatusCode.OK);
            var updated = (await ReadJsonAsync(update)).GetProperty("data");
            updated.GetProperty("name").GetString().Should().Be(updatedName);
        }

        await AuthenticateAsAdminAsync();
        using (var activate = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{organisationId}/status",
                   new { status = "active" }))
        {
            activate.StatusCode.Should().Be(HttpStatusCode.OK);
        }
        await AuthenticateAsMemberAsync();

        using (var opportunity = await Client.PostAsJsonAsync(
                   "/api/v2/volunteering/opportunities",
                   new
                   {
                       organization_id = organisationId,
                       title = "Neighbourhood welcome opportunity",
                       description = "Help welcome new neighbours to the community.",
                       required_volunteers = 3
                   }))
        {
            opportunity.StatusCode.Should().Be(HttpStatusCode.Created);
            (await ReadJsonAsync(opportunity)).GetProperty("organization_id").GetInt32()
                .Should().Be(organisationId);
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(org => org.Id == organisationId);
        organisation.TenantId.Should().Be(TestData.Tenant1.Id);
        organisation.OwnerUserId.Should().Be(TestData.MemberUser.Id);
        organisation.Status.Should().Be("active");
        organisation.Name.Should().Be(updatedName);
        organisation.ContactEmail.Should().Be("updated-coordinator@example.test");
        organisation.Website.Should().Be("https://updated-helpers.example.test");
        (await db.VolunteerOpportunities.IgnoreQueryFilters()
            .SingleAsync(opportunity => opportunity.VolunteerOrganisationId == organisationId))
            .OrganizerId.Should().Be(TestData.MemberUser.Id);

        var membership = await db.VolunteerOrganisationMembers.IgnoreQueryFilters()
            .SingleAsync(member => member.VolunteerOrganisationId == organisationId);
        membership.TenantId.Should().Be(TestData.Tenant1.Id);
        membership.UserId.Should().Be(TestData.MemberUser.Id);
        membership.OrgType.Should().Be("volunteer");
        membership.Role.Should().Be("owner");
        membership.Status.Should().Be("active");
        (await db.Organisations.IgnoreQueryFilters().AnyAsync(org => org.Name == updatedName)).Should().BeFalse(
            "volunteer organisations must not leak into the generic employer/community domain");
    }

    [Fact]
    public async Task MemberCreate_RejectsInvalidAndDuplicateNamesWithoutPartialRows()
    {
        await AuthenticateAsMemberAsync();

        using (var invalid = await Client.PostAsJsonAsync(
                   "/api/v2/volunteering/organisations",
                   ValidCreate("No")))
        {
            invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var error = (await ReadJsonAsync(invalid)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("field").GetString().Should().Be("name");
        }

        var name = $"Duplicate Helpers {Guid.NewGuid():N}";
        using (var first = await Client.PostAsJsonAsync(
                   "/api/v2/volunteering/organisations",
                   ValidCreate(name)))
        {
            first.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using (var duplicate = await Client.PostAsJsonAsync(
                   "/api/v2/volunteering/organisations",
                   ValidCreate(name.ToUpperInvariant())))
        {
            duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
            var error = (await ReadJsonAsync(duplicate)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("ALREADY_EXISTS");
            error.GetProperty("field").GetString().Should().Be("name");
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerOrganisations.IgnoreQueryFilters()
            .CountAsync(org => org.TenantId == TestData.Tenant1.Id
                && org.Name.ToLower() == name.ToLower())).Should().Be(1);
        (await db.VolunteerOrganisationMembers.IgnoreQueryFilters()
            .CountAsync(member => member.TenantId == TestData.Tenant1.Id)).Should().Be(1);
    }

    [Fact]
    public async Task Create_WhenOwnerMembershipInsertFails_RollsBackOrganisation()
    {
        await AuthenticateAsAdminAsync();
        var name = $"Rollback Volunteer Hub {Guid.NewGuid():N}";
        using (var setup = Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.Database.ExecuteSqlRawAsync(
                """
                DROP TRIGGER IF EXISTS test_fail_volunteer_org_member_insert ON org_members;
                DROP FUNCTION IF EXISTS test_fail_volunteer_org_member_insert();
                CREATE FUNCTION test_fail_volunteer_org_member_insert()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'forced membership failure';
                END;
                $$;
                CREATE TRIGGER test_fail_volunteer_org_member_insert
                BEFORE INSERT ON org_members
                FOR EACH ROW EXECUTE FUNCTION test_fail_volunteer_org_member_insert();
                """);
        }

        try
        {
            using var response = await Client.PostAsJsonAsync(
                "/api/v2/admin/volunteering/organizations",
                new
                {
                    name,
                    description = "A sufficiently detailed rollback test description.",
                    contact_email = "rollback@example.test",
                    website = "https://rollback.example.test"
                });
            response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            (await ReadJsonAsync(response)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("SERVER_ERROR");

            using var verify = Factory.Services.CreateScope();
            var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.VolunteerOrganisations.IgnoreQueryFilters()
                .AnyAsync(org => org.Name == name)).Should().BeFalse();
            (await db.VolunteerOrganisationMembers.IgnoreQueryFilters()
                .AnyAsync(member => member.VolunteerOrganisation != null
                    && member.VolunteerOrganisation.Name == name)).Should().BeFalse();
        }
        finally
        {
            using var cleanup = Factory.Services.CreateScope();
            await cleanup.ServiceProvider.GetRequiredService<NexusDbContext>()
                .Database.ExecuteSqlRawAsync(
                    """
                    DROP TRIGGER IF EXISTS test_fail_volunteer_org_member_insert ON org_members;
                    DROP FUNCTION IF EXISTS test_fail_volunteer_org_member_insert();
                    """);
        }
    }

    [Fact]
    public async Task AdminCreateListAndStatus_UseDedicatedTenantScopedLifecycle()
    {
        await AuthenticateAsAdminAsync();
        var name = $"Admin Volunteer Hub {Guid.NewGuid():N}";

        using var create = await Client.PostAsJsonAsync(
            "/api/v2/admin/volunteering/organizations",
            new
            {
                name,
                description = "A sufficiently detailed volunteer organisation description.",
                contact_email = "admin-hub@example.test",
                website = "https://admin-hub.example.test",
                org_type = "charity",
                meeting_schedule = "First Tuesday"
            });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await ReadJsonAsync(create)).GetProperty("data");
        created.GetProperty("status").GetString().Should().Be("active");
        var organisationId = created.GetProperty("id").GetInt32();
        var updatedName = name + " Updated";

        using (var update = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{organisationId}",
                   new
                   {
                       name = updatedName,
                       contact_email = "updated-admin-hub@example.test",
                       website = "https://updated-admin-hub.example.test",
                       org_type = "organisation",
                       meeting_schedule = "Second Thursday"
                   }))
        {
            update.StatusCode.Should().Be(HttpStatusCode.OK);
            var data = (await ReadJsonAsync(update)).GetProperty("data");
            data.GetProperty("name").GetString().Should().Be(updatedName);
        }

        using (var list = await Client.GetAsync("/api/v2/admin/volunteering/organizations"))
        {
            list.StatusCode.Should().Be(HttpStatusCode.OK);
            var listBody = await ReadJsonAsync(list);
            listBody.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
            var item = listBody.GetProperty("data").EnumerateArray()
                .Single(row => row.GetProperty("id").GetInt32() == organisationId);
            item.GetProperty("org_name").GetString().Should().Be(updatedName);
            item.GetProperty("status").GetString().Should().Be("active");
            item.GetProperty("member_count").GetInt32().Should().Be(1);
            item.GetProperty("org_type").GetString().Should().Be("organisation");
        }

        using (var suspend = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{organisationId}/status",
                   new { status = "suspended" }))
        {
            suspend.StatusCode.Should().Be(HttpStatusCode.OK);
            var data = (await ReadJsonAsync(suspend)).GetProperty("data");
            data.GetProperty("status").GetString().Should().Be("suspended");
            data.GetProperty("message").GetString()
                .Should().Be("Organization status updated to suspended");
        }

        using (var invalid = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{organisationId}/status",
                   new { status = "approved" }))
        {
            invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var error = (await ReadJsonAsync(invalid)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("field").GetString().Should().Be("status");
        }

        using (var whitespace = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{organisationId}/status",
                   new { status = " active " }))
        {
            whitespace.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(org => org.Id == organisationId);
        stored.Status.Should().Be("suspended");
        stored.OwnerUserId.Should().Be(TestData.AdminUser.Id);
        stored.UpdatedAt.Should().NotBeNull();
        (await verifyDb.Organisations.IgnoreQueryFilters().AnyAsync(org => org.Name == updatedName)).Should().BeFalse();
    }

    [Fact]
    public async Task MemberCreate_FeatureGateRunsBeforeRateLimitAndDoesNotMutate()
    {
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = AdminVolunteerApprovalService.FeatureConfigKey,
                Value = "false",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        for (var attempt = 0; attempt < 7; attempt++)
        {
            using var disabled = await Client.PostAsJsonAsync(
                attempt % 2 == 0
                    ? "/api/v2/volunteering/organisations"
                    : "/api/v2/volunteering/organisations/",
                ValidCreate($"Disabled Hub {attempt} {Guid.NewGuid():N}"));
            disabled.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            var error = (await ReadJsonAsync(disabled)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
            error.GetProperty("message").GetString()
                .Should().Be("Volunteering module is not enabled for this community");
        }

        foreach (var path in new[]
                 {
                     "/api/v2/volunteering/my-organisations",
                     "/api/v2/volunteering/my-organisations/"
                 })
        {
            using var disabledList = await Client.GetAsync(path);
            disabledList.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(disabledList)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
        }

        using (var enable = Factory.Services.CreateScope())
        {
            var db = enable.ServiceProvider.GetRequiredService<NexusDbContext>();
            var config = await db.TenantConfigs.IgnoreQueryFilters()
                .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.Key == AdminVolunteerApprovalService.FeatureConfigKey);
            config.Value = "true";
            await db.SaveChangesAsync();
        }

        var enabledName = $"Enabled Hub {Guid.NewGuid():N}";
        using var enabled = await Client.PostAsJsonAsync(
            "/api/v2/volunteering/organisations",
            ValidCreate(enabledName));
        enabled.StatusCode.Should().Be(HttpStatusCode.Created,
            "disabled requests must not consume the Laravel 5/minute create bucket");

        using (var addSecond = Factory.Services.CreateScope())
        {
            var db = addSecond.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.VolunteerOrganisations.Add(NewOrganisation(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                $"Second Enabled Hub {Guid.NewGuid():N}",
                "active"));
            await db.SaveChangesAsync();
        }

        using var firstPage = await Client.GetAsync(
            "/api/v2/volunteering/my-organisations?per_page=1");
        firstPage.StatusCode.Should().Be(HttpStatusCode.OK);
        firstPage.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        firstPage.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString());
        var firstPageBody = await ReadJsonAsync(firstPage);
        firstPageBody.GetProperty("data").GetArrayLength().Should().Be(1);
        var meta = firstPageBody.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(1);
        meta.GetProperty("has_more").GetBoolean().Should().BeTrue();
        meta.GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var cursor = Uri.EscapeDataString(meta.GetProperty("cursor").GetString()!);

        using var secondPage = await Client.GetAsync(
            $"/api/v2/volunteering/my-organisations?per_page=1&cursor={cursor}");
        secondPage.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(secondPage)).GetProperty("data").GetArrayLength().Should().Be(1);

        using var verify = Factory.Services.CreateScope();
        (await verify.ServiceProvider.GetRequiredService<NexusDbContext>()
            .VolunteerOrganisations.IgnoreQueryFilters()
            .CountAsync(org => org.TenantId == TestData.Tenant1.Id)).Should().Be(2);
    }

    [Fact]
    public async Task AdminStatus_IsAdminOnlyAndHidesCrossTenantOrganisations()
    {
        int otherTenantOrganisationId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisation = NewOrganisation(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                $"Other Tenant Hub {Guid.NewGuid():N}",
                "pending");
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();
            otherTenantOrganisationId = organisation.Id;
        }

        await AuthenticateAsMemberAsync();
        using (var forbidden = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{otherTenantOrganisationId}/status",
                   new { status = "active" }))
        {
            forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        await AuthenticateAsAdminAsync();
        using (var hidden = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{otherTenantOrganisationId}/status",
                   new { status = "active" }))
        {
            hidden.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await ReadJsonAsync(hidden)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("NOT_FOUND");
        }

        using var verifyScope = Factory.Services.CreateScope();
        var stored = await verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(org => org.Id == otherTenantOrganisationId);
        stored.Status.Should().Be("pending");
    }

    [Fact]
    public async Task SchemaRejectsCrossTenantOwnerMembershipAndTransactionReferences()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var invalidOwner = NewOrganisation(
            TestData.Tenant1.Id,
            TestData.OtherTenantUser.Id,
            "Cross Tenant Owner",
            "active");
        db.VolunteerOrganisations.Add(invalidOwner);
        Func<Task> ownerWrite = () => db.SaveChangesAsync();
        await ownerWrite.Should().ThrowAsync<DbUpdateException>();
        db.Entry(invalidOwner).State = EntityState.Detached;

        var valid = NewOrganisation(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            "Tenant Safe Owner",
            "active");
        db.VolunteerOrganisations.Add(valid);
        await db.SaveChangesAsync();
        var invalidMember = NewMember(
            valid.Id,
            TestData.OtherTenantUser.Id,
            "owner",
            "active");
        db.VolunteerOrganisationMembers.Add(invalidMember);
        Func<Task> memberWrite = () => db.SaveChangesAsync();
        await memberWrite.Should().ThrowAsync<DbUpdateException>();
        db.Entry(invalidMember).State = EntityState.Detached;

        var invalidTransaction = new VolunteerOrganisationTransaction
        {
            TenantId = TestData.Tenant1.Id,
            VolunteerOrganisationId = valid.Id,
            UserId = TestData.OtherTenantUser.Id,
            Type = "deposit",
            Amount = 10m,
            BalanceAfter = 10m,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOrganisationTransactions.Add(invalidTransaction);
        Func<Task> transactionWrite = () => db.SaveChangesAsync();
        await transactionWrite.Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task SchemaRejectsDuplicateVolunteerPaymentForSameLog()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = NewOrganisation(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            "Payment Integrity Hub",
            "active");
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();

        var log = new VolunteerLog
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            OrganizationId = organisation.Id,
            DateLogged = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
            Hours = 5m,
            Description = "Payment uniqueness schema fixture",
            Status = "approved",
            CreatedAt = DateTime.UtcNow.AddDays(-1),
            UpdatedAt = DateTime.UtcNow.AddDays(-1)
        };
        db.VolunteerLogs.Add(log);
        await db.SaveChangesAsync();

        var first = new VolunteerOrganisationTransaction
        {
            TenantId = TestData.Tenant1.Id,
            VolunteerOrganisationId = organisation.Id,
            UserId = TestData.AdminUser.Id,
            VolunteerLogId = log.Id,
            Type = "volunteer_payment",
            Amount = -5m,
            BalanceAfter = 95m,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOrganisationTransactions.Add(first);
        await db.SaveChangesAsync();

        db.VolunteerOrganisationTransactions.Add(new VolunteerOrganisationTransaction
        {
            TenantId = first.TenantId,
            VolunteerOrganisationId = first.VolunteerOrganisationId,
            UserId = first.UserId,
            VolunteerLogId = first.VolunteerLogId,
            Type = first.Type,
            Amount = first.Amount,
            BalanceAfter = 90m,
            CreatedAt = DateTime.UtcNow
        });

        Func<Task> duplicateWrite = () => db.SaveChangesAsync();
        await duplicateWrite.Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task OrganisationAggregates_RemainAvailableWhenQuarantinedVolLogsTableIsAbsent()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = NewOrganisation(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            "Fresh Chain Aggregate Hub",
            "active");
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();

        await using var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            await db.Database.ExecuteSqlRawAsync(
                """
                DROP TABLE vol_logs CASCADE;
                DROP TABLE IF EXISTS vol_reviews CASCADE;
                CREATE TABLE vol_reviews (
                    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    tenant_id integer NOT NULL,
                    reviewer_id integer NOT NULL,
                    target_type text NOT NULL,
                    target_id integer NOT NULL,
                    rating integer NOT NULL
                );
                INSERT INTO vol_reviews
                    (tenant_id, reviewer_id, target_type, target_id, rating)
                VALUES
                    ({0}, {1}, 'organization', {2}, 5),
                    ({0}, {3}, 'organization', {2}, 3);
                """,
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                organisation.Id,
                TestData.AdminUser.Id);
            var service = scope.ServiceProvider.GetRequiredService<VolunteerOrganisationService>();

            var statusMutation = await service.UpdateStatusAsync(
                organisation.Id,
                TestData.Tenant1.Id,
                "suspended");
            statusMutation.Success.Should().BeTrue();
            statusMutation.Data!.Status.Should().Be("suspended");

            var updateMutation = await service.UpdateAsync(
                organisation.Id,
                TestData.Tenant1.Id,
                new VolunteerOrganisationUpdateCommand(
                    HasName: false,
                    Name: null,
                    HasDescription: true,
                    Description: "Updated safely without a discovered volunteer-log table.",
                    HasContactEmail: false,
                    ContactEmail: null,
                    HasWebsite: false,
                    Website: null),
                adminSurface: false);
            updateMutation.Success.Should().BeTrue();

            var detail = await service.GetAsync(
                organisation.Id,
                TestData.Tenant1.Id,
                includeNonPublic: true);
            detail.Should().NotBeNull();
            detail!.TotalHours.Should().Be(0m);
            detail.ReviewCount.Should().Be(2);
            detail.AverageRating.Should().Be(4m);

            var adminRows = await service.ListAdminAsync(TestData.Tenant1.Id);
            adminRows.Single(row => row.Id == organisation.Id).TotalHours.Should().Be(0m);

            var summary = await service.GetHoursSummaryAsync(
                TestData.Tenant1.Id,
                organisation.Id);
            summary.Should().Be(new VolunteerOrganisationHoursSummary(0, 0m));

            var byUser = await service.GetApprovedHoursByUserAsync(
                TestData.Tenant1.Id,
                organisation.Id,
                new[] { TestData.MemberUser.Id });
            byUser.Should().BeEmpty();
        }
        finally
        {
            await transaction.RollbackAsync();
        }
    }

    [Fact]
    public async Task PublicDirectory_ExposesOnlyApprovedAndActiveTenantOrganisationsWithoutInternalFields()
    {
        int activeId;
        int approvedId;
        int pendingId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var active = NewOrganisation(TestData.Tenant1.Id, TestData.AdminUser.Id, "Active Public Hub", "active");
            var approved = NewOrganisation(TestData.Tenant1.Id, TestData.AdminUser.Id, "Approved Public Hub", "approved");
            var pending = NewOrganisation(TestData.Tenant1.Id, TestData.AdminUser.Id, "Pending Hidden Hub", "pending");
            var suspended = NewOrganisation(TestData.Tenant1.Id, TestData.AdminUser.Id, "Suspended Hidden Hub", "suspended");
            var otherTenant = NewOrganisation(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other Tenant Hub", "active");
            active.Balance = 999m;
            active.AutoPayEnabled = true;
            db.VolunteerOrganisations.AddRange(active, approved, pending, suspended, otherTenant);
            await db.SaveChangesAsync();
            activeId = active.Id;
            approvedId = approved.Id;
            pendingId = pending.Id;
        }

        ClearAuthToken();
        using var listRequest = new HttpRequestMessage(
            HttpMethod.Get,
            "/api/v2/volunteering/organisations");
        listRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        using var listResponse = await Client.SendAsync(listRequest);
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var listBody = await ReadJsonAsync(listResponse);
        var items = listBody.GetProperty("data").EnumerateArray().ToList();
        items.Select(item => item.GetProperty("id").GetInt32())
            .Should().BeEquivalentTo(new[] { activeId, approvedId });
        foreach (var item in items)
        {
            item.TryGetProperty("balance", out _).Should().BeFalse();
            item.TryGetProperty("auto_pay_enabled", out _).Should().BeFalse();
            item.TryGetProperty("user_id", out _).Should().BeFalse();
            item.GetProperty("owner").TryGetProperty("id", out _).Should().BeFalse();
        }

        using var detailRequest = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/volunteering/organisations/{activeId}");
        detailRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        using var detailResponse = await Client.SendAsync(detailRequest);
        detailResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(detailResponse)).GetProperty("data")
            .GetProperty("id").GetInt32().Should().Be(activeId);

        using var hiddenRequest = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/volunteering/organisations/{pendingId}");
        hiddenRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        using var hiddenResponse = await Client.SendAsync(hiddenRequest);
        hiddenResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task OrganisationDashboard_RequiresManagerAndNeverSerializesUserSecrets()
    {
        int organisationId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisation = NewOrganisation(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Dashboard Security Hub",
                "active");
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();
            organisationId = organisation.Id;
            var opportunity = new VolunteerOpportunity
            {
                TenantId = TestData.Tenant1.Id,
                OrganizerId = TestData.AdminUser.Id,
                VolunteerOrganisationId = organisation.Id,
                Title = "Dashboard security opportunity",
                Status = OpportunityStatus.Published,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            db.VolunteerApplications.Add(new VolunteerApplication
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = opportunity.Id,
                UserId = TestData.MemberUser.Id,
                Status = ApplicationStatus.Approved,
                Message = "I can help",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        using (var forbidden = await Client.GetAsync(
                   $"/api/v2/volunteering/organisations/{organisationId}/volunteers"))
        {
            forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        await AuthenticateAsAdminAsync();
        using var response = await Client.GetAsync(
            $"/api/v2/volunteering/organisations/{organisationId}/volunteers");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var volunteer = (await ReadJsonAsync(response)).GetProperty("data").EnumerateArray().Single();
        volunteer.GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        volunteer.GetProperty("email").GetString().Should().Be(TestData.MemberUser.Email);
        foreach (var forbiddenField in new[]
                 {
                     "password_hash",
                     "totp_secret_encrypted",
                     "email_verification_code",
                     "is_admin",
                     "is_super_admin",
                     "role"
                 })
        {
            volunteer.TryGetProperty(forbiddenField, out _).Should().BeFalse();
        }

        using var applications = await Client.GetAsync(
            $"/api/v2/volunteering/organisations/{organisationId}/applications");
        applications.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(applications)).GetProperty("data").EnumerateArray().Should().ContainSingle();

        foreach (var path in new[]
                 {
                     "/api/v2/volunteering/organisations/2147483647/stats",
                     "/api/v2/volunteering/organisations/2147483647/applications",
                     "/api/v2/volunteering/organisations/2147483647/volunteers"
                 })
        {
            using var missing = await Client.GetAsync(path);
            missing.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(missing)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("FORBIDDEN");
        }
    }

    [Fact]
    public async Task OpportunityPolicies_DistinguishCreatorFromOrganisationManagersExactly()
    {
        int opportunityId;
        int creatorId;
        int activeAdminId;
        int activeMemberId;
        int pendingOwnerId;
        int excludedSiteRoleId;
        int superAdminId;
        int tenantAdminId;
        int flagOnlyId;
        int inactiveCreatorId;
        int inactiveCreatorOpportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var creator = NewUser("org-policy-creator", TestData.Tenant1.Id, "member");
            var activeAdmin = NewUser("org-policy-admin", TestData.Tenant1.Id, "member");
            var activeMember = NewUser("org-policy-member", TestData.Tenant1.Id, "member");
            var pendingOwner = NewUser("org-policy-pending", TestData.Tenant1.Id, "member");
            var excludedSiteRole = NewUser("org-policy-wide-role", TestData.Tenant1.Id, "tenant_super_admin");
            var superAdmin = NewUser("org-policy-super-admin", TestData.Tenant1.Id, "super_admin");
            var tenantAdmin = NewUser("org-policy-tenant-admin", TestData.Tenant1.Id, "tenant_admin");
            var flagOnly = NewUser("org-policy-flag-only", TestData.Tenant1.Id, "member");
            flagOnly.IsAdmin = true;
            var inactiveCreator = NewUser("org-policy-inactive", TestData.Tenant1.Id, "member");
            inactiveCreator.IsActive = false;
            db.Users.AddRange(
                creator,
                activeAdmin,
                activeMember,
                pendingOwner,
                excludedSiteRole,
                superAdmin,
                tenantAdmin,
                flagOnly,
                inactiveCreator);
            await db.SaveChangesAsync();
            creatorId = creator.Id;
            activeAdminId = activeAdmin.Id;
            activeMemberId = activeMember.Id;
            pendingOwnerId = pendingOwner.Id;
            excludedSiteRoleId = excludedSiteRole.Id;
            superAdminId = superAdmin.Id;
            tenantAdminId = tenantAdmin.Id;
            flagOnlyId = flagOnly.Id;
            inactiveCreatorId = inactiveCreator.Id;

            var organisation = NewOrganisation(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                $"Policy Hub {Guid.NewGuid():N}",
                "suspended");
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();
            db.VolunteerOrganisationMembers.AddRange(
                NewMember(organisation.Id, activeAdminId, "admin", "active"),
                NewMember(organisation.Id, activeMemberId, "member", "active"),
                NewMember(organisation.Id, pendingOwnerId, "owner", "pending"));
            var opportunity = new VolunteerOpportunity
            {
                TenantId = TestData.Tenant1.Id,
                OrganizerId = creatorId,
                VolunteerOrganisationId = organisation.Id,
                Title = "Dedicated organisation policy",
                Status = OpportunityStatus.Published,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOpportunities.Add(opportunity);
            var inactiveOpportunity = new VolunteerOpportunity
            {
                TenantId = TestData.Tenant1.Id,
                OrganizerId = inactiveCreator.Id,
                Title = "Inactive creator policy",
                Status = OpportunityStatus.Published,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOpportunities.Add(inactiveOpportunity);
            await db.SaveChangesAsync();
            opportunityId = opportunity.Id;
            inactiveCreatorOpportunityId = inactiveOpportunity.Id;
        }

        using var scope = Factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<VolunteerOrganisationService>();

        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, creatorId, TestData.Tenant1.Id, includeCreator: true)).Allowed.Should().BeTrue();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, creatorId, TestData.Tenant1.Id, includeCreator: false)).Allowed.Should().BeFalse(
            "organizer application decisions intentionally exclude a creator-only grant");
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, TestData.MemberUser.Id, TestData.Tenant1.Id, includeCreator: false)).Allowed.Should().BeTrue(
            "the direct owner grant is independent of pending/suspended public status");
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, activeAdminId, TestData.Tenant1.Id, includeCreator: false)).Allowed.Should().BeTrue();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, activeMemberId, TestData.Tenant1.Id, includeCreator: true)).Allowed.Should().BeFalse();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, pendingOwnerId, TestData.Tenant1.Id, includeCreator: true)).Allowed.Should().BeFalse();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, TestData.AdminUser.Id, TestData.Tenant1.Id, includeCreator: false)).Allowed.Should().BeTrue();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, superAdminId, TestData.Tenant1.Id, includeCreator: false)).Allowed.Should().BeTrue();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, tenantAdminId, TestData.Tenant1.Id, includeCreator: false)).Allowed.Should().BeTrue();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, excludedSiteRoleId, TestData.Tenant1.Id, includeCreator: true)).Allowed.Should().BeFalse(
            "Laravel grants only super_admin, admin, and tenant_admin here");
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, flagOnlyId, TestData.Tenant1.Id, includeCreator: true)).Allowed.Should().BeFalse(
            "standalone ASP.NET privilege flags do not broaden Laravel's exact role contract");
        (await service.EvaluateOpportunityAccessAsync(
            inactiveCreatorOpportunityId,
            inactiveCreatorId,
            TestData.Tenant1.Id,
            includeCreator: true)).Allowed.Should().BeFalse();
        (await service.EvaluateOpportunityAccessAsync(
            opportunityId, TestData.OtherTenantUser.Id, TestData.Tenant1.Id, includeCreator: true)).Allowed.Should().BeFalse();

        var hidden = await service.EvaluateOpportunityAccessAsync(
            opportunityId,
            TestData.OtherTenantUser.Id,
            TestData.Tenant2.Id,
            includeCreator: true);
        hidden.Exists.Should().BeFalse();
        hidden.Allowed.Should().BeFalse();

        var inactiveCreate = await service.CreateAsync(
            TestData.Tenant1.Id,
            inactiveCreatorId,
            new VolunteerOrganisationCreateCommand(
                "Inactive Owner Hub",
                "A sufficiently detailed inactive owner description.",
                "inactive-owner@example.test",
                "https://inactive-owner.example.test"),
            activate: false);
        inactiveCreate.Success.Should().BeFalse();
        inactiveCreate.Error!.Code.Should().Be("FORBIDDEN");
    }

    [Fact]
    public async Task DeleteOpportunity_RequiresMappedOrganisationAndManager()
    {
        int opportunityId;
        int unmappedOpportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisation = NewOrganisation(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Delete Authorization Hub",
                "active");
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();

            var opportunity = new VolunteerOpportunity
            {
                TenantId = TestData.Tenant1.Id,
                OrganizerId = TestData.MemberUser.Id,
                VolunteerOrganisationId = organisation.Id,
                Title = "Protected destructive action",
                Status = OpportunityStatus.Published,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOpportunities.Add(opportunity);
            var unmappedOpportunity = new VolunteerOpportunity
            {
                TenantId = TestData.Tenant1.Id,
                OrganizerId = TestData.AdminUser.Id,
                Title = "Legacy unmapped destructive action",
                Status = OpportunityStatus.Published,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOpportunities.Add(unmappedOpportunity);
            await db.SaveChangesAsync();
            opportunityId = opportunity.Id;
            unmappedOpportunityId = unmappedOpportunity.Id;
        }

        await AuthenticateAsMemberAsync();
        using (var forbidden = await Client.DeleteAsync(
                   $"/api/v2/volunteering/opportunities/{opportunityId}"))
        {
            forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(forbidden)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("FORBIDDEN");
        }

        using (var verifyScope = Factory.Services.CreateScope())
        {
            var stored = await verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>()
                .VolunteerOpportunities.IgnoreQueryFilters()
                .SingleAsync(row => row.Id == opportunityId);
            stored.Status.Should().Be(OpportunityStatus.Published);
        }

        await AuthenticateAsAdminAsync();
        using (var hidden = await Client.DeleteAsync(
                   $"/api/v2/volunteering/opportunities/{unmappedOpportunityId}"))
        {
            hidden.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await ReadJsonAsync(hidden)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("NOT_FOUND");
        }

        using var deleted = await Client.DeleteAsync(
            $"/api/v2/volunteering/opportunities/{opportunityId}");
        deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var finalScope = Factory.Services.CreateScope();
        var cancelled = await finalScope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .VolunteerOpportunities.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == opportunityId);
        cancelled.Status.Should().Be(OpportunityStatus.Cancelled);
        var unmapped = await finalScope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .VolunteerOpportunities.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == unmappedOpportunityId);
        unmapped.Status.Should().Be(OpportunityStatus.Published);
    }

    private static object ValidCreate(string name) => new
    {
        name,
        description = "A detailed description long enough for the volunteer organisation.",
        contact_email = "coordinator@example.test",
        website = "https://helpers.example.test"
    };

    private static VolunteerOrganisation NewOrganisation(
        int tenantId,
        int ownerId,
        string name,
        string status) => new()
    {
        TenantId = tenantId,
        OwnerUserId = ownerId,
        Name = name,
        Slug = name.ToLowerInvariant().Replace(' ', '-') + "-" + Guid.NewGuid().ToString("N"),
        Description = "Dedicated volunteer organisation test fixture.",
        ContactEmail = "fixture@example.test",
        Status = status,
        CreatedAt = DateTime.UtcNow
    };

    private VolunteerOrganisationMember NewMember(
        int organisationId,
        int userId,
        string role,
        string status) => new()
    {
        TenantId = TestData.Tenant1.Id,
        VolunteerOrganisationId = organisationId,
        UserId = userId,
        Role = role,
        Status = status,
        CreatedAt = DateTime.UtcNow
    };

    private static User NewUser(string prefix, int tenantId, string role) => new()
    {
        TenantId = tenantId,
        Email = $"{prefix}-{Guid.NewGuid():N}@test.local",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
        FirstName = "Volunteer",
        LastName = "Manager",
        Role = role,
        IsActive = true,
        RegistrationStatus = RegistrationStatus.Active,
        CreatedAt = DateTime.UtcNow
    };

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }
}
