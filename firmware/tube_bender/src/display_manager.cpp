#include "display_manager.h"
#include "utils.h"

DisplayManager displayManager;

DisplayManager::DisplayManager()
    : _display2(PIN_DISP2_RX, PIN_DISP2_TX)
    , _lastState(SystemState::INIT)
    , _lastPush(0)
    , _lastBend(0)
    , _lastRot(0)
    , _lastTargetAngle(0)
    , _lastCurrentStep(0)
    , _lastTotalSteps(0)
    , _lastMenuIndex(-1)
{
}

void DisplayManager::begin() {
    // Initialize Display 1 (Hardware Serial2)
    Serial2.begin(DISPLAY_BAUD, SERIAL_8N1, PIN_DISP1_RX, PIN_DISP1_TX);
    
    // Initialize Display 2 (Software Serial)
    _display2.begin(DISPLAY_BAUD);
    
    // Give displays time to boot
    delay(500);
    
    // Send initial commands to displays
    sendCommand(Serial2, "page 0");  // Go to main page
    sendCommand(_display2, "page 0");
    
    // Set initial values
    setText(Serial2, "tState", "INIT");
    setValue(Serial2, "nPush", 0);
    setValue(Serial2, "nBend", 0);
    setValue(Serial2, "nRot", 0);
    setValue(Serial2, "nTarget", 0);
    
    setValue(_display2, "nStep", 0);
    setValue(_display2, "nTotal", 0);
    setText(_display2, "tMenu", "Run Program");
    
    Serial.println("[Display] Initialized");
}

void DisplayManager::update(SystemState state) {
    // Update state if changed
    if (state != _lastState) {
        setStatusText(getStateName(state));
        _lastState = state;
    }
    
    // Update positions
    float push = steppers.getPushPosition();
    float bend = steppers.getBendPosition();
    float rot = steppers.getRotatePosition();
    
    if (abs(push - _lastPush) > 0.1f) {
        setValue(Serial2, "nPush", (int)(push * 10));
        _lastPush = push;
    }
    
    if (abs(bend - _lastBend) > 0.1f) {
        setValue(Serial2, "nBend", (int)(bend * 10));
        _lastBend = bend;
    }
    
    if (abs(rot - _lastRot) > 0.1f) {
        setValue(Serial2, "nRot", (int)(rot * 10));
        _lastRot = rot;
    }
    
    // Update program info
    int currentStep = programManager.getCurrentStepIndex();
    int totalSteps = programManager.getStepCount();
    
    if (currentStep != _lastCurrentStep || totalSteps != _lastTotalSteps) {
        setProgramInfo(currentStep, totalSteps);
        _lastCurrentStep = currentStep;
        _lastTotalSteps = totalSteps;
    }

    int selectedMenuIndex = menuSystem.getSelectedIndex();
    if (selectedMenuIndex != _lastMenuIndex) {
        setMenuInfo(menuSystem.getSelectedLabel(), selectedMenuIndex);
        _lastMenuIndex = selectedMenuIndex;
    }
}

void DisplayManager::setStatusText(const char* text) {
    setText(Serial2, "tState", text);
}

void DisplayManager::setPosition(float push, float bend, float rot) {
    setValue(Serial2, "nPush", (int)(push * 10));
    setValue(Serial2, "nBend", (int)(bend * 10));
    setValue(Serial2, "nRot", (int)(rot * 10));
}

void DisplayManager::setTargetAngle(float angle) {
    if (abs(angle - _lastTargetAngle) > 0.5f) {
        setValue(Serial2, "nTarget", (int)(angle * 10));
        _lastTargetAngle = angle;
    }
}

void DisplayManager::setProgramInfo(int currentStep, int totalSteps) {
    setValue(_display2, "nStep", currentStep + 1);
    setValue(_display2, "nTotal", totalSteps);
}

void DisplayManager::setStepInfo(const BendStep& step) {
    setValue(_display2, "nStepPush", (int)(step.pushDistance * 10));
    setValue(_display2, "nStepAngle", (int)(step.bendAngle * 10));
    setValue(_display2, "nStepRot", (int)(step.rotation * 10));
}

void DisplayManager::setMenuInfo(const char* selectedLabel, int selectedIndex) {
    setText(_display2, "tMenu", selectedLabel);
    setValue(_display2, "nMenu", selectedIndex + 1);
}

// GM009605/Nextion command format
void DisplayManager::sendTerminator(Stream& serial) {
    serial.write(0xFF);
    serial.write(0xFF);
    serial.write(0xFF);
}

void DisplayManager::sendCommand(HardwareSerial& serial, const char* cmd) {
    serial.print(cmd);
    sendTerminator(serial);
}

void DisplayManager::setText(HardwareSerial& serial, const char* objName, const char* text) {
    serial.print(objName);
    serial.print(".txt=\"");
    serial.print(text);
    serial.print("\"");
    sendTerminator(serial);
}

void DisplayManager::setValue(HardwareSerial& serial, const char* objName, int value) {
    serial.print(objName);
    serial.print(".val=");
    serial.print(value);
    sendTerminator(serial);
}

void DisplayManager::sendCommand(SoftwareSerial& serial, const char* cmd) {
    serial.print(cmd);
    sendTerminator(serial);
}

void DisplayManager::setText(SoftwareSerial& serial, const char* objName, const char* text) {
    serial.print(objName);
    serial.print(".txt=\"");
    serial.print(text);
    serial.print("\"");
    sendTerminator(serial);
}

void DisplayManager::setValue(SoftwareSerial& serial, const char* objName, int value) {
    serial.print(objName);
    serial.print(".val=");
    serial.print(value);
    sendTerminator(serial);
}
