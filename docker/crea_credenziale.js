// Crea, dentro il container, la credenziale OpenAI che n8n usa nei nodi HTTP
// e nei guardrail. La chiave arriva dalla variabile d'ambiente OPENAI_API_KEY
// (file .env): non e' mai scritta nel workflow ne' nella cartella del progetto.
// Il file temporaneo viene cancellato subito dopo l'importazione.
const fs = require('fs');

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY mancante: copia .env.example in .env e inserisci la chiave');
  process.exit(1);
}
const credenziale = [{
  id: 'openaiRecensioni',
  name: 'OpenAI (da .env)',
  type: 'openAiApi',
  data: {
    apiKey: process.env.OPENAI_API_KEY,
    url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  },
}];
fs.writeFileSync('/tmp/credenziale.json', JSON.stringify(credenziale), { mode: 0o600 });
