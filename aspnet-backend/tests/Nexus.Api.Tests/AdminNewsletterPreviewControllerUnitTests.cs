// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class AdminNewsletterPreviewControllerUnitTests
{
    [Fact]
    public void PreviewNewsletter_ExposesLaravelAdminNewsletterPreviewRoute()
    {
        typeof(AdminCompatibility2Controller)
            .GetCustomAttributes<RouteAttribute>()
            .Select(attribute => attribute.Template)
            .Should().BeEquivalentTo("api/admin", "api/v2/admin");

        typeof(AdminCompatibility2Controller)
            .GetMethod(nameof(AdminCompatibility2Controller.PreviewNewsletter))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("newsletters/preview");
    }

    [Fact]
    public async Task PreviewNewsletter_RendersUnsavedDraftWithoutPersistingEmailLogs()
    {
        var tenant = new TenantContext();
        tenant.SetTenant(42);
        await using var db = CreateDbContext(tenant);
        db.Tenants.Add(new Tenant { Id = 42, Name = "Test Tenant", Slug = "test-tenant", IsActive = true });
        db.Users.Add(new User
        {
            Id = 9001,
            TenantId = 42,
            Email = "admin@test.local",
            FirstName = "Admin",
            LastName = "User",
            Role = "admin",
            IsActive = true,
            PasswordHash = "not-used"
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.PreviewNewsletter(new AdminCompatibility2Controller.PreviewNewsletterRequest
        {
            Subject = "Weekly hello",
            PreviewText = "What is happening this week",
            ContentFormat = "richtext",
            Content = "<p>Hello {{first_name}} from {{tenant_name}}</p><script>alert('nope')</script>"
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var json = JsonSerializer.SerializeToElement(ok.Value);
        var data = json.GetProperty("data");

        data.GetProperty("subject").GetString().Should().Be("Weekly hello");
        data.GetProperty("html").GetString().Should().Contain("Hello Admin from Test Tenant");
        data.GetProperty("html").GetString().Should().Contain("What is happening this week");
        data.GetProperty("html").GetString().Should().NotContain("<script");
        data.GetProperty("text").GetString().Should().Contain("Hello Admin from Test Tenant");
        (await db.Set<EmailLog>().CountAsync()).Should().Be(0);
    }

    private static AdminCompatibility2Controller CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var configuration = new ConfigurationBuilder().Build();
        var newsletter = new NewsletterService(
            db,
            tenant,
            new StubEmailService(),
            configuration,
            NullLogger<NewsletterService>.Instance);
        var location = new LocationService(
            db,
            tenant,
            configuration,
            NullLogger<LocationService>.Instance);

        return new AdminCompatibility2Controller(
            db,
            tenant,
            newsletter,
            location,
            NullLogger<AdminCompatibility2Controller>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim(ClaimTypes.Role, "admin")
                    }, "test"))
                }
            }
        };
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private sealed class StubEmailService : IEmailService
    {
        public Task<bool> SendEmailAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken ct = default) => Task.FromResult(true);

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
}
