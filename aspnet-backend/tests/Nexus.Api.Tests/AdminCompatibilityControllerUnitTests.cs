// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class AdminCompatibilityControllerUnitTests
{
    [Fact]
    public async Task GetUserBadges_ReturnsLaravelStyleBadgeListForCurrentTenantOnly()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);

        var user = new User
        {
            TenantId = 42,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "One",
            Role = "member",
            IsActive = true
        };
        var badge = new Badge
        {
            TenantId = 42,
            Slug = "helpful_neighbor",
            Name = "Helpful Neighbor",
            Description = "Helped another member",
            Icon = "heart",
            IsActive = true
        };
        var otherTenantBadge = new Badge
        {
            TenantId = 7,
            Slug = "other_tenant",
            Name = "Other Tenant",
            IsActive = true
        };

        db.Users.Add(user);
        db.Badges.AddRange(badge, otherTenantBadge);
        await db.SaveChangesAsync();

        db.UserBadges.AddRange(
            new UserBadge
            {
                TenantId = 42,
                UserId = user.Id,
                BadgeId = badge.Id,
                EarnedAt = new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc)
            },
            new UserBadge
            {
                TenantId = 7,
                UserId = user.Id,
                BadgeId = otherTenantBadge.Id,
                EarnedAt = new DateTime(2026, 7, 3, 11, 0, 0, DateTimeKind.Utc)
            });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext);
        var action = typeof(AdminCompatibilityController).GetMethod(
            "GetUserBadges",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel OpenAPI exposes GET /api/v2/admin/users/{id}/badges");
        var resultTask = (Task<IActionResult>)action!.Invoke(controller, new object[] { user.Id })!;
        var result = await resultTask;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data").EnumerateArray().ToArray();

        data.Should().HaveCount(1);
        data[0].GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data[0].GetProperty("badge_id").GetInt32().Should().Be(badge.Id);
        data[0].GetProperty("slug").GetString().Should().Be("helpful_neighbor");
        data[0].GetProperty("name").GetString().Should().Be("Helpful Neighbor");
        data[0].GetProperty("description").GetString().Should().Be("Helped another member");
        data[0].GetProperty("icon").GetString().Should().Be("heart");
        data[0].GetProperty("awarded_at").GetDateTime().Should().Be(new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc));
    }

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }

    private static AdminCompatibilityController CreateController(
        NexusDbContext db,
        TenantContext tenantContext)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = "unit-test-jwt-secret-with-at-least-32-characters"
            })
            .Build();

        return new AdminCompatibilityController(
            db,
            tenantContext,
            config,
            new TokenService(config),
            new NoopEmailService(),
            new GamificationService(db, NullLogger<GamificationService>.Instance),
            new PersonalWalletLedgerService(db, NullLogger<PersonalWalletLedgerService>.Instance),
            new MemoryCache(new MemoryCacheOptions()),
            NullLogger<AdminCompatibilityController>.Instance);
    }

    private sealed class NoopEmailService : IEmailService
    {
        public Task<bool> SendEmailAsync(string to, string subject, string htmlBody, string? textBody = null, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default)
            => Task.FromResult(true);
    }
}
