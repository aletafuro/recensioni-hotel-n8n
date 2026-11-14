// USA IL DIGEST DI RISERVA
// Si arriva qui solo se il guardrail di uscita ha trovato nel digest dati
// personali, link, chiavi o nomi di persone. Il testo non viene pubblicato:
// si usa il digest di riserva, scritto senza modello dagli stessi fatti.
const v = $('Verifica digest').first().json;
const controlli = ($input.first().json.checks ?? []).filter((c) => c.triggered);
return [{
  json: {
    digest: v.digest_riserva,
    origine: 'riserva_guardrail_uscita',
    guardrail_uscita: controlli.map((c) => ({ controllo: c.name, info: c.info ?? null, confidenza: c.confidenceScore ?? null })),
  },
}];
