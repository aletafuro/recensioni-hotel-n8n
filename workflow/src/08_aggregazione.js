// AGGREGAZIONE
// Dalle analisi delle singole recensioni calcola, per ogni aspetto, quanto e'
// apprezzato e quanto e' criticato, sull'intero archivio e nel tempo.
// Tutti i numeri del digest vengono da qui.
//
// Scelte:
// - Si contano le recensioni, non le frasi: un aspetto vale al massimo 1 per recensione.
// - Classifica principale per VOLUME: quante recensioni apprezzano/criticano
//   l'aspetto (cio' che tocca piu' ospiti). Classifica secondaria per TASSO:
//   tra le recensioni che ne parlano, quota di giudizi positivi/negativi,
//   solo per aspetti con almeno MIN_MENTIONS_RATE_RANKING menzioni.
// - Tempo: base annuale (data di pubblicazione, sempre presente). Gli anni con
//   poche recensioni vengono uniti ai successivi finche' il periodo ha almeno
//   MIN_REVIEWS_PER_PERIOD recensioni, perche' l'archivio non e' uniforme.
// - Andamento: l'ultimo periodo e' confrontato con tutti i precedenti e con il
//   periodo subito prima (test su due proporzioni). Un cambiamento e'
//   "significativo" solo se resta tale dopo la correzione per confronti
//   multipli (Benjamini-Hochberg, falsi positivi attesi al massimo 10%).
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;
const tax = $('Valida tassonomia').first().json;
const fileInfo = $('Recensioni pronte').first().json._file;
const tutte = $input.all().map((i) => i.json);
const infoAnalisi = tutte[0]._analisi;

// nei conteggi: solo recensioni analizzate, non duplicate e non sospette di manipolazione
const valide = tutte.filter((r) => (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta);
const N = valide.length;
if (N === 0) throw new Error('Nessuna recensione analizzata correttamente: aggregazione impossibile');

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const media = (xs) => (xs.length ? Math.round((100 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 100 : null);

function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(1000 * Math.max(0, c - m)) / 10, Math.round(1000 * Math.min(1, c + m)) / 10];
}
// funzione di ripartizione normale (approssimazione di Abramowitz-Stegun)
function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function dueProporzioni(k1, n1, k0, n0) {
  const p1 = k1 / n1, p0 = k0 / n0, p = (k1 + k0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  const z = se > 0 ? (p1 - p0) / se : 0;
  return { z: Math.round(100 * z) / 100, p_value: 2 * (1 - phi(Math.abs(z))) };
}

function contaSentiment(lista) {
  const c = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const r of lista) c[r.overall_sentiment]++;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { recensioni: v, pct: pct(v, lista.length) }]));
}

function statAspetti(lista) {
  const n = lista.length;
  const out = {};
  for (const a of tax.aspetti) {
    let pos = 0, neg = 0, neu = 0;
    for (const r of lista) {
      const x = r.aspects.find((y) => y.aspect === a.aspect);
      if (!x) continue;
      if (x.sentiment === 'positive') pos++;
      else if (x.sentiment === 'negative') neg++;
      else neu++;
    }
    const m = pos + neg + neu;
    out[a.aspect] = {
      aspect: a.aspect,
      nome: a.nome,
      menzioni: m,
      positive: pos,
      negative: neg,
      neutral: neu,
      pct_recensioni_che_ne_parlano: pct(m, n),
      pct_recensioni_che_lo_apprezzano: pct(pos, n),
      pct_recensioni_che_lo_criticano: pct(neg, n),
      pct_positive_su_menzioni: pct(pos, m),
      pct_negative_su_menzioni: pct(neg, m),
      ic95_pct_negative_su_menzioni: wilson(neg, m),
      saldo: m ? Math.round((100 * (pos - neg)) / m) / 100 : null,
    };
  }
  return out;
}

const classifica = (stat, campo, filtro = () => true) =>
  Object.values(stat)
    .filter((s) => s[campo] > 0 && filtro(s))
    .sort((a, b) => b[campo] - a[campo] || b.menzioni - a.menzioni || a.aspect.localeCompare(b.aspect));

// --- intero archivio
const statTotali = statAspetti(valide);
const conPos = (s) => ({ aspect: s.aspect, nome: s.nome, recensioni_positive: s.positive, pct_recensioni_che_lo_apprezzano: s.pct_recensioni_che_lo_apprezzano, pct_positive_su_menzioni: s.pct_positive_su_menzioni, menzioni: s.menzioni });
const conNeg = (s) => ({ aspect: s.aspect, nome: s.nome, recensioni_negative: s.negative, pct_recensioni_che_lo_criticano: s.pct_recensioni_che_lo_criticano, pct_negative_su_menzioni: s.pct_negative_su_menzioni, menzioni: s.menzioni });
const numera = (lista) => lista.map((x, i) => ({ posizione: i + 1, ...x }));
const minM = cfg.min_mentions_rate_ranking;

const classifiche = {
  piu_apprezzati: numera(classifica(statTotali, 'positive').map(conPos)),
  piu_criticati: numera(classifica(statTotali, 'negative').map(conNeg)),
  piu_apprezzati_per_tasso: numera(classifica(statTotali, 'pct_positive_su_menzioni', (s) => s.menzioni >= minM).map(conPos)),
  piu_criticati_per_tasso: numera(classifica(statTotali, 'pct_negative_su_menzioni', (s) => s.menzioni >= minM).map(conNeg)),
};

// --- periodi
const perAnno = new Map();
for (const r of valide) if (r.anno) perAnno.set(r.anno, (perAnno.get(r.anno) ?? 0) + 1);
const anni = [...perAnno.keys()].sort((a, b) => a - b);
const periodiGrezzi = [];
let corrente = null;
for (const a of anni) {
  corrente ??= { dal: a, al: a, n: 0 };
  corrente.al = a;
  corrente.n += perAnno.get(a);
  if (corrente.n >= cfg.min_reviews_per_period) {
    periodiGrezzi.push(corrente);
    corrente = null;
  }
}
if (corrente) {
  // gli ultimi anni rimasti sotto la soglia si uniscono al periodo precedente
  if (periodiGrezzi.length) {
    const u = periodiGrezzi[periodiGrezzi.length - 1];
    u.al = corrente.al;
    u.n += corrente.n;
  } else periodiGrezzi.push(corrente);
}

const periodi = periodiGrezzi.map((p) => {
  const lista = valide.filter((r) => r.anno >= p.dal && r.anno <= p.al);
  const stat = statAspetti(lista);
  return {
    periodo: p.dal === p.al ? String(p.dal) : `${p.dal}-${p.al}`,
    dal_anno: p.dal,
    al_anno: p.al,
    recensioni: lista.length,
    voto_medio: media(lista.filter((r) => r.rating !== null).map((r) => r.rating)),
    sentiment_complessivo: contaSentiment(lista),
    piu_apprezzati: classifica(stat, 'positive').slice(0, 5).map((s) => s.aspect),
    piu_criticati: classifica(stat, 'negative').slice(0, 5).map((s) => s.aspect),
    aspetti: stat,
  };
});

// --- andamento: ultimo periodo contro i precedenti
const andamento = [];
if (periodi.length >= 2) {
  const ultimo = periodi[periodi.length - 1];
  const penultimo = periodi[periodi.length - 2];
  const listaUltimo = valide.filter((r) => r.anno >= ultimo.dal_anno && r.anno <= ultimo.al_anno);
  const listaPrima = valide.filter((r) => r.anno && r.anno < ultimo.dal_anno);
  const listaPenultimo = valide.filter((r) => r.anno >= penultimo.dal_anno && r.anno <= penultimo.al_anno);
  const confronti = [
    { contro: 'tutti_i_periodi_precedenti', etichetta: listaPrima.length ? `${periodi[0].dal_anno}-${penultimo.al_anno}` : null, lista: listaPrima },
    { contro: 'periodo_precedente', etichetta: penultimo.periodo, lista: listaPenultimo },
  ];
  const conta = (lista, aspect, sentiment) => lista.filter((r) => r.aspects.some((x) => x.aspect === aspect && x.sentiment === sentiment)).length;
  for (const c of confronti) {
    if (c.lista.length < 30 || listaUltimo.length < 30) continue;
    for (const a of tax.aspetti) {
      for (const [misura, sentiment] of [['pct_recensioni_che_lo_criticano', 'negative'], ['pct_recensioni_che_lo_apprezzano', 'positive']]) {
        const k1 = conta(listaUltimo, a.aspect, sentiment);
        const k0 = conta(c.lista, a.aspect, sentiment);
        if (k1 + k0 < 10) continue; // troppo pochi casi per dire qualcosa
        const t = dueProporzioni(k1, listaUltimo.length, k0, c.lista.length);
        andamento.push({
          aspect: a.aspect,
          nome: a.nome,
          misura,
          ultimo_periodo: ultimo.periodo,
          confronto_con: c.contro,
          periodo_di_confronto: c.etichetta,
          valore_ultimo_periodo: pct(k1, listaUltimo.length),
          valore_periodo_di_confronto: pct(k0, c.lista.length),
          differenza_punti: Math.round(10 * (pct(k1, listaUltimo.length) - pct(k0, c.lista.length))) / 10,
          z: t.z,
          p_value: Math.round(10000 * t.p_value) / 10000,
        });
      }
    }
  }
  // Benjamini-Hochberg sul complesso dei confronti
  const ordinati = [...andamento].sort((a, b) => a.p_value - b.p_value);
  const m = ordinati.length;
  let soglia = -1;
  ordinati.forEach((x, i) => {
    if (x.p_value <= ((i + 1) / m) * 0.1) soglia = i;
  });
  ordinati.forEach((x, i) => {
    x.significativo = i <= soglia;
    x.direzione = x.differenza_punti > 0 ? 'aumento' : x.differenza_punti < 0 ? 'calo' : 'stabile';
  });
}

// --- per lingua
// La lingua e' un'informazione: se le recensioni negative venissero soprattutto da
// una lingua, sarebbe un segnale per la direzione. Ogni lingua con almeno
// MIN_LINGUA recensioni e' confrontata con tutte le altre insieme sulla quota di
// recensioni negative o miste (test su due proporzioni, correzione Benjamini-Hochberg).
const MIN_LINGUA = 15;
const negativeOMiste = (lista) => lista.filter((r) => r.overall_sentiment === 'negative' || r.overall_sentiment === 'mixed').length;
const conteggioLingue = new Map();
for (const r of valide) conteggioLingue.set(r.language, (conteggioLingue.get(r.language) ?? 0) + 1);
const perLingua = [...conteggioLingue].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([lingua, n]) => {
  const lista = valide.filter((r) => r.language === lingua);
  const altre = valide.filter((r) => r.language !== lingua);
  const base = {
    lingua,
    recensioni: n,
    voto_medio: media(lista.filter((r) => r.rating !== null).map((r) => r.rating)),
    sentiment_complessivo: contaSentiment(lista),
  };
  if (n < MIN_LINGUA || altre.length < 30) return { ...base, confronto_con_le_altre_lingue: null };
  const k1 = negativeOMiste(lista);
  const k0 = negativeOMiste(altre);
  const t = dueProporzioni(k1, n, k0, altre.length);
  return {
    ...base,
    confronto_con_le_altre_lingue: {
      misura: 'pct_recensioni_negative_o_miste',
      valore_lingua: pct(k1, n),
      valore_altre_lingue: pct(k0, altre.length),
      differenza_punti: Math.round(10 * (pct(k1, n) - pct(k0, altre.length))) / 10,
      z: t.z,
      p_value: Math.round(10000 * t.p_value) / 10000,
    },
  };
});
{
  const confronti = perLingua.map((x) => x.confronto_con_le_altre_lingue).filter(Boolean).sort((a, b) => a.p_value - b.p_value);
  let soglia = -1;
  confronti.forEach((x, i) => {
    if (x.p_value <= ((i + 1) / confronti.length) * 0.1) soglia = i;
  });
  confronti.forEach((x, i) => {
    x.significativo = i <= soglia;
    x.direzione = x.differenza_punti > 0 ? 'piu_negative' : x.differenza_punti < 0 ? 'meno_negative' : 'uguale';
  });
}

// --- serie annuale grezza (conteggi), per chi vuole ricalcolare con altre granularita'
const serieAnnuale = anni.map((anno) => {
  const lista = valide.filter((r) => r.anno === anno);
  const aspetti = {};
  for (const a of tax.aspetti) {
    const c = { positive: 0, negative: 0, neutral: 0 };
    for (const r of lista) {
      const x = r.aspects.find((y) => y.aspect === a.aspect);
      if (x) c[x.sentiment]++;
    }
    aspetti[a.aspect] = c;
  }
  const s = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const r of lista) s[r.overall_sentiment]++;
  return { anno, recensioni: lista.length, sentiment_complessivo: s, aspetti };
});

// --- segnalazioni
const segnalate = tutte.filter((r) => r.needs_attention && r.stato !== 'duplicato');
const ORD = { alta: 0, media: 1, bassa: 2 };
const perCategoria = {};
for (const r of segnalate) for (const s of r.segnalazioni) perCategoria[s.categoria] = (perCategoria[s.categoria] ?? 0) + 1;
const perPriorita = { alta: 0, media: 0, bassa: 0 };
for (const r of segnalate) perPriorita[r.priorita]++;
const segnalazioni = {
  totale: segnalate.length,
  pct_sul_totale: pct(segnalate.length, tutte.filter((r) => r.stato !== 'duplicato').length),
  per_priorita: perPriorita,
  per_categoria: perCategoria,
  solo_per_voto_basso: segnalate.filter((r) => r.segnalazioni.length === 0 && r.rating !== null && r.rating <= ctx.voto.basso_fino_a).length,
  per_periodo: periodi.map((p) => ({
    periodo: p.periodo,
    segnalate: segnalate.filter((r) => r.anno >= p.dal_anno && r.anno <= p.al_anno).length,
    segnalate_priorita_alta: segnalate.filter((r) => r.anno >= p.dal_anno && r.anno <= p.al_anno && r.priorita === 'alta').length,
  })),
  elenco: segnalate
    .sort((a, b) => ORD[a.priorita] - ORD[b.priorita] || (b.published_date ?? '').localeCompare(a.published_date ?? ''))
    .map((r) => ({
      review_id: r.review_id,
      published_date: r.published_date,
      rating: r.rating,
      priorita: r.priorita,
      categorie: [...new Set(r.segnalazioni.map((s) => s.categoria))],
      attention_reason: r.attention_reason,
    })),
};

const lingue = {};
for (const r of valide) lingue[r.language] = (lingue[r.language] ?? 0) + 1;
const date = valide.map((r) => r.published_date).filter(Boolean).sort();

// --- l'elenco fisso degli aspetti va rivisto?
// I temi fuori elenco sono la categoria «altro» del sistema. Si confronta la quota
// di recensioni con temi fuori elenco con la linea di base salvata nell'elenco fisso
// (test su due proporzioni, regola dei 2 errori standard) e si cercano i temi fuori
// elenco abbastanza frequenti da meritare un aspetto (almeno il 2% delle recensioni).
// Se una delle due condizioni scatta, l'elenco va rivisto da una persona (nuova versione).
const elencoAspetti = (() => {
  const conFuori = valide.filter((r) => (r.unmapped ?? []).length > 0).length;
  const base = tax.linea_di_base;
  let confronto = null;
  if (base?.recensioni) {
    const t = dueProporzioni(conFuori, N, base.recensioni_con_temi_fuori_elenco, base.recensioni);
    confronto = { pct_oggi: pct(conFuori, N), pct_linea_di_base: base.pct, z: t.z, sopra_la_linea_di_base: t.z >= 2 };
  }
  const conteggio = new Map();
  for (const r of valide) for (const u of new Set(r.unmapped ?? [])) conteggio.set(u, (conteggio.get(u) ?? 0) + 1);
  const soglia = Math.max(5, Math.ceil(0.02 * N));
  const candidati = [...conteggio].filter(([, n]) => n >= soglia).sort((a, b) => b[1] - a[1])
    .map(([tema, n]) => ({ tema, recensioni: n, pct: pct(n, N) }));
  const fisso = tax.origine_aspetti === 'elenco fisso';
  return {
    versione: tax.versione_aspetti,
    origine: tax.origine_aspetti,
    recensioni_con_temi_fuori_elenco_pct: pct(conFuori, N),
    confronto_con_la_linea_di_base: confronto,
    soglia_temi_candidati_recensioni: soglia,
    temi_candidati: candidati,
    da_rivedere: fisso && (!!confronto?.sopra_la_linea_di_base || candidati.length > 0),
    regola: "da rivedere se la quota di recensioni con temi fuori elenco supera la linea di base di almeno 2 errori standard, oppure se un tema fuori elenco compare in almeno il 2% delle recensioni",
  };
})();

const aggregazione = {
  meta: {
    generato_il: new Date().toISOString(),
    modello: cfg.model,
    file_input: cfg.input_file,
    righe_nel_file: fileInfo.righe_nel_file,
    recensioni_in_output: tutte.length,
    recensioni_aggregate: N,
    escluse_dall_aggregazione: {
      duplicati: tutte.filter((r) => r.stato === 'duplicato').length,
      vuote: tutte.filter((r) => r.stato === 'vuota').length,
      analisi_fallita: tutte.filter((r) => r.stato === 'fallita').length,
      sospette_di_manipolazione: tutte.filter((r) => r.sospetta && r.stato !== 'duplicato').length,
    },
    prima_data: date[0] ?? null,
    ultima_data: date[date.length - 1] ?? null,
    elenco_aspetti: elencoAspetti,
    regola_periodi: `anni di pubblicazione uniti finche' ogni periodo ha almeno ${cfg.min_reviews_per_period} recensioni`,
    definizioni: {
      menzioni: "recensioni che esprimono un giudizio sull'aspetto (al massimo 1 per recensione)",
      pct_recensioni_che_lo_apprezzano: "recensioni con giudizio positivo sull'aspetto / recensioni aggregate del periodo x 100",
      pct_recensioni_che_lo_criticano: "recensioni con giudizio negativo sull'aspetto / recensioni aggregate del periodo x 100",
      pct_positive_su_menzioni: "giudizi positivi / menzioni x 100",
      pct_negative_su_menzioni: "giudizi negativi / menzioni x 100",
      saldo: '(positive - negative) / menzioni, da -1 a +1',
      piu_apprezzati: 'ordinati per numero di recensioni che apprezzano l\'aspetto',
      piu_criticati: 'ordinati per numero di recensioni che criticano l\'aspetto',
      per_tasso: `ordinati per quota sulle menzioni, solo aspetti con almeno ${minM} menzioni`,
      per_lingua: 'ogni lingua con almeno 15 recensioni contro tutte le altre, quota di recensioni negative o miste; significativo dopo Benjamini-Hochberg (FDR 10%)',
      andamento: 'ultimo periodo contro i precedenti; significativo = test su due proporzioni con correzione Benjamini-Hochberg (FDR 10%)',
    },
  },
  sentiment_complessivo: contaSentiment(valide),
  voto_medio: media(valide.filter((r) => r.rating !== null).map((r) => r.rating)),
  lingue,
  per_lingua: perLingua,
  aspetti: Object.values(statTotali),
  classifiche,
  periodi,
  andamento,
  serie_annuale: serieAnnuale,
  segnalazioni,
};

return [{ json: { aggregazione, info_analisi: infoAnalisi } }];
