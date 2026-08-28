<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Providers;

use App\Events\CommunityEventCreated;
use App\Events\CommunityEventUpdated;
use App\Events\ConnectionAccepted;
use App\Events\ConnectionRequested;
use App\Events\FederatedCommunityEventReceived;
use App\Events\FederatedConnectionReceived;
use App\Events\FederatedGroupReceived;
use App\Events\FederatedListingReceived;
use App\Events\FederatedMemberUpdated;
use App\Events\FederatedReviewReceived;
use App\Events\FederatedVolunteeringReceived;
use App\Events\GdprActionOccurred;
use App\Events\GroupChatroomMessagePosted;
use App\Events\GroupCreated;
use App\Events\GroupDeleted;
use App\Events\GroupMemberJoined;
use App\Events\GroupMemberLeft;
use App\Events\GroupUpdated;
use App\Events\JobVacancyCreated;
use App\Events\ListingCreated;
use App\Events\ListingUpdated;
use App\Events\MemberProfileUpdated;
use App\Events\MessageSent;
use App\Events\OnboardingCompleted;
use App\Events\ReviewCreated;
use App\Events\SafeguardingContactAttemptBlocked;
use App\Events\SafeguardingCoordinationRequested;
use App\Events\SafeguardingFlaggedEvent;
use App\Events\TransactionCompleted;
use App\Events\UserFederatedOptOut;
use App\Events\UserRegistered;
use App\Events\VolLogStatusChanged;
use App\Events\VolunteerOpportunityCreated;
use App\Events\VolunteerOpportunityUpdated;
use App\Events\VolunteerOrganisationRegistered;
use App\Events\VolunteerOrganisationStatusChanged;
use App\Listeners\AwardXpOnVolLogApproved;
use App\Listeners\CopyMessageForBrokerReview;
use App\Listeners\HandleFederatedCommunityEventReceived;
use App\Listeners\HandleFederatedConnectionReceived;
use App\Listeners\HandleFederatedGroupReceived;
use App\Listeners\HandleFederatedListingReceived;
use App\Listeners\HandleFederatedMemberUpdated;
use App\Listeners\HandleFederatedReviewReceived;
use App\Listeners\IngestFederatedVolunteerOpportunity;
use App\Listeners\NotifyAdminOfNewCommunityEvent;
use App\Listeners\NotifyGroupChatroomMessage;
use App\Listeners\PostFeedActivityOnVolLogApproved;
use App\Listeners\NotifyGroupMemberJoined;
use App\Listeners\NotifyAdminOfNewGroup;
use App\Listeners\PushGroupRetractionToFederatedPartners;
use App\Listeners\NotifyAdminOfNewListing;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Listeners\NotifyAdminOfNewVolunteerOpportunity;
use App\Listeners\NotifyAdminOfNewVolunteerOrganisation;
use App\Listeners\NotifyOwnerOfVolunteerOrganisationDecision;
use App\Listeners\NotifyAdminOfGdprAction;
use App\Listeners\NotifyConnectionAccepted;
use App\Listeners\NotifyConnectionRequest;
use App\Listeners\NotifyJobAlertSubscribers;
use App\Listeners\NotifyMessageReceived;
use App\Listeners\NotifySafeguardingContactAttemptBlocked;
use App\Listeners\NotifySafeguardingCoordinationRequested;
use App\Listeners\NotifySafeguardingStaff;
use App\Listeners\NotifyTransactionCompleted;
use App\Listeners\PushConnectionAcceptedToFederatedPartner;
use App\Listeners\PushGroupMembershipToFederatedPartners;
use App\Listeners\PushGroupToFederatedPartners;
use App\Listeners\PushListingToFederatedPartners;
use App\Listeners\PushFederationDataRetraction;
use App\Listeners\PushMemberProfileUpdateToFederatedPartners;
use App\Listeners\PushMessageToFederatedPartner;
use App\Listeners\PushReviewToFederatedPartner;
use App\Listeners\PushTransactionToFederatedPartner;
use App\Listeners\PushVolunteerOpportunityToFederatedPartners;
use App\Listeners\RevertRegionalPointsOnVolLogChange;
use App\Listeners\SendOnboardingCompletionEmail;
use App\Listeners\SendWelcomeNotification;
use App\Listeners\UpdateFeedOnListingCreated;
use App\Listeners\UpdateWalletBalance;
use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;

/**
 * EventServiceProvider
 *
 * Maps domain events to their listeners.  During the Laravel migration each
 * listener delegates to the corresponding legacy service; once the services
 * are fully ported the legacy references can be removed.
 */
class EventServiceProvider extends ServiceProvider
{
    /**
     * The event-to-listener mappings for the application.
     *
     * @var array<class-string, array<int, class-string>>
     */
    protected $listen = [
        UserRegistered::class => [
            SendWelcomeNotification::class,
            NotifyAdminOfNewRegistration::class,
        ],

        ListingCreated::class => [
            UpdateFeedOnListingCreated::class,
            PushListingToFederatedPartners::class,
            NotifyAdminOfNewListing::class,
        ],

        ListingUpdated::class => [
            PushListingToFederatedPartners::class,
        ],

        TransactionCompleted::class => [
            UpdateWalletBalance::class,
            NotifyTransactionCompleted::class,
            PushTransactionToFederatedPartner::class,
        ],

        ConnectionRequested::class => [
            NotifyConnectionRequest::class,
        ],

        ConnectionAccepted::class => [
            PushConnectionAcceptedToFederatedPartner::class,
            NotifyConnectionAccepted::class,
        ],

        MessageSent::class => [
            NotifyMessageReceived::class,
            CopyMessageForBrokerReview::class,
            PushMessageToFederatedPartner::class,
        ],

        JobVacancyCreated::class => [
            NotifyJobAlertSubscribers::class,
        ],

        OnboardingCompleted::class => [
            SendOnboardingCompletionEmail::class,
        ],

        SafeguardingFlaggedEvent::class => [
            NotifySafeguardingStaff::class,
        ],

        // Member-initiated GDPR data-rights actions → alert tenant admins
        // (bell + push + email) the moment they happen, instead of a silent
        // pending row that only the overdue-request cron eventually surfaces.
        GdprActionOccurred::class => [
            NotifyAdminOfGdprAction::class,
        ],

        SafeguardingContactAttemptBlocked::class => [
            NotifySafeguardingContactAttemptBlocked::class,
        ],

        SafeguardingCoordinationRequested::class => [
            NotifySafeguardingCoordinationRequested::class,
        ],

        ReviewCreated::class => [
            PushReviewToFederatedPartner::class,
        ],

        CommunityEventCreated::class => [
            NotifyAdminOfNewCommunityEvent::class,
        ],

        FederatedGroupReceived::class => [
            HandleFederatedGroupReceived::class,
        ],

        GroupCreated::class => [
            PushGroupToFederatedPartners::class,
            NotifyAdminOfNewGroup::class,
        ],

        GroupUpdated::class => [
            PushGroupToFederatedPartners::class,
        ],

        GroupDeleted::class => [
            PushGroupRetractionToFederatedPartners::class,
        ],

        GroupMemberJoined::class => [
            PushGroupMembershipToFederatedPartners::class,
            NotifyGroupMemberJoined::class,
        ],

        GroupMemberLeft::class => [
            PushGroupRetractionToFederatedPartners::class,
        ],

        VolunteerOpportunityCreated::class => [
            PushVolunteerOpportunityToFederatedPartners::class,
            NotifyAdminOfNewVolunteerOpportunity::class,
        ],

        VolunteerOpportunityUpdated::class => [
            PushVolunteerOpportunityToFederatedPartners::class,
        ],

        // Registering a volunteering organisation notified nobody until
        // 2026-08-28 -- not the admins who must approve it, and not the member
        // waiting for that decision. Both halves of the workflow live here.
        VolunteerOrganisationRegistered::class => [
            NotifyAdminOfNewVolunteerOrganisation::class,
        ],

        VolunteerOrganisationStatusChanged::class => [
            NotifyOwnerOfVolunteerOrganisationDecision::class,
        ],

        MemberProfileUpdated::class => [
            PushMemberProfileUpdateToFederatedPartners::class,
        ],

        UserFederatedOptOut::class => [
            PushFederationDataRetraction::class,
        ],

        VolLogStatusChanged::class => [
            RevertRegionalPointsOnVolLogChange::class,
            AwardXpOnVolLogApproved::class,
            PostFeedActivityOnVolLogApproved::class,
        ],

        FederatedVolunteeringReceived::class => [
            IngestFederatedVolunteerOpportunity::class,
        ],

        // Inbound federation: partner platforms pushing data to us.
        // Controller persists into shadow tables; listeners do post-persist
        // side-effects (user notifications for member-facing events, audit
        // logging for bulk content).
        FederatedReviewReceived::class => [
            HandleFederatedReviewReceived::class,
        ],

        FederatedConnectionReceived::class => [
            HandleFederatedConnectionReceived::class,
        ],

        FederatedListingReceived::class => [
            HandleFederatedListingReceived::class,
        ],

        FederatedCommunityEventReceived::class => [
            HandleFederatedCommunityEventReceived::class,
        ],

        FederatedMemberUpdated::class => [
            HandleFederatedMemberUpdated::class,
        ],

        // Group chatroom messages: in-app bell notification for members who
        // weren't online to see the Pusher broadcast. NO email — chat
        // volume is too high; daily-digest opt-in handles that for users
        // who want it.
        GroupChatroomMessagePosted::class => [
            NotifyGroupChatroomMessage::class,
        ],
    ];

    /**
     * Determine if events and listeners should be automatically discovered.
     */
    public function shouldDiscoverEvents(): bool
    {
        return false;
    }
}
