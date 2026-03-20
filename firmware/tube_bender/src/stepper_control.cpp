#include "stepper_control.h"

StepperControl steppers;

StepperControl::StepperControl()
    : _stepperPush(AccelStepper::DRIVER, PIN_STEP_PUSH, PIN_DIR_PUSH)
    , _stepperBend(AccelStepper::DRIVER, PIN_STEP_BEND, PIN_DIR_BEND)
    , _stepperRot(AccelStepper::DRIVER, PIN_STEP_ROT, PIN_DIR_ROT)
    , _enabled(false)
    , _speedMode(false)
{
}

void StepperControl::begin() {
    // Configure enable pin
    pinMode(PIN_ENABLE, OUTPUT);
    disable();
    
    // Configure push stepper
    _stepperPush.setMaxSpeed(MAX_SPEED_PUSH);
    _stepperPush.setAcceleration(ACCEL_PUSH);
    _stepperPush.setCurrentPosition(0);
    
    // Configure bend stepper
    _stepperBend.setMaxSpeed(MAX_SPEED_BEND);
    _stepperBend.setAcceleration(ACCEL_BEND);
    _stepperBend.setCurrentPosition(0);
    
    // Configure rotate stepper
    _stepperRot.setMaxSpeed(MAX_SPEED_ROT);
    _stepperRot.setAcceleration(ACCEL_ROT);
    _stepperRot.setCurrentPosition(0);
    
    Serial.println("[Stepper] Initialized");
}

void StepperControl::enable() {
    digitalWrite(PIN_ENABLE, LOW);  // Active LOW
    _enabled = true;
    Serial.println("[Stepper] Enabled");
}

void StepperControl::disable() {
    digitalWrite(PIN_ENABLE, HIGH);  // Inactive HIGH
    _enabled = false;
    _speedMode = false;
    Serial.println("[Stepper] Disabled");
}

// Position control
void StepperControl::movePushTo(float mm) {
    _speedMode = false;
    _stepperPush.moveTo(mmToSteps(mm));
}

void StepperControl::moveBendTo(float degrees) {
    _speedMode = false;
    _stepperBend.moveTo(bendDegreesToSteps(degrees));
}

void StepperControl::moveRotateTo(float degrees) {
    _speedMode = false;
    _stepperRot.moveTo(rotDegreesToSteps(degrees));
}

void StepperControl::movePushRelative(float mm) {
    _speedMode = false;
    _stepperPush.move(mmToSteps(mm));
}

void StepperControl::moveBendRelative(float degrees) {
    _speedMode = false;
    _stepperBend.move(bendDegreesToSteps(degrees));
}

void StepperControl::moveRotateRelative(float degrees) {
    _speedMode = false;
    _stepperRot.move(rotDegreesToSteps(degrees));
}

// Speed control
void StepperControl::setPushSpeed(float stepsPerSec) {
    _speedMode = true;
    _stepperPush.setSpeed(stepsPerSec);
}

void StepperControl::setBendSpeed(float stepsPerSec) {
    _speedMode = true;
    _stepperBend.setSpeed(stepsPerSec);
}

void StepperControl::setRotateSpeed(float stepsPerSec) {
    _speedMode = true;
    _stepperRot.setSpeed(stepsPerSec);
}

// Run motors
void StepperControl::run() {
    if (!_enabled) return;
    
    _stepperPush.run();
    _stepperBend.run();
    _stepperRot.run();
}

void StepperControl::runSpeed() {
    if (!_enabled) return;
    
    _stepperPush.runSpeed();
    _stepperBend.runSpeed();
    _stepperRot.runSpeed();
}

// Status
bool StepperControl::isMoving() {
    return isPushMoving() || isBendMoving() || isRotateMoving();
}

bool StepperControl::isPushMoving() {
    return _stepperPush.distanceToGo() != 0;
}

bool StepperControl::isBendMoving() {
    return _stepperBend.distanceToGo() != 0;
}

bool StepperControl::isRotateMoving() {
    return _stepperRot.distanceToGo() != 0;
}

// Current position
float StepperControl::getPushPosition() {
    return stepsToMm(_stepperPush.currentPosition());
}

float StepperControl::getBendPosition() {
    return stepsToBendDegrees(_stepperBend.currentPosition());
}

float StepperControl::getRotatePosition() {
    return stepsToRotDegrees(_stepperRot.currentPosition());
}

// Reset position
void StepperControl::resetPushPosition() {
    _stepperPush.setCurrentPosition(0);
}

void StepperControl::resetBendPosition() {
    _stepperBend.setCurrentPosition(0);
}

void StepperControl::resetRotatePosition() {
    _stepperRot.setCurrentPosition(0);
}

void StepperControl::resetAllPositions() {
    resetPushPosition();
    resetBendPosition();
    resetRotatePosition();
    Serial.println("[Stepper] All positions reset to zero");
}

// Emergency stop
void StepperControl::emergencyStop() {
    _stepperPush.stop();
    _stepperBend.stop();
    _stepperRot.stop();
    
    _stepperPush.setCurrentPosition(_stepperPush.currentPosition());
    _stepperBend.setCurrentPosition(_stepperBend.currentPosition());
    _stepperRot.setCurrentPosition(_stepperRot.currentPosition());
    
    _speedMode = false;
    Serial.println("[Stepper] EMERGENCY STOP!");
}

// Unit conversion helpers
long StepperControl::mmToSteps(float mm) const {
    return (long)(mm * STEPS_PER_MM_PUSH);
}

long StepperControl::bendDegreesToSteps(float deg) const {
    return (long)(deg * STEPS_PER_DEG_BEND);
}

long StepperControl::rotDegreesToSteps(float deg) const {
    return (long)(deg * STEPS_PER_DEG_ROT);
}

float StepperControl::stepsToMm(long steps) const {
    return (float)steps / STEPS_PER_MM_PUSH;
}

float StepperControl::stepsToBendDegrees(long steps) const {
    return (float)steps / STEPS_PER_DEG_BEND;
}

float StepperControl::stepsToRotDegrees(long steps) const {
    return (float)steps / STEPS_PER_DEG_ROT;
}
