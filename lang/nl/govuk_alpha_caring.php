<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 Wording rules that are not stylistic here.
 *
 * A caregiver link is consent-gated authority over another person's care. The
 * copy must never tell anyone the relationship is established before it is:
 * creating a request produces a PENDING record, the care recipient must agree,
 * and staff must separately verify that agreement. The React copy for the same
 * journey was changed away from "Care receiver linked successfully" for exactly
 * this reason, and these strings must not reintroduce it.
 *
 * Read by web-uk through scripts/sync-laravel-locales.php, which globs
 * lang/{locale}/govuk_alpha*.php. Every key added here must exist in all eleven
 * locales, TRANSLATED — the parity gate compares key sets only, so copying the
 * English value across satisfies it while leaving the string untranslated.
 */

return [
    'shared' => [
        'service_name' => 'Zorgzame gemeenschap',
        'back_to_caring' => 'Terug naar de zorgzame gemeenschap',
        'back_to_caregiver' => 'Terug naar je zorgzame relaties',
        'success_title' => 'Succes',
        'error_title' => 'Er is een probleem',
        'unknown_member' => 'Onbekend lid',
        'optional' => '(optioneel)',
    ],
    'hub' => [
        'title' => 'Zorgzame gemeenschap',
        'caption' => 'Zorg en ondersteuning',
        'intro' => 'Regel reguliere zorg voor een ander lid, of beantwoord een verzoek van iemand die heeft gevraagd om voor u te zorgen.',
        'caregiver_card_title' => 'Jouw zorgzame relaties',
        'caregiver_card_description' => 'Bekijk relaties waar u om heeft gevraagd, beantwoord verzoeken over u en gebruik de tools die een goedgekeurde relatie ontgrendelt.',
        'become_title' => 'Word een zorgverlener',
        'become_description' => 'Vraag om reguliere zorg voor een ander lid van deze gemeenschap. Niets wordt van kracht totdat zij ermee instemmen en het personeel dit heeft gecontroleerd.',
    ],
    'caregiver' => [
        'title' => 'Jouw zorgzame relaties',
        'caption' => 'Zorgzame gemeenschap',
        'intro' => 'Relaties waar u om heeft gevraagd, en hun huidige fase.',
        'none' => 'Je hebt nog niet gevraagd om voor iemand te zorgen.',
        'become_button' => 'Vraag om voor iemand te zorgen',
        'incoming_title' => 'Verzoeken over jou',
        'incoming_intro' => 'Deze leden hebben gevraagd om voor u te zorgen. Ga er alleen mee akkoord als je begrijpt en accepteert wat het betekent.',
        'incoming_explanation' => 'Als u akkoord gaat, zal het personeel het verzoek controleren voordat de relatie begint. Het eens worden begint niet vanzelf.',
        'incoming_none' => 'Niemand heeft gevraagd om voor je te zorgen.',
        'confirm_button' => 'Ik ga akkoord met deze relatie',
        'reject_button' => 'Ik ben het er niet mee eens',
        'status_heading' => 'Fase',
        'status_pending_recipient' => 'Wachten tot het andere lid akkoord gaat',
        'status_pending_staff' => 'Wachten op een veiligheidscontrole van het personeel',
        'status_active' => 'Goedgekeurd en actief',
        'status_rejected' => 'Niet goedgekeurd',
        'status_inactive' => 'Beëindigd',
        'relationship_heading' => 'Relatie',
        'relationship_family' => 'Familie',
        'relationship_friend' => 'Vriend',
        'relationship_neighbour' => 'Buurman',
        'relationship_professional' => 'Professionele verzorger',
        'started_heading' => 'De zorg is begonnen',
        'reason_heading' => 'Reden gegeven',
        'pending_no_tools' => 'Zolang een aanvraag in behandeling is, heeft u geen toegang tot de zorggegevens van dit lid.',
        'active_tools_title' => 'Wat deze relatie je laat doen',
        'request_on_behalf_link' => 'Vraag om hulp namens dit lid',
    ],
    'link' => [
        'title' => 'Vraag om voor iemand te zorgen',
        'caption' => 'Zorgzame gemeenschap',
        'intro' => 'Vraag om reguliere zorg voor een ander lid van deze gemeenschap.',
        'consent_warning' => 'Het lid dat u noemt, wordt gevraagd of hij of zij hiermee akkoord gaat. Het personeel zal vervolgens de aanvraag controleren. De relatie begint pas en levert je niets op, totdat beide zijn gebeurd.',
        'search_label' => 'Zoek het lid waarvoor u wilt zorgen',
        'search_hint' => 'Voer een deel van hun naam in en kies ze vervolgens uit de resultaten.',
        'search_button' => 'Zoekopdracht',
        'results_title' => 'Kies een lid',
        'results_none' => 'Er zijn geen leden die overeenkomen met die naam. Probeer een andere spelling.',
        'choose_button' => 'Kiezen',
        'chosen_label' => 'Lid dat u hebt gekozen',
        'change_button' => 'Wijziging',
        'relationship_label' => 'Jouw relatie tot hen',
        'start_date_label' => 'Datum waarop de zorg is gestart of zal starten',
        'start_date_hint' => 'Bijvoorbeeld 27 3 2026',
        'notes_label' => 'Alles wat het personeel moet weten',
        'notes_hint' => 'Optioneel. Dit wordt getoond aan de medewerker die de aanvraag controleert.',
        'submit_button' => 'Verstuur verzoek',
        'error_no_member' => 'Kies het lid waarvoor u wilt zorgen',
        'error_no_relationship' => 'Selecteer uw relatie met hen',
        'error_no_start_date' => 'Vul de datum in waarop de zorg is gestart of gaat starten',
        'error_bad_start_date' => 'Voer een echte datum in, bijvoorbeeld 27 3 2026',
        'error_search_too_short' => 'Voer minimaal twee tekens in om te zoeken',
    ],
    'on_behalf' => [
        'title' => 'Vraag om hulp namens iemand',
        'intro' => 'Vraag de community om praktische hulp voor het lid waarvoor u zorgt. Het verzoek wordt op hun naam vastgelegd en laat zien dat u het heeft gedaan.',
        'for_member' => 'Dit verzoek is voor',
        'title_label' => 'Welke hulp is nodig',
        'title_hint' => 'Bijvoorbeeld een lift naar een ziekenhuisafspraak.',
        'description_label' => 'Meer details',
        'when_label' => 'Wanneer het nodig is',
        'contact_label' => 'Hoe helpers contact moeten opnemen',
        'contact_phone' => 'Per telefoon',
        'contact_message' => 'Per bericht',
        'contact_either' => 'Beide zijn prima',
        'submit_button' => 'Verstuur verzoek',
        'error_no_title' => 'Vul in welke hulp nodig is',
        'error_not_active' => 'U kunt alleen om hulp vragen namens een lid wiens relatie is goedgekeurd',
    ],
    'review' => [
        'title' => 'Verzorger vraagt ​​om controle',
        'caption' => 'Zorgzame gemeenschap',
        'intro' => 'Controleer of de zorgontvanger ermee heeft ingestemd en leg vast hoe u dit heeft geverifieerd voordat u een zorgrelatie goedkeurt.',
        'none' => 'Er wachten geen verzoeken van zorgverleners om te worden gecontroleerd.',
        'requested_by' => 'Aangevraagd door',
        'requested_for' => 'Om voor te zorgen',
        'requested_on' => 'Aangevraagd op',
        'recipient_agreed' => 'Het lid heeft ingestemd',
        'recipient_not_agreed' => 'Het lid heeft nog niet ingestemd',
        'blocked_until_agreed' => 'U kunt dit verzoek pas goedkeuren als het lid ermee heeft ingestemd.',
        'evidence_label' => 'Hoe u hun toestemming heeft geverifieerd',
        'evidence_hint' => 'Bijvoorbeeld een telefoontje op 27 maart 2026 met het lid zelf.',
        'attestation_label' => 'Ik bevestig dat ik de toestemming van dit lid zelf heb geverifieerd',
        'approve_button' => 'Relatie goedkeuren',
        'reject_label' => 'Waarom u dit verzoek weigert',
        'reject_hint' => 'Dit wordt geregistreerd en getoond aan het lid dat erom vraagt.',
        'reject_button' => 'Verzoek weigeren',
        'decided_approved' => 'Goedgekeurd',
        'decided_rejected' => 'Geweigerd',
        'error_no_evidence' => 'Voer in hoe u hun toestemming heeft geverifieerd',
        'error_no_attestation' => 'Bevestig dat u de toestemming van dit lid zelf heeft geverifieerd',
        'error_no_reason' => 'Vul in waarom u dit verzoek weigert',
    ],
    'status' => [
        'link_requested' => 'Uw aanvraag is verzonden. Het is wachten tot het andere lid akkoord gaat, en dan op een personeelscontrole.',
        'link_failed' => 'Uw verzoek kon niet worden verzonden.',
        'link_duplicate' => 'U heeft al een verzoek of een goedgekeurde relatie met dat lid.',
        'incoming_confirmed' => 'Je hebt ingestemd. Het personeel zal het verzoek nu controleren voordat de relatie begint.',
        'incoming_rejected' => 'Je hebt geweigerd. Er is geen relatie tot stand gekomen.',
        'incoming_failed' => 'Je antwoord kon niet worden opgeslagen.',
        'review_approved' => 'De zorgrelatie is goedgekeurd.',
        'review_rejected' => 'Het verzoek is afgewezen.',
        'review_not_agreed' => 'Dit verzoek kan niet worden ingewilligd, omdat het lid er niet mee heeft ingestemd.',
        'review_failed' => 'Die beslissing was niet meer te redden.',
        'review_not_found' => 'Dat verzoek kon niet worden gevonden in deze community.',
        'on_behalf_sent' => 'De hulpvraag is verzonden.',
        'on_behalf_failed' => 'De hulpvraag kon niet worden verzonden.',
    ],
];
