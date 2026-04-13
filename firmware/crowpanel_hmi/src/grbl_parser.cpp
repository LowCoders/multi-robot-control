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
  // Use explicit fallback values on each status frame to avoid stale ownership.
  _status.owner = "none";
  _status.ownerReason = "";
  _status.ownerVersion = 0;

  int firstPipe = line.indexOf('|');
  if (firstPipe > 1) {
    _status.state = line.substring(1, firstPipe);
  }

  int ownAt = line.indexOf("|OWN:");
  if (ownAt >= 0) {
    int ownStart = ownAt + 5;
    int ownEnd = line.indexOf('|', ownStart);
    if (ownEnd < 0) {
      ownEnd = line.length() - 1;
    }
    _status.owner = line.substring(ownStart, ownEnd);
  }

  int ownReasonAt = line.indexOf("|OWNR:");
  if (ownReasonAt >= 0) {
    int reasonStart = ownReasonAt + 6;
    int reasonEnd = line.indexOf('|', reasonStart);
    if (reasonEnd < 0) {
      reasonEnd = line.length() - 1;
    }
    _status.ownerReason = line.substring(reasonStart, reasonEnd);
  }

  int ownVersionAt = line.indexOf("|OWNV:");
  if (ownVersionAt >= 0) {
    int versionStart = ownVersionAt + 6;
    int versionEnd = line.indexOf('|', versionStart);
    if (versionEnd < 0) {
      versionEnd = line.length() - 1;
    }
    _status.ownerVersion = static_cast<uint32_t>(line.substring(versionStart, versionEnd).toInt());
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
