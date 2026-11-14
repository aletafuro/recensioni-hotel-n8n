// CONFRONTO DI UNA RIGA DEL GOLD SET CON L'OUTPUT DEL SISTEMA
// La scheda Evaluations di n8n fa passare il gold set una riga alla volta.
// Per ogni riga si cerca l'analisi prodotta dal sistema (recensioni_analizzate.json
// e recensioni_diagnostica.jsonl) e si calcolano le metriche della riga.
// n8n poi fa la media delle metriche su tutte le righe.
const riga = $('Gold set (Evaluation Trigger)').first().json;
const risultati = $('Estrai risultati').first().json.data ?? [];
const diagnostica = String($('Estrai diagnostica').first().json.data ?? '')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const r = risultati.find((x) => x.review_id === riga.review_id);
if (!r) throw new Error(`Recensione ${riga.review_id} non trovata nei risultati del sistema`);
const d = diagnostica.find((x) => x.review_id === riga.review_id) ?? {};

const atteso = {};
for (const p of String(riga.aspects ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
  const [a, s] = p.split(':').map((x) => x.trim());
  if (a) atteso[a] = s;
}
const sistema = Object.fromEntries(r.aspects.map((a) => [a.aspect, a.sentiment]));
const comuni = Object.keys(atteso).filter((a) => a in sistema);
const nA = Object.keys(atteso).length;
const nS = Object.keys(sistema).length;
// riga senza aspetti da entrambe le parti: accordo pieno
const precisione = nS ? comuni.length / nS : nA ? 0 : 1;
const richiamo = nA ? comuni.length / nA : nS ? 0 : 1;
const f1 = precisione + richiamo ? (2 * precisione * richiamo) / (precisione + richiamo) : 0;

const categorieAttese = String(riga.attention_categories ?? '').split(';').map((s) => s.trim()).filter(Boolean);
const categorieSistema = [...new Set((d.segnalazioni ?? []).map((s) => s.categoria))];

const comeTesto = (o) => Object.entries(o).map(([a, s]) => `${a}:${s}`).join('; ');
return [{
  json: {
    review_id: riga.review_id,
    atteso_overall: String(riga.overall_sentiment ?? '').trim(),
    sistema_overall: r.overall_sentiment,
    sistema_language: r.language,
    sistema_aspects: comeTesto(sistema),
    sistema_categorie: categorieSistema.join('; '),
    metriche: {
      lingua_corretta: String(riga.language ?? '').trim() === r.language ? 1 : 0,
      aspetti_precisione: Math.round(1000 * precisione) / 1000,
      aspetti_richiamo: Math.round(1000 * richiamo) / 1000,
      aspetti_f1: Math.round(1000 * f1) / 1000,
      // conteggi, non rapporti: se una riga non ha aspetti in comune il rapporto non esiste.
      // media(giudizi giusti) / media(aspetti in comune) = accuratezza del sentiment sugli aspetti
      aspetti_in_comune: comuni.length,
      aspetti_giudizio_giusto: comuni.filter((a) => atteso[a] === sistema[a]).length,
      segnalazione_corretta: (categorieAttese.length > 0) === (categorieSistema.length > 0) ? 1 : 0,
    },
  },
}];
