// PREPARA I FILE DI OUTPUT
// Ultimo controllo dello schema di ogni recensione, poi scrive:
//   recensioni_analizzate.json   un oggetto per recensione, nello schema richiesto
//   recensioni_analizzate.jsonl  lo stesso, una riga per recensione
//   aspetti.json                 elenco finale degli aspetti con descrizione
//   aggregazione.json            conteggi, classifiche, periodi, andamento
//   digest.md                    testo per la direzione
//   esecuzione.json              diagnostica: guardrail, ritentativi, scarti, verifiche
//   recensioni_diagnostica.jsonl dettaglio per recensione (segnalazioni con prova, temi fuori elenco)
const cfg = $('Configurazione').first().json;
const tax = $('Valida tassonomia').first().json;
// con l'elenco fisso la scoperta non gira: questi nodi possono non avere dati
let temi = { temi: [] };
let campione = [];
try {
  temi = $('Raccogli temi').first().json;
  campione = $('Campione per scoperta aspetti').all().flatMap((i) => i.json.ids);
} catch (e) {
  // elenco fisso
}
const pronte = $('Recensioni pronte').all().map((i) => i.json);
const analisi = $('Valida e completa').all().map((i) => i.json);
const { aggregazione, info_analisi } = $('Aggregazione').first().json;
const verifica = $('Verifica digest').first().json;

// il digest arriva o dal ramo "passa" del guardrail di uscita o dal digest di riserva
const ingresso = $input.first().json;
const digestFinale = ingresso.guardrailsInput !== undefined
  ? { digest: verifica.digest, origine: verifica.origine, guardrail_uscita: 'superato' }
  : { digest: ingresso.digest, origine: ingresso.origine, guardrail_uscita: ingresso.guardrail_uscita };

// --- schema fisso, controllato prima di scrivere
const OVERALL = ['positive', 'negative', 'mixed', 'neutral'];
const SENT = ['positive', 'negative', 'neutral'];
const idAspetti = new Set(tax.aspetti.map((a) => a.aspect));
const recensioni = analisi.map((r) => ({
  review_id: r.review_id,
  language: r.language,
  overall_sentiment: r.overall_sentiment,
  aspects: r.aspects.map((a) => ({ aspect: a.aspect, sentiment: a.sentiment })),
  needs_attention: r.needs_attention === true,
  attention_reason: r.needs_attention ? r.attention_reason : null,
}));
const errori = [];
const ids = new Set();
for (const r of recensioni) {
  if (typeof r.review_id !== 'string' || ids.has(r.review_id)) errori.push(`review_id non valido o ripetuto: ${r.review_id}`);
  ids.add(r.review_id);
  if (typeof r.language !== 'string' || !r.language) errori.push(`${r.review_id}: language mancante`);
  if (!OVERALL.includes(r.overall_sentiment)) errori.push(`${r.review_id}: overall_sentiment non ammesso`);
  for (const a of r.aspects) if (!idAspetti.has(a.aspect) || !SENT.includes(a.sentiment)) errori.push(`${r.review_id}: aspetto non valido ${JSON.stringify(a)}`);
  if (r.needs_attention && (typeof r.attention_reason !== 'string' || !r.attention_reason)) errori.push(`${r.review_id}: motivo mancante`);
}
if (recensioni.length !== pronte.length) errori.push(`recensioni in output ${recensioni.length} invece di ${pronte.length}`);
if (errori.length) throw new Error('Output non conforme allo schema:\n' + errori.slice(0, 20).join('\n'));

const aspetti = tax.aspetti.map((a) => ({ aspect: a.aspect, nome: a.nome, descrizione: a.descrizione, temi_raggruppati: a.temi_raggruppati }));

// temi giudicati che non rientrano in nessun aspetto: misura di quanto l'elenco copre
const nonMappati = {};
for (const r of analisi) for (const u of r.unmapped ?? []) nonMappati[u] = (nonMappati[u] ?? 0) + 1;
const conNonMappati = analisi.filter((r) => (r.unmapped ?? []).length > 0).length;

const oscurati = {};
for (const r of pronte) for (const [k, v] of Object.entries(r.dati_oscurati ?? {})) oscurati[k] = (oscurati[k] ?? 0) + v;

const esecuzione = {
  configurazione: { ...cfg, input_file: cfg.input_file },
  terminata_il: new Date().toISOString(),
  file: aggregazione.meta.righe_nel_file + ' righe lette da ' + cfg.input_file,
  anomalie_del_file: pronte[0]._file.anomalie,
  guardrail_ingresso: {
    dati_oscurati_prima_del_modello: oscurati,
    recensioni_con_dati_oscurati: pronte.filter((r) => Object.keys(r.dati_oscurati ?? {}).length).map((r) => r.review_id),
    recensioni_sospette_di_manipolazione: pronte.filter((r) => r.sospetta).map((r) => ({ review_id: r.review_id, controlli: r.guardrail_scattati })),
    errori_del_guardrail: pronte.filter((r) => r.guardrail_errore).map((r) => ({ review_id: r.review_id, errore: r.guardrail_errore })),
  },
  scoperta_aspetti: {
    origine: tax.origine_aspetti,
    versione: tax.versione_aspetti,
    recensioni_nel_campione: campione.length,
    campione: campione,
    temi_liberi_distinti: temi.temi.length,
    temi_piu_frequenti: temi.temi.slice(0, 40),
    copertura_temi_pct: tax.copertura_temi_pct,
    soglia_temi_frequenti: tax.soglia_temi_frequenti,
    giri_di_consolidamento: tax.giri_consolidamento,
    temi_tolti_perche_doppi: tax.temi_tolti_perche_doppi,
    temi_non_coperti: tax.temi_non_coperti,
  },
  analisi: {
    ...info_analisi,
    recensioni_con_temi_fuori_elenco: conNonMappati,
    temi_fuori_elenco_piu_frequenti: Object.entries(nonMappati).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tema, n]) => ({ tema, recensioni: n })),
  },
  digest: {
    origine: digestFinale.origine,
    guardrail_uscita: digestFinale.guardrail_uscita,
    verifica: verifica.verifica,
    testo_del_modello_scartato: verifica.ultimo_testo_modello,
  },
  fatti_dati_al_modello_per_il_digest: $('Fatti per il digest').first().json.fatti,
};

// --- tabelle CSV per strumenti di visualizzazione (Tableau, Excel, Power BI)
const campoCsv = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const tabellaCsv = (colonne, righe) => [colonne.join(','), ...righe.map((r) => colonne.map((c) => campoCsv(r[c])).join(','))].join('\n') + '\n';
const nomeAspetto = Object.fromEntries(tax.aspetti.map((a) => [a.aspect, a.nome]));
// una riga per ogni coppia recensione-aspetto (le recensioni senza aspetti hanno una riga con aspetto vuoto)
const righeRecensioni = [];
for (const r of analisi) {
  const base = {
    review_id: r.review_id,
    data_pubblicazione: r.published_date ?? '',
    anno: r.anno ?? '',
    mese: r.published_date ? r.published_date.slice(0, 7) : '',
    voto: r.rating ?? '',
    lingua: r.language,
    piattaforma: r.piattaforma ?? '',
    versione: r.versione ?? '',
    sentiment_complessivo: r.overall_sentiment,
    da_segnalare: r.needs_attention,
    priorita: r.priorita ?? '',
    nei_conteggi: (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta,
  };
  if (!r.aspects.length) righeRecensioni.push({ ...base, aspetto: '', nome_aspetto: '', sentiment_aspetto: '' });
  for (const a of r.aspects) righeRecensioni.push({ ...base, aspetto: a.aspect, nome_aspetto: nomeAspetto[a.aspect] ?? a.aspect, sentiment_aspetto: a.sentiment });
}
// una riga per ogni coppia periodo-aspetto, con i conteggi dell'aggregazione
const righePeriodi = aggregazione.periodi.flatMap((p) => Object.values(p.aspetti).map((a) => ({
  periodo: p.periodo,
  recensioni_del_periodo: p.recensioni,
  aspetto: a.aspect,
  nome_aspetto: a.nome,
  menzioni: a.menzioni,
  positive: a.positive,
  negative: a.negative,
  neutral: a.neutral,
  pct_recensioni_che_lo_apprezzano: a.pct_recensioni_che_lo_apprezzano,
  pct_recensioni_che_lo_criticano: a.pct_recensioni_che_lo_criticano,
})));

// --- registro del giro: token, costo e durata
// Token ESATTI per le chiamate fatte dal workflow (nodi HTTP e ritentativi nei nodi Code).
// Il guardrail con il modello lo esegue n8n al suo interno e non espone i token:
// per quello c'e' una STIMA dalla lunghezza dei testi (circa 4 caratteri per token).
const somma = (lista) => lista.reduce((t, u) => ({
  chiamate: t.chiamate + 1,
  token_input: t.token_input + (u?.prompt_tokens ?? 0),
  token_output: t.token_output + (u?.completion_tokens ?? 0),
}), { chiamate: 0, token_input: 0, token_output: 0 });
const usoDelNodo = (nomeNodo) => {
  try {
    return $(nomeNodo).all().map((i) => i.json?.usage).filter(Boolean);
  } catch (e) {
    return []; // nodo non eseguito (per esempio la scoperta con l'elenco fisso)
  }
};
const costo = (v) => Math.round(1e4 * ((v.token_input * cfg.prezzo_input_usd_per_milione + v.token_output * cfg.prezzo_output_usd_per_milione) / 1e6)) / 1e4;
const voci = {
  scoperta_temi_liberi: somma(usoDelNodo('LLM: temi liberi')),
  consolidamento_aspetti: somma([...usoDelNodo('LLM: consolida aspetti'), ...(tax.uso_token ?? [])]),
  analisi_recensioni: somma([...usoDelNodo('LLM: analisi recensioni'), ...(info_analisi.uso_token_ritentativi ?? [])]),
  digest: somma([...usoDelNodo('LLM: scrive digest'), ...(verifica.uso_token ?? [])]),
};
for (const v of Object.values(voci)) v.costo_usd = costo(v);
// stima per il guardrail con il modello: una chiamata per ogni recensione non gia' fermata dalle espressioni regolari
const nelGuardrail = pronte.filter((r) => !(r.guardrail_scattati ?? []).some((c) => c !== 'jailbreak'));
const stimaGuardrail = {
  chiamate: nelGuardrail.length + 1,
  token_input: Math.round(nelGuardrail.reduce((t, r) => t + (1300 + r.title.length + r.text.length) / 4, 0) + (1300 + digestFinale.digest.length) / 4),
  token_output: (nelGuardrail.length + 1) * 30,
  nota: 'STIMA: token calcolati dalla lunghezza dei testi, n8n non li espone per i nodi Guardrails',
};
stimaGuardrail.costo_usd = costo(stimaGuardrail);
const misurato = Object.values(voci).reduce((t, v) => ({ token_input: t.token_input + v.token_input, token_output: t.token_output + v.token_output, costo_usd: t.costo_usd + v.costo_usd }), { token_input: 0, token_output: 0, costo_usd: 0 });
const fine = new Date();
const registroGiro = {
  inizio: cfg.started_at,
  fine: fine.toISOString(),
  durata_minuti: Math.round((fine - new Date(cfg.started_at)) / 6000) / 10,
  modello: cfg.model,
  prezzi_usd_per_milione_di_token: { input: cfg.prezzo_input_usd_per_milione, output: cfg.prezzo_output_usd_per_milione },
  recensioni: analisi.length,
  versione_aspetti: tax.versione_aspetti,
  misurato_per_fase: voci,
  misurato_totale: { ...misurato, costo_usd: Math.round(1e4 * misurato.costo_usd) / 1e4 },
  guardrail_stimato: stimaGuardrail,
  costo_totale_usd_misurato_piu_stimato: Math.round(1e4 * (misurato.costo_usd + stimaGuardrail.costo_usd)) / 1e4,
  costo_per_1000_recensioni_usd: Math.round(1e4 * ((misurato.costo_usd + stimaGuardrail.costo_usd) / analisi.length) * 1000) / 1e4,
};
esecuzione.registro_giro = registroGiro;

const dir = cfg.output_dir;
const file = (nome, contenuto, mime) => ({
  json: { path: `${dir}/${nome}` },
  binary: { data: { data: Buffer.from(contenuto, 'utf8').toString('base64'), mimeType: mime, fileName: nome } },
});
let digest = digestFinale.digest;
if (!/^#\s/m.test(digest)) digest = '# Digest delle recensioni\n\n' + digest;

return [
  file('recensioni_analizzate.json', JSON.stringify(recensioni, null, 2), 'application/json'),
  file('recensioni_analizzate.jsonl', recensioni.map((r) => JSON.stringify(r)).join('\n') + '\n', 'application/x-ndjson'),
  file('aspetti.json', JSON.stringify({ versione: tax.versione_aspetti, origine: tax.origine_aspetti, aspetti }, null, 2), 'application/json'),
  file('aggregazione.json', JSON.stringify(aggregazione, null, 2), 'application/json'),
  file('digest.md', digest + '\n', 'text/markdown'),
  file('tabella_recensioni_aspetti.csv', tabellaCsv(['review_id', 'data_pubblicazione', 'anno', 'mese', 'voto', 'lingua', 'piattaforma', 'versione', 'sentiment_complessivo', 'da_segnalare', 'priorita', 'nei_conteggi', 'aspetto', 'nome_aspetto', 'sentiment_aspetto'], righeRecensioni), 'text/csv'),
  file('tabella_aspetti_per_periodo.csv', tabellaCsv(['periodo', 'recensioni_del_periodo', 'aspetto', 'nome_aspetto', 'menzioni', 'positive', 'negative', 'neutral', 'pct_recensioni_che_lo_apprezzano', 'pct_recensioni_che_lo_criticano'], righePeriodi), 'text/csv'),
  file('esecuzione.json', JSON.stringify(esecuzione, null, 2), 'application/json'),
  file('registro_giro.json', JSON.stringify(registroGiro, null, 2), 'application/json'),
  // dettaglio per recensione, fuori dallo schema richiesto: serve a controllare e a verificare
  file('recensioni_diagnostica.jsonl', analisi.map((r, i) => JSON.stringify({
    review_id: r.review_id,
    stato: r.stato,
    sospetta: r.sospetta,
    guardrail_scattati: pronte[i].guardrail_scattati,
    dati_oscurati: pronte[i].dati_oscurati,
    priorita: r.priorita,
    segnalazioni: r.segnalazioni,
    temi_fuori_elenco: r.unmapped,
  })).join('\n') + '\n', 'application/x-ndjson'),
];
