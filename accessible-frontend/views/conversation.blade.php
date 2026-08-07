{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    @php
        $otherUser = $conversation['other_user'] ?? [];
        $otherName = $otherUser['name'] ?? trim(($otherUser['first_name'] ?? '') . ' ' . ($otherUser['last_name'] ?? '')) ?: __('govuk_alpha.members.unknown_member');
        $formatDate = fn ($value): ?string => $value ? \Illuminate\Support\Carbon::parse($value)->translatedFormat('j F Y, g:ia') : null;
        $safeguarding = $conversation['safeguarding'] ?? null;
        $canSend = $directMessagingEnabled
            && empty($restriction['messaging_disabled'])
            && empty($safeguarding['restricted']);
        $translationEnabled = \App\Core\TenantContext::hasFeature('message_translation');
        $translation = session('messages_translation');
        $translatedMessageId = is_array($translation) ? (int) ($translation['id'] ?? 0) : 0;
        $successStatuses = [
            'message-sent' => 'govuk_alpha.messages.sent',
            'message-edited' => 'govuk_alpha.messages.edited_success',
            'message-deleted' => 'govuk_alpha.messages.deleted_success',
            'translate-done' => 'govuk_alpha_messages.translate.done',
        ];
        $errorStatuses = [
            'message-empty' => 'govuk_alpha.messages.empty_message',
            'message-disabled' => 'govuk_alpha.messages.disabled_detail',
            'message-failed' => 'govuk_alpha.messages.failed',
            'message-edit-forbidden' => 'govuk_alpha.messages.edit_forbidden',
            'message-edit-expired' => 'govuk_alpha.messages.edit_expired',
            'message-edit-failed' => 'govuk_alpha.messages.edit_failed',
            'message-delete-failed' => 'govuk_alpha.messages.delete_failed',
            'translate-failed' => 'govuk_alpha_messages.translate.failed',
            'translate-unavailable' => 'govuk_alpha_messages.translate.unavailable',
            'translate-empty' => 'govuk_alpha_messages.translate.empty',
            'attachment-too-many' => 'govuk_alpha_messages.attachments.error_too_many',
            'attachment-failed' => 'govuk_alpha_messages.attachments.error_failed',
            'attachment-invalid' => 'govuk_alpha_messages.attachments.error_invalid',
            'voice-required' => 'govuk_alpha_messages.voice.error_required',
            'voice-failed' => 'govuk_alpha_messages.voice.error_failed',
            'message-vetting-required' => 'safeguarding.errors.vetting_required_title',
            'message-contact-restricted' => 'safeguarding.errors.contact_restricted_title',
            'message-policy-unavailable' => 'safeguarding.errors.policy_unavailable_title',
        ];
        $safeguardingStatus = in_array($status, [
            'message-vetting-required',
            'message-contact-restricted',
            'message-policy-unavailable',
        ], true);
    @endphp

    <a class="govuk-back-link" href="{{ route('govuk-alpha.messages.index', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.actions.back_to_messages') }}</a>

    @if (isset($successStatuses[$status]))
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="message-success-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="message-success-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ __($successStatuses[$status]) }}</p>
            </div>
        </div>
    @elseif (isset($errorStatuses[$status]))
        <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
            <div role="alert">
                <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                <div class="govuk-error-summary__body">
                    <ul class="govuk-list govuk-error-summary__list">
                        <li>
                            <a href="{{ $safeguardingStatus ? '#safeguarding-notice' : '#body' }}">{{ __($errorStatuses[$status]) }}</a>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    @endif

    <span class="govuk-caption-l">{{ __('govuk_alpha.messages.title') }}</span>
    <h1 class="govuk-heading-xl">{{ __('govuk_alpha.messages.conversation_title', ['name' => $otherName]) }}</h1>

    @if ($listing)
        <div class="govuk-inset-text">
            <a class="govuk-link" href="{{ route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $listing['id']]) }}">{{ __('govuk_alpha.messages.listing_context', ['title' => $listing['title']]) }}</a>
        </div>
    @endif

    @if (!$directMessagingEnabled)
        <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="conversation-disabled-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="conversation-disabled-title">{{ __('govuk_alpha.messages.disabled_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-body">{{ __('govuk_alpha.messages.disabled_detail') }}</p>
            </div>
        </div>
    @elseif (!empty($restriction['messaging_disabled']))
        <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="conversation-restricted-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="conversation-restricted-title">{{ __('govuk_alpha.messages.disabled_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-body">{{ __('govuk_alpha.messages.restricted_detail') }}</p>
            </div>
        </div>
    @elseif (!empty($safeguarding['restricted']))
        <div id="safeguarding-notice" class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="conversation-safeguarding-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="conversation-safeguarding-title">{{ $safeguarding['title'] ?? __('safeguarding.errors.contact_restricted_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-body">{{ $safeguarding['detail'] ?? $safeguarding['message'] ?? __('safeguarding.errors.contact_restricted') }}</p>
            </div>
        </div>
    @endif

    {{-- ONE cause-agnostic visibility notice for broker review AND supporter
         message access, folded together so a reader can never tell which
         applies or to whom (parity: React ConversationPage). Fail-open: only
         an explicit false review flag with no supporter flag hides it. --}}
    @php
        $visibilityNoticeRequired = (($restriction['review_notice_required'] ?? null) !== false)
            || (($restriction['supporter_view_notice_required'] ?? false) === true);
    @endphp
    @if ($visibilityNoticeRequired)
        <div class="govuk-inset-text">
            <p class="govuk-body govuk-!-margin-bottom-0">{{ __('govuk_alpha.messages.visibility_notice') }}</p>
        </div>
    @endif

    {{-- The member's OWN standing reminder that a supporter they chose can
         view their messages, with the way back to manage or withdraw it. --}}
    @if (!empty($restriction['own_messages_shared']))
        <div class="govuk-inset-text">
            <p class="govuk-body govuk-!-margin-bottom-0">
                {{ __('govuk_alpha.messages.own_messages_shared_reminder') }}
                <a class="govuk-link" href="{{ route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug]) }}#parents">{{ __('govuk_alpha.messages.own_messages_shared_manage') }}</a>
            </p>
        </div>
    @endif

    @if (empty($messages))
        <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha.messages.empty') }}</p></div>
    @else
        @if (!empty($meta['has_more']) && !empty($meta['cursor']))
            {{-- Older messages live above the latest 50; this loads the previous page (no JS). --}}
            <nav class="govuk-pagination govuk-pagination--block govuk-!-margin-bottom-4" aria-label="{{ __('govuk_alpha.messages.older_pagination_label') }}">
                <div class="govuk-pagination__prev">
                    <a class="govuk-link govuk-pagination__link" href="{{ route('govuk-alpha.messages.show', array_filter(['tenantSlug' => $tenantSlug, 'userId' => $conversation['id'], 'cursor' => $meta['cursor'], 'listing' => $listing['id'] ?? null])) }}" rel="prev">
                        <svg class="govuk-pagination__icon govuk-pagination__icon--prev" xmlns="http://www.w3.org/2000/svg" height="13" width="15" aria-hidden="true" focusable="false" viewBox="0 0 15 13">
                            <path d="m6.5938-0.0078125-6.7266 6.7266 6.7441 6.4062 1.377-1.4492-4.1856-3.9765h12.896v-2h-12.984l4.2931-4.293-1.414-1.4141z"></path>
                        </svg>
                        <span class="govuk-pagination__link-title">{{ __('govuk_alpha.messages.show_older') }}</span>
                    </a>
                </div>
            </nav>
        @endif
        <ol class="govuk-list govuk-list--spaced">
            @foreach ($messages as $message)
                @php
                    $isOwn = (int) ($message['sender_id'] ?? 0) === $currentUserId;
                    $senderName = $isOwn ? __('govuk_alpha.messages.sent_by_you') : $otherName;
                    $sentAt = $formatDate($message['created_at'] ?? null);
                    $isDeleted = (bool) ($message['is_deleted'] ?? false);
                    $isEdited = (bool) ($message['is_edited'] ?? false);
                    $messageId = (int) ($message['id'] ?? 0);
                    $createdAt = $message['created_at'] ?? null;
                    $canEditMessage = $isOwn && !$isDeleted && $messageId > 0
                        && $createdAt && \Illuminate\Support\Carbon::parse($createdAt)->gt(now()->subHours(24));
                    $canManageMessage = $isOwn && !$isDeleted && $messageId > 0;
                @endphp
                <li class="nexus-alpha-card" id="m-{{ $messageId }}">
                    <div class="nexus-alpha-card-head">
                        @php
                            $senderAvatar = $message['sender']['avatar_url'] ?? null;
                        @endphp
                        @if (!empty($senderAvatar))
                            <img class="nexus-alpha-avatar" src="{{ $senderAvatar }}" alt="" loading="lazy" decoding="async" width="48" height="48">
                        @else
                            <span class="nexus-alpha-avatar nexus-alpha-avatar--placeholder" aria-hidden="true">{{ mb_strtoupper(mb_substr($senderName, 0, 1)) }}</span>
                        @endif
                        <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-0">{{ $senderName }}</p>
                    </div>
                    @if ($sentAt)
                        <p class="govuk-hint govuk-!-margin-bottom-2">{{ __('govuk_alpha.messages.sent_label') }} {{ $sentAt }}@if ($isEdited && !$isDeleted) <span class="govuk-!-font-weight-regular">&middot; {{ __('govuk_alpha.messages.edited') }}</span>@endif</p>
                    @endif
                    @if ($isDeleted)
                        <p class="govuk-body govuk-hint">{{ __('govuk_alpha.messages.deleted_placeholder') }}</p>
                    @else
                        <div class="govuk-body">{!! nl2br(e((string) ($message['body'] ?? ''))) !!}</div>
                        @if (!empty($message['is_voice']) && !empty($message['audio_url']))
                            <audio controls preload="none" src="{{ $message['audio_url'] }}" class="govuk-!-margin-top-1">
                                {{ __('govuk_alpha_messages.voice.no_audio_support') }}
                            </audio>
                            @if (!empty($message['transcript']))
                                <details class="govuk-details" data-module="govuk-details">
                                    <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha_messages.voice.transcript_toggle') }}</span></summary>
                                    <div class="govuk-details__text">{!! nl2br(e((string) $message['transcript'])) !!}</div>
                                </details>
                            @endif
                        @endif
                        @if (!empty($message['attachments']))
                            <ul class="govuk-list govuk-!-margin-top-2 govuk-!-margin-bottom-0">
                                @foreach ($message['attachments'] as $att)
                                    @if (!empty($att['file_url']))
                                        <li>
                                            @if (str_starts_with((string) ($att['mime_type'] ?? ''), 'image/'))
                                                <a class="govuk-link" href="{{ $att['file_url'] }}" target="_blank" rel="noopener"><span class="govuk-visually-hidden"> {{ __('govuk_alpha.opens_new_tab') }}</span>
                                                    <img src="{{ $att['file_url'] }}" alt="{{ $att['file_name'] ?? __('govuk_alpha_messages.attachments.default_name') }}" width="220" loading="lazy" decoding="async">
                                                </a>
                                            @else
                                                <a class="govuk-link" href="{{ $att['file_url'] }}" download>{{ $att['file_name'] ?? __('govuk_alpha_messages.attachments.default_name') }}</a>
                                            @endif
                                        </li>
                                    @endif
                                @endforeach
                            </ul>
                        @endif
                    @endif

                    {{-- Per-message translation (parity: React MessageBubble translate button).
                         The translated text is flashed by messagesTranslateMessage and rendered
                         inline here, under the original. No-JS: a plain POST form per message. --}}
                    @if (!$isDeleted && $translationEnabled && $messageId > 0 && trim((string) ($message['body'] ?? '')) !== '')
                        @if ($translatedMessageId === $messageId && !empty($translation['text']))
                            <div class="govuk-inset-text govuk-!-margin-top-2">
                                <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-1">{{ __('govuk_alpha_messages.translate.translated_label') }}</p>
                                <div class="govuk-body govuk-!-margin-bottom-0">{!! nl2br(e((string) $translation['text'])) !!}</div>
                            </div>
                        @else
                            <form method="post" action="{{ route('govuk-alpha.messages.translate', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id'], 'messageId' => $messageId]) }}" class="govuk-!-margin-top-1">
                                @csrf
                                <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_messages.translate.button') }}</button>
                            </form>
                        @endif
                    @endif

                    @if ($canManageMessage)
                        {{-- Edit/delete controls live INSIDE the <li> so the <ol> only ever has
                             <li> children (a <details> directly under <ol> is invalid HTML). --}}
                        <details class="govuk-details" data-module="govuk-details">
                            <summary class="govuk-details__summary">
                                <span class="govuk-details__summary-text">{{ __('govuk_alpha.messages.edit_delete_toggle') }}</span>
                            </summary>
                            <div class="govuk-details__text">
                                @if ($canEditMessage)
                                    <form method="post" action="{{ route('govuk-alpha.messages.edit', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id'], 'messageId' => $messageId]) }}" class="govuk-!-margin-bottom-4">
                                        @csrf
                                        <div class="govuk-form-group">
                                            <label class="govuk-label govuk-label--s" for="edit-body-{{ $messageId }}">{{ __('govuk_alpha.messages.edit_label') }}</label>
                                            <div id="edit-hint-{{ $messageId }}" class="govuk-hint">{{ __('govuk_alpha.messages.edit_window_hint') }}</div>
                                            <textarea class="govuk-textarea" id="edit-body-{{ $messageId }}" name="body" rows="4" aria-describedby="edit-hint-{{ $messageId }}" required>{{ (string) ($message['body'] ?? '') }}</textarea>
                                        </div>
                                        <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.messages.edit_button') }}</button>
                                    </form>
                                @else
                                    <p class="govuk-hint">{{ __('govuk_alpha.messages.edit_expired_notice') }}</p>
                                @endif

                                <form method="post" action="{{ route('govuk-alpha.messages.delete', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id'], 'messageId' => $messageId]) }}">
                                    @csrf
                                    <fieldset class="govuk-fieldset">
                                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha.messages.delete_legend') }}</legend>
                                        <div class="govuk-radios govuk-radios--small" data-module="govuk-radios">
                                            <div class="govuk-radios__item">
                                                <input class="govuk-radios__input" id="delete-self-{{ $messageId }}" name="scope" type="radio" value="self" checked aria-describedby="delete-self-hint-{{ $messageId }}">
                                                <label class="govuk-label govuk-radios__label" for="delete-self-{{ $messageId }}">{{ __('govuk_alpha.messages.delete_scope_self') }}</label>
                                                <div id="delete-self-hint-{{ $messageId }}" class="govuk-hint govuk-radios__hint">{{ __('govuk_alpha.messages.delete_scope_self_hint') }}</div>
                                            </div>
                                            <div class="govuk-radios__item">
                                                <input class="govuk-radios__input" id="delete-everyone-{{ $messageId }}" name="scope" type="radio" value="everyone" aria-describedby="delete-everyone-hint-{{ $messageId }}">
                                                <label class="govuk-label govuk-radios__label" for="delete-everyone-{{ $messageId }}">{{ __('govuk_alpha.messages.delete_scope_everyone') }}</label>
                                                <div id="delete-everyone-hint-{{ $messageId }}" class="govuk-hint govuk-radios__hint">{{ __('govuk_alpha.messages.delete_scope_everyone_hint') }}</div>
                                            </div>
                                        </div>
                                    </fieldset>
                                    <button class="govuk-button govuk-button--warning govuk-!-margin-top-2 govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.messages.delete_button') }}</button>
                                </form>
                            </div>
                        </details>
                    @endif
                </li>
            @endforeach
        </ol>
    @endif

    {{-- In-conversation message search (parity: React conversation search) --}}
    <div class="nexus-alpha-card govuk-!-margin-top-6 govuk-!-margin-bottom-4">
        <form method="get" action="{{ route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id']]) }}">
            <div class="govuk-form-group govuk-!-margin-bottom-2">
                <label class="govuk-label" for="conv-search">{{ __('govuk_alpha.polish_members.conversation_filter_label') }}</label>
                <div id="conv-search-hint" class="govuk-hint">{{ __('govuk_alpha.polish_members.conversation_filter_hint') }}</div>
                <input class="govuk-input govuk-!-width-two-thirds" id="conv-search" name="q" type="search" value="{{ request('q', '') }}" aria-describedby="conv-search-hint">
            </div>
            <div class="govuk-button-group">
                <button type="submit" class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.polish_members.conversation_filter_submit') }}</button>
                @if (request('q', '') !== '')
                    <a class="govuk-link" href="{{ route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id']]) }}">{{ __('govuk_alpha.polish_members.conversation_filter_clear') }}</a>
                @endif
            </div>
        </form>
    </div>

    @if ($canSend)
        {{-- Reply and archive are two independent POST targets, so they must be sibling
             forms — never nested (nested <form> is invalid HTML and the browser drops it). --}}
        <form method="post" enctype="multipart/form-data" action="{{ route('govuk-alpha.messages.store', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id']]) }}" class="govuk-!-margin-top-7">
            @csrf
            @if ($listing)
                <input type="hidden" name="context_type" value="listing">
                <input type="hidden" name="context_id" value="{{ $listing['id'] }}">
            @endif
            <div class="govuk-form-group">
                <label class="govuk-label govuk-label--m" for="body">{{ __('govuk_alpha.messages.message_label') }}</label>
                <div id="body-hint" class="govuk-hint">{{ __('govuk_alpha.messages.message_hint') }}</div>
                <textarea class="govuk-textarea" id="body" name="body" rows="5" aria-describedby="body-hint"></textarea>
            </div>
            {{-- File/image attachments (no-JS). A message may be attachments-only,
                 so the textarea above is no longer `required`. --}}
            <div class="govuk-form-group">
                <label class="govuk-label govuk-label--s" for="attachments">{{ __('govuk_alpha_messages.attachments.label') }}</label>
                <div id="attachments-hint" class="govuk-hint">{{ __('govuk_alpha_messages.attachments.hint') }}</div>
                <input class="govuk-file-upload" id="attachments" name="attachments[]" type="file" multiple aria-describedby="attachments-hint" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx">
            </div>
            <button class="govuk-button" data-module="govuk-button">{{ __('govuk_alpha.actions.reply') }}</button>
        </form>

        {{-- Voice message (no-JS): upload a recorded clip. On mobile the `capture`
             attribute opens the recorder directly; on desktop it picks an audio file. --}}
        <form method="post" enctype="multipart/form-data" action="{{ route('govuk-alpha.messages.voice', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id']]) }}" class="govuk-!-margin-top-4">
            @csrf
            <div class="govuk-form-group govuk-!-margin-bottom-2">
                <label class="govuk-label govuk-label--s" for="voice">{{ __('govuk_alpha_messages.voice.label') }}</label>
                <div id="voice-hint" class="govuk-hint">{{ __('govuk_alpha_messages.voice.hint') }}</div>
                <input class="govuk-file-upload" id="voice" name="voice" type="file" accept="audio/*" capture aria-describedby="voice-hint">
            </div>
            <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_messages.voice.submit') }}</button>
        </form>

        <form method="post" action="{{ route('govuk-alpha.messages.archive', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id']]) }}" class="govuk-!-margin-top-4">
            @csrf
            <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.actions.archive_conversation') }}</button>
        </form>
    @else
        <div class="govuk-button-group govuk-!-margin-top-4">
            <form method="post" action="{{ route('govuk-alpha.messages.archive', ['tenantSlug' => $tenantSlug, 'userId' => $conversation['id']]) }}">
                @csrf
                <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.actions.archive_conversation') }}</button>
            </form>
        </div>
    @endif
@endsection
