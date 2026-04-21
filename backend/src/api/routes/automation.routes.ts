/**
 * /automation/rules — automation szabályok in-memory CRUD-ja.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireParam } from '../_helpers/requireParam.js';
import { automationRules, AutomationRule } from '../_state/appState.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';

export function createAutomationRouter(): Router {
  const router = Router();

  router.get('/automation/rules', (_req: Request, res: Response) => {
    res.json({ rules: automationRules });
  });

  router.get('/automation/rules/:id', (req: Request, res: Response) => {
    const id = requireParam(req, 'id');
    const rule = automationRules.find((r) => r.id === id);
    if (!rule) throw new NotFoundError('Szabály nem található');
    res.json(rule);
  });

  router.post(
    '/automation/rules',
    asyncHandler(async (req: Request, res: Response) => {
      const { name, description, trigger, actions } = req.body;

      if (!name || !trigger || !actions) {
        throw new ValidationError('Hiányzó mezők: name, trigger, actions kötelező');
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
    })
  );

  router.put(
    '/automation/rules/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const id = requireParam(req, 'id');
      const rule = automationRules.find((r) => r.id === id);
      if (!rule) throw new NotFoundError('Szabály nem található');

      const { name, description, enabled, trigger, actions } = req.body;
      if (name !== undefined) rule.name = name;
      if (description !== undefined) rule.description = description;
      if (enabled !== undefined) rule.enabled = enabled;
      if (trigger !== undefined) rule.trigger = trigger;
      if (actions !== undefined) rule.actions = actions;

      res.json(rule);
    })
  );

  router.post(
    '/automation/rules/:id/toggle',
    asyncHandler(async (req: Request, res: Response) => {
      const id = requireParam(req, 'id');
      const rule = automationRules.find((r) => r.id === id);
      if (!rule) throw new NotFoundError('Szabály nem található');
      rule.enabled = !rule.enabled;
      res.json(rule);
    })
  );

  router.delete(
    '/automation/rules/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const id = requireParam(req, 'id');
      const ruleIndex = automationRules.findIndex((r) => r.id === id);
      if (ruleIndex === -1) throw new NotFoundError('Szabály nem található');
      automationRules.splice(ruleIndex, 1);
      res.json({ success: true });
    })
  );

  return router;
}
