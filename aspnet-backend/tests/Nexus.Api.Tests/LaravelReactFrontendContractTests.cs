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
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class LaravelReactFrontendContractTests : IntegrationTestBase
{
    public LaravelReactFrontendContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SwReset_ReturnsBrowserRecoveryDocument()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/sw-reset");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("text/html");
        response.Headers.TryGetValues("Clear-Site-Data", out var clearSiteData).Should().BeTrue();
        clearSiteData!.Single().Should().Contain("\"cache\"");
        var html = await response.Content.ReadAsStringAsync();
        html.Should().Contain("serviceWorker");
        html.Should().Contain("caches");
    }

    [Fact]
    public async Task PartnerAnalytics_WithQueryToken_ReturnsDashboardAndReportsEnvelope()
    {
        const string token = "partner-token-contract";

        await SeedRegionalAnalyticsSubscriptionAsync(token);
        ClearAuthToken();

        var dashboard = await Client.GetAsync($"/api/partner-analytics/me/dashboard?period=last_30d&token={token}");
        dashboard.StatusCode.Should().Be(HttpStatusCode.OK);
        var dashboardJson = await dashboard.Content.ReadFromJsonAsync<JsonElement>();
        dashboardJson.GetProperty("success").GetBoolean().Should().BeTrue();
        dashboardJson.GetProperty("data").TryGetProperty("period", out _).Should().BeTrue();

        var reports = await Client.GetAsync($"/api/partner-analytics/me/reports?token={token}");
        reports.StatusCode.Should().Be(HttpStatusCode.OK);
        var reportsJson = await reports.Content.ReadFromJsonAsync<JsonElement>();
        reportsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var report = reportsJson.GetProperty("data").GetProperty("reports").EnumerateArray().Should().ContainSingle().Subject;

        var download = await Client.GetAsync($"/api/partner-analytics/me/reports/{report.GetProperty("id").GetInt64()}/download?token={token}");
        download.StatusCode.Should().Be(HttpStatusCode.OK);
        download.Content.Headers.ContentType?.MediaType.Should().Be("application/pdf");
        download.Content.Headers.ContentDisposition?.FileName.Should().Contain($"regional-analytics-{report.GetProperty("period_start").GetString()}");
        var pdf = await download.Content.ReadAsByteArrayAsync();
        pdf.Length.Should().BeGreaterThan(100);
        Encoding.UTF8.GetString(pdf[..8]).Should().Be("%PDF-1.4");
        var pdfText = Encoding.UTF8.GetString(pdf);
        pdfText.Should().Contain("PROJECT NEXUS - REGIONAL ANALYTICS REPORT");
        pdfText.Should().NotContain("Regional analytics report placeholder");
    }

    [Fact]
    public async Task AuthOAuthV2_UsesLaravelReactDefaultDisabledProviderAndIdentityShapes()
    {
        ClearAuthToken();

        var providers = await Client.GetAsync("/api/v2/auth/oauth/enabled-providers");
        var providersBody = await providers.Content.ReadAsStringAsync();

        providers.StatusCode.Should().Be(HttpStatusCode.OK, providersBody);
        var providersJson = JsonDocument.Parse(providersBody).RootElement;
        providersJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var providerList = providersJson.GetProperty("providers");
        providerList.ValueKind.Should().Be(JsonValueKind.Array);
        providerList.EnumerateArray().Should().BeEmpty("Laravel's default OAUTH_ENABLED=false kill switch should not advertise connectable providers");
        providersJson.TryGetProperty("data", out _).Should().BeFalse();

        var redirect = await Client.GetAsync($"/api/v2/auth/oauth/google/redirect?tenant_id={TestData.Tenant1.Id}&intent=login");

        redirect.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var redirectJson = await redirect.Content.ReadFromJsonAsync<JsonElement>();
        redirectJson.GetProperty("success").GetBoolean().Should().BeFalse();
        redirectJson.GetProperty("error").GetString().Should().Be("oauth_redirect_failed");

        await AuthenticateAsMemberAsync();

        var identities = await Client.GetAsync("/api/v2/auth/oauth/me/identities");

        identities.StatusCode.Should().Be(HttpStatusCode.OK);
        var identitiesJson = await identities.Content.ReadFromJsonAsync<JsonElement>();
        identitiesJson.GetProperty("success").GetBoolean().Should().BeTrue();
        identitiesJson.GetProperty("identities").ValueKind.Should().Be(JsonValueKind.Array);
        identitiesJson.GetProperty("enabled_providers").ValueKind.Should().Be(JsonValueKind.Array);
        identitiesJson.GetProperty("enabled_providers").EnumerateArray().Should().BeEmpty();
        identitiesJson.GetProperty("supported_providers").EnumerateArray()
            .Select(item => item.GetString())
            .Should()
            .Contain(["google", "apple", "facebook"]);
        identitiesJson.TryGetProperty("data", out _).Should().BeFalse();

        var link = await Client.PostAsJsonAsync("/api/v2/auth/oauth/google/link", new { });

        link.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var linkJson = await link.Content.ReadFromJsonAsync<JsonElement>();
        linkJson.GetProperty("success").GetBoolean().Should().BeFalse();
        linkJson.GetProperty("error").GetString().Should().Be("oauth_link_failed");
        linkJson.TryGetProperty("data", out _).Should().BeFalse();
    }

    [Fact]
    public async Task AdminEnterpriseGdprDashboard_UsesLaravelReactMetricKeys()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/enterprise/gdpr/dashboard");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("total_requests").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        json.GetProperty("pending_requests").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        json.GetProperty("total_consents").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        json.GetProperty("total_breaches").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task AdminEnterpriseMonitoring_UsesLaravelReactHealthShapes()
    {
        await AuthenticateAsAdminAsync();

        var monitoring = await Client.GetAsync("/api/v2/admin/enterprise/monitoring");

        monitoring.StatusCode.Should().Be(HttpStatusCode.OK);
        var monitoringJson = await monitoring.Content.ReadFromJsonAsync<JsonElement>();
        monitoringJson.GetProperty("php_version").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("memory_usage").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("memory_limit").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("db_connected").GetBoolean().Should().BeTrue();
        monitoringJson.GetProperty("redis_connected").ValueKind.Should().Be(JsonValueKind.True);
        monitoringJson.GetProperty("redis_memory").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("db_size").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("uptime").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("server_time").GetString().Should().NotBeNullOrWhiteSpace();
        monitoringJson.GetProperty("os").GetString().Should().NotBeNullOrWhiteSpace();

        var health = await Client.GetAsync("/api/v2/admin/enterprise/monitoring/health");

        health.StatusCode.Should().Be(HttpStatusCode.OK);
        var healthJson = await health.Content.ReadFromJsonAsync<JsonElement>();
        healthJson.GetProperty("status").GetString().Should().BeOneOf("healthy", "degraded", "unhealthy");
        var checks = healthJson.GetProperty("checks");
        checks.ValueKind.Should().Be(JsonValueKind.Array);
        checks.EnumerateArray().Should().Contain(c =>
            c.GetProperty("name").GetString() == "database" &&
            c.GetProperty("status").GetString() == "ok");
    }

    [Fact]
    public async Task AdminEnterpriseGdprBreaches_CreateAndListUseLaravelReactShape()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/enterprise/gdpr/breaches", new
        {
            title = "Contract parity breach",
            description = "A runtime smoke test created this record.",
            severity = "high",
            affected_users = 3
        });

        create.StatusCode.Should().Be(HttpStatusCode.OK);
        var createdJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var createdData = createdJson.TryGetProperty("data", out var data) ? data : createdJson;
        createdData.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        createdData.GetProperty("title").GetString().Should().Be("Contract parity breach");
        createdData.GetProperty("description").GetString().Should().Be("A runtime smoke test created this record.");
        createdData.GetProperty("severity").GetString().Should().Be("high");
        createdData.GetProperty("status").GetString().Should().Be("open");
        createdData.GetProperty("reported_at").GetString().Should().NotBeNullOrWhiteSpace();

        var list = await Client.GetAsync("/api/v2/admin/enterprise/gdpr/breaches");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listData = listJson.GetProperty("data");
        listData.ValueKind.Should().Be(JsonValueKind.Array);
        var createdId = createdData.GetProperty("id").GetInt32();
        listData.EnumerateArray()
            .Any(item =>
                item.GetProperty("id").GetInt32() == createdId &&
                item.GetProperty("title").GetString() == "Contract parity breach" &&
                item.GetProperty("status").GetString() == "open" &&
                item.TryGetProperty("reported_at", out var reportedAt) &&
            !string.IsNullOrWhiteSpace(reportedAt.GetString()))
            .Should().BeTrue();
    }

    [Fact]
    public async Task AdminDeliverabilityV2_UsesLaravelReactCrudDashboardAnalyticsAndCommentShape()
    {
        await AuthenticateAsAdminAsync();

        var title = $"Laravel React deliverable {Guid.NewGuid():N}";
        var create = await Client.PostAsJsonAsync("/api/v2/admin/deliverability", new
        {
            title,
            description = "Backend contract parity deliverable.",
            priority = "high",
            status = "in_progress",
            due_date = "2026-08-15",
            assigned_to = TestData.MemberUser.Id
        });

        create.StatusCode.Should().Be(HttpStatusCode.OK);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var created = createJson.GetProperty("data");
        var id = created.GetProperty("id").GetInt32();
        id.Should().BeGreaterThan(0);
        created.GetProperty("title").GetString().Should().Be(title);
        created.GetProperty("status").GetString().Should().Be("in_progress");
        created.GetProperty("priority").GetString().Should().Be("high");

        var list = await Client.GetAsync("/api/v2/admin/deliverability?status=in_progress&priority=high&page=1&limit=10");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listData = listJson.GetProperty("data");
        listData.ValueKind.Should().Be(JsonValueKind.Array);
        listData.EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == id &&
            item.GetProperty("title").GetString() == title &&
            item.GetProperty("assigned_to").GetInt32() == TestData.MemberUser.Id);
        var meta = listJson.GetProperty("meta");
        meta.GetProperty("current_page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(10);
        meta.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/deliverability/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(id);
        detailData.GetProperty("description").GetString().Should().Be("Backend contract parity deliverable.");
        detailData.GetProperty("comments").ValueKind.Should().Be(JsonValueKind.Array);

        var comment = await Client.PostAsJsonAsync($"/api/v2/admin/deliverability/{id}/comments", new
        {
            comment_text = "Confirmed against Laravel React contract.",
            comment_type = "comment"
        });

        comment.StatusCode.Should().Be(HttpStatusCode.OK);
        var commentJson = await comment.Content.ReadFromJsonAsync<JsonElement>();
        var commentData = commentJson.GetProperty("data");
        commentData.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        commentData.GetProperty("deliverable_id").GetInt32().Should().Be(id);
        commentData.GetProperty("comment_text").GetString().Should().Be("Confirmed against Laravel React contract.");
        commentData.GetProperty("comment_type").GetString().Should().Be("comment");

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/deliverability/{id}", new
        {
            status = "completed",
            priority = "urgent"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        var updateData = updateJson.GetProperty("data");
        updateData.GetProperty("status").GetString().Should().Be("completed");
        updateData.GetProperty("priority").GetString().Should().Be("urgent");
        updateData.GetProperty("comments").EnumerateArray().Should().Contain(item =>
            item.GetProperty("comment_text").GetString() == "Confirmed against Laravel React contract.");

        var dashboard = await Client.GetAsync("/api/v2/admin/deliverability/dashboard");
        dashboard.StatusCode.Should().Be(HttpStatusCode.OK);
        var dashboardJson = await dashboard.Content.ReadFromJsonAsync<JsonElement>();
        var dashboardData = dashboardJson.GetProperty("data");
        dashboardData.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        dashboardData.GetProperty("by_status").TryGetProperty("completed", out _).Should().BeTrue();
        dashboardData.GetProperty("completion_rate").GetDouble().Should().BeGreaterThanOrEqualTo(0);
        dashboardData.GetProperty("recent_activity").ValueKind.Should().Be(JsonValueKind.Array);

        var analytics = await Client.GetAsync("/api/v2/admin/deliverability/analytics");
        analytics.StatusCode.Should().Be(HttpStatusCode.OK);
        var analyticsJson = await analytics.Content.ReadFromJsonAsync<JsonElement>();
        var analyticsData = analyticsJson.GetProperty("data");
        analyticsData.GetProperty("completion_trends").ValueKind.Should().Be(JsonValueKind.Array);
        analyticsData.GetProperty("priority_distribution").TryGetProperty("urgent", out _).Should().BeTrue();
        analyticsData.TryGetProperty("avg_days_to_complete", out _).Should().BeTrue();
        analyticsData.GetProperty("risk_distribution").ValueKind.Should().Be(JsonValueKind.Object);

        var delete = await Client.DeleteAsync($"/api/v2/admin/deliverability/{id}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        var deleteData = deleteJson.GetProperty("data");
        deleteData.GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteData.GetProperty("id").GetInt32().Should().Be(id);
    }

    [Fact]
    public async Task AdminVolunteeringOpportunitiesV2_ExposesLaravelAdminAlias()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/volunteering/opportunities?page=1&limit=10");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        var meta = json.GetProperty("meta");
        meta.GetProperty("current_page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(10);
        meta.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task AdminCrmV2_UsesLaravelReactNotesTagsAdminsAndFunnelShape()
    {
        await AuthenticateAsAdminAsync();

        var funnel = await Client.GetAsync("/api/v2/admin/crm/funnel");
        funnel.StatusCode.Should().Be(HttpStatusCode.OK);
        var funnelData = (await funnel.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var stages = funnelData.GetProperty("stages");
        stages.ValueKind.Should().Be(JsonValueKind.Array);
        stages.EnumerateArray()
            .Any(stage =>
                stage.TryGetProperty("name", out var name) &&
                !string.IsNullOrWhiteSpace(name.GetString()) &&
                stage.TryGetProperty("color", out var color) &&
                !string.IsNullOrWhiteSpace(color.GetString()))
            .Should().BeTrue();
        funnelData.GetProperty("monthly_registrations").ValueKind.Should().Be(JsonValueKind.Array);

        var admins = await Client.GetAsync("/api/v2/admin/crm/admins");
        admins.StatusCode.Should().Be(HttpStatusCode.OK);
        var adminData = (await admins.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        adminData.ValueKind.Should().Be(JsonValueKind.Array);
        adminData.EnumerateArray().Should().Contain(admin =>
            admin.GetProperty("id").GetInt32() == TestData.AdminUser.Id &&
            admin.GetProperty("email").GetString() == TestData.AdminUser.Email &&
            admin.GetProperty("role").GetString() == "admin");

        var noteContent = $"Laravel React CRM note {Guid.NewGuid():N}";
        var createNote = await Client.PostAsJsonAsync("/api/v2/admin/crm/notes", new
        {
            user_id = TestData.MemberUser.Id,
            content = noteContent,
            category = "outreach",
            is_pinned = true
        });

        createNote.StatusCode.Should().Be(HttpStatusCode.OK);
        var createdNote = (await createNote.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var noteId = createdNote.GetProperty("id").GetInt32();
        noteId.Should().BeGreaterThan(0);
        createdNote.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        createdNote.GetProperty("content").GetString().Should().Be(noteContent);
        createdNote.GetProperty("category").GetString().Should().Be("outreach");
        createdNote.GetProperty("is_pinned").GetBoolean().Should().BeTrue();
        createdNote.GetProperty("user_name").GetString().Should().Be($"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}");
        createdNote.GetProperty("author_name").GetString().Should().Be($"{TestData.AdminUser.FirstName} {TestData.AdminUser.LastName}");

        var notes = await Client.GetAsync($"/api/v2/admin/crm/notes?user_id={TestData.MemberUser.Id}&category=outreach&page=1&limit=10");
        notes.StatusCode.Should().Be(HttpStatusCode.OK);
        var notesJson = await notes.Content.ReadFromJsonAsync<JsonElement>();
        notesJson.GetProperty("data").EnumerateArray().Should().Contain(note =>
            note.GetProperty("id").GetInt32() == noteId &&
            note.GetProperty("content").GetString() == noteContent);
        notesJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        notesJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(10);

        var updateNote = await Client.PutAsJsonAsync($"/api/v2/admin/crm/notes/{noteId}", new
        {
            content = $"{noteContent} updated",
            category = "follow_up",
            is_pinned = false
        });

        updateNote.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedNote = (await updateNote.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updatedNote.GetProperty("id").GetInt32().Should().Be(noteId);
        updatedNote.GetProperty("content").GetString().Should().Be($"{noteContent} updated");
        updatedNote.GetProperty("category").GetString().Should().Be("follow_up");
        updatedNote.GetProperty("is_pinned").GetBoolean().Should().BeFalse();

        var tag = $"crm-{Guid.NewGuid():N}"[..12];
        var createTag = await Client.PostAsJsonAsync("/api/v2/admin/crm/tags", new
        {
            user_id = TestData.MemberUser.Id,
            tag
        });

        createTag.StatusCode.Should().Be(HttpStatusCode.OK);
        var createdTag = (await createTag.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var tagId = createdTag.GetProperty("id").GetInt32();
        tagId.Should().BeGreaterThan(0);
        createdTag.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        createdTag.GetProperty("tag").GetString().Should().Be(tag);

        var tagsForUser = await Client.GetAsync($"/api/v2/admin/crm/tags?user_id={TestData.MemberUser.Id}");
        tagsForUser.StatusCode.Should().Be(HttpStatusCode.OK);
        var tagsForUserData = (await tagsForUser.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        tagsForUserData.EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == tagId &&
            item.GetProperty("tag").GetString() == tag &&
            item.GetProperty("user_name").GetString() == $"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}");

        var tagSummary = await Client.GetAsync("/api/v2/admin/crm/tags");
        tagSummary.StatusCode.Should().Be(HttpStatusCode.OK);
        var tagSummaryData = (await tagSummary.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        tagSummaryData.EnumerateArray().Should().Contain(item =>
            item.GetProperty("tag").GetString() == tag &&
            item.GetProperty("member_count").GetInt32() >= 1);

        var bulkRemoveTag = await Client.DeleteAsync($"/api/v2/admin/crm/tags/bulk?tag={Uri.EscapeDataString(tag)}");
        bulkRemoveTag.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkRemoveData = (await bulkRemoveTag.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        bulkRemoveData.GetProperty("deleted").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var deleteNote = await Client.DeleteAsync($"/api/v2/admin/crm/notes/{noteId}");
        deleteNote.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteNoteData = (await deleteNote.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        deleteNoteData.GetProperty("deleted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminCrmTasksV2_UsesLaravelReactCoordinatorTaskShape()
    {
        await AuthenticateAsAdminAsync();

        var title = $"Laravel React CRM task {Guid.NewGuid():N}";
        var create = await Client.PostAsJsonAsync("/api/v2/admin/crm/tasks", new
        {
            title,
            description = "Created by backend contract smoke test.",
            priority = "high",
            assigned_to = TestData.AdminUser.Id,
            user_id = TestData.MemberUser.Id,
            due_date = "2026-09-01"
        });

        create.StatusCode.Should().Be(HttpStatusCode.OK);
        var created = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var taskId = created.GetProperty("id").GetInt32();
        taskId.Should().BeGreaterThan(0);
        created.GetProperty("title").GetString().Should().Be(title);
        created.GetProperty("description").GetString().Should().Be("Created by backend contract smoke test.");
        created.GetProperty("priority").GetString().Should().Be("high");
        created.GetProperty("status").GetString().Should().Be("pending");
        created.GetProperty("assigned_to").GetInt32().Should().Be(TestData.AdminUser.Id);
        created.GetProperty("assigned_to_name").GetString().Should().Be($"{TestData.AdminUser.FirstName} {TestData.AdminUser.LastName}");
        created.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        created.GetProperty("user_name").GetString().Should().Be($"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}");
        created.GetProperty("created_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        created.GetProperty("created_by_name").GetString().Should().Be($"{TestData.AdminUser.FirstName} {TestData.AdminUser.LastName}");

        var list = await Client.GetAsync("/api/v2/admin/crm/tasks?status=pending&priority=high&page=1&limit=10");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("data").EnumerateArray().Should().Contain(task =>
            task.GetProperty("id").GetInt32() == taskId &&
            task.GetProperty("title").GetString() == title &&
            task.GetProperty("assigned_to").GetInt32() == TestData.AdminUser.Id);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(10);
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/crm/tasks/{taskId}", new
        {
            title = $"{title} updated",
            description = "Updated by backend contract smoke test.",
            priority = "urgent",
            status = "in_progress",
            assigned_to = TestData.AdminUser.Id,
            user_id = TestData.MemberUser.Id,
            due_date = "2026-09-02"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updated.GetProperty("id").GetInt32().Should().Be(taskId);
        updated.GetProperty("title").GetString().Should().Be($"{title} updated");
        updated.GetProperty("priority").GetString().Should().Be("urgent");
        updated.GetProperty("status").GetString().Should().Be("in_progress");
        updated.GetProperty("due_date").GetString().Should().StartWith("2026-09-02");

        var complete = await Client.PutAsJsonAsync($"/api/v2/admin/crm/tasks/{taskId}", new
        {
            status = "completed"
        });

        complete.StatusCode.Should().Be(HttpStatusCode.OK);
        var completed = (await complete.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        completed.GetProperty("status").GetString().Should().Be("completed");
        completed.GetProperty("completed_at").GetString().Should().NotBeNullOrWhiteSpace();

        var delete = await Client.DeleteAsync($"/api/v2/admin/crm/tasks/{taskId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleted = (await delete.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        deleted.GetProperty("deleted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminCrmTimelineV2_UsesLaravelReactActivityShapeAndFilters()
    {
        await AuthenticateAsAdminAsync();

        var noteContent = $"Timeline CRM note {Guid.NewGuid():N}";
        var createNote = await Client.PostAsJsonAsync("/api/v2/admin/crm/notes", new
        {
            user_id = TestData.MemberUser.Id,
            content = noteContent,
            category = "support"
        });
        createNote.StatusCode.Should().Be(HttpStatusCode.OK);

        var taskTitle = $"Timeline CRM task {Guid.NewGuid():N}";
        var createTask = await Client.PostAsJsonAsync("/api/v2/admin/crm/tasks", new
        {
            title = taskTitle,
            priority = "medium",
            assigned_to = TestData.AdminUser.Id,
            user_id = TestData.MemberUser.Id
        });
        createTask.StatusCode.Should().Be(HttpStatusCode.OK);

        var notesTimeline = await Client.GetAsync($"/api/v2/admin/crm/timeline?type=note_added&user_id={TestData.MemberUser.Id}&days=30&page=1&limit=25");
        notesTimeline.StatusCode.Should().Be(HttpStatusCode.OK);
        var notesJson = await notesTimeline.Content.ReadFromJsonAsync<JsonElement>();
        var noteSnippet = noteContent.Substring(0, Math.Min(noteContent.Length, 24));
        notesJson.GetProperty("data").EnumerateArray().Should().Contain(entry =>
            entry.GetProperty("activity_type").GetString() == "note_added" &&
            entry.GetProperty("user_id").GetInt32() == TestData.MemberUser.Id &&
            entry.GetProperty("user_name").GetString() == $"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}" &&
            entry.GetProperty("description").GetString()!.Contains(noteSnippet) &&
            !string.IsNullOrWhiteSpace(entry.GetProperty("created_at").GetString()));
        notesJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        notesJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(25);
        notesJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var tasksTimeline = await Client.GetAsync($"/api/v2/admin/crm/timeline?type=task_created&user_id={TestData.AdminUser.Id}&days=30&page=1&limit=25");
        tasksTimeline.StatusCode.Should().Be(HttpStatusCode.OK);
        var tasksJson = await tasksTimeline.Content.ReadFromJsonAsync<JsonElement>();
        tasksJson.GetProperty("data").EnumerateArray().Should().Contain(entry =>
            entry.GetProperty("activity_type").GetString() == "task_created" &&
            entry.GetProperty("user_id").GetInt32() == TestData.AdminUser.Id &&
            entry.GetProperty("description").GetString()!.Contains(taskTitle) &&
            entry.GetProperty("metadata").ValueKind == JsonValueKind.Object);
        tasksJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task AdminCrmExportsV2_IncludeLaravelReactCsvRows()
    {
        await AuthenticateAsAdminAsync();

        var noteContent = $"Export CRM note {Guid.NewGuid():N}";
        var createNote = await Client.PostAsJsonAsync("/api/v2/admin/crm/notes", new
        {
            user_id = TestData.MemberUser.Id,
            content = noteContent,
            category = "support",
            is_pinned = true
        });
        createNote.StatusCode.Should().Be(HttpStatusCode.OK);

        var taskTitle = $"Export CRM task {Guid.NewGuid():N}";
        var createTask = await Client.PostAsJsonAsync("/api/v2/admin/crm/tasks", new
        {
            title = taskTitle,
            description = "CSV export contract task.",
            priority = "urgent",
            assigned_to = TestData.AdminUser.Id,
            user_id = TestData.MemberUser.Id,
            due_date = "2026-10-01"
        });
        createTask.StatusCode.Should().Be(HttpStatusCode.OK);

        var notesExport = await Client.GetAsync("/api/v2/admin/crm/export/notes");
        notesExport.StatusCode.Should().Be(HttpStatusCode.OK);
        notesExport.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        var notesCsv = await notesExport.Content.ReadAsStringAsync();
        notesCsv.Should().Contain("ID,User ID,User Name,Content,Category,Pinned,Author,Created,Updated");
        notesCsv.Should().Contain(noteContent);
        notesCsv.Should().Contain($"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}");
        notesCsv.Should().Contain($"{TestData.AdminUser.FirstName} {TestData.AdminUser.LastName}");

        var tasksExport = await Client.GetAsync("/api/v2/admin/crm/export/tasks");
        tasksExport.StatusCode.Should().Be(HttpStatusCode.OK);
        tasksExport.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        var tasksCsv = await tasksExport.Content.ReadAsStringAsync();
        tasksCsv.Should().Contain("ID,Title,Description,Priority,Status,Assigned To,Related Member,Due Date,Completed At,Created By,Created");
        tasksCsv.Should().Contain(taskTitle);
        tasksCsv.Should().Contain("urgent");
        tasksCsv.Should().Contain($"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}");

        var dashboardExport = await Client.GetAsync("/api/v2/admin/crm/export/dashboard");
        dashboardExport.StatusCode.Should().Be(HttpStatusCode.OK);
        dashboardExport.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        var dashboardCsv = await dashboardExport.Content.ReadAsStringAsync();
        dashboardCsv.Should().Contain("Metric,Value");
        dashboardCsv.Should().Contain("Total Members");
        dashboardCsv.Should().Contain("New This Month");
    }

    [Fact]
    public async Task AdminVettingV2_UsesMetadataOnlySafeguardingWorkflowShape()
    {
        await AuthenticateAsAdminAsync();

        var policyUpdate = await Client.PutAsJsonAsync("/api/v2/admin/vetting/policy", new
        {
            jurisdiction = "england_wales"
        });
        policyUpdate.StatusCode.Should().Be(HttpStatusCode.OK);
        var policyData = (await policyUpdate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        policyData.GetProperty("policy").GetProperty("attestation_code").GetString().Should().Be("dbs_enhanced");
        policyData.GetProperty("preference_transition").GetProperty("created").GetArrayLength().Should().Be(7);

        var confirm = await Client.PostAsJsonAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm",
            new { acknowledgement = true });
        confirm.StatusCode.Should().Be(HttpStatusCode.Created);
        var confirmed = (await confirm.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var attestationId = confirmed.GetProperty("id").GetInt64();
        confirmed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        confirmed.GetProperty("decision").GetString().Should().Be("confirmed");
        confirmed.GetProperty("attestation_code").GetString().Should().Be("dbs_enhanced");
        confirmed.TryGetProperty("document_url", out _).Should().BeFalse();
        confirmed.TryGetProperty("reference_number", out _).Should().BeFalse();

        var list = await Client.GetAsync("/api/v2/admin/vetting?status=confirmed&page=1&per_page=10");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("user_id").GetInt32() == TestData.MemberUser.Id
            && item.GetProperty("decision").GetString() == "confirmed");
        listJson.GetProperty("meta").GetProperty("pagination").GetProperty("per_page").GetInt32().Should().Be(10);

        var show = await Client.GetAsync($"/api/v2/admin/vetting/{attestationId}");
        show.StatusCode.Should().Be(HttpStatusCode.OK);
        (await show.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
            .GetProperty("confirmed_by").GetInt32().Should().Be(TestData.AdminUser.Id);

        var stats = await Client.GetAsync("/api/v2/admin/vetting/stats");
        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        (await stats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
            .GetProperty("confirmed").GetInt32().Should().Be(1);

        var revoke = await Client.PostAsJsonAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/revoke",
            new { reason_code = "community_decision_withdrawn" });
        revoke.StatusCode.Should().Be(HttpStatusCode.OK);
        (await revoke.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
            .GetProperty("decision").GetString().Should().Be("revoked");

        (await Client.PostAsJsonAsync("/api/v2/admin/vetting", new { status = "verified" }))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.PutAsJsonAsync($"/api/v2/admin/vetting/{attestationId}", new { status = "verified" }))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.DeleteAsync($"/api/v2/admin/vetting/{attestationId}"))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.PostAsync($"/api/v2/admin/vetting/{attestationId}/upload", null))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }


    [Fact]
    public async Task AdminInsuranceV2_UsesLaravelReactWorkflowShape()
    {
        await AuthenticateAsAdminAsync();

        var policyNumber = $"PL-{Guid.NewGuid():N}"[..12];
        var create = await Client.PostAsJsonAsync("/api/v2/admin/insurance", new
        {
            user_id = TestData.MemberUser.Id,
            insurance_type = "public_liability",
            status = "submitted",
            provider_name = "Contract Assurance",
            policy_number = policyNumber,
            coverage_amount = 2500000,
            start_date = "2026-02-01",
            expiry_date = "2027-02-01",
            notes = "Created by Laravel React insurance contract smoke test."
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var insuranceId = created.GetProperty("id").GetInt32();
        insuranceId.Should().BeGreaterThan(0);
        created.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        created.GetProperty("first_name").GetString().Should().Be(TestData.MemberUser.FirstName);
        created.GetProperty("last_name").GetString().Should().Be(TestData.MemberUser.LastName);
        created.GetProperty("email").GetString().Should().Be(TestData.MemberUser.Email);
        created.GetProperty("insurance_type").GetString().Should().Be("public_liability");
        created.GetProperty("status").GetString().Should().Be("submitted");
        created.GetProperty("provider_name").GetString().Should().Be("Contract Assurance");
        created.GetProperty("policy_number").GetString().Should().Be(policyNumber);
        created.GetProperty("coverage_amount").GetDecimal().Should().Be(2500000m);
        created.GetProperty("start_date").GetString().Should().StartWith("2026-02-01");
        created.GetProperty("expiry_date").GetString().Should().StartWith("2027-02-01");

        var list = await Client.GetAsync($"/api/v2/admin/insurance?status=pending_review&insurance_type=public_liability&search={Uri.EscapeDataString(policyNumber)}&page=1&per_page=10");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == insuranceId &&
            item.GetProperty("policy_number").GetString() == policyNumber);
        var meta = listJson.GetProperty("meta");
        meta.GetProperty("current_page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(10);
        meta.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var stats = await Client.GetAsync("/api/v2/admin/insurance/stats");
        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsData = (await stats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statsData.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("submitted").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("pending_review").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var show = await Client.GetAsync($"/api/v2/admin/insurance/{insuranceId}");
        show.StatusCode.Should().Be(HttpStatusCode.OK);
        var shown = (await show.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        shown.GetProperty("id").GetInt32().Should().Be(insuranceId);
        shown.GetProperty("verifier_first_name").ValueKind.Should().Be(JsonValueKind.Null);

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/insurance/{insuranceId}", new
        {
            provider_name = "Updated Contract Assurance",
            coverage_amount = 3000000,
            notes = "Updated by Laravel React insurance contract smoke test."
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updated.GetProperty("id").GetInt32().Should().Be(insuranceId);
        updated.GetProperty("provider_name").GetString().Should().Be("Updated Contract Assurance");
        updated.GetProperty("coverage_amount").GetDecimal().Should().Be(3000000m);
        updated.GetProperty("notes").GetString().Should().Be("Updated by Laravel React insurance contract smoke test.");

        var verify = await Client.PostAsync($"/api/v2/admin/insurance/{insuranceId}/verify", null);
        verify.StatusCode.Should().Be(HttpStatusCode.OK);
        var verified = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        verified.GetProperty("status").GetString().Should().Be("verified");
        verified.GetProperty("verified_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        verified.GetProperty("verifier_first_name").GetString().Should().Be(TestData.AdminUser.FirstName);
        verified.GetProperty("verified_at").GetString().Should().NotBeNullOrWhiteSpace();

        var userCertificates = await Client.GetAsync($"/api/v2/admin/insurance/user/{TestData.MemberUser.Id}");
        userCertificates.StatusCode.Should().Be(HttpStatusCode.OK);
        var userCertificateData = (await userCertificates.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        userCertificateData.EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == insuranceId &&
            item.GetProperty("user_id").GetInt32() == TestData.MemberUser.Id);

        var reject = await Client.PostAsJsonAsync($"/api/v2/admin/insurance/{insuranceId}/reject", new
        {
            reason = "Insurance contract test rejection reason"
        });

        reject.StatusCode.Should().Be(HttpStatusCode.OK);
        var rejected = (await reject.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        rejected.GetProperty("status").GetString().Should().Be("rejected");
        rejected.GetProperty("verified_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        rejected.GetProperty("notes").GetString().Should().Be("Insurance contract test rejection reason");

        var delete = await Client.DeleteAsync($"/api/v2/admin/insurance/{insuranceId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleted = (await delete.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        deleted.GetProperty("deleted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminCronV2_UsesLaravelReactLogsSettingsAndHealthShape()
    {
        await AuthenticateAsAdminAsync();

        var jobId = $"contract-cron-{Guid.NewGuid():N}"[..24];
        var runId = await SeedScheduledJobRunAsync(jobId, ScheduledJobRunStatus.Failed, "Contract cron failure output");

        var logs = await Client.GetAsync($"/api/v2/admin/system/cron-jobs/logs?jobId={Uri.EscapeDataString(jobId)}&status=failed&limit=10&offset=0");
        logs.StatusCode.Should().Be(HttpStatusCode.OK);
        var logsJson = await logs.Content.ReadFromJsonAsync<JsonElement>();
        var log = logsJson.GetProperty("data").EnumerateArray().Should().ContainSingle(item =>
            item.GetProperty("id").GetInt32() == runId &&
            item.GetProperty("job_id").GetString() == jobId &&
            item.GetProperty("status").GetString() == "failed").Subject;
        log.GetProperty("job_name").GetString().Should().Be(jobId);
        log.GetProperty("output").GetString().Should().Contain("Contract cron failure output");
        log.GetProperty("duration_seconds").GetDouble().Should().BeGreaterThan(0);
        log.GetProperty("executed_by").GetString().Should().Be("cron");
        logsJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        logsJson.GetProperty("meta").GetProperty("limit").GetInt32().Should().Be(10);
        logsJson.GetProperty("meta").GetProperty("offset").GetInt32().Should().Be(0);

        var detail = await Client.GetAsync($"/api/v2/admin/system/cron-jobs/logs/{runId}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(runId);
        detailData.GetProperty("job_id").GetString().Should().Be(jobId);
        detailData.GetProperty("status").GetString().Should().Be("failed");

        var otherStatuses = new[]
        {
            (Status: ScheduledJobRunStatus.Running, Expected: "running"),
            (Status: ScheduledJobRunStatus.Success, Expected: "success"),
            (Status: ScheduledJobRunStatus.Skipped, Expected: "skipped")
        };
        foreach (var (status, expected) in otherStatuses)
        {
            var statusRunId = await SeedScheduledJobRunAsync(
                $"{jobId}-{expected}",
                status,
                $"Contract cron {expected} output");
            var statusDetail = await Client.GetAsync($"/api/v2/admin/system/cron-jobs/logs/{statusRunId}");
            statusDetail.StatusCode.Should().Be(HttpStatusCode.OK);
            var statusData = (await statusDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            statusData.GetProperty("status").GetString().Should().Be(expected);
        }

        var updateJobSettings = await Client.PutAsJsonAsync($"/api/v2/admin/system/cron-jobs/{jobId}/settings", new
        {
            is_enabled = false,
            custom_schedule = "*/15 * * * *",
            notify_on_failure = true,
            notify_emails = "ops@example.test",
            max_retries = 5,
            timeout_seconds = 900
        });
        updateJobSettings.StatusCode.Should().Be(HttpStatusCode.OK);

        var jobSettings = await Client.GetAsync($"/api/v2/admin/system/cron-jobs/{jobId}/settings");
        jobSettings.StatusCode.Should().Be(HttpStatusCode.OK);
        var jobSettingsData = (await jobSettings.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        jobSettingsData.GetProperty("job_id").GetString().Should().Be(jobId);
        jobSettingsData.GetProperty("is_enabled").GetBoolean().Should().BeFalse();
        jobSettingsData.GetProperty("custom_schedule").GetString().Should().Be("*/15 * * * *");
        jobSettingsData.GetProperty("notify_on_failure").GetBoolean().Should().BeTrue();
        jobSettingsData.GetProperty("notify_emails").GetString().Should().Be("ops@example.test");
        jobSettingsData.GetProperty("max_retries").GetInt32().Should().Be(5);
        jobSettingsData.GetProperty("timeout_seconds").GetInt32().Should().Be(900);

        var updateGlobalSettings = await Client.PutAsJsonAsync("/api/v2/admin/system/cron-jobs/settings", new
        {
            default_notify_email = "platform-ops@example.test",
            log_retention_days = 14,
            max_concurrent_jobs = 2
        });
        updateGlobalSettings.StatusCode.Should().Be(HttpStatusCode.OK);

        var globalSettings = await Client.GetAsync("/api/v2/admin/system/cron-jobs/settings");
        globalSettings.StatusCode.Should().Be(HttpStatusCode.OK);
        var globalSettingsData = (await globalSettings.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        globalSettingsData.GetProperty("default_notify_email").GetString().Should().Be("platform-ops@example.test");
        globalSettingsData.GetProperty("log_retention_days").GetInt32().Should().Be(14);
        globalSettingsData.GetProperty("max_concurrent_jobs").GetInt32().Should().Be(2);

        var health = await Client.GetAsync("/api/v2/admin/system/cron-jobs/health");
        health.StatusCode.Should().Be(HttpStatusCode.OK);
        var healthData = (await health.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        healthData.GetProperty("health_score").GetInt32().Should().BeInRange(0, 100);
        healthData.GetProperty("jobs_failed_24h").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        healthData.GetProperty("recent_failures").EnumerateArray().Should().Contain(item =>
            item.GetProperty("job_name").GetString() == jobId &&
            item.GetProperty("reason").GetString()!.Contains("Contract cron failure output"));
        healthData.GetProperty("jobs_overdue").ValueKind.Should().Be(JsonValueKind.Array);
        healthData.GetProperty("avg_success_rate_7d").GetDouble().Should().BeInRange(0, 1);

        var clear = await Client.DeleteAsync($"/api/v2/admin/system/cron-jobs/logs?before={Uri.EscapeDataString(DateTime.UtcNow.AddDays(1).ToString("O"))}");
        clear.StatusCode.Should().Be(HttpStatusCode.OK);
        var clearData = (await clear.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        clearData.GetProperty("deleted_count").GetInt32().Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task AdminCronV2_UsesLaravelReactDefinitionListAndRequiresPlatformSuperAdminForManualRun()
    {
        await AuthenticateAsAdminAsync();

        var list = await Client.GetAsync("/api/v2/admin/system/cron-jobs");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var jobs = listJson.GetProperty("data").EnumerateArray().ToArray();
        jobs.Should().NotBeEmpty();

        var master = jobs.Should().ContainSingle(job =>
            job.GetProperty("id").GetInt32() == 1 &&
            job.GetProperty("slug").GetString() == "run-all").Subject;
        master.GetProperty("name").GetString().Should().Be("Master Cron Runner");
        master.GetProperty("command").GetString().Should().Be("runAll");
        master.GetProperty("schedule").GetString().Should().Be("* * * * *");
        master.GetProperty("status").GetString().Should().Be("disabled");
        master.GetProperty("execution_supported").GetBoolean().Should().BeFalse();
        master.GetProperty("category").GetString().Should().Be("master");
        master.GetProperty("description").GetString().Should().NotBeNullOrWhiteSpace();
        master.GetProperty("last_run_at").ValueKind.Should().Be(JsonValueKind.Null);
        master.GetProperty("last_status").ValueKind.Should().Be(JsonValueKind.Null);

        jobs.Count(job => job.GetProperty("status").GetString() == "active").Should().Be(4);
        jobs.Count(job => job.GetProperty("execution_supported").GetBoolean()).Should().Be(4);
        jobs.Should().ContainSingle(job =>
            job.GetProperty("slug").GetString() == "listing-expiry" &&
            job.GetProperty("status").GetString() == "active" &&
            job.GetProperty("execution_supported").GetBoolean());
        jobs.Should().ContainSingle(job =>
            job.GetProperty("slug").GetString() == "job-expiry" &&
            job.GetProperty("status").GetString() == "active" &&
            job.GetProperty("execution_supported").GetBoolean());
        jobs.Should().ContainSingle(job =>
            job.GetProperty("slug").GetString() == "volunteer-expire-consents" &&
            job.GetProperty("status").GetString() == "active" &&
            job.GetProperty("execution_supported").GetBoolean());
        jobs.Should().ContainSingle(job =>
            job.GetProperty("slug").GetString() == "recurring-shifts" &&
            job.GetProperty("status").GetString() == "active" &&
            job.GetProperty("execution_supported").GetBoolean());

        var run = await Client.PostAsJsonAsync("/api/v2/admin/system/cron-jobs/1/run", new { });
        run.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var runError = await run.Content.ReadFromJsonAsync<JsonElement>();
        var error = runError.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("forbidden");
        error.GetProperty("message").GetString().Should().Contain("Platform super-admin access is required");
    }

    [Fact]
    public async Task AdminPagesV2_UsesLaravelReactCmsWorkflowShape()
    {
        await AuthenticateAsAdminAsync();

        var title = $"Contract Page {Guid.NewGuid():N}"[..28];
        var create = await Client.PostAsJsonAsync("/api/v2/admin/pages", new
        {
            title,
            content = "<p>Laravel React CMS contract body.</p>",
            content_format = "builder",
            design_json = "{\"blocks\":[{\"type\":\"hero\"}]}",
            meta_description = "Contract CMS meta description",
            status = "published",
            show_in_menu = 1,
            menu_location = "footer",
            menu_order = 7,
            sort_order = 4
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var pageId = created.GetProperty("id").GetInt32();
        created.GetProperty("title").GetString().Should().Be(title);
        created.GetProperty("slug").GetString().Should().StartWith("contract-page");
        created.GetProperty("content_format").GetString().Should().Be("builder");
        created.GetProperty("design_json").GetString().Should().Contain("hero");
        created.GetProperty("status").GetString().Should().Be("published");
        created.GetProperty("show_in_menu").GetInt32().Should().Be(1);
        created.GetProperty("menu_location").GetString().Should().Be("footer");
        created.GetProperty("menu_order").GetInt32().Should().Be(7);

        var list = await Client.GetAsync("/api/v2/admin/pages");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listData = (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        listData.EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == pageId &&
            item.GetProperty("status").GetString() == "published");

        var detail = await Client.GetAsync($"/api/v2/admin/pages/{pageId}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("content").GetString().Should().Contain("contract body");
        detailData.GetProperty("content_format").GetString().Should().Be("builder");

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/pages/{pageId}", new
        {
            title = $"{title} Updated",
            slug = $"custom-{Guid.NewGuid():N}"[..20],
            status = "draft",
            show_in_menu = 0,
            menu_order = 2,
            content_format = "html",
            content = "<p>Updated body.</p>"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updated.GetProperty("title").GetString().Should().EndWith("Updated");
        updated.GetProperty("status").GetString().Should().Be("draft");
        updated.GetProperty("show_in_menu").GetInt32().Should().Be(0);
        updated.GetProperty("menu_order").GetInt32().Should().Be(2);
        updated.GetProperty("content_format").GetString().Should().Be("html");

        var delete = await Client.DeleteAsync($"/api/v2/admin/pages/{pageId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleted = (await delete.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        deleted.GetProperty("deleted").GetBoolean().Should().BeTrue();

        var missing = await Client.GetAsync($"/api/v2/admin/pages/{pageId}");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task VolunteeringShiftWaitlistV2_UsesLaravelReactActionEnvelope()
    {
        await AuthenticateAsMemberAsync();
        var shiftId = await SeedVolunteerShiftAsync("Laravel React waitlist shift");
        var groupId = await SeedVolunteerGroupAsync("Laravel React full waitlist shift group");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var shift = await db.VolunteerShifts
                .IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.Id == shiftId);
            db.VolunteerApplications.Add(new VolunteerApplication
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = shift.OpportunityId,
                UserId = TestData.MemberUser.Id,
                Status = ApplicationStatus.Approved,
                CreatedAt = DateTime.UtcNow
            });
            db.ShiftGroupReservations.Add(new ShiftGroupReservation
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shiftId,
                GroupId = groupId,
                ReservedBy = TestData.MemberUser.Id,
                ReservedSlots = shift.MaxVolunteers,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var join = await Client.PostAsJsonAsync($"/api/v2/volunteering/shifts/{shiftId}/waitlist", new { });

        join.StatusCode.Should().Be(HttpStatusCode.Created);
        var joinJson = await join.Content.ReadFromJsonAsync<JsonElement>();
        var waitlistId = joinJson.GetProperty("data").GetProperty("id").GetInt32();
        waitlistId.Should().BeGreaterThan(0);
        joinJson.GetProperty("data").GetProperty("position").GetInt32().Should().Be(1);
        joinJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var waitlist = await db.ShiftWaitlistEntries
                .IgnoreQueryFilters()
                .SingleAsync(entry => entry.Id == waitlistId);
            var reservation = await db.ShiftGroupReservations
                .IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.ShiftId == shiftId && candidate.GroupId == groupId);
            waitlist.Status = "notified";
            waitlist.NotifiedAt = DateTime.UtcNow;
            reservation.Status = "cancelled";
            await db.SaveChangesAsync();
        }

        var promote = await Client.PostAsJsonAsync($"/api/v2/volunteering/shifts/{shiftId}/waitlist/promote", new { });

        promote.StatusCode.Should().Be(HttpStatusCode.OK);
        var promoteJson = await promote.Content.ReadFromJsonAsync<JsonElement>();
        promoteJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task VolunteeringShiftSignupV2_UsesLaravelReactActionEnvelope()
    {
        await AuthenticateAsMemberAsync();
        var shiftId = await SeedVolunteerShiftAsync("Laravel React signup shift");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var shift = await db.VolunteerShifts
                .IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.Id == shiftId);
            db.VolunteerApplications.Add(new VolunteerApplication
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = shift.OpportunityId,
                UserId = TestData.MemberUser.Id,
                Status = ApplicationStatus.Approved,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var signup = await Client.PostAsJsonAsync($"/api/v2/volunteering/shifts/{shiftId}/signup", new { });

        signup.StatusCode.Should().Be(HttpStatusCode.OK);
        var signupJson = await signup.Content.ReadFromJsonAsync<JsonElement>();
        signupJson.GetProperty("data").GetProperty("shift_id").GetInt32().Should().Be(shiftId);
        signupJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task VolunteeringGroupReserveV2_UsesLaravelReactActionEnvelope()
    {
        await AuthenticateAsMemberAsync();
        var shiftId = await SeedVolunteerShiftAsync("Laravel React group reserve shift");
        var groupId = await SeedVolunteerGroupAsync("Laravel React reservation group");

        var reserve = await Client.PostAsJsonAsync($"/api/v2/volunteering/shifts/{shiftId}/group-reserve", new
        {
            group_id = groupId,
            reserved_slots = 2,
            notes = "Reserved from Laravel React contract test"
        });

        reserve.StatusCode.Should().Be(HttpStatusCode.Created);
        var reserveJson = await reserve.Content.ReadFromJsonAsync<JsonElement>();
        var reservationId = reserveJson.GetProperty("data").GetProperty("id").GetInt32();
        reservationId.Should().BeGreaterThan(0);
        reserveJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var addMember = await Client.PostAsJsonAsync($"/api/v2/volunteering/group-reservations/{reservationId}/members", new
        {
            user_id = TestData.AdminUser.Id
        });

        addMember.StatusCode.Should().Be(HttpStatusCode.OK);
        var addMemberJson = await addMember.Content.ReadFromJsonAsync<JsonElement>();
        addMemberJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task AdminEnterpriseGdprRequests_CreateAndListUseLaravelReactShape()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/enterprise/gdpr/requests", new
        {
            user_id = TestData.MemberUser.Id,
            type = "access",
            priority = "high",
            notes = "Created by Laravel React contract smoke test"
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createdJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var createdData = createdJson.GetProperty("data");
        createdData.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        createdData.GetProperty("type").GetString().Should().Be("access");
        createdData.GetProperty("status").GetString().Should().Be("pending");

        var list = await Client.GetAsync("/api/v2/admin/enterprise/gdpr/requests?status=pending");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listData = listJson.GetProperty("data");
        listData.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        listData.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThan(0);
        var createdId = createdData.GetProperty("id").GetInt32();
        listData.GetProperty("data").EnumerateArray()
            .Any(item =>
                item.GetProperty("id").GetInt32() == createdId &&
                item.GetProperty("user_name").GetString() == $"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}" &&
                item.GetProperty("type").GetString() == "access" &&
                item.GetProperty("status").GetString() == "pending" &&
                !string.IsNullOrWhiteSpace(item.GetProperty("created_at").GetString()))
            .Should().BeTrue();
    }

    [Fact]
    public async Task AdminEnterpriseGdprRequestDetail_UsesLaravelReactDetailShape()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/enterprise/gdpr/requests", new
        {
            user_id = TestData.MemberUser.Id,
            type = "portability",
            priority = "normal",
            notes = "Detail shape contract test"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdData = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var requestId = createdData.GetProperty("id").GetInt32();

        var detail = await Client.GetAsync($"/api/v2/admin/enterprise/gdpr/requests/{requestId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var data = detailJson.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().Be(requestId);
        data.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("user_name").GetString().Should().Be($"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName}");
        data.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);
        data.GetProperty("type").GetString().Should().Be("portability");
        data.GetProperty("request_type").GetString().Should().Be("portability");
        data.GetProperty("status").GetString().Should().Be("pending");
        data.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("sla_deadline").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("sla_days_remaining").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        data.GetProperty("sla_overdue").GetBoolean().Should().BeFalse();
        data.GetProperty("timeline").ValueKind.Should().Be(JsonValueKind.Array);
        data.TryGetProperty("export_file_path", out _).Should().BeTrue();
        data.TryGetProperty("assigned_to", out _).Should().BeTrue();
    }

    [Fact]
    public async Task LocalAdvertisingCampaigns_UseLaravelReactAdminShape()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/me/ad-campaigns", new
        {
            name = "Laravel React local ad",
            advertiser_type = "verein",
            budget_cents = 12345,
            placement = "feed",
            start_date = "2026-07-10",
            end_date = "2026-07-31",
            audience_filters = new { radius_km = 5, interests = new[] { "gardening" } }
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        created.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        created.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        created.GetProperty("created_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        created.GetProperty("name").GetString().Should().Be("Laravel React local ad");
        created.GetProperty("status").GetString().Should().Be("pending_review");
        created.GetProperty("advertiser_type").GetString().Should().Be("verein");
        created.GetProperty("budget_cents").GetInt32().Should().Be(12345);
        created.GetProperty("spent_cents").GetInt32().Should().Be(0);
        created.GetProperty("placement").GetString().Should().Be("feed");
        created.GetProperty("impression_count").GetInt32().Should().Be(0);
        created.GetProperty("click_count").GetInt32().Should().Be(0);
        created.GetProperty("advertiser_name").GetString().Should().Be("Admin User");
        created.GetProperty("advertiser_email").GetString().Should().Be(TestData.AdminUser.Email);

        var campaignId = created.GetProperty("id").GetInt32();

        var list = await Client.GetAsync("/api/v2/admin/ad-campaigns?status=pending_review&limit=50");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == campaignId);
        listed.GetProperty("creative_count").GetInt32().Should().Be(0);

        var stats = await Client.GetAsync("/api/v2/admin/ad-campaigns/stats");

        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsData = (await stats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statsData.GetProperty("active_campaigns").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        statsData.GetProperty("impressions_today").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        statsData.GetProperty("clicks_today").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        statsData.GetProperty("total_revenue_cents").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var detail = await Client.GetAsync($"/api/v2/admin/ad-campaigns/{campaignId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(campaignId);
        detailData.GetProperty("creatives").ValueKind.Should().Be(JsonValueKind.Array);
        detailData.GetProperty("stats").GetProperty("campaign_id").GetInt32().Should().Be(campaignId);
        detailData.GetProperty("stats").GetProperty("daily").ValueKind.Should().Be(JsonValueKind.Array);

        var approve = await Client.PostAsync($"/api/v2/admin/ad-campaigns/{campaignId}/approve", null);

        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        var approved = (await approve.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        approved.GetProperty("status").GetString().Should().Be("active");
        approved.GetProperty("approved_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        approved.GetProperty("approved_at").GetString().Should().NotBeNullOrWhiteSpace();

        var pause = await Client.PostAsync($"/api/v2/admin/ad-campaigns/{campaignId}/pause", null);

        pause.StatusCode.Should().Be(HttpStatusCode.OK);
        var paused = (await pause.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        paused.GetProperty("id").GetInt32().Should().Be(campaignId);
        paused.GetProperty("status").GetString().Should().Be("paused");

        var rejectCreate = await Client.PostAsJsonAsync("/api/v2/me/ad-campaigns", new
        {
            name = "Laravel React rejected local ad",
            advertiser_type = "sme",
            budget_cents = 5000,
            placement = "markt"
        });
        var rejectedCampaignId = (await rejectCreate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var reject = await Client.PostAsJsonAsync($"/api/v2/admin/ad-campaigns/{rejectedCampaignId}/reject", new
        {
            reason = "Audience is too broad."
        });

        reject.StatusCode.Should().Be(HttpStatusCode.OK);
        var rejected = (await reject.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        rejected.GetProperty("id").GetInt32().Should().Be(rejectedCampaignId);
        rejected.GetProperty("status").GetString().Should().Be("rejected");

        var rejectedDetail = await Client.GetAsync($"/api/v2/admin/ad-campaigns/{rejectedCampaignId}");
        var rejectedDetailData = (await rejectedDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        rejectedDetailData.GetProperty("rejection_reason").GetString().Should().Be("Audience is too broad.");
    }

    [Fact]
    public async Task PaidPushCampaigns_UseLaravelReactMemberAndAdminShape()
    {
        await AuthenticateAsAdminAsync();

        var estimate = await Client.PostAsJsonAsync("/api/v2/me/push-campaigns/estimate-audience", new
        {
            audience_min_trust_tier = "member",
            audience_radius_km = 25
        });

        estimate.StatusCode.Should().Be(HttpStatusCode.OK);
        var estimateData = (await estimate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        estimateData.GetProperty("estimated_reach").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        estimateData.GetProperty("estimated_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        estimateData.GetProperty("minimum_reached").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);

        var scheduledAt = DateTime.UtcNow.AddDays(7).ToString("O");
        var create = await Client.PostAsJsonAsync("/api/v2/me/push-campaigns", new
        {
            name = "Laravel React push campaign",
            title = "Garden day reminder",
            body = "Join the community garden session this weekend.",
            advertiser_type = "gemeinde",
            cta_url = "https://example.test/garden",
            schedule_at = scheduledAt,
            audience_radius_km = 25,
            audience_min_trust_tier = "trusted"
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var campaignId = created.GetProperty("id").GetInt32();
        campaignId.Should().BeGreaterThan(0);
        created.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        created.GetProperty("created_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        created.GetProperty("name").GetString().Should().Be("Laravel React push campaign");
        created.GetProperty("title").GetString().Should().Be("Garden day reminder");
        created.GetProperty("body").GetString().Should().Be("Join the community garden session this weekend.");
        created.GetProperty("status").GetString().Should().Be("draft");
        created.GetProperty("advertiser_type").GetString().Should().Be("gemeinde");
        created.GetProperty("schedule_at").GetString().Should().NotBeNullOrWhiteSpace();
        created.GetProperty("scheduled_at").GetString().Should().NotBeNullOrWhiteSpace();
        created.GetProperty("audience_radius_km").GetInt32().Should().Be(25);
        created.GetProperty("audience_min_trust_tier").GetString().Should().Be("trusted");

        var update = await Client.PutAsJsonAsync($"/api/v2/me/push-campaigns/{campaignId}", new
        {
            title = "Updated garden day reminder",
            body = "Updated notification body.",
            cost_per_send = 7
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updated.GetProperty("title").GetString().Should().Be("Updated garden day reminder");
        updated.GetProperty("body").GetString().Should().Be("Updated notification body.");
        updated.GetProperty("cost_per_send").GetInt32().Should().Be(7);

        var submit = await Client.PostAsync($"/api/v2/me/push-campaigns/{campaignId}/submit", null);

        submit.StatusCode.Should().Be(HttpStatusCode.OK);
        var submitted = (await submit.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        submitted.GetProperty("status").GetString().Should().Be("pending_review");

        var mine = await Client.GetAsync("/api/v2/me/push-campaigns");

        mine.StatusCode.Should().Be(HttpStatusCode.OK);
        var mineData = (await mine.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        mineData.EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == campaignId
                && item.GetProperty("status").GetString() == "pending_review");

        var adminList = await Client.GetAsync("/api/v2/admin/push-campaigns?status=pending_review");

        adminList.StatusCode.Should().Be(HttpStatusCode.OK);
        var adminListJson = await adminList.Content.ReadFromJsonAsync<JsonElement>();
        adminListJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        adminListJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == campaignId
                && item.GetProperty("advertiser_name").GetString() == "Admin User");

        var stats = await Client.GetAsync("/api/v2/admin/push-campaigns/stats");

        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsData = (await stats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statsData.GetProperty("total_campaigns").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("by_status").GetProperty("pending_review").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("sends_this_month").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        statsData.GetProperty("opens_this_month").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        statsData.GetProperty("revenue_cents_this_month").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var detail = await Client.GetAsync($"/api/v2/admin/push-campaigns/{campaignId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(campaignId);
        detailData.GetProperty("analytics").GetProperty("daily_breakdown").ValueKind.Should().Be(JsonValueKind.Array);

        var approve = await Client.PostAsync($"/api/v2/admin/push-campaigns/{campaignId}/approve", null);

        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        var approved = (await approve.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        approved.GetProperty("status").GetString().Should().Be("scheduled");
        approved.GetProperty("approved_by").GetInt32().Should().Be(TestData.AdminUser.Id);
        approved.GetProperty("approved_at").GetString().Should().NotBeNullOrWhiteSpace();

        var dispatch = await Client.PostAsync($"/api/v2/admin/push-campaigns/{campaignId}/dispatch", null);

        dispatch.StatusCode.Should().Be(HttpStatusCode.OK);
        var dispatchData = (await dispatch.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        dispatchData.GetProperty("sent").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        dispatchData.GetProperty("failed").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        dispatchData.GetProperty("total_cost_cents").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var rejectCreate = await Client.PostAsJsonAsync("/api/v2/me/push-campaigns", new
        {
            name = "Laravel React rejected push campaign",
            title = "Rejected title",
            body = "Rejected body",
            advertiser_type = "sme"
        });
        var rejectCampaignId = (await rejectCreate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();
        await Client.PostAsync($"/api/v2/me/push-campaigns/{rejectCampaignId}/submit", null);

        var reject = await Client.PostAsJsonAsync($"/api/v2/admin/push-campaigns/{rejectCampaignId}/reject", new
        {
            reason = "Needs clearer targeting."
        });

        reject.StatusCode.Should().Be(HttpStatusCode.OK);
        var rejectData = (await reject.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        rejectData.GetProperty("rejected").GetBoolean().Should().BeTrue();

        var rejectedDetail = await Client.GetAsync($"/api/v2/admin/push-campaigns/{rejectCampaignId}");
        var rejectedDetailData = (await rejectedDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        rejectedDetailData.GetProperty("status").GetString().Should().Be("rejected");
        rejectedDetailData.GetProperty("rejection_reason").GetString().Should().Be("Needs clearer targeting.");
    }

    [Fact]
    public async Task AdminApiPartners_UseLaravelReactManagementShape()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/api-partners", new
        {
            name = "Laravel React Bank Partner",
            contact_email = "bank-partner@example.test",
            description = "Created by Laravel React contract smoke test.",
            allowed_scopes = new[] { "users.read", "wallet.read" },
            allowed_ip_cidrs = new[] { "203.0.113.0/24" },
            rate_limit_per_minute = 120,
            is_sandbox = true
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var createData = createJson.GetProperty("data");
        var partnerId = createData.GetProperty("partner_id").GetInt32();
        partnerId.Should().BeGreaterThan(0);
        createData.GetProperty("credentials").GetProperty("client_id").GetString().Should().NotBeNullOrWhiteSpace();
        createData.GetProperty("credentials").GetProperty("client_secret").GetString().Should().NotBeNullOrWhiteSpace();

        var list = await Client.GetAsync("/api/v2/admin/api-partners");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var partners = listJson.GetProperty("data").GetProperty("partners").EnumerateArray().ToArray();
        var partner = partners.Single(item => item.GetProperty("id").GetInt32() == partnerId);
        partner.GetProperty("name").GetString().Should().Be("Laravel React Bank Partner");
        partner.GetProperty("slug").GetString().Should().NotBeNullOrWhiteSpace();
        partner.GetProperty("description").GetString().Should().Be("Created by Laravel React contract smoke test.");
        partner.GetProperty("contact_email").GetString().Should().Be("bank-partner@example.test");
        partner.GetProperty("status").GetString().Should().Be("pending");
        partner.GetProperty("is_sandbox").GetBoolean().Should().BeTrue();
        partner.GetProperty("allowed_scopes").EnumerateArray().Select(x => x.GetString()).Should().Equal("users.read", "wallet.read");
        partner.GetProperty("allowed_ip_cidrs").EnumerateArray().Select(x => x.GetString()).Should().Equal("203.0.113.0/24");
        partner.GetProperty("rate_limit_per_minute").GetInt32().Should().Be(120);

        var activate = await Client.PostAsync($"/api/v2/admin/api-partners/{partnerId}/activate", null);

        activate.StatusCode.Should().Be(HttpStatusCode.OK);
        var activated = (await activate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        activated.GetProperty("partner_id").GetInt32().Should().Be(partnerId);
        activated.GetProperty("status").GetString().Should().Be("active");

        var rotate = await Client.PostAsync($"/api/v2/admin/api-partners/{partnerId}/regenerate-credentials", null);

        rotate.StatusCode.Should().Be(HttpStatusCode.Created);
        var rotatedCredentials = (await rotate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("credentials");
        rotatedCredentials.GetProperty("client_id").GetString().Should().NotBeNullOrWhiteSpace();
        rotatedCredentials.GetProperty("client_secret").GetString().Should().NotBeNullOrWhiteSpace();

        var suspend = await Client.PostAsync($"/api/v2/admin/api-partners/{partnerId}/suspend", null);

        suspend.StatusCode.Should().Be(HttpStatusCode.OK);
        var suspended = (await suspend.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        suspended.GetProperty("partner_id").GetInt32().Should().Be(partnerId);
        suspended.GetProperty("status").GetString().Should().Be("suspended");

        var callLog = await Client.GetAsync($"/api/v2/admin/api-partners/{partnerId}/call-log?per_page=50");

        callLog.StatusCode.Should().Be(HttpStatusCode.OK);
        var callLogData = (await callLog.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        callLogData.GetProperty("items").ValueKind.Should().Be(JsonValueKind.Array);
        callLogData.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task UserNotificationPreferences_UseLaravelSettingsShape()
    {
        await AuthenticateAsMemberAsync();

        var initial = await Client.GetAsync("/api/v2/users/me/notifications");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("email_messages").GetBoolean().Should().BeTrue();
        initialData.GetProperty("email_digest").GetBoolean().Should().BeFalse();
        initialData.GetProperty("federation_notifications_enabled").GetBoolean().Should().BeTrue();
        initialData.GetProperty("push_enabled").GetBoolean().Should().BeTrue();

        var update = await Client.PutAsJsonAsync("/api/v2/users/me/notifications", new
        {
            email_messages = false,
            email_listings = false,
            email_digest = true,
            email_connections = false,
            email_transactions = true,
            email_reviews = false,
            email_gamification_digest = false,
            email_gamification_milestones = true,
            email_org_payments = false,
            email_org_transfers = true,
            email_org_membership = false,
            email_org_admin = true,
            caring_smart_nudges = false,
            push_enabled = false,
            push_campaigns_opted_in = true,
            federation_notifications_enabled = false
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        updateJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var reloaded = await Client.GetAsync("/api/v2/users/me/notifications");

        reloaded.StatusCode.Should().Be(HttpStatusCode.OK);
        var reloadedData = (await reloaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        reloadedData.GetProperty("email_messages").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_listings").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_digest").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("email_connections").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_transactions").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("email_reviews").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_gamification_digest").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_gamification_milestones").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("email_org_payments").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_org_transfers").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("email_org_membership").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("email_org_admin").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("caring_smart_nudges").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("push_enabled").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("push_campaigns_opted_in").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("federation_notifications_enabled").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task UserMatchPreferences_UseLaravelDefaultsAndUpdateShape()
    {
        await AuthenticateAsMemberAsync();

        var initial = await Client.GetAsync("/api/v2/users/me/match-preferences");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("max_distance_km").GetInt32().Should().Be(25);
        initialData.GetProperty("min_match_score").GetInt32().Should().Be(50);
        initialData.GetProperty("notification_frequency").GetString().Should().Be("monthly");
        initialData.GetProperty("notify_hot_matches").GetBoolean().Should().BeTrue();
        initialData.GetProperty("notify_mutual_matches").GetBoolean().Should().BeTrue();
        initialData.GetProperty("matching_paused").GetBoolean().Should().BeFalse();
        initialData.GetProperty("categories").EnumerateArray().Should().BeEmpty();
        initialData.GetProperty("availability").EnumerateArray().Should().BeEmpty();

        var update = await Client.PutAsJsonAsync("/api/v2/users/me/match-preferences", new
        {
            notification_frequency = "weekly",
            notify_hot_matches = false,
            notify_mutual_matches = false,
            matching_paused = true,
            max_distance_km = 500,
            min_match_score = -3,
            categories = new[] { 3, 5, 5 },
            availability = new[] { "weekends", "weekday_evenings" }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateData = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updateData.GetProperty("notification_frequency").GetString().Should().Be("monthly");
        updateData.GetProperty("notify_hot_matches").GetBoolean().Should().BeFalse();
        updateData.GetProperty("notify_mutual_matches").GetBoolean().Should().BeFalse();
        updateData.GetProperty("matching_paused").GetBoolean().Should().BeTrue();
        updateData.GetProperty("max_distance_km").GetInt32().Should().Be(100);
        updateData.GetProperty("min_match_score").GetInt32().Should().Be(0);
        updateData.GetProperty("categories").EnumerateArray().Select(x => x.GetInt32()).Should().Equal(3, 5, 5);
        updateData.GetProperty("availability").EnumerateArray().Select(x => x.GetString()).Should().Equal("weekends", "weekday_evenings");
    }

    [Fact]
    public async Task UserConsentAndGdprRequest_UseLaravelSettingsShape()
    {
        await AuthenticateAsMemberAsync();

        var initial = await Client.GetAsync("/api/v2/users/me/consent");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.GetProperty("success").GetBoolean().Should().BeTrue();
        initialJson.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var update = await Client.PutAsJsonAsync("/api/v2/users/me/consent", new
        {
            slug = "marketing_email",
            given = true
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateData = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updateData.GetProperty("consent_type_slug").GetString().Should().Be("marketing_email");
        updateData.GetProperty("given").GetBoolean().Should().BeTrue();

        var reloaded = await Client.GetAsync("/api/v2/users/me/consent");

        reloaded.StatusCode.Should().Be(HttpStatusCode.OK);
        var reloadedData = (await reloaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        reloadedData.EnumerateArray()
            .Should().Contain(c => c.GetProperty("consent_type_slug").GetString() == "marketing_email"
                && c.GetProperty("given").GetBoolean());

        var gdpr = await Client.PostAsJsonAsync("/api/v2/users/me/gdpr-request", new
        {
            type = "access",
            notes = "Please send my data export."
        });

        gdpr.StatusCode.Should().Be(HttpStatusCode.Created);
        var gdprData = (await gdpr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        gdprData.GetProperty("request_id").GetInt32().Should().BeGreaterThan(0);
        gdprData.GetProperty("type").GetString().Should().Be("access");
        gdprData.GetProperty("status").GetString().Should().Be("pending");
    }

    [Fact]
    public async Task UserPreferences_UseLaravelPrivacyFeedAndTranslationShape()
    {
        await AuthenticateAsMemberAsync();

        var initial = await Client.GetAsync("/api/v2/users/me/preferences");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("privacy").GetProperty("privacy_profile").GetString().Should().Be("public");
        initialData.GetProperty("privacy").GetProperty("privacy_search").GetBoolean().Should().BeTrue();
        initialData.GetProperty("privacy").GetProperty("privacy_contact").GetBoolean().Should().BeTrue();
        initialData.GetProperty("feed").GetProperty("prefers_chronological").GetBoolean().Should().BeFalse();
        initialData.GetProperty("translation").GetProperty("auto_translate_ugc").GetBoolean().Should().BeFalse();

        var update = await Client.PutAsJsonAsync("/api/v2/users/me/preferences", new
        {
            privacy = new
            {
                privacy_profile = "connections",
                privacy_search = false,
                privacy_contact = false
            },
            feed = new
            {
                prefers_chronological = true
            },
            translation = new
            {
                auto_translate_ugc = true,
                auto_translate_target_locale = "ga"
            }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var updateData = updateJson.GetProperty("data");
        updateData.GetProperty("privacy").GetProperty("privacy_profile").GetString().Should().Be("connections");
        updateData.GetProperty("privacy").GetProperty("privacy_search").GetBoolean().Should().BeFalse();
        updateData.GetProperty("privacy").GetProperty("privacy_contact").GetBoolean().Should().BeFalse();
        updateData.GetProperty("feed").GetProperty("prefers_chronological").GetBoolean().Should().BeTrue();
        updateData.GetProperty("translation").GetProperty("auto_translate_ugc").GetBoolean().Should().BeTrue();
        updateData.GetProperty("translation").GetProperty("auto_translate_target_locale").GetString().Should().Be("ga");

        var reloaded = await Client.GetAsync("/api/v2/users/me/preferences");

        reloaded.StatusCode.Should().Be(HttpStatusCode.OK);
        var reloadedData = (await reloaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        reloadedData.GetProperty("privacy").GetProperty("privacy_profile").GetString().Should().Be("connections");
        reloadedData.GetProperty("privacy").GetProperty("privacy_search").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("privacy").GetProperty("privacy_contact").GetBoolean().Should().BeFalse();
        reloadedData.GetProperty("feed").GetProperty("prefers_chronological").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("translation").GetProperty("auto_translate_ugc").GetBoolean().Should().BeTrue();
        reloadedData.GetProperty("translation").GetProperty("auto_translate_target_locale").GetString().Should().Be("ga");
    }

    [Fact]
    public async Task SettingsSecurityApis_UseLaravelTwoFactorAndSessionsShape()
    {
        await AuthenticateAsMemberAsync();

        var status = await Client.GetAsync("/api/v2/auth/2fa/status");

        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusData = (await status.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statusData.GetProperty("enabled").GetBoolean().Should().BeFalse();
        statusData.GetProperty("setup_required").GetBoolean().Should().BeFalse();
        statusData.GetProperty("backup_codes_remaining").GetInt32().Should().Be(0);

        var setup = await Client.PostAsync("/api/v2/auth/2fa/setup", null);

        setup.StatusCode.Should().Be(HttpStatusCode.OK);
        var setupData = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        setupData.GetProperty("secret").GetString().Should().NotBeNullOrWhiteSpace();
        setupData.GetProperty("qr_code_url").GetString().Should().StartWith("data:image/svg+xml;base64,");
        setupData.GetProperty("backup_codes").ValueKind.Should().Be(JsonValueKind.Array);

        var sessions = await Client.GetAsync("/api/v2/users/me/sessions");

        sessions.StatusCode.Should().Be(HttpStatusCode.OK);
        var sessionsJson = await sessions.Content.ReadFromJsonAsync<JsonElement>();
        sessionsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        sessionsJson.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task UserProfileMe_UsesLaravelOwnProfileShapeAndUpdateFields()
    {
        await AuthenticateAsMemberAsync();

        var initial = await Client.GetAsync("/api/v2/users/me");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        initialData.GetProperty("email").GetString().Should().Be(TestData.MemberUser.Email);
        initialData.GetProperty("profile_type").GetString().Should().Be("individual");
        initialData.TryGetProperty("phone", out _).Should().BeTrue();
        initialData.TryGetProperty("tagline", out _).Should().BeTrue();
        initialData.TryGetProperty("location", out _).Should().BeTrue();
        initialData.TryGetProperty("latitude", out _).Should().BeTrue();
        initialData.TryGetProperty("longitude", out _).Should().BeTrue();
        initialData.TryGetProperty("organization_name", out _).Should().BeTrue();
        initialData.TryGetProperty("date_of_birth", out _).Should().BeTrue();
        initialData.GetProperty("has_2fa_enabled").GetBoolean().Should().BeFalse();

        var update = await Client.PutAsJsonAsync("/api/v2/users/me", new
        {
            first_name = "Taylor",
            last_name = "Timebank",
            name = "Taylor Timebank",
            phone = "+353 1 555 0101",
            tagline = "Community repair mentor",
            bio = "<p>I help neighbours repair bikes.</p>",
            location = "Dublin",
            latitude = 53.3498,
            longitude = -6.2603,
            profile_type = "organisation",
            organization_name = "Taylor Repairs",
            date_of_birth = "1990-01-02"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateData = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updateData.GetProperty("first_name").GetString().Should().Be("Taylor");
        updateData.GetProperty("last_name").GetString().Should().Be("Timebank");
        updateData.GetProperty("name").GetString().Should().Be("Taylor Repairs");
        updateData.GetProperty("phone").GetString().Should().Be("+353 1 555 0101");
        updateData.GetProperty("tagline").GetString().Should().Be("Community repair mentor");
        updateData.GetProperty("bio").GetString().Should().Be("<p>I help neighbours repair bikes.</p>");
        updateData.GetProperty("location").GetString().Should().Be("Dublin");
        updateData.GetProperty("latitude").GetDecimal().Should().Be(53.3498m);
        updateData.GetProperty("longitude").GetDecimal().Should().Be(-6.2603m);
        updateData.GetProperty("profile_type").GetString().Should().Be("organisation");
        updateData.GetProperty("organization_name").GetString().Should().Be("Taylor Repairs");
        updateData.GetProperty("date_of_birth").GetString().Should().Be("1990-01-02");

        var reloaded = await Client.GetAsync("/api/v2/users/me");

        reloaded.StatusCode.Should().Be(HttpStatusCode.OK);
        var reloadedData = (await reloaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        reloadedData.GetProperty("name").GetString().Should().Be("Taylor Repairs");
        reloadedData.GetProperty("phone").GetString().Should().Be("+353 1 555 0101");
        reloadedData.GetProperty("tagline").GetString().Should().Be("Community repair mentor");
        reloadedData.GetProperty("profile_type").GetString().Should().Be("organisation");
        reloadedData.GetProperty("organization_name").GetString().Should().Be("Taylor Repairs");
    }

    [Fact]
    public async Task PartnerApiV1_UsesLaravelClientCredentialsAndScopedResponseShapes()
    {
        var (clientId, clientSecret) = await RegisterApiPartnerAsync("users.read listings.read wallet.read wallet.write aggregates.read webhooks.manage");
        ClearAuthToken();

        var unsupportedGrant = await Client.PostAsJsonAsync("/api/partner/v1/oauth/token", new
        {
            grant_type = "password",
            client_id = clientId,
            client_secret = clientSecret
        });

        unsupportedGrant.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var unsupportedJson = await unsupportedGrant.Content.ReadFromJsonAsync<JsonElement>();
        unsupportedJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("unsupported_grant_type");

        var tokenResponse = await Client.PostAsJsonAsync("/api/partner/v1/oauth/token", new
        {
            grant_type = "client_credentials",
            client_id = clientId,
            client_secret = clientSecret,
            scope = "listings.read wallet.read wallet.write aggregates.read webhooks.manage"
        });

        tokenResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        tokenResponse.Headers.GetValues("API-Version").Single().Should().Be("2.0");
        var tokenJson = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = tokenJson.GetProperty("access_token").GetString();
        accessToken.Should().NotBeNullOrWhiteSpace();
        tokenJson.GetProperty("token_type").GetString().Should().Be("bearer");
        tokenJson.GetProperty("expires_in").GetInt32().Should().Be(3600);
        tokenJson.GetProperty("scope").GetString().Should().Be("listings.read wallet.read wallet.write aggregates.read webhooks.manage");

        Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var listings = await Client.GetAsync("/api/partner/v1/listings?page=1&per_page=2");
        listings.StatusCode.Should().Be(HttpStatusCode.OK);
        listings.Headers.GetValues("API-Version").Single().Should().Be("2.0");
        var listingsJson = await listings.Content.ReadFromJsonAsync<JsonElement>();
        listingsJson.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        listingsJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listingsJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(2);

        var aggregate = await Client.GetAsync("/api/partner/v1/aggregates/community");
        aggregate.StatusCode.Should().Be(HttpStatusCode.OK);
        var aggregateData = (await aggregate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        aggregateData.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        aggregateData.GetProperty("active_members_bucket").GetInt32().Should().Be(0);
        aggregateData.GetProperty("active_listings_bucket").GetInt32().Should().Be(0);
        aggregateData.GetProperty("generated_at").GetString().Should().NotBeNullOrWhiteSpace();

        decimal memberBalanceBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
            memberBalanceBefore = await wallet.GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
        }

        var credit = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 1.25m,
            reference = "settlement-001",
            note = "Bank settlement"
        });

        credit.StatusCode.Should().Be(HttpStatusCode.Created);
        var creditData = (await credit.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        creditData.GetProperty("transaction_id").GetInt32().Should().BeGreaterThan(0);
        creditData.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        creditData.GetProperty("hours").GetDecimal().Should().Be(1.25m);
        creditData.GetProperty("reference").GetString().Should().Be("settlement-001");
        creditData.GetProperty("replayed").GetBoolean().Should().BeFalse();

        var replay = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 1.25m,
            reference = "settlement-001",
            note = "A changed note does not change the financial request"
        });
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        var replayData = (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        replayData.GetProperty("transaction_id").GetInt32()
            .Should().Be(creditData.GetProperty("transaction_id").GetInt32());
        replayData.GetProperty("replayed").GetBoolean().Should().BeTrue();

        var caseInsensitiveReplay = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 1.25m,
            reference = "SETTLEMENT-001"
        });
        caseInsensitiveReplay.StatusCode.Should().Be(HttpStatusCode.OK);
        (await caseInsensitiveReplay.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("replayed")
            .GetBoolean()
            .Should().BeTrue();

        var conflict = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 2m,
            reference = "settlement-001"
        });
        conflict.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await conflict.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors")[0]
            .GetProperty("code")
            .GetString()
            .Should().Be("idempotency_conflict");

        var oversized = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 24.001m,
            reference = "settlement-too-precise"
        });
        oversized.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var overMaximum = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 24.01m,
            reference = "settlement-over-maximum"
        });
        overMaximum.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var tooPrecise = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 1.001m,
            reference = "settlement-too-precise-only"
        });
        tooPrecise.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var exactMaximum = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 24m,
            reference = "settlement-exact-maximum"
        });
        exactMaximum.StatusCode.Should().Be(HttpStatusCode.Created);

        var concurrentCredits = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
            {
                user_id = TestData.MemberUser.Id,
                hours = 0.75m,
                reference = "settlement-concurrent"
            })));
        concurrentCredits.Count(response => response.StatusCode == HttpStatusCode.Created).Should().Be(1);
        concurrentCredits.Count(response => response.StatusCode == HttpStatusCode.OK).Should().Be(9);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evidence = await db.ApiPartnerWalletCredits
                .IgnoreQueryFilters()
                .SingleAsync(row => row.Reference == "settlement-001");
            evidence.Status.Should().Be("completed");
            evidence.Hours.Should().Be(1.25m);
            evidence.TransactionId.Should().Be(creditData.GetProperty("transaction_id").GetInt32());

            var ledger = await db.Transactions
                .IgnoreQueryFilters()
                .SingleAsync(row => row.Id == evidence.TransactionId);
            ledger.SenderId.Should().BeNull();
            ledger.ReceiverId.Should().Be(TestData.MemberUser.Id);
            ledger.TransactionType.Should().Be("other");
            (await db.Transactions
                .IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.ReceiverId == TestData.MemberUser.Id
                    && row.Description != null
                    && row.Description.Contains("(settlement-001)")))
                .Should().Be(1);

            var concurrentEvidence = await db.ApiPartnerWalletCredits
                .IgnoreQueryFilters()
                .SingleAsync(row => row.Reference == "settlement-concurrent");
            (await db.Transactions.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.ReceiverId == TestData.MemberUser.Id
                    && row.Description != null
                    && row.Description.Contains("(settlement-concurrent)")))
                .Should().Be(1);
            concurrentEvidence.TransactionId.Should().NotBeNull();
        }

        var balance = await Client.GetAsync($"/api/partner/v1/wallet/balance/{TestData.MemberUser.Id}");

        balance.StatusCode.Should().Be(HttpStatusCode.OK);
        var balanceData = (await balance.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        balanceData.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        balanceData.GetProperty("balance_hours").GetDecimal().Should().Be(memberBalanceBefore + 26m);
        balanceData.GetProperty("currency").GetString().Should().Be("time_credits");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var consent = await db.FederationUserSettings
                .IgnoreQueryFilters()
                .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.UserId == TestData.MemberUser.Id);
            consent.TransactionsEnabled = false;
            await db.SaveChangesAsync();
        }

        var consentBlocked = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 1m,
            reference = "settlement-without-consent"
        });
        consentBlocked.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.ApiPartnerWalletCredits
                .IgnoreQueryFilters()
                .AnyAsync(row => row.Reference == "settlement-without-consent"))
                .Should().BeFalse();
        }

        var webhook = await Client.PostAsJsonAsync("/api/partner/v1/webhooks/subscriptions", new
        {
            event_types = new[] { "wallet.credited" },
            target_url = "https://partner.example.test/hooks/nexus"
        });

        webhook.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await webhook.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors")[0]
            .GetProperty("code")
            .GetString()
            .Should().Be("webhook_subscriptions_unavailable");

        var webhookList = await Client.GetAsync("/api/partner/v1/webhooks/subscriptions");
        webhookList.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await webhookList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors")[0]
            .GetProperty("code")
            .GetString()
            .Should().Be("webhook_subscriptions_unavailable");
    }

    [Fact]
    public async Task MarketplaceSellerShippingOptions_BySellerId_ReturnsActiveOptions()
    {
        await AuthenticateAsMemberAsync();
        await SeedShippingOptionAsync(TestData.AdminUser.Id);

        var response = await Client.GetAsync($"/api/v2/marketplace/sellers/{TestData.AdminUser.Id}/shipping-options");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Array);
        data.EnumerateArray().Should().Contain(item =>
            item.GetProperty("courier_name").GetString() == "Tracked courier" &&
            item.GetProperty("currency").GetString() == "EUR" &&
            item.GetProperty("price").GetDecimal() == 4.95m &&
            item.GetProperty("is_active").GetBoolean() &&
            item.GetProperty("is_default").GetBoolean() == false);
    }

    [Fact]
    public async Task MembersSearchAlias_ReturnsLaravelReactArrayShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/members/search?q=Admin&limit=5");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Array);
        data.EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == TestData.AdminUser.Id &&
            !string.IsNullOrWhiteSpace(item.GetProperty("name").GetString()));
    }

    [Fact]
    public async Task V2UploadAndList_ReturnNewsletterAssetShape()
    {
        await AuthenticateAsAdminAsync();

        using var form = CreateImageForm();
        var upload = await Client.PostAsync("/api/v2/upload", form);

        upload.StatusCode.Should().Be(HttpStatusCode.Created);
        var uploadJson = await upload.Content.ReadFromJsonAsync<JsonElement>();
        uploadJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var uploaded = uploadJson.GetProperty("data");
        uploaded.GetProperty("url").GetString().Should().StartWith("/api/files/");
        var path = uploaded.GetProperty("path").GetString();
        path.Should().NotBeNullOrWhiteSpace();

        var list = await Client.GetAsync("/api/v2/upload/list");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.GetProperty("data").GetProperty("images").EnumerateArray()
            .Should().Contain(image => image.GetProperty("path").GetString() == path);
    }

    [Fact]
    public async Task BookmarkCollectionPatchAlias_UpdatesCurrentUsersCollection()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/bookmark-collections", new
        {
            name = "Original",
            description = "Before"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = createJson.GetProperty("data").GetProperty("id").GetInt32();

        var patch = await Client.PatchAsJsonAsync($"/api/v2/bookmark-collections/{id}", new
        {
            name = "Updated",
            description = "After"
        });

        patch.StatusCode.Should().Be(HttpStatusCode.OK);
        var patchJson = await patch.Content.ReadFromJsonAsync<JsonElement>();
        patchJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = patchJson.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().Be(id);
        data.GetProperty("name").GetString().Should().Be("Updated");
        data.GetProperty("description").GetString().Should().Be("After");
    }

    [Fact]
    public async Task AdminPrerenderTenantSafety_ReturnsLaravelReactShape()
    {
        await AuthenticateAsPlatformSuperAdminAsync();

        var response = await Client.GetAsync($"/api/v2/admin/prerender/tenant-safety?tenant={TestData.Tenant1.Slug}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("tenant").GetProperty("slug").GetString().Should().Be(TestData.Tenant1.Slug);
        data.GetProperty("counts").TryGetProperty("expected", out _).Should().BeTrue();
        data.GetProperty("static_routes").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("snapshots").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task AdminWindowOpenAndDownloadContracts_UseExpectedMethods()
    {
        await AuthenticateAsAdminAsync();

        var template = await Client.GetAsync("/api/v2/admin/users/import/template");
        template.StatusCode.Should().Be(HttpStatusCode.OK);
        template.Content.Headers.ContentType?.MediaType.Should().NotBeNullOrWhiteSpace();

        var export = await Client.PostAsJsonAsync("/api/v2/admin/federation/data/export", new { });
        export.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        export.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Fact]
    public async Task AdminSession_FormToken_BridgesToLegacyAdminRedirect()
    {
        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        ClearAuthToken();
        using var redirectClient = Factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });

        var response = await redirectClient.PostAsync("/api/auth/admin-session", new FormUrlEncodedContent([
            new KeyValuePair<string, string>("token", token),
            new KeyValuePair<string, string>("redirect", "/admin-legacy")
        ]));

        response.StatusCode.Should().Be(HttpStatusCode.Redirect);
        response.Headers.Location?.ToString().Should().Be("/admin-legacy");
    }

    [Fact]
    public async Task AdminAttributesV2_ReturnsLaravelReactAttributeShape()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/attributes", new
        {
            name = "Skill Level",
            type = "select",
            category_id = (int?)null
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var created = createJson.GetProperty("data");
        created.GetProperty("slug").GetString().Should().Be("skill-level");
        created.GetProperty("type").GetString().Should().Be("select");
        created.GetProperty("category_id").ValueKind.Should().Be(JsonValueKind.Null);
        created.GetProperty("is_active").GetBoolean().Should().BeTrue();
        var id = created.GetProperty("id").GetInt32();

        var list = await Client.GetAsync("/api/v2/admin/attributes");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(attribute => attribute.GetProperty("id").GetInt32() == id);
        listed.GetProperty("slug").GetString().Should().Be("skill-level");
        listed.GetProperty("options").ValueKind.Should().Be(JsonValueKind.Null);
        listed.GetProperty("category_name").ValueKind.Should().Be(JsonValueKind.Null);
        listed.GetProperty("target_type").GetString().Should().Be("any");

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/attributes/{id}", new
        {
            name = "Skill Rating",
            is_active = false
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        var updated = updateJson.GetProperty("data");
        updated.GetProperty("slug").GetString().Should().Be("skill-rating");
        updated.GetProperty("is_active").GetBoolean().Should().BeFalse();

        var delete = await Client.DeleteAsync($"/api/v2/admin/attributes/{id}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminBackgroundJobsV2_ReturnsLaravelReactOperationsShape()
    {
        await AuthenticateAsAdminAsync();

        var list = await Client.GetAsync("/api/v2/admin/background-jobs");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var jobs = listJson.GetProperty("data").EnumerateArray().ToList();
        jobs.Select(job => job.GetProperty("id").GetString()).Should().BeEquivalentTo([
            "digest_emails",
            "badge_checker",
            "streak_updater"
        ]);
        jobs.Should().OnlyContain(job => HasLaravelBackgroundJobShape(job));

        var run = await Client.PostAsync("/api/v2/admin/background-jobs/digest_emails/run", null);

        run.StatusCode.Should().Be(HttpStatusCode.OK);
        var runJson = await run.Content.ReadFromJsonAsync<JsonElement>();
        runJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = runJson.GetProperty("data");
        data.GetProperty("triggered").GetBoolean().Should().BeTrue();
        data.GetProperty("job").GetString().Should().Be("digest_emails");
    }

    [Fact]
    public async Task AdminCacheStatsV2_ReturnsLaravelReactOperationsShape()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/cache/stats");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("redis_connected").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
        data.GetProperty("redis_memory_used").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("redis_keys_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        data.GetProperty("cache_hit_rate").GetDouble().Should().BeGreaterThanOrEqualTo(0);

        var clear = await Client.PostAsJsonAsync("/api/v2/admin/cache/clear", new { type = "tenant" });
        clear.StatusCode.Should().Be(HttpStatusCode.OK);
        var clearJson = await clear.Content.ReadFromJsonAsync<JsonElement>();
        clearJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var clearData = clearJson.GetProperty("data");
        clearData.GetProperty("cleared").GetBoolean().Should().BeTrue();
        clearData.GetProperty("type").GetString().Should().Be("tenant");
    }

    [Fact]
    public async Task AdminMatchingConfigV2_ReturnsLaravelReactSmartMatchingShape()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/matching/config");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("category_weight").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("skill_weight").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("proximity_weight").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("freshness_weight").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("reciprocity_weight").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("quality_weight").GetDouble().Should().BeGreaterThan(0);
        data.GetProperty("enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("broker_approval_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("max_distance_km").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("min_match_score").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("hot_match_threshold").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("proximity_bands").EnumerateArray().Should().HaveCount(5);
        data.GetProperty("gates").GetProperty("missing_coords_mode").GetString().Should().Be("remote_only");
        data.GetProperty("ai").GetProperty("semantic_signal").GetBoolean().Should().BeTrue();
        data.GetProperty("ai").GetProperty("available").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
    }

    [Fact]
    public async Task AdminMatchingConfigV2_PersistsLaravelReactSmartMatchingShape()
    {
        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync("/api/v2/admin/matching/config", new
        {
            category_weight = 0.30m,
            skill_weight = 0.18m,
            proximity_weight = 0.22m,
            freshness_weight = 0.10m,
            reciprocity_weight = 0.14m,
            quality_weight = 0.06m,
            proximity_bands = new[]
            {
                new { distance_km = 3, score = 1.0m },
                new { distance_km = 12, score = 0.9m },
                new { distance_km = 25, score = 0.7m },
                new { distance_km = 45, score = 0.5m },
                new { distance_km = 90, score = 0.2m }
            },
            gates = new
            {
                geo_hard_gate = false,
                missing_coords_mode = "tenant_wide",
                dormancy_days = 120,
                owner_dismissal_threshold = 4
            },
            engine_version = 2,
            pillars = new { relevance = 0.50m, feasibility = 0.30m, trust = 0.20m },
            adjustments = new { mutual_bonus = 9m, freshness_max = 5m, semantic_boost = 7m, knn_boost = 4m },
            ai = new { semantic_signal = false, llm_explanations = true, explanation_top_n = 4 }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var get = await Client.GetAsync("/api/v2/admin/matching/config");

        get.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await get.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("category_weight").GetDecimal().Should().Be(0.30m);
        data.GetProperty("skill_weight").GetDecimal().Should().Be(0.18m);
        data.GetProperty("proximity_weight").GetDecimal().Should().Be(0.22m);
        data.GetProperty("gates").GetProperty("geo_hard_gate").GetBoolean().Should().BeFalse();
        data.GetProperty("gates").GetProperty("missing_coords_mode").GetString().Should().Be("tenant_wide");
        data.GetProperty("gates").GetProperty("dormancy_days").GetInt32().Should().Be(120);
        data.GetProperty("pillars").GetProperty("relevance").GetDecimal().Should().Be(0.50m);
        data.GetProperty("adjustments").GetProperty("mutual_bonus").GetDecimal().Should().Be(9m);
        data.GetProperty("ai").GetProperty("semantic_signal").GetBoolean().Should().BeFalse();
        data.GetProperty("ai").GetProperty("explanation_top_n").GetInt32().Should().Be(4);
        data.GetProperty("proximity_bands").EnumerateArray().Select(item => item.GetProperty("distance_km").GetInt32())
            .Should().Equal(3, 12, 25, 45, 90);
    }

    [Fact]
    public async Task AdminLanguageConfigV2_AcceptsAndReturnsLaravelReactSupportedLanguagesShape()
    {
        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync("/api/v2/admin/config/languages", new
        {
            default_language = "ga",
            supported_languages = new[] { "en", "ga", "fr" }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        var updateData = updateJson.GetProperty("data");
        updateData.GetProperty("default_language").GetString().Should().Be("ga");
        updateData.GetProperty("supported_languages").EnumerateArray().Select(x => x.GetString())
            .Should().BeEquivalentTo(["en", "ga", "fr"]);

        var get = await Client.GetAsync("/api/v2/admin/config/languages");

        get.StatusCode.Should().Be(HttpStatusCode.OK);
        var getJson = await get.Content.ReadFromJsonAsync<JsonElement>();
        getJson.GetProperty("default_language").GetString().Should().Be("ga");
        getJson.GetProperty("supported_languages").EnumerateArray().Select(x => x.GetString())
            .Should().BeEquivalentTo(["en", "ga", "fr"]);
    }

    [Fact]
    public async Task AdminGroupConfigV2_ReturnsAndPersistsLaravelReactModuleConfigShape()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/groups");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("config").ValueKind.Should().Be(JsonValueKind.Object);
        initialData.GetProperty("defaults").ValueKind.Should().Be(JsonValueKind.Object);

        var singleUpdate = await Client.PutAsJsonAsync("/api/v2/admin/config/groups", new
        {
            key = "max_members_per_group",
            value = 250
        });

        singleUpdate.StatusCode.Should().Be(HttpStatusCode.OK);
        var singleJson = await singleUpdate.Content.ReadFromJsonAsync<JsonElement>();
        var singleData = singleJson.GetProperty("data");
        singleData.GetProperty("key").GetString().Should().Be("max_members_per_group");
        singleData.GetProperty("value").GetInt32().Should().Be(250);

        var bulkUpdate = await Client.PutAsJsonAsync("/api/v2/admin/config/groups/bulk", new
        {
            settings = new
            {
                allow_private_groups = true,
                max_members_per_group = 300
            }
        });

        bulkUpdate.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkJson = await bulkUpdate.Content.ReadFromJsonAsync<JsonElement>();
        var updated = bulkJson.GetProperty("data").GetProperty("updated");
        updated.GetProperty("allow_private_groups").GetBoolean().Should().BeTrue();
        updated.GetProperty("max_members_per_group").GetInt32().Should().Be(300);

        var saved = await Client.GetAsync("/api/v2/admin/config/groups");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var savedJson = await saved.Content.ReadFromJsonAsync<JsonElement>();
        var config = savedJson.GetProperty("data").GetProperty("config");
        config.GetProperty("allow_private_groups").GetBoolean().Should().BeTrue();
        config.GetProperty("max_members_per_group").GetInt32().Should().Be(300);
    }

    [Fact]
    public async Task AdminIdentityConfigV2_ReturnsAndPersistsLaravelReactModuleConfigShape()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/identity");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("config").GetProperty("identity_verification_fee_cents")
            .GetInt32().Should().Be(500);
        initialData.GetProperty("defaults").GetProperty("identity_verification_fee_cents")
            .GetInt32().Should().Be(500);

        var bulkUpdate = await Client.PutAsJsonAsync("/api/v2/admin/config/identity/bulk", new
        {
            settings = new
            {
                identity_verification_fee_cents = 0
            }
        });

        bulkUpdate.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkJson = await bulkUpdate.Content.ReadFromJsonAsync<JsonElement>();
        bulkJson.GetProperty("data").GetProperty("updated")
            .GetProperty("identity_verification_fee_cents").GetInt32().Should().Be(0);

        var saved = await Client.GetAsync("/api/v2/admin/config/identity");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var savedJson = await saved.Content.ReadFromJsonAsync<JsonElement>();
        savedJson.GetProperty("data").GetProperty("config")
            .GetProperty("identity_verification_fee_cents").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task AdminTranslationConfigV2_ReturnsAndPersistsLaravelReactConfigShape()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/translation");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var initialData = initialJson.GetProperty("data");
        initialData.GetProperty("config").GetProperty("translation.engine")
            .GetString().Should().Be("openai");
        initialData.GetProperty("defaults").GetProperty("translation.max_per_user_per_hour")
            .GetInt32().Should().Be(100);

        var update = await Client.PutAsJsonAsync("/api/v2/admin/config/translation", new
        {
            key = "translation.auto_translate_default",
            value = true
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        var updateData = updateJson.GetProperty("data");
        updateData.GetProperty("key").GetString().Should().Be("translation.auto_translate_default");
        updateData.GetProperty("value").GetBoolean().Should().BeTrue();

        var saved = await Client.GetAsync("/api/v2/admin/config/translation");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var savedJson = await saved.Content.ReadFromJsonAsync<JsonElement>();
        savedJson.GetProperty("data").GetProperty("config")
            .GetProperty("translation.auto_translate_default").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminTranslationGlossaryV2_ReturnsCreatesAndDeletesLaravelReactShape()
    {
        await AuthenticateAsAdminAsync();

        var empty = await Client.GetAsync("/api/v2/admin/translation/glossary?language=ga");

        empty.StatusCode.Should().Be(HttpStatusCode.OK);
        var emptyJson = await empty.Content.ReadFromJsonAsync<JsonElement>();
        emptyJson.GetProperty("data").GetProperty("items").ValueKind.Should().Be(JsonValueKind.Array);
        emptyJson.GetProperty("data").GetProperty("total").GetInt32().Should().Be(0);

        var create = await Client.PostAsJsonAsync("/api/v2/admin/translation/glossary", new
        {
            source_term = "hello",
            target_term = "dia dhuit",
            target_language = "ga"
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var createdId = createJson.GetProperty("data").GetProperty("id").GetInt32();
        createdId.Should().BeGreaterThan(0);

        var list = await Client.GetAsync("/api/v2/admin/translation/glossary?language=ga");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var data = listJson.GetProperty("data");
        data.GetProperty("total").GetInt32().Should().Be(1);
        var item = data.GetProperty("items").EnumerateArray().Single();
        item.GetProperty("id").GetInt32().Should().Be(createdId);
        item.GetProperty("source_term").GetString().Should().Be("hello");
        item.GetProperty("target_term").GetString().Should().Be("dia dhuit");
        item.GetProperty("target_language").GetString().Should().Be("ga");
        item.GetProperty("is_active").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/translation/glossary/{createdId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminListingConfigV2_ReturnsFrontendDefaultsAndPersistsUpdates()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/listings");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var defaults = initialJson.GetProperty("data").GetProperty("defaults");
        defaults.GetProperty("listing.max_per_user").GetInt32().Should().Be(50);
        defaults.GetProperty("listing.max_images").GetInt32().Should().Be(5);
        defaults.GetProperty("listing.allow_offers").GetBoolean().Should().BeTrue();
        defaults.GetProperty("listing.enable_map_view").GetBoolean().Should().BeTrue();

        var update = await Client.PutAsJsonAsync("/api/v2/admin/config/listings", new
        {
            key = "listing.max_per_user",
            value = 25
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("data").GetProperty("value").GetInt32().Should().Be(25);

        var bulk = await Client.PutAsJsonAsync("/api/v2/admin/config/listings/bulk", new
        {
            settings = new Dictionary<string, object?>
            {
                ["listing.max_images"] = 3,
                ["listing.require_image"] = true
            }
        });

        bulk.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkJson = await bulk.Content.ReadFromJsonAsync<JsonElement>();
        var updated = bulkJson.GetProperty("data").GetProperty("updated");
        updated.GetProperty("listing.max_images").GetInt32().Should().Be(3);
        updated.GetProperty("listing.require_image").GetBoolean().Should().BeTrue();

        var saved = await Client.GetAsync("/api/v2/admin/config/listings");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var config = (await saved.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("config");
        config.GetProperty("listing.max_per_user").GetInt32().Should().Be(25);
        config.GetProperty("listing.max_images").GetInt32().Should().Be(3);
        config.GetProperty("listing.require_image").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminVolunteeringConfigV2_ReturnsFrontendDefaultsAndPersistsBulkUpdates()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/volunteering");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var defaults = initialJson.GetProperty("data").GetProperty("defaults");
        defaults.GetProperty("volunteering.tab_opportunities").GetBoolean().Should().BeTrue();
        defaults.GetProperty("volunteering.cancellation_deadline_hours").GetInt32().Should().Be(24);
        defaults.GetProperty("volunteering.max_hours_per_shift").GetInt32().Should().Be(8);
        defaults.GetProperty("volunteering.expense_max_amount").GetInt32().Should().Be(500);
        defaults.GetProperty("volunteering.enable_matching").GetBoolean().Should().BeTrue();

        var bulk = await Client.PutAsJsonAsync("/api/v2/admin/config/volunteering/bulk", new
        {
            settings = new Dictionary<string, object?>
            {
                ["volunteering.max_hours_per_shift"] = 6,
                ["volunteering.expense_require_receipt"] = true,
                ["volunteering.enable_matching"] = false
            }
        });

        bulk.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkJson = await bulk.Content.ReadFromJsonAsync<JsonElement>();
        var updated = bulkJson.GetProperty("data").GetProperty("updated");
        updated.GetProperty("volunteering.max_hours_per_shift").GetInt32().Should().Be(6);
        updated.GetProperty("volunteering.expense_require_receipt").GetBoolean().Should().BeTrue();
        updated.GetProperty("volunteering.enable_matching").GetBoolean().Should().BeFalse();

        var saved = await Client.GetAsync("/api/v2/admin/config/volunteering");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var config = (await saved.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("config");
        config.GetProperty("volunteering.max_hours_per_shift").GetInt32().Should().Be(6);
        config.GetProperty("volunteering.expense_require_receipt").GetBoolean().Should().BeTrue();
        config.GetProperty("volunteering.enable_matching").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task AdminJobsConfigV2_ReturnsFrontendDefaultsAndPersistsBulkUpdates()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/jobs");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var defaults = initialJson.GetProperty("data").GetProperty("defaults");
        defaults.GetProperty("jobs.tab_browse").GetBoolean().Should().BeTrue();
        defaults.GetProperty("jobs.default_currency").GetString().Should().Be("EUR");
        defaults.GetProperty("jobs.max_postings_per_user").GetInt32().Should().Be(20);
        defaults.GetProperty("jobs.default_deadline_days").GetInt32().Should().Be(30);
        defaults.GetProperty("jobs.enable_cv_upload").GetBoolean().Should().BeTrue();
        defaults.GetProperty("jobs.featured_duration_days").GetInt32().Should().Be(7);

        var bulk = await Client.PutAsJsonAsync("/api/v2/admin/config/jobs/bulk", new
        {
            settings = new Dictionary<string, object?>
            {
                ["jobs.max_postings_per_user"] = 12,
                ["jobs.require_salary"] = true,
                ["jobs.enable_blind_hiring"] = true
            }
        });

        bulk.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkJson = await bulk.Content.ReadFromJsonAsync<JsonElement>();
        var updated = bulkJson.GetProperty("data").GetProperty("updated");
        updated.GetProperty("jobs.max_postings_per_user").GetInt32().Should().Be(12);
        updated.GetProperty("jobs.require_salary").GetBoolean().Should().BeTrue();
        updated.GetProperty("jobs.enable_blind_hiring").GetBoolean().Should().BeTrue();

        var saved = await Client.GetAsync("/api/v2/admin/config/jobs");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var config = (await saved.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("config");
        config.GetProperty("jobs.max_postings_per_user").GetInt32().Should().Be(12);
        config.GetProperty("jobs.require_salary").GetBoolean().Should().BeTrue();
        config.GetProperty("jobs.enable_blind_hiring").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminPodcastConfigV2_ReturnsFrontendDefaultsAndPersistsBulkUpdates()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/config/podcasts");

        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        var defaults = initialJson.GetProperty("defaults");
        defaults.GetProperty("podcasts.allow_member_show_creation").GetBoolean().Should().BeTrue();
        defaults.GetProperty("podcasts.max_shows_per_user").GetInt32().Should().Be(5);
        defaults.GetProperty("podcasts.max_audio_size_mb").GetInt32().Should().Be(250);
        defaults.GetProperty("podcasts.enable_media_scanning").GetBoolean().Should().BeTrue();
        defaults.GetProperty("podcasts.enable_media_processing").GetBoolean().Should().BeTrue();

        var bulk = await Client.PutAsJsonAsync("/api/v2/admin/config/podcasts/bulk", new
        {
            settings = new Dictionary<string, object?>
            {
                ["podcasts.max_shows_per_user"] = 2,
                ["podcasts.enable_rss_feed"] = false,
                ["podcasts.media_storage_driver"] = "cloud"
            }
        });

        bulk.StatusCode.Should().Be(HttpStatusCode.OK);
        var bulkJson = await bulk.Content.ReadFromJsonAsync<JsonElement>();
        var updated = bulkJson.GetProperty("updated");
        updated.GetProperty("podcasts.max_shows_per_user").GetInt32().Should().Be(2);
        updated.GetProperty("podcasts.enable_rss_feed").GetBoolean().Should().BeFalse();
        updated.GetProperty("podcasts.media_storage_driver").GetString().Should().Be("cloud");

        var saved = await Client.GetAsync("/api/v2/admin/config/podcasts");
        saved.StatusCode.Should().Be(HttpStatusCode.OK);
        var config = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("config");
        config.GetProperty("podcasts.max_shows_per_user").GetInt32().Should().Be(2);
        config.GetProperty("podcasts.enable_rss_feed").GetBoolean().Should().BeFalse();
        config.GetProperty("podcasts.media_storage_driver").GetString().Should().Be("cloud");
    }

    [Fact]
    public async Task AdminPodcastsV2_UsesLaravelReactIndexAndModerationShape()
    {
        await AuthenticateAsAdminAsync();

        var createShow = await Client.PostAsJsonAsync("/api/v2/podcasts", new
        {
            title = $"Laravel React Podcast {Guid.NewGuid():N}",
            summary = "Podcast admin contract show.",
            language = "en",
            category = "community",
            visibility = "public"
        });
        createShow.StatusCode.Should().Be(HttpStatusCode.Created);
        var showId = (await createShow.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var createEpisode = await Client.PostAsJsonAsync($"/api/v2/podcasts/{showId}/episodes", new
        {
            title = "Laravel React Podcast Episode",
            summary = "Podcast admin contract episode.",
            audio_url = "https://cdn.example.test/podcast-admin.mp3",
            duration_seconds = 120
        });
        createEpisode.StatusCode.Should().Be(HttpStatusCode.Created);
        var episodeId = (await createEpisode.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var index = await Client.GetAsync("/api/v2/admin/podcasts?moderation_status=pending&shows_page=1&episodes_page=1&per_page=20");

        index.StatusCode.Should().Be(HttpStatusCode.OK);
        var indexJson = await index.Content.ReadFromJsonAsync<JsonElement>();
        indexJson.GetProperty("success").GetBoolean().Should().BeTrue();
        indexJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var indexData = indexJson.GetProperty("data");
        indexData.GetProperty("shows").EnumerateArray().Should().Contain(row => row.GetProperty("id").GetInt32() == showId);
        indexData.GetProperty("episodes").EnumerateArray().Should().Contain(row => row.GetProperty("id").GetInt32() == episodeId);
        indexData.GetProperty("stats").GetProperty("pending_shows").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        indexData.GetProperty("stats").GetProperty("pending_episodes").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        indexJson.GetProperty("meta").GetProperty("shows_total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        indexJson.GetProperty("meta").GetProperty("episodes_total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var moderateShow = await Client.PostAsJsonAsync($"/api/v2/admin/podcasts/shows/{showId}/moderate", new { action = "approve" });

        moderateShow.StatusCode.Should().Be(HttpStatusCode.OK);
        var moderateShowJson = await moderateShow.Content.ReadFromJsonAsync<JsonElement>();
        moderateShowJson.GetProperty("success").GetBoolean().Should().BeTrue();
        moderateShowJson.GetProperty("data").GetProperty("moderation_status").GetString().Should().Be("approved");

        var moderateEpisode = await Client.PostAsJsonAsync($"/api/v2/admin/podcasts/episodes/{episodeId}/moderate", new { action = "reject" });

        moderateEpisode.StatusCode.Should().Be(HttpStatusCode.OK);
        var moderateEpisodeJson = await moderateEpisode.Content.ReadFromJsonAsync<JsonElement>();
        moderateEpisodeJson.GetProperty("success").GetBoolean().Should().BeTrue();
        moderateEpisodeJson.GetProperty("data").GetProperty("moderation_status").GetString().Should().Be("rejected");
    }

    [Fact]
    public async Task PodcastEpisodeMultipartUploadV2_AcceptsLaravelReactAudioFormData()
    {
        await AuthenticateAsMemberAsync();

        var createShow = await Client.PostAsJsonAsync("/api/v2/podcasts", new
        {
            title = $"Laravel React Multipart Podcast {Guid.NewGuid():N}",
            summary = "Podcast multipart upload contract show.",
            language = "en",
            category = "community",
            visibility = "public"
        });
        createShow.StatusCode.Should().Be(HttpStatusCode.Created);
        var showId = (await createShow.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Laravel React Uploaded Episode"), "title");
        form.Add(new StringContent("Uploaded with the React podcasts API FormData path."), "summary");
        form.Add(new StringContent("180"), "duration_seconds");
        form.Add(new StringContent("""[{"title":"Intro","starts_at_seconds":0,"url":"https://example.test/intro"}]"""), "chapters");
        using var audio = new ByteArrayContent(new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00, 0x00 });
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/mpeg");
        form.Add(audio, "audio", "episode.mp3");

        var response = await Client.PostAsync($"/api/v2/podcasts/{showId}/episodes", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var episode = json.GetProperty("data");
        episode.GetProperty("title").GetString().Should().Be("Laravel React Uploaded Episode");
        episode.GetProperty("summary").GetString().Should().Be("Uploaded with the React podcasts API FormData path.");
        episode.GetProperty("audio_url").GetString().Should().Be($"/api/v2/podcasts/media/{TestData.Tenant1.Id}/{episode.GetProperty("id").GetInt32()}/audio");
        episode.GetProperty("audio_mime").GetString().Should().Be("audio/mpeg");
        episode.GetProperty("audio_bytes").GetInt64().Should().Be(6);
        episode.GetProperty("duration_seconds").GetInt32().Should().Be(180);
        var chapter = episode.GetProperty("chapters").EnumerateArray().Should().ContainSingle().Subject;
        chapter.GetProperty("title").GetString().Should().Be("Intro");
        chapter.GetProperty("starts_at_seconds").GetInt32().Should().Be(0);
        chapter.GetProperty("url").GetString().Should().Be("https://example.test/intro");
    }

    [Fact]
    public async Task AdminRegistrationPolicyV2_UsesLaravelReactPolicyProviderAndCredentialShape()
    {
        await AuthenticateAsAdminAsync();

        var policy = await Client.GetAsync("/api/v2/admin/config/registration-policy");

        policy.StatusCode.Should().Be(HttpStatusCode.OK);
        var policyJson = await policy.Content.ReadFromJsonAsync<JsonElement>();
        policyJson.GetProperty("success").GetBoolean().Should().BeTrue();
        policyJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var policyData = policyJson.GetProperty("data");
        policyData.GetProperty("registration_mode").GetString().Should().NotBeNullOrWhiteSpace();
        policyData.GetProperty("verification_level").GetString().Should().NotBeNullOrWhiteSpace();
        policyData.GetProperty("post_verification").GetString().Should().NotBeNullOrWhiteSpace();
        policyData.GetProperty("fallback_mode").GetString().Should().NotBeNullOrWhiteSpace();
        policyData.GetProperty("require_email_verify").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);

        var providers = await Client.GetAsync("/api/v2/admin/identity/providers");

        providers.StatusCode.Should().Be(HttpStatusCode.OK);
        var providersJson = await providers.Content.ReadFromJsonAsync<JsonElement>();
        providersJson.GetProperty("success").GetBoolean().Should().BeTrue();
        providersJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        providersJson.GetProperty("data").EnumerateArray()
            .Should().Contain(provider =>
                provider.GetProperty("slug").GetString() == "veriff" &&
                provider.GetProperty("levels").ValueKind == JsonValueKind.Array &&
                HasProperty(provider, "available") &&
                HasProperty(provider, "has_credentials"));

        var update = await Client.PutAsJsonAsync("/api/v2/admin/config/registration-policy", new
        {
            registration_mode = "verified_identity",
            verification_provider = "veriff",
            verification_level = "document_selfie",
            post_verification = "admin_approval",
            fallback_mode = "admin_review",
            require_email_verify = true
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var updatedPolicy = updateJson.GetProperty("data");
        updatedPolicy.GetProperty("registration_mode").GetString().Should().Be("verified_identity");
        updatedPolicy.GetProperty("verification_provider").GetString().Should().Be("veriff");
        updatedPolicy.GetProperty("verification_level").GetString().Should().Be("document_selfie");
        updatedPolicy.GetProperty("post_verification").GetString().Should().Be("admin_approval");
        updatedPolicy.GetProperty("fallback_mode").GetString().Should().Be("admin_review");
        updatedPolicy.GetProperty("require_email_verify").GetBoolean().Should().BeTrue();

        var saveCredentials = await Client.PutAsJsonAsync("/api/v2/admin/identity/provider-credentials/veriff", new
        {
            api_key = "contract-veriff-key",
            webhook_secret = "contract-veriff-secret"
        });

        saveCredentials.StatusCode.Should().Be(HttpStatusCode.OK);
        var saveJson = await saveCredentials.Content.ReadFromJsonAsync<JsonElement>();
        saveJson.GetProperty("success").GetBoolean().Should().BeTrue();
        saveJson.GetProperty("data").GetProperty("saved").GetBoolean().Should().BeTrue();
        saveJson.GetProperty("data").GetProperty("provider_slug").GetString().Should().Be("veriff");

        var deleteCredentials = await Client.DeleteAsync("/api/v2/admin/identity/provider-credentials/veriff");

        deleteCredentials.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await deleteCredentials.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("provider_slug").GetString().Should().Be("veriff");
    }

    [Fact]
    public async Task AdminFederationNeighborhoodsV2_UsesLaravelReactCrudAndMembershipShape()
    {
        await AuthenticateAsAdminAsync();

        var available = await Client.GetAsync("/api/v2/admin/federation/available-tenants");

        available.StatusCode.Should().Be(HttpStatusCode.OK);
        var availableJson = await available.Content.ReadFromJsonAsync<JsonElement>();
        availableJson.GetProperty("success").GetBoolean().Should().BeTrue();
        availableJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var availableTenants = availableJson.GetProperty("data").EnumerateArray().ToArray();
        availableTenants.Should().Contain(t =>
            t.GetProperty("id").GetInt32() == TestData.Tenant2.Id &&
            t.GetProperty("name").GetString() == TestData.Tenant2.Name &&
            t.GetProperty("slug").GetString() == TestData.Tenant2.Slug);

        var create = await Client.PostAsJsonAsync("/api/v2/admin/federation/neighborhoods", new
        {
            name = $"Laravel React Neighborhood {Guid.NewGuid():N}",
            description = "Runtime contract neighborhood"
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createJson.GetProperty("success").GetBoolean().Should().BeTrue();
        createJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var created = createJson.GetProperty("data");
        var neighborhoodId = created.GetProperty("id").GetInt32();
        created.GetProperty("name").GetString().Should().StartWith("Laravel React Neighborhood");
        created.GetProperty("description").GetString().Should().Be("Runtime contract neighborhood");
        created.GetProperty("tenants").ValueKind.Should().Be(JsonValueKind.Array);
        created.GetProperty("tenant_count").GetInt32().Should().Be(0);
        created.GetProperty("total_members").GetInt32().Should().Be(0);
        created.GetProperty("shared_events_count").GetInt32().Should().Be(0);
        created.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();

        var addTenant = await Client.PostAsJsonAsync($"/api/v2/admin/federation/neighborhoods/{neighborhoodId}/tenants", new
        {
            tenant_id = TestData.Tenant2.Id
        });

        addTenant.StatusCode.Should().Be(HttpStatusCode.OK);
        var addTenantJson = await addTenant.Content.ReadFromJsonAsync<JsonElement>();
        addTenantJson.GetProperty("success").GetBoolean().Should().BeTrue();

        var list = await Client.GetAsync("/api/v2/admin/federation/neighborhoods");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(n => n.GetProperty("id").GetInt32() == neighborhoodId);
        listed.GetProperty("tenant_count").GetInt32().Should().Be(1);
        listed.GetProperty("tenants").EnumerateArray().Should().Contain(t =>
            t.GetProperty("tenant_id").GetInt32() == TestData.Tenant2.Id &&
            t.GetProperty("name").GetString() == TestData.Tenant2.Name &&
            t.GetProperty("slug").GetString() == TestData.Tenant2.Slug);
        listed.GetProperty("total_members").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        listed.GetProperty("shared_events_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var removeTenant = await Client.DeleteAsync($"/api/v2/admin/federation/neighborhoods/{neighborhoodId}/tenants/{TestData.Tenant2.Id}");

        removeTenant.StatusCode.Should().Be(HttpStatusCode.OK);
        var removeTenantJson = await removeTenant.Content.ReadFromJsonAsync<JsonElement>();
        removeTenantJson.GetProperty("success").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/federation/neighborhoods/{neighborhoodId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminCommunityAnalyticsV2_UsesLaravelReactDashboardGeographyAndExportShape()
    {
        await AuthenticateAsAdminAsync();

        var dashboard = await Client.GetAsync("/api/v2/admin/community-analytics");

        dashboard.StatusCode.Should().Be(HttpStatusCode.OK);
        var dashboardJson = await dashboard.Content.ReadFromJsonAsync<JsonElement>();
        dashboardJson.GetProperty("success").GetBoolean().Should().BeTrue();
        dashboardJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var data = dashboardJson.GetProperty("data");
        var overview = data.GetProperty("overview");
        overview.GetProperty("total_credits_circulation").ValueKind.Should().Be(JsonValueKind.Number);
        overview.GetProperty("transaction_volume_30d").ValueKind.Should().Be(JsonValueKind.Number);
        overview.GetProperty("transaction_count_30d").ValueKind.Should().Be(JsonValueKind.Number);
        overview.GetProperty("active_traders_30d").ValueKind.Should().Be(JsonValueKind.Number);
        overview.GetProperty("new_users_30d").ValueKind.Should().Be(JsonValueKind.Number);
        overview.GetProperty("avg_transaction_size").ValueKind.Should().Be(JsonValueKind.Number);
        data.GetProperty("monthly_trends").GetArrayLength().Should().Be(12);
        data.GetProperty("weekly_trends").GetArrayLength().Should().Be(12);
        data.GetProperty("top_earners").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("top_spenders").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("category_demand").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("engagement_rate").ValueKind.Should().Be(JsonValueKind.Number);

        var geography = await Client.GetAsync("/api/v2/admin/community-analytics/geography");

        geography.StatusCode.Should().Be(HttpStatusCode.OK);
        var geographyJson = await geography.Content.ReadFromJsonAsync<JsonElement>();
        geographyJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var geographyData = geographyJson.GetProperty("data");
        geographyData.GetProperty("member_locations").ValueKind.Should().Be(JsonValueKind.Array);
        geographyData.GetProperty("total_with_location").ValueKind.Should().Be(JsonValueKind.Number);
        geographyData.GetProperty("total_members").ValueKind.Should().Be(JsonValueKind.Number);
        geographyData.GetProperty("coverage_percentage").ValueKind.Should().Be(JsonValueKind.Number);
        geographyData.GetProperty("top_areas").ValueKind.Should().Be(JsonValueKind.Array);

        var export = await Client.GetAsync("/api/v2/admin/community-analytics/export");

        export.StatusCode.Should().Be(HttpStatusCode.OK);
        export.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        export.Content.Headers.ContentDisposition?.FileName.Should().Contain("community-analytics.csv");
        var csv = await export.Content.ReadAsStringAsync();
        csv.Split('\n')[0].Trim().Should().Be("Month,New Users,Active Traders,Transactions,Hours Exchanged");
    }

    [Fact]
    public async Task AdminCommentsV2_UsesLaravelReactModerationListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var commentId = await SeedAdminFeedCommentAsync("Laravel React moderation comment");

        var list = await Client.GetAsync("/api/v2/admin/comments?content_type=post&search=Laravel%20React%20moderation&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(comment => comment.GetProperty("id").GetInt32() == commentId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("target_type").GetString().Should().Be("post");
        listed.GetProperty("content_type").GetString().Should().Be("post");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React moderation comment");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listed.GetProperty("is_flagged").GetBoolean().Should().BeFalse();
        listed.GetProperty("reports_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/comments/{commentId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        detailJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(commentId);

        var hide = await Client.PostAsync($"/api/v2/admin/comments/{commentId}/hide", null);

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenList = await Client.GetAsync("/api/v2/admin/comments?content_type=post&search=Laravel%20React%20moderation&page=1&limit=20");

        hiddenList.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenComment = (await hiddenList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single(comment => comment.GetProperty("id").GetInt32() == commentId);
        hiddenComment.GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/comments/{commentId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactPostListDetailStatsHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var postId = await SeedAdminFeedPostAsync("Laravel React admin feed moderation post");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=post&status=flagged&search=Laravel%20React%20admin%20feed&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(post => post.GetProperty("id").GetInt32() == postId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("post");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React admin feed");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listed.GetProperty("is_flagged").GetBoolean().Should().BeTrue();
        listed.GetProperty("likes_count").GetInt32().Should().Be(1);
        listed.GetProperty("comments_count").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(20);
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{postId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(postId);
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);
        detailData.GetProperty("recent_comments").EnumerateArray().Should().ContainSingle();

        var stats = await Client.GetAsync("/api/v2/admin/feed/stats");

        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsJson = await stats.Content.ReadFromJsonAsync<JsonElement>();
        statsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var statsData = statsJson.GetProperty("data");
        statsData.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("hidden").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        statsData.GetProperty("total_comments").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("feed_posts_total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("feed_posts_flagged").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("reports_pending").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{postId}/hide", new { type = "post" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{postId}");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{postId}?type=post");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{postId}");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_AllowsBrokerAndCoordinatorButKeepsAnnouncerAdminOnly()
    {
        var postId = await SeedAdminFeedPostAsync("Laravel React broker feed moderation post");
        var brokerToken = await SeedAndLoginUserAsync("broker-feed@test.com", "broker");

        SetAuthToken(brokerToken);

        var brokerList = await Client.GetAsync("/api/v2/admin/feed/posts?type=post&search=Laravel%20React%20broker%20feed&page=1&limit=20");

        brokerList.StatusCode.Should().Be(HttpStatusCode.OK);
        var brokerListJson = await brokerList.Content.ReadFromJsonAsync<JsonElement>();
        brokerListJson.GetProperty("success").GetBoolean().Should().BeTrue();
        brokerListJson.GetProperty("data").EnumerateArray()
            .Should().Contain(post => post.GetProperty("id").GetInt32() == postId);

        var brokerHide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{postId}/hide", new { type = "post" });

        brokerHide.StatusCode.Should().Be(HttpStatusCode.OK);
        var brokerHideJson = await brokerHide.Content.ReadFromJsonAsync<JsonElement>();
        brokerHideJson.GetProperty("success").GetBoolean().Should().BeTrue();

        var brokerAnnouncerGrant = await Client.PostAsJsonAsync("/api/v2/admin/feed/grant-announcer", new { user_id = TestData.MemberUser.Id });

        brokerAnnouncerGrant.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var coordinatorToken = await SeedAndLoginUserAsync("coordinator-feed@test.com", "coordinator");

        SetAuthToken(coordinatorToken);

        var coordinatorStats = await Client.GetAsync("/api/v2/admin/feed/stats");

        coordinatorStats.StatusCode.Should().Be(HttpStatusCode.OK);
        var coordinatorStatsJson = await coordinatorStats.Content.ReadFromJsonAsync<JsonElement>();
        coordinatorStatsJson.GetProperty("success").GetBoolean().Should().BeTrue();

        await AuthenticateAsMemberAsync();

        var memberList = await Client.GetAsync("/api/v2/admin/feed/posts?type=post&page=1&limit=20");

        memberList.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminBrokerV2_CanonicalRiskAndMonitoringWritesPersistForBroker()
    {
        var brokerEmail = $"broker-write-{Guid.NewGuid():N}@test.com";
        var brokerToken = await SeedAndLoginUserAsync(brokerEmail, "broker");
        var brokerId = await GetUserIdByEmailAsync(brokerEmail);
        var listingId = await SeedAdminFeedListingAsync(
            $"Laravel React broker write {Guid.NewGuid():N}",
            brokerId);

        try
        {
            SetAuthToken(brokerToken);

            var invalidMonitoring = await Client.PostAsJsonAsync($"/api/v2/admin/broker/monitoring/{brokerId}", new
            {
                under_monitoring = true,
                messaging_disabled = true
            });
            invalidMonitoring.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var invalidMonitoringError = (await invalidMonitoring.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("errors")[0];
            invalidMonitoringError.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            invalidMonitoringError.GetProperty("field").GetString().Should().Be("reason");

            var saveRisk = await Client.PostAsJsonAsync($"/api/v2/admin/broker/risk-tags/{listingId}", new
            {
                risk_level = "high",
                risk_category = "safeguarding",
                risk_notes = "Canonical broker risk persistence"
            });
            saveRisk.StatusCode.Should().Be(HttpStatusCode.OK);
            var riskData = (await saveRisk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            riskData.GetProperty("listing_id").GetInt32().Should().Be(listingId);
            riskData.GetProperty("risk_level").GetString().Should().Be("high");
            riskData.GetProperty("risk_category").GetString().Should().Be("safeguarding");
            riskData.GetProperty("risk_notes").GetString().Should().Be("Canonical broker risk persistence");

            var monitoring = await Client.PostAsJsonAsync($"/api/v2/admin/broker/monitoring/{brokerId}", new
            {
                under_monitoring = true,
                reason = "Canonical monitoring persistence",
                messaging_disabled = true,
                expires_days = 2
            });
            monitoring.StatusCode.Should().Be(HttpStatusCode.OK);
            var monitoringData = (await monitoring.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            monitoringData.GetProperty("user_id").GetInt32().Should().Be(brokerId);
            monitoringData.GetProperty("under_monitoring").GetBoolean().Should().BeTrue();

            var monitoringList = await Client.GetAsync("/api/v2/admin/broker/monitoring");
            monitoringList.StatusCode.Should().Be(HttpStatusCode.OK);
            var monitoredUser = (await monitoringList.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("data")
                .EnumerateArray()
                .Single(item => item.GetProperty("user_id").GetInt32() == brokerId);
            monitoredUser.GetProperty("user_name").GetString().Should().NotBeNullOrWhiteSpace();
            monitoredUser.GetProperty("monitoring_reason").GetString().Should().Be("Canonical monitoring persistence");
            monitoredUser.GetProperty("messaging_disabled").GetBoolean().Should().BeTrue();

            var configuration = await Client.GetAsync("/api/v2/admin/broker/configuration");
            configuration.StatusCode.Should().Be(HttpStatusCode.OK);
            var unsafeBrokerWrite = await Client.PostAsJsonAsync("/api/v2/admin/broker/configuration", new
            {
                enforce_vetting_on_exchanges = false
            });
            unsafeBrokerWrite.StatusCode.Should().Be(HttpStatusCode.Forbidden);

            using (var verify = Factory.Services.CreateScope())
            {
                var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
                var storedRisk = await db.BrokerRiskTags.SingleAsync(tag => tag.ListingId == listingId);
                storedRisk.RiskLevel.Should().Be("high");
                storedRisk.RiskType.Should().Be("safeguarding");
                storedRisk.Notes.Should().Be("Canonical broker risk persistence");

                var storedMonitoring = await db.UserMonitoringRestrictions.SingleAsync(row => row.UserId == brokerId);
                storedMonitoring.UnderMonitoring.Should().BeTrue();
                storedMonitoring.MessagingDisabled.Should().BeTrue();
                storedMonitoring.Reason.Should().Be("Canonical monitoring persistence");
                storedMonitoring.MonitoringExpiresAt.Should().BeAfter(DateTime.UtcNow.AddHours(47));

                (await db.AuditLogs.SingleAsync(row =>
                    row.UserId == brokerId
                    && row.EntityId == brokerId
                    && row.Action == "user_monitoring_added"))
                    .Metadata.Should().Contain("\"messaging_disabled\":true");
                (await db.Notifications.SingleAsync(row =>
                    row.UserId == brokerId
                    && row.Title == "Your messaging has been temporarily restricted by your timebank coordinator."))
                    .Link.Should().Be("/messages");
            }

            var removeMonitoring = await Client.PostAsJsonAsync($"/api/v2/admin/broker/monitoring/{brokerId}", new
            {
                under_monitoring = false
            });
            removeMonitoring.StatusCode.Should().Be(HttpStatusCode.OK);

            using (var verifyRemoval = Factory.Services.CreateScope())
            {
                var db = verifyRemoval.ServiceProvider.GetRequiredService<NexusDbContext>();
                var storedMonitoring = await db.UserMonitoringRestrictions.SingleAsync(row => row.UserId == brokerId);
                storedMonitoring.UnderMonitoring.Should().BeFalse();
                storedMonitoring.MessagingDisabled.Should().BeFalse();
                storedMonitoring.MonitoringExpiresAt.Should().BeNull();
                storedMonitoring.Reason.Should().Be("Canonical monitoring persistence");
                (await db.AuditLogs.CountAsync(row =>
                    row.UserId == brokerId
                    && row.EntityId == brokerId
                    && (row.Action == "user_monitoring_added" || row.Action == "user_monitoring_removed")))
                    .Should().Be(2);
                (await db.Notifications.CountAsync(row =>
                    row.UserId == brokerId
                    && row.Link == "/messages"
                    && (row.Title == "Your messaging has been temporarily restricted by your timebank coordinator."
                        || row.Title == "Your messaging restrictions have been lifted.")))
                    .Should().Be(2);
            }

            var removeRisk = await Client.DeleteAsync($"/api/v2/admin/broker/risk-tags/{listingId}");
            removeRisk.StatusCode.Should().Be(HttpStatusCode.OK);
            var removeData = (await removeRisk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            removeData.GetProperty("listing_id").GetInt32().Should().Be(listingId);
            removeData.GetProperty("removed").GetBoolean().Should().BeTrue();
        }
        finally
        {
            ClearAuthToken();
            using var cleanup = Factory.Services.CreateScope();
            var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.BrokerRiskTags.IgnoreQueryFilters().Where(tag => tag.ListingId == listingId).ExecuteDeleteAsync();
            await db.UserMonitoringRestrictions.IgnoreQueryFilters().Where(row => row.UserId == brokerId).ExecuteDeleteAsync();
            await db.Notifications.IgnoreQueryFilters().Where(row => row.UserId == brokerId).ExecuteDeleteAsync();
            await db.AuditLogs.IgnoreQueryFilters().Where(row => row.UserId == brokerId).ExecuteDeleteAsync();
            await db.RefreshTokens.IgnoreQueryFilters().Where(token => token.UserId == brokerId).ExecuteDeleteAsync();
            await db.Listings.IgnoreQueryFilters().Where(listing => listing.Id == listingId).ExecuteDeleteAsync();
            await db.Users.IgnoreQueryFilters().Where(user => user.Id == brokerId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task AdminFeedModerationV2_BrokerCannotHideOrDeleteOwnFeedPost()
    {
        var brokerToken = await SeedAndLoginUserAsync("broker-self-feed@test.com", "broker");
        SetAuthToken(brokerToken);

        var brokerId = await GetUserIdByEmailAsync("broker-self-feed@test.com");
        var ownPostId = await SeedAdminFeedPostAsync("Laravel React broker self moderation post", brokerId);

        var ownHide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{ownPostId}/hide", new { type = "post" });

        ownHide.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var ownHideJson = await ownHide.Content.ReadFromJsonAsync<JsonElement>();
        ownHideJson.GetProperty("success").GetBoolean().Should().BeFalse();

        var ownDelete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{ownPostId}?type=post");

        ownDelete.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var ownDeleteJson = await ownDelete.Content.ReadFromJsonAsync<JsonElement>();
        ownDeleteJson.GetProperty("success").GetBoolean().Should().BeFalse();

        await AuthenticateAsAdminAsync();

        var adminHide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{ownPostId}/hide", new { type = "post" });

        adminHide.StatusCode.Should().Be(HttpStatusCode.OK);
        var adminDelete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{ownPostId}?type=post");

        adminDelete.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminFeedModerationV2_BrokerCannotHideOrDeleteOwnAuthoredNonPostFeedItems()
    {
        var brokerToken = await SeedAndLoginUserAsync("broker-self-nonpost-feed@test.com", "broker");
        var brokerId = await GetUserIdByEmailAsync("broker-self-nonpost-feed@test.com");
        var sourceTypes = new[] { "listing", "event", "poll", "goal", "job", "volunteer", "blog", "discussion" };
        var moderationResults = new List<(string Type, string Action, HttpStatusCode Status)>();

        foreach (var sourceType in sourceTypes)
        {
            var sourceId = await SeedAuthoredFeedItemAsync(sourceType, brokerId);
            SetAuthToken(brokerToken);

            var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{sourceId}/hide", new { type = sourceType });
            moderationResults.Add((sourceType, "hide", hide.StatusCode));

            var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{sourceId}?type={sourceType}");
            moderationResults.Add((sourceType, "delete", delete.StatusCode));
        }

        moderationResults.Should().OnlyContain(
            result => result.Status == HttpStatusCode.Forbidden,
            "Laravel denies broker/coordinator self-moderation for every authored feed source type");
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesStoredChallengeAuthorAndBlocksBrokerSelfModeration()
    {
        var brokerEmail = "broker-self-challenge-feed@test.com";
        var brokerToken = await SeedAndLoginUserAsync(brokerEmail, "broker");
        var brokerId = await GetUserIdByEmailAsync(brokerEmail);
        var challengeId = await SeedAdminFeedChallengeAsync("Laravel React broker authored feed challenge", brokerId);

        await AuthenticateAsAdminAsync();

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("user_id").GetInt32().Should().Be(brokerId);
        detailData.GetProperty("user_email").GetString().Should().Be(brokerEmail);

        SetAuthToken(brokerToken);

        var ownHide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{challengeId}/hide", new { type = "challenge" });

        ownHide.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var ownHideJson = await ownHide.Content.ReadFromJsonAsync<JsonElement>();
        ownHideJson.GetProperty("success").GetBoolean().Should().BeFalse();

        var ownDelete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");

        ownDelete.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var ownDeleteJson = await ownDelete.Content.ReadFromJsonAsync<JsonElement>();
        ownDeleteJson.GetProperty("success").GetBoolean().Should().BeFalse();

        await AuthenticateAsAdminAsync();

        var adminHide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{challengeId}/hide", new { type = "challenge" });
        adminHide.StatusCode.Should().Be(HttpStatusCode.OK);

        var adminDelete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");
        adminDelete.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminFeedAnnouncerV2_GrantsAndRevokesMunicipalityAnnouncerRoleForUserEdit()
    {
        await AuthenticateAsAdminAsync();

        var initialDetail = await Client.GetAsync($"/api/v2/admin/users/{TestData.MemberUser.Id}");

        initialDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialRoles = (await initialDetail.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("roles")
            .EnumerateArray()
            .Select(role => role.GetString())
            .ToArray();
        initialRoles.Should().NotContain("municipality_announcer");

        var grant = await Client.PostAsJsonAsync("/api/v2/admin/feed/grant-announcer", new { user_id = TestData.MemberUser.Id });

        grant.StatusCode.Should().Be(HttpStatusCode.OK);
        var grantJson = await grant.Content.ReadFromJsonAsync<JsonElement>();
        grantJson.GetProperty("success").GetBoolean().Should().BeTrue();
        grantJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var grantedDetail = await Client.GetAsync($"/api/v2/admin/users/{TestData.MemberUser.Id}");
        grantedDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var grantedRoles = (await grantedDetail.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("roles")
            .EnumerateArray()
            .Select(role => role.GetString())
            .ToArray();
        grantedRoles.Should().Contain("municipality_announcer");

        var revoke = await Client.DeleteAsync($"/api/v2/admin/feed/revoke-announcer/{TestData.MemberUser.Id}");

        revoke.StatusCode.Should().Be(HttpStatusCode.OK);
        var revokeJson = await revoke.Content.ReadFromJsonAsync<JsonElement>();
        revokeJson.GetProperty("success").GetBoolean().Should().BeTrue();
        revokeJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var revokedDetail = await Client.GetAsync($"/api/v2/admin/users/{TestData.MemberUser.Id}");
        revokedDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var revokedRoles = (await revokedDetail.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("roles")
            .EnumerateArray()
            .Select(role => role.GetString())
            .ToArray();
        revokedRoles.Should().NotContain("municipality_announcer");
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactListingListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var listingId = await SeedAdminFeedListingAsync("Laravel React feed listing moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=listing&search=Laravel%20React%20feed%20listing&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == listingId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("listing");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed listing moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listed.GetProperty("likes_count").GetInt32().Should().Be(0);
        listed.GetProperty("comments_count").GetInt32().Should().Be(0);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{listingId}?type=listing");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(listingId);
        detailData.GetProperty("type").GetString().Should().Be("listing");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{listingId}/hide", new { type = "listing" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{listingId}?type=listing");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{listingId}?type=listing");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{listingId}?type=listing");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactEventListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var eventId = await SeedAdminFeedEventAsync("Laravel React feed event moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=event&search=Laravel%20React%20feed%20event&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == eventId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("event");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed event moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{eventId}?type=event");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(eventId);
        detailData.GetProperty("type").GetString().Should().Be("event");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{eventId}/hide", new { type = "event" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{eventId}?type=event");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{eventId}?type=event");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{eventId}?type=event");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactPollListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var pollId = await SeedAdminFeedPollAsync("Laravel React feed poll moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=poll&search=Laravel%20React%20feed%20poll&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == pollId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("poll");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed poll moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{pollId}?type=poll");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(pollId);
        detailData.GetProperty("type").GetString().Should().Be("poll");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{pollId}/hide", new { type = "poll" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{pollId}?type=poll");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{pollId}?type=poll");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{pollId}?type=poll");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactGoalListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var goalId = await SeedAdminFeedGoalAsync("Laravel React feed goal moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=goal&search=Laravel%20React%20feed%20goal&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == goalId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("goal");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed goal moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{goalId}?type=goal");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(goalId);
        detailData.GetProperty("type").GetString().Should().Be("goal");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{goalId}/hide", new { type = "goal" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{goalId}?type=goal");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{goalId}?type=goal");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{goalId}?type=goal");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactJobListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var jobId = await SeedAdminFeedJobAsync("Laravel React feed job moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=job&search=Laravel%20React%20feed%20job&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == jobId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("job");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed job moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{jobId}?type=job");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(jobId);
        detailData.GetProperty("type").GetString().Should().Be("job");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{jobId}/hide", new { type = "job" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{jobId}?type=job");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{jobId}?type=job");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{jobId}?type=job");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactChallengeListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var challengeId = await SeedAdminFeedChallengeAsync("Laravel React feed challenge moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=challenge&search=Laravel%20React%20feed%20challenge&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == challengeId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.AdminUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("challenge");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed challenge moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(challengeId);
        detailData.GetProperty("type").GetString().Should().Be("challenge");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.AdminUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{challengeId}/hide", new { type = "challenge" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactVolunteerListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var opportunityId = await SeedAdminFeedVolunteerAsync("Laravel React feed volunteer moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=volunteer&search=Laravel%20React%20feed%20volunteer&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == opportunityId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("volunteer");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed volunteer moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{opportunityId}?type=volunteer");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(opportunityId);
        detailData.GetProperty("type").GetString().Should().Be("volunteer");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{opportunityId}/hide", new { type = "volunteer" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{opportunityId}?type=volunteer");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{opportunityId}?type=volunteer");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{opportunityId}?type=volunteer");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactBlogListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var blogId = await SeedAdminFeedBlogAsync("Laravel React feed blog moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=blog&search=Laravel%20React%20feed%20blog&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == blogId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("blog");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed blog moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{blogId}?type=blog");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(blogId);
        detailData.GetProperty("type").GetString().Should().Be("blog");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{blogId}/hide", new { type = "blog" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{blogId}?type=blog");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{blogId}?type=blog");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{blogId}?type=blog");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminFeedModerationV2_UsesLaravelReactDiscussionListDetailHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var discussionId = await SeedAdminFeedDiscussionAsync("Laravel React feed discussion moderation");

        var list = await Client.GetAsync("/api/v2/admin/feed/posts?type=discussion&search=Laravel%20React%20feed%20discussion&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == discussionId);
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("user_name").GetString().Should().Contain(TestData.MemberUser.FirstName);
        listed.GetProperty("type").GetString().Should().Be("discussion");
        listed.GetProperty("content").GetString().Should().Contain("Laravel React feed discussion moderation");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/feed/posts/{discussionId}?type=discussion");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(discussionId);
        detailData.GetProperty("type").GetString().Should().Be("discussion");
        detailData.GetProperty("user_email").GetString().Should().Be(TestData.MemberUser.Email);

        var hide = await Client.PostAsJsonAsync($"/api/v2/admin/feed/posts/{discussionId}/hide", new { type = "discussion" });

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{discussionId}?type=discussion");
        hiddenDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenJson = await hiddenDetail.Content.ReadFromJsonAsync<JsonElement>();
        hiddenJson.GetProperty("data").GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/feed/posts/{discussionId}?type=discussion");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var deleted = await Client.GetAsync($"/api/v2/admin/feed/posts/{discussionId}?type=discussion");
        deleted.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminReviewsV2_UsesLaravelReactModerationListDetailFlagHideAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var seeded = await SeedAdminReviewAsync("Laravel React moderation review");

        var list = await Client.GetAsync("/api/v2/admin/reviews?rating=2&search=Laravel%20React%20moderation&page=1&limit=20");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(review => review.GetProperty("id").GetInt32() == seeded.ReviewId);
        listed.GetProperty("reviewer_id").GetInt32().Should().Be(seeded.ReviewerId);
        listed.GetProperty("reviewee_id").GetInt32().Should().Be(seeded.RevieweeId);
        listed.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        listed.GetProperty("tenant_name").GetString().Should().Be(TestData.Tenant1.Name);
        listed.GetProperty("reviewer_name").GetString().Should().Contain("Review Writer");
        listed.GetProperty("reviewee_name").GetString().Should().Contain("Review Target");
        listed.GetProperty("rating").GetInt32().Should().Be(2);
        listed.GetProperty("content").GetString().Should().Contain("Laravel React moderation review");
        listed.GetProperty("is_hidden").GetBoolean().Should().BeFalse();
        listed.GetProperty("is_flagged").GetBoolean().Should().BeFalse();
        listed.GetProperty("reports_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var detail = await Client.GetAsync($"/api/v2/admin/reviews/{seeded.ReviewId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        detailJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(seeded.ReviewId);

        var flag = await Client.PostAsync($"/api/v2/admin/reviews/{seeded.ReviewId}/flag", null);

        flag.StatusCode.Should().Be(HttpStatusCode.OK);
        var flagJson = await flag.Content.ReadFromJsonAsync<JsonElement>();
        flagJson.GetProperty("success").GetBoolean().Should().BeTrue();
        flagJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var flaggedList = await Client.GetAsync("/api/v2/admin/reviews?rating=2&search=Laravel%20React%20moderation&page=1&limit=20");

        flaggedList.StatusCode.Should().Be(HttpStatusCode.OK);
        var flaggedReview = (await flaggedList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single(review => review.GetProperty("id").GetInt32() == seeded.ReviewId);
        flaggedReview.GetProperty("is_flagged").GetBoolean().Should().BeTrue();

        var hide = await Client.PostAsync($"/api/v2/admin/reviews/{seeded.ReviewId}/hide", null);

        hide.StatusCode.Should().Be(HttpStatusCode.OK);
        var hideJson = await hide.Content.ReadFromJsonAsync<JsonElement>();
        hideJson.GetProperty("success").GetBoolean().Should().BeTrue();
        hideJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        var hiddenList = await Client.GetAsync("/api/v2/admin/reviews?rating=2&search=Laravel%20React%20moderation&page=1&limit=20");

        hiddenList.StatusCode.Should().Be(HttpStatusCode.OK);
        var hiddenReview = (await hiddenList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single(review => review.GetProperty("id").GetInt32() == seeded.ReviewId);
        hiddenReview.GetProperty("is_hidden").GetBoolean().Should().BeTrue();

        var delete = await Client.DeleteAsync($"/api/v2/admin/reviews/{seeded.ReviewId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminPollsV2_UsesLaravelReactListDetailAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var pollId = await SeedAdminPollAsync("Laravel React admin poll");

        var list = await Client.GetAsync("/api/v2/admin/polls?search=Laravel%20React&page=1&limit=50");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(50);
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == pollId);
        listed.GetProperty("question").GetString().Should().Be("Laravel React admin poll");
        listed.GetProperty("options").GetArrayLength().Should().Be(2);
        listed.GetProperty("total_votes").GetInt32().Should().Be(1);
        listed.GetProperty("user").GetProperty("name").GetString().Should().Be("Member User");

        var detail = await Client.GetAsync($"/api/v2/admin/polls/{pollId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(pollId);
        detailData.GetProperty("question").GetString().Should().Be("Laravel React admin poll");
        detailData.GetProperty("options").GetArrayLength().Should().Be(2);
        detailData.GetProperty("total_votes").GetInt32().Should().Be(1);

        var delete = await Client.DeleteAsync($"/api/v2/admin/polls/{pollId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(pollId);
    }

    [Fact]
    public async Task AdminResourcesV2_UsesLaravelReactListDetailAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var articleId = await SeedAdminResourceArticleAsync("Laravel React resource article");

        var list = await Client.GetAsync("/api/v2/admin/resources?search=Laravel%20React&status=published&page=1&limit=50");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        var payload = listJson.GetProperty("data");
        payload.GetProperty("meta").GetProperty("page").GetInt32().Should().Be(1);
        payload.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(50);
        payload.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        var listed = payload.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == articleId);
        listed.GetProperty("title").GetString().Should().Be("Laravel React resource article");
        listed.GetProperty("category").GetString().Should().Be("Getting Started");
        listed.GetProperty("author_name").GetString().Should().Be("Admin User");
        listed.GetProperty("views").GetInt32().Should().Be(42);
        listed.GetProperty("helpful_votes").GetInt32().Should().Be(0);
        listed.GetProperty("status").GetString().Should().Be("published");
        listed.GetProperty("updated_at").GetString().Should().NotBeNullOrWhiteSpace();

        var detail = await Client.GetAsync($"/api/v2/admin/resources/{articleId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(articleId);
        detailData.GetProperty("title").GetString().Should().Be("Laravel React resource article");
        detailData.GetProperty("slug").GetString().Should().Be($"resource-{articleId}");
        detailData.GetProperty("content").GetString().Should().Contain("Laravel React resource body");
        detailData.GetProperty("attachments").ValueKind.Should().Be(JsonValueKind.Array);

        var delete = await Client.DeleteAsync($"/api/v2/admin/resources/{articleId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(articleId);
    }

    [Fact]
    public async Task AdminGoalsV2_UsesLaravelReactListDetailAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var goalId = await SeedAdminGoalAsync("Laravel React admin goal");

        var list = await Client.GetAsync("/api/v2/admin/goals?search=Laravel%20React&page=1&limit=50");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(50);
        listJson.GetProperty("meta").GetProperty("total_pages").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == goalId);
        listed.GetProperty("title").GetString().Should().Be("Laravel React admin goal");
        listed.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        listed.GetProperty("target_value").GetDecimal().Should().Be(10m);
        listed.GetProperty("current_value").GetDecimal().Should().Be(4m);
        listed.GetProperty("status").GetString().Should().Be("active");
        listed.GetProperty("mentor_id").ValueKind.Should().Be(JsonValueKind.Null);
        listed.GetProperty("buddy_id").ValueKind.Should().Be(JsonValueKind.Null);
        listed.GetProperty("user").GetProperty("name").GetString().Should().Be("Member User");

        var detail = await Client.GetAsync($"/api/v2/admin/goals/{goalId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(goalId);
        detailData.GetProperty("title").GetString().Should().Be("Laravel React admin goal");
        detailData.GetProperty("description").GetString().Should().Contain("Laravel React goal body");
        detailData.GetProperty("milestones").GetArrayLength().Should().Be(1);

        var delete = await Client.DeleteAsync($"/api/v2/admin/goals/{goalId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(goalId);
    }

    [Fact]
    public async Task AdminIdeationV2_UsesLaravelReactListDetailStatusAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();
        var challengeId = await SeedAdminIdeationChallengeAsync("Laravel React ideation challenge");

        var list = await Client.GetAsync("/api/v2/admin/ideation?search=Laravel%20React&status=open&page=1&limit=50");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        listJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        listJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        listJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(50);
        var listed = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == challengeId);
        listed.GetProperty("title").GetString().Should().Be("Laravel React ideation challenge");
        listed.GetProperty("creator_name").GetString().Should().NotBeNull();
        listed.GetProperty("ideas_count").GetInt32().Should().Be(1);
        listed.GetProperty("status").GetString().Should().Be("open");
        listed.GetProperty("start_date").GetString().Should().NotBeNullOrWhiteSpace();
        listed.GetProperty("end_date").GetString().Should().NotBeNullOrWhiteSpace();

        var detail = await Client.GetAsync($"/api/v2/admin/ideation/{challengeId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(challengeId);
        detailData.GetProperty("title").GetString().Should().Be("Laravel React ideation challenge");
        detailData.GetProperty("ideas_count").GetInt32().Should().Be(1);

        var status = await Client.PostAsJsonAsync($"/api/v2/admin/ideation/{challengeId}/status", new { status = "archived" });

        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusJson = await status.Content.ReadFromJsonAsync<JsonElement>();
        statusJson.GetProperty("success").GetBoolean().Should().BeTrue();
        statusJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(challengeId);
        statusJson.GetProperty("data").GetProperty("status").GetString().Should().Be("archived");

        var delete = await Client.DeleteAsync($"/api/v2/admin/ideation/{challengeId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(challengeId);
    }

    [Fact]
    public async Task IdeationChallengesV2_CreatePersistsChallengeAndFeedAuthorForLaravelReact()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React created ideation challenge",
            description = "Created through the canonical Laravel React challenge form.",
            category = "Community",
            prize_description = "Recognition",
            submission_deadline = DateTime.UtcNow.AddDays(7).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(14).ToString("O"),
            max_ideas_per_user = 3,
            cover_image = "https://example.test/challenge.png",
            tags = new[] { "contracts", "ideation" },
            status = "open"
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var createdData = createJson.GetProperty("data");
        var challengeId = createdData.GetProperty("id").GetInt32();
        challengeId.Should().BeGreaterThan(0);
        createdData.GetProperty("title").GetString().Should().Be("Laravel React created ideation challenge");
        createdData.GetProperty("description").GetString().Should().Be("Created through the canonical Laravel React challenge form.");
        createdData.GetProperty("status").GetString().Should().Be("open");
        createdData.GetProperty("category").GetString().Should().Be("Community");
        createdData.GetProperty("prize_description").GetString().Should().Be("Recognition");
        createdData.GetProperty("max_ideas_per_user").GetInt32().Should().Be(3);
        createdData.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()).Should().Contain(new[] { "contracts", "ideation" });

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(challengeId);
        detailJson.GetProperty("data").GetProperty("title").GetString().Should().Be("Laravel React created ideation challenge");

        var feedDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");

        feedDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var feedData = (await feedDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        feedData.GetProperty("user_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        feedData.GetProperty("user_email").GetString().Should().Be(TestData.AdminUser.Email);
    }

    [Fact]
    public async Task IdeationChallengesV2_UpdatePersistsLaravelReactEditPayload()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React editable ideation challenge",
            description = "Original description from the challenge form.",
            category = "Community",
            prize_description = "Original prize",
            submission_deadline = DateTime.UtcNow.AddDays(5).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(10).ToString("O"),
            max_ideas_per_user = 2,
            cover_image = "https://example.test/original.png",
            tags = new[] { "original" },
            status = "open"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var update = await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{challengeId}", new
        {
            title = "Laravel React edited ideation challenge",
            description = "Updated through the canonical Laravel React edit form.",
            category = "Climate",
            prize_description = "Updated recognition",
            submission_deadline = DateTime.UtcNow.AddDays(8).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(16).ToString("O"),
            max_ideas_per_user = 5,
            cover_image = "https://example.test/updated.png",
            tags = new[] { "updated", "ideation" }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var updatedData = updateJson.GetProperty("data");
        updatedData.GetProperty("id").GetInt32().Should().Be(challengeId);
        updatedData.GetProperty("title").GetString().Should().Be("Laravel React edited ideation challenge");
        updatedData.GetProperty("description").GetString().Should().Be("Updated through the canonical Laravel React edit form.");
        updatedData.GetProperty("category").GetString().Should().Be("Climate");
        updatedData.GetProperty("prize_description").GetString().Should().Be("Updated recognition");
        updatedData.GetProperty("max_ideas_per_user").GetInt32().Should().Be(5);
        updatedData.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()).Should().Contain(new[] { "updated", "ideation" });

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("title").GetString().Should().Be("Laravel React edited ideation challenge");
        detailData.GetProperty("category").GetString().Should().Be("Climate");
        detailData.GetProperty("prize_description").GetString().Should().Be("Updated recognition");

        var feedDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");

        feedDetail.StatusCode.Should().Be(HttpStatusCode.OK);
        var feedContent = (await feedDetail.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("content")
            .GetString();
        feedContent.Should().Contain("Laravel React edited ideation challenge");
        feedContent.Should().Contain("Updated through the canonical Laravel React edit form.");
    }

    [Fact]
    public async Task IdeationChallengesV2_DeleteUsesLaravelNoContentAndRemovesChallenge()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React deletable ideation challenge",
            description = "Challenge that should be removed by the Laravel delete contract.",
            category = "Community",
            prize_description = "Temporary",
            submission_deadline = DateTime.UtcNow.AddDays(3).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(6).ToString("O"),
            max_ideas_per_user = 1,
            tags = new[] { "delete" },
            status = "open"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var delete = await Client.DeleteAsync($"/api/v2/ideation-challenges/{challengeId}");

        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await delete.Content.ReadAsStringAsync()).Should().BeEmpty();

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");
        detail.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var feedDetail = await Client.GetAsync($"/api/v2/admin/feed/posts/{challengeId}?type=challenge");
        feedDetail.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task IdeationChallengesV2_StatusUpdatesLaravelLifecycleAndPersistsDetailStatus()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React status ideation challenge",
            description = "Challenge that should follow the Laravel lifecycle status contract.",
            category = "Community",
            submission_deadline = DateTime.UtcNow.AddDays(3).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(6).ToString("O"),
            max_ideas_per_user = 2,
            status = "open"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var status = await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{challengeId}/status", new { status = "voting" });

        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusJson = await status.Content.ReadFromJsonAsync<JsonElement>();
        statusJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var statusData = statusJson.GetProperty("data");
        statusData.GetProperty("id").GetInt32().Should().Be(challengeId);
        statusData.GetProperty("status").GetString().Should().Be("voting");
        statusData.GetProperty("is_active").GetBoolean().Should().BeTrue();

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(challengeId);
        detailData.GetProperty("status").GetString().Should().Be("voting");
    }

    [Fact]
    public async Task IdeationChallengesV2_StatusRejectsInvalidLaravelLifecycleTransition()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React guarded status ideation challenge",
            description = "Challenge that should reject invalid lifecycle transitions.",
            submission_deadline = DateTime.UtcNow.AddDays(3).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(6).ToString("O"),
            status = "open"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var invalid = await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{challengeId}/status", new { status = "draft" });

        invalid.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var invalidJson = await invalid.Content.ReadFromJsonAsync<JsonElement>();
        var error = invalidJson.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("CONFLICT");
        error.GetProperty("message").GetString().Should().Contain("open").And.Contain("draft");

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("status").GetString().Should().Be("open");
    }

    [Fact]
    public async Task IdeationChallengesV2_StatusRequiresAdminLikeLaravel()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React admin-only status ideation challenge",
            description = "Challenge status changes should be admin-only like Laravel.",
            submission_deadline = DateTime.UtcNow.AddDays(3).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(6).ToString("O"),
            status = "open"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        await AuthenticateAsMemberAsync();

        var forbidden = await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{challengeId}/status", new { status = "voting" });

        forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsAdminAsync();
        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("status").GetString().Should().Be("open");
    }

    [Fact]
    public async Task IdeationChallengesV2_FavoriteTogglesAndPersistsLaravelReactFlags()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React favorite ideation challenge",
            description = "Challenge that should support the Laravel favorite toggle contract.",
            submission_deadline = DateTime.UtcNow.AddDays(3).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(6).ToString("O"),
            status = "open"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        await AuthenticateAsMemberAsync();

        var favorite = await Client.PostAsync($"/api/v2/ideation-challenges/{challengeId}/favorite", null);

        favorite.StatusCode.Should().Be(HttpStatusCode.OK);
        var favoriteJson = await favorite.Content.ReadFromJsonAsync<JsonElement>();
        favoriteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        favoriteJson.GetProperty("data").GetProperty("favorited").GetBoolean().Should().BeTrue();
        favoriteJson.GetProperty("data").GetProperty("favorites_count").GetInt32().Should().Be(1);

        var favoritedDetail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");
        var favoritedData = (await favoritedDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        favoritedData.GetProperty("is_favorited").GetBoolean().Should().BeTrue();
        favoritedData.GetProperty("favorites_count").GetInt32().Should().Be(1);

        var unfavorite = await Client.PostAsync($"/api/v2/ideation-challenges/{challengeId}/favorite", null);

        unfavorite.StatusCode.Should().Be(HttpStatusCode.OK);
        var unfavoriteJson = await unfavorite.Content.ReadFromJsonAsync<JsonElement>();
        unfavoriteJson.GetProperty("data").GetProperty("favorited").GetBoolean().Should().BeFalse();
        unfavoriteJson.GetProperty("data").GetProperty("favorites_count").GetInt32().Should().Be(0);

        var unfavoritedDetail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}");
        var unfavoritedData = (await unfavoritedDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        unfavoritedData.GetProperty("is_favorited").GetBoolean().Should().BeFalse();
        unfavoritedData.GetProperty("favorites_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task IdeationChallengesV2_DuplicateCreatesLaravelReactDraftCopy()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React duplicable ideation challenge",
            description = "Challenge that should duplicate into a draft copy.",
            category = "Community",
            prize_description = "Original recognition",
            submission_deadline = DateTime.UtcNow.AddDays(5).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(10).ToString("O"),
            max_ideas_per_user = 4,
            tags = new[] { "duplicate", "ideation" },
            status = "open"
        });
        var originalId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var duplicate = await Client.PostAsync($"/api/v2/ideation-challenges/{originalId}/duplicate", null);

        duplicate.StatusCode.Should().Be(HttpStatusCode.Created);
        var duplicateJson = await duplicate.Content.ReadFromJsonAsync<JsonElement>();
        duplicateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var duplicateData = duplicateJson.GetProperty("data");
        var duplicateId = duplicateData.GetProperty("id").GetInt32();
        duplicateId.Should().BeGreaterThan(0).And.NotBe(originalId);
        duplicateData.GetProperty("title").GetString().Should().Be("[Copy] Laravel React duplicable ideation challenge");
        duplicateData.GetProperty("description").GetString().Should().Be("Challenge that should duplicate into a draft copy.");
        duplicateData.GetProperty("status").GetString().Should().Be("draft");
        duplicateData.GetProperty("category").GetString().Should().Be("Community");
        duplicateData.GetProperty("prize_description").GetString().Should().Be("Original recognition");
        duplicateData.GetProperty("max_ideas_per_user").GetInt32().Should().Be(4);
        duplicateData.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()).Should().Contain(new[] { "duplicate", "ideation" });
        duplicateData.GetProperty("favorites_count").GetInt32().Should().Be(0);

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{duplicateId}");
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("title").GetString().Should().Be("[Copy] Laravel React duplicable ideation challenge");
        detailData.GetProperty("status").GetString().Should().Be("draft");
        detailData.GetProperty("category").GetString().Should().Be("Community");
    }

    [Fact]
    public async Task IdeationChallengesV2_OutcomePersistsLaravelReactPayload()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React outcome ideation challenge",
            description = "Challenge that should persist outcome modal fields.",
            submission_deadline = DateTime.UtcNow.AddDays(-10).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(-5).ToString("O"),
            status = "closed"
        });
        var challengeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var save = await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{challengeId}/outcome", new
        {
            winning_idea_id = (int?)null,
            implementation_status = "in_progress",
            impact_description = "Pilot implementation started with two local partners."
        });

        save.StatusCode.Should().Be(HttpStatusCode.OK);
        var saveJson = await save.Content.ReadFromJsonAsync<JsonElement>();
        saveJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var savedOutcome = saveJson.GetProperty("data");
        savedOutcome.GetProperty("challenge_id").GetInt32().Should().Be(challengeId);
        savedOutcome.GetProperty("winning_idea_id").ValueKind.Should().Be(JsonValueKind.Null);
        savedOutcome.GetProperty("winning_idea_title").ValueKind.Should().Be(JsonValueKind.Null);
        savedOutcome.GetProperty("implementation_status").GetString().Should().Be("in_progress");
        savedOutcome.GetProperty("impact_description").GetString().Should().Be("Pilot implementation started with two local partners.");

        var detail = await Client.GetAsync($"/api/v2/ideation-challenges/{challengeId}/outcome");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailOutcome = detailJson.GetProperty("data");
        detailOutcome.GetProperty("challenge_id").GetInt32().Should().Be(challengeId);
        detailOutcome.GetProperty("implementation_status").GetString().Should().Be("in_progress");
        detailOutcome.GetProperty("impact_description").GetString().Should().Be("Pilot implementation started with two local partners.");
    }

    [Fact]
    public async Task IdeationOutcomesDashboardV2_ReturnsLaravelReactSummaryAndRows()
    {
        await AuthenticateAsAdminAsync();

        var firstCreate = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React implemented outcome challenge",
            description = "Closed challenge with an implemented outcome.",
            submission_deadline = DateTime.UtcNow.AddDays(-14).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(-7).ToString("O"),
            status = "closed"
        });
        var firstId = (await firstCreate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var secondCreate = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React in-progress outcome challenge",
            description = "Closed challenge with an in-progress outcome.",
            submission_deadline = DateTime.UtcNow.AddDays(-12).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(-6).ToString("O"),
            status = "closed"
        });
        var secondId = (await secondCreate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{firstId}/outcome", new
        {
            implementation_status = "implemented",
            impact_description = "Implemented by the neighbourhood team."
        });
        await Client.PutAsJsonAsync($"/api/v2/ideation-challenges/{secondId}/outcome", new
        {
            implementation_status = "in_progress",
            impact_description = "Delivery partner onboarding is in progress."
        });

        var dashboard = await Client.GetAsync("/api/v2/ideation-outcomes/dashboard");

        dashboard.StatusCode.Should().Be(HttpStatusCode.OK);
        var dashboardJson = await dashboard.Content.ReadFromJsonAsync<JsonElement>();
        dashboardJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = dashboardJson.GetProperty("data");
        data.GetProperty("total").GetInt32().Should().Be(2);
        data.GetProperty("implemented").GetInt32().Should().Be(1);
        data.GetProperty("in_progress").GetInt32().Should().Be(1);
        data.GetProperty("not_started").GetInt32().Should().Be(0);
        data.GetProperty("abandoned").GetInt32().Should().Be(0);

        var outcomes = data.GetProperty("outcomes").EnumerateArray().ToArray();
        outcomes.Should().HaveCount(2);
        outcomes.Should().Contain(row =>
            row.GetProperty("challenge_id").GetInt32() == firstId &&
            row.GetProperty("challenge_title").GetString() == "Laravel React implemented outcome challenge" &&
            row.GetProperty("implementation_status").GetString() == "implemented" &&
            row.GetProperty("impact_description").GetString() == "Implemented by the neighbourhood team.");
        outcomes.Should().Contain(row =>
            row.GetProperty("challenge_id").GetInt32() == secondId &&
            row.GetProperty("challenge_title").GetString() == "Laravel React in-progress outcome challenge" &&
            row.GetProperty("implementation_status").GetString() == "in_progress");
    }

    [Fact]
    public async Task IdeationCampaignsV2_UseLaravelReactCrudAndChallengeLinkShape()
    {
        await AuthenticateAsAdminAsync();

        var challengeCreate = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React campaign linked challenge",
            description = "Challenge linked into a campaign by the canonical React workflow.",
            submission_deadline = DateTime.UtcNow.AddDays(5).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(10).ToString("O"),
            status = "open"
        });
        var challengeId = (await challengeCreate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        var create = await Client.PostAsJsonAsync("/api/v2/ideation-campaigns", new
        {
            title = "Laravel React campaign",
            description = "Campaign created through the Laravel React campaign modal.",
            cover_image = "https://example.test/campaign.png",
            status = "active",
            start_date = DateTime.UtcNow.AddDays(1).ToString("O"),
            end_date = DateTime.UtcNow.AddDays(30).ToString("O")
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var created = createJson.GetProperty("data");
        var campaignId = created.GetProperty("id").GetInt32();
        campaignId.Should().BeGreaterThan(0);
        created.GetProperty("title").GetString().Should().Be("Laravel React campaign");
        created.GetProperty("description").GetString().Should().Be("Campaign created through the Laravel React campaign modal.");
        created.GetProperty("cover_image").GetString().Should().Be("https://example.test/campaign.png");
        created.GetProperty("status").GetString().Should().Be("active");
        created.GetProperty("challenges_count").GetInt32().Should().Be(0);
        created.GetProperty("challenges").ValueKind.Should().Be(JsonValueKind.Array);

        var list = await Client.GetAsync("/api/v2/ideation-campaigns");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item =>
                item.GetProperty("id").GetInt32() == campaignId &&
                item.GetProperty("title").GetString() == "Laravel React campaign" &&
                item.GetProperty("challenges_count").GetInt32() == 0);

        var link = await Client.PostAsJsonAsync($"/api/v2/ideation-campaigns/{campaignId}/challenges", new
        {
            challenge_id = challengeId,
            sort_order = 2
        });

        link.StatusCode.Should().Be(HttpStatusCode.Created);
        var linkJson = await link.Content.ReadFromJsonAsync<JsonElement>();
        linkJson.GetProperty("success").GetBoolean().Should().BeTrue();
        linkJson.GetProperty("data").GetProperty("linked").GetBoolean().Should().BeTrue();

        var detail = await Client.GetAsync($"/api/v2/ideation-campaigns/{campaignId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(campaignId);
        detailData.GetProperty("challenges_count").GetInt32().Should().Be(1);
        var linkedChallenge = detailData.GetProperty("challenges").EnumerateArray().Should().ContainSingle().Subject;
        linkedChallenge.GetProperty("id").GetInt32().Should().Be(challengeId);
        linkedChallenge.GetProperty("title").GetString().Should().Be("Laravel React campaign linked challenge");
        linkedChallenge.GetProperty("status").GetString().Should().Be("open");
        linkedChallenge.GetProperty("ideas_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        linkedChallenge.GetProperty("favorites_count").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var update = await Client.PutAsJsonAsync($"/api/v2/ideation-campaigns/{campaignId}", new
        {
            title = "Laravel React campaign updated",
            description = "Updated through the Laravel React campaign detail modal.",
            status = "completed"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updated.GetProperty("title").GetString().Should().Be("Laravel React campaign updated");
        updated.GetProperty("description").GetString().Should().Be("Updated through the Laravel React campaign detail modal.");
        updated.GetProperty("status").GetString().Should().Be("completed");
        updated.GetProperty("challenges_count").GetInt32().Should().Be(1);

        var unlink = await Client.DeleteAsync($"/api/v2/ideation-campaigns/{campaignId}/challenges/{challengeId}");

        unlink.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await unlink.Content.ReadAsStringAsync()).Should().BeEmpty();

        var unlinkedDetail = await Client.GetAsync($"/api/v2/ideation-campaigns/{campaignId}");
        var unlinkedData = (await unlinkedDetail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        unlinkedData.GetProperty("challenges_count").GetInt32().Should().Be(0);
        unlinkedData.GetProperty("challenges").EnumerateArray().Should().BeEmpty();

        var delete = await Client.DeleteAsync($"/api/v2/ideation-campaigns/{campaignId}");

        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await delete.Content.ReadAsStringAsync()).Should().BeEmpty();

        var deletedDetail = await Client.GetAsync($"/api/v2/ideation-campaigns/{campaignId}");
        deletedDetail.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task IdeationIdeasV2_UseLaravelReactSubmitMediaCommentStatusAndDeleteShape()
    {
        await AuthenticateAsAdminAsync();

        var challengeCreate = await Client.PostAsJsonAsync("/api/v2/ideation-challenges", new
        {
            title = "Laravel React idea workflow challenge",
            description = "Challenge used to verify the Laravel React idea workflow.",
            submission_deadline = DateTime.UtcNow.AddDays(5).ToString("O"),
            voting_deadline = DateTime.UtcNow.AddDays(10).ToString("O"),
            status = "open"
        });
        var challengeId = (await challengeCreate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .GetProperty("id")
            .GetInt32();

        await AuthenticateAsMemberAsync();

        var submit = await Client.PostAsJsonAsync($"/api/v2/ideation-challenges/{challengeId}/ideas", new
        {
            title = "Laravel React submitted idea",
            description = "Submitted through the canonical Laravel React challenge page."
        });

        submit.StatusCode.Should().Be(HttpStatusCode.Created);
        var submitJson = await submit.Content.ReadFromJsonAsync<JsonElement>();
        submitJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var ideaId = submitJson.GetProperty("data").GetProperty("id").GetInt32();
        ideaId.Should().BeGreaterThan(0);

        var detail = await Client.GetAsync($"/api/v2/ideation-ideas/{ideaId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var idea = detailJson.GetProperty("data");
        idea.GetProperty("id").GetInt32().Should().Be(ideaId);
        idea.GetProperty("challenge_id").GetInt32().Should().Be(challengeId);
        idea.GetProperty("title").GetString().Should().Be("Laravel React submitted idea");
        idea.GetProperty("description").GetString().Should().Be("Submitted through the canonical Laravel React challenge page.");
        idea.GetProperty("comments_count").GetInt32().Should().Be(0);

        var vote = await Client.PostAsync($"/api/v2/ideation-ideas/{ideaId}/vote", null);

        vote.StatusCode.Should().Be(HttpStatusCode.OK);
        var voteJson = await vote.Content.ReadFromJsonAsync<JsonElement>();
        voteJson.GetProperty("success").GetBoolean().Should().BeTrue();
        voteJson.GetProperty("data").GetProperty("voted").GetBoolean().Should().BeTrue();
        voteJson.GetProperty("data").GetProperty("votes_count").GetInt32().Should().Be(1);

        var media = await Client.PostAsJsonAsync($"/api/v2/ideation-ideas/{ideaId}/media", new
        {
            media_type = "link",
            url = "https://example.test/prototype",
            caption = "Prototype reference"
        });

        media.StatusCode.Should().Be(HttpStatusCode.Created);
        var mediaJson = await media.Content.ReadFromJsonAsync<JsonElement>();
        mediaJson.GetProperty("success").GetBoolean().Should().BeTrue();
        mediaJson.GetProperty("data").GetProperty("id").GetInt32().Should().BeGreaterThan(0);

        var mediaList = await Client.GetAsync($"/api/v2/ideation-ideas/{ideaId}/media");

        mediaList.StatusCode.Should().Be(HttpStatusCode.OK);
        var mediaItem = (await mediaList.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Should()
            .ContainSingle()
            .Subject;
        var mediaId = mediaItem.GetProperty("id").GetInt32();
        mediaItem.GetProperty("idea_id").GetInt32().Should().Be(ideaId);
        mediaItem.GetProperty("media_type").GetString().Should().Be("link");
        mediaItem.GetProperty("url").GetString().Should().Be("https://example.test/prototype");
        mediaItem.GetProperty("caption").GetString().Should().Be("Prototype reference");

        var comment = await Client.PostAsJsonAsync($"/api/v2/ideation-ideas/{ideaId}/comments", new
        {
            body = "This idea needs a pilot partner."
        });

        comment.StatusCode.Should().Be(HttpStatusCode.Created);
        var commentJson = await comment.Content.ReadFromJsonAsync<JsonElement>();
        commentJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var commentData = commentJson.GetProperty("data");
        var commentId = commentData.GetProperty("id").GetInt32();
        commentData.GetProperty("body").GetString().Should().Be("This idea needs a pilot partner.");
        commentData.GetProperty("idea_id").GetInt32().Should().Be(ideaId);

        var comments = await Client.GetAsync($"/api/v2/ideation-ideas/{ideaId}/comments");

        comments.StatusCode.Should().Be(HttpStatusCode.OK);
        var commentsJson = await comments.Content.ReadFromJsonAsync<JsonElement>();
        commentsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        commentsJson.GetProperty("data").EnumerateArray()
            .Should().Contain(row =>
                row.GetProperty("id").GetInt32() == commentId &&
                row.GetProperty("body").GetString() == "This idea needs a pilot partner.");

        await AuthenticateAsAdminAsync();

        var status = await Client.PutAsJsonAsync($"/api/v2/ideation-ideas/{ideaId}/status", new
        {
            status = "approved"
        });

        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusJson = await status.Content.ReadFromJsonAsync<JsonElement>();
        statusJson.GetProperty("success").GetBoolean().Should().BeTrue();
        statusJson.GetProperty("data").GetProperty("status").GetString().Should().Be("approved");

        var convert = await Client.PostAsJsonAsync($"/api/v2/ideation-ideas/{ideaId}/convert-to-group", new
        {
            name = "Laravel React idea delivery group",
            description = "Group created from an approved idea.",
            visibility = "private"
        });

        convert.StatusCode.Should().Be(HttpStatusCode.Created);
        var convertJson = await convert.Content.ReadFromJsonAsync<JsonElement>();
        convertJson.GetProperty("success").GetBoolean().Should().BeTrue();
        convertJson.GetProperty("data").GetProperty("id").GetInt32().Should().BeGreaterThan(0);

        var deleteComment = await Client.DeleteAsync($"/api/v2/ideation-comments/{commentId}");

        deleteComment.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await deleteComment.Content.ReadAsStringAsync()).Should().BeEmpty();

        var deleteMedia = await Client.DeleteAsync($"/api/v2/ideation-media/{mediaId}");

        deleteMedia.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await deleteMedia.Content.ReadAsStringAsync()).Should().BeEmpty();

        var deleteIdea = await Client.DeleteAsync($"/api/v2/ideation-ideas/{ideaId}");

        deleteIdea.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await deleteIdea.Content.ReadAsStringAsync()).Should().BeEmpty();

        var deletedDetail = await Client.GetAsync($"/api/v2/ideation-ideas/{ideaId}");
        deletedDetail.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task IdeationTeamTasksV2_UseLaravelReactListCreateStatsUpdateAndDeleteShape()
    {
        var groupId = await SeedVolunteerGroupAsync($"Laravel React task team {Guid.NewGuid():N}");
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync($"/api/v2/groups/{groupId}/tasks", new
        {
            title = "Draft team prototype",
            description = "Coordinate the next ideation milestone.",
            status = "todo",
            priority = "high",
            assigned_to = TestData.MemberUser.Id,
            due_date = "2026-09-15"
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var created = createJson.GetProperty("data");
        var taskId = created.GetProperty("id").GetInt32();
        taskId.Should().BeGreaterThan(0);
        created.GetProperty("group_id").GetInt32().Should().Be(groupId);
        created.GetProperty("title").GetString().Should().Be("Draft team prototype");
        created.GetProperty("description").GetString().Should().Be("Coordinate the next ideation milestone.");
        created.GetProperty("status").GetString().Should().Be("todo");
        created.GetProperty("priority").GetString().Should().Be("high");
        created.GetProperty("assigned_to").GetInt32().Should().Be(TestData.MemberUser.Id);
        created.GetProperty("created_by").GetInt32().Should().Be(TestData.MemberUser.Id);
        created.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();

        var detail = await Client.GetAsync($"/api/v2/team-tasks/{taskId}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        detailData.GetProperty("id").GetInt32().Should().Be(taskId);
        detailData.GetProperty("group_id").GetInt32().Should().Be(groupId);
        detailData.GetProperty("priority").GetString().Should().Be("high");

        var list = await Client.GetAsync($"/api/v2/groups/{groupId}/tasks?status=todo&per_page=10");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == taskId &&
            item.GetProperty("title").GetString() == "Draft team prototype" &&
            item.GetProperty("status").GetString() == "todo");
        var meta = listJson.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(10);
        meta.TryGetProperty("cursor", out _).Should().BeTrue();
        meta.TryGetProperty("has_more", out _).Should().BeTrue();

        var stats = await Client.GetAsync($"/api/v2/groups/{groupId}/task-stats");
        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsData = (await stats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statsData.GetProperty("total").GetInt32().Should().Be(1);
        statsData.GetProperty("todo").GetInt32().Should().Be(1);
        statsData.GetProperty("in_progress").GetInt32().Should().Be(0);
        statsData.GetProperty("done").GetInt32().Should().Be(0);
        statsData.GetProperty("overdue").GetInt32().Should().Be(0);

        var update = await Client.PutAsJsonAsync($"/api/v2/team-tasks/{taskId}", new
        {
            status = "done",
            priority = "urgent"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await update.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updated.GetProperty("id").GetInt32().Should().Be(taskId);
        updated.GetProperty("status").GetString().Should().Be("done");
        updated.GetProperty("priority").GetString().Should().Be("urgent");
        updated.GetProperty("completed_at").GetString().Should().NotBeNullOrWhiteSpace();

        var doneStats = await Client.GetAsync($"/api/v2/groups/{groupId}/task-stats");
        doneStats.StatusCode.Should().Be(HttpStatusCode.OK);
        var doneStatsData = (await doneStats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        doneStatsData.GetProperty("total").GetInt32().Should().Be(1);
        doneStatsData.GetProperty("todo").GetInt32().Should().Be(0);
        doneStatsData.GetProperty("done").GetInt32().Should().Be(1);

        var delete = await Client.DeleteAsync($"/api/v2/team-tasks/{taskId}");
        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var emptyList = await Client.GetAsync($"/api/v2/groups/{groupId}/tasks?status=done");
        emptyList.StatusCode.Should().Be(HttpStatusCode.OK);
        var emptyData = (await emptyList.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        emptyData.EnumerateArray().Should().NotContain(item => item.GetProperty("id").GetInt32() == taskId);
    }

    [Fact]
    public async Task IdeationTeamDocumentsV2_UseLaravelReactUploadListAndDeleteShape()
    {
        var groupId = await SeedVolunteerGroupAsync($"Laravel React document team {Guid.NewGuid():N}");
        await AuthenticateAsMemberAsync();

        using var form = CreateImageForm();
        var upload = await Client.PostAsync($"/api/v2/groups/{groupId}/documents", form);

        upload.StatusCode.Should().Be(HttpStatusCode.Created);
        var uploadJson = await upload.Content.ReadFromJsonAsync<JsonElement>();
        uploadJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var documentId = uploadJson.GetProperty("data").GetProperty("id").GetInt32();
        documentId.Should().BeGreaterThan(0);

        var list = await Client.GetAsync($"/api/v2/groups/{groupId}/documents?per_page=10");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        listJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == documentId &&
            item.GetProperty("group_id").GetInt32() == groupId &&
            item.GetProperty("user_id").GetInt32() == TestData.MemberUser.Id &&
            item.GetProperty("original_name").GetString() == "newsletter.png" &&
            item.GetProperty("mime_type").GetString() == "image/png" &&
            item.GetProperty("url").GetString()!.Length > 0);
        listJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(10);

        var delete = await Client.DeleteAsync($"/api/v2/team-documents/{documentId}");

        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await delete.Content.ReadAsStringAsync()).Should().BeEmpty();

        var empty = await Client.GetAsync($"/api/v2/groups/{groupId}/documents");
        empty.StatusCode.Should().Be(HttpStatusCode.OK);
        var emptyData = (await empty.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        emptyData.EnumerateArray().Should().NotContain(item => item.GetProperty("id").GetInt32() == documentId);
    }

    [Fact]
    public async Task IdeationTeamChatroomsV2_UseLaravelReactChannelMessagePinAndDeleteShape()
    {
        var groupId = await SeedVolunteerGroupAsync($"Laravel React chat team {Guid.NewGuid():N}");
        await AuthenticateAsMemberAsync();

        var createRoom = await Client.PostAsJsonAsync($"/api/v2/groups/{groupId}/chatrooms", new
        {
            name = "delivery",
            description = "Delivery coordination",
            category = "planning",
            is_private = false
        });

        createRoom.StatusCode.Should().Be(HttpStatusCode.Created);
        var createRoomJson = await createRoom.Content.ReadFromJsonAsync<JsonElement>();
        createRoomJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var room = createRoomJson.GetProperty("data");
        var chatroomId = room.GetProperty("id").GetInt32();
        chatroomId.Should().BeGreaterThan(0);
        room.GetProperty("group_id").GetInt32().Should().Be(groupId);
        room.GetProperty("name").GetString().Should().Be("delivery");
        room.GetProperty("description").GetString().Should().Be("Delivery coordination");
        room.GetProperty("category").GetString().Should().Be("planning");
        room.GetProperty("is_default").GetBoolean().Should().BeFalse();
        room.GetProperty("is_private").GetBoolean().Should().BeFalse();
        room.GetProperty("messages_count").GetInt32().Should().Be(0);

        var rooms = await Client.GetAsync($"/api/v2/groups/{groupId}/chatrooms");
        rooms.StatusCode.Should().Be(HttpStatusCode.OK);
        var roomsJson = await rooms.Content.ReadFromJsonAsync<JsonElement>();
        roomsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        roomsJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == chatroomId &&
            item.GetProperty("name").GetString() == "delivery");

        var message = await Client.PostAsJsonAsync($"/api/v2/group-chatrooms/{chatroomId}/messages", new
        {
            body = "We need a pilot partner."
        });

        message.StatusCode.Should().Be(HttpStatusCode.Created);
        var messageJson = await message.Content.ReadFromJsonAsync<JsonElement>();
        messageJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var messageId = messageJson.GetProperty("data").GetProperty("id").GetInt32();
        messageId.Should().BeGreaterThan(0);

        var messages = await Client.GetAsync($"/api/v2/group-chatrooms/{chatroomId}/messages");
        messages.StatusCode.Should().Be(HttpStatusCode.OK);
        var messagesJson = await messages.Content.ReadFromJsonAsync<JsonElement>();
        messagesJson.GetProperty("success").GetBoolean().Should().BeTrue();
        messagesJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == messageId &&
            item.GetProperty("chatroom_id").GetInt32() == chatroomId &&
            item.GetProperty("user_id").GetInt32() == TestData.MemberUser.Id &&
            item.GetProperty("body").GetString() == "We need a pilot partner." &&
            item.GetProperty("author").GetProperty("id").GetInt32() == TestData.MemberUser.Id);

        var pin = await Client.PostAsJsonAsync($"/api/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId}", new { });
        pin.StatusCode.Should().Be(HttpStatusCode.Created);
        var pinJson = await pin.Content.ReadFromJsonAsync<JsonElement>();
        pinJson.GetProperty("success").GetBoolean().Should().BeTrue();
        pinJson.GetProperty("data").GetProperty("pinned").GetBoolean().Should().BeTrue();

        var pinned = await Client.GetAsync($"/api/v2/groups/{groupId}/chatrooms/{chatroomId}/pinned");
        pinned.StatusCode.Should().Be(HttpStatusCode.OK);
        var pinnedJson = await pinned.Content.ReadFromJsonAsync<JsonElement>();
        pinnedJson.GetProperty("success").GetBoolean().Should().BeTrue();
        pinnedJson.GetProperty("data").EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32() == messageId &&
            item.GetProperty("pinned_by").GetInt32() == TestData.MemberUser.Id &&
            item.GetProperty("body").GetString() == "We need a pilot partner.");

        var unpin = await Client.DeleteAsync($"/api/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId}");
        unpin.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var deleteMessage = await Client.DeleteAsync($"/api/v2/group-chatroom-messages/{messageId}");
        deleteMessage.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var deleteRoom = await Client.DeleteAsync($"/api/v2/group-chatrooms/{chatroomId}");
        deleteRoom.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var emptyRooms = await Client.GetAsync($"/api/v2/groups/{groupId}/chatrooms");
        emptyRooms.StatusCode.Should().Be(HttpStatusCode.OK);
        var emptyRoomsData = (await emptyRooms.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        emptyRoomsData.EnumerateArray().Should().NotContain(item => item.GetProperty("id").GetInt32() == chatroomId);
    }

    [Fact]
    public async Task IdeationBootstrapV2_UsesLaravelReactCategoriesTagsAndTemplatesShape()
    {
        await AuthenticateAsAdminAsync();

        var categories = await Client.GetAsync("/api/v2/ideation-categories");

        categories.StatusCode.Should().Be(HttpStatusCode.OK);
        var categoriesJson = await categories.Content.ReadFromJsonAsync<JsonElement>();
        categoriesJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var category = categoriesJson.GetProperty("data")
            .EnumerateArray()
            .Should()
            .ContainSingle(item => item.GetProperty("slug").GetString() == "community-impact")
            .Subject;
        category.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        category.GetProperty("name").GetString().Should().Be("Community Impact");
        category.GetProperty("icon").GetString().Should().NotBeNullOrWhiteSpace();
        category.GetProperty("color").GetString().Should().NotBeNullOrWhiteSpace();
        category.GetProperty("sort_order").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        var popularTags = await Client.GetAsync("/api/v2/ideation-tags/popular");

        popularTags.StatusCode.Should().Be(HttpStatusCode.OK);
        var popularTagsJson = await popularTags.Content.ReadFromJsonAsync<JsonElement>();
        popularTagsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var popularTag = popularTagsJson.GetProperty("data")
            .EnumerateArray()
            .Should()
            .ContainSingle(item => item.GetProperty("tag").GetString() == "community")
            .Subject;
        popularTag.GetProperty("count").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var tags = await Client.GetAsync("/api/v2/ideation-tags?type=general");

        tags.StatusCode.Should().Be(HttpStatusCode.OK);
        var tagsJson = await tags.Content.ReadFromJsonAsync<JsonElement>();
        tagsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var tag = tagsJson.GetProperty("data")
            .EnumerateArray()
            .Should()
            .ContainSingle(item => item.GetProperty("slug").GetString() == "community")
            .Subject;
        tag.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        tag.GetProperty("name").GetString().Should().Be("community");
        tag.GetProperty("tag_type").GetString().Should().Be("general");

        var templates = await Client.GetAsync("/api/v2/ideation-templates");

        templates.StatusCode.Should().Be(HttpStatusCode.OK);
        var templatesJson = await templates.Content.ReadFromJsonAsync<JsonElement>();
        templatesJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var template = templatesJson.GetProperty("data")
            .EnumerateArray()
            .Should()
            .ContainSingle(item => item.GetProperty("title").GetString() == "Community project")
            .Subject;
        var templateId = template.GetProperty("id").GetInt32();
        templateId.Should().BeGreaterThan(0);
        template.GetProperty("description").GetString().Should().NotBeNullOrWhiteSpace();
        template.GetProperty("default_category_id").GetInt32().Should().BeGreaterThan(0);
        template.GetProperty("category_name").GetString().Should().Be("Community Impact");
        template.GetProperty("default_tags").ValueKind.Should().Be(JsonValueKind.Array);
        template.GetProperty("evaluation_criteria").ValueKind.Should().Be(JsonValueKind.Array);
        template.GetProperty("creator").GetProperty("id").GetInt32().Should().BeGreaterThan(0);

        var detail = await Client.GetAsync($"/api/v2/ideation-templates/{templateId}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailJson.GetProperty("success").GetBoolean().Should().BeTrue();
        detailJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(templateId);

        var templateData = await Client.GetAsync($"/api/v2/ideation-templates/{templateId}/data");

        templateData.StatusCode.Should().Be(HttpStatusCode.OK);
        var templateDataJson = await templateData.Content.ReadFromJsonAsync<JsonElement>();
        templateDataJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = templateDataJson.GetProperty("data");
        data.GetProperty("title").GetString().Should().Be("Community project");
        data.GetProperty("description").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("category_id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("tags").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("evaluation_criteria").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("prize_description").ValueKind.Should().NotBe(JsonValueKind.Undefined);
        data.GetProperty("max_ideas_per_user").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task FeedTrackingV2_UsesLaravelReactRecordedEnvelopeAndValidation()
    {
        var postId = await SeedAdminFeedPostAsync("Laravel React feed tracking post");
        await AuthenticateAsMemberAsync();

        var legacyImpression = await Client.PostAsJsonAsync($"/api/v2/feed/posts/{postId}/impression", new { });

        legacyImpression.StatusCode.Should().Be(HttpStatusCode.OK);
        var legacyJson = await legacyImpression.Content.ReadFromJsonAsync<JsonElement>();
        legacyJson.GetProperty("data").GetProperty("recorded").GetBoolean().Should().BeTrue();
        legacyJson.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        legacyJson.TryGetProperty("success", out _).Should().BeFalse();

        var polymorphicImpression = await Client.PostAsJsonAsync("/api/v2/feed/impression", new
        {
            target_type = "post",
            target_id = postId
        });

        polymorphicImpression.StatusCode.Should().Be(HttpStatusCode.OK);
        var impressionJson = await polymorphicImpression.Content.ReadFromJsonAsync<JsonElement>();
        impressionJson.GetProperty("data").GetProperty("recorded").GetBoolean().Should().BeTrue();

        var polymorphicClick = await Client.PostAsJsonAsync("/api/v2/feed/click", new
        {
            target_type = "listing",
            target_id = TestData.Listing1.Id
        });

        polymorphicClick.StatusCode.Should().Be(HttpStatusCode.OK);
        var clickJson = await polymorphicClick.Content.ReadFromJsonAsync<JsonElement>();
        clickJson.GetProperty("data").GetProperty("recorded").GetBoolean().Should().BeTrue();

        var invalidType = await Client.PostAsJsonAsync("/api/v2/feed/impression", new
        {
            target_type = "level_up",
            target_id = postId
        });

        invalidType.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var invalidJson = await invalidType.Content.ReadFromJsonAsync<JsonElement>();
        var error = invalidJson.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("field").GetString().Should().Be("target_type");
    }

    [Fact]
    public async Task FeedSharesV2_UsesLaravelReactPolymorphicToggleDeleteAndSharersShape()
    {
        var postId = await SeedAdminFeedPostAsync("Laravel React shareable post", TestData.AdminUser.Id);
        var listingId = await SeedAdminFeedListingAsync("Laravel React shareable listing", TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();

        var sharePost = await Client.PostAsJsonAsync("/api/v2/shares", new
        {
            type = "post",
            id = postId,
            comment = "<b>Great update</b>"
        });

        sharePost.StatusCode.Should().Be(HttpStatusCode.Created);
        var sharePostJson = await sharePost.Content.ReadFromJsonAsync<JsonElement>();
        sharePostJson.TryGetProperty("success", out _).Should().BeFalse();
        sharePostJson.GetProperty("data").GetProperty("shared").GetBoolean().Should().BeTrue();
        sharePostJson.GetProperty("data").GetProperty("count").GetInt32().Should().Be(1);
        sharePostJson.GetProperty("data").GetProperty("share_id").GetInt32().Should().BeGreaterThan(0);
        sharePostJson.GetProperty("data").GetProperty("type").GetString().Should().Be("post");
        sharePostJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(postId);
        sharePostJson.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        var sharers = await Client.GetAsync($"/api/v2/feed/posts/{postId}/sharers");

        sharers.StatusCode.Should().Be(HttpStatusCode.OK);
        var sharersJson = await sharers.Content.ReadFromJsonAsync<JsonElement>();
        var sharersData = sharersJson.GetProperty("data");
        sharersData.GetProperty("share_count").GetInt32().Should().Be(1);
        sharersData.GetProperty("has_shared").GetBoolean().Should().BeTrue();
        sharersData.GetProperty("type").GetString().Should().Be("post");
        sharersData.GetProperty("id").GetInt32().Should().Be(postId);
        sharersData.GetProperty("sharers").EnumerateArray().Should().ContainSingle();

        var toggleOff = await Client.PostAsJsonAsync("/api/v2/shares", new
        {
            type = "post",
            id = postId
        });

        toggleOff.StatusCode.Should().Be(HttpStatusCode.OK);
        var toggleOffJson = await toggleOff.Content.ReadFromJsonAsync<JsonElement>();
        toggleOffJson.GetProperty("data").GetProperty("shared").GetBoolean().Should().BeFalse();
        toggleOffJson.GetProperty("data").GetProperty("count").GetInt32().Should().Be(0);

        var shareListing = await Client.PostAsJsonAsync("/api/v2/shares", new
        {
            type = "listing",
            id = listingId
        });

        shareListing.StatusCode.Should().Be(HttpStatusCode.Created);
        var shareListingJson = await shareListing.Content.ReadFromJsonAsync<JsonElement>();
        shareListingJson.GetProperty("data").GetProperty("shared").GetBoolean().Should().BeTrue();
        shareListingJson.GetProperty("data").GetProperty("count").GetInt32().Should().Be(1);
        shareListingJson.GetProperty("data").GetProperty("type").GetString().Should().Be("listing");
        shareListingJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(listingId);

        using var deleteRequest = new HttpRequestMessage(HttpMethod.Delete, "/api/v2/shares")
        {
            Content = JsonContent.Create(new
            {
                type = "listing",
                id = listingId
            })
        };
        var deleteListing = await Client.SendAsync(deleteRequest);

        deleteListing.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteListingJson = await deleteListing.Content.ReadFromJsonAsync<JsonElement>();
        deleteListingJson.GetProperty("data").GetProperty("shared").GetBoolean().Should().BeFalse();
        deleteListingJson.GetProperty("data").GetProperty("count").GetInt32().Should().Be(0);
        deleteListingJson.GetProperty("data").GetProperty("type").GetString().Should().Be("listing");
        deleteListingJson.GetProperty("data").GetProperty("id").GetInt32().Should().Be(listingId);

        var invalidType = await Client.PostAsJsonAsync("/api/v2/shares", new
        {
            type = "level_up",
            id = postId
        });

        invalidType.StatusCode.Should().Be((HttpStatusCode)422);
        var invalidJson = await invalidType.Content.ReadFromJsonAsync<JsonElement>();
        invalidJson.GetProperty("errors").EnumerateArray().Should().ContainSingle()
            .Subject.GetProperty("code").GetString().Should().Be("INVALID_INPUT");
    }

    [Fact]
    public async Task FeedCommentsV2_UsesLaravelReactThreadedCrudAndReactionShape()
    {
        var postId = await SeedAdminFeedPostAsync("Laravel React commentable post", TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();

        var createRoot = await Client.PostAsJsonAsync("/api/v2/comments", new
        {
            target_type = "post",
            target_id = postId,
            content = "<b>Root comment</b>"
        });

        createRoot.StatusCode.Should().Be(HttpStatusCode.Created);
        var createRootJson = await createRoot.Content.ReadFromJsonAsync<JsonElement>();
        createRootJson.TryGetProperty("success", out _).Should().BeFalse();
        createRootJson.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var rootData = createRootJson.GetProperty("data");
        var rootCommentId = rootData.GetProperty("id").GetInt32();
        rootData.GetProperty("content").GetString().Should().Be("<b>Root comment</b>");
        rootData.GetProperty("is_own").GetBoolean().Should().BeTrue();
        rootData.GetProperty("author").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        rootData.GetProperty("replies").GetArrayLength().Should().Be(0);

        var createReply = await Client.PostAsJsonAsync("/api/v2/comments", new
        {
            target_type = "post",
            target_id = postId,
            parent_id = rootCommentId,
            content = "Reply comment"
        });

        createReply.StatusCode.Should().Be(HttpStatusCode.Created);
        var createReplyJson = await createReply.Content.ReadFromJsonAsync<JsonElement>();
        var replyCommentId = createReplyJson.GetProperty("data").GetProperty("id").GetInt32();

        var list = await Client.GetAsync($"/api/v2/comments?target_type=post&target_id={postId}");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.TryGetProperty("success", out _).Should().BeFalse();
        var listData = listJson.GetProperty("data");
        listData.GetProperty("count").GetInt32().Should().Be(2);
        var listedRoot = listData.GetProperty("comments").EnumerateArray()
            .Single(row => row.GetProperty("id").GetInt32() == rootCommentId);
        listedRoot.GetProperty("replies").EnumerateArray().Should().ContainSingle()
            .Subject.GetProperty("id").GetInt32().Should().Be(replyCommentId);

        var update = await Client.PutAsJsonAsync($"/api/v2/comments/{rootCommentId}", new
        {
            content = "<script>@hiddenmention</script><p class='edit' onclick='bad()'>Edited <em>root</em></p>"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        var updatedContent = updateJson.GetProperty("data").GetProperty("content").GetString();
        updatedContent.Should().Contain("<p class=\"edit\">Edited <em>root</em></p>");
        updatedContent.Should().NotContain("script");
        updatedContent.Should().NotContain("onclick");
        updateJson.GetProperty("data").GetProperty("edited").GetBoolean().Should().BeTrue();

        var reaction = await Client.PostAsJsonAsync($"/api/v2/comments/{rootCommentId}/reactions", new
        {
            reaction_type = "love"
        });

        reaction.StatusCode.Should().Be(HttpStatusCode.OK);
        var reactionJson = await reaction.Content.ReadFromJsonAsync<JsonElement>();
        var reactionData = reactionJson.GetProperty("data");
        reactionData.GetProperty("action").GetString().Should().Be("added");
        reactionData.GetProperty("reaction_type").GetString().Should().Be("love");
        reactionData.GetProperty("reactions").GetProperty("love").GetInt32().Should().Be(1);

        var delete = await Client.DeleteAsync($"/api/v2/comments/{rootCommentId}");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("deleted_count").GetInt32().Should().Be(2);

        var invalidTarget = await Client.GetAsync($"/api/v2/comments?target_type=level_up&target_id={postId}");

        invalidTarget.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var invalidJson = await invalidTarget.Content.ReadFromJsonAsync<JsonElement>();
        invalidJson.GetProperty("errors").EnumerateArray().Should().ContainSingle()
            .Subject.GetProperty("code").GetString().Should().Be("RESOURCE_NOT_FOUND");
    }

    [Fact]
    public async Task FeedReactionsV2_UsesLaravelReactPolymorphicToggleShowAndReactorsShape()
    {
        var postId = await SeedAdminFeedPostAsync("Laravel React reaction post", TestData.AdminUser.Id);
        var listingId = await SeedAdminFeedListingAsync("Laravel React reaction listing", TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();

        var postReaction = await Client.PostAsJsonAsync("/api/v2/reactions", new
        {
            target_type = "post",
            target_id = postId,
            reaction_type = "celebrate"
        });

        postReaction.StatusCode.Should().Be(HttpStatusCode.OK);
        var postReactionJson = await postReaction.Content.ReadFromJsonAsync<JsonElement>();
        postReactionJson.TryGetProperty("success", out _).Should().BeFalse();
        var postReactionData = postReactionJson.GetProperty("data");
        postReactionData.GetProperty("action").GetString().Should().Be("added");
        postReactionData.GetProperty("reaction_type").GetString().Should().Be("celebrate");
        var postReactions = postReactionData.GetProperty("reactions");
        postReactions.GetProperty("counts").GetProperty("celebrate").GetInt32().Should().Be(1);
        postReactions.GetProperty("total").GetInt32().Should().Be(1);
        postReactions.GetProperty("user_reaction").GetString().Should().Be("celebrate");

        var showPost = await Client.GetAsync($"/api/v2/reactions/post/{postId}");

        showPost.StatusCode.Should().Be(HttpStatusCode.OK);
        var showPostJson = await showPost.Content.ReadFromJsonAsync<JsonElement>();
        var showPostData = showPostJson.GetProperty("data");
        showPostData.GetProperty("counts").GetProperty("celebrate").GetInt32().Should().Be(1);
        showPostData.GetProperty("total").GetInt32().Should().Be(1);
        showPostData.GetProperty("user_reaction").GetString().Should().Be("celebrate");
        showPostData.GetProperty("top_reactors").EnumerateArray()
            .Should().Contain(row => row.GetProperty("id").GetInt32() == TestData.MemberUser.Id);

        var toggleOff = await Client.PostAsJsonAsync("/api/v2/reactions", new
        {
            target_type = "post",
            target_id = postId,
            reaction_type = "celebrate"
        });

        toggleOff.StatusCode.Should().Be(HttpStatusCode.OK);
        var toggleOffJson = await toggleOff.Content.ReadFromJsonAsync<JsonElement>();
        var toggleOffData = toggleOffJson.GetProperty("data");
        toggleOffData.GetProperty("action").GetString().Should().Be("removed");
        toggleOffData.GetProperty("reaction_type").ValueKind.Should().Be(JsonValueKind.Null);
        toggleOffData.GetProperty("reactions").GetProperty("total").GetInt32().Should().Be(0);

        var listingReaction = await Client.PostAsJsonAsync("/api/v2/reactions", new
        {
            target_type = "listing",
            target_id = listingId,
            reaction_type = "clap"
        });

        listingReaction.StatusCode.Should().Be(HttpStatusCode.OK);
        var listingReactionJson = await listingReaction.Content.ReadFromJsonAsync<JsonElement>();
        listingReactionJson.GetProperty("data").GetProperty("reactions").GetProperty("counts").GetProperty("clap").GetInt32().Should().Be(1);

        var reactors = await Client.GetAsync($"/api/v2/reactions/listing/{listingId}/users/clap?page=1&per_page=20");

        reactors.StatusCode.Should().Be(HttpStatusCode.OK);
        var reactorsJson = await reactors.Content.ReadFromJsonAsync<JsonElement>();
        reactorsJson.GetProperty("data").EnumerateArray()
            .Should().Contain(row => row.GetProperty("id").GetInt32() == TestData.MemberUser.Id);
        reactorsJson.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();

        var invalidReaction = await Client.PostAsJsonAsync("/api/v2/reactions", new
        {
            target_type = "post",
            target_id = postId,
            reaction_type = "angry"
        });

        invalidReaction.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var invalidJson = await invalidReaction.Content.ReadFromJsonAsync<JsonElement>();
        var error = invalidJson.GetProperty("errors").EnumerateArray().Should().ContainSingle().Subject;
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("field").GetString().Should().Be("reaction_type");
    }

    [Fact]
    public async Task MentionsSearchV2_UsesLaravelReactSuggestionShapeAndConnectionOrdering()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

            var nonConnection = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = "zara.mention@example.test",
                Username = "zara",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Zara",
                LastName = "Mention",
                Role = "member",
                IsActive = true,
                AvatarUrl = "/storage/avatars/zara.png",
                CreatedAt = DateTime.UtcNow
            };
            var connection = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = "zach.connection@example.test",
                Username = "zach",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Zach",
                LastName = "Connection",
                Role = "member",
                IsActive = true,
                AvatarUrl = "/storage/avatars/zach.png",
                CreatedAt = DateTime.UtcNow
            };
            var inactive = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = "zoe.inactive@example.test",
                Username = "zoe",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Zoe",
                LastName = "Inactive",
                Role = "member",
                IsActive = false,
                CreatedAt = DateTime.UtcNow
            };
            var otherTenant = new User
            {
                TenantId = TestData.Tenant2.Id,
                Email = "zed.other@example.test",
                Username = "zed",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Zed",
                LastName = "Other",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            db.Users.AddRange(nonConnection, connection, inactive, otherTenant);
            await db.SaveChangesAsync();

            db.Connections.Add(new Connection
            {
                TenantId = TestData.Tenant1.Id,
                RequesterId = TestData.MemberUser.Id,
                AddresseeId = connection.Id,
                Status = Connection.Statuses.Accepted,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/mentions/search?q=Z&limit=20");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        var data = json.GetProperty("data").EnumerateArray().ToList();
        data.Should().HaveCount(2);

        var first = data[0];
        first.GetProperty("id").GetInt32().Should().NotBe(TestData.MemberUser.Id);
        first.GetProperty("name").GetString().Should().Be("Zach");
        first.GetProperty("username").GetString().Should().Be("zach");
        first.GetProperty("avatar_url").GetString().Should().Be("/storage/avatars/zach.png");
        first.GetProperty("is_connection").GetBoolean().Should().BeTrue();

        var second = data[1];
        second.GetProperty("name").GetString().Should().Be("Zara");
        second.GetProperty("avatar_url").GetString().Should().Be("/storage/avatars/zara.png");
        second.GetProperty("is_connection").GetBoolean().Should().BeFalse();

        data.Should().NotContain(row => row.GetProperty("username").GetString() == "zoe");
        data.Should().NotContain(row => row.GetProperty("username").GetString() == "zed");
    }

    [Fact]
    public async Task SocialCommentMention_PersistsLaravelMentionAndNotificationsOnPostgres()
    {
        int mentionedUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var mentioned = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = "mention.target@example.test",
                Username = "mentiontarget",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Mention",
                LastName = "Target",
                PreferredLanguage = "ga",
                Role = "member",
                IsActive = true,
                IsApproved = true
            };
            db.Users.Add(mentioned);
            await db.SaveChangesAsync();
            mentionedUserId = mentioned.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/social/comments", new
        {
            action = "submit",
            target_type = "listing",
            target_id = TestData.Listing1.Id,
            content = "Thanks @mentiontarget for helping"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var verificationScope = Factory.Services.CreateScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var mention = await verificationDb.ContentMentions
            .SingleAsync(row => row.MentionedUserId == mentionedUserId);
        mention.MentioningUserId.Should().Be(TestData.MemberUser.Id);
        mention.EntityType.Should().Be("comment");
        mention.CommentId.Should().Be(mention.EntityId);
        var mentionedNotification = await verificationDb.Notifications
            .SingleAsync(row => row.UserId == mentionedUserId && row.Type == "mention");
        mentionedNotification.Link.Should().Be("/feed");
        mentionedNotification.Body.Should().Be("Luaigh Member User thú i nóta tráchta.");
        await verificationDb.Notifications
            .SingleAsync(row => row.UserId == TestData.AdminUser.Id && row.Type == "comment");
    }

    [Fact]
    public async Task AdminModerationV2_UsesLaravelReactQueueStatsAndReviewShape()
    {
        await AuthenticateAsAdminAsync();
        var reportId = await SeedAdminModerationReportAsync("Laravel React moderation queue item");

        var queue = await Client.GetAsync("/api/v2/admin/moderation/queue?status=pending&content_type=listing&search=Laravel%20React&page=1&limit=20");

        queue.StatusCode.Should().Be(HttpStatusCode.OK);
        var queueJson = await queue.Content.ReadFromJsonAsync<JsonElement>();
        queueJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        queueJson.GetProperty("success").GetBoolean().Should().BeTrue();
        queueJson.GetProperty("meta").GetProperty("current_page").GetInt32().Should().Be(1);
        queueJson.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(20);
        queueJson.GetProperty("meta").GetProperty("total_pages").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        var item = queueJson.GetProperty("data").EnumerateArray()
            .Single(row => row.GetProperty("id").GetInt32() == reportId);
        item.GetProperty("content_type").GetString().Should().Be("listing");
        item.GetProperty("content_id").GetInt32().Should().Be(321);
        item.GetProperty("title").GetString().Should().Be("Laravel React moderation queue item");
        item.GetProperty("body").GetString().Should().Contain("Moderation details");
        item.GetProperty("author_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        item.GetProperty("author_name").GetString().Should().Be("Member User");
        item.GetProperty("status").GetString().Should().Be("pending");
        item.GetProperty("auto_flagged").GetBoolean().Should().BeFalse();
        item.GetProperty("submitted_at").GetString().Should().NotBeNullOrWhiteSpace();

        var stats = await Client.GetAsync("/api/v2/admin/moderation/stats");

        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        var statsJson = await stats.Content.ReadFromJsonAsync<JsonElement>();
        statsJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var statsData = statsJson.GetProperty("data");
        statsData.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("pending").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        statsData.GetProperty("by_type").GetProperty("listing").GetProperty("pending").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var review = await Client.PostAsJsonAsync($"/api/v2/admin/moderation/{reportId}/review", new
        {
            decision = "approved"
        });

        review.StatusCode.Should().Be(HttpStatusCode.OK);
        var reviewJson = await review.Content.ReadFromJsonAsync<JsonElement>();
        reviewJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        reviewJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var reviewData = reviewJson.GetProperty("data");
        reviewData.GetProperty("success").GetBoolean().Should().BeTrue();
        reviewData.GetProperty("content_type").GetString().Should().Be("listing");
        reviewData.GetProperty("content_id").GetInt32().Should().Be(321);
    }

    private async Task SeedRegionalAnalyticsSubscriptionAsync(string token)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var subscription = new RegionalAnalyticsSubscription
        {
            TenantId = TestData.Tenant1.Id,
            PartnerName = "Contract Partner",
            ContactEmail = "partner@example.test",
            Status = "active",
            SubscriptionToken = token,
            CurrentPeriodStart = DateTime.UtcNow.AddDays(-30),
            CurrentPeriodEnd = DateTime.UtcNow.AddDays(30)
        };
        db.RegionalAnalyticsSubscriptions.Add(subscription);
        await db.SaveChangesAsync();

        db.RegionalAnalyticsReports.Add(new RegionalAnalyticsReport
        {
            TenantId = TestData.Tenant1.Id,
            SubscriptionId = subscription.Id,
            ReportType = "monthly_summary",
            PeriodStart = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(-1)),
            PeriodEnd = DateOnly.FromDateTime(DateTime.UtcNow),
            GeneratedAt = DateTime.UtcNow,
            Status = "ready",
            FileUrl = "/storage/regional-analytics/report.pdf"
        });
        await db.SaveChangesAsync();
    }

    private async Task<int> SeedAdminPollAsync(string question)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var poll = new Poll
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.MemberUser.Id,
            Title = question,
            Description = "Poll seeded for Laravel React admin contract tests.",
            PollType = "single",
            Status = "active",
            ShowResultsBeforeClose = true,
            CreatedAt = now.AddMinutes(-10)
        };
        db.Polls.Add(poll);
        await db.SaveChangesAsync();

        var yes = new PollOption
        {
            TenantId = TestData.Tenant1.Id,
            PollId = poll.Id,
            Text = "Yes",
            SortOrder = 1,
            CreatedAt = now.AddMinutes(-9)
        };
        var no = new PollOption
        {
            TenantId = TestData.Tenant1.Id,
            PollId = poll.Id,
            Text = "No",
            SortOrder = 2,
            CreatedAt = now.AddMinutes(-9)
        };
        db.PollOptions.AddRange(yes, no);
        await db.SaveChangesAsync();

        db.PollVotes.Add(new PollVote
        {
            TenantId = TestData.Tenant1.Id,
            PollId = poll.Id,
            OptionId = yes.Id,
            UserId = TestData.AdminUser.Id,
            CreatedAt = now.AddMinutes(-8)
        });
        await db.SaveChangesAsync();

        return poll.Id;
    }

    private async Task<int> SeedAdminResourceArticleAsync(string title)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var article = new KnowledgeArticle
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.AdminUser.Id,
            Title = title,
            Slug = $"resource-{Guid.NewGuid():N}",
            Content = "Laravel React resource body for the admin resource table.",
            Category = "Getting Started",
            Tags = "contract,resources",
            IsPublished = true,
            SortOrder = 1,
            ViewCount = 42,
            CreatedAt = now.AddDays(-2),
            UpdatedAt = now.AddHours(-1)
        };
        db.KnowledgeArticles.Add(article);
        await db.SaveChangesAsync();
        article.Slug = $"resource-{article.Id}";
        await db.SaveChangesAsync();
        return article.Id;
    }

    private async Task<int> SeedAdminGoalAsync(string title)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var goal = new Goal
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Title = title,
            Description = "Laravel React goal body for the admin goals table.",
            GoalType = "hours",
            TargetValue = 10m,
            CurrentValue = 4m,
            Category = "community",
            Status = "active",
            TargetDate = now.AddDays(30),
            CreatedAt = now.AddDays(-1),
            UpdatedAt = now.AddHours(-2)
        };
        db.Goals.Add(goal);
        await db.SaveChangesAsync();

        db.GoalMilestones.Add(new GoalMilestone
        {
            TenantId = TestData.Tenant1.Id,
            GoalId = goal.Id,
            Title = "First checkpoint",
            IsCompleted = false,
            SortOrder = 1,
            CreatedAt = now.AddHours(-20)
        });
        await db.SaveChangesAsync();

        return goal.Id;
    }

    private async Task<int> SeedAdminIdeationChallengeAsync(string title)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var challenge = new Challenge
        {
            TenantId = TestData.Tenant1.Id,
            Title = title,
            Description = "Laravel React ideation body for the admin challenges table.",
            ChallengeType = ChallengeType.Community,
            TargetAction = "idea_submitted",
            TargetCount = 3,
            XpReward = 25,
            StartsAt = now.AddDays(-1),
            EndsAt = now.AddDays(14),
            IsActive = true,
            Difficulty = ChallengeDifficulty.Medium,
            CreatedAt = now.AddHours(-3),
            UpdatedAt = now.AddHours(-1)
        };
        db.Challenges.Add(challenge);
        await db.SaveChangesAsync();

        db.ChallengeParticipants.Add(new ChallengeParticipant
        {
            TenantId = TestData.Tenant1.Id,
            ChallengeId = challenge.Id,
            UserId = TestData.MemberUser.Id,
            CurrentProgress = 1,
            JoinedAt = now.AddHours(-2)
        });
        await db.SaveChangesAsync();

        return challenge.Id;
    }

    private async Task<int> SeedAdminModerationReportAsync(string title)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var report = new ContentReport
        {
            TenantId = TestData.Tenant1.Id,
            ReporterId = TestData.MemberUser.Id,
            ContentType = "listing",
            ContentId = 321,
            Reason = ReportReason.SafetyConcern,
            Description = $"{title}\nModeration details for the React moderation queue.",
            Status = ReportStatus.Pending,
            CreatedAt = DateTime.UtcNow.AddHours(-6)
        };
        db.ContentReports.Add(report);
        await db.SaveChangesAsync();
        return report.Id;
    }

    private async Task<int> SeedScheduledJobRunAsync(string jobName, ScheduledJobRunStatus status, string output)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var run = new ScheduledJobRun
        {
            TenantId = TestData.Tenant1.Id,
            JobName = jobName,
            StartedAt = DateTime.UtcNow.AddMinutes(-15),
            CompletedAt = DateTime.UtcNow.AddMinutes(-14),
            Status = status,
            ItemsProcessed = 3,
            ErrorMessage = output,
            ErrorType = status == ScheduledJobRunStatus.Failed ? "ContractTestFailure" : null,
            DurationMs = 1234
        };
        db.ScheduledJobRuns.Add(run);
        await db.SaveChangesAsync();
        return run.Id;
    }

    private async Task<int> SeedVolunteerShiftAsync(string title)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;

        var opportunity = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant1.Id,
            Title = title,
            Description = "Created for Laravel React volunteering contract tests.",
            OrganizerId = TestData.AdminUser.Id,
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 3,
            StartsAt = now.AddDays(2),
            EndsAt = now.AddDays(2).AddHours(2),
            CreatedAt = now
        };

        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();

        var shift = new VolunteerShift
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            Title = title,
            StartsAt = now.AddDays(2),
            EndsAt = now.AddDays(2).AddHours(2),
            MaxVolunteers = 3,
            Status = ShiftStatus.Scheduled,
            CreatedAt = now
        };

        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync();

        return shift.Id;
    }

    private async Task<int> SeedVolunteerGroupAsync(string name)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var group = new Group
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.MemberUser.Id,
            Name = name,
            Description = "Created for Laravel React volunteering contract tests.",
            IsPrivate = false,
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

        return group.Id;
    }

    private async Task<int> SeedAdminFeedCommentAsync(string content)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var post = new FeedPost
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            Content = "Feed post backing a Laravel React admin comment moderation test.",
            CreatedAt = now.AddHours(-3)
        };
        db.FeedPosts.Add(post);
        await db.SaveChangesAsync();

        var comment = new PostComment
        {
            TenantId = TestData.Tenant1.Id,
            PostId = post.Id,
            UserId = TestData.MemberUser.Id,
            Content = content,
            CreatedAt = now.AddHours(-2)
        };
        db.PostComments.Add(comment);
        await db.SaveChangesAsync();
        return comment.Id;
    }

    private Task<int> SeedAdminFeedPostAsync(string content)
    {
        return SeedAdminFeedPostAsync(content, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedPostAsync(string content, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var post = new FeedPost
        {
            TenantId = TestData.Tenant1.Id,
            UserId = userId,
            Content = content,
            ImageUrl = "https://example.test/feed-post.png",
            CreatedAt = now.AddHours(-3)
        };
        db.FeedPosts.Add(post);
        await db.SaveChangesAsync();

        db.PostLikes.Add(new PostLike
        {
            TenantId = TestData.Tenant1.Id,
            PostId = post.Id,
            UserId = TestData.AdminUser.Id,
            CreatedAt = now.AddHours(-2)
        });
        db.PostComments.Add(new PostComment
        {
            TenantId = TestData.Tenant1.Id,
            PostId = post.Id,
            UserId = TestData.AdminUser.Id,
            Content = "Recent admin moderation comment",
            CreatedAt = now.AddHours(-1)
        });
        db.FeedReports.Add(new FeedReport
        {
            TenantId = TestData.Tenant1.Id,
            PostId = post.Id,
            ReporterId = TestData.AdminUser.Id,
            Reason = "spam",
            Details = "Flagged for Laravel React admin feed contract coverage.",
            Status = "pending",
            CreatedAt = now.AddMinutes(-30)
        });
        await db.SaveChangesAsync();
        return post.Id;
    }

    private async Task<int> GetUserIdByEmailAsync(string email)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Users
            .Where(user => user.TenantId == TestData.Tenant1.Id && user.Email == email)
            .Select(user => user.Id)
            .SingleAsync();
    }

    private async Task<string> SeedAndLoginUserAsync(string email, string role)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = role[..1].ToUpperInvariant() + role[1..],
            LastName = "Feed",
            Role = role,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return await GetAccessTokenAsync(email, TestData.Tenant1.Slug);
    }

    private Task<int> SeedAdminFeedListingAsync(string title)
    {
        return SeedAdminFeedListingAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedListingAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = new Listing
        {
            TenantId = TestData.Tenant1.Id,
            UserId = userId,
            Title = title,
            Description = "Listing included in the Laravel React admin feed moderation contract.",
            Type = ListingType.Offer,
            Status = ListingStatus.Active,
            ImageUrl = "https://example.test/listing-feed.png",
            CreatedAt = DateTime.UtcNow.AddHours(-2)
        };
        db.Listings.Add(listing);
        await db.SaveChangesAsync();
        return listing.Id;
    }

    private Task<int> SeedAdminFeedEventAsync(string title)
    {
        return SeedAdminFeedEventAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedEventAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evt = new Event
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = userId,
            Title = title,
            Description = "Event included in the Laravel React admin feed moderation contract.",
            Location = "Contract test hall",
            StartsAt = DateTime.UtcNow.AddDays(3),
            EndsAt = DateTime.UtcNow.AddDays(3).AddHours(2),
            ImageUrl = "https://example.test/event-feed.png",
            CreatedAt = DateTime.UtcNow.AddHours(-2)
        };
        db.Events.Add(evt);
        await db.SaveChangesAsync();
        return evt.Id;
    }

    private Task<int> SeedAdminFeedPollAsync(string title)
    {
        return SeedAdminFeedPollAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedPollAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var poll = new Poll
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = userId,
            Title = title,
            Description = "Poll included in the Laravel React admin feed moderation contract.",
            PollType = "single",
            Status = "active",
            ShowResultsBeforeClose = true,
            CreatedAt = now.AddHours(-2)
        };
        db.Polls.Add(poll);
        await db.SaveChangesAsync();

        db.PollOptions.Add(new PollOption
        {
            TenantId = TestData.Tenant1.Id,
            PollId = poll.Id,
            Text = "First moderation option",
            SortOrder = 1,
            CreatedAt = now.AddHours(-2)
        });
        await db.SaveChangesAsync();
        return poll.Id;
    }

    private Task<int> SeedAdminFeedGoalAsync(string title)
    {
        return SeedAdminFeedGoalAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedGoalAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var goal = new Goal
        {
            TenantId = TestData.Tenant1.Id,
            UserId = userId,
            Title = title,
            Description = "Goal included in the Laravel React admin feed moderation contract.",
            GoalType = "custom",
            TargetValue = 5,
            CurrentValue = 2,
            Category = "Community",
            Status = "active",
            CreatedAt = DateTime.UtcNow.AddHours(-2)
        };
        db.Goals.Add(goal);
        await db.SaveChangesAsync();
        return goal.Id;
    }

    private Task<int> SeedAdminFeedJobAsync(string title)
    {
        return SeedAdminFeedJobAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedJobAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = userId,
            Title = title,
            Description = "Job included in the Laravel React admin feed moderation contract.",
            Category = "Community",
            JobType = "volunteer",
            Location = "Contract test hub",
            IsRemote = false,
            TimeCreditsPerHour = 2,
            RequiredSkills = "moderation,contract",
            Status = "active",
            CreatedAt = DateTime.UtcNow.AddHours(-2)
        };
        db.JobVacancies.Add(job);
        await db.SaveChangesAsync();
        return job.Id;
    }

    private async Task<int> SeedAdminFeedChallengeAsync(string title)
    {
        return await SeedAdminFeedChallengeAsync(title, authorUserId: null);
    }

    private async Task<int> SeedAdminFeedChallengeAsync(string title, int? authorUserId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var challenge = new Challenge
        {
            TenantId = TestData.Tenant1.Id,
            Title = title,
            Description = "Challenge included in the Laravel React admin feed moderation contract.",
            ChallengeType = ChallengeType.Community,
            TargetAction = "contract_test",
            TargetCount = 3,
            XpReward = 25,
            StartsAt = now.AddDays(-1),
            EndsAt = now.AddDays(14),
            IsActive = true,
            Difficulty = ChallengeDifficulty.Medium,
            CreatedAt = now.AddHours(-2)
        };
        db.Challenges.Add(challenge);
        await db.SaveChangesAsync();
        if (authorUserId.HasValue)
        {
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = $"admin.feed.author.challenge.{challenge.Id}",
                Value = authorUserId.Value.ToString(),
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync();
        }

        return challenge.Id;
    }

    private Task<int> SeedAdminFeedVolunteerAsync(string title)
    {
        return SeedAdminFeedVolunteerAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedVolunteerAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var opportunity = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant1.Id,
            OrganizerId = userId,
            Title = title,
            Description = "Volunteer opportunity included in the Laravel React admin feed moderation contract.",
            Location = "Contract test centre",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 4,
            StartsAt = now.AddDays(3),
            EndsAt = now.AddDays(3).AddHours(2),
            ApplicationDeadline = now.AddDays(2),
            SkillsRequired = "moderation,volunteering",
            CreditReward = 2,
            CreatedAt = now.AddHours(-2)
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();
        return opportunity.Id;
    }

    private Task<int> SeedAdminFeedBlogAsync(string title)
    {
        return SeedAdminFeedBlogAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedBlogAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var blog = new BlogPost
        {
            TenantId = TestData.Tenant1.Id,
            AuthorId = userId,
            Title = title,
            Slug = $"laravel-react-feed-blog-{Guid.NewGuid():N}",
            Content = "Blog post included in the Laravel React admin feed moderation contract.",
            Excerpt = "Blog post included in the Laravel React admin feed moderation contract.",
            FeaturedImageUrl = "https://example.test/blog-feed.png",
            Status = "published",
            Tags = "moderation,contract",
            PublishedAt = now.AddHours(-1),
            CreatedAt = now.AddHours(-2)
        };
        db.BlogPosts.Add(blog);
        await db.SaveChangesAsync();
        return blog.Id;
    }

    private Task<int> SeedAdminFeedDiscussionAsync(string title)
    {
        return SeedAdminFeedDiscussionAsync(title, TestData.MemberUser.Id);
    }

    private async Task<int> SeedAdminFeedDiscussionAsync(string title, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var group = new Group
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = userId,
            Name = $"Contract discussion group {Guid.NewGuid():N}",
            Description = "Group backing a Laravel React admin feed discussion contract test.",
            CreatedAt = now.AddHours(-3)
        };
        db.Groups.Add(group);
        await db.SaveChangesAsync();

        var discussion = new GroupDiscussion
        {
            TenantId = TestData.Tenant1.Id,
            GroupId = group.Id,
            AuthorId = userId,
            Title = title,
            Content = "Discussion included in the Laravel React admin feed moderation contract.",
            CreatedAt = now.AddHours(-2)
        };
        db.GroupDiscussions.Add(discussion);
        await db.SaveChangesAsync();
        return discussion.Id;
    }

    private Task<int> SeedAuthoredFeedItemAsync(string sourceType, int userId)
    {
        var title = $"Laravel React broker self moderation {sourceType} {Guid.NewGuid():N}";
        return sourceType switch
        {
            "listing" => SeedAdminFeedListingAsync(title, userId),
            "event" => SeedAdminFeedEventAsync(title, userId),
            "poll" => SeedAdminFeedPollAsync(title, userId),
            "goal" => SeedAdminFeedGoalAsync(title, userId),
            "job" => SeedAdminFeedJobAsync(title, userId),
            "volunteer" => SeedAdminFeedVolunteerAsync(title, userId),
            "blog" => SeedAdminFeedBlogAsync(title, userId),
            "discussion" => SeedAdminFeedDiscussionAsync(title, userId),
            _ => throw new ArgumentOutOfRangeException(nameof(sourceType), sourceType, "Unsupported feed source type")
        };
    }

    private async Task<(int ReviewId, int ReviewerId, int RevieweeId)> SeedAdminReviewAsync(string content)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        var now = DateTime.UtcNow;
        var reviewer = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"review-writer-{suffix}@example.test",
            PasswordHash = "not-used-in-contract-test",
            FirstName = "Review",
            LastName = "Writer",
            Role = "member",
            IsActive = true,
            CreatedAt = now.AddDays(-9)
        };
        var reviewee = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"review-target-{suffix}@example.test",
            PasswordHash = "not-used-in-contract-test",
            FirstName = "Review",
            LastName = "Target",
            Role = "member",
            IsActive = true,
            CreatedAt = now.AddDays(-8)
        };
        db.Users.AddRange(reviewer, reviewee);
        await db.SaveChangesAsync();

        var review = new Review
        {
            TenantId = TestData.Tenant1.Id,
            ReviewerId = reviewer.Id,
            TargetUserId = reviewee.Id,
            Rating = 2,
            Comment = content,
            CreatedAt = now.AddHours(-4)
        };
        db.Reviews.Add(review);
        await db.SaveChangesAsync();
        return (review.Id, reviewer.Id, reviewee.Id);
    }

    private async Task<(string ClientId, string ClientSecret)> RegisterApiPartnerAsync(string scopes)
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/api-partners", new
        {
            name = $"Laravel React Partner {Guid.NewGuid():N}",
            contact_email = "partner-contract@example.test",
            description = "Laravel React frontend contract test partner",
            scopes,
            is_sandbox = false,
            rate_limit_per_minute = 120
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("partner").GetProperty("status").GetString().Should().Be("pending");
        var partnerId = json.GetProperty("id").GetGuid();
        var secret = json.GetProperty("api_key").GetString();
        secret.Should().NotBeNullOrWhiteSpace();
        var activate = await Client.PostAsync($"/api/admin/api-partners/{partnerId}/activate", null);
        activate.StatusCode.Should().Be(HttpStatusCode.OK);
        return (partnerId.ToString(), secret!);
    }

    private static bool HasLaravelBackgroundJobShape(JsonElement job)
    {
        return !string.IsNullOrWhiteSpace(job.GetProperty("name").GetString()) &&
            job.TryGetProperty("last_run_at", out _) &&
            job.TryGetProperty("next_run_at", out _);
    }

    private static bool HasProperty(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out _);

    private async Task SeedShippingOptionAsync(int sellerId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.MarketplaceShippingOptions.Add(new MarketplaceShippingOption
        {
            TenantId = TestData.Tenant1.Id,
            UserId = sellerId,
            Name = "Tracked courier",
            Price = 4.95m,
            Currency = "EUR",
            Region = "domestic",
            IsActive = true
        });
        await db.SaveChangesAsync();
    }

    private static MultipartFormDataContent CreateImageForm()
    {
        var bytes = new byte[1024];
        bytes[0] = 0x89;
        bytes[1] = 0x50;
        bytes[2] = 0x4E;
        bytes[3] = 0x47;

        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(fileContent, "file", "newsletter.png");
        return form;
    }
}
