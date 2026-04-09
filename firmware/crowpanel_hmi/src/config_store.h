#pragma once

#include <vector>

#include "models.h"

class ConfigStore {
public:
  bool begin();
  bool load(MachineConfig &out);
  bool save(const MachineConfig &cfg);
  MachineConfig defaultConfig() const;
  const String &lastError() const { return _last_error; }

private:
  String _last_error;
};
