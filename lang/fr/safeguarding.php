<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Cette conversation est suspendue par une règle de protection de la communauté. Votre communauté doit avoir enregistré pour vous une confirmation :types à jour avant que vous puissiez écrire à ce membre. Demandez à votre intermédiaire ou à l’équipe d’administration de la communauté d’enregistrer ce statut sous forme de métadonnées uniquement. N’envoyez et ne téléversez aucun document de vérification.',
        'vetting_required_title' => 'Verification de protection necessaire',
        'vetting_required_detail' => 'Ce membre ne peut être contacté pour ce type d’interaction que par des personnes dont la communauté a enregistré un statut :types à jour. Cet enregistrement contient uniquement des métadonnées ; aucun document ne doit être envoyé ou téléversé.',
        'vetting_required_action' => 'Ouvrir aide',
        'contact_restricted' => 'Ce membre a demande qu un coordinateur organise le contact en son nom. Votre message n a pas ete envoye. Contactez votre broker ou administrateur de communaute pour organiser la prochaine etape sure.',
        'contact_restricted_title' => 'Arrangement par coordinateur requis',
        'contact_restricted_detail' => 'Ce membre n\'est pas disponible pour les messages directs, car ses préférences de protection nécessitent un contact organisé par un coordinateur. Vous pouvez demander à un coordinateur de vous aider à organiser un contact.',
        'contact_restricted_action' => 'Ouvrir aide',
        'coordination_not_required' => 'Le contact direct avec ce membre est actuellement disponible — vous n\'avez pas besoin d\'un coordinateur pour l\'organiser. Veuillez actualiser la page et réessayer d\'envoyer un message.',
        'coordination_request_failed' => 'Nous n\'avons pas pu envoyer votre demande au coordinateur pour le moment. Veuillez réessayer dans quelques instants.',
        'vetting_check_failed' => 'Nous n\'avons pas pu confirmer votre statut de vérification pour le moment. Veuillez réessayer dans quelques instants.',
        'policy_unavailable' => 'Nous ne pouvons pas confirmer la politique de sauvegarde de la communauté pour le moment. Aucun message n\'a été envoyé. Veuillez réessayer sous peu.',
        'blocked_interaction' => 'Vous ne pouvez pas interagir avec ce membre.',
        'interaction_not_allowed' => 'La politique de sauvegarde de la communauté du destinataire ne permet pas cette interaction directe. Demandez de l’aide à un coordinateur.',
        'policy_unavailable_title' => 'Chèque de sauvegarde temporairement indisponible',
        'policy_unavailable_detail' => 'Le projet NEXUS n\'a pas pu évaluer en toute sécurité la politique de contact, cette interaction a donc été suspendue.',
        'policy_unavailable_action' => 'Revérifier',
        'listing_role_confirmation_required' => 'Cette liste nécessite une décision DBS améliorée distincte, confirmée par la communauté, pour ce rôle. Une confirmation de contact par messager ne satisfait pas aux exigences de protection spécifiques au rôle.',
        'listing_role_feature_unavailable' => 'La vérification du casier judiciaire spécifique au rôle ne peut pas encore être activée ici. La confirmation du contact Messenger n\'est délibérément pas réutilisée comme autorisation de rôle.',
        'compliance_policy_unavailable' => 'Nous ne pouvons pas confirmer en toute sécurité les exigences de sauvegarde pour cette inscription pour le moment. Veuillez réessayer plus tard ou contacter votre courtier.',
        'statement_required' => 'Une déclaration de protection de l\'enfance au format PDF est requise avant de pouvoir déclarer que cette communauté travaille avec des enfants ou des adultes vulnérables. Veuillez en télécharger un pour continuer.',
        'invalid_file' => 'Le fichier téléchargé n\'a pas pu être lu. Veuillez réessayer avec un PDF valide.',
        'pdf_required' => 'La déclaration de sauvegarde doit être un fichier PDF.',
        'file_too_large' => 'Le fichier de déclaration de sauvegarde est trop volumineux. La taille maximale est de 10 Mo.',
        'storage_failed' => 'Nous n\'avons pas pu enregistrer le fichier téléchargé. Veuillez réessayer.',
        'statement_missing' => 'Aucune déclaration de sauvegarde n\'est enregistrée pour cette communauté.',
        'file_missing' => 'Le fichier de déclaration de sauvegarde est introuvable sur le serveur. Veuillez le télécharger à nouveau.',
        'revoke_failed' => 'Nous ne pouvions pas révoquer cette préférence. Il se peut qu\'il ait déjà été révoqué.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS de base',
        'dbs_standard' => 'Norme DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Vérification Garda',
        'access_ni' => 'AccèsNI',
        'pvg_scotland' => 'PVG Ecosse',
        'international' => 'Vérification des antécédents internationaux',
        'other' => 'Autre contrôle de vérification',
        'uk_safeguarding_clearance' => 'Autorisation de sauvegarde du Royaume-Uni',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Juridiction de sauvegarde non configurée',
        'united_kingdom' => 'Royaume-Uni — ensemble de politiques nationales',
        'england_wales' => 'Angleterre et Pays de Galles',
        'scotland' => 'Écosse',
        'northern_ireland' => 'Irlande du Nord',
        'ireland' => 'République d\'Irlande',
        'custom' => 'Juridiction douanière',
    ],
    'attestations' => [
        'dbs_enhanced' => 'DBS amélioré confirmé pour un contact protégé avec les membres',
        'pvg_scotland' => 'Statut PVG confirmé pour le contact des membres protégés',
        'access_ni' => 'Statut AccessNI confirmé pour les contacts de membres protégés',
        'garda_vetting' => 'Garda Vetting confirmé pour un contact protégé avec les membres',
        'uk_safeguarding_clearance' => 'Autorisation de sauvegarde du Royaume-Uni confirmée pour le contact d\'un membre protégé',
    ],
    'confirmation' => [
        'title' => 'Vos préférences de sauvegarde ont été enregistrées',
        'intro' => 'Merci d\'avoir partagé cela. Voici un résumé de ce que vous avez choisi, qui peut le voir et ce qui s\'active en conséquence.',
        'your_selections' => 'Vos sélections',
        'no_selections' => 'Vous n\'avez sélectionné aucune option de sauvegarde.',
        'who_can_see_heading' => 'Qui peut voir ça',
        'who_can_see_body' => 'Seuls les coordinateurs et administrateurs de communauté peuvent voir ces préférences. Les autres membres ne le peuvent pas. Tous les accès sont enregistrés.',
        'what_activates_heading' => 'Ce qui s\'active en conséquence',
        'activation_broker_review' => 'Un coordinateur examinera et approuvera les correspondances ou les échanges sauvegardés lorsque votre préférence sélectionnée l\'exige. Cela ne leur donne pas accès au contenu des messages.',
        'activation_match_approval' => 'Un coordinateur approuvera les matchs vous impliquant avant qu’ils ne soient suggérés à l’autre membre.',
        'activation_discovery_hidden' => 'Les membres sans vérification enregistrés par cette communauté ne peuvent pas vous envoyer de messages, vous répondre, vous envoyer des crédits temps ou démarrer un échange avec vous.',
        'activation_notification' => 'Un coordinateur a été informé et vous contactera pour discuter de la manière dont nous pouvons vous aider.',
        'activation_none' => 'Aucune protection automatique ne s\'active à partir de ces sélections. Vos préférences sont enregistrées pour la connaissance du coordinateur.',
        'revoke_heading' => 'Comment les modifier ou les révoquer à tout moment',
        'revoke_body' => 'Vous pouvez consulter ou révoquer n\'importe laquelle de ces préférences à tout moment à partir des paramètres de votre profil. Vous n\'avez pas besoin de demander à un administrateur de le faire.',
        'revoke_cta' => 'Accédez aux paramètres de sauvegarde',
        'continue_cta' => 'Continuer',
    ],
    'settings' => [
        'page_title' => 'Préférences de sauvegarde',
        'intro' => 'Vérifiez ou révoquez les préférences de protection que vous avez définies lors de l\'intégration. Vos coordinateurs peuvent les voir, mais les autres membres ne le peuvent pas.',
        'no_preferences' => 'Vous n\'avez aucune préférence de sauvegarde active. Vous pouvez les définir à tout moment depuis la page d’aide sur la sauvegarde.',
        'selected_on' => 'Sélectionné le :date',
        'revoke_button' => 'Révoquer',
        'revoke_confirm_title' => 'Révoquer cette préférence ?',
        'revoke_confirm_body' => 'Cette préférence ne s\'appliquera plus à votre compte. Vos coordinateurs seront informés du changement.',
        'revoke_confirm_yes' => 'Oui, révoquer',
        'revoke_confirm_no' => 'Gardez-le',
        'revoked_toast' => 'Préférence révoquée.',
        'revoke_error_toast' => 'Quelque chose s\'est mal passé. Veuillez réessayer.',
        'switch_heading' => 'Une option plus douce est disponible',
        'switch_body' => 'Vous avez choisi d\'être contacté uniquement par les membres dont cette communauté a enregistré les avis. Cela empêche presque tout le monde de vous joindre. Vous pouvez demander à un coordinateur de garder un œil sur vos échanges et de vous présenter aux membres, et les autres membres pourront à nouveau vous envoyer des messages.',
        'switch_button' => 'Passer aux présentations du coordinateur',
        'switched_toast' => 'Fait. Un coordinateur gardera un œil sur vos échanges et les membres pourront vous envoyer à nouveau des messages.',
        'switch_not_held' => 'Vous n’avez pas le paramètre réservé aux membres approuvés, il n’y a donc rien à changer.',
        'switch_unavailable' => 'Les présentations des coordinateurs ne sont pas encore disponibles dans cette communauté. Veuillez contacter un coordinateur.',
    ],
    'effects' => [
        'broker_approval' => 'Un coordinateur examine tout échange que vous organisez avant qu’il n’ait lieu. Ils ne peuvent pas lire vos messages.',
        'restricts_messaging' => 'Les autres membres ne peuvent pas vous envoyer de message directement. Un coordinateur organise le contact pour vous.',
        'restricts_matching' => 'Les correspondances suggérées entre vous et les autres membres sont d’abord vérifiées par un coordinateur.',
        'vetted_only' => 'Seuls les membres dont :vetting cette communauté a enregistré peuvent vous envoyer un message, vous répondre, vous envoyer des crédits temps ou démarrer un échange avec vous. Tout le monde est bloqué.',
        'vetted_count' => '{0} Aucun membre n\'a :vetting enregistré ici pour le moment. Personne ne peut donc vous contacter pendant que cette activité est activée.|{1} Un seul membre a :vetting enregistré ici pour le moment.|[2,*] :count membres ont :vetting enregistrés ici pour le moment.',
        'notify_coordinator' => 'Un coordinateur est informé de votre choix et peut vous contacter si vous avez besoin de quoi que ce soit.',
        'no_home_visits' => 'Les coordonnateurs savent que vous ne souhaitez pas de visites à domicile à moins qu\'ils ne les organisent.',
        'informational' => 'Rien ne change pour les autres membres. Votre réponse aide les coordinateurs à vous soutenir.',
        'declined' => 'Rien ne change. Les coordinateurs peuvent voir que vous avez examiné cette étape.',
        'vetting_fallback' => 'vérification',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Cette communauté prend la sauvegarde au sérieux. Si vous souhaitez faire preuve de plus de prudence pendant que vous utilisez la banque de temps, faites-le-nous savoir ci-dessous et nos coordinateurs vous aideront. Chaque choix vous indique exactement ce qu\'il fait avant que vous le choisissiez.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Je me considère comme un adulte vulnérable et j\'aimerais un soutien supplémentaire',
                    'description' => 'Un coordinateur vous contactera pour discuter de la manière dont nous pouvons vous aider et examinera vos échanges et matchs. Les autres membres peuvent toujours vous envoyer un message.',
                ],
                'coordinator_introductions' => [
                    'label' => 'J\'aimerais qu\'un coordinateur garde un œil sur mes échanges et m\'aide à me présenter aux membres',
                    'description' => 'Bien si vous souhaitez être rassuré sans être coupé. Les autres membres peuvent toujours vous envoyer un message.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Seuls les membres dont cette communauté a enregistré la vérification peuvent me contacter',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'J\'aimerais qu\'un coordinateur organise tous les contacts pour moi au lieu que les membres m\'envoient des messages directement',
                    'description' => 'Un coordinateur organisera les contacts et les échanges en votre nom. Les autres membres ne pourront pas vous envoyer de message directement.',
                ],
                'no_home_visits' => [
                    'label' => 'Je ne veux pas que des membres viennent chez moi à moins qu\'un coordinateur ne l\'ait organisé.',
                    'description' => 'Les coordonnateurs sont informés afin qu\'ils puissent vous aider à organiser toute visite à votre domicile et s\'assurer que les mesures de protection appropriées sont en place.',
                ],
                'works_with_children' => [
                    'label' => 'Je prévois de proposer des services susceptibles d’impliquer des enfants ou des jeunes (moins de 18 ans)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Je prévois de proposer des services susceptibles d’impliquer des personnes adultes vulnérables',
                ],
                'none_apply' => [
                    'label' => 'Aucune de ces situations ne me concerne',
                    'description' => 'J’ai examiné les options ci-dessus et aucune ne correspond à ma situation. Cette réponse est enregistrée afin que l’équipe de coordination sache que j’ai vu et pris en compte cette étape.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irlande',
            'vetting_authority' => 'Bureau national de vérification',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Irlande, Garda Vetting est organisée par l\'intermédiaire d\'une organisation chargée d\'un rôle particulier. Seul le fait de vérifier que cette communauté a enregistré compte ici, et non de vérifier que quelqu\'un l\'a fait par le biais de son travail ou d\'un autre groupe.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Un coordinateur organisera les contacts et les échanges en votre nom. Les autres membres ne pourront pas vous envoyer de message directement.',
                ],
                'works_with_children' => [
                    'description' => 'Une personne coordinatrice pourra discuter avec vous des exigences de la Garda Vetting. En Irlande, certaines activités impliquant des enfants nécessitent une vérification en vertu de la loi de 2012 sur le Bureau national de vérification.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Un coordinateur peut vous demander si Garda Vetting est nécessaire pour ce que vous envisagez de faire. En vertu de la loi de 2012 sur le Bureau national de contrôle, certains travaux principalement auprès de personnes vulnérables doivent être contrôlés par une organisation enregistrée.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Royaume-Uni',
            'vetting_authority' => 'DBS, Disclosure Scotland et AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Partout au Royaume-Uni, cela signifie un contrôle Enhanced DBS, PVG ou AccessNI que cette communauté a enregistré. Un chèque que quelqu\'un reçoit dans le cadre de son travail ou d\'un autre groupe ne compte pas ici.',
                ],
                'works_with_children' => [
                    'description' => 'Un coordinateur évaluera le rôle et la juridiction britannique applicable avant de décider quel contrôle de sauvegarde est légalement approprié.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Un coordinateur évaluera le rôle, les adultes impliqués et la juridiction britannique applicable avant de décider quel contrôle de sauvegarde est légalement approprié.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Angleterre et pays de Galles',
            'vetting_authority' => 'Service de divulgation et d’interdiction',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Angleterre et au Pays de Galles, cela signifie une vérification DBS améliorée que cette communauté a enregistrée. Un chèque que quelqu\'un reçoit dans le cadre de son travail ou d\'un autre groupe ne compte pas ici.',
                ],
                'works_with_children' => [
                    'description' => 'Une personne coordinatrice pourra discuter avec vous des exigences de vérification DBS.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Un coordinateur peut vous demander si une vérification DBS est nécessaire pour ce que vous envisagez de faire.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Écosse',
            'vetting_authority' => 'Disclosure Scotland (régime PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Je me considère comme une personne adulte vulnérable ou protégée et je peux avoir besoin d’un soutien supplémentaire en matière de protection',
                ],
                'requires_vetted_partners' => [
                    'description' => 'En Écosse, cela signifie l\'adhésion au programme PVG que cette communauté a enregistrée. L\'adhésion d\'une personne à travers son travail ou à un autre groupe ne compte pas ici.',
                ],
                'works_with_children' => [
                    'description' => 'Une personne coordinatrice pourra discuter avec vous de l’adhésion au régime PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Je prévois de proposer des services susceptibles d’impliquer des personnes adultes protégées',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlande du Nord',
            'vetting_authority' => 'AccèsNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Irlande du Nord, cela signifie un contrôle AccessNI que cette communauté a enregistré. Un chèque que quelqu\'un reçoit dans le cadre de son travail ou d\'un autre groupe ne compte pas ici.',
                ],
                'works_with_children' => [
                    'description' => 'Une personne coordinatrice pourra discuter avec vous de la vérification AccessNI.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Un coordinateur peut vous demander si une vérification AccessNI est nécessaire pour ce que vous envisagez de faire.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Personnalisé',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'Votre communauté a changé sa juridiction de sauvegarde. Votre protection existante reste active, mais veuillez consulter le libellé mis à jour dans Paramètres.',
        'jurisdiction_changed_staff' => 'La juridiction de sauvegarde a changé. Les protections des membres concernés restent actives et nécessitent désormais un examen par les membres.',
        'attestation_policy_rotated_member' => 'Votre communauté a entamé une révision de sa politique de sauvegarde. Votre courtier doit reconfirmer votre statut de contact privé ; il ne s\'agit pas d\'une expiration de certificat.',
        'reminder_subject' => 'Veuillez revoir vos préférences de sauvegarde',
        'reminder_title' => 'Il est temps de revoir vos préférences en matière de protection',
        'reminder_body' => 'Cela fait plus d\'un an que vous avez défini vos préférences de sauvegarde pour :community. Veuillez prendre un moment pour les examiner et confirmer qu\'ils s\'appliquent toujours, ou révoquer ceux qui ne le sont plus.',
        'reminder_cta' => 'Vérifier les préférences',
        'escalation_subject' => 'Examen de la protection des membres en cours',
        'escalation_title' => 'Examen annuel de sauvegarde en cours',
        'escalation_body' => ':name n\'a pas répondu à une demande de révision de ses préférences en matière de sauvegarde depuis 30 jours. Leurs préférences restent actives — le membre a le droit de les conserver. Veuillez nous contacter directement si vous souhaitez vous enregistrer.',
        'escalation_cta' => 'Afficher le membre dans le tableau de bord de sauvegarde',
    ],
];
