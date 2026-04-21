#pragma once

#include <Arduino.h>
#include <deque>

#include "grbl_parser.h"
#include "transport.h"

class GrblClient {
public:
  void begin(IGrblTransport *transport, GrblParser *parser);
  void setTransport(IGrblTransport *transport);
  IGrblTransport *transport() const { return _transport; }

  void update();

  bool queueLine(const String &line);
  void sendRealtime(uint8_t cmd);
  void requestStatus();

  bool isIdle() const;
  bool hasPending() const { return !_queue.empty() || _awaiting_ok; }
  size_t queuedCount() const { return _queue.size(); }
  bool awaitingOk() const { return _awaiting_ok; }
  bool linkUp() const { return _transport && _transport->connected(); }
  const String &lastError() const { return _last_error; }
  void clearError() { _last_error = ""; }
  void clearQueue();
  void setMotionAllowed(bool allowed);
  bool motionAllowed() const { return _motion_allowed; }

  const std::deque<String> &recentTx() const { return _recent_tx; }
  void clearRecentTx() { _recent_tx.clear(); }

private:
  bool isMotionCommand(const String &line) const;
  void processLine(const String &line);

  static constexpr size_t kRecentTxCap = 16;

  IGrblTransport *_transport = nullptr;
  GrblParser *_parser = nullptr;
  std::deque<String> _queue;
  std::deque<String> _recent_tx;
  String _rx_line;
  bool _awaiting_ok = false;
  uint32_t _awaiting_since_ms = 0;
  String _awaiting_line;
  String _last_error;
  bool _motion_allowed = true;
};
