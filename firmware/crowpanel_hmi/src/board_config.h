#pragma once

// CrowPanel 1.28" display pins (Elecrow reference design).
#define LCD_PIN_SCLK 10
#define LCD_PIN_MOSI 11
#define LCD_PIN_DC 3
#define LCD_PIN_CS 9
#define LCD_PIN_RST 14
#define LCD_PIN_BL 46
#define POWER_LIGHT_PIN 40

// Rotary encoder + switch.
#define ENCODER_PIN_A 45
#define ENCODER_PIN_B 42
#define ENCODER_PIN_SW 41

// Capacitive touch (CST816D) pins.
#define TOUCH_I2C_SDA_PIN 6
#define TOUCH_I2C_SCL_PIN 7
#define TOUCH_INT_PIN 5
#define TOUCH_RST_PIN 13

// grblHAL UART link pins on the CrowPanel side.
// Update these if your cable/board variant uses different UART pins.
#ifndef GRBL_UART_RX_PIN
#define GRBL_UART_RX_PIN 44
#endif
#ifndef GRBL_UART_TX_PIN
#define GRBL_UART_TX_PIN 43
#endif

#define GRBL_UART_BAUD 115200
