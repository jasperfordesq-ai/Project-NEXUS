// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class AuditControllerUnitTests
{
    [Fact]
    public async Task ExportCsv_ReturnsTenantScopedFormulaSafeActivityCsv()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);

        var user = new User
        {
            TenantId = 42,
            Email = "admin@example.test",
            PasswordHash = "hash",
            FirstName = "Ada",
            LastName = "Admin",
            Role = "admin",
            IsActive = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        db.AuditLogs.AddRange(
            new AuditLog
            {
                TenantId = 42,
                UserId = user.Id,
                Action = "=danger",
                EntityType = "Listing",
                EntityId = 99,
                Metadata = "+metadata",
                IpAddress = "127.0.0.1",
                CreatedAt = new DateTime(2026, 7, 3, 12, 0, 0, DateTimeKind.Utc)
            },
            new AuditLog
            {
                TenantId = 7,
                Action = "other_tenant",
                EntityType = "User",
                EntityId = 12,
                Metadata = "must not leak",
                CreatedAt = new DateTime(2026, 7, 3, 13, 0, 0, DateTimeKind.Utc)
            });
        await db.SaveChangesAsync();

        var controller = new AuditController(
            new AuditLogService(db, tenantContext, NullLogger<AuditLogService>.Instance),
            NullLogger<AuditController>.Instance);
        var action = typeof(AuditController).GetMethod(
            "ExportCsv",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes GET /api/v2/admin/audit-log/export.csv");
        var resultTask = (Task<IActionResult>)action!.Invoke(
            controller,
            new object?[] { null, null, null, null, null })!;
        var result = await resultTask;

        var file = result.Should().BeOfType<FileContentResult>().Subject;
        file.ContentType.Should().Be("text/csv; charset=utf-8");
        file.FileDownloadName.Should().StartWith("audit-log-activity-");

        var csv = Encoding.UTF8.GetString(file.FileContents);
        csv.Should().StartWith('\uFEFF' + "ID,User ID,User,Action,Action Type,Entity Type,Entity ID,Details,IP Address,Date");
        csv.Should().Contain("Ada Admin");
        csv.Should().Contain("'=danger");
        csv.Should().Contain("'+metadata");
        csv.Should().NotContain("other_tenant");
        csv.Should().NotContain("must not leak");
    }

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }
}
