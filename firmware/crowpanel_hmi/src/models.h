#pragma once

#include <Arduino.h>

#include <cstdint>
#include <vector>

// Extra (non-motion) tool types that can be attached to a teach step.
// `Custom` is a free-form G-code container so users can drive niche hardware
// without firmware changes.
enum class ExtraType : uint8_t {
  Gripper = 0,
  Sucker,
  Laser,
  Spindle,
  Coolant,
  Vacuum,
  Probe,
  ToolChanger,
  Custom,
};

inline const char *extraTypeToString(ExtraType t) {
  switch (t) {
    case ExtraType::Gripper:     return "gripper";
    case ExtraType::Sucker:      return "sucker";
    case ExtraType::Laser:       return "laser";
    case ExtraType::Spindle:     return "spindle";
    case ExtraType::Coolant:     return "coolant";
    case ExtraType::Vacuum:      return "vacuum";
    case ExtraType::Probe:       return "probe";
    case ExtraType::ToolChanger: return "toolchanger";
    case ExtraType::Custom:      return "custom";
  }
  return "custom";
}

inline ExtraType extraTypeFromString(const String &s) {
  if (s == "gripper")     return ExtraType::Gripper;
  if (s == "sucker")      return ExtraType::Sucker;
  if (s == "laser")       return ExtraType::Laser;
  if (s == "spindle")     return ExtraType::Spindle;
  if (s == "coolant")     return ExtraType::Coolant;
  if (s == "vacuum")      return ExtraType::Vacuum;
  if (s == "probe")       return ExtraType::Probe;
  if (s == "toolchanger") return ExtraType::ToolChanger;
  return ExtraType::Custom;
}

inline const char *extraTypeLabel(ExtraType t) {
  switch (t) {
    case ExtraType::Gripper:     return "Gripper";
    case ExtraType::Sucker:      return "Sucker";
    case ExtraType::Laser:       return "Laser";
    case ExtraType::Spindle:     return "Spindle";
    case ExtraType::Coolant:     return "Coolant";
    case ExtraType::Vacuum:      return "Vacuum";
    case ExtraType::Probe:       return "Probe";
    case ExtraType::ToolChanger: return "ToolChanger";
    case ExtraType::Custom:      return "Custom";
  }
  return "Custom";
}

// Per-machine declaration of an extra tool: which type, what limits, and the
// G/M code templates used to generate the actual command lines.  Templates
// support `{val}` and `{port}` placeholders.
struct ExtraDeclaration {
  ExtraType type = ExtraType::Custom;
  bool enabled = false;
  String label;                // override display name (defaults to extraTypeLabel)
  float maxPower = 1000.0f;    // laser S word ceiling
  float maxSpindleRpm = 24000.0f;
  int   ioPort = 0;            // M62/M63 port for IO-driven extras
  String onTemplate;           // e.g. "M3 S{val}", "M62 P{port}"
  String offTemplate;          // e.g. "M5", "M63 P{port}"
};

struct ExtrasConfig {
  std::vector<ExtraDeclaration> items;
};

// Persisted per-step extra command: which declaration it came from + the
// already-substituted G/M code lines to send before the motion.
struct ExtraCommand {
  ExtraType type = ExtraType::Custom;
  String label;
  std::vector<String> lines;
};

struct AxisConfig {
  String name;
  String type = "linear";
  String parent;
  bool has_min_limit = true;
  bool has_max_limit = true;
  float min = -1000.0f;
  float max = 1000.0f;
  float scale = 1.0f;
  float step = 1.0f;
  float default_feed = 600.0f;
  float max_rate = 50000.0f;
  float acceleration = 2000.0f;
  bool invert = false;
  bool has_feed_override = false;
  float feed_override = 0.0f;
};

struct PanelLinkConfig {
  String channel = "uart";        // "uart" | "wifi" | "bluetooth"
  uint32_t baud = 115200;         // UART baud rate
  String ssid;                    // WiFi SSID (also used for AP-join target)
  String password;                // WiFi password
  String host;                    // grblHAL TCP host; empty = auto (DHCP gateway, controller's SoftAP). Only meaningful in sta mode.
  uint16_t port = 23;             // grblHAL telnet port
  String wifi_mode = "ap_join";   // "ap_join" (controller is AP) | "sta"
};

struct MachineConfig {
  String id = "crowpanel_local";
  String name = "CrowPanel Local Machine";
  float motor_hold = 255.0f;
  bool enable_invert = true;
  String operation_mode = "serial";
  String last_program_name;
  String last_save_mode;
  std::vector<AxisConfig> axes;
  PanelLinkConfig link;
  ExtrasConfig extras;
};

struct ProgramStep {
  String mode;              // "step" or "pos"
  std::vector<float> axes;  // Axis values in machine axis order
  float feed = 600.0f;
  String comment;
  // Optional extras: queued before the G1 motion line during playback.
  std::vector<ExtraCommand> extras;
};

struct ProgramData {
  String name;
  std::vector<ProgramStep> steps;
};

struct Profile {
  String name;
  MachineConfig config;
};

struct ProfileSet {
  String activeName;
  std::vector<Profile> profiles;
};
