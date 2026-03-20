#ifndef MANUAL_CONTROL_H
#define MANUAL_CONTROL_H

#include <Arduino.h>
#include <AS5600.h>
#include "config.h"
#include "utils.h"

class ManualControl {
public:
    ManualControl();
    
    void begin();
    void update();
    
    // Joystick
    bool hasJoystickInput() const;
    int getJoystickPushSpeed() const;   // Returns speed in steps/sec (negative = reverse)
    int getJoystickBendPreview() const; // Returns preview angle adjustment
    bool isJogActivationPressed() const;
    int getRawJoystickX() const { return _joyX; }
    int getRawJoystickY() const { return _joyY; }
    
    // Encoder (AS5600-M)
    float getEncoderAngle() const;  // Returns angle 0-180 degrees (mapped)
    int getRawEncoder() const { return _encoderRaw; }
    
    // Buttons
    bool isJoyButtonPressed() const;
    bool isEncoderButtonPressed() const;

private:
    // Analog inputs
    AnalogInput _joystickX;
    AnalogInput _joystickY;
    AS5600 _encoder;
    
    // Buttons
    Button _joyButton;
    Button _encoderButton;
    
    // Cached values
    int _joyX;
    int _joyY;
    int _joyCenterX;
    int _joyCenterY;
    bool _joystickSignalValid;
    uint8_t _floatingCounter;
    int _encoderRaw;
    float _encoderAngle;
};

extern ManualControl manualControl;

#endif // MANUAL_CONTROL_H
