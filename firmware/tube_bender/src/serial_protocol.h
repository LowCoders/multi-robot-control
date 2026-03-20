#ifndef SERIAL_PROTOCOL_H
#define SERIAL_PROTOCOL_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "stepper_control.h"
#include "program_manager.h"
#include "manual_control.h"

class SerialProtocol {
public:
    SerialProtocol();
    
    void begin();
    void update();
    
    // Send status update
    void sendStatus();
    void sendError(const char* message);
    void sendOk(const char* message = nullptr);

private:
    char _inputBuffer[JSON_BUFFER_SIZE];
    int _bufferIndex;
    
    void processCommand(const char* json);
    
    // Command handlers
    void handleStatus(JsonDocument& doc);
    void handleListPrograms(JsonDocument& doc);
    void handleLoadProgram(JsonDocument& doc);
    void handleSaveProgram(JsonDocument& doc);
    void handleDeleteProgram(JsonDocument& doc);
    void handleRun(JsonDocument& doc);
    void handleStop(JsonDocument& doc);
    void handlePause(JsonDocument& doc);
    void handleResume(JsonDocument& doc);
    void handleJog(JsonDocument& doc);
    void handleHome(JsonDocument& doc);
    void handleReset(JsonDocument& doc);
    void handleEnable(JsonDocument& doc);
    void handleDisable(JsonDocument& doc);
    void handleAddStep(JsonDocument& doc);
    void handleClearSteps(JsonDocument& doc);
    void handleGetSteps(JsonDocument& doc);
};

extern SerialProtocol serialProtocol;

// Forward declaration of state access
extern SystemState currentState;
extern void changeState(SystemState newState);

#endif // SERIAL_PROTOCOL_H
