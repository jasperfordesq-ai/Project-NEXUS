// Copyright © 2024–2026 Jasper Ford
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
public class JobsAdminControllerTests : IntegrationTestBase
{
    public JobsAdminControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListAll_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/jobs");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListAll_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/jobs");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ListAll_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/jobs");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetStats_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/jobs/stats");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task V2ListAll_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var r = await Client.GetAsync("/api/v2/admin/jobs?page=1&limit=10");

        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task V2Stats_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var r = await Client.GetAsync("/api/v2/admin/jobs/stats");

        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task V2JobApplications_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();

        var r = await Client.GetAsync("/api/v2/admin/jobs/99999/applications");

        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task V2UpdateApplication_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();

        var r = await Client.PutAsJsonAsync("/api/v2/admin/jobs/applications/99999", new
        {
            status = "accepted",
            notes = "Laravel React compatibility test"
        });

        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task V2DeleteJob_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();

        var r = await Client.DeleteAsync("/api/v2/admin/jobs/99999");

        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task V2ShowJob_ReturnsSeededJobData()
    {
        var jobId = await SeedJobAsync("Laravel React detail alias");
        await AuthenticateAsAdminAsync();

        var r = await Client.GetAsync($"/api/v2/admin/jobs/{jobId}");

        r.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().Be(jobId);
        data.GetProperty("title").GetString().Should().Be("Laravel React detail alias");
    }

    [Fact]
    public async Task V2FeatureAndUnfeatureJob_TogglesSeededJob()
    {
        var jobId = await SeedJobAsync("Laravel React feature alias");
        await AuthenticateAsAdminAsync();

        var feature = await Client.PostAsJsonAsync($"/api/v2/admin/jobs/{jobId}/feature", new { duration_days = 14 });

        feature.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var job = await db.JobVacancies.IgnoreQueryFilters().SingleAsync(j => j.Id == jobId);
            job.IsFeatured.Should().BeTrue();
            job.FeaturedUntil.Should().NotBeNull();
        }

        var unfeature = await Client.PostAsJsonAsync($"/api/v2/admin/jobs/{jobId}/unfeature", new { });

        unfeature.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var job = await db.JobVacancies.IgnoreQueryFilters().SingleAsync(j => j.Id == jobId);
            job.IsFeatured.Should().BeFalse();
            job.FeaturedUntil.Should().BeNull();
        }
    }

    [Fact]
    public async Task V2ApplicationsAndStatusUpdate_UseSeededApplication()
    {
        var (jobId, applicationId) = await SeedJobWithApplicationAsync();
        await AuthenticateAsAdminAsync();

        var applications = await Client.GetAsync($"/api/v2/admin/jobs/{jobId}/applications");

        applications.StatusCode.Should().Be(HttpStatusCode.OK);
        var applicationsJson = await applications.Content.ReadFromJsonAsync<JsonElement>();
        applicationsJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == applicationId);

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/jobs/applications/{applicationId}", new
        {
            status = "accepted",
            notes = "Accepted through Laravel React alias"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("data").GetProperty("status").GetString().Should().Be("accepted");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var app = await db.JobApplications.IgnoreQueryFilters().SingleAsync(a => a.Id == applicationId);
        app.Status.Should().Be("accepted");
        app.ReviewNotes.Should().Be("Accepted through Laravel React alias");
    }

    [Fact]
    public async Task V2DeleteJob_RemovesSeededJob()
    {
        var jobId = await SeedJobAsync("Laravel React delete alias");
        await AuthenticateAsAdminAsync();

        var r = await Client.DeleteAsync($"/api/v2/admin/jobs/{jobId}");

        r.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.JobVacancies.IgnoreQueryFilters().AnyAsync(j => j.Id == jobId)).Should().BeFalse();
    }

    [Fact]
    public async Task V2JobsReadSideEndpoints_ReturnSeededBackendData()
    {
        var seeded = await SeedJobsReadSideDataAsync();
        await AuthenticateAsAdminAsync();

        var moderationQueue = await Client.GetAsync("/api/v2/admin/jobs/moderation-queue");
        moderationQueue.StatusCode.Should().Be(HttpStatusCode.OK);
        var moderationJson = await moderationQueue.Content.ReadFromJsonAsync<JsonElement>();
        moderationJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        moderationJson.GetProperty("data").GetProperty("items").EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == seeded.JobId);

        var moderationStats = await Client.GetAsync("/api/v2/admin/jobs/moderation-stats");
        moderationStats.StatusCode.Should().Be(HttpStatusCode.OK);
        var moderationStatsJson = await moderationStats.Content.ReadFromJsonAsync<JsonElement>();
        moderationStatsJson.GetProperty("data").GetProperty("pending_jobs").GetInt32().Should().BeGreaterThan(0);

        var spamStats = await Client.GetAsync("/api/v2/admin/jobs/spam-stats");
        spamStats.StatusCode.Should().Be(HttpStatusCode.OK);
        var spamStatsJson = await spamStats.Content.ReadFromJsonAsync<JsonElement>();
        spamStatsJson.GetProperty("data").GetProperty("flagged_jobs").GetInt32().Should().BeGreaterThan(0);

        var interviews = await Client.GetAsync("/api/v2/admin/jobs/interviews");
        interviews.StatusCode.Should().Be(HttpStatusCode.OK);
        var interviewsJson = await interviews.Content.ReadFromJsonAsync<JsonElement>();
        interviewsJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == seeded.InterviewId);

        var offers = await Client.GetAsync("/api/v2/admin/jobs/offers");
        offers.StatusCode.Should().Be(HttpStatusCode.OK);
        var offersJson = await offers.Content.ReadFromJsonAsync<JsonElement>();
        offersJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == seeded.OfferId);

        var templates = await Client.GetAsync("/api/v2/admin/jobs/templates");
        templates.StatusCode.Should().Be(HttpStatusCode.OK);
        var templatesJson = await templates.Content.ReadFromJsonAsync<JsonElement>();
        templatesJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("id").GetInt32() == seeded.TemplateId);
    }

    [Fact]
    public async Task V2ModerationActions_UpdateSeededJobStatuses()
    {
        var approveId = await SeedJobAsync("Laravel React approve alias", status: "draft");
        var rejectId = await SeedJobAsync("Laravel React reject alias", status: "draft");
        var flagId = await SeedJobAsync("Laravel React flag alias", status: "active");
        await AuthenticateAsAdminAsync();

        var approve = await Client.PostAsJsonAsync($"/api/v2/admin/jobs/{approveId}/approve", new
        {
            notes = "Approved through Laravel React alias"
        });
        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        var approveJson = await approve.Content.ReadFromJsonAsync<JsonElement>();
        approveJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        approveJson.GetProperty("data").GetProperty("approved").GetBoolean().Should().BeTrue();

        var reject = await Client.PostAsJsonAsync($"/api/v2/admin/jobs/{rejectId}/reject", new
        {
            reason = "Insufficient detail"
        });
        reject.StatusCode.Should().Be(HttpStatusCode.OK);
        var rejectJson = await reject.Content.ReadFromJsonAsync<JsonElement>();
        rejectJson.GetProperty("data").GetProperty("rejected").GetBoolean().Should().BeTrue();

        var flag = await Client.PostAsJsonAsync($"/api/v2/admin/jobs/{flagId}/flag", new
        {
            reason = "Possible spam"
        });
        flag.StatusCode.Should().Be(HttpStatusCode.OK);
        var flagJson = await flag.Content.ReadFromJsonAsync<JsonElement>();
        flagJson.GetProperty("data").GetProperty("flagged").GetBoolean().Should().BeTrue();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.JobVacancies.IgnoreQueryFilters().SingleAsync(j => j.Id == approveId)).Status.Should().Be("active");
        (await db.JobVacancies.IgnoreQueryFilters().SingleAsync(j => j.Id == rejectId)).Status.Should().Be("rejected");
        (await db.JobVacancies.IgnoreQueryFilters().SingleAsync(j => j.Id == flagId)).Status.Should().Be("flagged");
    }

    [Fact]
    public async Task UpdateStatus_NonExistent_ReturnsNotFoundOrBadRequest()
    {
        await AuthenticateAsAdminAsync();
        // Valid statuses are: draft, active, filled, expired, cancelled
        var r = await Client.PutAsJsonAsync("/api/admin/jobs/99999/status", new { status = "expired" });
        // May return BadRequest if validation fails before lookup, or NotFound for non-existent job
        r.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    private async Task<int> SeedJobAsync(string title, string status = "active")
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = title,
            Description = "Seeded for Laravel React admin jobs compatibility.",
            Category = "operations",
            JobType = "volunteer",
            Status = status,
            ContactEmail = TestData.AdminUser.Email,
            CreatedAt = DateTime.UtcNow
        };
        db.JobVacancies.Add(job);
        await db.SaveChangesAsync();
        return job.Id;
    }

    private async Task<(int JobId, int ApplicationId)> SeedJobWithApplicationAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = "Laravel React applications alias",
            Description = "Seeded for application compatibility.",
            Category = "operations",
            JobType = "volunteer",
            Status = "active",
            ContactEmail = TestData.AdminUser.Email,
            CreatedAt = DateTime.UtcNow,
            ApplicationCount = 1
        };
        db.JobVacancies.Add(job);
        await db.SaveChangesAsync();

        var application = new JobApplication
        {
            TenantId = TestData.Tenant1.Id,
            JobId = job.Id,
            ApplicantUserId = TestData.MemberUser.Id,
            CoverLetter = "I can help.",
            Status = "pending",
            CreatedAt = DateTime.UtcNow
        };
        db.JobApplications.Add(application);
        await db.SaveChangesAsync();
        return (job.Id, application.Id);
    }

    private async Task<(int JobId, int ApplicationId, int InterviewId, int OfferId, int TemplateId)> SeedJobsReadSideDataAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var job = new JobVacancy
        {
            TenantId = TestData.Tenant1.Id,
            PostedByUserId = TestData.AdminUser.Id,
            Title = "Laravel React moderation queue alias",
            Description = "Seeded for jobs read-side compatibility.",
            Category = "operations",
            JobType = "volunteer",
            Status = "draft",
            ContactEmail = TestData.AdminUser.Email,
            CreatedAt = DateTime.UtcNow
        };
        db.JobVacancies.Add(job);
        await db.SaveChangesAsync();

        var application = new JobApplication
        {
            TenantId = TestData.Tenant1.Id,
            JobId = job.Id,
            ApplicantUserId = TestData.MemberUser.Id,
            CoverLetter = "I can interview.",
            Status = "pending",
            CreatedAt = DateTime.UtcNow
        };
        db.JobApplications.Add(application);
        await db.SaveChangesAsync();

        var interview = new JobInterview
        {
            TenantId = TestData.Tenant1.Id,
            JobId = job.Id,
            ApplicationId = application.Id,
            CandidateUserId = TestData.MemberUser.Id,
            CreatedByUserId = TestData.AdminUser.Id,
            StartsAt = DateTime.UtcNow.AddDays(2),
            EndsAt = DateTime.UtcNow.AddDays(2).AddHours(1),
            Location = "video",
            Status = "proposed",
            Notes = "Compatibility interview"
        };
        var offer = new JobOffer
        {
            TenantId = TestData.Tenant1.Id,
            JobId = job.Id,
            ApplicationId = application.Id,
            CandidateUserId = TestData.MemberUser.Id,
            CreatedByUserId = TestData.AdminUser.Id,
            Title = "Compatibility offer",
            Message = "Welcome aboard",
            Status = "pending"
        };
        var template = new JobTemplate
        {
            TenantId = TestData.Tenant1.Id,
            CreatedByUserId = TestData.AdminUser.Id,
            Title = "Compatibility job template",
            Description = "Template visible to Laravel React",
            Category = "operations",
            JobType = "volunteer",
            RequiredSkills = "coordination",
            IsPublic = true
        };

        db.JobInterviews.Add(interview);
        db.JobOffers.Add(offer);
        db.JobTemplates.Add(template);
        await db.SaveChangesAsync();

        return (job.Id, application.Id, interview.Id, offer.Id, template.Id);
    }
}
