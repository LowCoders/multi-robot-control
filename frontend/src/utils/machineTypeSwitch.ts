import type { MachineConfig, MachineType } from '../types/machine-config'
import { getDefaultConfigForType } from '../types/machine-config'

/**
 * Visszaadja az adott `nextType`-hez tartozó alap-konfigot, megőrizve az
 * eredeti `id`-t és (ha van) `name`-t. Ezt a `MachineConfigTab` használja
 * típus-váltáskor; itt egy helyen tartjuk, mert a logika triviális, de
 * több helyről is szükség lehet rá (pl. új eszköz wizard).
 */
export function buildMachineConfigForTypeSwitch(
  current: MachineConfig,
  nextType: MachineType,
  deriveWorkEnvelope: (
    axes: MachineConfig['axes'],
    current?: MachineConfig['workEnvelope']
  ) => MachineConfig['workEnvelope']
): MachineConfig {
  const baseConfig = getDefaultConfigForType(nextType)
  return {
    ...baseConfig,
    id: current.id,
    name: current.name || baseConfig.name,
    type: nextType,
    workEnvelope: deriveWorkEnvelope(baseConfig.axes, baseConfig.workEnvelope),
  }
}

/**
 * `workEnvelope` levezetése a tengelyek aktuális min/max értékeiből.
 * Ha valamelyik tengely null-os limitű, a jelenlegi értéket / 100 mm-es
 * fallback-et használjuk. Ezt korábban a `MachineConfigTab.tsx` belső
 * függvényeként tartottuk; most külön util-ban él, hogy a
 * `buildMachineConfigForTypeSwitch` is használhassa.
 */
export function deriveWorkEnvelopeFromAxes(
  axes: MachineConfig['axes'],
  current?: MachineConfig['workEnvelope']
): MachineConfig['workEnvelope'] {
  const range = (n: string, fallback: number) => {
    const a = axes.find((x) => x.name === n)
    if (!a || a.min == null || a.max == null) return fallback
    return Math.max(1, Math.abs(a.max - a.min))
  }
  return {
    x: range('X', current?.x || 100),
    y: range('Y', current?.y || 100),
    z: range('Z', current?.z || 100),
  }
}
