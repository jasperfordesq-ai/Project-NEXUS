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
public class CompatibilityAliasControllerTests : IntegrationTestBase
{
    public CompatibilityAliasControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SharePost_PersistsShare()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/feed/posts", new
        {
            content = "Compatibility share test"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var postId = created.GetProperty("id").GetInt32();

        var share = await Client.PostAsJsonAsync($"/api/feed/posts/{postId}/share", new
        {
            shared_to = "copy_link"
        });
        share.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await share.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetProperty("shared_to").GetString().Should().Be("copy_link");
    }

    [Fact]
    public async Task FeedLikeAlias_PersistsPostLike()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/feed/like", new
        {
            post_id = TestData.Listing1.Id
        });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var create = await Client.PostAsJsonAsync("/api/feed/posts", new
        {
            content = "Compatibility like test"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var postId = created.GetProperty("id").GetInt32();

        response = await Client.PostAsJsonAsync("/api/feed/like", new
        {
            post_id = postId
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var persisted = db.PostLikes.SingleOrDefault(l => l.PostId == postId && l.UserId == TestData.MemberUser.Id);
        persisted.Should().NotBeNull();
    }

    [Fact]
    public async Task FeedModerationAliases_PersistHideMuteAndReport()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/feed/posts", new
        {
            content = "Compatibility moderation test"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var postId = created.GetProperty("id").GetInt32();

        (await Client.PostAsync($"/api/feed/posts/{postId}/hide", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsJsonAsync($"/api/feed/posts/{postId}/report", new
        {
            reason = "spam",
            details = "compatibility test report"
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsync($"/api/feed/users/{TestData.AdminUser.Id}/mute", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.HiddenPosts.Any(h => h.PostId == postId && h.UserId == TestData.MemberUser.Id).Should().BeTrue();
        db.FeedReports.Any(r => r.PostId == postId && r.ReporterId == TestData.MemberUser.Id && r.Reason == "spam").Should().BeTrue();
        db.MutedUsers.Any(m => m.UserId == TestData.MemberUser.Id && m.MutedUserId == TestData.AdminUser.Id).Should().BeTrue();
    }

    [Fact]
    public async Task TeamTaskAliases_PersistCreateUpdateAndDelete()
    {
        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var group = new Group
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.MemberUser.Id,
                Name = "Compatibility task group",
                CreatedAt = DateTime.UtcNow
            };
            db.Groups.Add(group);
            await db.SaveChangesAsync();

            db.GroupMembers.Add(new GroupMember
            {
                TenantId = TestData.Tenant1.Id,
                GroupId = group.Id,
                UserId = TestData.MemberUser.Id,
                Role = Group.Roles.Owner,
                JoinedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            groupId = group.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync($"/api/groups/{groupId}/tasks", new
        {
            title = "Persisted task",
            status = "open"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var taskId = content.GetProperty("id").GetInt32();

        (await Client.PutAsJsonAsync($"/api/team-tasks/{taskId}", new
        {
            title = "Updated task",
            status = "done"
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = db.TenantConfigs.Single(c => c.Id == taskId);
            stored.Key.Should().StartWith("compat:group-task:");
            stored.Value.Should().Contain("\"title\":\"Updated task\"");
            stored.Value.Should().Contain("\"status\":\"done\"");
        }

        (await Client.DeleteAsync($"/api/team-tasks/{taskId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        verifyDb.TenantConfigs.Any(c => c.Id == taskId).Should().BeFalse();
    }

    [Fact]
    public async Task FederationConnectionAction_UpdatesPersistedPartner()
    {
        int partnerId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            partnerId = db.FederationPartners.Single(p =>
                p.TenantId == TestData.Tenant1.Id &&
                p.PartnerTenantId == TestData.Tenant2.Id).Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsync($"/api/federation/connections/{partnerId}/suspend", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var partner = verifyDb.FederationPartners.Single(p => p.Id == partnerId);
        partner.Status.Should().Be(PartnerStatus.Suspended);
    }

    [Fact]
    public async Task CommunityProjectPersistsButHoursAliasRejectsObsoleteShiftPayloadWithoutAttendanceMutation()
    {
        await AuthenticateAsMemberAsync();

        var projectResponse = await Client.PostAsJsonAsync("/api/volunteering/community-projects", new
        {
            title = "Compatibility volunteer project",
            description = "Created by alias",
            required_volunteers = 2,
            publish = true
        });
        projectResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var projectJson = await projectResponse.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = projectJson.GetProperty("id").GetInt32();

        int shiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var shift = new VolunteerShift
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = projectId,
                Title = "Alias shift",
                StartsAt = DateTime.UtcNow.AddHours(-2),
                EndsAt = DateTime.UtcNow,
                MaxVolunteers = 5,
                Status = ShiftStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
        }

        var hoursResponse = await Client.PostAsJsonAsync("/api/volunteering/hours", new
        {
            shift_id = shiftId,
            hours = 1.5m,
            notes = "alias hours"
        });

        hoursResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var hoursJson = await hoursResponse.Content.ReadFromJsonAsync<JsonElement>();
        var errors = hoursJson.GetProperty("errors").EnumerateArray().ToArray();
        errors.Should().HaveCount(2);
        errors.Should().OnlyContain(error =>
            error.GetProperty("code").GetString() == "VALIDATION_ERROR");
        errors.Select(error => error.GetProperty("field").GetString())
            .Should().BeEquivalentTo("organization_id", "date");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        verifyDb.VolunteerOpportunities.Any(o => o.Id == projectId && o.Title == "Compatibility volunteer project").Should().BeTrue();
        verifyDb.VolunteerCheckIns.Any(c =>
            c.ShiftId == shiftId
            && c.UserId == TestData.MemberUser.Id).Should().BeFalse();
    }

    [Fact]
    public async Task TypingIndicator_ForParticipant_ReturnsOk()
    {
        int conversationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var conversation = new Conversation
            {
                TenantId = TestData.Tenant1.Id,
                Participant1Id = TestData.MemberUser.Id,
                Participant2Id = TestData.AdminUser.Id,
                CreatedAt = DateTime.UtcNow
            };
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync();
            conversationId = conversation.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/messages/typing", new
        {
            conversation_id = conversationId,
            is_typing = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ConversationArchiveAliases_UsePartnerIdAndPersistPerMessageState()
    {
        int conversationId;
        int memberSentMessageId;
        int adminSentMessageId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var conversation = new Conversation
            {
                TenantId = TestData.Tenant1.Id,
                Participant1Id = Math.Min(TestData.MemberUser.Id, TestData.AdminUser.Id),
                Participant2Id = Math.Max(TestData.MemberUser.Id, TestData.AdminUser.Id),
                CreatedAt = DateTime.UtcNow
            };
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync();
            conversationId = conversation.Id;

            var memberSentMessage = new Message
            {
                TenantId = TestData.Tenant1.Id,
                ConversationId = conversation.Id,
                SenderId = TestData.MemberUser.Id,
                Content = "Member message retained by archive",
                CreatedAt = DateTime.UtcNow.AddMinutes(-1)
            };
            var adminSentMessage = new Message
            {
                TenantId = TestData.Tenant1.Id,
                ConversationId = conversation.Id,
                SenderId = TestData.AdminUser.Id,
                Content = "Admin message retained by archive",
                CreatedAt = DateTime.UtcNow
            };
            db.Messages.AddRange(memberSentMessage, adminSentMessage);
            await db.SaveChangesAsync();
            memberSentMessageId = memberSentMessage.Id;
            adminSentMessageId = adminSentMessage.Id;
        }

        await AuthenticateAsMemberAsync();

        var archive = await Client.DeleteAsync($"/api/messages/conversations/{TestData.AdminUser.Id}");
        archive.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var messages = await db.Messages.IgnoreQueryFilters()
                .Where(message => message.ConversationId == conversationId)
                .ToListAsync();
            messages.Should().HaveCount(2, "archiving must not hard-delete conversation history");
            messages.Single(message => message.Id == memberSentMessageId)
                .ArchivedBySender.Should().NotBeNull();
            messages.Single(message => message.Id == adminSentMessageId)
                .ArchivedByReceiver.Should().NotBeNull();
        }

        var restore = await Client.PostAsync(
            $"/api/messages/conversations/{TestData.AdminUser.Id}/restore",
            null);
        restore.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var messages = await db.Messages.IgnoreQueryFilters()
                .Where(message => message.ConversationId == conversationId)
                .ToListAsync();
            messages.Should().HaveCount(2, "restoring must not replace or delete conversation history");
            messages.Single(message => message.Id == memberSentMessageId)
                .ArchivedBySender.Should().BeNull();
            messages.Single(message => message.Id == adminSentMessageId)
                .ArchivedByReceiver.Should().BeNull();
        }

        (await Client.DeleteAsync($"/api/chatrooms/{conversationId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task JobAlertAliases_UpdateNotificationFlag()
    {
        int alertId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var alert = new SavedSearch
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Name = "Job alert: gardening",
                SearchType = "job_alert",
                QueryJson = """{"keywords":"gardening"}""",
                NotifyOnNewResults = true,
                CreatedAt = DateTime.UtcNow
            };
            db.SavedSearches.Add(alert);
            await db.SaveChangesAsync();
            alertId = alert.Id;
        }

        await AuthenticateAsMemberAsync();

        (await Client.PutAsync($"/api/jobs/alerts/{alertId}/unsubscribe", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.SavedSearches.Single(s => s.Id == alertId).NotifyOnNewResults.Should().BeFalse();
        }

        (await Client.PutAsync($"/api/jobs/alerts/{alertId}/resubscribe", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        verifyDb.SavedSearches.Single(s => s.Id == alertId).NotifyOnNewResults.Should().BeTrue();
    }

    [Fact]
    public async Task JobApplicationAlias_UpdatesPersistedApplication()
    {
        int applicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var job = new JobVacancy
            {
                TenantId = TestData.Tenant1.Id,
                PostedByUserId = TestData.AdminUser.Id,
                Title = "Alias job",
                Category = "community",
                Status = "active",
                CreatedAt = DateTime.UtcNow
            };
            db.JobVacancies.Add(job);
            await db.SaveChangesAsync();

            var application = new JobApplication
            {
                TenantId = TestData.Tenant1.Id,
                JobId = job.Id,
                ApplicantUserId = TestData.MemberUser.Id,
                CoverLetter = "before",
                Status = "pending",
                CreatedAt = DateTime.UtcNow
            };
            db.JobApplications.Add(application);
            await db.SaveChangesAsync();
            applicationId = application.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync($"/api/jobs/applications/{applicationId}", new
        {
            cover_letter = "updated cover",
            status = "withdrawn"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var persisted = verifyDb.JobApplications.Single(a => a.Id == applicationId);
        persisted.CoverLetter.Should().Be("updated cover");
        persisted.Status.Should().Be("withdrawn");
    }

    [Fact]
    public async Task SubAccountAndSkillAliases_RequireChildApprovalAndPersistState()
    {
        int skillId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var skill = new Skill
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Alias Carpentry",
                Slug = "alias-carpentry",
                CreatedAt = DateTime.UtcNow
            };
            db.Skills.Add(skill);
            await db.SaveChangesAsync();
            skillId = skill.Id;
        }

        await AuthenticateAsMemberAsync();

        var subAccountResponse = await Client.PostAsJsonAsync("/api/users/me/sub-accounts", new
        {
            sub_user_id = TestData.AdminUser.Id,
            relationship = "managed",
            can_message = false
        });
        subAccountResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var subAccountJson = await subAccountResponse.Content.ReadFromJsonAsync<JsonElement>();
        var pendingRelationship = subAccountJson.GetProperty("data").EnumerateArray().Single();
        pendingRelationship.GetProperty("status").GetString().Should().Be("pending");
        var subAccountId = pendingRelationship.GetProperty("relationship_id").GetInt32();

        var prematurePermissionUpdate = await Client.PutAsJsonAsync($"/api/users/me/sub-accounts/{subAccountId}/permissions", new
        {
            can_transact = false,
            can_message = true,
            can_join_groups = false
        });
        prematurePermissionUpdate.StatusCode.Should().Be(HttpStatusCode.NotFound);

        await AuthenticateAsAdminAsync();
        (await Client.PutAsync($"/api/users/me/sub-accounts/{subAccountId}/approve", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsMemberAsync();
        (await Client.PutAsJsonAsync($"/api/users/me/sub-accounts/{subAccountId}/permissions", new
        {
            can_transact = false,
            can_message = true,
            can_join_groups = false
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        var skillResponse = await Client.PostAsJsonAsync("/api/users/me/skills", new
        {
            skill_id = skillId,
            proficiency_level = "advanced"
        });
        skillResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var subAccount = db.SubAccounts.Single(s => s.Id == subAccountId);
            subAccount.CanTransact.Should().BeFalse();
            subAccount.CanMessage.Should().BeTrue();
            subAccount.CanJoinGroups.Should().BeFalse();

            db.UserSkills.Any(us =>
                us.UserId == TestData.MemberUser.Id &&
                us.SkillId == skillId &&
                us.ProficiencyLevel == SkillLevel.Advanced).Should().BeTrue();
        }

        (await Client.DeleteAsync($"/api/users/me/skills/{skillId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        verifyDb.UserSkills.Any(us => us.UserId == TestData.MemberUser.Id && us.SkillId == skillId).Should().BeFalse();
    }

    [Fact]
    public async Task CommentReactionAndFeedAnalyticsAliases_PersistState()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/feed/posts", new
        {
            content = "Compatibility analytics test"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var postId = created.GetProperty("id").GetInt32();
        int commentId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var comment = new PostComment
            {
                TenantId = TestData.Tenant1.Id,
                PostId = postId,
                UserId = TestData.AdminUser.Id,
                Content = "React to this",
                CreatedAt = DateTime.UtcNow
            };
            db.PostComments.Add(comment);
            await db.SaveChangesAsync();
            commentId = comment.Id;
        }

        (await Client.PostAsJsonAsync($"/api/comments/{commentId}/reactions", new
        {
            type = "love"
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsync($"/api/feed/posts/{postId}/click", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsync($"/api/feed/posts/{postId}/impression", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var reaction = verifyDb.TenantConfigs.Single(c =>
            c.Key == $"compat:comment-reaction:{commentId}:{TestData.MemberUser.Id}");
        reaction.Value.Should().Contain("\"reaction_type\":\"love\"");
        verifyDb.UserInteractions.Any(i =>
            i.UserId == TestData.MemberUser.Id &&
            i.TargetType == "feed_post" &&
            i.TargetId == postId &&
            i.InteractionType == "click").Should().BeTrue();
        verifyDb.UserInteractions.Any(i =>
            i.UserId == TestData.MemberUser.Id &&
            i.TargetType == "feed_post" &&
            i.TargetId == postId &&
            i.InteractionType == "view").Should().BeTrue();
    }

    [Fact]
    public async Task FederationMessageReadAlias_PersistsTenantScopedMarker()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsync("/api/federation/messages/42/mark-read", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var marker = db.TenantConfigs.Single(c =>
            c.Key == $"compat:fed-msg-read:42:{TestData.MemberUser.Id}" &&
            c.TenantId == TestData.Tenant1.Id);
        marker.Value.Should().Contain("\"read_at\"");
    }

    [Fact]
    public async Task VolunteeringCompatibilityAliases_PersistMetadataAndSupport()
    {
        await AuthenticateAsMemberAsync();

        var projectResponse = await Client.PostAsJsonAsync("/api/volunteering/community-projects", new
        {
            title = "Supported compatibility project",
            description = "Project support alias test",
            publish = true
        });
        projectResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var projectJson = await projectResponse.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = projectJson.GetProperty("id").GetInt32();

        (await Client.PostAsync($"/api/volunteering/community-projects/{projectId}/support", null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.DeleteAsync($"/api/volunteering/community-projects/{projectId}/support"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (string Url, object Body)[] metadataPosts =
        {
            ("/api/volunteering/certificates", new { name = "Safeguarding cert" }),
            ("/api/volunteering/donations", new { amount = 12.50m, currency = "EUR" }),
            ("/api/volunteering/expenses", new { amount = 4.25m, category = "travel" }),
            ("/api/volunteering/incidents", new { summary = "Minor incident" }),
            ("/api/volunteering/training", new { course = "First aid" }),
            ("/api/volunteering/wellbeing/checkin", new { mood = "ok" })
        };

        foreach (var (url, body) in metadataPosts)
        {
            var response = await Client.PostAsJsonAsync(url, body);
            response.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        (await Client.PutAsJsonAsync("/api/volunteering/accessibility-needs", new
        {
            notes = "Step-free access"
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.TenantConfigs.Single(c => c.Key == $"compat:vol-support:{projectId}:{TestData.MemberUser.Id}")
            .Value.Should().Contain("\"supported\":false");
        db.TenantConfigs.Any(c => c.Key.StartsWith("compat:vol-cert:")).Should().BeTrue();
        db.TenantConfigs.Any(c => c.Key.StartsWith("compat:vol-donation:")).Should().BeTrue();
        db.TenantConfigs.Any(c => c.Key.StartsWith("compat:vol-expense:")).Should().BeTrue();
        db.TenantConfigs.Any(c => c.Key.StartsWith("compat:vol-incident:")).Should().BeTrue();
        db.TenantConfigs.Any(c => c.Key.StartsWith("compat:vol-training:")).Should().BeTrue();
        db.TenantConfigs.Any(c => c.Key.StartsWith("compat:vol-wellbeing:")).Should().BeTrue();
        db.TenantConfigs.Single(c => c.Key == $"compat:vol-access:{TestData.MemberUser.Id}")
            .Value.Should().Contain("Step-free access");
    }

    [Fact]
    public async Task EmergencyAlertCompatibilityAlias_UpdatesPersistedAlert()
    {
        int alertId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var alert = new EmergencyAlert
            {
                TenantId = TestData.Tenant1.Id,
                Title = "Original alert",
                Description = "Original description",
                Urgency = "medium",
                CreatedById = TestData.AdminUser.Id,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.EmergencyAlerts.Add(alert);
            await db.SaveChangesAsync();
            alertId = alert.Id;
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync($"/api/volunteering/emergency-alerts/{alertId}", new
        {
            title = "Updated alert",
            description = "Updated description",
            urgency = "critical",
            contact_info = "admin@example.test",
            status = "resolved"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var persisted = verifyDb.EmergencyAlerts.Single(a => a.Id == alertId);
        persisted.Title.Should().Be("Updated alert");
        persisted.Description.Should().Be("Updated description");
        persisted.Urgency.Should().Be("critical");
        persisted.ContactInfo.Should().Be("admin@example.test");
        persisted.IsActive.Should().BeFalse();
        persisted.ResolvedById.Should().Be(TestData.AdminUser.Id);
        persisted.ResolvedAt.Should().NotBeNull();
    }
}
