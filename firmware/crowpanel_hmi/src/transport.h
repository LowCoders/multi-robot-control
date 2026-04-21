#pragma once

#include <Arduino.h>

// Abstract serial-like transport for grblHAL link.
//
// Implementations:
//   - UartTransport  -> wraps a HardwareSerial pendant link (default UART1)
//   - WifiTcpTransport -> raw TCP/Telnet client (default port 23)
//   - BluetoothTransport (stub) -> placeholder; not supported on ESP32-S3
//
// The interface intentionally mirrors the subset of `Stream` used by
// `GrblClient` so that swapping transports does not change the client logic.
class IGrblTransport {
public:
  virtual ~IGrblTransport() = default;

  virtual bool begin() = 0;
  virtual void end() = 0;

  virtual bool connected() = 0;

  virtual int available() = 0;
  virtual int read() = 0;

  virtual size_t write(const uint8_t *buf, size_t len) = 0;
  virtual size_t write(uint8_t b) = 0;

  virtual const char *name() const = 0;

  // Convenience helper used by GrblClient when sending newline-terminated
  // command lines.  Implementations may override for transport-specific
  // flushing semantics (TCP NoDelay etc.).
  virtual size_t println(const String &line) {
    size_t n = 0;
    if (!line.isEmpty()) {
      n += write(reinterpret_cast<const uint8_t *>(line.c_str()), line.length());
    }
    n += write(static_cast<uint8_t>('\n'));
    return n;
  }
};
