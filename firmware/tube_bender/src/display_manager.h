#ifndef DISPLAY_MANAGER_H
#define DISPLAY_MANAGER_H

#include <Arduino.h>
#include <SoftwareSerial.h>
#include "config.h"
#include "stepper_control.h"
#include "program_manager.h"
#include "menu_system.h"

class DisplayManager {
public:
    DisplayManager();
    
    void begin();
    void update(SystemState state);
    
    // Display 1 - Status
    void setStatusText(const char* text);
    void setPosition(float push, float bend, float rot);
    void setTargetAngle(float angle);
    
    // Display 2 - Program
    void setProgramInfo(int currentStep, int totalSteps);
    void setStepInfo(const BendStep& step);
    void setMenuInfo(const char* selectedLabel, int selectedIndex);
    
    // Low-level commands
    void sendCommand(HardwareSerial& serial, const char* cmd);
    void setText(HardwareSerial& serial, const char* objName, const char* text);
    void setValue(HardwareSerial& serial, const char* objName, int value);
    
    void sendCommand(SoftwareSerial& serial, const char* cmd);
    void setText(SoftwareSerial& serial, const char* objName, const char* text);
    void setValue(SoftwareSerial& serial, const char* objName, int value);

private:
    SoftwareSerial _display2;
    
    void sendTerminator(Stream& serial);
    SystemState _lastState;
    float _lastPush, _lastBend, _lastRot;
    float _lastTargetAngle;
    int _lastCurrentStep, _lastTotalSteps;
    int _lastMenuIndex;
};

extern DisplayManager displayManager;

#endif // DISPLAY_MANAGER_H
