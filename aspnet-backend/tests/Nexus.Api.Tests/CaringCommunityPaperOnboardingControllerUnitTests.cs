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
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityPaperOnboardingControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelPaperOnboardingRoutes()
    {
        typeof(AdminCaringCommunityPaperOnboardingController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");

        typeof(AdminCaringCommunityPaperOnboardingController)
            .GetMethod(nameof(AdminCaringCommunityPaperOnboardingController.List))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("paper-onboarding");

        typeof(AdminCaringCommunityPaperOnboardingController)
            .GetMethod(nameof(AdminCaringCommunityPaperOnboardingController.Upload))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("paper-onboarding");

        typeof(AdminCaringCommunityPaperOnboardingController)
            .GetMethod(nameof(AdminCaringCommunityPaperOnboardingController.Confirm))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("paper-onboarding/{id:int}/confirm");
    }

    [Fact]
    public async Task List_ReturnsTenantScopedFilteredRowsWithLaravelEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedIntakes(db);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant);

        var data = ReadData(await controller.List("all", 1000, CancellationToken.None));

        data.GetProperty("count").GetInt32().Should().Be(2);
        var items = data.GetProperty("items").EnumerateArray().ToArray();
        items.Select(row => row.GetProperty("id").GetInt64()).Should().Equal(101, 100);
        items[0].GetProperty("status").GetString().Should().Be("confirmed");
        items[0].GetProperty("document_available").GetBoolean().Should().BeFalse();
        items[1].GetProperty("extracted_fields").GetProperty("name").GetString().Should().Be("Ada Lovelace");

        var pending = ReadData(await controller.List("unexpected", 20, CancellationToken.None));
        pending.GetProperty("count").GetInt32().Should().Be(1);
        pending.GetProperty("items")[0].GetProperty("status").GetString().Should().Be("pending_review");
    }

    [Fact]
    public async Task Upload_PersistsDocumentAndSeedFieldsForManualReview()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var uploadRoot = CreateUploadRoot();
        var controller = CreateController(db, tenant, uploadRoot);
        var file = CreateFormFile("kiss-consent.pdf", "application/pdf", "paper form"u8.ToArray());

        var result = await controller.Upload(
            file,
            "  Ada Lovelace  ",
            "1930-01-01",
            "  10 Example Street  ",
            " +31 20 123 4567 ",
            " ADA@EXAMPLE.TEST ",
            CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);

        var data = ReadData(result);
        data.GetProperty("status").GetString().Should().Be("pending_review");
        data.GetProperty("original_filename").GetString().Should().Be("kiss-consent.pdf");
        data.GetProperty("mime_type").GetString().Should().Be("application/pdf");
        data.GetProperty("ocr_provider").GetString().Should().Be("manual_review_stub");
        data.GetProperty("document_available").GetBoolean().Should().BeTrue();
        data.GetProperty("extracted_fields").GetProperty("name").GetString().Should().Be("Ada Lovelace");
        data.GetProperty("extracted_fields").GetProperty("email").GetString().Should().Be("ADA@EXAMPLE.TEST");

        var stored = await db.CaringPaperOnboardingIntakes.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.UploadedBy.Should().Be(9001);
        stored.StoredPath.Should().StartWith("caring-paper-onboarding/42/");
        File.Exists(Path.Combine(uploadRoot, stored.StoredPath.Replace('/', Path.DirectorySeparatorChar))).Should().BeTrue();
    }

    [Theory]
    [InlineData(null, "VALIDATION_ERROR")]
    [InlineData("text/plain", "VALIDATION_ERROR")]
    public async Task Upload_RejectsMissingOrUnsupportedFiles(string? contentType, string code)
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant);
        var file = contentType is null
            ? null
            : CreateFormFile("paper.txt", contentType, "plain"u8.ToArray());

        AssertSingleError(
            await controller.Upload(file, null, null, null, null, null, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            code,
            "file");
    }

    [Fact]
    public async Task Confirm_CreatesTenantMemberAndMarksIntakeConfirmed()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedIntakes(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Confirm(
            100,
            new CaringPaperOnboardingConfirmRequest
            {
                Name = "  Grace Hopper  ",
                DateOfBirth = "1906-12-09",
                Address = "  11 Navy Road  ",
                Phone = " +1 555 0100 ",
                Email = " GRACE.PAPER@EXAMPLE.TEST ",
                Note = " reviewed in person "
            },
            CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);

        var data = ReadData(result);
        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("temp_password").GetString().Should().HaveLength(16);
        data.GetProperty("user").GetProperty("name").GetString().Should().Be("Grace Hopper");
        data.GetProperty("user").GetProperty("email").GetString().Should().Be("grace.paper@example.test");
        data.GetProperty("intake").GetProperty("status").GetString().Should().Be("confirmed");
        data.GetProperty("intake").GetProperty("corrected_fields").GetProperty("email").GetString().Should().Be("grace.paper@example.test");

        var stored = await db.CaringPaperOnboardingIntakes.IgnoreQueryFilters().SingleAsync(row => row.Id == 100);
        stored.Status.Should().Be("confirmed");
        stored.ReviewedBy.Should().Be(9001);
        stored.CreatedUserId.Should().NotBeNull();
        stored.CoordinatorNotes.Should().Be("reviewed in person");
        stored.ConfirmedAt.Should().NotBeNull();

        var user = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Email == "grace.paper@example.test");
        user.TenantId.Should().Be(42);
        user.FirstName.Should().Be("Grace");
        user.LastName.Should().Be("Hopper");
        user.Role.Should().Be(Role.Names.Member);
        BCrypt.Net.BCrypt.Verify(data.GetProperty("temp_password").GetString(), user.PasswordHash).Should().BeTrue();
    }

    [Fact]
    public async Task Confirm_ReturnsLaravelErrorsForMissingReviewedInvalidAndDuplicateRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedIntakes(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await controller.Confirm(404, ValidConfirmRequest(), CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND");

        AssertSingleError(
            await controller.Confirm(101, ValidConfirmRequest(), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "ALREADY_REVIEWED");

        AssertSingleError(
            await controller.Confirm(100, new CaringPaperOnboardingConfirmRequest { Name = "No Email" }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await controller.Confirm(100, new CaringPaperOnboardingConfirmRequest
            {
                Name = "Existing Member",
                Email = "member@example.test"
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "EMAIL_EXISTS");
    }

    [Fact]
    public async Task Endpoints_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await controller.List("all", 20, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    private static CaringPaperOnboardingConfirmRequest ValidConfirmRequest() => new()
    {
        Name = "Valid Member",
        Email = "valid.member@example.test"
    };

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static void SeedUsers(NexusDbContext db)
    {
        db.Users.AddRange(
            new User
            {
                Id = 11,
                TenantId = 42,
                FirstName = "Existing",
                LastName = "Member",
                Email = "member@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Tenant",
                Email = "other@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            });
    }

    private static void SeedIntakes(NexusDbContext db)
    {
        db.CaringPaperOnboardingIntakes.AddRange(
            new CaringPaperOnboardingIntake
            {
                Id = 100,
                TenantId = 42,
                UploadedBy = 9001,
                Status = "pending_review",
                OriginalFilename = "ada.pdf",
                StoredPath = "missing/ada.pdf",
                MimeType = "application/pdf",
                FileSize = 123,
                OcrProvider = "manual_review_stub",
                ExtractedFields = "{\"name\":\"Ada Lovelace\",\"email\":\"ada@example.test\"}",
                CreatedAt = new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)
            },
            new CaringPaperOnboardingIntake
            {
                Id = 101,
                TenantId = 42,
                UploadedBy = 9001,
                ReviewedBy = 9001,
                CreatedUserId = 11,
                Status = "confirmed",
                OriginalFilename = "confirmed.pdf",
                StoredPath = "missing/confirmed.pdf",
                MimeType = "application/pdf",
                FileSize = 456,
                OcrProvider = "manual_review_stub",
                CorrectedFields = "{\"name\":\"Existing Member\"}",
                CreatedAt = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc),
                ConfirmedAt = new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc)
            },
            new CaringPaperOnboardingIntake
            {
                Id = 200,
                TenantId = 7,
                UploadedBy = 70,
                Status = "pending_review",
                OriginalFilename = "other.pdf",
                StoredPath = "missing/other.pdf",
                MimeType = "application/pdf",
                FileSize = 789,
                OcrProvider = "manual_review_stub",
                CreatedAt = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)
            });
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(
        IActionResult result,
        int statusCode,
        string code,
        string? field = null)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be(code);
        if (field is not null)
        {
            error.GetProperty("field").GetString().Should().Be(field);
        }
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

    private static AdminCaringCommunityPaperOnboardingController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        string? uploadRoot = null)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CaringCommunity:PaperOnboardingRoot"] = uploadRoot ?? CreateUploadRoot()
            })
            .Build();

        return new AdminCaringCommunityPaperOnboardingController(
            new PaperOnboardingIntakeService(db, config),
            tenant)
        {
            ControllerContext = ControllerContextFor(userId: 9001, tenant.GetTenantIdOrThrow())
        };
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, "admin"),
                    new Claim("role", "admin")
                ], "Test"))
            }
        };
    }

    private static IFormFile CreateFormFile(string fileName, string contentType, byte[] bytes)
    {
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };
    }

    private static string CreateUploadRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), "nexus-paper-onboarding-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }
}
