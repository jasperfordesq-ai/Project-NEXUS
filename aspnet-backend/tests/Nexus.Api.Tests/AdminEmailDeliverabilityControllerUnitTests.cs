// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class AdminEmailDeliverabilityControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelEmailDeliverabilityRoutes()
    {
        var routeTemplates = typeof(AdminEmailDeliverabilityController)
            .GetCustomAttributes<RouteAttribute>()
            .Select(route => route.Template)
            .ToArray();

        routeTemplates.Should().BeEquivalentTo(
            "api/admin/email-deliverability",
            "api/v2/admin/email-deliverability");
        typeof(AdminEmailDeliverabilityController)
            .GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");

        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.Summary))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("summary");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.PushSummary))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("push-summary");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.TriggerAudit))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("trigger-audit");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.Logs))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("logs");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.Queues))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("queues");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.Suppressions))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("suppressions");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.RemoveSuppression))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("suppressions/{id:int}");
        typeof(AdminEmailDeliverabilityController)
            .GetMethod(nameof(AdminEmailDeliverabilityController.UserHistory))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("user/{userId:int}");
    }

    [Fact]
    public async Task SummaryAndLogs_ReturnReactCompatibleEnvelopeAndTenantIsolation()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        db.EmailLogs.AddRange(
            new EmailLog
            {
                TenantId = 42,
                UserId = 5,
                ToEmail = "member@example.test",
                TemplateKey = "welcome",
                Subject = "Welcome",
                Status = EmailSendStatus.Sent,
                SentAt = DateTime.UtcNow.AddHours(-2),
                CreatedAt = DateTime.UtcNow.AddHours(-2)
            },
            new EmailLog
            {
                TenantId = 42,
                UserId = 5,
                ToEmail = "member@example.test",
                TemplateKey = "digest",
                Subject = "Digest",
                Status = EmailSendStatus.Failed,
                ErrorMessage = "SMTP refused",
                CreatedAt = DateTime.UtcNow.AddHours(-1)
            },
            new EmailLog
            {
                TenantId = 7,
                UserId = 5,
                ToEmail = "other@example.test",
                TemplateKey = "welcome",
                Subject = "Other",
                Status = EmailSendStatus.Sent,
                CreatedAt = DateTime.UtcNow.AddHours(-1)
            });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var summary = await controller.Summary(days: 7, CancellationToken.None);

        var summaryOk = summary.Should().BeOfType<OkObjectResult>().Subject;
        using (var summaryDocument = JsonDocument.Parse(JsonSerializer.Serialize(summaryOk.Value)))
        {
            var data = summaryDocument.RootElement.GetProperty("data");
            data.GetProperty("window_days").GetInt32().Should().Be(7);
            data.GetProperty("total").GetInt32().Should().Be(2);
            data.GetProperty("by_status").GetProperty("sent").GetInt32().Should().Be(1);
            data.GetProperty("by_status").GetProperty("failed").GetInt32().Should().Be(1);
            data.GetProperty("warnings").EnumerateArray().Should().BeEmpty();
            data.GetProperty("trigger_audit").GetProperty("score").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        }

        var logs = await controller.Logs(
            limit: 50,
            offset: 0,
            userId: null,
            email: "member",
            status: null,
            category: null,
            since: null,
            until: null,
            CancellationToken.None);

        var logsOk = logs.Should().BeOfType<OkObjectResult>().Subject;
        using var logsDocument = JsonDocument.Parse(JsonSerializer.Serialize(logsOk.Value));
        var rows = logsDocument.RootElement.GetProperty("data").GetProperty("rows").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows.Select(row => row.GetProperty("recipient_email").GetString()).Should()
            .OnlyContain(email => email == "member@example.test");
        logsDocument.RootElement.GetProperty("data").GetProperty("total").GetInt32().Should().Be(2);
        rows[0].GetProperty("provider").GetString().Should().Be("local");
        rows[0].GetProperty("provider_message_id").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task SuppressionsQueuesPushAndUserHistory_ReturnLaravelShapes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var service = new AdminEmailDeliverabilityService(db);
        var suppression = await service.UpsertSuppressionAsync(new EmailSuppressionRecord
        {
            Id = 5,
            Email = "blocked@example.test",
            Reason = "bounce",
            Detail = "hard bounce",
            SuppressedAt = DateTime.UtcNow.AddDays(-1)
        }, CancellationToken.None);
        await service.UpsertQueueRowAsync(42, new EmailQueueDiagnosticRow
        {
            Source = "notification_queue",
            Id = 77,
            Email = "member@example.test",
            Category = "welcome",
            Subject = "Welcome",
            Status = "failed",
            Attempts = 3,
            Error = "timeout",
            CreatedAt = DateTime.UtcNow.AddMinutes(-30)
        }, CancellationToken.None);
        db.Users.Add(new User
        {
            Id = 5,
            TenantId = 42,
            Email = "blocked@example.test",
            FirstName = "Ada",
            LastName = "Lovelace",
            EmailVerified = true,
            EmailVerifiedAt = DateTime.UtcNow.AddDays(-10),
            CreatedAt = DateTime.UtcNow.AddDays(-30)
        });
        db.EmailLogs.Add(new EmailLog
        {
            TenantId = 42,
            UserId = 5,
            ToEmail = "blocked@example.test",
            TemplateKey = "welcome",
            Subject = "Welcome",
            Status = EmailSendStatus.Bounced,
            ErrorMessage = "hard bounce",
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var push = await controller.PushSummary(days: 30, CancellationToken.None);
        using (var pushDocument = JsonDocument.Parse(JsonSerializer.Serialize(push.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var data = pushDocument.RootElement.GetProperty("data");
            data.GetProperty("available").GetBoolean().Should().BeFalse();
            data.GetProperty("recent_failures").EnumerateArray().Should().BeEmpty();
        }

        var queues = await controller.Queues(limit: 50, status: null, source: null, CancellationToken.None);
        using (var queuesDocument = JsonDocument.Parse(JsonSerializer.Serialize(queues.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var rows = queuesDocument.RootElement.GetProperty("data").GetProperty("rows").EnumerateArray().ToArray();
            rows.Should().ContainSingle();
            rows[0].GetProperty("source").GetString().Should().Be("notification_queue");
        }

        var suppressions = await controller.Suppressions(
            limit: 50,
            offset: 0,
            email: "blocked",
            reason: "bounce",
            CancellationToken.None);

        using (var suppressionsDocument = JsonDocument.Parse(JsonSerializer.Serialize(suppressions.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var data = suppressionsDocument.RootElement.GetProperty("data");
            data.GetProperty("total").GetInt32().Should().Be(1);
            data.GetProperty("rows")[0].GetProperty("id").GetInt32().Should().Be(suppression.Id);
        }

        var history = await controller.UserHistory(5, CancellationToken.None);
        using (var historyDocument = JsonDocument.Parse(JsonSerializer.Serialize(history.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var data = historyDocument.RootElement.GetProperty("data");
            data.GetProperty("user").GetProperty("email").GetString().Should().Be("blocked@example.test");
            data.GetProperty("logs").EnumerateArray().Should().ContainSingle();
            data.GetProperty("suppressions").EnumerateArray().Should().ContainSingle();
        }

        var deleted = await controller.RemoveSuppression(suppression.Id, CancellationToken.None);
        using (var deletedDocument = JsonDocument.Parse(JsonSerializer.Serialize(deleted.Should().BeOfType<OkObjectResult>().Subject.Value)))
        {
            var data = deletedDocument.RootElement.GetProperty("data");
            data.GetProperty("removed").GetBoolean().Should().BeTrue();
            data.GetProperty("email").GetString().Should().Be("blocked@example.test");
        }

        var missingUser = await controller.UserHistory(999, CancellationToken.None);
        var missingResult = missingUser.Should().BeOfType<ObjectResult>().Subject;
        missingResult.StatusCode.Should().Be(StatusCodes.Status404NotFound);
    }

    private static AdminEmailDeliverabilityController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new AdminEmailDeliverabilityService(db);
        return new AdminEmailDeliverabilityController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "super_admin")
        };
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

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, role),
                    new Claim("role", role)
                ], "Test"))
            }
        };
    }
}
