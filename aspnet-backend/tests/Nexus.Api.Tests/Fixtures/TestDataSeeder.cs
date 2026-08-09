// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests.Fixtures;

/// <summary>
/// Seeds test data for integration tests.
/// </summary>
public static class TestDataSeeder
{
    public const string TestPassword = "Test123!";
    public const string TestPasswordHash = "$2a$11$K7RqMfJ8XEQH8h8O8mP5P.5XQzC5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5O"; // BCrypt hash of Test123!
    public const string Tenant1FederationApiKey = "nxfed_test_tenant1";
    public const string Tenant2FederationApiKey = "nxfed_test_tenant2";

    public static async Task<TestData> SeedAsync(NexusDbContext db)
    {
        // Clear existing data
        await ClearDataAsync(db);

        // Create tenants
        var tenant1 = new Tenant
        {
            Slug = "test-tenant",
            Name = "Test Tenant",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        var tenant2 = new Tenant
        {
            Slug = "other-tenant",
            Name = "Other Tenant",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        db.Tenants.AddRange(tenant1, tenant2);
        await db.SaveChangesAsync();

        // Create users
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(TestPassword);

        var adminUser = new User
        {
            TenantId = tenant1.Id,
            Email = "admin@test.com",
            PasswordHash = passwordHash,
            FirstName = "Admin",
            LastName = "User",
            Role = "admin",
            IsActive = true,
            TotalXp = 100,
            Level = 2,
            CreatedAt = DateTime.UtcNow
        };

        var memberUser = new User
        {
            TenantId = tenant1.Id,
            Email = "member@test.com",
            PasswordHash = passwordHash,
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true,
            TotalXp = 500, // Enough balance for transfers
            Level = 3,
            CreatedAt = DateTime.UtcNow
        };

        var otherTenantUser = new User
        {
            TenantId = tenant2.Id,
            Email = "other@test.com",
            PasswordHash = passwordHash,
            FirstName = "Other",
            LastName = "User",
            Role = "member",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        db.Users.AddRange(adminUser, memberUser, otherTenantUser);
        await db.SaveChangesAsync();

        // Create initial transactions to give memberUser a balance
        var initialTransaction = new Transaction
        {
            TenantId = tenant1.Id,
            SenderId = adminUser.Id,
            ReceiverId = memberUser.Id,
            Amount = 10.0m,
            Description = "Initial balance",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };

        db.Transactions.Add(initialTransaction);
        await db.SaveChangesAsync();

        // Create listings
        var listing1 = new Listing
        {
            TenantId = tenant1.Id,
            UserId = adminUser.Id,
            Title = "Test Service",
            Description = "A test service listing",
            Type = ListingType.Offer,
            Status = ListingStatus.Active,
            EstimatedHours = 2.0m,
            CreatedAt = DateTime.UtcNow
        };

        var listing2 = new Listing
        {
            TenantId = tenant1.Id,
            UserId = memberUser.Id,
            Title = "Member Service",
            Description = "A service offered by member",
            Type = ListingType.Offer,
            Status = ListingStatus.Active,
            EstimatedHours = 1.5m,
            CreatedAt = DateTime.UtcNow
        };

        var listing3 = new Listing
        {
            TenantId = tenant2.Id,
            UserId = otherTenantUser.Id,
            Title = "Partner Gardening",
            Description = "A federated service from the partner tenant",
            Type = ListingType.Offer,
            Status = ListingStatus.Active,
            EstimatedHours = 3.0m,
            CreatedAt = DateTime.UtcNow
        };

        db.Listings.AddRange(listing1, listing2, listing3);
        await db.SaveChangesAsync();

        await SeedFederationAsync(db, tenant1, tenant2, adminUser, memberUser, otherTenantUser);

        // Listing reviews require a completed exchange involving the reviewer.
        // Seed one so review tests exercise the real production precondition.
        var completedExchange = new Exchange
        {
            TenantId = tenant1.Id,
            ListingId = listing1.Id,
            InitiatorId = memberUser.Id,
            ListingOwnerId = adminUser.Id,
            Status = ExchangeStatus.Completed,
            AgreedHours = 2.0m,
            CompletedAt = DateTime.UtcNow.AddHours(-1),
            CreatedAt = DateTime.UtcNow.AddDays(-2),
            UpdatedAt = DateTime.UtcNow.AddHours(-1)
        };

        db.Exchanges.Add(completedExchange);
        await db.SaveChangesAsync();

        // Create badges for gamification tests
        var badges = new[]
        {
            new Badge { TenantId = tenant1.Id, Slug = Badge.Slugs.FirstListing, Name = "First Listing", XpReward = 25, IsActive = true },
            new Badge { TenantId = tenant1.Id, Slug = Badge.Slugs.FirstConnection, Name = "First Connection", XpReward = 25, IsActive = true },
            new Badge { TenantId = tenant1.Id, Slug = Badge.Slugs.FirstTransaction, Name = "First Transaction", XpReward = 30, IsActive = true },
        };

        db.Badges.AddRange(badges);
        await db.SaveChangesAsync();

        return new TestData
        {
            Tenant1 = tenant1,
            Tenant2 = tenant2,
            AdminUser = adminUser,
            MemberUser = memberUser,
            OtherTenantUser = otherTenantUser,
            Listing1 = listing1,
            Listing2 = listing2,
            PartnerListing = listing3
        };
    }

    private static async Task SeedFederationAsync(
        NexusDbContext db,
        Tenant tenant1,
        Tenant tenant2,
        User adminUser,
        User memberUser,
        User otherTenantUser)
    {
        db.Set<FederationSystemControl>().Add(new FederationSystemControl
        {
            FederationEnabled = true,
            EmergencyLockdown = false,
            RequireTenantWhitelist = true,
            UpdatedAt = DateTime.UtcNow
        });

        db.Set<FederationTenantWhitelist>().AddRange(
            new FederationTenantWhitelist { TenantId = tenant1.Id, IsEnabled = true, ApprovedAt = DateTime.UtcNow, ApprovedByUserId = adminUser.Id },
            new FederationTenantWhitelist { TenantId = tenant2.Id, IsEnabled = true, ApprovedAt = DateTime.UtcNow, ApprovedByUserId = adminUser.Id });

        var features = new[]
        {
            "profiles", "members", "listings", "messages", "transactions", "reviews",
            "events", "groups", "connections", "volunteering", "member_sync"
        };

        db.Set<FederationTenantFeature>().AddRange(
            features.SelectMany(feature => new[]
            {
                new FederationTenantFeature { TenantId = tenant1.Id, Feature = feature, IsEnabled = true, UpdatedAt = DateTime.UtcNow },
                new FederationTenantFeature { TenantId = tenant2.Id, Feature = feature, IsEnabled = true, UpdatedAt = DateTime.UtcNow }
            }));

        db.Set<FederationPartner>().AddRange(
            new FederationPartner
            {
                TenantId = tenant1.Id,
                PartnerTenantId = tenant2.Id,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                TransactionsEnabled = true,
                CreditExchangeRate = 1.0m,
                RequestedById = adminUser.Id,
                ApprovedById = adminUser.Id,
                ApprovedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            },
            new FederationPartner
            {
                TenantId = tenant2.Id,
                PartnerTenantId = tenant1.Id,
                Status = PartnerStatus.Active,
                SharedListings = true,
                SharedEvents = true,
                SharedMembers = true,
                TransactionsEnabled = true,
                CreditExchangeRate = 1.0m,
                RequestedById = otherTenantUser.Id,
                ApprovedById = adminUser.Id,
                ApprovedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });

        db.Set<FederationUserSetting>().AddRange(
            new FederationUserSetting { TenantId = tenant1.Id, UserId = adminUser.Id, FederationOptIn = true, ProfileVisible = true, ListingsVisible = true, TransactionsEnabled = true },
            new FederationUserSetting { TenantId = tenant1.Id, UserId = memberUser.Id, FederationOptIn = true, ProfileVisible = true, ListingsVisible = true, TransactionsEnabled = true },
            new FederationUserSetting { TenantId = tenant2.Id, UserId = otherTenantUser.Id, FederationOptIn = true, ProfileVisible = true, ListingsVisible = true, TransactionsEnabled = true });

        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenant1.Id,
            Key = "admin_explicit.federation.credit_agreements",
            Value = $"[{{\"id\":1,\"fromTenantId\":{tenant1.Id},\"toTenantId\":{tenant2.Id},\"exchangeRate\":1.0,\"maxMonthlyCredits\":10000,\"status\":\"active\"}}]",
            CreatedAt = DateTime.UtcNow
        });

        const string scopes = "*,listings,members,messages,messages:read,messages:write,transactions,transactions:read,transactions:write,reviews,reviews:read,reviews:write,exchanges";
        db.Set<FederationApiKey>().AddRange(
            new FederationApiKey
            {
                TenantId = tenant1.Id,
                Name = "Tenant 1 federation test key",
                KeyHash = Sha256(Tenant1FederationApiKey),
                KeyPrefix = Tenant1FederationApiKey[..8],
                Scopes = scopes,
                IsActive = true,
                RateLimitPerMinute = 600,
                CreatedAt = DateTime.UtcNow
            },
            new FederationApiKey
            {
                TenantId = tenant2.Id,
                Name = "Tenant 2 federation test key",
                KeyHash = Sha256(Tenant2FederationApiKey),
                KeyPrefix = Tenant2FederationApiKey[..8],
                Scopes = scopes,
                IsActive = true,
                RateLimitPerMinute = 600,
                CreatedAt = DateTime.UtcNow
            });

        await db.SaveChangesAsync();
    }

    private static async Task ClearDataAsync(NexusDbContext db)
    {
        // Use raw SQL to truncate all tables and reset sequences in the correct order
        // This is faster and avoids FK constraint issues.
        // Uses DO block to skip tables that may not exist yet (e.g. pending migrations).
        // Scheduled-job integration hosts keep their real IHostedService
        // registrations. Give an in-flight job a bounded window to release its
        // table lock instead of failing at the provider's 30-second default.
        var previousCommandTimeout = db.Database.GetCommandTimeout();
        db.Database.SetCommandTimeout(TimeSpan.FromMinutes(2));
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
            DO $$
            DECLARE
                tbl TEXT;
                tables TEXT[] := ARRAY[
                    'event_registration_retention_items','event_registration_retention_runs',
                    'event_registration_guest_attendance_history','event_registration_guest_attendance',
                    'event_registration_guests','event_invitation_delivery_evidence',
                    'event_invitation_history','event_invitations',
                    'event_invitation_campaign_history','event_invitation_campaigns',
                    'event_registration_answer_access_audits','event_registration_submission_history',
                    'event_registration_form_answers','event_registration_form_submissions',
                    'event_registration_form_questions','event_registration_form_versions',
                    'event_registration_settings_history','event_registration_settings',
                    'event_federation_deliveries',
                    'federation_external_partner_logs','federation_external_partners',
                    'federation_webhook_nonces','federation_system_control',
                    'federation_tenant_whitelist','federation_tenant_features',
                    'federation_api_logs','federation_api_keys',
                    'federation_user_settings','federation_feature_toggles',
                    'merchant_coupon_redemptions','merchant_coupons',
                    'marketplace_disputes','marketplace_payments',
                    'marketplace_seller_ratings','marketplace_delivery_offers',
                    'marketplace_pickup_reservations','marketplace_pickup_slots',
                    'marketplace_shipping_options','marketplace_promotions',
                    'marketplace_collection_items','marketplace_collections',
                    'marketplace_saved_searches','marketplace_saved_listings',
                    'marketplace_reports','marketplace_orders','marketplace_offers',
                    'marketplace_images','marketplace_listings',
                    'marketplace_seller_profiles','marketplace_categories',
                    'group_recommendation_events','group_chatroom_pins',
                    'group_welcome_settings','group_custom_fields',
                    'group_notification_preferences','group_webhooks',
                    'group_scheduled_posts','group_challenges','group_qa_votes',
                    'group_answers','group_questions','group_wiki_revisions',
                    'group_wiki_pages','group_media_items','group_invites',
                    'story_highlight_items','story_highlights','story_close_friends',
                    'story_reactions','story_views','stories',
                    'feed_activity',
                    'employer_reviews','job_referrals','job_pipeline_rules',
                    'job_scorecards','job_offer_templates','job_offers',
                    'job_interview_slots','job_interviews',
                    'job_vacancy_team_members','job_templates','job_saved_profiles',
                    'legal_document_acceptances','legal_documents',
                    'knowledge_articles','member_vetting_attestation_events',
                    'safeguarding_policy_rotation_events','safeguarding_vetting_review_requests',
                    'member_vetting_attestations','tenant_safeguarding_settings',
                    'user_safeguarding_preferences',
                    'safeguarding_options','user_preferences',
                    'saved_jobs','job_applications','job_vacancies'
                ];
            BEGIN
                FOREACH tbl IN ARRAY tables LOOP
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
                        EXECUTE 'TRUNCATE TABLE ' || tbl || ' CASCADE';
                    END IF;
                END LOOP;
            END $$;

            TRUNCATE TABLE
                -- Audit follow-up tables
                provisioning_requests,
                api_partner_wallet_credits,
                api_partner_access_tokens,
                api_partners,
                -- Phase 16-37 tables (scaffolded)
                file_uploads,
                totp_backup_codes,
                user_passkeys,
                platform_announcements,
                scheduled_tasks,
                system_settings,
                volunteer_availabilities,
                staffing_predictions,
                federation_audit_logs,
                federated_exchanges,
                federated_listings,
                federation_partners,
                user_language_preferences,
                supported_locales,
                translations,
                notification_preferences,
                push_notification_logs,
                push_subscriptions,
                cookie_policies,
                cookie_consents,
                newsletter_subscriptions,
                newsletters,
                admin_notes,
                post_shares,
                feed_bookmarks,
                user_locations,
                consent_records,
                data_deletion_requests,
                data_export_requests,
                user_warnings,
                content_reports,
                digest_preferences,
                email_logs,
                email_templates,
                audit_logs,
                endorsements,
                user_skills,
                skills,
                daily_rewards,
                leaderboard_entries,
                leaderboard_seasons,
                streaks,
                challenge_participants,
                challenges,
                group_discussion_replies,
                group_discussions,
                group_files,
                group_policies,
                group_announcements,
                listing_tags,
                listing_favorites,
                listing_analytics,
                credit_donations,
                balance_alerts,
                transaction_limits,
                transaction_categories,
                vol_wellbeing_alerts,
                volunteer_check_ins,
                volunteer_applications,
                volunteer_shifts,
                volunteer_opportunities,
                vol_org_transactions,
                org_members,
                vol_organizations,
                match_results,
                match_preferences,
                exchange_ratings,
                exchanges,
                -- Phase 0-15 tables (tested)
                identity_verification_events,
                identity_verification_sessions,
                tenant_registration_policies,
                ai_messages,
                ai_conversations,
                xp_logs,
                user_badges,
                post_comments,
                post_likes,
                feed_posts,
                event_broadcast_delivery_attempts,
                event_broadcast_deliveries,
                event_broadcast_history,
                event_broadcasts,
                event_template_audit,
                event_template_materializations,
                event_template_versions,
                event_templates,
                event_recurrence_definition_applications,
                event_recurrence_definition_blueprints,
                event_recurrence_occurrence_ledger,
                event_recurrence_revisions,
                event_recurrence_rules,
                event_domain_outbox,
                event_status_history,
                event_reminders,
                event_attendance_activity,
                event_attendance,
                event_session_registration_history,
                event_session_registrations,
                event_session_resources,
                event_session_speakers,
                event_session_history,
                event_sessions,
                event_staff_assignment_history,
                event_staff_assignments,
                event_calendar_feed_tokens,
                event_participation_denial_history,
                event_participation_denials,
                event_guardian_consent_history,
                event_guardian_consents,
                event_safety_code_acknowledgements,
                event_safety_requirement_history,
                event_safety_requirement_versions,
                event_safety_requirements,
                event_ticket_inventory_history,
                event_ticket_entitlement_history,
                event_ticket_entitlements,
                event_ticket_type_history,
                event_ticket_types,
                event_offline_sync_decisions,
                event_offline_sync_items,
                event_offline_sync_batches,
                event_checkin_devices,
                event_checkin_credentials,
                event_waitlist_entry_history,
                event_registration_history,
                event_waitlist_entries,
                event_registrations,
                event_rsvps,
                events,
                group_members,
                groups,
                notifications,
                user_blocks,
                connections,
                messages,
                conversations,
                transactions,
                reviews,
                listings,
                password_reset_tokens,
                refresh_tokens,
                badges,
                categories,
                tenant_configs,
                roles,
                users,
                tenants
            RESTART IDENTITY CASCADE;
            ");
        }
        finally
        {
            db.Database.SetCommandTimeout(previousCommandTimeout);
        }
    }

    private static string Sha256(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

public class TestData
{
    public required Tenant Tenant1 { get; init; }
    public required Tenant Tenant2 { get; init; }
    public required User AdminUser { get; init; }
    public required User MemberUser { get; init; }
    public required User OtherTenantUser { get; init; }
    public required Listing Listing1 { get; init; }
    public required Listing Listing2 { get; init; }
    public required Listing PartnerListing { get; init; }
}
