#ifndef PROGRAM_MANAGER_H
#define PROGRAM_MANAGER_H

#include <Arduino.h>
#include <vector>
#include <SPIFFS.h>
#include <ArduinoJson.h>
#include "config.h"
#include "stepper_control.h"

class ProgramManager {
public:
    ProgramManager();
    
    void begin();
    
    // Program management
    bool hasProgram() const;
    int getStepCount() const;
    void clearProgram();
    
    // Step management
    void addStep(const BendStep& step);
    void removeStep(int index);
    BendStep* getStep(int index);
    const std::vector<BendStep>& getSteps() const { return _steps; }
    
    // Program execution
    void startProgram();
    void stopProgram();
    void pauseProgram();
    void resumeProgram();
    bool isRunning() const { return _running; }
    bool isPaused() const { return _paused; }
    int getCurrentStepIndex() const { return _currentStepIndex; }
    BendStep* getCurrentStep();
    void executeStep(StepperControl& steppers);
    
    // File operations
    bool saveProgram(const char* name);
    bool loadProgram(const char* name);
    bool deleteProgram(const char* name);
    std::vector<String> listPrograms();
    
    // Current program info
    const String& getProgramName() const { return _programName; }
    void setProgramName(const char* name) { _programName = name; }

private:
    std::vector<BendStep> _steps;
    String _programName;
    
    bool _running;
    bool _paused;
    int _currentStepIndex;
    
    enum class StepPhase {
        IDLE,
        PUSHING,
        BENDING,
        RETURNING,
        ROTATING,
        COMPLETE
    };
    StepPhase _stepPhase;
    
    bool initSPIFFS();
    String getProgramPath(const char* name);
};

extern ProgramManager programManager;

#endif // PROGRAM_MANAGER_H
