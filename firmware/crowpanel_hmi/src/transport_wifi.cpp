#include "transport_wifi.h"

namespace {
constexpr uint32_t kMaxBackoffMs = 8000;
constexpr uint32_t kMinBackoffMs = 500;
constexpr uint32_t kWifiAssocTimeoutMs = 8000;
constexpr uint32_t kTcpConnectTimeoutMs = 1500;

// Map ESP32 wl_status_t to a short human-readable name so the panel UI
// (and the serial log) can show *which* WiFi failure mode we hit instead
// of a generic "assoc failed".  Most informative codes in practice:
//   - WL_NO_SSID_AVAIL  -> SoftAP not visible (out of range / not powered)
//   - WL_CONNECT_FAILED -> wrong password / authentication rejected
//   - WL_DISCONNECTED   -> still trying / dropped; usually combined with
//                          WL_CONNECT_FAILED or WL_NO_SSID_AVAIL on retry
const char *wlStatusName(wl_status_t s) {
  switch (s) {
    case WL_NO_SHIELD:       return "no_shield";
    case WL_IDLE_STATUS:     return "idle";
    case WL_NO_SSID_AVAIL:   return "no_ssid";
    case WL_SCAN_COMPLETED:  return "scan_done";
    case WL_CONNECTED:       return "connected";
    case WL_CONNECT_FAILED:  return "auth_fail";
    case WL_CONNECTION_LOST: return "lost";
    case WL_DISCONNECTED:    return "disconnected";
    default:                 return "?";
  }
}
}  // namespace

void WifiTcpTransport::configure(const String &ssid, const String &password,
                                 const String &host, uint16_t port, Mode mode) {
  _ssid = ssid;
  _password = password;
  _host = host;
  _port = port;
  _mode = mode;
}

bool WifiTcpTransport::begin() {
  end();
  // Force STA mode explicitly *before* any begin/connect: the wifi_scan
  // helper toggles modes too, and a stale AP/AP_STA mode here causes
  // `WiFi.begin()` to silently no-op or return WL_CONNECT_FAILED.
  WiFi.mode(WIFI_STA);
  _started = true;
  _backoff_ms = kMinBackoffMs;
  _next_attempt_ms = 0;
  _attempts = 0;
  _status = "starting";
  Serial.printf("[wifi] begin ssid=%s host=%s:%u pass_len=%u\n",
                _ssid.c_str(), _host.c_str(), _port,
                (unsigned)_password.length());
  return true;
}

void WifiTcpTransport::end() {
  if (_client.connected()) {
    _client.stop();
  }
  if (_started) {
    // Keep the radio on (wifioff=false) so we can immediately rejoin, but
    // erase the cached STA config (eraseap=true) so `WiFi.begin(ssid,pass)`
    // does not get confused by leftover credentials from a previous attempt
    // (or from the wifi_scan helper).
    WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/true);
  }
  _started = false;
  _status = "idle";
}

bool WifiTcpTransport::connected() {
  if (!_started) return false;
  return WiFi.status() == WL_CONNECTED && _client.connected();
}

void WifiTcpTransport::scheduleRetry() {
  _next_attempt_ms = millis() + _backoff_ms;
  _backoff_ms = std::min<uint32_t>(_backoff_ms * 2, kMaxBackoffMs);
}

bool WifiTcpTransport::ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  // Both modes use STA on the panel side: in "ap_join" we associate to the
  // grblHAL SoftAP SSID, in "sta" we associate to an external router.
  WiFi.mode(WIFI_STA);
  if (_ssid.isEmpty()) {
    _status = "no SSID";
    Serial.printf("[wifi] %s\n", _status.c_str());
    return false;
  }
  _attempts++;
  _status = String("joining ") + _ssid + " (try " + String(_attempts) + ")";
  Serial.printf("[wifi] %s\n", _status.c_str());
  WiFi.begin(_ssid.c_str(), _password.c_str());
  uint32_t deadline = millis() + kWifiAssocTimeoutMs;
  while (millis() < deadline) {
    if (WiFi.status() == WL_CONNECTED) {
      // Print the gateway IP we received via DHCP alongside our own IP:
      // a mismatch with the configured host (`_host`) means the controller's
      // SoftAP is using a *different* subnet (e.g. grblHAL upstream default
      // 192.168.5.1 vs our 192.168.4.1) and TCP connect will fail with
      // "no route" — which the user otherwise sees only as "tcp fail".
      _status = String("ip ") + WiFi.localIP().toString() +
                " gw " + WiFi.gatewayIP().toString() +
                " rssi " + String(WiFi.RSSI()) + "dBm";
      Serial.printf("[wifi] %s\n", _status.c_str());
      return true;
    }
    delay(50);
  }
  wl_status_t st = WiFi.status();
  _status = String("assoc fail [") + wlStatusName(st) + "] try " + String(_attempts);
  Serial.printf("[wifi] %s (raw=%d)\n", _status.c_str(), (int)st);
  return false;
}

bool WifiTcpTransport::ensureClient() {
  if (_client.connected()) return true;
  IPAddress ip;
  // In ap_join mode the controller IS the DHCP gateway, so we always use
  // the gateway IP and ignore whatever `_host` the profile holds — that
  // way legacy profiles with a stale hardcoded host (e.g. "192.168.4.1"
  // from an older default) auto-recover when the controller's AP subnet
  // differs (grblHAL upstream is 192.168.5.1).  In sta mode the gateway
  // is the router, so we honour the explicit `_host`; empty/"auto"/
  // "gateway" still falls back to the gateway as a convenience.
  bool use_gateway = (_mode == Mode::ApJoin) ||
                     _host.isEmpty() || _host.equalsIgnoreCase("auto") ||
                     _host.equalsIgnoreCase("gateway");
  if (use_gateway) {
    ip = WiFi.gatewayIP();
    if (ip == IPAddress(0, 0, 0, 0)) {
      _status = "no gateway yet";
      Serial.printf("[wifi] %s\n", _status.c_str());
      return false;
    }
  } else if (!ip.fromString(_host)) {
    _status = String("bad host '") + _host + "'";
    Serial.printf("[wifi] %s\n", _status.c_str());
    return false;
  }
  String host_label = use_gateway ? (String("gw ") + ip.toString()) : _host;
  _client.setNoDelay(true);
  if (!_client.connect(ip, _port, kTcpConnectTimeoutMs)) {
    // Annotate the failure: if a fixed host was configured but doesn't
    // match the gateway, the SoftAP is on a different subnet (most common
    // cause).  If we're already using the gateway IP, the controller is
    // reachable but no telnetd is listening on the port (check `$70`
    // services bitmask / `$315` telnet port on the controller).
    IPAddress gw = WiFi.gatewayIP();
    bool subnet_mismatch = !use_gateway && !(gw == ip);
    _status = String("tcp fail ") + host_label + ":" + String(_port) +
              (subnet_mismatch ? String(" (gw=") + gw.toString() + ", subnet?)"
                               : String(" (no listener?)"));
    Serial.printf("[wifi] %s rssi=%ddBm\n", _status.c_str(), WiFi.RSSI());
    return false;
  }
  _status = String("tcp ") + host_label + ":" + String(_port) + " ok";
  Serial.printf("[wifi] %s\n", _status.c_str());
  _backoff_ms = kMinBackoffMs;
  return true;
}

void WifiTcpTransport::poll() {
  if (!_started) return;
  if (connected()) return;
  uint32_t now = millis();
  if (now < _next_attempt_ms) return;
  if (!ensureWifi()) {
    scheduleRetry();
    return;
  }
  if (!ensureClient()) {
    scheduleRetry();
    return;
  }
}

int WifiTcpTransport::available() {
  if (!connected()) return 0;
  return _client.available();
}

int WifiTcpTransport::read() {
  if (!connected()) return -1;
  return _client.read();
}

size_t WifiTcpTransport::write(const uint8_t *buf, size_t len) {
  if (!connected()) return 0;
  size_t n = _client.write(buf, len);
  _client.flush();
  return n;
}

size_t WifiTcpTransport::write(uint8_t b) {
  if (!connected()) return 0;
  size_t n = _client.write(b);
  _client.flush();
  return n;
}
