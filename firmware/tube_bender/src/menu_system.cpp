#include "menu_system.h"

MenuSystem menuSystem;

MenuSystem::MenuSystem()
    : _itemCount(0)
    , _selectedIndex(0)
    , _pendingAction(MenuAction::NONE)
{
}

void MenuSystem::begin() {
    buildMenu(SystemState::IDLE);
}

void MenuSystem::update(float encoderAngle, bool selectPressed, SystemState machineState) {
    buildMenu(machineState);

    if (_itemCount <= 0) {
        _selectedIndex = 0;
        return;
    }

    float normalized = encoderAngle;
    while (normalized < 0.0f) normalized += 360.0f;
    while (normalized >= 360.0f) normalized -= 360.0f;

    const float sector = 360.0f / static_cast<float>(_itemCount);
    int newIndex = static_cast<int>(normalized / sector);
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= _itemCount) newIndex = _itemCount - 1;
    _selectedIndex = newIndex;

    if (selectPressed) {
        _pendingAction = mapSelectionToAction(machineState, _selectedIndex);
    }
}

MenuAction MenuSystem::consumeAction() {
    MenuAction action = _pendingAction;
    _pendingAction = MenuAction::NONE;
    return action;
}

const char* MenuSystem::getSelectedLabel() const {
    if (_selectedIndex < 0 || _selectedIndex >= _itemCount) {
        return "-";
    }
    return _items[_selectedIndex];
}

void MenuSystem::buildMenu(SystemState machineState) {
    if (machineState == SystemState::RUNNING) {
        _items[0] = "Pause";
        _items[1] = "Stop";
        _itemCount = 2;
    } else if (machineState == SystemState::PAUSED) {
        _items[0] = "Resume";
        _items[1] = "Stop";
        _itemCount = 2;
    } else if (machineState == SystemState::TEACHING) {
        _items[0] = "Exit Teach";
        _items[1] = "Clear Program";
        _items[2] = "Home Zero";
        _itemCount = 3;
    } else {
        _items[0] = "Run Program";
        _items[1] = "Teach Mode";
        _items[2] = "Clear Program";
        _items[3] = "Home Zero";
        _itemCount = 4;
    }

    if (_selectedIndex >= _itemCount) {
        _selectedIndex = _itemCount - 1;
    }
    if (_selectedIndex < 0) {
        _selectedIndex = 0;
    }
}

MenuAction MenuSystem::mapSelectionToAction(SystemState machineState, int index) const {
    if (machineState == SystemState::RUNNING) {
        if (index == 0) return MenuAction::PAUSE_PROGRAM;
        if (index == 1) return MenuAction::STOP_PROGRAM;
    } else if (machineState == SystemState::PAUSED) {
        if (index == 0) return MenuAction::RESUME_PROGRAM;
        if (index == 1) return MenuAction::STOP_PROGRAM;
    } else if (machineState == SystemState::TEACHING) {
        if (index == 0) return MenuAction::EXIT_TEACH;
        if (index == 1) return MenuAction::CLEAR_PROGRAM;
        if (index == 2) return MenuAction::HOME_ALL;
    } else {
        if (index == 0) return MenuAction::START_PROGRAM;
        if (index == 1) return MenuAction::ENTER_TEACH;
        if (index == 2) return MenuAction::CLEAR_PROGRAM;
        if (index == 3) return MenuAction::HOME_ALL;
    }

    return MenuAction::NONE;
}
