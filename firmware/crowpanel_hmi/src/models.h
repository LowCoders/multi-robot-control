#pragma once

#include <Arduino.h>
#include <vector>

struct AxisConfig {
  String name;
  float min = -1000.0f;
  float max = 1000.0f;
  bool invert = false;
  float scale = 1.0f;
  float step = 1.0f;
  float default_feed = 600.0f;
};

struct MachineConfig {
  String id = "crowpanel_local";
  String name = "CrowPanel Local Machine";
  String type = "generic_cnc";
  float max_feed_rate = 1200.0f;
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
