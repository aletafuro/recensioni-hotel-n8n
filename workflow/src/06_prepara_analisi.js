// PREPARA LE RICHIESTE DI ANALISI
// Tutte le recensioni (tranne le vuote e i duplicati esatti, gestiti a parte)
// vengono mandate al modello a gruppi: al massimo BATCH_SIZE recensioni e
// circa 12.000 caratteri per richiesta, cosi' anche le recensioni lunghe
// restano intere e le risposte non vengono troncate.
const cfg = $('Configurazione').first().json;
const tax = $('Valida tassonomia').first().json;
const recensioni = $('Recensioni pronte')
  .all()
  .map((i) => i.json)
  .filter((r) => !r.vuota && !r.duplicato_di);

// stesso formato usato nei ritentativi (nodo "Valida e completa")
const payload = (r) => ({ review_id: r.review_id, rating: r.rating, title: r.title, text: r.text || r.title });

const MAX_CARATTERI = 12000;
const gruppi = [];
let corrente = [];
let caratteri = 0;
for (const r of recensioni) {
  const lung = r.title.length + r.text.length;
  if (corrente.length && (corrente.length >= cfg.batch_size || caratteri + lung > MAX_CARATTERI)) {
    gruppi.push(corrente);
    corrente = [];
    caratteri = 0;
  }
  corrente.push(r);
  caratteri += lung;
}
if (corrente.length) gruppi.push(corrente);

return gruppi.map((g) => ({
  json: {
    ids: g.map((r) => r.review_id),
    body: {
      ...tax.body_base,
      messages: [
        { role: 'system', content: tax.system_prompt },
        { role: 'user', content: JSON.stringify(g.map(payload)) },
      ],
    },
  },
}));
