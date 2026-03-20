#ifndef MENU_SYSTEM_H
#define MENU_SYSTEM_H

#include <Arduino.h>
#include "config.h"

enum class MenuAction {
    NONE,
    ENTER_TEACH,
    EXIT_TEACH,
    START_PROGRAM,
    PAUSE_PROGRAM,
    RESUME_PROGRAM,
    STOP_PROGRAM,
    CLEAR_PROGRAM,
    HOME_ALL
};

class MenuSystem {
public:
    MenuSystem();

    void begin();
    void update(float encoderAngle, bool selectPressed, SystemState machineState);

    MenuAction consumeAction();
    const char* getSelectedLabel() const;
    int getSelectedIndex() const { return _selectedIndex; }
    int getItemCount() const { return _itemCount; }

private:
    static constexpr int MAX_ITEMS = 6;

    const char* _items[MAX_ITEMS];
    int _itemCount;
    int _selectedIndex;
    MenuAction _pendingAction;

    void buildMenu(SystemState machineState);
    MenuAction mapSelectionToAction(SystemState machineState, int index) const;
};

extern MenuSystem menuSystem;

#endif // MENU_SYSTEM_H
