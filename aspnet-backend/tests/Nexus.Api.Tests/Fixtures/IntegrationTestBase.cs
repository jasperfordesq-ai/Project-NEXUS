// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests.Fixtures;

/// <summary>
/// Base class for integration tests providing common utilities.
/// </summary>
public abstract class IntegrationTestBase : IAsyncLifetime
{
    protected readonly NexusWebApplicationFactory Factory;
    protected readonly HttpClient Client;
    protected TestData TestData = null!;

    protected static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    protected IntegrationTestBase(NexusWebApplicationFactory factory)
    {
        Factory = factory;
        Client = factory.CreateClient();
    }

    public virtual async Task InitializeAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        TestData = await TestDataSeeder.SeedAsync(db);
    }

    public virtual Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Login and get an access token for the specified user.
    /// </summary>
    protected async Task<string> GetAccessTokenAsync(string email, string tenantSlug)
    {
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = tenantSlug
        });

        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        return content.GetProperty("access_token").GetString()!;
    }

    /// <summary>
    /// Set the authorization header for authenticated requests.
    /// </summary>
    protected void SetAuthToken(string token)
    {
        Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    /// <summary>
    /// Clear the authorization header.
    /// </summary>
    protected void ClearAuthToken()
    {
        Client.DefaultRequestHeaders.Authorization = null;
    }

    /// <summary>
    /// Authenticate as the admin user.
    /// </summary>
    protected async Task AuthenticateAsAdminAsync()
    {
        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        SetAuthToken(token);
    }

    /// <summary>
    /// Authenticate as the member user.
    /// </summary>
    protected async Task AuthenticateAsMemberAsync()
    {
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        SetAuthToken(token);
    }

    /// <summary>
    /// Authenticate as the other tenant user.
    /// </summary>
    protected async Task AuthenticateAsOtherTenantUserAsync()
    {
        var token = await GetAccessTokenAsync("other@test.com", "other-tenant");
        SetAuthToken(token);
    }

    /// <summary>
    /// Authenticate as a dedicated database-backed platform super administrator.
    /// Keeping this identity separate preserves ordinary-admin authorization tests.
    /// </summary>
    protected async Task AuthenticateAsPlatformSuperAdminAsync()
    {
        var email = $"platform-super-{Guid.NewGuid():N}@test.com";
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Users.Add(new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Platform",
                LastName = "Super",
                Role = "member",
                IsAdmin = false,
                IsSuperAdmin = true,
                IsTenantSuperAdmin = false,
                IsGod = false,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var token = await GetAccessTokenAsync(email, "test-tenant");
        SetAuthToken(token);
    }

    /// <summary>
    /// Authenticate as a dedicated database-backed god-level administrator.
    /// God-only routes require the explicit persisted flag; role aliases and
    /// ordinary platform-super-admin state must not satisfy that boundary.
    /// </summary>
    protected async Task AuthenticateAsGodAsync()
    {
        var email = $"god-{Guid.NewGuid():N}@test.com";
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Users.Add(new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "God",
                LastName = "Administrator",
                Role = "member",
                IsAdmin = false,
                IsSuperAdmin = false,
                IsTenantSuperAdmin = false,
                IsGod = true,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var token = await GetAccessTokenAsync(email, "test-tenant");
        SetAuthToken(token);
    }
}
