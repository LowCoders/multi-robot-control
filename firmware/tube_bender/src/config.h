#ifndef CONFIG_H
#define CONFIG_H

// ============================================================================
// TUBE BENDER ESP32-S3 STANDALONE - Configuration
// ============================================================================

// ----------------------------------------------------------------------------
// VERSION
// ----------------------------------------------------------------------------
#define FIRMWARE_VERSION "1.0.0"
#define FIRMWARE_NAME "TubeBender"

// ----------------------------------------------------------------------------
// STEPPER MOTOR PINS
// ----------------------------------------------------------------------------
// Motor 1 - Push (Tolás)
#define PIN_STEP_PUSH   4
#define PIN_DIR_PUSH    5

// Motor 2 - Bend (Hajlítás)
#define PIN_STEP_BEND   6
#define PIN_DIR_BEND    7

// Motor 3 - Rotate (Forgatás)
#define PIN_STEP_ROT    15
#define PIN_DIR_ROT     16

// Common Enable (Active LOW)
#define PIN_ENABLE      17

// SERVO42C UART (monitoring / diagnostics)
#define PIN_SERVO_UART_RX  8
#define PIN_SERVO_UART_TX  18
#define SERVO_UART_BAUD    38400

// ----------------------------------------------------------------------------
// ANALOG INPUTS (ADC1)
// ----------------------------------------------------------------------------
#define PIN_JOY_X       1   // Joystick X axis (push direction)
#define PIN_JOY_Y       2   // Joystick Y axis (bend preview)

// ----------------------------------------------------------------------------
// DIGITAL INPUTS (Active LOW with internal PULLUP)
// ----------------------------------------------------------------------------
#define PIN_JOY_BTN     42  // Joystick button (execute step)
#define PIN_ENCODER_BTN 39  // Encoder button (menu select)
#define PIN_ESTOP       38  // E-STOP (emergency stop)

// ----------------------------------------------------------------------------
// DISPLAY PINS (UART)
// ----------------------------------------------------------------------------
// Display 1 - Status (Hardware UART2)
#define PIN_DISP1_RX    21
#define PIN_DISP1_TX    47

// Display 2 - Program (Software Serial)
#define PIN_DISP2_RX    10
#define PIN_DISP2_TX    9

// ----------------------------------------------------------------------------
// I2C - AS5600-M encoder
// ----------------------------------------------------------------------------
#define PIN_I2C_SDA         41
#define PIN_I2C_SCL         40
#define ENCODER_I2C_ADDR    0x36

// ----------------------------------------------------------------------------
// STEPPER CONFIGURATION
// ----------------------------------------------------------------------------
// Steps per revolution (1.8° motor with microstepping)
#define STEPS_PER_REV           200
#define MICROSTEPPING           16
#define STEPS_PER_REV_FULL      (STEPS_PER_REV * MICROSTEPPING)

// Steps per unit
#define STEPS_PER_MM_PUSH       80.0f   // For linear push axis
#define STEPS_PER_DEG_BEND      17.78f  // For bend axis (gear ratio dependent)
#define STEPS_PER_DEG_ROT       8.89f   // For rotation axis

// Speed limits (steps/sec)
#define MAX_SPEED_PUSH          2000
#define MAX_SPEED_BEND          1000
#define MAX_SPEED_ROT           1500

// Acceleration (steps/sec²)
#define ACCEL_PUSH              1000
#define ACCEL_BEND              500
#define ACCEL_ROT               800

// ----------------------------------------------------------------------------
// JOYSTICK CONFIGURATION
// ----------------------------------------------------------------------------
#define JOY_CENTER              2048    // ADC center value (12-bit)
#define JOY_DEADZONE            300     // Deadzone around center
#define JOY_MIN                 0
#define JOY_MAX                 4095
// Manual jog is allowed only while joystick button is held.
#define JOY_REQUIRE_BUTTON_FOR_JOG      1
// If both axes drift far from startup center for multiple cycles, treat input as floating.
#define JOY_FLOATING_DRIFT_THRESHOLD    1400
#define JOY_FLOATING_FILTER_COUNT       6

// Manual jog speed (steps/sec)
#define JOG_SPEED_MIN           100
#define JOG_SPEED_MAX           1500

// ----------------------------------------------------------------------------
// ENCODER CONFIGURATION (AS5600-M)
// ----------------------------------------------------------------------------
#define ENCODER_MIN_ANGLE       0       // Minimum bend angle (degrees)
#define ENCODER_MAX_ANGLE       180     // Maximum bend angle (degrees)

// ----------------------------------------------------------------------------
// BUTTON CONFIGURATION
// ----------------------------------------------------------------------------
#define DEBOUNCE_MS             50      // Button debounce time
#define LONG_PRESS_MS           1000    // Long press threshold

// ----------------------------------------------------------------------------
// DISPLAY CONFIGURATION
// ----------------------------------------------------------------------------
#define DISPLAY_BAUD            9600    // GM009605 baud rate
#define DISPLAY_UPDATE_MS       100     // Display refresh interval

// ----------------------------------------------------------------------------
// SERIAL PROTOCOL
// ----------------------------------------------------------------------------
#define SERIAL_BAUD             115200
#define JSON_BUFFER_SIZE        512

// ----------------------------------------------------------------------------
// SPIFFS CONFIGURATION
// ----------------------------------------------------------------------------
#define PROGRAMS_DIR            "/programs"
#define MAX_PROGRAM_STEPS       100
#define MAX_PROGRAM_NAME_LEN    32

// ----------------------------------------------------------------------------
// STATE MACHINE
// ----------------------------------------------------------------------------
enum class SystemState {
    INIT,
    IDLE,
    MANUAL_JOG,
    TEACHING,
    RUNNING,
    PAUSED,
    ESTOP,
    ERROR
};

// ----------------------------------------------------------------------------
// BEND STEP STRUCTURE
// ----------------------------------------------------------------------------
struct BendStep {
    float pushDistance;     // mm
    float bendAngle;        // degrees
    float rotation;         // degrees
};

#endif // CONFIG_H
