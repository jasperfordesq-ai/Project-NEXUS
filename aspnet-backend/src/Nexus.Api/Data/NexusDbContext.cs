// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Nexus.Api.Entities;
using Nexus.Api.Data.Configurations;

namespace Nexus.Api.Data;

/// <summary>
/// EF Core database context with tenant isolation via global query filters.
/// </summary>
public class NexusDbContext : DbContext
{
    private readonly TenantContext _tenantContext;

    // Direct properties for EF Core query filter parameterization.
    // EF Core can only parameterize expressions that reference DbContext members directly —
    // chained access like _tenantContext.TenantId is evaluated once at model build time.
    public int? CurrentTenantId => _tenantContext.TenantId;
    public bool IsTenantResolved => _tenantContext.IsResolved;

    public NexusDbContext(DbContextOptions<NexusDbContext> options, TenantContext tenantContext)
        : base(options)
    {
        _tenantContext = tenantContext;
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Listing> Listings => Set<Listing>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageReaction> MessageReactions => Set<MessageReaction>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<Connection> Connections => Set<Connection>();
    public DbSet<UserBlock> UserBlocks => Set<UserBlock>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMember> GroupMembers => Set<GroupMember>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<EventRsvp> EventRsvps => Set<EventRsvp>();
    public DbSet<EventStatusHistory> EventStatusHistories => Set<EventStatusHistory>();
    public DbSet<ContentModerationQueue> ContentModerationQueue => Set<ContentModerationQueue>();
    public DbSet<EventDomainOutbox> EventDomainOutbox => Set<EventDomainOutbox>();
    public DbSet<EventRecurrenceRule> EventRecurrenceRules => Set<EventRecurrenceRule>();
    public DbSet<EventRecurrenceRevision> EventRecurrenceRevisions => Set<EventRecurrenceRevision>();
    public DbSet<EventRecurrenceOccurrenceLedger> EventRecurrenceOccurrenceLedger => Set<EventRecurrenceOccurrenceLedger>();
    public DbSet<EventRecurrenceDefinitionBlueprint> EventRecurrenceDefinitionBlueprints => Set<EventRecurrenceDefinitionBlueprint>();
    public DbSet<EventRecurrenceDefinitionApplication> EventRecurrenceDefinitionApplications => Set<EventRecurrenceDefinitionApplication>();
    public DbSet<EventNotificationDelivery> EventNotificationDeliveries => Set<EventNotificationDelivery>();
    public DbSet<EventFederationDelivery> EventFederationDeliveries => Set<EventFederationDelivery>();
    public DbSet<EventReminderRuleProduct> EventReminderRulesProduct => Set<EventReminderRuleProduct>();
    public DbSet<EventTemplate> EventTemplates => Set<EventTemplate>();
    public DbSet<EventTemplateVersion> EventTemplateVersions => Set<EventTemplateVersion>();
    public DbSet<EventTemplateMaterialization> EventTemplateMaterializations => Set<EventTemplateMaterialization>();
    public DbSet<EventTemplateAudit> EventTemplateAudits => Set<EventTemplateAudit>();
    public DbSet<EventRegistration> EventRegistrations => Set<EventRegistration>();
    public DbSet<EventRegistrationHistory> EventRegistrationHistory => Set<EventRegistrationHistory>();
    public DbSet<EventWaitlistEntry> EventWaitlistEntries => Set<EventWaitlistEntry>();
    public DbSet<EventWaitlistEntryHistory> EventWaitlistEntryHistory => Set<EventWaitlistEntryHistory>();
    public DbSet<EventAttendance> EventAttendance => Set<EventAttendance>();
    public DbSet<EventAttendanceActivity> EventAttendanceActivity => Set<EventAttendanceActivity>();
    public DbSet<EventBroadcast> EventBroadcasts => Set<EventBroadcast>();
    public DbSet<EventBroadcastHistory> EventBroadcastHistory => Set<EventBroadcastHistory>();
    public DbSet<EventBroadcastDelivery> EventBroadcastDeliveries => Set<EventBroadcastDelivery>();
    public DbSet<EventBroadcastDeliveryAttempt> EventBroadcastDeliveryAttempts => Set<EventBroadcastDeliveryAttempt>();
    public DbSet<EventSession> EventSessions => Set<EventSession>();
    public DbSet<EventSessionSpeaker> EventSessionSpeakers => Set<EventSessionSpeaker>();
    public DbSet<EventSessionResource> EventSessionResources => Set<EventSessionResource>();
    public DbSet<EventSessionHistory> EventSessionHistory => Set<EventSessionHistory>();
    public DbSet<EventSessionRegistration> EventSessionRegistrations => Set<EventSessionRegistration>();
    public DbSet<EventSessionRegistrationHistory> EventSessionRegistrationHistory => Set<EventSessionRegistrationHistory>();
    public DbSet<EventStaffAssignment> EventStaffAssignments => Set<EventStaffAssignment>();
    public DbSet<EventStaffAssignmentHistory> EventStaffAssignmentHistory => Set<EventStaffAssignmentHistory>();
    public DbSet<EventCalendarFeedToken> EventCalendarFeedTokens => Set<EventCalendarFeedToken>();
    public DbSet<EventCheckinCredential> EventCheckinCredentials => Set<EventCheckinCredential>();
    public DbSet<EventCheckinDevice> EventCheckinDevices => Set<EventCheckinDevice>();
    public DbSet<EventOfflineSyncBatch> EventOfflineSyncBatches => Set<EventOfflineSyncBatch>();
    public DbSet<EventOfflineSyncItem> EventOfflineSyncItems => Set<EventOfflineSyncItem>();
    public DbSet<EventOfflineSyncDecision> EventOfflineSyncDecisions => Set<EventOfflineSyncDecision>();
    public DbSet<EventSafetyRequirement> EventSafetyRequirements => Set<EventSafetyRequirement>();
    public DbSet<EventSafetyRequirementVersion> EventSafetyRequirementVersions => Set<EventSafetyRequirementVersion>();
    public DbSet<EventSafetyRequirementHistory> EventSafetyRequirementHistory => Set<EventSafetyRequirementHistory>();
    public DbSet<EventSafetyCodeAcknowledgement> EventSafetyCodeAcknowledgements => Set<EventSafetyCodeAcknowledgement>();
    public DbSet<EventGuardianConsent> EventGuardianConsents => Set<EventGuardianConsent>();
    public DbSet<EventGuardianConsentHistory> EventGuardianConsentHistory => Set<EventGuardianConsentHistory>();
    public DbSet<EventParticipationDenial> EventParticipationDenials => Set<EventParticipationDenial>();
    public DbSet<EventParticipationDenialHistory> EventParticipationDenialHistory => Set<EventParticipationDenialHistory>();
    public DbSet<EventTicketType> EventTicketTypes => Set<EventTicketType>();
    public DbSet<EventTicketTypeHistory> EventTicketTypeHistory => Set<EventTicketTypeHistory>();
    public DbSet<EventTicketEntitlement> EventTicketEntitlements => Set<EventTicketEntitlement>();
    public DbSet<EventTicketEntitlementHistory> EventTicketEntitlementHistory => Set<EventTicketEntitlementHistory>();
    public DbSet<EventTicketInventoryHistory> EventTicketInventoryHistory => Set<EventTicketInventoryHistory>();
    public DbSet<EventRegistrationSettings> EventRegistrationSettingsProduct => Set<EventRegistrationSettings>();
    public DbSet<EventRegistrationSettingsHistory> EventRegistrationSettingsHistory => Set<EventRegistrationSettingsHistory>();
    public DbSet<EventRegistrationFormVersion> EventRegistrationFormVersions => Set<EventRegistrationFormVersion>();
    public DbSet<EventRegistrationFormQuestion> EventRegistrationFormQuestions => Set<EventRegistrationFormQuestion>();
    public DbSet<EventRegistrationFormSubmission> EventRegistrationFormSubmissions => Set<EventRegistrationFormSubmission>();
    public DbSet<EventRegistrationFormAnswer> EventRegistrationFormAnswers => Set<EventRegistrationFormAnswer>();
    public DbSet<EventRegistrationSubmissionHistory> EventRegistrationSubmissionHistory => Set<EventRegistrationSubmissionHistory>();
    public DbSet<EventRegistrationAnswerAccessAudit> EventRegistrationAnswerAccessAudits => Set<EventRegistrationAnswerAccessAudit>();
    public DbSet<EventInvitationCampaign> EventInvitationCampaigns => Set<EventInvitationCampaign>();
    public DbSet<EventInvitationCampaignHistory> EventInvitationCampaignHistory => Set<EventInvitationCampaignHistory>();
    public DbSet<EventInvitation> EventInvitations => Set<EventInvitation>();
    public DbSet<EventInvitationHistory> EventInvitationHistory => Set<EventInvitationHistory>();
    public DbSet<EventInvitationDeliveryEvidence> EventInvitationDeliveryEvidence => Set<EventInvitationDeliveryEvidence>();
    public DbSet<EventNotificationPreferenceProduct> EventNotificationPreferencesProduct => Set<EventNotificationPreferenceProduct>();
    public DbSet<EventAttendanceCreditClaim> EventAttendanceCreditClaims => Set<EventAttendanceCreditClaim>();
    public DbSet<EventAnalyticsOptionalFact> EventAnalyticsOptionalFacts => Set<EventAnalyticsOptionalFact>();
    public DbSet<EventAnalyticsWithdrawalRun> EventAnalyticsWithdrawalRuns => Set<EventAnalyticsWithdrawalRun>();
    public DbSet<EventAnalyticsAccessAudit> EventAnalyticsAccessAudits => Set<EventAnalyticsAccessAudit>();
    public DbSet<EventRegistrationGuest> EventRegistrationGuests => Set<EventRegistrationGuest>();
    public DbSet<EventRegistrationGuestAttendance> EventRegistrationGuestAttendance => Set<EventRegistrationGuestAttendance>();
    public DbSet<EventRegistrationGuestAttendanceHistory> EventRegistrationGuestAttendanceHistory => Set<EventRegistrationGuestAttendanceHistory>();
    public DbSet<EventRegistrationRetentionRun> EventRegistrationRetentionRuns => Set<EventRegistrationRetentionRun>();
    public DbSet<EventRegistrationRetentionItem> EventRegistrationRetentionItems => Set<EventRegistrationRetentionItem>();
    public DbSet<FeedPost> FeedPosts => Set<FeedPost>();
    public DbSet<FeedActivity> FeedActivities => Set<FeedActivity>();
    public DbSet<PostLike> PostLikes => Set<PostLike>();
    public DbSet<PostComment> PostComments => Set<PostComment>();
    public DbSet<CommentReaction> CommentReactions => Set<CommentReaction>();
    public DbSet<ContentReaction> ContentReactions => Set<ContentReaction>();
    public DbSet<ContentLike> ContentLikes => Set<ContentLike>();
    public DbSet<Badge> Badges => Set<Badge>();
    public DbSet<UserBadge> UserBadges => Set<UserBadge>();
    public DbSet<XpLog> XpLogs => Set<XpLog>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<AiConversation> AiConversations => Set<AiConversation>();
    public DbSet<AiMessage> AiMessages => Set<AiMessage>();
    public DbSet<KnowledgeChunk> KnowledgeChunks => Set<KnowledgeChunk>();
    public DbSet<AiMessageFeedback> AiMessageFeedbacks => Set<AiMessageFeedback>();
    public DbSet<AiRequestAuditLog> AiRequestAuditLogs => Set<AiRequestAuditLog>();
    public DbSet<AiConversationLongMemory> AiConversationLongMemories => Set<AiConversationLongMemory>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<TenantConfig> TenantConfigs => Set<TenantConfig>();
    public DbSet<TenantSsoProvider> TenantSsoProviders => Set<TenantSsoProvider>();
    public DbSet<OAuthIdentity> OAuthIdentities => Set<OAuthIdentity>();
    public DbSet<SsoOidcFlow> SsoOidcFlows => Set<SsoOidcFlow>();
    public DbSet<OAuthCallbackGrant> OAuthCallbackGrants => Set<OAuthCallbackGrant>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<CaringEmergencyAlert> CaringEmergencyAlerts => Set<CaringEmergencyAlert>();
    public DbSet<CaringFederationPeer> CaringFederationPeers => Set<CaringFederationPeer>();
    public DbSet<CaringSubRegion> CaringSubRegions => Set<CaringSubRegion>();
    public DbSet<CaringCareProvider> CaringCareProviders => Set<CaringCareProvider>();
    public DbSet<CaringCaregiverLink> CaringCaregiverLinks => Set<CaringCaregiverLink>();
    public DbSet<CaringCoverRequest> CaringCoverRequests => Set<CaringCoverRequest>();
    public DbSet<CaringSupportCategory> CaringSupportCategories => Set<CaringSupportCategory>();
    public DbSet<CaringSupportRelationship> CaringSupportRelationships => Set<CaringSupportRelationship>();
    public DbSet<CaringTandemSuggestionLog> CaringTandemSuggestionLogs => Set<CaringTandemSuggestionLog>();
    public DbSet<CaringHelpRequest> CaringHelpRequests => Set<CaringHelpRequest>();
    public DbSet<VolunteerLog> VolunteerLogs => Set<VolunteerLog>();
    public DbSet<CaringProjectAnnouncement> CaringProjectAnnouncements => Set<CaringProjectAnnouncement>();
    public DbSet<CaringProjectUpdate> CaringProjectUpdates => Set<CaringProjectUpdate>();
    public DbSet<CaringProjectSubscription> CaringProjectSubscriptions => Set<CaringProjectSubscription>();
    public DbSet<CaringSmartNudge> CaringSmartNudges => Set<CaringSmartNudge>();
    public DbSet<CaringPaperOnboardingIntake> CaringPaperOnboardingIntakes => Set<CaringPaperOnboardingIntake>();
    public DbSet<MunicipalReportTemplate> MunicipalReportTemplates => Set<MunicipalReportTemplate>();
    public DbSet<MunicipalVerification> MunicipalVerifications => Set<MunicipalVerification>();
    public DbSet<CaringInviteCode> CaringInviteCodes => Set<CaringInviteCode>();
    public DbSet<CaringKpiBaseline> CaringKpiBaselines => Set<CaringKpiBaseline>();
    public DbSet<Exchange> Exchanges => Set<Exchange>();
    public DbSet<ExchangeRating> ExchangeRatings => Set<ExchangeRating>();

    // Phase 17: Smart Matching
    public DbSet<MatchPreference> MatchPreferences => Set<MatchPreference>();
    public DbSet<MatchResult> MatchResults => Set<MatchResult>();

    // Phase 18: Volunteering
    public DbSet<VolunteerOrganisation> VolunteerOrganisations => Set<VolunteerOrganisation>();
    public DbSet<VolunteerOrganisationMember> VolunteerOrganisationMembers => Set<VolunteerOrganisationMember>();
    public DbSet<VolunteerOrganisationTransaction> VolunteerOrganisationTransactions => Set<VolunteerOrganisationTransaction>();
    public DbSet<VolunteerOpportunity> VolunteerOpportunities => Set<VolunteerOpportunity>();
    public DbSet<VolunteerShift> VolunteerShifts => Set<VolunteerShift>();
    public DbSet<VolunteerApplication> VolunteerApplications => Set<VolunteerApplication>();
    public DbSet<VolunteerCheckIn> VolunteerCheckIns => Set<VolunteerCheckIn>();
    public DbSet<RecurringShiftPattern> RecurringShiftPatterns => Set<RecurringShiftPattern>();
    public DbSet<ShiftGroupReservation> ShiftGroupReservations => Set<ShiftGroupReservation>();
    public DbSet<ShiftGroupMember> ShiftGroupMembers => Set<ShiftGroupMember>();
    public DbSet<ShiftSwapRequest> ShiftSwapRequests => Set<ShiftSwapRequest>();
    public DbSet<ShiftWaitlistEntry> ShiftWaitlistEntries => Set<ShiftWaitlistEntry>();

    // Phase 19: Wallet expansion
    public DbSet<TransactionCategory> TransactionCategories => Set<TransactionCategory>();
    public DbSet<TransactionLimit> TransactionLimits => Set<TransactionLimit>();
    public DbSet<BalanceAlert> BalanceAlerts => Set<BalanceAlert>();
    public DbSet<CreditDonation> CreditDonations => Set<CreditDonation>();

    // Phase 20: Listings expansion
    public DbSet<ListingAnalytics> ListingAnalytics => Set<ListingAnalytics>();
    public DbSet<ListingFavorite> ListingFavorites => Set<ListingFavorite>();
    public DbSet<ListingTag> ListingTags => Set<ListingTag>();

    // Phase 21: Groups expansion
    public DbSet<GroupAnnouncement> GroupAnnouncements => Set<GroupAnnouncement>();
    public DbSet<GroupPolicy> GroupPolicies => Set<GroupPolicy>();
    public DbSet<GroupFile> GroupFiles => Set<GroupFile>();
    public DbSet<GroupDiscussion> GroupDiscussions => Set<GroupDiscussion>();
    public DbSet<GroupDiscussionReply> GroupDiscussionReplies => Set<GroupDiscussionReply>();
    public DbSet<GroupInvite> GroupInvites => Set<GroupInvite>();
    public DbSet<GroupDataExport> GroupDataExports => Set<GroupDataExport>();
    public DbSet<GroupMediaItem> GroupMediaItems => Set<GroupMediaItem>();
    public DbSet<GroupWikiPage> GroupWikiPages => Set<GroupWikiPage>();
    public DbSet<GroupWikiRevision> GroupWikiRevisions => Set<GroupWikiRevision>();
    public DbSet<GroupQuestion> GroupQuestions => Set<GroupQuestion>();
    public DbSet<GroupAnswer> GroupAnswers => Set<GroupAnswer>();
    public DbSet<GroupQaVote> GroupQaVotes => Set<GroupQaVote>();
    public DbSet<GroupType> GroupTypes => Set<GroupType>();
    public DbSet<GroupTemplate> GroupTemplates => Set<GroupTemplate>();
    public DbSet<GroupChallenge> GroupChallenges => Set<GroupChallenge>();
    public DbSet<GroupScheduledPost> GroupScheduledPosts => Set<GroupScheduledPost>();
    public DbSet<GroupWebhook> GroupWebhooks => Set<GroupWebhook>();
    public DbSet<GroupNotificationPreference> GroupNotificationPreferences => Set<GroupNotificationPreference>();
    public DbSet<GroupCustomField> GroupCustomFields => Set<GroupCustomField>();
    public DbSet<GroupWelcomeSettings> GroupWelcomeSettings => Set<GroupWelcomeSettings>();
    public DbSet<GroupChatroomPin> GroupChatroomPins => Set<GroupChatroomPin>();
    public DbSet<GroupRecommendationEvent> GroupRecommendationEvents => Set<GroupRecommendationEvent>();
    public DbSet<GroupAutoAssignRule> GroupAutoAssignRules => Set<GroupAutoAssignRule>();

    // Phase 22: Gamification expansion
    public DbSet<Challenge> Challenges => Set<Challenge>();
    public DbSet<ChallengeParticipant> ChallengeParticipants => Set<ChallengeParticipant>();
    public DbSet<Streak> Streaks => Set<Streak>();
    public DbSet<MonthlyEngagement> MonthlyEngagements => Set<MonthlyEngagement>();
    public DbSet<SeasonalRecognition> SeasonalRecognitions => Set<SeasonalRecognition>();
    public DbSet<LeaderboardSeason> LeaderboardSeasons => Set<LeaderboardSeason>();
    public DbSet<LeaderboardEntry> LeaderboardEntries => Set<LeaderboardEntry>();
    public DbSet<DailyReward> DailyRewards => Set<DailyReward>();
    public DbSet<Story> Stories => Set<Story>();
    public DbSet<StoryView> StoryViews => Set<StoryView>();
    public DbSet<StoryReaction> StoryReactions => Set<StoryReaction>();
    public DbSet<StoryCloseFriend> StoryCloseFriends => Set<StoryCloseFriend>();
    public DbSet<StoryHighlight> StoryHighlights => Set<StoryHighlight>();
    public DbSet<StoryHighlightItem> StoryHighlightItems => Set<StoryHighlightItem>();

    // Phase 23: Skills & Endorsements
    public DbSet<Skill> Skills => Set<Skill>();
    public DbSet<UserSkill> UserSkills => Set<UserSkill>();
    public DbSet<Endorsement> Endorsements => Set<Endorsement>();

    // Phase 24: Audit Logging
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<CompatibilityAuditEntry> CompatibilityAuditEntries => Set<CompatibilityAuditEntry>();

    // Phase 25: Email Notifications
    public DbSet<EmailTemplate> EmailTemplates => Set<EmailTemplate>();
    public DbSet<EmailLog> EmailLogs => Set<EmailLog>();
    public DbSet<DigestPreference> DigestPreferences => Set<DigestPreference>();

    // Phase 26: Content Reporting
    public DbSet<ContentReport> ContentReports => Set<ContentReport>();
    public DbSet<UserWarning> UserWarnings => Set<UserWarning>();

    // Phase 27: GDPR
    public DbSet<DataExportRequest> DataExportRequests => Set<DataExportRequest>();
    public DbSet<DataDeletionRequest> DataDeletionRequests => Set<DataDeletionRequest>();
    public DbSet<ConsentRecord> ConsentRecords => Set<ConsentRecord>();

    // Phase 28: Geocoding
    public DbSet<UserLocation> UserLocations => Set<UserLocation>();

    // Phase 29: Feed Ranking
    public DbSet<FeedBookmark> FeedBookmarks => Set<FeedBookmark>();
    public DbSet<PostShare> PostShares => Set<PostShare>();

    // Phase 30: Admin CRM
    public DbSet<AdminNote> AdminNotes => Set<AdminNote>();
    public DbSet<CrmTask> CrmTasks => Set<CrmTask>();
    public DbSet<UserTag> UserTags => Set<UserTag>();

    // Phase 31: Newsletter
    public DbSet<Newsletter> Newsletters => Set<Newsletter>();
    public DbSet<NewsletterSubscription> NewsletterSubscriptions => Set<NewsletterSubscription>();

    // Phase 32: Cookie Consent
    public DbSet<CookieConsent> CookieConsents => Set<CookieConsent>();
    public DbSet<CookiePolicy> CookiePolicies => Set<CookiePolicy>();

    // Phase 33: Push Notifications
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<PushNotificationLog> PushNotificationLogs => Set<PushNotificationLog>();
    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();

    // Phase 34: i18n
    public DbSet<Translation> Translations => Set<Translation>();
    public DbSet<SupportedLocale> SupportedLocales => Set<SupportedLocale>();
    public DbSet<UserLanguagePreference> UserLanguagePreferences => Set<UserLanguagePreference>();

    // Phase 35: Federation
    public DbSet<FederationPartner> FederationPartners => Set<FederationPartner>();
    public DbSet<FederatedListing> FederatedListings => Set<FederatedListing>();
    public DbSet<FederatedExchange> FederatedExchanges => Set<FederatedExchange>();
    public DbSet<FederationAuditLog> FederationAuditLogs => Set<FederationAuditLog>();
    public DbSet<FederationApiKey> FederationApiKeys => Set<FederationApiKey>();
    public DbSet<FederationFeatureToggle> FederationFeatureToggles => Set<FederationFeatureToggle>();
    public DbSet<FederationUserSetting> FederationUserSettings => Set<FederationUserSetting>();
    public DbSet<FederationApiLog> FederationApiLogs => Set<FederationApiLog>();
    public DbSet<FederationExternalPartner> FederationExternalPartners => Set<FederationExternalPartner>();
    public DbSet<FederationExternalPartnerLog> FederationExternalPartnerLogs => Set<FederationExternalPartnerLog>();
    public DbSet<FederationWebhookNonce> FederationWebhookNonces => Set<FederationWebhookNonce>();
    public DbSet<FederationSystemControl> FederationSystemControls => Set<FederationSystemControl>();
    public DbSet<FederationTenantWhitelist> FederationTenantWhitelists => Set<FederationTenantWhitelist>();
    public DbSet<FederationTenantFeature> FederationTenantFeatures => Set<FederationTenantFeature>();
    public DbSet<FederationWebhookSubscription> FederationWebhookSubscriptions => Set<FederationWebhookSubscription>();
    public DbSet<FederationWebhookDeliveryLog> FederationWebhookDeliveryLogs => Set<FederationWebhookDeliveryLog>();
    public DbSet<FederationNeighborhood> FederationNeighborhoods => Set<FederationNeighborhood>();
    public DbSet<FederationNeighborhoodTenant> FederationNeighborhoodTenants => Set<FederationNeighborhoodTenant>();

    // Phase 36: Predictive Staffing
    public DbSet<StaffingPrediction> StaffingPredictions => Set<StaffingPrediction>();
    public DbSet<VolunteerAvailability> VolunteerAvailabilities => Set<VolunteerAvailability>();

    // Phase 65: Volunteering long-tail
    // Phase 68: Federation protocol extensions
    public DbSet<FederatedHourTransfer> FederatedHourTransfers => Set<FederatedHourTransfer>();

    // Phase 72: Long-tail (donations, bookmarks, peer endorsements, presence)
    public DbSet<MoneyDonation> MoneyDonations => Set<MoneyDonation>();
    public DbSet<Bookmark> Bookmarks => Set<Bookmark>();
    public DbSet<BookmarkCollection> BookmarkCollections => Set<BookmarkCollection>();
    public DbSet<PeerEndorsement> PeerEndorsements => Set<PeerEndorsement>();
    public DbSet<UserPresence> UserPresences => Set<UserPresence>();

    public DbSet<VolunteerExpense> VolunteerExpenses => Set<VolunteerExpense>();
    public DbSet<VolunteerWellbeing> VolunteerWellbeings => Set<VolunteerWellbeing>();
    public DbSet<VolunteerWellbeingAlert> VolunteerWellbeingAlerts => Set<VolunteerWellbeingAlert>();
    public DbSet<VolunteerCertificate> VolunteerCertificates => Set<VolunteerCertificate>();
    public DbSet<VolunteerEmergencyAlert> VolunteerEmergencyAlerts => Set<VolunteerEmergencyAlert>();
    public DbSet<VolunteerTrainingCourse> VolunteerTrainingCourses => Set<VolunteerTrainingCourse>();
    public DbSet<VolunteerTrainingCompletion> VolunteerTrainingCompletions => Set<VolunteerTrainingCompletion>();
    public DbSet<VolunteerGuardianConsent> VolunteerGuardianConsents => Set<VolunteerGuardianConsent>();
    public DbSet<VolunteerTenantPolicy> VolunteerTenantPolicies => Set<VolunteerTenantPolicy>();
    public DbSet<CaringFavour> CaringFavours => Set<CaringFavour>();
    public DbSet<CaringMunicipalityFeedback> CaringMunicipalityFeedback => Set<CaringMunicipalityFeedback>();
    public DbSet<MunicipalitySurvey> MunicipalitySurveys => Set<MunicipalitySurvey>();
    public DbSet<MunicipalitySurveyQuestion> MunicipalitySurveyQuestions => Set<MunicipalitySurveyQuestion>();
    public DbSet<MunicipalitySurveyResponse> MunicipalitySurveyResponses => Set<MunicipalitySurveyResponse>();
    public DbSet<CaringTrustTierConfig> CaringTrustTierConfigs => Set<CaringTrustTierConfig>();
    public DbSet<CaringHourEstate> CaringHourEstates => Set<CaringHourEstate>();
    public DbSet<CaringHourTransfer> CaringHourTransfers => Set<CaringHourTransfer>();
    public DbSet<CaringHourGift> CaringHourGifts => Set<CaringHourGift>();
    public DbSet<CaringKissTreffen> CaringKissTreffen => Set<CaringKissTreffen>();
    public DbSet<CaringRegionalPointAccount> CaringRegionalPointAccounts => Set<CaringRegionalPointAccount>();
    public DbSet<CaringRegionalPointTransaction> CaringRegionalPointTransactions => Set<CaringRegionalPointTransaction>();
    public DbSet<CaringResearchPartner> CaringResearchPartners => Set<CaringResearchPartner>();
    public DbSet<CaringResearchConsent> CaringResearchConsents => Set<CaringResearchConsent>();
    public DbSet<CaringResearchDatasetExport> CaringResearchDatasetExports => Set<CaringResearchDatasetExport>();
    public DbSet<VereinFederationConsent> VereinFederationConsents => Set<VereinFederationConsent>();
    public DbSet<VereinMembershipFee> VereinMembershipFees => Set<VereinMembershipFee>();
    public DbSet<VereinMemberDue> VereinMemberDues => Set<VereinMemberDue>();
    public DbSet<VereinDuesPayment> VereinDuesPayments => Set<VereinDuesPayment>();
    public DbSet<VereinEventShare> VereinEventShares => Set<VereinEventShare>();
    public DbSet<VereinCrossInvitation> VereinCrossInvitations => Set<VereinCrossInvitation>();
    public DbSet<RegionalAnalyticsSubscription> RegionalAnalyticsSubscriptions => Set<RegionalAnalyticsSubscription>();
    public DbSet<RegionalAnalyticsReport> RegionalAnalyticsReports => Set<RegionalAnalyticsReport>();
    public DbSet<RegionalAnalyticsAccessLog> RegionalAnalyticsAccessLogs => Set<RegionalAnalyticsAccessLog>();
    public DbSet<RegionalAnalyticsCache> RegionalAnalyticsCaches => Set<RegionalAnalyticsCache>();

    // Phase 37: Advanced Admin
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<ScheduledTask> ScheduledTasks => Set<ScheduledTask>();
    public DbSet<ScheduledJobRun> ScheduledJobRuns => Set<ScheduledJobRun>();
    public DbSet<PlatformAnnouncement> PlatformAnnouncements => Set<PlatformAnnouncement>();

    // WebAuthn/Passkeys
    public DbSet<UserPasskey> UserPasskeys => Set<UserPasskey>();

    // Registration Policy Engine
    public DbSet<TenantRegistrationPolicy> TenantRegistrationPolicies => Set<TenantRegistrationPolicy>();
    public DbSet<TenantInviteCode> TenantInviteCodes => Set<TenantInviteCode>();
    public DbSet<TenantProviderCredential> TenantProviderCredentials => Set<TenantProviderCredential>();
    public DbSet<IdentityVerificationSession> IdentityVerificationSessions => Set<IdentityVerificationSession>();
    public DbSet<IdentityVerificationEvent> IdentityVerificationEvents => Set<IdentityVerificationEvent>();

    // TOTP Backup Codes
    public DbSet<TotpBackupCode> TotpBackupCodes => Set<TotpBackupCode>();

    // File Uploads
    public DbSet<FileUpload> FileUploads => Set<FileUpload>();

    // User Preferences
    public DbSet<UserPreference> UserPreferences => Set<UserPreference>();

    // Jobs Module
    public DbSet<JobVacancy> JobVacancies => Set<JobVacancy>();
    public DbSet<JobApplication> JobApplications => Set<JobApplication>();
    public DbSet<SavedJob> SavedJobs => Set<SavedJob>();

    // Knowledge Base
    public DbSet<KnowledgeArticle> KnowledgeArticles => Set<KnowledgeArticle>();

    // Legal Documents
    public DbSet<LegalDocument> LegalDocuments => Set<LegalDocument>();
    public DbSet<LegalDocumentAcceptance> LegalDocumentAcceptances => Set<LegalDocumentAcceptance>();

    // Polls Module
    public DbSet<Poll> Polls => Set<Poll>();
    public DbSet<PollOption> PollOptions => Set<PollOption>();
    public DbSet<PollVote> PollVotes => Set<PollVote>();

    // Goals Module
    public DbSet<Goal> Goals => Set<Goal>();
    public DbSet<GoalMilestone> GoalMilestones => Set<GoalMilestone>();

    // Member Availability
    public DbSet<MemberAvailability> MemberAvailabilities => Set<MemberAvailability>();
    public DbSet<AvailabilityException> AvailabilityExceptions => Set<AvailabilityException>();

    // Ideation
    public DbSet<Idea> Ideas => Set<Idea>();
    public DbSet<IdeaVote> IdeaVotes => Set<IdeaVote>();
    public DbSet<IdeaComment> IdeaComments => Set<IdeaComment>();

    // Blog/CMS
    public DbSet<BlogPost> BlogPosts => Set<BlogPost>();
    public DbSet<BlogCategory> BlogCategories => Set<BlogCategory>();

    // Pages
    public DbSet<Page> Pages => Set<Page>();
    public DbSet<PageVersion> PageVersions => Set<PageVersion>();

    // Organisations
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<OrganisationMember> OrganisationMembers => Set<OrganisationMember>();

    // Organisation Wallets
    public DbSet<OrgWallet> OrgWallets => Set<OrgWallet>();
    public DbSet<OrgWalletTransaction> OrgWalletTransactions => Set<OrgWalletTransaction>();

    // NexusScore
    public DbSet<NexusScore> NexusScores => Set<NexusScore>();
    public DbSet<NexusScoreHistory> NexusScoreHistories => Set<NexusScoreHistory>();

    // Onboarding
    public DbSet<OnboardingStep> OnboardingSteps => Set<OnboardingStep>();
    public DbSet<OnboardingProgress> OnboardingProgresses => Set<OnboardingProgress>();

    // Tenant Hierarchy
    public DbSet<TenantHierarchy> TenantHierarchies => Set<TenantHierarchy>();

    // Insurance
    public DbSet<InsuranceCertificate> InsuranceCertificates => Set<InsuranceCertificate>();

    // Voice Messages
    public DbSet<VoiceMessage> VoiceMessages => Set<VoiceMessage>();

    // Resources Library
    public DbSet<Resource> Resources => Set<Resource>();
    public DbSet<ResourceCategory> ResourceCategories => Set<ResourceCategory>();

    // Threaded Comments V2
    public DbSet<ThreadedComment> ThreadedComments => Set<ThreadedComment>();
    public DbSet<ContentMention> ContentMentions => Set<ContentMention>();

    // Vetting/DBS Records
    public DbSet<VettingRecord> VettingRecords => Set<VettingRecord>();

    // GDPR Breach & Consent Types
    public DbSet<GdprBreach> GdprBreaches => Set<GdprBreach>();
    public DbSet<GdprConsentType> GdprConsentTypes => Set<GdprConsentType>();

    // Verification Badges
    public DbSet<VerificationBadgeType> VerificationBadgeTypes => Set<VerificationBadgeType>();
    public DbSet<UserVerificationBadge> UserVerificationBadges => Set<UserVerificationBadge>();

    // Member Activity
    public DbSet<MemberActivityLog> MemberActivityLogs => Set<MemberActivityLog>();

    // FAQs
    public DbSet<Faq> Faqs => Set<Faq>();

    // Email Verification
    public DbSet<EmailVerificationToken> EmailVerificationTokens => Set<EmailVerificationToken>();

    // User Sessions
    public DbSet<UserSession> UserSessions => Set<UserSession>();

    // Event Reminders
    public DbSet<EventReminder> EventReminders => Set<EventReminder>();

    // Group Exchanges
    public DbSet<GroupExchange> GroupExchanges => Set<GroupExchange>();
    public DbSet<GroupExchangeParticipant> GroupExchangeParticipants => Set<GroupExchangeParticipant>();

    // Broker Assignments
    public DbSet<BrokerAssignment> BrokerAssignments => Set<BrokerAssignment>();
    public DbSet<BrokerNote> BrokerNotes => Set<BrokerNote>();
    public DbSet<SafeguardingOption> SafeguardingOptions => Set<SafeguardingOption>();
    public DbSet<UserSafeguardingPreference> UserSafeguardingPreferences => Set<UserSafeguardingPreference>();
    public DbSet<TenantSafeguardingSetting> TenantSafeguardingSettings => Set<TenantSafeguardingSetting>();
    public DbSet<MemberVettingAttestation> MemberVettingAttestations => Set<MemberVettingAttestation>();
    public DbSet<MemberVettingAttestationEvent> MemberVettingAttestationEvents => Set<MemberVettingAttestationEvent>();
    public DbSet<SafeguardingVettingReviewRequest> SafeguardingVettingReviewRequests => Set<SafeguardingVettingReviewRequest>();
    public DbSet<SafeguardingPolicyRotationEvent> SafeguardingPolicyRotationEvents => Set<SafeguardingPolicyRotationEvent>();
    public DbSet<SafeguardingAssignment> SafeguardingAssignments => Set<SafeguardingAssignment>();
    public DbSet<SafeguardingMessageReview> SafeguardingMessageReviews => Set<SafeguardingMessageReview>();
    public DbSet<SafeguardingReport> SafeguardingReports => Set<SafeguardingReport>();
    public DbSet<SafeguardingReportAction> SafeguardingReportActions => Set<SafeguardingReportAction>();
    public DbSet<BrokerRiskTag> BrokerRiskTags => Set<BrokerRiskTag>();
    public DbSet<UserMonitoringRestriction> UserMonitoringRestrictions => Set<UserMonitoringRestriction>();

    // Enterprise Config
    public DbSet<EnterpriseConfig> EnterpriseConfigs => Set<EnterpriseConfig>();
    // Collaborative Filtering + Match Learning
    public DbSet<UserInteraction> UserInteractions => Set<UserInteraction>();
    public DbSet<UserSimilarity> UserSimilarities => Set<UserSimilarity>();
    public DbSet<MatchFeedback> MatchFeedbacks => Set<MatchFeedback>();

    // Hashtag Discovery
    public DbSet<Hashtag> Hashtags => Set<Hashtag>();
    public DbSet<HashtagUsage> HashtagUsages => Set<HashtagUsage>();

    // Personal Insights
    public DbSet<PersonalInsight> PersonalInsights => Set<PersonalInsight>();

    // Saved Searches
    public DbSet<SavedSearch> SavedSearches => Set<SavedSearch>();

    // Sub-Accounts / Family Profiles
    public DbSet<SubAccount> SubAccounts => Set<SubAccount>();
    public DbSet<XpShopRedemption> XpShopRedemptions => Set<XpShopRedemption>();

    // Contact Forms
    public DbSet<ContactSubmission> ContactSubmissions => Set<ContactSubmission>();

    // Emergency Alerts
    public DbSet<EmergencyAlert> EmergencyAlerts => Set<EmergencyAlert>();

    // Message Attachments
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();

    // Subscriptions & Plans
    public DbSet<SubscriptionPlan> SubscriptionPlans => Set<SubscriptionPlan>();
    public DbSet<UserSubscription> UserSubscriptions => Set<UserSubscription>();

    // Deliverables
    public DbSet<Deliverable> Deliverables => Set<Deliverable>();
    public DbSet<DeliverableComment> DeliverableComments => Set<DeliverableComment>();

    // Idea Favorites
    public DbSet<IdeaFavorite> IdeaFavorites => Set<IdeaFavorite>();

    // Post Reactions
    public DbSet<PostReaction> PostReactions => Set<PostReaction>();

    // Feed Moderation
    public DbSet<HiddenPost> HiddenPosts => Set<HiddenPost>();
    public DbSet<MutedUser> MutedUsers => Set<MutedUser>();
    public DbSet<FeedReport> FeedReports => Set<FeedReport>();

    // Gamification Challenges (GamificationChallenge + ChallengeProgress)
    public DbSet<GamificationChallenge> GamificationChallenges => Set<GamificationChallenge>();
    public DbSet<ChallengeProgress> ChallengeProgresses => Set<ChallengeProgress>();

    // Daily Reward Log
    public DbSet<DailyRewardLog> DailyRewardLogs => Set<DailyRewardLog>();

    // Badge Collections & Showcase
    public DbSet<BadgeCollection> BadgeCollections => Set<BadgeCollection>();
    public DbSet<BadgeShowcase> BadgeShowcases => Set<BadgeShowcase>();

    // XP Shop
    public DbSet<ShopItem> ShopItems => Set<ShopItem>();
    public DbSet<ShopPurchase> ShopPurchases => Set<ShopPurchase>();

    // Webhook Events
    public DbSet<WebhookEvent> WebhookEvents => Set<WebhookEvent>();

    // Marketplace
    public DbSet<MarketplaceCategory> MarketplaceCategories => Set<MarketplaceCategory>();
    public DbSet<MarketplaceListing> MarketplaceListings => Set<MarketplaceListing>();
    public DbSet<MarketplaceImage> MarketplaceImages => Set<MarketplaceImage>();
    public DbSet<MarketplaceSellerProfile> MarketplaceSellerProfiles => Set<MarketplaceSellerProfile>();
    public DbSet<MarketplaceSavedListing> MarketplaceSavedListings => Set<MarketplaceSavedListing>();
    public DbSet<MarketplaceOffer> MarketplaceOffers => Set<MarketplaceOffer>();
    public DbSet<MarketplaceOrder> MarketplaceOrders => Set<MarketplaceOrder>();
    public DbSet<MarketplacePayment> MarketplacePayments => Set<MarketplacePayment>();
    public DbSet<MarketplacePaymentRefund> MarketplacePaymentRefunds => Set<MarketplacePaymentRefund>();
    public DbSet<MarketplaceEscrow> MarketplaceEscrows => Set<MarketplaceEscrow>();
    public DbSet<MarketplaceOrderNotificationDelivery> MarketplaceOrderNotificationDeliveries => Set<MarketplaceOrderNotificationDelivery>();
    public DbSet<MarketplaceDispute> MarketplaceDisputes => Set<MarketplaceDispute>();
    public DbSet<MarketplaceReport> MarketplaceReports => Set<MarketplaceReport>();
    public DbSet<MarketplaceCategoryTemplate> MarketplaceCategoryTemplates => Set<MarketplaceCategoryTemplate>();
    public DbSet<MarketplaceReportNotification> MarketplaceReportNotifications => Set<MarketplaceReportNotification>();
    public DbSet<DonationDispute> DonationDisputes => Set<DonationDispute>();
    public DbSet<PilotInquiry> PilotInquiries => Set<PilotInquiry>();
    public DbSet<HealthCheckHistory> HealthCheckHistories => Set<HealthCheckHistory>();
    public DbSet<CookieInventoryItem> CookieInventoryItems => Set<CookieInventoryItem>();
    public DbSet<SalaryBenchmark> SalaryBenchmarks => Set<SalaryBenchmark>();
    public DbSet<MemberResidencyVerification> MemberResidencyVerifications => Set<MemberResidencyVerification>();
    public DbSet<MarketplaceSavedSearch> MarketplaceSavedSearches => Set<MarketplaceSavedSearch>();
    public DbSet<MarketplaceCollection> MarketplaceCollections => Set<MarketplaceCollection>();
    public DbSet<MarketplaceCollectionItem> MarketplaceCollectionItems => Set<MarketplaceCollectionItem>();
    public DbSet<MarketplacePromotion> MarketplacePromotions => Set<MarketplacePromotion>();
    public DbSet<MarketplaceShippingOption> MarketplaceShippingOptions => Set<MarketplaceShippingOption>();
    public DbSet<MarketplacePickupSlot> MarketplacePickupSlots => Set<MarketplacePickupSlot>();
    public DbSet<MarketplacePickupReservation> MarketplacePickupReservations => Set<MarketplacePickupReservation>();
    public DbSet<MarketplaceDeliveryOffer> MarketplaceDeliveryOffers => Set<MarketplaceDeliveryOffer>();
    public DbSet<MarketplaceSellerRating> MarketplaceSellerRatings => Set<MarketplaceSellerRating>();
    public DbSet<MerchantCoupon> MerchantCoupons => Set<MerchantCoupon>();
    public DbSet<MerchantCouponRedemption> MerchantCouponRedemptions => Set<MerchantCouponRedemption>();
    public DbSet<MarketplaceSellerLoyaltySetting> MarketplaceSellerLoyaltySettings => Set<MarketplaceSellerLoyaltySetting>();
    public DbSet<CaringLoyaltyRedemption> CaringLoyaltyRedemptions => Set<CaringLoyaltyRedemption>();
    public DbSet<MarketplaceSellerRegionalPointSetting> MarketplaceSellerRegionalPointSettings => Set<MarketplaceSellerRegionalPointSetting>();

    // Provisioning Requests (new-tenant onboarding queue)
    public DbSet<ProvisioningRequest> ProvisioningRequests => Set<ProvisioningRequest>();

    // API Partners (third-party API consumers)
    public DbSet<ApiPartner> ApiPartners => Set<ApiPartner>();
    public DbSet<ApiPartnerAccessToken> ApiPartnerAccessTokens => Set<ApiPartnerAccessToken>();
    public DbSet<ApiPartnerWalletCredit> ApiPartnerWalletCredits => Set<ApiPartnerWalletCredit>();

    // Jobs parity
    public DbSet<JobSavedProfile> JobSavedProfiles => Set<JobSavedProfile>();
    public DbSet<JobTemplate> JobTemplates => Set<JobTemplate>();
    public DbSet<JobVacancyTeamMember> JobVacancyTeamMembers => Set<JobVacancyTeamMember>();
    public DbSet<JobInterview> JobInterviews => Set<JobInterview>();
    public DbSet<JobInterviewSlot> JobInterviewSlots => Set<JobInterviewSlot>();
    public DbSet<JobOffer> JobOffers => Set<JobOffer>();
    public DbSet<JobOfferTemplate> JobOfferTemplates => Set<JobOfferTemplate>();
    public DbSet<JobScorecard> JobScorecards => Set<JobScorecard>();
    public DbSet<JobPipelineRule> JobPipelineRules => Set<JobPipelineRule>();
    public DbSet<JobReferral> JobReferrals => Set<JobReferral>();
    public DbSet<EmployerReview> EmployerReviews => Set<EmployerReview>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        var configurations = new IEntityGroupConfiguration[]
        {
            new TenantConfiguration(_tenantContext),
            new AuthConfiguration(_tenantContext),
            new ListingConfiguration(_tenantContext),
            new WalletConfiguration(_tenantContext),
            new MessagingConfiguration(_tenantContext),
            new SocialConfiguration(_tenantContext),
            new FeedActivityConfiguration(_tenantContext),
            new GroupConfiguration(_tenantContext),
            new EventConfiguration(_tenantContext),
            new GamificationConfiguration(_tenantContext),
            new EngagementRecognitionConfiguration(_tenantContext),
            new NotificationConfiguration(_tenantContext),
            new FederationConfiguration(_tenantContext),
            new GdprConfiguration(_tenantContext),
            new AdminConfiguration(_tenantContext),
            new ReviewConfiguration(_tenantContext),
            new SkillConfiguration(_tenantContext),
            new EmailConfiguration(_tenantContext),
            new AiConfiguration(_tenantContext),
            new JobsConfiguration(_tenantContext),
            new OrganisationConfiguration(_tenantContext),
            new OrgWalletConfiguration(_tenantContext),
            new VolunteerConfiguration(_tenantContext),
            new VolunteerLongTailConfiguration(_tenantContext),
            new VolunteerAdminConfiguration(_tenantContext),
            new FederationProtocolsConfiguration(_tenantContext),
            new Phase72Configuration(_tenantContext),
            new MatchingConfiguration(_tenantContext),
            new LocationConfiguration(_tenantContext),
            new NewsletterConfiguration(_tenantContext),
            new I18nConfiguration(_tenantContext),
            new SystemConfiguration(_tenantContext),
            new FileContentConfiguration(_tenantContext),
            new PollsGoalsConfiguration(_tenantContext),
            new IdeationAvailabilityConfiguration(_tenantContext),
            new CmsConfiguration(_tenantContext),
            new NexusScoreOnboardingConfiguration(_tenantContext),
            new TenantHierarchyInsuranceConfiguration(_tenantContext),
            new ResourcesCommentsConfiguration(_tenantContext),
            new VettingVerificationConfiguration(_tenantContext),
            new SafeguardingAttestationConfiguration(_tenantContext),
            new MemberActivityFaqConfiguration(_tenantContext),
            new BrokerEnterpriseConfiguration(_tenantContext),
            new DiscoveryConfiguration(_tenantContext),
            new ContactEmergencyConfiguration(_tenantContext),
            new CaringCommunityConfiguration(_tenantContext),
            new VereinConfiguration(_tenantContext),
            new MarketplaceSupportConfiguration(_tenantContext),
            new DonationDisputeConfiguration(_tenantContext),
            new PilotInquiryConfiguration(_tenantContext),
            new HealthCheckHistoryConfiguration(_tenantContext),
            new CookieInventoryConfiguration(),
            new SalaryBenchmarkConfiguration(),
            new MemberResidencyVerificationConfiguration(_tenantContext),
            new RegionalAnalyticsConfiguration(_tenantContext),
            new ProvisioningRequestConfiguration(_tenantContext),
            new ApiPartnerConfiguration(_tenantContext),
            new FeedModerationGamificationConfiguration(_tenantContext),
            new WebhookConfiguration(_tenantContext),
            new ScheduledJobRunConfiguration(),
        };

        foreach (var config in configurations)
        {
            config.Configure(modelBuilder);
        }

        ConfigureMarketplace(modelBuilder);
        ConfigureJobsParity(modelBuilder);
        ConfigureGroupsParity(modelBuilder);
        ConfigureStories(modelBuilder);

        // Re-apply tenant query filters referencing DbContext's _tenantContext field
        // so EF Core can parameterize them per-query (fixes broken config class references)
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (typeof(ITenantEntity).IsAssignableFrom(entityType.ClrType))
            {
                var method = typeof(NexusDbContext)
                    .GetMethod(nameof(ApplyTenantQueryFilter), BindingFlags.NonPublic | BindingFlags.Instance)!
                    .MakeGenericMethod(entityType.ClrType);
                method.Invoke(this, new object[] { modelBuilder });
            }
        }
    }

    public override int SaveChanges()
    {
        return SaveChanges(acceptAllChangesOnSuccess: true);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        SetTenantIdOnInsert();
        EnforceImmutableSafeguardingAuditRows();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return SaveChangesAsync(acceptAllChangesOnSuccess: true, cancellationToken);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        SetTenantIdOnInsert();
        EnforceImmutableSafeguardingAuditRows();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void EnforceImmutableSafeguardingAuditRows()
    {
        ChangeTracker.DetectChanges();

        foreach (var entry in ChangeTracker.Entries<MemberVettingAttestation>())
        {
            if (entry.State == EntityState.Deleted
                && !IsTrackedDeletedTenant(entry.Entity.TenantId)
                && !IsTrackedDeletedUser(entry.Entity.UserId))
            {
                throw new InvalidOperationException(
                    "Safeguarding attestations are retained audit evidence and cannot be deleted directly.");
            }
        }

        foreach (var entry in ChangeTracker.Entries<MemberVettingAttestationEvent>())
        {
            var invalidUpdate = entry.State == EntityState.Modified
                && !IsActorSetNullFromDeletedUser(entry, nameof(MemberVettingAttestationEvent.ActorUserId));
            var invalidDelete = entry.State == EntityState.Deleted
                && !IsAttestationEventCascadeDelete(entry.Entity);

            if (invalidUpdate || invalidDelete)
            {
                throw new InvalidOperationException(
                    "Safeguarding attestation events are append-only and cannot be updated or deleted directly.");
            }
        }

        foreach (var entry in ChangeTracker.Entries<SafeguardingPolicyRotationEvent>())
        {
            var invalidUpdate = entry.State == EntityState.Modified
                && !IsActorSetNullFromDeletedUser(entry, nameof(SafeguardingPolicyRotationEvent.ActorUserId));
            var invalidDelete = entry.State == EntityState.Deleted
                && !IsTrackedDeletedTenant(entry.Entity.TenantId);

            if (invalidUpdate || invalidDelete)
            {
                throw new InvalidOperationException(
                    "Safeguarding policy rotation events are append-only and cannot be updated or deleted directly.");
            }
        }
    }

    private bool IsAttestationEventCascadeDelete(MemberVettingAttestationEvent auditEvent)
    {
        return ChangeTracker.Entries<MemberVettingAttestation>().Any(entry =>
                   entry.State == EntityState.Deleted && entry.Entity.Id == auditEvent.AttestationId)
               || IsTrackedDeletedTenant(auditEvent.TenantId)
               || IsTrackedDeletedUser(auditEvent.UserId);
    }

    private bool IsTrackedDeletedTenant(int tenantId)
    {
        return ChangeTracker.Entries<Tenant>().Any(entry =>
            entry.State == EntityState.Deleted && entry.Entity.Id == tenantId);
    }

    private bool IsTrackedDeletedUser(int userId)
    {
        return ChangeTracker.Entries<User>().Any(entry =>
            entry.State == EntityState.Deleted && entry.Entity.Id == userId);
    }

    private bool IsActorSetNullFromDeletedUser<TEntity>(
        EntityEntry<TEntity> entry,
        string actorPropertyName)
        where TEntity : class
    {
        var modifiedProperties = entry.Properties
            .Where(property => property.IsModified)
            .ToArray();
        if (modifiedProperties.Length != 1
            || modifiedProperties[0].Metadata.Name != actorPropertyName)
        {
            return false;
        }

        var actorProperty = entry.Property<int?>(actorPropertyName);
        return actorProperty.CurrentValue is null
            && actorProperty.OriginalValue is int deletedActorId
            && IsTrackedDeletedUser(deletedActorId);
    }

    private void ApplyTenantQueryFilter<T>(ModelBuilder modelBuilder) where T : class, ITenantEntity
    {
        if (typeof(T) == typeof(Listing))
        {
            modelBuilder.Entity<Listing>().HasQueryFilter(e =>
                (!IsTenantResolved || e.TenantId == CurrentTenantId)
                && e.DeletedAt == null);
        }
        else
        {
            modelBuilder.Entity<T>().HasQueryFilter(e =>
                !IsTenantResolved || e.TenantId == CurrentTenantId);
        }
    }

    private static void ConfigureMarketplace(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MarketplaceCategory>(entity =>
        {
            entity.ToTable("marketplace_categories");
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
        });
        modelBuilder.Entity<MarketplaceListing>(entity =>
        {
            entity.ToTable("marketplace_listings");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.ModerationStatus });
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceEnforcementReportId });
        });
        modelBuilder.Entity<MarketplaceImage>().ToTable("marketplace_images");
        modelBuilder.Entity<MarketplaceSellerProfile>(entity =>
        {
            entity.ToTable("marketplace_seller_profiles");
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();
            entity.Property(e => e.StripeAccountId).HasMaxLength(100);
            entity.HasIndex(e => e.StripeAccountId).IsUnique().HasFilter("\"StripeAccountId\" IS NOT NULL");
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceSuspensionReportId });
        });
        modelBuilder.Entity<MarketplaceSavedListing>(entity =>
        {
            entity.ToTable("marketplace_saved_listings");
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.MarketplaceListingId }).IsUnique();
        });
        modelBuilder.Entity<MarketplaceOffer>().ToTable("marketplace_offers");
        modelBuilder.Entity<MarketplaceOrder>(entity =>
        {
            entity.ToTable("marketplace_orders");
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.OrderNumber).HasMaxLength(100);
            entity.Property(e => e.CancellationReason).HasMaxLength(500);
            entity.HasIndex(e => new { e.TenantId, e.OrderNumber })
                .IsUnique()
                .HasDatabaseName("uk_marketplace_order_number");
            entity.HasIndex(e => new { e.TenantId, e.WalletRefundTransactionId }).IsUnique().HasFilter("\"WalletRefundTransactionId\" IS NOT NULL");
            entity.Property(e => e.PaymentIntentId).HasMaxLength(255);
            entity.Property(e => e.StripeCheckoutMode).HasMaxLength(32);
            entity.HasCheckConstraint("chk_marketplace_order_checkout_mode", "\"StripeCheckoutMode\" IS NULL OR \"StripeCheckoutMode\" IN ('payment_intent','checkout_session')");
            entity.HasIndex(e => new { e.TenantId, e.PaymentIntentId }).IsUnique().HasFilter("\"PaymentIntentId\" IS NOT NULL");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.PaymentExpiresAt });
            entity.HasIndex(e => new { e.TenantId, e.Status, e.AutoCompleteAt });
        });
        modelBuilder.Entity<MarketplacePayment>(entity =>
        {
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.ToTable("marketplace_payments", table =>
            {
                table.HasCheckConstraint("chk_marketplace_payment_status", "\"Status\" IN ('pending','succeeded','failed','refunded','partially_refunded')");
                table.HasCheckConstraint("chk_marketplace_payment_payout_status", "\"PayoutStatus\" IN ('pending','scheduled','paid','failed')");
                table.HasCheckConstraint("chk_marketplace_payment_funds_flow", "\"FundsFlow\" IN ('destination_charge','separate_charge_transfer')");
                table.HasCheckConstraint("chk_marketplace_payment_amounts", "\"Amount\" > 0 AND \"PlatformFee\" >= 0 AND \"SellerPayout\" >= 0 AND COALESCE(\"RefundAmount\", 0) >= 0 AND \"PlatformFee\" + \"SellerPayout\" + COALESCE(\"RefundAmount\", 0) = \"Amount\"");
            });
            entity.Property(e => e.StripePaymentIntentId).HasMaxLength(255);
            entity.Property(e => e.StripeChargeId).HasMaxLength(255);
            entity.Property(e => e.FundsFlow).HasMaxLength(32);
            entity.Property(e => e.Amount).HasPrecision(18, 2);
            entity.Property(e => e.Currency).HasMaxLength(3);
            entity.Property(e => e.PlatformFee).HasPrecision(18, 2);
            entity.Property(e => e.SellerPayout).HasPrecision(18, 2);
            entity.Property(e => e.PaymentMethod).HasMaxLength(50);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.RefundAmount).HasPrecision(18, 2);
            entity.Property(e => e.PayoutStatus).HasMaxLength(32);
            entity.Property(e => e.PayoutId).HasMaxLength(255);
            entity.Property(e => e.StripeDisputeId).HasMaxLength(255);
            entity.Property(e => e.StripeDisputeStatus).HasMaxLength(32);
            entity.Property(e => e.DisputePreviousOrderStatus).HasMaxLength(32);
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceOrderId });
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => e.StripePaymentIntentId).IsUnique();
            entity.HasOne<MarketplaceOrder>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MarketplaceOrderId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<MarketplacePaymentRefund>(entity =>
        {
            entity.ToTable("marketplace_payment_refunds", table =>
            {
                table.HasCheckConstraint("chk_marketplace_payment_refund_amounts",
                    "\"Amount\" > 0 AND \"PlatformFeeReversal\" >= 0 AND \"SellerPayoutReversal\" >= 0 AND \"PlatformFeeReversal\" + \"SellerPayoutReversal\" <= \"Amount\"");
            });
            entity.Property(e => e.StripeRefundId).HasMaxLength(255);
            entity.Property(e => e.Amount).HasPrecision(18, 2);
            entity.Property(e => e.PlatformFeeReversal).HasPrecision(18, 2);
            entity.Property(e => e.SellerPayoutReversal).HasPrecision(18, 2);
            entity.Property(e => e.Reason).HasMaxLength(500);
            entity.HasIndex(e => e.StripeRefundId).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.MarketplacePaymentId });
            entity.HasOne<MarketplacePayment>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MarketplacePaymentId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<MarketplaceEscrow>(entity =>
        {
            entity.ToTable("marketplace_escrow", table =>
            {
                table.HasCheckConstraint("chk_marketplace_escrow_status", "\"Status\" IN ('held','released','refunded','disputed')");
                table.HasCheckConstraint("chk_marketplace_escrow_amount", "\"Amount\" >= 0");
                table.HasCheckConstraint("chk_marketplace_escrow_release_trigger", "\"ReleaseTrigger\" IS NULL OR \"ReleaseTrigger\" IN ('buyer_confirmed','auto_timeout','admin_override','dispute_resolved')");
            });
            entity.Property(e => e.Amount).HasPrecision(18, 2);
            entity.Property(e => e.Currency).HasMaxLength(3);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.ReleaseTrigger).HasMaxLength(32);
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceOrderId })
                .IsUnique()
                .HasDatabaseName("uk_marketplace_escrow_order");
            entity.HasIndex(e => new { e.TenantId, e.MarketplacePaymentId })
                .IsUnique()
                .HasDatabaseName("uk_marketplace_escrow_payment");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.ReleaseAfter })
                .HasDatabaseName("idx_marketplace_escrow_release");
            entity.HasOne<MarketplaceOrder>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MarketplaceOrderId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<MarketplacePayment>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MarketplacePaymentId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<MarketplaceOrderNotificationDelivery>(entity =>
        {
            entity.ToTable("marketplace_order_notification_deliveries", table =>
            {
                table.HasCheckConstraint("chk_marketplace_order_notification_delivery_channel", "\"Channel\" IN ('email','bell')");
                table.HasCheckConstraint("chk_marketplace_order_notification_delivery_status", "\"Status\" IN ('claimed','delivered','failed','skipped')");
                table.HasCheckConstraint("chk_marketplace_order_notification_delivery_attempts", "\"Attempts\" > 0");
            });
            entity.Property(e => e.Event).HasMaxLength(50);
            entity.Property(e => e.Channel).HasMaxLength(20);
            entity.Property(e => e.Status).HasMaxLength(20);
            entity.Property(e => e.EvidenceId).HasMaxLength(255);
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceOrderId, e.Event, e.UserId, e.Channel })
                .IsUnique()
                .HasDatabaseName("uk_marketplace_order_delivery");
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceOrderId, e.Event })
                .HasDatabaseName("idx_marketplace_order_delivery_event");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.ClaimedAt })
                .HasDatabaseName("idx_marketplace_order_delivery_status");
            entity.HasOne<MarketplaceOrder>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MarketplaceOrderId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<MarketplaceDispute>(entity =>
        {
            entity.ToTable("marketplace_disputes", table =>
            {
                table.HasCheckConstraint("chk_marketplace_dispute_reason", "\"Reason\" IN ('not_received','not_as_described','damaged','wrong_item','other')");
                table.HasCheckConstraint("chk_marketplace_dispute_status", "\"Status\" IN ('open','under_review','resolved_buyer','resolved_seller','escalated','closed')");
                table.HasCheckConstraint("chk_marketplace_dispute_refund", "\"RefundAmount\" IS NULL OR \"RefundAmount\" >= 0");
            });
            entity.Property(e => e.Reason).HasMaxLength(32);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.PriorOrderStatus).HasMaxLength(32);
            entity.Property(e => e.EvidenceUrlsJson).HasColumnType("jsonb");
            entity.Property(e => e.RefundAmount).HasPrecision(18, 2);
            entity.HasIndex(e => new { e.TenantId, e.Status, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceOrderId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.OpenedByUserId, e.CreatedAt });
        });
        modelBuilder.Entity<MarketplaceReport>(entity =>
        {
            entity.ToTable("marketplace_reports", table =>
            {
                table.HasCheckConstraint("chk_marketplace_report_reason", "\"Reason\" IN ('counterfeit','illegal','unsafe','misleading','discrimination','ip_violation','other')");
                table.HasCheckConstraint("chk_marketplace_report_status", "\"Status\" IN ('received','acknowledged','under_review','action_taken','no_action','appealed','appeal_resolved')");
                table.HasCheckConstraint("chk_marketplace_report_action", "\"ActionTaken\" IS NULL OR \"ActionTaken\" IN ('none','warning','listing_removed','seller_suspended')");
            });
            entity.Property(e => e.Reason).HasMaxLength(32);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.ActionTaken).HasMaxLength(32);
            entity.Property(e => e.EvidenceUrlsJson).HasColumnType("jsonb");
            entity.Property(e => e.EnforcementSnapshotJson).HasColumnType("jsonb");
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.HasIndex(e => new { e.TenantId, e.Status, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.ReporterUserId, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.AppealedByUserId });
        });
        modelBuilder.Entity<MarketplaceSavedSearch>().ToTable("marketplace_saved_searches");
        modelBuilder.Entity<MarketplaceCollection>().ToTable("marketplace_collections");
        modelBuilder.Entity<MarketplaceCollectionItem>(entity =>
        {
            entity.ToTable("marketplace_collection_items");
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceCollectionId, e.MarketplaceListingId }).IsUnique();
        });
        modelBuilder.Entity<MarketplacePromotion>().ToTable("marketplace_promotions");
        modelBuilder.Entity<MarketplaceShippingOption>().ToTable("marketplace_shipping_options");
        modelBuilder.Entity<MarketplacePickupSlot>().ToTable("marketplace_pickup_slots");
        modelBuilder.Entity<MarketplacePickupReservation>().ToTable("marketplace_pickup_reservations");
        modelBuilder.Entity<MarketplaceDeliveryOffer>().ToTable("marketplace_delivery_offers");
        modelBuilder.Entity<MarketplaceSellerRating>().ToTable("marketplace_seller_ratings");
        modelBuilder.Entity<MerchantCoupon>(entity =>
        {
            entity.ToTable("merchant_coupons");
            entity.HasIndex(e => new { e.TenantId, e.Code }).IsUnique();
        });
        modelBuilder.Entity<MerchantCouponRedemption>().ToTable("merchant_coupon_redemptions");
        modelBuilder.Entity<MarketplaceSellerLoyaltySetting>(entity =>
        {
            entity.ToTable("marketplace_seller_loyalty_settings");
            entity.HasIndex(e => new { e.TenantId, e.SellerUserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.AcceptsTimeCredits });
        });
        modelBuilder.Entity<CaringLoyaltyRedemption>(entity =>
        {
            entity.ToTable("caring_loyalty_redemptions");
            entity.HasIndex(e => new { e.TenantId, e.MemberUserId });
            entity.HasIndex(e => new { e.TenantId, e.MerchantUserId });
            entity.HasIndex(e => new { e.TenantId, e.RedeemedAt });
            entity.HasIndex(e => new { e.TenantId, e.MarketplaceListingId });
            entity.HasIndex(e => new { e.TenantId, e.RedemptionTransactionId })
                .IsUnique()
                .HasFilter("\"RedemptionTransactionId\" IS NOT NULL");
            entity.HasIndex(e => new { e.TenantId, e.ReversalTransactionId })
                .IsUnique()
                .HasFilter("\"ReversalTransactionId\" IS NOT NULL");
            entity.HasOne(e => e.RedemptionTransaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.RedemptionTransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ReversalTransaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.ReversalTransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureJobsParity(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<JobSavedProfile>(entity =>
        {
            entity.ToTable("job_saved_profiles");
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();
        });
        modelBuilder.Entity<JobTemplate>().ToTable("job_templates");
        modelBuilder.Entity<JobVacancyTeamMember>(entity =>
        {
            entity.ToTable("job_vacancy_team_members");
            entity.HasIndex(e => new { e.TenantId, e.JobId, e.UserId }).IsUnique();
        });
        modelBuilder.Entity<JobInterview>().ToTable("job_interviews");
        modelBuilder.Entity<JobInterviewSlot>().ToTable("job_interview_slots");
        modelBuilder.Entity<JobOffer>().ToTable("job_offers");
        modelBuilder.Entity<JobOfferTemplate>().ToTable("job_offer_templates");
        modelBuilder.Entity<JobScorecard>(entity =>
        {
            entity.ToTable("job_scorecards");
            entity.HasIndex(e => new { e.TenantId, e.ApplicationId, e.ReviewerUserId }).IsUnique();
        });
        modelBuilder.Entity<JobPipelineRule>().ToTable("job_pipeline_rules");
        modelBuilder.Entity<JobReferral>(entity =>
        {
            entity.ToTable("job_referrals");
            entity.HasIndex(e => new { e.TenantId, e.JobId, e.ReferrerUserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Code }).IsUnique();
        });
        modelBuilder.Entity<EmployerReview>().ToTable("employer_reviews");
    }

    private static void ConfigureGroupsParity(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<GroupInvite>(entity =>
        {
            entity.ToTable("group_invites");
            entity.Property(e => e.InviteType).HasMaxLength(20);
            entity.Property(e => e.Status).HasMaxLength(20);
            entity.HasIndex(e => new { e.TenantId, e.Token }).IsUnique();
        });
        modelBuilder.Entity<GroupDataExport>(entity =>
        {
            entity.ToTable("group_data_exports");
            entity.Property(e => e.Status).HasMaxLength(20);
            entity.Property(e => e.StoragePath).HasMaxLength(500);
            entity.Property(e => e.ErrorCode).HasMaxLength(100);
            entity.HasIndex(e => new { e.TenantId, e.GroupId, e.RequestedByUserId, e.CreatedAt })
                .HasDatabaseName("idx_group_exports_requester");
            entity.HasIndex(e => new { e.Status, e.ExpiresAt })
                .HasDatabaseName("idx_group_exports_expiry");
        });
        modelBuilder.Entity<GroupMediaItem>().ToTable("group_media_items");
        modelBuilder.Entity<GroupWikiPage>(entity => { entity.ToTable("group_wiki_pages"); entity.HasIndex(e => new { e.TenantId, e.GroupId, e.Slug }).IsUnique(); });
        modelBuilder.Entity<GroupWikiRevision>().ToTable("group_wiki_revisions");
        modelBuilder.Entity<GroupQuestion>(entity =>
        {
            entity.ToTable("group_questions");
            entity.Property(row => row.Title).HasMaxLength(500);
            entity.HasIndex(row => new { row.GroupId, row.TenantId });
            entity.HasIndex(row => new { row.GroupId, row.VoteCount });
        });
        modelBuilder.Entity<GroupAnswer>(entity =>
        {
            entity.ToTable("group_answers");
            entity.HasIndex(row => row.QuestionId);
            entity.HasIndex(row => new { row.QuestionId, row.VoteCount });
        });
        modelBuilder.Entity<GroupQaVote>(entity => { entity.ToTable("group_qa_votes"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.TargetType, e.TargetId }).IsUnique(); });
        modelBuilder.Entity<GroupType>(entity =>
        {
            entity.ToTable("group_types");
            entity.Property(row => row.Name).HasMaxLength(100);
            entity.Property(row => row.Slug).HasMaxLength(100);
            entity.Property(row => row.Icon).HasMaxLength(100);
            entity.Property(row => row.Color).HasMaxLength(20);
            entity.Property(row => row.ImageUrl).HasMaxLength(500);
            entity.HasIndex(row => new { row.TenantId, row.Slug }).IsUnique();
            entity.HasIndex(row => new { row.TenantId, row.IsActive, row.SortOrder });
        });
        modelBuilder.Entity<GroupTemplate>(entity =>
        {
            entity.ToTable("group_templates");
            entity.Property(row => row.Name).HasMaxLength(255);
            entity.Property(row => row.Icon).HasMaxLength(50);
            entity.Property(row => row.DefaultVisibility).HasMaxLength(20);
            entity.Property(row => row.DefaultTagsJson).HasColumnType("jsonb");
            entity.Property(row => row.FeaturesJson).HasColumnType("jsonb");
            entity.HasIndex(row => new { row.TenantId, row.IsActive, row.SortOrder });
        });
        modelBuilder.Entity<GroupChallenge>().ToTable("group_challenges");
        modelBuilder.Entity<GroupScheduledPost>().ToTable("group_scheduled_posts");
        modelBuilder.Entity<GroupWebhook>().ToTable("group_webhooks");
        modelBuilder.Entity<GroupNotificationPreference>(entity => { entity.ToTable("group_notification_preferences"); entity.HasIndex(e => new { e.TenantId, e.GroupId, e.UserId }).IsUnique(); });
        modelBuilder.Entity<GroupCustomField>(entity => { entity.ToTable("group_custom_fields"); entity.HasIndex(e => new { e.TenantId, e.GroupId, e.Key }).IsUnique(); });
        modelBuilder.Entity<GroupWelcomeSettings>(entity => { entity.ToTable("group_welcome_settings"); entity.HasIndex(e => new { e.TenantId, e.GroupId }).IsUnique(); });
        modelBuilder.Entity<GroupChatroomPin>().ToTable("group_chatroom_pins");
        modelBuilder.Entity<GroupRecommendationEvent>().ToTable("group_recommendation_events");
    }

    private static void ConfigureStories(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Story>(entity => { entity.ToTable("stories"); entity.HasIndex(e => new { e.TenantId, e.UserId }); });
        modelBuilder.Entity<StoryView>(entity => { entity.ToTable("story_views"); entity.HasIndex(e => new { e.TenantId, e.StoryId, e.UserId }).IsUnique(); });
        modelBuilder.Entity<StoryReaction>(entity => { entity.ToTable("story_reactions"); entity.HasIndex(e => new { e.TenantId, e.StoryId, e.UserId, e.Reaction }); });
        modelBuilder.Entity<StoryCloseFriend>(entity => { entity.ToTable("story_close_friends"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.FriendUserId }).IsUnique(); });
        modelBuilder.Entity<StoryHighlight>(entity => { entity.ToTable("story_highlights"); entity.HasIndex(e => new { e.TenantId, e.UserId }); });
        modelBuilder.Entity<StoryHighlightItem>(entity => { entity.ToTable("story_highlight_items"); entity.HasIndex(e => new { e.TenantId, e.HighlightId, e.StoryId }).IsUnique(); });
    }

    /// <summary>
    /// Automatically sets TenantId on new tenant-scoped entities.
    /// </summary>
    private void SetTenantIdOnInsert()
    {
        foreach (var entry in ChangeTracker.Entries<MarketplaceOrder>())
        {
            if (entry.State == EntityState.Added && string.IsNullOrWhiteSpace(entry.Entity.OrderNumber))
            {
                entry.Entity.OrderNumber = MarketplaceOrder.GenerateOrderNumber();
            }
        }

        if (!_tenantContext.IsResolved) return;

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        foreach (var entry in ChangeTracker.Entries<ITenantEntity>())
        {
            if (entry.State == EntityState.Added && entry.Entity.TenantId == 0)
            {
                entry.Entity.TenantId = tenantId;
            }
        }
    }
}
