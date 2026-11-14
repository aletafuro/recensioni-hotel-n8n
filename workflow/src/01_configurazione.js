// CONFIGURAZIONE
// Legge i parametri dalle variabili d'ambiente (docker-compose.yml / .env).
// Nessun valore e' scritto nel workflow: chi lo esegue su un'altra macchina
// cambia solo il file .env.
const numero = (v, predefinito) =>
  v === undefined || v === null || v === '' || isNaN(Number(v)) ? predefinito : Number(v);

if (!$env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY mancante: copia .env.example in .env e inserisci la chiave');
}

return [{
  json: {
    input_file: $env.INPUT_FILE || '/files/input/ritz_carlton_reviews.csv',
    // contesto del dominio: chi e' recensito, chi legge, categorie di segnalazione
    context_file: $env.CONTEXT_FILE || '/files/contesto/contesto.json',
    output_dir: ($env.OUTPUT_DIR || '/files/output').replace(/\/+$/, ''),
    model: $env.LLM_MODEL || 'gpt-4.1-mini',
    base_url: ($env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    // 0 = tutte le recensioni; un numero > 0 = campione deterministico per le prove
    limit: numero($env.LIMIT, 0),
    // recensioni per chiamata al modello nell'analisi
    batch_size: numero($env.BATCH_SIZE, 5),
    // recensioni lette per far emergere gli aspetti
    discovery_sample: numero($env.DISCOVERY_SAMPLE, 240),
    // minimo di recensioni per periodo nell'andamento nel tempo
    min_reviews_per_period: numero($env.MIN_REVIEWS_PER_PERIOD, 100),
    // elenco fisso degli aspetti: se il file esiste si usa quello e la scoperta
    // degli aspetti si salta; RISCOPRI_ASPETTI=true forza una nuova scoperta
    aspects_file: $env.ASPECTS_FILE || '/files/aspetti/aspetti_fissi.json',
    riscopri_aspetti: String($env.RISCOPRI_ASPETTI || '').toLowerCase() === 'true',
    // minimo di menzioni per entrare nelle classifiche "per tasso"
    min_mentions_rate_ranking: numero($env.MIN_MENTIONS_RATE_RANKING, 30),
    // prezzi del modello in dollari per milione di token (listino da verificare quando cambia)
    prezzo_input_usd_per_milione: numero($env.PREZZO_INPUT_USD_PER_MILIONE, 0.4),
    prezzo_output_usd_per_milione: numero($env.PREZZO_OUTPUT_USD_PER_MILIONE, 1.6),
    seed: 42,
    started_at: new Date().toISOString(),
  },
}];
