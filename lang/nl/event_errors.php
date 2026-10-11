<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Inschrijvingsgegevens kunnen pas na afloop van het evenement worden beoordeeld voor verwijdering. Kies een datum na het einde van het evenement.',
        'settings_required' => 'Sla eerst de inschrijvingsinstellingen van dit evenement op. Daarin staat hoe lang inschrijvingsgegevens worden bewaard.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Dat verzendtijdstip is al verstreken. Kies een tijdstip in de toekomst of verstuur het bericht nu.',
        'post_event_too_early' => 'Een bericht voor na het evenement kan pas worden verstuurd als het evenement is afgelopen. Kies een tijdstip na het einde van het evenement.',
        'audience_empty' => 'Niemand zou dit bericht ontvangen. Kies een doelgroep met ten minste één persoon.',
        'channel_empty' => 'Kies ten minste één manier om dit bericht te versturen.',
        'body_invalid' => 'Schrijf een bericht van maximaal :max tekens.',
    ],
];
