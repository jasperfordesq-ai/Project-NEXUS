// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;
using System.Security.Cryptography;
using System.Text;

namespace Nexus.Api.Data;

/// <summary>
/// Minimal seed data for Phase 0 testing.
/// Creates tenants and users to verify tenant isolation.
/// </summary>
public static class SeedData
{
    public static async Task SeedAsync(NexusDbContext db, ILogger logger, IWebHostEnvironment? env = null)
    {
        // Hard guard: refuse to seed in Production regardless of how this is called
        if (env != null && env.IsProduction())
        {
            logger.LogWarning("SeedData.SeedAsync called in Production environment — aborted. This is test-only data.");
            return;
        }

        // Check if already seeded
        if (await db.Tenants.AnyAsync())
        {
            logger.LogInformation("Database already seeded");
            return;
        }

        logger.LogInformation("Seeding database...");

        // Create tenants
        var tenant1 = new Tenant
        {
            Id = 1,
            Slug = "acme",
            Name = "ACME Corporation",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        var tenant2 = new Tenant
        {
            Id = 2,
            Slug = "globex",
            Name = "Globex Industries",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        db.Tenants.AddRange(tenant1, tenant2);

        // Create test users with the strong local demo password shared by the V2 showcase seed.
        // BCrypt hash computed at runtime for deterministic seeding
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(DemoShowcaseSeedData.DemoPassword);

        var user1 = new User
        {
            Id = 1,
            TenantId = 1,
            Email = "admin@acme.test",
            PasswordHash = passwordHash,
            FirstName = "Alice",
            LastName = "Admin",
            Role = "admin",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        var user2 = new User
        {
            Id = 2,
            TenantId = 2,
            Email = "admin@globex.test",
            PasswordHash = passwordHash,
            FirstName = "Bob",
            LastName = "Boss",
            Role = "admin",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        var user3 = new User
        {
            Id = 3,
            TenantId = 1,
            Email = "member@acme.test",
            PasswordHash = passwordHash,
            FirstName = "Charlie",
            LastName = "Contributor",
            Role = "member",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        db.Users.AddRange(user1, user2, user3);

        // Create listings for testing tenant isolation and search
        // Seed data matches PHASE15_EXECUTION.md test expectations
        var listings = new List<Listing>
        {
            // Tenant 1 (ACME) listings
            new Listing
            {
                Id = 1,
                TenantId = 1,
                UserId = 1,
                Title = "Home Repair Assistance",
                Description = "I can help with basic home repairs - fixing doors, shelves, minor plumbing issues.",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                Location = "Downtown",
                EstimatedHours = 2.0m,
                CreatedAt = DateTime.UtcNow.AddDays(-5)
            },
            new Listing
            {
                Id = 3,
                TenantId = 1,
                UserId = 3,
                Title = "Garden Weeding Services",
                Description = "Happy to help with garden maintenance and weeding.",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                Location = "Suburbs",
                EstimatedHours = 1.5m,
                IsFeatured = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            },
            new Listing
            {
                Id = 4,
                TenantId = 1,
                UserId = 1,
                Title = "Bike Repair",
                Description = "Can fix flat tires, adjust brakes, and general bike maintenance.",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                Location = "Downtown",
                EstimatedHours = 1.0m,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            },
            // Tenant 2 (Globex) listings
            new Listing
            {
                Id = 2,
                TenantId = 2,
                UserId = 2,
                Title = "Language Tutoring",
                Description = "Can teach Spanish, French, or English as a second language.",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                Location = "Library",
                EstimatedHours = 1.0m,
                CreatedAt = DateTime.UtcNow.AddDays(-4)
            },
            new Listing
            {
                Id = 5,
                TenantId = 2,
                UserId = 2,
                Title = "Cooking Classes",
                Description = "Learn to cook healthy meals from scratch.",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                Location = "Community Center",
                EstimatedHours = 2.0m,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            }
        };

        db.Listings.AddRange(listings);

        // Create transactions for testing wallet functionality
        var transactions = new List<Transaction>
        {
            // Tenant 1 (ACME) transactions
            // Alice (user 1) receives 5 hours for home repair
            new Transaction
            {
                Id = 1,
                TenantId = 1,
                SenderId = 3,  // Charlie
                ReceiverId = 1,  // Alice
                Amount = 2.0m,
                Description = "Payment for home repair assistance",
                ListingId = 1,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-4)
            },
            // Charlie (user 3) receives 1.5 hours for gardening
            new Transaction
            {
                Id = 2,
                TenantId = 1,
                SenderId = 1,  // Alice
                ReceiverId = 3,  // Charlie
                Amount = 1.5m,
                Description = "Payment for garden weeding",
                ListingId = 3,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            },
            // Another transaction between Alice and Charlie
            new Transaction
            {
                Id = 3,
                TenantId = 1,
                SenderId = 3,  // Charlie
                ReceiverId = 1,  // Alice
                Amount = 1.0m,
                Description = "Payment for bike repair",
                ListingId = 4,  // Bike Repair listing
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            },
            // A pending transaction
            new Transaction
            {
                Id = 4,
                TenantId = 1,
                SenderId = 1,  // Alice
                ReceiverId = 3,  // Charlie
                Amount = 2.0m,
                Description = "Upcoming service",
                Status = TransactionStatus.Pending,
                CreatedAt = DateTime.UtcNow
            },
            // Tenant 2 (Globex) - Bob has some transactions with himself (for initial balance)
            new Transaction
            {
                Id = 5,
                TenantId = 2,
                SenderId = 2,  // Bob (system credit)
                ReceiverId = 2,  // Bob
                Amount = 10.0m,
                Description = "Initial time credit allocation",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-10)
            }
        };

        db.Transactions.AddRange(transactions);

        // Create conversations and messages for testing messaging functionality
        var conversations = new List<Conversation>
        {
            // Conversation between Alice and Charlie (ACME tenant)
            new Conversation
            {
                Id = 1,
                TenantId = 1,
                Participant1Id = 1,  // Alice
                Participant2Id = 3,  // Charlie
                CreatedAt = DateTime.UtcNow.AddDays(-3),
                UpdatedAt = DateTime.UtcNow.AddHours(-2)
            }
        };

        db.Conversations.AddRange(conversations);

        var messages = new List<Message>
        {
            // Messages in Alice-Charlie conversation
            new Message
            {
                Id = 1,
                TenantId = 1,
                ConversationId = 1,
                SenderId = 1,  // Alice
                Content = "Hi Charlie! I saw your garden weeding offer. Are you available this weekend?",
                IsRead = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3),
                ReadAt = DateTime.UtcNow.AddDays(-3).AddMinutes(15)
            },
            new Message
            {
                Id = 2,
                TenantId = 1,
                ConversationId = 1,
                SenderId = 3,  // Charlie
                Content = "Hi Alice! Yes, I'm free Saturday afternoon. Would 2pm work for you?",
                IsRead = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3).AddMinutes(30),
                ReadAt = DateTime.UtcNow.AddDays(-3).AddHours(1)
            },
            new Message
            {
                Id = 3,
                TenantId = 1,
                ConversationId = 1,
                SenderId = 1,  // Alice
                Content = "Perfect! I'll see you then. My address is 123 Main St.",
                IsRead = true,
                CreatedAt = DateTime.UtcNow.AddDays(-3).AddHours(2),
                ReadAt = DateTime.UtcNow.AddDays(-2)
            },
            new Message
            {
                Id = 4,
                TenantId = 1,
                ConversationId = 1,
                SenderId = 3,  // Charlie
                Content = "Thanks for the payment! Let me know if you need any more help.",
                IsRead = true,
                CreatedAt = DateTime.UtcNow.AddDays(-1),
                ReadAt = DateTime.UtcNow.AddDays(-1).AddMinutes(10)
            },
            new Message
            {
                Id = 5,
                TenantId = 1,
                ConversationId = 1,
                SenderId = 3,  // Charlie (unread by Alice)
                Content = "By the way, I also do lawn mowing if you're interested!",
                IsRead = false,
                CreatedAt = DateTime.UtcNow.AddHours(-2)
            }
        };

        db.Messages.AddRange(messages);

        // Enable V1.5-compatible federation between the two seeded tenants.
        db.FederationSystemControls.Add(new FederationSystemControl
        {
            Id = 1,
            FederationEnabled = true,
            EmergencyLockdown = false,
            RequireTenantWhitelist = true,
            AutoApprovePartnerships = true,
            MaxPartnersPerTenant = 100,
            UpdatedAt = DateTime.UtcNow
        });

        db.FederationTenantWhitelists.AddRange(
            new FederationTenantWhitelist { Id = 1, TenantId = 1, IsEnabled = true, ApprovedByUserId = 1, Notes = "Seed federation enabled" },
            new FederationTenantWhitelist { Id = 2, TenantId = 2, IsEnabled = true, ApprovedByUserId = 2, Notes = "Seed federation enabled" });

        var federationFeatureId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            foreach (var feature in new[] { "profiles", "members", "listings", "messages", "transactions", "reviews", "events", "groups", "connections", "volunteering", "member_sync" })
            {
                db.FederationTenantFeatures.Add(new FederationTenantFeature
                {
                    Id = federationFeatureId++,
                    TenantId = tenantId,
                    Feature = feature,
                    IsEnabled = true,
                    UpdatedAt = DateTime.UtcNow
                });
            }
        }

        db.FederationPartners.AddRange(
            new FederationPartner
            {
                Id = 1,
                TenantId = 1,
                PartnerTenantId = 2,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                CreditExchangeRate = 1m,
                RequestedById = 1,
                ApprovedById = 2,
                ApprovedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            },
            new FederationPartner
            {
                Id = 2,
                TenantId = 2,
                PartnerTenantId = 1,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                CreditExchangeRate = 1m,
                RequestedById = 2,
                ApprovedById = 1,
                ApprovedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });

        db.FederationUserSettings.AddRange(
            new FederationUserSetting { Id = 1, TenantId = 1, UserId = 1, FederationOptIn = true, ProfileVisible = true, ListingsVisible = true, TransactionsEnabled = true },
            new FederationUserSetting { Id = 2, TenantId = 1, UserId = 3, FederationOptIn = true, ProfileVisible = true, ListingsVisible = true, TransactionsEnabled = true },
            new FederationUserSetting { Id = 3, TenantId = 2, UserId = 2, FederationOptIn = true, ProfileVisible = true, ListingsVisible = true, TransactionsEnabled = true });

        db.FederationApiKeys.AddRange(
            new FederationApiKey
            {
                Id = 1,
                TenantId = 1,
                Name = "Seed ACME federation key",
                KeyHash = Sha256("nxfed_seed_acme_to_globex"),
                KeyPrefix = "nxfed_se",
                Scopes = "*,listings,members,messages,messages:read,messages:write,transactions,transactions:read,transactions:write,reviews,reviews:read,reviews:write,exchanges",
                IsActive = true,
                RateLimitPerMinute = 600,
                CreatedAt = DateTime.UtcNow
            },
            new FederationApiKey
            {
                Id = 2,
                TenantId = 2,
                Name = "Seed Globex federation key",
                KeyHash = Sha256("nxfed_seed_globex_to_acme"),
                KeyPrefix = "nxfed_se",
                Scopes = "*,listings,members,messages,messages:read,messages:write,transactions,transactions:read,transactions:write,reviews,reviews:read,reviews:write,exchanges",
                IsActive = true,
                RateLimitPerMinute = 600,
                CreatedAt = DateTime.UtcNow
            });

        // Create connections for testing connection functionality
        var connections = new List<Connection>
        {
            // Alice and Charlie are connected (ACME tenant)
            new Connection
            {
                Id = 1,
                TenantId = 1,
                RequesterId = 1,  // Alice
                AddresseeId = 3,  // Charlie
                Status = Connection.Statuses.Accepted,
                CreatedAt = DateTime.UtcNow.AddDays(-5),
                UpdatedAt = DateTime.UtcNow.AddDays(-5).AddHours(1)
            }
        };

        db.Connections.AddRange(connections);

        // Create groups for search testing
        var groups = new List<Group>
        {
            // ACME tenant groups
            new Group
            {
                Id = 1,
                TenantId = 1,
                CreatedById = 1,  // Alice
                Name = "Community Gardeners",
                Description = "A group for local gardening enthusiasts to share tips and organize garden projects.",
                IsPrivate = false,
                CreatedAt = DateTime.UtcNow.AddDays(-10)
            },
            new Group
            {
                Id = 2,
                TenantId = 1,
                CreatedById = 1,  // Alice
                Name = "Home Repair Network",
                Description = "DIY enthusiasts helping each other with home repair projects.",
                IsPrivate = false,
                CreatedAt = DateTime.UtcNow.AddDays(-8)
            },
            // Globex tenant group
            new Group
            {
                Id = 3,
                TenantId = 2,
                CreatedById = 2,  // Bob
                Name = "Language Exchange",
                Description = "Practice languages with native speakers.",
                IsPrivate = false,
                CreatedAt = DateTime.UtcNow.AddDays(-7)
            }
        };

        db.Groups.AddRange(groups);

        // Create group owner memberships (group creators should be members with owner role)
        var groupMembers = new List<GroupMember>
        {
            new GroupMember { Id = 1, TenantId = 1, GroupId = 1, UserId = 1, Role = Group.Roles.Owner, JoinedAt = DateTime.UtcNow.AddDays(-10) },
            new GroupMember { Id = 2, TenantId = 1, GroupId = 2, UserId = 1, Role = Group.Roles.Owner, JoinedAt = DateTime.UtcNow.AddDays(-8) },
            new GroupMember { Id = 3, TenantId = 2, GroupId = 3, UserId = 2, Role = Group.Roles.Owner, JoinedAt = DateTime.UtcNow.AddDays(-7) }
        };

        db.GroupMembers.AddRange(groupMembers);

        // Create events for search testing
        var events = new List<Event>
        {
            // ACME tenant events
            new Event
            {
                Id = 1,
                TenantId = 1,
                CreatedById = 1,  // Alice
                GroupId = 1,  // Community Gardeners
                Title = "Gardening Workshop",
                Description = "Learn the basics of vegetable gardening in this hands-on workshop.",
                Location = "Community Center",
                StartsAt = DateTime.UtcNow.AddDays(7),
                EndsAt = DateTime.UtcNow.AddDays(7).AddHours(2),
                MaxAttendees = 20,
                IsCancelled = false,
                CreatedAt = DateTime.UtcNow.AddDays(-5)
            },
            new Event
            {
                Id = 2,
                TenantId = 1,
                CreatedById = 3,  // Charlie
                GroupId = 2,  // Home Repair Network
                Title = "Repair Meetup",
                Description = "Bring your broken items and we'll fix them together!",
                Location = "Makerspace",
                StartsAt = DateTime.UtcNow.AddDays(14),
                EndsAt = DateTime.UtcNow.AddDays(14).AddHours(3),
                MaxAttendees = 15,
                IsCancelled = false,
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            },
            // Globex tenant event
            new Event
            {
                Id = 3,
                TenantId = 2,
                CreatedById = 2,  // Bob
                GroupId = 3,  // Language Exchange
                Title = "Cooking Class",
                Description = "Learn to cook traditional dishes while practicing a new language.",
                Location = "Kitchen",
                StartsAt = DateTime.UtcNow.AddDays(10),
                EndsAt = DateTime.UtcNow.AddDays(10).AddHours(2),
                MaxAttendees = 10,
                IsCancelled = false,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            }
        };

        db.Events.AddRange(events);

        // Create event RSVPs (creators automatically RSVP as going)
        var eventRsvps = new List<EventRsvp>
        {
            new EventRsvp { Id = 1, TenantId = 1, EventId = 1, UserId = 1, Status = Event.RsvpStatus.Going, RespondedAt = DateTime.UtcNow.AddDays(-5) },
            new EventRsvp { Id = 2, TenantId = 1, EventId = 2, UserId = 3, Status = Event.RsvpStatus.Going, RespondedAt = DateTime.UtcNow.AddDays(-3) },
            new EventRsvp { Id = 3, TenantId = 2, EventId = 3, UserId = 2, Status = Event.RsvpStatus.Going, RespondedAt = DateTime.UtcNow.AddDays(-2) },
            // Charlie RSVPs to Alice's gardening workshop
            new EventRsvp { Id = 4, TenantId = 1, EventId = 1, UserId = 3, Status = Event.RsvpStatus.Going, RespondedAt = DateTime.UtcNow.AddDays(-4) }
        };

        db.EventRsvps.AddRange(eventRsvps);

        // Create feed posts for testing social feed
        var feedPosts = new List<FeedPost>
        {
            new FeedPost
            {
                Id = 1,
                TenantId = 1,
                UserId = 1,  // Alice
                Content = "Just completed my first home repair exchange! This timebanking community is amazing.",
                CreatedAt = DateTime.UtcNow.AddDays(-4)
            },
            new FeedPost
            {
                Id = 2,
                TenantId = 1,
                UserId = 3,  // Charlie
                GroupId = 1,  // Community Gardeners group
                Content = "Great turnout at today's garden meetup! We planted tomatoes, peppers, and herbs.",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            },
            new FeedPost
            {
                Id = 3,
                TenantId = 2,
                UserId = 2,  // Bob
                Content = "Looking forward to the upcoming cooking class! Who's joining?",
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            }
        };

        db.FeedPosts.AddRange(feedPosts);

        // Create badges for gamification (for both tenants)
        var badges = new List<Badge>();
        var badgeId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            badges.AddRange(new[]
            {
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.FirstListing,
                    Name = "First Listing",
                    Description = "Created your first listing on the marketplace",
                    Icon = "🏪",
                    XpReward = 25,
                    SortOrder = 1,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.FirstConnection,
                    Name = "First Connection",
                    Description = "Made your first connection with another member",
                    Icon = "🤝",
                    XpReward = 25,
                    SortOrder = 2,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.FirstTransaction,
                    Name = "First Transaction",
                    Description = "Completed your first time credit transaction",
                    Icon = "💰",
                    XpReward = 30,
                    SortOrder = 3,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.FirstPost,
                    Name = "First Post",
                    Description = "Shared your first post with the community",
                    Icon = "📝",
                    XpReward = 15,
                    SortOrder = 4,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.FirstEvent,
                    Name = "Event Host",
                    Description = "Created your first community event",
                    Icon = "🎉",
                    XpReward = 30,
                    SortOrder = 5,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.HelpfulNeighbor,
                    Name = "Helpful Neighbor",
                    Description = "Completed 10 transactions - you're making a real difference!",
                    Icon = "⭐",
                    XpReward = 100,
                    SortOrder = 6,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.CommunityBuilder,
                    Name = "Community Builder",
                    Description = "Created a community group",
                    Icon = "🏗️",
                    XpReward = 50,
                    SortOrder = 7,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.EventOrganizer,
                    Name = "Event Organizer",
                    Description = "Organized 5 or more community events",
                    Icon = "📅",
                    XpReward = 75,
                    SortOrder = 8,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.PopularPost,
                    Name = "Popular Post",
                    Description = "One of your posts received 10 or more likes",
                    Icon = "🔥",
                    XpReward = 40,
                    SortOrder = 9,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.Veteran,
                    Name = "Veteran",
                    Description = "Been a member for 1 year or more",
                    Icon = "🎖️",
                    XpReward = 100,
                    SortOrder = 10,
                    CreatedAt = DateTime.UtcNow
                },
                new Badge
                {
                    Id = badgeId++,
                    TenantId = tenantId,
                    Slug = Badge.Slugs.FirstReview,
                    Name = "First Review",
                    Description = "Left your first review for a member or listing",
                    Icon = "⭐",
                    XpReward = 20,
                    SortOrder = 11,
                    CreatedAt = DateTime.UtcNow
                }
            });
        }

        db.Badges.AddRange(badges);

        // Create reviews for testing review functionality
        var reviews = new List<Review>
        {
            // Charlie reviews Alice as a user (ACME tenant)
            new Review
            {
                Id = 1,
                TenantId = 1,
                ReviewerId = 3,  // Charlie
                TargetUserId = 1,  // Alice
                Rating = 5,
                Comment = "Alice was fantastic to work with! Very organized and punctual. Highly recommend!",
                CreatedAt = DateTime.UtcNow.AddDays(-4)
            },
            // Alice reviews Charlie as a user (ACME tenant)
            new Review
            {
                Id = 2,
                TenantId = 1,
                ReviewerId = 1,  // Alice
                TargetUserId = 3,  // Charlie
                Rating = 4,
                Comment = "Charlie did a great job weeding the garden. Will definitely use his services again.",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            },
            // Charlie reviews Alice's listing (ACME tenant)
            new Review
            {
                Id = 3,
                TenantId = 1,
                ReviewerId = 3,  // Charlie
                TargetListingId = 1,  // Home Repair Assistance listing by Alice
                Rating = 5,
                Comment = "Excellent home repair service. Fixed my squeaky door in no time!",
                CreatedAt = DateTime.UtcNow.AddDays(-3)
            },
            // Alice reviews Charlie's listing (ACME tenant)
            new Review
            {
                Id = 4,
                TenantId = 1,
                ReviewerId = 1,  // Alice
                TargetListingId = 3,  // Garden Weeding Services listing by Charlie
                Rating = 4,
                Comment = "The garden looks so much better now. Good work ethic.",
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            }
        };

        db.Reviews.AddRange(reviews);

        // Create categories for admin testing (for both tenants)
        var categories = new List<Category>();
        var categoryId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            categories.AddRange(new[]
            {
                new Category
                {
                    Id = categoryId++,
                    TenantId = tenantId,
                    Name = "Home Services",
                    Description = "Home repair, cleaning, gardening, and maintenance services",
                    Slug = "home-services",
                    SortOrder = 1,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                },
                new Category
                {
                    Id = categoryId++,
                    TenantId = tenantId,
                    Name = "Education & Tutoring",
                    Description = "Teaching, tutoring, and educational services",
                    Slug = "education-tutoring",
                    SortOrder = 2,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                },
                new Category
                {
                    Id = categoryId++,
                    TenantId = tenantId,
                    Name = "Transportation",
                    Description = "Rides, deliveries, and moving help",
                    Slug = "transportation",
                    SortOrder = 3,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                },
                new Category
                {
                    Id = categoryId++,
                    TenantId = tenantId,
                    Name = "Technology",
                    Description = "Computer help, tech support, and digital services",
                    Slug = "technology",
                    SortOrder = 4,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                },
                new Category
                {
                    Id = categoryId++,
                    TenantId = tenantId,
                    Name = "Health & Wellness",
                    Description = "Fitness, wellness, and health-related services",
                    Slug = "health-wellness",
                    SortOrder = 5,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                },
                new Category
                {
                    Id = categoryId++,
                    TenantId = tenantId,
                    Name = "Other",
                    Description = "Other services not fitting other categories",
                    Slug = "other",
                    SortOrder = 99,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                }
            });
        }

        db.Categories.AddRange(categories);

        // Create roles for admin testing (for both tenants)
        var roles = new List<Role>();
        var roleId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            roles.AddRange(new[]
            {
                new Role
                {
                    Id = roleId++,
                    TenantId = tenantId,
                    Name = Role.Names.Admin,
                    Description = "Full administrative access",
                    Permissions = "[\"admin.*\", \"users.*\", \"listings.*\", \"categories.*\", \"config.*\"]",
                    IsSystem = true,
                    CreatedAt = DateTime.UtcNow
                },
                new Role
                {
                    Id = roleId++,
                    TenantId = tenantId,
                    Name = Role.Names.Member,
                    Description = "Standard member access",
                    Permissions = "[\"listings.read\", \"listings.create\", \"messages.*\", \"profile.*\"]",
                    IsSystem = true,
                    CreatedAt = DateTime.UtcNow
                }
            });
        }

        db.Roles.AddRange(roles);

        // Create tenant config for admin testing
        var tenantConfigs = new List<TenantConfig>();
        var configId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            tenantConfigs.AddRange(new[]
            {
                new TenantConfig
                {
                    Id = configId++,
                    TenantId = tenantId,
                    Key = "theme.primaryColor",
                    Value = "#3B82F6",
                    CreatedAt = DateTime.UtcNow
                },
                new TenantConfig
                {
                    Id = configId++,
                    TenantId = tenantId,
                    Key = "features.aiAssistant",
                    Value = "true",
                    CreatedAt = DateTime.UtcNow
                },
                new TenantConfig
                {
                    Id = configId++,
                    TenantId = tenantId,
                    Key = "limits.maxListingsPerUser",
                    Value = "50",
                    CreatedAt = DateTime.UtcNow
                },
                new TenantConfig
                {
                    Id = configId++,
                    TenantId = tenantId,
                    Key = "moderation.requireApproval",
                    Value = "false",
                    CreatedAt = DateTime.UtcNow
                }
            });
        }

        db.TenantConfigs.AddRange(tenantConfigs);

        // Seed i18n supported locales and translations for both tenants
        var locales = new List<SupportedLocale>();
        var localeId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            foreach (var (locale, name, nativeName, isDefault) in I18nSeedData.SupportedLocales)
            {
                locales.Add(new SupportedLocale
                {
                    Id = localeId++,
                    TenantId = tenantId,
                    Locale = locale,
                    Name = name,
                    NativeName = nativeName,
                    IsDefault = isDefault,
                    IsActive = true,
                    CompletionPercent = locale == "en" ? 100 : 60,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }
        db.SupportedLocales.AddRange(locales);

        var translations = new List<Translation>();
        var translationId = 1;
        foreach (var tenantId in new[] { 1, 2 })
        {
            foreach (var (locale, keys) in I18nSeedData.Translations)
            {
                foreach (var (key, value) in keys)
                {
                    var ns = key.Contains('.') ? key[..key.IndexOf('.')] : "common";
                    translations.Add(new Translation
                    {
                        Id = translationId++,
                        TenantId = tenantId,
                        Locale = locale,
                        Key = key,
                        Value = value,
                        Namespace = ns,
                        IsApproved = true,
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }
        }
        db.Translations.AddRange(translations);

        await db.SaveChangesAsync();

        // Reset sequences after seeding with explicit IDs
        // This ensures new records get IDs higher than seed data
        // Note: Column names are quoted because EF Core uses PascalCase
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('tenants', 'Id'), (SELECT MAX(\"Id\") FROM tenants))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('users', 'Id'), (SELECT MAX(\"Id\") FROM users))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('listings', 'Id'), (SELECT MAX(\"Id\") FROM listings))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('transactions', 'Id'), (SELECT MAX(\"Id\") FROM transactions))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('conversations', 'Id'), (SELECT MAX(\"Id\") FROM conversations))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('messages', 'Id'), (SELECT MAX(\"Id\") FROM messages))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('connections', 'Id'), (SELECT MAX(\"Id\") FROM connections))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('groups', 'Id'), (SELECT MAX(\"Id\") FROM groups))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('group_members', 'Id'), (SELECT MAX(\"Id\") FROM group_members))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('events', 'Id'), (SELECT MAX(\"Id\") FROM events))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('event_rsvps', 'Id'), (SELECT MAX(\"Id\") FROM event_rsvps))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('feed_posts', 'Id'), (SELECT MAX(\"Id\") FROM feed_posts))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('badges', 'Id'), (SELECT MAX(\"Id\") FROM badges))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('reviews', 'Id'), (SELECT MAX(\"Id\") FROM reviews))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('categories', 'Id'), (SELECT MAX(\"Id\") FROM categories))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('roles', 'Id'), (SELECT MAX(\"Id\") FROM roles))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('tenant_configs', 'Id'), (SELECT MAX(\"Id\") FROM tenant_configs))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('supported_locales', 'Id'), (SELECT MAX(\"Id\") FROM supported_locales))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('translations', 'Id'), (SELECT MAX(\"Id\") FROM translations))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('federation_system_control', 'Id'), (SELECT MAX(\"Id\") FROM federation_system_control))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('federation_tenant_whitelist', 'Id'), (SELECT MAX(\"Id\") FROM federation_tenant_whitelist))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('federation_tenant_features', 'Id'), (SELECT MAX(\"Id\") FROM federation_tenant_features))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('federation_partners', 'Id'), (SELECT MAX(\"Id\") FROM federation_partners))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('federation_user_settings', 'Id'), (SELECT MAX(\"Id\") FROM federation_user_settings))");
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('federation_api_keys', 'Id'), (SELECT MAX(\"Id\") FROM federation_api_keys))");

        logger.LogInformation("Seeded {TenantCount} tenants, {UserCount} users, {ListingCount} listings, {TransactionCount} transactions, {ConversationCount} conversations, {MessageCount} messages, {ConnectionCount} connections, {GroupCount} groups, {EventCount} events, {RsvpCount} RSVPs, {PostCount} posts, {BadgeCount} badges, {ReviewCount} reviews, {CategoryCount} categories, {RoleCount} roles, {ConfigCount} configs, {LocaleCount} locales, {TranslationCount} translations",
            2, 3, listings.Count, transactions.Count, conversations.Count, messages.Count, connections.Count, groups.Count, events.Count, eventRsvps.Count, feedPosts.Count, badges.Count, reviews.Count, categories.Count, roles.Count, tenantConfigs.Count, locales.Count, translations.Count);
    }

    private static string Sha256(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }
}
