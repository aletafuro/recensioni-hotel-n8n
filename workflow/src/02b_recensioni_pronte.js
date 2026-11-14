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

const indice = (it) => {
  const p = Array.isArray(it.pairedItem) ? it.pairedItem[0] : it.pairedItem;
  return p?.item;
};
const esito = new Map();
for (const it of $('Guardrail: manipolazione').all(0)) esito.set(indice(it), { sospetta: false, checks: it.json.checks ?? [] });
for (const it of $('Guardrail: manipolazione').all(1)) {
  // un errore tecnico del guardrail non rende sospetta la recensione
  const errore = it.json.error ?? null;
  esito.set(indice(it), { sospetta: !errore, errore, checks: it.json.checks ?? [] });
}

const SEGNAPOSTO = /<([A-Z_]+)>/g;
return originali.map((r, i) => {
  const testoPulito = String(puliti[i].json.guardrailsInput ?? '');
  const pos = testoPulito.indexOf(SEPARATORE);
  const title = pos >= 0 ? testoPulito.slice(0, pos) : r.title;
  const text = pos >= 0 ? testoPulito.slice(pos + SEPARATORE.length) : testoPulito;
  const oscurati = {};
  for (const m of testoPulito.matchAll(SEGNAPOSTO)) oscurati[m[1]] = (oscurati[m[1]] ?? 0) + 1;
  const e = esito.get(i) ?? { sospetta: false, checks: [], errore: 'esito mancante' };
  const scattati = e.checks.filter((c) => c.triggered).map((c) => c.name);
  return {
    json: {
      ...r,
      title,
      text,
      dati_oscurati: oscurati,
      sospetta: e.sospetta,
      guardrail_scattati: scattati,
      guardrail_errore: e.errore ?? null,
    },
  };
});
