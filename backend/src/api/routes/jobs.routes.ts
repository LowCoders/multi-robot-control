/**
 * /jobs* — job queue: létrehozás, futtatás, állapot-szinkron, reorder.
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireParam } from '../_helpers/requireParam.js';
import { validateBody } from '../_helpers/validate.js';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/AppError.js';
import { createLogger } from '../../utils/logger.js';
import {
  jobQueue,
  jobRepository,
  type Job,
  type ExecutionMode,
  getExecutionMode,
  setExecutionMode,
  startNextPendingJob,
} from '../_state/appState.js';

const log = createLogger('api:jobs');

const ExecutionModeSchema = z.enum(['sequential', 'parallel', 'manual']);

const SetModeSchema = z.object({
  mode: ExecutionModeSchema,
});

const CreateJobSchema = z.object({
  name: z.string().min(1),
  deviceId: z.string().min(1),
  filepath: z.string().min(1),
  estimatedTime: z.number().optional(),
});

const ReorderSchema = z.object({
  order: z.array(z.string()),
});

function findJobOr404(jobId: string): Job {
  const job = jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job nem található');
  return job;
}

/**
 * Egy `pending` job indítása: betölti a fájlt, majd futtat. Ha bármelyik lépés
 * sikertelen, a job-ot `failed`-re állítja és `false`-szal tér vissza, nem dob
 * (a hívó dönti el, hogy 500-zal vagy 200-as hibával válaszol).
 */
async function tryStartJob(deviceManager: DeviceManager, job: Job): Promise<boolean> {
  try {
    const loadOk = await deviceManager.loadFile(job.deviceId, job.filepath);
    if (!loadOk) {
      job.status = 'failed';
      return false;
    }
    const runOk = await deviceManager.run(job.deviceId);
    if (!runOk) {
      job.status = 'failed';
      return false;
    }
    job.status = 'running';
    return true;
  } catch (error) {
    job.status = 'failed';
    log.error(`Job indítási hiba (${job.id}):`, error);
    return false;
  }
}

/**
 * `running` job státuszának szinkronizálása a driver tényleges állapotával.
 * @returns true, ha a job most fejeződött be (akár completed, akár failed).
 */
async function syncRunningJob(deviceManager: DeviceManager, job: Job): Promise<boolean> {
  try {
    const status = await deviceManager.getDeviceStatus(job.deviceId);
    if (!status) return false;

    job.progress = status.progress || 0;

    if (status.state === 'idle' && job.progress >= 100) {
      job.status = 'completed';
      job.progress = 100;
      return true;
    }
    if (status.state === 'alarm' || status.state === 'error') {
      job.status = 'failed';
      return true;
    }
    if (status.state === 'idle' && job.progress < 100) {
      job.status = 'pending';
      job.progress = 0;
    }
    return false;
  } catch (error) {
    log.error(`Failed to sync job ${job.id} status:`, error);
    return false;
  }
}

export function createJobsRouter(deviceManager: DeviceManager): Router {
  const router = Router();

  router.get('/jobs/mode', (_req: Request, res: Response) => {
    res.json({ mode: getExecutionMode() });
  });

  router.post(
    '/jobs/mode',
    validateBody(SetModeSchema),
    (req: Request, res: Response) => {
      const { mode } = req.body as { mode: ExecutionMode };
      setExecutionMode(mode);
      res.json({ mode: getExecutionMode() });
    }
  );

  router.get(
    '/jobs',
    asyncHandler(async (_req: Request, res: Response) => {
      let jobJustCompleted = false;

      for (const job of jobQueue) {
        if (job.status !== 'running') continue;
        if (await syncRunningJob(deviceManager, job)) {
          jobJustCompleted = true;
        }
      }

      if (getExecutionMode() === 'sequential' && jobJustCompleted) {
        const hasRunning = jobQueue.some((j) => j.status === 'running');
        const hasPending = jobQueue.some((j) => j.status === 'pending');
        if (!hasRunning && hasPending) {
          await startNextPendingJob(deviceManager);
        }
      }

      res.json({ jobs: jobQueue, executionMode: getExecutionMode() });
    })
  );

  router.post(
    '/jobs',
    validateBody(CreateJobSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, deviceId, filepath, estimatedTime } = req.body as z.infer<
        typeof CreateJobSchema
      >;

      const newJob: Job = {
        id: Date.now().toString(),
        name,
        deviceId,
        filepath,
        status: 'pending',
        progress: 0,
        createdAt: Date.now(),
        ...(estimatedTime !== undefined ? { estimatedTime } : {}),
      };

      jobRepository.push(newJob);
      res.status(201).json(newJob);
    })
  );

  router.get('/jobs/:id', (req: Request, res: Response) => {
    const job = findJobOr404(requireParam(req, 'id'));
    res.json(job);
  });

  router.post(
    '/jobs/:id/run',
    asyncHandler(async (req: Request, res: Response) => {
      const job = findJobOr404(requireParam(req, 'id'));

      if (job.status === 'running') {
        throw new ConflictError('Job már fut');
      }
      if (job.status === 'completed' || job.status === 'failed') {
        job.progress = 0;
      }

      const ok = await tryStartJob(deviceManager, job);
      if (!ok) {
        res.status(500).json({ error: 'Job indítás sikertelen', code: 'job_start_failed' });
        return;
      }
      res.json({ success: true, job });
    })
  );

  router.post(
    '/jobs/:id/pause',
    asyncHandler(async (req: Request, res: Response) => {
      const job = findJobOr404(requireParam(req, 'id'));
      if (job.status !== 'running') {
        throw new ConflictError('Job nem fut');
      }

      await deviceManager.pause(job.deviceId);
      job.status = 'pending';
      res.json({ success: true, job });
    })
  );

  router.delete(
    '/jobs/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const id = requireParam(req, 'id');
      const job = jobRepository.findById(id);
      if (!job) throw new NotFoundError('Job nem található');

      if (job.status === 'running') {
        await deviceManager.stop(job.deviceId);
      }

      jobRepository.removeById(id);
      res.json({ success: true });
    })
  );

  router.post(
    '/jobs/run-all',
    asyncHandler(async (req: Request, res: Response) => {
      const { mode } = req.body;
      if (mode !== undefined) {
        const parsed = ExecutionModeSchema.safeParse(mode);
        if (!parsed.success) {
          throw new ValidationError('Érvénytelen execution mode', parsed.error.issues);
        }
        setExecutionMode(parsed.data);
      }

      const pendingJobs = jobQueue.filter((j) => j.status === 'pending');
      if (pendingJobs.length === 0) {
        throw new ValidationError('Nincs várakozó job');
      }

      const startedJobs: Job[] = [];
      const jobsToStart = getExecutionMode() === 'parallel' ? pendingJobs : pendingJobs.slice(0, 1);

      for (const job of jobsToStart) {
        if (await tryStartJob(deviceManager, job)) {
          startedJobs.push(job);
        }
      }

      res.json({ success: true, startedJobs, mode: getExecutionMode() });
    })
  );

  router.post(
    '/jobs/:id/progress',
    asyncHandler(async (req: Request, res: Response) => {
      const job = findJobOr404(requireParam(req, 'id'));
      const { progress, status } = req.body;

      if (typeof progress === 'number') job.progress = progress;
      if (status && ['pending', 'running', 'completed', 'failed'].includes(status)) {
        job.status = status;
      }

      res.json({ success: true, job });
    })
  );

  router.post(
    '/jobs/reorder',
    validateBody(ReorderSchema),
    (req: Request, res: Response) => {
      const { order } = req.body as z.infer<typeof ReorderSchema>;
      jobRepository.reorderByIds(order);
      res.json({ success: true, jobs: jobQueue });
    }
  );

  router.get(
    '/jobs/:id/gcode',
    asyncHandler(async (req: Request, res: Response) => {
      const job = findJobOr404(requireParam(req, 'id'));

      try {
        const content = await fs.readFile(job.filepath, 'utf-8');
        const lines = content.split('\n');

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
        log.error(`Failed to read G-code file for job ${job.id}:`, error);
        res.status(500).json({ error: 'Fájl olvasási hiba' });
      }
    })
  );

  return router;
}
