{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

{{--
    Co-decide support actions — parity with the React approval queue.

    A helper prepared a listing or a time-credit transfer for this member;
    nothing happens unless the member approves it. Approving is one button.
    Declining offers a reason field that is NEVER required — requiring somebody
    to justify refusing is pressure to consent. Doing nothing is always safe:
    the request expires on its own.

    HTML-first by design: every answer is a plain form POST with a submit
    button. No JavaScript is required to approve, decline, or withdraw.
--}}

@section('content')
    @php
        $incoming = $incoming ?? [];
        $outgoing = $outgoing ?? [];

        $successStates = ['support-approved', 'support-declined', 'support-withdrawn'];
        $errorStates = ['support-not-found', 'support-failed'];

        $statusMessageKey = match ($status) {
            'support-approved' => 'status_approved',
            'support-declined' => 'status_declined',
            'support-withdrawn' => 'status_withdrawn',
            'support-not-found' => 'status_not_found',
            'support-failed' => 'status_failed',
            default => null,
        };
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_settings.common.back_to_settings') }}</a>

            @if ($statusMessageKey && in_array($status, $successStates, true))
                <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="support-status-title">
                    <div class="govuk-notification-banner__header">
                        <h2 class="govuk-notification-banner__title" id="support-status-title">{{ __('govuk_alpha_settings.common.success_title') }}</h2>
                    </div>
                    <div class="govuk-notification-banner__content">
                        <p class="govuk-notification-banner__heading">{{ __('govuk_alpha_settings.support_actions.' . $statusMessageKey) }}</p>
                    </div>
                </div>
            @elseif ($statusMessageKey && in_array($status, $errorStates, true))
                <div class="govuk-error-summary" data-module="govuk-error-summary" role="alert">
                    <div role="alert">
                        <h2 class="govuk-error-summary__title">{{ __('govuk_alpha_settings.common.error_title') }}</h2>
                        <div class="govuk-error-summary__body">
                            <p class="govuk-body">{{ __('govuk_alpha_settings.support_actions.' . $statusMessageKey) }}</p>
                        </div>
                    </div>
                </div>
            @endif

            <h1 class="govuk-heading-l">{{ __('govuk_alpha_settings.support_actions.title') }}</h1>
            <p class="govuk-body">{{ __('govuk_alpha_settings.support_actions.intro') }}</p>

            @if (empty($incoming))
                <p class="govuk-inset-text">{{ __('govuk_alpha_settings.support_actions.none') }}</p>
            @else
                @foreach ($incoming as $action)
                    @php
                        $aid = (int) ($action['id'] ?? 0);
                        $typeKey = 'type_' . ($action['action_type'] ?? 'listing_create');
                        $summary = $action['payload_summary'] ?? [];
                        $detail = $summary['title'] ?? $summary['amount'] ?? null;
                    @endphp
                    <div class="govuk-summary-card">
                        <div class="govuk-summary-card__title-wrapper">
                            <h2 class="govuk-summary-card__title">{{ __('govuk_alpha_settings.support_actions.' . $typeKey) }}</h2>
                        </div>
                        <div class="govuk-summary-card__content">
                            <dl class="govuk-summary-list">
                                <div class="govuk-summary-list__row">
                                    <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.support_actions.prepared_by') }}</dt>
                                    <dd class="govuk-summary-list__value">{{ $action['other_party_name'] ?: __('govuk_alpha_settings.common.unknown_member') }}</dd>
                                </div>
                                @if ($detail !== null && $detail !== '')
                                    <div class="govuk-summary-list__row">
                                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.support_actions.detail') }}</dt>
                                        <dd class="govuk-summary-list__value">{{ $detail }}</dd>
                                    </div>
                                @endif
                                @if (!empty($action['expires_at']))
                                    <div class="govuk-summary-list__row">
                                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.support_actions.expires') }}</dt>
                                        <dd class="govuk-summary-list__value">{{ \Illuminate\Support\Carbon::parse($action['expires_at'])->format('j F Y') }}</dd>
                                    </div>
                                @endif
                            </dl>

                            <p class="govuk-body">{{ __('govuk_alpha_settings.support_actions.nothing_without_you') }}</p>

                            <form method="post" action="{{ route('govuk-alpha.settings.support-actions.respond', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-margin-bottom-3">
                                @csrf
                                <input type="hidden" name="action_id" value="{{ $aid }}">
                                <input type="hidden" name="answer" value="approve">
                                <button class="govuk-button" data-module="govuk-button" type="submit">
                                    {{ __('govuk_alpha_settings.support_actions.approve_button') }}
                                </button>
                            </form>

                            <form method="post" action="{{ route('govuk-alpha.settings.support-actions.respond', ['tenantSlug' => $tenantSlug]) }}">
                                @csrf
                                <input type="hidden" name="action_id" value="{{ $aid }}">
                                <input type="hidden" name="answer" value="decline">
                                <div class="govuk-form-group">
                                    <label class="govuk-label" for="reason_{{ $aid }}">{{ __('govuk_alpha_settings.support_actions.reason_label') }}</label>
                                    <div id="reason-hint-{{ $aid }}" class="govuk-hint">{{ __('govuk_alpha_settings.support_actions.reason_hint') }}</div>
                                    <textarea class="govuk-textarea" id="reason_{{ $aid }}" name="reason" rows="2" maxlength="500" aria-describedby="reason-hint-{{ $aid }}"></textarea>
                                </div>
                                <button class="govuk-button govuk-button--warning" data-module="govuk-button" type="submit">
                                    {{ __('govuk_alpha_settings.support_actions.decline_button') }}
                                </button>
                            </form>
                        </div>
                    </div>
                @endforeach
            @endif

            {{-- The supporter's own prepared actions, with a withdraw option
                 while they are still unanswered. Only rendered when any exist. --}}
            @if (!empty($outgoing))
                <h2 class="govuk-heading-m govuk-!-margin-top-8">{{ __('govuk_alpha_settings.support_actions.outgoing_title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha_settings.support_actions.outgoing_intro') }}</p>
                @foreach ($outgoing as $action)
                    @php
                        $aid = (int) ($action['id'] ?? 0);
                        $state = $action['status'] ?? 'pending';
                        $typeKey = 'type_' . ($action['action_type'] ?? 'listing_create');
                    @endphp
                    <div class="govuk-summary-list__row govuk-!-margin-bottom-3">
                        <dl class="govuk-summary-list">
                            <div class="govuk-summary-list__row">
                                <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.support_actions.' . $typeKey) }} — {{ $action['other_party_name'] ?: __('govuk_alpha_settings.common.unknown_member') }}</dt>
                                <dd class="govuk-summary-list__value">
                                    <strong class="govuk-tag {{ $state === 'confirmed' ? 'govuk-tag--green' : ($state === 'declined' ? 'govuk-tag--red' : ($state === 'pending' ? 'govuk-tag--yellow' : 'govuk-tag--grey')) }}">
                                        {{ __('govuk_alpha_settings.support_actions.state_' . $state) }}
                                    </strong>
                                </dd>
                                <dd class="govuk-summary-list__actions">
                                    @if ($state === 'pending')
                                        <form method="post" action="{{ route('govuk-alpha.settings.support-actions.respond', ['tenantSlug' => $tenantSlug]) }}">
                                            @csrf
                                            <input type="hidden" name="action_id" value="{{ $aid }}">
                                            <input type="hidden" name="answer" value="withdraw">
                                            <button class="govuk-button govuk-button--secondary" data-module="govuk-button" type="submit">
                                                {{ __('govuk_alpha_settings.support_actions.withdraw_button') }}
                                            </button>
                                        </form>
                                    @endif
                                </dd>
                            </div>
                        </dl>
                    </div>
                @endforeach
            @endif
        </div>
    </div>
@endsection
