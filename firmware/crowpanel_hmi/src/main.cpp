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
#include "vertical_menu.h"

static CrowPanelLGFX gfx;
static HardwareSerial GrblSerial(1);
static GrblParser grblParser;
static GrblClient grblClient;
static ConfigStore configStore;
static ProgramStore programStore;
static ProgramEngine programEngine;
static ProfileSet profileSet;
static MachineConfig machineCfg;
static Preferences uiPrefs;

static int activeProfileIdx() {
  for (size_t i = 0; i < profileSet.profiles.size(); i++) {
    if (profileSet.profiles[i].name == profileSet.activeName) {
      return static_cast<int>(i);
    }
  }
  return profileSet.profiles.empty() ? -1 : 0;
}

static void syncMachineCfgFromActive() {
  int idx = activeProfileIdx();
  if (idx >= 0) {
    machineCfg = profileSet.profiles[idx].config;
    if (profileSet.activeName.isEmpty()) {
      profileSet.activeName = profileSet.profiles[idx].name;
    }
  }
}

static bool persistActiveProfile() {
  int idx = activeProfileIdx();
  if (idx < 0) return false;
  profileSet.profiles[idx].config = machineCfg;
  return configStore.saveAll(profileSet);
}

static lv_disp_draw_buf_t drawBuf;
static lv_color_t drawPixels[240 * 24];
static lv_obj_t *titleLabel = nullptr;
static lv_obj_t *subTitleLabel = nullptr;
static lv_obj_t *line1Label = nullptr;
static lv_obj_t *line2Label = nullptr;
static lv_obj_t *line3Label = nullptr;
static lv_obj_t *line4Label = nullptr;
static lv_obj_t *modeIconLabel = nullptr;
static lv_obj_t *valueArc = nullptr;
static lv_obj_t *valueLabel = nullptr;
static lv_obj_t *touchReturnBtn = nullptr;
static lv_obj_t *touchReturnLabel = nullptr;
// Home ring: one button + caption per menu item (sized at homeCount, see below).
static lv_obj_t *homeCardButtons[4] = {nullptr, nullptr, nullptr, nullptr};
static lv_obj_t *homeCardIcons[4] = {nullptr, nullptr, nullptr, nullptr};
static lv_obj_t *homeCardLabels[4] = {nullptr, nullptr, nullptr, nullptr};
// Per-axis position rows shown in the centre of Home (and Status).  Each row is
// a spangroup with a value span (default font) and a smaller, muted unit span.
static lv_obj_t *positionStackSpans[3] = {nullptr, nullptr, nullptr};
static lv_span_t *positionStackValueSpan[3] = {nullptr, nullptr, nullptr};
static lv_span_t *positionStackUnitSpan[3] = {nullptr, nullptr, nullptr};
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
  SetupProfile,
  SetupProfileSelect,
  SetupAxes,
  SetupDriver,
  Step,
  StepActions,
  StepSaveTarget,
  StepSaveMode,
  StepSaveDelete,
  ProgramList,
  ProgramRun
};

enum class ButtonEvent { None, ShortPress, LongPress };

// Reusable description of a circular value-edit scale.
// `display*` define the arc visualization range; `clamp*` define the actually
// writable range (which can extend past the display via touch but not via
// encoder/touch beyond the limit). Use ±INFINITY for an unlimited side.
struct EditScale {
  float value = 0.0f;
  float displayMin = -1.0f;
  float displayMax = 1.0f;
  float clampMin = -1.0f;
  float clampMax = 1.0f;
  float baseStep = 0.1f;   // encoder step
  float tickStep = 0.0f;   // 0 -> auto (tickCountForStep heuristic)
  int decimals = 1;
  bool centerZero = true;  // if true and 0 is inside the range, keep 0 centered
  bool minOpen = false;    // unlimited on the lower side
  bool maxOpen = false;    // unlimited on the upper side
  bool showTickLabels = true;
  bool showValueLabel = true;
};

static Screen screen = Screen::Home;
static uint32_t lastStatusMs = 0;
static uint32_t lastUiMs = 0;

static int homeIndex = 0;
static const char *homeItems[] = {"Status", "Setup", "Step", "Program"};
static const int homeCount = sizeof(homeItems) / sizeof(homeItems[0]);
static int savedHomeIndex = -1;

static int setupMenuIndex = 0;
static const char *setupMenuItems[] = {"Profile", "Axes", "Driver"};
static const int setupMenuCount = sizeof(setupMenuItems) / sizeof(setupMenuItems[0]);

// SetupProfile: cursor on Add/Del/Set/Push submenu
static int setupProfileMenuIndex = 0;
static const char *profileMenuItems[] = {"Add Profile", "Del Profile", "Set Profile", "Push GRBL"};
static const int profileMenuItemCount = sizeof(profileMenuItems) / sizeof(profileMenuItems[0]);

enum class ProfileSelectMode { Del, Set };
static ProfileSelectMode profileSelectMode = ProfileSelectMode::Set;
static int profileSelectIndex = 0;

// SetupAxes: cursor 0 = axis list, 1 = field list, 2 = editing
static int setupAxesCursor = 0;
static int setupAxesAxis = 0;
static int setupAxesField = 0;
static bool setupAxesEditing = false;
static const char *setupAxesFields[] = {
    "min", "max", "scale", "maxRate", "accel",
    "type", "parent", "invert"};
static const int setupAxesFieldCount = sizeof(setupAxesFields) / sizeof(setupAxesFields[0]);

// SetupDriver: cursor 0 = field list, 1 = editing
static int setupDriverField = 0;
static int setupDriverCursor = 0;
static bool setupDriverEditing = false;
static const char *setupDriverFields[] = {
    "motorHold", "invert", "opMode"};
static const int setupDriverFieldCount = sizeof(setupDriverFields) / sizeof(setupDriverFields[0]);

static int stepAxis = 0;
static float stepValue = 0.0f;
static std::vector<float> stepValues;
static bool stepFeedEdit = false;

// MPG mode (Step screen) "throttle" state. The arc no longer represents a
// position to jog to; instead its value is the requested jog rate (signed
// mm/min). While the user touches the arc, the loop streams short jog chunks
// at that rate; lifting the finger sends a jog cancel and snaps back to 0.
static float    mpgJogRate = 0.0f;
static float    mpgLastSentRate = 0.0f;
static bool     mpgJogActive = false;
static uint32_t mpgLastJogMs = 0;

static int stepActionIndex = 0;
static const char *stepActionItems[] = {"Next Step", "Save"};
static const int stepActionCount = sizeof(stepActionItems) / sizeof(stepActionItems[0]);

static int saveProgramIndex = 0;
static int saveModeIndex = 0;
static const char *saveModes[] = {"Append", "Overwrite"};
static const int saveModeCount = sizeof(saveModes) / sizeof(saveModes[0]);
// Selected program name for the StepSaveMode screen (existing program or
// freshly auto-generated name when "New program" was picked).
static String saveTargetName;
// Cursor for the StepSaveDelete sub-list.
static int saveDeleteIndex = 0;

static ProgramData teachBuffer;
static std::vector<float> teachCombined;

static int programIndex = 0;
static std::vector<String> programNames;
static String infoLine;
static bool hostControlActive = false;
static String lastOwner = "none";
static String lastOwnerReason = "";
// MPG mode is now automatically coupled to ownership in grblHAL protocol.c
static constexpr uint8_t kOwnRequestPanelRt = 0x8E;
static constexpr uint8_t kOwnQueryRt = 0xA5;
// kMpgToggleRt removed: MPG mode is coupled to ownership in grblHAL
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
  return s == Screen::Step;
}

static bool shouldShowArc(Screen s) {
  if (isEditScreen(s)) {
    return true;
  }
  if (s == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing) {
    return true;
  }
  if (s == Screen::SetupDriver && setupDriverCursor == 1 && setupDriverEditing) {
    return true;
  }
  return false;
}

static const char *screenIcon(Screen s) {
  switch (s) {
    case Screen::Home: return "HOME";
    case Screen::Status: return "STAT";
    case Screen::Setup: return "SET";
    case Screen::SetupProfile: return "PROF";
    case Screen::SetupProfileSelect: return "PROF";
    case Screen::SetupAxes: return "AXES";
    case Screen::SetupDriver: return "DRV";
    case Screen::Step: return "STEP";
    case Screen::StepActions: return "ACT";
    case Screen::StepSaveTarget: return "SAVE";
    case Screen::StepSaveMode: return "MODE";
    case Screen::StepSaveDelete: return "DEL";
    case Screen::ProgramList: return "PROG";
    case Screen::ProgramRun: return "RUN";
  }
  return "UI";
}

static const char *homeItemSymbol(int idx) {
  switch (idx) {
    case 0: return LV_SYMBOL_LIST;      // Status
    case 1: return LV_SYMBOL_SETTINGS;  // Setup
    case 2: return LV_SYMBOL_SHUFFLE;   // Step
    case 3: return LV_SYMBOL_PLAY;      // Program
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
  // 4 menu items pinned at the cardinal slots: north/east/south/west.
  // Slot positions are fixed (no rotation around the active item); the
  // active slot is communicated only through colour (handled by the
  // render branch).  Render-deg convention: 0=N (top), 90=E (right),
  // 180=S (bottom), 270=W (left).
  static const float slotAngleDeg[4] = {0.0f, 90.0f, 180.0f, 270.0f};
  static const lv_coord_t ringRadius = 84;
  static const lv_coord_t cardSize = 64;
  static const lv_coord_t labelOffset = cardSize / 2 + 14;

  for (int i = 0; i < homeCount; i++) {
    if (!homeCardButtons[i] || !homeCardIcons[i] || !homeCardLabels[i]) {
      continue;
    }
    const float rad = (slotAngleDeg[i] - 90.0f) * (3.14159265f / 180.0f);
    const lv_coord_t dx = static_cast<lv_coord_t>(cosf(rad) * static_cast<float>(ringRadius));
    const lv_coord_t dy = static_cast<lv_coord_t>(sinf(rad) * static_cast<float>(ringRadius));

    lv_label_set_text(homeCardIcons[i], homeItemSymbol(i));
    lv_label_set_text(homeCardLabels[i], fitLine(homeItems[i], 10).c_str());

    lv_obj_set_size(homeCardButtons[i], cardSize, cardSize);
    lv_obj_align(homeCardButtons[i], LV_ALIGN_CENTER, dx, dy);
    lv_obj_set_style_text_font(homeCardIcons[i], &lv_font_montserrat_24, LV_PART_MAIN);

    // Caption position relative to the icon: usually directly below, but
    //  - the bottom (Step) icon's caption goes ABOVE so it doesn't fall off
    //    the screen edge,
    //  - the left (Program) icon's caption is nudged a few pixels to the
    //    right so the descender of the lower-case "p" isn't clipped by the
    //    screen edge.
    lv_coord_t labelDx = dx;
    lv_coord_t labelDy = static_cast<lv_coord_t>(dy + labelOffset);
    if (i == 2) {  // Step (bottom)
      labelDy = static_cast<lv_coord_t>(dy - labelOffset);
    } else if (i == 3) {  // Program (left)
      labelDx = static_cast<lv_coord_t>(dx + 6);
    }
    lv_obj_align(homeCardLabels[i], LV_ALIGN_CENTER, labelDx, labelDy);
    lv_obj_set_style_text_font(homeCardLabels[i],
                               &lv_font_montserrat_14,
                               LV_PART_MAIN);
  }
}

static UiPalette paletteForScreen(Screen s) {
  switch (s) {
    case Screen::Home: return {0x10263A, 0xEAF4FF, 0x3BC1FF};
    case Screen::Status: return {0x1E2630, 0xEAF4FF, 0x55E39F};
    case Screen::Setup: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupProfile: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupProfileSelect: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupAxes: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupDriver: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::Step: return {0x233229, 0xEDFFF2, 0x5FFB92};
    case Screen::StepActions: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::StepSaveTarget: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::StepSaveMode: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::StepSaveDelete: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::ProgramList:
    case Screen::ProgramRun: return {0x1E3130, 0xE9FFFD, 0x3EE9D7};
  }
  return {0x101010, 0xFFFFFF, 0x8FD3FF};
}

static int currentEditAxisIndex() {
  if (screen == Screen::Step) {
    return stepAxis;
  }
  if (screen == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing) {
    return setupAxesAxis;
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

// Build a Step-screen scale for the given axis and current value.
// - When both limits are defined: arc symmetric around 0 (12 o'clock), but
//   value is clamped to [a.min, a.max] (the smaller side is unreachable).
// - When only one side is open: arc expands symmetrically around 0 as the
//   value moves; the limited side still clamps the value.
// - When both sides are open: arc grows symmetrically around the value (legacy
//   behaviour) and the value is unbounded.
static EditScale axisStepScale(const AxisConfig &a, float value) {
  EditScale s;
  s.value = value;
  s.baseStep = normalizedStepSize(a.step);
  s.tickStep = 0.0f;  // auto via tickCountForStep heuristic
  s.decimals = decimalsForStep(s.baseStep);
  s.centerZero = true;
  s.minOpen = !a.has_min_limit;
  s.maxOpen = !a.has_max_limit;
  s.showTickLabels = true;
  s.showValueLabel = true;

  if (a.has_min_limit && a.has_max_limit) {
    s.clampMin = a.min;
    s.clampMax = a.max;
    float absMax = max(fabsf(a.min), fabsf(a.max));
    if (absMax < 10.0f) absMax = 10.0f;
    s.displayMin = -absMax;
    s.displayMax = absMax;
  } else {
    s.clampMin = a.has_min_limit ? a.min : -INFINITY;
    s.clampMax = a.has_max_limit ? a.max : INFINITY;
    float span = max(fabsf(value) + 100.0f, 100.0f);
    if (a.has_min_limit) span = max(span, fabsf(a.min) + 50.0f);
    if (a.has_max_limit) span = max(span, fabsf(a.max) + 50.0f);
    s.displayMin = -span;
    s.displayMax = span;
  }
  return s;
}

// Setup screen min/max field scale: symmetric, no value clamp (long-press
// toggles the no-limit flag instead).
static EditScale setupMinMaxScale(const AxisConfig &a, float value) {
  EditScale s;
  s.value = value;
  float absMax = max(fabsf(a.min), fabsf(a.max));
  if (absMax < 10.0f) absMax = 10.0f;
  float margin = absMax * 0.3f;
  s.displayMin = -(absMax + margin);
  s.displayMax = absMax + margin;
  s.clampMin = -INFINITY;
  s.clampMax = INFINITY;
  s.baseStep = 0.5f;
  s.tickStep = 0.0f;
  s.decimals = 1;
  s.centerZero = true;
  s.minOpen = true;
  s.maxOpen = true;
  s.showTickLabels = true;
  s.showValueLabel = true;
  return s;
}

// Feed-rate scale parameterised by [min_v..max_v] window. Suitable for both
// the per-axis Step feed-edit (1..axis.max_rate) and the global driver
// default-feed editor (50..driver max).
static EditScale feedRateScale(float value, float min_v, float max_v) {
  EditScale s;
  s.value = value;
  if (max_v < min_v + 1.0f) max_v = min_v + 1.0f;
  s.displayMin = min_v;
  s.displayMax = max_v;
  s.clampMin = min_v;
  s.clampMax = max_v;
  // Encoder step ~1% of the range, but at least 1.
  float range = max_v - min_v;
  float bs = range / 200.0f;
  if (bs < 1.0f) bs = 1.0f;
  s.baseStep = bs;
  s.tickStep = 0.0f;
  s.decimals = 0;
  s.centerZero = false;
  s.minOpen = false;
  s.maxOpen = false;
  s.showTickLabels = false;  // wide range, label clutter is heavy
  s.showValueLabel = true;
  return s;
}

// MPG-throttle scale for the Step screen. The arc maps -feed..+feed mm/min,
// where feed is the axis feed-override (fallback: default_feed). The value
// label is suppressed because the value row is repurposed to display the
// current axis position.
static EditScale mpgRateScale(const AxisConfig &a) {
  EditScale s;
  float feed = a.has_feed_override ? a.feed_override : a.default_feed;
  if (feed < 100.0f) feed = 100.0f;
  s.value = mpgJogRate;
  s.displayMin = -feed; s.displayMax = feed;
  s.clampMin   = -feed; s.clampMax   = feed;
  s.baseStep = max(1.0f, feed / 100.0f);
  s.tickStep = feed / 4.0f;
  s.decimals = 0;
  s.centerZero    = true;
  s.minOpen = false;
  s.maxOpen = false;
  s.showTickLabels = true;
  s.showValueLabel = false;
  return s;
}

static bool setupAxesFieldScale(const AxisConfig &a, int field, EditScale &out) {
  EditScale s;
  switch (field) {
    case 0: { // min
      if (!a.has_min_limit) return false;
      out = setupMinMaxScale(a, a.min);
      return true;
    }
    case 1: { // max
      if (!a.has_max_limit) return false;
      out = setupMinMaxScale(a, a.max);
      return true;
    }
    case 2: // scale 0.1 .. 10 (non-negative; 0 not a valid centre)
      s.value = a.scale;
      s.displayMin = 0.1f; s.displayMax = 10.0f;
      s.clampMin = 0.1f;   s.clampMax = 10.0f;
      s.baseStep = 0.05f;  s.tickStep = 1.0f;
      s.decimals = 2;
      s.centerZero = false;
      s.showTickLabels = true;
      out = s; return true;
    case 3: // maxRate
      s.value = a.max_rate;
      s.displayMin = 100.0f; s.displayMax = 100000.0f;
      s.clampMin = 100.0f;   s.clampMax = 100000.0f;
      s.baseStep = 100.0f;   s.tickStep = 10000.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
    case 4: // accel
      s.value = a.acceleration;
      s.displayMin = 10.0f;  s.displayMax = 50000.0f;
      s.clampMin = 10.0f;    s.clampMax = 50000.0f;
      s.baseStep = 50.0f;    s.tickStep = 5000.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
    case 5: // type (linear=0, rotary=1)
      s.value = a.type == "rotary" ? 1.0f : 0.0f;
      s.displayMin = 0.0f; s.displayMax = 1.0f;
      s.clampMin = 0.0f;   s.clampMax = 1.0f;
      s.baseStep = 1.0f;   s.tickStep = 1.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
    case 6: // parent (0=none, 1..N=axis index)
      s.value = 0.0f;
      for (size_t i = 0; i < machineCfg.axes.size(); i++) {
        if (machineCfg.axes[i].name == a.parent) { s.value = static_cast<float>(i + 1); break; }
      }
      s.displayMin = 0.0f;
      s.displayMax = static_cast<float>(max(static_cast<int>(machineCfg.axes.size()), 1));
      s.clampMin = 0.0f;
      s.clampMax = s.displayMax;
      s.baseStep = 1.0f;
      s.tickStep = 1.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
    case 7: // invert toggle
      s.value = a.invert ? 1.0f : 0.0f;
      s.displayMin = 0.0f; s.displayMax = 1.0f;
      s.clampMin = 0.0f;   s.clampMax = 1.0f;
      s.baseStep = 1.0f;   s.tickStep = 1.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
  }
  return false;
}

static bool setupDriverFieldScale(int field, EditScale &out) {
  EditScale s;
  switch (field) {
    case 0: // motorHold 0..255
      s.value = machineCfg.motor_hold;
      s.displayMin = 0.0f; s.displayMax = 255.0f;
      s.clampMin = 0.0f;   s.clampMax = 255.0f;
      s.baseStep = 1.0f;   s.tickStep = 32.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = true;
      out = s; return true;
    case 1: // invert toggle
      s.value = machineCfg.enable_invert ? 1.0f : 0.0f;
      s.displayMin = 0.0f; s.displayMax = 1.0f;
      s.clampMin = 0.0f;   s.clampMax = 1.0f;
      s.baseStep = 1.0f;   s.tickStep = 1.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
    case 2: // opMode 0..2
      s.value = machineCfg.operation_mode == "parallel" ? 1.0f
              : (machineCfg.operation_mode == "mpg" ? 2.0f : 0.0f);
      s.displayMin = 0.0f; s.displayMax = 2.0f;
      s.clampMin = 0.0f;   s.clampMax = 2.0f;
      s.baseStep = 1.0f;   s.tickStep = 1.0f;
      s.decimals = 0;
      s.centerZero = false;
      s.showTickLabels = false;
      out = s; return true;
  }
  return false;
}

static bool currentEditScale(EditScale &out) {
  if (screen == Screen::Step) {
    if (stepFeedEdit) {
      const AxisConfig &a = machineCfg.axes[stepAxis];
      float cur = a.has_feed_override ? a.feed_override : a.default_feed;
      out = feedRateScale(cur, 1.0f, max(2.0f, a.max_rate));
      return true;
    }
    const AxisConfig &a = machineCfg.axes[stepAxis];
    if (machineCfg.operation_mode == "mpg") {
      out = mpgRateScale(a);
      return true;
    }
    float v = (machineCfg.operation_mode == "serial")
                ? stepValue
                : (stepValues.empty() ? 0.0f : stepValues[stepAxis]);
    out = axisStepScale(a, v);
    return true;
  }
  if (screen == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing) {
    return setupAxesFieldScale(machineCfg.axes[setupAxesAxis], setupAxesField, out);
  }
  if (screen == Screen::SetupDriver && setupDriverCursor == 1 && setupDriverEditing) {
    return setupDriverFieldScale(setupDriverField, out);
  }
  return false;
}

// Backward-compat shim: returns display range only (used by callers that
// don't need clamp/tick metadata).
static bool currentEditValue(float &value, float &min_v, float &max_v, float &base_step) {
  EditScale s;
  if (!currentEditScale(s)) return false;
  value = s.value;
  min_v = s.displayMin;
  max_v = s.displayMax;
  base_step = s.baseStep;
  return true;
}

static void writeCurrentEditValue(float value) {
  EditScale s;
  if (!currentEditScale(s)) return;

  if (screen == Screen::Step) {
    if (stepFeedEdit) {
      AxisConfig &a = machineCfg.axes[stepAxis];
      a.has_feed_override = true;
      a.feed_override = clampf(max(1.0f, value), s.clampMin, s.clampMax);
    } else if (machineCfg.operation_mode == "serial") {
      stepValue = snapToStep(value, s.baseStep, s.clampMin, s.clampMax);
    } else if (machineCfg.operation_mode == "mpg") {
      mpgJogRate = clampf(value, s.clampMin, s.clampMax);
      mpgJogActive = true;
    } else {
      if (stepAxis < static_cast<int>(stepValues.size()))
        stepValues[stepAxis] = snapToStep(value, s.baseStep, s.clampMin, s.clampMax);
    }
    uiDirty = true;
    return;
  }

  if (screen == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing) {
    AxisConfig &a = machineCfg.axes[setupAxesAxis];
    const float v = clampf(value, s.clampMin, s.clampMax);
    switch (setupAxesField) {
      case 0: a.min = value; break;          // free during edit, no-limit toggled by long-press
      case 1: a.max = value; break;
      case 2: a.scale = v; break;
      case 3: a.max_rate = max(100.0f, v); break;
      case 4: a.acceleration = max(10.0f, v); break;
      case 5: a.type = v >= 0.5f ? "rotary" : "linear"; break;
      case 6: {
        int idx = static_cast<int>(v + 0.5f);
        a.parent = (idx <= 0 || idx > static_cast<int>(machineCfg.axes.size())) ? "" : machineCfg.axes[idx - 1].name;
        break;
      }
      case 7: a.invert = v >= 0.5f; break;
    }
    uiDirty = true;
    return;
  }

  if (screen == Screen::SetupDriver && setupDriverCursor == 1 && setupDriverEditing) {
    const float v = clampf(value, s.clampMin, s.clampMax);
    switch (setupDriverField) {
      case 0: machineCfg.motor_hold = v; break;
      case 1: machineCfg.enable_invert = v >= 0.5f; break;
      case 2: {
        int m = static_cast<int>(v + 0.5f);
        machineCfg.operation_mode = m == 1 ? "parallel" : (m == 2 ? "mpg" : "serial");
        break;
      }
    }
    uiDirty = true;
    return;
  }
}

static bool isToggleField() {
  if (screen == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing) {
    return setupAxesField == 5 || setupAxesField == 7;
  }
  if (screen == Screen::SetupDriver && setupDriverCursor == 1 && setupDriverEditing) {
    return setupDriverField == 1 || setupDriverField == 2;
  }
  return false;
}

static float effectiveFeed(const AxisConfig &a);

static void applyAdaptiveEditDelta(int encoder_delta) {
  EditScale s;
  if (!currentEditScale(s)) {
    return;
  }

  lastEncoderChangeMs = millis();

  if (isToggleField()) {
    float next = s.value + (encoder_delta > 0 ? 1.0f : -1.0f);
    writeCurrentEditValue(clampf(next, s.clampMin, s.clampMax));
    return;
  }

  if (screen == Screen::Step && machineCfg.operation_mode == "mpg" && !stepFeedEdit) {
    const AxisConfig &a = machineCfg.axes[stepAxis];
    float rate = effectiveFeed(a);
    // The current scale `s` is now the throttle scale (mpgRateScale) where
    // baseStep is in mm/min units; the encoder must still produce a discrete
    // distance jog, so use the axis distance step from axisStepScale.
    EditScale legacy = axisStepScale(a, 0.0f);
    float delta = static_cast<float>(encoder_delta) * legacy.baseStep;
    float jval = delta * (a.invert ? -1.0f : 1.0f) * a.scale;
    String cmd = "$J=G91 G21 " + a.name + String(jval, 3) + " F" + String(rate, 1);
    grblClient.queueLine(cmd);
    uiDirty = true;
    return;
  }

  const float delta = static_cast<float>(encoder_delta) * s.baseStep;
  writeCurrentEditValue(clampf(s.value + delta, s.clampMin, s.clampMax));
}

static int tickCountForStep(float step) {
  // Always keep 5-way subdivision: 1 major + 4 micro markers.
  if (step >= 5.0f) return 31;    // 30 intervals
  if (step >= 1.0f) return 61;    // 60 intervals
  if (step >= 0.1f) return 91;    // 90 intervals
  if (step >= 0.01f) return 121;  // 120 intervals
  return 121;
}

// Compute the number of visible tick lines for the given scale.
// 5x subdivision is preserved (1 major + 4 micro per major segment).
static int visibleTickCountForScale(const EditScale &s) {
  if (s.tickStep > 0.0f) {
    const float range = s.displayMax - s.displayMin;
    int majors = static_cast<int>(roundf(range / s.tickStep));
    if (majors < 1) majors = 1;
    int total = majors * 5 + 1;
    if (total > kArcTickCount) total = kArcTickCount;
    return total;
  }
  return tickCountForStep(s.baseStep);
}

// Render the arc tick marks and (optionally) their labels for the supplied
// scale. When `visible` is false the ticks are hidden but state still
// recomputed so a follow-up show is correctly positioned.
static void updateArcTicks(const EditScale &s, bool visible) {
  lv_area_t arcArea;
  lv_obj_get_coords(valueArc, &arcArea);
  const float cx = (arcArea.x1 + arcArea.x2) * 0.5f + 1.0f;
  const float cy = (arcArea.y1 + arcArea.y2) * 0.5f;
  const float outerR = (arcArea.x2 - arcArea.x1) * 0.5f + 1.0f;
  const int visibleCount = visibleTickCountForScale(s);
  const int majorStride = 5;
  const int sweepDeg = (kArcBgEndDeg >= kArcBgStartDeg) ? (kArcBgEndDeg - kArcBgStartDeg)
                                                         : (360 - kArcBgStartDeg + kArcBgEndDeg);

  // Decide which tick(s) deserve the largest emphasis.
  // For centered scales: -1/3, 0, +1/3 of range as before; for non-centered
  // scales: only the edges.
  int idxNeg = -1;
  int idxZero = -1;
  int idxPos = -1;
  if (s.centerZero && s.displayMin < 0.0f && s.displayMax > 0.0f) {
    idxNeg = static_cast<int>(roundf((visibleCount - 1) / 6.0f));
    idxZero = static_cast<int>(roundf((visibleCount - 1) / 2.0f));
    idxPos = static_cast<int>(roundf((visibleCount - 1) * 5.0f / 6.0f));
  }

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
    const bool edge = (i == 0) || (i == (visibleCount - 1));
    const bool largest = edge || (i == idxNeg) || (i == idxZero) || (i == idxPos);
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

    const bool labelHere = visible && s.showTickLabels && (largest || edge);
    if (labelHere) {
      const float labelR = innerR - 20.0f;
      const float value = s.displayMin + (s.displayMax - s.displayMin) * t;
      const lv_coord_t labelW = 34;
      const lv_coord_t centerShiftX = (i == idxZero) ? -2 : 0;
      lv_obj_align(arcTickLabels[i], LV_ALIGN_TOP_LEFT,
                   static_cast<lv_coord_t>(cx + cosf(rad) * labelR - (labelW / 2) + centerShiftX),
                   static_cast<lv_coord_t>(cy + sinf(rad) * labelR - 8.0f));
      lv_obj_set_style_text_color(arcTickLabels[i], lv_color_hex(0xFFFFFF), LV_PART_MAIN);
      lv_obj_set_style_text_font(arcTickLabels[i], &lv_font_montserrat_14, LV_PART_MAIN);
      lv_label_set_text(arcTickLabels[i], String(value, s.decimals).c_str());
      lv_obj_clear_flag(arcTickLabels[i], LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_add_flag(arcTickLabels[i], LV_OBJ_FLAG_HIDDEN);
    }
  }
}

// Render the full circular scale: arc colors, indicator angle, ticks, the
// triangle pointer and the centre value label. This is the single drawing
// entry point shared by every screen that exposes a value-edit arc.
static void renderScale(const EditScale &s,
                        lv_color_t accent, lv_color_t axisColor,
                        lv_color_t bg, lv_color_t fg,
                        bool editLayout, const String &valueText) {
  lv_obj_clear_flag(valueArc, LV_OBJ_FLAG_HIDDEN);
  const bool wantValueLabel = s.showValueLabel && !editLayout;
  if (wantValueLabel) {
    lv_obj_clear_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);
  }

  suppressArcEvent = true;
  lv_arc_set_value(valueArc, normalizedArc(s.value, s.displayMin, s.displayMax));
  suppressArcEvent = false;
  lv_obj_set_style_arc_color(valueArc, editLayout ? lv_color_mix(axisColor, bg, LV_OPA_40)
                                                  : lv_color_mix(accent, fg, LV_OPA_30),
                             LV_PART_MAIN);
  lv_obj_set_style_arc_color(valueArc, editLayout ? axisColor : accent, LV_PART_INDICATOR);

  updateArcTicks(s, true);

  // Closed triangle marker near the arc rim (no center line).
  lv_area_t arcArea;
  lv_obj_get_coords(valueArc, &arcArea);
  const float cx = (arcArea.x1 + arcArea.x2) * 0.5f + 1.0f;
  const float cy = (arcArea.y1 + arcArea.y2) * 0.5f;
  const float r = (arcArea.x2 - arcArea.x1) * 0.5f - 6.0f;
  const float sweepDeg = (kArcBgEndDeg >= kArcBgStartDeg)
                            ? static_cast<float>(kArcBgEndDeg - kArcBgStartDeg)
                            : static_cast<float>(360 - kArcBgStartDeg + kArcBgEndDeg);
  const float t = static_cast<float>(normalizedArc(s.value, s.displayMin, s.displayMax)) /
                  static_cast<float>(kArcRange);
  const float deg = static_cast<float>(kArcBgStartDeg) + t * sweepDeg +
                    static_cast<float>(kTickAngleOffsetDeg);
  const float rad = (deg - 90.0f) * (3.14159265f / 180.0f);

  const float tipR = r + 6.0f;
  const float baseR = r - 20.0f;
  const float halfSpread = 0.17f;
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

  if (s.showValueLabel) {
    lv_label_set_text(valueLabel, fitLine(valueText, 12).c_str());
  }
}

// Hide the scale and all of its decorations; used when the current screen
// does not expose an edit arc.
static void hideScale(const EditScale &s) {
  lv_obj_add_flag(valueArc, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(valueLabel, LV_OBJ_FLAG_HIDDEN);
  updateArcTicks(s, false);
  lv_obj_add_flag(valuePointerTriangle, LV_OBJ_FLAG_HIDDEN);
}

static void onTouchReturn(lv_event_t *e);
static void onHomeCardClick(lv_event_t *e);
static void navigateBack();
static void onArcValueChanged(lv_event_t *e);
static void onArcReleased(lv_event_t *e);
static void onShortPress();
static float effectiveFeed(const AxisConfig &a);
static void mpgStopJog();
static void mpgRefreshJog();
static void IRAM_ATTR encoderISR();

class MachineViewModel {
public:
  bool currentEdit(float &value, float &min_v, float &max_v, float &base_step) const;
  bool currentScale(EditScale &scale) const;
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

bool MachineViewModel::currentScale(EditScale &scale) const {
  return currentEditScale(scale);
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

// Unit suffix for a value display, derived from AxisConfig::type.
//   "rotary" -> degree sign, anything else (default "linear") -> " mm"
static const char *axisUnitSuffix(const AxisConfig &a) {
  if (a.type == "rotary") {
    return "\xC2\xB0";  // U+00B0 DEGREE SIGN, UTF-8 encoded
  }
  return " mm";
}

// Fill the up-to-3 pre-allocated `positionStackSpans` rows with the given
// axis values; each row has a value span (default font, `valueColor`) and a
// smaller, muted-colour unit-suffix span derived from the axis type.  Rows
// that have no matching axis are hidden.  The caller is responsible for
// positioning the rows on screen (see Home render branch).
static void renderPositionStack(const std::vector<float> &vals,
                                const std::vector<AxisConfig> &axes,
                                lv_color_t valueColor,
                                lv_color_t unitColor,
                                int decimals = 3,
                                const lv_font_t *valueFont = &lv_font_montserrat_20,
                                const lv_font_t *unitFont = &lv_font_montserrat_14) {
  const int rowCount = static_cast<int>(min<size_t>(axes.size(), 3));
  for (int i = 0; i < 3; i++) {
    lv_obj_t *grp = positionStackSpans[i];
    if (!grp) continue;
    if (i >= rowCount) {
      lv_obj_add_flag(grp, LV_OBJ_FLAG_HIDDEN);
      continue;
    }

    const AxisConfig &a = axes[static_cast<size_t>(i)];
    const float v = (static_cast<size_t>(i) < vals.size()) ? vals[static_cast<size_t>(i)] : 0.0f;

    String value;
    value.reserve(16);
    value += a.name;
    value += ": ";
    value += signedValue(v, decimals);

    if (positionStackValueSpan[i]) {
      lv_span_set_text(positionStackValueSpan[i], value.c_str());
      lv_style_set_text_color(&positionStackValueSpan[i]->style, valueColor);
      lv_style_set_text_font(&positionStackValueSpan[i]->style, valueFont);
    }
    if (positionStackUnitSpan[i]) {
      lv_span_set_text(positionStackUnitSpan[i], axisUnitSuffix(a));
      lv_style_set_text_color(&positionStackUnitSpan[i]->style, unitColor);
      lv_style_set_text_font(&positionStackUnitSpan[i]->style, unitFont);
    }
    lv_spangroup_refr_mode(grp);
    lv_obj_clear_flag(grp, LV_OBJ_FLAG_HIDDEN);
  }
}

static void hidePositionStack() {
  for (int i = 0; i < 3; i++) {
    if (positionStackSpans[i]) {
      lv_obj_add_flag(positionStackSpans[i], LV_OBJ_FLAG_HIDDEN);
    }
  }
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
  grblClient.setMotionAllowed(ownerIsPanel);

  if (!ownerIsPanel) {
    // We've lost (or never had) panel control; abort any active MPG jog so
    // we don't keep emitting jog chunks once GRBL ignores them.
    mpgStopJog();
  }

  if (!prevHostControl && hostControlActive && screen != Screen::Status) {
    screen = Screen::Status;
    infoLine = "Host active: monitor mode";
    uiDirty = true;
  }
  if (!owner.equalsIgnoreCase(lastOwner)) {
    Serial.printf("[OWN] %lu ms: %s -> %s (v%lu, reason=%s)\n",
                  millis(), lastOwner.c_str(), owner.c_str(),
                  grblParser.status().ownerVersion,
                  ownerReason.isEmpty() ? "-" : ownerReason.c_str());
    if (ownerIsPanel) {
      infoLine = "Panel control granted";
      if (screen == Screen::Status || screen == Screen::Home) {
        stepAxis = 0;
        stepValue = 0.0f;
        stepValues.assign(machineCfg.axes.size(), 0.0f);
        stepFeedEdit = false;
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
  return lastOwner.equalsIgnoreCase("panel");
}

static float effectiveFeed(const AxisConfig &a) {
  return a.has_feed_override ? a.feed_override : a.default_feed;
}

static constexpr uint8_t kJogCancelRt = 0x85;

// ── GRBL setting push helpers ────────────────────────────────────────────────
// GRBL "$N=value" commands are not motion commands, so they bypass the
// panel-ownership filter inside `GrblClient::isMotionCommand` and can be
// queued at any time. Each helper also surfaces a confirmation in `infoLine`
// so the user sees the exact line that was sent to the controller.
static void grblSetSetting(int n, float v, int dec = 0) {
  String line = "$" + String(n) + "=" + String(v, dec);
  grblClient.queueLine(line);
  infoLine = "GRBL " + line;
  uiDirty = true;
}

static void pushGrblMotorHold() {
  grblSetSetting(1, machineCfg.motor_hold, 0);
}

static void pushGrblEnableInvert() {
  grblSetSetting(4, machineCfg.enable_invert ? 1.0f : 0.0f, 0);
}

static void pushGrblAxisMaxRate(int axis_idx) {
  if (axis_idx < 0 || axis_idx >= static_cast<int>(machineCfg.axes.size()) || axis_idx > 2) return;
  grblSetSetting(110 + axis_idx, machineCfg.axes[axis_idx].max_rate, 0);
}

static void pushGrblAxisAccel(int axis_idx) {
  if (axis_idx < 0 || axis_idx >= static_cast<int>(machineCfg.axes.size()) || axis_idx > 2) return;
  grblSetSetting(120 + axis_idx, machineCfg.axes[axis_idx].acceleration, 0);
}

// ── MPG throttle jog control ─────────────────────────────────────────────────
// Cancel any in-flight jog and reset the throttle state. Safe to call even
// when nothing is in flight.
static void mpgStopJog() {
  if (mpgJogActive || mpgLastSentRate != 0.0f) {
    grblClient.sendRealtime(kJogCancelRt);
    grblClient.clearQueue();
  }
  mpgJogRate = 0.0f;
  mpgLastSentRate = 0.0f;
  mpgJogActive = false;
  mpgLastJogMs = 0;
}

// Stream short jog chunks at the current throttle rate. Re-queues only when
// the rate changes meaningfully or the previous chunk is about to drain.
static void mpgRefreshJog() {
  if (!mpgJogActive) return;
  if (!panelCommandsAllowed()) return;
  if (stepAxis < 0 || stepAxis >= static_cast<int>(machineCfg.axes.size())) return;
  const AxisConfig &a = machineCfg.axes[stepAxis];

  const float absRate = fabsf(mpgJogRate);
  if (absRate < 1.0f) {
    if (mpgLastSentRate != 0.0f) {
      grblClient.sendRealtime(kJogCancelRt);
      grblClient.clearQueue();
      mpgLastSentRate = 0.0f;
    }
    return;
  }

  const uint32_t now = millis();
  const bool rateChanged = fabsf(mpgJogRate - mpgLastSentRate) > max(5.0f, absRate * 0.05f);
  const bool refreshDue  = (now - mpgLastJogMs) > 1500;
  if (!rateChanged && !refreshDue) return;

  // Chunk worth ~3 s of motion; jog cancel pre-empts cleanly on rate change
  // or release, so the over-buffer is safe.
  float distMm = (absRate / 60.0f) * 3.0f;
  if (distMm < 1.0f) distMm = 1.0f;
  const float signedDist = distMm * (mpgJogRate > 0 ? 1.0f : -1.0f) *
                           (a.invert ? -1.0f : 1.0f) * a.scale;

  if (rateChanged) {
    grblClient.sendRealtime(kJogCancelRt);
    grblClient.clearQueue();
  }
  String line = "$J=G91 G21 ";
  line += a.name;
  line += String(signedDist, 3);
  line += " F";
  line += String(absRate, 1);
  if (grblClient.queueLine(line)) {
    mpgLastSentRate = mpgJogRate;
    mpgLastJogMs = now;
  }
}

static bool queueStepMove(size_t axis_idx, float value, String *queuedLine = nullptr) {
  if (!panelCommandsAllowed()) {
    return false;
  }
  if (axis_idx >= machineCfg.axes.size()) {
    return false;
  }
  const AxisConfig &a = machineCfg.axes[axis_idx];
  float rate = effectiveFeed(a);
  String line = "$J=G91 G21 ";
  line += a.name;
  line += String(value * (a.invert ? -1.0f : 1.0f) * a.scale, 3);
  line += " F";
  line += String(rate, 1);
  const bool ok = grblClient.queueLine(line);
  if (!ok) {
    return false;
  }
  if (queuedLine) {
    *queuedLine = line;
  }
  return true;
}

static bool queueParallelMove(const std::vector<float> &values) {
  if (!panelCommandsAllowed()) {
    return false;
  }
  float minRate = INFINITY;
  String line = "$J=G91 G21";
  for (size_t i = 0; i < machineCfg.axes.size(); i++) {
    float v = i < values.size() ? values[i] : 0.0f;
    line += " ";
    line += machineCfg.axes[i].name;
    line += String(v * (machineCfg.axes[i].invert ? -1.0f : 1.0f) * machineCfg.axes[i].scale, 3);
    float r = effectiveFeed(machineCfg.axes[i]);
    if (r < minRate) minRate = r;
  }
  if (!isfinite(minRate)) minRate = 1000.0f;
  line += " F";
  line += String(minRate, 1);
  return grblClient.queueLine(line);
}

static void recordCurrentStep() {
  ProgramStep s;
  if (machineCfg.operation_mode == "serial") {
    s.mode = "step";
    s.axes.assign(machineCfg.axes.size(), 0.0f);
    s.axes[stepAxis] = stepValue;
    s.feed = effectiveFeed(machineCfg.axes[stepAxis]);
  } else {
    s.mode = "pos";
    s.axes = stepValues;
    float minRate = INFINITY;
    for (size_t i = 0; i < machineCfg.axes.size(); i++) {
      float r = effectiveFeed(machineCfg.axes[i]);
      if (r < minRate) minRate = r;
    }
    if (!isfinite(minRate)) minRate = 1000.0f;
    s.feed = minRate;
  }
  s.comment = "teach";
  teachBuffer.steps.push_back(s);
}

static void saveTeachProgram(const String &name, bool append) {
  if (teachBuffer.steps.empty()) {
    infoLine = "Teach buffer empty";
    return;
  }
  teachBuffer.name = name.isEmpty() ? programStore.nextAutoName() : name;
  if (append) {
    ProgramData existing;
    if (programStore.loadProgram(teachBuffer.name, existing, machineCfg.axes)) {
      for (const auto &s : teachBuffer.steps) existing.steps.push_back(s);
      existing.name = teachBuffer.name;
      if (programStore.saveProgram(existing, machineCfg.axes)) {
        infoLine = "Appended " + teachBuffer.name;
      } else {
        infoLine = "Save err: " + programStore.lastError();
      }
    } else {
      if (programStore.saveProgram(teachBuffer, machineCfg.axes)) {
        infoLine = "Saved " + teachBuffer.name;
      } else {
        infoLine = "Save err: " + programStore.lastError();
      }
    }
  } else {
    if (programStore.saveProgram(teachBuffer, machineCfg.axes)) {
      infoLine = "Saved " + teachBuffer.name;
    } else {
      infoLine = "Save err: " + programStore.lastError();
    }
  }
  teachBuffer.steps.clear();
  teachBuffer.name = "";
  machineCfg.last_program_name = name;
  machineCfg.last_save_mode = append ? "append" : "overwrite";
  programStore.listPrograms(programNames);
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

  subTitleLabel = lv_label_create(lv_scr_act());
  lv_obj_set_width(subTitleLabel, 224);
  lv_obj_set_style_text_align(subTitleLabel, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_obj_set_style_text_font(subTitleLabel, &lv_font_montserrat_14, LV_PART_MAIN);
  lv_obj_align(subTitleLabel, LV_ALIGN_TOP_MID, 0, 28);
  lv_label_set_text(subTitleLabel, "");
  lv_obj_add_flag(subTitleLabel, LV_OBJ_FLAG_HIDDEN);

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
  lv_obj_add_event_cb(valueArc, onArcReleased, LV_EVENT_RELEASED, nullptr);
  lv_obj_add_event_cb(valueArc, onArcReleased, LV_EVENT_PRESS_LOST, nullptr);
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

  for (int i = 0; i < homeCount; i++) {
    homeCardButtons[i] = lv_btn_create(lv_scr_act());
    lv_obj_set_size(homeCardButtons[i], 44, 44);
    lv_obj_align(homeCardButtons[i], LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_radius(homeCardButtons[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(homeCardButtons[i], LV_OPA_40, LV_PART_MAIN);
    lv_obj_set_style_border_width(homeCardButtons[i], 1, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(homeCardButtons[i], 0, LV_PART_MAIN);
    lv_obj_set_user_data(homeCardButtons[i], reinterpret_cast<void *>(static_cast<intptr_t>(i)));
    lv_obj_add_event_cb(homeCardButtons[i], onHomeCardClick, LV_EVENT_CLICKED, nullptr);

    homeCardIcons[i] = lv_label_create(homeCardButtons[i]);
    lv_obj_set_style_text_font(homeCardIcons[i], &lv_font_montserrat_20, LV_PART_MAIN);
    lv_label_set_text(homeCardIcons[i], LV_SYMBOL_HOME);
    lv_obj_center(homeCardIcons[i]);

    homeCardLabels[i] = lv_label_create(lv_scr_act());
    lv_obj_set_width(homeCardLabels[i], 70);
    lv_obj_set_style_text_align(homeCardLabels[i], LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_align(homeCardLabels[i], LV_ALIGN_CENTER, 0, 0);
    lv_label_set_text(homeCardLabels[i], "");
  }

  // Per-axis position rows: spangroup with a value span (default size) and a
  // smaller, muted unit-suffix span.  Created once; refreshed every render.
  for (int i = 0; i < 3; i++) {
    positionStackSpans[i] = lv_spangroup_create(lv_scr_act());
    lv_spangroup_set_align(positionStackSpans[i], LV_TEXT_ALIGN_CENTER);
    lv_spangroup_set_overflow(positionStackSpans[i], LV_SPAN_OVERFLOW_CLIP);
    lv_spangroup_set_mode(positionStackSpans[i], LV_SPAN_MODE_FIXED);
    lv_obj_set_size(positionStackSpans[i], 200, 26);
    lv_obj_set_style_pad_all(positionStackSpans[i], 0, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(positionStackSpans[i], LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_opa(positionStackSpans[i], LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_add_flag(positionStackSpans[i], LV_OBJ_FLAG_HIDDEN);

    positionStackValueSpan[i] = lv_spangroup_new_span(positionStackSpans[i]);
    lv_style_set_text_font(&positionStackValueSpan[i]->style, &lv_font_montserrat_20);
    lv_span_set_text(positionStackValueSpan[i], "");

    positionStackUnitSpan[i] = lv_spangroup_new_span(positionStackSpans[i]);
    lv_style_set_text_font(&positionStackUnitSpan[i]->style, &lv_font_montserrat_14);
    lv_span_set_text(positionStackUnitSpan[i], " mm");
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
      // Title is suppressed on Home; the centre row hosts `infoLine` (the
      // ephemeral status / error message) when non-empty. The bottom
      // line4Label is also suppressed on Home so the same text doesn't
      // appear twice.
      title = "";
      l1 = infoLine;
      l2 = "";
      l3 = "";
      l4 = "";
      break;
    case Screen::Status:
      title = hostControlActive ? "Monitor" : "Status";
      l1 = String("State: ") + grblParser.status().state;
      // Per-axis values are drawn through the spangroup `positionStack`
      // (renderPositionStack) below; keep l2 empty so line2Label stays
      // hidden and doesn't overlap the stack.
      l2 = "";
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
      std::vector<VerticalMenuItem> rows;
      for (int i = 0; i < setupMenuCount; i++) rows.push_back({setupMenuItems[i], ""});
      l1 = renderVerticalMenu(rows, setupMenuIndex);
      l2 = "";
      l3 = "";
      break;
    }
    case Screen::SetupProfile: {
      title = "Profile";
      std::vector<VerticalMenuItem> rows;
      for (int i = 0; i < profileMenuItemCount; i++) rows.push_back({profileMenuItems[i], ""});
      l1 = renderVerticalMenu(rows, setupProfileMenuIndex);
      l2 = "";
      l3 = "";
      break;
    }
    case Screen::SetupProfileSelect: {
      title = (profileSelectMode == ProfileSelectMode::Del) ? "Del Profile" : "Set Profile";
      std::vector<VerticalMenuItem> rows;
      for (size_t i = 0; i < profileSet.profiles.size(); i++) {
        const String &name = profileSet.profiles[i].name;
        String marker;
        if (name == profileSet.activeName) marker = "*";
        rows.push_back({name, marker});
      }
      if (rows.empty()) rows.push_back({"(no profiles)", ""});
      l1 = renderVerticalMenu(rows, profileSelectIndex);
      l2 = "";
      l3 = "";
      break;
    }
    case Screen::SetupAxes: {
      const AxisConfig &a = machineCfg.axes[setupAxesAxis];
      if (setupAxesCursor == 0) {
        title = "Axes";
        int totalItems = static_cast<int>(machineCfg.axes.size()) + 2;
        auto axisItemName = [&](int idx) -> String {
          if (idx < static_cast<int>(machineCfg.axes.size())) return machineCfg.axes[idx].name;
          if (idx == static_cast<int>(machineCfg.axes.size())) return "Add Axis";
          return "Del Axis";
        };
        std::vector<VerticalMenuItem> rows;
        for (int i = 0; i < totalItems; i++) rows.push_back({axisItemName(i), ""});
        l1 = renderVerticalMenu(rows, setupAxesAxis);
        l2 = "";
        l3 = "";
      } else if (setupAxesCursor == 1) {
        title = String("Axes > ") + a.name;
        std::vector<VerticalMenuItem> rows = {
          {"min",     a.has_min_limit ? signedValue(a.min, 1) : "--"},
          {"max",     a.has_max_limit ? signedValue(a.max, 1) : "--"},
          {"scale",   String(a.scale, 2)},
          {"maxRate", String(a.max_rate, 0)},
          {"accel",   String(a.acceleration, 0)},
          {"type",    a.type},
          {"parent",  a.parent.isEmpty() ? String("-") : a.parent},
          {"invert",  a.invert ? String("ON") : String("OFF")},
        };
        l1 = renderVerticalMenu(rows, setupAxesField);
        l2 = "";
        l3 = "";
      } else {
        String field = setupAxesFields[setupAxesField];
        float value = 0.0f;
        switch (setupAxesField) {
          case 0: value = a.min; break;
          case 1: value = a.max; break;
          case 2: value = a.scale; break;
          case 3: value = a.max_rate; break;
          case 4: value = a.acceleration; break;
          case 5: value = a.type == "rotary" ? 1.0f : 0.0f; break;
          case 6: value = 0.0f; break;
          case 7: value = a.invert ? 1.0f : 0.0f; break;
        }
        title = a.name + " > " + field;
        l1 = a.name + " " + field;
        if (setupAxesField == 0) {
          l2 = a.has_min_limit ? signedValue(value, 1) : "--";
          l3 = a.has_min_limit ? "Hold: no limit" : "Hold: set limit";
        } else if (setupAxesField == 1) {
          l2 = a.has_max_limit ? signedValue(value, 1) : "--";
          l3 = a.has_max_limit ? "Hold: no limit" : "Hold: set limit";
        } else if (setupAxesField == 5) {
          l2 = a.type;
          l3 = "";
        } else if (setupAxesField == 7) {
          l2 = a.invert ? "ON" : "OFF";
          l3 = "";
        } else if (setupAxesField == 6) {
          l2 = a.parent.isEmpty() ? "none" : a.parent;
          l3 = "";
        } else {
          l2 = signedValue(value, 1);
          l3 = "";
        }
      }
      break;
    }
    case Screen::SetupDriver: {
      if (setupDriverCursor == 0) {
        title = "Driver";
        std::vector<VerticalMenuItem> rows = {
          {"motorHold", String(machineCfg.motor_hold, 0)},
          {"invert",    machineCfg.enable_invert ? String("ON") : String("OFF")},
          {"opMode",    machineCfg.operation_mode},
        };
        l1 = renderVerticalMenu(rows, setupDriverField);
        l2 = "";
        l3 = "";
      } else {
        String field = setupDriverFields[setupDriverField];
        String val;
        switch (setupDriverField) {
          case 0: val = String(machineCfg.motor_hold, 0); break;
          case 1: val = machineCfg.enable_invert ? "ON" : "OFF"; break;
          case 2: val = machineCfg.operation_mode; break;
        }
        title = String("Driver > ") + field;
        l1 = field;
        l2 = val;
        l3 = "";
      }
      break;
    }
    case Screen::Step: {
      const AxisConfig &a = machineCfg.axes[stepAxis];
      const int axis_dec = decimalsForStep(a.step);
      if (stepFeedEdit) {
        title = "Feed Rate";
        float rate = a.has_feed_override ? a.feed_override : a.default_feed;
        l1 = "Axis " + a.name + " Feed";
        l2 = String(rate, 0);
        l3 = "Long press to exit";
      } else {
        String modeTag = machineCfg.operation_mode == "serial" ? "S" : (machineCfg.operation_mode == "parallel" ? "P" : "M");
        title = "Step [" + modeTag + "]";
        l1 = "Axis " + a.name + " (" + String(stepAxis + 1) + "/" + String(machineCfg.axes.size()) + ")";
        const float curPos = stepAxis < static_cast<int>(currentAxes.size()) ? currentAxes[stepAxis] : 0.0f;
        if (machineCfg.operation_mode == "mpg") {
          // Throttle mode: value-row shows the live axis position; the
          // requested jog rate appears beneath as a small hint.
          l2 = signedValue(curPos, axis_dec);
          l3 = "Rate: " + String(static_cast<int>(mpgJogRate)) + " mm/min";
        } else {
          float dispVal = machineCfg.operation_mode == "serial" ? stepValue
                          : (stepAxis < static_cast<int>(stepValues.size()) ? stepValues[stepAxis] : 0.0f);
          l2 = signedValue(dispVal, axis_dec);
          // The per-axis position readout is drawn by the spangroup
          // `positionStack` below; line3Label stays hidden in this mode.
          l3 = "";
        }
      }
      break;
    }
    case Screen::StepActions: {
      title = "Actions";
      l1 = String(stepActionIndex == 0 ? "> " : "  ") + stepActionItems[0];
      l2 = String(stepActionIndex == 1 ? "> " : "  ") + stepActionItems[1];
      l3 = "";
      for (size_t i = 0; i < machineCfg.axes.size(); i++) {
        if (i > 0) l3 += "\n";
        float v = i < currentAxes.size() ? currentAxes[i] : 0.0f;
        l3 += machineCfg.axes[i].name + ": " + String(v, 2);
      }
      break;
    }
    case Screen::StepSaveTarget: {
      title = "Save Target";
      std::vector<VerticalMenuItem> rows;
      for (const String &name : programNames) rows.push_back({name, ""});
      rows.push_back({"New program", ""});
      rows.push_back({"Del program", ""});
      l1 = renderVerticalMenu(rows, saveProgramIndex);
      l2 = "";
      l3 = "";
      break;
    }
    case Screen::StepSaveMode: {
      title = String("Save: ") + saveTargetName;
      l1 = saveTargetName;
      l2 = "Mode: " + String(saveModes[saveModeIndex]);
      l3 = "SW=Save  Long=Back";
      break;
    }
    case Screen::StepSaveDelete: {
      title = "Del Program";
      std::vector<VerticalMenuItem> rows;
      for (const String &name : programNames) rows.push_back({name, ""});
      if (rows.empty()) rows.push_back({"(no programs)", ""});
      l1 = renderVerticalMenu(rows, saveDeleteIndex);
      l2 = "";
      l3 = "";
      break;
    }
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
  const bool editLayout = isEditScreen(screen) ||
                          (screen == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing) ||
                          (screen == Screen::SetupDriver && setupDriverCursor == 1 && setupDriverEditing);
  const int editAxis = currentEditAxisIndex();
  lv_color_t axisColor = axisColorByIndex(editAxis);

  EditScale curScale;
  if (viewModel.currentScale(curScale)) {
    arcVisible = true;
    arcValue = curScale.value;
    arcMin = curScale.displayMin;
    arcMax = curScale.displayMax;
    arcDecimals = curScale.decimals;
    arcText = String(curScale.value, arcDecimals);
  }

  lv_obj_set_style_bg_color(lv_scr_act(), bg, LV_PART_MAIN);
  lv_obj_set_style_text_color(lv_scr_act(), fg, LV_PART_MAIN);

  const bool showCarousel = (screen == Screen::Home);

  if (showCarousel) {
    lv_obj_add_flag(modeIconLabel, LV_OBJ_FLAG_HIDDEN);
    // No title on Home; the centre area is reserved for the optional
    // ephemeral status (`infoLine`) which travels through l1.
    lv_obj_add_flag(titleLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(line2Label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
    if (l1.isEmpty()) {
      lv_obj_add_flag(line1Label, LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_clear_flag(line1Label, LV_OBJ_FLAG_HIDDEN);
      lv_obj_set_width(line1Label, 180);
      lv_obj_set_height(line1Label, LV_SIZE_CONTENT);
      lv_obj_set_style_text_align(line1Label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
      lv_obj_align(line1Label, LV_ALIGN_CENTER, 0, 0);
    }

    for (int i = 0; i < homeCount; i++) {
      if (homeCardButtons[i]) {
        const bool active = (i == homeIndex);
        lv_obj_clear_flag(homeCardButtons[i], LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_border_color(
            homeCardButtons[i],
            active ? accent : lv_color_mix(accent, fg, LV_OPA_30),
            LV_PART_MAIN);
        lv_obj_set_style_border_width(homeCardButtons[i], 1, LV_PART_MAIN);
        lv_obj_set_style_bg_color(homeCardButtons[i],
                                  lv_color_mix(accent, bg, active ? LV_OPA_80 : LV_OPA_20),
                                  LV_PART_MAIN);
        if (homeCardIcons[i]) {
          lv_obj_set_style_text_color(homeCardIcons[i], fg, LV_PART_MAIN);
        }
        if (homeCardLabels[i]) {
          lv_obj_clear_flag(homeCardLabels[i], LV_OBJ_FLAG_HIDDEN);
          lv_obj_set_style_text_color(homeCardLabels[i], fg, LV_PART_MAIN);
          lv_obj_set_style_text_opa(homeCardLabels[i],
                                    active ? LV_OPA_COVER : LV_OPA_70,
                                    LV_PART_MAIN);
        }
      }
    }
    refreshHomeCards();
    hidePositionStack();
  } else {
    lv_obj_add_flag(modeIconLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(titleLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(line1Label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_width(line1Label, 224);
    for (int i = 0; i < homeCount; i++) {
      if (homeCardButtons[i]) lv_obj_add_flag(homeCardButtons[i], LV_OBJ_FLAG_HIDDEN);
      if (homeCardLabels[i]) lv_obj_add_flag(homeCardLabels[i], LV_OBJ_FLAG_HIDDEN);
    }
    hidePositionStack();
    if (screen == Screen::Setup ||
        screen == Screen::SetupProfile ||
        screen == Screen::SetupProfileSelect ||
        (screen == Screen::SetupAxes && setupAxesCursor < 2) ||
        (screen == Screen::SetupDriver && setupDriverCursor < 1) ||
        screen == Screen::StepSaveTarget ||
        screen == Screen::StepSaveDelete) {
      int menuLines = 0;
      for (size_t i = 0; i < l1.length(); i++) if (l1[i] == '\n') menuLines++;
      menuLines++;
      const int lineH = 26;
      const int menuH = menuLines * lineH;
      const int areaTop = 50;
      const int areaBot = 200;
      const int menuY = areaTop + (areaBot - areaTop - menuH) / 2;
      lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 6);
      lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, static_cast<lv_coord_t>(menuY));
      lv_obj_set_height(line1Label, LV_SIZE_CONTENT);
      lv_obj_add_flag(line2Label, LV_OBJ_FLAG_HIDDEN);
      lv_obj_add_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_set_height(line1Label, LV_SIZE_CONTENT);
      lv_obj_clear_flag(line2Label, LV_OBJ_FLAG_HIDDEN);
      lv_obj_set_height(line3Label, LV_SIZE_CONTENT);
      if (arcVisible) {
        lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 54);
        lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 77);
        lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 101);
        lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 139);
        lv_obj_clear_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
      } else if (screen == Screen::StepActions) {
        lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 8);
        lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 58);
        lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 86);
        lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 126);
        lv_obj_clear_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
      } else {
        lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 8);
        lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 40);
        lv_obj_align(line2Label, LV_ALIGN_TOP_MID, 0, 62);
        lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, 84);
        lv_obj_clear_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
      }
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
    const String labelText = editLayout ? signedValue(arcValue, arcDecimals) : arcText;
    renderScale(curScale, accent, axisColor, bg, fg, editLayout, labelText);
  } else {
    hideScale(curScale);
  }

  const bool setupMenu = (screen == Screen::Setup ||
                          screen == Screen::SetupProfile ||
                          screen == Screen::SetupProfileSelect ||
                          (screen == Screen::SetupAxes && setupAxesCursor < 2) ||
                          (screen == Screen::SetupDriver && setupDriverCursor < 1) ||
                          screen == Screen::StepSaveTarget ||
                          screen == Screen::StepSaveDelete);
  const bool actionMenu = (screen == Screen::StepActions);
  String tFit = fitLine(title, 22);
  String l1Fit = (setupMenu || actionMenu) ? l1 : fitLine(l1, arcVisible ? 20 : 24);
  String l2Fit = fitLine(l2, arcVisible ? 14 : 24);
  String l3Fit = actionMenu ? l3 : fitLine(l3, 24);
  String l4Fit = fitLine(l4, 26);
  if (setupMenu) {
    lv_obj_set_style_text_font(line1Label, &lv_font_montserrat_20, LV_PART_MAIN);
  } else if (showCarousel) {
    lv_obj_set_style_text_font(line1Label, &lv_font_montserrat_20, LV_PART_MAIN);
  } else {
    lv_obj_set_style_text_font(line1Label, (editLayout || actionMenu) ? &lv_font_montserrat_20 : &lv_font_montserrat_14, LV_PART_MAIN);
  }
  lv_obj_set_style_text_font(line2Label, editLayout ? responsiveValueFont(l2Fit) : (actionMenu ? &lv_font_montserrat_20 : &lv_font_montserrat_14), LV_PART_MAIN);
  lv_obj_set_style_text_font(line3Label, &lv_font_montserrat_14, LV_PART_MAIN);
  lv_obj_set_style_text_color(line1Label, editLayout ? axisColor : fg, LV_PART_MAIN);
  lv_obj_set_style_text_color(line2Label, fg, LV_PART_MAIN);
  lv_obj_set_style_text_color(line3Label, editLayout ? axisColor : fg, LV_PART_MAIN);

  lv_label_set_text(titleLabel, tFit.c_str());
  lv_label_set_text(line1Label, l1Fit.c_str());
  lv_label_set_text(line2Label, l2Fit.c_str());
  lv_label_set_text(line3Label, l3Fit.c_str());

  const bool showProfileSubtitle = setupMenu && !profileSet.activeName.isEmpty();
  if (showProfileSubtitle) {
    lv_obj_clear_flag(subTitleLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(subTitleLabel, LV_ALIGN_TOP_MID, 0, 28);
    lv_obj_set_style_text_color(subTitleLabel, lv_color_mix(accent, fg, LV_OPA_60), LV_PART_MAIN);
    String subFit = fitLine(String("Profile: ") + profileSet.activeName, 28);
    lv_label_set_text(subTitleLabel, subFit.c_str());
  } else {
    lv_obj_add_flag(subTitleLabel, LV_OBJ_FLAG_HIDDEN);
  }
  if (l4.isEmpty() || arcVisible) {
    lv_obj_add_flag(line4Label, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(line4Label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(line4Label, LV_ALIGN_TOP_MID, 0, 178);
    lv_obj_set_style_text_color(line4Label, lv_color_hex(0xFFD400), LV_PART_MAIN);
    lv_label_set_text(line4Label, l4Fit.c_str());
  }

  // ---- Position-stack overlay (shared for Status + Step non-MPG) ----------
  // The spangroup-based per-axis readout is positioned here so it can pick up
  // the final palette colours.  Home suppresses it explicitly above; other
  // screens fall through `hidePositionStack()` already.
  const bool stepWithStack = (screen == Screen::Step && arcVisible && !stepFeedEdit &&
                              machineCfg.operation_mode != "mpg");
  const bool statusWithStack = (screen == Screen::Status);
  if (stepWithStack || statusWithStack) {
    const lv_color_t unitColor = lv_color_mix(accent, fg, LV_OPA_60);
    const int decimals = stepWithStack ? 3 : 2;
    renderPositionStack(currentAxes, machineCfg.axes, fg, unitColor, decimals,
                        &lv_font_montserrat_14, &lv_font_montserrat_14);
    const int rowCount = static_cast<int>(min<size_t>(machineCfg.axes.size(), 3));
    const int pitch = stepWithStack ? 18 : 22;
    const int top = stepWithStack ? 139 : 84;
    for (int i = 0; i < rowCount; i++) {
      if (positionStackSpans[i]) {
        lv_obj_align(positionStackSpans[i], LV_ALIGN_TOP_MID, 0,
                     static_cast<lv_coord_t>(top + i * pitch));
      }
    }
    if (stepWithStack) {
      lv_obj_add_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
    }
    if (statusWithStack) {
      lv_obj_add_flag(line2Label, LV_OBJ_FLAG_HIDDEN);
      // Slot Owner / reason rows below the position stack so they don't
      // overlap (default else-branch placed l3 at y=84).
      const int afterStack = top + rowCount * pitch + 4;
      lv_obj_align(line3Label, LV_ALIGN_TOP_MID, 0, static_cast<lv_coord_t>(afterStack));
    }
  }
}

static void handleSetupAxesRotate(int delta) {
  if (setupAxesCursor == 0) {
    int totalItems = static_cast<int>(machineCfg.axes.size()) + 2;
    int ni = setupAxesAxis + delta;
    if (ni >= 0 && ni < totalItems) setupAxesAxis = ni;
    return;
  }
  if (setupAxesCursor == 1) {
    int ni = setupAxesField + delta;
    if (ni >= 0 && ni < setupAxesFieldCount) setupAxesField = ni;
    return;
  }
  if (setupAxesCursor != 2 || !setupAxesEditing || delta == 0) {
    return;
  }
  viewModel.applyAdaptiveDelta(delta);
}

static void handleSetupDriverRotate(int delta) {
  if (setupDriverCursor == 0) {
    int ni = setupDriverField + delta;
    if (ni >= 0 && ni < setupDriverFieldCount) setupDriverField = ni;
    return;
  }
  if (setupDriverCursor != 1 || !setupDriverEditing || delta == 0) {
    return;
  }
  viewModel.applyAdaptiveDelta(delta);
}

static void requestPanelOwnership() {
  Serial.printf("[OWN] %lu ms: REQUEST panel (q=%u await=%d)\n",
                millis(), grblClient.queuedCount(), grblClient.awaitingOk());
  grblClient.clearQueue();
  grblClient.sendRealtime(kOwnRequestPanelRt);
  grblClient.sendRealtime(kOwnQueryRt);
  grblClient.requestStatus();
  lastStatusMs = millis();
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
    case Screen::SetupProfile:
      screen = Screen::Setup;
      break;
    case Screen::SetupProfileSelect:
      screen = Screen::SetupProfile;
      break;
    case Screen::SetupAxes:
      if (setupAxesCursor == 2) {
        setupAxesEditing = false;
        setupAxesCursor = 1;
      } else if (setupAxesCursor == 1) {
        setupAxesCursor = 0;
      } else {
        screen = Screen::Setup;
      }
      break;
    case Screen::SetupDriver:
      if (setupDriverCursor == 1) {
        setupDriverEditing = false;
        setupDriverCursor = 0;
      } else {
        screen = Screen::Setup;
      }
      break;
    case Screen::StepActions:
      screen = Screen::Home;
      break;
    case Screen::StepSaveTarget:
      screen = Screen::Step;
      stepAxis = 0;
      stepValue = 0.0f;
      stepValues.assign(machineCfg.axes.size(), 0.0f);
      break;
    case Screen::StepSaveMode:
      screen = Screen::StepSaveTarget;
      break;
    case Screen::StepSaveDelete:
      programStore.listPrograms(programNames);
      screen = Screen::StepSaveTarget;
      break;
    case Screen::ProgramRun:
      programEngine.stop(grblClient);
      screen = Screen::ProgramList;
      programStore.listPrograms(programNames);
      break;
    case Screen::Step:
      mpgStopJog();
      screen = Screen::Home;
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
  if (lv_event_get_code(e) != LV_EVENT_CLICKED) {
    return;
  }
  if (screen != Screen::Home) {
    return;
  }
  if (hostControlActive) {
    screen = Screen::Status;
    infoLine = "Host active: monitor mode";
    uiDirty = true;
    return;
  }

  // Each ring button stores its menu index in its user_data.  Tapping any
  // icon makes it the active item and immediately runs the same action a
  // short-press would: a single tap navigates directly to that screen.
  lv_obj_t *btn = static_cast<lv_obj_t *>(lv_event_get_target(e));
  const int idx = static_cast<int>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(btn)));
  if (idx < 0 || idx >= homeCount) {
    return;
  }
  if (idx != homeIndex) {
    homeIndex = idx;
    persistHomeIndex();
  }
  onShortPress();
  uiDirty = true;
}

static void onArcValueChanged(lv_event_t *e) {
  if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED || suppressArcEvent) {
    return;
  }

  EditScale s;
  if (!viewModel.currentScale(s)) {
    return;
  }

  const int arc_val = lv_arc_get_value(static_cast<lv_obj_t *>(lv_event_get_target(e)));
  viewModel.setEditValue(denormalizeArc(arc_val, s.displayMin, s.displayMax));
}

static void onArcReleased(lv_event_t *e) {
  const lv_event_code_t code = lv_event_get_code(e);
  if (code != LV_EVENT_RELEASED && code != LV_EVENT_PRESS_LOST) {
    return;
  }
  if (screen != Screen::Step || stepFeedEdit) {
    return;
  }
  if (machineCfg.operation_mode != "mpg") {
    return;
  }
  mpgStopJog();
  uiDirty = true;
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
      requestPanelOwnership();
      infoLine = "Takeover requested";
      return;
    }
    infoLine = "Blocked: host monitor mode";
    return;
  }

  if (screen == Screen::Home) {
    switch (homeIndex) {
      case 0: screen = Screen::Status; break;
      case 1:
        setupMenuIndex = 0;
        screen = Screen::Setup;
        break;
      case 2:
        stepAxis = 0;
        stepValue = 0.0f;
        stepValues.assign(machineCfg.axes.size(), 0.0f);
        stepFeedEdit = false;
        requestPanelOwnership();
        screen = Screen::Step;
        break;
      case 3:
        programStore.listPrograms(programNames);
        programIndex = 0;
        screen = Screen::ProgramList;
        break;
      default: break;
    }
    return;
  }

  if (screen == Screen::Setup) {
    switch (setupMenuIndex) {
      case 0:
        setupProfileMenuIndex = 0;
        screen = Screen::SetupProfile;
        break;
      case 1:
        setupAxesCursor = 0;
        setupAxesAxis = 0;
        setupAxesField = 0;
        setupAxesEditing = false;
        screen = Screen::SetupAxes;
        break;
      case 2:
        setupDriverCursor = 0;
        setupDriverField = 0;
        setupDriverEditing = false;
        screen = Screen::SetupDriver;
        break;
    }
    return;
  }

  if (screen == Screen::SetupProfile) {
    switch (setupProfileMenuIndex) {
      case 0: {  // Add Profile
        int n = static_cast<int>(profileSet.profiles.size()) + 1;
        String candidate;
        while (true) {
          candidate = String("profile") + String(n);
          bool taken = false;
          for (const auto &p : profileSet.profiles) {
            if (p.name == candidate) { taken = true; break; }
          }
          if (!taken) break;
          n++;
        }
        Profile np = configStore.defaultProfileLaser();
        np.name = candidate;
        profileSet.profiles.push_back(np);
        profileSet.activeName = candidate;
        syncMachineCfgFromActive();
        configStore.saveAll(profileSet);
        infoLine = String("Added ") + candidate;
        return;
      }
      case 1: {  // Del Profile
        if (profileSet.profiles.size() <= 1) {
          infoLine = "Cannot remove last";
          return;
        }
        profileSelectMode = ProfileSelectMode::Del;
        profileSelectIndex = 0;
        screen = Screen::SetupProfileSelect;
        return;
      }
      case 2: {  // Set Profile
        profileSelectMode = ProfileSelectMode::Set;
        profileSelectIndex = activeProfileIdx();
        if (profileSelectIndex < 0) profileSelectIndex = 0;
        screen = Screen::SetupProfileSelect;
        return;
      }
      case 3: {  // Push GRBL: send all GRBL-relevant settings of the active profile.
        pushGrblMotorHold();
        pushGrblEnableInvert();
        const int axisCount = static_cast<int>(machineCfg.axes.size());
        for (int i = 0; i < axisCount && i <= 2; i++) {
          pushGrblAxisMaxRate(i);
          pushGrblAxisAccel(i);
        }
        infoLine = String("GRBL: pushed ") + profileSet.activeName;
        return;
      }
    }
    return;
  }

  if (screen == Screen::SetupProfileSelect) {
    if (profileSet.profiles.empty()) {
      screen = Screen::SetupProfile;
      return;
    }
    if (profileSelectIndex < 0 || profileSelectIndex >= static_cast<int>(profileSet.profiles.size())) {
      return;
    }
    const String name = profileSet.profiles[profileSelectIndex].name;
    if (profileSelectMode == ProfileSelectMode::Set) {
      profileSet.activeName = name;
      syncMachineCfgFromActive();
      configStore.saveAll(profileSet);
      stepValues.assign(machineCfg.axes.size(), 0.0f);
      teachCombined.assign(machineCfg.axes.size(), 0.0f);
      infoLine = String("Active: ") + name;
      screen = Screen::SetupProfile;
    } else {
      if (profileSet.profiles.size() <= 1) {
        infoLine = "Cannot remove last";
        return;
      }
      bool removingActive = (name == profileSet.activeName);
      profileSet.profiles.erase(profileSet.profiles.begin() + profileSelectIndex);
      if (removingActive) {
        profileSet.activeName = profileSet.profiles.front().name;
        syncMachineCfgFromActive();
        stepValues.assign(machineCfg.axes.size(), 0.0f);
        teachCombined.assign(machineCfg.axes.size(), 0.0f);
      }
      configStore.saveAll(profileSet);
      infoLine = String("Removed ") + name;
      if (profileSelectIndex >= static_cast<int>(profileSet.profiles.size())) {
        profileSelectIndex = static_cast<int>(profileSet.profiles.size()) - 1;
      }
    }
    return;
  }

  if (screen == Screen::SetupAxes) {
    int axisCount = static_cast<int>(machineCfg.axes.size());
    if (setupAxesCursor == 0) {
      if (setupAxesAxis < axisCount) {
        setupAxesCursor = 1;
        setupAxesField = 0;
      } else if (setupAxesAxis == axisCount) {
        AxisConfig newAxis;
        const char axisOrder[] = "XYZABCDEFGHIJKLMNOPQRSTUVW";
        for (size_t ci = 0; ci < sizeof(axisOrder) - 1; ci++) {
          String candidate(axisOrder[ci]);
          bool taken = false;
          for (const auto &ax : machineCfg.axes) {
            if (ax.name.equalsIgnoreCase(candidate)) { taken = true; break; }
          }
          if (!taken) { newAxis.name = candidate; break; }
        }
        machineCfg.axes.push_back(newAxis);
        persistActiveProfile();
        infoLine = "Added " + newAxis.name;
      } else {
        if (axisCount > 1) {
          int delIdx = axisCount - 1;
          String removed = machineCfg.axes[delIdx].name;
          machineCfg.axes.erase(machineCfg.axes.begin() + delIdx);
          persistActiveProfile();
          if (setupAxesAxis >= static_cast<int>(machineCfg.axes.size()))
            setupAxesAxis = static_cast<int>(machineCfg.axes.size()) + 1;
          infoLine = "Removed " + removed;
        } else {
          infoLine = "Cannot remove last axis";
        }
      }
      return;
    }
    if (setupAxesCursor == 1) {
      setupAxesCursor = 2;
      setupAxesEditing = true;
      return;
    }
    if (setupAxesCursor == 2) {
      setupAxesEditing = false;
      persistActiveProfile();
      const int finishedField = setupAxesField;
      const int finishedAxis = setupAxesAxis;
      setupAxesCursor = 1;
      if (finishedField == 3) pushGrblAxisMaxRate(finishedAxis);
      else if (finishedField == 4) pushGrblAxisAccel(finishedAxis);
      return;
    }
    return;
  }

  if (screen == Screen::SetupDriver) {
    if (setupDriverCursor == 0) {
      setupDriverCursor = 1;
      setupDriverEditing = true;
      return;
    }
    if (setupDriverCursor == 1) {
      setupDriverEditing = false;
      persistActiveProfile();
      const int finishedField = setupDriverField;
      setupDriverCursor = 0;
      if (finishedField == 0) pushGrblMotorHold();
      else if (finishedField == 1) pushGrblEnableInvert();
      return;
    }
    return;
  }

  if (screen == Screen::Step) {
    if (stepFeedEdit) {
      stepFeedEdit = false;
      infoLine = "Feed set";
      return;
    }
    if (!panelCommandsAllowed()) {
      mpgStopJog();
      requestPanelOwnership();
      infoLine = "Requesting control...";
      return;
    }

    if (machineCfg.operation_mode == "serial") {
      if (fabsf(stepValue) < 0.0005f) {
        infoLine = "Step value is 0";
        return;
      }
      String queued;
      const bool sent = queueStepMove(stepAxis, stepValue, &queued);
      if (!sent) {
        infoLine = grblClient.lastError().isEmpty() ? "Step send failed" : ("GRBL " + grblClient.lastError());
        return;
      }
      infoLine = "";
      stepAxis++;
      stepValue = 0.0f;
      if (stepAxis >= static_cast<int>(machineCfg.axes.size())) {
        stepAxis = static_cast<int>(machineCfg.axes.size()) - 1;
        stepActionIndex = 0;
        screen = Screen::StepActions;
      }
    } else if (machineCfg.operation_mode == "parallel") {
      if (stepAxis < static_cast<int>(machineCfg.axes.size()) - 1) {
        stepAxis++;
      } else {
        const bool queued = queueParallelMove(stepValues);
        if (!queued) {
          infoLine = grblClient.lastError().isEmpty() ? "Move failed" : ("GRBL " + grblClient.lastError());
          return;
        }
        infoLine = "Parallel move sent";
        stepActionIndex = 0;
        screen = Screen::StepActions;
      }
    } else {
      // mpg mode: short press advances axis. Stop any active throttle jog
      // first so we don't keep streaming on the previous axis.
      mpgStopJog();
      stepAxis++;
      stepValue = 0.0f;
      if (stepAxis >= static_cast<int>(machineCfg.axes.size())) {
        stepAxis = static_cast<int>(machineCfg.axes.size()) - 1;
        stepActionIndex = 0;
        screen = Screen::StepActions;
      }
    }
    return;
  }

  if (screen == Screen::StepActions) {
    switch (stepActionIndex) {
      case 0: // Next
        stepAxis = 0;
        stepValue = 0.0f;
        stepValues.assign(machineCfg.axes.size(), 0.0f);
        screen = Screen::Step;
        break;
      case 1: // Save
        recordCurrentStep();
        programStore.listPrograms(programNames);
        // Land on "New program" as the default selection (most common case).
        saveProgramIndex = static_cast<int>(programNames.size());
        saveModeIndex = 0;
        screen = Screen::StepSaveTarget;
        break;
    }
    return;
  }

  if (screen == Screen::StepSaveTarget) {
    const int N = static_cast<int>(programNames.size());
    if (saveProgramIndex < N) {
      saveTargetName = programNames[saveProgramIndex];
      saveModeIndex = 1;  // existing -> default Overwrite
      screen = Screen::StepSaveMode;
    } else if (saveProgramIndex == N) {
      // "New program"
      saveTargetName = programStore.nextAutoName();
      saveModeIndex = 0;  // new -> default Append
      screen = Screen::StepSaveMode;
    } else {
      // "Del program"
      if (N == 0) {
        infoLine = "No programs";
      } else {
        saveDeleteIndex = 0;
        screen = Screen::StepSaveDelete;
      }
    }
    return;
  }

  if (screen == Screen::StepSaveMode) {
    bool append = saveModeIndex == 0;
    saveTeachProgram(saveTargetName, append);
    stepAxis = 0;
    stepValue = 0.0f;
    stepValues.assign(machineCfg.axes.size(), 0.0f);
    screen = Screen::Step;
    return;
  }

  if (screen == Screen::StepSaveDelete) {
    if (programNames.empty()) {
      screen = Screen::StepSaveTarget;
      return;
    }
    String name = programNames[saveDeleteIndex];
    if (programStore.deleteProgram(name)) {
      infoLine = String("Removed ") + name;
    } else {
      infoLine = "Delete err";
    }
    programStore.listPrograms(programNames);
    if (saveDeleteIndex >= static_cast<int>(programNames.size())) {
      saveDeleteIndex = static_cast<int>(programNames.size()) - 1;
      if (saveDeleteIndex < 0) saveDeleteIndex = 0;
    }
    if (saveProgramIndex > static_cast<int>(programNames.size()) + 1) {
      saveProgramIndex = static_cast<int>(programNames.size()) + 1;
    }
    screen = Screen::StepSaveTarget;
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
  if (screen == Screen::SetupAxes && setupAxesCursor == 2 && setupAxesEditing &&
      (setupAxesField == 0 || setupAxesField == 1)) {
    AxisConfig &a = machineCfg.axes[setupAxesAxis];
    if (setupAxesField == 0) a.has_min_limit = !a.has_min_limit;
    else                     a.has_max_limit = !a.has_max_limit;
    persistActiveProfile();
    uiDirty = true;
    return;
  }
  if (screen == Screen::Step && !stepFeedEdit) {
    stepFeedEdit = true;
    infoLine = "Feed rate edit";
    uiDirty = true;
    return;
  }
  navigateBack();
}

static void handleInput() {
  int delta = encoderDelta();
  ButtonEvent ev = buttonEvent();

  if (delta != 0) {
    switch (screen) {
      case Screen::Home:
        homeIndex = (homeIndex + delta + homeCount) % homeCount;
        persistHomeIndex();
        uiDirty = true;
        break;
      case Screen::Setup: {
        int ni = setupMenuIndex + delta;
        if (ni >= 0 && ni < setupMenuCount) setupMenuIndex = ni;
        uiDirty = true;
        break;
      }
      case Screen::SetupProfile: {
        int ni = setupProfileMenuIndex + delta;
        if (ni >= 0 && ni < profileMenuItemCount) setupProfileMenuIndex = ni;
        uiDirty = true;
        break;
      }
      case Screen::SetupProfileSelect: {
        int total = static_cast<int>(profileSet.profiles.size());
        if (total > 0) {
          int ni = profileSelectIndex + delta;
          if (ni < 0) ni = 0;
          if (ni >= total) ni = total - 1;
          profileSelectIndex = ni;
        }
        uiDirty = true;
        break;
      }
      case Screen::SetupAxes:
        handleSetupAxesRotate(delta);
        uiDirty = true;
        break;
      case Screen::SetupDriver:
        handleSetupDriverRotate(delta);
        uiDirty = true;
        break;
      case Screen::Step:
        viewModel.applyAdaptiveDelta(delta);
        break;
      case Screen::StepActions: {
        int ni = stepActionIndex + delta;
        if (ni >= 0 && ni < stepActionCount) stepActionIndex = ni;
        uiDirty = true;
        break;
      }
      case Screen::StepSaveTarget: {
        int count = static_cast<int>(programNames.size()) + 2;
        saveProgramIndex = (saveProgramIndex + delta + count) % count;
        uiDirty = true;
        break;
      }
      case Screen::StepSaveMode:
        saveModeIndex = (saveModeIndex + delta + saveModeCount) % saveModeCount;
        uiDirty = true;
        break;
      case Screen::StepSaveDelete: {
        int total = static_cast<int>(programNames.size());
        if (total > 0) {
          int ni = saveDeleteIndex + delta;
          if (ni < 0) ni = 0;
          if (ni >= total) ni = total - 1;
          saveDeleteIndex = ni;
        }
        uiDirty = true;
        break;
      }
      case Screen::ProgramList:
        if (!programNames.empty()) {
          int count = static_cast<int>(programNames.size()) + 1;
          programIndex = (programIndex + delta + count) % count;
        } else {
          programIndex = 0;
        }
        uiDirty = true;
        break;
      default:
        break;
    }
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
  if (!configStore.loadAll(profileSet) || profileSet.profiles.empty()) {
    profileSet = configStore.seedDefaults();
    configStore.saveAll(profileSet);
  }
  syncMachineCfgFromActive();
  uiPrefs.begin("crowpanel", false);
  homeIndex = wrappedHomeIndex(uiPrefs.getInt("home_idx", homeIndex));
  savedHomeIndex = homeIndex;
  stepValues.assign(machineCfg.axes.size(), 0.0f);
  teachCombined.assign(machineCfg.axes.size(), 0.0f);

  programStore.begin();
  programStore.listPrograms(programNames);

  GrblSerial.begin(GRBL_UART_BAUD, SERIAL_8N1, GRBL_UART_RX_PIN, GRBL_UART_TX_PIN);
  grblClient.begin(&GrblSerial, &grblParser);
  grblClient.setMotionAllowed(false);
  grblClient.sendRealtime(kOwnQueryRt);

  mpgJogRate = 0.0f;
  mpgLastSentRate = 0.0f;
  mpgJogActive = false;
  mpgLastJogMs = 0;
}

void loop() {
  handleInput();
  grblClient.update();
  updateOwnershipFromStatus();

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

  {
    const uint32_t statusInterval =
        (screen == Screen::Step || screen == Screen::StepActions) ? 500 : 200;
    if (now - lastStatusMs > statusInterval) {
      grblClient.requestStatus();
      lastStatusMs = now;
    }
  }

  if (screen == Screen::Step && !stepFeedEdit && machineCfg.operation_mode == "mpg") {
    mpgRefreshJog();
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
  delay(1);
}
