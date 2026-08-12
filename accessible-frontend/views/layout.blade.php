{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" dir="{{ $alphaTextDirection ?? 'ltr' }}" class="govuk-template">
<head>
    @php
        $serviceName = __('govuk_alpha.service_name');
        $pageTitle = $title ?? $serviceName;
        $fullTitle = $pageTitle === $serviceName ? $serviceName : $pageTitle . ' - ' . $serviceName;
    @endphp
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>{{ $fullTitle }}</title>
    @if (!empty($metaDescription))
        <meta name="description" content="{{ $metaDescription }}">
        <meta property="og:description" content="{{ $metaDescription }}">
        <meta name="twitter:description" content="{{ $metaDescription }}">
    @endif
    @if (!empty($robotsDirective))
        <meta name="robots" content="{{ $robotsDirective }}">
    @endif
    @if (!empty($canonicalUrl))
        <link rel="canonical" href="{{ $canonicalUrl }}">
        <meta property="og:url" content="{{ $canonicalUrl }}">
    @endif
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{ $fullTitle }}">
    <meta property="og:site_name" content="{{ $serviceName }}">
    @php
        $ogImageResolved = ($ogImage ?? null) ?: ($defaultOgImage ?? null);
        $ogImageAltResolved = ($ogImageAlt ?? null) ?: __('govuk_alpha.seo.og_image_alt');
    @endphp
    @if (!empty($ogImageResolved))
        <meta property="og:image" content="{{ $ogImageResolved }}">
        @empty($ogImage)
            <meta property="og:image:width" content="1200">
            <meta property="og:image:height" content="630">
        @endempty
        <meta property="og:image:alt" content="{{ $ogImageAltResolved }}">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:image" content="{{ $ogImageResolved }}">
        <meta name="twitter:image:alt" content="{{ $ogImageAltResolved }}">
    @endif
    @foreach (($assetEntrypoint['css'] ?? []) as $stylesheet)
        <link rel="stylesheet" href="{{ $stylesheet }}">
    @endforeach
    @php
        // Per-tenant header theming. All values are server-validated #rrggbb so
        // they are safe to inline. The stylesheet reads these custom properties
        // with the stock GOV.UK black/blue as fallbacks, so an unset tenant is
        // untouched. When a custom background is set but no accent is chosen, we
        // default the accent line to the background so two mismatched blues never
        // stack — keeping the bar clean.
        $alphaHeaderVars = [];
        if (!empty($alphaHeaderBg)) {
            $alphaHeaderVars[] = '--nexus-alpha-header-bg:' . $alphaHeaderBg;
            if (!empty($alphaHeaderFg)) {
                $alphaHeaderVars[] = '--nexus-alpha-header-fg:' . $alphaHeaderFg;
            }
            if (!empty($alphaHeaderFgHover)) {
                $alphaHeaderVars[] = '--nexus-alpha-header-fg-hover:' . $alphaHeaderFgHover;
            }
        }
        $alphaAccent = (!empty($alphaHeaderAccent)) ? $alphaHeaderAccent : (!empty($alphaHeaderBg) ? $alphaHeaderBg : null);
        if (!empty($alphaAccent)) {
            $alphaHeaderVars[] = '--nexus-alpha-header-accent:' . $alphaAccent;
        }
    @endphp
    @if (!empty($alphaHeaderVars))
        <style>:root{ {{ implode(';', $alphaHeaderVars) }} }</style>
    @endif
    @stack('alpha_head')
</head>
<body class="govuk-template__body">
    {{-- GOV.UK progressive enhancement: only claim JS support when JS actually runs --}}
    <script nonce="{{ $cspNonce ?? request()->attributes->get('csp_nonce', '') }}">document.body.className += ' js-enabled' + ('noModule' in HTMLScriptElement.prototype ? ' govuk-frontend-supported' : '');</script>
    {{-- GOV.UK cookie banner — first thing in the body, before the skip link (no-JS). --}}
    @include('accessible-frontend::partials.cookie-banner')
    <a href="#main-content" class="govuk-skip-link" data-module="govuk-skip-link">{{ __('govuk_alpha.skip_to_content') }}</a>

    <header class="nexus-alpha-header" role="banner">
        <div class="govuk-width-container nexus-alpha-header__container">
            @php
                $brandText = !empty($tenantSlug) ? ($tenant['name'] ?? $tenantSlug) : __('govuk_alpha.service_name');
                // Header is always dark, so prefer the dark-background logo variant.
                $brandLogo = ($tenantLogoDarkUrl ?? null) ?: ($tenantLogoUrl ?? null);
            @endphp
            <a class="nexus-alpha-header__brand govuk-!-font-size-24" href="{{ $tenantSlug ? route('govuk-alpha.home', ['tenantSlug' => $tenantSlug]) : route('govuk-alpha.tenant-chooser') }}">
                @if (!empty($brandLogo))
                    {{-- No fixed width/height: logos vary per tenant; CSS (.nexus-alpha-header__logo--*) drives the height by shape. A hardcoded height defeats that sizing. --}}
                    <img class="nexus-alpha-header__logo nexus-alpha-header__logo--{{ $tenantLogoShape ?? 'landscape' }}" src="{{ $brandLogo }}" alt="{{ $brandText }}" decoding="async">
                @else
                    {{ $brandText }}
                @endif
            </a>
            <nav class="nexus-alpha-header__links" aria-label="{{ __('govuk_alpha.header.links_label') }}">
                @if (!empty($alphaLocaleOptions) && count($alphaLocaleOptions) > 1)
                    {{-- Global, no-JS language switcher: a GET form that reloads the
                         current page with ?locale=xx (honoured + persisted by the
                         AlphaSetLocale middleware). Existing query params are kept. --}}
                    <form method="get" action="{{ url()->current() }}" class="nexus-alpha-lang" aria-label="{{ __('govuk_alpha.header.language_label') }}">
                        @foreach (request()->except(['locale']) as $qKey => $qVal)
                            @if (is_scalar($qVal))
                                <input type="hidden" name="{{ $qKey }}" value="{{ $qVal }}">
                            @endif
                        @endforeach
                        <label class="govuk-visually-hidden" for="alpha-locale-select">{{ __('govuk_alpha.header.language_label') }}</label>
                        <select class="govuk-select nexus-alpha-lang__select" id="alpha-locale-select" name="locale">
                            @foreach ($alphaLocaleOptions as $code => $label)
                                <option value="{{ $code }}" @selected($code === ($alphaCurrentLocale ?? 'en'))>{{ $label }}</option>
                            @endforeach
                        </select>
                        <button type="submit" class="govuk-button govuk-button--secondary nexus-alpha-lang__submit govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.header.language_submit') }}</button>
                    </form>
                @endif
                @if (!empty($tenantSlug))
                    @if ($isAuthenticated ?? false)
                        {{-- The "My account" hub gathers all personal items — wallet,
                             messages, connections, matches, group exchanges, gamification,
                             profile and settings — so the header and service nav stay lean. --}}
                        <a class="nexus-alpha-header__link" href="{{ route('govuk-alpha.account', ['tenantSlug' => $tenantSlug]) }}" @if (in_array(($activeNav ?? ''), ['account', 'profile', 'messages', 'connections', 'wallet', 'matches', 'group_exchanges', 'achievements', 'leaderboard', 'nexus_score'], true)) aria-current="page" @endif>
                            {{ __('govuk_alpha.nav.account') }}
                            @if (($alphaUnreadMessages ?? 0) > 0)
                                <span class="nexus-alpha-nav-badge" aria-hidden="true">{{ $alphaUnreadMessages > 99 ? '99+' : $alphaUnreadMessages }}</span>
                                <span class="govuk-visually-hidden">{{ trans_choice('govuk_alpha.messages.unread_count', $alphaUnreadMessages, ['count' => $alphaUnreadMessages]) }}</span>
                            @endif
                        </a>
                    @endif
                @endif
            </nav>
        </div>
    </header>

    @if (!empty($tenantSlug))
        <section class="govuk-service-navigation" data-module="govuk-service-navigation" aria-label="{{ __('govuk_alpha.service_information_label') }}">
            <div class="govuk-width-container">
                <div class="govuk-service-navigation__container">
                    <nav class="govuk-service-navigation__wrapper" aria-label="{{ __('govuk_alpha.navigation_label') }}">
                        <button type="button" class="govuk-service-navigation__toggle govuk-js-service-navigation-toggle" aria-controls="alpha-navigation" hidden aria-hidden="true">
                            {{ __('govuk_alpha.nav.menu') }}
                        </button>
                        <ul class="govuk-service-navigation__list" id="alpha-navigation">
                            @foreach (($alphaNavItems ?? []) as $key => $href)
                                <li class="govuk-service-navigation__item {{ ($activeNav ?? '') === $key ? 'govuk-service-navigation__item--active' : '' }}">
                                    <a class="govuk-service-navigation__link" href="{{ $href }}" @if (($activeNav ?? '') === $key) aria-current="page" @endif>
                                        @if (($activeNav ?? '') === $key)
                                            <strong class="govuk-service-navigation__active-fallback">{{ __('govuk_alpha.nav.' . $key) }}</strong>
                                        @else
                                            {{ __('govuk_alpha.nav.' . $key) }}
                                        @endif
                                        @if ($key === 'messages' && ($alphaUnreadMessages ?? 0) > 0)
                                            <span class="nexus-alpha-nav-badge" aria-hidden="true">{{ $alphaUnreadMessages > 99 ? '99+' : $alphaUnreadMessages }}</span>
                                            <span class="govuk-visually-hidden">{{ trans_choice('govuk_alpha.messages.unread_count', $alphaUnreadMessages, ['count' => $alphaUnreadMessages]) }}</span>
                                        @endif
                                    </a>
                                </li>
                            @endforeach
                            @if (!($isAuthenticated ?? false))
                                <li class="govuk-service-navigation__item {{ ($activeNav ?? '') === 'login' ? 'govuk-service-navigation__item--active' : '' }}">
                                    <a class="govuk-service-navigation__link" href="{{ route('govuk-alpha.login', ['tenantSlug' => $tenantSlug]) }}" @if (($activeNav ?? '') === 'login') aria-current="page" @endif>
                                        @if (($activeNav ?? '') === 'login')
                                            <strong class="govuk-service-navigation__active-fallback">{{ __('govuk_alpha.nav.login') }}</strong>
                                        @else
                                            {{ __('govuk_alpha.nav.login') }}
                                        @endif
                                    </a>
                                </li>
                                <li class="govuk-service-navigation__item {{ ($activeNav ?? '') === 'register' ? 'govuk-service-navigation__item--active' : '' }}">
                                    <a class="govuk-service-navigation__link" href="{{ route('govuk-alpha.register', ['tenantSlug' => $tenantSlug]) }}" @if (($activeNav ?? '') === 'register') aria-current="page" @endif>
                                        @if (($activeNav ?? '') === 'register')
                                            <strong class="govuk-service-navigation__active-fallback">{{ __('govuk_alpha.nav.register') }}</strong>
                                        @else
                                            {{ __('govuk_alpha.nav.register') }}
                                        @endif
                                    </a>
                                </li>
                            @endif
                        </ul>
                    </nav>
                </div>
            </div>
        </section>
    @endif

    <div class="govuk-width-container">
        <div class="govuk-phase-banner">
            <p class="govuk-phase-banner__content">
                <strong class="govuk-tag govuk-phase-banner__content__tag">{{ __('govuk_alpha.phase') }}</strong>
                <span class="govuk-phase-banner__text">
                    <a class="govuk-link" href="{{ $feedbackUrl ?? __('govuk_alpha.feedback_url') }}">{{ __('govuk_alpha.feedback') }}</a>
                </span>
            </p>
        </div>
        <main class="govuk-main-wrapper" id="main-content" tabindex="-1">
            @yield('content')
        </main>
    </div>

    {{--
        Official GOV.UK footer (https://design-system.service.gov.uk/components/footer/).
        This is NOT an official UK government service, so the crown, the GOV.UK
        logotype, the Open Government Licence logo/text and the "Crown copyright"
        link are deliberately omitted. The AGPL Section 7(b) attribution and a
        link to the source repository are carried in govuk-footer__meta-custom.
    --}}
    <footer class="govuk-footer" role="contentinfo">
        <div class="govuk-width-container">
            @if (!empty($alphaFooterColumns))
                <div class="govuk-footer__navigation">
                    @foreach ($alphaFooterColumns as $column => $links)
                        <div class="govuk-footer__section govuk-grid-column-one-third">
                            <h2 class="govuk-footer__heading govuk-heading-m">{{ __('govuk_alpha.footer.columns.' . $column . '.heading') }}</h2>
                            <ul class="govuk-footer__list">
                                @foreach ($links as $key => $href)
                                    <li class="govuk-footer__list-item">
                                        <a class="govuk-footer__link" href="{{ $href }}">{{ __('govuk_alpha.footer.columns.' . $column . '.' . $key) }}</a>
                                    </li>
                                @endforeach
                            </ul>
                        </div>
                    @endforeach
                </div>
                <hr class="govuk-footer__section-break">
            @endif
            <div class="govuk-footer__meta">
                <div class="govuk-footer__meta-item govuk-footer__meta-item--grow">
                    <h2 class="govuk-visually-hidden">{{ __('govuk_alpha.footer.meta_label') }}</h2>
                    @if (!empty($tenantSlug))
                        {{-- GOV.UK footer utility links: report a problem with the current
                             page + change cookie settings, on every tenant page. --}}
                        <ul class="govuk-footer__inline-list">
                            <li class="govuk-footer__inline-list-item">
                                <a class="govuk-footer__link" href="{{ route('govuk-alpha.report-problem', ['tenantSlug' => $tenantSlug, 'return' => request()->getRequestUri()]) }}">{{ __('govuk_alpha.report_problem.footer_link') }}</a>
                            </li>
                            <li class="govuk-footer__inline-list-item">
                                <a class="govuk-footer__link" href="{{ route('govuk-alpha.cookies', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.cookie_settings.title') }}</a>
                            </li>
                        </ul>
                    @endif
                    @if (!empty($alphaSignOutUrl))
                        <ul class="govuk-footer__inline-list">
                            <li class="govuk-footer__inline-list-item">
                                {{-- Sign-out changes state, so it is a CSRF-protected POST form, not a GET link. --}}
                                <form method="post" action="{{ $alphaSignOutUrl }}" class="nexus-alpha-linkform">
                                    @csrf
                                    <button type="submit" class="govuk-footer__link nexus-alpha-linkbutton">{{ __('govuk_alpha.footer.sign_out') }}</button>
                                </form>
                            </li>
                        </ul>
                    @endif
                    <div class="govuk-footer__meta-custom">
                        <p class="govuk-!-margin-bottom-2">{{ __('govuk_alpha.footer.licence') }}</p>
                        <p class="govuk-!-margin-bottom-2">{{ __('govuk_alpha.footer.attribution') }}</p>
                        <p class="govuk-!-margin-bottom-0">
                            <a class="govuk-footer__link" href="https://github.com/jasperfordesq-ai/Project-NEXUS" rel="noopener noreferrer">{{ __('govuk_alpha.footer.source') }}</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </footer>

    @if (!empty($assetEntrypoint['js']))
        <script type="module" src="{{ $assetEntrypoint['js'] }}"></script>
    @endif
</body>
</html>
