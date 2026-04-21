#pragma once

#include <ArduinoJson.h>

#include <vector>

#include "models.h"

// Fill in project-wide defaults for any PanelLinkConfig field that came back
// empty (e.g. from a profile saved before WiFi support landed, or from a
// freshly decoded JSON object without the `link` key).  Keeping this in a
// header lets every load/decode/seed/activation site call it without an
// extra dependency.
inline void normalizePanelLink(PanelLinkConfig &lc) {
  if (lc.password.isEmpty())  lc.password  = "panelDefault";
  // Leave host empty by default: in `ap_join` mode the controller IS the
  // DHCP gateway, so the WifiTcpTransport falls back to WiFi.gatewayIP()
  // automatically — one less per-profile field to maintain and immune to
  // grblHAL upstream subnet changes (192.168.4.x vs 192.168.5.x).
  if (lc.port == 0)           lc.port      = 23;
  if (lc.wifi_mode.isEmpty()) lc.wifi_mode = "ap_join";
  if (lc.channel.isEmpty())   lc.channel   = "uart";
  if (lc.baud == 0)           lc.baud      = 115200;
}

class ConfigStore {
public:
  bool begin();
  bool loadAll(ProfileSet &out);
  bool saveAll(const ProfileSet &set);
  ProfileSet seedDefaults() const;
  Profile defaultProfileLaser() const;
  Profile defaultProfileBlendOMat() const;
  Profile defaultProfileRobot() const;
  const String &lastError() const { return _last_error; }

private:
  void encodeProfile(JsonObject obj, const Profile &p) const;
  bool decodeProfile(JsonObject obj, Profile &out) const;
  void encodeMachine(JsonObject obj, const MachineConfig &cfg) const;
  void decodeMachine(JsonObject obj, MachineConfig &out) const;
  void encodeExtras(JsonObject obj, const ExtrasConfig &extras) const;
  void decodeExtras(JsonObject obj, ExtrasConfig &out) const;

  String _last_error;
};
