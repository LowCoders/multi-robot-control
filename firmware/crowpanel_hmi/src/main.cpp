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
#include "transport.h"
#include "transport_bluetooth.h"
#include "transport_uart.h"
#include "transport_wifi.h"
#include "vertical_menu.h"
#include "wifi_scan.h"

static CrowPanelLGFX gfx;
static HardwareSerial GrblSerial(1);
static GrblParser grblParser;
static GrblClient grblClient;
static ConfigStore configStore;
static UartTransport uartTransport(GrblSerial, GRBL_UART_RX_PIN, GRBL_UART_TX_PIN, GRBL_UART_BAUD);
static WifiTcpTransport wifiTransport;
static BluetoothTransport bluetoothTransport;
static IGrblTransport *currentTransport = nullptr;
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
static lv_obj_t *txLogPanel = nullptr;
static lv_obj_t *txLogLabel = nullptr;
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
  SetupPanel,
  SetupPanelSsidScan,
  SetupExtras,
  SetupExtraEdit,
  Step,
  StepActions,
  StepOptionsList,
  StepOptionDetail,
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
static const char *setupMenuItems[] = {"Profile", "Axes", "Driver", "Panel", "Extras"};
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

// SetupPanel: communication-link configuration screen.
// cursor 0 = field list, 1 = editing.
// String fields (ssid/pass/host) use a positional character editor:
// rotate cycles characters at the current position; short press advances
// (auto-extends with space at end); long press commits and exits the
// string editor back to field selection.
static const char *kPanelChannels[] = {"uart", "wifi", "bluetooth"};
static const int kPanelChannelCount = sizeof(kPanelChannels) / sizeof(kPanelChannels[0]);
static const uint32_t kPanelBaudPresets[] = {9600, 19200, 38400, 57600, 115200, 230400, 460800};
static const int kPanelBaudCount = sizeof(kPanelBaudPresets) / sizeof(kPanelBaudPresets[0]);
static const char *kPanelWifiModes[] = {"ap_join", "sta"};
static const int kPanelWifiModeCount = sizeof(kPanelWifiModes) / sizeof(kPanelWifiModes[0]);
static const char *kPanelEditCharset =
    " 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-_:/";

static int setupPanelField = 0;
static int setupPanelCursor = 0;
static bool setupPanelEditing = false;
static bool setupPanelStringEditing = false;
static int setupPanelStringPos = 0;
static String setupPanelStringBuf;
static String *setupPanelStringTarget = nullptr;
static constexpr int kPanelStringMaxLen = 32;

static const char **panelFieldList(int &count);
static String panelFieldDisplayValue(const char *field);
static void selectTransport(const PanelLinkConfig &lc);
static void panelStringBeginEdit(String *target);
static String linkStatusText();

// SetupPanelSsidScan state.  Two static "control" rows are always present
// at the top of the list: row 0 = Rescan, row 1 = Manual entry; the actual
// scan results follow at index 2..N+1.
static int setupPanelSsidScanCursor = 0;

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
// Built dynamically from rebuildStepActions(): always {"Next Step"}, with
// "Options" inserted only when at least one extra declaration is enabled,
// and "Save" appended last.  Keeps the menu free of clutter on machines
// with no extras configured.
static std::vector<String> stepActions;

// ── Setup > Extras state ────────────────────────────────────────────────────
// SetupExtras: list view of declared extras with [add] / [del last] entries.
static int setupExtrasCursor = 0;
// SetupExtraEdit: editing one declaration; `setupExtraEditIdx` indexes into
// machineCfg.extras.items.  Field cursor + per-field editing flags mirror
// the SetupAxes/SetupPanel pattern.
static int setupExtraEditIdx = -1;
static int setupExtraField = 0;
static int setupExtraCursor = 0;       // 0 = field list, 1 = editing
static bool setupExtraEditing = false;
// String editor reused for label / onTemplate / offTemplate fields.  Mirrors
// the panelString* helpers but lives in its own state so the two editors
// can never collide.
static bool extraStringEditing = false;
static String extraStringBuf;
static int extraStringPos = 0;
static String *extraStringTarget = nullptr;
static constexpr int kExtraStringMaxLen = 32;
static const char *kExtraEditCharset =
    " 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-_:/{}=GMT";

static const char *setupExtraFields[] = {
    "type", "enabled", "label", "ioPort",
    "maxPower", "maxRPM", "onTpl", "offTpl"};
static const int setupExtraFieldCount = sizeof(setupExtraFields) / sizeof(setupExtraFields[0]);

// ── StepOptions state ───────────────────────────────────────────────────────
// Pending extra commands attached to the next saved step.  Populated when
// the user picks a preset on the StepOptionDetail screen; consumed and
// cleared once the step is recorded into teachBuffer.
static std::vector<ExtraCommand> pendingStepExtras;
// Cursor for StepOptionsList (which extra to edit, plus a trailing "Done").
static int stepOptionsListCursor = 0;
// Index into machineCfg.extras.items for the extra currently being edited.
static int stepOptionEditIdx = -1;
// Cursor for StepOptionDetail preset list.
static int stepOptionDetailCursor = 0;

static int saveProgramIndex = 0;
static int saveModeIndex = 0;
static const char *saveModes[] = {"Append", "Overwrite"};
static const int saveModeCount = sizeof(saveModes) / sizeof(saveModes[0]);
// Selected program name for the StepSaveMode screen (existing program or
// freshly auto-generated name when "New program" was picked).
static String saveTargetName;
// Cursor for the StepSaveDelete sub-list.
static int saveDeleteIndex = 0;

// NVS-mirrored "last selection" memories (loaded at boot, written on commit).
static String savedSaveTargetName;
static int    savedSaveModeIndex = -1;
static String savedProgramSelectedName;

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
    case Screen::SetupPanel: return "PNL";
    case Screen::SetupPanelSsidScan: return "SCAN";
    case Screen::SetupExtras: return "EXTR";
    case Screen::SetupExtraEdit: return "EXTR";
    case Screen::Step: return "STEP";
    case Screen::StepActions: return "ACT";
    case Screen::StepOptionsList: return "OPT";
    case Screen::StepOptionDetail: return "OPT";
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

static void persistSaveTargetName(const String &name) {
  if (savedSaveTargetName == name) {
    return;
  }
  uiPrefs.putString("sav_tgt_name", name);
  savedSaveTargetName = name;
}

static void persistSaveModeIndex() {
  if (savedSaveModeIndex == saveModeIndex) {
    return;
  }
  uiPrefs.putInt("sav_mode", saveModeIndex);
  savedSaveModeIndex = saveModeIndex;
}

static void persistProgramSelectedName(const String &name) {
  if (savedProgramSelectedName == name) {
    return;
  }
  uiPrefs.putString("prog_sel_name", name);
  savedProgramSelectedName = name;
}

static void refreshHomeCards() {
  // Layout:
  //   - Status icon centred at the top of the screen.
  //   - Program / Step / Setup icons share the middle row of the screen,
  //     Step in the centre with Program to its left and Setup to its right.
  //   - Each icon's caption sits directly below it.
  //   - The yellow `infoLine` (line1Label on Home) is placed by the render
  //     branch in the band below the Step caption.
  // Slot positions are fixed (no rotation around the active item); the
  // active slot is communicated only through colour (handled by the
  // render branch).
  static const lv_coord_t cardSize = 64;
  static const lv_coord_t labelOffset = cardSize / 2 + 10;
  static const lv_coord_t middleRowSpacing = 80;
  // index -> (dx, dy) relative to LV_ALIGN_CENTER (screen centre = 0,0).
  // 0=Status (top), 1=Setup (mid-right), 2=Step (centre), 3=Program (mid-left).
  static const lv_coord_t slotDx[4] = { 0,  middleRowSpacing, 0, -middleRowSpacing };
  static const lv_coord_t slotDy[4] = {-84, 0,                0, 0 };

  for (int i = 0; i < homeCount; i++) {
    if (!homeCardButtons[i] || !homeCardIcons[i] || !homeCardLabels[i]) {
      continue;
    }
    const lv_coord_t dx = slotDx[i];
    const lv_coord_t dy = slotDy[i];

    lv_label_set_text(homeCardIcons[i], homeItemSymbol(i));
    lv_label_set_text(homeCardLabels[i], fitLine(homeItems[i], 10).c_str());

    lv_obj_set_size(homeCardButtons[i], cardSize, cardSize);
    lv_obj_align(homeCardButtons[i], LV_ALIGN_CENTER, dx, dy);
    lv_obj_set_style_text_font(homeCardIcons[i], &lv_font_montserrat_24, LV_PART_MAIN);

    // Captions sit directly below their icon. The Program icon's caption
    // is nudged a few pixels to the right so the descender of the
    // lower-case "p" isn't clipped by the screen edge.
    lv_coord_t labelDx = dx;
    lv_coord_t labelDy = static_cast<lv_coord_t>(dy + labelOffset);
    if (i == 3) {  // Program (mid-left)
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
    case Screen::SetupPanel: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupPanelSsidScan: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupExtras: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::SetupExtraEdit: return {0x2A1F38, 0xF6EDFF, 0xBC8CFF};
    case Screen::Step: return {0x233229, 0xEDFFF2, 0x5FFB92};
    case Screen::StepActions: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::StepOptionsList: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
    case Screen::StepOptionDetail: return {0x362A1F, 0xFFF4E8, 0xFFB35A};
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
      // Reset Step working values so a later entry starts clean, but always
      // land on Home so the user explicitly chooses the next action (Step,
      // Status, Program, ...) instead of being dropped into the editor.
      stepAxis = 0;
      stepValue = 0.0f;
      stepValues.assign(machineCfg.axes.size(), 0.0f);
      stepFeedEdit = false;
      screen = Screen::Home;
      uiDirty = true;
    } else if (owner.equalsIgnoreCase("host")) {
      infoLine = "Host active: monitor mode";
      screen = Screen::Home;
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

// ── Extras: helpers ──────────────────────────────────────────────────────────

// Display label for an extra declaration: prefer the user-supplied label,
// otherwise fall back to the canonical type name.
static String extraDisplayLabel(const ExtraDeclaration &d) {
  return d.label.isEmpty() ? String(extraTypeLabel(d.type)) : d.label;
}

// Returns true if at least one declaration is enabled.  Used to decide
// whether the "Options" entry should appear in the StepActions menu.
static bool anyExtraEnabled() {
  for (const auto &e : machineCfg.extras.items) if (e.enabled) return true;
  return false;
}

// Indices of enabled declarations; kept stable across calls (order matches
// machineCfg.extras.items so rebuilding mid-flow doesn't shuffle the menu).
static std::vector<int> enabledExtraIndices() {
  std::vector<int> out;
  for (size_t i = 0; i < machineCfg.extras.items.size(); i++) {
    if (machineCfg.extras.items[i].enabled) out.push_back(static_cast<int>(i));
  }
  return out;
}

// Rebuild the StepActions menu to include "Options" only when relevant.
static void rebuildStepActions() {
  stepActions.clear();
  stepActions.push_back("Next Step");
  if (anyExtraEnabled()) stepActions.push_back("Options");
  stepActions.push_back("Save");
  if (stepActionIndex < 0) stepActionIndex = 0;
  if (stepActionIndex >= static_cast<int>(stepActions.size())) {
    stepActionIndex = static_cast<int>(stepActions.size()) - 1;
  }
}

// Substitute {val} / {port} in a template into a concrete G/M code line.
// `val` is rendered without trailing zeros for whole numbers (so M3 S500
// not M3 S500.00); fractional values keep two decimals.
static String substituteExtraTemplate(const String &tmpl, float val, int port) {
  String out = tmpl;
  String valStr;
  if (val == static_cast<float>(static_cast<int>(val))) {
    valStr = String(static_cast<int>(val));
  } else {
    valStr = String(val, 2);
  }
  out.replace("{val}", valStr);
  out.replace("{port}", String(port));
  return out;
}

struct ExtraPreset {
  String label;
  std::vector<String> lines;
};

// Build the list of presets exposed on the StepOptionDetail screen for a
// given extra declaration.  Keep the first entry as "Clear" so the user
// can detach a previously chosen preset without dropping back to back nav.
static std::vector<ExtraPreset> buildExtraPresets(const ExtraDeclaration &d) {
  std::vector<ExtraPreset> out;
  out.push_back({"Clear", {}});

  auto withDefaultsOn = [&](const String &fallback) -> String {
    return d.onTemplate.isEmpty() ? fallback : d.onTemplate;
  };
  auto withDefaultsOff = [&](const String &fallback) -> String {
    return d.offTemplate.isEmpty() ? fallback : d.offTemplate;
  };

  switch (d.type) {
    case ExtraType::Gripper: {
      String openTpl = withDefaultsOn("M62 P{port}");
      String closeTpl = withDefaultsOff("M63 P{port}");
      out.push_back({"Open",  {substituteExtraTemplate(openTpl, 1.0f, d.ioPort)}});
      out.push_back({"Close", {substituteExtraTemplate(closeTpl, 0.0f, d.ioPort)}});
      break;
    }
    case ExtraType::Sucker: {
      String onTpl  = withDefaultsOn("M62 P{port}");
      String offTpl = withDefaultsOff("M63 P{port}");
      out.push_back({"On",  {substituteExtraTemplate(onTpl, 1.0f, d.ioPort)}});
      out.push_back({"Off", {substituteExtraTemplate(offTpl, 0.0f, d.ioPort)}});
      break;
    }
    case ExtraType::Vacuum: {
      String onTpl  = withDefaultsOn("M62 P{port}");
      String offTpl = withDefaultsOff("M63 P{port}");
      out.push_back({"On",  {substituteExtraTemplate(onTpl, 1.0f, d.ioPort)}});
      out.push_back({"Off", {substituteExtraTemplate(offTpl, 0.0f, d.ioPort)}});
      break;
    }
    case ExtraType::Laser: {
      String onTpl  = withDefaultsOn("M3 S{val}");
      String offTpl = withDefaultsOff("M5");
      // Power presets: 25/50/75/100 % of declared maxPower, plus an Off entry.
      const float maxP = d.maxPower > 0.0f ? d.maxPower : 1000.0f;
      static const int pcts[] = {25, 50, 75, 100};
      for (int p : pcts) {
        float val = roundf(maxP * static_cast<float>(p) / 100.0f);
        String label = String(p) + "%";
        out.push_back({label, {substituteExtraTemplate(onTpl, val, d.ioPort)}});
      }
      out.push_back({"Off", {substituteExtraTemplate(offTpl, 0.0f, d.ioPort)}});
      break;
    }
    case ExtraType::Spindle: {
      const float rpm = d.maxSpindleRpm > 0.0f ? d.maxSpindleRpm : 12000.0f;
      out.push_back({"CW",  {String("M3 S") + String(static_cast<int>(rpm))}});
      out.push_back({"CCW", {String("M4 S") + String(static_cast<int>(rpm))}});
      out.push_back({"Off", {String("M5")}});
      break;
    }
    case ExtraType::Coolant: {
      out.push_back({"Mist (M7)",  {String("M7")}});
      out.push_back({"Flood (M8)", {String("M8")}});
      out.push_back({"Off (M9)",   {String("M9")}});
      break;
    }
    case ExtraType::Probe: {
      // Probe down -10 mm at the configured feed (maxPower repurposed as
      // probe feed when set, else 100 mm/min default).
      const float feed = d.maxPower > 0.0f ? d.maxPower : 100.0f;
      out.push_back({"Probe Z-10",
                     {String("G38.2 Z-10 F") + String(static_cast<int>(feed))}});
      break;
    }
    case ExtraType::ToolChanger: {
      // ioPort doubles as default tool number; expose T{port}, T{port}+1,
      // T{port}+2 so the user can teach a small set without leaving the menu.
      const int t0 = d.ioPort > 0 ? d.ioPort : 1;
      for (int i = 0; i < 3; i++) {
        int t = t0 + i;
        out.push_back({String("T") + String(t),
                       {String("M6 T") + String(t)}});
      }
      break;
    }
    case ExtraType::Custom: {
      if (!d.onTemplate.isEmpty()) {
        out.push_back({"On",  {substituteExtraTemplate(d.onTemplate,  1.0f, d.ioPort)}});
      }
      if (!d.offTemplate.isEmpty()) {
        out.push_back({"Off", {substituteExtraTemplate(d.offTemplate, 0.0f, d.ioPort)}});
      }
      if (out.size() == 1) {
        // No templates configured; surface a hint instead of an empty menu.
        out.push_back({"(set in Setup)", {}});
      }
      break;
    }
  }
  return out;
}

// Returns the index of the pending extra command for the given declaration,
// or -1 if nothing is currently attached.  Match key is type + label so
// the same extra type can be declared twice with different labels.
static int findPendingExtraIdx(const ExtraDeclaration &d) {
  const String label = extraDisplayLabel(d);
  for (size_t i = 0; i < pendingStepExtras.size(); i++) {
    if (pendingStepExtras[i].type == d.type &&
        pendingStepExtras[i].label == label) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

// Apply the user's preset choice: an empty `lines` list clears any existing
// pending entry; otherwise the entry is upserted (replace if same label).
static void applyExtraPreset(const ExtraDeclaration &d, const ExtraPreset &p) {
  const int existing = findPendingExtraIdx(d);
  if (p.lines.empty()) {
    if (existing >= 0) {
      pendingStepExtras.erase(pendingStepExtras.begin() + existing);
    }
    return;
  }
  ExtraCommand cmd;
  cmd.type = d.type;
  cmd.label = extraDisplayLabel(d);
  cmd.lines = p.lines;
  if (existing >= 0) {
    pendingStepExtras[existing] = cmd;
  } else {
    pendingStepExtras.push_back(cmd);
  }
}

// Helper: make sure pending extras are attached to the most recently saved
// teach step.  Used in serial mode where each axis pushes its own step;
// the extras should ride along with the very last one so they fire after
// the multi-axis sequence completes.
static void flushPendingExtrasIntoLastStep() {
  if (pendingStepExtras.empty() || teachBuffer.steps.empty()) return;
  ProgramStep &last = teachBuffer.steps.back();
  last.extras.insert(last.extras.end(),
                     pendingStepExtras.begin(),
                     pendingStepExtras.end());
}

// ── Extras: string editor (separate state from SetupPanel) ───────────────────

static void extraStringBeginEdit(String *target) {
  if (!target) return;
  extraStringTarget = target;
  extraStringBuf = *target;
  if (extraStringBuf.length() > kExtraStringMaxLen) {
    extraStringBuf = extraStringBuf.substring(0, kExtraStringMaxLen);
  }
  extraStringPos = extraStringBuf.length();
  if (extraStringPos < kExtraStringMaxLen) {
    extraStringBuf += ' ';
  } else {
    extraStringPos = kExtraStringMaxLen - 1;
  }
  extraStringEditing = true;
}

static void extraStringCommit() {
  if (!extraStringEditing) return;
  if (extraStringTarget) {
    String trimmed = extraStringBuf;
    while (trimmed.length() > 0 && trimmed[trimmed.length() - 1] == ' ') {
      trimmed.remove(trimmed.length() - 1);
    }
    *extraStringTarget = trimmed;
  }
  extraStringEditing = false;
  extraStringTarget = nullptr;
  extraStringBuf = "";
  extraStringPos = 0;
}

static void extraStringRotate(int delta) {
  if (!extraStringEditing || delta == 0) return;
  if (extraStringPos < 0 || extraStringPos >= static_cast<int>(extraStringBuf.length())) {
    return;
  }
  const int csLen = static_cast<int>(strlen(kExtraEditCharset));
  char cur = extraStringBuf[extraStringPos];
  int curIdx = 0;
  for (int i = 0; i < csLen; i++) {
    if (kExtraEditCharset[i] == cur) { curIdx = i; break; }
  }
  int next = ((curIdx + delta) % csLen + csLen) % csLen;
  extraStringBuf[extraStringPos] = kExtraEditCharset[next];
}

static void extraStringAdvance() {
  if (!extraStringEditing) return;
  extraStringPos++;
  if (extraStringPos >= static_cast<int>(extraStringBuf.length())) {
    if (extraStringBuf.length() < kExtraStringMaxLen) {
      extraStringBuf += ' ';
    } else {
      extraStringPos = extraStringBuf.length() - 1;
    }
  }
}

// Serial mode helper: each successful single-axis jog on the Step screen
// pushes its own ProgramStep into the teach buffer, so by the time the
// user reaches "Save" the buffer already contains one entry per axis with
// the actual values (the `stepValue` global is reset after each press).
static void recordSerialAxisStep(int axis_idx, float value) {
  if (axis_idx < 0 || axis_idx >= static_cast<int>(machineCfg.axes.size())) {
    return;
  }
  if (fabsf(value) < 0.0005f) {
    return;
  }
  ProgramStep s;
  s.mode = "step";
  s.axes.assign(machineCfg.axes.size(), 0.0f);
  s.axes[axis_idx] = value;
  s.feed = effectiveFeed(machineCfg.axes[axis_idx]);
  s.comment = "teach";
  teachBuffer.steps.push_back(s);
}

static void recordCurrentStep() {
  ProgramStep s;
  if (machineCfg.operation_mode == "serial") {
    // Serial mode steps are recorded incrementally via recordSerialAxisStep
    // on each successful per-axis jog.  At Save time `stepValue` is already
    // zero, so doing it here would only ever append a no-op all-zero step;
    // attach any pending extras to the most recently saved step instead so
    // they ride along with the multi-axis sequence.
    flushPendingExtrasIntoLastStep();
    return;
  } else if (machineCfg.operation_mode == "mpg") {
    // In MPG mode the user teaches the *current* machine pose by jogging,
    // so the values to record are the live GRBL axis positions, not the
    // never-updated `stepValues` (which would always be all zeros and
    // produce a useless "G90 X0 Y0 Z0" target).
    s.mode = "pos";
    s.axes = statusAxes();
    if (s.axes.size() < machineCfg.axes.size()) {
      s.axes.resize(machineCfg.axes.size(), 0.0f);
    }
    float minRate = INFINITY;
    for (size_t i = 0; i < machineCfg.axes.size(); i++) {
      float r = effectiveFeed(machineCfg.axes[i]);
      if (r < minRate) minRate = r;
    }
    if (!isfinite(minRate)) minRate = 1000.0f;
    s.feed = minRate;
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
  s.extras = pendingStepExtras;
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
  pendingStepExtras.clear();
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

  // ProgramRun TX log: a wide, tall scrollable panel centred on the screen
  // ending above the bottom Back button.  Auto-scrolls to the latest line on
  // every refresh, and finger-drag scrolling stays enabled so the user can
  // browse historical lines.  Hidden everywhere except Screen::ProgramRun.
  txLogPanel = lv_obj_create(lv_scr_act());
  lv_obj_set_size(txLogPanel, 200, 124);
  lv_obj_align(txLogPanel, LV_ALIGN_TOP_MID, 0, 76);
  lv_obj_set_style_pad_all(txLogPanel, 4, LV_PART_MAIN);
  lv_obj_set_style_border_width(txLogPanel, 0, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(txLogPanel, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_radius(txLogPanel, 4, LV_PART_MAIN);
  lv_obj_set_scroll_dir(txLogPanel, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(txLogPanel, LV_SCROLLBAR_MODE_AUTO);
  lv_obj_add_flag(txLogPanel, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_flag(txLogPanel, LV_OBJ_FLAG_SCROLLABLE);

  txLogLabel = lv_label_create(txLogPanel);
  lv_obj_set_width(txLogLabel, 188);
  lv_label_set_long_mode(txLogLabel, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_align(txLogLabel, LV_TEXT_ALIGN_LEFT, LV_PART_MAIN);
  lv_obj_set_style_text_font(txLogLabel, &lv_font_montserrat_14, LV_PART_MAIN);
  lv_label_set_text(txLogLabel, "");

  lv_obj_add_flag(txLogPanel, LV_OBJ_FLAG_HIDDEN);

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
    case Screen::SetupPanel: {
      int count = 0;
      const char **fields = panelFieldList(count);
      if (setupPanelField < 0) setupPanelField = 0;
      if (setupPanelField >= count) setupPanelField = count - 1;
      if (setupPanelCursor == 0) {
        title = "Panel";
        std::vector<VerticalMenuItem> rows;
        for (int i = 0; i < count; i++) {
          VerticalMenuItem row;
          row.label = fields[i];
          row.value = panelFieldDisplayValue(fields[i]);
          rows.push_back(row);
        }
        l1 = renderVerticalMenu(rows, setupPanelField);
        l2 = "";
        l3 = "";
      } else if (setupPanelStringEditing) {
        const char *field = fields[setupPanelField];
        title = String("Panel > ") + field;
        l1 = String("pos ") + String(setupPanelStringPos + 1) + "/" + String(setupPanelStringBuf.length());
        // Build a display string with brackets around the active char so the
        // user can spot the cursor position.
        String shown;
        for (int i = 0; i < static_cast<int>(setupPanelStringBuf.length()); i++) {
          char c = setupPanelStringBuf[i];
          if (i == setupPanelStringPos) {
            shown += '[';
            shown += (c == ' ' ? '_' : c);
            shown += ']';
          } else {
            shown += (c == ' ' ? '_' : c);
          }
        }
        l2 = shown;
        l3 = "rot:char  press:next  hold:OK";
      } else {
        const char *field = fields[setupPanelField];
        title = String("Panel > ") + field;
        l1 = field;
        l2 = panelFieldDisplayValue(field);
        l3 = "";
      }
      break;
    }
    case Screen::SetupPanelSsidScan: {
      title = "WiFi scan";
      WifiScanState st = wifiScanState();
      // Build the list with raw row strings (no padded label-column) so we
      // can fit longer SSIDs at smaller font size; the selected row is
      // wrapped in an LVGL recolor tag (`#FFD400 ...#`) for emphasis.
      struct Row { String text; };
      std::vector<Row> rows;
      {
        Row r;
        r.text = String("Rescan");
        if (st == WifiScanState::Running) r.text += " ...";
        rows.push_back(r);
      }
      {
        Row r;
        r.text = String("Manual entry");
        rows.push_back(r);
      }
      if (st == WifiScanState::Done) {
        int n = wifiScanCount();
        for (int i = 0; i < n; i++) {
          Row r;
          String ssid = wifiScanSsid(i);
          // Truncate long SSIDs so the row + RSSI fits within the label
          // width even at the smaller font size.
          if (ssid.length() > 18) ssid = ssid.substring(0, 17) + "~";
          r.text = ssid + "  " + String(wifiScanRssi(i)) + "dBm";
          if (wifiScanIsSecure(i)) r.text += " *";
          rows.push_back(r);
        }
      }
      int rowCount = static_cast<int>(rows.size());
      if (setupPanelSsidScanCursor < 0) setupPanelSsidScanCursor = 0;
      if (setupPanelSsidScanCursor >= rowCount) setupPanelSsidScanCursor = rowCount - 1;

      // Sliding window: smaller font lets us show more rows comfortably
      // (the `setupMenu` layout block centres `line1Label` based on the
      // newline count, so this just expands it vertically).
      const int kMaxVisible = 8;
      const int visCount = rowCount < kMaxVisible ? rowCount : kMaxVisible;
      int winStart = setupPanelSsidScanCursor - visCount / 2;
      if (winStart < 0) winStart = 0;
      if (winStart > rowCount - visCount) winStart = rowCount - visCount;

      String out;
      for (int v = 0; v < visCount; v++) {
        int idx = winStart + v;
        if (v > 0) out += '\n';
        if (idx == setupPanelSsidScanCursor) {
          // LVGL recolor: `#RRGGBB text#` paints `text` in the given hex
          // colour; recolor must be enabled on the label (done below).
          out += "#FFD400 > ";
          out += rows[idx].text;
          out += "#";
        } else {
          out += "  ";
          out += rows[idx].text;
        }
      }
      l1 = out;

      if (st == WifiScanState::Running) {
        l2 = "scanning...";
      } else if (st == WifiScanState::Failed) {
        l2 = "scan failed";
      } else if (st == WifiScanState::Done) {
        l2 = String(wifiScanCount()) + " AP";
      } else {
        l2 = "";
      }
      l3 = "rot:sel  press:ok  hold:back";
      break;
    }
    case Screen::SetupExtras: {
      title = "Extras";
      const int n = static_cast<int>(machineCfg.extras.items.size());
      std::vector<VerticalMenuItem> rows;
      for (int i = 0; i < n; i++) {
        const auto &d = machineCfg.extras.items[i];
        rows.push_back({extraDisplayLabel(d), d.enabled ? String("on") : String("off")});
      }
      rows.push_back({"Add Extra", ""});
      rows.push_back({"Del Last", ""});
      l1 = renderVerticalMenu(rows, setupExtrasCursor);
      l2 = "";
      l3 = "";
      break;
    }
    case Screen::SetupExtraEdit: {
      const int n = static_cast<int>(machineCfg.extras.items.size());
      if (setupExtraEditIdx < 0 || setupExtraEditIdx >= n) {
        title = "Extras";
        l1 = "(no extra)";
        l2 = "";
        l3 = "";
        break;
      }
      const ExtraDeclaration &d = machineCfg.extras.items[setupExtraEditIdx];
      if (setupExtraCursor == 0) {
        title = String("Extra > ") + extraDisplayLabel(d);
        std::vector<VerticalMenuItem> rows = {
          {"type",     extraTypeLabel(d.type)},
          {"enabled",  d.enabled ? String("ON") : String("OFF")},
          {"label",    d.label.isEmpty() ? String("(auto)") : d.label},
          {"ioPort",   String(d.ioPort)},
          {"maxPower", String(d.maxPower, 0)},
          {"maxRPM",   String(d.maxSpindleRpm, 0)},
          {"onTpl",    d.onTemplate.isEmpty() ? String("(auto)") : d.onTemplate},
          {"offTpl",   d.offTemplate.isEmpty() ? String("(auto)") : d.offTemplate},
        };
        l1 = renderVerticalMenu(rows, setupExtraField);
        l2 = "";
        l3 = "";
      } else if (extraStringEditing) {
        title = String("Extra > ") + setupExtraFields[setupExtraField];
        l1 = String("pos ") + String(extraStringPos + 1) + "/" + String(extraStringBuf.length());
        String shown;
        for (int i = 0; i < static_cast<int>(extraStringBuf.length()); i++) {
          char c = extraStringBuf[i];
          if (i == extraStringPos) {
            shown += '[';
            shown += (c == ' ' ? '_' : c);
            shown += ']';
          } else {
            shown += (c == ' ' ? '_' : c);
          }
        }
        l2 = shown;
        l3 = "rot:char  press:next  hold:OK";
      } else {
        title = String("Extra > ") + setupExtraFields[setupExtraField];
        String val;
        switch (setupExtraField) {
          case 0: val = extraTypeLabel(d.type); break;
          case 1: val = d.enabled ? "ON" : "OFF"; break;
          case 2: val = d.label.isEmpty() ? "(auto)" : d.label; break;
          case 3: val = String(d.ioPort); break;
          case 4: val = String(d.maxPower, 0); break;
          case 5: val = String(d.maxSpindleRpm, 0); break;
          case 6: val = d.onTemplate.isEmpty() ? "(auto)" : d.onTemplate; break;
          case 7: val = d.offTemplate.isEmpty() ? "(auto)" : d.offTemplate; break;
        }
        l1 = setupExtraFields[setupExtraField];
        l2 = val;
        l3 = "rot:edit  hold:back";
      }
      break;
    }
    case Screen::StepOptionsList: {
      title = "Options";
      std::vector<int> en = enabledExtraIndices();
      std::vector<VerticalMenuItem> rows;
      for (int idx : en) {
        const ExtraDeclaration &d = machineCfg.extras.items[idx];
        const int p = findPendingExtraIdx(d);
        rows.push_back({extraDisplayLabel(d), p >= 0 ? String("*") : String("")});
      }
      rows.push_back({"Done", ""});
      l1 = renderVerticalMenu(rows, stepOptionsListCursor);
      l2 = "";
      l3 = "";
      break;
    }
    case Screen::StepOptionDetail: {
      const int n = static_cast<int>(machineCfg.extras.items.size());
      if (stepOptionEditIdx < 0 || stepOptionEditIdx >= n) {
        title = "Option";
        l1 = "(no extra)";
        l2 = "";
        l3 = "";
        break;
      }
      const ExtraDeclaration &d = machineCfg.extras.items[stepOptionEditIdx];
      title = extraDisplayLabel(d);
      std::vector<ExtraPreset> presets = buildExtraPresets(d);
      std::vector<VerticalMenuItem> rows;
      const int pendingIdx = findPendingExtraIdx(d);
      const String pendingLabel = pendingIdx >= 0 ? pendingStepExtras[pendingIdx].label : String();
      for (const auto &p : presets) {
        // Mark the currently-attached preset with a `*` in the value column.
        // We compare the generated lines (best-effort) to identify which
        // preset matches the pending entry.
        bool matchesPending = false;
        if (pendingIdx >= 0 && p.lines.size() == pendingStepExtras[pendingIdx].lines.size()) {
          matchesPending = true;
          for (size_t i = 0; i < p.lines.size(); i++) {
            if (p.lines[i] != pendingStepExtras[pendingIdx].lines[i]) {
              matchesPending = false;
              break;
            }
          }
        } else if (pendingIdx < 0 && p.lines.empty()) {
          matchesPending = true;
        }
        rows.push_back({p.label, matchesPending ? String("*") : String("")});
      }
      l1 = renderVerticalMenu(rows, stepOptionDetailCursor);
      l2 = "";
      l3 = "press:set  hold:back";
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
      // Rebuild every render so toggling extras in Setup is reflected on
      // the very next paint without explicit invalidation hooks.
      rebuildStepActions();
      const int actionCount = static_cast<int>(stepActions.size());
      if (stepActionIndex < 0) stepActionIndex = 0;
      if (stepActionIndex >= actionCount) stepActionIndex = actionCount - 1;
      // Each menu entry on its own line so 2- and 3-item layouts both fit
      // the centred title + axis-value tail rendering below.
      String menu;
      for (int i = 0; i < actionCount; i++) {
        if (i > 0) menu += '\n';
        menu += (i == stepActionIndex) ? "> " : "  ";
        menu += stepActions[i];
      }
      l1 = menu;
      l2 = "";
      l3 = "";
      for (size_t i = 0; i < machineCfg.axes.size(); i++) {
        if (i > 0) l3 += "\n";
        float v = i < currentAxes.size() ? currentAxes[i] : 0.0f;
        l3 += machineCfg.axes[i].name + ": " + String(v, 2);
      }
      // Surface the current pending-extras count so the user sees there's
      // something attached before pressing Save.
      if (!pendingStepExtras.empty()) {
        l3 += "\n+";
        l3 += String(pendingStepExtras.size());
        l3 += " extra";
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
      title = "Save";
      l1 = saveTargetName;            // small caption (montserrat_14)
      l2 = saveModes[saveModeIndex];  // BIG value (responsiveValueFont)
      l3 = "";                        // no hint row
      // l4 left at default (= infoLine) so the yellow status row can still
      // surface ephemeral messages.
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
      if (programIndex == 0 || programNames.empty()) {
        l1 = "Return";
        l2 = "";
      } else {
        l1 = "";
        l2 = programNames[programIndex - 1];  // BIG (responsiveValueFont)
      }
      l3 = "";
      // l4 left at default (= infoLine).
      break;
    case Screen::ProgramRun: {
      title = "Run: " + programEngine.programName();
      l1 = "Step " + String(programEngine.currentStep()) + "/" + String(programEngine.totalSteps());
      // Live axis position is suppressed here: the TX log occupies the centre
      // of the screen instead.  Step target axes are visible in the G-code
      // lines themselves.  l3 is intentionally empty: the GRBL state row was
      // removed to give the txLogPanel one extra line of vertical space; the
      // current state is still surfaced via the screen-wide background tint
      // (Idle = green, Run = blue, Hold = amber, Alarm = red).
      l2 = "";
      l3 = "";
      break;
    }
  }

  // Background palette driven by the live GRBL state on every screen so the
  // user always has at-a-glance feedback about the controller's status
  // (idle/running/hold/alarm).  When the controller hasn't reported a state
  // yet we fall back to the screen-specific default palette.
  UiPalette palette = paletteForScreen(screen);
  {
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
      lv_obj_set_width(line1Label, 200);
      lv_obj_set_height(line1Label, LV_SIZE_CONTENT);
      lv_obj_set_style_text_align(line1Label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
      // Slot the status row in the band below the centre Step icon and its
      // caption (icon centre y=120, caption centre y~164), leaving a few
      // pixels of breathing room.
      lv_obj_align(line1Label, LV_ALIGN_CENTER, 0, 66);
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
        (screen == Screen::SetupPanel && setupPanelCursor < 1) ||
        screen == Screen::SetupPanelSsidScan ||
        screen == Screen::SetupExtras ||
        (screen == Screen::SetupExtraEdit && setupExtraCursor < 1) ||
        screen == Screen::StepOptionsList ||
        screen == Screen::StepOptionDetail ||
        screen == Screen::StepSaveTarget ||
        screen == Screen::StepSaveDelete) {
      int menuLines = 0;
      for (size_t i = 0; i < l1.length(); i++) if (l1[i] == '\n') menuLines++;
      menuLines++;
      // SsidScan uses montserrat_14 (smaller line height) so its rows pack
      // tighter than the standard montserrat_20-based menus.
      const int lineH = (screen == Screen::SetupPanelSsidScan) ? 18 : 26;
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
      } else if (screen == Screen::ProgramRun) {
        lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 8);
        lv_obj_align(line1Label, LV_ALIGN_TOP_MID, 0, 32);
        lv_obj_add_flag(line2Label, LV_OBJ_FLAG_HIDDEN);
        // The "State:" row used to live at y=54; it was removed and the
        // txLogPanel grown to fill the freed space (see the txLogPanel
        // resize block below).
        lv_obj_add_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
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
                          (screen == Screen::SetupPanel && setupPanelCursor < 1) ||
                          screen == Screen::SetupPanelSsidScan ||
                          screen == Screen::SetupExtras ||
                          (screen == Screen::SetupExtraEdit && setupExtraCursor < 1) ||
                          screen == Screen::StepOptionsList ||
                          screen == Screen::StepOptionDetail ||
                          screen == Screen::StepSaveTarget ||
                          screen == Screen::StepSaveDelete);
  const bool actionMenu = (screen == Screen::StepActions);
  String tFit = fitLine(title, 22);
  String l1Fit = (setupMenu || actionMenu) ? l1 : fitLine(l1, arcVisible ? 20 : 24);
  String l2Fit = fitLine(l2, arcVisible ? 14 : 24);
  String l3Fit = actionMenu ? l3 : fitLine(l3, 24);
  String l4Fit = fitLine(l4, 26);
  if (setupMenu) {
    // SsidScan can show many APs; use the smaller font so long SSIDs fit
    // on a single line and 6-8 entries are visible at once.  Also enable
    // LVGL recolor here so the `#RRGGBB ...#` cursor highlight rendered
    // in the SsidScan branch above is honoured.
    if (screen == Screen::SetupPanelSsidScan) {
      lv_obj_set_style_text_font(line1Label, &lv_font_montserrat_14, LV_PART_MAIN);
      lv_label_set_recolor(line1Label, true);
    } else {
      lv_obj_set_style_text_font(line1Label, &lv_font_montserrat_20, LV_PART_MAIN);
      lv_label_set_recolor(line1Label, false);
    }
  } else if (showCarousel) {
    // Home centre row carries `infoLine` (ephemeral status / error). Match
    // the bottom yellow status row used on every other page: small font and
    // yellow tint so the user always recognises it as a transient message.
    lv_obj_set_style_text_font(line1Label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_recolor(line1Label, false);
  } else {
    lv_obj_set_style_text_font(line1Label, (editLayout || actionMenu) ? &lv_font_montserrat_20 : &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_recolor(line1Label, false);
  }
  const bool bigValueLine2 = editLayout || screen == Screen::StepSaveMode || screen == Screen::ProgramList;
  lv_obj_set_style_text_font(line2Label, bigValueLine2 ? responsiveValueFont(l2Fit) : (actionMenu ? &lv_font_montserrat_20 : &lv_font_montserrat_14), LV_PART_MAIN);
  lv_obj_set_style_text_font(line3Label, &lv_font_montserrat_14, LV_PART_MAIN);
  lv_obj_set_style_text_color(line1Label,
                              showCarousel ? lv_color_hex(0xFFD400)
                                           : (editLayout ? axisColor : fg),
                              LV_PART_MAIN);
  lv_obj_set_style_text_color(line2Label, fg, LV_PART_MAIN);
  lv_obj_set_style_text_color(line3Label, editLayout ? axisColor : fg, LV_PART_MAIN);

  lv_label_set_text(titleLabel, tFit.c_str());
  lv_label_set_text(line1Label, l1Fit.c_str());
  lv_label_set_text(line2Label, l2Fit.c_str());
  lv_label_set_text(line3Label, l3Fit.c_str());

  const bool showProfileSubtitle = setupMenu && !profileSet.activeName.isEmpty();
  // Status screen reuses the subtitle slot to surface the live transport
  // connection state ("Link: wifi connected (192.168.4.1:23)" etc.) so the
  // operator can confirm at a glance whether the controller link is up
  // without having to enter Setup.
  const bool showStatusLinkSubtitle = (screen == Screen::Status);
  if (showProfileSubtitle) {
    lv_obj_clear_flag(subTitleLabel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(subTitleLabel, LV_ALIGN_TOP_MID, 0, 28);
    lv_obj_set_style_text_color(subTitleLabel, lv_color_mix(accent, fg, LV_OPA_60), LV_PART_MAIN);
    String subFit = fitLine(String("Profile: ") + profileSet.activeName, 28);
    lv_label_set_text(subTitleLabel, subFit.c_str());
  } else if (showStatusLinkSubtitle) {
    lv_obj_clear_flag(subTitleLabel, LV_OBJ_FLAG_HIDDEN);
    // Status screen: place the Link line just under `State:` (l1Label at
    // y=40, ~16px tall in montserrat_14) and above the position stack
    // (starts at y=84) — y=62 fits between them.
    lv_obj_align(subTitleLabel, LV_ALIGN_TOP_MID, 0, 62);
    lv_obj_set_style_text_color(subTitleLabel, lv_color_mix(accent, fg, LV_OPA_60), LV_PART_MAIN);
    String subFit = fitLine(String("Link: ") + linkStatusText(), 28);
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

  if (txLogPanel && txLogLabel) {
    if (screen == Screen::ProgramRun) {
      // Reclaim the row that used to host "State: <grbl>" (y=54..76): grow
      // the panel upwards by 22 px so the operator sees one extra line of
      // G-code log while running.  Idempotent: setting the same geometry
      // every frame is cheap and keeps us robust against future edits to
      // the create-time defaults in setup().
      lv_obj_set_size(txLogPanel, 200, 146);
      lv_obj_align(txLogPanel, LV_ALIGN_TOP_MID, 0, 54);
      String log;
      const auto &recent = grblClient.recentTx();
      for (const String &l : recent) {
        log += l;
        log += "\n";
      }
      if (log.length() > 0) {
        log.remove(log.length() - 1);
      }
      // Sticky-bottom auto-scroll: only snap to the latest line if the user
      // was already at (or very near) the bottom before the new content was
      // appended.  If they finger-scrolled up to inspect older lines, we
      // leave the scroll offset alone so their view is preserved.  As soon
      // as they drag back to the bottom, the auto-follow resumes.
      static String lastTxLog;
      const bool textChanged = (log != lastTxLog);
      bool wasAtBottom = true;
      if (textChanged) {
        // Threshold ~ one line of text so a tiny gap still counts as bottom.
        wasAtBottom = (lv_obj_get_scroll_bottom(txLogPanel) <= 6);
        lv_label_set_text(txLogLabel, log.c_str());
        lastTxLog = log;
      }
      lv_obj_set_style_text_color(txLogLabel, lv_color_mix(fg, bg, LV_OPA_70), LV_PART_MAIN);
      lv_obj_set_style_bg_color(txLogPanel, lv_color_mix(bg, fg, LV_OPA_90), LV_PART_MAIN);
      lv_obj_set_style_bg_opa(txLogPanel, LV_OPA_30, LV_PART_MAIN);
      lv_obj_clear_flag(txLogPanel, LV_OBJ_FLAG_HIDDEN);
      if (textChanged && wasAtBottom) {
        // Force-layout so the freshly set label has its real height before we
        // scroll, then snap to the bottom so the most recent line is in view.
        lv_obj_update_layout(txLogPanel);
        lv_obj_scroll_to_y(txLogPanel, LV_COORD_MAX, LV_ANIM_OFF);
      }
    } else {
      lv_obj_add_flag(txLogPanel, LV_OBJ_FLAG_HIDDEN);
    }
  }

  // ---- Position-stack overlay (shared for Status + Step non-MPG) ----------
  // The spangroup-based per-axis readout is positioned here so it can pick up
  // the final palette colours.  Home suppresses it explicitly above; other
  // screens fall through `hidePositionStack()` already.
  const bool stepWithStack = (screen == Screen::Step && arcVisible && !stepFeedEdit &&
                              machineCfg.operation_mode != "mpg");
  const bool statusWithStack = (screen == Screen::Status);
  const bool programListWithStack = (screen == Screen::ProgramList);
  if (stepWithStack || statusWithStack || programListWithStack) {
    const lv_color_t unitColor = lv_color_mix(accent, fg, LV_OPA_60);
    const int decimals = stepWithStack ? 3 : 2;
    renderPositionStack(currentAxes, machineCfg.axes, fg, unitColor, decimals,
                        &lv_font_montserrat_14, &lv_font_montserrat_14);
    const int rowCount = static_cast<int>(min<size_t>(machineCfg.axes.size(), 3));
    int pitch = 22;
    int top = 84;
    if (stepWithStack) {
      pitch = 18;
      top = 139;
    } else if (programListWithStack) {
      // Slotted below the BIG selected-program label (l2 ends near y~96)
      // and above the yellow infoLine row (y=178).
      pitch = 22;
      top = 102;
    }
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
    if (programListWithStack) {
      // l3 is empty in this screen; keep it hidden so it can't claim space.
      lv_obj_add_flag(line3Label, LV_OBJ_FLAG_HIDDEN);
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

// ── Setup > Panel helpers ────────────────────────────────────────────────────

static int panelChannelIndex(const String &ch) {
  for (int i = 0; i < kPanelChannelCount; i++) {
    if (ch == kPanelChannels[i]) return i;
  }
  return 0;  // default uart
}

static int panelWifiModeIndex(const String &m) {
  for (int i = 0; i < kPanelWifiModeCount; i++) {
    if (m == kPanelWifiModes[i]) return i;
  }
  return 0;
}

static int panelBaudPresetIndex(uint32_t baud) {
  for (int i = 0; i < kPanelBaudCount; i++) {
    if (kPanelBaudPresets[i] == baud) return i;
  }
  return 4;  // 115200 fallback
}

// Build the active field list for the SetupPanel screen based on the
// currently selected channel.  Returns an array of field names; the count
// is written to `count`.  The list always starts with `channel` and ends
// with `apply`.
static const char **panelFieldList(int &count) {
  static const char *uartFields[] = {"channel", "baud", "apply"};
  // WiFi mode uses "connect" instead of "apply" because the action both
  // saves the profile and (re-)opens the TCP socket — "connect" is the
  // user-visible verb we want exposed.  UART/Bluetooth still use the
  // generic "apply" wording.
  //
  // Two flavours of the WiFi field list:
  //   - ap_join: panel joins the controller's SoftAP, controller IS the
  //     DHCP gateway, so `host` is redundant — hide it for a tighter UI.
  //   - sta: panel joins an external router; the controller's IP must be
  //     supplied explicitly because the gateway points at the router.
  static const char *wifiApJoinFields[] = {
      "channel", "ssid", "pass", "port", "mode", "connect"};
  static const char *wifiStaFields[] = {
      "channel", "ssid", "pass", "host", "port", "mode", "connect"};
  static const char *btFields[] = {"channel", "apply"};
  const String &ch = machineCfg.link.channel;
  if (ch == "wifi") {
    if (machineCfg.link.wifi_mode == "sta") {
      count = sizeof(wifiStaFields) / sizeof(wifiStaFields[0]);
      return wifiStaFields;
    }
    count = sizeof(wifiApJoinFields) / sizeof(wifiApJoinFields[0]);
    return wifiApJoinFields;
  }
  if (ch == "bluetooth") {
    count = sizeof(btFields) / sizeof(btFields[0]);
    return btFields;
  }
  count = sizeof(uartFields) / sizeof(uartFields[0]);
  return uartFields;
}

static String panelFieldDisplayValue(const char *field) {
  const PanelLinkConfig &lc = machineCfg.link;
  if (!strcmp(field, "channel")) return lc.channel;
  if (!strcmp(field, "baud")) return String(lc.baud);
  if (!strcmp(field, "ssid")) return lc.ssid.isEmpty() ? String("(empty)") : lc.ssid;
  if (!strcmp(field, "pass")) {
    if (lc.password.isEmpty()) return "(empty)";
    String masked;
    for (size_t i = 0; i < lc.password.length(); i++) masked += '*';
    return masked;
  }
  if (!strcmp(field, "host")) {
    // Empty host is the recommended default in ap_join mode: the panel
    // talks to whatever WiFi.gatewayIP() resolves to (i.e. the controller's
    // SoftAP).  Show "(auto)" so users see the field is intentionally
    // blank rather than misconfigured.  Users can still type an explicit
    // override (sta mode, multi-AP topology, ...) if needed.
    if (lc.host.isEmpty()) return "(auto)";
    return lc.host;
  }
  if (!strcmp(field, "port")) return String(lc.port);
  if (!strcmp(field, "mode")) return lc.wifi_mode;
  if (!strcmp(field, "apply")) return "[run]";
  if (!strcmp(field, "connect")) return "[run]";
  return "";
}

// Apply the current PanelLinkConfig: tear down whatever transport is
// active, instantiate the requested one, and rebind GrblClient to it.
// Status messages are surfaced through `infoLine`.
static void selectTransport(const PanelLinkConfig &lc) {
  if (currentTransport) {
    currentTransport->end();
  }
  currentTransport = nullptr;

  if (lc.channel == "wifi") {
    WifiTcpTransport::Mode mode = lc.wifi_mode == "sta"
                                      ? WifiTcpTransport::Mode::Sta
                                      : WifiTcpTransport::Mode::ApJoin;
    wifiTransport.configure(lc.ssid, lc.password, lc.host, lc.port, mode);
    wifiTransport.begin();
    currentTransport = &wifiTransport;
    infoLine = String("WiFi: ") + wifiTransport.statusText();
  } else if (lc.channel == "bluetooth") {
    bluetoothTransport.begin();
    currentTransport = &bluetoothTransport;
    infoLine = "BT not supported on ESP32-S3";
  } else {
    uartTransport.configure(lc.baud, GRBL_UART_RX_PIN, GRBL_UART_TX_PIN);
    uartTransport.begin();
    currentTransport = &uartTransport;
    infoLine = String("UART ") + String(lc.baud);
  }

  grblClient.setTransport(currentTransport);
  uiDirty = true;
}

static void applyPanelLink() {
  persistActiveProfile();
  selectTransport(machineCfg.link);
}

// Human-readable summary of the active transport's connection state, used
// by the Status screen subtitle.  WiFi reports its own state machine
// (joining / no AP / idle) via WifiTcpTransport::statusText(); UART/BT
// just collapse to "<kind> connected" / "<kind> not connected".
static String linkStatusText() {
  if (!currentTransport) return "no link";
  if (currentTransport == &wifiTransport) {
    if (wifiTransport.connected()) {
      return String("wifi connected (") + wifiTransport.statusText() + ")";
    }
    return String("wifi ") + wifiTransport.statusText();
  }
  bool ok = currentTransport->connected();
  return String(currentTransport->name()) + (ok ? " connected" : " not connected");
}

static void panelStringBeginEdit(String *target) {
  if (!target) return;
  setupPanelStringTarget = target;
  setupPanelStringBuf = *target;
  if (setupPanelStringBuf.length() > kPanelStringMaxLen) {
    setupPanelStringBuf = setupPanelStringBuf.substring(0, kPanelStringMaxLen);
  }
  setupPanelStringPos = setupPanelStringBuf.length();
  // Append a trailing space so the user can immediately type a fresh char
  // at the end without first having to extend the buffer.
  if (setupPanelStringPos < kPanelStringMaxLen) {
    setupPanelStringBuf += ' ';
  } else {
    setupPanelStringPos = kPanelStringMaxLen - 1;
  }
  setupPanelStringEditing = true;
}

static void panelStringCommit() {
  if (!setupPanelStringEditing) return;
  if (setupPanelStringTarget) {
    String trimmed = setupPanelStringBuf;
    while (trimmed.length() > 0 && trimmed[trimmed.length() - 1] == ' ') {
      trimmed.remove(trimmed.length() - 1);
    }
    *setupPanelStringTarget = trimmed;
  }
  setupPanelStringEditing = false;
  setupPanelStringTarget = nullptr;
  setupPanelStringBuf = "";
  setupPanelStringPos = 0;
}

static void panelStringRotate(int delta) {
  if (!setupPanelStringEditing || delta == 0) return;
  if (setupPanelStringPos < 0 || setupPanelStringPos >= static_cast<int>(setupPanelStringBuf.length())) {
    return;
  }
  const int csLen = static_cast<int>(strlen(kPanelEditCharset));
  char cur = setupPanelStringBuf[setupPanelStringPos];
  int curIdx = 0;
  for (int i = 0; i < csLen; i++) {
    if (kPanelEditCharset[i] == cur) { curIdx = i; break; }
  }
  int next = ((curIdx + delta) % csLen + csLen) % csLen;
  setupPanelStringBuf[setupPanelStringPos] = kPanelEditCharset[next];
}

static void panelStringAdvance() {
  if (!setupPanelStringEditing) return;
  setupPanelStringPos++;
  if (setupPanelStringPos >= static_cast<int>(setupPanelStringBuf.length())) {
    if (setupPanelStringBuf.length() < kPanelStringMaxLen) {
      setupPanelStringBuf += ' ';
    } else {
      setupPanelStringPos = setupPanelStringBuf.length() - 1;
    }
  }
}

static void handleSetupPanelRotate(int delta) {
  if (delta == 0) return;
  if (setupPanelStringEditing) {
    panelStringRotate(delta);
    return;
  }
  if (setupPanelCursor == 0) {
    int count = 0;
    panelFieldList(count);
    int ni = setupPanelField + delta;
    if (ni < 0) ni = 0;
    if (ni >= count) ni = count - 1;
    setupPanelField = ni;
    return;
  }
  // cursor 1 + non-string editing: cycle/edit non-string field values.
  if (!setupPanelEditing) return;
  int count = 0;
  const char **fields = panelFieldList(count);
  if (setupPanelField < 0 || setupPanelField >= count) return;
  const char *field = fields[setupPanelField];
  PanelLinkConfig &lc = machineCfg.link;
  if (!strcmp(field, "channel")) {
    int idx = panelChannelIndex(lc.channel);
    int ni = ((idx + delta) % kPanelChannelCount + kPanelChannelCount) % kPanelChannelCount;
    lc.channel = kPanelChannels[ni];
    // Switching channel may invalidate the field cursor; clamp later.
  } else if (!strcmp(field, "baud")) {
    int idx = panelBaudPresetIndex(lc.baud);
    int ni = ((idx + delta) % kPanelBaudCount + kPanelBaudCount) % kPanelBaudCount;
    lc.baud = kPanelBaudPresets[ni];
  } else if (!strcmp(field, "port")) {
    int v = static_cast<int>(lc.port) + delta;
    if (v < 1) v = 1;
    if (v > 65535) v = 65535;
    lc.port = static_cast<uint16_t>(v);
  } else if (!strcmp(field, "mode")) {
    int idx = panelWifiModeIndex(lc.wifi_mode);
    int ni = ((idx + delta) % kPanelWifiModeCount + kPanelWifiModeCount) % kPanelWifiModeCount;
    lc.wifi_mode = kPanelWifiModes[ni];
    // Field list shape depends on wifi_mode (host is hidden in ap_join);
    // re-anchor the cursor to "mode" so the user keeps editing the same
    // logical field after the toggle instead of landing on a neighbour.
    int newCount = 0;
    const char **newFields = panelFieldList(newCount);
    for (int i = 0; i < newCount; i++) {
      if (!strcmp(newFields[i], "mode")) {
        setupPanelField = i;
        break;
      }
    }
  }
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
    case Screen::SetupPanelSsidScan:
      wifiScanRelease();
      screen = Screen::SetupPanel;
      break;
    case Screen::SetupPanel:
      if (setupPanelStringEditing) {
        // Cancel string edit without committing.
        setupPanelStringEditing = false;
        setupPanelStringTarget = nullptr;
        setupPanelStringBuf = "";
        setupPanelStringPos = 0;
      } else if (setupPanelCursor == 1) {
        setupPanelEditing = false;
        setupPanelCursor = 0;
      } else {
        screen = Screen::Setup;
      }
      break;
    case Screen::SetupExtras:
      screen = Screen::Setup;
      break;
    case Screen::SetupExtraEdit:
      if (extraStringEditing) {
        // Cancel string edit without committing.
        extraStringEditing = false;
        extraStringTarget = nullptr;
        extraStringBuf = "";
        extraStringPos = 0;
      } else if (setupExtraCursor == 1) {
        setupExtraEditing = false;
        setupExtraCursor = 0;
      } else {
        screen = Screen::SetupExtras;
      }
      break;
    case Screen::StepActions:
      screen = Screen::Home;
      break;
    case Screen::StepOptionsList:
      screen = Screen::StepActions;
      break;
    case Screen::StepOptionDetail:
      // Back returns to the chooser if multiple extras exist, else
      // straight to Actions; mirror the post-press routing.
      if (enabledExtraIndices().size() <= 1) {
        screen = Screen::StepActions;
      } else {
        screen = Screen::StepOptionsList;
      }
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

// Enter whichever Home item is currently active (`homeIndex`).  Keeps the
// per-screen entry side effects (cursor resets, ownership request, program
// list refresh) in one place so both touch and any future re-enabled
// encoder press go through identical setup.
static void enterActiveHomeItem() {
  infoLine = "";
  switch (homeIndex) {
    case 0:
      screen = Screen::Status;
      break;
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
      programIndex = 0;  // default Return row
      if (savedProgramSelectedName.length() > 0) {
        for (size_t i = 0; i < programNames.size(); i++) {
          if (programNames[i] == savedProgramSelectedName) {
            programIndex = static_cast<int>(i) + 1;  // +1 for the Return row
            break;
          }
        }
      }
      screen = Screen::ProgramList;
      break;
    default:
      break;
  }
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
  // icon makes it the active item and navigates directly to its screen.
  lv_obj_t *btn = static_cast<lv_obj_t *>(lv_event_get_target(e));
  const int idx = static_cast<int>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(btn)));
  if (idx < 0 || idx >= homeCount) {
    return;
  }
  if (idx != homeIndex) {
    homeIndex = idx;
    persistHomeIndex();
  }
  enterActiveHomeItem();
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

  // Home page: encoder press is intentionally inert; menu selection is
  // touch-only on this screen.  Rotation still updates the visual
  // highlight for previewing.
  if (screen == Screen::Home) {
    return;
  }

  if (hostControlActive) {
    if (screen == Screen::Status) {
      requestPanelOwnership();
      infoLine = "Takeover requested";
      return;
    }
    infoLine = "Blocked: host monitor mode";
    return;
  }

  // The Home short-press path was disabled higher up; the equivalent
  // navigation now lives in enterActiveHomeItem() and runs from touch only.

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
      case 3:
        setupPanelCursor = 0;
        setupPanelField = 0;
        setupPanelEditing = false;
        setupPanelStringEditing = false;
        screen = Screen::SetupPanel;
        break;
      case 4:
        setupExtrasCursor = 0;
        screen = Screen::SetupExtras;
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
        selectTransport(machineCfg.link);
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
      selectTransport(machineCfg.link);
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
        selectTransport(machineCfg.link);
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

  if (screen == Screen::SetupPanel) {
    if (setupPanelStringEditing) {
      panelStringAdvance();
      return;
    }
    int count = 0;
    const char **fields = panelFieldList(count);
    if (setupPanelField < 0) setupPanelField = 0;
    if (setupPanelField >= count) setupPanelField = count - 1;
    const char *field = fields[setupPanelField];
    if (setupPanelCursor == 0) {
      // Enter editing for the selected field.
      // `apply` (UART/BT) and `connect` (WiFi) are both leaf actions that
      // route to applyPanelLink — the wording differs by channel only.
      if (!strcmp(field, "apply") || !strcmp(field, "connect")) {
        applyPanelLink();
        return;
      }
      // ssid: short press jumps to the dedicated WiFi scan screen so the
      // user can pick an active controller from the air.  The positional
      // character editor is only reachable through "Manual entry" there.
      if (!strcmp(field, "ssid")) {
        setupPanelSsidScanCursor = 0;
        wifiScanStart();
        screen = Screen::SetupPanelSsidScan;
        return;
      }
      // String fields launch the positional character editor; everything
      // else uses the standard rotate-to-cycle editing mode.
      if (!strcmp(field, "pass")) {
        panelStringBeginEdit(&machineCfg.link.password);
      } else if (!strcmp(field, "host")) {
        panelStringBeginEdit(&machineCfg.link.host);
      }
      setupPanelCursor = 1;
      setupPanelEditing = true;
      return;
    }
    if (setupPanelCursor == 1) {
      setupPanelEditing = false;
      persistActiveProfile();
      setupPanelCursor = 0;
      // Field list may have changed if the channel was just toggled; clamp
      // the field cursor to the new range.
      panelFieldList(count);
      if (setupPanelField >= count) setupPanelField = count - 1;
      return;
    }
    return;
  }

  if (screen == Screen::SetupPanelSsidScan) {
    if (setupPanelSsidScanCursor == 0) {
      // Rescan
      wifiScanStart();
      return;
    }
    if (setupPanelSsidScanCursor == 1) {
      // Manual entry: drop into the positional character editor for ssid.
      wifiScanRelease();
      screen = Screen::SetupPanel;
      panelStringBeginEdit(&machineCfg.link.ssid);
      setupPanelCursor = 1;
      setupPanelEditing = true;
      return;
    }
    int resultIdx = setupPanelSsidScanCursor - 2;
    if (resultIdx >= 0 && resultIdx < wifiScanCount()) {
      machineCfg.link.ssid = wifiScanSsid(resultIdx);
      persistActiveProfile();
      wifiScanRelease();
      infoLine = String("ssid ") + machineCfg.link.ssid;
      screen = Screen::SetupPanel;
      setupPanelCursor = 0;
    }
    return;
  }

  if (screen == Screen::SetupExtras) {
    const int n = static_cast<int>(machineCfg.extras.items.size());
    if (setupExtrasCursor < n) {
      setupExtraEditIdx = setupExtrasCursor;
      setupExtraField = 0;
      setupExtraCursor = 0;
      setupExtraEditing = false;
      extraStringEditing = false;
      screen = Screen::SetupExtraEdit;
    } else if (setupExtrasCursor == n) {
      // Add Extra
      ExtraDeclaration d;
      d.type = ExtraType::Gripper;
      machineCfg.extras.items.push_back(d);
      persistActiveProfile();
      rebuildStepActions();
      setupExtrasCursor = n;
      infoLine = "Added extra";
    } else {
      // Del Last
      if (n > 0) {
        machineCfg.extras.items.pop_back();
        persistActiveProfile();
        rebuildStepActions();
        if (setupExtrasCursor > static_cast<int>(machineCfg.extras.items.size()) + 1) {
          setupExtrasCursor = static_cast<int>(machineCfg.extras.items.size()) + 1;
        }
        infoLine = "Removed extra";
      } else {
        infoLine = "No extras";
      }
    }
    return;
  }

  if (screen == Screen::SetupExtraEdit) {
    const int n = static_cast<int>(machineCfg.extras.items.size());
    if (setupExtraEditIdx < 0 || setupExtraEditIdx >= n) {
      screen = Screen::SetupExtras;
      return;
    }
    if (extraStringEditing) {
      extraStringAdvance();
      return;
    }
    if (setupExtraCursor == 0) {
      // Enter editing for the selected field.  String fields launch the
      // positional character editor, otherwise rotate-to-cycle takes over.
      if (setupExtraField == 2) {
        extraStringBeginEdit(&machineCfg.extras.items[setupExtraEditIdx].label);
      } else if (setupExtraField == 6) {
        extraStringBeginEdit(&machineCfg.extras.items[setupExtraEditIdx].onTemplate);
      } else if (setupExtraField == 7) {
        extraStringBeginEdit(&machineCfg.extras.items[setupExtraEditIdx].offTemplate);
      }
      setupExtraCursor = 1;
      setupExtraEditing = true;
      return;
    }
    // cursor 1: short press exits editing for non-string fields and saves.
    setupExtraEditing = false;
    persistActiveProfile();
    rebuildStepActions();
    setupExtraCursor = 0;
    return;
  }

  if (screen == Screen::StepOptionsList) {
    std::vector<int> en = enabledExtraIndices();
    if (stepOptionsListCursor >= 0 && stepOptionsListCursor < static_cast<int>(en.size())) {
      stepOptionEditIdx = en[stepOptionsListCursor];
      stepOptionDetailCursor = 0;
      screen = Screen::StepOptionDetail;
    } else {
      // "Done": back to StepActions with the pending list intact.
      screen = Screen::StepActions;
    }
    return;
  }

  if (screen == Screen::StepOptionDetail) {
    const int n = static_cast<int>(machineCfg.extras.items.size());
    if (stepOptionEditIdx < 0 || stepOptionEditIdx >= n) {
      screen = Screen::StepActions;
      return;
    }
    const ExtraDeclaration &d = machineCfg.extras.items[stepOptionEditIdx];
    std::vector<ExtraPreset> presets = buildExtraPresets(d);
    if (stepOptionDetailCursor < 0 || stepOptionDetailCursor >= static_cast<int>(presets.size())) {
      return;
    }
    const ExtraPreset &p = presets[stepOptionDetailCursor];
    applyExtraPreset(d, p);
    if (p.lines.empty()) {
      infoLine = String("Cleared ") + extraDisplayLabel(d);
    } else {
      infoLine = extraDisplayLabel(d) + ": " + p.label;
    }
    // Single-extra flow returns straight to Actions; multi-extra goes back
    // to the chooser so the user can configure the next one without an
    // extra hop.
    std::vector<int> en = enabledExtraIndices();
    if (en.size() <= 1) {
      screen = Screen::StepActions;
    } else {
      screen = Screen::StepOptionsList;
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
      recordSerialAxisStep(stepAxis, stepValue);
      infoLine = "";
      stepAxis++;
      stepValue = 0.0f;
      if (stepAxis >= static_cast<int>(machineCfg.axes.size())) {
        stepAxis = static_cast<int>(machineCfg.axes.size()) - 1;
        // Megorizzuk a stepActionIndex-et: ha az elozo savsban Save volt
        // a kurzor, ujra Save legyen az alapertelmezes.
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
        screen = Screen::StepActions;
      }
    }
    return;
  }

  if (screen == Screen::StepActions) {
    if (stepActionIndex < 0 || stepActionIndex >= static_cast<int>(stepActions.size())) {
      return;
    }
    const String &sel = stepActions[stepActionIndex];
    if (sel == "Next Step") {
      stepAxis = 0;
      stepValue = 0.0f;
      stepValues.assign(machineCfg.axes.size(), 0.0f);
      pendingStepExtras.clear();
      rebuildStepActions();
      screen = Screen::Step;
    } else if (sel == "Options") {
      std::vector<int> en = enabledExtraIndices();
      if (en.empty()) {
        infoLine = "No extras enabled";
      } else if (en.size() == 1) {
        // Skip the chooser when there's only one extra to configure.
        stepOptionEditIdx = en.front();
        stepOptionDetailCursor = 0;
        screen = Screen::StepOptionDetail;
      } else {
        stepOptionsListCursor = 0;
        screen = Screen::StepOptionsList;
      }
    } else if (sel == "Save") {
      recordCurrentStep();
      programStore.listPrograms(programNames);
      // Default to "New program"; if a previously persisted target name
      // matches an existing program, land the cursor on that row instead.
      saveProgramIndex = static_cast<int>(programNames.size());
      if (savedSaveTargetName.length() > 0) {
        for (size_t i = 0; i < programNames.size(); i++) {
          if (programNames[i] == savedSaveTargetName) {
            saveProgramIndex = static_cast<int>(i);
            break;
          }
        }
      }
      // saveModeIndex is preserved (loaded from NVS at boot, updated on save).
      screen = Screen::StepSaveTarget;
    }
    return;
  }

  if (screen == Screen::StepSaveTarget) {
    const int N = static_cast<int>(programNames.size());
    if (saveProgramIndex < N) {
      saveTargetName = programNames[saveProgramIndex];
      // saveModeIndex preserved (loaded from NVS / last save).
      screen = Screen::StepSaveMode;
    } else if (saveProgramIndex == N) {
      // "New program"
      saveTargetName = programStore.nextAutoName();
      // saveModeIndex preserved (loaded from NVS / last save).
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
    persistSaveTargetName(saveTargetName);
    persistSaveModeIndex();
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
    const String selectedName = programNames[programIndex - 1];
    if (!programStore.loadProgram(selectedName, p, machineCfg.axes)) {
      infoLine = "Load err";
      return;
    }
    persistProgramSelectedName(selectedName);
    grblClient.clearRecentTx();
    grblClient.clearError();
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
  // Home: encoder long-press is inert (touch-only navigation on this page).
  if (screen == Screen::Home) {
    return;
  }
  // StepSaveMode: long-press is a no-op; user must use the on-screen back
  // button to leave (avoids accidentally exiting while choosing a mode).
  if (screen == Screen::StepSaveMode) {
    return;
  }
  if (screen == Screen::SetupPanel && setupPanelStringEditing) {
    panelStringCommit();
    persistActiveProfile();
    setupPanelEditing = false;
    setupPanelCursor = 0;
    uiDirty = true;
    return;
  }
  if (screen == Screen::SetupExtraEdit && extraStringEditing) {
    extraStringCommit();
    persistActiveProfile();
    rebuildStepActions();
    setupExtraEditing = false;
    setupExtraCursor = 0;
    uiDirty = true;
    return;
  }
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
      case Screen::SetupPanel:
        handleSetupPanelRotate(delta);
        uiDirty = true;
        break;
      case Screen::SetupPanelSsidScan: {
        int total = 2 + (wifiScanState() == WifiScanState::Done ? wifiScanCount() : 0);
        if (total > 0) {
          int ni = setupPanelSsidScanCursor + delta;
          if (ni < 0) ni = 0;
          if (ni >= total) ni = total - 1;
          setupPanelSsidScanCursor = ni;
        }
        uiDirty = true;
        break;
      }
      case Screen::Step:
        viewModel.applyAdaptiveDelta(delta);
        break;
      case Screen::StepActions: {
        const int actionCount = static_cast<int>(stepActions.size());
        int ni = stepActionIndex + delta;
        if (ni < 0) ni = 0;
        if (ni >= actionCount) ni = actionCount - 1;
        stepActionIndex = ni;
        uiDirty = true;
        break;
      }
      case Screen::SetupExtras: {
        int total = static_cast<int>(machineCfg.extras.items.size()) + 2;
        int ni = setupExtrasCursor + delta;
        if (ni < 0) ni = 0;
        if (ni >= total) ni = total - 1;
        setupExtrasCursor = ni;
        uiDirty = true;
        break;
      }
      case Screen::SetupExtraEdit: {
        if (extraStringEditing) {
          extraStringRotate(delta);
        } else if (setupExtraCursor == 0) {
          int ni = setupExtraField + delta;
          if (ni < 0) ni = 0;
          if (ni >= setupExtraFieldCount) ni = setupExtraFieldCount - 1;
          setupExtraField = ni;
        } else if (setupExtraEditing &&
                   setupExtraEditIdx >= 0 &&
                   setupExtraEditIdx < static_cast<int>(machineCfg.extras.items.size())) {
          // In-field rotate-to-cycle for non-string fields.  Strings drop
          // through the dedicated extraString editor handled above.
          ExtraDeclaration &d = machineCfg.extras.items[setupExtraEditIdx];
          switch (setupExtraField) {
            case 0: {  // type
              int t = static_cast<int>(d.type) + delta;
              const int max = static_cast<int>(ExtraType::Custom);
              if (t < 0) t = 0;
              if (t > max) t = max;
              d.type = static_cast<ExtraType>(t);
              break;
            }
            case 1:  // enabled toggle
              d.enabled = (delta > 0);
              break;
            case 3: {  // ioPort 0..15
              int v = d.ioPort + delta;
              if (v < 0) v = 0;
              if (v > 15) v = 15;
              d.ioPort = v;
              break;
            }
            case 4: {  // maxPower 100..10000 step 50
              float v = d.maxPower + delta * 50.0f;
              if (v < 0.0f) v = 0.0f;
              if (v > 10000.0f) v = 10000.0f;
              d.maxPower = v;
              break;
            }
            case 5: {  // maxSpindleRpm 0..50000 step 500
              float v = d.maxSpindleRpm + delta * 500.0f;
              if (v < 0.0f) v = 0.0f;
              if (v > 50000.0f) v = 50000.0f;
              d.maxSpindleRpm = v;
              break;
            }
            default:
              break;
          }
        }
        uiDirty = true;
        break;
      }
      case Screen::StepOptionsList: {
        std::vector<int> en = enabledExtraIndices();
        int total = static_cast<int>(en.size()) + 1;  // +1 for "Done"
        int ni = stepOptionsListCursor + delta;
        if (ni < 0) ni = 0;
        if (ni >= total) ni = total - 1;
        stepOptionsListCursor = ni;
        uiDirty = true;
        break;
      }
      case Screen::StepOptionDetail: {
        const int n = static_cast<int>(machineCfg.extras.items.size());
        if (stepOptionEditIdx < 0 || stepOptionEditIdx >= n) break;
        std::vector<ExtraPreset> presets =
            buildExtraPresets(machineCfg.extras.items[stepOptionEditIdx]);
        int total = static_cast<int>(presets.size());
        if (total > 0) {
          int ni = stepOptionDetailCursor + delta;
          if (ni < 0) ni = 0;
          if (ni >= total) ni = total - 1;
          stepOptionDetailCursor = ni;
        }
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
  savedSaveTargetName = uiPrefs.getString("sav_tgt_name", "");
  saveModeIndex = uiPrefs.getInt("sav_mode", 0);
  if (saveModeIndex < 0 || saveModeIndex >= saveModeCount) saveModeIndex = 0;
  savedSaveModeIndex = saveModeIndex;
  savedProgramSelectedName = uiPrefs.getString("prog_sel_name", "");
  stepValues.assign(machineCfg.axes.size(), 0.0f);
  teachCombined.assign(machineCfg.axes.size(), 0.0f);

  programStore.begin();
  programStore.listPrograms(programNames);

  selectTransport(machineCfg.link);
  grblClient.begin(currentTransport, &grblParser);
  grblClient.setMotionAllowed(false);
  grblClient.sendRealtime(kOwnQueryRt);

  mpgJogRate = 0.0f;
  mpgLastSentRate = 0.0f;
  mpgJogActive = false;
  mpgLastJogMs = 0;

  rebuildStepActions();
}

void loop() {
  handleInput();
  if (currentTransport == &wifiTransport) {
    wifiTransport.poll();
    // Mirror the latest WifiTcpTransport status into `infoLine` on every
    // change so the user sees live progress (joining → assoc fail → tcp ok)
    // on whichever screen is active — the dedicated Status menu `Link:`
    // line already polls statusText() per render, but SetupPanel relies on
    // infoLine and would otherwise stay stuck on the initial "starting".
    static String lastWifiStatus;
    String nowWifi = wifiTransport.statusText();
    if (nowWifi != lastWifiStatus) {
      lastWifiStatus = nowWifi;
      infoLine = String("WiFi: ") + nowWifi;
      uiDirty = true;
    }
  }
  if (screen == Screen::SetupPanelSsidScan) {
    WifiScanState prev = wifiScanState();
    WifiScanState now = wifiScanPoll();
    if (now != prev) {
      uiDirty = true;
    }
  }
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
  // Gate the program engine on actual GRBL motion-idle (not just TX-idle).
  // GRBL ACKs `ok` when the planner accepts a line, but motion can still be
  // running.  Advance steps only when the controller reports it has finished
  // moving (Idle/Hold) or before any status has been received (empty).
  // Use baseGrblState() so substates like "Hold:0" / "Door:0" map back to
  // their root ("Hold" / "Door").
  {
    const String base = baseGrblState();
    const bool grblIdle = (base == "Idle" || base == "Hold" || base.isEmpty());
    if (grblIdle) {
      programEngine.update(grblClient, machineCfg.axes);
    }
  }
  if (programEngine.state() == ProgramEngine::State::Paused &&
      !grblClient.lastError().isEmpty() && screen == Screen::ProgramRun) {
    if (infoLine != grblClient.lastError()) {
      infoLine = grblClient.lastError();
      uiDirty = true;
    }
  }

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
    // Run-screen marad aktiv a program befejezese utan is; a felhasznalo
    // a Back gombbal navigal vissza, igy lattja az utolso TX sorokat es
    // a vegallapotot.
    uiAdapter.render();
    lastUiMs = now;
    uiDirty = false;
  }

  lv_timer_handler();
  delay(1);
}
