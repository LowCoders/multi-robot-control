/**
 * Multi-Robot Control System - Backend Entry Point
 */

// .env betöltése MIELŐTT bármely más modul használná a process.env-et.
// A workspace gyökérben (../.env) és a backend könyvtárban (./.env) is
// keresünk, hogy mindkét deploy-elrendezés működjön.
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const envCandidates = [resolve(process.cwd(), '..', '.env'), resolve(process.cwd(), '.env')];
for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    dotenvConfig({ path: candidate });
  }
}

import { createServer, ServerContext } from './server.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('startup');

async function main(): Promise<void> {
  log.info('========================================');
  log.info('Multi-Robot Control System - Backend');
  log.info('========================================');
  
  let serverContext: ServerContext | null = null;
  
  try {
    // Konfiguráció betöltése
    const config = await loadConfig();
    
    // Szerver indítása
    serverContext = await createServer(config);
    const { server, cleanup } = serverContext;
    
    const port = config.server?.backend?.port || 4001;
    const host = config.server?.backend?.host || '0.0.0.0';
    
    server.listen(port, host, () => {
      log.info(`Backend szerver fut: http://${host}:${port}`);
      log.info('Endpoints:');
      log.info(`  REST API: http://${host}:${port}/api`);
      log.info(`  WebSocket: ws://${host}:${port}`);
    });
    
    // Graceful shutdown handler
    const handleShutdown = (signal: string) => {
      log.info(`${signal} signal, shutting down...`);
      cleanup();
      server.close(() => {
        log.info('Server closed');
        process.exit(0);
      });
      
      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        log.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    
  } catch (error) {
    log.error('Startup error:', error);
    process.exit(1);
  }
}

main();
