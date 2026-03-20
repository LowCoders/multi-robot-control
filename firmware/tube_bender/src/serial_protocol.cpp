#include "serial_protocol.h"

SerialProtocol serialProtocol;

SerialProtocol::SerialProtocol()
    : _bufferIndex(0)
{
    memset(_inputBuffer, 0, JSON_BUFFER_SIZE);
}

void SerialProtocol::begin() {
    Serial.println("[Serial] Protocol initialized");
}

void SerialProtocol::update() {
    while (Serial.available()) {
        char c = Serial.read();
        
        if (c == '\n' || c == '\r') {
            if (_bufferIndex > 0) {
                _inputBuffer[_bufferIndex] = '\0';
                processCommand(_inputBuffer);
                _bufferIndex = 0;
                memset(_inputBuffer, 0, JSON_BUFFER_SIZE);
            }
        } else if (_bufferIndex < JSON_BUFFER_SIZE - 1) {
            _inputBuffer[_bufferIndex++] = c;
        }
    }
}

void SerialProtocol::processCommand(const char* json) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    if (error) {
        sendError("JSON parse error");
        return;
    }
    
    const char* cmd = doc["cmd"];
    if (cmd == nullptr) {
        sendError("Missing 'cmd' field");
        return;
    }
    
    // Route command to handler
    if (strcmp(cmd, "status") == 0) {
        handleStatus(doc);
    } else if (strcmp(cmd, "list_programs") == 0) {
        handleListPrograms(doc);
    } else if (strcmp(cmd, "load") == 0) {
        handleLoadProgram(doc);
    } else if (strcmp(cmd, "save") == 0) {
        handleSaveProgram(doc);
    } else if (strcmp(cmd, "delete") == 0) {
        handleDeleteProgram(doc);
    } else if (strcmp(cmd, "run") == 0) {
        handleRun(doc);
    } else if (strcmp(cmd, "stop") == 0) {
        handleStop(doc);
    } else if (strcmp(cmd, "pause") == 0) {
        handlePause(doc);
    } else if (strcmp(cmd, "resume") == 0) {
        handleResume(doc);
    } else if (strcmp(cmd, "jog") == 0) {
        handleJog(doc);
    } else if (strcmp(cmd, "home") == 0) {
        handleHome(doc);
    } else if (strcmp(cmd, "reset") == 0) {
        handleReset(doc);
    } else if (strcmp(cmd, "enable") == 0) {
        handleEnable(doc);
    } else if (strcmp(cmd, "disable") == 0) {
        handleDisable(doc);
    } else if (strcmp(cmd, "add_step") == 0) {
        handleAddStep(doc);
    } else if (strcmp(cmd, "clear_steps") == 0) {
        handleClearSteps(doc);
    } else if (strcmp(cmd, "get_steps") == 0) {
        handleGetSteps(doc);
    } else {
        sendError("Unknown command");
    }
}

void SerialProtocol::sendStatus() {
    JsonDocument doc;
    
    doc["state"] = getStateName(currentState);
    
    JsonObject pos = doc["pos"].to<JsonObject>();
    pos["push"] = steppers.getPushPosition();
    pos["bend"] = steppers.getBendPosition();
    pos["rot"] = steppers.getRotatePosition();
    
    doc["enabled"] = steppers.isEnabled();
    doc["moving"] = steppers.isMoving();
    
    JsonObject prog = doc["program"].to<JsonObject>();
    prog["name"] = programManager.getProgramName();
    prog["steps"] = programManager.getStepCount();
    prog["current"] = programManager.getCurrentStepIndex();
    prog["running"] = programManager.isRunning();
    prog["paused"] = programManager.isPaused();
    
    JsonObject input = doc["input"].to<JsonObject>();
    input["joy_x"] = manualControl.getRawJoystickX();
    input["joy_y"] = manualControl.getRawJoystickY();
    input["encoder_raw"] = manualControl.getRawEncoder();
    input["encoder_angle"] = manualControl.getEncoderAngle();
    input["mode"] = "menu_encoder";
    
    serializeJson(doc, Serial);
    Serial.println();
}

void SerialProtocol::sendError(const char* message) {
    JsonDocument doc;
    doc["error"] = message;
    serializeJson(doc, Serial);
    Serial.println();
}

void SerialProtocol::sendOk(const char* message) {
    JsonDocument doc;
    doc["ok"] = true;
    if (message) {
        doc["message"] = message;
    }
    serializeJson(doc, Serial);
    Serial.println();
}

void SerialProtocol::handleStatus(JsonDocument& doc) {
    sendStatus();
}

void SerialProtocol::handleListPrograms(JsonDocument& doc) {
    JsonDocument response;
    JsonArray programs = response["programs"].to<JsonArray>();
    
    auto list = programManager.listPrograms();
    for (const auto& name : list) {
        programs.add(name);
    }
    
    serializeJson(response, Serial);
    Serial.println();
}

void SerialProtocol::handleLoadProgram(JsonDocument& doc) {
    const char* name = doc["name"];
    if (name == nullptr) {
        sendError("Missing 'name' field");
        return;
    }
    
    if (programManager.loadProgram(name)) {
        sendOk("Program loaded");
    } else {
        sendError("Failed to load program");
    }
}

void SerialProtocol::handleSaveProgram(JsonDocument& doc) {
    const char* name = doc["name"];
    if (name == nullptr) {
        sendError("Missing 'name' field");
        return;
    }
    
    if (programManager.saveProgram(name)) {
        sendOk("Program saved");
    } else {
        sendError("Failed to save program");
    }
}

void SerialProtocol::handleDeleteProgram(JsonDocument& doc) {
    const char* name = doc["name"];
    if (name == nullptr) {
        sendError("Missing 'name' field");
        return;
    }
    
    if (programManager.deleteProgram(name)) {
        sendOk("Program deleted");
    } else {
        sendError("Failed to delete program");
    }
}

void SerialProtocol::handleRun(JsonDocument& doc) {
    if (currentState == SystemState::ESTOP) {
        sendError("Cannot run in E-STOP state");
        return;
    }
    
    if (!programManager.hasProgram()) {
        sendError("No program loaded");
        return;
    }
    
    changeState(SystemState::RUNNING);
    sendOk("Program started");
}

void SerialProtocol::handleStop(JsonDocument& doc) {
    programManager.stopProgram();
    changeState(SystemState::IDLE);
    sendOk("Stopped");
}

void SerialProtocol::handlePause(JsonDocument& doc) {
    if (currentState == SystemState::RUNNING) {
        changeState(SystemState::PAUSED);
        sendOk("Paused");
    } else {
        sendError("Not running");
    }
}

void SerialProtocol::handleResume(JsonDocument& doc) {
    if (currentState == SystemState::PAUSED) {
        changeState(SystemState::RUNNING);
        sendOk("Resumed");
    } else {
        sendError("Not paused");
    }
}

void SerialProtocol::handleJog(JsonDocument& doc) {
    if (currentState == SystemState::ESTOP) {
        sendError("Cannot jog in E-STOP state");
        return;
    }
    
    const char* axis = doc["axis"];
    float distance = doc["distance"] | 0.0f;
    float speed = doc["speed"] | 500.0f;
    
    if (axis == nullptr) {
        sendError("Missing 'axis' field");
        return;
    }
    
    steppers.enable();
    
    if (strcmp(axis, "push") == 0 || strcmp(axis, "x") == 0) {
        steppers.getPushStepper().setMaxSpeed(speed * STEPS_PER_MM_PUSH);
        steppers.movePushRelative(distance);
    } else if (strcmp(axis, "bend") == 0 || strcmp(axis, "y") == 0) {
        steppers.getBendStepper().setMaxSpeed(speed * STEPS_PER_DEG_BEND);
        steppers.moveBendRelative(distance);
    } else if (strcmp(axis, "rot") == 0 || strcmp(axis, "z") == 0) {
        steppers.getRotateStepper().setMaxSpeed(speed * STEPS_PER_DEG_ROT);
        steppers.moveRotateRelative(distance);
    } else {
        sendError("Invalid axis");
        return;
    }
    
    sendOk("Jogging");
}

void SerialProtocol::handleHome(JsonDocument& doc) {
    if (currentState == SystemState::ESTOP) {
        sendError("Cannot home in E-STOP state");
        return;
    }
    
    steppers.resetAllPositions();
    sendOk("Positions reset to zero");
}

void SerialProtocol::handleReset(JsonDocument& doc) {
    steppers.resetAllPositions();
    programManager.stopProgram();
    changeState(SystemState::IDLE);
    sendOk("Reset complete");
}

void SerialProtocol::handleEnable(JsonDocument& doc) {
    steppers.enable();
    sendOk("Steppers enabled");
}

void SerialProtocol::handleDisable(JsonDocument& doc) {
    steppers.disable();
    sendOk("Steppers disabled");
}

void SerialProtocol::handleAddStep(JsonDocument& doc) {
    BendStep step;
    step.pushDistance = doc["push"] | 0.0f;
    step.bendAngle = doc["angle"] | 0.0f;
    step.rotation = doc["rotation"] | 0.0f;
    
    programManager.addStep(step);
    
    JsonDocument response;
    response["ok"] = true;
    response["step_count"] = programManager.getStepCount();
    serializeJson(response, Serial);
    Serial.println();
}

void SerialProtocol::handleClearSteps(JsonDocument& doc) {
    programManager.clearProgram();
    sendOk("Steps cleared");
}

void SerialProtocol::handleGetSteps(JsonDocument& doc) {
    JsonDocument response;
    JsonArray steps = response["steps"].to<JsonArray>();
    
    const auto& programSteps = programManager.getSteps();
    for (const auto& s : programSteps) {
        JsonObject step = steps.add<JsonObject>();
        step["push"] = s.pushDistance;
        step["angle"] = s.bendAngle;
        step["rotation"] = s.rotation;
    }
    
    response["count"] = programManager.getStepCount();
    response["name"] = programManager.getProgramName();
    
    serializeJson(response, Serial);
    Serial.println();
}
