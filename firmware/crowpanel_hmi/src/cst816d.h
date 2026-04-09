#pragma once

#include <Arduino.h>
#include <Wire.h>

class Cst816d {
public:
  Cst816d(int8_t sda_pin, int8_t scl_pin, int8_t rst_pin, int8_t int_pin);
  void begin();
  bool readTouch(uint16_t &x, uint16_t &y);

private:
  uint8_t readReg(uint8_t reg);
  bool readRegs(uint8_t reg, uint8_t *data, size_t len);
  void writeReg(uint8_t reg, uint8_t val);

  int8_t _sda;
  int8_t _scl;
  int8_t _rst;
  int8_t _int;
};
