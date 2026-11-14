// RACCOGLI I TEMI LIBERI E PREPARA IL CONSOLIDAMENTO
// Conta quante recensioni del campione citano ogni tema libero e con quale
// giudizio. La lista ordinata per frequenza va al modello, che la raggruppa
// in un elenco chiuso di aspetti.
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;

const normalizza = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 &/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const conteggi = new Map();
let risposteNonValide = 0;
let recensioniLette = 0;
for (const it of $input.all()) {
  const content = it.json?.choices?.[0]?.message?.content;
  let dati = null;
  try {
    dati = JSON.parse(content);
  } catch (e) {
    risposteNonValide++;
    continue;
  }
  for (const r of dati.results ?? []) {
    recensioniLette++;
    const giaVisti = new Set(); // un tema conta una volta per recensione
    for (const t of r.topics ?? []) {
      const label = normalizza(t.label);
      if (!label || giaVisti.has(label)) continue;
      giaVisti.add(label);
      const c = conteggi.get(label) ?? { label, recensioni: 0, positive: 0, negative: 0, neutral: 0 };
      c.recensioni++;
      if (['positive', 'negative', 'neutral'].includes(t.sentiment)) c[t.sentiment]++;
      conteggi.set(label, c);
    }
  }
}
if (conteggi.size === 0) throw new Error('Scoperta degli aspetti fallita: nessuna risposta valida dal modello');

const temi = [...conteggi.values()].sort((a, b) => b.recensioni - a.recensioni || a.label.localeCompare(b.label));
// al modello vanno i 400 temi piu' frequenti (gli altri sono citati una sola volta)
const perModello = temi.slice(0, 400).map((t) => `${t.label} | ${t.recensioni} | +${t.positive} -${t.negative} =${t.neutral}`);

const SYSTEM = `You design the list of aspects for a system that analyses reviews for ${ctx.lettori_dei_risultati}.
${ctx.frase}
You receive free-text topic labels extracted from a sample of ${recensioniLette} reviews. Each line is: label | number of reviews that judged it | +positive -negative =neutral.
Merge synonyms and closely related labels into a final list of between 10 and 20 aspects.
Each aspect must be:
- a specific theme the authors judge, that the readers of the results can act on (not "overall experience", not the reviewed business itself);
- clearly distinct from the other aspects, with no overlaps;
- frequent enough: rare labels go into the closest aspect; a theme that is rare but serious for management (for example cleanliness or safety) may stay separate.
Frequent labels (judged by at least ${Math.max(3, Math.ceil(0.02 * recensioniLette))} reviews) must each appear in the includes of exactly one aspect. A frequent label that is a distinct part of the stay, run by different people or facilities, should not be hidden inside a broader aspect.
Put generic labels about the same area in the same aspect as the specific ones (for example generic staff labels together with specific staff roles only if you do not create separate aspects for those roles).
For each aspect give:
- aspect: short English identifier in snake_case (for example "breakfast", "room_comfort");
- name_it: short name in ${ctx.lingua_del_digest} for the readers of the results;
- description_it: one sentence in ${ctx.lingua_del_digest} saying exactly what the aspect covers and what it does not cover;
- includes: the source labels merged into it, copied exactly from the input.
Do not invent themes that are not supported by the labels.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['aspects'],
  properties: {
    aspects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['aspect', 'name_it', 'description_it', 'includes'],
        properties: {
          aspect: { type: 'string' },
          name_it: { type: 'string' },
          description_it: { type: 'string' },
          includes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

return [{
  json: {
    temi,
    recensioni_lette: recensioniLette,
    risposte_non_valide: risposteNonValide,
    body: {
      model: cfg.model,
      temperature: 0,
      seed: cfg.seed,
      max_tokens: 16000,
      response_format: { type: 'json_schema', json_schema: { name: 'aspects', strict: true, schema: SCHEMA } },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: perModello.join('\n') },
      ],
    },
  },
}];
