#pragma once

#include <Arduino.h>

#include "transport.h"

// HardwareSerial-backed transport.  Owns no Serial instance; the caller
// passes a pre-allocated HardwareSerial (typically the project-wide
// `GrblSerial = HardwareSerial(1)`), and the transport handles the actual
// `begin()` with the configured pins/baud rate.
class UartTransport : public IGrblTransport {
public:
  UartTransport(HardwareSerial &serial, int rx_pin, int tx_pin, uint32_t baud);

  void configure(uint32_t baud, int rx_pin, int tx_pin);

  bool begin() override;
  void end() override;

  bool connected() override { return _open; }

  int available() override { return _open ? _serial.available() : 0; }
  int read() override { return _open ? _serial.read() : -1; }

  size_t write(const uint8_t *buf, size_t len) override {
    return _open ? _serial.write(buf, len) : 0;
  }
  size_t write(uint8_t b) override { return _open ? _serial.write(b) : 0; }

  const char *name() const override { return "uart"; }

private:
  HardwareSerial &_serial;
  int _rx_pin;
  int _tx_pin;
  uint32_t _baud;
  bool _open = false;
};
