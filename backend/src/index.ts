/**
 * Multi-Robot Control System - Backend Entry Point
 */

import { createServer, ServerContext } from './server.js';
import { loadConfig } from './config/index.js';

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Multi-Robot Control System - Backend');
  console.log('========================================');
  
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
      console.log(`Backend szerver fut: http://${host}:${port}`);
      console.log('');
      console.log('Endpoints:');
      console.log(`  REST API: http://${host}:${port}/api`);
      console.log(`  WebSocket: ws://${host}:${port}`);
      console.log('');
    });
    
    // Graceful shutdown handler
    const handleShutdown = (signal: string) => {
      console.log(`${signal} signal, shutting down...`);
      cleanup();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
      
      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    
  } catch (error) {
    console.error('Startup error:', error);
    process.exit(1);
  }
}

main();
