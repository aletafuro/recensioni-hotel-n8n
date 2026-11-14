// FATTI PER IL DIGEST
// Il codice calcola i fatti e scrive le frasi con i numeri. Il modello riceve i
// fatti e restituisce solo commenti a parole (senza cifre) e citazioni: il digest
// lo monta il nodo "Verifica digest", che inserisce le frasi con i numeri.
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;
const A = $input.first().json.aggregazione;
const recensioni = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json]));
const analisi = new Map($('Valida e completa').all().map((i) => [i.json.review_id, i.json]));

const intero = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const perc = (x) => (x === null || x === undefined ? null : x > 0 && x < 1 ? String(x).replace('.', ',') + '%' : Math.round(x) + '%');
const dec = (x) => String(x).replace('.', ',');
const nome = (id) => A.aspetti.find((a) => a.aspect === id)?.nome ?? id;

const NOMI_PERSONA = /\b(Mr|Mrs|Ms|Miss|Mme|Dr|Sr|Sra|Herr|Frau|Sig|Signor|Signora)\.?\s+[A-Z][a-z]+/;

function candidati(aspect, sentimentAspetto, overallAmmessi, quanti) {
  const lista = [];
  for (const r of analisi.values()) {
    if (r.sospetta || !['ok', 'ritentata'].includes(r.stato)) continue;
    if (!overallAmmessi.includes(r.overall_sentiment)) continue;
    if (!r.aspects.some((x) => x.aspect === aspect && x.sentiment === sentimentAspetto)) continue;
    const rec = recensioni.get(r.review_id);
    if (!rec || rec.text.length < 80 || rec.text.length > 700 || NOMI_PERSONA.test(rec.text)) continue;
    if (/<[A-Z_]+>/.test(rec.text)) continue; // testi con dati oscurati: meglio non citarli
    lista.push({ r, rec });
  }
  // prima l'inglese (leggibile dalla direzione), poi le piu' recenti
  lista.sort((a, b) => (a.r.language === 'en' ? 0 : 1) - (b.r.language === 'en' ? 0 : 1) || (b.rec.published_date ?? '').localeCompare(a.rec.published_date ?? ''));
  return lista.slice(0, quanti).map(({ r, rec }) => ({
    review_id: r.review_id,
    data: rec.published_date,
    voto: `${rec.rating} su ${ctx.voto.massimo}`,
    lingua: r.language,
    testo: rec.text,
  }));
}

const top = (lista, n) => lista.slice(0, n);

// articolo davanti a una percentuale (il 12%, l'11%, lo 0,4%) e preposizioni articolate
function art(p) {
  const n = String(p);
  if (/^0/.test(n)) return 'lo ' + n;
  if (/^(8|11(?![\d])|1(?![\d])|1,)/.test(n)) return "l'" + n;
  return 'il ' + n;
}
function prep(p, base) {
  const a = art(p);
  const forme = { da: { 'il ': 'dal ', "l'": "dall'", 'lo ': 'dallo ' }, a: { 'il ': 'al ', "l'": "all'", 'lo ': 'allo ' } };
  for (const [k, v] of Object.entries(forme[base])) if (a.startsWith(k)) return v + a.slice(k.length);
  return a;
}
const misuraTesto = (m) => (m === 'pct_recensioni_che_lo_criticano' ? 'negativo' : 'positivo');

// la prova di una segnalazione e' stata accettata anche se quasi identica al testo:
// al digest si passa invece la frase ESATTA del testo che le somiglia di piu',
// cosi' il modello puo' citarla parola per parola
function provaEsatta(evidenza, testo) {
  if (!evidenza || !testo) return null;
  const pulito = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (pulito(testo).includes(pulito(evidenza))) {
    const i = pulito(testo).indexOf(pulito(evidenza));
    // ricostruisce lo stesso pezzo con gli spazi originali
    const testoSpazi = testo.replace(/\s+/g, ' ');
    return testoSpazi.slice(i, i + pulito(evidenza).length).trim();
  }
  const parole = new Set(pulito(evidenza).match(/[\p{L}\p{N}]+/gu) ?? []);
  const frasi = testo.split(/(?<=[.!?])\s+|\n+/).map((f) => f.replace(/\s+/g, ' ').trim()).filter((f) => f.length > 10);
  let migliore = null, punti = 0;
  for (const f of frasi) {
    const p = (pulito(f).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => parole.has(w)).length;
    if (p > punti) { punti = p; migliore = f; }
  }
  return migliore ? migliore.split(' ').slice(0, 30).join(' ') : null;
}

// parole che indicano l'aspetto in una frase (dai temi raggruppati): servono a
// scegliere, nel digest di riserva, una frase che parla davvero di quell'aspetto
const tassonomia = $('Valida tassonomia').first().json.aspetti;
function paroleChiave(aspect) {
  const a = tassonomia.find((x) => x.aspect === aspect);
  const parole = [...(a?.temi_raggruppati ?? []), aspect.replace(/_/g, ' ')].join(' ').toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const generiche = new Set(['quality', 'service', 'services', 'experience', 'overall', 'general', 'level', 'value']);
  return [...new Set(parole)].filter((p) => !generiche.has(p));
}
const S = A.sentiment_complessivo;
const anni = [A.meta.prima_data?.slice(0, 4), A.meta.ultima_data?.slice(0, 4)];

const significativi = A.andamento.filter((x) => x.significativo);
const fatti = {
  // FRASI CON I NUMERI: le scrive il codice, il modello le copia identiche.
  // Cosi' un numero non puo' cambiare significato (es. una quota sul totale
  // presentata come quota su chi parla dell'aspetto).
  frase_sintesi: `Sono state analizzate ${intero(A.meta.recensioni_aggregate)} recensioni pubblicate dal ${anni[0]} al ${anni[1]}. Il voto medio e' ${dec(A.voto_medio)} su ${ctx.voto.massimo}. ${art(perc(S.positive.pct)).replace(/^./, (c) => c.toUpperCase())} delle recensioni e' positivo, ${art(perc(S.mixed.pct))} misto, ${art(perc(S.negative.pct))} negativo e ${art(perc(S.neutral.pct))} neutro.`,
  // numeri senza ambiguita' che si possono ripetere anche fuori dalle frasi
  recensioni_analizzate: intero(A.meta.recensioni_aggregate),
  dal_anno: anni[0],
  al_anno: anni[1],
  escluse_dai_conteggi: A.meta.escluse_dall_aggregazione,
  aspetti_piu_apprezzati: top(A.classifiche.piu_apprezzati, 5).map((x) => ({
    aspetto: x.nome,
    frase_numeri: `${intero(x.recensioni_positive)} recensioni su ${intero(A.meta.recensioni_aggregate)} ne danno un giudizio positivo (${art(perc(x.pct_recensioni_che_lo_apprezzano))} del totale); tra le ${intero(x.menzioni)} recensioni che ne parlano, i giudizi positivi sono ${art(perc(x.pct_positive_su_menzioni))}`,
  })),
  aspetti_piu_criticati: top(A.classifiche.piu_criticati, 5).map((x) => ({
    aspetto: x.nome,
    frase_numeri: `${intero(x.recensioni_negative)} recensioni su ${intero(A.meta.recensioni_aggregate)} ne danno un giudizio negativo (${art(perc(x.pct_recensioni_che_lo_criticano))} del totale); tra le ${intero(x.menzioni)} recensioni che ne parlano, i giudizi negativi sono ${art(perc(x.pct_negative_su_menzioni))}`,
  })),
  aspetti_piu_divisivi: top(A.classifiche.piu_criticati_per_tasso, 3).map((x) => ({
    aspetto: x.nome,
    frase_numeri: `tra le ${intero(x.menzioni)} recensioni che ne parlano, i giudizi negativi sono ${art(perc(x.pct_negative_su_menzioni))}`,
  })),
  periodi: A.periodi.map((p) => ({
    periodo: p.periodo,
    frase_numeri: `nel periodo ${p.periodo} (${intero(p.recensioni)} recensioni) il voto medio e' ${dec(p.voto_medio)} su ${ctx.voto.massimo}, con ${art(perc(p.sentiment_complessivo.positive.pct))} di recensioni positive e ${art(perc(p.sentiment_complessivo.negative.pct))} di negative`,
    piu_apprezzati: p.piu_apprezzati.slice(0, 3).map(nome),
    piu_criticati: p.piu_criticati.slice(0, 3).map(nome),
  })),
  // una sola frase per aspetto e per periodo di confronto, con critiche e apprezzamenti
  // insieme: il modello tende a unire due frasi sullo stesso aspetto, e cosi' non serve
  cambiamenti_significativi: (() => {
    const gruppi = new Map();
    for (const x of significativi) {
      const k = x.nome + '|' + x.periodo_di_confronto;
      if (!gruppi.has(k)) gruppi.set(k, { aspetto: x.nome, confronto: x.periodo_di_confronto, ultimo: x.ultimo_periodo, pezzi: [] });
      gruppi.get(k).pezzi.push(x);
    }
    return [...gruppi.values()].map((g) => {
      const pezzo = (x) => `le recensioni con giudizio ${misuraTesto(x.misura)} passano ${prep(perc(x.valore_periodo_di_confronto), 'da')} ${prep(perc(x.valore_ultimo_periodo), 'a')}`;
      const ordinati = [...g.pezzi].sort((a, b) => (a.misura < b.misura ? -1 : 1));
      return {
        aspetto: g.aspetto,
        frase_numeri: `${g.aspetto}, dal ${g.confronto} al ${g.ultimo}: ${ordinati.map(pezzo).join(' e ')}`,
      };
    });
  })(),
  // numeri senza ambiguita', ammessi anche fuori dalle frasi
  confronti_nel_tempo_eseguiti: intero(A.andamento.length),
  confronti_nel_tempo_significativi: intero(significativi.length),
  frase_segnalate: `Le recensioni segnalate sono ${intero(A.segnalazioni.totale)} (${art(perc(A.segnalazioni.pct_sul_totale))} del totale): ${intero(A.segnalazioni.per_priorita.alta)} con priorita' alta, ${intero(A.segnalazioni.per_priorita.media)} media e ${intero(A.segnalazioni.per_priorita.bassa)} bassa.`,
  segnalate_da_mostrare: A.segnalazioni.elenco.slice(0, 8).map((s) => ({
    review_id: s.review_id,
    data: s.published_date,
    voto: s.rating === null ? null : `${s.rating} su ${ctx.voto.massimo}`,
    priorita: s.priorita,
    motivo: s.attention_reason,
    prova: provaEsatta(analisi.get(s.review_id)?.segnalazioni?.[0]?.evidenza, recensioni.get(s.review_id)?.text),
  })),
  lingue_con_abbastanza_recensioni: A.per_lingua.filter((l) => l.confronto_con_le_altre_lingue).map((l) => ({
    lingua: l.lingua,
    recensioni: intero(l.recensioni),
    negative_o_miste: perc(l.confronto_con_le_altre_lingue.valore_lingua),
  })),
  differenze_tra_lingue_significative: A.per_lingua.filter((l) => l.confronto_con_le_altre_lingue?.significativo).map((l) => ({
    lingua: l.lingua,
    frase_numeri: `nelle recensioni in lingua ${l.lingua} le negative o miste sono ${art(perc(l.confronto_con_le_altre_lingue.valore_lingua))}, contro ${art(perc(l.confronto_con_le_altre_lingue.valore_altre_lingue))} nelle altre lingue`,
  })),
  citazioni_disponibili: [
    ...top(A.classifiche.piu_apprezzati, 3).map((x) => ({ per: `apprezzato: ${x.nome}`, parole_chiave: paroleChiave(x.aspect), recensioni: candidati(x.aspect, 'positive', ['positive'], 3) })),
    ...top(A.classifiche.piu_criticati, 3).map((x) => ({ per: `criticato: ${x.nome}`, parole_chiave: paroleChiave(x.aspect), recensioni: candidati(x.aspect, 'negative', ['negative', 'mixed'], 3) })),
  ],
};

const SYSTEM = `Sei un analista che scrive per ${ctx.lettori_dei_risultati}: le recensioni riguardano ${ctx.oggetto_recensito} e sono scritte da ${ctx.autori_delle_recensioni}. Ricevi i fatti in JSON, gia' calcolati. I numeri, gli elenchi e i titoli li inserisce il sistema: tu scrivi SOLO i commenti a parole e scegli le citazioni, in ${ctx.lingua_del_digest} semplice, per chi non e' tecnico.

Restituisci un JSON con questi campi:
- sintesi: da due a quattro frasi su che cosa emerge nel complesso (che cosa piace, che cosa si critica, come cambiano le cose). Aggiungi una frase sulle lingue: se "differenze_tra_lingue_significative" e' vuoto, di' che le recensioni nelle diverse lingue non mostrano differenze distinguibili dal caso.
- commento_apprezzati: due o tre frasi sugli aspetti in "aspetti_piu_apprezzati".
- commento_criticati: due o tre frasi sugli aspetti in "aspetti_piu_criticati" e "aspetti_piu_divisivi". Spiega la differenza tra un aspetto criticato da molte recensioni in assoluto e uno criticato da una parte grande di chi ne parla.
- commento_tempo: da due a quattro frasi sui "cambiamenti_significativi". Se e' vuoto, di' che i cambiamenti tra periodi non sono distinguibili dal caso. Parla solo dei cambiamenti significativi e non spiegarne le cause.
- commento_segnalate: da una a tre frasi sui temi delle recensioni da guardare.
- citazioni: da tre a sei citazioni, almeno una per la sezione "apprezzati", una per "criticati" e una per "segnalate". Per ognuna: sezione, review_id, testo copiato parola per parola da un campo "testo" o "prova" dei fatti (frasi consecutive, al massimo 30 parole), traduzione in ${ctx.lingua_del_digest} (stringa vuota se la citazione e' gia' in ${ctx.lingua_del_digest}).

Regole obbligatorie:
1. Nei commenti NESSUNA cifra: niente numeri, percentuali, anni o conteggi. Descrivi a parole (per esempio "la maggior parte", "aumentano", "piu' di prima", "nell'ultimo periodo").
2. Nei commenti niente virgolette « »: le citazioni vanno solo nel campo "citazioni".
3. Nomi degli aspetti come scritti nei fatti.
4. Nessun nome di persona; non scegliere citazioni che ne contengono.
5. Nessuna informazione che non sia nei fatti.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sintesi', 'commento_apprezzati', 'commento_criticati', 'commento_tempo', 'commento_segnalate', 'citazioni'],
  properties: {
    sintesi: { type: 'string' },
    commento_apprezzati: { type: 'string' },
    commento_criticati: { type: 'string' },
    commento_tempo: { type: 'string' },
    commento_segnalate: { type: 'string' },
    citazioni: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sezione', 'review_id', 'testo', 'traduzione'],
        properties: {
          sezione: { type: 'string', enum: ['apprezzati', 'criticati', 'segnalate'] },
          review_id: { type: 'string' },
          testo: { type: 'string' },
          traduzione: { type: 'string' },
        },
      },
    },
  },
};

return [{
  json: {
    fatti,
    body: {
      model: cfg.model,
      temperature: 0,
      seed: cfg.seed,
      max_tokens: 2500,
      response_format: { type: 'json_schema', json_schema: { name: 'digest', strict: true, schema: SCHEMA } },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(fatti, null, 1) },
      ],
    },
  },
}];
