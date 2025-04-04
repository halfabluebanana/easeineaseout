// DOM Elements
let canvas, ctx;
let width, height;

// Audio processing
let audioContext;
let microphone;
let analyser;
let dataArray;
let micInitialized = false;

// Breath data
let breathHistory = [];
const maxHistoryPoints = 100;
let isInhaling = false;
let breathCycles = [];
let lastBreathValue = 0;
let breathThreshold = 8;  // Increased from 5 to 8 to reduce sensitivity to exhale sounds
let smoothedValue = 0;
let lastStateChangeTime = 0;
let stateChangeDelay = 1000; // 1 second minimum delay between state changes

// Smoothed data arrays
let smoothedHistory = [];
let superSmoothedHistory = [];

// Easing function visualization
let easingPoints = [];
let currentEasingType = 'easeIn';  // 'easeIn' or 'easeOut'

// Serial communication
let port;
let serialWriter;
let serialConnected = false;
let lastSentRatio = 1.0;

// Visualization parameters
let waveColor = '#3498db';         // Original breath wave
let smoothedColor = '#2ecc71';     // First smoothed wave
let superSmoothedColor = '#f39c12'; // Second super-smoothed wave
let easingColor = '#e74c3c';       // Easing function visualization
let waveAmplitude = 0.4;
let currentEasing = 1.0;

// Keyboard control elements
let upKey, downKey, leftKey, rightKey;
let breathTab, keyboardTab;
let modeToggle;

// Set up the page
window.addEventListener('load', setup);

function setup() {
  // Create canvas
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  
  // Set canvas size
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  // Setup event listeners for breath control
  document.getElementById('micAccessBtn').addEventListener('click', initializeMicrophone);
  document.getElementById('connectBtn').addEventListener('click', connectToArduino);
  
  // Setup toggle switch for mode selection
  setupModeToggle();
  
  // Setup keyboard control elements
  setupKeyboardControls();
  
  // Initialize easing points
  generateEasingPoints('easeIn');
  
  // Start animation loop
  requestAnimationFrame(draw);
}

function setupModeToggle() {
  modeToggle = document.getElementById('modeToggle');
  breathTab = document.getElementById('breathTab');
  keyboardTab = document.getElementById('keyboardTab');
  
  if (modeToggle) {
    modeToggle.addEventListener('change', function() {
      if (this.checked) {
        // Keyboard mode
        breathTab.classList.add('hidden');
        keyboardTab.classList.remove('hidden');
      } else {
        // Breath mode
        breathTab.classList.remove('hidden');
        keyboardTab.classList.add('hidden');
      }
    });
  }
}

function setupKeyboardControls() {
  // Get keyboard control elements
  upKey = document.getElementById('upKey');
  downKey = document.getElementById('downKey');
  leftKey = document.getElementById('leftKey');
  rightKey = document.getElementById('rightKey');
  
  // Add click listeners for on-screen buttons
  upKey.addEventListener('click', () => {
    activateKey(upKey);
    sendKeyCommand('w');
  });
  
  downKey.addEventListener('click', () => {
    activateKey(downKey);
    sendKeyCommand('s');
  });
  
  leftKey.addEventListener('click', () => {
    activateKey(leftKey);
    sendKeyCommand('a');
  });
  
  rightKey.addEventListener('click', () => {
    activateKey(rightKey);
    sendKeyCommand('d');
  });
  
  // Add keyboard event listener
  document.addEventListener('keydown', handleKeyPress);
}

function activateKey(keyElement) {
  keyElement.classList.add('active');
  setTimeout(() => {
    keyElement.classList.remove('active');
  }, 200);
}

function handleKeyPress(event) {
  let command = '';
  let keyElement = null;
  
  switch (event.key) {
    case 'ArrowUp':
    case 'w':
      command = 'w';
      keyElement = upKey;
      break;
    case 'ArrowDown':
    case 's':
      command = 's';
      keyElement = downKey;
      break;
    case 'ArrowLeft':
    case 'a':
      command = 'a';
      keyElement = leftKey;
      break;
    case 'ArrowRight':
    case 'd':
      command = 'd';
      keyElement = rightKey;
      break;
  }
  
  if (command && keyElement) {
    activateKey(keyElement);
    sendKeyCommand(command);
    
    // Prevent default action (page scrolling)
    event.preventDefault();
  }
}

async function sendKeyCommand(command) {
  if (!serialConnected || !serialWriter) {
    console.log('Not connected to Arduino');
    return;
  }
  
  try {
    await serialWriter.write(new TextEncoder().encode(command));
    console.log(`Sent key command: ${command}`);
  } catch (error) {
    console.error('Error sending key command:', error);
    handleDisconnection();
  }
}

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
}

function initializeMicrophone() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      microphone = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      microphone.connect(analyser);
      
      document.getElementById('micAccessBtn').textContent = 'Microphone Active';
      document.getElementById('micAccessBtn').disabled = true;
      document.getElementById('instructions').style.display = 'block';
      
      processAudioData();
    })
    .catch(error => {
      console.error("Microphone access error:", error);
      alert("Error accessing microphone: " + error.message);
    });
}

function connectToArduino() {
  // Specific filter for your Arduino Nano 33 IoT
  const filters = [
    { 
      usbVendorId: 0x2341,  // 9025
      usbProductId: 0x8057  // 32855
    }
  ];

  console.log("Attempting to connect to Arduino Nano 33 IoT...");
  
  navigator.serial.requestPort({ filters })
    .then(selectedPort => {
      console.log("Port selected:", selectedPort.getInfo());
      port = selectedPort;
      return port.open({ 
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none"
      });
    })
    .then(() => {
      console.log("Port opened successfully");
      serialWriter = port.writable.getWriter();
      serialConnected = true;
      
      // Update UI
      document.getElementById('connectBtn').textContent = 'Connected';
      document.getElementById('connectBtn').disabled = true;
      document.getElementById('connectionStatus').innerHTML = 
        '<span class="status connected"></span> Connected';
      
      // Set up reader to receive Arduino messages
      setupArduinoReader();
    })
    .catch(error => {
      console.error("Connection error:", error);
      document.getElementById('connectBtn').textContent = 'Connection Failed. Try Again';
      document.getElementById('connectionStatus').innerHTML = 
        '<span class="status disconnected"></span> Error: ' + error.message;
    });
}

function setupArduinoReader() {
  if (!port) return;
  
  const reader = port.readable.getReader();
  
  // Listen for messages from Arduino
  const readLoop = async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          console.log("Arduino disconnected");
          reader.releaseLock();
          handleDisconnection();
          break;
        }
        
        // Display received message from Arduino
        const message = new TextDecoder().decode(value);
        console.log("Arduino says:", message);
      }
    } catch (error) {
      console.error("Error reading from Arduino:", error);
      handleDisconnection();
    } finally {
      reader.releaseLock();
    }
  };
  
  readLoop();
}

function handleDisconnection() {
  serialConnected = false;
  document.getElementById('connectBtn').disabled = false;
  document.getElementById('connectBtn').textContent = 'Reconnect to Arduino';
  document.getElementById('connectionStatus').innerHTML = 
    '<span class="status disconnected"></span> Disconnected';
}

function processAudioData() {
  analyser.getByteFrequencyData(dataArray);
  
  let breathSum = 0;
  for (let i = 0; i < 10; i++) {
    breathSum += dataArray[i];
  }
  
  const rawBreathValue = breathSum / 10;
  smoothedValue = smoothedValue * 0.8 + rawBreathValue * 0.2;
  
  processBreathData(smoothedValue);
  
  requestAnimationFrame(processAudioData);
}

function processBreathData(value) {
  // Add new breath data
  breathHistory.push(value);
  
  // Keep history limited
  if (breathHistory.length > maxHistoryPoints) {
    breathHistory.shift();
  }
  
  // Create smoothed data
  // First level smoothing - moderate
  let firstSmoothedValue = 0;
  if (smoothedHistory.length > 0) {
    // Stronger smoothing (0.9/0.1 ratio)
    firstSmoothedValue = smoothedHistory[smoothedHistory.length - 1] * 0.9 + value * 0.1;
  } else {
    firstSmoothedValue = value;
  }
  smoothedHistory.push(firstSmoothedValue);
  
  // Keep smoothed history limited
  if (smoothedHistory.length > maxHistoryPoints) {
    smoothedHistory.shift();
  }
  
  // Second level super-smoothing - very strong, bandsaw-like
  let superSmoothedValue = 0;
  if (superSmoothedHistory.length > 0) {
    // Even stronger smoothing (0.95/0.05 ratio)
    superSmoothedValue = superSmoothedHistory[superSmoothedHistory.length - 1] * 0.95 + firstSmoothedValue * 0.05;
  } else {
    superSmoothedValue = firstSmoothedValue;
  }
  superSmoothedHistory.push(superSmoothedValue);
  
  // Keep super-smoothed history limited
  if (superSmoothedHistory.length > maxHistoryPoints) {
    superSmoothedHistory.shift();
  }
  
  // Calculate derivative - direction of change
  let isIncreasing = false;
  if (superSmoothedHistory.length >= 3) {
    // Look at the direction over the last few samples to detect trend
    const lastThree = superSmoothedHistory.slice(-3);
    isIncreasing = lastThree[2] > lastThree[0];
  }
  
  // Get current time to enforce minimum delay between state changes
  const now = Date.now();
  const timeSinceLastChange = now - lastStateChangeTime;
  
  // Detect inhale/exhale transitions with minimum delay between changes
  if (timeSinceLastChange >= stateChangeDelay) {
    // Check for threshold crossing AND direction change for more reliable detection
    if ((superSmoothedValue > lastBreathValue + breathThreshold || isIncreasing) && !isInhaling) {
      console.log("TRANSITION TO INHALE DETECTED!");
      console.log("Value change:", superSmoothedValue - lastBreathValue, "Direction:", isIncreasing ? "UP" : "DOWN");
      
      isInhaling = true;
      lastStateChangeTime = now;
      
      if (breathCycles.length > 0) {
        const lastCycle = breathCycles[breathCycles.length - 1];
        lastCycle.exhaleEnd = now;
        lastCycle.exhaleLength = lastCycle.exhaleEnd - lastCycle.exhaleStart;
        
        // Calculate and log the real-time ratio for debugging
        if (lastCycle.inhaleLength > 0) {
          console.log("Real-time ratio:", 
            (lastCycle.inhaleLength / (lastCycle.exhaleLength || 1)).toFixed(2));
        }
      }
      
      breathCycles.push({
        inhaleStart: now,
        inhaleLength: 0,
        exhaleLength: 0
      });
      
      // Send breath state to Arduino when changing to inhale
      sendDataToArduino(1.5); // Value > 1.1 indicates inhaling
      
      // Update easing visualization
      currentEasingType = 'easeIn';
      generateEasingPoints('easeIn');
    } else if ((superSmoothedValue < lastBreathValue - (breathThreshold * 0.7) || !isIncreasing) && isInhaling) {
      // Reduced threshold for exhale detection since exhales are more pronounced
      console.log("TRANSITION TO EXHALE DETECTED!");
      console.log("Value change:", superSmoothedValue - lastBreathValue, "Direction:", isIncreasing ? "UP" : "DOWN");
      
      isInhaling = false;
      lastStateChangeTime = now;
      
      if (breathCycles.length > 0) {
        const lastCycle = breathCycles[breathCycles.length - 1];
        lastCycle.inhaleEnd = now;
        lastCycle.inhaleLength = lastCycle.inhaleEnd - lastCycle.inhaleStart;
        lastCycle.exhaleStart = now;
        
        // Calculate and log the real-time ratio for debugging
        if (lastCycle.inhaleLength > 0 && lastCycle.exhaleLength > 0) {
          console.log("Real-time ratio:", 
            (lastCycle.inhaleLength / (lastCycle.exhaleLength || 1)).toFixed(2));
        }
      }
      
      // Send breath state to Arduino when changing to exhale
      sendDataToArduino(0.5); // Value < 0.9 indicates exhaling
      
      // Update easing visualization
      currentEasingType = 'easeOut';
      generateEasingPoints('easeOut');
    }
  }
  
  lastBreathValue = superSmoothedValue;
  
  // Keep only recent breath cycles
  if (breathCycles.length > 5) {
    breathCycles.shift();
  }
  
  // Update the ratio display continuously
  updateInhaleExhaleRatio();
}

// Generate points for easing curve visualization
function generateEasingPoints(easingType) {
  easingPoints = [];
  
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    let y;
    
    if (easingType === 'easeIn') {
      // Ease-in (quadratic): slow start, fast end
      y = t * t;
    } else {
      // Ease-out (quadratic): fast start, slow end
      y = t * (2 - t);
    }
    
    easingPoints.push({ t, y });
  }
}

// Easing functions
function easeInQuad(t) {
  return t * t;
}

function easeOutQuad(t) {
  return t * (2 - t);
}

function draw() {
  // Clear canvas
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  
  // Draw the breath data waves and easing function in rows
  drawAllRows();
  
  // Continue animation loop
  requestAnimationFrame(draw);
}

function drawAllRows() {
  if (breathHistory.length === 0) return;
  
  // Calculate row heights - now with 5 rows (4 graphs + 1 for state indicator)
  const rowHeight = height / 5;
  
  // Get individual max values for better scaling within each row
  const maxRawValue = Math.max(...breathHistory, 20);
  const maxSmoothedValue = Math.max(...smoothedHistory, 20);
  const maxSuperSmoothedValue = Math.max(...superSmoothedHistory, 20);
  
  // Draw the original breath wave (top row)
  drawWaveInRow(breathHistory, waveColor, maxRawValue, rowHeight * 0.5, rowHeight);
  
  // Draw the first smoothed wave (second row)
  drawWaveInRow(smoothedHistory, smoothedColor, maxSmoothedValue, rowHeight * 1.5, rowHeight);
  
  // Draw the super-smoothed bandsaw-like wave (third row)
  drawWaveInRow(superSmoothedHistory, superSmoothedColor, maxSuperSmoothedValue, rowHeight * 2.5, rowHeight);
  
  // Draw the easing function visualization (fourth row)
  drawEasingCurve(rowHeight * 3.5, rowHeight);
  
  // Add row labels
  ctx.fillStyle = '#fff';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  
  ctx.fillText('Raw Breath Data', 20, rowHeight * 0.2);
  ctx.fillText('Smoothed Data', 20, rowHeight * 1.2);
  ctx.fillText('Super-Smoothed Data', 20, rowHeight * 2.2);
  ctx.fillText(`Easing Function (${currentEasingType === 'easeIn' ? 'Ease In' : 'Ease Out'})`, 20, rowHeight * 3.2);
  
  // Draw horizontal separation lines between rows
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(0, rowHeight * i);
    ctx.lineTo(width, rowHeight * i);
    ctx.stroke();
  }
  
  // Draw breath state indicator and motor status
  drawBreathStateIndicator(rowHeight * 4.5);
}

function drawEasingCurve(centerY, rowHeight) {
  const startX = 0;
  const endX = width;
  const amplitude = rowHeight * 0.4;
  
  // Draw the curve
  ctx.strokeStyle = easingColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  
  for (let i = 0; i < easingPoints.length; i++) {
    const point = easingPoints[i];
    const x = startX + point.t * (endX - startX);
    const y = centerY - point.y * amplitude;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.stroke();
  
  // Draw baseline
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, centerY);
  ctx.lineTo(endX, centerY);
  ctx.stroke();
  
  // Draw current time marker (moving dot) based on breath cycle
  if (breathCycles.length > 0) {
    const lastCycle = breathCycles[breathCycles.length - 1];
    const now = Date.now();
    let progressRatio;
    
    if (isInhaling) {
      // During inhale
      const inhaleElapsed = now - lastCycle.inhaleStart;
      // Estimate total inhale time based on average of previous cycles
      let estimatedInhaleTime = 2000; // Default 2 seconds
      
      if (breathCycles.length > 1) {
        const prevCycles = breathCycles.slice(0, -1).filter(c => c.inhaleLength);
        if (prevCycles.length > 0) {
          estimatedInhaleTime = prevCycles.reduce((sum, c) => sum + c.inhaleLength, 0) / prevCycles.length;
        }
      }
      
      progressRatio = Math.min(inhaleElapsed / estimatedInhaleTime, 1);
    } else {
      // During exhale
      const exhaleElapsed = now - lastCycle.exhaleStart;
      // Estimate total exhale time
      let estimatedExhaleTime = 2000; // Default 2 seconds
      
      if (breathCycles.length > 1) {
        const prevCycles = breathCycles.slice(0, -1).filter(c => c.exhaleLength);
        if (prevCycles.length > 0) {
          estimatedExhaleTime = prevCycles.reduce((sum, c) => sum + c.exhaleLength, 0) / prevCycles.length;
        }
      }
      
      progressRatio = Math.min(exhaleElapsed / estimatedExhaleTime, 1);
    }
    
    // Find the point on the easing curve
    const pointIndex = Math.min(Math.floor(progressRatio * easingPoints.length), easingPoints.length - 1);
    const point = easingPoints[pointIndex];
    
    // Draw the point
    const x = startX + point.t * (endX - startX);
    const y = centerY - point.y * amplitude;
    
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBreathStateIndicator(yPosition) {
  // Set up positions
  const centerX = width / 2;
  const radius = 20; // Reduced from 30 to 20 for smaller circles
  const spacing = 200;
  
  // Clear shadows
  ctx.shadowBlur = 0;
  
  // Inhale text (above left circle)
  ctx.font = '14px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = isInhaling ? '#ffffff' : '#555555';
  ctx.fillText('INHALING', centerX - spacing, yPosition - radius - 15);
  
  // Exhale text (above right circle)
  ctx.fillStyle = !isInhaling ? '#ffffff' : '#555555';
  ctx.fillText('EXHALING', centerX + spacing, yPosition - radius - 15);
  
  // Inhale indicator (left circle)
  if (isInhaling) {
    // Active state - white fill
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
  } else {
    // Inactive state - grey stroke only
    ctx.fillStyle = 'transparent';
    ctx.strokeStyle = '#555555';
  }
  
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX - spacing, yPosition, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  
  // Motor label under inhale circle
  ctx.fillStyle = '#888888';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.fillText('Motor 2', centerX - spacing, yPosition + radius + 15);
  
  // Exhale indicator (right circle)
  if (!isInhaling) {
    // Active state - white fill
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
  } else {
    // Inactive state - grey stroke only
    ctx.fillStyle = 'transparent';
    ctx.strokeStyle = '#555555';
  }
  
  ctx.beginPath();
  ctx.arc(centerX + spacing, yPosition, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  
  // Motor label under exhale circle
  ctx.fillStyle = '#888888';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.fillText('Motor 1', centerX + spacing, yPosition + radius + 15);
}

function drawWaveInRow(dataArray, color, maxValue, centerY, rowHeight) {
  // Style for wave
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  
  // Draw the wave
  const pointSpacing = width / maxHistoryPoints;
  const amplitude = rowHeight * 0.4;  // Use 40% of the row height
  
  for (let i = 0; i < dataArray.length; i++) {
    const x = i * pointSpacing;
    const normalizedValue = dataArray[i] / maxValue;
    const y = centerY - normalizedValue * amplitude;  // Center in row
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.stroke();
  
  // Draw baseline for this wave
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
}

// Update the ratio display
function updateInhaleExhaleRatio() {
  // Update ratio based on the current state and timing
  let ratio = 1.0;
  const now = Date.now();
  
  if (breathCycles.length > 0) {
    const lastCycle = breathCycles[breathCycles.length - 1];
    
    if (isInhaling) {
      // Currently inhaling - calculate ratio based on current inhale time and last exhale
      const currentInhaleTime = now - lastCycle.inhaleStart;
      if (lastCycle.exhaleLength > 0) {
        ratio = currentInhaleTime / lastCycle.exhaleLength;
      } else if (breathCycles.length > 1) {
        // Use previous cycle's exhale if available
        const prevCycle = breathCycles[breathCycles.length - 2];
        if (prevCycle && prevCycle.exhaleLength > 0) {
          ratio = currentInhaleTime / prevCycle.exhaleLength;
        }
      }
    } else {
      // Currently exhaling - calculate ratio based on last inhale and current exhale
      if (lastCycle.inhaleLength > 0) {
        const currentExhaleTime = now - lastCycle.exhaleStart;
        ratio = lastCycle.inhaleLength / (currentExhaleTime || 1);
      }
    }
  }
  
  // Clamp ratio to reasonable values
  ratio = Math.max(0.1, Math.min(10, ratio));
  
  // Update current easing value
  currentEasing = ratio;
  
  // Display the ratio
  const ratioElement = document.getElementById('inhaleExhaleRatio');
  if (ratioElement) {
    ratioElement.textContent = `Inhale/Exhale Ratio: ${ratio.toFixed(2)}`;
  }
}

async function sendDataToArduino(ratio) {
  if (!serialConnected || !serialWriter) {
    console.log('Cannot send data: Not connected to Arduino');
    return;
  }
  
  // Only send if ratio has changed or it's a state transition (inhale/exhale)
  // This prevents flooding the serial port
  if (Math.abs(ratio - lastSentRatio) < 0.1 && ratio !== 0.5 && ratio !== 1.5) {
    return;
  }
  
  try {
    const encoder = new TextEncoder();
    const data = `R:${ratio.toFixed(2)}\n`; // Format: R:1.20
    console.log("Sending to Arduino:", data);
    
    // Send the data multiple times with a small delay to ensure it's received
    await serialWriter.write(encoder.encode(data));
    
    // Remember the last sent ratio
    lastSentRatio = ratio;
    
    // Visual feedback that data was sent
    const connectionStatus = document.getElementById('connectionStatus');
    if (connectionStatus) {
      const originalHTML = connectionStatus.innerHTML;
      connectionStatus.innerHTML = '<span class="status connected"></span> Sending Data...';
      setTimeout(() => {
        connectionStatus.innerHTML = originalHTML;
      }, 200);
    }
  } catch (error) {
    console.error('Error sending data to Arduino:', error);
    handleDisconnection();
  }
} 