#pragma once

#include <Arduino.h>
#include <vector>

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

struct MachineConfig {
  String id = "crowpanel_local";
  String name = "CrowPanel Local Machine";
  float motor_hold = 255.0f;
  bool enable_invert = true;
  String operation_mode = "serial";
  String last_program_name;
  String last_save_mode;
  std::vector<AxisConfig> axes;
};

struct ProgramStep {
  String mode;              // "step" or "pos"
  std::vector<float> axes;  // Axis values in machine axis order
  float feed = 600.0f;
  String comment;
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
