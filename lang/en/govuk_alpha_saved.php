<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    // ---- My collections grid + create ----
    'collections' => [
        'title' => 'My collections',
        'caption' => 'Your saved collections at :community',
        'description' => 'Group the listings, posts, events and other items you have saved into collections.',
        'back_to_saved' => 'Back to saved items',
        'count' => '{0} No items|{1} 1 item|[2,*] :count items',
        'public_tag' => 'Public',
        'private_tag' => 'Private',
        'view' => 'View collection',
        'empty_title' => 'You have no collections yet',
        'empty_body' => 'Create a collection to start grouping the items you save.',
    ],
    'create' => [
        'heading' => 'Create a collection',
        'name_label' => 'Collection name',
        'name_hint' => 'For example, "Skills I want to learn" or "Events to attend".',
        'description_label' => 'Description (optional)',
        'public_label' => 'Make this collection public',
        'public_hint' => 'Public collections can be seen by other members on your profile.',
        'submit' => 'Create collection',
    ],

    // ---- Collection detail ----
    'detail' => [
        'title' => 'Collection',
        'caption' => 'Saved items at :community',
        'count' => '{0} No items|{1} 1 item|[2,*] :count items',
        'public_tag' => 'Public',
        'private_tag' => 'Private',
        'saved_on' => 'Saved on :date',
        'open_item' => 'Open item',
        'remove_item' => 'Remove',
        'remove_item_label' => 'Remove :title from this collection',
        'empty_title' => 'No items in this collection',
        'empty_body' => 'When you save items to this collection, they will appear here.',
        'item_type_label' => 'Type',
    ],
    'edit' => [
        'heading' => 'Edit this collection',
        'name_label' => 'Collection name',
        'description_label' => 'Description (optional)',
        'public_label' => 'Make this collection public',
        'submit' => 'Save changes',
        'delete_heading' => 'Delete this collection',
        'delete_warning' => 'Deleting a collection cannot be undone. The saved items it contains will also be removed.',
        'delete_submit' => 'Delete collection',
        'delete_confirm_label' => 'Delete the collection :name',
    ],

    // ---- Public collections (another member) ----
    'public' => [
        'title' => 'Public collections',
        'caption' => 'Collections shared by :name',
        'heading' => 'Public collections of :name',
        'description' => 'Collections this member has chosen to share publicly.',
        'back_to_profile' => 'Back to profile',
        'empty_title' => 'No public collections',
        'empty_body' => 'This member has not shared any collections publicly.',
    ],

    // ---- Item type labels (shared across views) ----
    'types' => [
        'post' => 'Post',
        'listing' => 'Listing',
        'event' => 'Event',
        'group' => 'Group',
        'article' => 'Article',
        'marketplace_listing' => 'Marketplace listing',
        'job' => 'Opportunity',
        'resource' => 'Resource',
    ],

    // ---- Appreciation wall ----
    'wall' => [
        'title' => 'Appreciation wall',
        'caption' => 'Thank-you notes received by :name',
        'heading' => 'Appreciation for :name',
        'description' => 'Public thank-you notes other members have sent to this person.',
        'back_to_profile' => 'Back to profile',
        'received_on' => ':date',
        'from' => 'From :name',
        'from_someone' => 'A member',
        'reactions_count' => '{0} No reactions|{1} 1 reaction|[2,*] :count reactions',
        'empty_title' => 'No appreciation yet',
        'empty_body' => 'When members thank this person, the public notes will appear here.',
        'own_description' => 'Thank-you notes other members have sent you. Only you can see a note until you choose to show it on your profile.',
        'own_empty_body' => 'When members thank you, their notes will appear here. Only you will see them until you choose to show them on your profile.',
        'visibility_private' => 'Only you can see this',
        'visibility_public' => 'Shown on your profile',
    ],
    'react' => [
        'legend' => 'React to this note',
        'heart' => 'Heart',
        'clap' => 'Clap',
        'star' => 'Star',
        'react_label' => 'React with :reaction',
        'remove_label' => 'Remove your :reaction reaction',
        'your_reaction' => 'Your reaction: :reaction',
    ],
    // The receiver's own controls: show a note on their profile, hide it again, or remove it.
    'manage' => [
        'show' => 'Show on my profile',
        'hide' => 'Hide from my profile',
        'remove' => 'Remove',
        'for_note' => '(note from :name)',
        'remove_heading' => 'Remove this thank-you note?',
        'remove_warning' => 'The note will be deleted for good. You cannot undo this.',
        'remove_confirm' => 'Remove note',
    ],
    'send' => [
        'heading' => 'Say thank you',
        'heading_to' => 'Say thank you to :name',
        'intro' => 'Send a thank-you note to this member.',
        'message_label' => 'Your message',
        'message_hint' => 'Up to 500 characters.',
        'private_hint' => 'Only this person will see your note, unless they choose to show it on their profile.',
        'submit' => 'Send thank you',
        'self_notice' => 'You cannot send a thank-you to yourself.',
    ],

    // ---- Shared pagination ----
    'pagination' => [
        'previous' => 'Previous',
        'next' => 'Next',
        'page_of' => 'Page :current of :last',
    ],

    // ---- Status / error banners ----
    'status' => [
        'collection_created' => 'Collection created.',
        'collection_updated' => 'Collection updated.',
        'collection_deleted' => 'Collection deleted.',
        'collection_name_required' => 'Enter a name for the collection.',
        'collection_failed' => 'Sorry, that could not be saved. Please try again.',
        'item_removed' => 'Item removed from the collection.',
        'item_remove_failed' => 'Sorry, that item could not be removed.',
        'appreciation_sent' => 'Your thank-you has been sent.',
        'appreciation_message_required' => 'Enter a message before sending.',
        'appreciation_self' => 'You cannot send a thank-you to yourself.',
        'appreciation_too_long' => 'Your message is too long. Use 500 characters or fewer.',
        'appreciation_rate_limited' => 'You have reached the daily limit for sending thank-you notes. Try again tomorrow.',
        'appreciation_failed' => 'Sorry, your thank-you could not be sent. Please try again.',
        'reaction_updated' => 'Your reaction has been updated.',
        'reaction_failed' => 'Sorry, your reaction could not be saved.',
        'appreciation_shown' => 'This note is now shown on your profile.',
        'appreciation_hidden' => 'This note is now hidden. Only you can see it.',
        'appreciation_removed' => 'The thank-you note has been removed.',
        'appreciation_visibility_failed' => 'Sorry, that note could not be changed. Please try again.',
        'appreciation_remove_failed' => 'Sorry, that note could not be removed. Please try again.',
    ],

    // ---- Error summary ----
    'errors' => [
        'summary_title' => 'There is a problem',
    ],
];
