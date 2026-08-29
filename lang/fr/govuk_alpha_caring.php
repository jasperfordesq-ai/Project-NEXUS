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
        'service_name' => 'Communauté bienveillante',
        'back_to_caring' => 'Retour à la communauté bienveillante',
        'back_to_caregiver' => 'Retour à vos relations bienveillantes',
        'success_title' => 'Succès',
        'error_title' => 'Il y a un problème',
        'unknown_member' => 'Membre inconnu',
        'optional' => '(facultatif)',
    ],
    'hub' => [
        'title' => 'Communauté bienveillante',
        'caption' => 'Soins et soutien',
        'intro' => 'Organisez des soins réguliers pour un autre membre ou répondez à une demande de quelqu\'un qui a demandé à s\'occuper de vous.',
        'caregiver_card_title' => 'Vos relations bienveillantes',
        'caregiver_card_description' => 'Consultez les relations que vous avez demandées, répondez aux demandes vous concernant et utilisez les outils qu’une relation approuvée débloque.',
        'become_title' => 'Devenez soignant',
        'become_description' => 'Demandez à prodiguer des soins réguliers à un autre membre de cette communauté. Rien ne prend effet tant qu’ils n’ont pas accepté et que le personnel n’a pas vérifié.',
    ],
    'caregiver' => [
        'title' => 'Vos relations bienveillantes',
        'caption' => 'Communauté bienveillante',
        'intro' => 'Relations que vous avez demandées et leur stade actuel.',
        'none' => 'Vous n’avez encore demandé à prendre soin de personne.',
        'become_button' => 'Demander à prendre soin de quelqu\'un',
        'incoming_title' => 'Demandes vous concernant',
        'incoming_intro' => 'Ces membres ont demandé à prendre soin de vous. N\'acceptez que si vous comprenez et acceptez ce que cela signifie.',
        'incoming_explanation' => 'Si vous êtes d’accord, le personnel vérifiera alors la demande avant le début de la relation. Accepter ne démarre pas tout seul.',
        'incoming_none' => 'Personne n\'a demandé à prendre soin de vous.',
        'confirm_button' => 'J\'accepte cette relation',
        'reject_button' => 'je ne suis pas d\'accord',
        'status_heading' => 'Scène',
        'status_pending_recipient' => 'En attendant que l\'autre membre soit d\'accord',
        'status_pending_staff' => 'En attente d\'un contrôle de sécurité du personnel',
        'status_active' => 'Approuvé et actif',
        'status_rejected' => 'Non approuvé',
        'status_inactive' => 'Terminé',
        'relationship_heading' => 'Relation',
        'relationship_family' => 'Famille',
        'relationship_friend' => 'Ami',
        'relationship_neighbour' => 'Voisin',
        'relationship_professional' => 'Aide-soignant professionnel',
        'started_heading' => 'Les soins ont commencé',
        'reason_heading' => 'Raison invoquée',
        'pending_no_tools' => 'Pendant qu\'une demande est en attente, elle ne vous donne aucun accès aux détails des soins de ce membre.',
        'active_tools_title' => 'Ce que cette relation vous permet de faire',
        'request_on_behalf_link' => 'Demander de l\'aide au nom de ce membre',
    ],
    'link' => [
        'title' => 'Demander à prendre soin de quelqu\'un',
        'caption' => 'Communauté bienveillante',
        'intro' => 'Demandez à prodiguer des soins réguliers à un autre membre de cette communauté.',
        'consent_warning' => 'Il sera demandé au membre que vous nommez s’il est d’accord. Le personnel vérifiera ensuite la demande. La relation ne commence et ne vous donne rien tant que les deux ne se sont pas produits.',
        'search_label' => 'Trouvez le membre dont vous souhaitez vous occuper',
        'search_hint' => 'Saisissez une partie de leur nom, puis choisissez-les parmi les résultats.',
        'search_button' => 'Recherche',
        'results_title' => 'Choisissez un membre',
        'results_none' => 'Aucun membre ne correspond à ce nom. Essayez une orthographe différente.',
        'choose_button' => 'Choisir',
        'chosen_label' => 'Membre que vous avez choisi',
        'change_button' => 'Changement',
        'relationship_label' => 'Votre relation avec eux',
        'start_date_label' => 'Date de début ou de début des soins',
        'start_date_hint' => 'Par exemple, 27 3 2026',
        'notes_label' => 'Tout ce que le personnel devrait savoir',
        'notes_hint' => 'Facultatif. Celui-ci est présenté au membre du personnel qui vérifie la demande.',
        'submit_button' => 'Envoyer la demande',
        'error_no_member' => 'Choisissez le membre dont vous souhaitez vous occuper',
        'error_no_relationship' => 'Sélectionnez votre relation avec eux',
        'error_no_start_date' => 'Entrez la date à laquelle les soins ont commencé ou commenceront',
        'error_bad_start_date' => 'Entrez une date réelle, par exemple 27 3 2026',
        'error_search_too_short' => 'Entrez au moins deux caractères pour rechercher',
    ],
    'on_behalf' => [
        'title' => 'Demander de l\'aide au nom de quelqu\'un',
        'intro' => 'Demandez à la communauté une aide pratique pour le membre dont vous vous occupez. La demande est enregistrée à son nom et montre que vous l\'avez faite.',
        'for_member' => 'Cette demande est destinée',
        'title_label' => 'Quelle aide est nécessaire',
        'title_hint' => 'Par exemple, un ascenseur pour un rendez-vous à l\'hôpital.',
        'description_label' => 'Plus de détails',
        'when_label' => 'Quand c\'est nécessaire',
        'contact_label' => 'Comment les aidants doivent-ils nous contacter',
        'contact_phone' => 'Par téléphone',
        'contact_message' => 'Par message',
        'contact_either' => 'L\'un ou l\'autre est bien',
        'submit_button' => 'Envoyer la demande',
        'error_no_title' => 'Entrez quelle aide est nécessaire',
        'error_not_active' => 'Vous ne pouvez demander de l\'aide qu\'au nom d\'un membre dont la relation a été approuvée',
    ],
    'review' => [
        'title' => 'Le soignant demande à vérifier',
        'caption' => 'Communauté bienveillante',
        'intro' => 'Vérifiez que le bénéficiaire de soins a accepté et enregistrez comment vous l\'avez vérifié avant d\'approuver une relation de soins.',
        'none' => 'Aucune demande de soignant n’attend d’être vérifiée.',
        'requested_by' => 'Demandé par',
        'requested_for' => 'Prendre soin de',
        'requested_on' => 'Demandé le',
        'recipient_agreed' => 'Le député a accepté',
        'recipient_not_agreed' => 'Le membre n\'est pas encore d\'accord',
        'blocked_until_agreed' => 'Vous ne pouvez pas approuver cette demande tant que le membre ne l\'a pas accepté.',
        'evidence_label' => 'Comment vous avez vérifié leur consentement',
        'evidence_hint' => 'Par exemple, un appel téléphonique le 27 mars 2026 avec le membre lui-même.',
        'attestation_label' => 'Je confirme avoir vérifié moi-même le consentement de ce membre',
        'approve_button' => 'Approuver la relation',
        'reject_label' => 'Pourquoi vous refusez cette demande',
        'reject_hint' => 'Ceci est enregistré et montré au membre qui a demandé.',
        'reject_button' => 'Refuser la demande',
        'decided_approved' => 'Approuvé',
        'decided_rejected' => 'Refusé',
        'error_no_evidence' => 'Entrez comment vous avez vérifié leur consentement',
        'error_no_attestation' => 'Confirmez que vous avez vérifié vous-même le consentement de ce membre',
        'error_no_reason' => 'Entrez pourquoi vous refusez cette demande',
    ],
    'status' => [
        'link_requested' => 'Votre demande a été envoyée. Il attend l\'accord de l\'autre membre, puis un contrôle du personnel.',
        'link_failed' => 'Votre demande n\'a pas pu être envoyée.',
        'link_duplicate' => 'Vous avez déjà une demande ou une relation approuvée avec ce membre.',
        'incoming_confirmed' => 'Vous avez accepté. Le personnel vérifiera désormais la demande avant le début de la relation.',
        'incoming_rejected' => 'Vous avez refusé. Aucune relation n\'a été créée.',
        'incoming_failed' => 'Votre réponse n\'a pas pu être enregistrée.',
        'review_approved' => 'La relation bienveillante a été approuvée.',
        'review_rejected' => 'La demande a été refusée.',
        'review_not_agreed' => 'Cette demande ne peut être approuvée parce que le député ne l\'a pas accepté.',
        'review_failed' => 'Cette décision n\'a pas pu être sauvegardée.',
        'review_not_found' => 'Cette demande n\'a pas pu être trouvée dans cette communauté.',
        'on_behalf_sent' => 'La demande d\'aide a été envoyée.',
        'on_behalf_failed' => 'La demande d\'aide n\'a pas pu être envoyée.',
    ],
];
