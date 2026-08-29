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
        'service_name' => 'Fürsorgliche Gemeinschaft',
        'back_to_caring' => 'Zurück zur Caring Community',
        'back_to_caregiver' => 'Zurück zu Ihren fürsorglichen Beziehungen',
        'success_title' => 'Erfolg',
        'error_title' => 'Es gibt ein Problem',
        'unknown_member' => 'Unbekanntes Mitglied',
        'optional' => '(optional)',
    ],
    'hub' => [
        'title' => 'Fürsorgliche Gemeinschaft',
        'caption' => 'Betreuung und Unterstützung',
        'intro' => 'Vereinbaren Sie die regelmäßige Betreuung eines anderen Mitglieds oder beantworten Sie eine Anfrage von jemandem, der darum gebeten hat, sich um Sie zu kümmern.',
        'caregiver_card_title' => 'Ihre fürsorglichen Beziehungen',
        'caregiver_card_description' => 'Sehen Sie sich Beziehungen an, nach denen Sie gefragt haben, beantworten Sie Anfragen über Sie und nutzen Sie die Tools, die eine genehmigte Beziehung freischaltet.',
        'become_title' => 'Werden Sie Betreuer',
        'become_description' => 'Bitten Sie darum, ein anderes Mitglied dieser Gemeinschaft regelmäßig zu betreuen. Erst wenn sie zustimmen und die Mitarbeiter dies überprüft haben, tritt keine Wirkung in Kraft.',
    ],
    'caregiver' => [
        'title' => 'Ihre fürsorglichen Beziehungen',
        'caption' => 'Fürsorgliche Gemeinschaft',
        'intro' => 'Die von Ihnen angefragten Beziehungen und ihr aktueller Stand.',
        'none' => 'Sie haben noch nicht darum gebeten, sich um jemanden zu kümmern.',
        'become_button' => 'Bitten Sie darum, sich um jemanden zu kümmern',
        'incoming_title' => 'Anfragen über Sie',
        'incoming_intro' => 'Diese Mitglieder haben darum gebeten, sich um Sie zu kümmern. Stimmen Sie nur zu, wenn Sie verstehen und akzeptieren, was es bedeutet.',
        'incoming_explanation' => 'Wenn Sie einverstanden sind, prüfen die Mitarbeiter die Anfrage, bevor die Beziehung beginnt. Mit der Zustimmung beginnt es nicht von alleine.',
        'incoming_none' => 'Niemand hat darum gebeten, sich um Sie zu kümmern.',
        'confirm_button' => 'Ich stimme dieser Beziehung zu',
        'reject_button' => 'Ich stimme nicht zu',
        'status_heading' => 'Bühne',
        'status_pending_recipient' => 'Warten auf die Zustimmung des anderen Mitglieds',
        'status_pending_staff' => 'Warten auf eine Personalsicherheitskontrolle',
        'status_active' => 'Anerkannt und aktiv',
        'status_rejected' => 'Nicht genehmigt',
        'status_inactive' => 'Beendet',
        'relationship_heading' => 'Beziehung',
        'relationship_family' => 'Familie',
        'relationship_friend' => 'Freund',
        'relationship_neighbour' => 'Nachbar',
        'relationship_professional' => 'Professioneller Betreuer',
        'started_heading' => 'Die Pflege begann',
        'reason_heading' => 'Grund angegeben',
        'pending_no_tools' => 'Während eine Anfrage wartet, haben Sie keinen Zugriff auf die Pflegedetails dieses Mitglieds.',
        'active_tools_title' => 'Was diese Beziehung Ihnen ermöglicht',
        'request_on_behalf_link' => 'Bitten Sie im Namen dieses Mitglieds um Hilfe',
    ],
    'link' => [
        'title' => 'Bitten Sie darum, sich um jemanden zu kümmern',
        'caption' => 'Fürsorgliche Gemeinschaft',
        'intro' => 'Bitten Sie darum, ein anderes Mitglied dieser Gemeinschaft regelmäßig zu betreuen.',
        'consent_warning' => 'Das von Ihnen benannte Mitglied wird gefragt, ob es damit einverstanden ist. Anschließend prüft das Personal die Anfrage. Die Beziehung beginnt erst, wenn beides passiert ist, und bringt einem nichts.',
        'search_label' => 'Finden Sie das Mitglied, das Sie betreuen möchten',
        'search_hint' => 'Geben Sie einen Teil ihres Namens ein und wählen Sie sie dann aus den Ergebnissen aus.',
        'search_button' => 'Suchen',
        'results_title' => 'Wählen Sie ein Mitglied',
        'results_none' => 'Kein Mitglied stimmte mit diesem Namen überein. Versuchen Sie es mit einer anderen Schreibweise.',
        'choose_button' => 'Wählen',
        'chosen_label' => 'Mitglied, das Sie ausgewählt haben',
        'change_button' => 'Ändern',
        'relationship_label' => 'Deine Beziehung zu ihnen',
        'start_date_label' => 'Datum, an dem die Pflege begann oder beginnen wird',
        'start_date_hint' => 'Beispiel: 27.3.2026',
        'notes_label' => 'Alles, was das Personal wissen sollte',
        'notes_hint' => 'Optional. Dies wird dem Mitarbeiter angezeigt, der die Anfrage prüft.',
        'submit_button' => 'Anfrage senden',
        'error_no_member' => 'Wählen Sie das Mitglied aus, das Sie betreuen möchten',
        'error_no_relationship' => 'Wählen Sie Ihre Beziehung zu ihnen aus',
        'error_no_start_date' => 'Geben Sie das Datum ein, an dem die Pflege begonnen hat oder beginnen wird',
        'error_bad_start_date' => 'Geben Sie ein echtes Datum ein, zum Beispiel den 27.3.2026',
        'error_search_too_short' => 'Geben Sie für die Suche mindestens zwei Zeichen ein',
    ],
    'on_behalf' => [
        'title' => 'Bitten Sie im Namen einer anderen Person um Hilfe',
        'intro' => 'Bitten Sie die Community um praktische Hilfe für das Mitglied, das Sie betreuen. Die Anfrage wird in ihrem Namen registriert und zeigt, dass Sie sie gestellt haben.',
        'for_member' => 'Diese Anfrage ist für',
        'title_label' => 'Welche Hilfe wird benötigt',
        'title_hint' => 'Zum Beispiel eine Mitfahrgelegenheit zu einem Krankenhaustermin.',
        'description_label' => 'Mehr Details',
        'when_label' => 'Wenn es nötig ist',
        'contact_label' => 'Wie Helfer Kontakt aufnehmen sollten',
        'contact_phone' => 'Per Telefon',
        'contact_message' => 'Per Nachricht',
        'contact_either' => 'Beides ist in Ordnung',
        'submit_button' => 'Anfrage senden',
        'error_no_title' => 'Geben Sie ein, welche Hilfe benötigt wird',
        'error_not_active' => 'Sie können nur im Namen eines Mitglieds um Hilfe bitten, dessen Beziehung genehmigt wurde',
    ],
    'review' => [
        'title' => 'Betreuer bittet um Kontrolle',
        'caption' => 'Fürsorgliche Gemeinschaft',
        'intro' => 'Überprüfen Sie, ob der Pflegebedürftige zugestimmt hat, und notieren Sie, wie Sie dies bestätigt haben, bevor Sie einer Pflegebeziehung zustimmen.',
        'none' => 'Es liegen keine Betreuungsanfragen zur Prüfung vor.',
        'requested_by' => 'Angefordert von',
        'requested_for' => 'Um sich zu kümmern',
        'requested_on' => 'Angefordert am',
        'recipient_agreed' => 'Das Mitglied hat zugestimmt',
        'recipient_not_agreed' => 'Das Mitglied hat noch nicht zugestimmt',
        'blocked_until_agreed' => 'Sie können dieser Anfrage erst dann zustimmen, wenn das Mitglied ihr zugestimmt hat.',
        'evidence_label' => 'Wie Sie ihre Zustimmung überprüft haben',
        'evidence_hint' => 'Beispielsweise ein Telefonat am 27. März 2026 mit dem Mitglied selbst.',
        'attestation_label' => 'Ich bestätige, dass ich die Zustimmung dieses Mitglieds selbst überprüft habe',
        'approve_button' => 'Beziehung genehmigen',
        'reject_label' => 'Warum Sie diese Anfrage ablehnen',
        'reject_hint' => 'Dies wird aufgezeichnet und dem fragenden Mitglied angezeigt.',
        'reject_button' => 'Anfrage ablehnen',
        'decided_approved' => 'Genehmigt',
        'decided_rejected' => 'Abgelehnt',
        'error_no_evidence' => 'Geben Sie ein, wie Sie ihre Zustimmung überprüft haben',
        'error_no_attestation' => 'Bestätigen Sie, dass Sie die Einwilligung dieses Mitglieds selbst überprüft haben',
        'error_no_reason' => 'Geben Sie ein, warum Sie diese Anfrage ablehnen',
    ],
    'status' => [
        'link_requested' => 'Ihre Anfrage wurde gesendet. Es wartet auf die Zustimmung des anderen Mitglieds und dann auf eine Überprüfung durch das Personal.',
        'link_failed' => 'Ihre Anfrage konnte nicht gesendet werden.',
        'link_duplicate' => 'Sie haben bereits eine Anfrage oder eine genehmigte Beziehung zu diesem Mitglied.',
        'incoming_confirmed' => 'Sie haben zugestimmt. Die Mitarbeiter werden nun die Anfrage prüfen, bevor die Beziehung beginnt.',
        'incoming_rejected' => 'Sie haben abgelehnt. Es wurde keine Beziehung erstellt.',
        'incoming_failed' => 'Ihre Antwort konnte nicht gespeichert werden.',
        'review_approved' => 'Die Betreuungsbeziehung wurde genehmigt.',
        'review_rejected' => 'Der Antrag wurde abgelehnt.',
        'review_not_agreed' => 'Diesem Antrag kann nicht stattgegeben werden, da das Mitglied ihm nicht zugestimmt hat.',
        'review_failed' => 'Diese Entscheidung konnte nicht gerettet werden.',
        'review_not_found' => 'Diese Anfrage konnte in dieser Community nicht gefunden werden.',
        'on_behalf_sent' => 'Die Hilfeanfrage wurde gesendet.',
        'on_behalf_failed' => 'Die Hilfeanfrage konnte nicht gesendet werden.',
    ],
];
