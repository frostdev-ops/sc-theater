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

const PORT = process.env.PORT || 4000;
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Load passwords from environment variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD;

if (!ADMIN_PASSWORD || !VIEWER_PASSWORD) {
    console.error('Error: ADMIN_PASSWORD and VIEWER_PASSWORD environment variables must be set.');
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
console.log(`Serving static files from: ${publicPath}`);
app.use(express.static(publicPath));

// Session management
const activeSessions = new Map(); // token -> { role, name, expiry }

// Generate a secure session token
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Validate session token
function validateSession(token) {
    if (!token || !activeSessions.has(token)) {
        return null;
    }

    const session = activeSessions.get(token);
    const now = Date.now();

    // Check for expiration
    if (session.expiry < now) {
        // Session expired, remove it
        activeSessions.delete(token);
        return null;
    }

    return session;
}

// Clean up expired sessions periodically
function cleanupExpiredSessions() {
    const now = Date.now();
    let expiredCount = 0;

    for (const [token, session] of activeSessions.entries()) {
        if (session.expiry < now) {
            activeSessions.delete(token);
            expiredCount++;
        }
    }

    if (expiredCount > 0) {
        console.log(`Cleaned up ${expiredCount} expired sessions. Active sessions: ${activeSessions.size}`);
    }
}

// Cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// API endpoint to validate session
app.post('/api/validate-session', (req, res) => {
    console.log('Session validation request received');
    
    if (!req.body || typeof req.body !== 'object') {
        console.error('Invalid request body format');
        return res.status(400).json({ valid: false, error: 'Invalid request format' });
    }
    
    const { token } = req.body;
    
    if (!token) {
        console.error('No token provided in validation request');
        return res.status(400).json({ valid: false, error: 'No token provided' });
    }
    
    console.log(`Validating session token: ${token.substring(0, 8)}...`);
    const session = validateSession(token);

    if (session) {
        console.log(`Valid session found for user: ${session.name} (${session.role})`);
        // Return session info without sensitive data
        res.status(200).json({
            valid: true,
            role: session.role,
            name: session.name
        });
    } else {
        console.log('Session validation failed: token invalid or expired');
        res.status(401).json({ 
            valid: false, 
            error: 'Invalid or expired session'
        });
    }
});

// Video serving endpoint
app.get('/video/:filename*', (req, res) => { // Use wildcard to capture potential subpaths
    const filenameWithSubPath = req.params.filename + (req.params[0] || '');

    // Basic security check: validate filename parts
    if (!filenameWithSubPath || /[/\\?%*:|"<>]/.test(filenameWithSubPath.replace(/\//g, ''))) { // Allow forward slash but check rest
        console.error(`Invalid filename requested: ${filenameWithSubPath}`);
        return res.status(400).send('Invalid filename');
    }

    const videoDir = path.join(__dirname, 'videos');
    const processedDir = path.join(videoDir, 'processed');
    let requestedPath;

    // Determine if it's an HLS segment/playlist or a potential direct file request
    // HLS requests usually look like /video/streamName/segment.ts or /video/streamName/master.m3u8
    if (filenameWithSubPath.includes('/') && (filenameWithSubPath.endsWith('.m3u8') || filenameWithSubPath.endsWith('.ts'))) {
        // Assume HLS request - path is relative to processedDir
        requestedPath = path.join(processedDir, filenameWithSubPath);
    } else {
        // This case should ideally not happen if client always requests HLS streams
        // For safety, assume it might be a direct request for a processed MP4 (if encodeToMP4 is used)
        // Deny access to raw files in videoDir root for safety
        console.warn(`Direct file request attempt (should use HLS): ${filenameWithSubPath}`);
        // Let's check if it exists in processedDir for now
        requestedPath = path.join(processedDir, filenameWithSubPath);
    }

    // Ensure the requested path doesn't escape the processed directory (path traversal protection)
    const normalizedPath = path.normalize(requestedPath);
    if (!normalizedPath.startsWith(processedDir)) {
        console.error(`Path traversal attempt: ${filenameWithSubPath}`);
        return res.status(403).send('Access denied');
    }

    console.log(`Request for video asset: ${filenameWithSubPath} -> ${normalizedPath}`);

    // Ensure the file exists
    fsSync.stat(normalizedPath, (err, stats) => { // Use fsSync.stat for consistency
        if (err) {
            console.error(`File not found or error accessing: ${normalizedPath}`, err);
            if (err.code === 'ENOENT') {
                return res.status(404).send('Video asset not found');
            } else {
                return res.status(500).send('Server error accessing video asset');
            }
        }

        // Determine content type based on file extension
        let contentType = 'video/mp4'; // Default
        const ext = path.extname(normalizedPath).toLowerCase();

        if (ext === '.m3u8') {
            contentType = 'application/vnd.apple.mpegurl';
        } else if (ext === '.ts') {
            contentType = 'video/mp2t';
        }
        // Add other types if needed (e.g., webm, ogg if encodeToMP4 is used)

        const fileSize = stats.size;
        const range = req.headers.range;

        if (range) {
            // Range requests are generally not applicable to HLS segments/playlists
            // but handle for potential direct file access if needed
            console.log(`Range header: ${range}`);
            // Validate range header format
            if (!range.startsWith('bytes=') || !/^\d*-\d*$/.test(range.substring(6))) {
                console.error(`Invalid range format: ${range}`);
                return res.status(400).send('Invalid range format');
            }
            
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            // Ensure end is within bounds, or defaults to end of file
            const end = parts[1] ? Math.min(parseInt(parts[1], 10), fileSize - 1) : fileSize - 1;

            if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
                 console.error(`Invalid range: start=${start}, end=${end}, fileSize=${fileSize}`);
                return res.status(416).send('Range Not Satisfiable');
            }

            const chunksize = (end - start) + 1;
            // Use fsSync here for consistency with stat, though async readStream is fine
            const file = fsSync.createReadStream(normalizedPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
                'Cache-Control': 'max-age=3600'
            };

            console.log(`Serving chunk: bytes ${start}-${end}/${fileSize}`);
            res.writeHead(206, head);
            file.pipe(res);

            file.on('error', (streamErr) => {
                console.error('Error reading video stream chunk:', streamErr);
                if (!res.headersSent) {
                    res.status(500).send('Error streaming video chunk');
                } else {
                    res.end();
                }
            });

        } else {
            console.log('No range header, serving full file.');
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Cache-Control': 'max-age=3600' // Cache HLS manifests/segments
            };
            res.writeHead(200, head);
            const file = fsSync.createReadStream(normalizedPath);
            file.pipe(res);

            file.on('error', (streamErr) => {
                console.error('Error reading full video stream:', streamErr);
                if (!res.headersSent) {
                    res.status(500).send('Error streaming full video');
                } else {
                    res.end();
                }
            });
        }
    });
});

// Add a healthcheck endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Fallback route for non-existing routes
app.use((req, res) => {
    res.status(404).sendFile(path.join(publicPath, 'index.html'));
});

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

console.log('WebSocket server created');

// Keep track of connected clients (WebSocket object -> { role: 'admin' | 'viewer', ip: string, lastDrift: number, currentSyncInterval: number, syncTimerId: NodeJS.Timeout | null })
const clients = new Map();

// --- Adaptive Sync Constants ---
const DEFAULT_SYNC_INTERVAL = 7500; // Initial sync interval (ms)
const MIN_SYNC_INTERVAL = 3000;     // Fastest interval for drifting clients (ms)
const MAX_SYNC_INTERVAL = 15000;    // Slowest interval for stable clients (ms)
const DRIFT_THRESHOLD_LOW = 0.5;    // Below this drift (seconds), increase interval
const DRIFT_THRESHOLD_HIGH = 1.5;   // Above this drift (seconds), decrease interval
const SYNC_INTERVAL_ADJUST_STEP = 1500; // How much to change interval by (ms)

// --- Playback Rate Management Constants ---
const MIN_PLAYBACK_RATE = 0.9;      // Minimum server playback rate (10% slow down)
const MAX_PLAYBACK_RATE = 1.0;      // Maximum/normal server playback rate
const PLAYBACK_RATE_ADJUST_STEP = 0.01; // How much to adjust playback rate at a time
const RATE_ADJUSTMENT_INTERVAL = 5000;  // How often to check and adjust global rate (ms)
const CLIENT_BEHIND_THRESHOLD = -1.0;   // If more clients are behind by this amount, slow down

// --- Playback State (Master State) ---
let masterState = {
    currentVideo: null, // Holds the filename of the current video (e.g., 'sample.mp4')
    currentTime: 0,     // Holds the current playback time in seconds
    isPlaying: false,   // Holds the current playback status
    lastUpdateTime: Date.now(),
    playbackRate: 1.0   // Server-side playback rate (can be slowed down to help clients catch up)
};

// Track how many clients are significantly behind
let rateAdjustTimerId = null;

// --- Helper Functions ---

// Calculate the effective current time based on master state, accounting for playback rate
function getEffectiveTime() {
    let actualCurrentTime = masterState.currentTime;
    if (masterState.isPlaying) {
        const timeDiffSeconds = (Date.now() - masterState.lastUpdateTime) / 1000;
        // Apply playback rate to the elapsed time
        actualCurrentTime += timeDiffSeconds * masterState.playbackRate;
    }
    return Math.max(0, actualCurrentTime);
}

// Adjust server playback rate based on client sync status
function adjustPlaybackRate() {
    // Only adjust if we're currently playing
    if (!masterState.isPlaying || clients.size === 0) {
        return;
    }

    // Count how many clients are ahead vs behind
    let clientsBehind = 0;
    let clientsAhead = 0;
    let totalClients = 0;
    
    clients.forEach((clientInfo) => {
        if (clientInfo.lastDrift !== undefined) {
            totalClients++;
            // Negative drift means client is behind server
            if (clientInfo.lastDrift < CLIENT_BEHIND_THRESHOLD) {
                clientsBehind++;
            } else if (clientInfo.lastDrift > 0.5) {
                clientsAhead++;
            }
        }
    });
    
    // If we don't have enough data, default to normal rate
    if (totalClients === 0) {
        if (masterState.playbackRate < MAX_PLAYBACK_RATE) {
            masterState.playbackRate = MAX_PLAYBACK_RATE;
            console.log(`No client drift data available. Reset playback rate to ${masterState.playbackRate}`);
        }
        return;
    }
    
    // Calculate what percentage of clients are behind
    const behindRatio = clientsBehind / totalClients;
    
    // If more than 25% of clients are significantly behind, slow down the server
    if (behindRatio > 0.25 && masterState.playbackRate > MIN_PLAYBACK_RATE) {
        masterState.playbackRate = Math.max(MIN_PLAYBACK_RATE, masterState.playbackRate - PLAYBACK_RATE_ADJUST_STEP);
        console.log(`${clientsBehind} clients (${Math.round(behindRatio * 100)}%) are behind. Slowing server playback rate to ${masterState.playbackRate.toFixed(2)}x`);
        
        // Update the lastUpdateTime to account for the rate change
        const currentEffectiveTime = getEffectiveTime();
        masterState.currentTime = currentEffectiveTime;
        masterState.lastUpdateTime = Date.now();
        
        // Broadcast the updated state with new playback rate
        broadcastState();
    } 
    // If less than 10% of clients are behind, or more are ahead, speed up to normal
    else if ((behindRatio < 0.1 || clientsAhead > clientsBehind) && masterState.playbackRate < MAX_PLAYBACK_RATE) {
        masterState.playbackRate = Math.min(MAX_PLAYBACK_RATE, masterState.playbackRate + PLAYBACK_RATE_ADJUST_STEP);
        console.log(`Few clients behind (${behindRatio.toFixed(2)}). Increasing server playback rate to ${masterState.playbackRate.toFixed(2)}x`);
        
        // Update the lastUpdateTime to account for the rate change
        const currentEffectiveTime = getEffectiveTime();
        masterState.currentTime = currentEffectiveTime;
        masterState.lastUpdateTime = Date.now();
        
        // Broadcast the updated state with new playback rate
        broadcastState();
    }
}

// Start periodic playback rate adjustment
function startRateAdjustment() {
    stopRateAdjustment(); // Stop any existing timer
    rateAdjustTimerId = setInterval(adjustPlaybackRate, RATE_ADJUSTMENT_INTERVAL);
    console.log(`Started playback rate adjustment every ${RATE_ADJUSTMENT_INTERVAL}ms`);
}

// Stop periodic playback rate adjustment
function stopRateAdjustment() {
    if (rateAdjustTimerId) {
        clearInterval(rateAdjustTimerId);
        rateAdjustTimerId = null;
        console.log('Stopped playback rate adjustment');
    }
}

// Schedule the next sync state message for a specific client
function scheduleNextSync(ws, clientInfo) {
    // Clear any existing timer for this client
    if (clientInfo.syncTimerId) {
        clearTimeout(clientInfo.syncTimerId);
        clientInfo.syncTimerId = null;
    }

    // Only schedule if the master state is playing
    if (masterState.isPlaying) {
        clientInfo.syncTimerId = setTimeout(() => {
            sendSyncStateToClient(ws, clientInfo);
        }, clientInfo.currentSyncInterval);
    }
}

// Send sync state to a specific client and schedule the next one
function sendSyncStateToClient(ws, clientInfo) {
    if (!clients.has(ws) || ws.readyState !== WebSocket.OPEN) {
        console.log(`Attempted to send sync to disconnected/invalid client ${clientInfo.ip}`);
        return; // Client disconnected or invalid
    }

    const stateToSend = {
        type: 'syncState',
        currentVideo: masterState.currentVideo,
        targetTime: getEffectiveTime(),
        isPlaying: masterState.isPlaying,
        playbackRate: masterState.playbackRate // Include server playback rate
    };
    const stateString = JSON.stringify(stateToSend);

    try {
        ws.send(stateString);
        // Schedule the next sync for this client
        scheduleNextSync(ws, clientInfo);
    } catch (err) {
        console.error(`Error sending sync state to client ${clientInfo.ip}:`, err);
        // Remove client or handle error appropriately
        clearTimeout(clientInfo.syncTimerId); // Stop trying to sync
        clients.delete(ws);
        console.log(`Removed client ${clientInfo.ip} due to send error.`);
    }
}

// Function to send the list of connected viewers to admins
function sendViewerList(adminWs) {
    // First, check if the recipient is an admin and has a valid connection
    const adminInfo = clients.get(adminWs);
    if (!adminInfo || adminInfo.role !== 'admin' || adminWs.readyState !== WebSocket.OPEN) {
        console.log('Cannot send viewer list: recipient is not an admin or has invalid connection');
        return;
    }

    // Create a list of viewers with relevant info, but without sensitive data
    const viewers = [];
    const serverTime = getEffectiveTime();

    clients.forEach((clientInfo, ws) => {
        // Include information about all clients, including admins
        if (ws.readyState === WebSocket.OPEN) {
            viewers.push({
                role: clientInfo.role,
                name: clientInfo.name || 'Anonymous',
                ip: clientInfo.ip,
                currentTime: clientInfo.lastReportedTime !== undefined ? clientInfo.lastReportedTime : null,
                serverTime: serverTime, // Add server time for comparison
                drift: clientInfo.lastDrift !== undefined ? clientInfo.lastDrift : null
            });
        }
    });

    try {
        adminWs.send(JSON.stringify({
            type: 'viewerList',
            viewers: viewers,
            count: viewers.length
        }));
        console.log(`Sent viewer list to admin at ${adminInfo.ip} (${viewers.length} viewers)`);
    } catch (err) {
        console.error(`Error sending viewer list to admin at ${adminInfo.ip}:`, err);
    }
}

// Function to broadcast the current master state to all connected clients
// This is now mainly used for IMMEDIATE updates after admin actions
function broadcastState() {
    const stateToSend = {
        type: 'syncState',
        currentVideo: masterState.currentVideo,
        targetTime: getEffectiveTime(), // Use calculated time
        isPlaying: masterState.isPlaying,
        playbackRate: masterState.playbackRate // Include server playback rate
    };
    const stateString = JSON.stringify(stateToSend);
    console.log(`Broadcasting immediate state: ${stateString}`);

    clients.forEach((clientInfo, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(stateString);
                // After broadcasting an immediate update, reschedule the next individual sync
                scheduleNextSync(ws, clientInfo);
            } catch (err) {
                console.error('Error broadcasting state to client:', err);
                // Clean up client if send fails during broadcast
                if (clientInfo.syncTimerId) clearTimeout(clientInfo.syncTimerId);
                clients.delete(ws);
            }
        } else {
            // Clean up stale clients found during broadcast
             console.log(`Removing stale client ${clientInfo.ip} found during broadcast.`);
            if (clientInfo.syncTimerId) clearTimeout(clientInfo.syncTimerId);
            clients.delete(ws);
        }
    });
    console.log(`Broadcast complete. ${clients.size} client(s) remaining.`);
}

// Function to get the list of available video files (now based on processed HLS streams)
async function getVideoList() {
    const videoDir = path.join(__dirname, 'videos');
    const processedDir = path.join(videoDir, 'processed');

    try {
        // Ensure processed directory exists
        await fs.mkdir(processedDir, { recursive: true });

        const entries = await fs.readdir(processedDir, { withFileTypes: true });
        let hlsStreams = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const streamDir = path.join(processedDir, entry.name);
                // Check if master.m3u8 exists within the directory
                try {
                    await fs.access(path.join(streamDir, 'master.m3u8'));
                    // Use stream directory name as the identifier
                    hlsStreams.push(`hls:${entry.name}`);
                } catch (err) {
                    // Ignore directories that don't contain master.m3u8
                    console.warn(`Directory ${entry.name} in processed does not contain master.m3u8, skipping.`);
                }
            }
        }

        console.log('Found HLS streams:', hlsStreams);

        // Set the first video as default if none is set and list is not empty
        if (!masterState.currentVideo && hlsStreams.length > 0) {
            console.log(`Setting default video to: ${hlsStreams[0]}`);
            masterState.currentVideo = hlsStreams[0];
        }

        return hlsStreams;
    } catch (err) {
        console.error(`Error reading processed videos directory (${processedDir}):`, err);
        // If the directory doesn't exist (should have been created, but handle anyway)
        if (err.code === 'ENOENT') {
             console.log(`Processed directory ${processedDir} not found. Attempting creation.`);
             try {
                 await fs.mkdir(processedDir, { recursive: true });
                 return []; // Return empty list after creating
             } catch (mkdirErr) {
                  console.error(`Failed to create processed directory ${processedDir}:`, mkdirErr);
                   return []; // Return empty list on error
             }
        } else {
           return []; // Return empty list on other errors
        }
    }
}

// Helper function to validate video filename (now expects hls: format)
function isValidVideoFilename(filename) {
    // Check if filename exists and is a string
    if (!filename || typeof filename !== 'string') {
        return false;
    }

    // Expect HLS stream references
    if (filename.startsWith('hls:')) {
        // Check that the directory name doesn't contain invalid characters
        const dirName = filename.substring(4); // Remove 'hls:' prefix
        // Allow alphanumeric, underscore, hyphen
        return dirName && /^[a-zA-Z0-9_-]+$/.test(dirName);
    }

    // Reject non-HLS stream references now
    console.warn(`isValidVideoFilename rejected non-HLS reference: ${filename}`);
    return false;
}

// --- WebSocket Server Logic ---

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`Client connected from ${clientIp}. Waiting for authentication.`);
    
    // Set a timeout for authentication
    const authTimeout = setTimeout(() => {
        if (!clients.has(ws)) { // If client hasn't authenticated yet
            console.log(`Client from ${clientIp} failed to authenticate in time, disconnecting.`);
            try {
                ws.send(JSON.stringify({ type: 'error', message: 'Authentication timed out' }));
                ws.terminate(); // Force close connection
            } catch (err) {
                console.error('Error during auth timeout termination:', err);
                // Just terminate if we can't send the message
                ws.terminate();
            }
        }
    }, 5000); // 5 seconds to authenticate

    ws.on('message', (message) => {
        console.log(`Received from ${clientIp}: ${message}`);
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
            
            // Basic message validation
            if (!parsedMessage.type || typeof parsedMessage.type !== 'string') {
                throw new Error('Message missing required "type" field');
            }
        } catch (e) {
            console.error(`Failed to parse message or invalid JSON format from ${clientIp}:`, e.message);
            try {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            } catch (sendErr) {
                console.error('Error sending error message:', sendErr);
            }
            return; // Ignore invalid messages
        }

        // Handle Authentication
        if (parsedMessage.type === 'auth') {
            console.log(`Auth attempt from ${clientIp}. Message:`, parsedMessage); // Log the exact message

            if (clients.has(ws)) {
                 console.warn(`Client from ${clientIp} attempting to authenticate again.`);
                 ws.send(JSON.stringify({ type: 'error', message: 'Already authenticated' }));
                 return;
            }

            let token = null;
            let role = null;
            let name = null;
            let authenticated = false; // Flag to track success

            // Try token authentication first
            if (parsedMessage.token) {
                console.log(`Attempting token authentication for ${clientIp} with token ${parsedMessage.token.substring(0, 8)}...`);
                const session = validateSession(parsedMessage.token); // Server validates it
                if (session) { // <-- Did validation succeed?
                    role = session.role;
                    name = session.name;
                    token = parsedMessage.token; // Reuse existing token
                    authenticated = true;
                    console.log(`SUCCESS: Client from ${clientIp} authenticated via session token as: ${role} (${name})`);
                } else {
                    console.log(`FAIL: Token validation failed for ${clientIp}. Token: ${parsedMessage.token.substring(0, 8)}...`);
                    // Explicitly fail if token was provided but invalid
                    ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid or expired session token' }));
                    return; // Don't fall through to password auth
                }
            }

            // If token auth was not attempted or failed (now handled above), try password auth
            if (!authenticated && parsedMessage.password) { // Check for password specifically
                console.log(`Attempting password authentication for ${clientIp}`);
                const { password, name: providedName } = parsedMessage;

                if (!password || typeof password !== 'string') {
                    console.warn(`Invalid password format from ${clientIp}`);
                    ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid password format' }));
                    return;
                }

                // Validate and sanitize name
                name = providedName && typeof providedName === 'string' ?
                    providedName.trim().substring(0, 30) : 'Anonymous'; // Limit to 30 chars

                if (password === ADMIN_PASSWORD) {
                    role = 'admin';
                } else if (password === VIEWER_PASSWORD) {
                    role = 'viewer';
                } else {
                    console.log(`FAIL: Password authentication failed for ${clientIp}: Invalid password`);
                    ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid password' }));
                    return;
                }

                // Password auth succeeded
                token = generateSessionToken(); // Generate new token
                const expiry = Date.now() + SESSION_EXPIRY;
                activeSessions.set(token, { role, name, expiry }); // Stores NEW session
                authenticated = true;
                console.log(`SUCCESS: Client from ${clientIp} authenticated with password as: ${role} (${name}). New session created.`);
            }

            // If neither method succeeded
            if (!authenticated) {
                console.log(`FAIL: Authentication failed for ${clientIp}. No valid token or password provided.`);
                ws.send(JSON.stringify({ type: 'auth_fail', message: 'Authentication required' }));
                return;
            }

            // Auth successful, initialize client state
            // Note: Use the determined role, name, token here
            clients.set(ws, {
                role,
                ip: clientIp,
                name, // Use the validated/provided name
                token, // Use the validated or newly generated token
                lastDrift: 0,
                lastReportedTime: 0,
                currentSyncInterval: DEFAULT_SYNC_INTERVAL,
                syncTimerId: null
            });

            clearTimeout(authTimeout);

            try {
                // Send confirmation back to client with token, role, and name
                ws.send(JSON.stringify({
                    type: 'auth_success',
                    role,
                    token,
                    name // Send name back on success
                }));

                // Send current state immediately upon successful auth
                const clientInfo = clients.get(ws); // Get the newly set info
                sendSyncStateToClient(ws, clientInfo); // Sends initial state & schedules next sync if playing

                // If this is the first client AND the master state is currently playing, start sync
                // Otherwise, sync will start when admin presses play.
                if (clients.size === 1 && masterState.isPlaying) {
                    startRateAdjustment();
                }

                // If admin, also send the video list and viewer list
                if (role === 'admin') {
                    getVideoList().then(videoList => {
                        console.log('Sending video list to admin upon auth');
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'videoList', videos: videoList }));

                            // Also send the viewer list
                            sendViewerList(ws);
                        }
                    }).catch(err => {
                        console.error("Error getting video list for admin auth:", err);
                        // Optionally send an error to the admin
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Could not retrieve video list' }));
                        }
                    });
                }

                // Notify all admins that a new client has joined (regardless of role)
                // This ensures the admin list is updated immediately when anyone joins
                clients.forEach((c_info, c_ws) => {
                    if (c_info.role === 'admin' && c_ws !== ws && c_ws.readyState === WebSocket.OPEN) { // Exclude self
                         console.log(`Notifying admin ${c_info.name} about new client ${name}`);
                         sendViewerList(c_ws);
                    }
                });

            } catch (err) {
                console.error(`Error sending auth response or post-auth data to ${clientIp}:`, err);
                // Clean up client if send fails during auth response
                if (clientInfo && clientInfo.syncTimerId) clearTimeout(clientInfo.syncTimerId);
                clients.delete(ws);
            }
            return; // Authentication message handled
        }

        // --- Message handling for authenticated clients ---
        if (!clients.has(ws)) {
            console.log(`Received message from unauthenticated client ${clientIp}. Ignoring.`);
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
        }

        const clientInfo = clients.get(ws);
        console.log(`Received message from authenticated client (${clientInfo.role}) at ${clientInfo.ip}:`, parsedMessage);

        // Only admins can send control messages
        if (clientInfo.role !== 'admin' && [
            'play', 'pause', 'seek', 'changeVideo', 'requestVideoList', 'requestViewerList'
        ].includes(parsedMessage.type)) {
            console.warn(`Received control message type '${parsedMessage.type}' from non-admin at ${clientInfo.ip}. Ignoring.`);
            ws.send(JSON.stringify({ type: 'error', message: 'Permission denied' }));
            return;
        }

        // Handle messages based on type
        switch (parsedMessage.type) {
            case 'play':
                if (!masterState.isPlaying) {
                    console.log(`Admin at ${clientInfo.ip} action: Play`);
                    masterState.isPlaying = true;
                    masterState.lastUpdateTime = Date.now();
                    broadcastState(); // Broadcast immediate change & reschedule syncs for all clients
                    // Start playback rate adjustment when playing
                    startRateAdjustment();
                }
                break;
            case 'pause':
                if (masterState.isPlaying) {
                    console.log(`Admin at ${clientInfo.ip} action: Pause`);
                    const now = Date.now();
                    const timeDiffSeconds = (now - masterState.lastUpdateTime) / 1000;
                    masterState.currentTime += timeDiffSeconds * masterState.playbackRate; // Apply rate when pausing
                    masterState.isPlaying = false;
                    masterState.lastUpdateTime = now;
                    broadcastState(); // Broadcast immediate change
                    // Stop playback rate adjustment when paused
                    stopRateAdjustment();
                    // Reset to normal playback rate when paused
                    if (masterState.playbackRate < MAX_PLAYBACK_RATE) {
                        masterState.playbackRate = MAX_PLAYBACK_RATE;
                        console.log(`Reset playback rate to ${masterState.playbackRate} on pause`);
                    }
                }
                break;
            case 'seek':
                 // Validate time
                const seekTime = parseFloat(parsedMessage.time);
                if (isNaN(seekTime) || seekTime < 0) {
                    console.error(`Invalid seek time received from ${clientInfo.ip}: ${parsedMessage.time}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid seek time' }));
                    break;
                }
                console.log(`Admin at ${clientInfo.ip} action: Seek to ${seekTime}`);
                masterState.currentTime = seekTime;
                masterState.lastUpdateTime = Date.now();
                broadcastState(); // Broadcast immediate change & reschedule syncs for all clients
                break;
            case 'changeVideo':
                const newVideo = parsedMessage.video; // Expected format: "hls:streamName"

                // Validate video filename (expects hls:streamName format)
                if (!isValidVideoFilename(newVideo)) {
                    console.error(`Invalid HLS video reference received from ${clientInfo.ip}: ${newVideo}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid video reference format. Expected hls:streamName' }));
                    break;
                }

                // Check if the corresponding HLS stream directory exists
                const videoDir = path.join(__dirname, 'videos');
                const processedDir = path.join(videoDir, 'processed');
                const streamName = newVideo.substring(4); // Extract stream name
                const streamDir = path.join(processedDir, streamName);

                // Extra security: ensure the resolved path is within the processed directory
                const normalizedPath = path.normalize(streamDir);
                if (!normalizedPath.startsWith(processedDir)) {
                    console.error(`Path traversal attempt from ${clientInfo.ip}: ${newVideo}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid video path' }));
                    break;
                }

                // Check if the directory exists and contains master.m3u8
                fs.access(path.join(streamDir, 'master.m3u8'), fsSync.constants.R_OK) // Use async fs.access
                    .then(() => {
                        console.log(`Admin at ${clientInfo.ip} action: Change video to HLS stream ${newVideo}`);
                        masterState.currentVideo = newVideo;
                        masterState.currentTime = 0;
                        masterState.isPlaying = false; // Start paused
                        masterState.lastUpdateTime = Date.now();
                        broadcastState(); // Broadcast immediate change. Timers won't reschedule.
                        // Reset playback rate to normal when changing videos
                        masterState.playbackRate = MAX_PLAYBACK_RATE;
                    })
                    .catch(err => {
                        console.error(`Admin at ${clientInfo.ip} requested non-existent or unreadable HLS stream: ${newVideo}`, err);
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: `HLS stream not found or unreadable: ${newVideo}` }));
                        }
                    });
                break;
            case 'requestVideoList':
                // Only admin can request this (already checked above)
                console.log(`Admin at ${clientInfo.ip} requested video list`);
                getVideoList().then(videoList => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'videoList', videos: videoList }));
                    }
                }).catch(err => {
                     console.error(`Error getting video list on request from ${clientInfo.ip}:`, err);
                     if (ws.readyState === WebSocket.OPEN) {
                         ws.send(JSON.stringify({ type: 'error', message: 'Could not retrieve video list' }));
                     }
                });
                break;
            case 'requestViewerList':
                // Only admin can request this (already checked above)
                console.log(`Admin at ${clientInfo.ip} requested viewer list`);
                sendViewerList(ws);
                break;
            case 'requestSync':
                 console.log(`Client ${clientInfo.ip} requested state sync.`);
                 sendSyncStateToClient(ws, clientInfo); // Send state just to requester & reschedule their next sync
                 break;
            // Handle client time updates
            case 'clientTimeUpdate':
                if (typeof parsedMessage.clientTime === 'number' && !isNaN(parsedMessage.clientTime)) {
                    const clientTime = parsedMessage.clientTime;
                    const serverTime = getEffectiveTime();
                    const drift = clientTime - serverTime; // Positive drift means client is ahead
                    
                    // Update client information regardless of playing state
                    clientInfo.lastDrift = drift;
                    clientInfo.lastReportedTime = clientTime;
                    
                    // Update client name if provided and different
                    if (parsedMessage.name && parsedMessage.name !== clientInfo.name) {
                        clientInfo.name = parsedMessage.name.substring(0, 30); // Limit to 30 chars
                    }
                    
                    // Only adjust sync intervals if the video is playing
                    if (masterState.isPlaying) {
                        // Adjust sync interval based on drift
                        let intervalAdjusted = false;
                        if (Math.abs(drift) > DRIFT_THRESHOLD_HIGH && clientInfo.currentSyncInterval > MIN_SYNC_INTERVAL) {
                            // High drift, need to sync more often
                            clientInfo.currentSyncInterval = Math.max(MIN_SYNC_INTERVAL, clientInfo.currentSyncInterval - SYNC_INTERVAL_ADJUST_STEP);
                            intervalAdjusted = true;
                            console.log(`High drift (${drift.toFixed(2)}s) for ${clientInfo.ip}. Reducing sync interval to ${clientInfo.currentSyncInterval}ms.`);
                        } else if (Math.abs(drift) < DRIFT_THRESHOLD_LOW && clientInfo.currentSyncInterval < MAX_SYNC_INTERVAL) {
                            // Low drift, can sync less often
                            clientInfo.currentSyncInterval = Math.min(MAX_SYNC_INTERVAL, clientInfo.currentSyncInterval + SYNC_INTERVAL_ADJUST_STEP);
                            intervalAdjusted = true;
                            console.log(`Low drift (${drift.toFixed(2)}s) for ${clientInfo.ip}. Increasing sync interval to ${clientInfo.currentSyncInterval}ms.`);
                        }

                        // If interval was adjusted, reschedule the next sync immediately with the new interval
                        if (intervalAdjusted) {
                            scheduleNextSync(ws, clientInfo);
                        }
                    }
                    
                    // Always notify admins of updated viewer information, even when paused
                    clients.forEach((info, clientWs) => {
                        if (info.role === 'admin' && clientWs.readyState === WebSocket.OPEN) {
                            sendViewerList(clientWs);
                        }
                    });
                } else {
                    console.warn(`Invalid clientTimeUpdate received from ${clientInfo.ip}:`, parsedMessage);
                }
                break;
            default:
                console.log(`Unhandled message type: ${parsedMessage.type} from ${clientInfo.ip}`);
                ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${parsedMessage.type}` }));
        }

    });

    ws.on('close', () => {
        const clientInfo = clients.get(ws);
        const role = clientInfo ? clientInfo.role : 'unknown';
        const ip = clientInfo ? clientInfo.ip : clientIp;
        const name = clientInfo ? clientInfo.name : 'Anonymous';
        console.log(`Client (${role}) ${name} from ${ip} disconnected`);
        
        if (clientInfo && clientInfo.syncTimerId) {
            clearTimeout(clientInfo.syncTimerId); // Clear timer on disconnect
        }
        clearTimeout(authTimeout);
        clients.delete(ws);
        
        // Notify admins that a viewer has disconnected
        clients.forEach((info, clientWs) => {
            if (info.role === 'admin' && clientWs.readyState === WebSocket.OPEN) {
                sendViewerList(clientWs);
            }
        });
    });

    ws.on('error', (error) => {
        const clientInfo = clients.get(ws);
        const role = clientInfo ? clientInfo.role : 'unknown';
        const ip = clientInfo ? clientInfo.ip : clientIp;
        const name = clientInfo ? clientInfo.name : 'Anonymous';
        console.error(`WebSocket error for client (${role}) ${name} from ${ip}:`, error);
        
        if (clientInfo && clientInfo.syncTimerId) {
            clearTimeout(clientInfo.syncTimerId); // Clear timer on error
        }
        clearTimeout(authTimeout);
        clients.delete(ws);
        
        // Notify admins that a viewer has disconnected
        clients.forEach((info, clientWs) => {
            if (info.role === 'admin' && clientWs.readyState === WebSocket.OPEN) {
                sendViewerList(clientWs);
            }
        });
    });
});

// --- Auto-Encoding Logic ---

const encodingQueue = new Set(); // Keep track of files currently being encoded

async function scanAndEncodeVideos() {
    console.log('Scanning for unprocessed videos...');
    const videoDir = path.join(__dirname, 'videos');
    const processedDir = path.join(videoDir, 'processed');
    const allowedInputExtensions = ['.mp4', '.mkv'];

    try {
        await fs.mkdir(processedDir, { recursive: true }); // Ensure processed exists
        const entries = await fs.readdir(videoDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isFile()) {
                const inputFile = entry.name;
                const inputExt = path.extname(inputFile).toLowerCase();

                if (allowedInputExtensions.includes(inputExt)) {
                    // Check if already being processed
                    if (encodingQueue.has(inputFile)) {
                        console.log(`Skipping ${inputFile}, already in encoding queue.`);
                        continue;
                    }
                    
                    const outputName = path.basename(inputFile, inputExt).replace(/[^\w-]/g, "_"); // Sanitize
                    const outputDir = path.join(processedDir, outputName);
                    const masterPlaylistPath = path.join(outputDir, 'master.m3u8');

                    try {
                        await fs.access(masterPlaylistPath); // Check if HLS playlist exists
                        // console.log(`HLS stream already exists for ${inputFile}`);
                    } catch (err) {
                        // HLS does not exist, needs encoding
                        console.log(`Found unprocessed video: ${inputFile}. Adding to ABR HLS encoding queue.`);
                        encodingQueue.add(inputFile); // Add to queue

                        // Start encoding asynchronously, don't wait for all to finish
                        videoEncoder.createHLSStream(inputFile, outputName)
                            .then(async (masterPlaylistPath) => { // Resolves with master playlist path now
                                console.log(`Successfully created ABR HLS stream for ${inputFile}. Master Playlist: ${masterPlaylistPath}`);

                                // Determine stream name from playlist path for thumbnail
                                const streamName = path.basename(path.dirname(masterPlaylistPath));

                                // Optionally create thumbnail after successful HLS encoding
                                try {
                                    await videoEncoder.createThumbnail(inputFile, streamName, 1);
                                    console.log(`Successfully created thumbnail for ${streamName}`);
                                } catch (thumbErr) {
                                    console.error(`Failed to create thumbnail for ${streamName}:`, thumbErr);
                                }
                                // Update video list after successful encoding
                                await getVideoList();
                                // TODO: Notify admin?
                            })
                            .catch(encodeErr => {
                                console.error(`Error creating HLS stream for ${inputFile}:`, encodeErr);
                            })
                            .finally(() => {
                                encodingQueue.delete(inputFile); // Remove from queue regardless of outcome
                            });
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error scanning videos directory:', err);
    }
    console.log('Initial video scan complete.');
}

// Start the server
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    console.log(`Access the client at http://localhost:${PORT}`);

    // Perform initial video scan and encoding AFTER server starts listening
    scanAndEncodeVideos().then(() => {
         // Update list after initial scan attempt (might not have new videos yet if encoding takes time)
         return getVideoList();
    }).then(initialList => {
        console.log("Initial video list populated after scan.");
         if (!masterState.currentVideo && initialList.length > 0) {
             console.log(`Initial default video set to: ${initialList[0]}`);
         }
    }).catch(err => {
        console.error("Error during initial video scan/list population:", err);
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server and WebSocket connections');
    stopRateAdjustment(); // Stop rate adjustment timer
    wss.clients.forEach(client => {
        try {
            client.close(1000, 'Server shutting down');
        } catch (err) {
            console.error('Error closing client connection:', err);
        }
    });
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// Basic error handling for the server itself
server.on('error', (error) => {
    console.error('Server error:', error);
});