#include "program_manager.h"

ProgramManager programManager;

ProgramManager::ProgramManager()
    : _programName("")
    , _running(false)
    , _paused(false)
    , _currentStepIndex(0)
    , _stepPhase(StepPhase::IDLE)
{
}

void ProgramManager::begin() {
    if (!initSPIFFS()) {
        Serial.println("[Program] SPIFFS init failed!");
        return;
    }
    
    // Create programs directory if it doesn't exist
    if (!SPIFFS.exists(PROGRAMS_DIR)) {
        Serial.println("[Program] Creating programs directory");
    }
    
    Serial.println("[Program] Initialized");
}

bool ProgramManager::initSPIFFS() {
    if (!SPIFFS.begin(true)) {
        Serial.println("[SPIFFS] Mount failed");
        return false;
    }
    
    Serial.print("[SPIFFS] Total: ");
    Serial.print(SPIFFS.totalBytes());
    Serial.print(" Used: ");
    Serial.println(SPIFFS.usedBytes());
    
    return true;
}

bool ProgramManager::hasProgram() const {
    return !_steps.empty();
}

int ProgramManager::getStepCount() const {
    return _steps.size();
}

void ProgramManager::clearProgram() {
    _steps.clear();
    _programName = "";
    _running = false;
    _paused = false;
    _currentStepIndex = 0;
    _stepPhase = StepPhase::IDLE;
    Serial.println("[Program] Cleared");
}

void ProgramManager::addStep(const BendStep& step) {
    if (_steps.size() >= MAX_PROGRAM_STEPS) {
        Serial.println("[Program] Max steps reached!");
        return;
    }
    
    _steps.push_back(step);
    Serial.print("[Program] Added step #");
    Serial.println(_steps.size());
}

void ProgramManager::removeStep(int index) {
    if (index < 0 || index >= (int)_steps.size()) {
        return;
    }
    
    _steps.erase(_steps.begin() + index);
    Serial.print("[Program] Removed step #");
    Serial.println(index + 1);
}

BendStep* ProgramManager::getStep(int index) {
    if (index < 0 || index >= (int)_steps.size()) {
        return nullptr;
    }
    return &_steps[index];
}

void ProgramManager::startProgram() {
    if (_steps.empty()) {
        Serial.println("[Program] No steps to run");
        return;
    }
    
    _running = true;
    _paused = false;
    _currentStepIndex = 0;
    _stepPhase = StepPhase::PUSHING;
    
    Serial.print("[Program] Starting, ");
    Serial.print(_steps.size());
    Serial.println(" steps");
}

void ProgramManager::stopProgram() {
    _running = false;
    _paused = false;
    _currentStepIndex = 0;
    _stepPhase = StepPhase::IDLE;
    Serial.println("[Program] Stopped");
}

void ProgramManager::pauseProgram() {
    _paused = true;
    Serial.println("[Program] Paused");
}

void ProgramManager::resumeProgram() {
    _paused = false;
    Serial.println("[Program] Resumed");
}

BendStep* ProgramManager::getCurrentStep() {
    return getStep(_currentStepIndex);
}

void ProgramManager::executeStep(StepperControl& steppers) {
    if (!_running || _paused) return;
    
    BendStep* step = getCurrentStep();
    if (step == nullptr) {
        _running = false;
        return;
    }
    
    switch (_stepPhase) {
        case StepPhase::PUSHING:
            if (!steppers.isPushMoving()) {
                // Start push movement
                steppers.movePushTo(step->pushDistance);
                Serial.print("[Program] Step ");
                Serial.print(_currentStepIndex + 1);
                Serial.print(" - Pushing to ");
                Serial.print(step->pushDistance);
                Serial.println("mm");
            }
            
            if (steppers.isPushMoving()) {
                steppers.run();
            } else {
                _stepPhase = StepPhase::BENDING;
            }
            break;
            
        case StepPhase::BENDING:
            if (!steppers.isBendMoving()) {
                // Start bend movement
                steppers.moveBendTo(step->bendAngle);
                Serial.print("[Program] Step ");
                Serial.print(_currentStepIndex + 1);
                Serial.print(" - Bending to ");
                Serial.print(step->bendAngle);
                Serial.println(" deg");
            }
            
            if (steppers.isBendMoving()) {
                steppers.run();
            } else {
                _stepPhase = StepPhase::RETURNING;
            }
            break;
            
        case StepPhase::RETURNING:
            if (!steppers.isBendMoving()) {
                // Return bend to zero
                steppers.moveBendTo(0);
                Serial.print("[Program] Step ");
                Serial.print(_currentStepIndex + 1);
                Serial.println(" - Returning bend to 0");
            }
            
            if (steppers.isBendMoving()) {
                steppers.run();
            } else {
                _stepPhase = StepPhase::ROTATING;
            }
            break;
            
        case StepPhase::ROTATING:
            if (step->rotation != 0) {
                if (!steppers.isRotateMoving()) {
                    // Start rotation
                    steppers.moveRotateRelative(step->rotation);
                    Serial.print("[Program] Step ");
                    Serial.print(_currentStepIndex + 1);
                    Serial.print(" - Rotating ");
                    Serial.print(step->rotation);
                    Serial.println(" deg");
                }
                
                if (steppers.isRotateMoving()) {
                    steppers.run();
                } else {
                    _stepPhase = StepPhase::COMPLETE;
                }
            } else {
                _stepPhase = StepPhase::COMPLETE;
            }
            break;
            
        case StepPhase::COMPLETE:
            Serial.print("[Program] Step ");
            Serial.print(_currentStepIndex + 1);
            Serial.println(" complete");
            
            _currentStepIndex++;
            if (_currentStepIndex >= (int)_steps.size()) {
                _running = false;
                Serial.println("[Program] All steps complete");
            } else {
                _stepPhase = StepPhase::PUSHING;
            }
            break;
            
        default:
            break;
    }
}

String ProgramManager::getProgramPath(const char* name) {
    return String(PROGRAMS_DIR) + "/" + String(name) + ".json";
}

bool ProgramManager::saveProgram(const char* name) {
    String path = getProgramPath(name);
    
    File file = SPIFFS.open(path, "w");
    if (!file) {
        Serial.print("[Program] Failed to open file for writing: ");
        Serial.println(path);
        return false;
    }
    
    JsonDocument doc;
    doc["name"] = name;
    doc["created"] = millis();  // TODO: Real timestamp if RTC available
    
    JsonArray stepsArray = doc["steps"].to<JsonArray>();
    for (const auto& step : _steps) {
        JsonObject stepObj = stepsArray.add<JsonObject>();
        stepObj["push"] = step.pushDistance;
        stepObj["angle"] = step.bendAngle;
        stepObj["rotation"] = step.rotation;
    }
    
    size_t written = serializeJson(doc, file);
    file.close();
    
    if (written > 0) {
        _programName = name;
        Serial.print("[Program] Saved: ");
        Serial.print(path);
        Serial.print(" (");
        Serial.print(written);
        Serial.println(" bytes)");
        return true;
    }
    
    return false;
}

bool ProgramManager::loadProgram(const char* name) {
    String path = getProgramPath(name);
    
    if (!SPIFFS.exists(path)) {
        Serial.print("[Program] File not found: ");
        Serial.println(path);
        return false;
    }
    
    File file = SPIFFS.open(path, "r");
    if (!file) {
        Serial.print("[Program] Failed to open file: ");
        Serial.println(path);
        return false;
    }
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, file);
    file.close();
    
    if (error) {
        Serial.print("[Program] JSON parse error: ");
        Serial.println(error.c_str());
        return false;
    }
    
    // Clear current program
    clearProgram();
    
    _programName = doc["name"].as<String>();
    
    JsonArray stepsArray = doc["steps"].as<JsonArray>();
    for (JsonObject stepObj : stepsArray) {
        BendStep step;
        step.pushDistance = stepObj["push"].as<float>();
        step.bendAngle = stepObj["angle"].as<float>();
        step.rotation = stepObj["rotation"].as<float>();
        _steps.push_back(step);
    }
    
    Serial.print("[Program] Loaded: ");
    Serial.print(name);
    Serial.print(" (");
    Serial.print(_steps.size());
    Serial.println(" steps)");
    
    return true;
}

bool ProgramManager::deleteProgram(const char* name) {
    String path = getProgramPath(name);
    
    if (!SPIFFS.exists(path)) {
        return false;
    }
    
    if (SPIFFS.remove(path)) {
        Serial.print("[Program] Deleted: ");
        Serial.println(path);
        return true;
    }
    
    return false;
}

std::vector<String> ProgramManager::listPrograms() {
    std::vector<String> programs;
    
    File root = SPIFFS.open(PROGRAMS_DIR);
    if (!root || !root.isDirectory()) {
        return programs;
    }
    
    File file = root.openNextFile();
    while (file) {
        if (!file.isDirectory()) {
            String name = file.name();
            // Remove .json extension
            if (name.endsWith(".json")) {
                name = name.substring(0, name.length() - 5);
                // Remove leading path
                int lastSlash = name.lastIndexOf('/');
                if (lastSlash >= 0) {
                    name = name.substring(lastSlash + 1);
                }
                programs.push_back(name);
            }
        }
        file = root.openNextFile();
    }
    
    return programs;
}
