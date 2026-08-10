// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class VolunteerAttendanceFailureTests
{
    [Fact]
    public async Task VerifyPersistenceFailureReturnsInternalErrorRatherThanFalseNotFound()
    {
        var interceptor = new ThrowingSaveChangesInterceptor();
        var root = new InMemoryDatabaseRoot();
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase($"attendance-failure-{Guid.NewGuid():N}", root)
            .AddInterceptors(interceptor)
            .Options;
        var tenant = new TenantContext();
        tenant.SetTenant(1);
        await using var db = new NexusDbContext(options, tenant);
        const string token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 1,
                Key = AdminVolunteerApprovalService.FeatureConfigKey,
                Value = "true",
                CreatedAt = DateTime.UtcNow
            },
            new TenantConfig
            {
                TenantId = 1,
                Key = VolunteerAttendanceService.QrFeatureConfigKey,
                Value = "true",
                CreatedAt = DateTime.UtcNow
            });
        db.Users.AddRange(
            new User
            {
                Id = 1,
                TenantId = 1,
                Email = "volunteer@attendance.test",
                PasswordHash = "unused",
                FirstName = "Volunteer",
                LastName = "Member",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            },
            new User
            {
                Id = 2,
                TenantId = 1,
                Email = "admin@attendance.test",
                PasswordHash = "unused",
                FirstName = "Attendance",
                LastName = "Admin",
                Role = "admin",
                IsAdmin = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
        db.VolunteerOrganisations.Add(new VolunteerOrganisation
        {
            Id = 10,
            TenantId = 1,
            OwnerUserId = 2,
            Name = "Failure test organisation",
            Slug = "failure-test-organisation",
            Status = "active",
            CreatedAt = DateTime.UtcNow
        });
        db.VolunteerOpportunities.Add(new VolunteerOpportunity
        {
            Id = 20,
            TenantId = 1,
            OrganizerId = 2,
            VolunteerOrganisationId = 10,
            Title = "Failure test opportunity",
            Description = "Persistence failure fixture",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 1,
            CreatedAt = DateTime.UtcNow
        });
        db.VolunteerShifts.Add(new VolunteerShift
        {
            Id = 30,
            TenantId = 1,
            OpportunityId = 20,
            Title = "Failure test shift",
            StartsAt = DateTime.UtcNow.AddMinutes(-5),
            EndsAt = DateTime.UtcNow.AddHours(1),
            MaxVolunteers = 1,
            Status = ShiftStatus.Scheduled,
            CreatedAt = DateTime.UtcNow
        });
        db.VolunteerCheckIns.Add(new VolunteerCheckIn
        {
            Id = 40,
            TenantId = 1,
            ShiftId = 30,
            UserId = 1,
            QrToken = token,
            Status = "pending",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        interceptor.Throw = true;
        var service = new VolunteerAttendanceService(
            db,
            NullLogger<VolunteerAttendanceService>.Instance);

        var result = await service.VerifyAsync(1, 2, token);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().NotBeNull();
        result.Error!.StatusCode.Should().Be(500);
        result.Error.Code.Should().Be("INTERNAL_ERROR");
    }

    private sealed class ThrowingSaveChangesInterceptor : SaveChangesInterceptor
    {
        public bool Throw { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Throw)
            {
                throw new DbUpdateException("Simulated attendance persistence failure");
            }

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }
}
