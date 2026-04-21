#include "program_engine.h"

void ProgramEngine::start(const ProgramData &program) {
  _program = program;
  _current_step = 0;
  _state = _program.steps.empty() ? State::Stopped : State::Running;
}

void ProgramEngine::stop(GrblClient &client) {
  client.sendRealtime(0x18);  // reset
  _state = State::Stopped;
  _current_step = 0;
}

void ProgramEngine::pause(GrblClient &client) {
  if (_state != State::Running) {
    return;
  }
  client.sendRealtime('!');  // feed hold
  _state = State::Paused;
}

void ProgramEngine::resume(GrblClient &client) {
  if (_state != State::Paused) {
    return;
  }
  client.sendRealtime('~');  // cycle start
  _state = State::Running;
}

const ProgramStep *ProgramEngine::activeStep() const {
  if (_current_step == 0 || _current_step > _program.steps.size()) {
    return nullptr;
  }
  return &_program.steps[_current_step - 1];
}

bool ProgramEngine::queueStep(const ProgramStep &step, GrblClient &client, const std::vector<AxisConfig> &axes_cfg) {
  // Extras run before the motion so the user can e.g. open a gripper or
  // turn on a laser while the previous move is still settling.  Failure on
  // any extra line leaves the engine paused so the operator can investigate.
  for (const ExtraCommand &ex : step.extras) {
    for (const String &extraLine : ex.lines) {
      if (extraLine.isEmpty()) continue;
      if (!client.queueLine(extraLine)) return false;
    }
  }

  String line = "G1";
  const bool incremental = (step.mode == "step");
  for (size_t i = 0; i < axes_cfg.size(); i++) {
    float value = i < step.axes.size() ? step.axes[i] : 0.0f;
    // In incremental (G91 / "step") mode a 0.0 delta means "no movement" on
    // this axis, so skip it.  In absolute (G90 / "pos") mode the axis word
    // must always be emitted - X0 means "move to absolute zero", which is a
    // legitimate target.
    if (incremental && value == 0.0f) {
      continue;
    }
    line += " ";
    line += axes_cfg[i].name;
    line += String(value, 3);
  }
  line += " F";
  line += String(step.feed > 0 ? step.feed : 600.0f, 1);

  if (incremental) {
    return client.queueLine("G91") && client.queueLine(line) && client.queueLine("G90");
  }
  return client.queueLine("G90") && client.queueLine(line);
}

void ProgramEngine::update(GrblClient &client, const std::vector<AxisConfig> &axes_cfg) {
  if (_state != State::Running) {
    return;
  }
  if (!client.isIdle()) {
    return;
  }

  if (_current_step >= _program.steps.size()) {
    _state = State::Stopped;
    return;
  }

  if (queueStep(_program.steps[_current_step], client, axes_cfg)) {
    _current_step++;
  } else {
    _state = State::Paused;
  }
}
