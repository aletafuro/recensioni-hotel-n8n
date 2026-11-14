// VALIDA L'ELENCO DEGLI ASPETTI E PREPARA LE ISTRUZIONI PER L'ANALISI
// Due origini possibili:
// - ELENCO FISSO (data/aspetti/aspetti_fissi.json): elenco con versione,
//   uguale da un giro all'altro, cosi' i numeri di periodi e giri diversi si
//   confrontano. E' il funzionamento normale in produzione.
// - SCOPERTA: se l'elenco fisso non c'e' (o si chiede di riscoprirlo), gli
//   aspetti emergono dal campione come descritto qui sotto.
// Controlla l'elenco proposto dal modello (identificativi unici e in
// snake_case, numero ragionevole di aspetti), misura quanta parte dei temi
// liberi e' coperta e scrive le istruzioni usate per analizzare OGNI
// recensione. Lo schema di risposta elenca gli aspetti ammessi: il modello
// non puo' inventarne di nuovi, quindi i nomi restano coerenti tra recensioni.
//
// Controllo di copertura: ogni tema FREQUENTE del campione (citato da almeno
// il 2% delle recensioni lette, minimo 3) deve finire in un aspetto. Se ne
// resta fuori qualcuno, il modello riceve l'elenco e ripropone la lista
// completa (fino a 2 volte).
const helpers = this.helpers;
const usoToken = []; // token delle chiamate fatte da questo nodo
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;
const ingresso = $input.first().json ?? {};
const elencoFisso = Array.isArray(ingresso.data?.aspetti) && !ingresso.choices ? ingresso.data : null;
let raccolta = null;
try {
  raccolta = $('Raccogli temi').first().json;
} catch (e) {
  raccolta = null; // scoperta non eseguita: si usa l'elenco fisso
}

function leggi(content) {
  const proposta = JSON.parse(content);
  const visti = new Set();
  const lista = [];
  for (const a of proposta.aspects ?? []) {
    const id = String(a.aspect ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!id || visti.has(id)) continue;
    visti.add(id);
    lista.push({
      aspect: id,
      nome: String(a.name_it ?? '').trim() || id,
      descrizione: String(a.description_it ?? '').trim(),
      temi_raggruppati: [...new Set((a.includes ?? []).map((s) => String(s).toLowerCase().trim()).filter(Boolean))],
    });
  }
  return lista;
}

async function dallaScoperta() {
const soglia = Math.max(3, Math.ceil(0.02 * raccolta.recensioni_lette));
const frequenti = raccolta.temi.filter((t) => t.recensioni >= soglia).map((t) => t.label);
const fuori = (lista) => {
  const dentro = new Set(lista.flatMap((a) => a.temi_raggruppati));
  return frequenti.filter((l) => !dentro.has(l));
};
// un tema in due aspetti rende ambigua la classificazione (es. "club lounge" sia nel
// servizio sia nel cibo): ogni tema deve stare in un solo aspetto
const doppi = (lista) => {
  const conta = new Map();
  for (const a of lista) for (const t of a.temi_raggruppati) conta.set(t, (conta.get(t) ?? 0) + 1);
  return [...conta].filter(([, n]) => n > 1).map(([t]) => t);
};
const daSistemare = (lista) => fuori(lista).length > 0 || doppi(lista).length > 0;

// lettura sicura: null se la risposta manca, e' tagliata o non e' JSON valido
const prova = (testo) => {
  try {
    const lista = leggi(testo);
    return lista.length >= 6 ? lista : null;
  } catch (e) {
    return null;
  }
};
const stato = (lista) => (lista ? { aspetti: lista.length, temi_frequenti_fuori: fuori(lista), temi_in_piu_aspetti: doppi(lista) } : { leggibile: false });

const primo = $input.first().json ?? {};
let content = primo.choices?.[0]?.message?.content ?? '';
let aspetti = prova(content);
const giri = [{
  giro: 1,
  fine_risposta: primo.choices?.[0]?.finish_reason ?? null,
  errore: primo.error ? JSON.stringify(primo.error).slice(0, 300) : undefined,
  ...stato(aspetti),
}];
let messaggi = [...raccolta.body.messages];
if (aspetti) messaggi.push({ role: 'assistant', content });

// fino a 3 giri in piu': si richiede l'elenco se illeggibile, altrimenti si chiede di correggerlo
for (let giro = 2; giro <= 4 && (!aspetti || daSistemare(aspetti)); giro++) {
  const conCorrezione = !!aspetti;
  let richiesta = messaggi;
  if (conCorrezione) {
    const richieste = [];
    if (fuori(aspetti).length) {
      richieste.push(`These frequent labels are not in the includes of any aspect: ${fuori(aspetti).join(', ')}. Put each of them in the right aspect, or create a new aspect if it is a distinct theme that management can act on.`);
    }
    if (doppi(aspetti).length) {
      richieste.push(`These labels are in the includes of more than one aspect: ${doppi(aspetti).join(', ')}. Each label must be in exactly one aspect. If a group of labels describes a distinct part of the stay (for example a specific facility), make it its own aspect instead of splitting it.`);
    }
    richiesta = [...messaggi, {
      role: 'user',
      content: `${richieste.join('\n')}\nReturn the complete list again. Keep between 10 and 20 aspects, aspects must not overlap, and keep all the other rules.`,
    }];
  }
  try {
    const res = await helpers.httpRequest({
      method: 'POST',
      url: cfg.base_url + '/chat/completions',
      headers: { Authorization: 'Bearer ' + $env.OPENAI_API_KEY },
      body: { ...raccolta.body, messages: richiesta },
      json: true,
      timeout: 240000,
    });
    if (res.usage) usoToken.push(res.usage);
    const nuovo = res.choices?.[0]?.message?.content ?? '';
    const lista = prova(nuovo);
    giri.push({ giro, tipo: conCorrezione ? 'correzione' : 'nuova_richiesta', fine_risposta: res.choices?.[0]?.finish_reason ?? null, ...stato(lista) });
    if (lista) {
      // si tiene la nuova proposta e la conversazione prosegue da li'
      messaggi = [...richiesta, { role: 'assistant', content: nuovo }];
      content = nuovo;
      aspetti = lista;
    }
  } catch (e) {
    giri.push({ giro, errore: e.message });
  }
}
if (!aspetti) {
  throw new Error('Il modello non ha restituito un elenco di aspetti leggibile dopo 4 tentativi: ' + JSON.stringify(giri));
}
if (aspetti.length > 24) {
  throw new Error(`Elenco di aspetti non plausibile: ${aspetti.length} aspetti`);
}
// se dopo i giri un tema e' ancora in piu' aspetti, resta solo nel primo (regola fissa, registrata)
const temiTolti = [];
{
  const giaUsati = new Set();
  for (const a of aspetti) {
    a.temi_raggruppati = a.temi_raggruppati.filter((t) => {
      if (giaUsati.has(t)) {
        temiTolti.push({ tema: t, tolto_da: a.aspect });
        return false;
      }
      giaUsati.add(t);
      return true;
    });
  }
}
  return { aspetti, giri, temiTolti, soglia };
}

let aspetti, giri, temiTolti, soglia, origine, versione;
if (elencoFisso) {
  // elenco fisso: controlli minimi e nessuna chiamata al modello
  const visti = new Set();
  aspetti = elencoFisso.aspetti.map((a) => ({
    aspect: String(a.aspect ?? '').trim(),
    nome: String(a.nome ?? a.aspect ?? '').trim(),
    descrizione: String(a.descrizione ?? '').trim(),
    temi_raggruppati: (a.temi_raggruppati ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
  }));
  for (const a of aspetti) {
    if (!/^[a-z][a-z0-9_]*$/.test(a.aspect) || visti.has(a.aspect)) throw new Error(`Elenco fisso non valido: identificativo "${a.aspect}"`);
    visti.add(a.aspect);
  }
  if (aspetti.length < 3) throw new Error('Elenco fisso con meno di 3 aspetti');
  versione = String(elencoFisso.versione ?? 'senza versione');
  origine = 'elenco fisso';
  giri = [{ origine, versione }];
  temiTolti = [];
  soglia = null;
} else {
  ({ aspetti, giri, temiTolti, soglia } = await dallaScoperta());
  origine = 'scoperta dalle recensioni';
  versione = 'scoperta del ' + new Date().toISOString().slice(0, 10);
}

// copertura (solo con la scoperta): quota delle citazioni di temi liberi che finiscono in un aspetto
const inclusi = new Set(aspetti.flatMap((a) => a.temi_raggruppati));
const totale = raccolta && !elencoFisso ? raccolta.temi.reduce((s, t) => s + t.recensioni, 0) : 0;
const coperte = totale ? raccolta.temi.filter((t) => inclusi.has(t.label)).reduce((s, t) => s + t.recensioni, 0) : 0;
const nonCoperti = totale ? raccolta.temi.filter((t) => !inclusi.has(t.label)).slice(0, 50) : [];

// categorie di segnalazione: dal file di contesto
const CATEGORIE = Object.fromEntries(Object.entries(ctx.categorie).map(([k, v]) => [k, v.definizione]));

// ogni aspetto con TUTTI i temi che raggruppa (fino a 25): cosi' il modello sa,
// per esempio, che "concierge" sta gia' dentro l'aspetto del personale
const elenco = aspetti.map((a) => `- ${a.aspect}: ${a.descrizione} Includes: ${a.temi_raggruppati.slice(0, 25).join(', ')}.`).join('\n');
const elencoCategorie = Object.entries(CATEGORIE).map(([k, v]) => `- ${k}: ${v}`).join('\n');

const SYSTEM = `You analyse reviews for ${ctx.lettori_dei_risultati}. Reviews can be in any language, of any length, and may contain noise.
${ctx.frase}
The input is a list of independent reviews. Analyse each review ONLY on its own text: never use content of one review in the result of another.
For EACH review in the input return one result with:
- review_id: copied exactly.
- language: ISO 639-1 code of the language of the review text (for example en, es, ja).
- overall_sentiment: the author's overall evaluation as expressed in the text.
  positive = clearly satisfied, criticisms are minor or absent;
  negative = clearly dissatisfied, praise is minor or absent;
  mixed = both substantial praise and substantial criticism;
  neutral = no clear evaluation (descriptive or factual text).
  Judge the text. The rating (from ${ctx.voto.minimo} to ${ctx.voto.massimo}) is given only as context.
- aspects: one entry for each aspect in the list below on which the author expresses a judgement. Use only the aspect identifiers from the list. Do not add an aspect that is only mentioned without a judgement.
  sentiment: positive, negative, or neutral (the judgement is lukewarm or explicitly balanced, for example "breakfast was ok").
  If the same aspect gets both praise and criticism, choose the prevailing judgement; if they really balance, use neutral.
- unmapped: short English labels (1-3 words) of judged topics that fit none of the aspects, considering their descriptions and the topics they include. A topic that belongs to an aspect goes in aspects, not here. Empty list if none.
- attention: issues that ${ctx.lettori_dei_risultati} should look at, ONLY if the review explicitly describes them. For each issue:
  category: one of the codes below;
  summary_it: what happened, in Italian, maximum 20 words, factual, no speculation;
  evidence: a short excerpt copied verbatim from the review (maximum 25 words, original language, no changes).
  Ordinary mild criticisms (for example: ${ctx.critiche_ordinarie_da_non_segnalare}) are NOT attention issues.
  Report only issues caused by, or under the responsibility of, ${ctx.oggetto_recensito} (its staff, services, premises or product). Problems with third parties or the surroundings are NOT attention issues. Empty list if none.

Aspects:
${elenco}

Attention categories:
${elencoCategorie}

Never add information that is not in the review.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['review_id', 'language', 'overall_sentiment', 'aspects', 'unmapped', 'attention'],
        properties: {
          review_id: { type: 'string' },
          language: { type: 'string' },
          overall_sentiment: { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'] },
          aspects: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['aspect', 'sentiment'],
              properties: {
                aspect: { type: 'string', enum: aspetti.map((a) => a.aspect) },
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
              },
            },
          },
          unmapped: { type: 'array', items: { type: 'string' } },
          attention: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['category', 'summary_it', 'evidence'],
              properties: {
                category: { type: 'string', enum: Object.keys(CATEGORIE) },
                summary_it: { type: 'string' },
                evidence: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

return [{
  json: {
    aspetti,
    origine_aspetti: origine,
    uso_token: usoToken,
    versione_aspetti: versione,
    linea_di_base: elencoFisso?.linea_di_base_temi_fuori_elenco ?? null,
    categorie_attenzione: Object.keys(CATEGORIE),
    copertura_temi_pct: totale ? Math.round((1000 * coperte) / totale) / 10 : null,
    soglia_temi_frequenti: soglia,
    giri_consolidamento: giri,
    temi_tolti_perche_doppi: temiTolti,
    temi_non_coperti: nonCoperti,
    system_prompt: SYSTEM,
    // modello della richiesta: i nodi successivi aggiungono solo i messaggi
    body_base: {
      model: cfg.model,
      temperature: 0,
      seed: cfg.seed,
      max_tokens: 6000,
      response_format: { type: 'json_schema', json_schema: { name: 'review_analysis', strict: true, schema: SCHEMA } },
    },
  },
}];
