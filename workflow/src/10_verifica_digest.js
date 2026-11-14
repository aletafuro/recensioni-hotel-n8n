// VERIFICA E COMPOSIZIONE DEL DIGEST
// Il digest lo monta il CODICE: titoli, frasi con i numeri (scritte nel nodo dei
// fatti), elenchi, recensioni da guardare. Dal modello arrivano solo i commenti a
// parole, sezione per sezione, e le citazioni. Cosi' ogni numero del digest e'
// scritto dal codice, per costruzione, e non puo' cambiare significato.
// Controlli sulla parte del modello:
// - nei commenti nessuna cifra e nessuna virgoletta « »;
// - ogni citazione copiata parola per parola dalla recensione indicata;
// - identificativi esistenti e almeno una citazione per le sezioni principali.
// Se un controllo fallisce, il modello riceve i problemi e corregge (fino a 2 volte).
// Se non basta, il digest esce senza i commenti del modello (versione di riserva).
const helpers = this.helpers;
const usoToken = []; // token delle correzioni del digest
const cfg = $('Configurazione').first().json;
const { fatti, body } = $('Fatti per il digest').first().json;
const testi = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json.title + '\n' + i.json.text]));

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”„"]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
const maiusc = (s) => String(s).replace(/^./, (c) => c.toUpperCase());
const SEZIONI = ['apprezzati', 'criticati', 'segnalate'];
const COMMENTI = ['sintesi', 'commento_apprezzati', 'commento_criticati', 'commento_tempo', 'commento_segnalate'];

function leggi(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

function controlla(o) {
  if (!o) return ['la risposta non e\' un JSON valido'];
  const problemi = [];
  for (const k of COMMENTI) {
    const t = String(o[k] ?? '').trim();
    if (!t) problemi.push(`il campo ${k} e' vuoto`);
    const cifre = t.match(/\d+/g);
    if (cifre) problemi.push(`il campo ${k} contiene cifre (${cifre.slice(0, 5).join(', ')}): descrivi a parole, senza numeri ne' anni`);
    if (/[«»]/.test(t)) problemi.push(`il campo ${k} contiene virgolette « »: le citazioni vanno solo nel campo "citazioni"`);
  }
  const cit = Array.isArray(o.citazioni) ? o.citazioni : [];
  for (const s of SEZIONI) if (!cit.some((c) => c.sezione === s)) problemi.push(`manca una citazione per la sezione "${s}"`);
  for (const c of cit) {
    const testo = testi.get(c.review_id);
    if (!testo) {
      problemi.push(`la citazione per "${c.sezione}" indica un identificativo inesistente (${c.review_id})`);
      continue;
    }
    const pezzi = norm(c.testo).split(/\.{3,}/).map((p) => p.trim().replace(/^["'.,;:\s]+|["',;:\s]+$/g, '')).filter((p) => p.length > 2);
    if (!pezzi.length || !pezzi.every((p) => norm(testo).includes(p))) {
      problemi.push(`la citazione «${String(c.testo).slice(0, 60)}...» non e' copiata parola per parola dalla recensione ${c.review_id}: copia frasi consecutive senza cambiare parole, oppure segna con "..." le parti saltate`);
    }
    if (String(c.testo).split(/\s+/).length > 40) problemi.push(`la citazione della recensione ${c.review_id} supera 30 parole`);
    const numeriCitazione = new Set(String(c.testo).match(/\d+/g) ?? []);
    for (const n of String(c.traduzione ?? '').match(/\d+/g) ?? []) {
      if (!numeriCitazione.has(n)) problemi.push(`la traduzione della citazione ${c.review_id} contiene il numero ${n}, che non e' nella citazione`);
    }
  }
  return problemi;
}

// --- citazioni per la versione di riserva: una frase della recensione che contiene una parola dell'aspetto
function fraseSullAspetto(testo, paroleChiave) {
  const frasi = testo.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);
  const scelta = frasi.find((s) => paroleChiave.some((k) => s.toLowerCase().includes(k))) ?? frasi[0] ?? testo;
  return scelta.split(/\s+/).slice(0, 30).join(' ');
}
function citazioniDiRiserva(sezione) {
  const giaCitate = new Set();
  return fatti.citazioni_disponibili
    .filter((c) => c.per.startsWith(sezione === 'apprezzati' ? 'apprezzato' : 'criticato'))
    .slice(0, 2)
    .map((c) => {
      const r = c.recensioni.find((x) => !giaCitate.has(x.review_id));
      if (!r) return null;
      giaCitate.add(r.review_id);
      return { sezione, review_id: r.review_id, testo: fraseSullAspetto(r.testo, c.parole_chiave ?? []), traduzione: '' };
    })
    .filter(Boolean);
}

// --- composizione del digest
function componi(o) {
  const f = fatti;
  const r = [];
  const citazioni = (sezione) => {
    const lista = o ? (o.citazioni ?? []).filter((c) => c.sezione === sezione) : sezione === 'segnalate' ? [] : citazioniDiRiserva(sezione);
    return lista.flatMap((c) => [`> «${c.testo}» (${c.review_id})${c.traduzione ? ` [${c.traduzione}]` : ''}`, '']);
  };
  r.push('# Digest delle recensioni', '');

  r.push('## In sintesi', '', f.frase_sintesi, '');
  for (const l of f.differenze_tra_lingue_significative ?? []) r.push(maiusc(l.frase_numeri) + '.', '');
  if (o) r.push(o.sintesi.trim(), '');
  else if (!(f.differenze_tra_lingue_significative ?? []).length) r.push('Le recensioni nelle diverse lingue non mostrano differenze distinguibili dal caso.', '');

  r.push("## Cosa apprezzano di piu'", '');
  for (const x of f.aspetti_piu_apprezzati) r.push(`- **${x.aspetto}**: ${x.frase_numeri}.`);
  r.push('');
  if (o) r.push(o.commento_apprezzati.trim(), '');
  r.push(...citazioni('apprezzati'));

  r.push("## Cosa criticano di piu'", '');
  for (const x of f.aspetti_piu_criticati) r.push(`- **${x.aspetto}**: ${x.frase_numeri}.`);
  r.push('');
  if (f.aspetti_piu_divisivi.length) {
    r.push("Gli aspetti piu' divisivi, cioe' criticati da una parte grande di chi ne parla:", '');
    for (const x of f.aspetti_piu_divisivi) r.push(`- **${x.aspetto}**: ${x.frase_numeri}.`);
    r.push('');
  }
  if (o) r.push(o.commento_criticati.trim(), '');
  r.push(...citazioni('criticati'));

  r.push('## Come cambiano le cose nel tempo', '');
  r.push(`Le recensioni sono raggruppate in periodi con abbastanza recensioni per un confronto. Sono stati fatti ${f.confronti_nel_tempo_eseguiti} confronti tra l'ultimo periodo e i precedenti: ${f.confronti_nel_tempo_significativi} risultano significativi dopo la correzione per confronti multipli.`, '');
  for (const x of f.cambiamenti_significativi) r.push(`- ${x.frase_numeri}.`);
  if (f.cambiamenti_significativi.length) r.push('');
  for (const p of f.per_piattaforma ?? []) {
    r.push(`Versioni dell'app su ${p.piattaforma}:`, '');
    for (const v of p.versioni) {
      r.push(v.nota ? `- versione ${v.versione}: ${v.recensioni} recensioni, ${v.nota}.` : `- versione ${v.versione}: ${v.recensioni} recensioni, voto medio ${v.voto_medio}, positive ${v.positive}, negative ${v.negative}.`);
    }
    for (const x of p.cambiamenti_ultima_versione) r.push(`- ${x.aspetto}: ${x.misura} in ${x.direzione}, ${x.valore_ultima_versione} nella versione ${x.ultima_versione} contro ${x.valore_di_confronto} nelle versioni precedenti.`);
    r.push('');
  }
  if (o) r.push(o.commento_tempo.trim(), '');
  r.push('Andamento per periodo:', '');
  for (const p of f.periodi) r.push(`- ${maiusc(p.frase_numeri)}.`);
  r.push('');

  r.push('## Recensioni da guardare', '', f.frase_segnalate, '');
  for (const s of f.segnalate_da_mostrare) r.push(`- ${s.review_id} (${s.data}${s.voto ? `, voto ${s.voto}` : ''}, priorita' ${s.priorita}): ${s.motivo}`);
  r.push('');
  if (o) r.push(o.commento_segnalate.trim(), '');
  r.push(...citazioni('segnalate'));

  r.push('## Come sono stati ottenuti questi numeri', '');
  r.push("Ogni recensione e' stata letta da un modello linguistico, nella sua lingua, che ne ha indicato il giudizio complessivo e il giudizio sugli aspetti di un elenco fisso. Tutti i numeri di questo testo sono conteggi calcolati dal sistema su quelle analisi; i cambiamenti nel tempo sono indicati solo quando superano la soglia statistica dopo la correzione per confronti multipli. Le segnalazioni seguono criteri fissati in anticipo e ognuna ha una frase di prova presa dalla recensione.");
  r.push('');
  r.push(o
    ? "I commenti a parole e la scelta delle citazioni sono del modello; ogni citazione e' stata controllata parola per parola sulla recensione originale."
    : "Questa versione non contiene i commenti del modello, perche' non hanno superato i controlli automatici; le citazioni sono scelte dal sistema.");
  return r.join('\n');
}

// --- chiamata al modello con le correzioni
async function chiedi(messaggi) {
  const res = await helpers.httpRequest({
    method: 'POST',
    url: cfg.base_url + '/chat/completions',
    headers: { Authorization: 'Bearer ' + $env.OPENAI_API_KEY },
    body: { ...body, messages: messaggi },
    json: true,
    timeout: 180000,
  });
  if (res.usage) usoToken.push(res.usage);
  return String(res.choices?.[0]?.message?.content ?? '');
}

let risposta = String($input.first().json?.choices?.[0]?.message?.content ?? '');
let o = leggi(risposta);
let problemi = controlla(o);
const tentativi = [{ tentativo: 1, ok: problemi.length === 0, problemi }];
let messaggi = [...body.messages];
for (let t = 2; t <= 3 && problemi.length; t++) {
  messaggi = [
    ...messaggi,
    { role: 'assistant', content: risposta || '(vuoto)' },
    { role: 'user', content: 'La risposta non supera i controlli automatici. Correggi questi problemi e restituisci di nuovo il JSON completo:\n- ' + problemi.join('\n- ') },
  ];
  try {
    risposta = await chiedi(messaggi);
    o = leggi(risposta);
    problemi = controlla(o);
  } catch (e) {
    problemi = ['errore di chiamata al modello: ' + e.message];
  }
  tentativi.push({ tentativo: t, ok: problemi.length === 0, problemi });
}

const usaModello = problemi.length === 0;
const riserva = componi(null);
return [{
  json: {
    digest: usaModello ? componi(o) : riserva,
    origine: usaModello ? 'modello' : 'riserva_controlli_non_superati',
    verifica: { tentativi, esito_finale: { ok: usaModello, problemi } },
    uso_token: usoToken,
    digest_riserva: riserva,
    esito_riserva: { ok: true, nota: 'composto dal codice: numeri dalle frasi dei fatti, citazioni scelte dal sistema' },
    // risposta del modello scartata, conservata per capire perche'
    ultimo_testo_modello: usaModello ? null : risposta,
  },
}];
