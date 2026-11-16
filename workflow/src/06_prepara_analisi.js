// PREPARA LE RICHIESTE DI ANALISI
// Le recensioni (tranne le vuote e i duplicati esatti, gestiti a parte) vengono mandate al modello a gruppi:
// al massimo BATCH_SIZE recensioni e circa 12.000 caratteri per richiesta, cosi' anche le recensioni lunghe
// restano intere e le risposte non vengono troncate.
//
// MEMORIA DELLE ANALISI (16/11): si mandano al modello solo le recensioni NUOVE o CAMBIATE. Per ogni recensione
// gia' analizzata la memoria (memoria_analisi.json nella cartella dei risultati) tiene la risposta del modello e
// una «firma»: l'impronta di istruzioni, elenco degli aspetti e categorie (tutto nel system prompt), modello e
// impostazioni della richiesta, dimensione dei gruppi e testo della recensione. Se cambia una sola di queste cose
// la firma cambia e la recensione si rianalizza: un nuovo elenco degli aspetti o un nuovo contesto fanno
// rianalizzare TUTTO da soli. La stessa firma la calcola il nodo «Valida e completa».
const crypto = require('crypto');
const cfg = $('Configurazione').first().json;
const tax = $('Valida tassonomia').first().json;
const recensioni = $('Recensioni pronte')
  .all()
  .map((i) => i.json)
  .filter((r) => !r.vuota && !r.duplicato_di);

// stesso formato usato nei ritentativi (nodo "Valida e completa")
const payload = (r) => ({ review_id: r.review_id, rating: r.rating, title: r.title, text: r.text || r.title });
const firma = (r) => crypto.createHash('sha1').update(JSON.stringify([tax.system_prompt, tax.body_base, cfg.batch_size, payload(r)]), 'utf8').digest('hex');
let memoria = {};
try {
  memoria = $('Estrai memoria analisi').first().json.data?.voci ?? {};
} catch (e) {
  memoria = {}; // primo giro: nessuna memoria
}
const daMandare = recensioni.filter((r) => memoria[r.review_id]?.firma !== firma(r));

const MAX_CARATTERI = 12000;
const gruppi = [];
let corrente = [];
let caratteri = 0;
for (const r of daMandare) {
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

// niente di nuovo da analizzare: un solo elemento segnaposto, che salta la chiamata al modello
// (nodo «Richieste da fare?») e arriva direttamente a «Valida e completa»
if (!gruppi.length) return [{ json: { nessuna_richiesta: true, dalla_memoria: recensioni.length } }];

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
