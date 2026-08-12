{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
{{-- Standalone GOV.UK error page (403/404/419/429/503) for the accessible
     frontend. Deliberately does NOT extend accessible-frontend::layout: it is
     rendered from the exception handler, where none of the controller shared
     data (nav items, footer columns, unread counts) is available, and where a
     second failure while rendering the error page must be impossible. --}}
<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" dir="{{ app()->getLocale() === 'ar' ? 'rtl' : 'ltr' }}" class="govuk-template">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>{{ $title }} - {{ __('govuk_alpha.service_name') }}</title>
    <meta name="robots" content="noindex">
    @foreach ($assetCss as $css)
        <link rel="stylesheet" href="{{ $css }}">
    @endforeach
</head>
<body class="govuk-template__body">
    <a href="#main-content" class="govuk-skip-link" data-module="govuk-skip-link">{{ __('govuk_alpha.skip_to_content') }}</a>
    <div class="govuk-width-container">
        <main class="govuk-main-wrapper" id="main-content">
            <div class="govuk-grid-row">
                <div class="govuk-grid-column-two-thirds">
                    <h1 class="govuk-heading-xl">{{ $title }}</h1>
                    <p class="govuk-body">{{ $body }}</p>
                    @if (!empty($homeUrl))
                        <p class="govuk-body">
                            <a class="govuk-link govuk-link--no-visited-state" href="{{ $homeUrl }}">{{ __('govuk_alpha.error_pages.home_link') }}</a>
                        </p>
                    @endif
                </div>
            </div>
        </main>
    </div>
    <footer class="govuk-footer">
        <div class="govuk-width-container">
            <div class="govuk-footer__meta">
                <div class="govuk-footer__meta-item govuk-footer__meta-item--grow">
                    {{-- AGPL Section 7(b) attribution — required on every page. --}}
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
</body>
</html>
