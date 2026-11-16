// VALIDA E COMPLETA L'ANALISI DI OGNI RECENSIONE
// 1. legge le risposte del modello e le abbina alle recensioni per review_id;
// 2. le recensioni mancanti o con risposta non valida vengono richieste di nuovo
//    una per una (fino a 3 tentativi);
// 3. normalizza i valori (solo i sentiment e gli aspetti ammessi);
// 4. tiene una segnalazione solo se la frase citata come prova si ritrova
//    davvero nel testo della recensione (niente informazioni inventate);
// 5. applica le regole per needs_attention e scrive il motivo.
const helpers = this.helpers;
const usoToken = []; // token dei ritentativi
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;
const tax = $('Valida tassonomia').first().json;
const recensioni = $('Recensioni pronte').all().map((i) => i.json);
const perId = new Map(recensioni.map((r) => [r.review_id, r]));
const idAspetti = new Set(tax.aspetti.map((a) => a.aspect));

const OVERALL = ['positive', 'negative', 'mixed', 'neutral'];
const SENT = ['positive', 'negative', 'neutral'];
// categorie di segnalazione con nome e priorita': dal file di contesto
const CATEGORIE = ctx.categorie;
const ORDINE_PRIORITA = { alta: 0, media: 1, bassa: 2 };

const payload = (r) => ({ review_id: r.review_id, rating: r.rating, title: r.title, text: r.text || r.title });

const valido = (g) =>
  g &&
  typeof g.review_id === 'string' &&
  OVERALL.includes(g.overall_sentiment) &&
  Array.isArray(g.aspects) &&
  Array.isArray(g.attention);

// --- 0. memoria delle analisi: le recensioni con la stessa firma del giro prima riprendono la risposta salvata
// (stessa firma del nodo «Prepara richieste analisi»: istruzioni, elenco, categorie, modello, gruppi, testo)
const crypto = require('crypto');
const firma = (r) => crypto.createHash('sha1').update(JSON.stringify([tax.system_prompt, tax.body_base, cfg.batch_size, payload(r)]), 'utf8').digest('hex');
let memoria = {};
try {
  memoria = $('Estrai memoria analisi').first().json.data?.voci ?? {};
} catch (e) {
  memoria = {};
}
const grezzi = new Map();
const ritentataNellaMemoria = new Set();
const firme = new Map();
for (const r of recensioni) {
  if (r.vuota || r.duplicato_di) continue;
  const f = firma(r);
  firme.set(r.review_id, f);
  const m = memoria[r.review_id];
  if (m && m.firma === f && valido(m.risposta)) {
    grezzi.set(r.review_id, m.risposta);
    if (m.ritentata) ritentataNellaMemoria.add(r.review_id);
  }
}
const dallaMemoria = grezzi.size;

// --- 1. risposte del primo giro (solo le recensioni nuove o cambiate)
let risposteNonValide = 0;
const richieste = $input.all().filter((it) => !it.json?.nessuna_richiesta);
for (const it of richieste) {
  const content = it.json?.choices?.[0]?.message?.content;
  let dati = null;
  try {
    dati = JSON.parse(content);
  } catch (e) {
    risposteNonValide++;
    continue;
  }
  for (const g of dati.results ?? []) {
    if (perId.has(g.review_id) && !grezzi.has(g.review_id) && valido(g)) grezzi.set(g.review_id, g);
  }
}

// --- 2. ritentativi una recensione alla volta
const attesa = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function chiediUna(r) {
  const body = {
    ...tax.body_base,
    messages: [
      { role: 'system', content: tax.system_prompt },
      { role: 'user', content: JSON.stringify([payload(r)]) },
    ],
  };
  let errore = null;
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await helpers.httpRequest({
        method: 'POST',
        url: cfg.base_url + '/chat/completions',
        headers: { Authorization: 'Bearer ' + $env.OPENAI_API_KEY },
        body,
        json: true,
        timeout: 180000,
      });
      if (res.usage) usoToken.push(res.usage);
      const g = (JSON.parse(res.choices[0].message.content).results ?? []).find((x) => x.review_id === r.review_id);
      if (valido(g)) return { g, errore: null };
      errore = 'risposta senza la recensione richiesta';
    } catch (e) {
      errore = e.message;
    }
    await attesa(2000 * tentativo);
  }
  return { g: null, errore };
}

const daAnalizzare = recensioni.filter((r) => !r.vuota && !r.duplicato_di);
const mancanti = daAnalizzare.filter((r) => !grezzi.has(r.review_id));
const ritentate = new Set();
const fallite = [];
for (const r of mancanti) {
  const { g, errore } = await chiediUna(r);
  if (g) {
    grezzi.set(r.review_id, g);
    ritentate.add(r.review_id);
  } else fallite.push({ review_id: r.review_id, errore });
}

// --- 3/4. normalizzazione e controllo delle prove
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”„«»"]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

function provaNelTesto(evidenza, testo) {
  const e = norm(evidenza).replace(/^["'.\s]+|["'.\s]+$/g, '');
  if (e.length < 3) return false;
  const t = norm(testo);
  if (t.includes(e)) return true;
  // citazione con omissioni "...": ogni pezzo deve esserci
  const pezzi = e.split(/\.{3,}/).map((p) => p.trim()).filter((p) => p.length >= 3);
  if (pezzi.length > 1 && pezzi.every((p) => t.includes(p))) return true;
  // quasi letterale: almeno il 90% delle parole della citazione compare nel testo
  const parole = e.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (parole.length < 4) return false;
  return parole.filter((p) => t.includes(p)).length / parole.length >= 0.9;
}

const scarti = { aspetti_non_ammessi: 0, segnalazioni_senza_prova: [] };

const normTema = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 &/-]/g, ' ').replace(/\s+/g, ' ').trim();
const temiInclusi = new Set(tax.aspetti.flatMap((a) => a.temi_raggruppati.map(normTema)));
// coperto se il tema (anche al singolare/plurale) e' uno dei temi raggruppati negli aspetti
const giaCoperto = (u) => temiInclusi.has(u) || temiInclusi.has(u.replace(/s$/, '')) || temiInclusi.has(u + 's');

function costruisci(r, g, stato) {
  let language = String(g.language ?? '').toLowerCase().trim();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(language)) language = 'und';

  const aspetti = new Map();
  for (const a of g.aspects ?? []) {
    if (!idAspetti.has(a.aspect) || !SENT.includes(a.sentiment)) {
      scarti.aspetti_non_ammessi++;
      continue;
    }
    if (!aspetti.has(a.aspect)) aspetti.set(a.aspect, a.sentiment);
    else if (aspetti.get(a.aspect) !== a.sentiment) aspetti.set(a.aspect, 'neutral'); // giudizi opposti sullo stesso aspetto
  }

  const testo = r.title + '\n' + r.text;
  const segnalazioni = [];
  for (const s of g.attention ?? []) {
    if (!CATEGORIE[s.category]) continue;
    if (!provaNelTesto(s.evidence, testo)) {
      // la prova non e' nel testo: e' inventata o presa da un'altra recensione dello stesso gruppo?
      const altra = recensioni.find((x) => x.review_id !== r.review_id && provaNelTesto(s.evidence, x.title + '\n' + x.text));
      scarti.segnalazioni_senza_prova.push({
        review_id: r.review_id,
        categoria: s.category,
        evidenza: s.evidence,
        tipo: altra ? 'presa_da_un_altra_recensione' : 'non_trovata_in_nessuna_recensione',
        recensione_di_origine: altra ? altra.review_id : null,
      });
      continue;
    }
    segnalazioni.push({
      categoria: s.category,
      nome_categoria: CATEGORIE[s.category].nome,
      priorita: CATEGORIE[s.category].priorita,
      sintesi: String(s.summary_it ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
      evidenza: String(s.evidence ?? '').trim(),
    });
  }

  // --- 5. regole per needs_attention
  const motivi = [];
  const viste = new Set();
  for (const s of segnalazioni) {
    if (viste.has(s.categoria)) continue;
    viste.add(s.categoria);
    motivi.push(`${s.nome_categoria}: ${s.sintesi}`);
  }
  let priorita = segnalazioni.length
    ? segnalazioni.map((s) => s.priorita).sort((a, b) => ORDINE_PRIORITA[a] - ORDINE_PRIORITA[b])[0]
    : null;
  const V = ctx.voto;
  if (r.rating !== null && r.rating <= V.basso_fino_a) {
    motivi.push(`voto molto basso (${r.rating} su ${V.massimo})`);
    priorita ??= 'bassa';
  }
  if (r.rating !== null && r.rating >= V.alto_da && g.overall_sentiment === 'negative') {
    motivi.push(`voto alto (${r.rating} su ${V.massimo}) ma testo negativo: da verificare`);
    priorita ??= 'bassa';
  }
  if (r.rating !== null && r.rating <= V.basso_fino_a && g.overall_sentiment === 'positive') {
    motivi.push(`voto basso (${r.rating} su ${V.massimo}) ma testo positivo: possibile errore di chi ha scritto`);
    priorita ??= 'bassa';
  }
  if (r.sospetta) {
    motivi.unshift(`possibile testo manipolatorio rilevato dal guardrail (${r.guardrail_scattati.join(', ')}): verificare, esclusa dai conteggi`);
    if (priorita !== 'alta') priorita = 'media';
  }

  return {
    review_id: r.review_id,
    stato,
    sospetta: r.sospetta,
    rating: r.rating,
    published_date: r.published_date,
    anno: r.anno,
    language,
    overall_sentiment: g.overall_sentiment,
    aspects: [...aspetti].map(([aspect, sentiment]) => ({ aspect, sentiment })),
    needs_attention: motivi.length > 0,
    attention_reason: motivi.length ? motivi.join('; ') : null,
    priorita: motivi.length ? priorita : null,
    segnalazioni,
    // temi fuori elenco: si tolgono quelli che stanno gia' dentro un aspetto (il modello a volte
    // li ripete qui), cosi' la misura conta solo i temi davvero non coperti
    unmapped: [...new Set((g.unmapped ?? []).map(normTema).filter(Boolean))].filter((u) => !giaCoperto(u)),
  };
}

const risultati = new Map();
for (const r of daAnalizzare) {
  const g = grezzi.get(r.review_id);
  if (g) risultati.set(r.review_id, costruisci(r, g, ritentate.has(r.review_id) || ritentataNellaMemoria.has(r.review_id) ? 'ritentata' : 'ok'));
  else {
    // analisi non riuscita dopo i ritentativi: nessun giudizio inventato,
    // la recensione viene segnalata perche' qualcuno la legga
    risultati.set(r.review_id, {
      review_id: r.review_id, stato: 'fallita', sospetta: r.sospetta, rating: r.rating, published_date: r.published_date, anno: r.anno,
      language: 'und', overall_sentiment: 'neutral', aspects: [], needs_attention: true,
      attention_reason: 'analisi automatica non riuscita: da leggere manualmente', priorita: 'bassa', segnalazioni: [], unmapped: [],
    });
  }
}
for (const r of recensioni) {
  if (r.vuota) {
    risultati.set(r.review_id, {
      review_id: r.review_id, stato: 'vuota', sospetta: r.sospetta, rating: r.rating, published_date: r.published_date, anno: r.anno,
      language: 'und', overall_sentiment: 'neutral', aspects: [], needs_attention: false,
      attention_reason: null, priorita: null, segnalazioni: [], unmapped: [],
    });
  } else if (r.duplicato_di) {
    // duplicato esatto: stessa analisi dell'originale, escluso dai conteggi
    const o = risultati.get(r.duplicato_di);
    risultati.set(r.review_id, { ...o, review_id: r.review_id, stato: 'duplicato' });
  }
}

// memoria aggiornata: una voce per ogni recensione con una risposta valida (le fallite si riprovano al giro dopo)
const voci = {};
for (const r of daAnalizzare) {
  const g = grezzi.get(r.review_id);
  if (g) voci[r.review_id] = { firma: firme.get(r.review_id), ritentata: ritentate.has(r.review_id) || ritentataNellaMemoria.has(r.review_id), risposta: g };
}

const out = recensioni.map((r) => risultati.get(r.review_id));
out[0] = {
  ...out[0],
  _memoria: { versione_formato: 1, aggiornata_il: new Date().toISOString(), voci },
  _analisi: {
    dalla_memoria: dallaMemoria,
    analizzate_in_questo_giro: daAnalizzare.length - dallaMemoria,
    richieste_primo_giro: richieste.length,
    uso_token_ritentativi: usoToken,
    risposte_non_valide: risposteNonValide,
    recensioni_ritentate: [...ritentate],
    recensioni_fallite: fallite,
    aspetti_non_ammessi_scartati: scarti.aspetti_non_ammessi,
    segnalazioni_scartate_senza_prova: scarti.segnalazioni_senza_prova,
  },
};
return out.map((r) => ({ json: r }));
