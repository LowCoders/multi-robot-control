#include "config_store.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

namespace {
constexpr const char *kConfigPath = "/config.json";
}

bool ConfigStore::begin() {
  if (LittleFS.begin(true)) {
    return true;
  }
  _last_error = "LittleFS mount failed";
  return false;
}

MachineConfig ConfigStore::defaultConfig() const {
  MachineConfig cfg;
  cfg.axes.clear();

  AxisConfig x;
  x.name = "X";
  x.min = -500.0f;
  x.max = 500.0f;
  x.step = 1.0f;
  x.default_feed = 1200.0f;
  cfg.axes.push_back(x);

  AxisConfig y;
  y.name = "Y";
  y.min = -360.0f;
  y.max = 360.0f;
  y.step = 1.0f;
  y.default_feed = 800.0f;
  cfg.axes.push_back(y);

  AxisConfig z;
  z.name = "Z";
  z.min = -360.0f;
  z.max = 360.0f;
  z.step = 1.0f;
  z.default_feed = 800.0f;
  cfg.axes.push_back(z);

  return cfg;
}

bool ConfigStore::load(MachineConfig &out) {
  if (!LittleFS.exists(kConfigPath)) {
    out = defaultConfig();
    return save(out);
  }

  File f = LittleFS.open(kConfigPath, FILE_READ);
  if (!f) {
    _last_error = "config.json open failed";
    return false;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    _last_error = String("config parse failed: ") + err.c_str();
    return false;
  }

  out = defaultConfig();
  out.id = doc["id"] | out.id;
  out.name = doc["name"] | out.name;
  out.type = doc["type"] | out.type;

  if (doc["driverConfig"]["maxFeedRate"].is<float>() || doc["driverConfig"]["maxFeedRate"].is<int>()) {
    out.max_feed_rate = doc["driverConfig"]["maxFeedRate"].as<float>();
  } else if (doc["maxFeedRate"].is<float>() || doc["maxFeedRate"].is<int>()) {
    out.max_feed_rate = doc["maxFeedRate"].as<float>();
  }

  if (doc["axes"].is<JsonArray>()) {
    out.axes.clear();
    for (JsonObject axis : doc["axes"].as<JsonArray>()) {
      AxisConfig a;
      a.name = axis["name"] | "X";
      a.min = axis["min"] | -1000.0f;
      a.max = axis["max"] | 1000.0f;
      a.invert = axis["invert"] | false;
      a.scale = axis["scale"] | 1.0f;
      a.step = axis["step"] | 1.0f;
      a.default_feed = axis["defaultFeed"] | out.max_feed_rate;
      out.axes.push_back(a);
    }
  }

  if (out.axes.empty()) {
    out.axes = defaultConfig().axes;
  }

  return true;
}

bool ConfigStore::save(const MachineConfig &cfg) {
  JsonDocument doc;
  doc["id"] = cfg.id;
  doc["name"] = cfg.name;
  doc["type"] = cfg.type;

  JsonObject driver = doc["driverConfig"].to<JsonObject>();
  driver["maxFeedRate"] = cfg.max_feed_rate;
  driver["protocol"] = "grbl";

  JsonArray axes = doc["axes"].to<JsonArray>();
  for (const AxisConfig &a : cfg.axes) {
    JsonObject axis = axes.add<JsonObject>();
    axis["name"] = a.name;
    axis["type"] = "linear";
    axis["min"] = a.min;
    axis["max"] = a.max;
    axis["invert"] = a.invert;
    axis["scale"] = a.scale;
    axis["step"] = a.step;
    axis["defaultFeed"] = a.default_feed;
    axis["color"] = "#22D3EE";
  }

  JsonObject env = doc["workEnvelope"].to<JsonObject>();
  env["x"] = 500;
  env["y"] = 500;
  env["z"] = 500;

  File f = LittleFS.open(kConfigPath, FILE_WRITE);
  if (!f) {
    _last_error = "config.json write open failed";
    return false;
  }
  if (serializeJsonPretty(doc, f) == 0) {
    f.close();
    _last_error = "config.json write failed";
    return false;
  }
  f.close();
  return true;
}
