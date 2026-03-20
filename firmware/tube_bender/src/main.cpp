/**
 * Tube Bender ESP32 Standalone Controller
 * 
 * 3-axis tube bending machine controller with:
 * - Manual joystick control
 * - Program teaching and playback
 * - GM009605 display support
 * - USB Serial JSON protocol
 */

#include <Arduino.h>
#include <Wire.h>
#include "config.h"
#include "utils.h"
#include "stepper_control.h"
#include "manual_control.h"
#include "program_manager.h"
#include "display_manager.h"
#include "serial_protocol.h"
#include "menu_system.h"

// Global state
SystemState currentState = SystemState::INIT;
SystemState previousState = SystemState::INIT;

// E-STOP button (special handling - always active)
Button estopButton(PIN_ESTOP, true, true);

// Timing
unsigned long lastStateChange = 0;
unsigned long lastDisplayUpdate = 0;

// Function declarations
void changeState(SystemState newState);
void handleInit();
void handleIdle();
void handleManualJog();
void handleTeaching();
void handleRunning();
void handlePaused();
void handleEStop();
void handleError();
void checkEStop();
void handleMenuAction(MenuAction action);

void setup() {
    // Initialize serial
    Serial.begin(SERIAL_BAUD);
    delay(100);
    
    Serial.println();
    Serial.println("================================");
    Serial.println("  TUBE BENDER ESP32 CONTROLLER  ");
    Serial.println("================================");
    Serial.print("Firmware: ");
    Serial.print(FIRMWARE_NAME);
    Serial.print(" v");
    Serial.println(FIRMWARE_VERSION);
    Serial.println();
    
    // Initialize E-STOP button
    estopButton.begin();

    // Initialize I2C for AS5600 encoder
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setClock(400000);
    
    // Initialize steppers
    steppers.begin();
    
    // Initialize manual control
    manualControl.begin();
    
    // Initialize program manager
    programManager.begin();
    
    // Initialize displays
    displayManager.begin();

    // Initialize menu system
    menuSystem.begin();
    
    // Initialize serial protocol
    serialProtocol.begin();
    
    // Check initial E-STOP state
    estopButton.update();
    if (estopButton.isPressed()) {
        changeState(SystemState::ESTOP);
    } else {
        changeState(SystemState::IDLE);
    }
    
    Serial.println("[Main] Setup complete");
    Serial.println();
}

void loop() {
    // Always check E-STOP first
    checkEStop();
    
    // Update manual control inputs
    manualControl.update();
    
    // Handle serial commands
    serialProtocol.update();

    // Update menu from encoder angle + button
    menuSystem.update(
        manualControl.getEncoderAngle(),
        manualControl.isEncoderButtonPressed(),
        currentState
    );
    handleMenuAction(menuSystem.consumeAction());
    
    // State machine
    switch (currentState) {
        case SystemState::INIT:
            handleInit();
            break;
        case SystemState::IDLE:
            handleIdle();
            break;
        case SystemState::MANUAL_JOG:
            handleManualJog();
            break;
        case SystemState::TEACHING:
            handleTeaching();
            break;
        case SystemState::RUNNING:
            handleRunning();
            break;
        case SystemState::PAUSED:
            handlePaused();
            break;
        case SystemState::ESTOP:
            handleEStop();
            break;
        case SystemState::ERROR:
            handleError();
            break;
    }
    
    // Run steppers
    steppers.run();
    
    // Update display periodically
    if (millis() - lastDisplayUpdate >= DISPLAY_UPDATE_MS) {
        displayManager.update(currentState);
        lastDisplayUpdate = millis();
    }
}

void changeState(SystemState newState) {
    if (newState == currentState) return;
    
    previousState = currentState;
    currentState = newState;
    lastStateChange = millis();
    
    Serial.print("[State] ");
    Serial.print(getStateName(previousState));
    Serial.print(" -> ");
    Serial.println(getStateName(newState));
    
    // State entry actions
    switch (newState) {
        case SystemState::IDLE:
            steppers.enable();
            break;
        case SystemState::MANUAL_JOG:
            steppers.enable();
            break;
        case SystemState::TEACHING:
            steppers.enable();
            break;
        case SystemState::RUNNING:
            steppers.enable();
            programManager.startProgram();
            break;
        case SystemState::PAUSED:
            // Keep steppers enabled but stop movement
            steppers.emergencyStop();
            break;
        case SystemState::ESTOP:
            steppers.emergencyStop();
            steppers.disable();
            break;
        case SystemState::ERROR:
            steppers.emergencyStop();
            steppers.disable();
            break;
        default:
            break;
    }
}

void checkEStop() {
    estopButton.update();
    
    if (estopButton.justPressed() && currentState != SystemState::ESTOP) {
        Serial.println("[E-STOP] ACTIVATED!");
        changeState(SystemState::ESTOP);
    }
}

void handleMenuAction(MenuAction action) {
    if (action == MenuAction::NONE) return;

    if (currentState == SystemState::ESTOP && action != MenuAction::NONE) {
        return;
    }

    switch (action) {
        case MenuAction::ENTER_TEACH:
            if (currentState == SystemState::IDLE || currentState == SystemState::MANUAL_JOG) {
                changeState(SystemState::TEACHING);
            }
            break;

        case MenuAction::EXIT_TEACH:
            if (currentState == SystemState::TEACHING) {
                changeState(SystemState::IDLE);
            }
            break;

        case MenuAction::START_PROGRAM:
            if (programManager.hasProgram() &&
                (currentState == SystemState::IDLE || currentState == SystemState::MANUAL_JOG)) {
                changeState(SystemState::RUNNING);
            }
            break;

        case MenuAction::PAUSE_PROGRAM:
            if (currentState == SystemState::RUNNING) {
                changeState(SystemState::PAUSED);
            }
            break;

        case MenuAction::RESUME_PROGRAM:
            if (currentState == SystemState::PAUSED) {
                changeState(SystemState::RUNNING);
            }
            break;

        case MenuAction::STOP_PROGRAM:
            if (currentState == SystemState::RUNNING || currentState == SystemState::PAUSED) {
                programManager.stopProgram();
                changeState(SystemState::IDLE);
            }
            break;

        case MenuAction::CLEAR_PROGRAM:
            if (currentState != SystemState::RUNNING && currentState != SystemState::PAUSED) {
                programManager.clearProgram();
                Serial.println("[Menu] Program cleared");
            }
            break;

        case MenuAction::HOME_ALL:
            if (currentState != SystemState::RUNNING && currentState != SystemState::PAUSED) {
                steppers.resetAllPositions();
                Serial.println("[Menu] Positions reset to zero");
            }
            break;

        default:
            break;
    }
}

void handleInit() {
    // Should not stay in INIT state
    changeState(SystemState::IDLE);
}

void handleIdle() {
    // Enter manual jog only when the joystick button is intentionally held.
    if (JOY_REQUIRE_BUTTON_FOR_JOG &&
        (!manualControl.isJogActivationPressed() || !manualControl.hasJoystickInput())) {
        return;
    }

    if (manualControl.hasJoystickInput()) {
        changeState(SystemState::MANUAL_JOG);
        return;
    }
}

void handleManualJog() {
    if (JOY_REQUIRE_BUTTON_FOR_JOG && !manualControl.isJogActivationPressed()) {
        steppers.setPushSpeed(0);
        changeState(SystemState::IDLE);
        return;
    }

    // Apply joystick input to motors
    int pushSpeed = manualControl.getJoystickPushSpeed();
    
    if (pushSpeed != 0) {
        steppers.setPushSpeed(pushSpeed);
        steppers.runSpeed();
    } else {
        // Joystick released, return to idle
        steppers.setPushSpeed(0);
        changeState(SystemState::IDLE);
        return;
    }
    
    // Check for joystick button to execute step
    if (manualControl.isJoyButtonPressed()) {
        float targetAngle = manualControl.getEncoderAngle();
        float currentPush = steppers.getPushPosition();
        
        // Record this as a step if in teaching mode is accessible
        Serial.print("[Jog] Execute step: push=");
        Serial.print(currentPush);
        Serial.print("mm, angle=");
        Serial.print(targetAngle);
        Serial.println("deg");
        
        // Execute bend sequence
        steppers.moveBendTo(targetAngle);
        while (steppers.isBendMoving()) {
            steppers.run();
            checkEStop();
            if (currentState == SystemState::ESTOP) return;
        }
        
        // Return to zero
        steppers.moveBendTo(0);
        while (steppers.isBendMoving()) {
            steppers.run();
            checkEStop();
            if (currentState == SystemState::ESTOP) return;
        }
    }
}

void handleTeaching() {
    // Manual control still active in teaching mode
    int pushSpeed = manualControl.getJoystickPushSpeed();
    
    if (pushSpeed != 0) {
        steppers.setPushSpeed(pushSpeed);
        steppers.runSpeed();
    }
    
    // Record position on joystick button
    if (manualControl.isJoyButtonPressed()) {
        BendStep step;
        step.pushDistance = steppers.getPushPosition();
        step.bendAngle = manualControl.getEncoderAngle();
        step.rotation = steppers.getRotatePosition();
        
        programManager.addStep(step);
        
        Serial.print("[Teach] Recorded step #");
        Serial.print(programManager.getStepCount());
        Serial.print(": push=");
        Serial.print(step.pushDistance);
        Serial.print("mm, angle=");
        Serial.print(step.bendAngle);
        Serial.print("deg, rot=");
        Serial.print(step.rotation);
        Serial.println("deg");
    }
    
}

void handleRunning() {
    // Execute program steps
    if (!programManager.isRunning()) {
        // Program complete
        Serial.println("[Run] Program complete");
        changeState(SystemState::IDLE);
        return;
    }
    
    // Get current step and execute
    BendStep* step = programManager.getCurrentStep();
    if (step != nullptr) {
        // Execute step based on program manager state
        programManager.executeStep(steppers);
    }
}

void handlePaused() {
    // Controlled from menu actions.
}

void handleEStop() {
    // Wait for E-STOP to be released
    if (!estopButton.isPressed()) {
        // Use encoder button to reset after E-STOP release.
        if (manualControl.isEncoderButtonPressed()) {
            Serial.println("[E-STOP] Reset - returning to IDLE");
            steppers.resetAllPositions();
            changeState(SystemState::IDLE);
        }
    }
}

void handleError() {
    // Error reset can be done from host command / menu extension.
}
