#ifndef STEPPER_CONTROL_H
#define STEPPER_CONTROL_H

#include <AccelStepper.h>
#include "config.h"

class StepperControl {
public:
    StepperControl();
    
    void begin();
    void enable();
    void disable();
    bool isEnabled() const { return _enabled; }
    
    // Position control
    void movePushTo(float mm);
    void moveBendTo(float degrees);
    void moveRotateTo(float degrees);
    
    void movePushRelative(float mm);
    void moveBendRelative(float degrees);
    void moveRotateRelative(float degrees);
    
    // Speed control (for joystick)
    void setPushSpeed(float stepsPerSec);
    void setBendSpeed(float stepsPerSec);
    void setRotateSpeed(float stepsPerSec);
    
    // Run motors (call in loop)
    void run();
    void runSpeed();  // For constant speed mode
    
    // Status
    bool isMoving();
    bool isPushMoving();
    bool isBendMoving();
    bool isRotateMoving();
    
    // Current position
    float getPushPosition();    // mm
    float getBendPosition();    // degrees
    float getRotatePosition();  // degrees
    
    // Reset position to zero
    void resetPushPosition();
    void resetBendPosition();
    void resetRotatePosition();
    void resetAllPositions();
    
    // Emergency stop
    void emergencyStop();
    
    // Direct access to steppers (for advanced use)
    AccelStepper& getPushStepper() { return _stepperPush; }
    AccelStepper& getBendStepper() { return _stepperBend; }
    AccelStepper& getRotateStepper() { return _stepperRot; }

private:
    AccelStepper _stepperPush;
    AccelStepper _stepperBend;
    AccelStepper _stepperRot;
    
    bool _enabled;
    bool _speedMode;  // true = constant speed, false = position control
    
    long mmToSteps(float mm) const;
    long bendDegreesToSteps(float deg) const;
    long rotDegreesToSteps(float deg) const;
    
    float stepsToMm(long steps) const;
    float stepsToBendDegrees(long steps) const;
    float stepsToRotDegrees(long steps) const;
};

extern StepperControl steppers;

#endif // STEPPER_CONTROL_H
