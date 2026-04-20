/**
 * REST API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { parseDocument, isMap, isSeq } from 'yaml';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

// Machine config directory
const MACHINE_CONFIG_DIR = path.join(process.cwd(), '..', 'config', 'machines');

// devices.yaml elérési út – a config könyvtárban a backend cwd-jéhez képest
const DEVICES_YAML_PATH = path.join(process.cwd(), '..', 'config', 'devices.yaml');

// Ensure machine config directory exists
if (!existsSync(MACHINE_CONFIG_DIR)) {
  mkdirSync(MACHINE_CONFIG_DIR, { recursive: true });
}

// Default machine config generator
function getDefaultMachineConfig(deviceType: string, id: string, name: string) {
  const is5Axis = deviceType === '5axis' || deviceType.includes('5');
  
  return {
    id,
    name,
    type: is5Axis ? '5axis' : 'cnc_mill',
    workEnvelope: { x: 300, y: is5Axis ? 300 : 400, z: is5Axis ? 200 : 80 },
    axes: is5Axis ? [
      { name: 'X', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#ef4444' },
      { name: 'Y', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#22c55e', parent: 'X' },
      { name: 'Z', type: 'linear', min: -200, max: 0, homePosition: 0, color: '#3b82f6', parent: 'Y' },
      { name: 'A', type: 'rotary', min: -90, max: 90, homePosition: 0, color: '#f59e0b', parent: 'Z' },
      { name: 'B', type: 'rotary', min: -180, max: 180, homePosition: 0, color: '#8b5cf6', parent: 'A' },
    ] : [
      { name: 'X', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#ef4444' },
      { name: 'Y', type: 'linear', min: 0, max: 400, homePosition: 0, color: '#22c55e', parent: 'X' },
      { name: 'Z', type: 'linear', min: -80, max: 0, homePosition: 0, color: '#3b82f6', parent: 'Y' },
    ],
    spindle: {
      maxRpm: is5Axis ? 20000 : 24000,
      diameter: is5Axis ? 65 : 52,
      length: is5Axis ? 100 : 80,
    },
    tool: {
      diameter: 6,
      length: is5Axis ? 40 : 30,
      type: 'endmill',
    },
    base: {
      width: is5Axis ? 450 : 400,
      height: is5Axis ? 80 : 50,
      depth: is5Axis ? 450 : 500,
    },
    visuals: {
      showGrid: true,
      showAxesHelper: true,
    },
  };
}

// =========================================
// VALIDATION HELPERS
// =========================================

const VALID_AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'];

function validateAxis(axis: unknown): axis is string {
  return typeof axis === 'string' && VALID_AXES.includes(axis.toUpperCase());
}

function validateNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

function validatePercent(value: unknown): value is number {
  return validateNumber(value) && value >= 0 && value <= 200;
}

function validateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateAxesArray(axes: unknown): axes is string[] {
  if (!Array.isArray(axes)) return false;
  return axes.every((axis) => validateAxis(axis));
}

// Async error wrapper
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// In-memory settings storage (in production, use a database or config file)
let appSettings = {
  bridgeHost: 'localhost',
  bridgePort: 4002,
  gcodeDirectory: '/home/user/nc_files',
  positionUpdateRate: 10,
  statusUpdateRate: 5,
};

// In-memory automation rules storage
interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: {
    type: string;
    device?: string;
    condition?: Record<string, unknown>;
  };
  actions: {
    type: string;
    device?: string;
    params?: Record<string, unknown>;
  }[];
}

let automationRules: AutomationRule[] = [
  {
    id: '1',
    name: 'CNC után Lézer',
    description: 'A CNC job befejezése után automatikusan indítja a lézert',
    enabled: true,
    trigger: { type: 'job_complete', device: 'cnc_main' },
    actions: [{ type: 'run', device: 'laser_1' }],
  },
  {
    id: '2',
    name: 'Hiba - Mindent Leállít',
    description: 'Bármely eszköz ALARM állapotánál minden eszközt leállít',
    enabled: true,
    trigger: { type: 'state_change', condition: { to_state: 'alarm' } },
    actions: [{ type: 'stop', device: 'all' }],
  },
  {
    id: '3',
    name: 'Pozíció Trigger',
    description: 'CNC Z pozíció alapján lézer bekapcsolás',
    enabled: false,
    trigger: { type: 'position', device: 'cnc_main', condition: { axis: 'Z', below: 0 } },
    actions: [{ type: 'send_gcode', device: 'laser_1', params: { gcode: 'M3 S1000' } }],
  },
];

// In-memory job queue storage
interface Job {
  id: string;
  name: string;
  deviceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  estimatedTime?: number;
  filepath: string;
  createdAt: number;
}

let jobQueue: Job[] = [];

// Global execution mode
let executionMode: 'sequential' | 'parallel' | 'manual' = 'sequential';

// Helper function to start the next pending job (for sequential mode)
async function startNextPendingJob(deviceManager: DeviceManager): Promise<boolean> {
  const pendingJobs = jobQueue.filter(j => j.status === 'pending');
  if (pendingJobs.length === 0) return false;
  
  const nextJob = pendingJobs[0];
  try {
    const loadSuccess = await deviceManager.loadFile(nextJob.deviceId, nextJob.filepath);
    if (loadSuccess) {
      const runSuccess = await deviceManager.run(nextJob.deviceId);
      if (runSuccess) {
        nextJob.status = 'running';
        return true;
      }
    }
  } catch (error) {
    console.error('Error starting next job:', error);
  }
  return false;
}

export function createApiRoutes(
  deviceManager: DeviceManager,
  stateManager: StateManager
): Router {
  const router = Router();
  
  // =========================================
  // SETTINGS
  // =========================================
  
  // Get settings
  router.get('/settings', (_req: Request, res: Response) => {
    res.json(appSettings);
  });
  
  // Save settings
  router.post('/settings', asyncHandler(async (req: Request, res: Response) => {
    const { bridgeHost, bridgePort, gcodeDirectory, positionUpdateRate, statusUpdateRate } = req.body;
    
    // Validate settings
    if (bridgeHost && typeof bridgeHost === 'string') {
      appSettings.bridgeHost = bridgeHost;
    }
    if (bridgePort && typeof bridgePort === 'number' && bridgePort > 0 && bridgePort < 65536) {
      appSettings.bridgePort = bridgePort;
    }
    if (gcodeDirectory && typeof gcodeDirectory === 'string') {
      appSettings.gcodeDirectory = gcodeDirectory;
    }
    if (positionUpdateRate && typeof positionUpdateRate === 'number' && positionUpdateRate >= 1 && positionUpdateRate <= 50) {
      appSettings.positionUpdateRate = positionUpdateRate;
    }
    if (statusUpdateRate && typeof statusUpdateRate === 'number' && statusUpdateRate >= 1 && statusUpdateRate <= 20) {
      appSettings.statusUpdateRate = statusUpdateRate;
    }
    
    res.json({ success: true, settings: appSettings });
  }));

  // =========================================
  // DEVICES.YAML CONFIG (raw nézet + enable/disable persist)
  // =========================================

  // A devices.yaml jelenlegi tartalmát adja vissza (raw szöveg + parsolt lista),
  // hogy a Settings oldal és az Add Device modal egyaránt tudja használni.
  router.get('/config/devices-yaml', asyncHandler(async (_req: Request, res: Response) => {
    if (!existsSync(DEVICES_YAML_PATH)) {
      res.status(404).json({ error: 'devices.yaml nem található', path: DEVICES_YAML_PATH });
      return;
    }
    const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
    let entries: Array<{
      id: string;
      name: string;
      type: string;
      driver: string;
      enabled: boolean;
      simulated: boolean;
    }> = [];
    try {
      const doc = parseDocument(raw);
      const seq = doc.get('devices');
      if (isSeq(seq)) {
        for (const item of seq.items) {
          if (!isMap(item)) continue;
          const js = item.toJS(doc) as Record<string, unknown>;
          const id = typeof js.id === 'string' ? js.id : '';
          if (!id) continue;
          entries.push({
            id,
            name: typeof js.name === 'string' ? js.name : id,
            type: typeof js.type === 'string' ? js.type : 'unknown',
            driver: typeof js.driver === 'string' ? js.driver : 'unknown',
            enabled: js.enabled !== false,
            simulated: js.simulated === true,
          });
        }
      }
    } catch (err) {
      // YAML parse hiba esetén csak a raw-ot adjuk vissza, hogy a felhasználó láthassa
      entries = [];
      console.error('devices.yaml parse hiba:', err);
    }
    res.json({ raw, path: DEVICES_YAML_PATH, devices: entries });
  }));

  // Egy konkrét eszköz YAML bejegyzésének lekérdezése (a MachineConfigTab
  // alatti "Devices.yaml beállítások" panelhez).
  router.get('/config/devices-yaml/:id', asyncHandler(async (req: Request, res: Response) => {
    if (!existsSync(DEVICES_YAML_PATH)) {
      res.status(404).json({ error: 'devices.yaml nem található' });
      return;
    }
    const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
    const doc = parseDocument(raw);
    const seq = doc.get('devices');
    if (!isSeq(seq)) {
      res.status(500).json({ error: 'Hibás YAML struktúra' });
      return;
    }
    for (const item of seq.items) {
      if (!isMap(item)) continue;
      if (item.get('id') !== req.params.id) continue;
      const js = item.toJS(doc) as Record<string, unknown>;
      res.json(js);
      return;
    }
    res.status(404).json({ error: `Eszköz nem található a YAML-ben: ${req.params.id}` });
  }));

  // Egy konkrét eszköz YAML bejegyzésének részleges frissítése.
  // Az `enabled` mezőt ezen az endpointon szándékosan nem fogadjuk el – arra a
  // /config/devices-yaml/enable van. A `config` mező teljes cserét végez
  // (a frontend a teljes objektumot küldi vissza).
  router.patch('/config/devices-yaml/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    const patch = (req.body ?? {}) as {
      name?: unknown;
      driver?: unknown;
      type?: unknown;
      simulated?: unknown;
      config?: unknown;
    };

    if (!existsSync(DEVICES_YAML_PATH)) {
      res.status(404).json({ error: 'devices.yaml nem található' });
      return;
    }

    const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
    const doc = parseDocument(raw);
    const seq = doc.get('devices');
    if (!isSeq(seq)) {
      res.status(500).json({ error: 'Hibás YAML struktúra' });
      return;
    }

    let updated = false;
    for (const item of seq.items) {
      if (!isMap(item)) continue;
      if (item.get('id') !== id) continue;

      if (typeof patch.name === 'string' && patch.name.length > 0) {
        item.set('name', patch.name);
      }
      if (typeof patch.driver === 'string' && patch.driver.length > 0) {
        item.set('driver', patch.driver);
      }
      if (typeof patch.type === 'string' && patch.type.length > 0) {
        item.set('type', patch.type);
      }
      if (typeof patch.simulated === 'boolean') {
        item.set('simulated', patch.simulated);
      }
      if (patch.config !== undefined && patch.config !== null && typeof patch.config === 'object') {
        // Teljes config csere – yaml v2 a sima JS objektumot YAMLMap-be konvertálja.
        item.set('config', patch.config);
      }
      updated = true;
      break;
    }

    if (!updated) {
      res.status(404).json({ error: `Eszköz nem található a YAML-ben: ${id}` });
      return;
    }

    await fs.writeFile(DEVICES_YAML_PATH, doc.toString(), 'utf-8');
    res.json({ success: true, id });
  }));

  // A devices.yaml-ben az adott eszköz `enabled` flagjének átállítása.
  // Komment- és formázásmegőrző írás a yaml v2 Document API-val.
  // Engedélyezéskor a bridge-be is megpróbáljuk betölteni az eszközt.
  router.post('/config/devices-yaml/enable', asyncHandler(async (req: Request, res: Response) => {
    const { id, enabled } = req.body as { id?: string; enabled?: boolean };
    if (!id || typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'id (string) és enabled (boolean) kötelező' });
      return;
    }
    if (!existsSync(DEVICES_YAML_PATH)) {
      res.status(404).json({ error: 'devices.yaml nem található' });
      return;
    }

    const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
    const doc = parseDocument(raw);
    const seq = doc.get('devices');
    if (!isSeq(seq)) {
      res.status(500).json({ error: 'Hibás YAML struktúra: a devices kulcs nem lista' });
      return;
    }

    let foundEntry: {
      id: string;
      name: string;
      type: string;
      driver: string;
      config: Record<string, unknown>;
    } | null = null;

    for (const item of seq.items) {
      if (!isMap(item)) continue;
      if (item.get('id') !== id) continue;
      item.set('enabled', enabled);
      const js = item.toJS(doc) as Record<string, unknown>;
      foundEntry = {
        id: String(js.id ?? id),
        name: String(js.name ?? id),
        type: String(js.type ?? 'unknown'),
        driver: String(js.driver ?? 'simulated'),
        config: (js.config && typeof js.config === 'object') ? (js.config as Record<string, unknown>) : {},
      };
      break;
    }

    if (!foundEntry) {
      res.status(404).json({ error: `Eszköz nem található a YAML-ben: ${id}` });
      return;
    }

    await fs.writeFile(DEVICES_YAML_PATH, doc.toString(), 'utf-8');

    // Engedélyezéskor próbáljuk a bridge-be is bejuttatni az eszközt,
    // hogy ne kelljen újraindítani a backendet/bridge-et.
    let bridgeLoaded: boolean | null = null;
    let bridgeError: string | null = null;
    if (enabled) {
      const existing = deviceManager.getDevice(id);
      if (!existing) {
        try {
          bridgeLoaded = await deviceManager.addDevice({
            id: foundEntry.id,
            name: foundEntry.name,
            type: foundEntry.type,
            driver: foundEntry.driver,
            enabled: true,
            config: foundEntry.config,
          });
        } catch (err) {
          bridgeError = err instanceof Error ? err.message : String(err);
        }
      } else {
        bridgeLoaded = true;
      }
    }

    res.json({ success: true, id, enabled, bridgeLoaded, bridgeError });
  }));

  // =========================================
  // AUTOMATION RULES
  // =========================================
  
  // Get all rules
  router.get('/automation/rules', (_req: Request, res: Response) => {
    res.json({ rules: automationRules });
  });
  
  // Get rule by ID
  router.get('/automation/rules/:id', (req: Request, res: Response) => {
    const rule = automationRules.find(r => r.id === req.params.id);
    if (!rule) {
      res.status(404).json({ error: 'Szabály nem található' });
      return;
    }
    res.json(rule);
  });
  
  // Create new rule
  router.post('/automation/rules', asyncHandler(async (req: Request, res: Response) => {
    const { name, description, trigger, actions } = req.body;
    
    if (!name || !trigger || !actions) {
      res.status(400).json({ error: 'Hiányzó mezők: name, trigger, actions kötelező' });
      return;
    }
    
    const newRule: AutomationRule = {
      id: Date.now().toString(),
      name,
      description: description || '',
      enabled: true,
      trigger,
      actions,
    };
    
    automationRules.push(newRule);
    res.status(201).json(newRule);
  }));
  
  // Update rule
  router.put('/automation/rules/:id', asyncHandler(async (req: Request, res: Response) => {
    const ruleIndex = automationRules.findIndex(r => r.id === req.params.id);
    if (ruleIndex === -1) {
      res.status(404).json({ error: 'Szabály nem található' });
      return;
    }
    
    const { name, description, enabled, trigger, actions } = req.body;
    const rule = automationRules[ruleIndex];
    
    if (name !== undefined) rule.name = name;
    if (description !== undefined) rule.description = description;
    if (enabled !== undefined) rule.enabled = enabled;
    if (trigger !== undefined) rule.trigger = trigger;
    if (actions !== undefined) rule.actions = actions;
    
    res.json(rule);
  }));
  
  // Toggle rule enabled status
  router.post('/automation/rules/:id/toggle', asyncHandler(async (req: Request, res: Response) => {
    const rule = automationRules.find(r => r.id === req.params.id);
    if (!rule) {
      res.status(404).json({ error: 'Szabály nem található' });
      return;
    }
    
    rule.enabled = !rule.enabled;
    res.json(rule);
  }));
  
  // Delete rule
  router.delete('/automation/rules/:id', asyncHandler(async (req: Request, res: Response) => {
    const ruleIndex = automationRules.findIndex(r => r.id === req.params.id);
    if (ruleIndex === -1) {
      res.status(404).json({ error: 'Szabály nem található' });
      return;
    }
    
    automationRules.splice(ruleIndex, 1);
    res.json({ success: true });
  }));
  
  // =========================================
  // JOB QUEUE
  // =========================================
  
  // Get/Set execution mode
  router.get('/jobs/mode', (_req: Request, res: Response) => {
    res.json({ mode: executionMode });
  });
  
  router.post('/jobs/mode', (req: Request, res: Response) => {
    const { mode } = req.body;
    if (mode && ['sequential', 'parallel', 'manual'].includes(mode)) {
      executionMode = mode;
      res.json({ mode: executionMode });
    } else {
      res.status(400).json({ error: 'Invalid mode' });
    }
  });
  
  // Get all jobs (with real-time progress sync and auto-start)
  router.get('/jobs', asyncHandler(async (_req: Request, res: Response) => {
    let jobJustCompleted = false;
    
    // Sync running jobs with device status
    for (const job of jobQueue) {
      if (job.status === 'running') {
        try {
          const status = await deviceManager.getDeviceStatus(job.deviceId);
          if (status) {
            job.progress = status.progress || 0;
            
            // Update job status based on device state
            if (status.state === 'idle' && job.progress >= 100) {
              job.status = 'completed';
              job.progress = 100;
              jobJustCompleted = true;
            } else if (status.state === 'alarm' || status.state === 'error') {
              job.status = 'failed';
              jobJustCompleted = true;
            } else if (status.state === 'idle' && job.progress < 100) {
              // Device stopped before completion
              job.status = 'pending';
              job.progress = 0;
            }
          }
        } catch (error) {
          console.error(`Failed to sync job ${job.id} status:`, error);
        }
      }
    }
    
    // Auto-start next job in sequential mode
    if (executionMode === 'sequential' && jobJustCompleted) {
      const runningJobs = jobQueue.filter(j => j.status === 'running');
      const pendingJobs = jobQueue.filter(j => j.status === 'pending');
      
      if (runningJobs.length === 0 && pendingJobs.length > 0) {
        await startNextPendingJob(deviceManager);
      }
    }
    
    res.json({ jobs: jobQueue, executionMode });
  }));
  
  // Create new job
  router.post('/jobs', asyncHandler(async (req: Request, res: Response) => {
    const { name, deviceId, filepath, estimatedTime } = req.body;
    
    if (!name || !deviceId || !filepath) {
      res.status(400).json({ error: 'Hiányzó mezők: name, deviceId, filepath kötelező' });
      return;
    }
    
    const newJob: Job = {
      id: Date.now().toString(),
      name,
      deviceId,
      filepath,
      status: 'pending',
      progress: 0,
      estimatedTime: estimatedTime || undefined,
      createdAt: Date.now(),
    };
    
    jobQueue.push(newJob);
    res.status(201).json(newJob);
  }));
  
  // Get job by ID
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const job = jobQueue.find(j => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job nem található' });
      return;
    }
    res.json(job);
  });
  
  // Run a specific job (also supports restarting completed/failed jobs)
  router.post('/jobs/:id/run', asyncHandler(async (req: Request, res: Response) => {
    const job = jobQueue.find(j => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job nem található' });
      return;
    }
    
    if (job.status === 'running') {
      res.status(400).json({ error: 'Job már fut' });
      return;
    }
    
    // Reset progress for restart
    if (job.status === 'completed' || job.status === 'failed') {
      job.progress = 0;
    }
    
    try {
      // Load file on device
      const loadSuccess = await deviceManager.loadFile(job.deviceId, job.filepath);
      if (!loadSuccess) {
        job.status = 'failed';
        res.status(500).json({ error: 'Fájl betöltése sikertelen' });
        return;
      }
      
      // Run the program
      const runSuccess = await deviceManager.run(job.deviceId);
      if (!runSuccess) {
        job.status = 'failed';
        res.status(500).json({ error: 'Program indítása sikertelen' });
        return;
      }
      
      job.status = 'running';
      res.json({ success: true, job });
    } catch (error) {
      job.status = 'failed';
      res.status(500).json({ error: 'Job futtatási hiba' });
    }
  }));
  
  // Pause a running job
  router.post('/jobs/:id/pause', asyncHandler(async (req: Request, res: Response) => {
    const job = jobQueue.find(j => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job nem található' });
      return;
    }
    
    if (job.status !== 'running') {
      res.status(400).json({ error: 'Job nem fut' });
      return;
    }
    
    await deviceManager.pause(job.deviceId);
    job.status = 'pending';
    res.json({ success: true, job });
  }));
  
  // Delete job
  router.delete('/jobs/:id', asyncHandler(async (req: Request, res: Response) => {
    const jobIndex = jobQueue.findIndex(j => j.id === req.params.id);
    if (jobIndex === -1) {
      res.status(404).json({ error: 'Job nem található' });
      return;
    }
    
    const job = jobQueue[jobIndex];
    if (job.status === 'running') {
      await deviceManager.stop(job.deviceId);
    }
    
    jobQueue.splice(jobIndex, 1);
    res.json({ success: true });
  }));
  
  // Run all pending jobs (supports parallel and sequential modes)
  router.post('/jobs/run-all', asyncHandler(async (req: Request, res: Response) => {
    const { mode } = req.body;
    
    // Update execution mode if provided
    if (mode && ['sequential', 'parallel', 'manual'].includes(mode)) {
      executionMode = mode;
    }
    
    const pendingJobs = jobQueue.filter(j => j.status === 'pending');
    
    if (pendingJobs.length === 0) {
      res.status(400).json({ error: 'Nincs várakozó job' });
      return;
    }
    
    const startedJobs: Job[] = [];
    
    if (executionMode === 'parallel') {
      // Parallel mode: start all pending jobs simultaneously
      for (const job of pendingJobs) {
        try {
          const loadSuccess = await deviceManager.loadFile(job.deviceId, job.filepath);
          if (loadSuccess) {
            const runSuccess = await deviceManager.run(job.deviceId);
            if (runSuccess) {
              job.status = 'running';
              startedJobs.push(job);
            }
          }
        } catch (error) {
          console.error(`Error starting job ${job.id}:`, error);
        }
      }
    } else {
      // Sequential mode: start only the first pending job
      const firstJob = pendingJobs[0];
      try {
        const loadSuccess = await deviceManager.loadFile(firstJob.deviceId, firstJob.filepath);
        if (loadSuccess) {
          const runSuccess = await deviceManager.run(firstJob.deviceId);
          if (runSuccess) {
            firstJob.status = 'running';
            startedJobs.push(firstJob);
          }
        }
      } catch (error) {
        console.error('Error starting job:', error);
      }
    }
    
    res.json({ success: true, startedJobs, mode: executionMode });
  }));
  
  // Update job progress (called internally or via WebSocket)
  router.post('/jobs/:id/progress', asyncHandler(async (req: Request, res: Response) => {
    const job = jobQueue.find(j => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job nem található' });
      return;
    }
    
    const { progress, status } = req.body;
    
    if (typeof progress === 'number') {
      job.progress = progress;
    }
    if (status && ['pending', 'running', 'completed', 'failed'].includes(status)) {
      job.status = status;
    }
    
    res.json({ success: true, job });
  }));
  
  // Reorder jobs (drag-and-drop support)
  router.post('/jobs/reorder', (req: Request, res: Response) => {
    const { order } = req.body;
    
    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order must be an array of job IDs' });
      return;
    }
    
    // Create a map of current jobs
    const jobMap = new Map(jobQueue.map(j => [j.id, j]));
    
    // Reorder jobs based on the provided order
    const newQueue: Job[] = [];
    
    for (const id of order) {
      const job = jobMap.get(id);
      if (job) {
        newQueue.push(job);
        jobMap.delete(id);
      }
    }
    
    // Add any remaining jobs that weren't in the order array
    for (const job of jobMap.values()) {
      newQueue.push(job);
    }
    
    // Update the job queue
    jobQueue.length = 0;
    jobQueue.push(...newQueue);
    
    res.json({ success: true, jobs: jobQueue });
  });
  
  // Get G-code file content for a job
  router.get('/jobs/:id/gcode', asyncHandler(async (req: Request, res: Response) => {
    const job = jobQueue.find(j => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job nem található' });
      return;
    }
    
    try {
      // Read the G-code file
      const content = await fs.readFile(job.filepath, 'utf-8');
      const lines = content.split('\n');
      
      // Get current line from device status if job is running
      let currentLine = 0;
      if (job.status === 'running') {
        const status = await deviceManager.getDeviceStatus(job.deviceId);
        if (status) {
          currentLine = status.current_line || 0;
        }
      } else if (job.status === 'completed') {
        currentLine = lines.length;
      }
      
      res.json({
        jobId: job.id,
        filepath: job.filepath,
        lines,
        totalLines: lines.length,
        currentLine,
        status: job.status,
      });
    } catch (error) {
      console.error(`Failed to read G-code file for job ${job.id}:`, error);
      res.status(500).json({ error: 'Fájl olvasási hiba' });
    }
  }));
  
  // Read G-code file from path
  router.get('/gcode/file', asyncHandler(async (req: Request, res: Response) => {
    const filepath = req.query.path as string;
    
    if (!filepath) {
      res.status(400).json({ error: 'Fájl útvonal szükséges' });
      return;
    }
    
    // Security check - only allow certain directories
    const allowedPrefixes = [
      '/web/arduino/test_gcode',
      '/home',
      appSettings.gcodeDirectory,
    ];
    
    const isAllowed = allowedPrefixes.some(prefix => filepath.startsWith(prefix));
    if (!isAllowed) {
      res.status(403).json({ error: 'Hozzáférés megtagadva ehhez az útvonalhoz' });
      return;
    }
    
    try {
      if (!existsSync(filepath)) {
        res.status(404).json({ error: 'Fájl nem található' });
        return;
      }
      
      const content = await fs.readFile(filepath, 'utf-8');
      const lines = content.split('\n');
      
      res.json({
        filepath,
        filename: path.basename(filepath),
        lines,
        totalLines: lines.length,
      });
    } catch (error) {
      console.error(`Failed to read G-code file: ${filepath}`, error);
      res.status(500).json({ error: 'Fájl olvasási hiba' });
    }
  }));
  
  // =========================================
  // DEVICES
  // =========================================
  
  // Get all devices
  router.get('/devices', (_req: Request, res: Response) => {
    const devices = deviceManager.getDevices();
    res.json({ devices });
  });
  
  // Get device by ID
  router.get('/devices/:id', (req: Request, res: Response) => {
    const device = deviceManager.getDevice(req.params.id);
    if (!device) {
      res.status(404).json({ error: 'Eszköz nem található' });
      return;
    }
    res.json(device);
  });
  
  // Add new device
  router.post('/devices', asyncHandler(async (req: Request, res: Response) => {
    const { id, name, type, driver, enabled, config } = req.body;
    
    // Validate required fields
    if (!id || !name || !type || !driver) {
      res.status(400).json({ error: 'Hiányzó mezők: id, name, type, driver kötelező' });
      return;
    }
    
    // Check if device already exists
    if (deviceManager.getDevice(id)) {
      res.status(400).json({ error: 'Eszköz már létezik ezzel az ID-val' });
      return;
    }
    
    // Add device via bridge
    try {
      const success = await deviceManager.addDevice({
        id,
        name,
        type,
        driver,
        enabled: enabled !== false,
        config: config || {}
      });
      
      if (success) {
        res.status(201).json({ success: true, message: 'Eszköz sikeresen hozzáadva' });
      } else {
        res.status(500).json({ error: 'Nem sikerült hozzáadni az eszközt' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Hiba az eszköz hozzáadásakor' });
    }
  }));
  
  // Get device status
  router.get('/devices/:id/status', async (req: Request, res: Response) => {
    const status = await deviceManager.getDeviceStatus(req.params.id);
    if (!status) {
      res.status(404).json({ error: 'Eszköz nem található' });
      return;
    }
    res.json(status);
  });
  
  // Get device capabilities
  router.get('/devices/:id/capabilities', async (req: Request, res: Response) => {
    const capabilities = await deviceManager.getDeviceCapabilities(req.params.id);
    if (!capabilities) {
      res.status(404).json({ error: 'Eszköz nem található' });
      return;
    }
    res.json(capabilities);
  });

  router.get('/devices/:id/control/state', asyncHandler(async (req: Request, res: Response) => {
    const control = await deviceManager.getDeviceControlState(req.params.id);
    if (!control) {
      res.status(404).json({ error: 'Control state nem érhető el' });
      return;
    }
    res.json(control);
  }));

  router.post('/devices/:id/control/request', asyncHandler(async (req: Request, res: Response) => {
    const requestedOwnerRaw = req.body?.requested_owner;
    if (requestedOwnerRaw !== 'host' && requestedOwnerRaw !== 'panel') {
      res.status(400).json({ error: 'requested_owner csak host vagy panel lehet' });
      return;
    }
    const result = await deviceManager.requestControl(
      req.params.id,
      requestedOwnerRaw,
      req.body?.requested_by || 'api_request'
    );
    if (!result) {
      res.status(500).json({ error: 'Control request sikertelen' });
      return;
    }
    if (result.state) {
      if (result.granted) {
        stateManager.broadcastControlState(req.params.id, result.state);
      } else {
        stateManager.broadcastControlDenied(
          req.params.id,
          result.reason || 'denied',
          result.state
        );
      }
    }
    res.json(result);
  }));

  router.post('/devices/:id/control/release', asyncHandler(async (req: Request, res: Response) => {
    const result = await deviceManager.releaseControl(
      req.params.id,
      req.body?.requested_by || 'api_release'
    );
    if (!result) {
      res.status(500).json({ error: 'Control release sikertelen' });
      return;
    }
    if (result.state) {
      stateManager.broadcastControlState(req.params.id, result.state);
    }
    res.json(result);
  }));

  // Soft limits state (robot arm)
  router.get('/devices/:id/soft-limits', asyncHandler(async (req: Request, res: Response) => {
    const data = await deviceManager.getSoftLimits(req.params.id);
    if (!data) {
      res.status(404).json({ error: 'Eszköz nem található vagy soft limits nem támogatott' });
      return;
    }
    res.json(data);
  }));

  router.post('/devices/:id/soft-limits', asyncHandler(async (req: Request, res: Response) => {
    const enabledRaw = req.query.enabled;
    if (enabledRaw === undefined) {
      res.status(400).json({ error: 'Hiányzó enabled query paraméter (true/false)' });
      return;
    }

    const enabled = String(enabledRaw).toLowerCase() === 'true';
    const success = await deviceManager.setSoftLimits(req.params.id, enabled);
    if (!success) {
      res.status(500).json({ success: false, error: 'Soft limits állítás sikertelen' });
      return;
    }
    res.json({ success: true, soft_limits_enabled: enabled });
  }));

  router.get('/devices/:id/grbl-settings', asyncHandler(async (req: Request, res: Response) => {
    const settings = await deviceManager.getGrblSettings(req.params.id);
    if (!settings) {
      res.status(404).json({ error: 'Eszköz nem található vagy GRBL settings nem elérhető' });
      return;
    }
    res.json({ settings });
  }));

  router.post('/devices/:id/grbl-settings/batch', asyncHandler(async (req: Request, res: Response) => {
    const settings = req.body?.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      res.status(400).json({ error: 'Érvénytelen settings payload' });
      return;
    }

    for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
      if (!/^\d+$/.test(key) || !validateNumber(value)) {
        res.status(400).json({ error: `Érvénytelen GRBL setting: ${key}` });
        return;
      }
    }

    const success = await deviceManager.setGrblSettingsBatch(
      req.params.id,
      settings as Record<string, number>
    );
    if (!success) {
      res.status(500).json({ success: false, error: 'GRBL settings mentés sikertelen' });
      return;
    }

    res.json({ success: true });
  }));

  // =========================================
  // MACHINE CONFIGURATION
  // =========================================

  // Get machine config for a device
  // Note: Device doesn't need to be online - config is stored independently
  router.get('/devices/:id/machine-config', asyncHandler(async (req: Request, res: Response) => {
    const deviceId = req.params.id;
    const device = deviceManager.getDevice(deviceId);
    const configPath = path.join(MACHINE_CONFIG_DIR, `${deviceId}.json`);
    
    try {
      if (existsSync(configPath)) {
        const content = await fs.readFile(configPath, 'utf-8');
        res.json(JSON.parse(content));
      } else {
        // Return default config based on device type (if device exists) or generic default
        const deviceType = device?.type ?? 'cnc_mill';
        const deviceName = device?.name ?? deviceId;
        const defaultConfig = getDefaultMachineConfig(deviceType, deviceId, deviceName);
        res.json(defaultConfig);
      }
    } catch (error) {
      console.error('Error reading machine config:', error);
      res.status(500).json({ error: 'Konfiguráció olvasási hiba' });
    }
  }));

  // Save machine config for a device
  // Note: Device doesn't need to be online - config is stored independently
  router.put('/devices/:id/machine-config', asyncHandler(async (req: Request, res: Response) => {
    const deviceId = req.params.id;
    const config = req.body;
    
    // Validate required fields
    if (!config || !config.axes || !config.workEnvelope) {
      res.status(400).json({ error: 'Érvénytelen konfiguráció: axes és workEnvelope kötelező' });
      return;
    }

    const configPath = path.join(MACHINE_CONFIG_DIR, `${deviceId}.json`);
    
    try {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      res.json({ success: true, message: 'Konfiguráció mentve' });
    } catch (error) {
      console.error('Error saving machine config:', error);
      res.status(500).json({ error: 'Konfiguráció mentési hiba' });
    }
  }));

  // Reload driver config from JSON file (hot reload)
  // Call this after saving machine-config to apply changes without restart
  router.post('/devices/:id/reload-config', asyncHandler(async (req: Request, res: Response) => {
    const deviceId = req.params.id;
    
    try {
      const result = await deviceManager.reloadConfig(deviceId);
      
      // Frissített capabilities broadcast a klienseknek
      const capabilities = await deviceManager.getDeviceCapabilities(deviceId);
      if (capabilities) {
        stateManager.broadcastCapabilities(deviceId, capabilities);
      }
      
      res.json(result);
    } catch (error) {
      console.error('Config reload error:', error);
      res.status(500).json({ error: 'Konfiguráció újratöltési hiba' });
    }
  }));
  
  // Get currently loaded G-code for a device
  router.get('/devices/:id/gcode', asyncHandler(async (req: Request, res: Response) => {
    const status = await deviceManager.getDeviceStatus(req.params.id);
    if (!status) {
      res.status(404).json({ error: 'Eszköz nem található' });
      return;
    }
    
    // Check if there's a currently loaded file
    if (!status.current_file) {
      res.status(404).json({ error: 'Nincs betöltött fájl' });
      return;
    }
    
    try {
      // Read the G-code file
      const content = await fs.readFile(status.current_file, 'utf-8');
      const lines = content.split('\n');
      
      res.json({
        filepath: status.current_file,
        filename: status.current_file.split('/').pop(),
        lines,
        totalLines: lines.length,
        currentLine: status.current_line || 0,
        state: status.state,
        progress: status.progress || 0,
      });
    } catch (error) {
      console.error(`Failed to read G-code file:`, error);
      res.status(500).json({ error: 'Fájl olvasási hiba' });
    }
  }));
  
  // Connect device
  router.post('/devices/:id/connect', async (req: Request, res: Response) => {
    const success = await deviceManager.connectDevice(req.params.id);
    res.json({ success });
  });
  
  // Disconnect device
  router.post('/devices/:id/disconnect', async (req: Request, res: Response) => {
    const success = await deviceManager.disconnectDevice(req.params.id);
    res.json({ success });
  });
  
  // =========================================
  // DEVICE COMMANDS
  // =========================================
  
  // Home
  router.post('/devices/:id/home', asyncHandler(async (req: Request, res: Response) => {
    const { axes } = req.body;
    
    // Validate axes if provided
    if (axes !== undefined && !validateAxesArray(axes)) {
      res.status(400).json({ error: 'Érvénytelen tengelyek. Használj: X, Y, Z, A, B, C' });
      return;
    }
    
    const success = await deviceManager.home(req.params.id, axes);
    res.json({ success });
  }));
  
  // Jog
  router.post('/devices/:id/jog', asyncHandler(async (req: Request, res: Response) => {
    const { axis, distance, feed_rate } = req.body;
    
    // Validate axis
    if (!validateAxis(axis)) {
      res.status(400).json({ error: 'Érvénytelen tengely. Használj: X, Y, Z, A, B, C' });
      return;
    }
    
    // Validate distance
    if (!validateNumber(distance)) {
      res.status(400).json({ error: 'Érvénytelen távolság érték' });
      return;
    }
    
    // Validate feed rate
    if (!validateNumber(feed_rate) || feed_rate <= 0) {
      res.status(400).json({ error: 'Érvénytelen feed rate (pozitív szám kell)' });
      return;
    }
    
    const success = await deviceManager.jog(req.params.id, axis, distance, feed_rate);
    res.json({ success });
  }));
  
  // Jog stop
  router.post('/devices/:id/jog/stop', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.jogStop(req.params.id);
    res.json({ success });
  }));
  
  // Send G-code
  router.post('/devices/:id/gcode', asyncHandler(async (req: Request, res: Response) => {
    const { gcode } = req.body;
    
    // Validate G-code
    if (!validateString(gcode)) {
      res.status(400).json({ error: 'Érvénytelen G-code (nem lehet üres)' });
      return;
    }
    
    const response = await deviceManager.sendGCode(req.params.id, gcode);
    res.json({ response });
  }));
  
  // Load file
  router.post('/devices/:id/load', asyncHandler(async (req: Request, res: Response) => {
    const { filepath } = req.body;
    
    // Validate filepath
    if (!validateString(filepath)) {
      res.status(400).json({ error: 'Érvénytelen fájl útvonal' });
      return;
    }
    
    const success = await deviceManager.loadFile(req.params.id, filepath);
    res.json({ success });
  }));
  
  // Run
  router.post('/devices/:id/run', asyncHandler(async (req: Request, res: Response) => {
    const fromLineRaw = req.query.from_line as string;
    const fromLine = fromLineRaw ? parseInt(fromLineRaw, 10) : 0;
    
    // Validate from_line
    if (fromLineRaw && (isNaN(fromLine) || fromLine < 0)) {
      res.status(400).json({ error: 'Érvénytelen from_line (nem-negatív egész szám kell)' });
      return;
    }
    
    const success = await deviceManager.run(req.params.id, fromLine);
    res.json({ success });
  }));
  
  // Pause
  router.post('/devices/:id/pause', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.pause(req.params.id);
    res.json({ success });
  }));
  
  // Resume
  router.post('/devices/:id/resume', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.resume(req.params.id);
    res.json({ success });
  }));
  
  // Stop
  router.post('/devices/:id/stop', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.stop(req.params.id);
    res.json({ success });
  }));
  
  // Reset
  router.post('/devices/:id/reset', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.reset(req.params.id);
    res.json({ success });
  }));
  
  // Feed override
  router.post('/devices/:id/feed-override', asyncHandler(async (req: Request, res: Response) => {
    const { percent } = req.body;
    
    // Validate percent
    if (!validatePercent(percent)) {
      res.status(400).json({ error: 'Érvénytelen százalék (0-200 közötti szám kell)' });
      return;
    }
    
    const success = await deviceManager.setFeedOverride(req.params.id, percent);
    res.json({ success });
  }));
  
  // Spindle override
  router.post('/devices/:id/spindle-override', asyncHandler(async (req: Request, res: Response) => {
    const { percent } = req.body;
    
    // Validate percent
    if (!validatePercent(percent)) {
      res.status(400).json({ error: 'Érvénytelen százalék (0-200 közötti szám kell)' });
      return;
    }
    
    const success = await deviceManager.setSpindleOverride(req.params.id, percent);
    res.json({ success });
  }));
  
  // =========================================
  // ROBOT ARM SPECIFIKUS VÉGPONTOK
  // =========================================

  // Gripper
  router.post('/devices/:id/gripper/on', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.gripperOn(req.params.id);
    res.json({ success });
  }));

  router.post('/devices/:id/gripper/off', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.gripperOff(req.params.id);
    res.json({ success });
  }));

  // Sucker
  router.post('/devices/:id/sucker/on', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.suckerOn(req.params.id);
    res.json({ success });
  }));

  router.post('/devices/:id/sucker/off', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.suckerOff(req.params.id);
    res.json({ success });
  }));

  // Robot enable/disable
  router.post('/devices/:id/enable', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.robotEnable(req.params.id);
    res.json({ success });
  }));

  router.post('/devices/:id/disable', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.robotDisable(req.params.id);
    res.json({ success });
  }));

  // Calibration
  router.post('/devices/:id/calibrate', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.robotCalibrate(req.params.id);
    res.json({ success });
  }));

  // Automatic limits calibration (closed loop)
  router.post('/devices/:id/calibrate-limits', asyncHandler(async (req: Request, res: Response) => {
    const options = req.body || {};
    const result = await deviceManager.calibrateLimits(req.params.id, options);
    res.json(result);
  }));

  router.get('/devices/:id/calibration-status', asyncHandler(async (req: Request, res: Response) => {
    const status = await deviceManager.getCalibrationStatus(req.params.id);
    res.json(status);
  }));

  router.post('/devices/:id/calibration-stop', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.stopCalibration(req.params.id);
    res.json({ success });
  }));

  router.post('/devices/:id/save-calibration', asyncHandler(async (req: Request, res: Response) => {
    const result = await deviceManager.saveCalibration(req.params.id, req.body);
    res.json(result);
  }));

  // Teaching
  router.post('/devices/:id/teach/record', asyncHandler(async (req: Request, res: Response) => {
    const result = await deviceManager.teachRecord(req.params.id);
    res.json(result || { success: false });
  }));

  router.post('/devices/:id/teach/play', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.teachPlay(req.params.id);
    res.json({ success });
  }));

  router.post('/devices/:id/teach/clear', asyncHandler(async (req: Request, res: Response) => {
    const success = await deviceManager.teachClear(req.params.id);
    res.json({ success });
  }));

  router.get('/devices/:id/teach/positions', asyncHandler(async (req: Request, res: Response) => {
    const positions = await deviceManager.teachGetPositions(req.params.id);
    res.json({ positions });
  }));

  // =========================================
  // BOARD DIAGNOSZTIKA
  // =========================================

  router.post('/devices/:id/diagnostics', asyncHandler(async (req: Request, res: Response) => {
    const moveTest = req.body?.move_test === true;
    const result = await deviceManager.runDiagnostics(req.params.id, moveTest);
    res.json(result);
  }));

  // =========================================
  // MOTOR HANGOLÁS TESZTEK
  // =========================================

  // Firmware paraméter felderítés
  router.post('/devices/:id/firmware-probe', asyncHandler(async (req: Request, res: Response) => {
    const result = await deviceManager.runFirmwareProbe(req.params.id);
    res.json(result);
  }));

  // Végállás teszt
  router.post('/devices/:id/endstop-test', asyncHandler(async (req: Request, res: Response) => {
    const stepSize = typeof req.body?.step_size === 'number' ? req.body.step_size : 5.0;
    const speed = typeof req.body?.speed === 'number' ? req.body.speed : 15;
    const maxAngle = typeof req.body?.max_angle === 'number' ? req.body.max_angle : 200.0;
    const result = await deviceManager.runEndstopTest(req.params.id, stepSize, speed, maxAngle);
    res.json(result);
  }));

  // Mozgásminőség teszt
  router.post('/devices/:id/motion-test', asyncHandler(async (req: Request, res: Response) => {
    const testAngle = typeof req.body?.test_angle === 'number' ? req.body.test_angle : 30.0;
    const result = await deviceManager.runMotionTest(req.params.id, testAngle);
    res.json(result);
  }));

  // Teszt progress (polling)
  router.get('/devices/:id/test-progress', asyncHandler(async (req: Request, res: Response) => {
    const after = parseInt(req.query.after as string) || 0;
    const result = await deviceManager.getTestProgress(req.params.id, after);
    res.json(result);
  }));

  // Teszt leállítása
  router.post('/devices/:id/cancel-test', asyncHandler(async (req: Request, res: Response) => {
    const result = await deviceManager.cancelTest(req.params.id);
    res.json(result);
  }));

  // =========================================
  // STATS
  // =========================================
  
  router.get('/stats', (_req: Request, res: Response) => {
    res.json({
      connectedClients: stateManager.getClientCount(),
      devices: deviceManager.getDevices().length,
    });
  });
  
  return router;
}
