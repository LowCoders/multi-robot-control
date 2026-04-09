#include "cst816d.h"

namespace {
constexpr uint8_t kTouchAddr = 0x15;
}

Cst816d::Cst816d(int8_t sda_pin, int8_t scl_pin, int8_t rst_pin, int8_t int_pin)
    : _sda(sda_pin), _scl(scl_pin), _rst(rst_pin), _int(int_pin) {}

void Cst816d::begin() {
  Wire1.begin(_sda, _scl);

  if (_int >= 0) {
    pinMode(_int, OUTPUT);
    digitalWrite(_int, HIGH);
    delay(1);
    digitalWrite(_int, LOW);
    delay(1);
  }

  if (_rst >= 0) {
    pinMode(_rst, OUTPUT);
    digitalWrite(_rst, LOW);
    delay(10);
    digitalWrite(_rst, HIGH);
    delay(300);
  }

  // Vendor init sequence.
  writeReg(0xFE, 0xFF);
}

bool Cst816d::readTouch(uint16_t &x, uint16_t &y) {
  const bool finger = readReg(0x02) != 0;
  if (!finger) {
    return false;
  }

  uint8_t data[4] = {0};
  if (!readRegs(0x03, data, sizeof(data))) {
    return false;
  }

  x = static_cast<uint16_t>(((data[0] & 0x0F) << 8) | data[1]);
  y = static_cast<uint16_t>(((data[2] & 0x0F) << 8) | data[3]);
  return true;
}

uint8_t Cst816d::readReg(uint8_t reg) {
  Wire1.beginTransmission(kTouchAddr);
  Wire1.write(reg);
  if (Wire1.endTransmission(false) != 0) {
    return 0;
  }
  if (Wire1.requestFrom(kTouchAddr, static_cast<uint8_t>(1)) != 1) {
    return 0;
  }
  return Wire1.available() ? Wire1.read() : 0;
}

bool Cst816d::readRegs(uint8_t reg, uint8_t *data, size_t len) {
  Wire1.beginTransmission(kTouchAddr);
  Wire1.write(reg);
  if (Wire1.endTransmission(true) != 0) {
    return false;
  }

  const uint8_t req = static_cast<uint8_t>(len);
  if (Wire1.requestFrom(kTouchAddr, req) != req) {
    return false;
  }

  for (size_t i = 0; i < len; i++) {
    if (!Wire1.available()) {
      return false;
    }
    data[i] = Wire1.read();
  }
  return true;
}

void Cst816d::writeReg(uint8_t reg, uint8_t val) {
  Wire1.beginTransmission(kTouchAddr);
  Wire1.write(reg);
  Wire1.write(val);
  Wire1.endTransmission();
}
