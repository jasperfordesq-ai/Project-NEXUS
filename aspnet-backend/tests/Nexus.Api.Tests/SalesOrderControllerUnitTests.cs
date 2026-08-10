// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class SalesOrderControllerUnitTests
{
    [Fact]
    public void Submit_ExposesPublicLaravelSalesOrderRouteWithStrictThrottle()
    {
        var (controllerType, method) = GetSubmitAction();

        controllerType.GetCustomAttributes<RouteAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain(new[] { "api/sales", "api/v2/sales" });

        method.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("orders");
        method.GetCustomAttribute<AllowAnonymousAttribute>().Should().NotBeNull();
        method.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName
            .Should().Be(RateLimitingExtensions.AuthPolicy);
    }

    [Fact]
    public async Task Submit_ValidOrderSendsSalesEmailAndReturnsReceivedReference()
    {
        var email = new RecordingEmailService(sendResult: true);
        var controller = CreateController(email);
        var request = CreateRequest(controller, ValidPayload());

        var result = await InvokeSubmitAsync(controller, request);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");

        data.GetProperty("status").GetString().Should().Be("received");
        data.GetProperty("reference").GetString().Should().StartWith("NXSO-");
        data.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        email.Messages.Should().ContainSingle();
        email.Messages[0].To.Should().Be("jasper.ford.esq@gmail.com");
        email.Messages[0].Subject.Should().Contain("Project NEXUS order enquiry");
        email.Messages[0].HtmlBody.Should().Contain("West Cork Timebank");
        email.Messages[0].HtmlBody.Should().Contain("Project NEXUS Core");
    }

    [Fact]
    public async Task Submit_InvalidOrderReturnsLaravelStyleValidationErrors()
    {
        var controller = CreateController(new RecordingEmailService(sendResult: true));
        var request = CreateRequest(controller, new
        {
            contact_name = "A",
            email = "not-an-email",
            quote = new
            {
                billing_cycle = "weekly",
                pricing_mode = "published"
            }
        });

        var result = await InvokeSubmitAsync(controller, request);

        var invalid = result.Should().BeOfType<ObjectResult>().Subject;
        invalid.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        var errors = document.RootElement.GetProperty("errors").EnumerateArray().ToArray();

        errors.Should().NotBeEmpty();
        errors.Select(error => new
            {
                Code = error.GetProperty("code").GetString(),
                Field = error.GetProperty("field").GetString()
            })
            .Should().Contain(error =>
                error.Code == "VALIDATION_FAILED"
                && error.Field == "contact_name");
    }

    [Fact]
    public async Task Submit_HoneypotReturnsReceivedWithoutSendingEmail()
    {
        var email = new RecordingEmailService(sendResult: true);
        var controller = CreateController(email);
        var request = CreateRequest(controller, new { website = "filled by bot" });

        var result = await InvokeSubmitAsync(controller, request);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        email.Messages.Should().BeEmpty();
    }

    [Fact]
    public async Task TenantResolution_AllowsPublicSalesOrdersWithoutTenantHeader()
    {
        var nextCalled = false;
        var middleware = new TenantResolutionMiddleware(
            _ =>
            {
                nextCalled = true;
                return Task.CompletedTask;
            },
            NullLogger<TenantResolutionMiddleware>.Instance,
            new FakeHostEnvironment());
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/sales/orders";

        await middleware.InvokeAsync(
            context,
            new TenantContext(),
            null!,
            new MemoryCache(new MemoryCacheOptions()));

        nextCalled.Should().BeTrue();
        context.Response.StatusCode.Should().Be(StatusCodes.Status200OK);
    }

    private static (Type ControllerType, MethodInfo Method) GetSubmitAction()
    {
        var controllerType = typeof(Program).Assembly.GetType("Nexus.Api.Controllers.SalesOrderController");
        controllerType.Should().NotBeNull("Laravel exposes App\\Http\\Controllers\\Api\\SalesOrderController::submit");

        var method = controllerType!.GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .SingleOrDefault(candidate =>
                candidate.GetCustomAttribute<HttpPostAttribute>()?.Template == "orders");
        method.Should().NotBeNull("Laravel exposes POST /v2/sales/orders");

        return (controllerType, method!);
    }

    private static ControllerBase CreateController(RecordingEmailService email)
    {
        var (controllerType, _) = GetSubmitAction();
        var controller = (ControllerBase)Activator.CreateInstance(controllerType, email)!;
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext()
        };
        controller.Request.Headers.UserAgent = "unit-test";
        controller.HttpContext.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("127.0.0.1");
        return controller;
    }

    private static object CreateRequest(ControllerBase controller, object payload)
    {
        var (_, method) = GetSubmitAction();
        var requestType = method.GetParameters().Single().ParameterType;
        var json = JsonSerializer.Serialize(payload);
        return JsonSerializer.Deserialize(json, requestType, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        })!;
    }

    private static async Task<IActionResult> InvokeSubmitAsync(ControllerBase controller, object request)
    {
        var (_, method) = GetSubmitAction();
        var resultTask = (Task<IActionResult>)method.Invoke(controller, new[] { request })!;
        return await resultTask;
    }

    private static object ValidPayload()
        => new
        {
            contact_name = "Jasper Ford",
            organisation = "West Cork Timebank",
            email = "jasper@example.test",
            region = "Cork",
            note = "Please follow up about rollout.",
            page_url = "https://project-nexus.test/pricing",
            quote = new
            {
                product_line_label = "Project NEXUS",
                plan_name = "Project NEXUS Core",
                active_member_label = "Up to 500 active members",
                billing_cycle = "annual",
                pricing_mode = "published",
                monthly_recurring_label = "EUR 250/mo",
                annual_recurring_label = "EUR 2,500/yr",
                annual_savings_label = "Save EUR 500",
                one_off_label = "EUR 1,000",
                first_year_label = "EUR 3,500",
                line_items = new[]
                {
                    new
                    {
                        label = "Platform subscription",
                        amount_label = "EUR 2,500",
                        quantity = 1,
                        cadence = "monthly"
                    }
                }
            }
        };

    private sealed class RecordingEmailService : IEmailService
    {
        private readonly bool _sendResult;

        public RecordingEmailService(bool sendResult)
        {
            _sendResult = sendResult;
        }

        public List<EmailMessage> Messages { get; } = new();

        public Task<bool> SendEmailAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken ct = default)
        {
            Messages.Add(new EmailMessage(to, subject, htmlBody, textBody));
            return Task.FromResult(_sendResult);
        }

        public Task<bool> SendPasswordResetEmailAsync(
            string to,
            string resetToken,
            string userName,
            string resetUrl,
            CancellationToken ct = default)
            => Task.FromResult(_sendResult);

        public Task<bool> SendWelcomeEmailAsync(
            string to,
            string userName,
            string tenantName,
            CancellationToken ct = default)
            => Task.FromResult(_sendResult);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default)
            => Task.FromResult(_sendResult);
    }

    private sealed record EmailMessage(string To, string Subject, string HtmlBody, string? TextBody);

    private sealed class FakeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "Nexus.Api.Tests";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}
