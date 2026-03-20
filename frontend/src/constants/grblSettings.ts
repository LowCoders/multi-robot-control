export const GRBL_SETTING_DESCRIPTIONS: Record<number, string> = {
  0: 'Step pulse time in microseconds.',
  1: 'Stepper idle delay in milliseconds (255 keeps motors always enabled).',
  2: 'Step pulse invert mask.',
  3: 'Direction invert mask.',
  4: 'Step enable invert mask.',
  5: 'Limit pins invert flag.',
  6: 'Probe pin invert flag.',
  10: 'Status report mask.',
  11: 'Junction deviation in millimeters.',
  12: 'Arc tolerance in millimeters.',
  13: 'Report inches (1) or millimeters (0).',
  20: 'Soft limits enable flag.',
  21: 'Hard limits enable flag.',
  22: 'Homing cycle enable flag.',
  23: 'Homing direction invert mask.',
  24: 'Homing feed rate.',
  25: 'Homing seek rate.',
  26: 'Homing switch debounce delay in milliseconds.',
  27: 'Homing pull-off distance.',
  30: 'Maximum spindle speed.',
  31: 'Minimum spindle speed.',
  32: 'Laser mode enable flag.',
  9: 'Extended setting (firmware-dependent, commonly used by grblHAL/forks).',
  14: 'Extended setting (firmware-dependent control/report option).',
  15: 'Extended setting (firmware-dependent control/report option).',
  16: 'Extended setting (firmware-dependent control/report option).',
  17: 'Extended setting (firmware-dependent control/report option).',
  18: 'Extended setting (firmware-dependent control/report option).',
  19: 'Extended setting (firmware-dependent control/report option).',
  33: 'Extended spindle/laser behavior setting (firmware-dependent).',
  34: 'Extended spindle/laser behavior setting (firmware-dependent).',
  35: 'Extended spindle/laser behavior setting (firmware-dependent).',
  36: 'Extended spindle/laser behavior setting (firmware-dependent).',
  37: 'Extended spindle/laser behavior setting (firmware-dependent).',
  39: 'Extended runtime/reporting setting (firmware-dependent).',
  40: 'Extended runtime/reporting setting (firmware-dependent).',
  41: 'Extended runtime/reporting setting (firmware-dependent).',
  42: 'Extended runtime/reporting setting (firmware-dependent).',
  43: 'Extended runtime/reporting setting (firmware-dependent).',
  44: 'Extended runtime/reporting setting (firmware-dependent).',
  100: 'X-axis steps per unit.',
  101: 'Y-axis steps per unit.',
  102: 'Z-axis steps per unit.',
  110: 'X-axis max rate.',
  111: 'Y-axis max rate.',
  112: 'Z-axis max rate.',
  120: 'X-axis acceleration.',
  121: 'Y-axis acceleration.',
  122: 'Z-axis acceleration.',
  130: 'X-axis max travel.',
  131: 'Y-axis max travel.',
  132: 'Z-axis max travel.',
}

export function getGrblSettingDescription(settingId: number): string {
  return (
    GRBL_SETTING_DESCRIPTIONS[settingId] ??
    'Unknown setting for this firmware version (custom / board-specific).'
  )
}

export function hasKnownGrblSettingDescription(settingId: number): boolean {
  return Object.prototype.hasOwnProperty.call(GRBL_SETTING_DESCRIPTIONS, settingId)
}
