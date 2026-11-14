// VERIFICA DEL SISTEMA: METRICHE
// A. Generalizzazione senza etichette: confronta le recensioni di SVILUPPO
//    (usate per scrivere e provare i prompt) con quelle di TEST (tenute da parte).
//    Se il sistema fosse tarato sulle recensioni viste, sul test peggiorerebbe.
//    Una differenza conta solo se supera 2 errori standard (|z| >= 2).
// B. Accuratezza sul gold set: recensioni di test etichettate alla cieca da un
//    modello diverso, che non ha visto ne' i risultati ne' i prompt del sistema.
// Scrive valutazione.json (per il codice) e valutazione.md (da leggere).
const crypto = require('crypto');
const cfg = $('Configurazione verifica').first().json;

const testo = (nodo) => String($(nodo).first().json.data ?? '');
const risultati = $('Estrai risultati').first().json.data ?? [];
const diagnostica = new Map(testo('Estrai diagnostica').split('\n').filter((l) => l.trim()).map((l) => {
  const d = JSON.parse(l);
  return [d.review_id, d];
}));
const testIds = new Set(testo('Estrai id di test').split(/\s+/).filter(Boolean));
const pulisci = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const sorgente = new Map($('Estrai archivio').all().map((i) => {
  const r = i.json;
  const h = crypto.createHash('sha1').update([pulisci(r.publishedDate), pulisci(r.title), pulisci(r.text)].join('|'), 'utf8').digest('hex');
  return ['R' + h.slice(0, 10), { rating: Number(r.rating), text: pulisci(r.text) }];
}));
let gold = [];
try {
  gold = $('Estrai gold set').all().map((i) => i.json).filter((g) => g.review_id && g.overall_sentiment);
} catch (e) {
  gold = [];
}

// ---------- strumenti statistici
const pct = (k, n) => (n ? Math.round((1000 * k) / n) / 10 : null);
function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(1000 * Math.max(0, c - m)) / 10, Math.round(1000 * Math.min(1, c + m)) / 10];
}
function z2(k1, n1, k0, n0) {
  if (!n1 || !n0) return null;
  const p = (k1 + k0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  return se > 0 ? Math.round((100 * (k1 / n1 - k0 / n0)) / se) / 100 : 0;
}
// lingua deducibile dall'alfabeto, per controllare il codice lingua del modello
function alfabeto(t) {
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[가-힯]/.test(t)) return 'ko';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  return null;
}

// ---------- A. sviluppo contro test
const voto = (r) => sorgente.get(r.review_id)?.rating;
function misure(gruppo) {
  const alti = gruppo.filter((r) => voto(r) >= 4);
  const bassi = gruppo.filter((r) => voto(r) <= 2);
  const conAlfabeto = gruppo.filter((r) => alfabeto(sorgente.get(r.review_id)?.text ?? ''));
  return {
    positive_tra_voti_4_5: [alti.filter((r) => r.overall_sentiment === 'positive').length, alti.length],
    negative_o_miste_tra_voti_1_2: [bassi.filter((r) => ['negative', 'mixed'].includes(r.overall_sentiment)).length, bassi.length],
    con_almeno_un_aspetto: [gruppo.filter((r) => r.aspects.length > 0).length, gruppo.length],
    con_temi_fuori_elenco: [gruppo.filter((r) => (diagnostica.get(r.review_id)?.temi_fuori_elenco ?? []).length > 0).length, gruppo.length],
    segnalate: [gruppo.filter((r) => r.needs_attention).length, gruppo.length],
    segnalate_per_contenuto: [gruppo.filter((r) => (diagnostica.get(r.review_id)?.segnalazioni ?? []).length > 0).length, gruppo.length],
    lingua_coerente_con_alfabeto: [conAlfabeto.filter((r) => r.language === alfabeto(sorgente.get(r.review_id).text)).length, conAlfabeto.length],
  };
}
const sviluppo = risultati.filter((r) => !testIds.has(r.review_id));
const test = risultati.filter((r) => testIds.has(r.review_id));
const ms = misure(sviluppo);
const mt = misure(test);
const confronto = Object.keys(ms).map((k) => {
  const [ks, ns] = ms[k];
  const [kt, nt] = mt[k];
  const z = z2(kt, nt, ks, ns);
  return {
    misura: k,
    sviluppo: { casi: ks, su: ns, pct: pct(ks, ns), ic95: wilson(ks, ns) },
    test: { casi: kt, su: nt, pct: pct(kt, nt), ic95: wilson(kt, nt) },
    z_test_meno_sviluppo: z,
    differenza_oltre_il_rumore: z === null ? null : Math.abs(z) >= 2,
  };
});
const media = (g) => (g.length ? Math.round((100 * g.reduce((s, r) => s + r.aspects.length, 0)) / g.length) / 100 : null);

// ---------- B. gold set
let metricheGold = null;
if (gold.length) {
  const perId = new Map(risultati.map((r) => [r.review_id, r]));
  const diag = (id) => diagnostica.get(id) ?? {};
  const etichette = ['positive', 'mixed', 'negative', 'neutral'];
  const confusione = Object.fromEntries(etichette.map((a) => [a, Object.fromEntries(etichette.map((b) => [b, 0]))]));
  let okOverall = 0, okLingua = 0, tp = 0, fp = 0, fn = 0, sentOk = 0, sentN = 0;
  let segTp = 0, segFp = 0, segFn = 0, segTn = 0;
  const disaccordi = [];
  const perAspetto = {};
  for (const g of gold) {
    const r = perId.get(g.review_id);
    if (!r) continue;
    const atteso = String(g.overall_sentiment).trim();
    if (confusione[atteso]?.[r.overall_sentiment] !== undefined) confusione[atteso][r.overall_sentiment]++;
    if (atteso === r.overall_sentiment) okOverall++;
    if (String(g.language ?? '').trim() === r.language) okLingua++;

    const asp = {};
    for (const p of String(g.aspects ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
      const [a, s] = p.split(':').map((x) => x.trim());
      if (a) asp[a] = s;
    }
    const sis = Object.fromEntries(r.aspects.map((a) => [a.aspect, a.sentiment]));
    const comuni = Object.keys(asp).filter((a) => a in sis);
    tp += comuni.length;
    fp += Object.keys(sis).filter((a) => !(a in asp)).length;
    fn += Object.keys(asp).filter((a) => !(a in sis)).length;
    for (const a of comuni) {
      sentN++;
      if (asp[a] === sis[a]) sentOk++;
    }
    for (const a of new Set([...Object.keys(asp), ...Object.keys(sis)])) {
      perAspetto[a] ??= { attesi: 0, trovati: 0, in_comune: 0 };
      if (a in asp) perAspetto[a].attesi++;
      if (a in sis) perAspetto[a].trovati++;
      if (a in asp && a in sis) perAspetto[a].in_comune++;
    }

    const categorieAttese = String(g.attention_categories ?? '').split(';').map((s) => s.trim()).filter(Boolean);
    const segnalataGold = categorieAttese.length > 0;
    const segnalataSis = (diag(g.review_id).segnalazioni ?? []).length > 0;
    if (segnalataGold && segnalataSis) segTp++;
    else if (!segnalataGold && segnalataSis) segFp++;
    else if (segnalataGold && !segnalataSis) segFn++;
    else segTn++;

    if (atteso !== r.overall_sentiment || segnalataGold !== segnalataSis) {
      disaccordi.push({
        review_id: g.review_id,
        sentiment_atteso: atteso,
        sentiment_sistema: r.overall_sentiment,
        segnalazione_attesa: categorieAttese,
        segnalazione_sistema: (diag(g.review_id).segnalazioni ?? []).map((s) => s.categoria),
      });
    }
  }
  const n = gold.length;
  const prec = tp + fp ? tp / (tp + fp) : null;
  const rich = tp + fn ? tp / (tp + fn) : null;
  // kappa di Cohen sul sentiment complessivo: accordo oltre quello atteso per caso
  const po = okOverall / n;
  const pe = etichette.reduce((s, a) => s + (Object.values(confusione[a]).reduce((x, y) => x + y, 0) / n) * (etichette.reduce((x, b) => x + confusione[b][a], 0) / n), 0);
  metricheGold = {
    recensioni_etichettate: n,
    sentiment_complessivo: { accuratezza_pct: pct(okOverall, n), ic95: wilson(okOverall, n), kappa_cohen: pe < 1 ? Math.round((100 * (po - pe)) / (1 - pe)) / 100 : null, matrice_confusione_atteso_per_sistema: confusione },
    lingua: { accuratezza_pct: pct(okLingua, n), ic95: wilson(okLingua, n) },
    aspetti: {
      precisione_pct: prec === null ? null : Math.round(1000 * prec) / 10,
      richiamo_pct: rich === null ? null : Math.round(1000 * rich) / 10,
      f1_pct: prec && rich ? Math.round((1000 * 2 * prec * rich) / (prec + rich)) / 10 : null,
      in_comune: tp, solo_sistema: fp, solo_gold: fn,
      sentiment_corretto_sugli_aspetti_in_comune_pct: pct(sentOk, sentN),
      ic95_sentiment: wilson(sentOk, sentN),
      per_aspetto: perAspetto,
    },
    segnalazioni_per_contenuto: {
      precisione_pct: pct(segTp, segTp + segFp),
      richiamo_pct: pct(segTp, segTp + segFn),
      vere_positive: segTp, false_positive: segFp, false_negative: segFn, vere_negative: segTn,
    },
    disaccordi,
  };
}

const valutazione = {
  generata_il: new Date().toISOString(),
  file_risultati: cfg.cartella_risultati,
  avvertenza_gold_set: "Gold set etichettato alla cieca da un modello diverso da quello del sistema, senza accesso ai risultati ne' ai prompt: e' un confronto tra modelli, non un'annotazione umana.",
  A_sviluppo_contro_test: {
    recensioni: { sviluppo: sviluppo.length, test: test.length },
    aspetti_medi_per_recensione: { sviluppo: media(sviluppo), test: media(test) },
    confronto,
  },
  B_gold_set: metricheGold,
};

// ---------- versione da leggere
const fmt = (x) => (x === null || x === undefined ? '-' : String(x).replace('.', ','));
const righe = ['# Verifica del sistema', '', `Generata il ${valutazione.generata_il.slice(0, 10)} dai risultati in \`${cfg.cartella_risultati}\`.`, ''];
righe.push('## A. Sviluppo contro test (senza etichette)', '');
righe.push(`Recensioni di sviluppo: ${sviluppo.length}. Recensioni di test: ${test.length}. Una differenza conta solo se |z| >= 2.`, '');
righe.push('| misura | sviluppo | test | z | oltre il rumore |', '|---|---|---|---|---|');
for (const c of confronto) {
  righe.push(`| ${c.misura.replace(/_/g, ' ')} | ${c.sviluppo.casi}/${c.sviluppo.su} (${fmt(c.sviluppo.pct)}%) | ${c.test.casi}/${c.test.su} (${fmt(c.test.pct)}%) | ${fmt(c.z_test_meno_sviluppo)} | ${c.differenza_oltre_il_rumore ? 'si' : 'no'} |`);
}
righe.push('', `Aspetti medi per recensione: sviluppo ${fmt(media(sviluppo))}, test ${fmt(media(test))}.`, '');
righe.push('## B. Gold set', '');
if (!metricheGold) righe.push('Gold set non presente (data/valutazione/gold_set.csv).');
else {
  const g = metricheGold;
  righe.push(valutazione.avvertenza_gold_set, '');
  righe.push(`Recensioni etichettate: ${g.recensioni_etichettate}.`, '');
  righe.push('| misura | valore | intervallo 95% |', '|---|---|---|');
  righe.push(`| sentiment complessivo, accuratezza | ${fmt(g.sentiment_complessivo.accuratezza_pct)}% | ${fmt(g.sentiment_complessivo.ic95?.[0])}-${fmt(g.sentiment_complessivo.ic95?.[1])}% |`);
  righe.push(`| sentiment complessivo, kappa di Cohen | ${fmt(g.sentiment_complessivo.kappa_cohen)} | |`);
  righe.push(`| lingua, accuratezza | ${fmt(g.lingua.accuratezza_pct)}% | ${fmt(g.lingua.ic95?.[0])}-${fmt(g.lingua.ic95?.[1])}% |`);
  righe.push(`| aspetti, precisione | ${fmt(g.aspetti.precisione_pct)}% | |`);
  righe.push(`| aspetti, richiamo | ${fmt(g.aspetti.richiamo_pct)}% | |`);
  righe.push(`| aspetti, F1 | ${fmt(g.aspetti.f1_pct)}% | |`);
  righe.push(`| sentiment sugli aspetti in comune | ${fmt(g.aspetti.sentiment_corretto_sugli_aspetti_in_comune_pct)}% | ${fmt(g.aspetti.ic95_sentiment?.[0])}-${fmt(g.aspetti.ic95_sentiment?.[1])}% |`);
  righe.push(`| segnalazioni per contenuto, precisione | ${fmt(g.segnalazioni_per_contenuto.precisione_pct)}% | |`);
  righe.push(`| segnalazioni per contenuto, richiamo | ${fmt(g.segnalazioni_per_contenuto.richiamo_pct)}% | |`);
  righe.push('', `Disaccordi da leggere: ${g.disaccordi.length} (elenco in valutazione.json).`);
}

const file = (nome, contenuto, mime) => ({
  json: { path: `${cfg.cartella_risultati}/${nome}` },
  binary: { data: { data: Buffer.from(contenuto, 'utf8').toString('base64'), mimeType: mime, fileName: nome } },
});
return [
  file('valutazione.json', JSON.stringify(valutazione, null, 2), 'application/json'),
  file('valutazione.md', righe.join('\n') + '\n', 'text/markdown'),
];
