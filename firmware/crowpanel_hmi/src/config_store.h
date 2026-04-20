#pragma once

#include <ArduinoJson.h>

#include <vector>

#include "models.h"

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

  String _last_error;
};
