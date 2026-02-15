/**
 * Express + Socket.IO Server
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer as createHttpServer, Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';

import { AppConfig } from './config/index.js';
import { DeviceManager } from './devices/DeviceManager.js';
import { StateManager } from './state/StateManager.js';
import { createApiRoutes } from './api/routes.js';
import { setupWebSocket } from './websocket/server.js';

export interface ServerContext {
  server: Server;
  cleanup: () => void;
}

export async function createServer(config: AppConfig): Promise<ServerContext> {
  // Express app
  const app: Express = express();
  
  // Middleware
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json());
  
  // HTTP server
  const httpServer = createHttpServer(app);
  
  // Socket.IO
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: config.websocket?.ping_interval || 25000,
    pingTimeout: config.websocket?.ping_timeout || 60000,
  });
  
  // State Manager
  const stateManager = new StateManager(io);
  
  // Device Manager
  const bridgeUrl = `http://${config.server?.bridge?.host || 'localhost'}:${config.server?.bridge?.port || 4002}`;
  const deviceManager = new DeviceManager(bridgeUrl, stateManager);
  
  // Inicializálás
  await deviceManager.initialize(config.devices);
  
  // API Routes
  app.use('/api', createApiRoutes(deviceManager, stateManager));
  
  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Root
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
  
  // WebSocket setup
  setupWebSocket(io, deviceManager, stateManager);
  
  // Error handler - forward bridge (axios) error status codes when available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err.message || err);
    const status = err?.response?.status || err?.status || 500;
    const detail = err?.response?.data?.detail || err.message || 'Internal server error';
    res.status(status).json({ error: detail });
  });
  
  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });
  
  // Cleanup function for graceful shutdown
  const cleanup = (): void => {
    console.log('Cleaning up resources...');
    deviceManager.cleanup();
    stateManager.cleanup();
    io.close();
  };
  
  return { server: httpServer, cleanup };
}
