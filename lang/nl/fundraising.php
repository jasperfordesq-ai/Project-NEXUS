<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'Die inzamelingscampagne is niet gevonden.',
    'organisation_locked' => 'Deze campagne heeft al giften ontvangen, dus de organisatie waarvoor ze geld inzamelt kan niet meer worden gewijzigd.',
    'organisation_not_eligible' => 'Alleen goedgekeurde organisaties kunnen inzamelingscampagnes voeren.',
    'not_your_campaign' => 'U kunt alleen campagnes van uw eigen organisatie beheren.',
    'handover_not_found' => 'Die overdracht is niet gevonden.',
    'handover_amount_positive' => 'Voer een bedrag in dat groter is dan nul.',
    'handover_exceeds_held' => 'Dat is meer dan deze campagne nog in beheer heeft (:held).',
    'handover_method_invalid' => 'Kies hoe het geld is doorgegeven.',
    'handover_reference_required' => 'Voer een betalingskenmerk in zodat de overboeking kan worden nagetrokken.',
    'handover_date_invalid' => 'Voer de datum in waarop het geld is doorgegeven. Deze mag niet in de toekomst liggen.',
    'handover_campaign_has_no_organisation' => 'Deze campagne is voor de hele gemeenschap, dus er is geen organisatie om geld aan over te dragen.',
    'handover_already_closed' => 'Deze overdracht is al bevestigd of geannuleerd.',
    'paused_by_community' => 'Een gemeenschapsbeheerder heeft deze campagne gepauzeerd, dus alleen de gemeenschap kan haar hervatten.',
    'cancel_reason_required' => 'Geef een reden op voor het annuleren van deze overdracht.',
    'email' => [
        'handover_subject' => ':community heeft :amount voor :campaign doorgegeven',
        'handover_title' => 'Geld doorgegeven aan :organisation',
        'handover_body' => ':community heeft vastgelegd dat :amount, opgehaald met de campagne ":campaign", op :date is doorgegeven (kenmerk :reference). Controleer of het is aangekomen en bevestig dit op het dashboard van uw organisatie.',
        'handover_cta' => 'Ontvangst bevestigen',
        'handover_bell' => ':community heeft :amount voor :campaign doorgegeven. Bevestig dat het is aangekomen.',
    ],
];
