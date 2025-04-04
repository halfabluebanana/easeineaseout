#include <Stepper.h>

// Motor Configuration for 28BYJ-48
const int stepsPerRevolution = 2048;  // Steps for full rotation

// Motor Pin Definitions
const int motor1Pin1 = 8;
const int motor1Pin2 = 9;
const int motor1Pin3 = 10;
const int motor1Pin4 = 11;

const int motor2Pin1 = 4;
const int motor2Pin2 = 5;
const int motor2Pin3 = 6;
const int motor2Pin4 = 7;

// Stepper Motor Objects - using pin order that works
Stepper motor1(stepsPerRevolution, motor1Pin1, motor1Pin3, motor1Pin2, motor1Pin4);
Stepper motor2(stepsPerRevolution, motor2Pin1, motor2Pin3, motor2Pin2, motor2Pin4);

// Breath state
bool isInhaling = false;
bool lastBreathState = false;
bool isBreathing = false;
unsigned long lastBreathTime = 0;
const unsigned long breathTimeoutMs = 2000; // Pause motors if no breath data for 2 seconds

// Motor movement parameters
const int stepsPerMovement = 50;  // Steps to move per second of breath
const int stepsPerKeyPress = 100;  // Steps to move per key press

// Timing parameters
unsigned long lastMotorMoveTime = 0;
unsigned long lastStateChangeTime = 0;
const int motorUpdateInterval = 100; // Check for motor updates every 100ms

// Easing parameters
float currentEasingValue = 0.0;
float inhaleProgress = 0.0;  // 0.0 to 1.0 progress through inhale
float exhaleProgress = 0.0;  // 0.0 to 1.0 progress through exhale

// Breath timing
unsigned long inhaleStartTime = 0;
unsigned long exhaleStartTime = 0;
unsigned long lastInhaleDuration = 2000; // Default 2 seconds
unsigned long lastExhaleDuration = 2000; // Default 2 seconds

void setup() {
  Serial.begin(9600);
  
  // Use slower speed that we know works reliably
  motor1.setSpeed(10);  // 10 RPM
  motor2.setSpeed(10);  // 10 RPM
  
  Serial.println("Breath & Keyboard Motor Control with Easing");
  Serial.println("=========================================");
  Serial.println("Breath commands: R:1.50 (inhale), R:0.50 (exhale)");
  Serial.println("Keyboard commands:");
  Serial.println("  w - Move motor1 clockwise");
  Serial.println("  s - Move motor1 counterclockwise");
  Serial.println("  d - Move motor2 clockwise");
  Serial.println("  a - Move motor2 counterclockwise");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check for serial commands
  if (Serial.available() > 0) {
    // Read the incoming data
    char firstChar = Serial.peek();
    
    // Check if it's a keyboard command (single character)
    if (firstChar == 'w' || firstChar == 's' || firstChar == 'a' || firstChar == 'd') {
      char command = Serial.read();  // Read and remove the character
      handleKeyboardCommand(command);
    }
    // Otherwise it's likely a breath command (R:X.XX)
    else {
      String data = Serial.readStringUntil('\n');
      processBreathCommand(data);
      lastBreathTime = currentTime; // Update last breath time
      isBreathing = true;
    }
  }
  
  // Check for breath timeout (pause motors if no breath data received recently)
  if (isBreathing && (currentTime - lastBreathTime > breathTimeoutMs)) {
    Serial.println("Breath pause detected - stopping motors");
    isBreathing = false;
  }
  
  // Update motor movements based on breath state and timing
  if (isBreathing && (currentTime - lastMotorMoveTime >= motorUpdateInterval)) {
    updateMotorsWithEasing(currentTime);
    lastMotorMoveTime = currentTime;
  }
  
  // Small delay to prevent CPU overload
  delay(10);
}

void handleKeyboardCommand(char command) {
  switch (command) {
    case 'w':  // Up arrow - Motor1 clockwise
      Serial.println("Keyboard: Moving motor1 clockwise");
      motor1.step(stepsPerKeyPress);
      break;
    
    case 's':  // Down arrow - Motor1 counterclockwise
      Serial.println("Keyboard: Moving motor1 counterclockwise");
      motor1.step(-stepsPerKeyPress);
      break;
    
    case 'd':  // Right arrow - Motor2 clockwise
      Serial.println("Keyboard: Moving motor2 clockwise");
      motor2.step(stepsPerKeyPress);
      break;
    
    case 'a':  // Left arrow - Motor2 counterclockwise
      Serial.println("Keyboard: Moving motor2 counterclockwise");
      motor2.step(-stepsPerKeyPress);
      break;
  }
}

void processBreathCommand(String data) {
  // Echo received data
  Serial.print("Received: ");
  Serial.println(data);
  
  if (data.startsWith("R:")) {
    // Extract the ratio value
    float ratio = data.substring(2).toFloat();
    Serial.print("Parsed ratio: ");
    Serial.println(ratio, 3);
    
    unsigned long currentTime = millis();
    
    // Detect breath state changes
    bool previousState = isInhaling;
    isInhaling = (ratio > 1.1);  // Inhaling when ratio > 1.1
    
    // If breath state changed, update timing and progress
    if (isInhaling != lastBreathState) {
      Serial.println("Breath state changed!");
      
      // Record the time of the state change
      if (isInhaling) {
        // Starting a new inhale
        inhaleStartTime = currentTime;
        
        // If we have a valid exhale duration from the last exhale, save it
        if (lastBreathState == false && exhaleStartTime > 0) {
          lastExhaleDuration = currentTime - exhaleStartTime;
          Serial.print("Last exhale duration (ms): ");
          Serial.println(lastExhaleDuration);
        }
        
        // Reset inhale progress
        inhaleProgress = 0.0;
      } else {
        // Starting a new exhale
        exhaleStartTime = currentTime;
        
        // If we have a valid inhale duration from the last inhale, save it
        if (lastBreathState == true && inhaleStartTime > 0) {
          lastInhaleDuration = currentTime - inhaleStartTime;
          Serial.print("Last inhale duration (ms): ");
          Serial.println(lastInhaleDuration);
        }
        
        // Reset exhale progress
        exhaleProgress = 0.0;
      }
      
      lastStateChangeTime = currentTime;
      lastBreathState = isInhaling;
    }
  }
}

// Apply easing function to a value between 0.0 and 1.0
float easeInQuad(float t) {
  return t * t;
}

float easeOutQuad(float t) {
  return t * (2.0 - t);
}

void updateMotorsWithEasing(unsigned long currentTime) {
  // Calculate progress in the current breath phase
  if (isInhaling) {
    // Calculate progress during inhale (0.0 to 1.0)
    unsigned long timeInCurrentPhase = currentTime - inhaleStartTime;
    inhaleProgress = min(1.0, (float)timeInCurrentPhase / (float)lastInhaleDuration);
    
    // Apply easing function to get smoother movement
    float easedValue = easeInQuad(inhaleProgress);
    
    // Calculate steps to move based on time since last update
    int stepsToMove = (stepsPerMovement * motorUpdateInterval) / 1000.0;
    stepsToMove = max(1, stepsToMove); // Ensure at least 1 step
    
    // Apply easing to step count (more steps as we progress through the ease-in)
    int easedSteps = stepsToMove * easedValue * 2.0; // Multiply by 2 to get full range
    
    if (easedSteps > 0) {
      // For inhale: motor2 moves anticlockwise
      Serial.print("Inhale (");
      Serial.print(inhaleProgress * 100);
      Serial.print("%) - Moving motor2 anticlockwise ");
      Serial.print(easedSteps);
      Serial.println(" steps");
      motor2.step(-easedSteps);  // Negative for anticlockwise
    }
  } else {
    // Calculate progress through exhale (0.0 to 1.0)
    unsigned long timeInCurrentPhase = currentTime - exhaleStartTime;
    exhaleProgress = min(1.0, (float)timeInCurrentPhase / (float)lastExhaleDuration);
    
    // Apply easing function to get smoother movement
    float easedValue = easeOutQuad(exhaleProgress);
    
    // Calculate steps to move based on time since last update
    int stepsToMove = (stepsPerMovement * motorUpdateInterval) / 1000.0;
    stepsToMove = max(1, stepsToMove); // Ensure at least 1 step
    
    // Apply easing to step count (more steps at the beginning of the ease-out)
    int easedSteps = stepsToMove * easedValue * 2.0; // Multiply by 2 to get full range
    
    if (easedSteps > 0) {
      // For exhale: motor1 moves clockwise
      Serial.print("Exhale (");
      Serial.print(exhaleProgress * 100);
      Serial.print("%) - Moving motor1 clockwise ");
      Serial.print(easedSteps);
      Serial.println(" steps");
      motor1.step(easedSteps);   // Positive for clockwise
    }
  }
} 