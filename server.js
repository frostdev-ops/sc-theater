// Load .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises; // Use promises version of fs
const fsSync = require('fs'); // Use sync version for specific checks
const videoEncoder = require('./tools/video-encoder');
const crypto = require('crypto'); // For generating secure tokens
const LogManager = require('./lib/utils-server'); // Import LogManager
const AuthManager = require('./lib/auth-server'); // Import AuthManager
const StateManager = require('./lib/state-manager'); // Import StateManager
const VideoService = require('./lib/video-service'); // Import VideoService
const WebSocketServer = require('./lib/websocket-server'); // Import WebSocketServer

const PORT = process.env.PORT || 4000;
// Session expiry is now handled within AuthManager based on env var or default
// const SESSION_EXPIRY = process.env.SESSION_EXPIRY_MS || (7 * 24 * 60 * 60 * 1000);

// Logging configuration (Constants moved to utils-server.js, but keep env var access)
// const LOG_SUMMARY_INTERVAL = process.env.LOG_SUMMARY_INTERVAL || 5 * 60 * 1000;
// const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Create global logger instance using the imported class
const logger = new LogManager({
    logLevel: process.env.LOG_LEVEL,
    summaryInterval: process.env.LOG_SUMMARY_INTERVAL
});

// Load passwords from environment variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD;

if (!ADMIN_PASSWORD || !VIEWER_PASSWORD) {
    logger.error('ADMIN_PASSWORD and VIEWER_PASSWORD environment variables must be set.', 'config');
    process.exit(1); // Exit if passwords are not set
}

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Use JSON parsing middleware
app.use(express.json());

// Basic security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Serve static files from the 'public' directory
const publicPath = path.join(__dirname, 'public');
logger.info(`Serving static files from: ${publicPath}`, 'startup');
app.use(express.static(publicPath));

// Global state and configuration
// const masterState = { ... };
// const connectedClients = new Map();
// const activeSessions = new Map();

// Interval IDs for cleanup
// let masterStateSyncIntervalId = null; ...
// let heartbeatInterval = null; ...
// let sessionCleanupInterval = null; ...
// let viewerListIntervalId = null; ...
// let rateAdjustmentIntervalId = null; ...
// let rateAdjustTimerId = null; ...

// Constants (keep existing constants)
// const DEFAULT_SYNC_INTERVAL = 1000; ...
// const MIN_SYNC_INTERVAL = 1000;     // Fastest interval for drifting clients (ms) - changed from 3000 to 1000
// const MAX_SYNC_INTERVAL = 1000;     // Slowest interval for stable clients (ms) - changed from 5000 to 1000 to ensure consistent updates
// const DRIFT_THRESHOLD_LOW = 0.5;    // Below this drift (in seconds) is considered "in sync"
// const DRIFT_THRESHOLD_HIGH = 1.5;   // Above this drift (in seconds) is considered "significantly out of sync"
// const SYNC_INTERVAL_ADJUST_STEP = 1000; // How much to change interval by (ms) - adjusted to match new scale
// const MIN_PLAYBACK_RATE = 0.9;      // Minimum server playback rate (10% slow down)
// const MAX_PLAYBACK_RATE = 1.0;      // Maximum/normal server playback rate
// const PLAYBACK_RATE_ADJUST_STEP = 0.01; // How much to adjust playback rate at a time
// const RATE_ADJUSTMENT_INTERVAL = 1000;  // How often to check and adjust global rate (ms) - changed from 5000 to 1000
// const CLIENT_BEHIND_THRESHOLD = -1.0;   // If more clients are behind by this amount, slow down
// const MASTER_STATE_SYNC_INTERVAL = 5000; // How often to broadcast master state to everyone (ms)

// Heartbeat constants
// const HEARTBEAT_INTERVAL = 30000; // Client should send heartbeat roughly this often (ms)
// const HEARTBEAT_CHECK_INTERVAL = 10000; // How often server checks for missing heartbeats (ms)
// const MAX_MISSED_HEARTBEATS = 3; // Disconnect after this many missed check intervals

// Remove generateSessionToken function
// function generateSessionToken() { ... } // REMOVED (will move to auth-server.js)

// Remove validateSession function
// function validateSession(token) { ... } // REMOVED (will move to auth-server.js)

// Remove cleanupExpiredSessions function
// function cleanupExpiredSessions() { ... } // REMOVED (will move to auth-server.js)

// Remove API route for session validation
// app.post('/api/validate-session', (req, res) => { ... }); // REMOVED (will move to auth-server.js)

// Remove getEffectiveTime function
// function getEffectiveTime() { ... } // REMOVED (will move to state-manager.js)

// Remove adjustPlaybackRate function
// function adjustPlaybackRate() { ... } // REMOVED (will move to state-manager.js)

// Remove startRateAdjustment function
// function startRateAdjustment() { ... } // REMOVED (will move to state-manager.js)

// Remove stopRateAdjustment function
// function stopRateAdjustment() { ... } // REMOVED (will move to state-manager.js)

// Remove getVideoList function
// async function getVideoList() { ... } // REMOVED (will move to video-service.js)

// Remove isValidVideoFilename function
// function isValidVideoFilename(filename) { ... } // REMOVED (will move to video-service.js)

// Remove HLS segment serving route
// app.get('/video/:streamName/*', (req, res) => { ... }); // REMOVED (will move to video-service.js)

// Remove scanAndEncodeVideos function
// async function scanAndEncodeVideos() { ... } // REMOVED (will move to video-service.js)

// Remove wss initialization (will be in websocket-server.js)
// const wss = new WebSocket.Server({ server });

// Remove wss event listeners ('connection', 'error')
// wss.on('connection', handleConnection);
// wss.on('error', (error) => { ... });

// Remove handleConnection function
// function handleConnection(ws, req) { ... } // REMOVED (will move to websocket-server.js)

// Remove handleMessage function
// async function handleMessage(ws, message, clientInfo) { ... } // REMOVED (will move to websocket-server.js)

// Remove handleDisconnect function
// function handleDisconnect(ws, code, reason, clientInfo) { ... } // REMOVED (will move to websocket-server.js)

// Remove broadcastState function
// function broadcastState(excludeWs = null) { ... } // REMOVED (will move to websocket-server.js)

// Remove sendSyncStateToClient function
// function sendSyncStateToClient(ws, clientInfo) { ... } // REMOVED (will move to websocket-server.js)

// Remove sendViewerList function
// function sendViewerList(adminWs) { ... } // REMOVED (will move to websocket-server.js)

// Remove scheduleNextSync function
// function scheduleNextSync(ws, clientInfo) { ... } // REMOVED (will move to websocket-server.js)

// Remove heartbeat functions
// function startHeartbeatChecks() { ... } // REMOVED (will move to websocket-server.js)
// function checkHeartbeats() { ... } // REMOVED (will move to websocket-server.js)

// Keep top-level route for index.html (or move if desired)
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// --- Initialize Services/Managers (Example Structure) ---
const authManager = new AuthManager(logger, {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    VIEWER_PASSWORD: process.env.VIEWER_PASSWORD,
    SESSION_EXPIRY: process.env.SESSION_EXPIRY_MS || (7 * 24 * 60 * 60 * 1000) // Pass expiry config
});
const stateManager = new StateManager(logger); // Instantiate StateManager
const videoService = new VideoService(logger, { videoEncoder }); // Instantiate VideoService
// Instantiate WebSocketServer, passing dependencies
const webSocketServer = new WebSocketServer(server, logger, authManager, stateManager, videoService);

// --- Register API Routes (Example Structure) ---
app.use('/api', authManager.getRouter()); // Mount auth routes under /api
app.use('/video', videoService.getRouter()); // Mount video routes under /video

// --- Start Background Tasks (Example Structure) ---
authManager.startSessionCleanup();
stateManager.startRateAdjustment(); // Start rate adjustment via StateManager
videoService.startVideoScan(); // Start video scanning via VideoService