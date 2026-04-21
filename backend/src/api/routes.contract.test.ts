/**
 * Contract test: rögzíti az összes regisztrált API route (method + path) listáját.
 *
 * Ez a "golden" snapshot a routes.ts szétbontása előtt készül; a refaktor után
 * a teljes lista bit-pontosan egyezik kell legyen, hogy a publikus API contract
 * sértetlen maradjon.
 *
 * A teszt az Express Router belső `stack`-jét olvassa: ez a routes.ts (vagy a
 * majdani moduláris struktúra) regisztrált végpontjait tartalmazza, beleértve a
 * sub-router-eket is.
 */

import { describe, it, expect } from 'vitest';
import express, { Router as ExpressRouter } from 'express';
import { createApiRoutes } from './routes.js';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

interface RouteEntry {
  method: string;
  path: string;
}

interface ExpressLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
  name?: string;
  regexp?: RegExp;
  handle?: { stack?: ExpressLayer[] };
}

function joinBasePath(base: string, sub: string): string {
  if (!base) return sub;
  if (sub === '/' || sub === '') return base;
  const a = base.endsWith('/') ? base.slice(0, -1) : base;
  const b = sub.startsWith('/') ? sub : `/${sub}`;
  return `${a}${b}`;
}

function extractMountPath(layer: ExpressLayer): string {
  if (!layer.regexp) return '';
  const src = layer.regexp.source;
  const cleaned = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function listRoutes(router: ExpressRouter, basePath = ''): RouteEntry[] {
  const out: RouteEntry[] = [];
  const stack = (router as unknown as { stack: ExpressLayer[] }).stack || [];

  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) {
          out.push({
            method: method.toUpperCase(),
            path: joinBasePath(basePath, layer.route.path),
          });
        }
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const subBase = joinBasePath(basePath, extractMountPath(layer));
      out.push(
        ...listRoutes(
          layer.handle as unknown as ExpressRouter,
          subBase
        )
      );
    }
  }

  return out;
}

function normalizeAndSort(entries: RouteEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    seen.add(`${e.method} ${e.path}`);
  }
  return [...seen].sort();
}

describe('API Routes — contract snapshot', () => {
  it('regisztrált végpontok teljes listája változatlan a refaktor során', () => {
    const mockDeviceManager = {} as unknown as DeviceManager;
    const mockStateManager = {} as unknown as StateManager;

    const router = createApiRoutes(mockDeviceManager, mockStateManager);
    const routes = normalizeAndSort(listRoutes(router));

    // Snapshot: ha új végpontot adsz hozzá vagy törölsz, frissítsd a snapshotot
    // tudatosan (vitest -u). Refaktor során ennek bit-pontosan egyeznie kell.
    expect(routes).toMatchInlineSnapshot(`
      [
        "DELETE /automation/rules/:id",
        "DELETE /jobs/:id",
        "GET /automation/rules",
        "GET /automation/rules/:id",
        "GET /config/devices-yaml",
        "GET /config/devices-yaml/:id",
        "GET /devices",
        "GET /devices/:id",
        "GET /devices/:id/calibration-status",
        "GET /devices/:id/capabilities",
        "GET /devices/:id/control/state",
        "GET /devices/:id/gcode",
        "GET /devices/:id/grbl-settings",
        "GET /devices/:id/machine-config",
        "GET /devices/:id/soft-limits",
        "GET /devices/:id/status",
        "GET /devices/:id/teach/positions",
        "GET /devices/:id/test-progress",
        "GET /gcode/file",
        "GET /gcode/list",
        "GET /jobs",
        "GET /jobs/:id",
        "GET /jobs/:id/gcode",
        "GET /jobs/mode",
        "GET /settings",
        "GET /stats",
        "PATCH /config/devices-yaml/:id",
        "POST /automation/rules",
        "POST /automation/rules/:id/toggle",
        "POST /config/devices-yaml/enable",
        "POST /devices",
        "POST /devices/:id/calibrate",
        "POST /devices/:id/calibrate-limits",
        "POST /devices/:id/calibration-stop",
        "POST /devices/:id/cancel-test",
        "POST /devices/:id/connect",
        "POST /devices/:id/control/release",
        "POST /devices/:id/control/request",
        "POST /devices/:id/diagnostics",
        "POST /devices/:id/disable",
        "POST /devices/:id/disconnect",
        "POST /devices/:id/enable",
        "POST /devices/:id/endstop-test",
        "POST /devices/:id/feed-override",
        "POST /devices/:id/firmware-probe",
        "POST /devices/:id/gcode",
        "POST /devices/:id/grbl-settings/batch",
        "POST /devices/:id/gripper/off",
        "POST /devices/:id/gripper/on",
        "POST /devices/:id/home",
        "POST /devices/:id/jog",
        "POST /devices/:id/jog/stop",
        "POST /devices/:id/load",
        "POST /devices/:id/motion-test",
        "POST /devices/:id/pause",
        "POST /devices/:id/reload-config",
        "POST /devices/:id/reset",
        "POST /devices/:id/resume",
        "POST /devices/:id/run",
        "POST /devices/:id/run-buffer",
        "POST /devices/:id/save-calibration",
        "POST /devices/:id/soft-limits",
        "POST /devices/:id/spindle-override",
        "POST /devices/:id/stop",
        "POST /devices/:id/sucker/off",
        "POST /devices/:id/sucker/on",
        "POST /devices/:id/teach/clear",
        "POST /devices/:id/teach/play",
        "POST /devices/:id/teach/record",
        "POST /gcode/delete",
        "POST /gcode/file",
        "POST /gcode/mkdir",
        "POST /gcode/rename",
        "POST /jobs",
        "POST /jobs/:id/pause",
        "POST /jobs/:id/progress",
        "POST /jobs/:id/run",
        "POST /jobs/mode",
        "POST /jobs/reorder",
        "POST /jobs/run-all",
        "POST /settings",
        "PUT /automation/rules/:id",
        "PUT /devices/:id/machine-config",
      ]
    `);
  });

  it('a route-listing helper üres routerrel sem dob hibát', () => {
    const empty: ExpressRouter = express.Router();
    expect(listRoutes(empty)).toEqual([]);
  });
});
