/**
 * Automation rules in-memory tárolója.
 *
 * Jelenleg nincs perzisztencia (yaml visszaírás): a default szabályok
 * 1:1 megegyeznek a refaktor előtti alapértékekkel.
 */

export interface AutomationRule {
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

export const automationRules: AutomationRule[] = [
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
