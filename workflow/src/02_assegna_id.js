// ASSEGNA ID E PULISCI
// Ogni recensione riceve un identificativo stabile che dipende solo dal suo
// contenuto: review_id = "R" + primi 10 caratteri di sha1(publishedDate|title|text).
// Se il file viene riordinato o ricaricato, gli identificativi non cambiano.
// Qui si controllano anche i campi e si annotano le anomalie (rumore del file).
const crypto = require('crypto');
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;

const pulisci = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

const righe = $input.all().map((i) => i.json);
if (righe.length === 0) throw new Error('Nessuna recensione nel file ' + cfg.input_file);
for (const c of ['title', 'rating', 'publishedDate', 'text']) {
  if (!(c in righe[0])) throw new Error('Colonna mancante nel CSV: ' + c);
}

const visti = new Set();
const anomalie = [];
let recensioni = righe.map((r, i) => {
  const riga = i + 2; // la riga 1 del file e' l'intestazione
  const title = pulisci(r.title);
  const text = pulisci(r.text);
  const published = pulisci(r.publishedDate);
  const travelGrezzo = pulisci(r.travelDate);

  const h = sha1([published, title, text].join('|'));
  let id = 'R' + h.slice(0, 10);
  let duplicato_di = null;
  if (visti.has(id)) {
    // stessa data, stesso titolo, stesso testo: duplicato esatto
    duplicato_di = id;
    let k = 2;
    while (visti.has(`${id}-${k}`)) k++;
    id = `${id}-${k}`;
    anomalie.push({ riga, review_id: id, tipo: 'duplicato', dettaglio: 'uguale a ' + duplicato_di });
  }
  visti.add(id);

  const n = Number(pulisci(r.rating));
  const rating = Number.isInteger(n) && n >= ctx.voto.minimo && n <= ctx.voto.massimo ? n : null;
  if (rating === null) anomalie.push({ riga, review_id: id, tipo: 'voto_non_valido', dettaglio: String(r.rating ?? '') });

  const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(published) && !isNaN(Date.parse(published));
  if (!dataOk) anomalie.push({ riga, review_id: id, tipo: 'data_pubblicazione_non_valida', dettaglio: published });

  let travel = /^\d{4}-\d{2}$/.test(travelGrezzo) ? travelGrezzo : null;
  if (!travelGrezzo) anomalie.push({ riga, review_id: id, tipo: 'data_soggiorno_mancante', dettaglio: null });
  else if (!travel) anomalie.push({ riga, review_id: id, tipo: 'data_soggiorno_non_valida', dettaglio: travelGrezzo });
  if (travel && dataOk && travel > published.slice(0, 7)) {
    anomalie.push({ riga, review_id: id, tipo: 'soggiorno_dopo_pubblicazione', dettaglio: `${travel} > ${published}` });
    travel = null;
  }

  // testo per il modello: spazi multipli ridotti, a capo mantenuti
  const testo = text.replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  const vuota = testo.length === 0 && title.length === 0;
  if (vuota) anomalie.push({ riga, review_id: id, tipo: 'recensione_vuota', dettaglio: null });
  else if (testo.length === 0) anomalie.push({ riga, review_id: id, tipo: 'testo_vuoto_si_usa_il_titolo', dettaglio: null });

  return {
    review_id: id,
    riga,
    ordine_hash: h.slice(10, 18), // ordine pseudo-casuale ma ripetibile
    title,
    text: testo,
    rating,
    published_date: dataOk ? published : null,
    travel_date: travel,
    anno: dataOk ? Number(published.slice(0, 4)) : null,
    duplicato_di,
    vuota,
  };
});

// ordine cronologico; le recensioni senza data valida in fondo
recensioni.sort(
  (a, b) => (a.published_date ?? '9999').localeCompare(b.published_date ?? '9999') || a.review_id.localeCompare(b.review_id),
);

// LIMIT > 0: campione ripetibile per le prove (ordine dato dall'hash, quindi sparso negli anni)
if (cfg.limit > 0 && cfg.limit < recensioni.length) {
  const scelti = new Set(
    [...recensioni].sort((a, b) => a.ordine_hash.localeCompare(b.ordine_hash)).slice(0, cfg.limit).map((r) => r.review_id),
  );
  recensioni = recensioni.filter((r) => scelti.has(r.review_id));
}

// le informazioni sul file viaggiano sul primo elemento
recensioni[0] = { ...recensioni[0], _file: { righe_nel_file: righe.length, anomalie } };
return recensioni.map((r) => ({ json: r }));
