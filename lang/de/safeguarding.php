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
        'contact_restricted' => 'Dieses Mitglied kann nur über einen Koordinator kontaktiert werden. Es wurde nichts gesendet. Sie können einen Koordinator bitten, den Kontakt zu Ihnen herzustellen.',
        'contact_restricted_title' => 'Kontakt über einen Koordinator',
        'contact_restricted_detail' => 'Der Kontakt zu diesem Mitglied wird über einen Koordinator vermittelt. Sie können einen Koordinator bitten, den Kontakt zu Ihnen herzustellen.',
        'contact_via_coordinator' => 'Aufgrund der von Ihnen getroffenen Sicherheitsentscheidung können Sie nur Koordinatoren und Mitglieder kontaktieren, deren Überprüfung diese Community aufgezeichnet hat. Es wurde nichts gesendet. Ein Koordinator kann Ihnen bei der Kontaktaufnahme helfen.',
        'contact_via_coordinator_title' => 'Sie können Kontakt zu Koordinatoren und geprüften Mitgliedern aufnehmen',
        'contact_via_coordinator_detail' => 'Aufgrund der von Ihnen getroffenen Sicherheitsentscheidung können Sie Koordinatoren und Mitglieder kontaktieren, deren Überprüfung diese Community aufgezeichnet hat. Fragen Sie einen Koordinator, ob Sie Hilfe bei der Kontaktaufnahme mit diesem Mitglied benötigen.',
        'contact_restricted_action' => 'Hilfe oeffnen',
        'coordination_not_required' => 'Ein direkter Kontakt mit diesem Mitglied ist derzeit möglich — Sie benötigen keinen Koordinator, um ihn zu vermitteln. Bitte laden Sie die Seite neu und versuchen Sie erneut, eine Nachricht zu senden.',
        'coordination_request_failed' => 'Ihre Anfrage konnte gerade nicht an den Koordinator gesendet werden. Bitte versuchen Sie es in Kürze erneut.',
        'vetting_check_failed' => 'Ihr Überprüfungsstatus konnte gerade nicht bestätigt werden. Bitte versuchen Sie es in Kürze erneut.',
        'policy_unavailable' => 'Wir können die Community-Schutzrichtlinie derzeit nicht bestätigen. Es wurde keine Nachricht gesendet. Bitte versuchen Sie es in Kürze noch einmal.',
        'blocked_interaction' => 'Sie können mit diesem Mitglied nicht interagieren.',
        'interaction_not_allowed' => 'Die Community-Schutzrichtlinie des Empfängers lässt diese direkte Interaktion nicht zu. Bitten Sie einen Koordinator um Hilfe.',
        'policy_unavailable_title' => 'Sicherungsscheck vorübergehend nicht verfügbar',
        'policy_unavailable_detail' => 'Project NEXUS konnte die Kontaktrichtlinie nicht sicher bewerten, daher wurde diese Interaktion pausiert.',
        'policy_unavailable_action' => 'Überprüfen Sie es noch einmal',
        'listing_role_confirmation_required' => 'Diese Auflistung erfordert eine separate, von der Community bestätigte Enhanced DBS-Entscheidung für diese Rolle. Eine Messenger-Kontaktbestätigung genügt nicht den rollenspezifischen Schutzanforderungen.',
        'listing_role_feature_unavailable' => 'Die rollenspezifische Überprüfung des Strafregisters kann hier noch nicht aktiviert werden. Die Messenger-Kontaktbestätigung wird bewusst nicht als Rollenfreigabe wiederverwendet.',
        'compliance_policy_unavailable' => 'Wir können die Schutzanforderungen für diesen Eintrag derzeit nicht sicher bestätigen. Bitte versuchen Sie es später noch einmal oder wenden Sie sich an Ihren Broker.',
        'statement_required' => 'Bevor Sie erklären können, dass diese Community mit Kindern oder schutzbedürftigen Erwachsenen arbeitet, ist eine PDF-Erklärung zum Schutz von Kindern erforderlich. Bitte laden Sie eines hoch, um fortzufahren.',
        'invalid_file' => 'Die hochgeladene Datei konnte nicht gelesen werden. Bitte versuchen Sie es erneut mit einem gültigen PDF.',
        'pdf_required' => 'Die Sicherungserklärung muss eine PDF-Datei sein.',
        'file_too_large' => 'Die Sicherungserklärungsdatei ist zu groß. Die maximale Größe beträgt 10 MB.',
        'storage_failed' => 'Wir konnten die hochgeladene Datei nicht speichern. Bitte versuchen Sie es erneut.',
        'statement_missing' => 'Für diese Community liegt keine Sicherheitserklärung vor.',
        'file_missing' => 'Die Sicherungserklärungsdatei konnte auf dem Server nicht gefunden werden. Bitte laden Sie es erneut hoch.',
        'revoke_failed' => 'Wir konnten diese Präferenz nicht widerrufen. Möglicherweise wurde es bereits widerrufen.',
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
        'united_kingdom' => 'Vereinigtes Königreich — nationales Richtlinienpaket',
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
        'activation_discovery_hidden' => 'Von dieser Community registrierte Mitglieder ohne Überprüfung können Ihnen keine Nachrichten senden, Ihnen antworten, Ihnen keine Zeitgutschriften senden oder einen Austausch mit Ihnen beginnen.',
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
        'switch_heading' => 'Es gibt eine sanftere Variante',
        'switch_body' => 'Sie haben sich dafür entschieden, nur von Mitgliedern kontaktiert zu werden, deren Überprüfung diese Community aufgezeichnet hat. Das verhindert, dass fast jeder Sie erreicht. Sie können dazu wechseln, dass ein Koordinator Ihren Austausch im Auge behält und Sie stattdessen den Mitgliedern vorstellt, und andere Mitglieder können Ihnen erneut Nachrichten senden.',
        'switch_button' => 'Wechseln Sie zu den Vorstellungen der Koordinatoren',
        'switched_toast' => 'Erledigt. Ein Koordinator überwacht Ihren Austausch und die Mitglieder können Ihnen erneut eine Nachricht senden.',
        'switch_not_held' => 'Sie verfügen nicht über die Einstellung „Nur für geprüfte Mitglieder“, sodass Sie nichts ändern müssen.',
        'switch_unavailable' => 'Koordinatoreinführungen sind in dieser Community noch nicht verfügbar. Bitte wenden Sie sich an einen Koordinator.',
    ],
    'effects' => [
        'broker_approval' => 'Ein Koordinator prüft jeden von Ihnen arrangierten Austausch, bevor er durchgeführt wird. Sie können Ihre Nachrichten nicht lesen.',
        'restricts_messaging' => 'Andere Mitglieder können Ihnen keine Nachrichten senden, keinen Austausch mit Ihnen starten oder Sie erwähnen. Koordinatoren können Sie jederzeit kontaktieren, und Sie können sie kontaktieren. Gruppen, denen Sie angehören, funktionieren wie gewohnt.',
        'restricts_matching' => 'Vorgeschlagene Übereinstimmungen zwischen Ihnen und anderen Mitgliedern werden zunächst von einem Koordinator geprüft.',
        'vetted_only' => 'Nur Koordinatoren und Mitglieder, deren :vetting diese Community aufgezeichnet hat, können Ihnen Nachrichten senden, Ihnen antworten, Ihnen Zeitguthaben senden oder einen Austausch mit Ihnen beginnen, und Sie können nur sie kontaktieren. Alle anderen sind blockiert. Gruppen, denen Sie angehören, funktionieren wie gewohnt.',
        'vetted_count' => '{0} Im Moment sind hier keine Mitglieder :vetting registriert, daher können Sie vorerst nur von Koordinatoren kontaktiert werden.|{1} Im Moment hat hier nur 1 Mitglied :vetting registriert.|[2,*] Mitglieder von :count haben im Moment :vetting hier registriert.',
        'notify_coordinator' => 'Ein Koordinator wird über Ihre Wahl informiert, sodass er sich bei Bedarf mit Ihnen in Verbindung setzen kann.',
        'no_home_visits' => 'Die Koordinatoren wissen, dass Sie keine Hausbesuche wünschen, es sei denn, sie arrangieren sie.',
        'check_before_helping' => 'Ein Koordinator wird darüber informiert und wird bestätigen, ob eine Überprüfung (:vetting) erforderlich ist. Bitte arrangieren Sie bis dahin keine Hilfe für Kinder oder schutzbedürftige Erwachsene über die Zeitbank.',
        'informational' => 'Für andere Mitglieder ändert sich nichts. Ihre Antwort hilft den Koordinatoren, Sie zu unterstützen.',
        'declined' => 'Es ändert sich nichts. Koordinatoren können sehen, dass Sie sich diesen Schritt angesehen haben.',
        'vetting_fallback' => 'Überprüfung',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Diese Gemeinschaft nimmt den Schutz ernst. Wenn Sie bei der Nutzung der Zeitbank besondere Betreuung wünschen, teilen Sie uns dies unten mit. Unsere Koordinatoren helfen Ihnen gerne weiter. Bei jeder Auswahl erfahren Sie genau, was sie bewirkt, bevor Sie sie auswählen.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Ich betrachte mich als verletzlichen Erwachsenen und hätte gerne zusätzliche Unterstützung',
                    'description' => 'Um Ihre Sicherheit zu gewährleisten, können nur Koordinatoren und Mitglieder, deren Überprüfung diese Community aufgezeichnet hat, Sie kontaktieren, und Sie können nur mit ihnen Kontakt aufnehmen. Ein Koordinator wird sich mit Ihnen in Verbindung setzen.',
                ],
                'coordinator_introductions' => [
                    'label' => 'Ich möchte, dass ein Koordinator meinen Austausch im Auge behält und mir dabei hilft, mich den Mitgliedern vorzustellen',
                    'description' => 'Gut, wenn Sie etwas Sicherheit wünschen, ohne abgeschnitten zu werden. Andere Mitglieder können Ihnen weiterhin Nachrichten senden.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Nur Mitglieder, deren Überprüfung diese Community aufgezeichnet hat, dürfen mich kontaktieren',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Ich möchte, dass ein Koordinator den gesamten Kontakt für mich arrangiert, anstatt dass Mitglieder mir direkt Nachrichten senden',
                    'description' => 'Ein Koordinator wird in Ihrem Namen den Kontakt und den Austausch arrangieren und kann bestimmten Mitgliedern die Genehmigung erteilen, mit Ihnen in Kontakt zu treten. Andere Mitglieder können Sie nicht direkt kontaktieren.',
                ],
                'no_home_visits' => [
                    'label' => 'Ich möchte nicht, dass Mitglieder mein Zuhause besuchen, es sei denn, ein Koordinator hat dies arrangiert',
                    'description' => 'Den Koordinatoren wird Bescheid gegeben, damit sie bei der Organisation eines Besuchs bei Ihnen zu Hause helfen und sicherstellen können, dass die richtigen Sicherheitsvorkehrungen getroffen werden.',
                ],
                'works_with_children' => [
                    'label' => 'Ich plane Angebote, an denen Kinder oder junge Menschen unter 18 Jahren beteiligt sein können',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Ich habe vor, Hilfe anzubieten, die Kinder oder schutzbedürftige Erwachsene betrifft (z. B. Nachhilfe für das Kind eines Mitglieds oder persönliche Betreuung).',
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
                    'description' => 'In Irland wird Garda Vetting von einer Organisation für eine bestimmte Rolle organisiert. Hier zählt nur die Überprüfung, ob diese Community Aufzeichnungen gemacht hat, nicht die Überprüfung, ob jemand durch seinen Job oder eine andere Gruppe Aufzeichnungen gemacht hat.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Ein Koordinator wird in Ihrem Namen den Kontakt und den Austausch arrangieren und kann bestimmten Mitgliedern die Genehmigung erteilen, mit Ihnen in Kontakt zu treten. Andere Mitglieder können Sie nicht direkt kontaktieren.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Anforderungen der Garda-Überprüfung besprechen. In Irland müssen bestimmte Tätigkeiten mit Kindern nach dem National Vetting Bureau Act 2012 überprüft werden.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Ein Koordinator wird bekannt gegeben. In Irland ist für die regelmäßige Arbeit mit Kindern oder schutzbedürftigen Menschen eine Garda-Überprüfung erforderlich, die nur eine registrierte Organisation organisieren kann, und das Unterrichten, Coachen oder Mentorieren von Kindern ist immer erforderlich. Bitte arrangieren Sie diese Art von Hilfe nicht über die Zeitbank, bis ein Koordinator bestätigt hat, was benötigt wird.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Vereinigtes Königreich',
            'vetting_authority' => 'DBS, Disclosure Scotland und AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Im gesamten Vereinigten Königreich bedeutet dies eine Enhanced DBS-, PVG- oder AccessNI-Prüfung, die von dieser Community erfasst wurde. Ein Scheck, den jemand durch seinen Job oder eine andere Gruppe hat, zählt hier nicht.',
                ],
                'works_with_children' => [
                    'description' => 'Ein Koordinator wird die Rolle und die anwendbare britische Gerichtsbarkeit bewerten, bevor er entscheidet, welche Schutzprüfung rechtlich angemessen ist.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Ein Koordinator wird darüber informiert und bestätigt, ob für das, was Sie vorhaben, eine Enhanced DBS-, PVG- oder AccessNI-Prüfung erforderlich ist. Bitte arrangieren Sie diese Art von Hilfe erst dann über die Zeitbank, wenn dies der Fall ist.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'England und Wales',
            'vetting_authority' => 'Offenlegungs- und Sperrdienst',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In England und Wales bedeutet dies einen erweiterten DBS-Check, den diese Community aufgezeichnet hat. Ein Scheck, den jemand durch seinen Job oder eine andere Gruppe hat, zählt hier nicht.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Anforderungen einer DBS-Überprüfung besprechen.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Ein Koordinator wird darüber informiert und bestätigt, ob für Ihre geplanten Aktivitäten eine DBS-Prüfung erforderlich ist. Bitte arrangieren Sie diese Art von Hilfe erst dann über die Zeitbank, wenn dies der Fall ist.',
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
                    'description' => 'In Schottland bedeutet dies die Mitgliedschaft im PVG-System, die diese Gemeinschaft registriert hat. Die Mitgliedschaft, die jemand durch seinen Job oder eine andere Gruppe hat, zählt hier nicht.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen die Mitgliedschaft im PVG-System besprechen.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Ich habe vor, Hilfe anzubieten, die Kinder oder geschützte Erwachsene einbezieht (z. B. Nachhilfe für das Kind eines Mitglieds oder persönliche Betreuung).',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Nordirland',
            'vetting_authority' => 'Zugriff auf NI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Nordirland bedeutet dies eine AccessNI-Überprüfung, die diese Community aufgezeichnet hat. Ein Scheck, den jemand durch seinen Job oder eine andere Gruppe hat, zählt hier nicht.',
                ],
                'works_with_children' => [
                    'description' => 'Eine Koordinationsperson kann mit Ihnen eine AccessNI-Überprüfung besprechen.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Ein Koordinator wird darüber informiert und bestätigt, ob für das, was Sie vorhaben, eine AccessNI-Prüfung erforderlich ist. Bitte arrangieren Sie diese Art von Hilfe erst dann über die Zeitbank, wenn dies der Fall ist.',
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
