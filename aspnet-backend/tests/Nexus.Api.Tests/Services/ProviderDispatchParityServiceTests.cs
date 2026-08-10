// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using System.Net;
using System.Text;

namespace Nexus.Api.Tests.Services;

public class ProviderDispatchParityServiceTests
{
    [Fact]
    public void EventInvitationEvidenceHasher_BindsEvidenceToTenantAndEvent()
    {
        var hasher = new EventInvitationEvidenceHasher(CreateConfiguration(new()
        {
            ["EventRegistration:EvidenceHashKey"] = "test-evidence-key-with-at-least-32-characters"
        }));

        hasher.Email(10, " Member@Example.Test ").Should().Be(hasher.Email(10, "member@example.test"));
        hasher.Email(10, "member@example.test").Should().NotBe(hasher.Email(11, "member@example.test"));
        hasher.Token(10, 20, "nxi1_secret").Should().NotBe(hasher.Token(10, 21, "nxi1_secret"));
    }

    [Fact]
    public async Task NewsletterProcessQueuedLogs_WithoutProvider_MarksLogsFailedHonestly()
    {
        using var db = CreateDbContext();
        var email = new RecordingEmailService(true);
        var service = new NewsletterService(
            db,
            CreateTenantContext(),
            email,
            CreateConfiguration(),
            NullLogger<NewsletterService>.Instance);

        var newsletter = await service.CreateNewsletterAsync(10, "Local queue", "<p>Hello</p>", "Hello");
        await service.SubscribeAsync("member@example.com");

        var queued = await service.SendNewsletterAsync(newsletter.Id);
        queued!.Status.Should().Be(NewsletterStatus.Queued);

        var pending = await db.EmailLogs.SingleAsync();
        pending.Status.Should().Be(EmailSendStatus.Pending);
        pending.ErrorMessage.Should().Be("provider_not_configured");

        var result = await service.ProcessQueuedNewsletterLogsAsync(newsletter.Id);

        result!.ProviderConfigured.Should().BeFalse();
        result.Failed.Should().Be(1);
        email.Sent.Count.Should().Be(0);
        (await db.EmailLogs.SingleAsync()).Status.Should().Be(EmailSendStatus.Failed);
    }

    [Fact]
    public async Task NewsletterSend_WithConfiguredProvider_UsesEmailServiceAndMarksSent()
    {
        using var db = CreateDbContext();
        var email = new RecordingEmailService(true);
        var service = new NewsletterService(
            db,
            CreateTenantContext(),
            email,
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["SendGrid:Enabled"] = "true",
                ["SendGrid:ApiKey"] = "test-key"
            }),
            NullLogger<NewsletterService>.Instance);

        var newsletter = await service.CreateNewsletterAsync(10, "Provider send", "<p>Hello</p>", "Hello");
        await service.SubscribeAsync("member@example.com");

        var sent = await service.SendNewsletterAsync(newsletter.Id);

        email.Sent.Should().ContainSingle(e => e.To == "member@example.com");
        var log = await db.EmailLogs.SingleAsync();
        log.Status.Should().Be(EmailSendStatus.Sent);
        log.ErrorMessage.Should().BeNull();
        var persisted = await db.Newsletters.SingleAsync(n => n.Id == sent!.Id);
        persisted.Status.Should().Be(NewsletterStatus.Sent);
    }

    [Fact]
    public async Task NewsletterSend_WithConfiguredProviderFailure_MarksLogFailedWithoutFakeSuccess()
    {
        using var db = CreateDbContext();
        var email = new RecordingEmailService(false);
        var service = new NewsletterService(
            db,
            CreateTenantContext(),
            email,
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["SendGrid:Enabled"] = "true",
                ["SendGrid:ApiKey"] = "test-key"
            }),
            NullLogger<NewsletterService>.Instance);

        var newsletter = await service.CreateNewsletterAsync(10, "Provider failure", "<p>Hello</p>", "Hello");
        await service.SubscribeAsync("member@example.com");

        var queued = await service.SendNewsletterAsync(newsletter.Id);

        queued!.Status.Should().Be(NewsletterStatus.Queued);
        email.Sent.Should().ContainSingle(e => e.To == "member@example.com");
        var log = await db.EmailLogs.SingleAsync();
        log.Status.Should().Be(EmailSendStatus.Failed);
        log.ErrorMessage.Should().Be("provider_send_failed");
        log.RetryCount.Should().Be(1);
    }

    [Fact]
    public async Task NewsletterProcessDueQueue_QueuesScheduledNewsletterAndProcessesLogs()
    {
        using var db = CreateDbContext();
        var email = new RecordingEmailService(true);
        var service = new NewsletterService(
            db,
            CreateTenantContext(),
            email,
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["SendGrid:Enabled"] = "true",
                ["SendGrid:ApiKey"] = "test-key"
            }),
            NullLogger<NewsletterService>.Instance);

        var newsletter = await service.CreateNewsletterAsync(
            10,
            "Scheduled send",
            "<p>Hello</p>",
            "Hello",
            DateTime.UtcNow.AddMinutes(-5));
        await service.SubscribeAsync("member@example.com");

        var result = await service.ProcessDueNewsletterQueueAsync();

        result.ProviderConfigured.Should().BeTrue();
        result.QueuedNewsletters.Should().Be(1);
        result.ProcessedNewsletters.Should().Be(1);
        result.Attempted.Should().Be(1);
        result.Sent.Should().Be(1);
        var persisted = await db.Newsletters.SingleAsync(n => n.Id == newsletter.Id);
        persisted.Status.Should().Be(NewsletterStatus.Sent);
    }

    [Fact]
    public async Task PushProcessPending_WithoutProvider_MarksFailedWithProviderNotConfigured()
    {
        using var db = CreateDbContext();
        var service = new PushNotificationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(),
            NullLogger<PushNotificationService>.Instance);

        await service.RegisterDeviceAsync(7, "token-123", "web", "Browser");
        var queued = await service.SendPushAsync(7, "Hello", "Body");

        queued.Should().Be(1);
        (await db.PushNotificationLogs.SingleAsync()).Status.Should().Be(PushStatus.Pending);

        var result = await service.ProcessPendingPushNotificationsAsync();

        result.ProviderConfigured.Should().BeFalse();
        result.Failed.Should().Be(1);
        var log = await db.PushNotificationLogs.SingleAsync();
        log.Status.Should().Be(PushStatus.Failed);
        log.ErrorMessage.Should().Be("provider_not_configured");
    }

    [Fact]
    public async Task PushProcessPending_WithConfiguredHttpProvider_PostsPayloadAndMarksSent()
    {
        using var db = CreateDbContext();
        var handler = new RecordingHttpHandler((_, _) => new HttpResponseMessage(HttpStatusCode.Accepted));
        var service = new PushNotificationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["Push:Http:Endpoint"] = "https://push-provider.test/send",
                ["Push:Http:AuthHeaderName"] = "X-Push-Key",
                ["Push:Http:AuthHeaderValue"] = "secret-from-config"
            }),
            NullLogger<PushNotificationService>.Instance,
            new StubHttpClientFactory(handler));

        await service.RegisterDeviceAsync(7, "token-123", "web", "Browser");
        await service.SendPushAsync(7, "Hello", "Body", "{\"url\":\"/inbox\"}");

        var result = await service.ProcessPendingPushNotificationsAsync();

        result.ProviderConfigured.Should().BeTrue();
        result.Provider.Should().Be("generic-http");
        result.Sent.Should().Be(1);
        result.Failed.Should().Be(0);
        var log = await db.PushNotificationLogs.SingleAsync();
        log.Status.Should().Be(PushStatus.Sent);
        log.ErrorMessage.Should().BeNull();
        log.SentAt.Should().NotBeNull();
        (await db.PushSubscriptions.SingleAsync()).LastUsedAt.Should().NotBeNull();

        var request = handler.Requests.Should().ContainSingle().Subject;
        request.Method.Should().Be(HttpMethod.Post);
        request.Uri.Should().Be("https://push-provider.test/send");
        request.Body.Should().Contain("token-123");
        request.Body.Should().Contain("Hello");
        request.Headers["X-Push-Key"].Should().ContainSingle("secret-from-config");
    }

    [Fact]
    public async Task PushProcessPending_WithConfiguredHttpProviderFailure_MarksFailedHonestly()
    {
        using var db = CreateDbContext();
        var handler = new RecordingHttpHandler((_, _) => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = new PushNotificationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["Push:Http:Endpoint"] = "https://push-provider.test/send"
            }),
            NullLogger<PushNotificationService>.Instance,
            new StubHttpClientFactory(handler));

        await service.RegisterDeviceAsync(7, "token-123", "web", "Browser");
        await service.SendPushAsync(7, "Hello", "Body");

        var result = await service.ProcessPendingPushNotificationsAsync();

        result.ProviderConfigured.Should().BeTrue();
        result.Sent.Should().Be(0);
        result.Failed.Should().Be(1);
        var log = await db.PushNotificationLogs.SingleAsync();
        log.Status.Should().Be(PushStatus.Failed);
        log.ErrorMessage.Should().Be("provider_http_500");
    }

    [Fact]
    public async Task PushChannelQueue_SeparatesWebPushAndFcmSubscriptions()
    {
        using var db = CreateDbContext();
        var service = new PushNotificationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(),
            NullLogger<PushNotificationService>.Instance);

        var web = await service.RegisterDeviceAsync(7, "https://push.example.test/subscription", "web", "Browser", "p256dh", "auth");
        var android = await service.RegisterDeviceAsync(7, "fcm-token", "android", "Phone");

        (await service.SendPushChannelAsync(7, "Web", "Body", "{}", "web-push")).Should().Be(1);
        (await service.SendPushChannelAsync(7, "Native", "Body", "{}", "fcm")).Should().Be(1);

        var logs = await db.PushNotificationLogs.OrderBy(x => x.Id).ToListAsync();
        logs.Should().HaveCount(2);
        logs[0].SubscriptionId.Should().Be(web.Id);
        logs[0].Data.Should().Contain("web-push");
        logs[1].SubscriptionId.Should().Be(android.Id);
        logs[1].Data.Should().Contain("fcm");
    }

    [Fact]
    public async Task PushProcessPending_UsesTheProviderFrozenIntoEachLog()
    {
        using var db = CreateDbContext();
        var handler = new RecordingHttpHandler((_, _) => new HttpResponseMessage(HttpStatusCode.Accepted)
        {
            Content = new StringContent("{\"success\":1,\"failure\":0}")
        });
        var service = new PushNotificationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["Firebase:ServerKey"] = "test-server-key"
            }),
            NullLogger<PushNotificationService>.Instance,
            new StubHttpClientFactory(handler));

        await service.RegisterDeviceAsync(7, "fcm-token", "android", "Phone");
        await service.SendPushChannelAsync(7, "Native", "Body", "{}", "fcm");

        var result = await service.ProcessPendingPushNotificationsAsync();

        result.Provider.Should().Be("fcm");
        result.ProviderConfigured.Should().BeTrue();
        result.Sent.Should().Be(1);
        handler.Requests.Should().ContainSingle().Which.Uri.Should().Be("https://fcm.googleapis.com/fcm/send");
    }

    [Fact]
    public async Task GeocodeTenantLocalResult_ReportsProviderAbsenceExplicitly()
    {
        using var db = CreateDbContext();
        db.UserLocations.Add(new UserLocation
        {
            TenantId = 1,
            UserId = 7,
            Latitude = 51.8985,
            Longitude = -8.4756,
            City = "Cork",
            Region = "County Cork",
            Country = "Ireland",
            FormattedAddress = "Cork, County Cork, Ireland",
            IsPublic = true
        });
        await db.SaveChangesAsync();

        var service = new LocationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(),
            NullLogger<LocationService>.Instance);

        var result = await service.GeocodeAddressAsync("Cork");

        result.Should().NotBeNull();
        result!.Source.Should().Be("tenant_locations");
        result.Provider.Should().Be("none");
        result.ProviderConfigured.Should().BeFalse();
        result.ProviderMessage.Should().Contain("provider_not_configured");
    }

    [Fact]
    public async Task GeocodeAddress_WithConfiguredHttpProvider_ReturnsProviderResult()
    {
        using var db = CreateDbContext();
        var handler = new RecordingHttpHandler((_, _) => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                "{\"latitude\":53.3498,\"longitude\":-6.2603,\"formattedAddress\":\"Dublin, Ireland\",\"city\":\"Dublin\",\"country\":\"Ireland\"}",
                Encoding.UTF8,
                "application/json")
        });
        var service = new LocationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["Geocoding:Http:Endpoint"] = "https://geocoder.test/search",
                ["Geocoding:Http:BearerToken"] = "geocoder-token"
            }),
            NullLogger<LocationService>.Instance,
            new StubHttpClientFactory(handler));

        var result = await service.GeocodeAddressAsync("Dublin");

        result.Should().NotBeNull();
        result!.Source.Should().Be("provider");
        result.Provider.Should().Be("generic-http");
        result.ProviderConfigured.Should().BeTrue();
        result.Latitude.Should().BeApproximately(53.3498, 0.0001);
        result.Longitude.Should().BeApproximately(-6.2603, 0.0001);
        result.FormattedAddress.Should().Be("Dublin, Ireland");
        var request = handler.Requests.Should().ContainSingle().Subject;
        request.Body.Should().Contain("Dublin");
        request.Headers["Authorization"].Should().ContainSingle("Bearer geocoder-token");
    }

    [Fact]
    public async Task GeocodeAddress_WithConfiguredHttpProviderFailure_FallsBackToTenantLocal()
    {
        using var db = CreateDbContext();
        db.UserLocations.Add(new UserLocation
        {
            TenantId = 1,
            UserId = 7,
            Latitude = 51.8985,
            Longitude = -8.4756,
            City = "Cork",
            Region = "County Cork",
            Country = "Ireland",
            FormattedAddress = "Cork, County Cork, Ireland",
            IsPublic = true
        });
        await db.SaveChangesAsync();

        var handler = new RecordingHttpHandler((_, _) => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var service = new LocationService(
            db,
            CreateTenantContext(),
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["Geocoding:Http:Endpoint"] = "https://geocoder.test/search"
            }),
            NullLogger<LocationService>.Instance,
            new StubHttpClientFactory(handler));

        var result = await service.GeocodeAddressAsync("Cork");

        result.Should().NotBeNull();
        result!.Source.Should().Be("tenant_locations");
        result.ProviderConfigured.Should().BeTrue();
        result.ProviderMessage.Should().Contain("fallback");
        result.ProviderMessage.Should().Contain("provider_http_503");
        handler.Requests.Should().ContainSingle();
    }

    private static NexusDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, CreateTenantContext());
    }

    private static TenantContext CreateTenantContext()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(1);
        return tenantContext;
    }

    private static IConfiguration CreateConfiguration(Dictionary<string, string?>? values = null)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(values ?? new Dictionary<string, string?>())
            .Build();
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;

        public StubHttpClientFactory(HttpMessageHandler handler)
        {
            _handler = handler;
        }

        public HttpClient CreateClient(string name)
        {
            return new HttpClient(_handler, disposeHandler: false);
        }
    }

    private sealed class RecordingHttpHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, string, HttpResponseMessage> _respond;

        public RecordingHttpHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond)
        {
            _respond = respond;
        }

        public List<RecordedHttpRequest> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content == null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken);
            var headers = request.Headers.ToDictionary(
                h => h.Key,
                h => h.Value.ToList());

            Requests.Add(new RecordedHttpRequest(
                request.Method,
                request.RequestUri?.ToString() ?? string.Empty,
                body,
                headers));

            return _respond(request, body);
        }
    }

    private sealed record RecordedHttpRequest(
        HttpMethod Method,
        string Uri,
        string Body,
        Dictionary<string, List<string>> Headers);

    private sealed class RecordingEmailService : IEmailService
    {
        private readonly bool _sendResult;

        public RecordingEmailService(bool sendResult)
        {
            _sendResult = sendResult;
        }

        public List<(string To, string Subject)> Sent { get; } = new();

        public Task<bool> SendEmailAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken ct = default)
        {
            Sent.Add((to, subject));
            return Task.FromResult(_sendResult);
        }

        public Task<bool> SendPasswordResetEmailAsync(
            string to,
            string resetToken,
            string userName,
            string resetUrl,
            CancellationToken ct = default) => Task.FromResult(_sendResult);

        public Task<bool> SendWelcomeEmailAsync(
            string to,
            string userName,
            string tenantName,
            CancellationToken ct = default) => Task.FromResult(_sendResult);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(_sendResult);
    }
}
