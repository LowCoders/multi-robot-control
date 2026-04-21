/**
 * Express + Socket.IO Server
 *
 * Middleware sorrend (best practice):
 *   helmet → cors → json → routes → notFoundHandler → errorMiddleware
 *
 * Helmet konfig:
 *   - contentSecurityPolicy: false   — a backend csak JSON-t szolgál ki, nincs HTML.
 *   - crossOriginResourcePolicy: 'cross-origin' — Vite dev (4000/5173) → /api elérés.
 */

import express, { Express, Request, Response } from 'express';
import { createServer as createHttpServer, Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

import { AppConfig } from './config/index.js';
import {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  WS_PING_INTERVAL_MS,
  WS_PING_TIMEOUT_MS,
} from './config/constants.js';
import { DeviceManager } from './devices/DeviceManager.js';
import { StateManager } from './state/StateManager.js';
import { createApiRoutes } from './api/routes.js';
import { setupWebSocket } from './websocket/server.js';
import { errorMiddleware } from './api/_helpers/errorMiddleware.js';
import { sendError } from './api/_helpers/sendError.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

export interface ServerContext {
  server: Server;
  cleanup: () => void;
}

export async function createServer(config: AppConfig): Promise<ServerContext> {
  const app: Express = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // CORS originek a system.yaml `security.cors_origins`-ből; üres → '*' (dev).
  const configuredOrigins = config.security?.cors_origins;
  const corsOrigin: string | string[] =
    Array.isArray(configuredOrigins) && configuredOrigins.length > 0
      ? configuredOrigins
      : '*';
  app.use(
    cors({
      origin: corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );
  app.use(express.json());

  const httpServer = createHttpServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
    pingInterval: config.websocket?.ping_interval || WS_PING_INTERVAL_MS,
    pingTimeout: config.websocket?.ping_timeout || WS_PING_TIMEOUT_MS,
  });

  const stateManager = new StateManager(io);

  const bridgeHost = config.server?.bridge?.host || DEFAULT_BRIDGE_HOST;
  const bridgePort = config.server?.bridge?.port || DEFAULT_BRIDGE_PORT;
  const bridgeUrl = `http://${bridgeHost}:${bridgePort}`;
  const deviceManager = new DeviceManager(bridgeUrl, stateManager);

  await deviceManager.initialize(config.devices);

  app.use('/api', createApiRoutes(deviceManager, stateManager, config));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Multi-Robot Control System',
      version: '1.0.0',
      endpoints: {
        api: '/api',
        health: '/health',
        websocket: 'ws://...',
      },
    });
  });

  setupWebSocket(io, deviceManager, stateManager);

  // 404 handler (a routes után, az error middleware előtt).
  app.use((_req: Request, res: Response) => {
    sendError(res, 404, 'Not found', { code: 'not_found' });
  });

  // Globális error middleware (utolsó middleware, 4 paraméter — Express így
  // ismeri fel error handlerként).
  app.use(errorMiddleware);

  const cleanup = (): void => {
    log.info('Cleaning up resources...');
    deviceManager.cleanup();
    stateManager.cleanup();
    io.close();
  };

  return { server: httpServer, cleanup };
}
