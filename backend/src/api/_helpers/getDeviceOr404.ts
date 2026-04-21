/**
 * Egységes "device-lookup vagy 404" helper.
 *
 * Az új AppError-alapú error pipeline-on keresztül dolgozik: a NotFoundError
 * dobódik, a globális error middleware pedig egységes JSON választ ad
 * (`{ error, code: 'not_found' }`).
 */

import type { DeviceManager, Device } from '../../devices/DeviceManager.js';
import { NotFoundError } from '../../errors/AppError.js';

export function getDeviceOr404(deviceManager: DeviceManager, deviceId: string): Device {
  const device = deviceManager.getDevice(deviceId);
  if (!device) {
    throw new NotFoundError(`Eszköz nem található: ${deviceId}`);
  }
  return device;
}
