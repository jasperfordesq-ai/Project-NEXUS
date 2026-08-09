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
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class GroupQaMutationLifecycleTests : IntegrationTestBase
{
    public GroupQaMutationLifecycleTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Mutations_EnforceAuthorshipMaintainCountersAndCascadeTenantScopedState()
    {
        int groupId;
        int questionId;
        int adminAnswerId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var group = new Group
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                Name = "Q&A lifecycle group"
            };
            db.Groups.Add(group);
            await db.SaveChangesAsync();
            groupId = group.Id;
            db.GroupMembers.AddRange(
                new GroupMember { TenantId = TestData.Tenant1.Id, GroupId = groupId, UserId = TestData.AdminUser.Id, Role = Group.Roles.Owner },
                new GroupMember { TenantId = TestData.Tenant1.Id, GroupId = groupId, UserId = TestData.MemberUser.Id, Role = Group.Roles.Member });
            var question = new GroupQuestion
            {
                TenantId = TestData.Tenant1.Id,
                GroupId = groupId,
                AuthorUserId = TestData.MemberUser.Id,
                Title = "Original question",
                Body = "Original body",
                AnswerCount = 1
            };
            db.GroupQuestions.Add(question);
            await db.SaveChangesAsync();
            questionId = question.Id;
            var adminAnswer = new GroupAnswer
            {
                TenantId = TestData.Tenant1.Id,
                QuestionId = questionId,
                AuthorUserId = TestData.AdminUser.Id,
                Body = "Administrator answer"
            };
            db.GroupAnswers.Add(adminAnswer);
            await db.SaveChangesAsync();
            adminAnswerId = adminAnswer.Id;
        }

        await AuthenticateAsMemberAsync();
        var updateQuestion = await Client.PutAsJsonAsync($"/api/groups/{groupId}/questions/{questionId}", new
        {
            title = "Updated member question",
            body = "Updated member body"
        });
        updateQuestion.StatusCode.Should().Be(HttpStatusCode.OK);

        var forbiddenAnswerUpdate = await Client.PutAsJsonAsync($"/api/groups/{groupId}/answers/{adminAnswerId}", new
        {
            body = "Member cannot replace this"
        });
        await AssertErrorAsync(forbiddenAnswerUpdate, HttpStatusCode.Forbidden, "FORBIDDEN");

        var createAnswer = await Client.PostAsJsonAsync($"/api/groups/{groupId}/questions/{questionId}/answers", new
        {
            body = "Member answer to accept"
        });
        createAnswer.StatusCode.Should().Be(HttpStatusCode.OK);
        var createdBody = await createAnswer.Content.ReadFromJsonAsync<JsonElement>();
        var memberAnswerId = createdBody.GetProperty("data").GetProperty("id").GetInt32();

        var accept = await Client.PostAsync($"/api/groups/{groupId}/answers/{memberAnswerId}/accept", null);
        accept.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var addVote = Factory.Services.CreateScope())
        {
            var db = addVote.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.GroupQaVotes.Add(new GroupQaVote
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                TargetType = "answer",
                TargetId = memberAnswerId,
                Value = 1
            });
            await db.SaveChangesAsync();
        }

        var deleteAccepted = await Client.DeleteAsync($"/api/groups/{groupId}/answers/{memberAnswerId}");
        deleteAccepted.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var verifyAnswerDelete = Factory.Services.CreateScope())
        {
            var db = verifyAnswerDelete.ServiceProvider.GetRequiredService<NexusDbContext>();
            var question = await db.GroupQuestions.IgnoreQueryFilters().SingleAsync(row => row.Id == questionId);
            question.AcceptedAnswerId.Should().BeNull();
            question.AnswerCount.Should().Be(1);
            (await db.GroupAnswers.IgnoreQueryFilters().AnyAsync(row => row.Id == memberAnswerId)).Should().BeFalse();
            (await db.GroupQaVotes.IgnoreQueryFilters().AnyAsync(row => row.TargetType == "answer" && row.TargetId == memberAnswerId)).Should().BeFalse();
        }

        await AuthenticateAsOtherTenantUserAsync();
        var hidden = await Client.DeleteAsync($"/api/groups/{groupId}/questions/{questionId}");
        await AssertErrorAsync(hidden, HttpStatusCode.NotFound, "NOT_FOUND");

        await AuthenticateAsAdminAsync();
        var managerDelete = await Client.DeleteAsync($"/api/groups/{groupId}/questions/{questionId}");
        managerDelete.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.GroupQuestions.IgnoreQueryFilters().AnyAsync(row => row.Id == questionId)).Should().BeFalse();
        (await verifyDb.GroupAnswers.IgnoreQueryFilters().AnyAsync(row => row.QuestionId == questionId)).Should().BeFalse();
        (await verifyDb.GroupQaVotes.IgnoreQueryFilters().AnyAsync(row =>
            row.TargetType == "question" && row.TargetId == questionId
            || row.TargetType == "answer" && row.TargetId == adminAnswerId)).Should().BeFalse();
    }

    [Fact]
    public async Task MutationRoutes_HaveExactlyOneAuthenticatedOwner()
    {
        var routes = new[]
        {
            (HttpMethod.Put, "/api/groups/991/questions/992"),
            (HttpMethod.Delete, "/api/groups/991/questions/992"),
            (HttpMethod.Put, "/api/groups/991/answers/993"),
            (HttpMethod.Delete, "/api/groups/991/answers/993")
        };
        ClearAuthToken();
        foreach (var (method, path) in routes)
        {
            using var request = new HttpRequestMessage(method, path)
            {
                Content = method == HttpMethod.Put ? JsonContent.Create(new { title = "Valid title", body = "Valid body" }) : null
            };
            var response = await Client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
    }

    private static async Task AssertErrorAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        response.StatusCode.Should().Be(status);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
    }
}
