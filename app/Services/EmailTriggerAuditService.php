<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Models\EmailSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Audits whether business events that should produce emails are actually
 * creating tenant-scoped send attempts.
 *
 * email_log proves dispatch/acceptance/delivery. This service covers the
 * earlier enterprise reliability layer: "the domain event happened, but did
 * any email path fire for the right tenant and recipient?"
 */
class EmailTriggerAuditService
{
    /**
     * Enterprise notification contract. Keep entries machine-readable so admin
     * UI can render translated labels around module/event/category codes.
     *
     * @return list<array<string, mixed>>
     */
    public function eventMatrix(): array
    {
        return [
            ['module' => 'auth', 'event' => 'password_reset_requested', 'category' => 'password_reset', 'critical' => true, 'source_table' => 'password_resets'],
            ['module' => 'auth', 'event' => 'password_changed', 'category' => 'security_alert', 'critical' => true, 'source_table' => 'users'],
            ['module' => 'registration', 'event' => 'email_verification_required', 'category' => 'email_verification', 'critical' => true, 'source_table' => 'users'],
            ['module' => 'registration', 'event' => 'welcome_or_activation', 'category' => 'welcome', 'critical' => true, 'source_table' => 'users'],
            ['module' => 'registration', 'event' => 'welcome_or_activation', 'category' => 'activation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'admin_users', 'event' => 'admin_welcome_or_activation', 'category' => 'admin_welcome', 'critical' => true, 'source_table' => 'users'],
            ['module' => 'security', 'event' => 'two_factor_or_passkey_changed', 'category' => 'security_alert', 'critical' => true, 'source_table' => 'users'],
            ['module' => 'groups', 'event' => 'group_email_invite', 'category' => 'group_invite', 'critical' => true, 'source_table' => 'group_invites'],
            ['module' => 'groups', 'event' => 'membership_or_role_change', 'category' => 'group', 'critical' => false, 'source_table' => 'group_members'],
            ['module' => 'groups', 'event' => 'group_approved_or_rejected', 'category' => 'group_approval', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'connections', 'event' => 'request_or_response', 'category' => 'connection', 'critical' => true, 'source_table' => 'notifications'],
            ['module' => 'sub_accounts', 'event' => 'linked_account_request_or_approval', 'category' => 'sub_account', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'sub_accounts', 'event' => 'support_action_prepared_or_answered', 'category' => 'support_action', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'messages', 'event' => 'direct_or_voice_message', 'category' => 'message', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'listings', 'event' => 'approval_expiry_saved_search', 'category' => 'listing', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'listings', 'event' => 'listing_expiry_reminder_source', 'category' => 'listing_expiry', 'critical' => true, 'source_table' => 'listing_expiry_reminders_sent'],
            ['module' => 'events', 'event' => 'rsvp_change_or_reminder', 'category' => 'event_reminder', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'events', 'event' => 'scheduled_event_reminder', 'category' => 'event_reminder', 'critical' => true, 'source_table' => 'event_reminders'],
            ['module' => 'events', 'event' => 'event_reminder_delivery_claim_source', 'category' => 'event_reminder', 'critical' => true, 'source_table' => 'event_reminder_delivery_claims'],
            ['module' => 'volunteering', 'event' => 'application_shift_reminder_hours_expense', 'category' => 'volunteering', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'volunteering', 'event' => 'volunteer_reminder_source', 'category' => 'volunteer_reminder', 'critical' => true, 'source_table' => 'vol_reminders_sent'],
            ['module' => 'volunteering', 'event' => 'volunteer_reminder_delivery_claim_source', 'category' => 'volunteer_reminder', 'critical' => true, 'source_table' => 'vol_reminder_delivery_claims'],
            ['module' => 'goals', 'event' => 'goal_reminder', 'category' => 'goal_reminder', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'goals', 'event' => 'goal_reminder_source', 'category' => 'goal_reminder', 'critical' => true, 'source_table' => 'goal_reminders'],
            ['module' => 'marketplace', 'event' => 'order_offer_payment_rating_report', 'category' => 'marketplace', 'critical' => true, 'source_table' => 'notification_queue'],
            ['module' => 'marketplace', 'event' => 'marketplace_report_outbox', 'category' => 'marketplace_report', 'critical' => true, 'source_table' => 'marketplace_report_notifications'],
            ['module' => 'marketplace', 'event' => 'marketplace_report_source', 'category' => 'marketplace_report', 'critical' => true, 'source_table' => 'marketplace_reports'],
            ['module' => 'safeguarding', 'event' => 'incident_flag_vetting_guardian_training', 'category' => 'safeguarding', 'critical' => true, 'source_table' => 'notifications'],
            ['module' => 'safeguarding', 'event' => 'safeguarding_review_reminder_source', 'category' => 'safeguarding_review', 'critical' => true, 'source_table' => 'user_safeguarding_preferences'],
            ['module' => 'newsletter', 'event' => 'newsletter_queue_dispatch', 'category' => 'newsletter', 'critical' => false, 'source_table' => 'newsletter_queue'],
            ['module' => 'digests', 'event' => 'notification_digest_dispatch', 'category' => 'notification_digest', 'critical' => false, 'source_table' => 'notification_queue'],
            ['module' => 'billing', 'event' => 'upgrade_or_billing_notice', 'category' => 'billing', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'billing', 'event' => 'billing_audit_notice', 'category' => 'billing', 'critical' => true, 'source_table' => 'billing_audit_log'],
            ['module' => 'billing', 'event' => 'stripe_webhook_processing', 'category' => 'billing', 'critical' => true, 'source_table' => 'stripe_webhook_events'],
            ['module' => 'billing', 'event' => 'member_premium_billing', 'category' => 'billing', 'critical' => true, 'source_table' => 'member_subscription_events'],
            ['module' => 'federation', 'event' => 'cross_tenant_connection_or_transaction', 'category' => 'federation', 'critical' => true, 'source_table' => 'notifications'],
            ['module' => 'auth', 'event' => 'email_verification_resend', 'category' => 'email_verification', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'security', 'event' => 'email_address_changed', 'category' => 'security_alert', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'security', 'event' => 'account_suspended_banned_deleted_reactivated', 'category' => 'admin_user_status', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'security', 'event' => 'account_deleted', 'category' => 'account_deleted', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'gdpr', 'event' => 'gdpr_request_confirmation', 'category' => 'gdpr_request', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'gdpr', 'event' => 'admin_gdpr_action_notification', 'category' => 'admin_gdpr_action', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'security', 'event' => 'two_factor_reset', 'category' => 'security_alert', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'legal', 'event' => 'legal_document_updated', 'category' => 'legal_document', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'insurance', 'event' => 'insurance_certificate_verified_or_rejected', 'category' => 'insurance_certificate', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'identity', 'event' => 'identity_verification_payment_result', 'category' => 'identity_payment', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'identity', 'event' => 'identity_verification_result_or_reminder', 'category' => 'identity_verification', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'tenant_provisioning', 'event' => 'tenant_provisioning_rejected', 'category' => 'tenant_provisioning', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'admin_users', 'event' => 'admin_created_approved_password_or_resend_welcome', 'category' => 'admin_welcome', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'admin_users', 'event' => 'admin_approved_user', 'category' => 'approval', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'admin_users', 'event' => 'admin_deliberate_account_action', 'category' => 'admin_action', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'admin_notifications', 'event' => 'admin_new_registration', 'category' => 'admin_new_registration', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'admin_notifications', 'event' => 'admin_new_listing', 'category' => 'admin_new_listing', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'admin_notifications', 'event' => 'admin_new_group', 'category' => 'admin_new_group', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'admin_notifications', 'event' => 'admin_new_event', 'category' => 'admin_new_event', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'admin_notifications', 'event' => 'admin_new_volunteer_opportunity', 'category' => 'admin_new_volunteer_opportunity', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'admin_notifications', 'event' => 'admin_donation_received', 'category' => 'donation_admin', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'knowledge_base', 'event' => 'kb_article_approved_or_rejected', 'category' => 'knowledge_base', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'community_projects', 'event' => 'community_project_approved_or_rejected', 'category' => 'community_project', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'volunteering', 'event' => 'volunteer_expense_approved_rejected_paid', 'category' => 'volunteer_expense', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'volunteering', 'event' => 'safeguarding_training_approved_or_rejected', 'category' => 'safeguarding', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'volunteering', 'event' => 'shift_reminder_feedback_certificate_payment', 'category' => 'volunteer_reminder', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'volunteering', 'event' => 'volunteer_certificate_ready', 'category' => 'volunteer_certificate', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'volunteering', 'event' => 'organization_wallet_alert', 'category' => 'vol_org_wallet', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'connections', 'event' => 'connection_declined', 'category' => 'connection_declined', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'wallet', 'event' => 'credit_received_sent_review_request', 'category' => 'transaction', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'wallet', 'event' => 'transaction_notification_delivery_source', 'category' => 'transaction', 'critical' => true, 'source_table' => 'transaction_notification_deliveries'],
            ['module' => 'wallet', 'event' => 'wallet_low_empty_org_wallet_alerts', 'category' => 'wallet_alert', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'wallet', 'event' => 'balance_alert', 'category' => 'balance_alert', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'donations', 'event' => 'donation_sent_received', 'category' => 'donation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'donations', 'event' => 'stripe_donation_receipt_source', 'category' => 'donation_receipt', 'critical' => true, 'source_table' => 'vol_donations'],
            ['module' => 'support', 'event' => 'contact_form', 'category' => 'contact_form', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'social', 'event' => 'post_liked_commented_shared', 'category' => 'social_notification', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'listings', 'event' => 'listing_created_updated_expiry_expired', 'category' => 'listing_expiry', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'listings', 'event' => 'listing_moderation_approved_rejected', 'category' => 'listing_moderation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'listings', 'event' => 'listing_updated', 'category' => 'listing_update', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'matching', 'event' => 'job_alert_or_hot_match', 'category' => 'job_alert', 'critical' => false, 'source_table' => 'notification_queue'],
            ['module' => 'jobs', 'event' => 'job_vacancy_expiry_or_application', 'category' => 'job_application', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'jobs', 'event' => 'job_vacancy_expiry', 'category' => 'job_expiry', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'jobs', 'event' => 'job_interview_all_stages', 'category' => 'job_interview', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'jobs', 'event' => 'job_interview_reminder_source', 'category' => 'job_interview', 'critical' => true, 'source_table' => 'job_interviews'],
            ['module' => 'exchanges', 'event' => 'exchange_dispute_opened_or_resolved', 'category' => 'exchange', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'exchanges', 'event' => 'exchange_dispute_opened_or_resolved', 'category' => 'exchange_dispute', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'exchanges', 'event' => 'exchange_rating_received', 'category' => 'exchange_rating', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'reviews', 'event' => 'review_or_rating_received', 'category' => 'review', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'goals', 'event' => 'goal_progress_milestone_completed_abandoned', 'category' => 'goal_milestone', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'goals', 'event' => 'goal_created_updated', 'category' => 'goal', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'ideation', 'event' => 'new_idea_or_comment', 'category' => 'ideation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'marketplace', 'event' => 'offer_order_refund_rating_report_dispute', 'category' => 'marketplace_order', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'marketplace', 'event' => 'marketplace_order_delivery_source', 'category' => 'marketplace_order', 'critical' => true, 'source_table' => 'marketplace_order_notification_deliveries'],
            ['module' => 'marketplace', 'event' => 'offer_created_updated', 'category' => 'marketplace_offer', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'marketplace', 'event' => 'refund_processed', 'category' => 'marketplace_refund', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'marketplace', 'event' => 'rating_received', 'category' => 'marketplace_rating', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'gamification', 'event' => 'milestone_level_badge_streak_leaderboard', 'category' => 'gamification_milestone', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'gamification', 'event' => 'gamification_weekly_digest', 'category' => 'gamification_digest', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'onboarding', 'event' => 'onboarding_nurture_sequence', 'category' => 'onboarding_nurture', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'onboarding', 'event' => 'onboarding_completed', 'category' => 'onboarding_completed', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 're_engagement', 'event' => 'inactive_member', 'category' => 'inactive_member', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'verein', 'event' => 'verein_dues_invoice_reminder_paid', 'category' => 'verein_dues', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'verein', 'event' => 'verein_dues_source', 'category' => 'verein_dues', 'critical' => true, 'source_table' => 'verein_member_dues'],
            ['module' => 'verein', 'event' => 'cross_invitation_received_accepted', 'category' => 'verein_federation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'appreciation', 'event' => 'appreciation_received', 'category' => 'appreciation', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'federation', 'event' => 'federated_transaction_received_sent', 'category' => 'federation_transaction', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'federation', 'event' => 'federated_connection_request_accepted', 'category' => 'federation_connection', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'federation', 'event' => 'federated_message_received', 'category' => 'federation_message', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'federation', 'event' => 'federation_partnership_notice', 'category' => 'federation_partnership', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'federation', 'event' => 'federated_transaction_source', 'category' => 'federation_transaction', 'critical' => true, 'source_table' => 'federation_transactions'],
            ['module' => 'federation', 'event' => 'federated_connection_source', 'category' => 'federation_connection', 'critical' => true, 'source_table' => 'federation_inbound_connections'],
            ['module' => 'federation', 'event' => 'federated_message_source', 'category' => 'federation_message', 'critical' => true, 'source_table' => 'federation_messages'],
            ['module' => 'federation', 'event' => 'federated_review_source', 'category' => 'federation_review', 'critical' => true, 'source_table' => 'reviews'],
            ['module' => 'messages', 'event' => 'direct_message_received', 'category' => 'message', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'broadcasts', 'event' => 'newsletter_broadcast', 'category' => 'newsletter', 'critical' => false, 'source_table' => 'newsletter_queue'],
            ['module' => 'broadcasts', 'event' => 'newsletter_unsubscribe_confirmation', 'category' => 'newsletter_unsubscribe', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'digests', 'event' => 'civic_digest', 'category' => 'civic_digest', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'digests', 'event' => 'civic_digest_claim_source', 'category' => 'civic_digest', 'critical' => false, 'source_table' => 'civic_digest_delivery_claims'],
            ['module' => 'digests', 'event' => 'federation_activity_digest', 'category' => 'federation_digest', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'digests', 'event' => 'group_activity_digest', 'category' => 'group_digest', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'events', 'event' => 'event_created_update_cancellation_rsvp_reminder', 'category' => 'event_notification', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'safeguarding', 'event' => 'safeguarding_alerts', 'category' => 'safeguarding', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'safeguarding', 'event' => 'guardian_consent_request', 'category' => 'guardian_consent', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'safeguarding', 'event' => 'vetting_result', 'category' => 'vetting', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'analytics', 'event' => 'regional_monthly_report', 'category' => 'regional_analytics', 'critical' => false, 'source_table' => 'email_log'],
            ['module' => 'billing', 'event' => 'stripe_subscription_billing', 'category' => 'billing', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'moderation', 'event' => 'content_hidden_removed_or_flagged', 'category' => 'moderation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'jobs', 'event' => 'job_posting_approved_or_rejected', 'category' => 'job_moderation', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'courses', 'event' => 'course_completed', 'category' => 'course_completed', 'critical' => true, 'source_table' => 'email_log'],
            ['module' => 'support', 'event' => 'support_report_created', 'category' => 'support_report', 'critical' => true, 'source_table' => 'email_log'],
        ];
    }

    /**
     * @return array{
     *   checked_at:string,
     *   window_hours:int,
     *   tenant_id:int|null,
     *   score:int,
     *   matrix_count:int,
     *   issue_count:int,
     *   issues_by_severity:array<string,int>,
     *   issues:list<array<string,mixed>>,
     *   matrix:list<array<string,mixed>>,
     *   source_tables:list<array<string,mixed>>
     * }
     */
    public function run(?int $tenantId = null, int $windowHours = 24): array
    {
        $windowHours = max(1, min($windowHours, 168));
        $since = now()->subHours($windowHours);
        $issues = [];

        try {
            $issues = array_merge(
                $issues,
                $this->checkNewUsersWithoutAccountEmail($tenantId, $since, $windowHours),
                $this->checkNewUsersWithoutAdminRegistrationAlert($tenantId, $since, $windowHours),
                $this->checkPasswordResetsWithoutEmail($tenantId, $since, $windowHours),
                $this->checkGroupInvitesWithoutEmail($tenantId, $since, $windowHours),
                $this->checkGroupMembershipNotificationHealth($tenantId, $since, $windowHours),
                $this->checkNotificationQueueHealth($tenantId, $since, $windowHours),
                $this->checkNewsletterQueueHealth($tenantId, $since, $windowHours),
                $this->checkListingExpiryReminderSourceHealth($tenantId, $since, $windowHours),
                $this->checkEventReminderSourceHealth($tenantId, $since, $windowHours),
                $this->checkEventReminderDeliveryClaimHealth($tenantId, $since, $windowHours),
                $this->checkEventOutboxDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkGoalReminderSourceHealth($tenantId, $since, $windowHours),
                $this->checkVolunteerReminderSourceHealth($tenantId, $since, $windowHours),
                $this->checkVolunteerReminderDeliveryClaimHealth($tenantId, $since, $windowHours),
                $this->checkJobInterviewReminderSourceHealth($tenantId, $since, $windowHours),
                $this->checkCivicDigestClaimSourceHealth($tenantId, $since, $windowHours),
                $this->checkNotificationStoreHealth($tenantId),
                $this->checkSafeguardingEmailEvidenceHealth($tenantId, $since, $windowHours),
                $this->checkTenantContextAndWebhookHealth($tenantId, $since, $windowHours),
                $this->checkTenantProviderConfiguration($tenantId),
                $this->checkBillingAndStripeHealth($tenantId, $since, $windowHours),
                $this->checkMemberPremiumBillingEmailHealth($tenantId, $since, $windowHours),
                $this->checkStripeDonationReceiptEmailHealth($tenantId, $since, $windowHours),
                $this->checkVereinDuesEmailHealth($tenantId, $since, $windowHours),
                $this->checkMarketplaceReportNotificationHealth($tenantId, $since, $windowHours),
                $this->checkTransactionNotificationDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkMarketplaceOrderNotificationDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkFederationMessageDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkFederationTransactionDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkFederationConnectionDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkFederationReviewDeliveryHealth($tenantId, $since, $windowHours),
                $this->checkDirectEmailSendSurface($tenantId),
                $this->checkTenantlessDispatcherSendSurface($tenantId)
            );
        } catch (\Throwable $e) {
            Log::warning('EmailTriggerAuditService::run failed', ['error' => $e->getMessage()]);
            $issues[] = $this->issue(
                'email_trigger_audit_failed',
                'warning',
                $tenantId,
                'platform',
                'audit',
                ['error' => $e->getMessage()]
            );
        }

        $issuesBySeverity = ['critical' => 0, 'warning' => 0, 'info' => 0];
        foreach ($issues as $issue) {
            $severity = (string) ($issue['severity'] ?? 'info');
            $issuesBySeverity[$severity] = ($issuesBySeverity[$severity] ?? 0) + 1;
        }

        $score = max(0, 1000
            - ($issuesBySeverity['critical'] * 90)
            - ($issuesBySeverity['warning'] * 35)
            - ($issuesBySeverity['info'] * 10));

        return [
            'checked_at' => now()->toIso8601String(),
            'window_hours' => $windowHours,
            'tenant_id' => $tenantId,
            'score' => $score,
            'matrix_count' => count($this->eventMatrix()),
            'issue_count' => count($issues),
            'issues_by_severity' => $issuesBySeverity,
            'issues' => $issues,
            'matrix' => $this->eventMatrix(),
            'source_tables' => $this->sourceTableCoverage(),
        ];
    }

    /**
     * @return list<array{
     *   source_table:string,
     *   matrix_count:int,
     *   available:bool,
     *   audited:bool,
     *   check:string|null,
     *   modules:list<string>,
     *   events:list<string>
     * }>
     */
    public function sourceTableCoverage(): array
    {
        $checks = [
            'billing_audit_log' => 'checkBillingAndStripeHealth',
            'civic_digest_delivery_claims' => 'checkCivicDigestClaimSourceHealth',
            'email_log' => 'checkTenantContextAndWebhookHealth',
            'event_notification_deliveries' => 'checkEventOutboxDeliveryHealth',
            'event_reminder_delivery_claims' => 'checkEventReminderDeliveryClaimHealth',
            'event_reminders' => 'checkEventReminderSourceHealth',
            'federation_inbound_connections' => 'checkFederationConnectionDeliveryHealth',
            'federation_messages' => 'checkFederationMessageDeliveryHealth',
            'federation_transactions' => 'checkFederationTransactionDeliveryHealth',
            'reviews' => 'checkFederationReviewDeliveryHealth',
            'goal_reminders' => 'checkGoalReminderSourceHealth',
            'group_invites' => 'checkGroupInvitesWithoutEmail',
            'group_members' => 'checkGroupMembershipNotificationHealth',
            'job_interviews' => 'checkJobInterviewReminderSourceHealth',
            'listing_expiry_reminders_sent' => 'checkListingExpiryReminderSourceHealth',
            'marketplace_report_notifications' => 'checkMarketplaceReportNotificationHealth',
            'marketplace_reports' => 'checkMarketplaceReportSourceOutboxHealth',
            'marketplace_order_notification_deliveries' => 'checkMarketplaceOrderNotificationDeliveryHealth',
            'member_subscription_events' => 'checkMemberPremiumBillingEmailHealth',
            'newsletter_queue' => 'checkNewsletterQueueHealth',
            'notification_queue' => 'checkNotificationQueueHealth',
            'notifications' => 'checkNotificationStoreHealth/checkSafeguardingEmailEvidenceHealth',
            'password_resets' => 'checkPasswordResetsWithoutEmail',
            'stripe_webhook_events' => 'checkBillingAndStripeHealth',
            'transaction_notification_deliveries' => 'checkTransactionNotificationDeliveryHealth',
            'user_safeguarding_preferences' => 'checkSafeguardingEmailEvidenceHealth',
            'users' => 'checkNewUsersWithoutAccountEmail/checkNewUsersWithoutAdminRegistrationAlert',
            'verein_member_dues' => 'checkVereinDuesEmailHealth',
            'vol_donations' => 'checkStripeDonationReceiptEmailHealth',
            'vol_reminder_delivery_claims' => 'checkVolunteerReminderDeliveryClaimHealth',
            'vol_reminders_sent' => 'checkVolunteerReminderSourceHealth',
        ];

        $coverage = [];
        foreach ($this->eventMatrix() as $row) {
            $table = (string) $row['source_table'];
            $coverage[$table] ??= [
                'source_table' => $table,
                'matrix_count' => 0,
                'available' => Schema::hasTable($table),
                'audited' => isset($checks[$table]),
                'check' => $checks[$table] ?? null,
                'modules' => [],
                'events' => [],
            ];

            $coverage[$table]['matrix_count']++;
            $coverage[$table]['modules'][] = (string) $row['module'];
            $coverage[$table]['events'][] = (string) $row['event'];
        }

        foreach ($coverage as &$row) {
            $row['modules'] = array_values(array_unique($row['modules']));
            $row['events'] = array_values(array_unique($row['events']));
        }
        unset($row);

        usort($coverage, fn (array $a, array $b): int => $a['source_table'] <=> $b['source_table']);

        return array_values($coverage);
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkNewUsersWithoutAccountEmail(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['users', 'email_log'])) {
            return [];
        }

        $q = DB::table('users')
            ->select('users.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('users.created_at', '>=', $since)
            ->whereNull('users.deleted_at')
            ->whereNotExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', 'users.id')
                    ->whereColumn('email_log.tenant_id', 'users.tenant_id')
                    ->whereColumn('email_log.created_at', '>=', 'users.created_at')
                    ->whereIn('email_log.category', [
                        'activation',
                        'admin_welcome',
                        'approval',
                        'email_verification',
                        'identity_verification',
                        'welcome',
                    ])
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
            })
            ->groupBy('users.tenant_id');
        $this->excludeReservedEmailDomains($q, 'users.email');

        if ($tenantId !== null) {
            $q->where('users.tenant_id', $tenantId);
        }

        return $this->rowsToIssues(
            $q->get(),
            'new_users_without_account_email_attempt',
            'critical',
            'registration',
            'welcome_or_activation',
            ['window_hours' => $windowHours]
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkNewUsersWithoutAdminRegistrationAlert(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['users', 'email_log'])) {
            return [];
        }

        $hasIdempotencyKey = Schema::hasColumn('email_log', 'idempotency_key');

        $q = DB::table('users')
            ->select('users.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('users.created_at', '>=', $since)
            ->whereNull('users.deleted_at')
            ->whereNotExists(function ($sub) use ($hasIdempotencyKey) {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.tenant_id', 'users.tenant_id')
                    ->whereColumn('email_log.created_at', '>=', 'users.created_at')
                    ->where('email_log.category', 'admin_new_registration')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);

                if ($hasIdempotencyKey) {
                    $sub->where(function ($evidence) {
                        $evidence
                            ->whereRaw("email_log.idempotency_key LIKE CONCAT('admin_new_registration:', users.tenant_id, ':', users.id, ':%')")
                            ->orWhere(function ($fallback) {
                                $fallback
                                    ->whereNull('email_log.idempotency_key')
                                    ->whereRaw('email_log.created_at <= DATE_ADD(users.created_at, INTERVAL 15 MINUTE)');
                            });
                    });
                } else {
                    $sub->whereRaw('email_log.created_at <= DATE_ADD(users.created_at, INTERVAL 15 MINUTE)');
                }
            })
            ->groupBy('users.tenant_id');
        $this->excludeReservedEmailDomains($q, 'users.email');

        if ($tenantId !== null) {
            $q->where('users.tenant_id', $tenantId);
        }

        return $this->rowsToIssues(
            $q->get(),
            'new_users_without_admin_registration_alert',
            'critical',
            'admin_notifications',
            'admin_new_registration',
            ['window_hours' => $windowHours]
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkPasswordResetsWithoutEmail(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['password_resets', 'email_log'])) {
            return [];
        }

        $q = DB::table('password_resets as pr')
            ->select('pr.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('pr.created_at', '>=', $since)
            ->whereNotExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereRaw('email_log.recipient_email COLLATE utf8mb4_unicode_ci = pr.email COLLATE utf8mb4_unicode_ci')
                    ->whereColumn('email_log.tenant_id', 'pr.tenant_id')
                    ->whereColumn('email_log.created_at', '>=', 'pr.created_at')
                    ->where('email_log.category', 'password_reset')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
            })
            ->groupBy('pr.tenant_id');
        $this->excludeReservedEmailDomains($q, 'pr.email');

        if ($tenantId !== null) {
            $q->where('pr.tenant_id', $tenantId);
        }

        return $this->rowsToIssues(
            $q->get(),
            'password_resets_without_email_attempt',
            'critical',
            'auth',
            'password_reset_requested',
            ['window_hours' => $windowHours]
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkGroupInvitesWithoutEmail(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['group_invites', 'email_log'])) {
            return [];
        }

        $q = DB::table('group_invites as gi')
            ->select('gi.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('gi.invite_type', 'email')
            ->where('gi.created_at', '>=', $since)
            ->whereNotNull('gi.email')
            ->whereNotExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.recipient_email', 'gi.email')
                    ->whereColumn('email_log.tenant_id', 'gi.tenant_id')
                    ->whereColumn('email_log.created_at', '>=', 'gi.created_at')
                    ->where('email_log.category', 'group_invite')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
            })
            ->groupBy('gi.tenant_id');
        $this->excludeReservedEmailDomains($q, 'gi.email');

        if ($tenantId !== null) {
            $q->where('gi.tenant_id', $tenantId);
        }

        return $this->rowsToIssues(
            $q->get(),
            'group_invites_without_email_attempt',
            'critical',
            'groups',
            'group_email_invite',
            ['window_hours' => $windowHours]
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkNotificationQueueHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['notification_queue'])) {
            return [];
        }

        $issues = [];
        $queueHasTenantId = Schema::hasColumn('notification_queue', 'tenant_id');
        $tenantExpr = $queueHasTenantId ? 'notification_queue.tenant_id' : 'users.tenant_id';

        if ($queueHasTenantId) {
            $missingTenant = DB::table('notification_queue')
                ->selectRaw('NULL as tenant_id, COUNT(*) as count')
                ->whereNull('tenant_id')
                ->whereIn('status', ['pending', 'processing'])
                ->when($tenantId !== null, fn ($q) => $q->whereRaw('1 = 0'))
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($missingTenant, 'notification_queue_missing_tenant_id', 'critical', 'notifications', 'queue_dispatch'));

            if ($this->hasTables(['users'])) {
                $tenantMismatch = DB::table('notification_queue as nq')
                    ->join('users as u', 'u.id', '=', 'nq.user_id')
                    ->selectRaw('u.tenant_id as tenant_id, COUNT(*) as count')
                    ->whereNotNull('nq.tenant_id')
                    ->whereRaw('nq.tenant_id <> u.tenant_id')
                    ->whereIn('nq.status', ['pending', 'processing'])
                    ->when($tenantId !== null, fn ($q) => $q->where('u.tenant_id', $tenantId))
                    ->groupBy('u.tenant_id')
                    ->get();
                $issues = array_merge($issues, $this->rowsToIssues($tenantMismatch, 'notification_queue_tenant_mismatch', 'critical', 'notifications', 'queue_dispatch'));
            }
        }

        $instantPending = DB::table('notification_queue')
            ->when(!$queueHasTenantId, fn ($q) => $q->join('users', 'users.id', '=', 'notification_queue.user_id'))
            ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
            ->where('notification_queue.frequency', 'instant')
            ->where('notification_queue.status', 'pending')
            ->where('notification_queue.created_at', '<', now()->subMinutes(5))
            ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
            ->groupByRaw($tenantExpr)
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($instantPending, 'instant_notifications_stuck_pending', 'critical', 'notifications', 'instant_queue_dispatch', ['minutes' => 5]));

        $processing = DB::table('notification_queue')
            ->when(!$queueHasTenantId, fn ($q) => $q->join('users', 'users.id', '=', 'notification_queue.user_id'))
            ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
            ->where('notification_queue.status', 'processing')
            ->where('notification_queue.created_at', '<', now()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
            ->groupByRaw($tenantExpr)
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($processing, 'notification_queue_stale_processing', 'critical', 'notifications', 'queue_dispatch', ['minutes' => 15]));

        $failed = DB::table('notification_queue')
            ->when(!$queueHasTenantId, fn ($q) => $q->join('users', 'users.id', '=', 'notification_queue.user_id'))
            ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
            ->where('notification_queue.status', 'failed')
            ->where('notification_queue.created_at', '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
            ->groupByRaw($tenantExpr)
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($failed, 'notification_queue_failed_recently', 'warning', 'notifications', 'queue_dispatch', ['window_hours' => $windowHours]));

        $suppressed = DB::table('notification_queue')
            ->when(!$queueHasTenantId, fn ($q) => $q->join('users', 'users.id', '=', 'notification_queue.user_id'))
            ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
            ->where('notification_queue.status', 'suppressed')
            ->where('notification_queue.created_at', '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
            ->groupByRaw($tenantExpr)
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($suppressed, 'notification_queue_suppressed_recently', 'warning', 'notifications', 'queue_dispatch', ['window_hours' => $windowHours]));

        if ($this->hasTables(['email_log', 'users'])) {
            $queuedTenantExpr = $queueHasTenantId ? 'nq.tenant_id' : 'u.tenant_id';
            $sentWithoutLog = DB::table('notification_queue as nq')
                ->join('users as u', 'u.id', '=', 'nq.user_id')
                ->selectRaw("{$queuedTenantExpr} as tenant_id, COUNT(*) as count")
                ->where('nq.status', 'sent')
                ->where('nq.sent_at', '>=', $since)
                ->whereNotExists(function ($sub) use ($queuedTenantExpr) {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereColumn('email_log.user_id', 'nq.user_id')
                        ->whereRaw("email_log.tenant_id = {$queuedTenantExpr}")
                        ->whereColumn('email_log.created_at', '>=', 'nq.created_at')
                        ->whereIn('email_log.category', $this->notificationQueueEvidenceCategories())
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
                })
                ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$queuedTenantExpr} = ?", [$tenantId]))
                ->groupByRaw($queuedTenantExpr)
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($sentWithoutLog, 'notification_queue_marked_sent_without_email_log', 'critical', 'notifications', 'queue_dispatch', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * Categories that can prove a sent notification_queue row reached the
     * central email dispatcher.
     *
     * @return list<string>
     */
    private function notificationQueueEvidenceCategories(): array
    {
        $categories = collect($this->eventMatrix())
            ->filter(fn (array $entry) => ($entry['source_table'] ?? null) === 'notification_queue')
            ->pluck('category')
            ->push('notification_queue')
            ->unique()
            ->values()
            ->all();

        sort($categories);

        return $categories;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkNewsletterQueueHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['newsletter_queue'])) {
            return [];
        }

        $issues = [];
        $queueHasTenantId = Schema::hasColumn('newsletter_queue', 'tenant_id');
        $tenantExpr = $queueHasTenantId ? 'newsletter_queue.tenant_id' : 'newsletters.tenant_id';
        $staleExpr = Schema::hasColumn('newsletter_queue', 'last_attempted_at')
            ? 'COALESCE(newsletter_queue.last_attempted_at, newsletter_queue.created_at)'
            : 'newsletter_queue.created_at';

        if ($queueHasTenantId) {
            $missingTenant = DB::table('newsletter_queue')
                ->selectRaw('NULL as tenant_id, COUNT(*) as count')
                ->whereNull('tenant_id')
                ->whereIn('status', ['pending', 'processing', 'sent'])
                ->when($tenantId !== null, fn ($q) => $q->whereRaw('1 = 0'))
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($missingTenant, 'newsletter_queue_missing_tenant_id', 'critical', 'newsletter', 'newsletter_queue_dispatch'));
        }

        if ($this->hasTables(['newsletters'])) {
            if ($queueHasTenantId) {
                $tenantMismatch = DB::table('newsletter_queue as nq')
                    ->join('newsletters as n', 'n.id', '=', 'nq.newsletter_id')
                    ->selectRaw('n.tenant_id as tenant_id, COUNT(*) as count')
                    ->whereNotNull('nq.tenant_id')
                    ->whereRaw('nq.tenant_id <> n.tenant_id')
                    ->whereIn('nq.status', ['pending', 'processing', 'sent'])
                    ->when($tenantId !== null, fn ($q) => $q->where('n.tenant_id', $tenantId))
                    ->groupBy('n.tenant_id')
                    ->get();
                $issues = array_merge($issues, $this->rowsToIssues($tenantMismatch, 'newsletter_queue_tenant_mismatch', 'critical', 'newsletter', 'newsletter_queue_dispatch'));
            }

            $tenantExpr = $queueHasTenantId ? 'COALESCE(newsletter_queue.tenant_id, newsletters.tenant_id)' : 'newsletters.tenant_id';
            $pending = DB::table('newsletter_queue')
                ->join('newsletters', 'newsletters.id', '=', 'newsletter_queue.newsletter_id')
                ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
                ->where('newsletter_queue.status', 'pending')
                ->where('newsletter_queue.created_at', '<', now()->subMinutes(15))
                ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
                ->groupByRaw($tenantExpr)
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($pending, 'newsletter_queue_stuck_pending', 'warning', 'newsletter', 'newsletter_queue_dispatch', ['minutes' => 15]));

            $processing = DB::table('newsletter_queue')
                ->join('newsletters', 'newsletters.id', '=', 'newsletter_queue.newsletter_id')
                ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
                ->where('newsletter_queue.status', 'processing')
                ->whereRaw("{$staleExpr} < ?", [now()->subMinutes(15)])
                ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
                ->groupByRaw($tenantExpr)
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($processing, 'newsletter_queue_stale_processing', 'critical', 'newsletter', 'newsletter_queue_dispatch', ['minutes' => 15]));

            $failed = DB::table('newsletter_queue')
                ->join('newsletters', 'newsletters.id', '=', 'newsletter_queue.newsletter_id')
                ->selectRaw("{$tenantExpr} as tenant_id, COUNT(*) as count")
                ->where('newsletter_queue.status', 'failed')
                ->where('newsletter_queue.created_at', '>=', $since)
                ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$tenantExpr} = ?", [$tenantId]))
                ->groupByRaw($tenantExpr)
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($failed, 'newsletter_queue_failed_recently', 'warning', 'newsletter', 'newsletter_queue_dispatch', ['window_hours' => $windowHours]));
        }

        if ($this->hasTables(['email_log']) && ($queueHasTenantId || $this->hasTables(['newsletters']))) {
            $queuedTenantExpr = $queueHasTenantId ? 'nq.tenant_id' : 'n.tenant_id';
            $sentWithoutLog = DB::table('newsletter_queue as nq')
                ->when($this->hasTables(['newsletters']), fn ($q) => $q->join('newsletters as n', 'n.id', '=', 'nq.newsletter_id'))
                ->selectRaw("{$queuedTenantExpr} as tenant_id, COUNT(*) as count")
                ->where('nq.status', 'sent')
                ->where('nq.sent_at', '>=', $since)
                ->whereNotExists(function ($sub) use ($queuedTenantExpr) {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereRaw('email_log.recipient_email COLLATE utf8mb4_unicode_ci = nq.email COLLATE utf8mb4_unicode_ci')
                        ->whereRaw("email_log.tenant_id = {$queuedTenantExpr}")
                        ->whereColumn('email_log.created_at', '>=', 'nq.created_at')
                        ->where('email_log.category', 'newsletter')
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
                })
                ->when($tenantId !== null, fn ($q) => $q->whereRaw("{$queuedTenantExpr} = ?", [$tenantId]))
                ->groupByRaw($queuedTenantExpr)
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($sentWithoutLog, 'newsletter_queue_marked_sent_without_email_log', 'critical', 'newsletter', 'newsletter_queue_dispatch', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkNotificationStoreHealth(?int $tenantId): array
    {
        if (!$this->hasTables(['notifications', 'users']) || !Schema::hasColumn('notifications', 'tenant_id')) {
            return [];
        }

        $missingTenant = DB::table('notifications as n')
            ->join('users as u', 'u.id', '=', 'n.user_id')
            ->selectRaw('u.tenant_id as tenant_id, COUNT(*) as count')
            ->whereNull('n.tenant_id')
            ->when($tenantId !== null, fn ($q) => $q->where('u.tenant_id', $tenantId))
            ->groupBy('u.tenant_id')
            ->get();

        $tenantMismatch = DB::table('notifications as n')
            ->join('users as u', 'u.id', '=', 'n.user_id')
            ->selectRaw('u.tenant_id as tenant_id, COUNT(*) as count')
            ->whereNotNull('n.tenant_id')
            ->whereRaw('n.tenant_id <> u.tenant_id')
            ->when($tenantId !== null, fn ($q) => $q->where('u.tenant_id', $tenantId))
            ->groupBy('u.tenant_id')
            ->get();

        return array_merge(
            $this->rowsToIssues($missingTenant, 'notifications_missing_tenant_id', 'critical', 'notifications', 'bell_dispatch'),
            $this->rowsToIssues($tenantMismatch, 'notifications_tenant_mismatch', 'critical', 'notifications', 'bell_dispatch')
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkSafeguardingEmailEvidenceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['email_log', 'users'])) {
            return [];
        }

        $issues = [];

        if (
            $this->hasTables(['user_safeguarding_preferences'])
            && Schema::hasColumn('user_safeguarding_preferences', 'review_reminder_sent_at')
        ) {
            $reviewReminders = DB::table('user_safeguarding_preferences as usp')
                ->join('users as u', function ($join): void {
                    $join->on('u.id', '=', 'usp.user_id')
                        ->whereColumn('u.tenant_id', '=', 'usp.tenant_id');
                })
                ->select('usp.tenant_id', DB::raw('COUNT(*) as count'))
                ->where('usp.review_reminder_sent_at', '>=', $since)
                ->whereNotNull('u.email')
                ->where('u.email', '<>', '')
                ->whereNotExists(function ($sub): void {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereColumn('email_log.tenant_id', 'usp.tenant_id')
                        ->where('email_log.category', 'safeguarding_review')
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                        ->whereRaw('(email_log.user_id = usp.user_id OR email_log.recipient_email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci)')
                        ->whereRaw('email_log.created_at BETWEEN DATE_SUB(usp.review_reminder_sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(usp.review_reminder_sent_at, INTERVAL 10 MINUTE)');
                })
                ->when($tenantId !== null, fn ($q) => $q->where('usp.tenant_id', $tenantId))
                ->groupBy('usp.tenant_id')
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($reviewReminders, 'safeguarding_review_reminder_marked_sent_without_email_log', 'critical', 'safeguarding', 'safeguarding_review_reminder_source', ['window_hours' => $windowHours]));
        }

        if ($this->hasTables(['notifications']) && Schema::hasColumn('notifications', 'tenant_id')) {
            $emailBackedNotificationTypes = ['safeguarding_flag', 'safeguarding_assignment'];
            $notificationsWithoutEmail = DB::table('notifications as n')
                ->join('users as u', function ($join): void {
                    $join->on('u.id', '=', 'n.user_id')
                        ->whereColumn('u.tenant_id', '=', 'n.tenant_id');
                })
                ->select('n.tenant_id', DB::raw('COUNT(*) as count'))
                ->whereIn('n.type', $emailBackedNotificationTypes)
                ->where('n.created_at', '>=', $since)
                ->whereNotNull('u.email')
                ->where('u.email', '<>', '')
                ->whereNotExists(function ($sub): void {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereColumn('email_log.tenant_id', 'n.tenant_id')
                        ->where('email_log.category', 'safeguarding')
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                        ->whereRaw('(email_log.user_id = n.user_id OR email_log.recipient_email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci)')
                        ->whereRaw('email_log.created_at BETWEEN n.created_at AND DATE_ADD(n.created_at, INTERVAL 10 MINUTE)');
                })
                ->when($tenantId !== null, fn ($q) => $q->where('n.tenant_id', $tenantId))
                ->groupBy('n.tenant_id')
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($notificationsWithoutEmail, 'safeguarding_notification_without_email_log', 'critical', 'safeguarding', 'incident_flag_vetting_guardian_training', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkDirectEmailSendSurface(?int $tenantId): array
    {
        $surface = $this->directEmailSendSurface();
        if ($surface === []) {
            return [];
        }

        return [
            $this->issue(
                'direct_email_send_paths_remaining',
                'warning',
                $tenantId,
                'architecture',
                'direct_send_surface',
                [
                    'count' => count($surface),
                    'samples' => array_slice(array_map(
                        fn (array $row): string => $row['path'] . ':' . $row['line'],
                        $surface
                    ), 0, 8),
                ]
            ),
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkTenantlessDispatcherSendSurface(?int $tenantId): array
    {
        $surface = $this->tenantlessDispatcherSendSurface();
        if ($surface === []) {
            return [];
        }

        return [
            $this->issue(
                'email_dispatch_missing_explicit_tenant',
                'critical',
                $tenantId,
                'architecture',
                'dispatcher_tenant_contract',
                [
                    'count' => count($surface),
                    'samples' => array_slice(array_map(
                        fn (array $row): string => $row['path'] . ':' . $row['line'],
                        $surface
                    ), 0, 8),
                ]
            ),
        ];
    }

    /**
     * Find legacy raw email send call sites that still bypass the central
     * business-event dispatcher. This is intentionally advisory today; once
     * the migration is complete it can become a CI-blocking assertion.
     *
     * @return list<array{path:string,line:int,pattern:string}>
     */
    public function directEmailSendSurface(): array
    {
        $appPath = app_path();
        if (!is_dir($appPath)) {
            return [];
        }

        $allowed = array_filter(array_map('realpath', [
            app_path('Core/Mailer.php'),
            app_path('Services/EmailDispatchService.php'),
            app_path('Services/EmailService.php'),
            app_path('Services/EmailTriggerAuditService.php'),
            // SalesOrderController sends its single billing enquiry via the injected
            // EmailService, which delegates to the audited EmailDispatchService::send()
            // (category 'billing', idempotency key) — an audited path, allow-listed here.
            app_path('Http/Controllers/Api/SalesOrderController.php'),
        ]));

        $patterns = [
            'mailer_factory_send' => '/(?:\\\\?App\\\\Core\\\\)?Mailer::forCurrentTenant\s*\(\s*\)\s*\)?\s*->\s*send\s*\(/',
            'mailer_new_send' => '/new\s+(?:\\\\?App\\\\Core\\\\)?Mailer\s*\([^;]*\)\s*\)?\s*->\s*send\s*\(/',
            'mailer_variable_send' => '/(?:\$mailer|\$[A-Za-z_][A-Za-z0-9_]*mailer[A-Za-z0-9_]*)\s*->\s*send\s*\(/i',
            'email_service_app_send' => '/app\s*\(\s*EmailService::class\s*\)\s*->\s*send\s*\(/',
            'email_service_variable_send' => '/(?:\$email|\$emailService|\$[A-Za-z_][A-Za-z0-9_]*(?:emailservice|email)[A-Za-z0-9_]*)\s*->\s*send\s*\(/i',
        ];

        $surface = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($appPath));
        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $path = $file->getPathname();
            $realPath = realpath($path);
            if ($realPath !== false && in_array($realPath, $allowed, true)) {
                continue;
            }

            $relativePath = str_replace($appPath . DIRECTORY_SEPARATOR, '', $path);
            $lines = file($path, FILE_IGNORE_NEW_LINES);
            if ($lines === false) {
                continue;
            }

            $inBlockComment = false;
            foreach ($lines as $index => $line) {
                $codeLine = $this->stripPhpCommentsFromLine((string) $line, $inBlockComment);
                if (trim($codeLine) === '') {
                    continue;
                }

                foreach ($patterns as $name => $pattern) {
                    if (preg_match($pattern, $codeLine) === 1) {
                        $surface[] = [
                            'path' => $relativePath,
                            'line' => $index + 1,
                            'pattern' => $name,
                        ];
                        break;
                    }
                }
            }
        }

        usort($surface, fn (array $a, array $b): int => [$a['path'], $a['line']] <=> [$b['path'], $b['line']]);

        return $surface;
    }

    /**
     * Find EmailDispatchService send calls that still rely on implicit tenant
     * inference. Tenant inference remains as a defensive fallback, but audited
     * production send roots must pass tenant_id/tenantId explicitly.
     *
     * @return list<array{path:string,line:int,pattern:string}>
     */
    public function tenantlessDispatcherSendSurface(): array
    {
        $appPath = app_path();
        if (!is_dir($appPath)) {
            return [];
        }

        $allowed = array_filter(array_map('realpath', [
            app_path('Services/EmailDispatchService.php'),
            app_path('Services/EmailTriggerAuditService.php'),
        ]));

        $surface = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($appPath));
        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $path = $file->getPathname();
            $realPath = realpath($path);
            if ($realPath !== false && in_array($realPath, $allowed, true)) {
                continue;
            }

            $relativePath = str_replace($appPath . DIRECTORY_SEPARATOR, '', $path);
            $lines = file($path, FILE_IGNORE_NEW_LINES);
            if ($lines === false) {
                continue;
            }

            $inBlockComment = false;
            $count = count($lines);
            for ($index = 0; $index < $count; $index++) {
                $codeLine = $this->stripPhpCommentsFromLine((string) $lines[$index], $inBlockComment);
                if (!str_contains($codeLine, 'EmailDispatchService::sendRaw(')
                    && !str_contains($codeLine, 'EmailDispatchService::sendWithOptions(')
                    && !str_contains($codeLine, '\\App\\Services\\EmailDispatchService::sendRaw(')
                    && !str_contains($codeLine, '\\App\\Services\\EmailDispatchService::sendWithOptions(')
                ) {
                    continue;
                }

                $call = $codeLine;
                $parenBalance = substr_count($codeLine, '(') - substr_count($codeLine, ')');
                $end = $index;
                while ($parenBalance > 0 && $end + 1 < $count) {
                    $end++;
                    $nextLine = $this->stripPhpCommentsFromLine((string) $lines[$end], $inBlockComment);
                    $call .= "\n" . $nextLine;
                    $parenBalance += substr_count($nextLine, '(') - substr_count($nextLine, ')');
                }

                if (!preg_match('/[\'"]tenant_id[\'"]|[\'"]tenantId[\'"]/', $call)) {
                    $surface[] = [
                        'path' => $relativePath,
                        'line' => $index + 1,
                        'pattern' => str_contains($call, 'sendWithOptions') ? 'send_with_options_missing_tenant' : 'send_raw_missing_tenant',
                    ];
                }

                $index = max($index, $end);
            }
        }

        usort($surface, fn (array $a, array $b): int => [$a['path'], $a['line']] <=> [$b['path'], $b['line']]);

        return $surface;
    }

    private function stripPhpCommentsFromLine(string $line, bool &$inBlockComment): string
    {
        $remaining = $line;

        while ($remaining !== '') {
            if ($inBlockComment) {
                $end = strpos($remaining, '*/');
                if ($end === false) {
                    return '';
                }
                $remaining = substr($remaining, $end + 2);
                $inBlockComment = false;
                continue;
            }

            $start = strpos($remaining, '/*');
            $single = strpos($remaining, '//');

            if ($single !== false && ($start === false || $single < $start)) {
                return substr($remaining, 0, $single);
            }

            if ($start === false) {
                return $remaining;
            }

            $end = strpos($remaining, '*/', $start + 2);
            if ($end === false) {
                $inBlockComment = true;
                return substr($remaining, 0, $start);
            }

            $remaining = substr($remaining, 0, $start) . substr($remaining, $end + 2);
        }

        return '';
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkTenantContextAndWebhookHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['email_log'])) {
            return [];
        }

        $issues = [];
        $criticalCategories = [
            'activation',
            'admin_welcome',
            'approval',
            'email_verification',
            'group_invite',
            'identity_verification',
            'password_reset',
            'security_alert',
            'welcome',
        ];

        if ($tenantId === null) {
            $nullTenantCritical = DB::table('email_log')
                ->whereNull('tenant_id')
                ->where('created_at', '>=', $since)
                ->whereIn('category', $criticalCategories)
                ->count();
            if ($nullTenantCritical > 0) {
                $issues[] = $this->issue('critical_email_attempts_missing_tenant_context', 'critical', null, 'platform', 'tenant_context', [
                    'count' => $nullTenantCritical,
                    'window_hours' => $windowHours,
                ]);
            }
        }

        $unconfirmed = DB::table('email_log')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('provider', 'postmark')
            ->where('status', 'sent')
            ->whereNotNull('provider_message_id')
            ->where('created_at', '<', now()->subHours(6))
            ->where('created_at', '>=', now()->subDays(7))
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($unconfirmed, 'postmark_events_not_confirming_delivery', 'warning', 'deliverability', 'provider_webhook', ['hours' => 6]));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkTenantProviderConfiguration(?int $tenantId): array
    {
        if (!$this->hasTables(['tenants', 'email_settings'])) {
            return [];
        }

        $tenantIds = DB::table('tenants')
            ->where('is_active', 1)
            ->when($tenantId !== null, fn ($q) => $q->where('id', $tenantId))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $issues = [];
        foreach ($tenantIds as $id) {
            try {
                $provider = EmailSettings::get($id, 'email_provider') ?: 'platform_default';
                if ($provider === 'gmail_api') {
                    $missing = [];
                    foreach (['gmail_client_id', 'gmail_client_secret', 'gmail_refresh_token'] as $key) {
                        if (!EmailSettings::get($id, $key)) {
                            $missing[] = $key;
                        }
                    }
                    if ($missing !== []) {
                        $issues[] = $this->issue('tenant_gmail_override_incomplete', 'warning', $id, 'deliverability', 'provider_config', ['missing' => implode(',', $missing)]);
                    }
                }
                if ($provider === 'smtp') {
                    $host = EmailSettings::get($id, 'smtp_host');
                    $from = EmailSettings::get($id, 'smtp_from_email');
                    if (!$host || !$from) {
                        $issues[] = $this->issue('tenant_smtp_override_incomplete', 'warning', $id, 'deliverability', 'provider_config', ['provider' => 'smtp']);
                    }
                }
            } catch (\Throwable $e) {
                $issues[] = $this->issue('tenant_provider_config_check_failed', 'warning', $id, 'deliverability', 'provider_config', ['error' => $e->getMessage()]);
            }
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkEventReminderSourceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['event_reminders'])) {
            return [];
        }

        $issues = [];

        $overduePending = DB::table('event_reminders')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'pending')
            ->where('scheduled_for', '<', now()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($overduePending, 'event_reminders_overdue_pending', 'critical', 'events', 'event_created_update_cancellation_rsvp_reminder', ['minutes' => 15]));

        $failed = DB::table('event_reminders')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'failed')
            ->where('updated_at', '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($failed, 'event_reminders_failed_recently', 'warning', 'events', 'event_created_update_cancellation_rsvp_reminder', ['window_hours' => $windowHours]));

        if ($this->hasTables(['email_log'])) {
            $sentWithoutEmail = DB::table('event_reminders as er')
                ->select('er.tenant_id', DB::raw('COUNT(*) as count'))
                ->where('er.status', 'sent')
                ->whereIn('er.reminder_type', ['email', 'both'])
                ->where('er.sent_at', '>=', $since)
                ->when(
                    Schema::hasTable('event_notification_deliveries') && Schema::hasTable('event_domain_outbox'),
                    fn ($query) => $query->whereNotExists(function ($sub): void {
                        $sub->select(DB::raw(1))
                            ->from('event_notification_deliveries as event_delivery')
                            ->join('event_domain_outbox as edo', 'edo.id', '=', 'event_delivery.outbox_id')
                            ->whereColumn('event_delivery.tenant_id', 'er.tenant_id')
                            ->whereColumn('event_delivery.recipient_user_id', 'er.user_id')
                            ->whereColumn('edo.event_id', 'er.event_id')
                            ->where('event_delivery.channel', 'email')
                            ->where('event_delivery.status', 'suppressed')
                            ->whereColumn('event_delivery.created_at', '>=', 'er.created_at');
                    }),
                )
                ->whereNotExists(function ($sub) {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereColumn('email_log.user_id', 'er.user_id')
                        ->whereColumn('email_log.tenant_id', 'er.tenant_id')
                        ->whereColumn('email_log.created_at', '>=', 'er.created_at')
                        ->where('email_log.category', 'event_reminder')
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
                })
                ->when($tenantId !== null, fn ($q) => $q->where('er.tenant_id', $tenantId))
                ->groupBy('er.tenant_id')
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($sentWithoutEmail, 'event_reminders_marked_sent_without_email_log', 'critical', 'events', 'event_created_update_cancellation_rsvp_reminder', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkListingExpiryReminderSourceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['listing_expiry_reminders_sent', 'email_log'])
            || !Schema::hasColumn('listing_expiry_reminders_sent', 'sent_at')
        ) {
            return [];
        }

        $sentWithoutEmail = DB::table('listing_expiry_reminders_sent as lers')
            ->select('lers.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('lers.sent_at', '>=', $since)
            ->whereNotExists(function ($sub): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', 'lers.user_id')
                    ->whereColumn('email_log.tenant_id', 'lers.tenant_id')
                    ->where('email_log.category', 'listing_expiry')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw('email_log.created_at BETWEEN DATE_SUB(lers.sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(lers.sent_at, INTERVAL 10 MINUTE)');
            })
            ->when($tenantId !== null, fn ($q) => $q->where('lers.tenant_id', $tenantId))
            ->groupBy('lers.tenant_id')
            ->get();

        return $this->rowsToIssues($sentWithoutEmail, 'listing_expiry_reminder_marked_sent_without_email_log', 'critical', 'listings', 'listing_expiry_reminder_source', ['window_hours' => $windowHours]);
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkGoalReminderSourceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['goal_reminders', 'goals', 'users'])
            || !Schema::hasColumn('goal_reminders', 'next_reminder_at')
            || !Schema::hasColumn('goal_reminders', 'last_sent_at')
        ) {
            return [];
        }

        $issues = [];

        $overdue = DB::table('goal_reminders as gr')
            ->join('goals as g', function ($join): void {
                $join->on('gr.goal_id', '=', 'g.id')
                    ->whereColumn('g.tenant_id', '=', 'gr.tenant_id');
            })
            ->select('gr.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('gr.enabled', 1)
            ->whereNotNull('gr.next_reminder_at')
            ->where('gr.next_reminder_at', '>=', $since)
            ->where('gr.next_reminder_at', '<=', now()->subMinutes(15))
            ->where('g.status', 'active')
            ->when($tenantId !== null, fn ($q) => $q->where('gr.tenant_id', $tenantId))
            ->groupBy('gr.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($overdue, 'goal_reminders_overdue_pending', 'critical', 'goals', 'goal_reminder_source', ['window_hours' => $windowHours, 'minutes' => 15]));

        if (!$this->hasTables(['email_log'])) {
            return $issues;
        }

        $sentWithoutEmail = DB::table('goal_reminders as gr')
            ->join('users as u', function ($join): void {
                $join->on('gr.user_id', '=', 'u.id')
                    ->whereColumn('u.tenant_id', '=', 'gr.tenant_id');
            })
            ->select('gr.tenant_id', DB::raw('COUNT(*) as count'))
            ->whereNotNull('gr.last_sent_at')
            ->where('gr.last_sent_at', '>=', $since)
            ->whereNotNull('u.email')
            ->where('u.email', '<>', '')
            ->whereNotExists(function ($sub): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', 'gr.user_id')
                    ->whereColumn('email_log.tenant_id', 'gr.tenant_id')
                    ->where('email_log.category', 'goal_reminder')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw('email_log.created_at BETWEEN DATE_SUB(gr.last_sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(gr.last_sent_at, INTERVAL 10 MINUTE)');
            })
            ->when($tenantId !== null, fn ($q) => $q->where('gr.tenant_id', $tenantId))
            ->groupBy('gr.tenant_id');
        $this->excludeReservedEmailDomains($sentWithoutEmail, 'u.email');

        $issues = array_merge($issues, $this->rowsToIssues($sentWithoutEmail->get(), 'goal_reminders_marked_sent_without_email_log', 'critical', 'goals', 'goal_reminder_source', ['window_hours' => $windowHours]));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkVolunteerReminderSourceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['vol_reminders_sent', 'email_log'])
            || !Schema::hasColumn('vol_reminders_sent', 'sent_at')
        ) {
            return [];
        }

        $sentWithoutEmail = DB::table('vol_reminders_sent as vrs')
            ->select('vrs.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('vrs.channel', 'email')
            ->where('vrs.sent_at', '>=', $since)
            ->whereNotExists(function ($sub): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', 'vrs.user_id')
                    ->whereColumn('email_log.tenant_id', 'vrs.tenant_id')
                    ->where('email_log.category', 'volunteer_reminder')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw('email_log.created_at BETWEEN DATE_SUB(vrs.sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(vrs.sent_at, INTERVAL 10 MINUTE)');
            })
            ->when($tenantId !== null, fn ($q) => $q->where('vrs.tenant_id', $tenantId))
            ->groupBy('vrs.tenant_id')
            ->get();

        return $this->rowsToIssues($sentWithoutEmail, 'volunteer_reminder_marked_sent_without_email_log', 'critical', 'volunteering', 'volunteer_reminder_source', ['window_hours' => $windowHours]);
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkJobInterviewReminderSourceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['job_interviews'])
            || !Schema::hasColumn('job_interviews', 'reminder_24h_sent_at')
            || !Schema::hasColumn('job_interviews', 'reminder_1h_sent_at')
        ) {
            return [];
        }

        $issues = [];

        $stale24h = DB::table('job_interviews as ji')
            ->select('ji.tenant_id', DB::raw('COUNT(*) as count'))
            ->whereIn('ji.status', ['proposed', 'accepted'])
            ->whereNull('ji.reminder_24h_sent_at')
            ->where('ji.scheduled_at', '>', now()->addHour())
            ->where('ji.scheduled_at', '<=', now()->addHours(24)->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where('ji.tenant_id', $tenantId))
            ->groupBy('ji.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($stale24h, 'job_interview_24h_reminder_overdue_pending', 'critical', 'jobs', 'job_interview_reminder_source', ['window_hours' => $windowHours]));

        $stale1h = DB::table('job_interviews as ji')
            ->select('ji.tenant_id', DB::raw('COUNT(*) as count'))
            ->whereIn('ji.status', ['proposed', 'accepted'])
            ->whereNull('ji.reminder_1h_sent_at')
            ->where('ji.scheduled_at', '>', now())
            ->where('ji.scheduled_at', '<=', now()->addHour()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where('ji.tenant_id', $tenantId))
            ->groupBy('ji.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($stale1h, 'job_interview_1h_reminder_overdue_pending', 'critical', 'jobs', 'job_interview_reminder_source', ['window_hours' => $windowHours]));

        if (!$this->hasTables(['email_log'])) {
            return $issues;
        }

        $sentWithoutEmail = DB::table('job_interviews as ji')
            ->select('ji.tenant_id', DB::raw('COUNT(*) as count'))
            ->where(function ($query) use ($since): void {
                $query->where('ji.reminder_24h_sent_at', '>=', $since)
                    ->orWhere('ji.reminder_1h_sent_at', '>=', $since);
            })
            ->whereNotExists(function ($sub): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.tenant_id', 'ji.tenant_id')
                    ->where('email_log.category', 'job_interview')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw(
                        '(email_log.created_at BETWEEN DATE_SUB(ji.reminder_24h_sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(ji.reminder_24h_sent_at, INTERVAL 10 MINUTE)
                          OR email_log.created_at BETWEEN DATE_SUB(ji.reminder_1h_sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(ji.reminder_1h_sent_at, INTERVAL 10 MINUTE))'
                    );
            })
            ->when($tenantId !== null, fn ($q) => $q->where('ji.tenant_id', $tenantId))
            ->groupBy('ji.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($sentWithoutEmail, 'job_interview_reminder_marked_sent_without_email_log', 'critical', 'jobs', 'job_interview_reminder_source', ['window_hours' => $windowHours]));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkCivicDigestClaimSourceHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['civic_digest_delivery_claims'])
            || !Schema::hasColumn('civic_digest_delivery_claims', 'sent_at')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'claimed_at')
        ) {
            return [];
        }

        $issues = [];

        $staleClaimed = DB::table('civic_digest_delivery_claims as cddc')
            ->select('cddc.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('cddc.status', 'claimed')
            ->whereNull('cddc.sent_at')
            ->where('cddc.claimed_at', '<', now()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where('cddc.tenant_id', $tenantId))
            ->groupBy('cddc.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($staleClaimed, 'civic_digest_claim_stale_pending', 'warning', 'digests', 'civic_digest_claim_source', ['minutes' => 15]));

        $sentStatusMissingTimestamp = DB::table('civic_digest_delivery_claims as cddc')
            ->select('cddc.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('cddc.status', 'sent')
            ->whereNull('cddc.sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('cddc.tenant_id', $tenantId))
            ->groupBy('cddc.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($sentStatusMissingTimestamp, 'civic_digest_claim_sent_status_missing_sent_at', 'critical', 'digests', 'civic_digest_claim_source'));

        if (!$this->hasTables(['email_log'])) {
            return $issues;
        }

        $sentWithoutEmail = DB::table('civic_digest_delivery_claims as cddc')
            ->select('cddc.tenant_id', DB::raw('COUNT(*) as count'))
            ->where('cddc.status', 'sent')
            ->where('cddc.sent_at', '>=', $since)
            ->whereNotExists(function ($sub): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', 'cddc.user_id')
                    ->whereColumn('email_log.tenant_id', 'cddc.tenant_id')
                    ->where('email_log.category', 'civic_digest')
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw('email_log.created_at BETWEEN DATE_SUB(cddc.sent_at, INTERVAL 10 MINUTE) AND DATE_ADD(cddc.sent_at, INTERVAL 10 MINUTE)');
            })
            ->when($tenantId !== null, fn ($q) => $q->where('cddc.tenant_id', $tenantId))
            ->groupBy('cddc.tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($sentWithoutEmail, 'civic_digest_claim_marked_sent_without_email_log', 'warning', 'digests', 'civic_digest_claim_source', ['window_hours' => $windowHours]));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkBillingAndStripeHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        $issues = [];

        if ($this->hasTables(['stripe_webhook_events']) && Schema::hasColumn('stripe_webhook_events', 'status')) {
            $failed = DB::table('stripe_webhook_events')
                ->selectRaw('NULL as tenant_id, COUNT(*) as count')
                ->where('status', 'failed')
                ->where('processed_at', '>=', $since)
                ->when($tenantId !== null, fn ($q) => $q->whereRaw('1 = 0'))
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($failed, 'stripe_webhook_events_failed_recently', 'critical', 'billing', 'stripe_webhook_processing', ['window_hours' => $windowHours]));

            $stale = DB::table('stripe_webhook_events')
                ->selectRaw('NULL as tenant_id, COUNT(*) as count')
                ->where('status', 'processing')
                ->where('processed_at', '<', now()->subMinutes(10))
                ->when($tenantId !== null, fn ($q) => $q->whereRaw('1 = 0'))
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($stale, 'stripe_webhook_events_stale_processing', 'critical', 'billing', 'stripe_webhook_processing', ['minutes' => 10]));
        }

        if ($this->hasTables(['billing_audit_log', 'email_log'])) {
            $billingActions = ['plan_assigned', 'upgrade_requested'];

            $withoutEmailLog = DB::table('billing_audit_log as bal')
                ->select('bal.tenant_id', DB::raw('COUNT(*) as count'))
                ->whereIn('bal.action', $billingActions)
                ->where('bal.created_at', '>=', $since)
                ->whereNotExists(function ($sub) {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereColumn('email_log.tenant_id', 'bal.tenant_id')
                        ->whereColumn('email_log.created_at', '>=', 'bal.created_at')
                        ->where('email_log.category', 'billing')
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
                })
                ->when($tenantId !== null, fn ($q) => $q->where('bal.tenant_id', $tenantId))
                ->groupBy('bal.tenant_id')
                ->get();

            $issues = array_merge($issues, $this->rowsToIssues($withoutEmailLog, 'billing_audit_event_without_email_log', 'critical', 'billing', 'billing_notice', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkMarketplaceReportNotificationHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['marketplace_report_notifications'])) {
            return [];
        }

        $issues = [];

        if ($this->hasTables(['marketplace_reports'])) {
            $issues = array_merge($issues, $this->checkMarketplaceReportSourceOutboxHealth($tenantId, $since, $windowHours));
        }

        $pending = DB::table('marketplace_report_notifications')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'pending')
            ->where('created_at', '<', now()->subMinutes(10))
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($pending, 'marketplace_report_notifications_stuck_pending', 'warning', 'marketplace', 'marketplace_report_notice', ['minutes' => 10]));

        $processing = DB::table('marketplace_report_notifications')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'processing')
            ->where('last_attempted_at', '<', now()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($processing, 'marketplace_report_notifications_stale_processing', 'critical', 'marketplace', 'marketplace_report_notice', ['minutes' => 15]));

        $failed = DB::table('marketplace_report_notifications')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'failed')
            ->where('updated_at', '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($failed, 'marketplace_report_notifications_failed_recently', 'warning', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));

        if ($this->hasTables(['email_log'])) {
            $sentEmailWithoutLog = DB::table('marketplace_report_notifications as mrn')
                ->select('mrn.tenant_id', DB::raw('COUNT(*) as count'))
                ->where('mrn.channel', 'email')
                ->where('mrn.status', 'sent')
                ->where('mrn.sent_at', '>=', $since)
                ->whereNotExists(function ($sub): void {
                    $sub->select(DB::raw(1))
                        ->from('email_log')
                        ->whereColumn('email_log.tenant_id', 'mrn.tenant_id')
                        ->whereColumn('email_log.user_id', 'mrn.recipient_user_id')
                        ->whereColumn('email_log.created_at', '>=', 'mrn.created_at')
                        ->where('email_log.category', 'marketplace_report')
                        ->whereIn('email_log.status', ['sent', 'delivered', 'bounced']);
                })
                ->when($tenantId !== null, fn ($q) => $q->where('mrn.tenant_id', $tenantId))
                ->groupBy('mrn.tenant_id')
                ->get();

            $issues = array_merge($issues, $this->rowsToIssues($sentEmailWithoutLog, 'marketplace_report_notification_sent_without_email_log', 'critical', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkMarketplaceReportSourceOutboxHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        $issues = [];

        $received = $this->marketplaceReportsMissingEmailOutbox('created_at', ['received'], $since, $tenantId)
            ->where('mr.status', 'received')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($received, 'marketplace_report_received_without_notification_outbox', 'critical', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));

        $acknowledged = $this->marketplaceReportsMissingEmailOutbox('acknowledged_at', ['acknowledged', 'auto_acknowledged'], $since, $tenantId)
            ->whereNotNull('mr.acknowledged_at')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($acknowledged, 'marketplace_report_acknowledged_without_notification_outbox', 'critical', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));

        $resolved = $this->marketplaceReportsMissingEmailOutbox('resolved_at', ['resolved'], $since, $tenantId)
            ->whereNotNull('mr.resolved_at')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($resolved, 'marketplace_report_resolved_without_notification_outbox', 'critical', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));

        $appealed = $this->marketplaceReportsMissingEmailOutbox('updated_at', ['appeal_received'], $since, $tenantId)
            ->where('mr.status', 'appealed')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($appealed, 'marketplace_report_appealed_without_notification_outbox', 'critical', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));

        $appealResolved = $this->marketplaceReportsMissingEmailOutbox('appeal_resolved_at', ['appeal_resolved'], $since, $tenantId)
            ->whereNotNull('mr.appeal_resolved_at')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($appealResolved, 'marketplace_report_appeal_resolved_without_notification_outbox', 'critical', 'marketplace', 'marketplace_report_notice', ['window_hours' => $windowHours]));

        return $issues;
    }

    /**
     * @param list<string> $eventTypes
     * @return \Illuminate\Database\Query\Builder
     */
    private function marketplaceReportsMissingEmailOutbox(string $timestampColumn, array $eventTypes, \DateTimeInterface $since, ?int $tenantId)
    {
        return DB::table('marketplace_reports as mr')
            ->select('mr.tenant_id', DB::raw('COUNT(*) as count'))
            ->where("mr.{$timestampColumn}", '>=', $since)
            ->whereNotExists(function ($sub) use ($eventTypes): void {
                $sub->select(DB::raw(1))
                    ->from('marketplace_report_notifications as mrn')
                    ->whereColumn('mrn.tenant_id', 'mr.tenant_id')
                    ->whereColumn('mrn.marketplace_report_id', 'mr.id')
                    ->where('mrn.channel', 'email')
                    ->whereIn('mrn.event_type', $eventTypes);
            })
            ->when($tenantId !== null, fn ($q) => $q->where('mr.tenant_id', $tenantId))
            ->groupBy('mr.tenant_id');
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkTransactionNotificationDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        return $this->checkEmailDeliveryLedgerHealth(
            'transaction_notification_deliveries',
            'tnd',
            'transaction',
            'wallet',
            'transaction_notification_delivery_source',
            'transaction_notification_delivery',
            $tenantId,
            $since,
            $windowHours
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkMarketplaceOrderNotificationDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        return $this->checkEmailDeliveryLedgerHealth(
            'marketplace_order_notification_deliveries',
            'mond',
            'marketplace_order',
            'marketplace',
            'marketplace_order_delivery_source',
            'marketplace_order_notification_delivery',
            $tenantId,
            $since,
            $windowHours
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkEventReminderDeliveryClaimHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        return $this->checkReminderDeliveryClaimHealth(
            'event_reminder_delivery_claims',
            'erdc',
            'event_reminder',
            'events',
            'event_reminder_delivery_claim_source',
            'event_reminder_delivery_claim',
            $tenantId,
            $since,
            $windowHours
        );
    }

    /**
     * Health of the CANONICAL event notification pipeline.
     *
     * 🔴 Everything above this method watches the LEGACY reminder tables
     * (event_reminders, event_reminder_delivery_claims) and the
     * 'event_reminder' email_log category. Under the default configuration
     * (events.reminders.mode = canonical, events.notification_delivery.mode =
     * outbox_authoritative) the legacy sender no-ops, so those tables stay
     * empty and their checks are permanently silent — every reminder, update
     * and lifecycle email actually flows through event_domain_outbox /
     * event_notification_deliveries under the 'event_outbox' category, which
     * nothing was watching. Event email could therefore break for a tenant
     * without raising a single alarm.
     *
     * @return list<array<string,mixed>>
     */
    private function checkEventOutboxDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (! $this->hasTables(['event_notification_deliveries'])) {
            return [];
        }

        $issues = [];

        // Queued long past the point a worker should have taken it. Mirrors
        // the 15-minute overdue threshold the legacy reminder check uses.
        $stuck = DB::table('event_notification_deliveries')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->whereIn('status', ['pending', 'retry'])
            ->where('created_at', '<', now()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues(
            $stuck,
            'event_outbox_deliveries_overdue_pending',
            'critical',
            'events',
            'event_created_update_cancellation_rsvp_reminder',
            ['minutes' => 15],
        ));

        // Gave up entirely: these recipients were never told.
        $deadLettered = DB::table('event_notification_deliveries')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'dead_letter')
            ->where('updated_at', '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues(
            $deadLettered,
            'event_outbox_deliveries_dead_lettered',
            'critical',
            'events',
            'event_created_update_cancellation_rsvp_reminder',
            ['window_hours' => $windowHours],
        ));

        // Outbox rows nothing ever picked up — the pipeline's own intake
        // failing, upstream of any individual delivery.
        if ($this->hasTables(['event_domain_outbox'])) {
            $unprocessed = DB::table('event_domain_outbox')
                ->select('tenant_id', DB::raw('COUNT(*) as count'))
                ->whereNull('processed_at')
                ->where('created_at', '<', now()->subMinutes(30))
                ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
                ->groupBy('tenant_id')
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues(
                $unprocessed,
                'event_outbox_rows_unprocessed',
                'critical',
                'events',
                'event_created_update_cancellation_rsvp_reminder',
                ['minutes' => 30],
            ));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkVolunteerReminderDeliveryClaimHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        return $this->checkReminderDeliveryClaimHealth(
            'vol_reminder_delivery_claims',
            'vrdc',
            'volunteer_reminder',
            'volunteering',
            'volunteer_reminder_delivery_claim_source',
            'volunteer_reminder_delivery_claim',
            $tenantId,
            $since,
            $windowHours
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkReminderDeliveryClaimHealth(
        string $table,
        string $alias,
        string $category,
        string $module,
        string $event,
        string $codePrefix,
        ?int $tenantId,
        \DateTimeInterface $since,
        int $windowHours
    ): array {
        if (
            !$this->hasTables([$table])
            || !Schema::hasColumn($table, 'claimed_at')
            || !Schema::hasColumn($table, 'delivered_at')
        ) {
            return [];
        }

        $issues = [];

        $staleClaimed = DB::table("{$table} as {$alias}")
            ->select("{$alias}.tenant_id", DB::raw('COUNT(*) as count'))
            ->where("{$alias}.status", 'claimed')
            ->whereNull("{$alias}.delivered_at")
            ->where("{$alias}.claimed_at", '<', now()->subMinutes(15))
            ->when(
                Schema::hasColumn($table, 'channel'),
                fn ($q) => $q->where("{$alias}.channel", 'email')
            )
            ->when($tenantId !== null, fn ($q) => $q->where("{$alias}.tenant_id", $tenantId))
            ->groupBy("{$alias}.tenant_id")
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($staleClaimed, "{$codePrefix}_stale_claimed", 'critical', $module, $event, ['minutes' => 15]));

        if (!$this->hasTables(['email_log'])) {
            return $issues;
        }

        $deliveredWithoutEmail = DB::table("{$table} as {$alias}")
            ->select("{$alias}.tenant_id", DB::raw('COUNT(*) as count'))
            ->where("{$alias}.status", 'delivered')
            ->where("{$alias}.delivered_at", '>=', $since)
            ->when(
                Schema::hasColumn($table, 'channel'),
                fn ($q) => $q->where("{$alias}.channel", 'email')
            )
            ->whereNotExists(function ($sub) use ($alias, $category): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', "{$alias}.user_id")
                    ->whereColumn('email_log.tenant_id', "{$alias}.tenant_id")
                    ->where('email_log.category', $category)
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw("email_log.created_at BETWEEN DATE_SUB({$alias}.delivered_at, INTERVAL 10 MINUTE) AND DATE_ADD({$alias}.delivered_at, INTERVAL 10 MINUTE)");
            })
            ->when($tenantId !== null, fn ($q) => $q->where("{$alias}.tenant_id", $tenantId))
            ->groupBy("{$alias}.tenant_id")
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($deliveredWithoutEmail, "{$codePrefix}_delivered_without_email_log", 'critical', $module, $event, ['window_hours' => $windowHours]));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkEmailDeliveryLedgerHealth(
        string $table,
        string $alias,
        string $category,
        string $module,
        string $event,
        string $codePrefix,
        ?int $tenantId,
        \DateTimeInterface $since,
        int $windowHours
    ): array {
        if (
            !$this->hasTables([$table])
            || !Schema::hasColumn($table, 'claimed_at')
            || !Schema::hasColumn($table, 'delivered_at')
            || !Schema::hasColumn($table, 'failed_at')
            || !Schema::hasColumn($table, 'channel')
        ) {
            return [];
        }

        $issues = [];

        $staleClaimed = DB::table("{$table} as {$alias}")
            ->select("{$alias}.tenant_id", DB::raw('COUNT(*) as count'))
            ->where("{$alias}.channel", 'email')
            ->where("{$alias}.status", 'claimed')
            ->where("{$alias}.claimed_at", '<', now()->subMinutes(15))
            ->when($tenantId !== null, fn ($q) => $q->where("{$alias}.tenant_id", $tenantId))
            ->groupBy("{$alias}.tenant_id")
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($staleClaimed, "{$codePrefix}_stale_claimed", 'critical', $module, $event, ['minutes' => 15]));

        $failedRecent = DB::table("{$table} as {$alias}")
            ->select("{$alias}.tenant_id", DB::raw('COUNT(*) as count'))
            ->where("{$alias}.channel", 'email')
            ->where("{$alias}.status", 'failed')
            ->where("{$alias}.failed_at", '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->where("{$alias}.tenant_id", $tenantId))
            ->groupBy("{$alias}.tenant_id")
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($failedRecent, "{$codePrefix}_failed_recently", 'warning', $module, $event, ['window_hours' => $windowHours]));

        if (!$this->hasTables(['email_log'])) {
            return $issues;
        }

        $deliveredWithoutEmail = DB::table("{$table} as {$alias}")
            ->select("{$alias}.tenant_id", DB::raw('COUNT(*) as count'))
            ->where("{$alias}.channel", 'email')
            ->where("{$alias}.status", 'delivered')
            ->where("{$alias}.delivered_at", '>=', $since)
            ->whereNotExists(function ($sub) use ($alias, $category): void {
                $sub->select(DB::raw(1))
                    ->from('email_log')
                    ->whereColumn('email_log.user_id', "{$alias}.user_id")
                    ->whereColumn('email_log.tenant_id', "{$alias}.tenant_id")
                    ->where('email_log.category', $category)
                    ->whereIn('email_log.status', ['sent', 'delivered', 'bounced'])
                    ->whereRaw("email_log.created_at BETWEEN DATE_SUB({$alias}.delivered_at, INTERVAL 10 MINUTE) AND DATE_ADD({$alias}.delivered_at, INTERVAL 10 MINUTE)");
            })
            ->when($tenantId !== null, fn ($q) => $q->where("{$alias}.tenant_id", $tenantId))
            ->groupBy("{$alias}.tenant_id")
            ->get();
        $issues = array_merge($issues, $this->rowsToIssues($deliveredWithoutEmail, "{$codePrefix}_delivered_without_email_log", 'critical', $module, $event, ['window_hours' => $windowHours]));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkVereinDuesEmailHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['verein_member_dues'])) {
            return [];
        }

        $issues = [];

        if (Schema::hasColumn('verein_member_dues', 'generated_email_sent_at')) {
            $generatedWithoutEmail = DB::table('verein_member_dues')
                ->select('tenant_id', DB::raw('COUNT(*) as count'))
                ->where('created_at', '>=', $since)
                ->whereNull('generated_email_sent_at')
                ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
                ->groupBy('tenant_id')
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($generatedWithoutEmail, 'verein_dues_generated_without_email_evidence', 'critical', 'verein', 'verein_dues', ['window_hours' => $windowHours]));
        }

        if (Schema::hasColumn('verein_member_dues', 'paid_email_sent_at')) {
            $paidWithoutEmail = DB::table('verein_member_dues')
                ->select('tenant_id', DB::raw('COUNT(*) as count'))
                ->where('status', 'paid')
                ->where('paid_at', '>=', $since)
                ->whereNull('paid_email_sent_at')
                ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
                ->groupBy('tenant_id')
                ->get();
            $issues = array_merge($issues, $this->rowsToIssues($paidWithoutEmail, 'verein_dues_paid_without_email_evidence', 'critical', 'verein', 'verein_dues', ['window_hours' => $windowHours]));
        }

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkMemberPremiumBillingEmailHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['member_subscription_events']) || !Schema::hasColumn('member_subscription_events', 'notification_sent_at')) {
            return [];
        }

        $withoutNotification = DB::table('member_subscription_events')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->whereIn('event_type', ['subscription.deleted', 'invoice.paid', 'invoice.payment_failed'])
            ->where('created_at', '>=', $since)
            ->whereNull('notification_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();

        return $this->rowsToIssues($withoutNotification, 'member_subscription_event_without_email_evidence', 'critical', 'billing', 'member_premium_billing', ['window_hours' => $windowHours]);
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkStripeDonationReceiptEmailHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['vol_donations'])
            || !Schema::hasColumn('vol_donations', 'receipt_email_sent_at')
            || !Schema::hasColumn('vol_donations', 'receipt_email_failed_at')
        ) {
            return [];
        }

        $withoutReceipt = DB::table('vol_donations')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->where('status', 'completed')
            ->whereNotNull('stripe_payment_intent_id')
            ->where('created_at', '>=', $since)
            ->whereNull('receipt_email_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();

        return $this->rowsToIssues($withoutReceipt, 'stripe_donation_without_receipt_email_evidence', 'critical', 'donations', 'stripe_donation_receipt_source', ['window_hours' => $windowHours]);
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkFederationMessageDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['federation_messages'])
            || !Schema::hasColumn('federation_messages', 'email_sent_at')
            || !Schema::hasColumn('federation_messages', 'notification_sent_at')
        ) {
            return [];
        }

        $withoutEmail = DB::table('federation_messages')
            ->select('receiver_tenant_id as tenant_id', DB::raw('COUNT(*) as count'))
            ->where('direction', 'inbound')
            ->where('created_at', '>=', $since)
            ->whereNull('email_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('receiver_tenant_id', $tenantId))
            ->groupBy('receiver_tenant_id')
            ->get();

        $withoutBell = DB::table('federation_messages')
            ->select('receiver_tenant_id as tenant_id', DB::raw('COUNT(*) as count'))
            ->where('direction', 'inbound')
            ->where('created_at', '>=', $since)
            ->whereNull('notification_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('receiver_tenant_id', $tenantId))
            ->groupBy('receiver_tenant_id')
            ->get();

        return array_merge(
            $this->rowsToIssues($withoutEmail, 'federation_message_without_email_evidence', 'critical', 'federation', 'federated_message_received', ['window_hours' => $windowHours]),
            $this->rowsToIssues($withoutBell, 'federation_message_without_bell_evidence', 'warning', 'federation', 'federated_message_received', ['window_hours' => $windowHours])
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkGroupMembershipNotificationHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (!$this->hasTables(['group_members', 'groups'])) {
            return [];
        }

        $issues = [];

        if (Schema::hasColumn('group_members', 'tenant_id')) {
            $tenantMismatch = DB::table('group_members as gm')
                ->join('groups as g', 'g.id', '=', 'gm.group_id')
                ->selectRaw('g.tenant_id as tenant_id, COUNT(*) as count')
                ->whereRaw('gm.tenant_id <> g.tenant_id')
                ->when($tenantId !== null, fn ($q) => $q->where('g.tenant_id', $tenantId))
                ->groupBy('g.tenant_id')
                ->get();

            $issues = array_merge($issues, $this->rowsToIssues(
                $tenantMismatch,
                'group_members_tenant_mismatch',
                'critical',
                'groups',
                'membership_or_role_change'
            ));
        }

        if (!$this->hasTables(['notification_queue']) || !Schema::hasColumn('group_members', 'created_at')) {
            return $issues;
        }

        $recentJoinsWithoutOwnerQueue = DB::table('group_members as gm')
            ->join('groups as g', 'g.id', '=', 'gm.group_id')
            ->selectRaw('g.tenant_id as tenant_id, COUNT(*) as count')
            ->where('gm.status', 'active')
            ->where('gm.created_at', '>=', $since)
            ->whereRaw('g.owner_id <> gm.user_id')
            ->whereNotExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('notification_queue as nq')
                    ->whereColumn('nq.user_id', 'g.owner_id')
                    ->whereColumn('nq.tenant_id', 'g.tenant_id')
                    ->whereColumn('nq.created_at', '>=', 'gm.created_at')
                    ->where('nq.activity_type', 'group_member_joined')
                    ->whereIn('nq.status', ['pending', 'processing', 'sent', 'suppressed']);
            })
            ->when($tenantId !== null, fn ($q) => $q->where('g.tenant_id', $tenantId))
            ->groupBy('g.tenant_id')
            ->get();

        $issues = array_merge($issues, $this->rowsToIssues(
            $recentJoinsWithoutOwnerQueue,
            'group_member_joined_without_owner_notification_queue',
            'warning',
            'groups',
            'membership_or_role_change',
            ['window_hours' => $windowHours]
        ));

        return $issues;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkFederationTransactionDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['federation_transactions'])
            || !Schema::hasColumn('federation_transactions', 'email_sent_at')
            || !Schema::hasColumn('federation_transactions', 'notification_sent_at')
        ) {
            return [];
        }

        $withoutEmail = DB::table('federation_transactions')
            ->select('receiver_tenant_id as tenant_id', DB::raw('COUNT(*) as count'))
            ->whereNotNull('external_partner_id')
            ->where('status', 'completed')
            ->where('created_at', '>=', $since)
            ->whereNull('email_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('receiver_tenant_id', $tenantId))
            ->groupBy('receiver_tenant_id')
            ->get();

        $withoutBell = DB::table('federation_transactions')
            ->select('receiver_tenant_id as tenant_id', DB::raw('COUNT(*) as count'))
            ->whereNotNull('external_partner_id')
            ->where('status', 'completed')
            ->where('created_at', '>=', $since)
            ->whereNull('notification_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('receiver_tenant_id', $tenantId))
            ->groupBy('receiver_tenant_id')
            ->get();

        return array_merge(
            $this->rowsToIssues($withoutEmail, 'federation_transaction_without_email_evidence', 'critical', 'federation', 'federated_transaction_received_sent', ['window_hours' => $windowHours]),
            $this->rowsToIssues($withoutBell, 'federation_transaction_without_bell_evidence', 'warning', 'federation', 'federated_transaction_received_sent', ['window_hours' => $windowHours])
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkFederationConnectionDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['federation_inbound_connections'])
            || !Schema::hasColumn('federation_inbound_connections', 'email_sent_at')
            || !Schema::hasColumn('federation_inbound_connections', 'notification_sent_at')
        ) {
            return [];
        }

        $withoutEmail = DB::table('federation_inbound_connections')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->whereIn('status', ['pending', 'accepted'])
            ->where('created_at', '>=', $since)
            ->whereNull('email_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();

        $withoutBell = DB::table('federation_inbound_connections')
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->whereIn('status', ['pending', 'accepted'])
            ->where('created_at', '>=', $since)
            ->whereNull('notification_sent_at')
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->groupBy('tenant_id')
            ->get();

        return array_merge(
            $this->rowsToIssues($withoutEmail, 'federation_connection_without_email_evidence', 'critical', 'federation', 'federated_connection_request_accepted', ['window_hours' => $windowHours]),
            $this->rowsToIssues($withoutBell, 'federation_connection_without_bell_evidence', 'warning', 'federation', 'federated_connection_request_accepted', ['window_hours' => $windowHours])
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function checkFederationReviewDeliveryHealth(?int $tenantId, \DateTimeInterface $since, int $windowHours): array
    {
        if (
            !$this->hasTables(['reviews'])
            || !Schema::hasColumn('reviews', 'external_partner_id')
            || !Schema::hasColumn('reviews', 'external_id')
            || !Schema::hasColumn('reviews', 'email_sent_at')
            || !Schema::hasColumn('reviews', 'email_skipped_at')
            || !Schema::hasColumn('reviews', 'notification_sent_at')
        ) {
            return [];
        }

        $base = DB::table('reviews')
            ->where('review_type', 'federated')
            ->whereNotNull('external_partner_id')
            ->whereNotNull('external_id')
            ->where('created_at', '>=', $since)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId));

        $withoutEmail = (clone $base)
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->whereNull('email_sent_at')
            ->whereNull('email_skipped_at')
            ->groupBy('tenant_id')
            ->get();

        $withoutBell = (clone $base)
            ->select('tenant_id', DB::raw('COUNT(*) as count'))
            ->whereNull('notification_sent_at')
            ->groupBy('tenant_id')
            ->get();

        return array_merge(
            $this->rowsToIssues($withoutEmail, 'federation_review_without_email_evidence', 'critical', 'federation', 'federated_review_source', ['window_hours' => $windowHours]),
            $this->rowsToIssues($withoutBell, 'federation_review_without_bell_evidence', 'warning', 'federation', 'federated_review_source', ['window_hours' => $windowHours])
        );
    }

    /**
     * @param iterable<object> $rows
     * @param array<string,mixed> $extraParams
     * @return list<array<string,mixed>>
     */
    private function rowsToIssues(iterable $rows, string $code, string $severity, string $module, string $event, array $extraParams = []): array
    {
        $issues = [];
        foreach ($rows as $row) {
            $count = (int) ($row->count ?? 0);
            if ($count <= 0) {
                continue;
            }
            $issues[] = $this->issue($code, $severity, isset($row->tenant_id) ? (int) $row->tenant_id : null, $module, $event, array_merge($extraParams, ['count' => $count]));
        }
        return $issues;
    }

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    private function issue(string $code, string $severity, ?int $tenantId, string $module, string $event, array $params = []): array
    {
        return [
            'code' => $code,
            'severity' => $severity,
            'tenant_id' => $tenantId,
            'module' => $module,
            'event' => $event,
            'message_key' => "email_deliverability.warnings.{$code}.body",
            'params' => $params,
        ];
    }

    /**
     * @param list<string> $tables
     */
    private function hasTables(array $tables): bool
    {
        foreach ($tables as $table) {
            if (!Schema::hasTable($table)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Reserved test domains are intentionally non-deliverable. They are useful
     * for local fixtures, but should not be counted as "email failed to fire"
     * incidents in the enterprise trigger audit.
     *
     * @param \Illuminate\Database\Query\Builder $query
     */
    private function excludeReservedEmailDomains($query, string $column): void
    {
        foreach ([
            '%@example.test',
            '%@example.invalid',
            '%@test.local',
            '%@localhost',
        ] as $pattern) {
            $query->where($column, 'not like', $pattern);
        }
    }
}
