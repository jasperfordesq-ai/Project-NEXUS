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
        'service_name' => 'Comunidade atenciosa',
        'back_to_caring' => 'Voltar para a Comunidade Carinhosa',
        'back_to_caregiver' => 'De volta aos seus relacionamentos afetuosos',
        'success_title' => 'Sucesso',
        'error_title' => 'Há um problema',
        'unknown_member' => 'Membro desconhecido',
        'optional' => '(opcional)',
    ],
    'hub' => [
        'title' => 'Comunidade atenciosa',
        'caption' => 'Cuidado e suporte',
        'intro' => 'Providencie cuidados regulares para outro membro ou responda a um pedido de alguém que pediu para cuidar de você.',
        'caregiver_card_title' => 'Seus relacionamentos afetuosos',
        'caregiver_card_description' => 'Veja os relacionamentos que você solicitou, responda às solicitações sobre você e use as ferramentas que um relacionamento aprovado desbloqueia.',
        'become_title' => 'Torne-se um cuidador',
        'become_description' => 'Peça para prestar cuidados regulares a outro membro desta comunidade. Nada entra em vigor até que eles concordem e a equipe verifique.',
    ],
    'caregiver' => [
        'title' => 'Seus relacionamentos afetuosos',
        'caption' => 'Comunidade atenciosa',
        'intro' => 'Relacionamentos que você solicitou e seu estágio atual.',
        'none' => 'Você ainda não pediu para cuidar de ninguém.',
        'become_button' => 'Peça para cuidar de alguém',
        'incoming_title' => 'Pedidos sobre você',
        'incoming_intro' => 'Esses membros pediram para cuidar de você. Concorde apenas se você compreender e aceitar o que isso significa.',
        'incoming_explanation' => 'Se você concordar, a equipe verificará a solicitação antes do início do relacionamento. Concordar não inicia por si só.',
        'incoming_none' => 'Ninguém pediu para cuidar de você.',
        'confirm_button' => 'Eu concordo com esse relacionamento',
        'reject_button' => 'eu não concordo',
        'status_heading' => 'Estágio',
        'status_pending_recipient' => 'Esperando que o outro membro concorde',
        'status_pending_staff' => 'Aguardando uma verificação de proteção de pessoal',
        'status_active' => 'Aprovado e ativo',
        'status_rejected' => 'Não aprovado',
        'status_inactive' => 'Terminou',
        'relationship_heading' => 'Relação',
        'relationship_family' => 'Família',
        'relationship_friend' => 'Amigo',
        'relationship_neighbour' => 'Vizinho',
        'relationship_professional' => 'Cuidador profissional',
        'started_heading' => 'Cuidados iniciados',
        'reason_heading' => 'Razão dada',
        'pending_no_tools' => 'Enquanto uma solicitação estiver aguardando, você não terá acesso aos detalhes de atendimento desse membro.',
        'active_tools_title' => 'O que esse relacionamento permite que você faça',
        'request_on_behalf_link' => 'Peça ajuda em nome deste membro',
    ],
    'link' => [
        'title' => 'Peça para cuidar de alguém',
        'caption' => 'Comunidade atenciosa',
        'intro' => 'Peça para prestar cuidados regulares a outro membro desta comunidade.',
        'consent_warning' => 'O membro que você nomear será questionado se concorda. A equipe verificará a solicitação. O relacionamento não começa e não lhe dá nada até que ambos tenham acontecido.',
        'search_label' => 'Encontre o membro que você deseja cuidar',
        'search_hint' => 'Insira parte do nome e escolha-os nos resultados.',
        'search_button' => 'Procurar',
        'results_title' => 'Escolha um membro',
        'results_none' => 'Nenhum membro corresponde a esse nome. Tente uma grafia diferente.',
        'choose_button' => 'Escolher',
        'chosen_label' => 'Membro que você escolheu',
        'change_button' => 'Mudar',
        'relationship_label' => 'Seu relacionamento com eles',
        'start_date_label' => 'Data em que o atendimento começou ou irá começar',
        'start_date_hint' => 'Por exemplo, 27 3 2026',
        'notes_label' => 'Qualquer coisa que a equipe deva saber',
        'notes_hint' => 'Opcional. Isso é mostrado ao funcionário que verifica a solicitação.',
        'submit_button' => 'Enviar solicitação',
        'error_no_member' => 'Escolha o membro que você deseja cuidar',
        'error_no_relationship' => 'Selecione seu relacionamento com eles',
        'error_no_start_date' => 'Insira a data em que o atendimento começou ou irá começar',
        'error_bad_start_date' => 'Insira uma data real, por exemplo 27 3 2026',
        'error_search_too_short' => 'Digite pelo menos dois caracteres para pesquisar',
    ],
    'on_behalf' => [
        'title' => 'Peça ajuda em nome de alguém',
        'intro' => 'Peça à comunidade ajuda prática para o membro de quem você cuida. A solicitação fica registrada em seu nome e mostra que você a fez.',
        'for_member' => 'Este pedido é para',
        'title_label' => 'Que ajuda é necessária',
        'title_hint' => 'Por exemplo, uma carona para uma consulta no hospital.',
        'description_label' => 'Mais detalhes',
        'when_label' => 'Quando é necessário',
        'contact_label' => 'Como os ajudantes devem entrar em contato',
        'contact_phone' => 'Por telefone',
        'contact_message' => 'Por mensagem',
        'contact_either' => 'Qualquer um está bem',
        'submit_button' => 'Enviar solicitação',
        'error_no_title' => 'Digite que ajuda é necessária',
        'error_not_active' => 'Você só pode pedir ajuda em nome de um membro cujo relacionamento foi aprovado',
    ],
    'review' => [
        'title' => 'Cuidador solicita verificação',
        'caption' => 'Comunidade atenciosa',
        'intro' => 'Verifique se o destinatário do cuidado concordou e registre como você verificou isso antes de aprovar um relacionamento de carinho.',
        'none' => 'Nenhuma solicitação de cuidador está esperando para ser verificada.',
        'requested_by' => 'Solicitado por',
        'requested_for' => 'Para cuidar',
        'requested_on' => 'Solicitado em',
        'recipient_agreed' => 'O membro concordou',
        'recipient_not_agreed' => 'O membro ainda não concordou',
        'blocked_until_agreed' => 'Você não pode aprovar esta solicitação até que o membro concorde com ela.',
        'evidence_label' => 'Como você verificou o consentimento deles',
        'evidence_hint' => 'Por exemplo, uma chamada telefónica no dia 27 de março de 2026 com o próprio membro.',
        'attestation_label' => 'Confirmo que verifiquei pessoalmente o consentimento deste membro',
        'approve_button' => 'Aprovar relacionamento',
        'reject_label' => 'Por que você está recusando este pedido',
        'reject_hint' => 'Isso é gravado e mostrado ao membro que solicitou.',
        'reject_button' => 'Recusar pedido',
        'decided_approved' => 'Aprovado',
        'decided_rejected' => 'Recusado',
        'error_no_evidence' => 'Digite como você verificou o consentimento deles',
        'error_no_attestation' => 'Confirme que você mesmo verificou o consentimento deste membro',
        'error_no_reason' => 'Digite por que você está recusando esta solicitação',
    ],
    'status' => [
        'link_requested' => 'Sua solicitação foi enviada. Está aguardando a concordância do outro membro e, em seguida, uma verificação da equipe.',
        'link_failed' => 'Não foi possível enviar sua solicitação.',
        'link_duplicate' => 'Você já tem uma solicitação ou um relacionamento aprovado com esse membro.',
        'incoming_confirmed' => 'Você concordou. A equipe agora verificará a solicitação antes do início do relacionamento.',
        'incoming_rejected' => 'Você recusou. Nenhum relacionamento foi criado.',
        'incoming_failed' => 'Não foi possível salvar sua resposta.',
        'review_approved' => 'A relação de carinho foi aprovada.',
        'review_rejected' => 'O pedido foi recusado.',
        'review_not_agreed' => 'Essa solicitação não pode ser aprovada porque o membro não concordou com ela.',
        'review_failed' => 'Essa decisão não pôde ser salva.',
        'review_not_found' => 'Essa solicitação não foi encontrada nesta comunidade.',
        'on_behalf_sent' => 'O pedido de ajuda foi enviado.',
        'on_behalf_failed' => 'O pedido de ajuda não pôde ser enviado.',
    ],
];
