// PREPARA IL CONTROLLO DELLA MANIPOLAZIONE (memoria del guardrail, 16/11)
// Il guardrail «manipolazione» chiama il modello una volta per recensione: con 2.300 recensioni era la parte
// che faceva durare il giro mezz'ora. Qui si mandano al guardrail solo le recensioni NUOVE o CAMBIATE.
// Per le altre l'esito si riprende dalla memoria (memoria_guardrail.json nella cartella dei risultati), se la
// «firma» e' la stessa: impronta della configurazione del guardrail (istruzioni, espressioni regolari, soglia:
// calcolata da build_workflow.py e scritta qui sotto), del modello e del testo gia' ripulito dai dati personali.
// Cambia una di queste cose -> il controllo si rifa'. Le recensioni con un errore tecnico del guardrail non
// vanno in memoria: si ricontrollano al giro dopo. Il nodo «Recensioni pronte» rimette insieme gli esiti.
const crypto = require('crypto');
const FIRMA_CONFIGURAZIONE = '__FIRMA_GUARDRAIL_MANIPOLAZIONE__';
const modello = $env.GUARDRAIL_MODEL || 'gpt-4.1-mini';
const firma = (testo) => crypto.createHash('sha1').update(JSON.stringify([FIRMA_CONFIGURAZIONE, modello, testo]), 'utf8').digest('hex');
const originali = $('Assegna ID e pulisci').all().map((i) => i.json);
const puliti = $('Guardrail: dati sensibili').all();
let memoria = {};
try {
  memoria = $('Estrai memoria guardrail').first().json.data?.voci ?? {};
} catch (e) {
  memoria = {};
}
const out = [];
puliti.forEach((it, i) => {
  const testo = String(it.json.guardrailsInput ?? '');
  const m = memoria[originali[i]?.review_id];
  if (m && m.firma === firma(testo)) return; // gia' controllata con la stessa configurazione e lo stesso testo
  out.push({ json: { guardrailsInput: testo, indice_originale: i } });
});
// niente di nuovo: un testo neutro, cosi' il guardrail (e il resto del giro) parte comunque; il suo esito si ignora
if (!out.length) out.push({ json: { guardrailsInput: 'ok', indice_originale: null } });
return out;
