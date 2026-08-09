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
public sealed class GroupFormLifecycleTests : IntegrationTestBase
{
    public GroupFormLifecycleTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CapabilitiesAndMultipartSettings_AreTypedTenantScopedAndManageTwoImages()
    {
        int groupId;
        int parentId;
        int typeId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var parent = NewGroup("Parent group");
            var group = NewGroup("Editable group");
            db.Groups.AddRange(parent, group);
            var type = new GroupType
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Community",
                Slug = "community",
                Description = "Community group",
                Icon = "users",
                Color = "#112233",
                IsActive = true,
                SortOrder = 1
            };
            db.GroupTypes.Add(type);
            db.GroupTemplates.Add(new GroupTemplate
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Neighbourhood",
                DefaultVisibility = "private",
                DefaultTagsJson = "[3,5]",
                FeaturesJson = "{\"qa\":true}",
                IsActive = true
            });
            await db.SaveChangesAsync();
            groupId = group.Id;
            parentId = parent.Id;
            typeId = type.Id;
            db.GroupMembers.AddRange(
                Owner(parentId, TestData.AdminUser.Id),
                Owner(groupId, TestData.AdminUser.Id),
                new GroupMember { TenantId = TestData.Tenant1.Id, GroupId = groupId, UserId = TestData.MemberUser.Id, Role = Group.Roles.Member });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var capabilities = await Client.GetAsync("/api/v2/groups/form-capabilities");
        capabilities.StatusCode.Should().Be(HttpStatusCode.OK);
        var capabilityBody = await capabilities.Content.ReadFromJsonAsync<JsonElement>();
        var data = capabilityBody.GetProperty("data");
        data.GetProperty("allowed_visibility").EnumerateArray().Select(item => item.GetString())
            .Should().Equal("public", "private", "secret");
        data.GetProperty("group_types")[0].GetProperty("id").GetInt32().Should().Be(typeId);
        data.GetProperty("templates")[0].GetProperty("default_tags").GetArrayLength().Should().Be(2);
        data.GetProperty("parent_candidates").EnumerateArray().Select(item => item.GetProperty("id").GetInt32())
            .Should().Contain(parentId);
        data.GetProperty("fields").GetProperty("cover").GetBoolean().Should().BeTrue();

        using var form = new MultipartFormDataContent();
        Add(form, "name", "Updated editable group");
        Add(form, "description", "A sufficiently detailed group description.");
        Add(form, "visibility", "private");
        Add(form, "location", "Dublin 8");
        Add(form, "latitude", "53.33700000");
        Add(form, "longitude", "-6.28600000");
        Add(form, "type_id", typeId.ToString());
        Add(form, "parent_id", parentId.ToString());
        Add(form, "primary_color", "#abcdef");
        Add(form, "accent_color", "#123456");
        Add(form, "avatar_action", "replace");
        Add(form, "cover_action", "replace");
        AddImage(form, "avatar", "avatar.png");
        AddImage(form, "cover", "cover.png");
        var update = await Client.PostAsync($"/api/v2/groups/{groupId}/settings", form);
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateBody = await update.Content.ReadFromJsonAsync<JsonElement>();
        var saved = updateBody.GetProperty("data");
        saved.GetProperty("visibility").GetString().Should().Be("private");
        saved.GetProperty("image_url").GetString().Should().MatchRegex("^/api/files/[0-9]+/download$");
        saved.GetProperty("cover_image_url").GetString().Should().MatchRegex("^/api/files/[0-9]+/download$");

        await AuthenticateAsMemberAsync();
        using var forbiddenForm = MinimalForm("Member cannot edit this group");
        var forbidden = await Client.PostAsync($"/api/v2/groups/{groupId}/settings", forbiddenForm);
        await AssertErrorAsync(forbidden, HttpStatusCode.Forbidden, "FORBIDDEN");

        await AuthenticateAsAdminAsync();
        var removeCover = await Client.DeleteAsync($"/api/v2/groups/{groupId}/image?type=cover");
        removeCover.StatusCode.Should().Be(HttpStatusCode.OK);
        var removeAvatar = await Client.DeleteAsync($"/api/v2/groups/{groupId}/image?type=avatar");
        removeAvatar.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Groups.IgnoreQueryFilters().SingleAsync(row => row.Id == groupId);
        stored.Name.Should().Be("Updated editable group");
        stored.Visibility.Should().Be("private");
        stored.IsPrivate.Should().BeTrue();
        stored.ParentId.Should().Be(parentId);
        stored.TypeId.Should().Be(typeId);
        stored.PrimaryColor.Should().Be("#ABCDEF");
        stored.ImageUrl.Should().BeNull();
        stored.CoverImageUrl.Should().BeNull();
        (await verifyDb.FileUploads.IgnoreQueryFilters().CountAsync(row => row.EntityType == "group" && row.EntityId == groupId))
            .Should().Be(0);
    }

    [Fact]
    public async Task Settings_RejectInvalidActionsAndCrossTenantTargets()
    {
        int groupId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var group = NewGroup("Validation group");
            db.Groups.Add(group);
            await db.SaveChangesAsync();
            groupId = group.Id;
            db.GroupMembers.Add(Owner(groupId, TestData.AdminUser.Id));
            await db.SaveChangesAsync();
        }
        await AuthenticateAsAdminAsync();
        using var invalid = new MultipartFormDataContent();
        Add(invalid, "name", "Validation group updated");
        Add(invalid, "description", "A sufficiently detailed group description.");
        Add(invalid, "visibility", "public");
        Add(invalid, "avatar_action", "erase");
        Add(invalid, "cover_action", "keep");
        var invalidResponse = await Client.PostAsync($"/api/v2/groups/{groupId}/settings", invalid);
        await AssertErrorAsync(invalidResponse, HttpStatusCode.UnprocessableEntity, "VALIDATION_ERROR");

        await AuthenticateAsOtherTenantUserAsync();
        var hidden = await Client.DeleteAsync($"/api/v2/groups/{groupId}/image");
        await AssertErrorAsync(hidden, HttpStatusCode.NotFound, "NOT_FOUND");
    }

    private Group NewGroup(string name) => new()
    {
        TenantId = TestData.Tenant1.Id,
        CreatedById = TestData.AdminUser.Id,
        Name = name,
        Visibility = "public",
        IsActive = true
    };

    private GroupMember Owner(int groupId, int userId) => new()
    {
        TenantId = TestData.Tenant1.Id,
        GroupId = groupId,
        UserId = userId,
        Role = Group.Roles.Owner
    };

    private static MultipartFormDataContent MinimalForm(string name)
    {
        var form = new MultipartFormDataContent();
        Add(form, "name", name);
        Add(form, "description", "A sufficiently detailed group description.");
        Add(form, "visibility", "public");
        Add(form, "avatar_action", "keep");
        Add(form, "cover_action", "keep");
        return form;
    }

    private static void Add(MultipartFormDataContent form, string name, string value) =>
        form.Add(new StringContent(value, Encoding.UTF8), name);

    private static void AddImage(MultipartFormDataContent form, string name, string filename)
    {
        var content = new ByteArrayContent([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
        ]);
        content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(content, name, filename);
    }

    private static async Task AssertErrorAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        response.StatusCode.Should().Be(status);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
    }
}
