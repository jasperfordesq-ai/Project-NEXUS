// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerHoursNotificationParityTests : IntegrationTestBase
{
    public VolunteerHoursNotificationParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task NormalApproval_SendsDecisionEmailWithoutGlobalFrequency()
    {
        using var harness = CreateHarness();
        var scenario = await SeedPendingReviewAsync(harness.Db);
        var frequencyKey = FrequencyKey(scenario.Volunteer.Id);

        (await harness.Db.TenantConfigs.IgnoreQueryFilters().CountAsync(config =>
            config.TenantId == TestData.Tenant1.Id && config.Key == frequencyKey)).Should().Be(0);

        var result = await harness.Service.VerifyAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            scenario.Log.Id,
            "approve",
            tenantAdministrator: true);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Status.Should().Be("approved");
        result.Value.PaymentOutcome.Should().Be("no_whole_hours");
        await AssertDecisionBellAsync(harness.Db, scenario, "vol_hours_approved");
        await AssertSingleEmailAsync(
            harness,
            scenario,
            "vol_hours_approved_no_credit");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("off")]
    public async Task NormalDecline_WritesBellButDefaultsImmediateEmailOff(string? frequency)
    {
        using var harness = CreateHarness();
        var scenario = await SeedPendingReviewAsync(harness.Db);
        await SetFrequencyAsync(
            harness.Db,
            scenario.Volunteer.Id,
            currentTenantFrequency: frequency,
            otherTenantFrequency: "instant");

        var result = await harness.Service.VerifyAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            scenario.Log.Id,
            "decline",
            tenantAdministrator: true);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Status.Should().Be("declined");
        await AssertDecisionBellAsync(harness.Db, scenario, "vol_hours_declined");
        await AssertNoEmailAsync(harness, scenario);
    }

    [Fact]
    public async Task NormalDecline_InstantGlobalFrequencyPermitsImmediateEmail()
    {
        using var harness = CreateHarness();
        var scenario = await SeedPendingReviewAsync(harness.Db);
        await SetFrequencyAsync(
            harness.Db,
            scenario.Volunteer.Id,
            currentTenantFrequency: "instant",
            otherTenantFrequency: "off");

        var result = await harness.Service.VerifyAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            scenario.Log.Id,
            "decline",
            tenantAdministrator: true);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Status.Should().Be("declined");
        await AssertDecisionBellAsync(harness.Db, scenario, "vol_hours_declined");
        await AssertSingleEmailAsync(harness, scenario, "vol_hours_declined");
    }

    [Theory]
    [InlineData("approve", "approved")]
    [InlineData("decline", "declined")]
    public async Task ReviewedCaringDecision_EmitsNoDecisionBellPushOrEmail(
        string action,
        string expectedStatus)
    {
        using var harness = CreateHarness(includePush: true);
        var scenario = await SeedPendingReviewAsync(harness.Db, includePushSubscription: true);
        await SetFrequencyAsync(
            harness.Db,
            scenario.Volunteer.Id,
            currentTenantFrequency: "instant",
            otherTenantFrequency: "instant");

        var result = await harness.Service.VerifyCaringAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            scenario.Log.Id,
            action);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Status.Should().Be(expectedStatus);
        (await harness.Db.VolunteerLogs.IgnoreQueryFilters()
            .SingleAsync(log => log.Id == scenario.Log.Id)).Status.Should().Be(expectedStatus);

        (await harness.Db.Notifications.IgnoreQueryFilters()
            .Where(notification => notification.UserId == scenario.Volunteer.Id)
            .ToListAsync()).Should().BeEmpty();
        (await harness.Db.PushNotificationLogs.IgnoreQueryFilters()
            .Where(log => log.UserId == scenario.Volunteer.Id)
            .ToListAsync()).Should().BeEmpty();
        await AssertNoEmailAsync(harness, scenario);
    }

    private Harness CreateHarness(bool includePush = false)
    {
        var scope = Factory.Services.CreateScope();
        var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenantContext.SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transport = new RecordingEmailService();
        var emailNotifications = new EmailNotificationService(
            db,
            transport,
            NullLogger<EmailNotificationService>.Instance);
        var pushNotifications = includePush
            ? new PushNotificationService(
                db,
                tenantContext,
                scope.ServiceProvider.GetRequiredService<IConfiguration>(),
                NullLogger<PushNotificationService>.Instance)
            : null;
        var service = new VolunteerHoursService(
            db,
            new PersonalWalletLedgerService(
                db,
                NullLogger<PersonalWalletLedgerService>.Instance),
            NullLogger<VolunteerHoursService>.Instance,
            pushNotifications,
            gamification: null,
            emailNotifications: emailNotifications);

        return new Harness(scope, db, service, transport);
    }

    private async Task<ReviewScenario> SeedPendingReviewAsync(
        NexusDbContext db,
        bool includePushSubscription = false)
    {
        var marker = Guid.NewGuid().ToString("N");
        var volunteer = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"hours-notification-{marker}@example.test",
            PasswordHash = "not-used",
            FirstName = "Notification",
            LastName = "Volunteer",
            Role = Role.Names.Member,
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active
        };
        db.Users.Add(volunteer);
        await db.SaveChangesAsync();

        var organisation = new VolunteerOrganisation
        {
            TenantId = TestData.Tenant1.Id,
            OwnerUserId = TestData.AdminUser.Id,
            Name = $"Notification parity {marker}",
            Slug = $"notification-parity-{marker}",
            Description = "Focused volunteer-hours notification parity fixture",
            Status = "active",
            CreatedAt = DateTime.UtcNow.AddDays(-2)
        };
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();

        var log = new VolunteerLog
        {
            TenantId = TestData.Tenant1.Id,
            UserId = volunteer.Id,
            OrganizationId = organisation.Id,
            DateLogged = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
            Hours = 0.75m,
            Description = "Notification parity review",
            Status = "pending",
            CreatedAt = DateTime.UtcNow.AddDays(-1),
            UpdatedAt = DateTime.UtcNow.AddDays(-1)
        };
        db.VolunteerLogs.Add(log);
        if (includePushSubscription)
        {
            db.PushSubscriptions.Add(new PushSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = volunteer.Id,
                DeviceToken = $"notification-parity-{marker}",
                Platform = "web",
                IsActive = true
            });
        }

        await db.SaveChangesAsync();
        return new ReviewScenario(volunteer, log);
    }

    private async Task SetFrequencyAsync(
        NexusDbContext db,
        int userId,
        string? currentTenantFrequency,
        string otherTenantFrequency)
    {
        var key = FrequencyKey(userId);
        if (currentTenantFrequency is not null)
        {
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = key,
                Value = currentTenantFrequency,
                CreatedAt = DateTime.UtcNow
            });
        }

        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = TestData.Tenant2.Id,
            Key = key,
            Value = otherTenantFrequency,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private static async Task AssertDecisionBellAsync(
        NexusDbContext db,
        ReviewScenario scenario,
        string expectedType)
    {
        var notifications = await db.Notifications.IgnoreQueryFilters()
            .Where(notification => notification.UserId == scenario.Volunteer.Id)
            .ToListAsync();
        var notification = notifications.Should().ContainSingle().Which;
        notification.TenantId.Should().Be(scenario.Volunteer.TenantId);
        notification.Type.Should().Be(expectedType);
        notification.Data.Should().Contain($"\"vol_log_id\":{scenario.Log.Id}");
    }

    private static async Task AssertSingleEmailAsync(
        Harness harness,
        ReviewScenario scenario,
        string expectedTemplateKey)
    {
        var message = harness.Transport.Messages.Should().ContainSingle().Which;
        message.To.Should().Be(scenario.Volunteer.Email);

        var logs = await harness.Db.EmailLogs.IgnoreQueryFilters()
            .Where(log => log.UserId == scenario.Volunteer.Id)
            .ToListAsync();
        var emailLog = logs.Should().ContainSingle().Which;
        emailLog.TenantId.Should().Be(scenario.Volunteer.TenantId);
        emailLog.ToEmail.Should().Be(scenario.Volunteer.Email);
        emailLog.TemplateKey.Should().Be(expectedTemplateKey);
        emailLog.Status.Should().Be(EmailSendStatus.Sent);
    }

    private static async Task AssertNoEmailAsync(Harness harness, ReviewScenario scenario)
    {
        harness.Transport.Messages.Should().BeEmpty();
        (await harness.Db.EmailLogs.IgnoreQueryFilters()
            .Where(log => log.UserId == scenario.Volunteer.Id)
            .ToListAsync()).Should().BeEmpty();
    }

    private static string FrequencyKey(int userId) =>
        $"notification_settings.{userId}.global.0";

    private sealed class Harness : IDisposable
    {
        private readonly IServiceScope _scope;

        public Harness(
            IServiceScope scope,
            NexusDbContext db,
            VolunteerHoursService service,
            RecordingEmailService transport)
        {
            _scope = scope;
            Db = db;
            Service = service;
            Transport = transport;
        }

        public NexusDbContext Db { get; }
        public VolunteerHoursService Service { get; }
        public RecordingEmailService Transport { get; }

        public void Dispose() => _scope.Dispose();
    }

    private sealed record ReviewScenario(User Volunteer, VolunteerLog Log);

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
