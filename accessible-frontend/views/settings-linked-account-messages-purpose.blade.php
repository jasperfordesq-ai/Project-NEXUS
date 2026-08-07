{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

{{--
    The front door of the message viewer: WHY are you looking? Nothing is
    fetched — and no audit row exists yet — until this form is answered. The
    reason is stored in the session (30-minute TTL), never in the URL, then the
    viewer records it permanently with every look. Plain POST, no JavaScript.
--}}

@section('content')
    @php
        $reasons = $reasons ?? ['wellbeing', 'safety', 'helping_reply', 'other'];
        $partnerId = $partnerId ?? null;
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_settings.linked.activity_back') }}</a>

            <span class="govuk-caption-xl">{{ __('govuk_alpha_settings.linked.title') }}</span>
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha_settings.linked_messages.purpose_title') }}</h1>

            <div class="govuk-warning-text">
                <span class="govuk-warning-text__icon" aria-hidden="true">!</span>
                <strong class="govuk-warning-text__text">
                    <span class="govuk-visually-hidden">{{ __('govuk_alpha_settings.common.error_title') }}</span>
                    {{ __('govuk_alpha_settings.linked_messages.purpose_warning') }}
                </strong>
            </div>

            <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.messages.purpose', ['tenantSlug' => $tenantSlug, 'childId' => $childUserId]) }}">
                @csrf
                @if ($partnerId)
                    <input type="hidden" name="partner_id" value="{{ (int) $partnerId }}">
                @endif

                <div class="govuk-form-group">
                    <fieldset class="govuk-fieldset">
                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--m">{{ __('govuk_alpha_settings.linked_messages.purpose_reason_legend') }}</legend>
                        <div class="govuk-radios" data-module="govuk-radios">
                            @foreach ($reasons as $index => $reason)
                                <div class="govuk-radios__item">
                                    <input class="govuk-radios__input" id="reason-{{ $reason }}" name="reason" type="radio" value="{{ $reason }}" @checked($index === 0)>
                                    <label class="govuk-label govuk-radios__label" for="reason-{{ $reason }}">{{ __('govuk_alpha_settings.linked_messages.reason_' . $reason) }}</label>
                                </div>
                            @endforeach
                        </div>
                    </fieldset>
                </div>

                <div class="govuk-form-group">
                    <label class="govuk-label" for="detail">{{ __('govuk_alpha_settings.linked_messages.purpose_detail_label') }}</label>
                    <div id="detail-hint" class="govuk-hint">{{ __('govuk_alpha_settings.linked_messages.purpose_detail_hint') }}</div>
                    <textarea class="govuk-textarea" id="detail" name="detail" rows="2" maxlength="300" aria-describedby="detail-hint"></textarea>
                </div>

                <button class="govuk-button" data-module="govuk-button">{{ __('govuk_alpha_settings.linked_messages.purpose_continue') }}</button>
            </form>
        </div>
    </div>
@endsection
