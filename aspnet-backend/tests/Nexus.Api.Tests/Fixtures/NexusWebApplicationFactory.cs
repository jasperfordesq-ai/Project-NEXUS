// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Nexus.Api.Tests.Fixtures;

/// <summary>
/// Custom WebApplicationFactory for integration tests using PostgreSQL test container.
/// Provides isolated database per test run.
/// </summary>
public class NexusWebApplicationFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private static readonly string? ExternalTestConnection = Environment.GetEnvironmentVariable("NEXUS_TEST_POSTGRES");
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:16.4-bookworm")
        .WithDatabase("nexus_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    // Docker Desktop can occasionally take longer than Npgsql's 15-second
    // default to complete a fresh PostgreSQL handshake while integration tests
    // are creating a child host or deliberately holding row locks. Keep the
    // production connection settings untouched, but give this disposable test
    // database enough time to distinguish a slow local handshake from a real
    // endpoint failure.
    public string ConnectionString
    {
        get
        {
            var connection = ExternalTestConnection ?? _postgres.GetConnectionString();
            var parsed = new NpgsqlConnectionStringBuilder(connection);
            if (ExternalTestConnection is not null && !(parsed.Database ?? string.Empty).StartsWith("nexus_", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("NEXUS_TEST_POSTGRES must target an explicitly disposable nexus_* database.");
            parsed.Timeout = 60;
            parsed.CommandTimeout = 60;
            return parsed.ConnectionString;
        }
    }

    // Test JWT secret - generated deterministically to avoid hardcoded secrets in source control
    private static readonly string TestJwtSecret = Convert.ToBase64String(
        System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes("nexus-test-environment-jwt")));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // Add test configuration BEFORE services are configured
        builder.ConfigureAppConfiguration((context, config) =>
        {
            // Add in-memory configuration for test settings
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = TestJwtSecret,
                ["Jwt:Issuer"] = "NexusTestIssuer",
                ["Jwt:Audience"] = "NexusTestAudience",
                ["Jwt:AccessTokenExpiryMinutes"] = "120",
                ["ConnectionStrings:DefaultConnection"] = ConnectionString,
                ["RateLimiting:Auth:PermitLimit"] = "1000", // High limit for tests
                ["RateLimiting:Auth:WindowSeconds"] = "1",
                ["RateLimiting:General:PermitLimit"] = "10000",
                ["RateLimiting:General:WindowSeconds"] = "1",
                ["RateLimiting:EventRegistration:ReadPermitLimit"] = "1000",
                ["RateLimiting:EventRegistration:MutationPermitLimit"] = "1000",
                ["RateLimiting:EventRegistration:SubmissionPermitLimit"] = "1000",
                ["RateLimiting:EventRegistration:AnswerReadPermitLimit"] = "1000",
                ["RateLimiting:EventRegistration:RestrictedPermitLimit"] = "1000",
                ["RateLimiting:EventRegistration:RetentionApplyPermitLimit"] = "1000",
                ["RateLimiting:EventRegistration:WindowSeconds"] = "1",
                ["RateLimiting:Events:PublishPermitLimit"] = "1000",
                ["RateLimiting:Events:RecurrenceReadPermitLimit"] = "1000",
                ["RateLimiting:Events:RecurrencePreviewPermitLimit"] = "1000",
                ["RateLimiting:Events:RecurrenceCommitPermitLimit"] = "1000",
                ["RateLimiting:GuardianConsent:ListPermitLimit"] = "1000",
                ["RateLimiting:GuardianConsent:ListWindowSeconds"] = "1",
                ["RateLimiting:GuardianConsent:RequestPermitLimit"] = "1000",
                ["RateLimiting:GuardianConsent:RequestWindowSeconds"] = "1",
                ["RateLimiting:GuardianConsent:VerifyPermitLimit"] = "1000",
                ["RateLimiting:GuardianConsent:VerifyWindowSeconds"] = "1",
                ["RateLimiting:GuardianConsent:WithdrawPermitLimit"] = "1000",
                ["RateLimiting:GuardianConsent:WithdrawWindowSeconds"] = "1",
                ["RateLimiting:SafeguardingVetting:PolicyUpdatePermitLimit"] = "1000",
                ["RateLimiting:SafeguardingVetting:PolicyUpdateWindowSeconds"] = "1",
                ["RateLimiting:SafeguardingVetting:PolicyRotationPermitLimit"] = "1000",
                ["RateLimiting:SafeguardingVetting:PolicyRotationWindowSeconds"] = "1",
                ["RateLimiting:SafeguardingVetting:DecisionPermitLimit"] = "1000",
                ["RateLimiting:SafeguardingVetting:DecisionWindowSeconds"] = "1",
                ["RateLimiting:SafeguardingVetting:MemberMutationPermitLimit"] = "1000",
                ["RateLimiting:SafeguardingVetting:MemberMutationWindowSeconds"] = "1",
                ["RateLimiting:SafeguardingVetting:OnboardingPermitLimit"] = "1000",
                ["RateLimiting:SafeguardingVetting:OnboardingWindowSeconds"] = "1",
                ["RateLimiting:SafeguardingVetting:OptionMutationPermitLimit"] = "1000",
                ["RateLimiting:SafeguardingVetting:OptionMutationWindowSeconds"] = "1",
                ["RateLimiting:Messages:EditPermitLimit"] = "1000",
                ["RateLimiting:Messages:EditWindowSeconds"] = "1",
                ["RateLimiting:Messages:DeletePermitLimit"] = "1000",
                ["RateLimiting:Messages:DeleteWindowSeconds"] = "1",
                ["RateLimiting:Messages:ArchivePermitLimit"] = "1000",
                ["RateLimiting:Messages:ArchiveWindowSeconds"] = "1",
                ["RateLimiting:Messages:RestorePermitLimit"] = "1000",
                ["RateLimiting:Messages:RestoreWindowSeconds"] = "1",
                ["RateLimiting:PersonalWallet:TransferPermitLimit"] = "1000",
                ["RateLimiting:PersonalWallet:TransferWindowSeconds"] = "1",
                ["RateLimiting:PersonalWallet:UserSearchPermitLimit"] = "1000",
                ["RateLimiting:PersonalWallet:UserSearchWindowSeconds"] = "1",
                ["Prerender:WebhookToken"] = "nexus-prerender-test-webhook-token",
                ["Prerender:CachePath"] = Path.Combine(Path.GetTempPath(), "nexus-prerender-integration-cache"),
                ["RateLimiting:VolunteerOrganisationWallet:DepositPermitLimit"] = "1000",
                ["RateLimiting:VolunteerOrganisationWallet:DepositWindowSeconds"] = "1",
                ["Cors:AllowedOrigins:0"] = "https://wallet-ui.example.test",
                ["RabbitMq:Enabled"] = "false", // Disable RabbitMQ for tests
                ["BackgroundServices:SuppressAutomaticExecution"] = "true",
                ["LlamaService:BaseUrl"] = "http://localhost:11434", // Mock URL
                // Disable the outbound-network security gates in the test host.
                // Otherwise registration hits live third-party APIs in CI: the
                // HIBP k-anonymity check rejects the common test passwords
                // (e.g. "TestPassword123!", "NewPassword123!") as breached and
                // returns 400, breaking every Register_* integration test.
                // Turnstile is explicitly unset so the verifier short-circuits
                // to pass (it already does when no secret is configured).
                ["Hibp:Enabled"] = "false",
                ["Turnstile:SecretKey"] = ""
            });
        });

        builder.ConfigureServices(services =>
        {
            // Remove the existing DbContext registration
            var descriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(DbContextOptions<NexusDbContext>));

            if (descriptor != null)
            {
                services.Remove(descriptor);
            }

            // Remove any existing DbContext registrations
            var dbContextDescriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(NexusDbContext));

            if (dbContextDescriptor != null)
            {
                services.Remove(dbContextDescriptor);
            }

            // Add DbContext using test container
            services.AddDbContext<NexusDbContext>((sp, options) =>
            {
                options.UseNpgsql(ConnectionString);
            });

        });
    }

    public async Task InitializeAsync()
    {
        if (ExternalTestConnection is null)
            await _postgres.StartAsync();

        // Create the disposable schema once, after PostgreSQL is ready and before
        // any test host is built. Derived WithWebHostBuilder factories share this
        // database; creating it from ConfigureServices made every derived host
        // reconnect and rerun schema initialization, which could race or lose a Docker
        // Desktop socket during long integration classes.
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql(ConnectionString)
            .Options;

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var db = new NexusDbContext(options, new TenantContext());
                // Production starts from the committed migration chain. EnsureCreated
                // omits migration SQL such as PostgreSQL immutability triggers, making
                // integration results weaker than the deployed schema contract.
                await db.Database.MigrateAsync();
                break;
            }
            catch (NpgsqlException) when (attempt < 3)
            {
                // Testcontainers has completed its readiness probe, but Docker
                // Desktop can still reset the first client handshake under load.
                await Task.Delay(TimeSpan.FromMilliseconds(250 * attempt));
            }
        }
    }

    public new async Task DisposeAsync()
    {
        if (ExternalTestConnection is null)
            await _postgres.DisposeAsync();
        await base.DisposeAsync();
    }
}

/// <summary>
/// Collection definition for tests sharing the same factory instance.
/// </summary>
[CollectionDefinition("Integration")]
public class IntegrationTestCollection : ICollectionFixture<NexusWebApplicationFactory>
{
}
