#include "wifi_scan.h"

#include <WiFi.h>

namespace {
WifiScanState g_state = WifiScanState::Idle;
int g_count = 0;
}

void wifiScanStart() {
  // Aborting a previous scan: scanDelete() drops cached results, then we
  // restart in async mode.  WIFI_STA is required for scanning even though
  // we never associate from the scan helper itself.
  WiFi.scanDelete();
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false);
  int rc = WiFi.scanNetworks(/*async=*/true, /*show_hidden=*/false);
  if (rc == WIFI_SCAN_RUNNING || rc == 0) {
    g_state = WifiScanState::Running;
    g_count = 0;
  } else if (rc >= 0) {
    g_state = WifiScanState::Done;
    g_count = rc;
  } else {
    g_state = WifiScanState::Failed;
    g_count = 0;
  }
}

WifiScanState wifiScanPoll() {
  if (g_state != WifiScanState::Running) {
    return g_state;
  }
  int rc = WiFi.scanComplete();
  if (rc == WIFI_SCAN_RUNNING) {
    return g_state;  // still busy
  }
  if (rc >= 0) {
    g_count = rc;
    g_state = WifiScanState::Done;
  } else {
    g_count = 0;
    g_state = WifiScanState::Failed;
  }
  return g_state;
}

WifiScanState wifiScanState() {
  return g_state;
}

int wifiScanCount() {
  return g_state == WifiScanState::Done ? g_count : 0;
}

String wifiScanSsid(int index) {
  if (g_state != WifiScanState::Done || index < 0 || index >= g_count) {
    return String();
  }
  return WiFi.SSID(index);
}

int wifiScanRssi(int index) {
  if (g_state != WifiScanState::Done || index < 0 || index >= g_count) {
    return 0;
  }
  return WiFi.RSSI(index);
}

bool wifiScanIsSecure(int index) {
  if (g_state != WifiScanState::Done || index < 0 || index >= g_count) {
    return false;
  }
  return WiFi.encryptionType(index) != WIFI_AUTH_OPEN;
}

void wifiScanRelease() {
  WiFi.scanDelete();
  g_state = WifiScanState::Idle;
  g_count = 0;
}
