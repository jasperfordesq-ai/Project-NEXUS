// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class VolunteerHoursDecisionEmailTests
{
    public static TheoryData<string, string?, decimal, string, string, string> DecisionCases => new()
    {
        {
            "approved",
            "paid",
            2.75m,
            "vol_hours_approved_paid",
            "2</strong> time credits added to your wallet",
            "https://volunteers.example.test/wallet"
        },
        {
            "approved",
            "no_whole_hours",
            0.75m,
            "vol_hours_approved_no_credit",
            "no time credit was added to your wallet",
            "https://volunteers.example.test/volunteering?tab=hours"
        },
        {
            "approved",
            "no_payable_hours",
            0.25m,
            "vol_hours_approved_no_credit",
            "no time credit was added to your wallet",
            "https://volunteers.example.test/volunteering?tab=hours"
        },
        {
            "approved",
            null,
            1.5m,
            "vol_hours_approved",
            "Thank you for your valuable contribution",
            "https://volunteers.example.test/volunteering?tab=hours"
        },
        {
            "declined",
            null,
            1.5m,
            "vol_hours_declined",
            "was not approved",
            "https://volunteers.example.test/volunteering?tab=hours"
        }
    };

    [Theory]
    [MemberData(nameof(DecisionCases))]
    public async Task DecisionEmail_UsesHonestFallbackAndImmediateTenantScopedDelivery(
        string decision,
        string? paymentOutcome,
        decimal hours,
        string expectedTemplateKey,
        string expectedWording,
        string expectedUrl)
    {
        var tenantContext = CreateTenantContext(71);
        await using var db = CreateDbContext(tenantContext);
        await SeedRecipientAsync(db);
        var transport = new RecordingEmailService();
        var service = new EmailNotificationService(
            db,
            transport,
            NullLogger<EmailNotificationService>.Instance);

        var sent = await service.SendVolunteerHoursDecisionEmailAsync(
            701,
            71,
            decision,
            hours,
            "Community <Crew>",
            paymentOutcome);

        sent.Should().BeTrue();
        transport.Messages.Should().ContainSingle();
        var message = transport.Messages.Single();
        message.To.Should().Be("volunteer@example.test");
        message.HtmlBody.Should().Contain(expectedWording);
        message.HtmlBody.Should().Contain(expectedUrl);
        message.HtmlBody.Should().Contain("Community &lt;Crew&gt;")
            .And.NotContain("Community <Crew>");

        var log = await db.EmailLogs.SingleAsync();
        log.TenantId.Should().Be(71);
        log.UserId.Should().Be(701);
        log.TemplateKey.Should().Be(expectedTemplateKey);
        log.Status.Should().Be(EmailSendStatus.Sent);
    }

    [Fact]
    public async Task DecisionEmail_UsesActiveTenantTemplateBeforeFallback()
    {
        var tenantContext = CreateTenantContext(71);
        await using var db = CreateDbContext(tenantContext);
        await SeedRecipientAsync(db);
        db.EmailTemplates.Add(new EmailTemplate
        {
            TenantId = 71,
            Key = "vol_hours_approved_no_credit",
            Subject = "Reviewed {{hours}} hours",
            BodyHtml = "<p>{{user_name}}|{{organization_name}}|{{credited_hours}}|{{action_url}}</p>",
            IsActive = true
        });
        await db.SaveChangesAsync();
        var transport = new RecordingEmailService();
        var service = new EmailNotificationService(
            db,
            transport,
            NullLogger<EmailNotificationService>.Instance);

        var sent = await service.SendVolunteerHoursDecisionEmailAsync(
            701,
            71,
            "approved",
            0.75m,
            "Org & Co",
            "no_whole_hours");

        sent.Should().BeTrue();
        var message = transport.Messages.Should().ContainSingle().Which;
        message.Subject.Should().Be("Reviewed 0.75 hours");
        message.HtmlBody.Should().Be(
            "<p>Ada|Org &amp; Co|0|https://volunteers.example.test/volunteering?tab=hours</p>");
        message.HtmlBody.Should().NotContain("under a whole hour");
    }

    [Fact]
    public async Task DecisionEmail_RejectsUnknownDecisionBeforeSending()
    {
        var tenantContext = CreateTenantContext(71);
        await using var db = CreateDbContext(tenantContext);
        await SeedRecipientAsync(db);
        var transport = new RecordingEmailService();
        var service = new EmailNotificationService(
            db,
            transport,
            NullLogger<EmailNotificationService>.Instance);

        Func<Task> act = async () =>
        {
            await service.SendVolunteerHoursDecisionEmailAsync(
                701,
                71,
                "pending",
                1m,
                "Community Crew");
        };

        await act.Should().ThrowAsync<ArgumentOutOfRangeException>()
            .WithParameterName("decision");
        transport.Messages.Should().BeEmpty();
        (await db.EmailLogs.CountAsync()).Should().Be(0);
    }

    private static async Task SeedRecipientAsync(NexusDbContext db)
    {
        db.Tenants.Add(new Tenant
        {
            Id = 71,
            Slug = "volunteers",
            Name = "Volunteers Community",
            Domain = "volunteers.example.test"
        });
        db.Users.Add(new User
        {
            Id = 701,
            TenantId = 71,
            Email = "volunteer@example.test",
            PasswordHash = "not-used",
            FirstName = "Ada",
            LastName = "Volunteer",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active
        });
        await db.SaveChangesAsync();
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new NexusDbContext(options, tenant);
    }

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
