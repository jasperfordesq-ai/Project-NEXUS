<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Kaartjes voor evenementen',
    'intro' => 'Bekijk beschikbare tickettypes, claim vrije plaatsen en beheer uw eigen bevestigde gratis tickets.',
    'load_error' => 'De ticketcatalogus voor het evenement kan niet worden geladen.',
    'validation_error' => 'Controleer de ticketgegevens en probeer het opnieuw.',
    'allocate_error' => 'Het gratis ticket kon niet worden toegewezen. Controleer uw registratie, geschiktheid en de resterende toewijzing.',
    'cancel_error' => 'Het gratis ticket kon niet worden geannuleerd. Vernieuw de catalogus en probeer het opnieuw.',
    'allocated' => 'Uw gratis ticket is toegewezen.',
    'cancelled' => 'Uw gratis ticket is geannuleerd en teruggestuurd naar de toewijzing.',
    'back_to_event' => 'Terug naar evenement',
    'back_to_tickets' => 'Terug naar evenemententickets',
    'gateway_disabled' => 'Betaald afrekenen en afrekenen met tijdskrediet is niet mogelijk. Deze pagina brengt nooit geld of tijdskrediet in rekening en verandert niets aan uw portemonnee.',
    'my_tickets' => 'Mijn kaartjes',
    'no_tickets' => 'Je hebt geen ticket voor dit evenement.',
    'ticket_fallback' => 'Evenement kaartje',
    'units' => 'Hoeveelheid',
    'status_label' => 'Status',
    'status' => [
        'confirmed' => 'Bevestigd',
        'cancelled' => 'Geannuleerd',
    ],
    'cancel_ticket' => 'Ticket annuleren',
    'time_credit_cancel_disabled' => 'Annulering van tijdskrediettickets is niet beschikbaar in deze gratis workflow. Er is geen portemonnee-actie ondernomen.',
    'catalogue' => 'Beschikbare kaartjes',
    'catalogue_empty' => 'Er zijn geen tickettypes beschikbaar voor dit evenement.',
    'kind' => [
        'free' => 'Gratis',
        'time_credit' => 'Tijdkredieten',
    ],
    'remaining' => 'Resterende toewijzing',
    'member_limit' => 'Limiet per lid',
    'time_credit_disabled' => 'Dit type kost :credits tijdskredieten, maar het afrekenen is uitgeschakeld totdat de goedgekeurde portemonnee-gateway is verbonden. Er worden geen tegoeden afgeschreven.',
    'units_to_claim' => 'Aantal gratis kaartjes',
    'reconcile' => 'Voer afstemming uit',
    'reconciliation_clear' => 'Ticketinventaris en grootboekrecords worden op elkaar afgestemd.',
    'reconciliation_warnings' => '{1} :count afstemmingswaarschuwing|[2,*] :count afstemmingswaarschuwingen',
    'reconciliation_error' => 'Ticketafstemming kon niet worden voltooid.',
    'units_hint' => 'Bij deze toewijzing kunt u aanspraak maken op maximaal :count.',
    'claim_free' => 'Gratis kaartje claimen',
    'registration_required' => 'Je hebt een bevestigde evenementregistratie nodig voordat je aanspraak kunt maken op een gratis ticket.',
    'not_eligible' => 'U voldoet momenteel niet aan de geschiktheidsregels voor dit tickettype.',
    'sales_closed' => 'Dit tickettype staat momenteel niet open voor toewijzing.',
    'sold_out' => 'In deze toewijzing blijven er geen gratis tickets voor u over.',
    'cancel_title' => 'Dit gratis ticket annuleren?',
    'cancel_intro' => 'Vertel de organisator waarom je annuleert. De hoeveelheid wordt teruggestort in de gratis toewijzing.',
    'cancel_free_only' => 'Met deze actie wordt alleen een gratis recht geannuleerd. Er wordt geen restitutie verleend en er wordt geen portemonnee-saldo gewijzigd.',
    'reason_label' => 'Reden van annulering',
    'reason_hint' => 'Neem geen privé- of gevoelige informatie op. Maximaal 500 tekens.',
    'confirm_cancel' => 'Gratis ticket annuleren',
];
