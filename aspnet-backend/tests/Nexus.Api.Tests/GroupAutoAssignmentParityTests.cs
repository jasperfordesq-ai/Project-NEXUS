// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class GroupAutoAssignmentParityTests : IntegrationTestBase
{
    public GroupAutoAssignmentParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Lifecycle_PersistsPartialUpdatesCanonicalProjectionAndAuditHistory()
    {
        var (firstGroupId, secondGroupId, _) = await SeedGroupsAsync();
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/group-auto-assign-rules", new
        {
            group_id = firstGroupId,
            rule_type = "location",
            rule_value = "Dublin"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var ruleId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32();

        var listed = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/group-auto-assign-rules");
        var initial = listed.GetProperty("data").EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == ruleId);
        initial.GetProperty("group_id").GetInt32().Should().Be(firstGroupId);
        initial.GetProperty("group_name").GetString().Should().Be("Auto assignment one");
        initial.GetProperty("is_active").GetBoolean().Should().BeTrue();

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}", new
        {
            group_id = secondGroupId,
            rule_type = "interest",
            rule_value = "gardening",
            is_active = false
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32().Should().Be(ruleId);

        listed = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/group-auto-assign-rules");
        var changed = listed.GetProperty("data").EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == ruleId);
        changed.GetProperty("group_id").GetInt32().Should().Be(secondGroupId);
        changed.GetProperty("group_name").GetString().Should().Be("Auto assignment two");
        changed.GetProperty("rule_type").GetString().Should().Be("interest");
        changed.GetProperty("rule_value").GetString().Should().Be("gardening");
        changed.GetProperty("is_active").GetBoolean().Should().BeFalse();

        (await Client.DeleteAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.DeleteAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.GroupAutoAssignRules.IgnoreQueryFilters().AnyAsync(x => x.Id == ruleId)).Should().BeFalse();
        var actions = await db.AuditLogs.IgnoreQueryFilters()
            .Where(x => x.TenantId == TestData.Tenant1.Id && x.EntityType == "group_auto_assign_rule" && x.EntityId == ruleId)
            .OrderBy(x => x.Id)
            .Select(x => x.Action)
            .ToListAsync();
        actions.Should().Equal(
            "admin_create_group_auto_assign_rule",
            "admin_update_group_auto_assign_rule",
            "admin_delete_group_auto_assign_rule");
    }

    [Fact]
    public async Task Mutations_RejectInvalidAndForeignInputsAndConcealPoisonedRows()
    {
        var (localGroupId, _, foreignGroupId) = await SeedGroupsAsync();
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/group-auto-assign-rules", new
        {
            group_id = localGroupId,
            rule_type = "role",
            rule_value = "member"
        });
        var ruleId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32();

        (await Client.PutAsJsonAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}", new { }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await Client.PutAsJsonAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}", new { rule_type = "unsafe" }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await Client.PutAsJsonAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}", new { rule_value = "   " }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await Client.PutAsJsonAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}", new { group_id = foreignGroupId }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var persisted = await db.GroupAutoAssignRules.IgnoreQueryFilters().SingleAsync(x => x.Id == ruleId);
            persisted.GroupId.Should().Be(localGroupId);
            persisted.RuleType.Should().Be("role");
            persisted.RuleValue.Should().Be("member");
            db.GroupAutoAssignRules.Add(new GroupAutoAssignRule
            {
                TenantId = TestData.Tenant1.Id,
                GroupId = foreignGroupId,
                RuleType = "attribute",
                RuleValue = "poisoned",
                IsActive = true
            });
            await db.SaveChangesAsync();
        }

        var listed = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/group-auto-assign-rules");
        listed.GetProperty("data").EnumerateArray()
            .Should().NotContain(x => x.GetProperty("rule_value").GetString() == "poisoned");

        await AuthenticateAsMemberAsync();
        (await Client.PutAsJsonAsync($"/api/v2/admin/group-auto-assign-rules/{ruleId}", new { is_active = false }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync("/api/v2/admin/group-auto-assign-rules")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    private async Task<(int First, int Second, int Foreign)> SeedGroupsAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var first = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Auto assignment one");
        var second = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Auto assignment two");
        var foreign = NewGroup(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Foreign private group");
        db.Groups.AddRange(first, second, foreign);
        await db.SaveChangesAsync();
        return (first.Id, second.Id, foreign.Id);
    }

    private static Group NewGroup(int tenantId, int ownerId, string name) => new()
    {
        TenantId = tenantId,
        CreatedById = ownerId,
        Name = name,
        Description = name,
        Visibility = "private",
        Status = "active",
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };
}
