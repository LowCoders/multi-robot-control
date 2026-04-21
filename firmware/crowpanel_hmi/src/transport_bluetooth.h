#pragma once

#include <Arduino.h>

#include "transport.h"

// Bluetooth transport stub.
//
// The controller is an ESP32-S3 which does NOT support Bluetooth Classic
// (SPP), and grblHAL's BLE implementation is marked "work in progress, not
// yet functional" upstream.  This stub exists so that the panel UI can
// expose a Bluetooth option as a placeholder and the transport-selection
// factory has a uniform target; activating it surfaces a clear error
// without any actual radio bring-up.
class BluetoothTransport : public IGrblTransport {
public:
  bool begin() override {
    _msg = "BT not supported on ESP32-S3";
    return false;
  }
  void end() override {}
  bool connected() override { return false; }
  int available() override { return 0; }
  int read() override { return -1; }
  size_t write(const uint8_t *, size_t) override { return 0; }
  size_t write(uint8_t) override { return 0; }
  const char *name() const override { return "bluetooth"; }
  const String &statusText() const { return _msg; }

private:
  String _msg = "BT disabled";
};
