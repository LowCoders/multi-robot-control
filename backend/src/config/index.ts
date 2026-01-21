/**
 * Configuration Loader
 */

import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';

export interface ServerConfig {
  backend?: {
    host?: string;
    port?: number;
  };
  bridge?: {
    host?: string;
    port?: number;
  };
  frontend?: {
    host?: string;
    port?: number;
  };
}

export interface WebSocketConfig {
  ping_interval?: number;
  ping_timeout?: number;
}

export interface RealtimeConfig {
  position_update_rate?: number;
  status_update_rate?: number;
}

export interface FilesConfig {
  gcode_directory?: string;
  max_file_size?: number;
  allowed_extensions?: string[];
}

export interface SystemConfig {
  server?: ServerConfig;
  websocket?: WebSocketConfig;
  realtime?: RealtimeConfig;
  files?: FilesConfig;
}

export interface DeviceConfigEntry {
  id: string;
  name: string;
  driver: string;
  type: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface DevicesConfig {
  devices: DeviceConfigEntry[];
}

export interface AppConfig extends SystemConfig {
  devices: DeviceConfigEntry[];
}

export async function loadConfig(): Promise<AppConfig> {
  const configDir = join(process.cwd(), '..', 'config');
  
  // System config
  let systemConfig: SystemConfig = {};
  const systemConfigPath = join(configDir, 'system.yaml');
  if (existsSync(systemConfigPath)) {
    const content = readFileSync(systemConfigPath, 'utf-8');
    systemConfig = parse(content) as SystemConfig;
  }
  
  // Devices config
  let devicesConfig: DevicesConfig = { devices: [] };
  const devicesConfigPath = join(configDir, 'devices.yaml');
  if (existsSync(devicesConfigPath)) {
    const content = readFileSync(devicesConfigPath, 'utf-8');
    devicesConfig = parse(content) as DevicesConfig;
  }
  
  return {
    ...systemConfig,
    devices: devicesConfig.devices || [],
  };
}
