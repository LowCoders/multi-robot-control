#pragma once

#include <Arduino.h>
#include <vector>

struct GrblStatus {
  String state = "Unknown";
  std::vector<float> axes;
  String owner = "none";
  String ownerReason = "";
  uint32_t ownerVersion = 0;
  bool valid = false;
};

class GrblParser {
public:
  void ingestLine(const String &line);
  const GrblStatus &status() const { return _status; }
  const String &firmwareLine() const { return _firmware; }
  const String &lastErrorLine() const { return _last_error_line; }

private:
  void parseStatus(const String &line);
  static std::vector<float> parseAxes(const String &field);
  GrblStatus _status;
  String _firmware;
  String _last_error_line;
};
