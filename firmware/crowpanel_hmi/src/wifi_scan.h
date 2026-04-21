#pragma once

#include <Arduino.h>

// Lightweight async WiFi scan helper for the SetupPanel SSID picker.
//
// The Arduino-ESP32 core exposes `WiFi.scanNetworks(true)` for non-blocking
// scans (`WiFi.scanComplete()` returns the AP count once finished, or a
// negative `WIFI_SCAN_*` sentinel while running / on error).  This wrapper
// drives that API as a small state machine that can be polled from the
// main loop without blocking the UI.
//
// Only one scan is in flight at a time.  Calling `wifiScanStart()` while a
// scan is already running aborts the previous results.  Successful results
// remain valid until `wifiScanRelease()` is called.
enum class WifiScanState {
  Idle,
  Running,
  Done,
  Failed,
};

void wifiScanStart();
WifiScanState wifiScanPoll();
WifiScanState wifiScanState();

int wifiScanCount();
String wifiScanSsid(int index);
int wifiScanRssi(int index);
bool wifiScanIsSecure(int index);

void wifiScanRelease();
