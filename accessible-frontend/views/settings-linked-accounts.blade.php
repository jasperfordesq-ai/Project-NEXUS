{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    @php
        $successStates = [
            'link-requested', 'link-approved', 'link-revoked', 'link-permissions-saved',
            'message-access-requested', 'message-access-withdrawn',
        ];
        $errorStates = [
            'link-email-invalid', 'link-user-not-found', 'link-self', 'link-exists',
            'link-max', 'link-failed', 'appearance-invalid', 'appearance-failed',
            'link-vetting-required', 'link-contact-restricted', 'link-safeguarding-unavailable',
            'activity-denied', 'message-view-denied',
        ];
        $safeguardingErrorStates = [
            'link-vetting-required', 'link-contact-restricted', 'link-safeguarding-unavailable',
        ];
        $linkTypes = $linkTypes ?? [];
        $permissionKeys = $permissionKeys ?? [];
        $children = $children ?? [];
        $parents = $parents ?? [];
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_settings.common.back_to_settings') }}</a>

            @if (in_array($status, $successStates, true))
                <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="linked-status-title">
                    <div class="govuk-notification-banner__header">
                        <h2 class="govuk-notification-banner__title" id="linked-status-title">{{ __('govuk_alpha_settings.common.success_title') }}</h2>
                    </div>
                    <div class="govuk-notification-banner__content">
                        <p class="govuk-notification-banner__heading">{{ __('govuk_alpha_settings.states.' . $status) }}</p>
                    </div>
                </div>
            @elseif (in_array($status, $errorStates, true))
                <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
                    <div role="alert">
                        <h2 class="govuk-error-summary__title">{{ __('govuk_alpha_settings.common.error_title') }}</h2>
                        <div class="govuk-error-summary__body">
                            <ul class="govuk-list govuk-error-summary__list">
                                <li><a href="#request">{{ in_array($status, $safeguardingErrorStates, true)
                                    ? (session('linked_account_safeguarding_error') ?: match ($status) {
                                        'link-safeguarding-unavailable' => __('safeguarding.errors.policy_unavailable'),
                                        'link-vetting-required' => __('safeguarding.errors.vetting_required_title'),
                                        default => __('safeguarding.errors.contact_restricted'),
                                    })
                                    : __('govuk_alpha_settings.states.' . $status) }}</a></li>
                            </ul>
                        </div>
                    </div>
                </div>
            @endif

            <span class="govuk-caption-xl">{{ __('govuk_alpha_settings.linked.caption') }}</span>
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha_settings.linked.title') }}</h1>
            <p class="govuk-body-l">{{ __('govuk_alpha_settings.linked.description') }}</p>

            {{-- The approval queue is where prepared listings/transfers and
                 message-access asks land — reachable from here, not only from
                 the settings hub (B7). Page-title-as-label, same reasoning as
                 the settings tiles. --}}
            @if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.support-actions'))
                <p class="govuk-body">
                    <a class="govuk-link" href="{{ route('govuk-alpha.settings.support-actions', ['tenantSlug' => $tenantSlug]) }}">
                        {{ __('govuk_alpha_settings.support_actions.title') }}
                    </a>
                </p>
            @endif

            {{-- Accounts that manage me (parents) — approve incoming first --}}
            <section aria-labelledby="parents-heading" id="parents">
                <h2 class="govuk-heading-l" id="parents-heading">{{ __('govuk_alpha_settings.linked.parents_heading') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha_settings.linked.parents_description') }}</p>
                @if (empty($parents))
                    <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha_settings.linked.parents_empty') }}</p></div>
                @else
                    <ul class="govuk-list nexus-alpha-card-list">
                        @foreach ($parents as $p)
                            @php
                                $pName = trim((string) ($p['name'] ?? '')) !== '' ? $p['name'] : __('govuk_alpha_settings.common.unknown_member');
                                $isPending = ($p['status'] ?? '') === 'pending';
                            @endphp
                            <li class="nexus-alpha-card">
                                <div class="nexus-alpha-card-head">
                                    @if (!empty($p['avatar_url']))
                                        <img class="nexus-alpha-avatar" src="{{ $p['avatar_url'] }}" alt="" loading="lazy" decoding="async" width="48" height="48">
                                    @else
                                        <span class="nexus-alpha-avatar nexus-alpha-avatar--placeholder" aria-hidden="true">{{ mb_strtoupper(mb_substr($pName, 0, 1)) }}</span>
                                    @endif
                                    <div>
                                        <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-0">{{ $pName }}</p>
                                        <p class="govuk-body-s nexus-alpha-meta govuk-!-margin-bottom-0">{{ __('govuk_alpha_settings.linked.types.' . ($p['relationship_type'] ?? 'family')) }}</p>
                                    </div>
                                </div>
                                <p class="govuk-body-s govuk-!-margin-bottom-2">
                                    <strong class="govuk-tag {{ $isPending ? 'govuk-tag--yellow' : 'govuk-tag--green' }}">
                                        {{ $isPending ? __('govuk_alpha_settings.linked.status_pending') : __('govuk_alpha_settings.linked.status_active') }}
                                    </strong>
                                </p>
                                {{-- Message-access disclosure — the member's own view of a
                                     grant THEY made: who can view, when they last looked
                                     (from the immutable audit), and a one-press withdraw.
                                     Nothing renders unless access is actually active. --}}
                                @if (($p['message_access'] ?? 'none') === 'active' && (int) ($p['relationship_id'] ?? 0) > 0)
                                    <div class="govuk-inset-text govuk-!-margin-top-2 govuk-!-margin-bottom-2">
                                        <p class="govuk-body govuk-!-margin-bottom-1">{{ __('govuk_alpha_settings.linked_messages.member_disclosure', ['name' => $pName]) }}</p>
                                        <p class="govuk-body-s govuk-!-margin-bottom-2">
                                            @if (!empty($p['message_view_last_at']))
                                                {{ __('govuk_alpha_settings.linked_messages.member_last_viewed', ['date' => \Illuminate\Support\Carbon::parse($p['message_view_last_at'])->translatedFormat('j F Y, g:ia')]) }}
                                            @else
                                                {{ __('govuk_alpha_settings.linked_messages.member_never_viewed') }}
                                            @endif
                                        </p>
                                        <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.message-access.withdraw', ['tenantSlug' => $tenantSlug]) }}">
                                            @csrf
                                            <input type="hidden" name="relationship_id" value="{{ (int) $p['relationship_id'] }}">
                                            <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_settings.linked_messages.member_withdraw_button') }}<span class="govuk-visually-hidden"> {{ $pName }}</span></button>
                                        </form>
                                    </div>
                                @endif
                                <div class="nexus-alpha-actions">
                                    @if ($isPending && (int) ($p['relationship_id'] ?? 0) > 0)
                                        <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.approve', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-display-inline-block govuk-!-margin-right-2">
                                            @csrf
                                            <input type="hidden" name="relationship_id" value="{{ (int) $p['relationship_id'] }}">
                                            <button class="govuk-button govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_settings.linked.approve_button') }}<span class="govuk-visually-hidden"> {{ $pName }}</span></button>
                                        </form>
                                    @endif
                                    @if ((int) ($p['relationship_id'] ?? 0) > 0)
                                        <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.revoke', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-display-inline-block">
                                            @csrf
                                            <input type="hidden" name="relationship_id" value="{{ (int) $p['relationship_id'] }}">
                                            <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_settings.linked.revoke_button') }}<span class="govuk-visually-hidden"> {{ $pName }}</span></button>
                                        </form>
                                    @endif
                                </div>
                            </li>
                        @endforeach
                    </ul>
                @endif
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            {{-- Accounts I manage (children) — with per-child permissions --}}
            <section aria-labelledby="children-heading" id="children">
                <h2 class="govuk-heading-l" id="children-heading">{{ __('govuk_alpha_settings.linked.children_heading') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha_settings.linked.children_description') }}</p>
                @if (empty($children))
                    <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha_settings.linked.children_empty') }}</p></div>
                @else
                    <ul class="govuk-list nexus-alpha-card-list">
                        @foreach ($children as $c)
                            @php
                                $cName = trim((string) ($c['name'] ?? '')) !== '' ? $c['name'] : __('govuk_alpha_settings.common.unknown_member');
                                $cIsPending = ($c['status'] ?? '') === 'pending';
                                $cId = (int) ($c['relationship_id'] ?? 0);
                                $cPerms = $c['permissions'] ?? [];
                            @endphp
                            <li class="nexus-alpha-card">
                                <div class="nexus-alpha-card-head">
                                    @if (!empty($c['avatar_url']))
                                        <img class="nexus-alpha-avatar" src="{{ $c['avatar_url'] }}" alt="" loading="lazy" decoding="async" width="48" height="48">
                                    @else
                                        <span class="nexus-alpha-avatar nexus-alpha-avatar--placeholder" aria-hidden="true">{{ mb_strtoupper(mb_substr($cName, 0, 1)) }}</span>
                                    @endif
                                    <div>
                                        <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-0">{{ $cName }}</p>
                                        <p class="govuk-body-s nexus-alpha-meta govuk-!-margin-bottom-0">{{ __('govuk_alpha_settings.linked.types.' . ($c['relationship_type'] ?? 'family')) }}</p>
                                    </div>
                                </div>
                                <p class="govuk-body-s govuk-!-margin-bottom-2">
                                    <strong class="govuk-tag {{ $cIsPending ? 'govuk-tag--yellow' : 'govuk-tag--green' }}">
                                        {{ $cIsPending ? __('govuk_alpha_settings.linked.status_pending') : __('govuk_alpha_settings.linked.status_active') }}
                                    </strong>
                                </p>

                                {{-- Read-only activity view — offered only when the grant is on
                                     AND the link is active (never show what does not work). --}}
                                @if (!$cIsPending && !empty($c['can_see_activity']) && (int) ($c['user_id'] ?? 0) > 0)
                                    <p class="govuk-body govuk-!-margin-bottom-2">
                                        <a class="govuk-link" href="{{ route('govuk-alpha.settings.linked-accounts.activity', ['tenantSlug' => $tenantSlug, 'childId' => (int) $c['user_id']]) }}">
                                            {{ __('govuk_alpha_settings.linked.activity_link') }}<span class="govuk-visually-hidden"> {{ $cName }}</span>
                                        </a>
                                    </p>
                                @endif

                                @if ($cId > 0)
                                    <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.permissions', ['tenantSlug' => $tenantSlug]) }}">
                                        @csrf
                                        <input type="hidden" name="relationship_id" value="{{ $cId }}">
                                        <fieldset class="govuk-fieldset govuk-!-margin-bottom-2">
                                            <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha_settings.linked.permissions_heading') }}</legend>
                                            {{-- Activity stays a plain see/don't-see checkbox. --}}
                                            <div class="govuk-checkboxes govuk-checkboxes--small" data-module="govuk-checkboxes">
                                                <div class="govuk-checkboxes__item">
                                                    <input class="govuk-checkboxes__input" id="perm_{{ $cId }}_can_view_activity" name="perm_can_view_activity" type="checkbox" value="1" @checked($cPerms['can_view_activity'] ?? false)>
                                                    <label class="govuk-label govuk-checkboxes__label" for="perm_{{ $cId }}_can_view_activity">{{ __('govuk_alpha_settings.linked.permissions.can_view_activity') }}</label>
                                                </div>
                                            </div>
                                            {{--
                                                Listings and credits are THREE-level choices, not on/off.
                                                🔴 The old checkboxes were a live escalation hazard: a
                                                "Prepare only" (co_decide) grant projects to an UNTICKED
                                                box, so saving the form re-posted it as false→true, which
                                                the boolean shorthand used to promote to full act-alone
                                                power. Selects state the level explicitly; the backend
                                                additionally refuses boolean-driven escalation now, but
                                                this page must not misrepresent the grant in the first
                                                place. Keys are page-local: the guardians page speaks from
                                                the SUPPORTED MEMBER's side ("Your listings… you approve"),
                                                this page from the SUPPORTER's ("Their listings… they
                                                approve") — reusing those keys read wrong-way-round.
                                            --}}
                                            @foreach (['listings', 'credits'] as $capability)
                                                <div class="govuk-form-group govuk-!-margin-top-2 govuk-!-margin-bottom-2">
                                                    <label class="govuk-label" for="tier_{{ $cId }}_{{ $capability }}">
                                                        {{ __('govuk_alpha_settings.linked.tiers_capability_' . $capability) }}
                                                    </label>
                                                    <select class="govuk-select" id="tier_{{ $cId }}_{{ $capability }}" name="tier_{{ $capability }}">
                                                        @foreach ($grantableActionTiers ?? ['none', 'co_decide', 'represent'] as $tierOption)
                                                            <option value="{{ $tierOption }}" @if ($tierOption === ($c['tiers'][$capability] ?? 'none')) selected @endif>
                                                                {{ __('govuk_alpha_settings.linked.tiers_option_' . $tierOption) }}
                                                            </option>
                                                        @endforeach
                                                    </select>
                                                </div>
                                            @endforeach
                                        </fieldset>
                                        <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-2" data-module="govuk-button">{{ __('govuk_alpha_settings.linked.save_permissions') }}<span class="govuk-visually-hidden"> {{ $cName }}</span></button>
                                    </form>

                                    {{-- Messages: NEVER a checkbox or select. Three server-derived
                                         states — ask (a consent request the member answers),
                                         waiting, or on since a date with a link to the read-only
                                         viewer. The backend converts the ask into a pending
                                         consent action; only the member's own yes activates it. --}}
                                    @if (!$cIsPending)
                                        @php
                                            $cMsgAccess = $c['message_access'] ?? 'none';
                                        @endphp
                                        <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha_settings.linked_messages.capability_heading') }}</h3>
                                        @if ($cMsgAccess === 'active')
                                            <p class="govuk-body-s govuk-!-margin-bottom-1">
                                                <strong class="govuk-tag govuk-tag--green">{{ __('govuk_alpha_settings.linked_messages.state_active') }}</strong>
                                                @if (!empty($c['message_access_granted_at']))
                                                    {{ __('govuk_alpha_settings.linked_messages.state_active_since', ['date' => \Illuminate\Support\Carbon::parse($c['message_access_granted_at'])->translatedFormat('j F Y')]) }}
                                                @endif
                                            </p>
                                            <p class="govuk-body govuk-!-margin-bottom-2">
                                                <a class="govuk-link" href="{{ route('govuk-alpha.settings.linked-accounts.messages', ['tenantSlug' => $tenantSlug, 'childId' => (int) $c['user_id']]) }}">
                                                    {{ __('govuk_alpha_settings.linked_messages.view_link') }}<span class="govuk-visually-hidden"> {{ $cName }}</span>
                                                </a>
                                            </p>
                                        @elseif ($cMsgAccess === 'pending')
                                            <p class="govuk-body-s govuk-!-margin-bottom-2">
                                                <strong class="govuk-tag govuk-tag--yellow">{{ __('govuk_alpha_settings.linked_messages.state_pending', ['name' => $cName]) }}</strong>
                                            </p>
                                        @else
                                            <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.message-access.request', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-margin-bottom-2">
                                                @csrf
                                                <input type="hidden" name="relationship_id" value="{{ $cId }}">
                                                <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_settings.linked_messages.request_button') }}<span class="govuk-visually-hidden"> {{ $cName }}</span></button>
                                            </form>
                                        @endif
                                        <p class="govuk-body-s nexus-alpha-meta govuk-!-margin-bottom-2">{{ __('govuk_alpha_settings.linked_messages.explainer', ['name' => $cName]) }}</p>
                                    @endif

                                    <div class="govuk-warning-text govuk-!-margin-bottom-2">
                                        <span class="govuk-warning-text__icon" aria-hidden="true">!</span>
                                        <strong class="govuk-warning-text__text">
                                            <span class="govuk-visually-hidden">{{ __('govuk_alpha_settings.common.error_title') }}</span>
                                            {{ __('govuk_alpha_settings.linked.revoke_warning') }}
                                        </strong>
                                    </div>
                                    <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.revoke', ['tenantSlug' => $tenantSlug]) }}">
                                        @csrf
                                        <input type="hidden" name="relationship_id" value="{{ $cId }}">
                                        <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha_settings.linked.revoke_button') }}<span class="govuk-visually-hidden"> {{ $cName }}</span></button>
                                    </form>
                                @endif
                            </li>
                        @endforeach
                    </ul>
                @endif
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            {{-- Request a new link --}}
            <section aria-labelledby="request-heading">
                <h2 class="govuk-heading-l" id="request-heading">{{ __('govuk_alpha_settings.linked.request_heading') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha_settings.linked.request_description') }}</p>
                <p class="govuk-body-s nexus-alpha-meta">{{ __('govuk_alpha_settings.linked.request_max', ['count' => $maxChildren ?? 20]) }}</p>

                <form method="post" action="{{ route('govuk-alpha.settings.linked-accounts.request', ['tenantSlug' => $tenantSlug]) }}">
                    @csrf
                    <div class="govuk-form-group {{ in_array($status, ['link-email-invalid', 'link-user-not-found'], true) ? 'govuk-form-group--error' : '' }}">
                        <label class="govuk-label" for="request">{{ __('govuk_alpha_settings.linked.email_label') }}</label>
                        <div id="request-hint" class="govuk-hint">{{ __('govuk_alpha_settings.linked.email_hint') }}</div>
                        @if (in_array($status, ['link-email-invalid', 'link-user-not-found'], true))
                            <p id="request-error" class="govuk-error-message">
                                <span class="govuk-visually-hidden">{{ __('govuk_alpha_settings.common.error_title') }}:</span>
                                {{ __('govuk_alpha_settings.states.' . $status) }}
                            </p>
                        @endif
                        <input class="govuk-input" id="request" name="email" type="email" spellcheck="false" autocomplete="off"
                            aria-describedby="request-hint{{ in_array($status, ['link-email-invalid', 'link-user-not-found'], true) ? ' request-error' : '' }}">
                    </div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="relationship_type">{{ __('govuk_alpha_settings.linked.type_label') }}</label>
                        <select class="govuk-select" id="relationship_type" name="relationship_type">
                            @foreach ($linkTypes as $type)
                                <option value="{{ $type }}" @selected($type === 'family')>{{ __('govuk_alpha_settings.linked.types.' . $type) }}</option>
                            @endforeach
                        </select>
                    </div>

                    <fieldset class="govuk-fieldset govuk-!-margin-bottom-3">
                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha_settings.linked.permissions_heading') }}</legend>
                        <div class="govuk-checkboxes govuk-checkboxes--small" data-module="govuk-checkboxes">
                            @foreach ($permissionKeys as $permKey)
                                <div class="govuk-checkboxes__item">
                                    <input class="govuk-checkboxes__input" id="new_perm_{{ $permKey }}" name="perm_{{ $permKey }}" type="checkbox" value="1" @checked($permKey === 'can_view_activity')>
                                    <label class="govuk-label govuk-checkboxes__label" for="new_perm_{{ $permKey }}">{{ __('govuk_alpha_settings.linked.permissions.' . $permKey) }}</label>
                                </div>
                            @endforeach
                        </div>
                    </fieldset>

                    <button class="govuk-button" data-module="govuk-button">{{ __('govuk_alpha_settings.linked.request_button') }}</button>
                </form>
            </section>
        </div>
    </div>
@endsection
