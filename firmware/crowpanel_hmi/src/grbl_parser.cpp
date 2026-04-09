#include "grbl_parser.h"

void GrblParser::ingestLine(const String &line) {
  if (line.startsWith("<") && line.endsWith(">")) {
    parseStatus(line);
    return;
  }

  if (line.startsWith("[FIRMWARE:")) {
    _firmware = line;
  }

  if (line.startsWith("error:") || line.startsWith("ALARM:")) {
    _last_error_line = line;
  }
}

void GrblParser::parseStatus(const String &line) {
  int firstPipe = line.indexOf('|');
  if (firstPipe > 1) {
    _status.state = line.substring(1, firstPipe);
  }

  int mposAt = line.indexOf("MPos:");
  if (mposAt < 0) {
    int wposAt = line.indexOf("WPos:");
    if (wposAt < 0) {
      _status.valid = false;
      return;
    }
    mposAt = wposAt;
  }

  int start = mposAt + 5;
  int end = line.indexOf('|', start);
  if (end < 0) {
    end = line.length() - 1;
  }

  String coord = line.substring(start, end);
  _status.axes = parseAxes(coord);
  _status.valid = true;
}

std::vector<float> GrblParser::parseAxes(const String &field) {
  std::vector<float> out;
  if (field.isEmpty()) {
    return out;
  }

  int from = 0;
  while (from < static_cast<int>(field.length())) {
    int comma = field.indexOf(',', from);
    String token = comma < 0 ? field.substring(from) : field.substring(from, comma);
    out.push_back(token.toFloat());
    if (comma < 0) {
      break;
    }
    from = comma + 1;
  }
  return out;
}
