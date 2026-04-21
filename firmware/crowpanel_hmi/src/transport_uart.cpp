#include "transport_uart.h"

UartTransport::UartTransport(HardwareSerial &serial, int rx_pin, int tx_pin, uint32_t baud)
    : _serial(serial), _rx_pin(rx_pin), _tx_pin(tx_pin), _baud(baud) {}

void UartTransport::configure(uint32_t baud, int rx_pin, int tx_pin) {
  _baud = baud;
  _rx_pin = rx_pin;
  _tx_pin = tx_pin;
}

bool UartTransport::begin() {
  if (_open) {
    _serial.end();
    _open = false;
  }
  _serial.begin(_baud, SERIAL_8N1, _rx_pin, _tx_pin);
  _open = true;
  return true;
}

void UartTransport::end() {
  if (_open) {
    _serial.end();
    _open = false;
  }
}
