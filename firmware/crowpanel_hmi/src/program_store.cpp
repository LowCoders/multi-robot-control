#include "program_store.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

namespace {
constexpr const char *kProgramsDir = "/programs";
}

bool ProgramStore::begin() {
  if (!LittleFS.exists(kProgramsDir)) {
    if (!LittleFS.mkdir(kProgramsDir)) {
      _last_error = "programs dir create failed";
      return false;
    }
  }
  return true;
}

String ProgramStore::buildPath(const String &name) const {
  return String(kProgramsDir) + "/" + name + ".json";
}

bool ProgramStore::listPrograms(std::vector<String> &out) {
  out.clear();
  File root = LittleFS.open(kProgramsDir, FILE_READ);
  if (!root || !root.isDirectory()) {
    _last_error = "programs dir open failed";
    return false;
  }

  File file = root.openNextFile();
  while (file) {
    if (!file.isDirectory()) {
      String n = String(file.name());
      if (n.endsWith(".json")) {
        int slash = n.lastIndexOf('/');
        if (slash >= 0) {
          n = n.substring(slash + 1);
        }
        n.remove(n.length() - 5);  // .json
        out.push_back(n);
      }
    }
    file = root.openNextFile();
  }
  return true;
}

bool ProgramStore::loadProgram(const String &name, ProgramData &out, const std::vector<AxisConfig> &axes_cfg) {
  File f = LittleFS.open(buildPath(name), FILE_READ);
  if (!f) {
    _last_error = "program open failed";
    return false;
  }

  JsonDocument doc;
  auto err = deserializeJson(doc, f);
  f.close();
  if (err) {
    _last_error = String("program parse failed: ") + err.c_str();
    return false;
  }

  out.name = doc["name"] | name;
  out.steps.clear();
  if (!doc["steps"].is<JsonArray>()) {
    return true;
  }

  for (JsonObject s : doc["steps"].as<JsonArray>()) {
    ProgramStep step;
    step.mode = s["mode"] | "step";
    step.feed = s["feed"] | 600.0f;
    step.comment = s["comment"] | "";
    step.axes.assign(axes_cfg.size(), 0.0f);

    JsonObject axes = s["axes"];
    for (size_t i = 0; i < axes_cfg.size(); i++) {
      // Try exact match first; fall back to case-insensitive scan so a
      // legacy program saved with lowercase axis names still loads against
      // a current uppercase machine config.
      const String &want = axes_cfg[i].name;
      if (axes[want].is<float>() || axes[want].is<int>()) {
        step.axes[i] = axes[want].as<float>();
        continue;
      }
      for (JsonPair kv : axes) {
        const String key = kv.key().c_str();
        if (key.equalsIgnoreCase(want) &&
            (kv.value().is<float>() || kv.value().is<int>())) {
          step.axes[i] = kv.value().as<float>();
          break;
        }
      }
    }
    out.steps.push_back(step);
  }
  return true;
}

bool ProgramStore::saveProgram(const ProgramData &program, const std::vector<AxisConfig> &axes_cfg) {
  JsonDocument doc;
  doc["name"] = program.name;
  doc["created"] = millis();

  JsonArray steps = doc["steps"].to<JsonArray>();
  for (const ProgramStep &s : program.steps) {
    JsonObject so = steps.add<JsonObject>();
    so["mode"] = s.mode;
    so["feed"] = s.feed;
    so["comment"] = s.comment;
    JsonObject axes = so["axes"].to<JsonObject>();
    for (size_t i = 0; i < axes_cfg.size(); i++) {
      float v = i < s.axes.size() ? s.axes[i] : 0.0f;
      axes[axes_cfg[i].name] = v;
    }
  }

  File f = LittleFS.open(buildPath(program.name), FILE_WRITE);
  if (!f) {
    _last_error = "program write open failed";
    return false;
  }
  if (serializeJsonPretty(doc, f) == 0) {
    f.close();
    _last_error = "program write failed";
    return false;
  }
  f.close();
  return true;
}

bool ProgramStore::deleteProgram(const String &name) {
  if (!LittleFS.remove(buildPath(name))) {
    _last_error = "program delete failed";
    return false;
  }
  return true;
}

String ProgramStore::nextAutoName() {
  std::vector<String> names;
  listPrograms(names);
  int idx = 1;
  while (true) {
    String candidate = String("teach_") + String(idx);
    bool exists = false;
    for (const String &n : names) {
      if (n == candidate) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      return candidate;
    }
    idx++;
  }
}
