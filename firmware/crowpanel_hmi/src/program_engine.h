#pragma once

#include "grbl_client.h"
#include "models.h"

class ProgramEngine {
public:
  enum class State {
    Stopped,
    Running,
    Paused
  };

  void start(const ProgramData &program);
  void stop(GrblClient &client);
  void pause(GrblClient &client);
  void resume(GrblClient &client);
  void update(GrblClient &client, const std::vector<AxisConfig> &axes_cfg);

  State state() const { return _state; }
  size_t currentStep() const { return _current_step; }
  size_t totalSteps() const { return _program.steps.size(); }
  const ProgramStep *activeStep() const;
  const String &programName() const { return _program.name; }

private:
  bool queueStep(const ProgramStep &step, GrblClient &client, const std::vector<AxisConfig> &axes_cfg);

  ProgramData _program;
  State _state = State::Stopped;
  size_t _current_step = 0;
};
