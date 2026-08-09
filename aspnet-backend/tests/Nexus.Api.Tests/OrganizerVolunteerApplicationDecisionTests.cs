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
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class OrganizerVolunteerApplicationDecisionTests : IntegrationTestBase
{
    public OrganizerVolunteerApplicationDecisionTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Theory]
    [InlineData("/api/v2", "approve", "approved", "vol_application_approved", "Application Approved")]
    [InlineData("/api", "decline", "declined", "vol_application_declined", "Application Declined")]
    public async Task CanonicalPut_CommitsDecisionAndUsesOrganizerNotificationPolicy(
        string prefix,
        string action,
        string expectedStatus,
        string expectedType,
        string expectedTitle)
    {
        var scenario = await CreateApplicationAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            $"{prefix}/volunteering/applications/{scenario.ApplicationId}",
            new { action, org_note = "Thanks for applying" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        body.GetProperty("data").GetProperty("id").GetInt32().Should().Be(scenario.ApplicationId);
        body.GetProperty("data").GetProperty("status").GetString().Should().Be(expectedStatus);
        body.GetProperty("data").GetProperty("org_note").GetString().Should().Be("Thanks for applying");
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var application = await db.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.ApplicationId);
        application.Status.ToString().ToLowerInvariant().Should().Be(expectedStatus);
        application.OrgNote.Should().Be("Thanks for applying");
        application.ReviewedById.Should().Be(TestData.AdminUser.Id);
        application.ReviewedAt.Should().NotBeNull();

        var notification = await db.Notifications.IgnoreQueryFilters()
            .SingleAsync(row => row.UserId == scenario.ApplicantId && row.Type == expectedType);
        notification.Title.Should().Be(expectedTitle);
        notification.Body.Should().Be(action == "approve"
            ? $"Your volunteer application for \"{scenario.OpportunityTitle}\" was accepted!"
            : $"Your volunteer application for \"{scenario.OpportunityTitle}\" was not accepted");
        notification.Link.Should().Be($"/volunteering/opportunities/{scenario.OpportunityId}");
        notification.Data.Should().Contain($"/volunteering/opportunities/{scenario.OpportunityId}");

        (await db.Set<EmailLog>().IgnoreQueryFilters()
            .CountAsync(row => row.UserId == scenario.ApplicantId && row.TemplateKey == expectedType))
            .Should().Be(1);

        var applicantToken = await GetAccessTokenAsync(scenario.ApplicantEmail, "test-tenant");
        SetAuthToken(applicantToken);
        var notificationsResponse = await Client.GetAsync("/api/v2/notifications");
        notificationsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var notificationWire = (await ReadJsonAsync(notificationsResponse))
            .GetProperty("data")
            .EnumerateArray()
            .Single(item => item.GetProperty("type").GetString() == expectedType);
        notificationWire.GetProperty("title").GetString().Should().Be(expectedTitle);
        notificationWire.GetProperty("link").GetString()
            .Should().Be($"/volunteering/opportunities/{scenario.OpportunityId}");
        notificationWire.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Object);
        notificationWire.GetProperty("data").GetProperty("application_id").GetInt32()
            .Should().Be(scenario.ApplicationId);
    }

    [Fact]
    public async Task CanonicalPut_AllowsTenantAdminWhoIsNotOpportunityOrganizer()
    {
        var scenario = await CreateApplicationAsync(organizerId: TestData.MemberUser.Id);
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "approve" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.ApplicationId))
            .ReviewedById.Should().Be(TestData.AdminUser.Id);
    }

    [Fact]
    public async Task CanonicalPut_UnmappedOpportunityIsNotFoundEvenForSiteAdmin()
    {
        int applicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity($"Unmapped decision {Guid.NewGuid():N}");
            var applicant = NewUser("unmapped-decision-applicant");
            db.AddRange(opportunity, applicant);
            await db.SaveChangesAsync();
            var application = NewApplication(opportunity, applicant.Id, shiftId: null);
            db.VolunteerApplications.Add(application);
            await db.SaveChangesAsync();
            applicationId = application.Id;
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{applicationId}",
            new { action = "approve" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadJsonAsync(response)).GetProperty("errors")[0]
            .GetProperty("code").GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task CanonicalPut_OpportunityCreatorWithoutOrganisationGrantIsForbidden()
    {
        int applicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisation = new VolunteerOrganisation
            {
                TenantId = TestData.Tenant1.Id,
                OwnerUserId = TestData.AdminUser.Id,
                Name = $"Creator Exclusion Hub {Guid.NewGuid():N}",
                Slug = $"creator-exclusion-{Guid.NewGuid():N}",
                Description = "Organisation decision creator exclusion fixture.",
                ContactEmail = "creator-exclusion@example.test",
                Status = "active",
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();

            var opportunity = NewOpportunity(
                $"Creator-only decision {Guid.NewGuid():N}",
                TestData.MemberUser.Id);
            opportunity.VolunteerOrganisationId = organisation.Id;
            var applicant = NewUser("creator-only-applicant");
            db.AddRange(opportunity, applicant);
            await db.SaveChangesAsync();
            var application = NewApplication(opportunity, applicant.Id, shiftId: null);
            db.VolunteerApplications.Add(application);
            await db.SaveChangesAsync();
            applicationId = application.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{applicationId}",
            new { action = "approve" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var verifyScope = Factory.Services.CreateScope();
        (await verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == applicationId))
            .Status.Should().Be(ApplicationStatus.Pending);
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("admin")]
    public async Task CanonicalPut_AllowsActiveOrganisationOwnerOrAdminMembership(string role)
    {
        int applicationId;
        string managerEmail;
        int managerId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var manager = NewUser($"organisation-{role}");
            var applicant = NewUser($"organisation-{role}-applicant");
            db.Users.AddRange(manager, applicant);
            await db.SaveChangesAsync();
            managerEmail = manager.Email;
            managerId = manager.Id;

            var organisation = new VolunteerOrganisation
            {
                TenantId = TestData.Tenant1.Id,
                OwnerUserId = TestData.AdminUser.Id,
                Name = $"Membership Decision Hub {Guid.NewGuid():N}",
                Slug = $"membership-decision-{Guid.NewGuid():N}",
                Description = "Organisation membership decision fixture.",
                ContactEmail = "membership-decision@example.test",
                Status = "suspended",
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();
            db.VolunteerOrganisationMembers.Add(new VolunteerOrganisationMember
            {
                TenantId = TestData.Tenant1.Id,
                VolunteerOrganisationId = organisation.Id,
                UserId = manager.Id,
                Role = role,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            });

            var opportunity = NewOpportunity(
                $"Membership decision {Guid.NewGuid():N}",
                TestData.AdminUser.Id);
            opportunity.VolunteerOrganisationId = organisation.Id;
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            var application = NewApplication(opportunity, applicant.Id, shiftId: null);
            db.VolunteerApplications.Add(application);
            await db.SaveChangesAsync();
            applicationId = application.Id;
        }

        SetAuthToken(await GetAccessTokenAsync(managerEmail, "test-tenant"));
        var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{applicationId}",
            new { action = "approve" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var verifyScope = Factory.Services.CreateScope();
        var stored = await verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == applicationId);
        stored.Status.Should().Be(ApplicationStatus.Approved);
        stored.ReviewedById.Should().Be(managerId);
    }

    [Fact]
    public async Task CanonicalPut_DeclineNoteDefaultsToOptionalWhenConfigIsAbsent()
    {
        var scenario = await CreateApplicationAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "decline" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(response)).GetProperty("data").GetProperty("org_note").ValueKind
            .Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task CanonicalPut_ValidatesConfiguredDeclineNoteAndPersistsValidValue()
    {
        var scenario = await CreateApplicationAsync();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = AdminVolunteerApprovalService.RequireOrgNoteOnDeclineConfigKey,
                Value = "true",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var missing = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "decline" });
        missing.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var missingError = (await ReadJsonAsync(missing)).GetProperty("errors")[0];
        missingError.GetProperty("message").GetString().Should().Be("Missing required field: org_note");
        missingError.GetProperty("field").GetString().Should().Be("org_note");

        var oversized = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "decline", org_note = new string('x', 2001) });
        oversized.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(oversized)).GetProperty("errors")[0].GetProperty("field").GetString()
            .Should().Be("org_note");

        var accepted = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "decline", org_note = "  Please try another opportunity  " });
        accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(accepted)).GetProperty("data").GetProperty("org_note").GetString()
            .Should().Be("Please try another opportunity");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.ApplicationId))
            .OrgNote.Should().Be("Please try another opportunity");
    }

    [Theory]
    [InlineData("volunteer_application_approved", "Your volunteer application was approved", "has been approved")]
    [InlineData("vol_application_approved", "Your volunteer application was approved", "has been approved")]
    [InlineData("vol_application_declined", "Update on your volunteer application", "was not accepted")]
    public async Task VolunteerEmailFallback_UsesMeaningfulEscapedTenantContent(
        string templateKey,
        string expectedSubject,
        string expectedPhrase)
    {
        using var scope = Factory.Services.CreateScope();
        var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
        if (!tenantContext.IsResolved)
        {
            tenantContext.SetTenant(TestData.Tenant1.Id);
        }

        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transport = new RecordingEmailService();
        var service = new EmailNotificationService(
            db,
            transport,
            NullLogger<EmailNotificationService>.Instance);

        var sent = await service.SendTemplatedEmailAsync(
            TestData.MemberUser.Id,
            templateKey,
            new Dictionary<string, string>
            {
                ["user_name"] = WebUtility.HtmlEncode("Member <Admin>"),
                ["opportunity_title"] = WebUtility.HtmlEncode("<script>alert('x')</script>"),
                ["volunteering_url"] = "/volunteering/opportunities/99",
                ["org_note"] = WebUtility.HtmlEncode("<b>Try another role</b>")
            });

        sent.Should().BeTrue();
        transport.Messages.Should().ContainSingle();
        var message = transport.Messages[0];
        message.Subject.Should().Be(expectedSubject);
        message.HtmlBody.Should().Contain(expectedPhrase);
        message.HtmlBody.Should().Contain("&lt;script&gt;").And.NotContain("<script>");
        message.HtmlBody.Should().Contain("https://app.project-nexus.ie/test-tenant/volunteering/opportunities/99");
        if (templateKey == "vol_application_declined")
        {
            message.HtmlBody.Should().Contain("&lt;b&gt;Try another role&lt;/b&gt;");
        }
    }

    [Fact]
    public async Task VolunteerWaitlistEmailFallback_UsesMeaningfulEscapedTenantContent()
    {
        using var scope = Factory.Services.CreateScope();
        var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
        if (!tenantContext.IsResolved)
        {
            tenantContext.SetTenant(TestData.Tenant1.Id);
        }

        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transport = new RecordingEmailService();
        var service = new EmailNotificationService(
            db,
            transport,
            NullLogger<EmailNotificationService>.Instance);

        var sent = await service.SendTemplatedEmailAsync(
            TestData.MemberUser.Id,
            "vol_waitlist_spot",
            new Dictionary<string, string>
            {
                ["user_name"] = WebUtility.HtmlEncode("Member <Admin>"),
                ["volunteering_url"] = "/volunteering?tab=waitlist"
            });

        sent.Should().BeTrue();
        transport.Messages.Should().ContainSingle();
        var message = transport.Messages[0];
        message.Subject.Should().Be("Volunteer shift spot available");
        message.HtmlBody.Should().Contain("A place has opened on a volunteer shift");
        message.HtmlBody.Should().Contain("Member &lt;Admin&gt;").And.NotContain("Member <Admin>");
        message.HtmlBody.Should().Contain("https://app.project-nexus.ie/test-tenant/volunteering?tab=waitlist");
    }

    [Fact]
    public async Task CanonicalPut_RejectsInvalidActionBeforeLookup()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            "/api/v2/volunteering/applications/2147483000",
            new { action = "accept" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = (await ReadJsonAsync(response)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be("Action must be approve or decline");
        error.GetProperty("field").GetString().Should().Be("action");
    }

    [Fact]
    public async Task CanonicalPut_RejectsNonOrganizerWithoutChangingApplication()
    {
        var scenario = await CreateApplicationAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "approve" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = (await ReadJsonAsync(response)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("FORBIDDEN");
        error.GetProperty("message").GetString()
            .Should().Be("You do not have permission to manage this opportunity");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.ApplicationId))
            .Status.Should().Be(ApplicationStatus.Pending);
    }

    [Fact]
    public async Task CanonicalPut_RetryReturnsConflictWithoutDuplicateSideEffects()
    {
        var scenario = await CreateApplicationAsync();
        await AuthenticateAsAdminAsync();

        (await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "approve" })).StatusCode.Should().Be(HttpStatusCode.OK);

        var retry = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/applications/{scenario.ApplicationId}",
            new { action = "decline" });

        retry.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var error = (await ReadJsonAsync(retry)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("ALREADY_EXISTS");
        error.GetProperty("message").GetString().Should().Be("This application has already been decided");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Notifications.IgnoreQueryFilters()
            .CountAsync(row => row.UserId == scenario.ApplicantId
                && (row.Type == "vol_application_approved" || row.Type == "vol_application_declined")))
            .Should().Be(1);
        (await db.Set<EmailLog>().IgnoreQueryFilters()
            .CountAsync(row => row.UserId == scenario.ApplicantId
                && (row.TemplateKey == "vol_application_approved" || row.TemplateKey == "vol_application_declined")))
            .Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentOrganizerApprovalsForLastPlace_HaveOneWinner()
    {
        int firstApplicationId;
        int secondApplicationId;
        int firstApplicantId;
        int secondApplicantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisation = NewOrganisation(TestData.AdminUser.Id, "Organizer final place");
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();
            var opportunity = NewOpportunity("Organizer final place");
            opportunity.VolunteerOrganisationId = organisation.Id;
            var firstApplicant = NewUser("organizer-final-one");
            var secondApplicant = NewUser("organizer-final-two");
            db.AddRange(opportunity, firstApplicant, secondApplicant);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var first = NewApplication(opportunity, firstApplicant.Id, shift.Id);
            var second = NewApplication(opportunity, secondApplicant.Id, shift.Id);
            db.AddRange(first, second);
            await db.SaveChangesAsync();
            firstApplicationId = first.Id;
            secondApplicationId = second.Id;
            firstApplicantId = firstApplicant.Id;
            secondApplicantId = secondApplicant.Id;
        }

        await AuthenticateAsAdminAsync();
        var responses = await Task.WhenAll(
            Client.PutAsJsonAsync(
                $"/api/v2/volunteering/applications/{firstApplicationId}",
                new { action = "approve" }),
            Client.PutAsJsonAsync(
                $"/api/v2/volunteering/applications/{secondApplicationId}",
                new { action = "approve" }));

        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity });
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
        var error = (await ReadJsonAsync(loser)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be("This shift is at capacity");
        error.GetProperty("field").GetString().Should().Be("shift_id");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync(row =>
            (row.Id == firstApplicationId || row.Id == secondApplicationId)
            && row.Status == ApplicationStatus.Approved)).Should().Be(1);
        (await verifyDb.Notifications.IgnoreQueryFilters().CountAsync(row =>
            (row.UserId == firstApplicantId || row.UserId == secondApplicantId)
            && row.Type == "vol_application_approved")).Should().Be(1);
        (await verifyDb.Set<EmailLog>().IgnoreQueryFilters().CountAsync(row =>
            (row.UserId == firstApplicantId || row.UserId == secondApplicantId)
            && row.TemplateKey == "vol_application_approved")).Should().Be(1);
    }

    private async Task<ApplicationScenario> CreateApplicationAsync(
        int? applicantId = null,
        int? organizerId = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var resolvedOrganizerId = organizerId ?? TestData.AdminUser.Id;
        var organisation = NewOrganisation(
            resolvedOrganizerId,
            $"Organizer decision {Guid.NewGuid():N}");
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();
        var opportunity = NewOpportunity(
            $"Organizer decision {Guid.NewGuid():N}",
            resolvedOrganizerId);
        opportunity.VolunteerOrganisationId = organisation.Id;
        db.VolunteerOpportunities.Add(opportunity);

        User? applicant = null;
        if (!applicantId.HasValue)
        {
            applicant = NewUser("organizer-applicant");
            db.Users.Add(applicant);
        }

        await db.SaveChangesAsync();
        var resolvedApplicantId = applicantId ?? applicant!.Id;
        var applicantEmail = applicant?.Email
            ?? await db.Users.IgnoreQueryFilters()
                .Where(user => user.Id == resolvedApplicantId && user.TenantId == TestData.Tenant1.Id)
                .Select(user => user.Email)
                .SingleAsync();
        var application = NewApplication(
            opportunity,
            resolvedApplicantId,
            shiftId: null);
        db.VolunteerApplications.Add(application);
        await db.SaveChangesAsync();
        return new ApplicationScenario(
            application.Id,
            application.UserId,
            applicantEmail,
            opportunity.Id,
            opportunity.Title);
    }

    private VolunteerOpportunity NewOpportunity(string title, int? organizerId = null) => new()
    {
        TenantId = TestData.Tenant1.Id,
        OrganizerId = organizerId ?? TestData.AdminUser.Id,
        Title = title,
        Description = "Organizer decision contract test",
        Status = OpportunityStatus.Published,
        RequiredVolunteers = 2,
        CreatedAt = DateTime.UtcNow
    };

    private VolunteerOrganisation NewOrganisation(int ownerId, string name) => new()
    {
        TenantId = TestData.Tenant1.Id,
        OwnerUserId = ownerId,
        Name = name,
        Slug = $"organizer-decision-{Guid.NewGuid():N}",
        Description = "Organizer decision contract organisation fixture.",
        ContactEmail = "organizer-decision@example.test",
        Status = "active",
        CreatedAt = DateTime.UtcNow
    };

    private static VolunteerShift NewShift(VolunteerOpportunity opportunity, int maxVolunteers) => new()
    {
        TenantId = opportunity.TenantId,
        OpportunityId = opportunity.Id,
        Title = "Organizer decision shift",
        StartsAt = DateTime.UtcNow.AddDays(2),
        EndsAt = DateTime.UtcNow.AddDays(2).AddHours(2),
        MaxVolunteers = maxVolunteers,
        Status = ShiftStatus.Scheduled,
        CreatedAt = DateTime.UtcNow
    };

    private static VolunteerApplication NewApplication(
        VolunteerOpportunity opportunity,
        int applicantId,
        int? shiftId) => new()
    {
        TenantId = opportunity.TenantId,
        OpportunityId = opportunity.Id,
        UserId = applicantId,
        ShiftId = shiftId,
        Status = ApplicationStatus.Pending,
        Message = "I would like to help",
        CreatedAt = DateTime.UtcNow
    };

    private User NewUser(string prefix) => new()
    {
        TenantId = TestData.Tenant1.Id,
        Email = $"{prefix}-{Guid.NewGuid():N}@test.local",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
        FirstName = "Organizer",
        LastName = "Applicant",
        Role = "member",
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

    private sealed record ApplicationScenario(
        int ApplicationId,
        int ApplicantId,
        string ApplicantEmail,
        int OpportunityId,
        string OpportunityTitle);

    private sealed class RecordingEmailService : IEmailService
    {
        public List<RecordedEmail> Messages { get; } = [];

        public Task<bool> SendEmailAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken ct = default)
        {
            Messages.Add(new RecordedEmail(to, subject, htmlBody));
            return Task.FromResult(true);
        }

        public Task<bool> SendPasswordResetEmailAsync(
            string to,
            string resetToken,
            string userName,
            string resetUrl,
            CancellationToken ct = default) => Task.FromResult(true);

        public Task<bool> SendWelcomeEmailAsync(
            string to,
            string userName,
            string tenantName,
            CancellationToken ct = default) => Task.FromResult(true);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(true);
    }

    private sealed record RecordedEmail(string To, string Subject, string HtmlBody);
}
