<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Dieses Gespräch wurde durch eine Schutzregel der Community pausiert. Deine Community muss für dich einen aktuellen :types-Status erfasst haben, bevor du diesem Mitglied schreiben kannst. Bitte deine vermittelnde Person oder die Community-Administration, diese reine Metadatenbestätigung einzutragen. Sende keine Prüfunterlagen und lade sie nicht hoch.',
        'vetting_required_title' => 'Schutzpruefung erforderlich',
        'vetting_required_detail' => 'Dieses Mitglied kann für diese Art von Interaktion nur von Mitgliedern kontaktiert werden, deren Community einen aktuellen :types-Status erfasst hat. Der Eintrag enthält nur Metadaten; Unterlagen dürfen weder gesendet noch hochgeladen werden.',
        'vetting_required_action' => 'Hilfe oeffnen',
        'contact_restricted' => 'Dieses Mitglied moechte, dass ein Koordinator den Kontakt in seinem Namen arrangiert. Deine Nachricht wurde nicht gesendet. Bitte kontaktiere deinen Broker oder Community-Administrator, damit der naechste sichere Schritt arrangiert werden kann.',
        'contact_restricted_title' => 'Koordinator-Arrangement erforderlich',
        'contact_restricted_detail' => 'Dieses Mitglied ist für Direktnachrichten nicht verfügbar, da seine Schutzeinstellungen eine koordinatorvermittelte Kontaktaufnahme erfordern. Sie können einen Koordinator bitten, die Kontaktaufnahme zu unterstützen.',
        'contact_restricted_action' => 'Hilfe oeffnen',
        'coordination_not_required' => 'Ein direkter Kontakt mit diesem Mitglied ist derzeit möglich — Sie benötigen keinen Koordinator, um ihn zu vermitteln. Bitte laden Sie die Seite neu und versuchen Sie erneut, eine Nachricht zu senden.',
        'coordination_request_failed' => 'Ihre Anfrage konnte gerade nicht an den Koordinator gesendet werden. Bitte versuchen Sie es in Kürze erneut.',
        'vetting_check_failed' => 'Ihr Überprüfungsstatus konnte gerade nicht bestätigt werden. Bitte versuchen Sie es in Kürze erneut.',
        'statement_required' => 'Bevor Sie erklären können, dass diese Community mit Kindern oder schutzbedürftigen Erwachsenen arbeitet, ist eine PDF-Erklärung zum Schutz von Kindern erforderlich. Bitte laden Sie eines hoch, um fortzufahren.',
        'invalid_file' => 'Die hochgeladene Datei konnte nicht gelesen werden. Bitte versuchen Sie es erneut mit einem gültigen PDF.',
        'pdf_required' => 'Die Sicherungserklärung muss eine PDF-Datei sein.',
        'file_too_large' => 'Die Sicherungserklärungsdatei ist zu groß. Die maximale Größe beträgt 10 MB.',
        'storage_failed' => 'Wir konnten die hochgeladene Datei nicht speichern. Bitte versuchen Sie es erneut.',
        'statement_missing' => 'Für diese Community liegt keine Sicherheitserklärung vor.',
        'file_missing' => 'Die Sicherungserklärungsdatei konnte auf dem Server nicht gefunden werden. Bitte laden Sie es erneut hoch.',
        'revoke_failed' => 'Wir konnten diese Präferenz nicht widerrufen. Möglicherweise wurde es bereits widerrufen.',
        'policy_unavailable' => 'Wir können die Community-Schutzrichtlinie derzeit nicht bestätigen. Es wurde keine Nachricht gesendet. Bitte versuchen Sie es in Kürze noch einmal.',
        'interaction_not_allowed' => 'Die Community-Schutzrichtlinie des Empfängers lässt diese direkte Interaktion nicht zu. Bitten Sie einen Koordinator um Hilfe.',
        'policy_unavailable_title' => 'Sicherungsscheck vorübergehend nicht verfügbar',
        'policy_unavailable_detail' => 'Project NEXUS konnte die Kontaktrichtlinie nicht sicher bewerten, daher wurde diese Interaktion pausiert.',
        'policy_unavailable_action' => 'Überprüfen Sie es noch einmal',
        'listing_role_confirmation_required' => 'Diese Auflistung erfordert eine separate, von der Community bestätigte Enhanced DBS-Entscheidung für diese Rolle. Eine Messenger-Kontaktbestätigung genügt nicht den rollenspezifischen Schutzanforderungen.',
        'listing_role_feature_unavailable' => 'Die rollenspezifische Überprüfung des Strafregisters kann hier noch nicht aktiviert werden. Die Messenger-Kontaktbestätigung wird bewusst nicht als Rollenfreigabe wiederverwendet.',
        'compliance_policy_unavailable' => 'Wir können die Schutzanforderungen für diesen Eintrag derzeit nicht sicher bestätigen. Bitte versuchen Sie es später noch einmal oder wenden Sie sich an Ihren Broker.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS Basic',
        'dbs_standard' => 'DBS-Standard',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Garda-Überprüfung',
        'access_ni' => 'Zugriff auf NI',
        'pvg_scotland' => 'PVG Schottland',
        'international' => 'Internationaler Hintergrundcheck',
        'other' => 'Andere Sicherheitskontrolle',
        'uk_safeguarding_clearance' => 'Sicherheitsfreigabe für das Vereinigte Königreich',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Schutzgerichtsbarkeit nicht konfiguriert',
        'united_kingdom' => 'United Kingdom ? national policy package',
        'england_wales' => 'England und Wales',
        'scotland' => 'Schottland',
        'northern_ireland' => 'Nordirland',
        'ireland' => 'Republik Irland',
        'custom' => 'Zollrechtliche Zuständigkeit',
    ],
    'attestations' => [
        'dbs_enhanced' => 'Erweiterter DBS für geschützten Mitgliederkontakt bestätigt',
        'pvg_scotland' => 'PVG-Status für geschützten Mitgliedskontakt bestätigt',
        'access_ni' => 'AccessNI-Status für geschützten Mitgliederkontakt bestätigt',
        'garda_vetting' => 'Garda Vetting bestätigte den gesicherten Mitgliederkontakt',
        'uk_safeguarding_clearance' => 'Britische Schutzfreigabe für geschützten Mitgliedskontakt bestätigt',
    ],
    'confirmation' => [
        'title' => 'Ihre Sicherheitseinstellungen wurden gespeichert',
        'intro' => 'Vielen Dank, dass Sie dies geteilt haben. Hier finden Sie eine Zusammenfassung dessen, was Sie ausgewählt haben, wer es sehen kann und was dadurch aktiviert wird.',
        'your_selections' => 'Ihre Auswahl',
        'no_selections' => 'Sie haben keine Schutzoptionen ausgewählt.',
        'who_can_see_heading' => 'Wer kann das sehen?',
        'who_can_see_body' => 'Nur die Community-Koordinatoren und Administratoren können diese Einstellungen sehen. Andere Mitglieder können das nicht. Alle Zugriffe werden protokolliert.',
        'what_activates_heading' => 'Was dadurch aktiviert wird',
        'activation_broker_review' => 'Ein Koordinator prüft und genehmigt geschützte Spiele oder Austausche, wenn Ihre ausgewählte Präferenz dies erfordert. Dadurch erhalten sie keinen Zugriff auf den Nachrichteninhalt.',
        'activation_match_approval' => 'Ein Koordinator genehmigt Spiele, an denen Sie beteiligt sind, bevor sie dem anderen Mitglied vorgeschlagen werden.',
        'activation_discovery_hidden' => 'Für Mitglieder, die die erforderliche Überprüfung nicht abgeschlossen haben, werden Sie nicht entdeckt.',
        'activation_notification' => 'Ein Koordinator wurde benachrichtigt und wird sich mit Ihnen in Verbindung setzen, um zu besprechen, wie wir helfen können.',
        'activation_none' => 'Bei dieser Auswahl werden keine automatischen Schutzmaßnahmen aktiviert. Ihre Präferenzen werden zur Kenntnisnahme des Koordinators aufgezeichnet.',
        'revoke_heading' => 'So können Sie diese jederzeit ändern oder widerrufen',
        'revoke_body' => 'Sie können diese Einstellungen jederzeit in Ihren Profileinstellungen überprüfen oder widerrufen. Sie müssen hierfür keinen Administrator beauftragen.',
        'revoke_cta' => 'Gehen Sie zu den Schutzeinstellungen',
        'continue_cta' => 'Weitermachen',
    ],
    'settings' => [
        'page_title' => 'Präferenzen schützen',
        'intro' => 'Überprüfen oder widerrufen Sie die Schutzeinstellungen, die Sie beim Onboarding festgelegt haben. Ihre Koordinatoren können diese sehen, andere Mitglieder jedoch nicht.',
        'no_preferences' => 'Sie haben keine aktiven Schutzeinstellungen. Sie können diese jederzeit auf der Hilfeseite zum Schutz festlegen.',
        'selected_on' => 'Ausgewählt am :date',
        'revoke_button' => 'Widerrufen',
        'revoke_confirm_title' => 'Diese Präferenz widerrufen?',
        'revoke_confirm_body' => 'Diese Einstellung gilt nicht mehr für Ihr Konto. Ihre Koordinatoren werden über die Änderung benachrichtigt.',
        'revoke_confirm_yes' => 'Ja, widerrufen',
        'revoke_confirm_no' => 'Behalte es',
        'revoked_toast' => 'Präferenz widerrufen.',
        'revoke_error_toast' => 'Etwas ist schief gelaufen. Bitte versuchen Sie es erneut.',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Diese Gemeinschaft nimmt den Schutz ihrer Mitglieder ernst. Wenn Sie sich als schutzbedürftige erwachsene Person sehen oder zusätzliche Unterstützung benötigen, teilen Sie uns dies bitte mit, damit unsere Koordination sichere Austausche für Sie organisieren kann.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Ich sehe mich als schutzbedürftige erwachsene Person und benötige möglicherweise zusätzliche Unterstützung',
                    'description' => 'Damit erfährt unsere Koordination, dass Sie bei der Organisation von Austauschen möglicherweise zusätzliche Unterstützung benötigen. Eine Koordinationsperson wird sich mit Ihnen in Verbindung setzen. Diese Informationen sind vertraulich.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Ich möchte möglichst nur mit angemessen überprüften Mitgliedern interagieren',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Ich möchte, dass eine Koordinationsperson meine Austausche organisiert, statt direkt kontaktiert zu werden',
                    'description' => 'Eine Koordinationsperson vermittelt sämtliche Kontakte und organisiert Austausche in Ihrem Namen. Andere Mitglieder können Ihnen keine direkten Nachrichten senden.',
                ],
                'no_home_visits' => [
                    'label' => 'Ich möchte keine Besuche von Mitgliedern bei mir zu Hause ohne vorherige Koordination',
                    'description' => 'Alle Hausbesuche werden über eine Koordinationsperson organisiert, die für angemessene Schutzmaßnahmen sorgt.',
                ],
                'works_with_children' => [
                    'label' => 'Ich plane Angebote, an denen Kinder oder junge Menschen unter 18 Jahren beteiligt sein können',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Ich plane Angebote, an denen schutzbedürftige Erwachsene beteiligt sein können',
                ],
                'none_apply' => [
                    'label' => 'Nichts davon trifft auf mich zu',
                    'description' => 'Ich habe die obigen Optionen geprüft und keine davon trifft auf meine Situation zu. Dies wird gespeichert, damit die Koordination weiß, dass ich diesen Schritt gesehen und berücksichtigt habe.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irland',
            'vetting_authority' => 'Nationales Überprüfungsbüro',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Irland bedeutet dies Garda-überprüfte Mitglieder. Unsere Koordination stellt sicher, dass Sie nur mit überprüften Mitgliedern zusammengebracht werden.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Eine Koordinationsperson (Broker) vermittelt sämtliche Kontakte und organisiert Austausche in Ihrem Namen. Andere Mitglieder können Ihnen keine direkten Nachrichten senden.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Anforderungen der Garda-Überprüfung besprechen. In Irland müssen bestimmte Tätigkeiten mit Kindern nach dem National Vetting Bureau Act 2012 überprüft werden.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Anforderungen der Garda-Überprüfung besprechen. Tätigkeiten mit schutzbedürftigen Erwachsenen können eine Überprüfung erfordern.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Vereinigtes Königreich',
            'vetting_authority' => 'DBS, Disclosure Scotland und AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Im gesamten Vereinigten Königreich bestätigen Koordinatoren die entsprechende Enhanced DBS-, PVG- und/oder AccessNI-Basis für geschützten Kontakt.',
                ],
                'works_with_children' => [
                    'description' => 'Ein Koordinator wird die Rolle und die anwendbare britische Gerichtsbarkeit bewerten, bevor er entscheidet, welche Schutzprüfung rechtlich angemessen ist.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Ein Koordinator bewertet die Rolle, die beteiligten Erwachsenen und die geltende britische Gerichtsbarkeit, bevor er entscheidet, welche Schutzprüfung rechtlich angemessen ist.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'England und Wales',
            'vetting_authority' => 'Offenlegungs- und Sperrdienst',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In England und Wales bedeutet dies Mitglieder mit DBS-Überprüfung. Unsere Koordination stellt sicher, dass Sie nur mit überprüften Mitgliedern zusammengebracht werden.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Anforderungen einer DBS-Überprüfung besprechen.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Schottland',
            'vetting_authority' => 'Disclosure Scotland (PVG-System)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Ich sehe mich als schutzbedürftige oder geschützte erwachsene Person und benötige möglicherweise zusätzliche Unterstützung',
                ],
                'requires_vetted_partners' => [
                    'description' => 'In Schottland bedeutet dies Mitglieder des PVG-Systems. Unsere Koordination stellt sicher, dass Sie nur mit überprüften Mitgliedern zusammengebracht werden.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Mitgliedschaft im PVG-System besprechen.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Ich plane Angebote, an denen geschützte Erwachsene beteiligt sein können',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Nordirland',
            'vetting_authority' => 'Zugriff auf NI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Nordirland bedeutet dies Mitglieder mit AccessNI-Überprüfung. Unsere Koordination stellt sicher, dass Sie nur mit überprüften Mitgliedern zusammengebracht werden.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen eine AccessNI-Überprüfung besprechen.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Benutzerdefiniert',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'Ihre Gemeinde hat ihre Schutzzuständigkeit geändert. Ihr bestehender Schutz bleibt aktiv, aber bitte überprüfen Sie den aktualisierten Wortlaut in den Einstellungen.',
        'jurisdiction_changed_staff' => 'Die Sicherungszuständigkeit änderte sich. Der betroffene Mitgliederschutz bleibt aktiv und erfordert nun eine Überprüfung durch die Mitglieder.',
        'attestation_policy_rotated_member' => 'Ihre Community hat mit der Überprüfung der Schutzrichtlinien begonnen. Ihr Makler muss Ihren privaten Kontaktstatus erneut bestätigen; Dies ist kein Zertifikatsablauf.',
        'reminder_subject' => 'Bitte überprüfen Sie Ihre Sicherheitspräferenzen',
        'reminder_title' => 'Es ist Zeit, Ihre Sicherheitspräferenzen zu überprüfen',
        'reminder_body' => 'Es ist über ein Jahr her, seit Sie Ihre Schutzeinstellungen für :community festgelegt haben. Bitte nehmen Sie sich einen Moment Zeit, um sie zu überprüfen und zu bestätigen, dass sie weiterhin gelten, oder widerrufen Sie alle, die nicht mehr gelten.',
        'reminder_cta' => 'Überprüfen Sie die Einstellungen',
        'escalation_subject' => 'Mitgliederschutzbewertung ausstehend',
        'escalation_title' => 'Jährliche Schutzüberprüfung ausstehend',
        'escalation_body' => ':name hat seit 30 Tagen nicht auf eine Anfrage zur Überprüfung seiner Schutzpräferenzen geantwortet. Ihre Präferenzen bleiben aktiv – das Mitglied hat das Recht, sie beizubehalten. Bitte kontaktieren Sie uns direkt, wenn Sie einchecken möchten.',
        'escalation_cta' => 'Mitglied im Schutz-Dashboard anzeigen',
    ],
];
