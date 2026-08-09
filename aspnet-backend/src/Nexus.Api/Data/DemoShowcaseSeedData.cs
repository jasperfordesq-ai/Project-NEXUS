// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data;

/// <summary>
/// Local-development showcase data for Project NEXUS .NET Edition.
/// This enriches the main tenant after the baseline seed has run and is hard-blocked in Production.
/// </summary>
public static class DemoShowcaseSeedData
{
    public const string DemoPassword = "NexusV2!Demo#2026";

    private const int MainTenantId = 1;
    private const string MainTenantSlug = "acme";
    private const string AssetBaseUrl = "/demo-assets";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task SeedAsync(NexusDbContext db, ILogger logger, IWebHostEnvironment? env = null, bool allowProduction = false)
    {
        if (env != null && env.IsProduction() && !allowProduction)
        {
            logger.LogWarning("DemoShowcaseSeedData.SeedAsync called in Production environment - aborted.");
            return;
        }

        logger.LogInformation("Seeding Project NEXUS .NET Edition demo showcase data...");

        var now = DateTime.UtcNow;
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(DemoPassword);

        var mainTenant = await EnsureAsync(
            db,
            t => t.Slug == MainTenantSlug,
            () => new Tenant
            {
                Slug = MainTenantSlug,
                Name = "ACME Community Timebank",
                Tagline = "A full Project NEXUS .NET Edition demo tenant",
                Domain = "acme.localhost",
                LogoUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png",
                IsActive = true,
                CreatedAt = now.AddDays(-180)
            },
            t =>
            {
                t.Name = "ACME Community Timebank";
                t.Tagline = "A full Project NEXUS .NET Edition demo tenant";
                t.Domain ??= "acme.localhost";
                t.LogoUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png";
                t.IsActive = true;
                t.UpdatedAt = now;
            });

        var globexTenant = await EnsureAsync(
            db,
            t => t.Slug == "globex",
            () => new Tenant
            {
                Slug = "globex",
                Name = "Globex Neighbourhood Network",
                Tagline = "Federation partner tenant",
                Domain = "globex.localhost",
                IsActive = true,
                CreatedAt = now.AddDays(-150)
            },
            t =>
            {
                t.Name = "Globex Neighbourhood Network";
                t.Tagline = "Federation partner tenant";
                t.IsActive = true;
            });

        var youthTenant = await EnsureAsync(
            db,
            t => t.Slug == "acme-youth",
            () => new Tenant
            {
                Slug = "acme-youth",
                Name = "ACME Youth Programme",
                Tagline = "Managed child tenant for youth activities",
                Domain = "youth.acme.localhost",
                IsActive = true,
                CreatedAt = now.AddDays(-120)
            });

        var admin = await EnsureUserAsync(db, mainTenant.Id, "admin@acme.test", "Alice", "Admin", "admin", passwordHash, now, "Platform owner and demo admin.", $"{AssetBaseUrl}/community-operations-table.png");
        var member = await EnsureUserAsync(db, mainTenant.Id, "member@acme.test", "Charlie", "Contributor", "member", passwordHash, now, "Handy neighbour offering repairs, gardening and mentoring.", $"{AssetBaseUrl}/repair-cafe-workshop.png");
        var coordinator = await EnsureUserAsync(db, mainTenant.Id, "coordinator@acme.test", "Maya", "Coordinator", "member", passwordHash, now, "Community coordinator for events, volunteering and onboarding.", $"{AssetBaseUrl}/community-garden-planning.png");
        var broker = await EnsureUserAsync(db, mainTenant.Id, "broker@acme.test", "Ravi", "Broker", "admin", passwordHash, now, "Broker user for supported exchanges, safeguarding and vetting workflows.", $"{AssetBaseUrl}/community-operations-table.png");
        var volunteer = await EnsureUserAsync(db, mainTenant.Id, "volunteer@acme.test", "Niamh", "Volunteer", "member", passwordHash, now, "Volunteer lead for repair cafe shifts and emergency response.", $"{AssetBaseUrl}/nexus-v2-community-hub.png");
        var orgOwner = await EnsureUserAsync(db, mainTenant.Id, "organisation@acme.test", "Owen", "Organisation", "member", passwordHash, now, "Organisation owner account for charity and partner workflows.", $"{AssetBaseUrl}/community-operations-table.png");
        var guardian = await EnsureUserAsync(db, mainTenant.Id, "guardian@acme.test", "Grace", "Guardian", "member", passwordHash, now, "Guardian account used to demo sub-account and safeguarding controls.", $"{AssetBaseUrl}/community-garden-planning.png");
        var youth = await EnsureUserAsync(db, mainTenant.Id, "youth@acme.test", "Sam", "Youth", "member", passwordHash, now, "Managed youth profile for family and consent workflows.", $"{AssetBaseUrl}/nexus-v2-community-hub.png");
        var globexAdmin = await EnsureUserAsync(db, globexTenant.Id, "admin@globex.test", "Bob", "Boss", "admin", passwordHash, now, "Federation partner admin.", $"{AssetBaseUrl}/community-operations-table.png");

        await EnsureAllUsersHaveDemoPasswordAsync(db, passwordHash, now);

        var categories = await SeedCategoriesAndRolesAsync(db, mainTenant.Id, now);
        var repairCategory = categories["repair"];
        var gardenCategory = categories["gardening"];
        var careCategory = categories["care"];
        var techCategory = categories["technology"];

        await SeedTenantSettingsAsync(db, mainTenant.Id, admin.Id, youthTenant.Id, now);
        await SeedRegistrationAndSecurityAsync(db, mainTenant.Id, admin.Id, member.Id, now);

        var listings = await SeedMarketplaceAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, volunteer.Id, repairCategory.Id, gardenCategory.Id, careCategory.Id, techCategory.Id, now);
        var repairListing = listings["repair"];
        var gardenListing = listings["garden"];
        var companionshipListing = listings["companionship"];

        await SeedWalletAndExchangesAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, volunteer.Id, repairListing.Id, gardenListing.Id, now);

        var conversation = await SeedMessagingAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, now);
        await SeedFilesAsync(db, env, mainTenant.Id, admin.Id, repairListing.Id, conversation.Id, now);

        var group = await SeedGroupsAndEventsAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, volunteer.Id, gardenCategory.Id, now);
        var feedPost = await SeedFeedAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, volunteer.Id, group.Id, now);

        await SeedGamificationAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, volunteer.Id, now);
        await SeedSkillsMatchingAndSearchAsync(db, mainTenant.Id, member.Id, coordinator.Id, volunteer.Id, repairListing.Id, gardenListing.Id, group.Id, feedPost.Id, now);
        await SeedVolunteeringAndStaffingAsync(db, mainTenant.Id, coordinator.Id, volunteer.Id, member.Id, group.Id, careCategory.Id, now);
        await SeedContentAndCommsAsync(db, mainTenant.Id, admin.Id, coordinator.Id, member.Id, now);
        await SeedOrganisationsAndSubscriptionsAsync(db, mainTenant.Id, admin.Id, orgOwner.Id, coordinator.Id, now);
        await SeedOnboardingGoalsPollsAndIdeasAsync(db, mainTenant.Id, admin.Id, member.Id, coordinator.Id, group.Id, now);
        await SeedComplianceAdminAndSafetyAsync(db, mainTenant.Id, admin.Id, broker.Id, member.Id, coordinator.Id, guardian.Id, youth.Id, repairListing.Id, conversation.Id, now);
        await SeedFederationAndAutomationAsync(db, mainTenant.Id, globexTenant.Id, admin.Id, globexAdmin.Id, member.Id, repairListing.Id, now);

        logger.LogInformation(
            "Project NEXUS .NET Edition demo showcase seed complete for tenant {TenantSlug}. Demo users share a shared local password (see DemoShowcaseSeedData source).",
            mainTenant.Slug);
    }

    private static async Task<Dictionary<string, Category>> SeedCategoriesAndRolesAsync(NexusDbContext db, int tenantId, DateTime now)
    {
        var categories = new Dictionary<string, Category>();
        var specs = new[]
        {
            ("repair", "Repair Cafe", "Bike, appliance, clothing and household repairs", "repair-cafe", 1),
            ("gardening", "Community Gardening", "Gardens, food growing, biodiversity and outdoor skills", "community-gardening", 2),
            ("care", "Care & Companionship", "Neighbourly check-ins, accessibility support and social connection", "care-companionship", 3),
            ("technology", "Digital Inclusion", "Device setup, forms, online services and accessibility tech", "digital-inclusion", 4),
            ("arts", "Arts & Culture", "Creative workshops, local history and community storytelling", "arts-culture", 5)
        };

        foreach (var (key, name, description, slug, order) in specs)
        {
            categories[key] = await EnsureAsync(
                db,
                c => c.TenantId == tenantId && c.Slug == slug,
                () => new Category
                {
                    TenantId = tenantId,
                    Name = name,
                    Description = description,
                    Slug = slug,
                    SortOrder = order,
                    IsActive = true,
                    CreatedAt = now.AddDays(-90)
                },
                c =>
                {
                    c.Name = name;
                    c.Description = description;
                    c.SortOrder = order;
                    c.IsActive = true;
                });
        }

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.Name == Role.Names.Admin,
            () => new Role
            {
                TenantId = tenantId,
                Name = Role.Names.Admin,
                Description = "Full administrative access",
                Permissions = "[\"admin.*\",\"users.*\",\"listings.*\",\"config.*\",\"demo.*\"]",
                IsSystem = true,
                CreatedAt = now
            });

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.Name == Role.Names.Member,
            () => new Role
            {
                TenantId = tenantId,
                Name = Role.Names.Member,
                Description = "Standard community member access",
                Permissions = "[\"listings.read\",\"listings.create\",\"messages.*\",\"profile.*\",\"events.*\"]",
                IsSystem = true,
                CreatedAt = now
            });

        return categories;
    }

    private static async Task SeedTenantSettingsAsync(NexusDbContext db, int tenantId, int adminId, int youthTenantId, DateTime now)
    {
        var configs = new (string Key, string Value)[]
        {
            ("demo.version", "2"),
            ("demo.password", DemoPassword),
            ("theme.primaryColor", "#0F766E"),
            ("theme.accentColor", "#D97706"),
            ("features.aiAssistant", "true"),
            ("features.federation", "true"),
            ("features.passkeys", "true"),
            ("features.totp", "true"),
            ("features.voiceMessages", "true"),
            ("features.shiftManagement", "true"),
            ("moderation.requireApproval", "false"),
            ("limits.maxListingsPerUser", "100")
        };

        foreach (var (key, value) in configs)
        {
            await EnsureAsync(
                db,
                c => c.TenantId == tenantId && c.Key == key,
                () => new TenantConfig { TenantId = tenantId, Key = key, Value = value, CreatedAt = now },
                c =>
                {
                    c.Value = value;
                    c.UpdatedAt = now;
                });
        }

        await EnsureAsync(
            db,
            h => h.ParentTenantId == tenantId && h.ChildTenantId == youthTenantId,
            () => new TenantHierarchy
            {
                ParentTenantId = tenantId,
                ChildTenantId = youthTenantId,
                InheritanceMode = "config-and-safeguarding",
                IsActive = true,
                CreatedAt = now.AddDays(-30)
            });

        await EnsureAsync(
            db,
            s => s.Key == "demo_showcase_enabled",
            () => new SystemSetting
            {
                Key = "demo_showcase_enabled",
                Value = "true",
                Description = "Enables local Project NEXUS .NET Edition showcase data.",
                Category = "demo",
                UpdatedById = adminId,
                UpdatedAt = now,
                CreatedAt = now
            },
            s =>
            {
                s.Value = "true";
                s.UpdatedById = adminId;
                s.UpdatedAt = now;
            });
    }

    private static async Task SeedRegistrationAndSecurityAsync(NexusDbContext db, int tenantId, int adminId, int memberId, DateTime now)
    {
        await EnsureAsync(
            db,
            p => p.TenantId == tenantId,
            () => new TenantRegistrationPolicy
            {
                TenantId = tenantId,
                Mode = RegistrationMode.VerifiedIdentity,
                Provider = VerificationProvider.Mock,
                VerificationLevel = VerificationLevel.DocumentAndSelfie,
                PostVerificationAction = PostVerificationAction.SendToAdminForApproval,
                IsActive = true,
                RegistrationMessage = "Demo tenant uses verified identity plus admin approval for high-trust exchanges.",
                InviteCode = "NEXUS-V2-DEMO",
                MaxInviteUses = 500,
                UpdatedByUserId = adminId,
                CreatedAt = now.AddDays(-80),
                UpdatedAt = now
            },
            p =>
            {
                p.Mode = RegistrationMode.VerifiedIdentity;
                p.Provider = VerificationProvider.Mock;
                p.VerificationLevel = VerificationLevel.DocumentAndSelfie;
                p.PostVerificationAction = PostVerificationAction.SendToAdminForApproval;
                p.RegistrationMessage = "Demo tenant uses verified identity plus admin approval for high-trust exchanges.";
                p.InviteCode = "NEXUS-V2-DEMO";
                p.MaxInviteUses = 500;
                p.IsActive = true;
                p.UpdatedByUserId = adminId;
                p.UpdatedAt = now;
            });

        var session = await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserId == memberId && s.ExternalSessionId == "demo-identity-charlie",
            () => new IdentityVerificationSession
            {
                TenantId = tenantId,
                UserId = memberId,
                Provider = VerificationProvider.Mock,
                Level = VerificationLevel.DocumentAndSelfie,
                Status = VerificationSessionStatus.Completed,
                ExternalSessionId = "demo-identity-charlie",
                ProviderDecision = "approved",
                DecisionReason = "Demo verification passed",
                ConfidenceScore = 0.97,
                ExpiresAt = now.AddDays(30),
                CompletedAt = now.AddDays(-20),
                CreatedAt = now.AddDays(-20)
            });

        await EnsureAsync(
            db,
            e => e.TenantId == tenantId && e.SessionId == session.Id && e.EventType == "session.completed",
            () => new IdentityVerificationEvent
            {
                TenantId = tenantId,
                SessionId = session.Id,
                EventType = "session.completed",
                PreviousStatus = VerificationSessionStatus.InProgress,
                NewStatus = VerificationSessionStatus.Completed,
                Metadata = JsonSerializer.Serialize(new { source = "demo", decision = "approved" }, JsonOptions),
                ActorUserId = adminId,
                CreatedAt = now.AddDays(-20)
            });

        await EnsureAsync(
            db,
            k => k.TenantId == tenantId && k.UserId == memberId && k.DisplayName == "Demo platform passkey",
            () => new UserPasskey
            {
                TenantId = tenantId,
                UserId = memberId,
                CredentialId = SHA256.HashData(Encoding.UTF8.GetBytes("demo-passkey-credential")),
                PublicKey = SHA256.HashData(Encoding.UTF8.GetBytes("demo-passkey-public-key")),
                UserHandle = SHA256.HashData(Encoding.UTF8.GetBytes($"demo-passkey-user-{memberId}")),
                SignCount = 12,
                CredType = "public-key",
                AaGuid = Guid.Parse("11111111-2222-3333-4444-555555555555"),
                DisplayName = "Demo platform passkey",
                Transports = "internal,hybrid",
                IsDiscoverable = true,
                CreatedAt = now.AddDays(-18),
                LastUsedAt = now.AddDays(-2)
            });

        await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.UserId == memberId && c.IsUsed,
            () => new TotpBackupCode
            {
                TenantId = tenantId,
                UserId = memberId,
                CodeHash = BCrypt.Net.BCrypt.HashPassword("NEXUS-USED-BACKUP"),
                IsUsed = true,
                UsedAt = now.AddDays(-3),
                CreatedAt = now.AddDays(-30)
            });

        await EnsureAsync(
            db,
            t => t.TenantId == tenantId && t.UserId == memberId && t.Token == "demo-email-verification-token",
            () => new EmailVerificationToken
            {
                TenantId = tenantId,
                UserId = memberId,
                Token = "demo-email-verification-token",
                Email = "member@acme.test",
                IsUsed = true,
                ExpiresAt = now.AddDays(14),
                CreatedAt = now.AddDays(-40)
            });

        await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserId == adminId && s.SessionToken == "demo-admin-session",
            () => new UserSession
            {
                TenantId = tenantId,
                UserId = adminId,
                SessionToken = "demo-admin-session",
                IpAddress = "127.0.0.1",
                UserAgent = "Project NEXUS demo browser",
                DeviceInfo = "Chrome on Windows",
                IsActive = true,
                LastActivityAt = now.AddMinutes(-15),
                ExpiresAt = now.AddDays(7),
                CreatedAt = now.AddDays(-1)
            });
    }

    private static async Task<Dictionary<string, Listing>> SeedMarketplaceAsync(
        NexusDbContext db,
        int tenantId,
        int adminId,
        int memberId,
        int coordinatorId,
        int volunteerId,
        int repairCategoryId,
        int gardenCategoryId,
        int careCategoryId,
        int techCategoryId,
        DateTime now)
    {
        var repair = await EnsureListingAsync(db, tenantId, memberId, "Repair Cafe: bike and small appliance help", "Bring a bike, lamp or toaster and Charlie will help you diagnose and repair it safely.", ListingType.Offer, repairCategoryId, "Community Workshop", 2.0m, true, 328, now.AddDays(-40));
        var garden = await EnsureListingAsync(db, tenantId, coordinatorId, "Raised bed planning and seedling swap", "Help planning a community food-growing bed, with seedlings available for new growers.", ListingType.Offer, gardenCategoryId, "Community Garden", 1.5m, true, 211, now.AddDays(-35));
        var companionship = await EnsureListingAsync(db, tenantId, volunteerId, "Weekly check-in companion for older residents", "Friendly visits and phone check-ins coordinated through the volunteer team.", ListingType.Offer, careCategoryId, "Neighbourhood-wide", 1.0m, true, 187, now.AddDays(-24));
        var tech = await EnsureListingAsync(db, tenantId, adminId, "Digital forms and phone setup support", "Patient one-to-one help with online forms, accessibility settings and passkeys.", ListingType.Offer, techCategoryId, "Library Digital Room", 1.0m, false, 144, now.AddDays(-18));
        var request = await EnsureListingAsync(db, tenantId, coordinatorId, "Request: volunteers for accessibility audit", "We need two members to walk the route from the bus stop to the hub and record barriers.", ListingType.Request, careCategoryId, "Town Centre", 2.5m, true, 92, now.AddDays(-8));

        foreach (var (listing, tags) in new[]
        {
            (repair, new[] { "repair", "bike", "appliance", "reuse" }),
            (garden, new[] { "garden", "food", "outdoors" }),
            (companionship, new[] { "care", "companionship", "safeguarded" }),
            (tech, new[] { "digital", "passkeys", "accessibility" }),
            (request, new[] { "accessibility", "audit", "volunteering" })
        })
        {
            await EnsureAsync(
                db,
                a => a.TenantId == tenantId && a.ListingId == listing.Id,
                () => new ListingAnalytics
                {
                    TenantId = tenantId,
                    ListingId = listing.Id,
                    ViewCount = listing.ViewCount,
                    UniqueViewCount = Math.Max(20, listing.ViewCount / 3),
                    ContactCount = 8,
                    FavoriteCount = 5,
                    ShareCount = 3,
                    LastViewedAt = now.AddHours(-4),
                    CreatedAt = now.AddDays(-10)
                });

            foreach (var tag in tags)
            {
                await EnsureAsync(
                    db,
                    lt => lt.TenantId == tenantId && lt.ListingId == listing.Id && lt.Tag == tag,
                    () => new ListingTag
                    {
                        TenantId = tenantId,
                        ListingId = listing.Id,
                        Tag = tag,
                        TagType = tag == "safeguarded" ? "risk" : "skill",
                        CreatedAt = now.AddDays(-10)
                    });
            }
        }

        await EnsureAsync(
            db,
            f => f.TenantId == tenantId && f.ListingId == repair.Id && f.UserId == coordinatorId,
            () => new ListingFavorite { TenantId = tenantId, ListingId = repair.Id, UserId = coordinatorId, CreatedAt = now.AddDays(-5) });

        return new Dictionary<string, Listing>
        {
            ["repair"] = repair,
            ["garden"] = garden,
            ["companionship"] = companionship,
            ["tech"] = tech,
            ["accessibility"] = request
        };
    }

    private static async Task SeedWalletAndExchangesAsync(NexusDbContext db, int tenantId, int adminId, int memberId, int coordinatorId, int volunteerId, int repairListingId, int gardenListingId, DateTime now)
    {
        foreach (var (name, color, icon) in new[]
        {
            ("Exchange Credits", "#0F766E", "clock"),
            ("Community Fund", "#D97706", "heart"),
            ("Volunteer Rewards", "#2563EB", "badge")
        })
        {
            await EnsureAsync(
                db,
                c => c.TenantId == tenantId && c.Name == name,
                () => new TransactionCategory
                {
                    TenantId = tenantId,
                    Name = name,
                    Description = $"Demo wallet category for {name.ToLowerInvariant()}.",
                    Color = color,
                    Icon = icon,
                    IsDefault = true,
                    CreatedAt = now.AddDays(-60)
                });
        }

        await EnsureAsync(
            db,
            l => l.TenantId == tenantId && l.UserId == null,
            () => new TransactionLimit
            {
                TenantId = tenantId,
                MaxDailyAmount = 24,
                MaxSingleAmount = 8,
                MaxDailyTransactions = 10,
                MinBalance = -5,
                IsActive = true,
                CreatedAt = now.AddDays(-50)
            });

        var seedGrant = await EnsureAsync(
            db,
            t => t.TenantId == tenantId && t.Description == "Demo opening balance grant",
            () => new Transaction
            {
                TenantId = tenantId,
                SenderId = adminId,
                ReceiverId = memberId,
                Amount = 20,
                Description = "Demo opening balance grant",
                Status = TransactionStatus.Completed,
                CreatedAt = now.AddDays(-45)
            });

        var exchangePayment = await EnsureAsync(
            db,
            t => t.TenantId == tenantId && t.Description == "Demo repair cafe exchange payment",
            () => new Transaction
            {
                TenantId = tenantId,
                SenderId = coordinatorId,
                ReceiverId = memberId,
                Amount = 2,
                Description = "Demo repair cafe exchange payment",
                ListingId = repairListingId,
                Status = TransactionStatus.Completed,
                CreatedAt = now.AddDays(-12)
            });

        var donationTx = await EnsureAsync(
            db,
            t => t.TenantId == tenantId && t.Description == "Demo donation to community fund",
            () => new Transaction
            {
                TenantId = tenantId,
                SenderId = memberId,
                ReceiverId = adminId,
                Amount = 3,
                Description = "Demo donation to community fund",
                Status = TransactionStatus.Completed,
                CreatedAt = now.AddDays(-7)
            });

        await EnsureAsync(
            db,
            d => d.TenantId == tenantId && d.TransactionId == donationTx.Id,
            () => new CreditDonation
            {
                TenantId = tenantId,
                DonorId = memberId,
                RecipientId = null,
                Amount = 3,
                Message = "Keeping the repair cafe stocked with parts.",
                TransactionId = donationTx.Id,
                IsAnonymous = false,
                CreatedAt = now.AddDays(-7)
            });

        await EnsureAsync(
            db,
            a => a.TenantId == tenantId && a.UserId == volunteerId,
            () => new BalanceAlert
            {
                TenantId = tenantId,
                UserId = volunteerId,
                ThresholdAmount = 2,
                IsActive = true,
                CreatedAt = now.AddDays(-20)
            });

        var completedExchange = await EnsureAsync(
            db,
            e => e.TenantId == tenantId && e.ListingId == repairListingId && e.InitiatorId == coordinatorId,
            () => new Exchange
            {
                TenantId = tenantId,
                ListingId = repairListingId,
                InitiatorId = coordinatorId,
                ListingOwnerId = memberId,
                ProviderId = memberId,
                ReceiverId = coordinatorId,
                Status = ExchangeStatus.Completed,
                AgreedHours = 2,
                ActualHours = 2,
                RequestMessage = "Can you help fix two bikes before the family cycling day?",
                Notes = "Completed at the repair cafe.",
                ScheduledAt = now.AddDays(-13),
                StartedAt = now.AddDays(-12).AddHours(-2),
                CompletedAt = now.AddDays(-12),
                TransactionId = exchangePayment.Id,
                CreatedAt = now.AddDays(-14),
                UpdatedAt = now.AddDays(-12)
            });

        await EnsureAsync(
            db,
            e => e.TenantId == tenantId && e.ListingId == gardenListingId && e.InitiatorId == volunteerId,
            () => new Exchange
            {
                TenantId = tenantId,
                ListingId = gardenListingId,
                InitiatorId = volunteerId,
                ListingOwnerId = coordinatorId,
                ProviderId = coordinatorId,
                ReceiverId = volunteerId,
                Status = ExchangeStatus.InProgress,
                AgreedHours = 1.5m,
                RequestMessage = "I would like help planning a pollinator bed.",
                ScheduledAt = now.AddDays(3),
                CreatedAt = now.AddDays(-2),
                UpdatedAt = now.AddDays(-1)
            });

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.ExchangeId == completedExchange.Id && r.RaterId == coordinatorId,
            () => new ExchangeRating
            {
                TenantId = tenantId,
                ExchangeId = completedExchange.Id,
                RaterId = coordinatorId,
                RatedUserId = memberId,
                Rating = 5,
                Comment = "Clear, patient and practical. Both bikes are road-ready.",
                WouldWorkAgain = true,
                CreatedAt = now.AddDays(-11)
            });

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.ReviewerId == coordinatorId && r.TargetListingId == repairListingId,
            () => new Review
            {
                TenantId = tenantId,
                ReviewerId = coordinatorId,
                TargetListingId = repairListingId,
                Rating = 5,
                Comment = "A brilliant repair cafe demo listing.",
                CreatedAt = now.AddDays(-11)
            });
    }

    private static async Task<Conversation> SeedMessagingAsync(NexusDbContext db, int tenantId, int adminId, int memberId, int coordinatorId, DateTime now)
    {
        var conversation = await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.Participant1Id == memberId && c.Participant2Id == coordinatorId,
            () => new Conversation
            {
                TenantId = tenantId,
                Participant1Id = memberId,
                Participant2Id = coordinatorId,
                CreatedAt = now.AddDays(-9),
                UpdatedAt = now.AddHours(-3)
            });

        await EnsureMessageAsync(db, tenantId, conversation.Id, coordinatorId, "Could you bring the puncture repair kit to Saturday's repair cafe?", true, now.AddDays(-9));
        await EnsureMessageAsync(db, tenantId, conversation.Id, memberId, "Yes, and I can also do a quick handover for new volunteers.", true, now.AddDays(-9).AddMinutes(12));
        await EnsureMessageAsync(db, tenantId, conversation.Id, coordinatorId, "Perfect. I will add the checklist to the event resources.", false, now.AddHours(-3));

        await EnsureAsync(
            db,
            n => n.TenantId == tenantId && n.UserId == memberId && n.Type == Notification.Types.MessageReceived && n.Title == "New repair cafe message",
            () => new Notification
            {
                TenantId = tenantId,
                UserId = memberId,
                Type = Notification.Types.MessageReceived,
                Title = "New repair cafe message",
                Body = "Maya sent an update about the Saturday repair cafe.",
                Data = JsonSerializer.Serialize(new { conversation_id = conversation.Id }, JsonOptions),
                IsRead = false,
                CreatedAt = now.AddHours(-3)
            });

        await EnsureAsync(
            db,
            v => v.TenantId == tenantId && v.SenderId == coordinatorId && v.ConversationId == conversation.Id,
            () => new VoiceMessage
            {
                TenantId = tenantId,
                SenderId = coordinatorId,
                ConversationId = conversation.Id,
                AudioUrl = "/demo-assets/voice-message-placeholder.webm",
                DurationSeconds = 34,
                FileSizeBytes = 248000,
                Format = "webm",
                Transcription = "Quick update: the accessibility audit route has changed because of roadworks.",
                IsRead = false,
                CreatedAt = now.AddHours(-2)
            });

        await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.UserId == adminId && c.Title == "Demo AI broker assistant",
            () => new AiConversation
            {
                TenantId = tenantId,
                UserId = adminId,
                Title = "Demo AI broker assistant",
                Context = "Suggest next-best actions for the repair cafe and accessibility audit.",
                TotalTokensUsed = 860,
                IsActive = true,
                LastMessageAt = now.AddHours(-5),
                CreatedAt = now.AddDays(-4)
            });

        var aiConversation = await db.AiConversations.FirstAsync(c => c.TenantId == tenantId && c.UserId == adminId && c.Title == "Demo AI broker assistant");
        await EnsureAsync(
            db,
            m => m.TenantId == tenantId && m.ConversationId == aiConversation.Id && m.Role == "assistant",
            () => new AiMessage
            {
                TenantId = tenantId,
                ConversationId = aiConversation.Id,
                Role = "assistant",
                Content = "Prioritise two new volunteers for Saturday, publish the accessibility route update, and invite the gardening group to cross-post.",
                TokensUsed = 164,
                CreatedAt = now.AddHours(-5)
            });

        return conversation;
    }

    private static async Task SeedFilesAsync(NexusDbContext db, IWebHostEnvironment? env, int tenantId, int userId, int listingId, int conversationId, DateTime now)
    {
        var repairUpload = await EnsureFileUploadAsync(db, env, tenantId, userId, "repair-cafe-workshop.png", FileCategory.Listing, listingId, "listing", now);
        await EnsureFileUploadAsync(db, env, tenantId, userId, "community-garden-planning.png", FileCategory.Event, null, "event", now);
        await EnsureFileUploadAsync(db, env, tenantId, userId, "community-operations-table.png", FileCategory.Document, null, "resource", now);

        var message = await db.Messages
            .Where(m => m.TenantId == tenantId && m.ConversationId == conversationId)
            .OrderByDescending(m => m.CreatedAt)
            .FirstAsync();

        await EnsureAsync(
            db,
            a => a.MessageId == message.Id && a.FileUploadId == repairUpload.Id,
            () => new MessageAttachment
            {
                MessageId = message.Id,
                FileUploadId = repairUpload.Id,
                UploadedById = userId,
                CreatedAt = now.AddHours(-2)
            });
    }

    private static async Task<Group> SeedGroupsAndEventsAsync(NexusDbContext db, int tenantId, int adminId, int memberId, int coordinatorId, int volunteerId, int categoryId, DateTime now)
    {
        var group = await EnsureAsync(
            db,
            g => g.TenantId == tenantId && g.Name == "Community Garden & Repair Collective",
            () => new Group
            {
                TenantId = tenantId,
                CreatedById = coordinatorId,
                Name = "Community Garden & Repair Collective",
                Description = "A public group combining growing, reuse, repair and practical skill-sharing.",
                IsPrivate = false,
                ImageUrl = $"{AssetBaseUrl}/community-garden-planning.png",
                CreatedAt = now.AddDays(-70)
            },
            g =>
            {
                g.ImageUrl = $"{AssetBaseUrl}/community-garden-planning.png";
                g.Description = "A public group combining growing, reuse, repair and practical skill-sharing.";
            });

        foreach (var (userId, role) in new[] { (coordinatorId, Group.Roles.Owner), (memberId, Group.Roles.Admin), (volunteerId, Group.Roles.Member), (adminId, Group.Roles.Admin) })
        {
            await EnsureAsync(
                db,
                gm => gm.TenantId == tenantId && gm.GroupId == group.Id && gm.UserId == userId,
                () => new GroupMember
                {
                    TenantId = tenantId,
                    GroupId = group.Id,
                    UserId = userId,
                    Role = role,
                    JoinedAt = now.AddDays(-68)
                },
                gm => gm.Role = role);
        }

        await EnsureAsync(
            db,
            a => a.TenantId == tenantId && a.GroupId == group.Id && a.Title == "Saturday showcase rota",
            () => new GroupAnnouncement
            {
                TenantId = tenantId,
                GroupId = group.Id,
                AuthorId = coordinatorId,
                Title = "Saturday showcase rota",
                Content = "Repair, garden and digital inclusion tables are all covered. Please confirm your shift.",
                IsPinned = true,
                ExpiresAt = now.AddDays(10),
                CreatedAt = now.AddDays(-2)
            });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.GroupId == group.Id && p.Key == "safe-exchanges",
            () => new GroupPolicy
            {
                TenantId = tenantId,
                GroupId = group.Id,
                Key = "safe-exchanges",
                Value = JsonSerializer.Serialize(new { title = "Safe exchanges", content = "All first meetings happen in public or broker-supported spaces.", isActive = true }, JsonOptions),
                CreatedAt = now.AddDays(-60)
            });

        await EnsureAsync(
            db,
            f => f.TenantId == tenantId && f.GroupId == group.Id && f.FileName == "repair-cafe-checklist.pdf",
            () => new GroupFile
            {
                TenantId = tenantId,
                GroupId = group.Id,
                UploadedById = coordinatorId,
                FileName = "repair-cafe-checklist.pdf",
                FileUrl = "/api/files/demo-repair-cafe-checklist/download",
                FileSizeBytes = 184000,
                ContentType = "application/pdf",
                CreatedAt = now.AddDays(-8)
            });

        var discussion = await EnsureAsync(
            db,
            d => d.TenantId == tenantId && d.GroupId == group.Id && d.Title == "What should the next skill swap cover?",
            () => new GroupDiscussion
            {
                TenantId = tenantId,
                GroupId = group.Id,
                AuthorId = memberId,
                Title = "What should the next skill swap cover?",
                Content = "I can teach basic bike checks. Could someone cover seed saving or digital forms?",
                IsPinned = false,
                IsLocked = false,
                ReplyCount = 1,
                LastReplyAt = now.AddDays(-3),
                CreatedAt = now.AddDays(-5)
            });

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.DiscussionId == discussion.Id && r.AuthorId == coordinatorId,
            () => new GroupDiscussionReply
            {
                TenantId = tenantId,
                DiscussionId = discussion.Id,
                AuthorId = coordinatorId,
                Content = "Let's pair bike checks with a seedling swap and make it a family-friendly morning.",
                CreatedAt = now.AddDays(-3)
            });

        var eventItem = await EnsureAsync(
            db,
            e => e.TenantId == tenantId && e.Title == "Project NEXUS .NET Edition Demo Open Day",
            () => new Event
            {
                TenantId = tenantId,
                CreatedById = coordinatorId,
                GroupId = group.Id,
                Title = "Project NEXUS .NET Edition Demo Open Day",
                Description = "A full platform showcase: listings, exchanges, passkeys, groups, shifts, AI, safeguarding and impact analytics.",
                Location = "ACME Community Hub",
                StartsAt = now.Date.AddDays(14).AddHours(10),
                EndsAt = now.Date.AddDays(14).AddHours(15),
                MaxAttendees = 80,
                ImageUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png",
                IsCancelled = false,
                CreatedAt = now.AddDays(-20)
            },
            e => e.ImageUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png");

        foreach (var (userId, status) in new[] { (coordinatorId, Event.RsvpStatus.Going), (memberId, Event.RsvpStatus.Going), (volunteerId, Event.RsvpStatus.Maybe), (adminId, Event.RsvpStatus.Going) })
        {
            await EnsureAsync(
                db,
                r => r.TenantId == tenantId && r.EventId == eventItem.Id && r.UserId == userId,
                () => new EventRsvp { TenantId = tenantId, EventId = eventItem.Id, UserId = userId, Status = status, RespondedAt = now.AddDays(-4) },
                r => r.Status = status);

            await EnsureAsync(
                db,
                er => er.TenantId == tenantId && er.EventId == eventItem.Id && er.UserId == userId && er.MinutesBefore == 1440,
                () => new EventReminder
                {
                    TenantId = tenantId,
                    EventId = eventItem.Id,
                    UserId = userId,
                    MinutesBefore = 1440,
                    ReminderType = "email",
                    IsSent = false,
                    CreatedAt = now.AddDays(-4)
                });
        }

        var groupExchange = await EnsureAsync(
            db,
            ge => ge.TenantId == tenantId && ge.GroupId == group.Id && ge.Title == "Repair cafe team hours",
            () => new GroupExchange
            {
                TenantId = tenantId,
                GroupId = group.Id,
                Title = "Repair cafe team hours",
                Description = "Team credit allocation for the Saturday repair cafe.",
                TotalHours = 6,
                Status = "pending_confirmation",
                CreatedById = coordinatorId,
                ApprovedById = adminId,
                ApprovedAt = now.AddDays(-1),
                CreatedAt = now.AddDays(-3)
            });

        await EnsureAsync(
            db,
            p => p.GroupExchangeId == groupExchange.Id && p.UserId == memberId,
            () => new GroupExchangeParticipant
            {
                GroupExchangeId = groupExchange.Id,
                UserId = memberId,
                Hours = 2,
                Role = "provider",
                IsConfirmed = true,
                ConfirmedAt = now.AddDays(-1),
                CreatedAt = now.AddDays(-3)
            });

        return group;
    }

    private static async Task<FeedPost> SeedFeedAsync(NexusDbContext db, int tenantId, int adminId, int memberId, int coordinatorId, int volunteerId, int groupId, DateTime now)
    {
        var post = await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.Content == "Demo open day is live: repair cafe, garden planning, passkeys, AI matching and impact dashboards are ready to explore.",
            () => new FeedPost
            {
                TenantId = tenantId,
                UserId = coordinatorId,
                GroupId = groupId,
                Content = "Demo open day is live: repair cafe, garden planning, passkeys, AI matching and impact dashboards are ready to explore.",
                ImageUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png",
                IsPinned = true,
                CreatedAt = now.AddDays(-2)
            });

        foreach (var userId in new[] { adminId, memberId, volunteerId })
        {
            await EnsureAsync(
                db,
                l => l.TenantId == tenantId && l.PostId == post.Id && l.UserId == userId,
                () => new PostLike { TenantId = tenantId, PostId = post.Id, UserId = userId, CreatedAt = now.AddDays(-1) });

            await EnsureAsync(
                db,
                r => r.TenantId == tenantId && r.PostId == post.Id && r.UserId == userId,
                () => new PostReaction { TenantId = tenantId, PostId = post.Id, UserId = userId, ReactionType = userId == memberId ? PostReaction.Types.Love : PostReaction.Types.Like, CreatedAt = now.AddDays(-1) });
        }

        await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.PostId == post.Id && c.UserId == memberId,
            () => new PostComment
            {
                TenantId = tenantId,
                PostId = post.Id,
                UserId = memberId,
                Content = "I will cover the bike safety table and bring spare brake pads.",
                CreatedAt = now.AddDays(-1)
            });

        await EnsureAsync(
            db,
            b => b.TenantId == tenantId && b.UserId == adminId && b.PostId == post.Id,
            () => new FeedBookmark { TenantId = tenantId, UserId = adminId, PostId = post.Id, CreatedAt = now.AddDays(-1) });

        await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserId == volunteerId && s.PostId == post.Id,
            () => new PostShare { TenantId = tenantId, UserId = volunteerId, PostId = post.Id, SharedTo = "group", CreatedAt = now.AddHours(-20) });

        await EnsureAsync(
            db,
            h => h.TenantId == tenantId && h.PostId == post.Id && h.UserId == volunteerId,
            () => new HiddenPost { TenantId = tenantId, PostId = post.Id, UserId = volunteerId, HiddenAt = now.AddHours(-5) });

        await EnsureAsync(
            db,
            m => m.TenantId == tenantId && m.UserId == volunteerId && m.MutedUserId == adminId,
            () => new MutedUser { TenantId = tenantId, UserId = volunteerId, MutedUserId = adminId, MutedAt = now.AddDays(-10) });

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.PostId == post.Id && r.ReporterId == adminId,
            () => new FeedReport
            {
                TenantId = tenantId,
                PostId = post.Id,
                ReporterId = adminId,
                Reason = "other",
                Details = "Demo report for moderation workflow.",
                Status = "dismissed",
                ReviewedByAdminId = adminId,
                ReviewedAt = now.AddHours(-12),
                CreatedAt = now.AddDays(-1)
            });

        return post;
    }

    private static async Task SeedGamificationAsync(NexusDbContext db, int tenantId, int adminId, int memberId, int coordinatorId, int volunteerId, DateTime now)
    {
        var badge = await EnsureAsync(
            db,
            b => b.TenantId == tenantId && b.Slug == "demo-v2-showcase",
            () => new Badge
            {
                TenantId = tenantId,
                Slug = "demo-v2-showcase",
                Name = ".NET Edition Showcase Explorer",
                Description = "Explored the full Project NEXUS .NET Edition demo tenant.",
                Icon = "sparkles",
                XpReward = 250,
                SortOrder = 100,
                CreatedAt = now.AddDays(-30)
            });

        foreach (var userId in new[] { adminId, memberId, coordinatorId, volunteerId })
        {
            await EnsureAsync(
                db,
                ub => ub.TenantId == tenantId && ub.UserId == userId && ub.BadgeId == badge.Id,
                () => new UserBadge { TenantId = tenantId, UserId = userId, BadgeId = badge.Id, EarnedAt = now.AddDays(-5) });

            await EnsureAsync(
                db,
                x => x.TenantId == tenantId && x.UserId == userId && x.Source == "demo_showcase",
                () => new XpLog
                {
                    TenantId = tenantId,
                    UserId = userId,
                    Amount = 250,
                    Source = "demo_showcase",
                    Description = "Awarded for local V2 showcase seed.",
                    CreatedAt = now.AddDays(-5)
                });
        }

        var challenge = await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.Title == "Complete three demo exchanges",
            () => new Challenge
            {
                TenantId = tenantId,
                Title = "Complete three demo exchanges",
                Description = "A community challenge that demonstrates exchange lifecycle, reviews and wallet movement.",
                ChallengeType = ChallengeType.Community,
                TargetAction = "exchange_completed",
                TargetCount = 3,
                XpReward = 150,
                BadgeId = badge.Id,
                StartsAt = now.AddDays(-7),
                EndsAt = now.AddDays(21),
                IsActive = true,
                MaxParticipants = 100,
                Difficulty = ChallengeDifficulty.Medium,
                CreatedAt = now.AddDays(-7)
            });

        await EnsureAsync(
            db,
            cp => cp.TenantId == tenantId && cp.ChallengeId == challenge.Id && cp.UserId == memberId,
            () => new ChallengeParticipant
            {
                TenantId = tenantId,
                ChallengeId = challenge.Id,
                UserId = memberId,
                CurrentProgress = 2,
                IsCompleted = false,
                JoinedAt = now.AddDays(-6)
            });

        var gamificationChallenge = await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.Title == "Daily helper streak",
            () => new GamificationChallenge
            {
                TenantId = tenantId,
                Title = "Daily helper streak",
                Description = "Log in, reply, or complete a helpful action each day.",
                Type = "daily",
                ActionType = "daily_activity",
                TargetCount = 1,
                XpReward = 25,
                BadgeReward = "demo-v2-showcase",
                StartsAt = now.AddDays(-1),
                EndsAt = now.AddDays(1),
                IsActive = true,
                CreatedAt = now.AddDays(-1)
            });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.ChallengeId == gamificationChallenge.Id && p.UserId == volunteerId,
            () => new ChallengeProgress
            {
                TenantId = tenantId,
                ChallengeId = gamificationChallenge.Id,
                UserId = volunteerId,
                CurrentCount = 1,
                IsCompleted = true,
                CompletedAt = now.AddHours(-6),
                UpdatedAt = now.AddHours(-6)
            });

        await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserId == memberId && s.StreakType == "daily_login",
            () => new Streak
            {
                TenantId = tenantId,
                UserId = memberId,
                StreakType = "daily_login",
                CurrentStreak = 12,
                LongestStreak = 19,
                LastActivityDate = now.Date,
                CreatedAt = now.AddDays(-30)
            });

        var season = await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.Name == "Spring Impact Sprint",
            () => new LeaderboardSeason
            {
                TenantId = tenantId,
                Name = "Spring Impact Sprint",
                StartsAt = now.AddDays(-14),
                EndsAt = now.AddDays(16),
                Status = SeasonStatus.Active,
                PrizeDescription = "Featured member story and community lunch voucher.",
                CreatedAt = now.AddDays(-14)
            });

        await EnsureAsync(
            db,
            e => e.TenantId == tenantId && e.SeasonId == season.Id && e.UserId == memberId,
            () => new LeaderboardEntry
            {
                TenantId = tenantId,
                SeasonId = season.Id,
                UserId = memberId,
                Score = 980,
                Rank = 1,
                UpdatedAt = now.AddHours(-1)
            });

        await EnsureAsync(db, r => r.TenantId == tenantId && r.UserId == memberId && r.Day == 5, () => new DailyReward { TenantId = tenantId, UserId = memberId, Day = 5, XpAwarded = 50, ClaimedAt = now.AddHours(-8) });
        await EnsureAsync(db, r => r.TenantId == tenantId && r.UserId == memberId && r.DayNumber == 5, () => new DailyRewardLog { TenantId = tenantId, UserId = memberId, DayNumber = 5, XpAwarded = 50, BonusAwarded = "demo-streak", ClaimedAt = now.AddHours(-8) });

        await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.Name == "Community Hero Collection",
            () => new BadgeCollection
            {
                TenantId = tenantId,
                Name = "Community Hero Collection",
                Description = "Badges earned through exchange, volunteering and demo exploration.",
                IconUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png",
                BadgeIds = JsonSerializer.Serialize(new[] { badge.Id }, JsonOptions),
                IsActive = true,
                CreatedAt = now.AddDays(-4)
            });

        await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserId == memberId && s.BadgeId == badge.Id,
            () => new BadgeShowcase { TenantId = tenantId, UserId = memberId, BadgeId = badge.Id, DisplayOrder = 1, CreatedAt = now.AddDays(-4) });

        var shopItem = await EnsureAsync(
            db,
            i => i.TenantId == tenantId && i.ItemKey == "demo-community-hero-title",
            () => new ShopItem
            {
                TenantId = tenantId,
                Name = "Community Hero Title",
                Description = "A demo XP shop reward that decorates the member profile.",
                Type = "title",
                ItemKey = "demo-community-hero-title",
                ImageUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png",
                XpCost = 300,
                IsActive = true,
                StockLimit = null,
                PurchasedCount = 1,
                CreatedAt = now.AddDays(-3)
            });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.ShopItemId == shopItem.Id && p.UserId == memberId,
            () => new ShopPurchase { TenantId = tenantId, ShopItemId = shopItem.Id, UserId = memberId, XpSpent = 300, PurchasedAt = now.AddDays(-2) });

        await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.UserId == memberId && r.ItemId == "demo-community-hero-title",
            () => new XpShopRedemption
            {
                TenantId = tenantId,
                UserId = memberId,
                ItemId = "demo-community-hero-title",
                ItemName = "Community Hero Title",
                XpSpent = 300,
                RedeemedAt = now.AddDays(-2),
                IsActive = true
            });
    }

    private static async Task SeedSkillsMatchingAndSearchAsync(NexusDbContext db, int tenantId, int memberId, int coordinatorId, int volunteerId, int repairListingId, int gardenListingId, int groupId, int feedPostId, DateTime now)
    {
        var repairSkill = await EnsureAsync(db, s => s.TenantId == tenantId && s.Slug == "bike-repair", () => new Skill { TenantId = tenantId, Name = "Bike repair", Slug = "bike-repair", Description = "Basic diagnostics, punctures, brakes and safe handover.", IsVerifiable = true, CreatedAt = now.AddDays(-80) });
        var gardenSkill = await EnsureAsync(db, s => s.TenantId == tenantId && s.Slug == "community-gardening", () => new Skill { TenantId = tenantId, Name = "Community gardening", Slug = "community-gardening", Description = "Raised beds, seedlings, composting and group facilitation.", IsVerifiable = true, CreatedAt = now.AddDays(-80) });

        var userSkill = await EnsureAsync(
            db,
            us => us.TenantId == tenantId && us.UserId == memberId && us.SkillId == repairSkill.Id,
            () => new UserSkill
            {
                TenantId = tenantId,
                UserId = memberId,
                SkillId = repairSkill.Id,
                ProficiencyLevel = SkillLevel.Advanced,
                IsVerified = true,
                EndorsementCount = 1,
                CreatedAt = now.AddDays(-75)
            });

        await EnsureAsync(
            db,
            us => us.TenantId == tenantId && us.UserId == coordinatorId && us.SkillId == gardenSkill.Id,
            () => new UserSkill
            {
                TenantId = tenantId,
                UserId = coordinatorId,
                SkillId = gardenSkill.Id,
                ProficiencyLevel = SkillLevel.Expert,
                IsVerified = true,
                EndorsementCount = 1,
                CreatedAt = now.AddDays(-75)
            });

        await EnsureAsync(
            db,
            e => e.TenantId == tenantId && e.UserSkillId == userSkill.Id && e.EndorserId == coordinatorId,
            () => new Endorsement
            {
                TenantId = tenantId,
                UserSkillId = userSkill.Id,
                EndorserId = coordinatorId,
                EndorsedUserId = memberId,
                Comment = "Charlie ran a safe and friendly bike check station.",
                CreatedAt = now.AddDays(-10)
            });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.UserId == memberId,
            () => new MatchPreference
            {
                TenantId = tenantId,
                UserId = memberId,
                MaxDistanceKm = 12,
                PreferredCategories = "[1,2,3]",
                AvailableDays = "[\"saturday\",\"wednesday\"]",
                AvailableTimeSlots = "morning,afternoon",
                SkillsOffered = "bike repair,small appliance repair",
                SkillsWanted = "gardening,digital inclusion",
                IsActive = true,
                CreatedAt = now.AddDays(-20)
            });

        var match = await EnsureAsync(
            db,
            m => m.TenantId == tenantId && m.UserId == memberId && m.MatchedUserId == coordinatorId && m.MatchedListingId == gardenListingId,
            () => new MatchResult
            {
                TenantId = tenantId,
                UserId = memberId,
                MatchedUserId = coordinatorId,
                MatchedListingId = gardenListingId,
                Score = 0.94m,
                Reasons = "[\"skill_wanted:garden\",\"same_group\",\"high_reliability\"]",
                Status = MatchStatus.Accepted,
                ViewedAt = now.AddDays(-3),
                RespondedAt = now.AddDays(-2),
                CreatedAt = now.AddDays(-4)
            });

        await EnsureAsync(
            db,
            i => i.TenantId == tenantId && i.UserId == memberId && i.InteractionType == "view" && i.TargetType == "listing" && i.TargetId == gardenListingId,
            () => new UserInteraction { TenantId = tenantId, UserId = memberId, InteractionType = "view", TargetType = "listing", TargetId = gardenListingId, Score = 0.7m, CreatedAt = now.AddDays(-3) });

        await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserAId == memberId && s.UserBId == coordinatorId,
            () => new UserSimilarity { TenantId = tenantId, UserAId = memberId, UserBId = coordinatorId, SimilarityScore = 0.82m, Algorithm = "cosine", CommonInteractions = 7, CalculatedAt = now.AddDays(-1) });

        await EnsureAsync(
            db,
            f => f.MatchResultId == match.Id && f.UserId == memberId,
            () => new MatchFeedback { TenantId = tenantId, MatchResultId = match.Id, UserId = memberId, FeedbackType = "perfect", Comment = "This match is ideal for the demo garden exchange.", CreatedAt = now.AddDays(-2) });

        foreach (var tag in new[] { "repair", "garden", "demo" })
        {
            var hashtag = await EnsureAsync(
                db,
                h => h.TenantId == tenantId && h.Tag == tag,
                () => new Hashtag { TenantId = tenantId, Tag = tag, UsageCount = 1, CreatedAt = now.AddDays(-5), LastUsedAt = now.AddDays(-1) });

            await EnsureAsync(
                db,
                u => u.HashtagId == hashtag.Id && u.TargetType == "post" && u.TargetId == feedPostId,
                () => new HashtagUsage { TenantId = tenantId, HashtagId = hashtag.Id, TargetType = "post", TargetId = feedPostId, CreatedById = volunteerId, CreatedAt = now.AddDays(-1) });
        }

        await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.UserId == memberId && s.Name == "Repair and garden opportunities",
            () => new SavedSearch
            {
                TenantId = tenantId,
                UserId = memberId,
                Name = "Repair and garden opportunities",
                SearchType = "listings",
                QueryJson = JsonSerializer.Serialize(new { q = "repair garden", radius = 12 }, JsonOptions),
                NotifyOnNewResults = true,
                LastResultCount = 5,
                LastRunAt = now.AddHours(-6),
                CreatedAt = now.AddDays(-8)
            });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.UserId == memberId && p.InsightType == "impact_score",
            () => new PersonalInsight
            {
                TenantId = tenantId,
                UserId = memberId,
                InsightType = "impact_score",
                Value = JsonSerializer.Serialize(new { score = 84, trend = "up" }, JsonOptions),
                Label = "Community impact",
                Period = "month",
                CalculatedAt = now.AddHours(-1)
            });
    }

    private static async Task SeedVolunteeringAndStaffingAsync(NexusDbContext db, int tenantId, int coordinatorId, int volunteerId, int memberId, int groupId, int categoryId, DateTime now)
    {
        var opportunity = await EnsureAsync(
            db,
            o => o.TenantId == tenantId && o.Title == "Demo open day welcome team",
            () => new VolunteerOpportunity
            {
                TenantId = tenantId,
                Title = "Demo open day welcome team",
                Description = "Welcome visitors, explain time credits, and signpost people to the right demo station.",
                OrganizerId = coordinatorId,
                GroupId = groupId,
                Location = "ACME Community Hub",
                CategoryId = categoryId,
                Status = OpportunityStatus.Published,
                RequiredVolunteers = 6,
                IsRecurring = true,
                StartsAt = now.Date.AddDays(14).AddHours(9),
                EndsAt = now.Date.AddDays(14).AddHours(16),
                ApplicationDeadline = now.Date.AddDays(10).AddHours(17),
                SkillsRequired = "welcome,accessibility,digital inclusion",
                CreditReward = 2,
                CreatedAt = now.AddDays(-20)
            });

        var pattern = await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.OpportunityId == opportunity.Id && p.Title == "Saturday welcome rota",
            () => new RecurringShiftPattern
            {
                TenantId = tenantId,
                OpportunityId = opportunity.Id,
                CreatedBy = coordinatorId,
                Title = "Saturday welcome rota",
                Frequency = "weekly",
                DaysOfWeek = "6",
                StartTime = TimeSpan.FromHours(9),
                EndTime = TimeSpan.FromHours(12),
                Capacity = 4,
                StartDate = DateOnly.FromDateTime(now.Date.AddDays(7)),
                EndDate = DateOnly.FromDateTime(now.Date.AddDays(60)),
                MaxOccurrences = 8,
                OccurrencesGenerated = 2,
                IsActive = true,
                CreatedAt = now.AddDays(-15)
            });

        var shift = await EnsureAsync(
            db,
            s => s.TenantId == tenantId && s.OpportunityId == opportunity.Id && s.Title == "Morning welcome desk",
            () => new VolunteerShift
            {
                TenantId = tenantId,
                OpportunityId = opportunity.Id,
                Title = "Morning welcome desk",
                StartsAt = now.Date.AddDays(14).AddHours(9),
                EndsAt = now.Date.AddDays(14).AddHours(12),
                MaxVolunteers = 4,
                Location = "Front desk",
                Notes = "Briefing at 08:45.",
                Status = ShiftStatus.Scheduled,
                RecurringPatternId = pattern.Id,
                CreatedAt = now.AddDays(-12)
            });

        await EnsureAsync(
            db,
            a => a.TenantId == tenantId && a.OpportunityId == opportunity.Id && a.UserId == volunteerId,
            () => new VolunteerApplication
            {
                TenantId = tenantId,
                OpportunityId = opportunity.Id,
                UserId = volunteerId,
                Status = ApplicationStatus.Approved,
                Message = "Happy to welcome people and help with accessibility needs.",
                ReviewedById = coordinatorId,
                ReviewedAt = now.AddDays(-5),
                CreatedAt = now.AddDays(-6)
            });

        await EnsureAsync(
            db,
            c => c.TenantId == tenantId && c.ShiftId == shift.Id && c.UserId == volunteerId,
            () => new VolunteerCheckIn
            {
                TenantId = tenantId,
                ShiftId = shift.Id,
                UserId = volunteerId,
                CheckedInAt = now.AddDays(-1).AddHours(-3),
                CheckedOutAt = now.AddDays(-1),
                Status = "checked_out",
                HoursLogged = 3,
                Notes = "Demo check-in record for completed prep shift.",
                CreatedAt = now.AddDays(-1),
                UpdatedAt = now.AddDays(-1)
            });

        var reservation = await EnsureAsync(
            db,
            r => r.TenantId == tenantId && r.ShiftId == shift.Id && r.GroupId == groupId,
            () => new ShiftGroupReservation
            {
                TenantId = tenantId,
                ShiftId = shift.Id,
                GroupId = groupId,
                ReservedBy = coordinatorId,
                ReservedSlots = 2,
                FilledSlots = 1,
                Status = "active",
                Notes = "Reserved for the repair collective.",
                CreatedAt = now.AddDays(-7)
            });

        await EnsureAsync(db, m => m.TenantId == tenantId && m.ReservationId == reservation.Id && m.UserId == memberId, () => new ShiftGroupMember { TenantId = tenantId, ReservationId = reservation.Id, UserId = memberId, Status = "confirmed", CreatedAt = now.AddDays(-6) });
        await EnsureAsync(db, w => w.TenantId == tenantId && w.ShiftId == shift.Id && w.UserId == memberId, () => new ShiftWaitlistEntry { TenantId = tenantId, ShiftId = shift.Id, UserId = memberId, Position = 1, Status = "waiting", CreatedAt = now.AddDays(-4) });
        await EnsureAsync(db, sw => sw.TenantId == tenantId && sw.FromUserId == volunteerId && sw.FromShiftId == shift.Id, () => new ShiftSwapRequest { TenantId = tenantId, FromUserId = volunteerId, ToUserId = memberId, FromShiftId = shift.Id, Status = "admin_pending", RequiresAdminApproval = true, Message = "Can Charlie take my first hour if work runs late?", AdminId = coordinatorId, CreatedAt = now.AddDays(-2) });

        await EnsureAsync(db, a => a.TenantId == tenantId && a.UserId == volunteerId && a.DayOfWeek == 6, () => new VolunteerAvailability { TenantId = tenantId, UserId = volunteerId, DayOfWeek = 6, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(16, 0), IsRecurring = true, EffectiveFrom = now.Date.AddDays(-30), CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, a => a.TenantId == tenantId && a.UserId == volunteerId && a.DayOfWeek == 6 && a.StartTime == "09:00", () => new MemberAvailability { TenantId = tenantId, UserId = volunteerId, DayOfWeek = 6, StartTime = "09:00", EndTime = "16:00", IsActive = true, Note = "Available most Saturdays for showcase shifts.", CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, e => e.TenantId == tenantId && e.UserId == volunteerId && e.Date == now.Date.AddDays(21), () => new AvailabilityException { TenantId = tenantId, UserId = volunteerId, Date = now.Date.AddDays(21), Type = "unavailable", Reason = "Family commitment", CreatedAt = now.AddDays(-3) });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.OpportunityId == opportunity.Id && p.PredictedDate == now.Date.AddDays(14),
            () => new StaffingPrediction
            {
                TenantId = tenantId,
                OpportunityId = opportunity.Id,
                PredictedDate = now.Date.AddDays(14),
                PredictedVolunteersNeeded = 6,
                PredictedVolunteersAvailable = 5,
                ShortfallRisk = 0.42m,
                Factors = JsonSerializer.Serialize(new[] { "weather", "school_holiday", "historical_no_shows" }, JsonOptions),
                CreatedAt = now.AddHours(-8)
            });
    }

    private static async Task SeedContentAndCommsAsync(NexusDbContext db, int tenantId, int adminId, int coordinatorId, int memberId, DateTime now)
    {
        var blogCategory = await EnsureAsync(db, c => c.TenantId == tenantId && c.Slug == "showcase", () => new BlogCategory { TenantId = tenantId, Name = "Showcase", Slug = "showcase", Description = "Project NEXUS .NET Edition demo stories and release notes.", Color = "#0F766E", SortOrder = 1, CreatedAt = now.AddDays(-30) });

        await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.Slug == "project-nexus-v2-demo-showcase",
            () => new BlogPost
            {
                TenantId = tenantId,
                Title = "Project NEXUS .NET Edition demo showcase",
                Slug = "project-nexus-v2-demo-showcase",
                Content = "This demo tenant shows every major .NET Edition module with realistic community data: time credits, matching, groups, shifts, content, governance, AI and compliance.",
                Excerpt = "A guided tour of the full Project NEXUS .NET Edition platform.",
                FeaturedImageUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png",
                Status = "published",
                CategoryId = blogCategory.Id,
                AuthorId = adminId,
                Tags = "demo,v2,timebanking",
                IsFeatured = true,
                ViewCount = 420,
                PublishedAt = now.AddDays(-12),
                CreatedAt = now.AddDays(-14),
                MetaTitle = "Project NEXUS .NET Edition Demo Showcase",
                MetaDescription = "Explore the full Project NEXUS .NET Edition demo tenant.",
                OgImageUrl = $"{AssetBaseUrl}/nexus-v2-community-hub.png"
            });

        var page = await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.Slug == "about-project-nexus-v2",
            () => new Page
            {
                TenantId = tenantId,
                Title = "About Project NEXUS .NET Edition",
                Slug = "about-project-nexus-v2",
                Content = "<h1>Project NEXUS .NET Edition</h1><p>A modern timebanking platform demo with full AGPL attribution, source availability and community impact modules.</p>",
                IsPublished = true,
                SortOrder = 1,
                ShowInMenu = true,
                MenuLocation = "footer",
                PublishAt = now.AddDays(-10),
                CreatedById = adminId,
                CurrentVersion = 1,
                MetaTitle = "About Project NEXUS .NET Edition",
                MetaDescription = "License, attribution, source code and demo tenant information.",
                CreatedAt = now.AddDays(-10)
            });

        await EnsureAsync(
            db,
            v => v.TenantId == tenantId && v.PageId == page.Id && v.VersionNumber == 1,
            () => new PageVersion
            {
                TenantId = tenantId,
                PageId = page.Id,
                VersionNumber = 1,
                Title = page.Title,
                Slug = page.Slug,
                Content = page.Content,
                CreatedById = adminId,
                CreatedAt = now.AddDays(-10)
            });

        await EnsureAsync(db, a => a.TenantId == tenantId && a.Slug == "how-time-credits-work", () => new KnowledgeArticle { TenantId = tenantId, Title = "How time credits work", Slug = "how-time-credits-work", Content = "One hour given equals one time credit earned. Credits can be exchanged, donated or pooled by organisations.", Category = "Getting Started", Tags = "wallet,exchange,time credits", IsPublished = true, SortOrder = 1, ViewCount = 192, CreatedById = adminId, CreatedAt = now.AddDays(-25) });
        await EnsureAsync(db, f => f.TenantId == tenantId && f.Question == "Can I use passkeys in the demo?", () => new Faq { TenantId = tenantId, Question = "Can I use passkeys in the demo?", Answer = "Yes. The demo includes passkey records and configuration, though real authenticator registration is device-specific.", Category = "Security", SortOrder = 1, IsPublished = true, CreatedAt = now.AddDays(-20) });

        var resourceCategory = await EnsureAsync(db, c => c.TenantId == tenantId && c.Name == "Demo Resources", () => new ResourceCategory { TenantId = tenantId, Name = "Demo Resources", Description = "Seeded guides and visual assets for the V2 showcase.", SortOrder = 1, CreatedAt = now.AddDays(-20) });
        await EnsureAsync(db, r => r.TenantId == tenantId && r.Title == "V2 showcase image pack", () => new Resource { TenantId = tenantId, Title = "V2 showcase image pack", Description = "Generated demo assets used across listings, blog posts, organisations and events.", Url = $"{AssetBaseUrl}/nexus-v2-community-hub.png", ResourceType = "image", CategoryId = resourceCategory.Id, CreatedById = coordinatorId, SortOrder = 1, IsPublished = true, CreatedAt = now.AddDays(-19) });

        await EnsureAsync(db, d => d.TenantId == tenantId && d.Slug == "terms-of-service" && d.Version == "2.0-demo", () => new LegalDocument { TenantId = tenantId, Title = "Terms of Service", Slug = "terms-of-service", Content = "Demo terms for local development. AGPL attribution and source availability remain mandatory.", Version = "2.0-demo", IsActive = true, RequiresAcceptance = true, CreatedAt = now.AddDays(-30) });
        var legal = await db.LegalDocuments.FirstAsync(d => d.TenantId == tenantId && d.Slug == "terms-of-service" && d.Version == "2.0-demo");
        await EnsureAsync(db, a => a.TenantId == tenantId && a.UserId == memberId && a.LegalDocumentId == legal.Id, () => new LegalDocumentAcceptance { TenantId = tenantId, UserId = memberId, LegalDocumentId = legal.Id, AcceptedAt = now.AddDays(-12), IpAddress = "127.0.0.1", UserAgent = "Demo browser" });

        await EnsureAsync(db, t => t.TenantId == tenantId && t.Key == "demo.showcase.title" && t.Locale == "en", () => new Translation { TenantId = tenantId, Locale = "en", Key = "demo.showcase.title", Value = "Project NEXUS .NET Edition Showcase", Namespace = "demo", IsApproved = true, ApprovedById = adminId, CreatedAt = now.AddDays(-1) });
        await EnsureAsync(db, l => l.TenantId == tenantId && l.UserId == memberId, () => new UserLanguagePreference { TenantId = tenantId, UserId = memberId, PreferredLocale = "en", FallbackLocale = "ga", CreatedAt = now.AddDays(-20) });

        await EnsureAsync(db, e => e.TenantId == tenantId && e.Key == "demo_welcome", () => new EmailTemplate { TenantId = tenantId, Key = "demo_welcome", Subject = "Welcome to the Project NEXUS .NET Edition demo", BodyHtml = "<p>Hello {{user_name}}, explore every seeded module in the demo tenant.</p>", BodyText = "Hello {{user_name}}, explore every seeded module in the demo tenant.", IsActive = true, CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, e => e.TenantId == tenantId && e.ToEmail == "member@acme.test" && e.TemplateKey == "demo_welcome", () => new EmailLog { TenantId = tenantId, UserId = memberId, ToEmail = "member@acme.test", Subject = "Welcome to the Project NEXUS .NET Edition demo", TemplateKey = "demo_welcome", Status = EmailSendStatus.Sent, SentAt = now.AddDays(-1), CreatedAt = now.AddDays(-1) });

        var newsletter = await EnsureAsync(db, n => n.TenantId == tenantId && n.Subject == "V2 showcase weekly digest", () => new Newsletter { TenantId = tenantId, Subject = "V2 showcase weekly digest", ContentHtml = "<h1>Demo highlights</h1><p>Repair cafe, garden planning and partner workflows are ready.</p>", ContentText = "Demo highlights: repair cafe, garden planning and partner workflows are ready.", Status = NewsletterStatus.Sent, SentAt = now.AddDays(-2), CreatedById = adminId, RecipientCount = 8, OpenCount = 6, ClickCount = 3, CreatedAt = now.AddDays(-3) });
        await EnsureAsync(db, s => s.TenantId == tenantId && s.Email == "member@acme.test", () => new NewsletterSubscription { TenantId = tenantId, UserId = memberId, Email = "member@acme.test", IsSubscribed = true, Source = "demo_seed", SubscribedAt = now.AddDays(-30), CreatedAt = now.AddDays(-30) });

        await EnsureAsync(db, p => p.TenantId == tenantId && p.UserId == memberId && p.NotificationType == "message_received", () => new NotificationPreference { TenantId = tenantId, UserId = memberId, NotificationType = "message_received", EnableInApp = true, EnablePush = true, EnableEmail = true, CreatedAt = now.AddDays(-20) });
        var subscription = await EnsureAsync(db, p => p.TenantId == tenantId && p.DeviceToken == "demo-web-push-token-member", () => new PushSubscription { TenantId = tenantId, UserId = memberId, DeviceToken = "demo-web-push-token-member", Platform = "web", DeviceName = "Demo browser", IsActive = true, LastUsedAt = now.AddHours(-6), CreatedAt = now.AddDays(-12) });
        await EnsureAsync(db, p => p.TenantId == tenantId && p.SubscriptionId == subscription.Id && p.Title == "Demo push delivered", () => new PushNotificationLog { TenantId = tenantId, UserId = memberId, SubscriptionId = subscription.Id, Title = "Demo push delivered", Body = "Your repair cafe shift starts tomorrow.", Data = "{}", Status = PushStatus.Sent, SentAt = now.AddHours(-6), CreatedAt = now.AddHours(-6) });
    }

    private static async Task SeedOrganisationsAndSubscriptionsAsync(NexusDbContext db, int tenantId, int adminId, int orgOwnerId, int coordinatorId, DateTime now)
    {
        var organisation = await EnsureAsync(
            db,
            o => o.TenantId == tenantId && o.Slug == "acme-community-hub",
            () => new Organisation
            {
                TenantId = tenantId,
                Name = "ACME Community Hub",
                Slug = "acme-community-hub",
                Description = "Anchor organisation for the V2 demo tenant, hosting events, repair cafes and broker-supported referrals.",
                LogoUrl = $"{AssetBaseUrl}/community-operations-table.png",
                WebsiteUrl = "https://example.test/acme-community-hub",
                Email = "hub@acme.test",
                Phone = "+353 21 000 0000",
                Address = "Demo Community Hub, Main Street",
                Latitude = 51.897,
                Longitude = -8.47,
                Type = "charity",
                Industry = "Community Development",
                Status = "verified",
                IsPublic = true,
                OwnerId = orgOwnerId,
                VerifiedAt = now.AddDays(-30),
                CreatedAt = now.AddDays(-60)
            });

        foreach (var (userId, role) in new[] { (orgOwnerId, "owner"), (coordinatorId, "member"), (adminId, "admin") })
        {
            await EnsureAsync(db, m => m.OrganisationId == organisation.Id && m.UserId == userId, () => new OrganisationMember { TenantId = tenantId, OrganisationId = organisation.Id, UserId = userId, Role = role, JobTitle = role == "owner" ? "Community Hub Lead" : "Demo Coordinator", JoinedAt = now.AddDays(-50) });
        }

        var wallet = await EnsureAsync(db, w => w.TenantId == tenantId && w.OrganisationId == organisation.Id, () => new OrgWallet { TenantId = tenantId, OrganisationId = organisation.Id, Balance = 64, TotalReceived = 120, TotalSpent = 56, CreatedAt = now.AddDays(-45) });
        await EnsureAsync(db, t => t.TenantId == tenantId && t.OrgWalletId == wallet.Id && t.Category == "admin_grant", () => new OrgWalletTransaction { TenantId = tenantId, OrgWalletId = wallet.Id, Type = "credit", Amount = 50, BalanceAfter = 64, Category = "admin_grant", Description = "Demo organisation wallet grant.", InitiatedById = adminId, CreatedAt = now.AddDays(-20) });

        await EnsureAsync(db, s => s.TenantId == tenantId && s.UserId == orgOwnerId, () => new NexusScore { TenantId = tenantId, UserId = orgOwnerId, Score = 812, ExchangeScore = 170, ReviewScore = 165, EngagementScore = 160, ReliabilityScore = 162, TenureScore = 155, Tier = "exemplary", LastCalculatedAt = now.AddHours(-4), CreatedAt = now.AddDays(-20) });
        await EnsureAsync(db, h => h.TenantId == tenantId && h.UserId == orgOwnerId && h.NewScore == 812, () => new NexusScoreHistory { TenantId = tenantId, UserId = orgOwnerId, PreviousScore = 790, NewScore = 812, PreviousTier = "trusted", NewTier = "exemplary", Reason = "Demo organisation onboarding completed", CreatedAt = now.AddHours(-4) });

        var plan = await EnsureAsync(db, p => p.TenantId == tenantId && p.Name == "Community Showcase", () => new SubscriptionPlan { TenantId = tenantId, Name = "Community Showcase", Description = "Demo subscription plan with all V2 modules enabled.", Price = 0, Currency = "EUR", MaxMembers = 0, MaxListings = 0, MaxExchangesPerMonth = 0, Features = "[\"all_modules\",\"federation\",\"ai\",\"admin\"]", IsActive = true, IsPublic = false, CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, s => s.TenantId == tenantId && s.UserId == orgOwnerId && s.PlanId == plan.Id, () => new UserSubscription { TenantId = tenantId, UserId = orgOwnerId, PlanId = plan.Id, Status = SubscriptionStatus.Active, StartedAt = now.AddDays(-30), NextBillingDate = now.AddDays(365), Notes = "Local demo entitlement.", CreatedAt = now.AddDays(-30) });

        await EnsureAsync(db, e => e.TenantId == tenantId && e.Key == "sso.enabled", () => new EnterpriseConfig { TenantId = tenantId, Key = "sso.enabled", Value = "false", Category = "identity", Description = "Demo enterprise config row.", UpdatedAt = now });
    }

    private static async Task SeedOnboardingGoalsPollsAndIdeasAsync(NexusDbContext db, int tenantId, int adminId, int memberId, int coordinatorId, int groupId, DateTime now)
    {
        var step = await EnsureAsync(db, s => s.TenantId == tenantId && s.Key == "explore_v2_showcase", () => new OnboardingStep { TenantId = tenantId, Key = "explore_v2_showcase", Title = "Explore the V2 showcase", Description = "Visit listings, wallet, groups, events, AI and admin workflows.", SortOrder = 1, IsRequired = true, XpReward = 100, CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, p => p.UserId == memberId && p.StepId == step.Id, () => new OnboardingProgress { TenantId = tenantId, UserId = memberId, StepId = step.Id, IsCompleted = true, CompletedAt = now.AddDays(-10), CreatedAt = now.AddDays(-12) });

        var goal = await EnsureAsync(db, g => g.TenantId == tenantId && g.UserId == memberId && g.Title == "Give 10 hours through the repair cafe", () => new Goal { TenantId = tenantId, UserId = memberId, Title = "Give 10 hours through the repair cafe", Description = "A demo goal showing milestones and progress.", GoalType = "hours", TargetValue = 10, CurrentValue = 4, Category = "Repair", Status = "active", TargetDate = now.AddDays(45), CreatedAt = now.AddDays(-20) });
        await EnsureAsync(db, m => m.TenantId == tenantId && m.GoalId == goal.Id && m.Title == "Complete first repair shift", () => new GoalMilestone { TenantId = tenantId, GoalId = goal.Id, Title = "Complete first repair shift", IsCompleted = true, CompletedAt = now.AddDays(-5), SortOrder = 1, CreatedAt = now.AddDays(-20) });

        var poll = await EnsureAsync(db, p => p.TenantId == tenantId && p.Title == "Which demo station should be first on the tour?", () => new Poll { TenantId = tenantId, CreatedById = coordinatorId, Title = "Which demo station should be first on the tour?", Description = "Seeded poll with options and votes.", PollType = "single", IsAnonymous = false, ShowResultsBeforeClose = true, GroupId = groupId, Status = "active", ClosesAt = now.AddDays(7), CreatedAt = now.AddDays(-3) });
        var option = await EnsureAsync(db, o => o.TenantId == tenantId && o.PollId == poll.Id && o.Text == "Repair cafe and exchange lifecycle", () => new PollOption { TenantId = tenantId, PollId = poll.Id, Text = "Repair cafe and exchange lifecycle", SortOrder = 1, CreatedAt = now.AddDays(-3) });
        await EnsureAsync(db, v => v.TenantId == tenantId && v.PollId == poll.Id && v.OptionId == option.Id && v.UserId == memberId, () => new PollVote { TenantId = tenantId, PollId = poll.Id, OptionId = option.Id, UserId = memberId, CreatedAt = now.AddDays(-2) });

        var idea = await EnsureAsync(db, i => i.TenantId == tenantId && i.Title == "Mobile demo checklist for open days", () => new Idea { TenantId = tenantId, AuthorId = memberId, Title = "Mobile demo checklist for open days", Content = "Create a public checklist that guides visitors through passkeys, exchanges, AI matching and impact dashboards.", Category = "Product", Status = "under_review", UpvoteCount = 2, CommentCount = 1, CreatedAt = now.AddDays(-6) });
        await EnsureAsync(db, v => v.TenantId == tenantId && v.IdeaId == idea.Id && v.UserId == coordinatorId, () => new IdeaVote { TenantId = tenantId, IdeaId = idea.Id, UserId = coordinatorId, CreatedAt = now.AddDays(-5) });
        await EnsureAsync(db, c => c.TenantId == tenantId && c.IdeaId == idea.Id && c.UserId == adminId, () => new IdeaComment { TenantId = tenantId, IdeaId = idea.Id, UserId = adminId, Content = "Good candidate for a guided admin-panel walkthrough.", CreatedAt = now.AddDays(-4) });
        await EnsureAsync(db, f => f.TenantId == tenantId && f.IdeaId == idea.Id && f.UserId == coordinatorId, () => new IdeaFavorite { TenantId = tenantId, IdeaId = idea.Id, UserId = coordinatorId, CreatedAt = now.AddDays(-4) });
    }

    private static async Task SeedComplianceAdminAndSafetyAsync(NexusDbContext db, int tenantId, int adminId, int brokerId, int memberId, int coordinatorId, int guardianId, int youthId, int listingId, int conversationId, DateTime now)
    {
        await EnsureAsync(db, p => p.TenantId == tenantId && p.UserId == memberId, () => new UserPreference { TenantId = tenantId, UserId = memberId, Theme = "system", Language = "en", Timezone = "Europe/Dublin", EmailDigestFrequency = "weekly", ProfileVisibility = "public", ShowOnlineStatus = true, ShowLastSeen = true, ShowLocation = true, Searchable = true, EmailNotifications = true, PushNotifications = true, DateFormat = "DD/MM/YYYY", ItemsPerPage = 20, CreatedAt = now.AddDays(-25) });
        await EnsureAsync(db, l => l.TenantId == tenantId && l.UserId == memberId, () => new UserLocation { TenantId = tenantId, UserId = memberId, Latitude = 51.897, Longitude = -8.47, City = "Cork", Region = "Munster", Country = "Ireland", PostalCode = "T12 DEMO", FormattedAddress = "ACME Community Hub, Demo Street", IsPublic = true, CreatedAt = now.AddDays(-20), UpdatedAt = now.AddDays(-1) });

        await EnsureAsync(db, n => n.TenantId == tenantId && n.UserId == memberId && n.AdminId == adminId, () => new AdminNote { TenantId = tenantId, UserId = memberId, AdminId = adminId, Content = "Demo member has completed identity, onboarding and first exchange.", Category = "demo", IsFlagged = false, CreatedAt = now.AddDays(-8) });
        await EnsureAsync(db, t => t.TenantId == tenantId && t.TargetUserId == memberId && t.Title == "Check repair cafe onboarding", () => new CrmTask { TenantId = tenantId, TargetUserId = memberId, AssignedToAdminId = adminId, Title = "Check repair cafe onboarding", Description = "Demo CRM task for admin panel workflow.", Priority = "high", Status = "pending", DueDate = now.AddDays(3), CreatedAt = now.AddDays(-2) });
        await EnsureAsync(db, t => t.TenantId == tenantId && t.UserId == memberId && t.Tag == "demo-champion", () => new UserTag { TenantId = tenantId, UserId = memberId, Tag = "demo-champion", AppliedByAdminId = adminId, CreatedAt = now.AddDays(-9) });

        await EnsureAsync(db, a => a.TenantId == tenantId && a.UserId == adminId && a.Action == "demo.seed.showcase", () => new AuditLog { TenantId = tenantId, UserId = adminId, Action = "demo.seed.showcase", EntityType = "Tenant", EntityId = tenantId, NewValues = "{\"demo\":\"v2\"}", IpAddress = "127.0.0.1", UserAgent = "DemoSeeder", Metadata = "{\"source\":\"DemoShowcaseSeedData\"}", Severity = AuditSeverity.Info, CreatedAt = now });

        var report = await EnsureAsync(db, r => r.TenantId == tenantId && r.ReporterId == coordinatorId && r.ContentType == "listing" && r.ContentId == listingId, () => new ContentReport { TenantId = tenantId, ReporterId = coordinatorId, ContentType = "listing", ContentId = listingId, Reason = ReportReason.SafetyConcern, Description = "Demo report: ensure first-time repairs happen in public workshop.", Status = ReportStatus.ActionTaken, ReviewedById = adminId, ReviewedAt = now.AddDays(-1), ReviewNotes = "Added broker note and group policy.", ActionTaken = "Broker review attached.", CreatedAt = now.AddDays(-2) });
        await EnsureAsync(db, w => w.TenantId == tenantId && w.UserId == memberId && w.ReportId == report.Id, () => new UserWarning { TenantId = tenantId, UserId = memberId, IssuedById = adminId, Reason = "Demo informal safety reminder for public first exchanges.", Severity = WarningSeverity.Informal, ReportId = report.Id, AcknowledgedAt = now.AddHours(-12), CreatedAt = now.AddDays(-1) });

        await EnsureAsync(db, c => c.TenantId == tenantId && c.UserId == memberId && c.ConsentType == "terms_of_service", () => new ConsentRecord { TenantId = tenantId, UserId = memberId, ConsentType = "terms_of_service", IsGranted = true, GrantedAt = now.AddDays(-30), IpAddress = "127.0.0.1", CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, c => c.TenantId == tenantId && c.UserId == memberId && c.SessionId == "demo-member-cookie", () => new CookieConsent { TenantId = tenantId, UserId = memberId, SessionId = "demo-member-cookie", AnalyticsCookies = true, MarketingCookies = false, PreferenceCookies = true, IpAddress = "127.0.0.1", UserAgent = "Demo browser", ConsentedAt = now.AddDays(-30), CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, p => p.TenantId == tenantId && p.Version == "2.0-demo", () => new CookiePolicy { TenantId = tenantId, Version = "2.0-demo", ContentHtml = "<p>Demo cookie policy for local development.</p>", IsActive = true, PublishedAt = now.AddDays(-30), CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, c => c.TenantId == tenantId && c.Key == "terms_of_service", () => new GdprConsentType { TenantId = tenantId, Key = "terms_of_service", Name = "Terms of Service", Description = "Required platform terms acceptance.", IsRequired = true, Version = 2, IsActive = true, CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, b => b.TenantId == tenantId && b.Title == "Demo low-severity breach exercise", () => new GdprBreach { TenantId = tenantId, Title = "Demo low-severity breach exercise", Description = "A simulated breach record for admin workflow demos.", Severity = "low", Status = "resolved", AffectedUsersCount = 0, DataTypesAffected = "demo metadata", DetectedAt = now.AddDays(-15), ContainedAt = now.AddDays(-15).AddHours(2), ResolvedAt = now.AddDays(-14), RemediationSteps = "Confirmed no production data involved.", ReportedById = adminId, CreatedAt = now.AddDays(-15) });
        await EnsureAsync(db, e => e.TenantId == tenantId && e.UserId == memberId && e.Status == ExportStatus.Ready, () => new DataExportRequest { TenantId = tenantId, UserId = memberId, Status = ExportStatus.Ready, Format = "json", FileUrl = "/api/gdpr/export/demo-member.json", FileSizeBytes = 42000, RequestedAt = now.AddDays(-4), CompletedAt = now.AddDays(-3), ExpiresAt = now.AddDays(27), CreatedAt = now.AddDays(-4) });
        await EnsureAsync(db, d => d.TenantId == tenantId && d.UserId == youthId, () => new DataDeletionRequest { TenantId = tenantId, UserId = youthId, Status = DeletionStatus.Pending, Reason = "Demo pending guardian-managed deletion request.", ReviewedById = adminId, CreatedAt = now.AddDays(-1) });

        await EnsureAsync(db, vt => vt.Key == "identity-verified", () => new VerificationBadgeType { Key = "identity-verified", Name = "Identity verified", Description = "User completed tenant identity verification.", IconUrl = $"{AssetBaseUrl}/community-operations-table.png", SortOrder = 1, IsActive = true, CreatedAt = now.AddDays(-30) });
        var badgeType = await db.VerificationBadgeTypes.FirstAsync(v => v.Key == "identity-verified");
        await EnsureAsync(db, b => b.UserId == memberId && b.BadgeTypeId == badgeType.Id, () => new UserVerificationBadge { TenantId = tenantId, UserId = memberId, BadgeTypeId = badgeType.Id, AwardedAt = now.AddDays(-20), AwardedById = adminId, Notes = "Seeded demo verification badge." });

        await EnsureAsync(db, v => v.TenantId == tenantId && v.UserId == memberId && v.VettingType == "volunteer_reference", () => new VettingRecord { TenantId = tenantId, UserId = memberId, VettingType = "volunteer_reference", Status = "verified", ReferenceNumber = "DEMO-VET-001", IssuedAt = now.AddDays(-45), ExpiresAt = now.AddDays(320), DocumentUrl = "/api/files/demo-vetting/download", Notes = "Demo vetting record.", VerifiedById = adminId, VerifiedAt = now.AddDays(-40), CreatedAt = now.AddDays(-45) });
        await EnsureAsync(db, i => i.TenantId == tenantId && i.UserId == memberId && i.PolicyNumber == "DEMO-INS-001", () => new InsuranceCertificate { TenantId = tenantId, UserId = memberId, Type = "public_liability", Provider = "Demo Mutual", PolicyNumber = "DEMO-INS-001", CoverAmount = 1000000, StartDate = now.Date.AddDays(-60), ExpiryDate = now.Date.AddDays(305), DocumentUrl = "/api/files/demo-insurance/download", Status = "verified", VerifiedById = adminId, VerifiedAt = now.AddDays(-30), CreatedAt = now.AddDays(-60) });

        await EnsureAsync(db, b => b.TenantId == tenantId && b.BrokerId == brokerId && b.MemberId == memberId, () => new BrokerAssignment { TenantId = tenantId, BrokerId = brokerId, MemberId = memberId, Status = "active", Notes = "Demo broker support for first exchange.", AssignedAt = now.AddDays(-12), CreatedAt = now.AddDays(-12) });
        await EnsureAsync(db, n => n.TenantId == tenantId && n.BrokerId == brokerId && n.MemberId == memberId, () => new BrokerNote { TenantId = tenantId, BrokerId = brokerId, MemberId = memberId, Content = "Member is confident with repairs; first exchange should remain in community hub.", IsPrivate = true, CreatedAt = now.AddDays(-10) });
        await EnsureAsync(db, o => o.TenantId == tenantId && o.OptionKey == "public-first-meeting", () => new SafeguardingOption { TenantId = tenantId, OptionKey = "public-first-meeting", OptionType = "checkbox", Label = "First meeting in a public venue", Description = "Recommended for new exchanges and youth-supported accounts.", SortOrder = 1, IsActive = true, IsRequired = true, CreatedAt = now.AddDays(-30) });
        await EnsureAsync(db, a => a.TenantId == tenantId && a.WardUserId == youthId && a.GuardianUserId == guardianId, () => new SafeguardingAssignment { TenantId = tenantId, WardUserId = youthId, GuardianUserId = guardianId, Status = "active", ConsentGivenAt = now.AddDays(-20), AssignedAt = now.AddDays(-20), Notes = "Demo guardian relationship.", ExpiresAt = now.AddDays(365) });

        var flaggedMessage = await db.Messages.Where(m => m.TenantId == tenantId && m.ConversationId == conversationId).OrderByDescending(m => m.CreatedAt).FirstAsync();
        await EnsureAsync(db, r => r.TenantId == tenantId && r.MessageId == flaggedMessage.Id, () => new SafeguardingMessageReview { TenantId = tenantId, MessageId = flaggedMessage.Id, SenderId = flaggedMessage.SenderId, RecipientId = memberId, Severity = "low", FlagReason = "demo_manual_review", IsFlagged = true, ReviewedByUserId = brokerId, ReviewedAt = now.AddHours(-1), ReviewNotes = "Demo reviewed and cleared.", CreatedAt = now.AddHours(-2) });
        await EnsureAsync(db, r => r.TenantId == tenantId && r.ListingId == listingId, () => new BrokerRiskTag { TenantId = tenantId, ListingId = listingId, RiskLevel = "low", RiskType = "public_meeting_required", Notes = "Use public workshop for first repair exchange.", CreatedByUserId = brokerId, CreatedAt = now.AddDays(-8) });
        await EnsureAsync(db, r => r.TenantId == tenantId && r.UserId == youthId, () => new UserMonitoringRestriction { TenantId = tenantId, UserId = youthId, UnderMonitoring = true, MonitoringExpiresAt = now.AddDays(180), Reason = "Demo youth managed profile.", SetByUserId = adminId, CreatedAt = now.AddDays(-20) });

        await EnsureAsync(db, s => s.TenantId == tenantId && s.PrimaryUserId == guardianId && s.SubUserId == youthId, () => new SubAccount { TenantId = tenantId, PrimaryUserId = guardianId, SubUserId = youthId, Relationship = "dependent", DisplayName = "Sam's managed demo profile", CanTransact = false, CanMessage = false, CanJoinGroups = true, IsActive = true, CreatedAt = now.AddDays(-20) });
        await EnsureAsync(db, c => c.TenantId == tenantId && c.Email == "resident@example.test" && c.Subject == "Demo contact form", () => new ContactSubmission { TenantId = tenantId, Name = "Demo Resident", Email = "resident@example.test", Subject = "Demo contact form", Message = "Could someone explain how time credits work?", Category = "general", UserId = null, IsResolved = true, ResolvedById = adminId, ResolvedAt = now.AddDays(-1), ResolvedNote = "Replied with knowledge base link.", CreatedAt = now.AddDays(-2) });
        await EnsureAsync(db, e => e.TenantId == tenantId && e.Title == "Demo urgent volunteer call-out", () => new EmergencyAlert { TenantId = tenantId, Title = "Demo urgent volunteer call-out", Description = "Simulated alert for opening the community hub during a weather event.", Urgency = "high", ContactInfo = "hub@acme.test", IsActive = true, CreatedById = adminId, CreatedAt = now.AddDays(-1) });
        await EnsureAsync(db, l => l.TenantId == tenantId && l.UserId == memberId && l.ActivityType == "demo_showcase_opened", () => new MemberActivityLog { TenantId = tenantId, UserId = memberId, ActivityType = "demo_showcase_opened", Details = "Member opened the V2 showcase dashboard.", OccurredAt = now.AddHours(-2) });
    }

    private static async Task SeedFederationAndAutomationAsync(NexusDbContext db, int tenantId, int partnerTenantId, int adminId, int partnerAdminId, int localUserId, int sourceListingId, DateTime now)
    {
        var partner = await EnsureAsync(
            db,
            p => p.TenantId == tenantId && p.PartnerTenantId == partnerTenantId,
            () => new FederationPartner
            {
                TenantId = tenantId,
                PartnerTenantId = partnerTenantId,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = false,
                CreditExchangeRate = 1,
                RequestedById = adminId,
                ApprovedById = partnerAdminId,
                ApprovedAt = now.AddDays(-25),
                CreatedAt = now.AddDays(-30)
            });

        var apiKey = await EnsureAsync(
            db,
            k => k.TenantId == tenantId && k.Name == "Demo federation key",
            () => new FederationApiKey
            {
                TenantId = tenantId,
                KeyHash = HashHex("demo-federation-api-key"),
                KeyPrefix = "demo-fed",
                Name = "Demo federation key",
                Scopes = "listings,events,exchanges",
                IsActive = true,
                ExpiresAt = now.AddDays(180),
                LastUsedAt = now.AddHours(-2),
                RateLimitPerMinute = 120,
                CreatedAt = now.AddDays(-25)
            });

        await EnsureAsync(db, f => f.TenantId == tenantId && f.Feature == "federation.enabled", () => new FederationFeatureToggle { TenantId = tenantId, Feature = "federation.enabled", IsEnabled = true, Configuration = "{\"shareListings\":true,\"shareEvents\":true}", CreatedAt = now.AddDays(-25) });
        await EnsureAsync(db, s => s.TenantId == tenantId && s.UserId == localUserId, () => new FederationUserSetting { TenantId = tenantId, UserId = localUserId, FederationOptIn = true, ProfileVisible = false, ListingsVisible = true, CreatedAt = now.AddDays(-20) });
        await EnsureAsync(db, l => l.TenantId == partnerTenantId && l.SourceTenantId == tenantId && l.SourceListingId == sourceListingId, () => new FederatedListing { TenantId = partnerTenantId, SourceTenantId = tenantId, SourceListingId = sourceListingId, Title = "Federated repair cafe support", Description = "A cross-tenant view of the repair cafe listing.", ListingType = "offer", OwnerDisplayName = "Charlie C.", Status = FederatedListingStatus.Active, SyncedAt = now.AddHours(-2), CreatedAt = now.AddDays(-10) });
        await EnsureAsync(db, e => e.TenantId == tenantId && e.PartnerTenantId == partnerTenantId && e.LocalUserId == localUserId && e.SourceListingId == sourceListingId, () => new FederatedExchange { TenantId = tenantId, PartnerTenantId = partnerTenantId, LocalUserId = localUserId, RemoteUserDisplayName = "Globex Member", SourceListingId = sourceListingId, Status = ExchangeStatus.Accepted, AgreedHours = 2, CreditExchangeRate = 1, Notes = "Demo cross-tenant exchange.", CreatedAt = now.AddDays(-2) });
        await EnsureAsync(db, a => a.TenantId == tenantId && a.PartnerTenantId == partnerTenantId && a.Action == "listing.shared", () => new FederationAuditLog { TenantId = tenantId, PartnerTenantId = partnerTenantId, Action = "listing.shared", EntityType = "Listing", EntityId = sourceListingId, Details = "{\"demo\":true}", CreatedAt = now.AddDays(-10) });
        await EnsureAsync(db, l => l.ApiKeyId == apiKey.Id && l.Path == "/api/federation/listings", () => new FederationApiLog { TenantId = tenantId, ApiKeyId = apiKey.Id, HttpMethod = "GET", Path = "/api/federation/listings", StatusCode = 200, IpAddress = "127.0.0.1", DurationMs = 42, Direction = "inbound", CreatedAt = now.AddHours(-2) });

        await EnsureAsync(db, t => t.TenantId == tenantId && t.TaskName == "demo_compute_matches", () => new ScheduledTask { TenantId = tenantId, TaskName = "demo_compute_matches", Status = ScheduledTaskStatus.Completed, LastRunAt = now.AddHours(-1), NextRunAt = now.AddHours(23), CronExpression = "0 2 * * *", Parameters = "{\"demo\":true}", RunCount = 12, AverageDurationMs = 860, CreatedAt = now.AddDays(-20) });
        await EnsureAsync(db, a => a.TenantId == tenantId && a.Title == "Project NEXUS .NET Edition demo data loaded", () => new PlatformAnnouncement { TenantId = tenantId, Title = "Project NEXUS .NET Edition demo data loaded", Content = "All major modules have local showcase data. Use the demo accounts to explore member, broker and admin paths.", Type = AnnouncementType.Info, IsActive = true, StartsAt = now.AddDays(-1), EndsAt = now.AddDays(30), CreatedById = adminId, CreatedAt = now.AddDays(-1) });
        await EnsureAsync(db, w => w.TenantId == tenantId && w.EventType == "demo.seed.completed", () => new WebhookEvent { TenantId = tenantId, EventType = "demo.seed.completed", Source = "demo-showcase-seeder", PayloadJson = "{\"version\":2}", Status = "processed", ReceivedAt = now });
    }

    private static async Task<User> EnsureUserAsync(NexusDbContext db, int tenantId, string email, string firstName, string lastName, string role, string passwordHash, DateTime now, string bio, string avatarUrl)
    {
        return await EnsureAsync(
            db,
            u => u.TenantId == tenantId && u.Email == email,
            () => new User
            {
                TenantId = tenantId,
                Email = email,
                PasswordHash = passwordHash,
                FirstName = firstName,
                LastName = lastName,
                Role = role,
                IsActive = true,
                CreatedAt = now.AddDays(-90),
                LastLoginAt = now.AddHours(-6),
                AvatarUrl = avatarUrl,
                Bio = bio,
                RegistrationStatus = RegistrationStatus.Active,
                EmailVerified = true,
                EmailVerifiedAt = now.AddDays(-80),
                TotalXp = role == "admin" ? 1500 : 850,
                Level = role == "admin" ? 6 : 4
            },
            u =>
            {
                u.FirstName = firstName;
                u.LastName = lastName;
                u.Role = role;
                u.IsActive = true;
                u.AvatarUrl = avatarUrl;
                u.Bio = bio;
                u.RegistrationStatus = RegistrationStatus.Active;
                u.EmailVerified = true;
                u.EmailVerifiedAt ??= now.AddDays(-80);
                u.TotalXp = Math.Max(u.TotalXp, role == "admin" ? 1500 : 850);
                u.Level = Math.Max(u.Level, role == "admin" ? 6 : 4);
                if (!BCrypt.Net.BCrypt.Verify(DemoPassword, u.PasswordHash))
                {
                    u.PasswordHash = passwordHash;
                    u.UpdatedAt = now;
                }
            });
    }

    private static async Task EnsureAllUsersHaveDemoPasswordAsync(NexusDbContext db, string passwordHash, DateTime now)
    {
        var users = await db.Users.ToListAsync();
        foreach (var user in users)
        {
            if (string.IsNullOrWhiteSpace(user.PasswordHash) || !BCrypt.Net.BCrypt.Verify(DemoPassword, user.PasswordHash))
            {
                user.PasswordHash = passwordHash;
                user.UpdatedAt = now;
            }
        }

        await db.SaveChangesAsync();
    }

    private static async Task<Listing> EnsureListingAsync(NexusDbContext db, int tenantId, int userId, string title, string description, ListingType type, int categoryId, string location, decimal hours, bool isFeatured, int viewCount, DateTime createdAt)
    {
        return await EnsureAsync(
            db,
            l => l.TenantId == tenantId && l.Title == title,
            () => new Listing
            {
                TenantId = tenantId,
                UserId = userId,
                Title = title,
                Description = description,
                Type = type,
                Status = ListingStatus.Active,
                CategoryId = categoryId,
                Location = location,
                EstimatedHours = hours,
                IsFeatured = isFeatured,
                ViewCount = viewCount,
                ExpiresAt = DateTime.UtcNow.AddDays(90),
                CreatedAt = createdAt
            },
            l =>
            {
                l.Description = description;
                l.Type = type;
                l.Status = ListingStatus.Active;
                l.CategoryId = categoryId;
                l.Location = location;
                l.EstimatedHours = hours;
                l.IsFeatured = isFeatured;
                l.ViewCount = Math.Max(l.ViewCount, viewCount);
                l.ExpiresAt ??= DateTime.UtcNow.AddDays(90);
            });
    }

    private static async Task<Message> EnsureMessageAsync(NexusDbContext db, int tenantId, int conversationId, int senderId, string content, bool isRead, DateTime createdAt)
    {
        return await EnsureAsync(
            db,
            m => m.TenantId == tenantId && m.ConversationId == conversationId && m.Content == content,
            () => new Message
            {
                TenantId = tenantId,
                ConversationId = conversationId,
                SenderId = senderId,
                Content = content,
                IsRead = isRead,
                CreatedAt = createdAt,
                ReadAt = isRead ? createdAt.AddMinutes(20) : null
            });
    }

    private static async Task<FileUpload> EnsureFileUploadAsync(NexusDbContext db, IWebHostEnvironment? env, int tenantId, int userId, string assetName, FileCategory category, int? entityId, string? entityType, DateTime now)
    {
        var contentRoot = env?.ContentRootPath ?? AppContext.BaseDirectory;
        var webRoot = env?.WebRootPath;
        if (string.IsNullOrWhiteSpace(webRoot))
        {
            webRoot = Path.Combine(contentRoot, "wwwroot");
        }

        var sourcePath = Path.Combine(webRoot, "demo-assets", assetName);
        var relativePath = Path.Combine(tenantId.ToString(), category.ToString().ToLowerInvariant(), assetName).Replace('\\', '/');
        var uploadsRoot = Environment.GetEnvironmentVariable("FileUpload__UploadsRoot") ?? Path.Combine(AppContext.BaseDirectory, "uploads");
        var destinationPath = Path.Combine(uploadsRoot, relativePath);

        if (File.Exists(sourcePath) && !File.Exists(destinationPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            File.Copy(sourcePath, destinationPath);
        }

        var fileInfo = File.Exists(destinationPath)
            ? new FileInfo(destinationPath)
            : File.Exists(sourcePath)
                ? new FileInfo(sourcePath)
                : null;

        return await EnsureAsync(
            db,
            f => f.TenantId == tenantId && f.OriginalFilename == assetName && f.EntityType == entityType && f.EntityId == entityId,
            () => new FileUpload
            {
                TenantId = tenantId,
                UserId = userId,
                OriginalFilename = assetName,
                StoredFilename = assetName,
                FilePath = relativePath,
                ContentType = "image/png",
                FileSizeBytes = fileInfo?.Length ?? 0,
                Category = category,
                EntityId = entityId,
                EntityType = entityType,
                CreatedAt = now
            },
            f =>
            {
                f.FilePath = relativePath;
                f.ContentType = "image/png";
                f.FileSizeBytes = fileInfo?.Length ?? f.FileSizeBytes;
            });
    }

    private static async Task<T> EnsureAsync<T>(
        NexusDbContext db,
        Expression<Func<T, bool>> predicate,
        Func<T> create,
        Action<T>? update = null)
        where T : class
    {
        var set = db.Set<T>();
        var entity = await set.FirstOrDefaultAsync(predicate);
        if (entity == null)
        {
            entity = create();
            set.Add(entity);
        }

        update?.Invoke(entity);
        await db.SaveChangesAsync();
        return entity;
    }

    private static string HashHex(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
