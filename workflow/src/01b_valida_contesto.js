// VALIDA IL CONTESTO DEL DOMINIO
// Il contesto (data/contesto/contesto.json) dice al sistema che cosa viene
// recensito, chi scrive, chi legge i risultati, in che lingua scrivere il digest
// e quali problemi vanno segnalati. Tutti i prompt lo leggono da qui: per
// passare da un hotel a un'app o a un negozio si cambia solo quel file.
// Il contesto NON suggerisce aspetti: quelli emergono dalle recensioni.
const c = $input.first().json.data ?? $input.first().json;
const errori = [];
const testo = (campo) => {
  const v = String(c[campo] ?? '').trim();
  if (!v) errori.push(`manca "${campo}"`);
  return v;
};

const ctx = {
  oggetto_recensito: testo('oggetto_recensito'),
  descrizione: testo('descrizione'),
  autori_delle_recensioni: testo('autori_delle_recensioni'),
  lettori_dei_risultati: testo('lettori_dei_risultati'),
  lingua_del_digest: testo('lingua_del_digest'),
  critiche_ordinarie_da_non_segnalare: String(c.critiche_ordinarie_da_non_segnalare ?? '').trim(),
};

const v = c.voto ?? {};
ctx.voto = {
  minimo: Number(v.minimo ?? 1),
  massimo: Number(v.massimo ?? 5),
  basso_fino_a: Number(v.basso_fino_a ?? 2),
  alto_da: Number(v.alto_da ?? 4),
};
if (!(ctx.voto.minimo < ctx.voto.basso_fino_a && ctx.voto.basso_fino_a < ctx.voto.alto_da && ctx.voto.alto_da <= ctx.voto.massimo)) {
  errori.push('scala del voto non coerente: serve minimo < basso_fino_a < alto_da <= massimo');
}

ctx.categorie = {};
for (const [codice, cat] of Object.entries(c.categorie_di_segnalazione ?? {})) {
  if (!/^[a-z][a-z0-9_]*$/.test(codice)) errori.push(`codice di categoria non valido: "${codice}" (solo minuscole, cifre e _)`);
  if (!['alta', 'media'].includes(cat?.priorita)) errori.push(`categoria "${codice}": priorita deve essere "alta" o "media"`);
  if (!String(cat?.nome ?? '').trim() || !String(cat?.definizione ?? '').trim()) errori.push(`categoria "${codice}": servono nome e definizione`);
  ctx.categorie[codice] = { nome: String(cat?.nome ?? codice).trim(), priorita: cat?.priorita, definizione: String(cat?.definizione ?? '').trim() };
}
if (Object.keys(ctx.categorie).length === 0) errori.push('servono almeno una categoria di segnalazione');

if (errori.length) throw new Error('File di contesto non valido:\n- ' + errori.join('\n- '));

// frase di contesto riusata in tutti i prompt
ctx.frase = `Context: the texts are reviews of ${ctx.oggetto_recensito}, written by ${ctx.autori_delle_recensioni}. ${ctx.descrizione} The results are read by ${ctx.lettori_dei_risultati}.`;
return [{ json: ctx }];
