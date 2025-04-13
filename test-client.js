const WebSocket = require('ws');
const readline = require('readline');

// Test configuration
const WS_URL = 'ws://localhost:4000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || 'viewer';

// Create readline interface for CLI input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Create a WebSocket connection
let ws;
let role = '';

function connect() {
  console.log(`Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connection established.');
    showLoginPrompt();
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log(`Received: ${JSON.stringify(message, null, 2)}`);
      
      // Handle authentication response
      if (message.type === 'auth_success') {
        role = message.role;
        console.log(`\nAuthenticated as: ${role}`);
        showCommands();
      }
      
      // Handle video list (for admin)
      if (message.type === 'videoList') {
        console.log('\nAvailable videos:');
        message.videos.forEach((video, index) => {
          console.log(`  ${index + 1}. ${video}`);
        });
      }
    } catch (err) {
      console.error('Error parsing message:', err);
      console.log('Raw message:', data);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`Connection closed: ${code} - ${reason}`);
    process.exit(0);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    process.exit(1);
  });
}

function showLoginPrompt() {
  rl.question('\nChoose role (1=admin, 2=viewer): ', (answer) => {
    if (answer === '1') {
      authenticate(ADMIN_PASSWORD);
    } else if (answer === '2') {
      authenticate(VIEWER_PASSWORD);
    } else {
      console.log('Invalid choice. Please try again.');
      showLoginPrompt();
    }
  });
}

function authenticate(password) {
  console.log('Authenticating...');
  ws.send(JSON.stringify({
    type: 'auth',
    password: password
  }));
}

function showCommands() {
  console.log('\nAvailable commands:');
  console.log('  1. Get video list (admin only)');
  console.log('  2. Play video (admin only)');
  console.log('  3. Pause video (admin only)');
  console.log('  4. Seek (admin only) - format: seek 30 (seconds)');
  console.log('  5. Change video (admin only) - format: video filename.mp4');
  console.log('  6. Exit');
  
  promptCommand();
}

function promptCommand() {
  rl.question('\nEnter command: ', (input) => {
    if (input === '1') {
      ws.send(JSON.stringify({ type: 'requestVideoList' }));
    } else if (input === '2') {
      ws.send(JSON.stringify({ type: 'play' }));
    } else if (input === '3') {
      ws.send(JSON.stringify({ type: 'pause' }));
    } else if (input.startsWith('seek ')) {
      const time = parseFloat(input.replace('seek ', ''));
      if (!isNaN(time)) {
        ws.send(JSON.stringify({ type: 'seek', time }));
      } else {
        console.log('Invalid time format. Use "seek 30" for 30 seconds.');
      }
    } else if (input.startsWith('video ')) {
      const video = input.replace('video ', '');
      ws.send(JSON.stringify({ type: 'changeVideo', video }));
    } else if (input === '6') {
      console.log('Exiting...');
      ws.close();
      rl.close();
      return;
    } else {
      console.log('Unknown command');
    }
    
    promptCommand();
  });
}

// Start the test client
console.log('WebSocket Test Client');
console.log('====================');
connect(); 