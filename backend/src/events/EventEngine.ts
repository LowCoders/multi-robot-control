/**
 * Event Engine - Automatizálási szabályok feldolgozása
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

// =========================================
// TYPES
// =========================================

export interface Trigger {
  type: 'job_complete' | 'state_change' | 'position' | 'timer' | 'manual' | 'gcode_comment';
  device?: string;
  event?: string;
  to_state?: string;
  from_state?: string;
  axis?: string;
  condition?: string;
  value?: number;
  pattern?: string;
  interval?: number;
}

export interface Condition {
  device: string;
  state?: string;
  position?: {
    axis: string;
    operator: string;
    value: number;
  };
}

export interface Action {
  type: 'run' | 'pause' | 'resume' | 'stop' | 'load_file' | 'send_gcode' | 'notify' | 'wait' | 'set_flag' | 'check_sync';
  device?: string;
  file?: string;
  gcode?: string;
  channel?: string;
  message?: string;
  severity?: string;
  flag?: string;
  value?: unknown;
  sync_id?: string;
  devices?: string[];
  on_all_ready?: Action[];
  on_complete?: Action[];
  delay?: number; // Wait delay in milliseconds (for 'wait' action)
}

export interface Rule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: Trigger;
  conditions?: Condition[];
  actions: Action[];
}

export interface EventContext {
  trigger: {
    device?: string;
    type: string;
    match?: string[];
    error?: string;
  };
  context: Record<string, unknown>;
}

// =========================================
// EVENT ENGINE
// =========================================

export class EventEngine {
  private rules: Rule[] = [];
  private deviceManager: DeviceManager;
  private stateManager: StateManager;
  private flags: Map<string, unknown> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(deviceManager: DeviceManager, stateManager: StateManager) {
    this.deviceManager = deviceManager;
    this.stateManager = stateManager;
  }
  
  async loadRules(configPath?: string): Promise<void> {
    const path = configPath || join(process.cwd(), '..', 'config', 'automation_rules.yaml');
    
    if (!existsSync(path)) {
      console.log('Automatizálási szabályok nem találhatók:', path);
      return;
    }
    
    try {
      const content = readFileSync(path, 'utf-8');
      const config = parse(content) as { rules: Rule[] };
      
      this.rules = config.rules || [];
      console.log(`${this.rules.length} automatizálási szabály betöltve`);
      
      // Timer triggerek indítása
      this.setupTimerTriggers();
      
    } catch (error) {
      console.error('Szabályok betöltési hiba:', error);
    }
  }
  
  getRules(): Rule[] {
    return this.rules;
  }
  
  getRule(ruleId: string): Rule | undefined {
    return this.rules.find(r => r.id === ruleId);
  }
  
  enableRule(ruleId: string): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = true;
      // Start timer if this is a timer rule
      this.updateTimerForRule(rule);
      return true;
    }
    return false;
  }
  
  disableRule(ruleId: string): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = false;
      // Stop timer if this is a timer rule
      this.stopTimerForRule(ruleId);
      return true;
    }
    return false;
  }
  
  private updateTimerForRule(rule: Rule): void {
    // Stop existing timer first
    this.stopTimerForRule(rule.id);
    
    // Start new timer if rule is enabled and is a timer trigger
    if (rule.enabled && rule.trigger.type === 'timer' && rule.trigger.interval) {
      const timer = setInterval(() => {
        this.processEvent('timer', '', { ruleId: rule.id });
      }, rule.trigger.interval * 1000);
      
      this.timers.set(rule.id, timer);
    }
  }
  
  private stopTimerForRule(ruleId: string): void {
    const existingTimer = this.timers.get(ruleId);
    if (existingTimer) {
      clearInterval(existingTimer);
      this.timers.delete(ruleId);
    }
  }
  
  // =========================================
  // EVENT PROCESSING
  // =========================================
  
  async processEvent(
    eventType: string,
    deviceId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      
      if (this.matchesTrigger(rule.trigger, eventType, deviceId, data)) {
        const context: EventContext = {
          trigger: {
            device: deviceId,
            type: eventType,
            ...data,
          },
          context: {},
        };
        
        if (await this.evaluateConditions(rule.conditions || [], context)) {
          console.log(`Szabály aktiválva: ${rule.name}`);
          await this.executeActions(rule.actions, context);
          
          // Broadcast
          this.stateManager.broadcastAutomationTriggered(
            rule.id,
            rule.name,
            rule.actions.map(a => a.type)
          );
        }
      }
    }
  }
  
  private matchesTrigger(
    trigger: Trigger,
    eventType: string,
    deviceId: string,
    data: Record<string, unknown>
  ): boolean {
    // Esemény típus egyezés
    if (trigger.type !== eventType) return false;
    
    // Eszköz szűrés (ha meg van adva)
    if (trigger.device && trigger.device !== deviceId) return false;
    
    // Specifikus ellenőrzések
    switch (trigger.type) {
      case 'state_change':
        if (trigger.to_state && data.newState !== trigger.to_state) return false;
        if (trigger.from_state && data.oldState !== trigger.from_state) return false;
        break;
        
      case 'position':
        if (trigger.axis && trigger.condition && trigger.value !== undefined) {
          const position = data.position as Record<string, number>;
          const axisValue = position?.[trigger.axis.toLowerCase()];
          if (axisValue === undefined) return false;
          
          switch (trigger.condition) {
            case '<': if (!(axisValue < trigger.value)) return false; break;
            case '<=': if (!(axisValue <= trigger.value)) return false; break;
            case '>': if (!(axisValue > trigger.value)) return false; break;
            case '>=': if (!(axisValue >= trigger.value)) return false; break;
            case '==': if (!(axisValue === trigger.value)) return false; break;
          }
        }
        break;
        
      case 'manual':
        if (trigger.event && data.event !== trigger.event) return false;
        break;
        
      case 'gcode_comment':
        if (trigger.pattern) {
          const comment = data.comment as string;
          const regex = new RegExp(trigger.pattern);
          if (!regex.test(comment)) return false;
        }
        break;
    }
    
    return true;
  }
  
  private async evaluateConditions(
    conditions: Condition[],
    _context: EventContext
  ): Promise<boolean> {
    for (const condition of conditions) {
      // Eszköz állapot ellenőrzés
      if (condition.state) {
        const device = this.deviceManager.getDevice(condition.device);
        if (!device || device.state !== condition.state) {
          return false;
        }
      }
      
      // Pozíció ellenőrzés
      if (condition.position) {
        const status = await this.deviceManager.getDeviceStatus(condition.device);
        if (!status) return false;
        
        const axis = condition.position.axis.toLowerCase() as 'x' | 'y' | 'z';
        const value = status.position[axis];
        const target = condition.position.value;
        
        switch (condition.position.operator) {
          case '<': if (!(value < target)) return false; break;
          case '<=': if (!(value <= target)) return false; break;
          case '>': if (!(value > target)) return false; break;
          case '>=': if (!(value >= target)) return false; break;
          case '==': if (!(value === target)) return false; break;
        }
      }
    }
    
    return true;
  }
  
  // =========================================
  // ACTION EXECUTION
  // =========================================
  
  private async executeActions(
    actions: Action[],
    context: EventContext
  ): Promise<void> {
    for (const action of actions) {
      await this.executeAction(action, context);
    }
  }
  
  private async executeAction(
    action: Action,
    context: EventContext
  ): Promise<void> {
    const deviceId = this.resolveTemplate(action.device, context);
    
    switch (action.type) {
      case 'run':
        if (deviceId === 'all') {
          for (const device of this.deviceManager.getDevices()) {
            await this.deviceManager.run(device.id);
          }
        } else if (deviceId) {
          await this.deviceManager.run(deviceId);
        }
        break;
        
      case 'pause':
        if (deviceId === 'all') {
          for (const device of this.deviceManager.getDevices()) {
            await this.deviceManager.pause(device.id);
          }
        } else if (deviceId) {
          await this.deviceManager.pause(deviceId);
        }
        break;
        
      case 'resume':
        if (deviceId === 'all') {
          for (const device of this.deviceManager.getDevices()) {
            await this.deviceManager.resume(device.id);
          }
        } else if (deviceId) {
          await this.deviceManager.resume(deviceId);
        }
        break;
        
      case 'stop':
        if (deviceId === 'all') {
          for (const device of this.deviceManager.getDevices()) {
            await this.deviceManager.stop(device.id);
          }
        } else if (deviceId) {
          await this.deviceManager.stop(deviceId);
        }
        break;
        
      case 'load_file':
        if (deviceId && action.file) {
          const filepath = this.resolveTemplate(action.file, context);
          await this.deviceManager.loadFile(deviceId, filepath);
        }
        break;
        
      case 'send_gcode':
        if (deviceId && action.gcode) {
          await this.deviceManager.sendGCode(deviceId, action.gcode);
        }
        break;
        
      case 'notify':
        const message = this.resolveTemplate(action.message, context);
        this.stateManager.broadcastToAll('notification', {
          channel: action.channel || 'ui',
          message,
          severity: action.severity || 'info',
          timestamp: Date.now(),
        });
        break;
        
      case 'wait':
        // Wait implementáció (configurable delay, default 1000ms)
        const waitDelay = action.delay ?? 1000;
        await new Promise(resolve => setTimeout(resolve, waitDelay));
        break;
        
      case 'set_flag':
        if (action.flag) {
          const flagName = this.resolveTemplate(action.flag, context);
          this.flags.set(flagName, action.value);
        }
        break;
        
      case 'check_sync':
        if (action.sync_id && action.devices) {
          const allReady = await this.checkSyncPoint(action.sync_id, action.devices);
          if (allReady && action.on_all_ready) {
            await this.executeActions(action.on_all_ready, context);
          }
        }
        break;
    }
  }
  
  private resolveTemplate(
    template: string | undefined,
    context: EventContext
  ): string {
    if (!template) return '';
    
    // Egyszerű template helyettesítés: {{trigger.device}} stb.
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const parts = path.trim().split('.');
      let value: unknown = context;
      
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return '';
        }
      }
      
      return String(value || '');
    });
  }
  
  private async checkSyncPoint(
    syncId: string,
    devices: string[]
  ): Promise<boolean> {
    // Ellenőrzés, hogy minden eszköz elérte-e a sync pontot
    for (const deviceId of devices) {
      const flagName = `sync_${syncId}_${deviceId}`;
      if (!this.flags.get(flagName)) {
        return false;
      }
    }
    
    // Ha mind kész, töröljük a flag-eket
    for (const deviceId of devices) {
      const flagName = `sync_${syncId}_${deviceId}`;
      this.flags.delete(flagName);
    }
    
    return true;
  }
  
  // =========================================
  // TIMER TRIGGERS
  // =========================================
  
  private setupTimerTriggers(): void {
    // Régi timerek törlése
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    
    // Új timerek beállítása
    for (const rule of this.rules) {
      this.updateTimerForRule(rule);
    }
  }
  
  // =========================================
  // MANUAL TRIGGER
  // =========================================
  
  async triggerManualEvent(eventName: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.processEvent('manual', '', { event: eventName, ...context });
  }
  
  // =========================================
  // CLEANUP
  // =========================================
  
  cleanup(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.flags.clear();
  }
}
