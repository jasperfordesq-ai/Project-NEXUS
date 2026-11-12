{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
{{-- A thank-you note is private when it is sent: only the receiver sees it
     until they choose to show it on their profile. There is no public form. --}}
@component('mail::message')
# {{ __('emails.appreciation.title') }}

{{ __('emails.appreciation.body', ['sender' => $senderName ?? '']) }}

@component('mail::panel')
{{ $message ?? '' }}
@endcomponent

{{ __('emails.appreciation.private_note') }}

@component('mail::button', ['url' => $url ?? '#'])
{{ __('emails.appreciation.cta_view') }}
@endcomponent

{{ __('emails.common.signoff', ['app' => config('app.name')]) }}
@endcomponent
