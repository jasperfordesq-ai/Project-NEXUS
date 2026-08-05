{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

{{--
    Guardian arrangements, member side — parity with the React safeguarding tab.

    🔴 Why this page exists. Coordinators record that someone is responsible for
    supporting a member. That member is the subject of the arrangement and the
    only person who can answer it. This frontend had no screen for it at all, so a
    member using the accessible site could not see an arrangement, agree to it,
    refuse it, or withdraw — on the frontend most likely to be used by the very
    people those arrangements are about.

    HTML-first by design: every action is a plain form POST with a submit button.
    No JavaScript is required to agree, refuse or withdraw.
--}}

@section('content')
    @php
        $guardians = $guardians ?? [];
        $wards = $wards ?? [];

        $successStates = ['guardian-consented', 'guardian-declined', 'guardian-withdrawn'];
        $errorStates = ['guardian-not-found', 'guardian-not-allowed', 'guardian-failed'];

        // Which answers each position allows. Mirrors
        // GuardianArrangementService::ALLOWED_FROM so the page never offers an
        // action the backend will refuse.
        $nextActions = [
            'pending' => ['consented', 'declined'],
            'consented' => ['withdrawn'],
            'declined' => ['consented'],
            'withdrawn' => ['consented'],
        ];

        $statusMessageKey = match ($status) {
            'guardian-consented' => 'status_consented',
            'guardian-declined' => 'status_declined',
            'guardian-withdrawn' => 'status_withdrawn',
            'guardian-not-found' => 'status_not_found',
            'guardian-not-allowed' => 'status_not_allowed',
            'guardian-failed' => 'status_failed',
            default => null,
        };
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_settings.common.back_to_settings') }}</a>

            @if ($statusMessageKey && in_array($status, $successStates, true))
                <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="guardian-status-title">
                    <div class="govuk-notification-banner__header">
                        <h2 class="govuk-notification-banner__title" id="guardian-status-title">{{ __('govuk_alpha_settings.common.success_title') }}</h2>
                    </div>
                    <div class="govuk-notification-banner__content">
                        <p class="govuk-notification-banner__heading">{{ __('govuk_alpha_settings.guardians.' . $statusMessageKey) }}</p>
                    </div>
                </div>
            @elseif ($statusMessageKey && in_array($status, $errorStates, true))
                <div class="govuk-error-summary" data-module="govuk-error-summary" role="alert">
                    <div role="alert">
                        <h2 class="govuk-error-summary__title">{{ __('govuk_alpha_settings.common.error_title') }}</h2>
                        <div class="govuk-error-summary__body">
                            <p class="govuk-body">{{ __('govuk_alpha_settings.guardians.' . $statusMessageKey) }}</p>
                        </div>
                    </div>
                </div>
            @endif

            <h1 class="govuk-heading-l">{{ __('govuk_alpha_settings.guardians.title') }}</h1>
            <p class="govuk-body">{{ __('govuk_alpha_settings.guardians.intro') }}</p>

            @if (empty($guardians))
                <p class="govuk-inset-text">{{ __('govuk_alpha_settings.guardians.none') }}</p>
            @else
                @foreach ($guardians as $guardian)
                    @php
                        $state = $guardian['state'] ?? 'pending';
                        $allowed = $nextActions[$state] ?? ['consented'];
                        $gid = (int) ($guardian['id'] ?? 0);
                    @endphp
                    <div class="govuk-summary-card">
                        <div class="govuk-summary-card__title-wrapper">
                            <h2 class="govuk-summary-card__title">{{ $guardian['guardian_name'] ?: __('govuk_alpha_settings.common.unknown_member') }}</h2>
                        </div>
                        <div class="govuk-summary-card__content">
                            <dl class="govuk-summary-list">
                                <div class="govuk-summary-list__row">
                                    <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.guardians.date_added') }}</dt>
                                    <dd class="govuk-summary-list__value">
                                        {{ !empty($guardian['assigned_at']) ? \Illuminate\Support\Carbon::parse($guardian['assigned_at'])->format('j F Y') : '—' }}
                                    </dd>
                                </div>
                                <div class="govuk-summary-list__row">
                                    <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.guardians.your_answer') }}</dt>
                                    <dd class="govuk-summary-list__value">
                                        <strong class="govuk-tag {{ $state === 'consented' ? 'govuk-tag--green' : ($state === 'declined' ? 'govuk-tag--red' : ($state === 'withdrawn' ? 'govuk-tag--grey' : 'govuk-tag--yellow')) }}">
                                            {{ __('govuk_alpha_settings.guardians.state_' . $state) }}
                                        </strong>
                                    </dd>
                                </div>
                                @if (!empty($guardian['notes']))
                                    <div class="govuk-summary-list__row">
                                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.guardians.coordinator_note') }}</dt>
                                        <dd class="govuk-summary-list__value">{{ $guardian['notes'] }}</dd>
                                    </div>
                                @endif
                                @if (!empty($guardian['ward_response_reason']))
                                    <div class="govuk-summary-list__row">
                                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.guardians.your_reason') }}</dt>
                                        <dd class="govuk-summary-list__value">{{ $guardian['ward_response_reason'] }}</dd>
                                    </div>
                                @endif
                            </dl>

                            {{--
                                Agreeing is a single button. Refusing and withdrawing
                                offer a reason field — never required, because
                                requiring somebody to justify refusing a safeguarding
                                arrangement is pressure to agree.
                            --}}
                            @if (in_array('consented', $allowed, true))
                                <form method="post" action="{{ route('govuk-alpha.settings.guardians.respond', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-margin-bottom-3">
                                    @csrf
                                    <input type="hidden" name="assignment_id" value="{{ $gid }}">
                                    <input type="hidden" name="action" value="consented">
                                    <button class="govuk-button" data-module="govuk-button" type="submit">
                                        {{ $state === 'pending' ? __('govuk_alpha_settings.guardians.agree_button') : __('govuk_alpha_settings.guardians.agree_again_button') }}
                                    </button>
                                </form>
                            @endif

                            @foreach (['declined', 'withdrawn'] as $negative)
                                @if (in_array($negative, $allowed, true))
                                    <form method="post" action="{{ route('govuk-alpha.settings.guardians.respond', ['tenantSlug' => $tenantSlug]) }}">
                                        @csrf
                                        <input type="hidden" name="assignment_id" value="{{ $gid }}">
                                        <input type="hidden" name="action" value="{{ $negative }}">
                                        <div class="govuk-form-group">
                                            <label class="govuk-label" for="reason_{{ $negative }}_{{ $gid }}">{{ __('govuk_alpha_settings.guardians.reason_label') }}</label>
                                            <div id="reason-hint-{{ $negative }}-{{ $gid }}" class="govuk-hint">{{ __('govuk_alpha_settings.guardians.reason_hint') }}</div>
                                            <textarea class="govuk-textarea" id="reason_{{ $negative }}_{{ $gid }}" name="reason" rows="2" maxlength="500" aria-describedby="reason-hint-{{ $negative }}-{{ $gid }}"></textarea>
                                        </div>
                                        <button class="govuk-button govuk-button--warning" data-module="govuk-button" type="submit">
                                            {{ $negative === 'declined' ? __('govuk_alpha_settings.guardians.decline_button') : __('govuk_alpha_settings.guardians.withdraw_button') }}
                                        </button>
                                    </form>
                                @endif
                            @endforeach
                        </div>
                    </div>
                @endforeach
            @endif

            {{--
                The other half of the relationship. A guardian previously had no
                screen at all — emailed that they were responsible for someone, with
                nowhere to see it or whether that person had agreed. Only rendered
                when they actually support someone.
            --}}
            @if (!empty($wards))
                <h2 class="govuk-heading-m govuk-!-margin-top-8">{{ __('govuk_alpha_settings.guardians.wards_title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha_settings.guardians.wards_intro') }}</p>
                <dl class="govuk-summary-list">
                    @foreach ($wards as $ward)
                        @php $wardState = $ward['state'] ?? 'pending'; @endphp
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ $ward['ward_name'] ?: __('govuk_alpha_settings.common.unknown_member') }}</dt>
                            <dd class="govuk-summary-list__value">
                                <strong class="govuk-tag {{ $wardState === 'consented' ? 'govuk-tag--green' : ($wardState === 'declined' ? 'govuk-tag--red' : ($wardState === 'withdrawn' ? 'govuk-tag--grey' : 'govuk-tag--yellow')) }}">
                                    {{ __('govuk_alpha_settings.guardians.ward_state_' . $wardState) }}
                                </strong>
                            </dd>
                        </div>
                    @endforeach
                </dl>
            @endif
        </div>
    </div>
@endsection
