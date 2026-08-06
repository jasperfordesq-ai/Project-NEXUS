{{-- Copyright (c) 2024-2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    @php
        $profileType = ($profile['profile_type'] ?? 'individual') === 'organisation' ? 'organisation' : 'individual';
        $privacyProfile = $profile['privacy_profile'] ?? 'public';
        $privacySearch = (bool) ($profile['privacy_search'] ?? true);
        $marketingOptIn = (bool) ($marketingOptIn ?? false);
        $currentAvatar = $avatarUrl ?? null;
        $successStatuses = ['data-export-requested'];
        $infoStatuses = ['data-export-exists'];
        $errorStatuses = ['avatar-invalid', 'data-export-failed'];
        $statusMessage = [
            'data-export-requested' => __('govuk_alpha.states.data-export-requested'),
            'data-export-exists' => __('govuk_alpha.states.data-export-exists'),
            'data-export-failed' => __('govuk_alpha.states.data-export-failed'),
            'avatar-invalid' => __('govuk_alpha.states.avatar-invalid'),
        ];
    @endphp

    <a class="govuk-back-link" href="{{ route('govuk-alpha.profile.me', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.actions.back_to_profile') }}</a>

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha.profile_settings.title') }}</h1>
            <p class="govuk-body-l">{{ __('govuk_alpha.profile_settings.description') }}</p>

            @php
                $settingsTabs = [];
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.linked-accounts')) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.nav.linked_accounts'),
                        'href' => route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug]),
                    ];
                }
                // Guardian arrangements. Reuses the page title as its label rather
                // than adding a `nav.guardians` key with the identical value — a
                // duplicate string is a duplicate translation to keep correct.
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.guardians')) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.guardians.title'),
                        'href' => route('govuk-alpha.settings.guardians', ['tenantSlug' => $tenantSlug]),
                    ];
                }
                // Co-decide support actions — same page-title-as-label reasoning
                // as the guardians entry above.
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.support-actions')) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.support_actions.title'),
                        'href' => route('govuk-alpha.settings.support-actions', ['tenantSlug' => $tenantSlug]),
                    ];
                }
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.appearance')) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.nav.appearance'),
                        'href' => route('govuk-alpha.settings.appearance', ['tenantSlug' => $tenantSlug]),
                    ];
                }
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.data-rights')) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.nav.data_rights'),
                        'href' => route('govuk-alpha.settings.data-rights', ['tenantSlug' => $tenantSlug]),
                    ];
                }
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.insurance')
                    && \App\Services\BrokerControlConfigService::isInsuranceEnabled()) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.nav.insurance'),
                        'href' => route('govuk-alpha.settings.insurance', ['tenantSlug' => $tenantSlug]),
                    ];
                }
                if (\Illuminate\Support\Facades\Route::has('govuk-alpha.settings.availability')) {
                    $settingsTabs[] = [
                        'label' => __('govuk_alpha_settings.nav.availability'),
                        'href' => route('govuk-alpha.settings.availability', ['tenantSlug' => $tenantSlug]),
                    ];
                }
            @endphp
            @if (!empty($settingsTabs))
                <ul class="govuk-list govuk-!-margin-bottom-6">
                    @foreach ($settingsTabs as $settingsTab)
                        <li><a class="govuk-link" href="{{ $settingsTab['href'] }}">{{ $settingsTab['label'] }}</a></li>
                    @endforeach
                </ul>
            @endif

            @if (($status ?? '') === 'profile-update-failed')
                <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
                    <div role="alert">
                        <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                        <div class="govuk-error-summary__body">
                            <ul class="govuk-list govuk-error-summary__list">
                                <li><a href="#first_name">{{ __('govuk_alpha.profile_settings.failed') }}</a></li>
                            </ul>
                        </div>
                    </div>
                </div>
            @elseif (in_array($status ?? '', $errorStatuses, true))
                <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
                    <div role="alert">
                        <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                        <div class="govuk-error-summary__body">
                            <ul class="govuk-list govuk-error-summary__list">
                                <li><a href="#{{ ($status ?? '') === 'avatar-invalid' ? 'avatar' : 'data-export' }}">{{ $statusMessage[$status] ?? '' }}</a></li>
                            </ul>
                        </div>
                    </div>
                </div>
            @elseif (in_array($status ?? '', $successStatuses, true))
                <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="settings-status-title">
                    <div class="govuk-notification-banner__header">
                        <h2 class="govuk-notification-banner__title" id="settings-status-title">{{ __('govuk_alpha.states.success_title') }}</h2>
                    </div>
                    <div class="govuk-notification-banner__content">
                        <p class="govuk-notification-banner__heading">{{ $statusMessage[$status] ?? '' }}</p>
                    </div>
                </div>
            @elseif (in_array($status ?? '', $infoStatuses, true))
                <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="settings-status-title">
                    <div class="govuk-notification-banner__header">
                        <h2 class="govuk-notification-banner__title" id="settings-status-title">{{ __('govuk_alpha.states.important') }}</h2>
                    </div>
                    <div class="govuk-notification-banner__content">
                        <p class="govuk-notification-banner__heading">{{ $statusMessage[$status] ?? '' }}</p>
                    </div>
                </div>
            @endif

            @php
                $accountStatusMap = [
                    'email-changed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.email_changed')],
                    'email-unchanged' => ['type' => 'info', 'msg' => __('govuk_alpha.profile_settings.email_unchanged')],
                    'email-invalid' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.email_invalid'), 'anchor' => '#new_email'],
                    'email-password-incorrect' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.email_password_incorrect'), 'anchor' => '#email_current_password'],
                    'email-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.email_failed'), 'anchor' => '#new_email'],
                    'password-changed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.password_changed')],
                    'password-current-required' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_current_required'), 'anchor' => '#current_password'],
                    'password-current-incorrect' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_current_incorrect'), 'anchor' => '#current_password'],
                    'password-weak' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_weak'), 'anchor' => '#new_password'],
                    'password-mismatch' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_mismatch'), 'anchor' => '#new_password_confirmation'],
                    'password-reused' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_reused'), 'anchor' => '#new_password'],
                    'password-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_failed'), 'anchor' => '#new_password'],
                    'language-changed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.language_changed')],
                    'language-invalid' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.language_invalid'), 'anchor' => '#language'],
                    'notifications-saved' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.notifications.saved')],
                    'notifications-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.notifications.failed'), 'anchor' => '#notifications'],
                    'passkey-renamed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.passkeys.renamed')],
                    'passkey-removed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.passkeys.removed')],
                    'passkey-not-found' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.passkeys.not_found'), 'anchor' => '#passkeys'],
                    'passkey-last-sign-in-method' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.passkeys.last_sign_in_method'), 'anchor' => '#passkeys'],
                    'passkey-name-required' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.passkeys.name_required'), 'anchor' => '#passkeys'],
                    'passkey-password-required' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_current_required'), 'anchor' => '#passkeys'],
                    'passkey-password-incorrect' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.password_current_incorrect'), 'anchor' => '#passkeys'],
                    'personalisation-saved' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.personalisation.saved')],
                    'personalisation-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.personalisation.failed'), 'anchor' => '#personalisation'],
                    'match-prefs-saved' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.match.saved')],
                    'match-prefs-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.match.failed'), 'anchor' => '#match-preferences'],
                    'skill-added' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.skills.added')],
                    'skill-removed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.skills.removed')],
                    'skill-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.skills.failed'), 'anchor' => '#skills'],
                    'skill-name-required' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.skills.name_required'), 'anchor' => '#skills'],
                    'safeguarding-revoked' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.safeguarding.revoked')],
                    'safeguarding-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.safeguarding.failed'), 'anchor' => '#safeguarding'],
                    'vetting-review-requested' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.safeguarding.vetting.review_requested_toast')],
                    'vetting-review-evidence-prohibited' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.safeguarding.vetting.no_documents'), 'anchor' => '#vetting-status'],
                    'vetting-review-unavailable' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.safeguarding.vetting.policy_unavailable_body'), 'anchor' => '#vetting-status'],
                    'vetting-review-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.safeguarding.vetting.review_error'), 'anchor' => '#vetting-status'],
                    'safeguarding-policy-reviewed' => ['type' => 'success', 'msg' => __('govuk_alpha.profile_settings.safeguarding.policy_review_confirmed')],
                    'safeguarding-policy-review-failed' => ['type' => 'error', 'msg' => __('govuk_alpha.profile_settings.safeguarding.policy_review_error'), 'anchor' => '#safeguarding-policy-review'],
                ];
                $accountStatus = $accountStatusMap[$status ?? ''] ?? null;
                // Field-level error helper: reuse the status map (its anchor IS the
                // field id) so a failing email/password form highlights the field.
                $fieldErrorFor = function (string $field) use ($accountStatus): ?string {
                    if ($accountStatus === null || ($accountStatus['type'] ?? '') !== 'error') {
                        return null;
                    }
                    return ltrim((string) ($accountStatus['anchor'] ?? ''), '#') === $field
                        ? $accountStatus['msg']
                        : null;
                };
            @endphp
            @if ($accountStatus)
                @if ($accountStatus['type'] === 'success')
                    <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="account-status-title">
                        <div class="govuk-notification-banner__header"><h2 class="govuk-notification-banner__title" id="account-status-title">{{ __('govuk_alpha.states.success_title') }}</h2></div>
                        <div class="govuk-notification-banner__content"><p class="govuk-notification-banner__heading">{{ $accountStatus['msg'] }}</p></div>
                    </div>
                @elseif ($accountStatus['type'] === 'info')
                    <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="account-status-title">
                        <div class="govuk-notification-banner__header"><h2 class="govuk-notification-banner__title" id="account-status-title">{{ __('govuk_alpha.states.important') }}</h2></div>
                        <div class="govuk-notification-banner__content"><p class="govuk-notification-banner__heading">{{ $accountStatus['msg'] }}</p></div>
                    </div>
                @else
                    <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
                        <div role="alert">
                            <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                            <div class="govuk-error-summary__body">
                                <ul class="govuk-list govuk-error-summary__list">
                                    <li><a href="{{ $accountStatus['anchor'] ?? '#new_email' }}">{{ $accountStatus['msg'] }}</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                @endif
            @endif

            <form method="post" action="{{ route('govuk-alpha.profile.settings.update', ['tenantSlug' => $tenantSlug]) }}" enctype="multipart/form-data" novalidate>
                @csrf

                <fieldset class="govuk-fieldset">
                    <legend class="govuk-fieldset__legend govuk-fieldset__legend--l">
                        <h2 class="govuk-fieldset__heading">{{ __('govuk_alpha.profile_settings.photo_title') }}</h2>
                    </legend>

                    @if (!empty($currentAvatar))
                        <img src="{{ $currentAvatar }}" alt="{{ __('govuk_alpha.profile_settings.photo_current_alt') }}" class="nexus-alpha-avatar nexus-alpha-avatar--xl govuk-!-margin-bottom-4" width="96" height="96">
                    @else
                        <p class="govuk-body">{{ __('govuk_alpha.profile_settings.photo_none') }}</p>
                    @endif

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="avatar">{{ __('govuk_alpha.profile_settings.photo_label') }}</label>
                        <div id="avatar-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.photo_hint') }}</div>
                        <input class="govuk-file-upload" id="avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/gif,image/webp" aria-describedby="avatar-hint">
                    </div>

                    @if (!empty($currentAvatar))
                        <div class="govuk-form-group">
                            <div class="govuk-checkboxes govuk-checkboxes--small" data-module="govuk-checkboxes">
                                <div class="govuk-checkboxes__item">
                                    <input class="govuk-checkboxes__input" id="remove_avatar" name="remove_avatar" type="checkbox" value="1">
                                    <label class="govuk-label govuk-checkboxes__label" for="remove_avatar">{{ __('govuk_alpha.profile_settings.photo_remove_label') }}</label>
                                </div>
                            </div>
                        </div>
                    @endif
                </fieldset>

                <fieldset class="govuk-fieldset govuk-!-margin-top-7">
                    <legend class="govuk-fieldset__legend govuk-fieldset__legend--l">
                        <h2 class="govuk-fieldset__heading">{{ __('govuk_alpha.profile_settings.personal_details') }}</h2>
                    </legend>

                    <div class="govuk-grid-row">
                        <div class="govuk-grid-column-one-half">
                            <div class="govuk-form-group">
                                <label class="govuk-label" for="first_name">{{ __('govuk_alpha.profile_settings.first_name_label') }}</label>
                                <input class="govuk-input" id="first_name" name="first_name" type="text" autocomplete="given-name" value="{{ $profile['first_name'] ?? '' }}">
                            </div>
                        </div>
                        <div class="govuk-grid-column-one-half">
                            <div class="govuk-form-group">
                                <label class="govuk-label" for="last_name">{{ __('govuk_alpha.profile_settings.last_name_label') }}</label>
                                <input class="govuk-input" id="last_name" name="last_name" type="text" autocomplete="family-name" value="{{ $profile['last_name'] ?? '' }}">
                            </div>
                        </div>
                    </div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="phone">{{ __('govuk_alpha.profile_settings.phone_label') }}</label>
                        <div id="phone-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.phone_hint') }}</div>
                        <input class="govuk-input govuk-!-width-two-thirds" id="phone" name="phone" type="tel" autocomplete="tel" value="{{ $profile['phone'] ?? '' }}" aria-describedby="phone-hint">
                    </div>
                </fieldset>

                <fieldset class="govuk-fieldset govuk-!-margin-top-7">
                    <legend class="govuk-fieldset__legend govuk-fieldset__legend--l">
                        <h2 class="govuk-fieldset__heading">{{ __('govuk_alpha.profile_settings.public_profile') }}</h2>
                    </legend>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="profile_type">{{ __('govuk_alpha.profile_settings.profile_type_label') }}</label>
                        <select class="govuk-select" id="profile_type" name="profile_type">
                            <option value="individual" @selected($profileType === 'individual')>{{ __('govuk_alpha.profile.profile_type_individual') }}</option>
                            <option value="organisation" @selected($profileType === 'organisation')>{{ __('govuk_alpha.profile.profile_type_organisation') }}</option>
                        </select>
                    </div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="organization_name">{{ __('govuk_alpha.profile_settings.organization_name_label') }}</label>
                        <input class="govuk-input" id="organization_name" name="organization_name" type="text" value="{{ $profile['organization_name'] ?? '' }}">
                    </div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="tagline">{{ __('govuk_alpha.profile_settings.tagline_label') }}</label>
                        <input class="govuk-input" id="tagline" name="tagline" type="text" value="{{ $profile['tagline'] ?? '' }}">
                    </div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="bio">{{ __('govuk_alpha.profile_settings.bio_label') }}</label>
                        <textarea class="govuk-textarea" id="bio" name="bio" rows="6">{{ $profile['bio'] ?? '' }}</textarea>
                    </div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="location">{{ __('govuk_alpha.profile_settings.location_label') }}</label>
                        <input class="govuk-input" id="location" name="location" type="text" autocomplete="address-level2" value="{{ $profile['location'] ?? '' }}">
                    </div>
                </fieldset>

                <fieldset class="govuk-fieldset govuk-!-margin-top-7" aria-describedby="privacy-profile-hint">
                    <legend class="govuk-fieldset__legend govuk-fieldset__legend--l">
                        <h2 class="govuk-fieldset__heading">{{ __('govuk_alpha.profile_settings.privacy_title') }}</h2>
                    </legend>
                    <div id="privacy-profile-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.privacy_profile_hint') }}</div>

                    <div class="govuk-form-group">
                        <label class="govuk-label" for="privacy_profile">{{ __('govuk_alpha.profile_settings.privacy_profile_label') }}</label>
                        <select class="govuk-select" id="privacy_profile" name="privacy_profile">
                            @foreach (['public', 'members', 'connections'] as $option)
                                <option value="{{ $option }}" @selected($privacyProfile === $option)>{{ __('govuk_alpha.profile_settings.privacy_options.' . $option) }}</option>
                            @endforeach
                        </select>
                    </div>

                    <div class="govuk-form-group">
                        <div class="govuk-checkboxes" data-module="govuk-checkboxes">
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="privacy_search" name="privacy_search" type="checkbox" value="1" @checked($privacySearch)>
                                <label class="govuk-label govuk-checkboxes__label" for="privacy_search">{{ __('govuk_alpha.profile_settings.privacy_search_label') }}</label>
                            </div>
                        </div>
                    </div>
                </fieldset>

                <fieldset class="govuk-fieldset govuk-!-margin-top-7" aria-describedby="marketing-hint">
                    <legend class="govuk-fieldset__legend govuk-fieldset__legend--l">
                        <h2 class="govuk-fieldset__heading">{{ __('govuk_alpha.profile_settings.marketing_title') }}</h2>
                    </legend>
                    <div id="marketing-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.marketing_hint') }}</div>

                    <div class="govuk-form-group">
                        <div class="govuk-checkboxes" data-module="govuk-checkboxes">
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="newsletter_opt_in" name="newsletter_opt_in" type="checkbox" value="1" @checked($marketingOptIn)>
                                <label class="govuk-label govuk-checkboxes__label" for="newsletter_opt_in">{{ __('govuk_alpha.profile_settings.marketing_label') }}</label>
                            </div>
                        </div>
                    </div>
                </fieldset>

                <button class="govuk-button govuk-!-margin-top-4" data-module="govuk-button" type="submit">{{ __('govuk_alpha.actions.save_changes') }}</button>
            </form>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="skills-heading" id="skills">
                <h2 class="govuk-heading-l" id="skills-heading">{{ __('govuk_alpha.profile_settings.skills.title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.skills.description') }}</p>

                @if (empty($mySkills))
                    <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha.profile_settings.skills.none') }}</p></div>
                @else
                    <ul class="govuk-list nexus-alpha-skill-list">
                        @foreach ($mySkills as $skill)
                            @php $skillEndorsements = (int) ($skill['endorsement_count'] ?? 0); @endphp
                            <li>
                                <span class="govuk-!-font-weight-bold">{{ $skill['skill_name'] ?? '' }}</span>
                                @if (!empty($skill['is_offering']))
                                    <strong class="govuk-tag govuk-tag--blue">{{ __('govuk_alpha.profile.skill_offering') }}</strong>
                                @endif
                                @if (!empty($skill['is_requesting']))
                                    <strong class="govuk-tag govuk-tag--purple">{{ __('govuk_alpha.profile.skill_requesting') }}</strong>
                                @endif
                                @if ($skillEndorsements > 0)
                                    <strong class="govuk-tag govuk-tag--green">{{ trans_choice('govuk_alpha.profile.endorsement_count', $skillEndorsements, ['count' => $skillEndorsements]) }}</strong>
                                @endif
                                <form method="post" action="{{ route('govuk-alpha.profile.skills.remove', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-margin-top-1">
                                    @csrf
                                    <input type="hidden" name="user_skill_id" value="{{ $skill['id'] ?? '' }}">
                                    <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.skills.remove_button') }}<span class="govuk-visually-hidden"> {{ $skill['skill_name'] ?? '' }}</span></button>
                                </form>
                            </li>
                        @endforeach
                    </ul>
                @endif

                <form method="post" action="{{ route('govuk-alpha.profile.skills.add', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-margin-top-4">
                    @csrf
                    <div class="govuk-form-group">
                        <label class="govuk-label" for="skill_name">{{ __('govuk_alpha.profile_settings.skills.add_label') }}</label>
                        <div id="skill-name-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.skills.add_hint') }}</div>
                        <input class="govuk-input govuk-!-width-two-thirds" id="skill_name" name="skill_name" type="text" maxlength="100" aria-describedby="skill-name-hint">
                    </div>
                    <fieldset class="govuk-fieldset govuk-!-margin-bottom-3">
                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha.profile_settings.skills.type_legend') }}</legend>
                        <div class="govuk-checkboxes govuk-checkboxes--small" data-module="govuk-checkboxes">
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="is_offering" name="is_offering" type="checkbox" value="1" checked>
                                <label class="govuk-label govuk-checkboxes__label" for="is_offering">{{ __('govuk_alpha.profile_settings.skills.offering') }}</label>
                            </div>
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="is_requesting" name="is_requesting" type="checkbox" value="1">
                                <label class="govuk-label govuk-checkboxes__label" for="is_requesting">{{ __('govuk_alpha.profile_settings.skills.requesting') }}</label>
                            </div>
                        </div>
                    </fieldset>
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.skills.add_button') }}</button>
                </form>
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="security-heading">
                <h2 class="govuk-heading-l" id="security-heading">{{ __('govuk_alpha.profile_settings.security_title') }}</h2>

                @if (($twoFactorEnrollmentAllowed ?? true) || ($twoFactorEnabled ?? false))
                <h3 class="govuk-heading-m">{{ __('govuk_alpha.profile_settings.two_factor_heading') }}</h3>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.two_factor_intro') }}</p>
                <p class="govuk-body">
                    <a class="govuk-link" href="{{ route('govuk-alpha.profile.2fa', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.profile_settings.two_factor_link') }}</a>
                </p>
                @endif
                <p class="govuk-body">
                    <a class="govuk-link" href="{{ route('govuk-alpha.profile.blocked', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.profile_settings.blocked_link') }}</a>
                </p>

                <h3 class="govuk-heading-m govuk-!-margin-top-6">{{ __('govuk_alpha.profile_settings.email_heading') }}</h3>
                <form method="post" action="{{ route('govuk-alpha.profile.email.update', ['tenantSlug' => $tenantSlug]) }}" novalidate>
                    @csrf
                    @php $newEmailError = $fieldErrorFor('new_email'); @endphp
                    <div class="govuk-form-group{{ $newEmailError ? ' govuk-form-group--error' : '' }}">
                        <label class="govuk-label" for="new_email">{{ __('govuk_alpha.profile_settings.email_label') }}</label>
                        @if ($newEmailError)
                            <p id="new_email-error" class="govuk-error-message"><span class="govuk-visually-hidden">{{ __('govuk_alpha.states.error_prefix') }}</span> {{ $newEmailError }}</p>
                        @endif
                        <input class="govuk-input govuk-!-width-two-thirds{{ $newEmailError ? ' govuk-input--error' : '' }}" id="new_email" name="email" type="email" autocomplete="email" value="{{ old('email', $currentEmail ?? '') }}" @if ($newEmailError) aria-describedby="new_email-error" @endif>
                    </div>
                    @php $emailPwError = $fieldErrorFor('email_current_password'); @endphp
                    <div class="govuk-form-group{{ $emailPwError ? ' govuk-form-group--error' : '' }}">
                        <label class="govuk-label" for="email_current_password">{{ __('govuk_alpha.profile_settings.confirm_password_label') }}</label>
                        <div id="email-current-password-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.confirm_password_hint') }}</div>
                        @if ($emailPwError)
                            <p id="email_current_password-error" class="govuk-error-message"><span class="govuk-visually-hidden">{{ __('govuk_alpha.states.error_prefix') }}</span> {{ $emailPwError }}</p>
                        @endif
                        <input class="govuk-input govuk-!-width-two-thirds{{ $emailPwError ? ' govuk-input--error' : '' }}" id="email_current_password" name="current_password" type="password" autocomplete="current-password" aria-describedby="email-current-password-hint{{ $emailPwError ? ' email_current_password-error' : '' }}">
                    </div>
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.email_submit') }}</button>
                </form>

                <h3 class="govuk-heading-m govuk-!-margin-top-6">{{ __('govuk_alpha.profile_settings.password_heading') }}</h3>
                <form method="post" action="{{ route('govuk-alpha.profile.password.update', ['tenantSlug' => $tenantSlug]) }}" novalidate>
                    @csrf
                    @php $currentPwError = $fieldErrorFor('current_password'); @endphp
                    <div class="govuk-form-group{{ $currentPwError ? ' govuk-form-group--error' : '' }}">
                        <label class="govuk-label" for="current_password">{{ __('govuk_alpha.profile_settings.current_password_label') }}</label>
                        @if ($currentPwError)
                            <p id="current_password-error" class="govuk-error-message"><span class="govuk-visually-hidden">{{ __('govuk_alpha.states.error_prefix') }}</span> {{ $currentPwError }}</p>
                        @endif
                        <input class="govuk-input govuk-!-width-two-thirds{{ $currentPwError ? ' govuk-input--error' : '' }}" id="current_password" name="current_password" type="password" autocomplete="current-password" @if ($currentPwError) aria-describedby="current_password-error" @endif>
                    </div>
                    @php $newPwError = $fieldErrorFor('new_password'); @endphp
                    <div class="govuk-form-group{{ $newPwError ? ' govuk-form-group--error' : '' }}">
                        <label class="govuk-label" for="new_password">{{ __('govuk_alpha.profile_settings.new_password_label') }}</label>
                        <div id="new-password-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.new_password_hint') }}</div>
                        @if ($newPwError)
                            <p id="new_password-error" class="govuk-error-message"><span class="govuk-visually-hidden">{{ __('govuk_alpha.states.error_prefix') }}</span> {{ $newPwError }}</p>
                        @endif
                        <input class="govuk-input govuk-!-width-two-thirds{{ $newPwError ? ' govuk-input--error' : '' }}" id="new_password" name="new_password" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="new-password-hint{{ $newPwError ? ' new_password-error' : '' }}">
                    </div>
                    @php $confirmPwError = $fieldErrorFor('new_password_confirmation'); @endphp
                    <div class="govuk-form-group{{ $confirmPwError ? ' govuk-form-group--error' : '' }}">
                        <label class="govuk-label" for="new_password_confirmation">{{ __('govuk_alpha.profile_settings.new_password_confirm_label') }}</label>
                        @if ($confirmPwError)
                            <p id="new_password_confirmation-error" class="govuk-error-message"><span class="govuk-visually-hidden">{{ __('govuk_alpha.states.error_prefix') }}</span> {{ $confirmPwError }}</p>
                        @endif
                        <input class="govuk-input govuk-!-width-two-thirds{{ $confirmPwError ? ' govuk-input--error' : '' }}" id="new_password_confirmation" name="new_password_confirmation" type="password" autocomplete="new-password" spellcheck="false" @if ($confirmPwError) aria-describedby="new_password_confirmation-error" @endif>
                    </div>
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.password_submit') }}</button>
                </form>

                @if (($passkeyEnrollmentAllowed ?? true) || !empty($passkeys))
                <h3 class="govuk-heading-m govuk-!-margin-top-6" id="passkeys">{{ __('govuk_alpha.profile_settings.passkeys.title') }}</h3>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.passkeys.description') }}</p>

                @php
                    $passkeyDate = fn ($value): ?string => $value ? \Illuminate\Support\Carbon::parse($value)->translatedFormat('j F Y') : null;
                @endphp

                @if (empty($passkeys))
                    <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha.profile_settings.passkeys.none') }}</p></div>
                @else
                    @foreach ($passkeys as $pk)
                        @php
                            $pkName = trim((string) ($pk['device_name'] ?? '')) !== '' ? $pk['device_name'] : __('govuk_alpha.profile_settings.passkeys.unnamed');
                            $pkType = ($pk['authenticator_type'] ?? '') === 'platform'
                                ? __('govuk_alpha.profile_settings.passkeys.type_platform')
                                : __('govuk_alpha.profile_settings.passkeys.type_cross_platform');
                        @endphp
                        <div class="nexus-alpha-card govuk-!-margin-bottom-4">
                            <h3 class="govuk-heading-s govuk-!-margin-bottom-2">{{ $pkName }}</h3>
                            <dl class="nexus-alpha-inline-list govuk-!-margin-bottom-3">
                                <div>
                                    <dt>{{ __('govuk_alpha.profile_settings.passkeys.type') }}</dt>
                                    <dd>{{ $pkType }}</dd>
                                </div>
                                <div>
                                    <dt>{{ __('govuk_alpha.profile_settings.passkeys.added') }}</dt>
                                    <dd>{{ $passkeyDate($pk['created_at'] ?? null) ?? '—' }}</dd>
                                </div>
                                <div>
                                    <dt>{{ __('govuk_alpha.profile_settings.passkeys.last_used') }}</dt>
                                    <dd>{{ $passkeyDate($pk['last_used_at'] ?? null) ?? __('govuk_alpha.profile_settings.passkeys.never') }}</dd>
                                </div>
                            </dl>
                            <form method="post" action="{{ route('govuk-alpha.profile.passkeys.rename', ['tenantSlug' => $tenantSlug]) }}" class="govuk-!-margin-bottom-2">
                                @csrf
                                <input type="hidden" name="credential_id" value="{{ $pk['credential_id'] ?? '' }}">
                                <div class="govuk-form-group govuk-!-margin-bottom-2">
                                    <label class="govuk-label" for="rename-{{ $loop->index }}">{{ __('govuk_alpha.profile_settings.passkeys.rename_label') }}</label>
                                    <input class="govuk-input govuk-!-width-two-thirds" id="rename-{{ $loop->index }}" name="device_name" type="text" value="{{ $pk['device_name'] ?? '' }}" maxlength="100">
                                </div>
                                <div class="govuk-form-group govuk-!-margin-bottom-2">
                                    <label class="govuk-label" for="rename-password-{{ $loop->index }}">{{ __('govuk_alpha.profile_settings.current_password_label') }}</label>
                                    <input class="govuk-input govuk-!-width-two-thirds" id="rename-password-{{ $loop->index }}" name="current_password" type="password" autocomplete="current-password" required>
                                </div>
                                <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.passkeys.rename_submit') }}</button>
                            </form>
                            <details class="govuk-details govuk-!-margin-bottom-0" data-module="govuk-details">
                                <summary class="govuk-details__summary">
                                    <span class="govuk-details__summary-text">{{ __('govuk_alpha.profile_settings.passkeys.remove_submit') }}<span class="govuk-visually-hidden"> {{ $pkName }}</span></span>
                                </summary>
                                <div class="govuk-details__text">
                                    <div class="govuk-warning-text">
                                        <span class="govuk-warning-text__icon" aria-hidden="true">!</span>
                                        <strong class="govuk-warning-text__text">
                                            <span class="govuk-visually-hidden">{{ __('govuk_alpha.states.warning_prefix') }}</span>
                                            {{ __('govuk_alpha.ux.confirm_irreversible') }}
                                        </strong>
                                    </div>
                                    <form method="post" action="{{ route('govuk-alpha.profile.passkeys.remove', ['tenantSlug' => $tenantSlug]) }}">
                                        @csrf
                                        <input type="hidden" name="credential_id" value="{{ $pk['credential_id'] ?? '' }}">
                                        <div class="govuk-form-group">
                                            <label class="govuk-label" for="remove-password-{{ $loop->index }}">{{ __('govuk_alpha.profile_settings.current_password_label') }}</label>
                                            <input class="govuk-input govuk-!-width-two-thirds" id="remove-password-{{ $loop->index }}" name="current_password" type="password" autocomplete="current-password" required>
                                        </div>
                                        <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.passkeys.remove_submit') }}<span class="govuk-visually-hidden"> {{ $pkName }}</span></button>
                                    </form>
                                </div>
                            </details>
                        </div>
                    @endforeach
                @endif

                @if ($passkeyEnrollmentAllowed ?? true)
                <details class="govuk-details govuk-!-margin-top-4">
                    <summary class="govuk-details__summary">
                        <span class="govuk-details__summary-text">{{ __('govuk_alpha.profile_settings.passkeys.add_title') }}</span>
                    </summary>
                    <div class="govuk-details__text">
                        <p class="govuk-body">{{ __('govuk_alpha.profile_settings.passkeys.add_description') }}</p>
                    </div>
                </details>
                @endif
                @endif

                <h3 class="govuk-heading-m govuk-!-margin-top-6" id="sessions">{{ __('govuk_alpha.profile_settings.sessions.title') }}</h3>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.sessions.description') }}</p>
                @if (empty($sessions))
                    <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha.profile_settings.sessions.none') }}</p></div>
                @else
                    <table class="govuk-table">
                        <caption class="govuk-table__caption govuk-table__caption--s govuk-visually-hidden">{{ __('govuk_alpha.profile_settings.sessions.title') }}</caption>
                        <thead class="govuk-table__head">
                            <tr class="govuk-table__row">
                                <th scope="col" class="govuk-table__header">{{ __('govuk_alpha.profile_settings.sessions.device') }}</th>
                                <th scope="col" class="govuk-table__header">{{ __('govuk_alpha.profile_settings.sessions.ip') }}</th>
                                <th scope="col" class="govuk-table__header">{{ __('govuk_alpha.profile_settings.sessions.last_active') }}</th>
                            </tr>
                        </thead>
                        <tbody class="govuk-table__body">
                            @foreach ($sessions as $sessionRow)
                                @php
                                    $ua = (string) ($sessionRow['user_agent'] ?? '');
                                    $deviceLabel = match (strtolower(trim((string) ($sessionRow['device_type'] ?? '')))) {
                                        'web' => __('govuk_alpha.ux.device_web'),
                                        'mobile' => __('govuk_alpha.ux.device_mobile'),
                                        'pwa' => __('govuk_alpha.ux.device_pwa'),
                                        default => __('govuk_alpha.ux.device_unknown'),
                                    };
                                    $lastActive = !empty($sessionRow['last_active']) || !empty($sessionRow['last_activity'])
                                        ? \Illuminate\Support\Carbon::parse($sessionRow['last_active'] ?? $sessionRow['last_activity'])->translatedFormat('j F Y, g:ia')
                                        : null;
                                @endphp
                                <tr class="govuk-table__row">
                                    <td class="govuk-table__cell">{{ $deviceLabel }}</td>
                                    <td class="govuk-table__cell">{{ $sessionRow['ip_address'] ?? '—' }}</td>
                                    <td class="govuk-table__cell">{{ $lastActive ?? '—' }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                @endif
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="language-heading">
                <h2 class="govuk-heading-l" id="language-heading">{{ __('govuk_alpha.profile_settings.language_title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.language_description') }}</p>
                <form method="post" action="{{ route('govuk-alpha.profile.language.update', ['tenantSlug' => $tenantSlug]) }}">
                    @csrf
                    <div class="govuk-form-group">
                        <label class="govuk-label" for="language">{{ __('govuk_alpha.profile_settings.language_label') }}</label>
                        <select class="govuk-select" id="language" name="language">
                            @foreach ($locales as $locale)
                                <option value="{{ $locale }}" @selected(($currentLanguage ?? 'en') === $locale)>{{ __('govuk_alpha.profile_settings.languages.' . $locale) }}</option>
                            @endforeach
                        </select>
                    </div>
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.language_submit') }}</button>
                </form>
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="notifications-heading" id="notifications">
                <h2 class="govuk-heading-l" id="notifications-heading">{{ __('govuk_alpha.profile_settings.notifications.title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.notifications.description') }}</p>

                @php
                    $notifGroups = [
                        'messages' => ['email_messages', 'email_connections', 'caring_smart_nudges', 'federation_notifications_enabled'],
                        'activity' => ['email_listings', 'email_events', 'email_transactions', 'email_reviews'],
                        'achievements' => ['email_gamification_digest', 'email_gamification_milestones', 'email_digest'],
                        'organisation' => ['email_org_payments', 'email_org_transfers', 'email_org_membership', 'email_org_admin'],
                        'push' => ['push_enabled', 'push_campaigns_opted_in'],
                    ];
                @endphp

                <form method="post" action="{{ route('govuk-alpha.profile.notifications.update', ['tenantSlug' => $tenantSlug]) }}">
                    @csrf
                    @foreach ($notifGroups as $group => $keys)
                        <fieldset class="govuk-fieldset govuk-!-margin-top-6">
                            <legend class="govuk-fieldset__legend govuk-fieldset__legend--m">
                                <h3 class="govuk-fieldset__heading">{{ __('govuk_alpha.profile_settings.notifications.groups.' . $group) }}</h3>
                            </legend>
                            <div class="govuk-checkboxes govuk-checkboxes--small" data-module="govuk-checkboxes">
                                @foreach ($keys as $key)
                                    <div class="govuk-checkboxes__item">
                                        <input class="govuk-checkboxes__input" id="notif_{{ $key }}" name="{{ $key }}" type="checkbox" value="1" @checked($notificationPrefs[$key] ?? false)>
                                        <label class="govuk-label govuk-checkboxes__label" for="notif_{{ $key }}">{{ __('govuk_alpha.profile_settings.notifications.labels.' . $key) }}</label>
                                    </div>
                                @endforeach
                            </div>
                        </fieldset>
                    @endforeach

                    <div class="govuk-form-group govuk-!-margin-top-6">
                        <label class="govuk-label govuk-label--m" for="digest_frequency">{{ __('govuk_alpha.profile_settings.notifications.digest_label') }}</label>
                        <div id="digest-frequency-hint" class="govuk-hint">{{ __('govuk_alpha.profile_settings.notifications.digest_hint') }}</div>
                        <select class="govuk-select" id="digest_frequency" name="digest_frequency" aria-describedby="digest-frequency-hint">
                            @foreach (['off', 'instant', 'daily', 'monthly'] as $freq)
                                <option value="{{ $freq }}" @selected(($digestFrequency ?? 'off') === $freq)>{{ __('govuk_alpha.profile_settings.notifications.digest_options.' . $freq) }}</option>
                            @endforeach
                        </select>
                    </div>

                    <button class="govuk-button govuk-!-margin-top-6" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.notifications.save') }}</button>
                </form>
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="match-preferences-heading" id="match-preferences">
                <h2 class="govuk-heading-l" id="match-preferences-heading">{{ __('govuk_alpha.profile_settings.match.title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.match.description') }}</p>
                <form method="post" action="{{ route('govuk-alpha.profile.match-preferences.update', ['tenantSlug' => $tenantSlug]) }}">
                    @csrf
                    <div class="govuk-form-group">
                        <label class="govuk-label" for="notification_frequency">{{ __('govuk_alpha.profile_settings.match.frequency_label') }}</label>
                        <select class="govuk-select" id="notification_frequency" name="notification_frequency">
                            @foreach (['daily', 'weekly', 'fortnightly', 'monthly', 'never'] as $freq)
                                <option value="{{ $freq }}" @selected(($matchPrefs['notification_frequency'] ?? 'monthly') === $freq)>{{ __('govuk_alpha.profile_settings.match.frequency.' . $freq) }}</option>
                            @endforeach
                        </select>
                    </div>
                    <fieldset class="govuk-fieldset govuk-!-margin-bottom-3">
                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha.profile_settings.match.instant_legend') }}</legend>
                        <div class="govuk-checkboxes govuk-checkboxes--small" data-module="govuk-checkboxes">
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="notify_hot_matches" name="notify_hot_matches" type="checkbox" value="1" @checked($matchPrefs['notify_hot_matches'] ?? true)>
                                <label class="govuk-label govuk-checkboxes__label" for="notify_hot_matches">{{ __('govuk_alpha.profile_settings.match.notify_hot') }}</label>
                            </div>
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="notify_mutual_matches" name="notify_mutual_matches" type="checkbox" value="1" @checked($matchPrefs['notify_mutual_matches'] ?? true)>
                                <label class="govuk-label govuk-checkboxes__label" for="notify_mutual_matches">{{ __('govuk_alpha.profile_settings.match.notify_mutual') }}</label>
                            </div>
                        </div>
                    </fieldset>
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.match.save') }}</button>
                </form>
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="personalisation-heading" id="personalisation">
                <h2 class="govuk-heading-l" id="personalisation-heading">{{ __('govuk_alpha.profile_settings.personalisation.title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.personalisation.description') }}</p>
                <form method="post" action="{{ route('govuk-alpha.profile.personalisation.update', ['tenantSlug' => $tenantSlug]) }}">
                    @csrf
                    <fieldset class="govuk-fieldset govuk-!-margin-bottom-3">
                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha.profile_settings.personalisation.options_legend') }}</legend>
                        <div class="govuk-checkboxes" data-module="govuk-checkboxes">
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="prefers_chronological" name="prefers_chronological" type="checkbox" value="1" @checked($prefersChronological ?? false) aria-describedby="prefers_chronological-hint">
                                <label class="govuk-label govuk-checkboxes__label" for="prefers_chronological">{{ __('govuk_alpha.profile_settings.personalisation.chronological_label') }}</label>
                                <div id="prefers_chronological-hint" class="govuk-hint govuk-checkboxes__hint">{{ __('govuk_alpha.profile_settings.personalisation.chronological_hint') }}</div>
                            </div>
                            <div class="govuk-checkboxes__item">
                                <input class="govuk-checkboxes__input" id="auto_translate_ugc" name="auto_translate_ugc" type="checkbox" value="1" @checked($autoTranslate ?? false) aria-describedby="auto_translate_ugc-hint">
                                <label class="govuk-label govuk-checkboxes__label" for="auto_translate_ugc">{{ __('govuk_alpha.profile_settings.personalisation.auto_translate_label') }}</label>
                                <div id="auto_translate_ugc-hint" class="govuk-hint govuk-checkboxes__hint">{{ __('govuk_alpha.profile_settings.personalisation.auto_translate_hint') }}</div>
                            </div>
                        </div>
                    </fieldset>
                    <div class="govuk-form-group">
                        <label class="govuk-label" for="auto_translate_target_locale">{{ __('govuk_alpha.profile_settings.personalisation.translate_into_label') }}</label>
                        <select class="govuk-select" id="auto_translate_target_locale" name="auto_translate_target_locale">
                            @foreach ($locales as $locale)
                                <option value="{{ $locale }}" @selected(($autoTranslateLocale ?? 'en') === $locale)>{{ __('govuk_alpha.profile_settings.languages.' . $locale) }}</option>
                            @endforeach
                        </select>
                    </div>
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.personalisation.save') }}</button>
                </form>
            </section>

            <hr class="govuk-section-break govuk-section-break--l govuk-section-break--visible">

            <section aria-labelledby="safeguarding-heading" id="safeguarding">
                <h2 class="govuk-heading-l" id="safeguarding-heading">{{ __('govuk_alpha.profile_settings.safeguarding.title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.description') }}</p>
                @php
                    $policyReviewRequired = collect($safeguarding ?? [])->contains(
                        static fn (array $preference): bool => (bool) ($preference['policy_review_required'] ?? false)
                    );
                    $vettingPolicy = is_array($vettingStatus['policy'] ?? null) ? $vettingStatus['policy'] : [];
                    $vettingDecision = (string) ($vettingStatus['decision'] ?? 'not_confirmed');
                    $vettingReviewPending = ($vettingStatus['review_status'] ?? null) === 'pending';
                    $vettingPolicyAvailable = (bool) ($vettingPolicy['configured'] ?? false)
                        && (bool) ($vettingPolicy['contact_policy_available'] ?? false);
                    $vettingAttestationCode = (string) ($vettingPolicy['attestation_code'] ?? '');
                    $vettingAttestationLabel = $vettingAttestationCode !== ''
                        ? __('safeguarding.attestations.' . $vettingAttestationCode)
                        : null;
                    $vettingStatusLabel = $vettingReviewPending
                        ? __('govuk_alpha.profile_settings.safeguarding.vetting.status_review_requested')
                        : match ($vettingDecision) {
                            'confirmed' => __('govuk_alpha.exchanges.confirmed'),
                            'revoked' => __('govuk_alpha.profile_settings.safeguarding.vetting.status_revoked'),
                            default => __('govuk_alpha.profile_settings.safeguarding.vetting.status_not_confirmed'),
                        };
                    $vettingTagClass = $vettingReviewPending
                        ? 'govuk-tag--yellow'
                        : match ($vettingDecision) {
                            'confirmed' => 'govuk-tag--green',
                            'revoked' => 'govuk-tag--red',
                            default => 'govuk-tag--grey',
                        };
                    $confirmedDate = !empty($vettingStatus['confirmed_at'] ?? null)
                        ? \Illuminate\Support\Carbon::parse($vettingStatus['confirmed_at'])->translatedFormat('j F Y')
                        : null;
                @endphp

                @if ($policyReviewRequired)
                    <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="safeguarding-policy-review-banner-title" id="safeguarding-policy-review">
                        <div class="govuk-notification-banner__header">
                            <h3 class="govuk-notification-banner__title" id="safeguarding-policy-review-banner-title">{{ __('govuk_alpha.states.important') }}</h3>
                        </div>
                        <div class="govuk-notification-banner__content">
                            <h3 class="govuk-notification-banner__heading">{{ __('govuk_alpha.profile_settings.safeguarding.policy_review_title') }}</h3>
                            <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.policy_review_body') }}</p>
                            <form method="post" action="{{ route('govuk-alpha.profile.safeguarding.policy-review', ['tenantSlug' => $tenantSlug]) }}">
                                @csrf
                                <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button" type="submit">{{ __('govuk_alpha.profile_settings.safeguarding.policy_review_confirm') }}</button>
                            </form>
                        </div>
                    </div>
                @endif

                <div class="nexus-alpha-card govuk-!-margin-bottom-6" id="vetting-status">
                    <h3 class="govuk-heading-m govuk-!-margin-bottom-2">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.title') }}</h3>
                    @if (!is_array($vettingStatus ?? null))
                        <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.status_unavailable') }}</p>
                    @else
                        <p class="govuk-body govuk-!-margin-bottom-2">
                            <strong class="govuk-tag {{ $vettingTagClass }}">{{ $vettingStatusLabel }}</strong>
                            @if ($vettingAttestationLabel !== null)
                                <span class="govuk-!-margin-left-2">{{ $vettingAttestationLabel }}</span>
                            @endif
                        </p>
                        @if ($vettingDecision === 'confirmed' && $confirmedDate !== null)
                            <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.confirmed_on', ['date' => $confirmedDate]) }}</p>
                        @elseif ($vettingReviewPending)
                            <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.review_pending_body') }}</p>
                        @elseif ($vettingPolicyAvailable)
                            <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.not_confirmed_body') }}</p>
                        @else
                            <p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.policy_unavailable_body') }}</p>
                        @endif
                    @endif
                    <div class="govuk-inset-text">{{ __('govuk_alpha.profile_settings.safeguarding.vetting.no_documents') }}</div>
                    @if (is_array($vettingStatus ?? null) && $vettingDecision !== 'confirmed' && $vettingPolicyAvailable)
                        <form method="post" action="{{ route('govuk-alpha.profile.safeguarding.vetting-review', ['tenantSlug' => $tenantSlug]) }}">
                            @csrf
                            <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button" type="submit" @disabled($vettingReviewPending)>
                                {{ $vettingReviewPending
                                    ? __('govuk_alpha.profile_settings.safeguarding.vetting.review_requested_button')
                                    : __('govuk_alpha.profile_settings.safeguarding.vetting.request_review_button') }}
                            </button>
                        </form>
                    @endif
                </div>

                @if (empty($safeguarding))
                    <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha.profile_settings.safeguarding.none') }}</p></div>
                @else
                    @foreach ($safeguarding as $pref)
                        @php
                            $activations = collect([
                                'restricts_messaging' => $pref['restricts_messaging'] ?? false,
                                'restricts_matching' => $pref['restricts_matching'] ?? false,
                                'requires_broker_approval' => $pref['requires_broker_approval'] ?? false,
                                'requires_vetted_interaction' => $pref['requires_vetted_interaction'] ?? false,
                            ])->filter()->keys();
                        @endphp
                        <div class="nexus-alpha-card govuk-!-margin-bottom-4">
                            <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ $pref['label'] ?? '' }}</h3>
                            @if (!empty($pref['description']))
                                <p class="govuk-body-s nexus-alpha-meta">{{ $pref['description'] }}</p>
                            @endif
                            @if ($activations->isNotEmpty())
                                <ul class="govuk-list govuk-list--bullet govuk-body-s">
                                    @foreach ($activations as $activation)
                                        <li>{{ __('govuk_alpha.profile_settings.safeguarding.activations.' . $activation) }}</li>
                                    @endforeach
                                </ul>
                            @endif
                            <form method="post" action="{{ route('govuk-alpha.profile.safeguarding.revoke', ['tenantSlug' => $tenantSlug]) }}">
                                @csrf
                                <input type="hidden" name="option_id" value="{{ $pref['option_id'] ?? '' }}">
                                <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.profile_settings.safeguarding.revoke_button') }}<span class="govuk-visually-hidden"> {{ $pref['label'] ?? '' }}</span></button>
                            </form>
                        </div>
                    @endforeach
                @endif
            </section>

            <hr class="govuk-section-break govuk-section-break--xl govuk-section-break--visible">

            <section aria-labelledby="data-privacy-heading">
                <h2 class="govuk-heading-l" id="data-privacy-heading">{{ __('govuk_alpha.profile_settings.data_title') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.data_description') }}</p>

                <h3 class="govuk-heading-m" id="data-export">{{ __('govuk_alpha.profile_settings.data_export_heading') }}</h3>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.data_export_body') }}</p>
                <form method="post" action="{{ route('govuk-alpha.profile.data-export', ['tenantSlug' => $tenantSlug]) }}">
                    @csrf
                    <button class="govuk-button govuk-button--secondary" data-module="govuk-button" type="submit">{{ __('govuk_alpha.actions.download_data') }}</button>
                </form>

                <h3 class="govuk-heading-m govuk-!-margin-top-4">{{ __('govuk_alpha.profile_settings.delete_heading') }}</h3>
                <p class="govuk-body">{{ __('govuk_alpha.profile_settings.delete_body') }}</p>
                <a class="govuk-button govuk-button--warning" data-module="govuk-button" href="{{ route('govuk-alpha.profile.delete', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.actions.delete_account') }}</a>
            </section>
        </div>
    </div>
@endsection
