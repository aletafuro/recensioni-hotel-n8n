// RECENSIONI PRONTE (dopo i guardrail di ingresso)
// Rimette insieme ogni recensione con:
// - il testo ripulito dal guardrail "dati sensibili" (email, telefoni, carte,
//   IBAN, IP, chiavi e link sostituiti da segnaposto come <EMAIL_ADDRESS>):
//   da qui in poi il modello vede SOLO il testo ripulito;
// - l'esito del guardrail "manipolazione": le recensioni che contengono
//   istruzioni rivolte a un sistema automatico vengono marcate come sospette.
//   Si analizzano lo stesso (lo schema di risposta limita cio' che il modello
//   puo' restituire), ma vengono segnalate e tenute fuori dai conteggi.
const SEPARATORE = '\n§§§\n';
const originali = $('Assegna ID e pulisci').all().map((i) => i.json);
const puliti = $('Guardrail: dati sensibili').all();
if (puliti.length !== originali.length) {
  throw new Error(`Il guardrail dati sensibili ha restituito ${puliti.length} recensioni su ${originali.length}`);
}

// il guardrail riceve solo le recensioni nuove o cambiate (nodo «Prepara controllo manipolazione»): la posizione
// di ogni suo esito si riporta alla posizione della recensione con indice_originale
const inviate = $('Prepara controllo manipolazione').all().map((i) => i.json.indice_originale);
const indice = (it) => {
  const p = Array.isArray(it.pairedItem) ? it.pairedItem[0] : it.pairedItem;
  return inviate[p?.item] ?? null;
};
const esito = new Map();
for (const it of $('Guardrail: manipolazione').all(0)) {
  const i = indice(it);
  if (i !== null) esito.set(i, { sospetta: false, checks: it.json.checks ?? [] });
}
for (const it of $('Guardrail: manipolazione').all(1)) {
  // un errore tecnico del guardrail non rende sospetta la recensione
  const i = indice(it);
  if (i === null) continue;
  const errore = it.json.error ?? null;
  esito.set(i, { sospetta: !errore, errore, checks: it.json.checks ?? [] });
}
// le altre: esito dalla memoria (stessa firma del nodo «Prepara controllo manipolazione»)
const crypto = require('crypto');
const FIRMA_CONFIGURAZIONE = '__FIRMA_GUARDRAIL_MANIPOLAZIONE__';
const modello = $env.GUARDRAIL_MODEL || 'gpt-4.1-mini';
const firma = (testo) => crypto.createHash('sha1').update(JSON.stringify([FIRMA_CONFIGURAZIONE, modello, testo]), 'utf8').digest('hex');
let memoria = {};
try {
  memoria = $('Estrai memoria guardrail').first().json.data?.voci ?? {};
} catch (e) {
  memoria = {};
}

const SEGNAPOSTO = /<([A-Z_]+)>/g;
return originali.map((r, i) => {
  const testoPulito = String(puliti[i].json.guardrailsInput ?? '');
  const pos = testoPulito.indexOf(SEPARATORE);
  const title = pos >= 0 ? testoPulito.slice(0, pos) : r.title;
  const text = pos >= 0 ? testoPulito.slice(pos + SEPARATORE.length) : testoPulito;
  const oscurati = {};
  for (const m of testoPulito.matchAll(SEGNAPOSTO)) oscurati[m[1]] = (oscurati[m[1]] ?? 0) + 1;
  const f = firma(testoPulito);
  const m = memoria[r.review_id];
  let sospetta, scattati, errore, dallaMemoria = false;
  if (esito.has(i)) {
    const e = esito.get(i);
    sospetta = e.sospetta;
    scattati = e.checks.filter((c) => c.triggered).map((c) => c.name);
    errore = e.errore ?? null;
  } else if (m && m.firma === f) {
    sospetta = !!m.sospetta;
    scattati = m.scattati ?? [];
    errore = null;
    dallaMemoria = true;
  } else {
    sospetta = false;
    scattati = [];
    errore = 'esito mancante';
  }
  return {
    json: {
      ...r,
      title,
      text,
      dati_oscurati: oscurati,
      sospetta,
      guardrail_scattati: scattati,
      guardrail_errore: errore,
      guardrail_firma: f,
      guardrail_dalla_memoria: dallaMemoria,
    },
  };
});
