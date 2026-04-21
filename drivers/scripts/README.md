# Manuális diagnosztikai szkriptek (drivers/scripts)

Ezek a szkriptek **interaktív, kézi** diagnosztikai eszközök, amik
**közvetlenül** beszélnek a vezérlőkkel a soros porton — nem a bridge
serveren keresztül. Ezért:

- A bridge servert (`bridge_server.py` / `uvicorn bridge.app:app`) le kell
  állítani, mielőtt ezek a szkriptek futnak (különben "Resource busy").
- Csak fejlesztési / hibakeresési helyzetben kellenek; a normál működéshez
  a bridge REST/WebSocket API-ját használja a Node.js backend.

## Tartalom

| Fájl                    | Mit csinál                                           |
| ----------------------- | ---------------------------------------------------- |
| `coupling_test.py`      | Cross-axis kapcsolás vizsgálat + kalibráció (axis_scale) |
| `test_esp32_grbl.py`    | ESP32 GRBL 6-Axis vezérlő interaktív tesztje         |
| `test_robot.py`         | RobotArmDevice + kinematics interaktív validáció      |

## Futtatás

A szkriptek a parent dir-t (`drivers/`) a `sys.path`-ra teszik, így a
robot_arm_driver és társai betölthetők. A virtualenv-ből futtatva:

```bash
cd drivers/scripts
python3 coupling_test.py --port /dev/ttyUSB0
python3 test_esp32_grbl.py
python3 test_robot.py
```

A részletes opciókért futtasd `--help`-pel.
