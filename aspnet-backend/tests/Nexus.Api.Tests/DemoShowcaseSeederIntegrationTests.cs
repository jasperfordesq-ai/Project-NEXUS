// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class DemoShowcaseSeederIntegrationTests
{
    private readonly NexusWebApplicationFactory _factory;

    public DemoShowcaseSeederIntegrationTests(NexusWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task SeedAsync_EnrichesMainTenantAndResetsUsersToStrongDemoPassword()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DemoShowcaseSeederTest");

        await SeedData.SeedAsync(db, logger);
        await DemoShowcaseSeedData.SeedAsync(db, logger);

        var acme = await db.Tenants.SingleAsync(t => t.Slug == "acme");
        var users = await db.Users.ToListAsync();

        Assert.All(users, user => Assert.True(BCrypt.Net.BCrypt.Verify(DemoShowcaseSeedData.DemoPassword, user.PasswordHash)));
        Assert.True(await db.Users.CountAsync(u => u.TenantId == acme.Id) >= 8);
        Assert.True(await db.Listings.CountAsync(l => l.TenantId == acme.Id) >= 5);
        Assert.True(await db.BlogPosts.AnyAsync(p => p.TenantId == acme.Id && p.Slug == "project-nexus-v2-demo-showcase"));
        Assert.True(await db.VolunteerOpportunities.AnyAsync(o => o.TenantId == acme.Id && o.Title == "Demo open day welcome team"));
        Assert.True(await db.Organisations.AnyAsync(o => o.TenantId == acme.Id && o.Slug == "acme-community-hub"));
        Assert.True(await db.FileUploads.AnyAsync(f => f.TenantId == acme.Id && f.OriginalFilename == "repair-cafe-workshop.png"));
        Assert.True(await db.FederationPartners.AnyAsync(p => p.TenantId == acme.Id));
    }
}
