/*
 * ESP8266 SERVO42C UART Bridge
 * 
 * USB-UART passthrough for SERVO42C motor encoder feedback.
 * Uses Software Serial since ESP8266 has limited hardware UARTs.
 * 
 * Connections:
 *   USB Serial (115200 baud) <-> PC Python driver
 *   SoftwareSerial (38400 baud) <-> SERVO42C motors (TX/RX bus)
 * 
 * Pinout (NodeMCU/Wemos D1 Mini):
 *   D5 (GPIO14) = RX (connect to all SERVO42C TX pins in parallel)
 *   D6 (GPIO12) = TX (connect to all SERVO42C RX pins in parallel)
 *   GND = Common ground with 12V PSU
 */

#include <SoftwareSerial.h>

#define USB_BAUD 115200
#define SERVO_BAUD 38400

#define SERVO_RX D5  // GPIO14
#define SERVO_TX D6  // GPIO12

#define LED_PIN LED_BUILTIN
#define LED_BLINK_INTERVAL 500

SoftwareSerial ServoSerial(SERVO_RX, SERVO_TX);

unsigned long lastLedToggle = 0;
bool ledState = false;

void setup() {
    Serial.begin(USB_BAUD);
    ServoSerial.begin(SERVO_BAUD);
    
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH);  // LED off (active low on ESP8266)
    
    Serial.println();
    Serial.println("ESP8266 SERVO42C UART Bridge v1.0");
    Serial.println("USB: 115200 baud, SERVO: 38400 baud");
    Serial.println("SERVO RX: D5 (GPIO14), TX: D6 (GPIO12)");
    Serial.println("Ready.");
}

void loop() {
    bool activity = false;
    
    while (Serial.available()) {
        uint8_t byte = Serial.read();
        ServoSerial.write(byte);
        activity = true;
    }
    
    while (ServoSerial.available()) {
        uint8_t byte = ServoSerial.read();
        Serial.write(byte);
        activity = true;
    }
    
    unsigned long now = millis();
    
    if (activity) {
        digitalWrite(LED_PIN, LOW);  // LED on (active low)
        ledState = true;
        lastLedToggle = now;
    } else if (ledState && (now - lastLedToggle > 100)) {
        digitalWrite(LED_PIN, HIGH);  // LED off
        ledState = false;
    }
    
    if (!activity && (now - lastLedToggle > LED_BLINK_INTERVAL * 2)) {
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState ? LOW : HIGH);
        lastLedToggle = now;
    }
}
