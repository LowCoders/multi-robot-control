#include "config_store.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

namespace {
constexpr const char *kProfilesPath = "/profiles.json";
constexpr const char *kLegacyConfigPath = "/config.json";

static const char *axisColors[] = {"#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7"};
static const size_t kColorCount = sizeof(axisColors) / sizeof(axisColors[0]);
}

bool ConfigStore::begin() {
  if (LittleFS.begin(true)) {
    if (LittleFS.exists(kLegacyConfigPath)) {
      LittleFS.remove(kLegacyConfigPath);
    }
    return true;
  }
  _last_error = "LittleFS mount failed";
  return false;
}

// ── default profiles ─────────────────────────────────────────────────────────

Profile ConfigStore::defaultProfileLaser() const {
  Profile p;
  p.name = "default";
  MachineConfig &cfg = p.config;
  cfg.id = "default_laser";
  cfg.name = "Default Laser";
  cfg.motor_hold = 200.0f;
  cfg.enable_invert = true;
  cfg.operation_mode = "serial";
  cfg.axes.clear();

  AxisConfig x;
  x.name = "X"; x.type = "linear";
  x.has_min_limit = true; x.has_max_limit = true;
  x.min = 0.0f; x.max = 500.0f;
  x.scale = 1.0f; x.step = 1.0f;
  x.default_feed = 1500.0f; x.max_rate = 5000.0f; x.acceleration = 1500.0f;
  cfg.axes.push_back(x);

  AxisConfig y;
  y.name = "Y"; y.type = "linear";
  y.has_min_limit = true; y.has_max_limit = true;
  y.min = 0.0f; y.max = 400.0f;
  y.scale = 1.0f; y.step = 1.0f;
  y.default_feed = 1500.0f; y.max_rate = 5000.0f; y.acceleration = 1500.0f;
  cfg.axes.push_back(y);

  AxisConfig z;
  z.name = "Z"; z.type = "linear";
  z.has_min_limit = true; z.has_max_limit = true;
  z.min = 0.0f; z.max = 50.0f;
  z.scale = 1.0f; z.step = 0.1f;
  z.default_feed = 500.0f; z.max_rate = 1000.0f; z.acceleration = 500.0f;
  cfg.axes.push_back(z);

  // Pre-fill the panel link with the project-wide WiFi defaults so a user
  // who switches `channel` to "wifi" doesn't have to retype the password
  // every time.  `channel` stays "uart" for regression-safety; `ssid` is
  // left empty so the user picks the active controller via the SetupPanel
  // SSID-scan UI; `host` is left empty so the panel auto-uses the DHCP
  // gateway in ap_join mode (the controller is the AP).
  cfg.link.password = "panelDefault";
  cfg.link.port = 23;
  cfg.link.wifi_mode = "ap_join";

  return p;
}

Profile ConfigStore::defaultProfileBlendOMat() const {
  Profile p;
  p.name = "blend-o-mat";
  MachineConfig &cfg = p.config;
  cfg.id = "tube_bender_1";
  cfg.name = "Csohajlito";
  cfg.motor_hold = 255.0f;
  cfg.enable_invert = true;
  cfg.operation_mode = "serial";
  cfg.axes.clear();

  AxisConfig x;  // Tolas
  x.name = "X"; x.type = "linear";
  x.has_min_limit = false; x.has_max_limit = false;
  x.min = 0.0f; x.max = 0.0f;
  x.scale = 1.0f; x.step = 1.0f;
  x.default_feed = 5000.0f; x.max_rate = 50000.0f; x.acceleration = 2000.0f;
  cfg.axes.push_back(x);

  AxisConfig y;  // Hajlitas
  y.name = "Y"; y.type = "linear";
  y.has_min_limit = true; y.has_max_limit = true;
  y.min = -180.0f; y.max = 180.0f;
  y.scale = 1.0f; y.step = 1.0f;
  y.default_feed = 5000.0f; y.max_rate = 50000.0f; y.acceleration = 2000.0f;
  cfg.axes.push_back(y);

  AxisConfig z;  // Forgatas
  z.name = "Z"; z.type = "rotary";
  z.has_min_limit = true; z.has_max_limit = true;
  z.min = -110.0f; z.max = 110.0f;
  z.scale = 1.0f; z.step = 1.0f;
  z.default_feed = 5000.0f; z.max_rate = 50000.0f; z.acceleration = 2000.0f;
  cfg.axes.push_back(z);

  cfg.link.password = "panelDefault";
  cfg.link.port = 23;
  cfg.link.wifi_mode = "ap_join";

  return p;
}

Profile ConfigStore::defaultProfileRobot() const {
  Profile p;
  p.name = "robot";
  MachineConfig &cfg = p.config;
  cfg.id = "robot_arm_2";
  cfg.name = "Robotkar v2";
  cfg.motor_hold = 255.0f;
  cfg.enable_invert = true;
  cfg.operation_mode = "serial";
  cfg.axes.clear();

  AxisConfig x;
  x.name = "X"; x.type = "rotary";
  x.has_min_limit = true; x.has_max_limit = true;
  x.min = -175.0f; x.max = 175.0f;
  x.scale = 1.0f; x.step = 1.0f; x.invert = false;
  x.default_feed = 5000.0f; x.max_rate = 200000.0f; x.acceleration = 2000.0f;
  cfg.axes.push_back(x);

  AxisConfig y;
  y.name = "Y"; y.type = "rotary"; y.parent = "X"; y.invert = true;
  y.has_min_limit = true; y.has_max_limit = true;
  y.min = 0.0f; y.max = 90.0f;
  y.scale = 1.0f; y.step = 1.0f;
  y.default_feed = 5000.0f; y.max_rate = 200000.0f; y.acceleration = 2000.0f;
  cfg.axes.push_back(y);

  AxisConfig z;
  z.name = "Z"; z.type = "rotary"; z.parent = "Y"; z.invert = true;
  z.has_min_limit = true; z.has_max_limit = true;
  z.min = -135.0f; z.max = -80.0f;
  z.scale = 1.0f; z.step = 1.0f;
  z.default_feed = 5000.0f; z.max_rate = 200000.0f; z.acceleration = 2000.0f;
  cfg.axes.push_back(z);

  cfg.link.password = "panelDefault";
  cfg.link.port = 23;
  cfg.link.wifi_mode = "ap_join";

  return p;
}

ProfileSet ConfigStore::seedDefaults() const {
  ProfileSet set;
  set.profiles.push_back(defaultProfileLaser());
  set.profiles.push_back(defaultProfileBlendOMat());
  set.profiles.push_back(defaultProfileRobot());
  set.activeName = "default";
  return set;
}

// ── (de)serialization ────────────────────────────────────────────────────────

void ConfigStore::encodeMachine(JsonObject obj, const MachineConfig &cfg) const {
  obj["id"] = cfg.id;
  obj["name"] = cfg.name;

  JsonObject driver = obj["driverConfig"].to<JsonObject>();
  driver["motorHold"] = cfg.motor_hold;
  driver["enableInvert"] = cfg.enable_invert;
  driver["defaultOperationMode"] = cfg.operation_mode;
  driver["protocol"] = "grbl";

  JsonObject link = obj["link"].to<JsonObject>();
  link["channel"] = cfg.link.channel;
  link["baud"] = cfg.link.baud;
  link["ssid"] = cfg.link.ssid;
  link["password"] = cfg.link.password;
  link["host"] = cfg.link.host;
  link["port"] = cfg.link.port;
  link["wifiMode"] = cfg.link.wifi_mode;

  JsonArray axes = obj["axes"].to<JsonArray>();
  for (size_t i = 0; i < cfg.axes.size(); i++) {
    const AxisConfig &a = cfg.axes[i];
    JsonObject axis = axes.add<JsonObject>();
    axis["name"] = a.name;
    axis["type"] = a.type;
    if (!a.parent.isEmpty()) axis["parent"] = a.parent;
    axis["hasMin"] = a.has_min_limit;
    axis["hasMax"] = a.has_max_limit;
    axis["min"] = a.min;
    axis["max"] = a.max;
    axis["scale"] = a.scale;
    axis["step"] = a.step;
    axis["defaultFeed"] = a.default_feed;
    axis["maxRate"] = a.max_rate;
    axis["acceleration"] = a.acceleration;
    axis["invert"] = a.invert;
    if (a.has_feed_override) axis["feedOverride"] = a.feed_override;
    axis["color"] = axisColors[i % kColorCount];
  }

  JsonObject extras = obj["extras"].to<JsonObject>();
  encodeExtras(extras, cfg.extras);
}

void ConfigStore::encodeExtras(JsonObject obj, const ExtrasConfig &extras) const {
  JsonArray items = obj["items"].to<JsonArray>();
  for (const ExtraDeclaration &d : extras.items) {
    JsonObject it = items.add<JsonObject>();
    it["type"] = extraTypeToString(d.type);
    it["enabled"] = d.enabled;
    it["label"] = d.label;
    it["maxPower"] = d.maxPower;
    it["maxSpindleRpm"] = d.maxSpindleRpm;
    it["ioPort"] = d.ioPort;
    it["onTemplate"] = d.onTemplate;
    it["offTemplate"] = d.offTemplate;
  }
}

void ConfigStore::decodeExtras(JsonObject obj, ExtrasConfig &out) const {
  out.items.clear();
  if (!obj["items"].is<JsonArray>()) return;
  for (JsonObject it : obj["items"].as<JsonArray>()) {
    ExtraDeclaration d;
    if (it["type"].is<const char *>()) {
      d.type = extraTypeFromString(String(it["type"].as<const char *>()));
    }
    d.enabled = it["enabled"] | false;
    d.label = it["label"] | "";
    d.maxPower = it["maxPower"] | 1000.0f;
    d.maxSpindleRpm = it["maxSpindleRpm"] | 24000.0f;
    d.ioPort = it["ioPort"] | 0;
    d.onTemplate = it["onTemplate"] | "";
    d.offTemplate = it["offTemplate"] | "";
    out.items.push_back(d);
  }
}

void ConfigStore::decodeMachine(JsonObject obj, MachineConfig &out) const {
  out.id = obj["id"] | out.id;
  out.name = obj["name"] | out.name;

  JsonObject drv = obj["driverConfig"];
  if (drv["motorHold"].is<float>() || drv["motorHold"].is<int>()) {
    out.motor_hold = drv["motorHold"].as<float>();
  }
  if (drv["enableInvert"].is<bool>()) {
    out.enable_invert = drv["enableInvert"].as<bool>();
  }
  if (drv["defaultOperationMode"].is<const char *>()) {
    out.operation_mode = drv["defaultOperationMode"].as<const char *>();
  }

  if (obj["link"].is<JsonObject>()) {
    JsonObject link = obj["link"].as<JsonObject>();
    if (link["channel"].is<const char *>()) {
      out.link.channel = link["channel"].as<const char *>();
    }
    if (link["baud"].is<uint32_t>() || link["baud"].is<int>()) {
      out.link.baud = link["baud"].as<uint32_t>();
    }
    if (link["ssid"].is<const char *>()) {
      out.link.ssid = link["ssid"].as<const char *>();
    }
    if (link["password"].is<const char *>()) {
      out.link.password = link["password"].as<const char *>();
    }
    if (link["host"].is<const char *>()) {
      out.link.host = link["host"].as<const char *>();
    }
    if (link["port"].is<uint16_t>() || link["port"].is<int>()) {
      out.link.port = link["port"].as<uint16_t>();
    }
    if (link["wifiMode"].is<const char *>()) {
      out.link.wifi_mode = link["wifiMode"].as<const char *>();
    }
  }
  // Backfill any missing PanelLinkConfig field (older profiles saved
  // before WiFi support, or JSON blobs without a `link` key) with the
  // project-wide defaults — most importantly `password = "panelDefault"`
  // so the user does not see "(empty)" on first WiFi setup.
  normalizePanelLink(out.link);

  if (obj["axes"].is<JsonArray>()) {
    out.axes.clear();
    for (JsonObject axis : obj["axes"].as<JsonArray>()) {
      AxisConfig a;
      a.name = axis["name"] | "X";
      a.type = axis["type"] | "linear";
      a.parent = axis["parent"] | "";
      a.has_min_limit = axis["hasMin"] | true;
      a.has_max_limit = axis["hasMax"] | true;
      a.min = axis["min"] | -1000.0f;
      a.max = axis["max"] | 1000.0f;
      a.scale = axis["scale"] | 1.0f;
      a.step = axis["step"] | 1.0f;
      a.default_feed = axis["defaultFeed"] | 1500.0f;
      a.max_rate = axis["maxRate"] | 50000.0f;
      a.acceleration = axis["acceleration"] | 2000.0f;
      a.invert = axis["invert"] | false;
      if (axis["feedOverride"].is<float>() || axis["feedOverride"].is<int>()) {
        a.has_feed_override = true;
        a.feed_override = axis["feedOverride"].as<float>();
      }
      out.axes.push_back(a);
    }
  }

  // Backwards compatible: older profiles have no `extras` key.  Leaving the
  // list empty hides the Options menu entry on the Actions screen.
  out.extras.items.clear();
  if (obj["extras"].is<JsonObject>()) {
    decodeExtras(obj["extras"].as<JsonObject>(), out.extras);
  }
}

void ConfigStore::encodeProfile(JsonObject obj, const Profile &p) const {
  obj["name"] = p.name;
  JsonObject cfg = obj["config"].to<JsonObject>();
  encodeMachine(cfg, p.config);
}

bool ConfigStore::decodeProfile(JsonObject obj, Profile &out) const {
  out.name = obj["name"] | "";
  if (out.name.isEmpty()) return false;
  if (obj["config"].is<JsonObject>()) {
    decodeMachine(obj["config"].as<JsonObject>(), out.config);
  }
  return true;
}

// ── load / save ──────────────────────────────────────────────────────────────

bool ConfigStore::loadAll(ProfileSet &out) {
  if (!LittleFS.exists(kProfilesPath)) {
    out = seedDefaults();
    return saveAll(out);
  }

  File f = LittleFS.open(kProfilesPath, FILE_READ);
  if (!f) {
    _last_error = "profiles.json open failed";
    out = seedDefaults();
    return saveAll(out);
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    _last_error = String("profiles parse failed: ") + err.c_str();
    out = seedDefaults();
    return saveAll(out);
  }

  out.profiles.clear();
  out.activeName = doc["activeName"] | "";

  if (doc["profiles"].is<JsonArray>()) {
    for (JsonObject po : doc["profiles"].as<JsonArray>()) {
      Profile p;
      if (decodeProfile(po, p)) {
        out.profiles.push_back(p);
      }
    }
  }

  if (out.profiles.empty()) {
    out = seedDefaults();
    return saveAll(out);
  }

  bool activeFound = false;
  for (const auto &p : out.profiles) {
    if (p.name == out.activeName) { activeFound = true; break; }
  }
  if (!activeFound) {
    out.activeName = out.profiles.front().name;
    saveAll(out);
  }

  return true;
}

bool ConfigStore::saveAll(const ProfileSet &set) {
  JsonDocument doc;
  doc["activeName"] = set.activeName;
  JsonArray arr = doc["profiles"].to<JsonArray>();
  for (const Profile &p : set.profiles) {
    JsonObject po = arr.add<JsonObject>();
    encodeProfile(po, p);
  }

  File f = LittleFS.open(kProfilesPath, FILE_WRITE);
  if (!f) {
    _last_error = "profiles.json write open failed";
    return false;
  }
  if (serializeJsonPretty(doc, f) == 0) {
    f.close();
    _last_error = "profiles.json write failed";
    return false;
  }
  f.close();
  return true;
}
