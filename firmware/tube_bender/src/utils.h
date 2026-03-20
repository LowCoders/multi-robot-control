#ifndef UTILS_H
#define UTILS_H

#include <Arduino.h>
#include "config.h"

// Map value with deadzone handling
inline int mapWithDeadzone(int value, int center, int deadzone, int outMin, int outMax) {
    if (abs(value - center) < deadzone) {
        return 0;
    }
    
    if (value < center - deadzone) {
        return map(value, JOY_MIN, center - deadzone, outMin, 0);
    } else {
        return map(value, center + deadzone, JOY_MAX, 0, outMax);
    }
}

// Constrain float value
inline float constrainFloat(float value, float min, float max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

// State name helper
inline const char* getStateName(SystemState state) {
    switch (state) {
        case SystemState::INIT:       return "INIT";
        case SystemState::IDLE:       return "IDLE";
        case SystemState::MANUAL_JOG: return "MANUAL_JOG";
        case SystemState::TEACHING:   return "TEACHING";
        case SystemState::RUNNING:    return "RUNNING";
        case SystemState::PAUSED:     return "PAUSED";
        case SystemState::ESTOP:      return "ESTOP";
        case SystemState::ERROR:      return "ERROR";
        default:                      return "UNKNOWN";
    }
}

// Button state structure with debouncing
class Button {
public:
    Button(uint8_t pin, bool activeLow = true, bool usePullup = true)
        : _pin(pin)
        , _activeLow(activeLow)
        , _usePullup(usePullup)
        , _lastState(false)
        , _currentState(false)
        , _lastDebounceTime(0)
        , _pressedTime(0)
        , _justPressed(false)
        , _justReleased(false)
        , _longPressed(false)
    {}
    
    void begin() {
        if (_usePullup) {
            pinMode(_pin, INPUT_PULLUP);
        } else {
            pinMode(_pin, INPUT);
        }
        _lastState = readRaw();
        _currentState = _lastState;
    }
    
    void update() {
        bool reading = readRaw();
        _justPressed = false;
        _justReleased = false;
        
        if (reading != _lastState) {
            _lastDebounceTime = millis();
        }
        
        if ((millis() - _lastDebounceTime) > DEBOUNCE_MS) {
            if (reading != _currentState) {
                _currentState = reading;
                
                if (_currentState) {
                    _justPressed = true;
                    _pressedTime = millis();
                    _longPressed = false;
                } else {
                    _justReleased = true;
                }
            }
            
            // Check for long press
            if (_currentState && !_longPressed && 
                (millis() - _pressedTime) > LONG_PRESS_MS) {
                _longPressed = true;
            }
        }
        
        _lastState = reading;
    }
    
    bool isPressed() const { return _currentState; }
    bool justPressed() const { return _justPressed; }
    bool justReleased() const { return _justReleased; }
    bool isLongPressed() const { return _longPressed; }
    
private:
    bool readRaw() const {
        bool state = digitalRead(_pin);
        return _activeLow ? !state : state;
    }
    
    uint8_t _pin;
    bool _activeLow;
    bool _usePullup;
    bool _lastState;
    bool _currentState;
    unsigned long _lastDebounceTime;
    unsigned long _pressedTime;
    bool _justPressed;
    bool _justReleased;
    bool _longPressed;
};

// Analog input with smoothing
class AnalogInput {
public:
    AnalogInput(uint8_t pin, uint8_t samples = 8)
        : _pin(pin)
        , _samples(samples)
        , _index(0)
        , _sum(0)
    {
        for (int i = 0; i < 16; i++) {
            _buffer[i] = 0;
        }
    }
    
    void begin() {
        // Fill buffer with initial readings
        for (int i = 0; i < _samples; i++) {
            _buffer[i] = analogRead(_pin);
            _sum += _buffer[i];
        }
    }
    
    int read() {
        // Remove oldest value from sum
        _sum -= _buffer[_index];
        
        // Read new value
        _buffer[_index] = analogRead(_pin);
        _sum += _buffer[_index];
        
        // Advance index
        _index = (_index + 1) % _samples;
        
        // Return average
        return _sum / _samples;
    }
    
private:
    uint8_t _pin;
    uint8_t _samples;
    uint8_t _index;
    int _buffer[16];
    long _sum;
};

#endif // UTILS_H
