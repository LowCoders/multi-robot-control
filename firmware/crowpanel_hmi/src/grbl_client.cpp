#include "grbl_client.h"

bool GrblClient::isMotionCommand(const String &line) const {
  String cmd = line;
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.startsWith("G0") || cmd.startsWith("G1") || cmd.startsWith("G2") || cmd.startsWith("G3")) {
    return true;
  }
  if (cmd.startsWith("G90") || cmd.startsWith("G91") || cmd.startsWith("G92")) {
    return true;
  }
  if (cmd.startsWith("$J=")) {
    return true;
  }
  if (cmd.startsWith("M3") || cmd.startsWith("M4") || cmd.startsWith("M5")) {
    return true;
  }
  return false;
}

void GrblClient::begin(HardwareSerial *serial, GrblParser *parser) {
  _serial = serial;
  _parser = parser;
}

bool GrblClient::queueLine(const String &line) {
  if (!_motion_allowed && isMotionCommand(line)) {
    _last_error = "monitor-only mode";
    return false;
  }
  _queue.push_back(line);
  return true;
}

void GrblClient::setMotionAllowed(bool allowed) {
  _motion_allowed = allowed;
}

void GrblClient::sendRealtime(uint8_t cmd) {
  if (!_serial) {
    return;
  }
  _serial->write(cmd);
}

void GrblClient::requestStatus() {
  if (!_serial) {
    return;
  }
  _serial->println("?");
}

bool GrblClient::isIdle() const {
  return !_awaiting_ok && _queue.empty();
}

void GrblClient::processLine(const String &line) {
  Serial.print("GRBL RX: ");
  Serial.println(line);

  if (_parser) {
    _parser->ingestLine(line);
  }

  String trimmed = line;
  trimmed.trim();
  if (trimmed.equalsIgnoreCase("ok")) {
    _awaiting_ok = false;
    _awaiting_line = "";
    _last_error = "";
    return;
  }
  if (trimmed.startsWith("error:") || trimmed.startsWith("ALARM:")) {
    _last_error = line;
    _awaiting_ok = false;
    _awaiting_line = "";
    return;
  }
}

void GrblClient::update() {
  if (!_serial) {
    return;
  }

  while (_serial->available()) {
    char c = static_cast<char>(_serial->read());
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      if (!_rx_line.isEmpty()) {
        processLine(_rx_line);
        _rx_line = "";
      }
      continue;
    }
    _rx_line += c;
  }

  if (_awaiting_ok) {
    const uint32_t now = millis();
    if (now - _awaiting_since_ms > 1200) {
      Serial.print("GRBL timeout waiting ok for: ");
      Serial.println(_awaiting_line);
      _last_error = String("timeout: ") + _awaiting_line;
      _awaiting_ok = false;
      _awaiting_line = "";
    }
  }

  if (!_awaiting_ok && !_queue.empty()) {
    String line = _queue.front();
    _queue.pop_front();
    Serial.print("GRBL TX: ");
    Serial.println(line);
    _serial->println(line);
    _awaiting_ok = true;
    _awaiting_since_ms = millis();
    _awaiting_line = line;
  }
}
