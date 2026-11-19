<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

/**
 * MatchConcepts — groups of words that ask for, or offer, the same kind of
 * help, in the platform's European languages.
 *
 * Without an AI model the matcher only sees shared WORDS, and most genuine
 * pairs share none: "babysitter" / "childcare", "my laptop is slow" /
 * "computer repair", "lifts to hospital" / "I can drive you to the doctor".
 * KeywordExtractor adds a concept token ("~childcare") for every word found
 * here, so such pairs overlap.
 *
 * Rules for editing:
 *  - One word per entry. Written as people write it: KeywordExtractor folds
 *    accents and trims word endings on both sides, so "jardín", "jardines"
 *    and "Jardin" all land on the same stem.
 *  - Two-word phrases are matched as one joined word ("flat pack" →
 *    "flatpack"), so list them joined.
 *  - Leave out words that commonly mean something else. "piano" is not in
 *    ~music because "help moving a piano" is not a music request; "car" is
 *    not in ~transport because "car repair" is not a lift; "kinder" is left
 *    out because its stem is the English word "kind". A missing word costs a
 *    weaker match; a wrong word introduces strangers who cannot help.
 *  - Arabic and Japanese are not covered: Japanese is not written with
 *    spaces between words, so word matching cannot work for it at all.
 */
final class MatchConcepts
{
    /** @var array<string, string[]> concept => words */
    public const GROUPS = [
        'gardening' => [
            'garden', 'gardens', 'gardening', 'gardener', 'lawn', 'lawns', 'mow', 'mowing', 'mower', 'lawnmower',
            'grass', 'hedge', 'hedges', 'weeding', 'weeds', 'pruning', 'prune', 'allotment', 'planting', 'plants',
            'patio', 'paving', 'decking', 'fencing', 'landscaping', 'compost', 'composting', 'tree', 'trees',
            'shrubs', 'greenhouse', 'strimming', 'strimmer',
            'jardín', 'jardines', 'jardinería', 'césped', 'jardinage', 'jardiner', 'pelouse', 'tondre', 'garten',
            'gartenarbeit', 'rasen', 'rasenmähen', 'giardino', 'giardinaggio', 'jardim', 'jardinagem', 'relva',
            'tuin', 'tuinieren', 'tuinman', 'maaien', 'ogród', 'ogrodzie', 'ogrodnictwo', 'trawa', 'trawy',
            'koszenie', 'gairdín', 'garraíodóireacht', 'féar',
        ],
        // Minding children. The words for children themselves are in
        // 'children' below: "swimming lessons for my kids" is not childcare.
        'childcare' => [
            'childcare', 'babysit', 'babysitter', 'babysitting', 'nanny', 'childminder', 'childminding', 'creche',
            'niñera', 'canguro', 'guardería', 'nounou', 'kinderbetreuung', 'babysitten', 'babá', 'oppas',
            'oppassen', 'kinderopvang', 'opiekunka', 'niania',
        ],
        // Who the help is for (see GENERIC). The childcare words are here as
        // well, so "someone to look after my kids" still meets "babysitter".
        'children' => [
            'kids', 'children', 'child', 'toddler', 'toddlers', 'niños', 'enfants', 'bambini', 'crianças',
            'kinderen', 'dzieci', 'páistí', 'leanaí', 'schoolrun',
            'childcare', 'babysit', 'babysitter', 'babysitting', 'nanny', 'childminder', 'childminding', 'creche',
            'niñera', 'canguro', 'guardería', 'nounou', 'kinderbetreuung', 'babysitten', 'babá', 'oppas',
            'oppassen', 'kinderopvang', 'opiekunka', 'niania',
        ],
        // "chat" is left out ("call me for a chat" ends many listings of every
        // kind), and so is "carer": trimmed, it is the word "car".
        'older_people' => [
            'elderly', 'older', 'senior', 'seniors', 'pensioner', 'pensioners', 'companionship', 'companion',
            'befriending', 'befriend', 'lonely', 'loneliness', 'listeningear', 'respite', 'dementia',
            'alzheimers', 'housebound', 'isolated', 'mayores', 'ancianos', 'acompañamiento', 'compañía',
            'âgées', 'compagnie', 'accompagnement', 'senioren', 'begleitung', 'anziani', 'compagnia', 'idosos',
            'companhia', 'ouderen', 'gezelschap', 'seniorzy', 'starsi', 'towarzystwo', 'seanóirí', 'comhluadar',
        ],
        'pets' => [
            'dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'pet', 'pets', 'dogwalking', 'petsitting', 'perro',
            'perros', 'mascota', 'mascotas', 'gato', 'gatos', 'chien', 'chiens', 'hund', 'hunde', 'katze',
            'haustier', 'gatto', 'animali', 'cão', 'cachorro', 'hond', 'honden', 'huisdier', 'kot', 'koty', 'madra',
            'hamster', 'rabbit', 'rabbits', 'guineapig', 'budgie',
        ],
        'transport' => [
            'lift', 'lifts', 'driving', 'drive', 'driver', 'ride', 'rides', 'transport', 'taxi', 'carpool',
            'schoolrun',
            'conducir', 'transporte', 'conduire', 'covoiturage', 'chauffeur', 'fahren', 'fahrdienst', 'mitfahrt',
            'mitnehmen', 'passaggio', 'guidare', 'trasporto', 'boleia', 'carona', 'conduzir', 'rijden', 'vervoer',
            'podwózka', 'podwiezienie', 'kierowca', 'síob', 'tiomáint',
        ],
        'health' => [
            'hospital', 'doctor', 'gp', 'appointment', 'appointments', 'clinic', 'dentist', 'pharmacy',
            'prescription', 'prescriptions', 'médico', 'cita', 'hôpital', 'médecin', 'arzt', 'krankenhaus',
            'ospedale', 'ziekenhuis', 'huisarts', 'afspraak', 'szpital', 'lekarz', 'wizyta', 'ospidéal', 'dochtúir',
            'coinne',
        ],
        'shopping' => [
            'shopping', 'groceries', 'grocery', 'errands', 'errand', 'compras', 'recados', 'supermercado',
            'einkaufen', 'einkauf', 'besorgungen', 'spesa', 'commissioni', 'boodschappen', 'zakupy',
            'siopadóireacht',
        ],
        'diy' => [
            'diy', 'handyman', 'shelf', 'shelves', 'shelving', 'drill', 'drilling', 'flatpack', 'assembly',
            'woodwork', 'woodworking', 'carpentry', 'carpenter',
            'assemble', 'furniture', 'ikea', 'bricolage', 'montaje', 'muebles', 'bricoler', 'meubles', 'heimwerken',
            'möbel', 'aufbauen', 'montaggio', 'mobili', 'montagem', 'móveis', 'klusjes', 'klussen', 'meubels',
            'montaż', 'meble', 'troscán',
        ],
        'plumbing' => [
            'plumber', 'plumbing', 'leak', 'leaking', 'leaky', 'tap', 'taps', 'sink', 'toilet', 'pipe', 'pipes',
            'drain', 'radiator', 'radiators', 'fontanero', 'fontanería', 'grifo', 'plombier', 'plomberie', 'fuite', 'robinet', 'klempner',
            'wasserhahn', 'idraulico', 'rubinetto', 'canalizador', 'torneira', 'loodgieter', 'kraan', 'lekkage',
            'hydraulik', 'pluiméir', 'sconna',
        ],
        // "light" and "lights" are left out: "light housework" is not electrical.
        'electrical' => [
            'electrician', 'electrical', 'electric', 'wiring', 'socket', 'sockets', 'fuse', 'lamp', 'lamps',
            'bulb', 'bulbs', 'lightbulb', 'lightfitting', 'lightswitch', 'rewire', 'rewiring', 'electricista',
            'électricien', 'elektriker', 'elettricista', 'eletricista', 'elektricien', 'elektryk', 'leictreoir',
        ],
        'decorating' => [
            'painting', 'paint', 'painter', 'decorating', 'decorator', 'wallpaper', 'wallpapering', 'tiling',
            'tiler', 'tiles', 'grouting', 'plastering', 'plasterer', 'pintar',
            'pintura', 'peindre', 'peinture', 'streichen', 'maler', 'tapezieren', 'imbiancare', 'schilderen',
            'schilder', 'behangen', 'behanger', 'malowanie', 'malarz', 'péinteáil',
        ],
        'moving' => [
            'moving', 'removal', 'removals', 'packing', 'unpacking', 'rubbish', 'dump', 'recycling',
            // "van" alone is the Dutch for "of" and is dropped as a filler
            // word, so it is listed joined to the word beside it.
            'avan', 'thevan', 'myvan', 'ownvan', 'andvan', 'withvan', 'vanhire', 'vandriver',
            'mudanza', 'déménagement', 'déménager', 'umzug',
            'umziehen', 'trasloco', 'mudança', 'verhuizen', 'verhuizing', 'przeprowadzka',
        ],
        'computers' => [
            'computer', 'computers', 'laptop', 'laptops', 'pc', 'tablet', 'ipad', 'iphone', 'smartphone', 'android',
            'email', 'emails', 'internet', 'wifi', 'printer', 'software', 'tech', 'technology', 'ordenador',
            'portátil', 'computadora', 'informática', 'ordinateur', 'informatique', 'rechner', 'informatica',
            'computador', 'komputer', 'laptopa', 'ríomhaire', 'ríomhaireacht',
            // "mobile" is left out: a "mobile hairdresser" is not tech help.
            'phone', 'phones', 'whatsapp', 'zoom', 'facebook', 'website', 'websites', 'app', 'apps', 'password',
            'passwords', 'broadband', 'digital', 'digitale', 'socialmedia', 'instagram', 'youtube',
            'spreadsheet', 'spreadsheets', 'excel', 'powerpoint', 'gmail', 'skype', 'coding', 'programming',
            'onlinebanking', 'teléfono', 'téléphone', 'telefon', 'telefono',
            'telefone', 'telefoon',
        ],
        // Language help in general (see GENERIC): it does not say WHICH
        // language. Every language name below is here too, so "language
        // exchange" still meets "French lessons", while "French conversation"
        // and "Spanish lessons" each name a different language and do not.
        'languages' => [
            'language', 'languages', 'conversation', 'idioma', 'idiomas', 'conversación', 'langue', 'langues',
            'sprache', 'sprachen', 'konversation', 'lingua', 'lingue', 'conversazione', 'língua', 'conversação',
            'taal', 'talen', 'język', 'teanga',
            'english', 'inglés', 'anglais', 'englisch', 'inglese', 'inglês', 'engels', 'angielski', 'béarla',
            'french', 'francés', 'français', 'französisch', 'francese', 'francês', 'frans', 'francuski', 'fraincis',
            'spanish', 'español', 'espagnol', 'spanisch', 'spagnolo', 'espanhol', 'spaans', 'hiszpański', 'spáinnis',
            'german', 'alemán', 'allemand', 'deutsch', 'tedesco', 'alemão', 'duits', 'niemiecki', 'gearmáinis',
            'italian', 'italiano', 'italien', 'italienisch', 'italiaans', 'włoski', 'iodáilis',
            'irish', 'gaelic', 'gaeilge', 'irlandés', 'irlandais', 'irisch', 'irlandese', 'iers', 'irlandzki',
            'signlanguage', 'isl', 'bsl',
        ],
        'lang_english' => ['english', 'inglés', 'anglais', 'englisch', 'inglese', 'inglês', 'engels', 'angielski', 'béarla'],
        'lang_french' => ['french', 'francés', 'français', 'französisch', 'francese', 'francês', 'frans', 'francuski', 'fraincis'],
        'lang_spanish' => ['spanish', 'español', 'espagnol', 'spanisch', 'spagnolo', 'espanhol', 'spaans', 'hiszpański', 'spáinnis'],
        'lang_german' => ['german', 'alemán', 'allemand', 'deutsch', 'tedesco', 'alemão', 'duits', 'niemiecki', 'gearmáinis'],
        'lang_italian' => ['italian', 'italiano', 'italien', 'italienisch', 'italiaans', 'włoski', 'iodáilis'],
        'lang_irish' => ['irish', 'gaelic', 'gaeilge', 'irlandés', 'irlandais', 'irisch', 'irlandese', 'iers', 'irlandzki'],
        'lang_sign' => ['signlanguage', 'isl', 'bsl'],
        // HOW help is given (see GENERIC): a lesson can be in anything, so
        // "guitar lessons" and "French lessons" are not the same kind of help.
        'teaching' => [
            'tutor', 'tutoring', 'tuition', 'lesson', 'lessons', 'teach', 'teaching', 'teacher',
            'class', 'classes', 'course', 'cours', 'clase', 'clases',
            'profesor', 'enseñar', 'leçon', 'leçons', 'professeur',
            'nachhilfe', 'unterricht', 'lehrer', 'lezione', 'lezioni', 'ripetizioni',
            'insegnante', 'aulas', 'explicações', 'professor', 'bijles', 'korepetycje',
            'lekcja', 'lekcje', 'nauczyciel', 'ceacht', 'ceachtanna', 'múinteoir', 'grinds',
        ],
        // School subjects and school work: a kind of help in its own right.
        // The words for private school tuition are here and in 'teaching'.
        'schoolwork' => [
            'homework', 'exam', 'exams', 'maths', 'math', 'mathematics', 'grinds', 'literacy', 'spelling',
            'phonics', 'science', 'physics', 'chemistry', 'biology', 'algebra', 'revision', 'gcse', 'leavingcert',
            'juniorcert', 'deberes', 'matemáticas',
            'devoirs', 'nachhilfe', 'hausaufgaben', 'mathe', 'ripetizioni', 'compiti', 'explicações', 'bijles',
            'huiswerk', 'korepetycje',
        ],
        'music' => [
            'music', 'musical', 'guitar', 'violin', 'drums', 'singing', 'choir', 'ukulele', 'flute', 'música',
            'guitarra', 'cantar', 'musique', 'guitare', 'chanter', 'chorale', 'musik', 'gitarre', 'singen', 'chor',
            'musica', 'chitarra', 'cantare', 'violão', 'muziek', 'gitaar', 'zingen', 'koor', 'muzyka', 'gitara',
            'śpiew', 'ceol', 'giotár', 'amhránaíocht',
        ],
        'arts' => [
            'art', 'arts', 'craft', 'crafts', 'crafting', 'drawing', 'sketching', 'watercolour', 'pottery',
            'graphic', 'graphics', 'graphicdesign', 'logo', 'logos', 'illustration',
            // "painting" alone is in 'decorating' (a fence, a room).
            'portrait', 'portraits', 'oilpainting', 'acrylic', 'acrylics', 'sculpture', 'calligraphy',
            'artist', 'artists',
            'manualidades', 'dibujo', 'artisanat', 'dessin', 'basteln', 'zeichnen', 'kunst', 'disegno',
            'artigianato', 'artesanato', 'desenho', 'knutselen', 'tekenen', 'rękodzieło', 'rysunek', 'ealaín',
            'ceardaíocht',
        ],
        'sewing' => [
            'sewing', 'sew', 'alterations', 'mending', 'mend', 'hemming', 'knitting', 'knit', 'crochet',
            'embroidery', 'quilting', 'dressmaking', 'dressmaker', 'curtainmaking', 'tailoring', 'tailor',
            'seamstress', 'upholstery', 'upholsterer', 'darning', 'costura', 'coser', 'arreglos', 'tejer', 'couture', 'coudre', 'retouches',
            'tricot', 'tricoter', 'nähen', 'stricken', 'häkeln', 'cucito', 'cucire', 'uncinetto', 'tricô', 'crochê',
            'naaien', 'breien', 'szycie', 'szydełkowanie', 'fuáil', 'cniotáil',
        ],
        'hair_beauty' => [
            'haircut', 'haircuts', 'hairdresser', 'hairdressing', 'hair', 'barber', 'nails', 'manicure', 'makeup',
            'beauty', 'peluquería', 'peluquero', 'coiffure', 'coiffeur', 'cheveux', 'friseur', 'haare',
            'haarschnitt', 'parrucchiere', 'capelli', 'cabeleireiro', 'cabelo', 'kapper', 'fryzjer', 'włosy',
            'gruagaire', 'gruaig',
        ],
        'fitness' => [
            'fitness', 'exercise', 'exercises', 'gym', 'jogging', 'hiking', 'swimming', 'sport', 'sports',
            'pilates', 'dance', 'dancing', 'rambling', 'hillwalking', 'aerobics', 'zumba', 'keepfit', 'badminton',
            'tennis', 'golf', 'football', 'weightlifting', 'weighttraining', 'weights', 'ejercicio', 'deporte', 'gimnasio', 'baile', 'exercice', 'danse',
            'tanzen', 'esercizio', 'ginnastica', 'palestra', 'danza', 'exercício', 'ginásio', 'dança', 'sporten',
            'dansen', 'ćwiczenia', 'taniec', 'aclaíocht', 'damhsa', 'spórt',
        ],
        'wellbeing' => [
            'yoga', 'meditation', 'mindfulness', 'massage', 'reiki', 'relaxation', 'reflexology', 'taichi',
            'aromatherapy', 'qigong', 'meditación', 'masaje',
            'méditation', 'entspannung', 'meditazione', 'massaggio', 'meditação', 'massagem', 'meditatie',
            'ontspanning', 'medytacja', 'masaż',
        ],
        'cooking' => [
            'cooking', 'cook', 'meal', 'meals', 'baking', 'bake', 'cake', 'cakes', 'bread', 'dinner', 'dinners',
            'lunch', 'recipe', 'recipes', 'chef', 'chutney', 'marmalade', 'soup', 'catering', 'scones', 'cookery',
            'cocinar', 'comida', 'hornear', 'repostería', 'recetas',
            'cuisiner', 'repas', 'pâtisserie', 'recette', 'kochen', 'backen', 'rezept', 'cucinare', 'pasti',
            'ricette', 'cozinhar', 'bolos', 'refeição', 'receitas', 'koken', 'bakken', 'maaltijd', 'gotowanie',
            'pieczenie', 'posiłki', 'cócaireacht', 'bácáil', 'béile',
        ],
        'cleaning' => [
            'cleaning', 'clean', 'cleaner', 'hoovering', 'hoover', 'vacuum', 'vacuuming', 'dusting', 'housework',
            'tidy', 'tidying', 'declutter', 'decluttering', 'laundry', 'ironing', 'iron', 'clearing', 'clearance',
            'gutter', 'gutters', 'valet', 'valeting', 'carwash', 'powerwash', 'powerwashing', 'jetwash',
            'limpieza', 'limpiar', 'planchar',
            'colada', 'ménage', 'nettoyage', 'nettoyer', 'repassage', 'putzen', 'reinigung', 'bügeln', 'wäsche',
            'aufräumen', 'pulizia', 'pulire', 'stirare', 'bucato', 'limpeza', 'limpar', 'schoonmaken', 'poetsen',
            'strijken', 'sprzątanie', 'prasowanie', 'pranie', 'glanadh', 'iarnáil',
        ],
        'paperwork' => [
            'paperwork', 'letters', 'admin', 'administration', 'bills', 'typing', 'filing', 'formfilling',
            'applications', 'welfare', 'pension', 'passport', 'visa', 'papeleo',
            'formularios', 'trámites', 'formulaires', 'démarches', 'formulare', 'papierkram', 'behörden', 'moduli',
            'pratiche', 'burocrazia', 'papelada', 'formulários', 'papierwerk', 'formulieren', 'administratie',
            'formularze', 'foirmeacha', 'páipéarachas',
        ],
        // "job" and "jobs" are left out: "odd jobs" is not help finding work.
        'jobs' => [
            'cv', 'resume', 'curriculum', 'interview', 'interviews', 'career', 'careers',
            'employment', 'currículum', 'empleo', 'entrevista', 'emploi', 'entretien', 'candidature',
            'lebenslauf', 'bewerbung', 'vorstellungsgespräch', 'colloquio', 'candidatura', 'currículo', 'emprego',
            'sollicitatie', 'sollicitatiegesprek', 'życiorys', 'agallamh',
        ],
        'money' => [
            'budget', 'budgeting', 'money', 'finances', 'finance', 'tax', 'taxes', 'accounts', 'accounting',
            'bookkeeping', 'presupuesto', 'finanzas', 'impuestos', 'contabilidad', 'impôts', 'comptabilité',
            'finanzen', 'steuern', 'buchhaltung', 'finanze', 'contabilità', 'orçamento', 'finanças', 'impostos',
            'contabilidade', 'financiën', 'belasting', 'boekhouding', 'budżet', 'finanse', 'podatki', 'księgowość',
            'buiséad', 'cáin',
        ],
        'photography' => [
            'photography', 'photo', 'photos', 'photographer', 'camera', 'filming', 'videography', 'fotografía', 'fotos', 'photographie',
            'fotografie', 'fotografia', 'zdjęcia', 'grianghrafadóireacht',
        ],
        'writing' => [
            'writing', 'write', 'editing', 'proofreading', 'proofread', 'copywriting', 'escribir', 'redacción',
            'écrire', 'rédaction', 'relecture', 'schreiben', 'korrekturlesen', 'scrittura', 'escrita', 'schrijven',
            'redactie', 'pisanie', 'korekta', 'scríbhneoireacht',
        ],
        'translation' => [
            'translation', 'translate', 'translating', 'interpreter', 'interpreting', 'traducción', 'traducir',
            'intérprete', 'traduction', 'traduire', 'übersetzung', 'übersetzen', 'dolmetscher', 'traduzione',
            'tradurre', 'tradução', 'traduzir', 'vertaling', 'vertalen', 'tłumaczenie', 'tłumacz', 'aistriúchán',
        ],
        'bikes' => [
            'bike', 'bikes', 'bicycle', 'bicycles', 'puncture', 'bici', 'bicicleta', 'vélo', 'fahrrad',
            'bicicletta', 'fiets', 'rower', 'rothar',
        ],
        'car_repair' => [
            'mechanic', 'vehicle', 'tyre', 'tyres', 'tire', 'tires', 'jumpstart', 'jumpleads', 'engine', 'brakes',
            'carrepair', 'carrepairs', 'carservice', 'mecánico', 'mécanicien', 'werkstatt',
            'meccanico', 'mecânico', 'monteur', 'samochód', 'mechanik', 'gluaisteán',
        ],
        'housesitting' => ['housesitting', 'housesit', 'housesitter'],
        'games' => [
            'chess', 'boardgames', 'boardgame', 'scrabble', 'bingo', 'quiz', 'jigsaw', 'jigsaws',
            'draughts', 'dominoes',
            // "bridge" alone is also something that gets repaired.
            'bridgeclub', 'bridgepartner', 'bridgenight', 'bridgegame', 'bridgeplayer', 'playbridge',
        ],
        // Help running a group or an event.
        'organising' => [
            'fundraising', 'fundraiser', 'leaflet', 'leaflets', 'leafleting', 'stewarding', 'steward',
            'marshalling', 'minutetaking', 'raffle',
        ],
        'first_aid' => ['firstaid', 'cpr', 'defibrillator'],
    ];

    /**
     * Groups that say HOW help is given, WHO it is for or WHERE it happens,
     * not WHAT it is. Sharing one of these is weak evidence on its own, and
     * it never makes two listings "the same kind of help" when each also
     * names a different kind: "guitar lessons" and "French lessons" share
     * ~teaching and nothing else that matters.
     */
    public const GENERIC = ['teaching', 'children', 'health', 'languages'];

    /**
     * Kinds of help that one person often does both of. Two listings whose
     * kinds are related are not treated as different kinds of help (a
     * handyman may well fix a tap), and get no credit for being the same.
     * Every group in a row is related to every other group in that row.
     *
     * @var array<int, string[]>
     */
    public const RELATED = [
        ['diy', 'plumbing', 'electrical', 'decorating'],
        ['fitness', 'wellbeing'],
        ['arts', 'sewing'],
        ['bikes', 'car_repair'],
        ['pets', 'housesitting'],
        ['paperwork', 'money'],
        ['paperwork', 'writing'],
        ['writing', 'translation'],
    ];

    /** @var array<string, array<string, true>>|null */
    private static ?array $relatedIndex = null;

    /** Whether a concept (with or without its "~") is a generic one. */
    public static function isGeneric(string $concept): bool
    {
        return in_array(ltrim($concept, KeywordExtractor::CONCEPT_PREFIX), self::GENERIC, true);
    }

    /** Whether two different concepts (with or without their "~") are related kinds of help. */
    public static function related(string $a, string $b): bool
    {
        if (self::$relatedIndex === null) {
            $index = [];
            foreach (self::RELATED as $row) {
                foreach ($row as $one) {
                    foreach ($row as $other) {
                        if ($one !== $other) {
                            $index[$one][$other] = true;
                        }
                    }
                }
            }
            self::$relatedIndex = $index;
        }

        $a = ltrim($a, KeywordExtractor::CONCEPT_PREFIX);
        $b = ltrim($b, KeywordExtractor::CONCEPT_PREFIX);

        return isset(self::$relatedIndex[$a][$b]);
    }
}
