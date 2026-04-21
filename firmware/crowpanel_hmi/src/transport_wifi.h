#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>

#include "transport.h"

// Raw TCP/Telnet transport: connects to grblHAL's TELNET_ENABLE port.
//
// Modes:
//   - "ap_join": panel acts as STA and joins grblHAL's SoftAP SSID,
//     then opens a TCP connection to `host:port`.
//   - "sta": panel joins an existing WiFi router (same SSID/pass), then
//     connects to grblHAL on its router-assigned IP.
//
// Reconnect strategy: exponential backoff (capped) when the TCP socket is
// down or WiFi association is lost.  `connected()` returns true only when
// both WiFi is associated and the TCP client is open.
class WifiTcpTransport : public IGrblTransport {
public:
  enum class Mode { ApJoin, Sta };

  void configure(const String &ssid, const String &password,
                 const String &host, uint16_t port, Mode mode);

  bool begin() override;
  void end() override;

  bool connected() override;

  int available() override;
  int read() override;

  size_t write(const uint8_t *buf, size_t len) override;
  size_t write(uint8_t b) override;

  const char *name() const override { return "wifi"; }

  String statusText() const { return _status; }

  // Should be called periodically from the main loop when this transport
  // is the active one; drives the reconnect state machine.
  void poll();

private:
  bool ensureWifi();
  bool ensureClient();
  void scheduleRetry();

  String _ssid;
  String _password;
  String _host;             // empty = auto (use DHCP gateway). Only consulted in Sta mode.
  uint16_t _port = 23;
  Mode _mode = Mode::ApJoin;

  WiFiClient _client;
  bool _started = false;
  uint32_t _next_attempt_ms = 0;
  uint32_t _backoff_ms = 500;
  uint32_t _attempts = 0;   // total `ensureWifi()` invocations since `begin()`
  String _status = "idle";
};
