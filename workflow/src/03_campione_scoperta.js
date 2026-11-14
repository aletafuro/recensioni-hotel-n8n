// CAMPIONE PER LA SCOPERTA DEGLI ASPETTI
// Gli aspetti non sono dati: emergono dalle recensioni in due passi.
// Passo 1 (qui e nel nodo LLM successivo): su un campione, il modello elenca
// liberamente i temi su cui l'ospite esprime un giudizio.
// Passo 2 (nodo "LLM - consolida aspetti"): i temi liberi, con la loro
// frequenza, vengono raggruppati in un elenco chiuso di aspetti.
//
// Il campione e' stratificato per voto: le recensioni con voto basso sono
// poche ma contengono le critiche che la direzione deve conoscere, quindi
// sono sovra-rappresentate (30% del campione). Dentro ogni strato l'ordine
// e' dato dall'hash dell'identificativo: pseudo-casuale ma ripetibile.
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;
const recensioni = $('Recensioni pronte')
  .all()
  .map((i) => i.json)
  .filter((r) => !r.vuota && !r.duplicato_di && !r.sospetta);

const strato = (r) => (r.rating === null ? 'senza_voto' : r.rating <= ctx.voto.basso_fino_a ? 'basso' : r.rating < ctx.voto.alto_da ? 'medio' : 'alto');
const quote = { basso: 0.3, medio: 0.25, alto: 0.45 };
const N = Math.min(cfg.discovery_sample, recensioni.length);

const perStrato = {};
for (const r of recensioni) (perStrato[strato(r)] ??= []).push(r);
for (const g of Object.values(perStrato)) g.sort((a, b) => a.ordine_hash.localeCompare(b.ordine_hash));

const campione = [];
for (const [s, q] of Object.entries(quote)) campione.push(...(perStrato[s] ?? []).slice(0, Math.round(N * q)));
if (campione.length < N) {
  // uno strato troppo piccolo: si completa con le altre recensioni in ordine di hash
  const presi = new Set(campione.map((r) => r.review_id));
  const resto = recensioni
    .filter((r) => !presi.has(r.review_id))
    .sort((a, b) => a.ordine_hash.localeCompare(b.ordine_hash));
  campione.push(...resto.slice(0, N - campione.length));
}

const SYSTEM = `${ctx.frase}
For each review, list every specific topic on which the author expresses an evaluation (positive, negative or neutral).
Rules:
- A topic is a concrete theme the author judges (for example a service, a feature, a cost, the behaviour of staff).
- Use a short English label of 1 to 3 words, generic and reusable across reviews. Not a sentence, no adjectives of judgement in the label.
- Do not list topics that are only mentioned without any evaluation.
- Do not use "overall experience" or the reviewed business itself as topics: the overall judgement is not a topic.
- Reviews can be in any language; labels are always in English.
- review_id must be copied exactly.`;

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
        required: ['review_id', 'topics'],
        properties: {
          review_id: { type: 'string' },
          topics: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'sentiment'],
              properties: {
                label: { type: 'string' },
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
              },
            },
          },
        },
      },
    },
  },
};

// nella scoperta i testi molto lunghi si tagliano a 2.500 caratteri (solo qui, non nell'analisi)
const payload = (r) => ({ review_id: r.review_id, title: r.title, text: r.text.slice(0, 2500) });
const GRUPPO = 10;
const richieste = [];
for (let i = 0; i < campione.length; i += GRUPPO) {
  const gruppo = campione.slice(i, i + GRUPPO);
  richieste.push({
    json: {
      ids: gruppo.map((r) => r.review_id),
      body: {
        model: cfg.model,
        temperature: 0,
        seed: cfg.seed,
        max_tokens: 4000,
        response_format: { type: 'json_schema', json_schema: { name: 'topics', strict: true, schema: SCHEMA } },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(gruppo.map(payload)) },
        ],
      },
    },
  });
}
return richieste;
