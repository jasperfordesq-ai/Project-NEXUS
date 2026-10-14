{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
{{-- mail::layout rather than mail::message: the stock message header links
     config('app.url'), the API host. The header must point at the community
     the alert is about (email-links audit, 2026-10-14). --}}
@component('mail::layout')
@slot('header')
@component('mail::header', ['url' => $communityUrl])
{{ $communityName }}
@endcomponent
@endslot

# {{ __('safeguarding.critical.subject') }}

{{ __('safeguarding.critical.greeting', ['name' => $reporter]) }}

{{ __('safeguarding.critical.urgency') }}

- {{ __('safeguarding.critical.report_category', ['category' => $report['category'] ?? '—']) }}
- {{ __('safeguarding.critical.report_severity', ['severity' => $report['severity'] ?? 'critical']) }}
- {{ __('safeguarding.critical.sla_hours', ['hours' => $report['sla_hours'] ?? 4]) }}
- {{ __('safeguarding.critical.time_remaining', ['remaining' => $remaining]) }}

@component('mail::button', ['url' => $report['admin_url'] ?? '#'])
{{ __('safeguarding.critical.action_label') }}
@endcomponent

{{ __('safeguarding.critical.footer') }}

@slot('footer')
@component('mail::footer')
© {{ date('Y') }} {{ $communityName }}. {{ __('emails.footer.all_rights_reserved') }}
@endcomponent
@endslot
@endcomponent
