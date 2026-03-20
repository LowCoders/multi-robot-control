#include "manual_control.h"
#include <Wire.h>

ManualControl manualControl;

ManualControl::ManualControl()
    : _joystickX(PIN_JOY_X, 8)
    , _joystickY(PIN_JOY_Y, 8)
    , _encoder(&Wire)
    , _joyButton(PIN_JOY_BTN, true, true)
    , _encoderButton(PIN_ENCODER_BTN, true, true)
    , _joyX(JOY_CENTER)
    , _joyY(JOY_CENTER)
    , _joyCenterX(JOY_CENTER)
    , _joyCenterY(JOY_CENTER)
    , _joystickSignalValid(true)
    , _floatingCounter(0)
    , _encoderRaw(0)
    , _encoderAngle(0.0f)
{
}

void ManualControl::begin() {
    // Initialize analog inputs
    _joystickX.begin();
    _joystickY.begin();
    
    // Initialize buttons
    _joyButton.begin();
    _encoderButton.begin();

    bool encoderOk = _encoder.begin();
    
    // Read initial values
    _joyX = _joystickX.read();
    _joyY = _joystickY.read();
    _joyCenterX = _joyX;
    _joyCenterY = _joyY;
    _encoderRaw = _encoder.readAngle();
    _encoderAngle = (_encoderRaw * 360.0f) / 4096.0f;
    _encoderAngle = constrainFloat(_encoderAngle, ENCODER_MIN_ANGLE, ENCODER_MAX_ANGLE);
    
    Serial.println("[ManualCtrl] Initialized");
    Serial.print("  Joystick X: ");
    Serial.println(_joyX);
    Serial.print("  Joystick Y: ");
    Serial.println(_joyY);
    Serial.print("  Joystick center X/Y: ");
    Serial.print(_joyCenterX);
    Serial.print(" / ");
    Serial.println(_joyCenterY);
    Serial.print("  AS5600: ");
    Serial.println(encoderOk ? "OK" : "NOT FOUND");
}

void ManualControl::update() {
    // Update analog inputs
    _joyX = _joystickX.read();
    _joyY = _joystickY.read();
    const int dx = abs(_joyX - _joyCenterX);
    const int dy = abs(_joyY - _joyCenterY);
    const bool looksFloating = (dx > JOY_FLOATING_DRIFT_THRESHOLD) && (dy > JOY_FLOATING_DRIFT_THRESHOLD);
    if (looksFloating) {
        if (_floatingCounter < 255) {
            _floatingCounter++;
        }
    } else if (_floatingCounter > 0) {
        _floatingCounter--;
    }
    _joystickSignalValid = (_floatingCounter < JOY_FLOATING_FILTER_COUNT);

    _encoderRaw = _encoder.readAngle();
    _encoderAngle = (_encoderRaw * 360.0f) / 4096.0f;
    _encoderAngle = constrainFloat(_encoderAngle, ENCODER_MIN_ANGLE, ENCODER_MAX_ANGLE);
    
    // Update buttons
    _joyButton.update();
    _encoderButton.update();
}

bool ManualControl::hasJoystickInput() const {
    if (!_joystickSignalValid) {
        return false;
    }
    return abs(_joyX - _joyCenterX) > JOY_DEADZONE ||
           abs(_joyY - _joyCenterY) > JOY_DEADZONE;
}

int ManualControl::getJoystickPushSpeed() const {
    if (!_joystickSignalValid) {
        return 0;
    }
    return mapWithDeadzone(_joyX, _joyCenterX, JOY_DEADZONE, -JOG_SPEED_MAX, JOG_SPEED_MAX);
}

int ManualControl::getJoystickBendPreview() const {
    if (!_joystickSignalValid) {
        return 0;
    }
    return mapWithDeadzone(_joyY, _joyCenterY, JOY_DEADZONE, -90, 90);
}

bool ManualControl::isJogActivationPressed() const {
    return _joyButton.isPressed();
}

float ManualControl::getEncoderAngle() const {
    return _encoderAngle;
}

bool ManualControl::isJoyButtonPressed() const {
    return _joyButton.justPressed();
}

bool ManualControl::isEncoderButtonPressed() const {
    return _encoderButton.justPressed();
}
