{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

{{--
    One conversation, read-only, as the supported member sees it (React
    SupportedMessagesPage thread parity). No reply form exists on this page —
    read-only is structural, not a disabled control — nothing is marked as
    read, and this visit was written to the immutable view audit (with the
    stated purpose) before rendering.
--}}

@section('content')
    @php
        $messages = $messages ?? [];
        $formatDate = fn ($value): ?string => $value ? \Illuminate\Support\Carbon::parse($value)->translatedFormat('j F Y, g:ia') : null;
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.settings.linked-accounts.messages', ['tenantSlug' => $tenantSlug, 'childId' => $childUserId]) }}">{{ __('govuk_alpha_settings.linked_messages.back_to_list') }}</a>

            <span class="govuk-caption-xl">{{ __('govuk_alpha_settings.linked.title') }}</span>
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha_settings.linked_messages.thread_title', ['name' => $childName]) }}</h1>

            <div class="govuk-inset-text">
                <p class="govuk-body govuk-!-margin-bottom-0">{{ __('govuk_alpha_settings.linked_messages.read_only_banner') }}</p>
            </div>

            @if (empty($messages))
                <p class="govuk-body">{{ __('govuk_alpha_settings.linked_messages.empty_thread') }}</p>
            @else
                <ol class="govuk-list govuk-list--spaced">
                    @foreach ($messages as $message)
                        @php
                            $sender = is_array($message['sender'] ?? null) ? $message['sender'] : [];
                            $senderName = trim(($sender['first_name'] ?? '') . ' ' . ($sender['last_name'] ?? ''));
                            $fromMember = (int) ($message['sender_id'] ?? 0) === (int) $childUserId;
                            if ($senderName === '') {
                                $senderName = $fromMember ? $childName : __('govuk_alpha_settings.common.unknown_member');
                            }
                            $sentAt = $formatDate($message['created_at'] ?? null);
                            $isDeleted = (bool) ($message['is_deleted'] ?? false);
                        @endphp
                        <li class="nexus-alpha-card">
                            <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-0">{{ $senderName }}</p>
                            @if ($sentAt)
                                <p class="govuk-hint govuk-!-margin-bottom-2">{{ $sentAt }}</p>
                            @endif
                            @if ($isDeleted)
                                <p class="govuk-body govuk-hint">{{ __('govuk_alpha.messages.deleted_placeholder') }}</p>
                            @elseif (!empty($message['is_voice']))
                                <p class="govuk-body govuk-hint">{{ __('govuk_alpha_settings.linked_messages.voice_message') }}</p>
                            @else
                                <div class="govuk-body">{!! nl2br(e((string) ($message['body'] ?? ''))) !!}</div>
                            @endif
                        </li>
                    @endforeach
                </ol>
            @endif
        </div>
    </div>
@endsection
