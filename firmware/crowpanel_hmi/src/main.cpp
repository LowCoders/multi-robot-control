#include <Arduino.h>
#include <LovyanGFX.hpp>
#include <Preferences.h>
#include <lvgl.h>
#include <math.h>

#include "board_config.h"
#include "config_store.h"
#include "cst816d.h"
#include "grbl_client.h"
#include "grbl_parser.h"
#include "lgfx_crowpanel_128.h"
#include "program_engine.h"
#include "program_store.h"

static CrowPanelLGFX gfx;
static HardwareSerial GrblSerial(1);
static GrblParser grblParser;
static GrblClient grblClient;
static ConfigStore configStore;
static ProgramStore programStore;
static ProgramEngine programEngine;
static MachineConfig machineCfg;
static Preferences uiPrefs;

static lv_disp_draw_buf_t drawBuf;
static lv_color_t drawPixels[240 * 24];
static lv_obj_t *titleLabel = nullptr;
static lv_obj_t *line1Label = nullptr;
static lv_obj_t *line2Label = nullptr;
static lv_obj_t *line3Label = nullptr;
static lv_obj_t *line4Label = nullptr;
static lv_obj_t *modeIconLabel = nullptr;
static lv_obj_t *valueArc = nullptr;
static lv_obj_t *valueLabel = nullptr;
static lv_obj_t *touchReturnBtn = nullptr;
static lv_obj_t *touchReturnLabel = nullptr;
static lv_obj_t *homeCardButtons[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *homeCardIcons[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *homeCardLabels[3] = {nullptr, nullptr, nullptr};
static int homeCardOffsets[3] = {-1, 0, 1};
static Cst816d touch(TOUCH_I2C_SDA_PIN, TOUCH_I2C_SCL_PIN, TOUCH_RST_PIN, TOUCH_INT_PIN);
static constexpr int kArcTickCount = 121;
static lv_obj_t *arcTickLines[kArcTickCount] = {nullptr};
static lv_point_t arcTickPoints[kArcTickCount][2];
static lv_obj_t *arcTickLabels[kArcTickCount] = {nullptr};
static lv_obj_t *valuePointerTriangle = nullptr;
static lv_color32_t valuePointerTriangleBuf[32 * 32];
static lv_point_t valuePointerTrianglePoints[3];
static constexpr int kArcBgStartDeg = 135;
static constexpr int kArcBgEndDeg = 45;
static constexpr int kTickAngleOffsetDeg = 90;

enum class Screen {
  Home,
  Status,
  Setup,
  Step,
  Pos,
  TeachMenu,
  TeachStep,
  TeachPos,
  ProgramList,
  ProgramRun
};

enum class ButtonEvent { None, ShortPress, LongPress };

static Screen screen = Screen::Home;
static uint32_t lastStatusMs = 0;
static uint32_t lastUiMs = 0;

static int homeIndex = 0;
static const char *homeItems[] = {"Status", "Setup", "Step", "Pos", "Teach", "Program"};
static const int homeCount = sizeof(homeItems) / sizeof(homeItems[0]);
static int savedHomeIndex = -1;

static int setupCursor = 0;
static int setupAxis = 0;
static int setupField = 0;
static int setupAction = 0;
static bool setupEditing = false;
static const char *setupFields[] = {"min", "max", "invert", "scale", "step", "feed"};
static const int setupFieldCount = sizeof(setupFields) / sizeof(setupFields[0]);
static const char *setupActions[] = {"SaveCfg"};
static const int setupActionCount = sizeof(setupActions) / sizeof(setupActions[0]);

static int stepAxis = 0;
static float stepValue = 0.0f;

static int posAxis = 0;
static std::vector<float> posValues;

static int teachMenuIndex = 0;
static bool teachPerStep = true;
static ProgramData teachBuffer;
static std::vector<float> teachCombined;
static std::vector<float> teachPosValues;
static int teachPosAxis = 0;

static int programIndex = 0;
static std::vector<String> programNames;
static String infoLine;
static bool hostControlActive = false;
static String lastOwner = "none";
static String lastOwnerReason = "";
static bool panelMpgModeAssumed = false;
static constexpr uint8_t kOwnRequestPanelRt = 0x8E;
static constexpr uint8_t kOwnQueryRt = 0xA5;
static constexpr uint8_t kMpgToggleRt = 0x8B;
static bool suppressArcEvent = false;
static uint32_t lastEncoderChangeMs = 0;
static bool uiDirty = true;
static constexpr int kArcRange = 1000;
static volatile uint32_t encoderQuarterStepCount = 0;
static volatile uint32_t encoderStepEventCount = 0;
static volatile int32_t encoderIsrDelta = 0;
static volatile uint8_t encoderIsrState = 0;
static volatile uint32_t encoderIsrLastUs = 0;

static String fitLine(const String &src, size_t max_chars = 24) {
  if (src.length() <= max_chars) {
    return src;
  }
  if (max_chars < 4) {
    return src.substring(0, max_chars);
  }
  return src.substring(0, max_chars - 3) + "...";
}

struct UiPalette {
  uint32_t bg;
  uint32_t fg;
  uint32_t accent;
};

static bool isEditScreen(Screen s) {
  return s == Screen::Step || s == Screen::Pos || s == Screen::TeachStep || s == Screen::TeachPos;
}

static bool shouldShowArc(Screen s) {
  if (isEditScreen(s)) {
    return true;
  }
  return s == Screen::Setup && setupCursor == 2 && setupEditing;
}

static const char *screenIcon(Screen s) {
  switch (s) {
    case Screen::Home: return "HOME";
    case Screen::Status: return "STAT";
    case Screen::Setup: return "SET";
    case Screen::Step: return "STEP";
    case Screen::Pos: return "POS";
    case Screen::TeachMenu:
    case Screen::TeachStep:
    case Screen::TeachPos: return "TEACH";
    case Screen::ProgramList: return "PROG";
    case Screen::ProgramRun: return "RUN";
  }
  return "UI";
}

static const char *homeItemSymbol(int idx) {
  switch (idx) {
    case 0: return LV_SYMBOL_LIST;      // Status
    case 1: return LV_SYMBOL_SETTINGS;  // Setup
    case 2: return LV_SYMBOL_SHUFFLE;   // Step (footprint-like motion icon)
    case 3: return LV_SYMBOL_GPS;       // Pos (target/crosshair style)
    case 4: return LV_SYMBOL_EDIT;      // Teach
    case 5: return LV_SYMBOL_PLAY;      // Program
    default: return LV_SYMBOL_HOME;
  }
}

static int wrappedHomeIndex(int index) {
  int out = index % homeCount;
  if (out < 0) {
    out += homeCount;
  }
  return out;
}

static void persistHomeIndex() {
  const int wrapped = wrappedHomeIndex(homeIndex);
  if (savedHomeIndex == wrapped) {
    return;
  }
  uiPrefs.putInt("home_idx", wrapped);
  savedHomeIndex = wrapped;
}

static void refreshHomeCards() {
  const lv_coord_t x_offsets[3] = {-72, 0, 72};
  for (int i = 0; i < 3; i++) {
    if (!homeCardButtons[i] || !homeCardIcons[i] || !homeCardLabels[i]) {
      continue;
    }
    const int idx = wrappedHomeIndex(homeIndex + homeCardOffsets[i]);
    lv_label_set_text(homeCardIcons[i], homeItemSymbol(idx));
    lv_label_set_text(homeCardLabels[i], fitLine(homeItems[idx], 10).c_str());

    const bool selected = (i == 1);
    const lv_coord_t cardSize = selected ? 66 : 52;
    lv_obj_set_size(homeCardButtons[i], cardSize, cardSize);
    lv_obj_set_style_radius(homeCardButtons[i], cardSize / 2, LV_PART_MAIN);
    lv_obj_align(homeCardButtons[i], LV_ALIGN_TOP_MID, x_offsets[i], selected ? 60 : 67);
    lv_obj_align(homeCardLabels[i], LV_ALIGN_TOP_MID, x_offsets[i], 133);
    lv_obj_set_style_bg_opa(homeCardButtons[i], selected ? LV_OPA_90 : LV_OPA_30, LV_PART_MAIN);
    lv_obj_set_style_border_width(homeCardButtons[i], selected ? 3 : 1, LV_PART_MAIN);
    lv_obj_set_style_text_font(homeCardLabels[i], selected ? &lv_font_montserrat_20 : &lv_font_montserrat_14, LV_PART_MAIN);
  }
}

static UiPalette paletteForScreen(Screen s) {
  switch (s) {
    case Screen::Home: return {0x10263A, 0xEAF4FF, 0x3BC1FF};
    case Screen::Status: return {0x1E2630, 0xEAF4FF, 0x55E39F};
    case Screen::Setup: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::Step: return {0x233229, 0xEDFFF2, 0x5FFB92};
    case Screen::Pos: return {0x2B2236, 0xF7F0FF, 0xD38BFF};
    case Screen::TeachMenu:
    case Screen::TeachStep:
    case Screen::TeachPos: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::ProgramList:
    case Screen::ProgramRun: return {0x1E3130, 0xE9FFFD, 0x3EE9D7};
  }
  return {0x101010, 0xFFFFFF, 0x8FD3FF};
}

static int currentEditAxisIndex() {
  if (screen == Screen::Step || screen == Screen::TeachStep) {
    return stepAxis;
  }
  if (screen == Screen::Pos) {
    return posAxis;
  }
  if (screen == Screen::TeachPos) {
    return teachPosAxis;
  }
  if (screen == Screen::Setup && setupCursor == 2 && setupEditing) {
    return setupAxis;
  }
  return -1;
}

static lv_color_t axisColorByIndex(int axis_idx) {
  static const uint32_t axis_colors[] = {
      0xFF6B6B,  // X
      0x58D66D,  // Y
      0x59A8FF,  // Z
      0xFFC85A,  // A
      0xD38BFF   // B
  };
  if (axis_idx < 0) {
    return lv_color_hex(0xFFFFFF);
  }
  const size_t color_count = sizeof(axis_colors) / sizeof(axis_colors[0]);
  return lv_color_hex(axis_colors[static_cast<size_t>(axis_idx) % color_count]);
}

static float clampf(float v, float min_v, float max_v) {
  if (v < min_v) {
    return min_v;
  }
  if (v > max_v) {
    return max_v;
  }
  return v;
}

static int normalizedArc(float value, float min_v, float max_v) {
  if (max_v <= min_v) {
    return kArcRange / 2;
  }
  float p = (value - min_v) / (max_v - min_v);
  p = clampf(p, 0.0f, 1.0f);
  return static_cast<int>(p * static_cast<float>(kArcRange) + 0.5f);
}

static float denormalizeArc(int arc_value, float min_v, float max_v) {
  if (max_v <= min_v) {
    return min_v;
  }
  float p = static_cast<float>(arc_value) / static_cast<float>(kArcRange);
  p = clampf(p, 0.0f, 1.0f);
  return min_v + (max_v - min_v) * p;
}

static String signedValue(float value, int decimals = 3) {
  return String(value, decimals);
}

static float normalizedStepSize(float step) {
  return max(0.001f, step);
}

static int decimalsForStep(float step) {
  const float s = normalizedStepSize(step);
  if (s >= 1.0f) return 0;
  if (s >= 0.1f) return 1;
  if (s >= 0.01f) return 2;
  return 3;
}

static float snapToStep(float value, float step, float min_v, float max_v) {
  const float s = normalizedStepSize(step);
  const float clamped = clampf(value, min_v, max_v);
  const float snapped = roundf(clamped / s) * s;
  return clampf(snapped, min_v, max_v);
}

static const lv_font_t *responsiveValueFont(const String &txt) {
  const size_t len = txt.length();
  if (len <= 5) {
    return &lv_font_montserrat_32;
  }
  if (len <= 7) {
    return &lv_font_montserrat_24;
  }
  return &lv_font_montserrat_20;
}

static bool currentEditValue(float &value, float &min_v, float &max_v, float &base_step) {
  if (screen == Screen::Step || screen == Screen::TeachStep) {
    const AxisConfig &a = machineCfg.axes[stepAxis];
    float span = max(fabsf(a.min), fabsf(a.max));
    if (span < 10.0f) {
      span = 10.0f;
    }
    value = stepValue;
    min_v = -span;
    max_v = span;
    base_step = normalizedStepSize(a.step);
    return true;
  }

  if (screen == Screen::Pos) {
    value = posValues[posAxis];
    min_v = machineCfg.axes[posAxis].min;
    max_v = machineCfg.axes[posAxis].max;
    base_step = normalizedStepSize(machineCfg.axes[posAxis].step);
    return true;
  }

  if (screen == Screen::TeachPos) {
    value = teachPosValues[teachPosAxis];
    min_v = machineCfg.axes[teachPosAxis].min;
    max_v = machineCfg.axes[teachPosAxis].max;
    base_step = normalizedStepSize(machineCfg.axes[teachPosAxis].step);
    return true;
  }

  if (screen == Screen::Setup && setupCursor == 2 && setupEditing) {
    const AxisConfig &a = machineCfg.axes[setupAxis];
    if (setupField == 0) {
      value = a.min;
      float span = fabsf(a.max - a.min);
      if (span < 20.0f) span = 20.0f;
      min_v = a.min - span * 0.3f;
      max_v = a.max + span * 0.3f;
      base_step = 0.5f;
      return true;
    }
    if (setupField == 1) {
      value = a.max;
      float span = fabsf(a.max - a.min);
      if (span < 20.0f) span = 20.0f;
      min_v = a.min - span * 0.3f;
      max_v = a.max + span * 0.3f;
      base_step = 0.5f;
      return true;
    }
    if (setupField == 2) {
      value = a.invert ? 1.0f : 0.0f;
      min_v = 0.0f;
      max_v = 1.0f;
      base_step = 1.0f;
      return true;
    }
    if (setupField == 3) {
      value = a.scale;
      min_v = 0.1f;
      max_v = 5.0f;
      base_step = 0.05f;
      return true;
    }
    if (setupField == 4) {
      value = a.step;
      min_v = 0.1f;
      max_v = 20.0f;
      base_step = 0.1f;
      return true;
    }
    if (setupField == 5) {
      value = a.default_feed;
      min_v = 50.0f;
      max_v = machineCfg.max_feed_rate * 2.0f;
      base_step = 5.0f;
      return true;
    }
  }

  return false;
}

static void writeCurrentEditValue(float value) {
  if (screen == Screen::Step || screen == Screen::TeachStep) {
    float cur = 0.0f;
    float min_v = 0.0f;
    float max_v = 0.0f;
    float step = 0.1f;
    if (!currentEditValue(cur, min_v, max_v, step)) return;
    stepValue = snapToStep(value, step, min_v, max_v);
    uiDirty = true;
    return;
  }

  if (screen == Screen::Pos) {
    float cur = 0.0f;
    float min_v = 0.0f;
    float max_v = 0.0f;
    float step = 0.1f;
    if (!currentEditValue(cur, min_v, max_v, step)) return;
    posValues[posAxis] = snapToStep(value, step, min_v, max_v);
    uiDirty = true;
    return;
  }

  if (screen == Screen::TeachPos) {
    float cur = 0.0f;
    float min_v = 0.0f;
    float max_v = 0.0f;
    float step = 0.1f;
    if (!currentEditValue(cur, min_v, max_v, step)) return;
    teachPosValues[teachPosAxis] = snapToStep(value, step, min_v, max_v);
    uiDirty = true;
    return;
  }

  if (screen == Screen::Setup && setupCursor == 2 && setupEditing) {
    AxisConfig &a = machineCfg.axes[setupAxis];
    if (setupField == 0) a.min = value;
    if (setupField == 1) a.max = value;
    if (setupField == 2) a.invert = value >= 0.5f;
    if (setupField == 3) a.scale = clampf(value, 0.1f, 5.0f);
    if (setupField == 4) a.step = clampf(value, 0.1f, 20.0f);
    if (setupField == 5) a.default_feed = max(1.0f, value);
    uiDirty = true;
  }
}

static void applyAdaptiveEditDelta(int encoder_delta) {
  float cur = 0.0f;
  float min_v = 0.0f;
  float max_v = 0.0f;
  float base_step = 0.1f;
  if (!currentEditValue(cur, min_v, max_v, base_step)) {
    return;
  }

  lastEncoderChangeMs = millis();

  if (screen == Screen::Setup && setupField == 2) {
    writeCurrentEditValue(encoder_delta > 0 ? 1.0f : 0.0f);
    return;
  }

  const float delta = static_cast<float>(encoder_delta) * base_step;
  writeCurrentEditValue(clampf(cur + delta, min_v, max_v));
}

static int tickCountForStep(float step) {
  // Always keep 5-way subdivision: 1 major + 4 micro markers.
  if (step >= 5.0f) return 31;    // 30 intervals
  if (step >= 1.0f) return 61;    // 60 intervals
  if (step >= 0.1f) return 91;    // 90 intervals
  if (step >= 0.01f) return 121;  // 120 intervals
  return 121;
}

static void updateArcTicks(float step, bool visible, float min_v, float max_v, int decimals) {
  lv_area_t arcArea;
  lv_obj_get_coords(valueArc, &arcArea);
  const float cx = (arcArea.x1 + arcArea.x2) * 0.5f + 1.0f;
  const float cy = (arcArea.y1 + arcArea.y2) * 0.5f;
  const float outerR = (arcArea.x2 - arcArea.x1) * 0.5f + 1.0f;
  const int visibleCount = tickCountForStep(step);
  const int majorStride = 5;  // 1 major + 4 micro per unit
  const int sweepDeg = (kArcBgEndDeg >= kArcBgStartDeg) ? (kArcBgEndDeg - kArcBgStartDeg)
                                                         : (360 - kArcBgStartDeg + kArcBgEndDeg);
  const int idxNeg90 = static_cast<int>(roundf((visibleCount - 1) / 6.0f));
  const int idxZero = static_cast<int>(roundf((visibleCount - 1) / 2.0f));
  const int idxPos90 = static_cast<int>(roundf((visibleCount - 1) * 5.0f / 6.0f));

  for (int i = 0; i < kArcTickCount; i++) {
    if (!arcTickLines[i] || !arcTickLabels[i]) {
      continue;
    }
    if (i >= visibleCount) {
      lv_obj_add_flag(arcTickLines[i], LV_OBJ_FLAG_HIDDEN);
      lv_obj_add_flag(arcTickLabels[i], LV_OBJ_FLAG_HIDDEN);
      continue;
    }
    const float t = static_cast<float>(i) / static_cast<float>(max(1, visibleCount - 1));
    const float deg = static_cast<float>(kArcBgStartDeg) + t * static_cast<float>(sweepDeg) +
                      static_cast<float>(kTickAngleOffsetDeg);
    const float rad = (deg - 90.0f) * (3.14159265f / 180.0f);
    const bool major = (i % majorStride) == 0 || i == (visibleCount - 1);
    const bool largest = (i == idxNeg90) || (i == idxZero) || (i == idxPos90);
    const float tickLen = largest ? 20.0f : (major ? 18.0f : 9.0f);
    const float innerR = outerR - tickLen;

    arcTickPoints[i][0].x = static_cast<lv_coord_t>(cx + cosf(rad) * innerR);
    arcTickPoints[i][0].y = static_cast<lv_coord_t>(cy + sinf(rad) * innerR);
    arcTickPoints[i][1].x = static_cast<lv_coord_t>(cx + cosf(rad) * outerR);
    arcTickPoints[i][1].y = static_cast<lv_coord_t>(cy + sinf(rad) * outerR);
    lv_line_set_points(arcTickLines[i], arcTickPoints[i], 2);
    lv_obj_set_style_line_color(arcTickLines[i], lv_color_hex(0xFFFFFF), LV_PART_MAIN);
    lv_obj_set_style_line_width(arcTickLines[i], largest ? 3 : (major ? 2 : 1), LV_PART_MAIN);
    lv_obj_set_style_line_opa(arcTickLines[i], largest ? LV_OPA_COVER : (major ? LV_OPA_80 : LV_OPA_60), LV_PART_MAIN);
    if (visible) {
      lv_obj_clear_flag(arcTickLines[i], LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_add_flag(arcTickLines[i], LV_OBJ_FLAG_HIDDEN);
    }

    const bool edgeLabel = (i == 0) || (i == (visibleCount - 1));
    if ((largest || edgeLabel) && visible) {
      const float labelR = innerR - 20.0f;  // slightly outward from center
      const float value = min_v + (max_v - min_v) * t;
      const lv_coord_t labelW = 34;
      const lv_coord_t centerShiftX = (i == idxZero) ? -2 : 0;  // zero label slightly left
      lv_obj_align(arcTickLabels[i], LV_ALIGN_TOP_LEFT,
                   static_cast<lv_coord_t>(cx + cosf(rad) * labelR - (labelW / 2) + centerShiftX),
                   static_cast<lv_coord_t>(cy + sinf(rad) * labelR - 8.0f));
      lv_obj_set_style_text_color(arcTickLabels[i], lv_color_hex(0xFFFFFF), LV_PART_MAIN);
      lv_obj_set_style_text_font(arcTickLabels[i], &lv_font_montserrat_14, LV_PART_MAIN);
      lv_label_set_text(arcTickLabels[i], String(value, decimals).c_str());
      lv_obj_clear_flag(arcTickLabels[i], LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_add_flag(arcTickLabels[i], LV_OBJ_FLAG_HIDDEN);
    }
  }
}

static void onTouchReturn(lv_event_t *e);
static void onHomeCardClick(lv_event_t *e);
static void navigateBack();
static void onArcValueChanged(lv_event_t *e);
static void onShortPress();
static void IRAM_ATTR encoderISR();

class MachineViewModel {
public:
  bool currentEdit(float &value, float &min_v, float &max_v, float &base_step) const;
  void setEditValue(float value);
  void applyAdaptiveDelta(int encoder_delta);
};

class DemoStyleUiAdapter {
public:
  void begin();
  void render();
};

static MachineViewModel viewModel;
static DemoStyleUiAdapter uiAdapter;

bool MachineViewModel::currentEdit(float &value, float &min_v, float &max_v, float &base_step) const {
  return currentEditValue(value, min_v, max_v, base_step);
}

void MachineViewModel::setEditValue(float value) {
  writeCurrentEditValue(value);
}

void MachineViewModel::applyAdaptiveDelta(int encoder_delta) {
  applyAdaptiveEditDelta(encoder_delta);
}

static void IRAM_ATTR encoderISR() {
  const uint8_t a = static_cast<uint8_t>(digitalRead(ENCODER_PIN_A) & 0x1);
  const uint8_t b = static_cast<uint8_t>(digitalRead(ENCODER_PIN_B) & 0x1);
  const uint8_t state = static_cast<uint8_t>((a << 1) | b);
  static const int8_t qem[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  const uint8_t idx = static_cast<uint8_t>((encoderIsrState << 2) | state);
  const int8_t q = qem[idx];
  encoderIsrState = state;

  if (q == 0) {
    return;
  }

  const uint32_t now_us = micros();
  if (now_us - encoderIsrLastUs < 120) {
    return;
  }
  encoderIsrLastUs = now_us;
  encoderIsrDelta += q;
  encoderQuarterStepCount++;
}

static int encoderDelta() {
  static int8_t acc = 0;
  int32_t raw = 0;
  noInterrupts();
  raw = encoderIsrDelta;
  encoderIsrDelta = 0;
  interrupts();

  if (raw == 0) {
    return 0;
  }

  acc += static_cast<int8_t>(raw);
  int out = 0;
  while (acc >= 4) {
    acc -= 4;
    out++;
    encoderStepEventCount++;
  }
  while (acc <= -4) {
    acc += 4;
    out--;
    encoderStepEventCount++;
  }
  return out;
}

static ButtonEvent buttonEvent() {
  static int last = HIGH;
  static uint32_t downAt = 0;
  int sw = digitalRead(ENCODER_PIN_SW);
  if (last == HIGH && sw == LOW) {
    downAt = millis();
  } else if (last == LOW && sw == HIGH) {
    uint32_t held = millis() - downAt;
    last = sw;
    return held > 800 ? ButtonEvent::LongPress : ButtonEvent::ShortPress;
  }
  last = sw;
  return ButtonEvent::None;
}

static String axisValueLine(const std::vector<float> &vals) {
  String out;
  for (size_t i = 0; i < machineCfg.axes.size(); i++) {
    if (i > 0) {
      out += " ";
    }
    out += machineCfg.axes[i].name;
    out += ":";
    float v = i < vals.size() ? vals[i] : 0.0f;
    out += String(v, 2);
  }
  return out;
}

static std::vector<float> statusAxes() {
  if (grblParser.status().axes.empty()) {
    return std::vector<float>(machineCfg.axes.size(), 0.0f);
  }
  return grblParser.status().axes;
}

static String baseGrblState() {
  const String &raw = grblParser.status().state;
  int sep = raw.indexOf(':');
  if (sep > 0) {
    return raw.substring(0, sep);
  }
  return raw;
}

static void updateOwnershipFromStatus() {
  const bool prevHostControl = hostControlActive;
  String owner = grblParser.status().owner;
  String ownerReason = grblParser.status().ownerReason;
  owner.trim();
  ownerReason.trim();
  if (owner.isEmpty()) {
    owner = "none";
  }
  const bool ownerIsPanel = owner.equalsIgnoreCase("panel");
  hostControlActive = owner.equalsIgnoreCase("host");
  grblClient.setMotionAllowed(!hostControlActive);

  if (ownerIsPanel != panelMpgModeAssumed) {
    grblClient.sendRealtime(kMpgToggleRt);
    panelMpgModeAssumed = ownerIsPanel;
  }

  if (!prevHostControl && hostControlActive && screen != Screen::Status) {
    screen = Screen::Status;
    infoLine = "Host active: monitor mode";
    uiDirty = true;
  }
  if (!owner.equalsIgnoreCase(lastOwner)) {
    if (owner.equalsIgnoreCase("panel")) {
      infoLine = "Panel control granted";
      if (screen == Screen::Status || screen == Screen::Home) {
        screen = Screen::Step;
      }
      uiDirty = true;
    } else if (owner.equalsIgnoreCase("host")) {
      infoLine = "Host active: monitor mode";
      screen = Screen::Status;
      uiDirty = true;
    } else if (lastOwner.equalsIgnoreCase("panel")) {
      infoLine = "Control released";
      uiDirty = true;
    }
    lastOwner = owner;
  }
  if (owner.equalsIgnoreCase("host") && !ownerReason.isEmpty() &&
      !ownerReason.equalsIgnoreCase(lastOwnerReason)) {
    infoLine = "Takeover denied: " + ownerReason;
    uiDirty = true;
  }
  lastOwnerReason = ownerReason;
}

static bool panelCommandsAllowed() {
  String owner = grblParser.status().owner;
  owner.trim();
  return !owner.equalsIgnoreCase("host");
}

static bool queueStepMove(size_t axis_idx, float value, String *queuedLine = nullptr) {
  if (!panelCommandsAllowed()) {
    return false;
  }
  if (axis_idx >= machineCfg.axes.size()) {
    return false;
  }
  const AxisConfig &a = machineCfg.axes[axis_idx];
  String line = "G1 ";
  line += a.name;
  line += String(value * (a.invert ? -1.0f : 1.0f) * a.scale, 3);
  line += " F";
  line += String(a.default_feed, 1);
  const bool ok = grblClient.queueLine("G91") && grblClient.queueLine(line) && grblClient.queueLine("G90");
  if (!ok) {
    return false;
  }
  if (queuedLine) {
    *queuedLine = line;
  }
  Serial.print("STEP enqueue: ");
  Serial.println(line);
  return true;
}

static bool queuePosMove(const std::vector<float> &values) {
  if (!panelCommandsAllowed()) {
    return false;
  }
  String line = "G1";
  for (size_t i = 0; i < machineCfg.axes.size(); i++) {
    float v = i < values.size() ? values[i] : 0.0f;
    line += " ";
    line += machineCfg.axes[i].name;
    line += String(v * (machineCfg.axes[i].invert ? -1.0f : 1.0f) * machineCfg.axes[i].scale, 3);
  }
  line += " F";
  line += String(machineCfg.max_feed_rate, 1);
  const bool ok = grblClient.queueLine("G90") && grblClient.queueLine(line);
  return ok;
}

static void recordTeachStep(const ProgramStep &s) {
  if (teachPerStep) {
    teachBuffer.steps.push_back(s);
    return;
  }
  if (teachCombined.size() != machineCfg.axes.size()) {
    teachCombined.assign(machineCfg.axes.size(), 0.0f);
  }
  for (size_t i = 0; i < machineCfg.axes.size(); i++) {
    float v = i < s.axes.size() ? s.axes[i] : 0.0f;
    teachCombined[i] += v;
  }
}

static void saveTeachProgram() {
  if (!teachPerStep) {
    bool nonZero = false;
    for (float v : teachCombined) {
      if (v != 0.0f) {
        nonZero = true;
        break;
      }
    }
    if (nonZero) {
      ProgramStep s;
      s.mode = "pos";
      s.axes = teachCombined;
      s.feed = machineCfg.max_feed_rate;
      s.comment = "combined";
      teachBuffer.steps.push_back(s);
      teachCombined.assign(machineCfg.axes.size(), 0.0f);
    }
  }
  if (teachBuffer.steps.empty()) {
    infoLine = "Teach buffer empty";
    return;
  }
  if (teachBuffer.name.isEmpty()) {
    teachBuffer.name = programStore.nextAutoName();
  }
  if (programStore.saveProgram(teachBuffer, machineCfg.axes)) {
    infoLine = "Saved " + teachBuffer.name;
    teachBuffer.steps.clear();
    teachBuffer.name = "";
    programStore.listPrograms(programNames);
  } else {
    infoLine = "Save err: " + programStore.lastError();
  }
}

void DemoStyleUiAdapter::begin() {
  lv_obj_clear_flag(lv_scr_act(), LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_scrollbar_mode(lv_scr_act(), LV_SCROLLBAR_MODE_OFF);
  lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(0x101010), LV_PART_MAIN);
  lv_obj_set_style_text_color(lv_scr_act(), lv_color_hex(0xFFFFFF), LV_PART_MAIN);
  lv_obj_set_style_text_font(lv_scr_act(), &lv_font_montserrat_14, LV_PART_MAIN);

  modeIconLabel = lv_label_create(lv_scr_act());
  lv_obj_set_width(modeIconLabel, 100);
  lv_obj_set_style_text_align(modeIconLabel, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_obj_set_style_text_font(modeIconLabel, &lv_font_montserrat_32, LV_PART_MAIN);
  lv_obj_align(modeIconLabel, LV_ALIGN_TOP_MID, 0, 24);
  lv_label_set_text(modeIconLabel, "");

  titleLabel = lv_label_create(lv_scr_act());
  lv_obj_set_width(titleLabel, 148);
  lv_obj_set_style_text_align(titleLabel, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 8);
  lv_label_set_text(titleLabel, "CrowPanel");

  line1Label = lv_label_create(lv_scr_act());
  lv_obj_set_width(line1Label, 224);
  lv_obj_set_style_text_align(line1Label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(line1Label, LV_LABEL_LONG_CLIP);
  lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 40);
  lv_label_set_text(line1Label, "");

  line2Label = lv_label_create(lv_scr_act());
  lv_obj_set_width(line2Label, 224);
  lv_obj_set_style_text_align(line2Label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(line2Label, LV_LABEL_LONG_CLIP);
  lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 62);
  lv_label_set_text(line2Label, "");

  line3Label = lv_label_create(lv_scr_act());
  lv_obj_set_width(line3Label, 224);
  lv_obj_set_style_text_align(line3Label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(line3Label, LV_LABEL_LONG_CLIP);
  lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 84);
  lv_label_set_text(line3Label, "");

  line4Label = lv_label_create(lv_scr_act());
  lv_obj_set_width(line4Label, 224);
  lv_obj_set_style_text_align(line4Label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(line4Label, LV_LABEL_LONG_CLIP);
  lv_obj_align(line4Label, LV_ALIGN_TOP_MID, 0, 106);
  lv_label_set_text(line4Label, "");

  valueArc = lv_arc_create(lv_scr_act());
  lv_obj_set_size(valueArc, 241, 241);
  lv_obj_align(valueArc, LV_ALIGN_CENTER, 0, 0);
  lv_arc_set_range(valueArc, 0, kArcRange);
  lv_arc_set_rotation(valueArc, 0);
  lv_arc_set_bg_angles(valueArc, kArcBgStartDeg, kArcBgEndDeg);
  lv_arc_set_mode(valueArc, LV_ARC_MODE_NORMAL);
  lv_obj_clear_flag(valueArc, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_event_cb(valueArc, onArcValueChanged, LV_EVENT_VALUE_CHANGED, nullptr);
  lv_obj_set_style_arc_width(valueArc, 16, LV_PART_MAIN);
  lv_obj_set_style_arc_width(valueArc, 20, LV_PART_INDICATOR);
  lv_obj_set_style_arc_rounded(valueArc, false, LV_PART_MAIN);
  lv_obj_set_style_arc_rounded(valueArc, false, LV_PART_INDICATOR);
  lv_obj_set_style_bg_opa(valueArc, LV_OPA_TRANSP, LV_PART_KNOB);
  lv_obj_set_style_border_opa(valueArc, LV_OPA_TRANSP, LV_PART_KNOB);
  lv_obj_set_style_pad_all(valueArc, 0, LV_PART_MAIN);
  lv_obj_move_background(valueArc);
  lv_obj_add_flag(valueArc, LV_OBJ_FLAG_HIDDEN);

  for (int i = 0; i < kArcTickCount; i++) {
    arcTickLines[i] = lv_line_create(lv_scr_act());
    lv_obj_set_style_line_rounded(arcTickLines[i], false, LV_PART_MAIN);
    lv_obj_move_foreground(arcTickLines[i]);
    lv_obj_add_flag(arcTickLines[i], LV_OBJ_FLAG_HIDDEN);

    arcTickLabels[i] = lv_label_create(lv_scr_act());
    lv_obj_set_width(arcTickLabels[i], 34);
    lv_obj_set_style_text_align(arcTickLabels[i], LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_label_set_long_mode(arcTickLabels[i], LV_LABEL_LONG_CLIP);
    lv_obj_move_foreground(arcTickLabels[i]);
    lv_obj_add_flag(arcTickLabels[i], LV_OBJ_FLAG_HIDDEN);
  }

  valuePointerTriangle = lv_canvas_create(lv_scr_act());
  lv_canvas_set_buffer(valuePointerTriangle, valuePointerTriangleBuf, 32, 32, LV_IMG_CF_TRUE_COLOR_ALPHA);
  lv_canvas_fill_bg(valuePointerTriangle, lv_color_hex(0x000000), LV_OPA_TRANSP);
  lv_obj_move_foreground(valuePointerTriangle);
  lv_obj_add_flag(valuePointerTriangle, LV_OBJ_FLAG_HIDDEN);

  valueLabel = lv_label_create(lv_scr_act());
  lv_obj_set_width(valueLabel, 116);
  lv_obj_set_style_text_align(valueLabel, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_obj_align(valueLabel, LV_ALIGN_CENTER, 0, 2);
  lv_obj_set_style_text_font(valueLabel, &lv_font_montserrat_32, LV_PART_MAIN);
  lv_label_set_text(valueLabel, "0.000");
  lv_obj_add_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);

  touchReturnBtn = lv_btn_create(lv_scr_act());
  lv_obj_set_size(touchReturnBtn, 80, 30);
  lv_obj_align(touchReturnBtn, LV_ALIGN_BOTTOM_MID, 0, -8);
  lv_obj_set_style_radius(touchReturnBtn, 16, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(touchReturnBtn, LV_OPA_80, LV_PART_MAIN);
  lv_obj_set_style_border_width(touchReturnBtn, 1, LV_PART_MAIN);

  touchReturnLabel = lv_label_create(touchReturnBtn);
  lv_label_set_text(touchReturnLabel, "Back");
  lv_obj_center(touchReturnLabel);
  lv_obj_add_event_cb(touchReturnBtn, onTouchReturn, LV_EVENT_CLICKED, nullptr);

  const lv_coord_t x_offsets[3] = {-72, 0, 72};
  for (int i = 0; i < 3; i++) {
    homeCardButtons[i] = lv_btn_create(lv_scr_act());
    lv_obj_set_size(homeCardButtons[i], 56, 56);
    lv_obj_align(homeCardButtons[i], LV_ALIGN_TOP_MID, x_offsets[i], 64);
    lv_obj_set_style_radius(homeCardButtons[i], 28, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(homeCardButtons[i], LV_OPA_40, LV_PART_MAIN);
    lv_obj_set_style_border_width(homeCardButtons[i], 1, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(homeCardButtons[i], 0, LV_PART_MAIN);
    lv_obj_add_event_cb(homeCardButtons[i], onHomeCardClick, LV_EVENT_CLICKED, (void *)&homeCardOffsets[i]);

    homeCardIcons[i] = lv_label_create(homeCardButtons[i]);
    lv_obj_set_style_text_font(homeCardIcons[i], &lv_font_montserrat_24, LV_PART_MAIN);
    lv_label_set_text(homeCardIcons[i], LV_SYMBOL_HOME);
    lv_obj_center(homeCardIcons[i]);

    homeCardLabels[i] = lv_label_create(lv_scr_act());
    lv_obj_set_width(homeCardLabels[i], 70);
    lv_obj_set_style_text_align(homeCardLabels[i], LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_align(homeCardLabels[i], LV_ALIGN_TOP_MID, x_offsets[i], 126);
    lv_label_set_text(homeCardLabels[i], "");
  }

  refreshHomeCards();
}

void DemoStyleUiAdapter::render() {
  String title = "CrowPanel";
  String l1, l2, l3;
  String l4 = infoLine;
  const std::vector<float> currentAxes = statusAxes();
  bool arcVisible = false;
  float arcValue = 0.0f;
  float arcMin = -100.0f;
  float arcMax = 100.0f;
  int arcDecimals = 0;
  String arcText;

  switch (screen) {
    case Screen::Home:
      title = "Home";
      l2 = axisValueLine(statusAxes());
      l3 = "";
      break;
    case Screen::Status:
      title = hostControlActive ? "Monitor" : "Status";
      l1 = String("State: ") + grblParser.status().state;
      l2 = axisValueLine(currentAxes);
      l3 = String("Owner: ") + grblParser.status().owner;
      if (!grblParser.status().ownerReason.isEmpty()) {
        l4 = String("OWNR: ") + grblParser.status().ownerReason;
      } else if (grblParser.status().ownerVersion > 0) {
        l4 = String("OWNV: ") + String(grblParser.status().ownerVersion);
      } else if (hostControlActive) {
        l4 = "Monitor-only mode";
      }
      break;
    case Screen::Setup: {
      title = "Setup";
      const AxisConfig &a = machineCfg.axes[setupAxis];
      String field = setupFields[setupField];
      float value = 0.0f;
      if (setupField == 0) value = a.min;
      if (setupField == 1) value = a.max;
      if (setupField == 2) value = a.invert ? 1.0f : 0.0f;
      if (setupField == 3) value = a.scale;
      if (setupField == 4) value = a.step;
      if (setupField == 5) value = a.default_feed;
      if (setupCursor == 2 && setupEditing) {
        l1 = "Axis " + a.name + " " + field;
        const int axis_dec = decimalsForStep(a.step);
        l2 = setupField == 2 ? String(a.invert ? "+1" : "0")
                             : (setupField == 4 ? String(value, axis_dec) : signedValue(value, axis_dec));
        l3 = "Current " + a.name + ": " +
             String(setupAxis < static_cast<int>(currentAxes.size()) ? currentAxes[setupAxis] : 0.0f, axis_dec);
      } else {
        l1 = "Axis: " + a.name + " (" + String(setupAxis + 1) + "/" + String(machineCfg.axes.size()) + ")";
        l2 = "Field: " + field + (setupEditing ? " [edit]" : "");
        l3 = "Val: " + String(value, 3) + " Act:" + setupActions[setupAction];
      }
      break;
    }
    case Screen::Step:
      title = "Step";
      {
        const int axis_dec = decimalsForStep(machineCfg.axes[stepAxis].step);
      l1 = "Axis " + machineCfg.axes[stepAxis].name;
      l2 = signedValue(stepValue, axis_dec);
      l3 = "Current " + machineCfg.axes[stepAxis].name + ": " +
           String(stepAxis < static_cast<int>(currentAxes.size()) ? currentAxes[stepAxis] : 0.0f, axis_dec);
      }
      break;
    case Screen::Pos:
      title = "Pos";
      {
        const int axis_dec = decimalsForStep(machineCfg.axes[posAxis].step);
      l1 = "Axis " + machineCfg.axes[posAxis].name;
      l2 = signedValue(posValues[posAxis], axis_dec);
      l3 = "Current " + machineCfg.axes[posAxis].name + ": " +
           String(posAxis < static_cast<int>(currentAxes.size()) ? currentAxes[posAxis] : 0.0f, axis_dec);
      }
      break;
    case Screen::TeachMenu: {
      title = "Teach";
      const char *items[] = {"Policy", "StepCapture", "PosCapture", "Save", "Clear", "Return"};
      l1 = String("> ") + items[teachMenuIndex];
      l2 = String("Policy: ") + (teachPerStep ? "PerStep" : "EndBlock");
      l3 = "Buffer steps: " + String(teachBuffer.steps.size());
      break;
    }
    case Screen::TeachStep:
      title = "Teach Step";
      {
        const int axis_dec = decimalsForStep(machineCfg.axes[stepAxis].step);
      l1 = "Axis " + machineCfg.axes[stepAxis].name;
      l2 = signedValue(stepValue, axis_dec);
      l3 = "Current " + machineCfg.axes[stepAxis].name + ": " +
           String(stepAxis < static_cast<int>(currentAxes.size()) ? currentAxes[stepAxis] : 0.0f, axis_dec);
      }
      break;
    case Screen::TeachPos:
      title = "Teach Pos";
      {
        const int axis_dec = decimalsForStep(machineCfg.axes[teachPosAxis].step);
      l1 = "Axis " + machineCfg.axes[teachPosAxis].name;
      l2 = signedValue(teachPosValues[teachPosAxis], axis_dec);
      l3 = "Current " + machineCfg.axes[teachPosAxis].name + ": " +
           String(teachPosAxis < static_cast<int>(currentAxes.size()) ? currentAxes[teachPosAxis] : 0.0f, axis_dec);
      }
      break;
    case Screen::ProgramList:
      title = "Program";
      if (programIndex == 0) {
        l1 = "> Return";
      } else if (programNames.empty()) {
        l1 = "> Return";
      } else {
        l1 = String("> ") + programNames[programIndex - 1];
      }
      l2 = "SW=Start selected";
      l3 = "Programs: " + String(programNames.size());
      break;
    case Screen::ProgramRun: {
      title = "Run: " + programEngine.programName();
      const ProgramStep *s = programEngine.activeStep();
      l1 = "Step " + String(programEngine.currentStep()) + "/" + String(programEngine.totalSteps());
      l2 = s ? axisValueLine(s->axes) : "Waiting...";
      l3 = String("State: ") + (programEngine.state() == ProgramEngine::State::Paused ? "Paused" : "Running");
      break;
    }
  }

  UiPalette palette = paletteForScreen(screen);
  if (screen == Screen::Home) {
    const String &state = grblParser.status().state;
    if (state == "Idle") {
      palette = {0x1A3B1F, 0xE9FFE9, 0x59D869};  // command-ready
    } else if (state == "Run" || state == "Jog") {
      palette = {0x1A2E4A, 0xEAF4FF, 0x51A8FF};
    } else if (state == "Hold") {
      palette = {0x4A3D1A, 0xFFF6E8, 0xFFC85A};
    } else if (state.startsWith("Alarm") || state == "Door") {
      palette = {0x4A1F1F, 0xFFEAEA, 0xFF6868};
    }
  }
  lv_color_t bg = lv_color_hex(palette.bg);
  lv_color_t fg = lv_color_hex(palette.fg);
  lv_color_t accent = lv_color_hex(palette.accent);
  const bool editLayout = isEditScreen(screen) || (screen == Screen::Setup && setupCursor == 2 && setupEditing);
  const int editAxis = currentEditAxisIndex();
  lv_color_t axisColor = axisColorByIndex(editAxis);

  float cur_edit = 0.0f;
  float cur_min = 0.0f;
  float cur_max = 0.0f;
  float cur_step = 0.1f;
  if (viewModel.currentEdit(cur_edit, cur_min, cur_max, cur_step)) {
    arcVisible = true;
    arcValue = cur_edit;
    arcMin = cur_min;
    arcMax = cur_max;
    arcDecimals = decimalsForStep(cur_step);
    arcText = String(cur_edit, arcDecimals);
  }

  lv_obj_set_style_bg_color(lv_scr_act(), bg, LV_PART_MAIN);
  lv_obj_set_style_text_color(lv_scr_act(), fg, LV_PART_MAIN);

  if (screen == Screen::Home) {
    lv_obj_add_flag(modeIconLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 8);
    lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 152);
    lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 174);
    lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 196);
    lv_obj_add_flag(line1Label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
    for (int i = 0; i < 3; i++) {
      if (homeCardButtons[i]) {
        lv_obj_clear_flag(homeCardButtons[i], LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_border_color(homeCardButtons[i], accent, LV_PART_MAIN);
        lv_obj_set_style_bg_color(homeCardButtons[i], lv_color_mix(accent, bg, LV_OPA_40), LV_PART_MAIN);
      }
      if (homeCardIcons[i]) {
        lv_obj_set_style_text_color(homeCardIcons[i], fg, LV_PART_MAIN);
      }
      if (homeCardLabels[i]) {
        lv_obj_clear_flag(homeCardLabels[i], LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_text_color(homeCardLabels[i], fg, LV_PART_MAIN);
        lv_obj_set_style_text_opa(homeCardLabels[i], i == 1 ? LV_OPA_COVER : LV_OPA_70, LV_PART_MAIN);
      }
    }
    refreshHomeCards();
  } else {
    lv_obj_add_flag(modeIconLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(line1Label, LV_OBJ_FLAG_HIDDEN);
    for (int i = 0; i < 3; i++) {
      if (homeCardButtons[i]) lv_obj_add_flag(homeCardButtons[i], LV_OBJ_FLAG_HIDDEN);
      if (homeCardLabels[i]) lv_obj_add_flag(homeCardLabels[i], LV_OBJ_FLAG_HIDDEN);
    }
    if (arcVisible) {
      lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 54);
      lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 77);
      lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 101);
      lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 139);
      lv_obj_clear_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 8);
      lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 40);
      lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 62);
      lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 84);
      lv_obj_clear_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
    }
  }

  lv_obj_set_style_border_color(touchReturnBtn, accent, LV_PART_MAIN);
  lv_obj_set_style_bg_color(touchReturnBtn, lv_color_mix(accent, bg, LV_OPA_60), LV_PART_MAIN);
  lv_obj_set_style_text_color(touchReturnLabel, fg, LV_PART_MAIN);
  if (screen == Screen::Home) {
    lv_obj_add_flag(touchReturnBtn, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(touchReturnBtn, LV_OBJ_FLAG_HIDDEN);
  }

  if (arcVisible) {
    lv_obj_clear_flag(valueArc, LV_OBJ_FLAG_HIDDEN);
    if (editLayout) {
      lv_obj_add_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_clear_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);
    }
    suppressArcEvent = true;
    lv_arc_set_value(valueArc, normalizedArc(arcValue, arcMin, arcMax));
    suppressArcEvent = false;
    lv_obj_set_style_arc_color(valueArc, editLayout ? lv_color_mix(axisColor, bg, LV_OPA_40)
                                                    : lv_color_mix(accent, fg, LV_OPA_30),
                               LV_PART_MAIN);
    lv_obj_set_style_arc_color(valueArc, editLayout ? axisColor : accent, LV_PART_INDICATOR);
    updateArcTicks(cur_step, true, arcMin, arcMax, arcDecimals);

    // Closed triangle marker near the arc rim (no center line).
    lv_area_t arcArea;
    lv_obj_get_coords(valueArc, &arcArea);
    const float cx = (arcArea.x1 + arcArea.x2) * 0.5f + 1.0f;
    const float cy = (arcArea.y1 + arcArea.y2) * 0.5f;
    const float r = (arcArea.x2 - arcArea.x1) * 0.5f - 6.0f;
    const float sweepDeg = (kArcBgEndDeg >= kArcBgStartDeg) ? static_cast<float>(kArcBgEndDeg - kArcBgStartDeg)
                                                             : static_cast<float>(360 - kArcBgStartDeg + kArcBgEndDeg);
    const float t = static_cast<float>(normalizedArc(arcValue, arcMin, arcMax)) / static_cast<float>(kArcRange);
    const float deg = static_cast<float>(kArcBgStartDeg) + t * sweepDeg + static_cast<float>(kTickAngleOffsetDeg);
    const float rad = (deg - 90.0f) * (3.14159265f / 180.0f);

    const float tipR = r + 6.0f;
    const float baseR = r - 20.0f;
    const float halfSpread = 0.17f;  // larger triangle marker
    const lv_coord_t tipX = static_cast<lv_coord_t>(cx + cosf(rad) * tipR);
    const lv_coord_t tipY = static_cast<lv_coord_t>(cy + sinf(rad) * tipR);
    const lv_coord_t baseLX = static_cast<lv_coord_t>(cx + cosf(rad + halfSpread) * baseR);
    const lv_coord_t baseLY = static_cast<lv_coord_t>(cy + sinf(rad + halfSpread) * baseR);
    const lv_coord_t baseRX = static_cast<lv_coord_t>(cx + cosf(rad - halfSpread) * baseR);
    const lv_coord_t baseRY = static_cast<lv_coord_t>(cy + sinf(rad - halfSpread) * baseR);

    const lv_coord_t minX = min(tipX, min(baseLX, baseRX));
    const lv_coord_t minY = min(tipY, min(baseLY, baseRY));

    lv_obj_set_pos(valuePointerTriangle, minX - 2, minY - 2);
    lv_canvas_fill_bg(valuePointerTriangle, lv_color_hex(0x000000), LV_OPA_TRANSP);
    valuePointerTrianglePoints[0].x = tipX - (minX - 2);
    valuePointerTrianglePoints[0].y = tipY - (minY - 2);
    valuePointerTrianglePoints[1].x = baseLX - (minX - 2);
    valuePointerTrianglePoints[1].y = baseLY - (minY - 2);
    valuePointerTrianglePoints[2].x = baseRX - (minX - 2);
    valuePointerTrianglePoints[2].y = baseRY - (minY - 2);

    lv_draw_rect_dsc_t triDsc;
    lv_draw_rect_dsc_init(&triDsc);
    triDsc.bg_color = lv_color_hex(0xFFD400);
    triDsc.bg_opa = LV_OPA_70;
    triDsc.border_opa = LV_OPA_TRANSP;
    triDsc.outline_opa = LV_OPA_TRANSP;
    triDsc.shadow_opa = LV_OPA_TRANSP;
    triDsc.radius = 0;
    lv_canvas_draw_polygon(valuePointerTriangle, valuePointerTrianglePoints, 3, &triDsc);
    lv_obj_clear_flag(valuePointerTriangle, LV_OBJ_FLAG_HIDDEN);

    lv_label_set_text(valueLabel, fitLine(editLayout ? signedValue(arcValue, arcDecimals) : arcText, 12).c_str());
  } else {
    lv_obj_add_flag(valueArc, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);
    updateArcTicks(cur_step, false, arcMin, arcMax, arcDecimals);
    lv_obj_add_flag(valuePointerTriangle, LV_OBJ_FLAG_HIDDEN);
  }

  String tFit = fitLine(title, 22);
  String l1Fit = fitLine(l1, arcVisible ? 20 : 24);
  String l2Fit = fitLine(l2, arcVisible ? 14 : 24);
  String l3Fit = fitLine(l3, 24);
  String l4Fit = fitLine(l4, 26);

  lv_obj_set_style_text_font(line1Label, editLayout ? &lv_font_montserrat_20 : &lv_font_montserrat_14, LV_PART_MAIN);
  lv_obj_set_style_text_font(line2Label, editLayout ? responsiveValueFont(l2Fit) : &lv_font_montserrat_14, LV_PART_MAIN);
  lv_obj_set_style_text_font(line3Label, &lv_font_montserrat_14, LV_PART_MAIN);
  lv_obj_set_style_text_color(line1Label, editLayout ? axisColor : fg, LV_PART_MAIN);
  lv_obj_set_style_text_color(line2Label, fg, LV_PART_MAIN);
  lv_obj_set_style_text_color(line3Label, editLayout ? axisColor : fg, LV_PART_MAIN);

  lv_label_set_text(titleLabel, tFit.c_str());
  lv_label_set_text(line1Label, l1Fit.c_str());
  lv_label_set_text(line2Label, l2Fit.c_str());
  lv_label_set_text(line3Label, l3Fit.c_str());
  if (l4.isEmpty() || arcVisible) {
    lv_obj_add_flag(line4Label, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(line4Label, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(line4Label, l4Fit.c_str());
  }
}

static void handleSetupRotate(int delta) {
  if (setupCursor == 0) {
    setupAxis = (setupAxis + delta + machineCfg.axes.size()) % machineCfg.axes.size();
    return;
  }
  if (setupCursor == 1) {
    setupField = (setupField + delta + setupFieldCount) % setupFieldCount;
    return;
  }
  if (setupCursor == 3) {
    setupAction = (setupAction + delta + setupActionCount) % setupActionCount;
    return;
  }
  if (setupCursor != 2) {
    return;
  }
  if (!setupEditing || delta == 0) {
    return;
  }
  viewModel.applyAdaptiveDelta(delta);
}

static void navigateBack() {
  infoLine = "";
  if (hostControlActive) {
    screen = Screen::Status;
    return;
  }
  switch (screen) {
    case Screen::Home:
      break;
    case Screen::TeachStep:
    case Screen::TeachPos:
      screen = Screen::TeachMenu;
      break;
    case Screen::ProgramRun:
      programEngine.stop(grblClient);
      screen = Screen::ProgramList;
      programStore.listPrograms(programNames);
      break;
    default:
      screen = Screen::Home;
      break;
  }
}

static void onTouchReturn(lv_event_t *e) {
  if (lv_event_get_code(e) != LV_EVENT_CLICKED) {
    return;
  }
  navigateBack();
}

static void onHomeCardClick(lv_event_t *e) {
  if (lv_event_get_code(e) != LV_EVENT_CLICKED || screen != Screen::Home) {
    return;
  }
  if (hostControlActive) {
    screen = Screen::Status;
    infoLine = "Host active: monitor mode";
    uiDirty = true;
    return;
  }

  int offset = 0;
  void *ud = lv_event_get_user_data(e);
  if (ud != nullptr) {
    offset = *static_cast<int *>(ud);
  }

  if (offset == 0) {
    onShortPress();
  } else {
    homeIndex = wrappedHomeIndex(homeIndex + offset);
    persistHomeIndex();
    uiDirty = true;
  }
}

static void onArcValueChanged(lv_event_t *e) {
  if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED || suppressArcEvent) {
    return;
  }

  float cur = 0.0f;
  float min_v = 0.0f;
  float max_v = 0.0f;
  float step = 0.1f;
  if (!viewModel.currentEdit(cur, min_v, max_v, step)) {
    return;
  }

  const int arc_val = lv_arc_get_value(static_cast<lv_obj_t *>(lv_event_get_target(e)));
  viewModel.setEditValue(denormalizeArc(arc_val, min_v, max_v));
}

static void onShortPress() {
  infoLine = "";

  if (hostControlActive) {
    if (screen == Screen::Home) {
      screen = Screen::Status;
      infoLine = "Host active: monitor mode";
      return;
    }
    if (screen == Screen::Status) {
      grblClient.sendRealtime(kOwnRequestPanelRt);
      grblClient.sendRealtime(kOwnQueryRt);
      infoLine = "Takeover requested";
      return;
    }
    infoLine = "Blocked: host monitor mode";
    return;
  }

  if (screen == Screen::Home) {
    switch (homeIndex) {
      case 0: screen = Screen::Status; break;
      case 1: screen = Screen::Setup; break;
      case 2: screen = Screen::Step; break;
      case 3: screen = Screen::Pos; break;
      case 4: screen = Screen::TeachMenu; break;
      case 5:
        programStore.listPrograms(programNames);
        programIndex = 0;
        screen = Screen::ProgramList;
        break;
      default: break;
    }
    return;
  }

  if (screen == Screen::Setup) {
    if (setupCursor < 2) {
      setupCursor++;
      return;
    }
    if (setupCursor == 2) {
      if (!setupEditing) {
        setupEditing = true;
      } else {
        setupEditing = false;
        setupCursor = 3;
      }
      return;
    }
    if (configStore.save(machineCfg)) {
      infoLine = "Config saved";
    } else {
      infoLine = "Save err";
    }
    setupCursor = 0;
    setupEditing = false;
    return;
  }

  if (screen == Screen::Step) {
    if (!panelCommandsAllowed()) {
      infoLine = "Blocked: host monitor mode";
      return;
    }
    if (fabsf(stepValue) < 0.0005f) {
      infoLine = "Step value is 0";
      return;
    }
    String queued;
    const bool sent = queueStepMove(stepAxis, stepValue, &queued);
    infoLine = sent ? ("Sent " + machineCfg.axes[stepAxis].name + " " + signedValue(stepValue, decimalsForStep(machineCfg.axes[stepAxis].step)))
                    : "Step send failed";
    if (!grblClient.lastError().isEmpty()) {
      infoLine = "GRBL " + grblClient.lastError();
    }
    if (!sent) {
      // Keep axis/value as-is on failure so the operator can retry.
      return;
    }
    ProgramStep s;
    s.mode = "step";
    s.axes.assign(machineCfg.axes.size(), 0.0f);
    s.axes[stepAxis] = stepValue;
    s.feed = machineCfg.axes[stepAxis].default_feed;
    stepAxis = (stepAxis + 1) % machineCfg.axes.size();
    stepValue = 0.0f;
    return;
  }

  if (screen == Screen::Pos) {
    if (!panelCommandsAllowed()) {
      infoLine = "Blocked: host monitor mode";
      return;
    }
    if (posAxis < static_cast<int>(machineCfg.axes.size()) - 1) {
      posAxis++;
    } else {
      const bool queued = queuePosMove(posValues);
      infoLine = queued ? "Pos move queued" : ("GRBL " + grblClient.lastError());
      if (!queued) {
        // Keep edited position values for retry after transient failures.
        return;
      }
      posAxis = 0;
    }
    return;
  }

  if (screen == Screen::TeachMenu) {
    switch (teachMenuIndex) {
      case 0:
        teachPerStep = !teachPerStep;
        infoLine = teachPerStep ? "Policy PerStep" : "Policy EndBlock";
        break;
      case 1:
        stepAxis = 0;
        stepValue = 0.0f;
        screen = Screen::TeachStep;
        break;
      case 2:
        teachPosAxis = 0;
        teachPosValues.assign(machineCfg.axes.size(), 0.0f);
        screen = Screen::TeachPos;
        break;
      case 3:
        saveTeachProgram();
        break;
      case 4:
        teachBuffer.steps.clear();
        teachBuffer.name = "";
        teachCombined.assign(machineCfg.axes.size(), 0.0f);
        infoLine = "Teach buffer cleared";
        break;
      case 5:
        screen = Screen::Home;
        break;
      default:
        break;
    }
    return;
  }

  if (screen == Screen::TeachStep) {
    if (!panelCommandsAllowed()) {
      infoLine = "Blocked: host monitor mode";
      return;
    }
    if (fabsf(stepValue) < 0.0005f) {
      infoLine = "Step value is 0";
      return;
    }
    const bool queued = queueStepMove(stepAxis, stepValue);
    if (!queued) {
      infoLine = "GRBL " + grblClient.lastError();
      return;
    }
    ProgramStep s;
    s.mode = "step";
    s.axes.assign(machineCfg.axes.size(), 0.0f);
    s.axes[stepAxis] = stepValue;
    s.feed = machineCfg.axes[stepAxis].default_feed;
    s.comment = "teach-step";
    recordTeachStep(s);
    stepAxis = (stepAxis + 1) % machineCfg.axes.size();
    stepValue = 0.0f;
    return;
  }

  if (screen == Screen::TeachPos) {
    if (!panelCommandsAllowed()) {
      infoLine = "Blocked: host monitor mode";
      return;
    }
    if (teachPosAxis < static_cast<int>(machineCfg.axes.size()) - 1) {
      teachPosAxis++;
    } else {
      if (!queuePosMove(teachPosValues)) {
        infoLine = "GRBL " + grblClient.lastError();
        return;
      }
      ProgramStep s;
      s.mode = "pos";
      s.axes = teachPosValues;
      s.feed = machineCfg.max_feed_rate;
      s.comment = "teach-pos";
      recordTeachStep(s);
      teachPosAxis = 0;
      teachPosValues.assign(machineCfg.axes.size(), 0.0f);
      infoLine = "Teach pos recorded";
    }
    return;
  }

  if (screen == Screen::ProgramList) {
    if (programIndex == 0) {
      screen = Screen::Home;
      return;
    }
    if (programNames.empty()) {
      return;
    }
    ProgramData p;
    if (!programStore.loadProgram(programNames[programIndex - 1], p, machineCfg.axes)) {
      infoLine = "Load err";
      return;
    }
    programEngine.start(p);
    screen = Screen::ProgramRun;
    return;
  }

  if (screen == Screen::ProgramRun) {
    if (programEngine.state() == ProgramEngine::State::Running) {
      programEngine.pause(grblClient);
    } else if (programEngine.state() == ProgramEngine::State::Paused) {
      programEngine.resume(grblClient);
    }
    return;
  }
}

static void onLongPress() {
  navigateBack();
}

static void handleInput() {
  int delta = encoderDelta();
  ButtonEvent ev = buttonEvent();

  if (screen == Screen::Home && delta != 0) {
    homeIndex = (homeIndex + delta + homeCount) % homeCount;
    persistHomeIndex();
    uiDirty = true;
  } else if (screen == Screen::Setup && delta != 0) {
    handleSetupRotate(delta);
    uiDirty = true;
  } else if ((screen == Screen::Step || screen == Screen::TeachStep || screen == Screen::Pos || screen == Screen::TeachPos) && delta != 0) {
    viewModel.applyAdaptiveDelta(delta);
  } else if (screen == Screen::TeachMenu && delta != 0) {
    int count = 6;
    teachMenuIndex = (teachMenuIndex + delta + count) % count;
    uiDirty = true;
  } else if (screen == Screen::ProgramList && delta != 0 && !programNames.empty()) {
    int count = static_cast<int>(programNames.size()) + 1; // includes Return
    programIndex = (programIndex + delta + count) % count;
    uiDirty = true;
  } else if (screen == Screen::ProgramList && delta != 0 && programNames.empty()) {
    programIndex = 0;
    uiDirty = true;
  }

  if (ev == ButtonEvent::ShortPress) {
    onShortPress();
    uiDirty = true;
  } else if (ev == ButtonEvent::LongPress) {
    onLongPress();
    uiDirty = true;
  }
}

static void lvglFlush(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color_p) {
  const int32_t w = area->x2 - area->x1 + 1;
  const int32_t h = area->y2 - area->y1 + 1;
  gfx.startWrite();
  gfx.setAddrWindow(area->x1, area->y1, w, h);
  gfx.writePixels(reinterpret_cast<lgfx::rgb565_t *>(color_p), w * h);
  gfx.endWrite();
  lv_disp_flush_ready(disp);
}

static void touchRead(lv_indev_drv_t *driver, lv_indev_data_t *data) {
  (void)driver;
  static uint16_t lastTouchX = 0;
  static uint16_t lastTouchY = 0;
  static bool lastTouchPressed = false;
  uint16_t x = 0;
  uint16_t y = 0;
  if (!touch.readTouch(x, y)) {
    lastTouchPressed = false;
    data->state = LV_INDEV_STATE_REL;
    return;
  }

  if (x > 239) x = 239;
  if (y > 239) y = 239;

  data->state = LV_INDEV_STATE_PR;
  data->point.x = x;
  data->point.y = y;
  if (!lastTouchPressed || x != lastTouchX || y != lastTouchY) {
    lastTouchPressed = true;
    lastTouchX = x;
    lastTouchY = y;
  }
}

static void displaySelfTest() {
  Serial.println("Display self-test start");
  const uint16_t colors[] = {0xF800, 0x07E0, 0x001F, 0xFFFF, 0x0000}; // R,G,B,W,Black
  for (uint8_t i = 0; i < sizeof(colors) / sizeof(colors[0]); i++) {
    gfx.fillScreen(colors[i]);
    delay(220);
  }

  // Backlight polarity probe for unknown hardware revisions.
  gfx.fillScreen(0xFFFF);
  Serial.println("BL probe: HIGH");
  digitalWrite(LCD_PIN_BL, HIGH);
  delay(1200);
  Serial.println("BL probe: LOW");
  digitalWrite(LCD_PIN_BL, LOW);
  delay(1200);
  Serial.println("BL probe: HIGH restore");
  digitalWrite(LCD_PIN_BL, HIGH);
  delay(400);

  gfx.fillScreen(0xFFFF);
  gfx.setTextColor(0x0000, 0xFFFF);
  gfx.setTextSize(2);
  gfx.setCursor(12, 16);
  gfx.print("CrowPanel");
  gfx.setCursor(12, 44);
  gfx.print("Display OK?");
  delay(300);
  Serial.println("Display self-test end");
}

void setup() {
  Serial.begin(115200);
  delay(150);
  Serial.println("CrowPanel offline HMI boot");

  pinMode(ENCODER_PIN_A, INPUT_PULLUP);
  pinMode(ENCODER_PIN_B, INPUT_PULLUP);
  pinMode(ENCODER_PIN_SW, INPUT_PULLUP);
  encoderIsrState = static_cast<uint8_t>(((digitalRead(ENCODER_PIN_A) & 0x1) << 1) | (digitalRead(ENCODER_PIN_B) & 0x1));
  attachInterrupt(digitalPinToInterrupt(ENCODER_PIN_A), encoderISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_PIN_B), encoderISR, CHANGE);
  // Match Elecrow factory power sequencing for panel compatibility.
  pinMode(1, OUTPUT);
  pinMode(2, OUTPUT);
  pinMode(POWER_LIGHT_PIN, OUTPUT);
  pinMode(LCD_PIN_BL, OUTPUT);
  digitalWrite(1, HIGH);
  digitalWrite(2, HIGH);
  digitalWrite(POWER_LIGHT_PIN, LOW);
  digitalWrite(LCD_PIN_BL, HIGH);
  touch.begin();

  gfx.init();
  gfx.setRotation(0);
  displaySelfTest();

  lv_init();
  lv_disp_draw_buf_init(&drawBuf, drawPixels, nullptr, 240 * 24);
  static lv_disp_drv_t dispDrv;
  lv_disp_drv_init(&dispDrv);
  dispDrv.hor_res = 240;
  dispDrv.ver_res = 240;
  dispDrv.flush_cb = lvglFlush;
  dispDrv.draw_buf = &drawBuf;
  lv_disp_drv_register(&dispDrv);

  static lv_indev_drv_t indevDrv;
  lv_indev_drv_init(&indevDrv);
  indevDrv.type = LV_INDEV_TYPE_POINTER;
  indevDrv.read_cb = touchRead;
  lv_indev_drv_register(&indevDrv);

  uiAdapter.begin();

  configStore.begin();
  if (!configStore.load(machineCfg)) {
    machineCfg = configStore.defaultConfig();
    configStore.save(machineCfg);
  }
  uiPrefs.begin("crowpanel", false);
  homeIndex = wrappedHomeIndex(uiPrefs.getInt("home_idx", homeIndex));
  savedHomeIndex = homeIndex;
  posValues.assign(machineCfg.axes.size(), 0.0f);
  teachCombined.assign(machineCfg.axes.size(), 0.0f);
  teachPosValues.assign(machineCfg.axes.size(), 0.0f);

  programStore.begin();
  programStore.listPrograms(programNames);

  GrblSerial.begin(GRBL_UART_BAUD, SERIAL_8N1, GRBL_UART_RX_PIN, GRBL_UART_TX_PIN);
  grblClient.begin(&GrblSerial, &grblParser);
  grblClient.setMotionAllowed(true);
  grblClient.sendRealtime(kOwnQueryRt);
}

void loop() {
  grblClient.update();
  updateOwnershipFromStatus();
  handleInput();

  uint32_t now = millis();
  if (hostControlActive) {
    if (programEngine.state() != ProgramEngine::State::Stopped) {
      programEngine.stop(grblClient);
    }
    if (screen != Screen::Status) {
      screen = Screen::Status;
      infoLine = "Host active: monitor mode";
      uiDirty = true;
    }
  }
  programEngine.update(grblClient, machineCfg.axes);

  if (now - lastStatusMs > 200) {
    grblClient.requestStatus();
    lastStatusMs = now;
  }

  if (uiDirty || (now - lastUiMs > 33)) {
    if (programEngine.state() == ProgramEngine::State::Stopped && screen == Screen::ProgramRun) {
      screen = Screen::ProgramList;
      programStore.listPrograms(programNames);
      uiDirty = true;
    }
    uiAdapter.render();
    lastUiMs = now;
    uiDirty = false;
  }

  lv_timer_handler();
  delay(5);
}
