// Interactive A-axis pin finder for CNC Shield v3
// Send '1', '2', '3', '4' via serial to try different pin combinations

#include <Arduino.h>

// All possible A-axis pin combinations on CNC Shield clones
const int pinConfigs[][2] = {
  {A0, A1},    // Config 1: Most common clone
  {12, 13},    // Config 2: Some clones (D12/D13)
  {A3, A4},    // Config 3: Alternative
  {A4, A5},    // Config 4: I2C pins (rare)
};
const char* configNames[] = {
  "A0/A1 (Analog 0,1)",
  "D12/D13",
  "A3/A4 (Analog 3,4)",
  "A4/A5 (Analog 4,5)"
};

int currentConfig = 0;
bool dir = false;
int stepPin, dirPin;

void setupPins(int config) {
  stepPin = pinConfigs[config][0];
  dirPin = pinConfigs[config][1];
  pinMode(stepPin, OUTPUT);
  pinMode(dirPin, OUTPUT);
  digitalWrite(dirPin, LOW);
  Serial.print("\n>>> Config "); Serial.print(config + 1);
  Serial.print(": "); Serial.println(configNames[config]);
  Serial.print("    Step="); Serial.print(stepPin);
  Serial.print(", Dir="); Serial.println(dirPin);
}

void runMotor() {
  Serial.println("Running 400 steps...");
  for (int i = 0; i < 400; i++) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(800);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(800);
  }
  Serial.println("Done. Did motor move? Send 1-4 to try other configs, 'r' to repeat.");
}

void setup() {
  // Enable steppers (D8)
  pinMode(8, OUTPUT);
  digitalWrite(8, LOW);
  
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== CNC Shield A-axis Pin Finder ===");
  Serial.println("Commands:");
  Serial.println("  1 = A0/A1");
  Serial.println("  2 = D12/D13");
  Serial.println("  3 = A3/A4");
  Serial.println("  4 = A4/A5");
  Serial.println("  r = repeat current config");
  Serial.println("  d = toggle direction");
  Serial.println("\nStarting with config 1...");
  
  setupPins(0);
  runMotor();
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c >= '1' && c <= '4') {
      currentConfig = c - '1';
      setupPins(currentConfig);
      runMotor();
    } else if (c == 'r' || c == 'R') {
      runMotor();
    } else if (c == 'd' || c == 'D') {
      dir = !dir;
      digitalWrite(dirPin, dir ? HIGH : LOW);
      Serial.print("Direction: "); Serial.println(dir ? "REVERSE" : "FORWARD");
      runMotor();
    }
  }
}
