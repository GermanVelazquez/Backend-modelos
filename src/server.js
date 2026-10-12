'use strict';

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { loadConfig } = require('./config/env');
const createApp = require('./app');
const PostgresStore = require('./repositories/PostgresStore');
const InMemoryStore = require('./repositories/InMemoryStore');
const AIServiceAdapter = require('./engines/AIServiceAdapter');
const StockfishAdapter = require('./engines/StockfishAdapter');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1); // Fail-Fast
  }

  let store;
  if (config.store === 'memory') {
    console.warn('STORE=memory: las partidas se pierden al reiniciar. Usar solo para desarrollo.');
    store = new InMemoryStore();
  } else {
    const pool = new Pool({ connectionString: config.databaseUrl });
    store = new PostgresStore(pool);
    try {
      await store.ping();
      console.log('Conexión a la base de datos establecida.');
    } catch (err) {
      console.error('No se pudo conectar a la base de datos:', err.message);
      process.exit(1);
    }
  }

  const stockfishAdapter = new StockfishAdapter({ binaryPath: config.stockfishPath, timeoutMs: config.stockfishTimeoutMs });
  const app = createApp({
    store,
    frontendUrl: config.frontendUrl,
    aiServiceAdapter: new AIServiceAdapter({ baseUrl: config.aiServiceUrl, timeoutMs: config.aiTimeoutMs }),
    stockfishAdapter,
  });

  const server = app.listen(config.port, () => {
    console.log(`Servidor corriendo en http://localhost:${config.port}`);
    console.log(` Entorno: ${config.nodeEnv}`);
    console.log(` Stockfish: ${stockfishAdapter.binaryPath || '(STOCKFISH_PATH sin configurar)'}`);
  });

  // Al apagar, cerrar el proceso de Stockfish para no dejarlo colgado (en Windows no se cierra solo).
  const apagar = async () => {
    server.close();
    await stockfishAdapter.dispose().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', apagar);
  process.once('SIGTERM', apagar);
}

main();
