#pragma once

#include <vector>

#include "models.h"

class ProgramStore {
public:
  bool begin();
  bool listPrograms(std::vector<String> &out);
  bool loadProgram(const String &name, ProgramData &out, const std::vector<AxisConfig> &axes_cfg);
  bool saveProgram(const ProgramData &program, const std::vector<AxisConfig> &axes_cfg);
  bool deleteProgram(const String &name);
  String nextAutoName();
  const String &lastError() const { return _last_error; }

private:
  String buildPath(const String &name) const;
  String _last_error;
};
