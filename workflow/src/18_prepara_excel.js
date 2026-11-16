// PREPARA IL FILE EXCEL (recensioni_hotel.xlsx)
// Un solo file con piu' fogli, scritto accanto agli altri risultati: andamento mese per mese, confronti tra periodi,
// temi per mese, lingue, segnalazioni e una riga per recensione.
// Nessun numero nuovo: tutto viene dall'Aggregazione o e' un semplice conteggio delle analisi delle recensioni.
// I TESTI delle recensioni non ci sono: hanno la loro licenza e si scaricano a parte (vedi README); nel file ci sono
// solo le analisi e le brevi frasi citate come prova, come negli altri file dei risultati.
// Il file .xlsx e' costruito a mano (zip senza compressione + XML), perche' nel nodo Code non ci sono librerie esterne.
const cfg = $('Configurazione').first().json;
const A = $('Aggregazione').first().json.aggregazione;
const tax = $('Valida tassonomia').first().json;
const analisi = $('Valida e completa').all().map((i) => i.json);

const nomeAspetto = Object.fromEntries([...(A.aspetti ?? []).map((a) => [a.aspect, a.nome]), ...tax.aspetti.map((a) => [a.aspect, a.nome])]);
const SENT = { positive: 'positivo', negative: 'negativo', mixed: 'misto', neutral: 'neutro' };
const MISURA = { pct_recensioni_che_lo_criticano: '% recensioni che lo criticano', pct_recensioni_che_lo_apprezzano: '% recensioni che lo apprezzano' };
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const valide = analisi.filter((r) => (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta);

const fogli = [];
const R = A.periodi_di_calendario;
fogli.push({
  nome: 'Leggimi',
  colonne: ['foglio', 'che cosa contiene'],
  righe: [
    ['Mesi', 'Per ogni mese: recensioni, voto medio, sentiment e confronto con il mese prima.'],
    ['Confronti', 'Aspetti: ultimo periodo contro i precedenti (periodi di almeno ' + cfg.min_reviews_per_period + ' recensioni, come nel digest).'],
    ['Temi per mese', 'Per ogni mese e aspetto: quante recensioni lo apprezzano e quante lo criticano.'],
    ['Lingue', 'Recensioni per lingua, con la quota di negative.'],
    ['Segnalazioni', 'Le recensioni da guardare: categoria, priorità, che cosa dice chi ha scritto e la sua frase.'],
    ['Recensioni', 'Una riga per recensione: data, lingua, voto, sentiment, aspetti, segnalazioni. Senza testo: i testi si scaricano a parte (vedi README).'],
    ['', ''],
    ['Come leggere i confronti', '«oltre il rumore» = la differenza è troppo grande per essere un caso (test su due proporzioni con correzione per i confronti multipli). «entro il rumore» = può essere un caso. «pochi dati» = uno dei due mesi ha meno di 20 recensioni: si vedono i numeri ma non si dà un verdetto.'],
    ['p-value e verdetto', 'Un p-value sotto 0,05 può restare «entro il rumore»: con tanti confronti nella stessa tabella qualcuno risulta basso per caso, e la correzione alza la soglia (Benjamini-Hochberg, al massimo 10% di falsi allarmi attesi). Conta la colonna «confronto».'],
    ['Mesi incompleti', 'Il primo e l\'ultimo mese dell\'archivio possono essere coperti solo in parte: la colonna «nota» lo dice.'],
    ['Attenzione', 'Le recensioni sono affermazioni di chi le scrive, non fatti accertati.'],
    ['Regola dei mesi', R?.regola ?? ''],
    ['Giro del', new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })],
  ],
});

fogli.push({
  nome: 'Mesi',
  colonne: ['mese', 'nota', 'recensioni', 'voto medio', 'positive', 'negative', 'miste', 'neutre', '% negative', '% negative mese prima', 'differenza (punti)', 'confronto', 'p-value'],
  righe: (R?.mesi ?? []).flatMap((s) => s.periodi.map((p) => [
    p.periodo, p.dati_solo_dal ? `incompleto: dati solo dal ${p.dati_solo_dal}` : p.dati_fino_al ? `incompleto: dati fino al ${p.dati_fino_al}` : '',
    p.recensioni, p.voto_medio, p.positive, p.negative, p.miste, p.neutre,
    p.pct_negative, p.confronto?.pct_negative_prima ?? null, p.confronto?.differenza_punti ?? null, p.confronto?.esito ?? '', p.confronto?.p_value ?? null,
  ])),
});

fogli.push({
  nome: 'Confronti',
  colonne: ['confronto', 'aspetto', 'misura', 'valore nuovo', 'valore di confronto', 'differenza (punti)', 'p-value', 'esito'],
  righe: (A.andamento ?? []).map((x) => [`${x.ultimo_periodo} contro ${x.periodo_di_confronto}`, x.nome, MISURA[x.misura] ?? x.misura, x.valore_ultimo_periodo, x.valore_periodo_di_confronto, x.differenza_punti, x.p_value, x.significativo ? 'oltre il rumore' : 'entro il rumore']),
});

const temiMese = new Map(), recMese = new Map();
for (const r of valide) {
  if (!r.published_date) continue;
  const m = String(r.published_date).slice(0, 7);
  recMese.set(m, (recMese.get(m) ?? 0) + 1);
  for (const a of r.aspects ?? []) {
    const k = `${m}|${a.aspect}`;
    const x = temiMese.get(k) ?? { m, aspect: a.aspect, pos: 0, neg: 0 };
    if (a.sentiment === 'positive') x.pos++;
    if (a.sentiment === 'negative') x.neg++;
    temiMese.set(k, x);
  }
}
fogli.push({
  nome: 'Temi per mese',
  colonne: ['mese', 'aspetto', 'recensioni del mese', 'lo apprezzano', 'lo criticano', '% che lo criticano'],
  righe: [...temiMese.values()].sort((a, b) => a.m.localeCompare(b.m) || b.neg - a.neg)
    .map((x) => { const n = recMese.get(x.m); return [x.m, nomeAspetto[x.aspect] ?? x.aspect, n, x.pos, x.neg, pct(x.neg, n)]; }),
});

const perLingua = new Map();
for (const r of valide) { if (!perLingua.has(r.language)) perLingua.set(r.language, []); perLingua.get(r.language).push(r); }
fogli.push({
  nome: 'Lingue',
  colonne: ['lingua', 'recensioni', 'negative', '% negative'],
  righe: [...perLingua.entries()].map(([lg, l]) => { const neg = l.filter((r) => r.overall_sentiment === 'negative').length; return [lg === 'und' ? 'non riconosciuta' : lg, l.length, neg, pct(neg, l.length)]; })
    .sort((a, b) => b[1] - a[1]),
});

fogli.push({
  nome: 'Segnalazioni',
  colonne: ['data', 'voto', 'lingua', 'categoria', 'priorità', 'secondo chi ha scritto', 'frase della recensione', 'review_id'],
  righe: analisi.flatMap((r) => (r.segnalazioni ?? []).map((s) => [r.published_date ?? '', r.rating, r.language, s.nome_categoria, s.priorita, s.sintesi, s.evidenza, r.review_id]))
    .sort((a, b) => String(b[0]).localeCompare(String(a[0]))),
});

fogli.push({
  nome: 'Recensioni',
  colonne: ['data', 'lingua', 'voto', 'sentiment', 'aspetti (giudizio)', 'segnalazioni', 'nei conteggi', 'review_id'],
  righe: analisi.map((r) => [
    r.published_date ?? '', r.language === 'und' ? '' : r.language, r.rating, SENT[r.overall_sentiment] ?? r.overall_sentiment,
    (r.aspects ?? []).map((a) => `${nomeAspetto[a.aspect] ?? a.aspect}: ${SENT[a.sentiment] ?? a.sentiment}`).join('; '),
    [...new Set((r.segnalazioni ?? []).map((s) => s.nome_categoria))].join('; '),
    (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta ? 'sì' : 'no',
    r.review_id,
  ]).sort((a, b) => String(b[0]).localeCompare(String(a[0]))),
});

// --- costruzione del file .xlsx
const xml = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').slice(0, 32000)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colonna = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const cella = (v, rif, stile) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${rif}"${stile}><v>${v}</v></c>`;
  return `<c r="${rif}" t="inlineStr"${stile}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
};
const foglioXml = (f) => {
  const tutte = [f.colonne, ...f.righe];
  const larghezze = f.colonne.map((c, j) => Math.min(60, Math.max(10, ...tutte.slice(0, 200).map((r) => String(r[j] ?? '').length + 2))));
  const righe = tutte.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cella(v, `${colonna(j)}${i + 1}`, i === 0 ? ' s="1"' : '')).join('')}</row>`).join('');
  const ultima = `${colonna(f.colonne.length - 1)}${Math.max(1, tutte.length)}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${larghezze.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${righe}</sheetData>`
    + (f.righe.length ? `<autoFilter ref="A1:${ultima}"/>` : '')
    + '</worksheet>';
};
const file = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + fogli.map((f, i) => `<sheet name="${xml(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets>'
    + `<definedNames>${fogli.map((f, i) => (f.righe.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(f.nome)}'!$A$1:$${colonna(f.colonne.length - 1)}$${f.righe.length + 1}</definedName>` : '')).join('')}</definedNames>`
    + '</workbook>',
  'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
};
fogli.forEach((f, i) => { file[`xl/worksheets/sheet${i + 1}.xml`] = foglioXml(f); });

// zip senza compressione (metodo «stored»), con CRC-32
const TABELLA_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABELLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const locali = [], centrali = [];
let posizione = 0;
for (const [nome, testo] of Object.entries(file)) {
  const n = Buffer.from(nome, 'utf8'), d = Buffer.from(testo, 'utf8'), crc = crc32(d);
  const loc = Buffer.alloc(30);
  loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(0, 8);
  loc.writeUInt16LE(0, 10); loc.writeUInt16LE(0x21, 12); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(d.length, 18); loc.writeUInt32LE(d.length, 22);
  loc.writeUInt16LE(n.length, 26); loc.writeUInt16LE(0, 28);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
  cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(d.length, 20); cen.writeUInt32LE(d.length, 24);
  cen.writeUInt16LE(n.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36);
  cen.writeUInt32LE(0, 38); cen.writeUInt32LE(posizione, 42);
  locali.push(loc, n, d); centrali.push(cen, n);
  posizione += loc.length + n.length + d.length;
}
const dirCentrale = Buffer.concat(centrali);
const fine = Buffer.alloc(22);
fine.writeUInt32LE(0x06054b50, 0); fine.writeUInt16LE(0, 4); fine.writeUInt16LE(0, 6);
fine.writeUInt16LE(Object.keys(file).length, 8); fine.writeUInt16LE(Object.keys(file).length, 10);
fine.writeUInt32LE(dirCentrale.length, 12); fine.writeUInt32LE(posizione, 16); fine.writeUInt16LE(0, 20);
const xlsx = Buffer.concat([...locali, dirCentrale, fine]);

return [{
  json: { path: `${cfg.output_dir}/recensioni_hotel.xlsx`, fogli: fogli.map((f) => ({ nome: f.nome, righe: f.righe.length })), byte: xlsx.length },
  binary: { data: { data: xlsx.toString('base64'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: 'recensioni_hotel.xlsx' } },
}];
