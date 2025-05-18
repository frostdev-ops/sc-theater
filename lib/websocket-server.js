const WebSocket = require('ws');

// Constants (Consider moving to a shared config or passing in constructor)
const HEARTBEAT_INTERVAL_MARGIN = 35000; // Give client a bit longer than 30s to send heartbeat
const HEARTBEAT_CHECK_INTERVAL = 10000;
const MASTER_STATE_SYNC_INTERVAL = 5000; // How often to broadcast master state to everyone (ms)
const AUTH_TIMEOUT = 5000; // ms

class WebSocketServer {
    constructor(httpServer, logger, authManager, stateManager, videoService) {
        this.logger = logger;
        this.authManager = authManager;
        this.stateManager = stateManager;
        this.videoService = videoService;
        this.wss = new WebSocket.Server({ server: httpServer });
        this.heartbeatIntervalId = null;
        this.masterBroadcastTimerId = null;

        // Inject dependencies into StateManager
        this.stateManager.setWebSocketServer(this);

        this.logger.info('WebSocket server initialized.', 'websocket');
        this._setupEventHandlers();
    }

    _setupEventHandlers() {
        this.wss.on('connection', this.handleConnection.bind(this));
        this.wss.on('error', (error) => {
            this.logger.error('WebSocket Server Error:', error, 'websocket');
            // Handle specific errors if needed, e.g., EADDRINUSE
        });
        this.wss.on('close', () => {
            this.logger.warn('WebSocket Server shutting down.', 'websocket');
            this.stopHeartbeatChecks();
            this.stopMasterStateBroadcast();
        });
    }

    handleConnection(ws, req) {
        const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for']; // Handle proxies
        this.logger.info(`Client connecting from ${clientIp}...`, 'connection');

        // Temporary info until authenticated
        const tempClientInfo = { ip: clientIp, ws: ws }; 

        const authTimeout = setTimeout(() => {
            if (!this.stateManager.getClient(ws)) { // Check StateManager if client exists
                this.logger.warn(`Client from ${clientIp} failed to authenticate in ${AUTH_TIMEOUT}ms. Disconnecting.`, 'auth');
                this.send(ws, { type: 'error', message: 'Authentication timed out' });
                ws.terminate();
            }
        }, AUTH_TIMEOUT);

        ws.on('message', (message) => {
            this.handleMessage(ws, message, tempClientInfo, authTimeout);
        });

        ws.on('close', (code, reason) => {
            clearTimeout(authTimeout); // Clear timer on disconnect
            this.handleDisconnect(ws, code, reason ? reason.toString() : 'Unknown Reason');
        });

        ws.on('error', (error) => {
            this.logger.error(`WebSocket error for client ${clientIp}:`, error, 'websocket');
            clearTimeout(authTimeout);
             // Let the 'close' event handle cleanup
             ws.terminate(); // Force close on error
        });
        
        // Initialize missed heartbeats for ping/pong or other methods
        // ws.missedHeartbeats = 0; // Or manage within stateManager
    }

    async handleMessage(ws, message, tempClientInfo, authTimeout) {
        let parsedMessage;
        const clientIp = tempClientInfo.ip;
        try {
            parsedMessage = JSON.parse(message);
            if (!parsedMessage.type || typeof parsedMessage.type !== 'string') {
                throw new Error('Invalid message format: Missing or invalid "type"');
            }
            this.logger.debug(`Received msg type '${parsedMessage.type}' from ${clientIp}`, 'websocket');
        } catch (e) {
            this.logger.error(`Invalid message format from ${clientIp}: ${e.message}`, 'websocket', { raw: message.toString() });
            this.send(ws, { type: 'error', message: 'Invalid message format' });
            return;
        }

        // --- Authentication Handling ---
        if (parsedMessage.type === 'auth') {
             if (this.stateManager.getClient(ws)) {
                 this.logger.warn(`Client ${clientIp} attempting to re-authenticate.`, 'auth');
                 this.send(ws, { type: 'error', message: 'Already authenticated' });
                 return;
             }

            let authResult = null;
            let name = 'Anonymous';

            // Try token auth first
            if (parsedMessage.token) {
                const session = this.authManager.validateSession(parsedMessage.token);
                if (session) {
                    authResult = { role: session.role, name: session.name, token: parsedMessage.token };
                    this.logger.info(`Token auth SUCCESS for ${clientIp} as ${session.role} (${session.name})`, 'auth');
                } else {
                    this.logger.warn(`Token auth FAIL for ${clientIp}. Token: ${parsedMessage.token.substring(0, 8)}...`, 'auth');
                    this.send(ws, { type: 'auth_fail', message: 'Invalid or expired session token' });
                    return; // Don't proceed to password if token was provided but invalid
                }
            }
            // Else, try password auth
            else if (parsedMessage.password) {
                const role = this.authManager.validatePassword(parsedMessage.password);
                if (role) {
                     name = parsedMessage.name && typeof parsedMessage.name === 'string' ?
                            parsedMessage.name.trim().substring(0, 30) : 'Anonymous';
                     const token = this.authManager.createSession(role, name);
                     authResult = { role, name, token };
                     this.logger.info(`Password auth SUCCESS for ${clientIp} as ${role} (${name}). New session created.`, 'auth');
                } else {
                    this.logger.warn(`Password auth FAIL for ${clientIp}: Invalid password`, 'auth');
                    this.send(ws, { type: 'auth_fail', message: 'Invalid password' });
                    return;
                }
            }

            // Check if any auth method succeeded
            if (!authResult) {
                this.logger.warn(`Auth FAIL for ${clientIp}: No valid credentials provided.`, 'auth');
                this.send(ws, { type: 'auth_fail', message: 'Authentication required' });
                return;
            }

            // --- Authentication Success --- 
            clearTimeout(authTimeout); // Clear the auth timer
            
            // Add client to state manager
            const clientInfo = {
                role: authResult.role,
                ip: clientIp,
                name: authResult.name,
                token: authResult.token,
                 // Initialize state fields (StateManager constructor sets defaults)
            };
            this.stateManager.addClient(ws, clientInfo);

            // Send auth success message
            this.send(ws, { type: 'auth_success', ...authResult });

            // Send initial state immediately
            const currentClientInfo = this.stateManager.getClient(ws);
            this.sendSyncStateToClient(ws, currentClientInfo);

            // Send lists if admin
            if (authResult.role === 'admin') {
                this.sendInitialAdminData(ws);
            }

            // Notify other admins of the new connection
            this.broadcastViewerListToAdmins(ws); 

            return; // Auth message handled
        }

        // --- Authenticated Message Handling ---
        const clientInfo = this.stateManager.getClient(ws);
        if (!clientInfo) {
            this.logger.warn(`Received message type '${parsedMessage.type}' from unauthenticated client ${clientIp}. Ignoring.`, 'websocket');
            this.send(ws, { type: 'error', message: 'Not authenticated' });
            return;
        }
        
        // Reset heartbeat counter on any valid message
        if (clientInfo) {
            clientInfo.missedHeartbeats = 0;
        }

        // --- Admin-Only Messages ---
        const adminCommands = ['play', 'pause', 'seek', 'changeVideo', 'requestVideoList', 'requestViewerList', 'syncAll'];
        if (adminCommands.includes(parsedMessage.type) && clientInfo.role !== 'admin') {
            this.logger.warn(`Received admin command '${parsedMessage.type}' from non-admin ${clientInfo.name} (${clientIp}). Denying.`, 'auth');
            this.send(ws, { type: 'error', message: 'Permission denied' });
            return;
        }

        // --- General Message Handling ---
        try {
            switch (parsedMessage.type) {
                case 'play':
                    this.stateManager.setMasterState({ isPlaying: true });
                    break;
                case 'pause':
                    this.stateManager.setMasterState({ isPlaying: false });
                    break;
                case 'seek':
                    const seekTime = parseFloat(parsedMessage.time);
                    if (!isNaN(seekTime) && seekTime >= 0) {
                        this.stateManager.setMasterState({ seekTime });
                    } else {
                         this.logger.warn(`Invalid seek time from ${clientInfo.name}: ${parsedMessage.time}`, 'websocket');
                         this.send(ws, { type: 'error', message: 'Invalid seek time' });
                    }
                    break;
                case 'changeVideo':
                    const newVideo = parsedMessage.video;
                    if (this.videoService.isValidVideoFilename(newVideo)) {
                        // Further check if stream actually exists could be added here if needed,
                        // but StateManager setting it will trigger broadcast,
                        // client will load it, and handle potential HLS errors.
                        this.stateManager.setMasterState({ currentVideo: newVideo });
                    } else {
                         this.logger.warn(`Invalid video filename from ${clientInfo.name}: ${newVideo}`, 'websocket');
                         this.send(ws, { type: 'error', message: 'Invalid video filename format' });
                    }
                    break;
                case 'requestVideoList':
                    this.sendVideoList(ws);
                    break;
                case 'requestViewerList':
                     this.sendViewerList(ws);
                     break;
                case 'requestSync':
                     this.sendSyncStateToClient(ws, clientInfo);
                     break;
                case 'syncAll':
                    // Force broadcast of master state to all clients
                    this.logger.info('Admin triggered force sync for all clients', 'sync');
                    this.broadcastState();
                    break;
                case 'clientTimeUpdate':
                    this.handleClientTimeUpdate(ws, clientInfo, parsedMessage);
                    break;
                // Add ping handler if implementing client-side pings
                // case 'ping': 
                //     this.send(ws, { type: 'pong' });
                //     break; 
                default:
                    this.logger.warn(`Unhandled message type '${parsedMessage.type}' from ${clientInfo.name}`, 'websocket');
                    this.send(ws, { type: 'error', message: `Unknown message type: ${parsedMessage.type}` });
            }
        } catch (error) {
             this.logger.error(`Error processing message type ${parsedMessage.type} from ${clientInfo.name}:`, error, 'websocket');
             this.send(ws, { type: 'error', message: 'Internal server error processing message' });
        }
    }

    handleDisconnect(ws, code, reason) {
        const clientInfo = this.stateManager.getClient(ws);
        if (clientInfo) {
            this.logger.info(`Client disconnected: ${clientInfo.name} (${clientInfo.role}) from ${clientInfo.ip}. Code: ${code}, Reason: ${reason}`, 'connection');
            this.stateManager.removeClient(ws);
            this.broadcastViewerListToAdmins(ws); // Notify admins (excluding the disconnected ws)
        } else {
             this.logger.info(`Unauthenticated client disconnected. Code: ${code}, Reason: ${reason}`, 'connection');
        }
    }

    // --- Data Sending Functions ---
    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(data));
                return true;
            } catch (error) {
                this.logger.error('Error sending WebSocket message:', error, 'websocket');
                // Attempt to close the connection if send fails
                try { ws.terminate(); } catch (e) { /* ignore */ }
                this.handleDisconnect(ws, 1011, 'Send Error'); // Manually handle disconnect
                return false;
            }
        }
        return false;
    }

    broadcast(data, excludeWs = null) {
        const messageString = JSON.stringify(data);
        this.wss.clients.forEach((ws) => {
            if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                // Retrieve client info for logging purposes if needed
                // const clientInfo = this.stateManager.getClient(ws);
                // const logTarget = clientInfo ? `${clientInfo.name} (${clientInfo.ip})` : 'unknown client';
                try {
                    ws.send(messageString);
                } catch (error) {
                    this.logger.error(`Error broadcasting message to client:`, error, 'websocket');
                     try { ws.terminate(); } catch (e) { /* ignore */ }
                     this.handleDisconnect(ws, 1011, 'Broadcast Send Error');
                }
            }
        });
    }
    
    // Broadcast current master state
    broadcastState(excludeWs = null) {
        const state = this.stateManager.getMasterState(); // Gets state with effectiveTime
        const message = { type: 'syncState', ...state };
        this.logger.info('Broadcasting master state', 'sync', message);
        this.broadcast(message, excludeWs);
        // After broadcast, reschedule individual syncs
        this.wss.clients.forEach((clientWs) => {
             if (clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
                 const clientInfo = this.stateManager.getClient(clientWs);
                 if(clientInfo) this.scheduleNextSync(clientWs, clientInfo);
             }
        });
    }

    // Send sync state to a single client and schedule next
    sendSyncStateToClient(ws, clientInfo) {
        if (!clientInfo || ws.readyState !== WebSocket.OPEN) return;

        const state = this.stateManager.getMasterState();
        const message = { type: 'syncState', ...state };
        if (this.send(ws, message)) {
            this.scheduleNextSync(ws, clientInfo);
        }
    }

    // Schedule next sync for a client based on their interval
    scheduleNextSync(ws, clientInfo) {
        if (!clientInfo || ws.readyState !== WebSocket.OPEN) return;

        if (clientInfo.syncTimerId) {
            clearTimeout(clientInfo.syncTimerId);
            clientInfo.syncTimerId = null;
        }

        // Only schedule if master state is playing
        if (this.stateManager.masterState.isPlaying) {
             clientInfo.syncTimerId = setTimeout(() => {
                 // Re-fetch clientInfo in case it changed
                 const currentClientInfo = this.stateManager.getClient(ws);
                 if (currentClientInfo) {
                    this.sendSyncStateToClient(ws, currentClientInfo);
                 }
            }, clientInfo.currentSyncInterval);
             // Allow Node to exit even if timers are active
             clientInfo.syncTimerId.unref(); 
        }
    }
    
    // Send video list to a specific client (usually admin)
    async sendVideoList(ws) {
        try {
            const videoList = await this.videoService.getVideoList();
            this.send(ws, { type: 'videoList', videos: videoList });
        } catch (err) {
            this.logger.error('Error retrieving video list to send:', err, 'video');
            this.send(ws, { type: 'error', message: 'Failed to retrieve video list' });
        }
    }
    
    // Send viewer list to a specific admin client
    sendViewerList(adminWs) {
        const adminInfo = this.stateManager.getClient(adminWs);
        if (!adminInfo || adminInfo.role !== 'admin' || adminWs.readyState !== WebSocket.OPEN) {
             // this.logger.warn('Attempted to send viewer list to non-admin or disconnected socket.', 'websocket');
             return;
        }
        const viewers = this.stateManager.getAllClientsInfo();
        this.send(adminWs, { type: 'viewerList', viewers: viewers, count: viewers.length });
    }
    
    // Send viewer list to ALL connected admins
    broadcastViewerListToAdmins(excludeWs = null) {
        const viewers = this.stateManager.getAllClientsInfo();
        const message = { type: 'viewerList', viewers: viewers, count: viewers.length };
        this.stateManager.connectedClients.forEach((info, ws) => {
             if (info.role === 'admin' && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                 this.send(ws, message);
             }
        });
    }
    
    // Send initial video and viewer lists to a newly connected admin
    async sendInitialAdminData(ws) {
         this.logger.info('Sending initial data (video list, viewer list) to new admin.', 'admin');
         await this.sendVideoList(ws);
         this.sendViewerList(ws); // Send current viewer list
    }
    
    // Handle updates from client about their time/state
    handleClientTimeUpdate(ws, clientInfo, message) {
        const { clientTime, playbackRate, isPlaying, name } = message;

        // Validate data
        if (typeof clientTime !== 'number' || isNaN(clientTime) || clientTime < 0 ||
            typeof playbackRate !== 'number' || isNaN(playbackRate) || playbackRate <= 0 ||
            typeof isPlaying !== 'boolean') {
            this.logger.warn(`Invalid clientTimeUpdate data received from ${clientInfo.name}:`, message, 'websocket');
            return;
        }

        const serverTime = this.stateManager.getEffectiveTime();
        const drift = clientTime - serverTime;

        // Update client info in StateManager
        const updates = {
            lastDrift: drift,
            lastReportedTime: clientTime,
            isPlaying: isPlaying,
            playbackRate: playbackRate,
            missedHeartbeats: 0 // Reset heartbeat counter on time update
        };
        if (name && name !== clientInfo.name) {
            updates.name = name.substring(0, 30); // Update name if changed
        }
        this.stateManager.updateClientInfo(ws, updates);
        
        // Adjust this client's sync interval based on the new drift
        const intervalChanged = this.stateManager.adjustClientSyncInterval(ws, this.stateManager.getClient(ws)); 
        if (intervalChanged) {
            this.scheduleNextSync(ws, this.stateManager.getClient(ws)); // Reschedule immediately if interval changed
        }

        // Notify admins about the updated viewer state
        this.broadcastViewerListToAdmins();
    }
    
    // --- Heartbeat --- 
    startHeartbeatChecks() {
        this.stopHeartbeatChecks(); // Clear existing interval
        this.logger.info(`Starting heartbeat checks every ${HEARTBEAT_CHECK_INTERVAL}ms.`, 'connection');
        this.heartbeatIntervalId = setInterval(() => this.checkHeartbeats(), HEARTBEAT_CHECK_INTERVAL);
        this.heartbeatIntervalId.unref(); // Allow Node to exit
    }
    
    stopHeartbeatChecks() {
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
            this.logger.info('Stopped heartbeat checks.', 'connection');
        }
    }
    
    checkHeartbeats() {
        // This assumes missedHeartbeats is incremented here and reset on message/timeUpdate
        this.logger.debug(`Checking heartbeats for ${this.stateManager.connectedClients.size} clients...`, 'connection');
        this.stateManager.connectedClients.forEach((clientInfo, ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                clientInfo.missedHeartbeats++;
                if (clientInfo.missedHeartbeats > 2) { // Allow ~30 seconds of silence
                    this.logger.warn(`Client ${clientInfo.name} (${clientInfo.ip}) missed too many heartbeats. Terminating.`, 'connection');
                    ws.terminate(); // Force close
                     // Disconnect handling happens in 'close' event
                } else {
                     // Optional: Send ping if implementing server-side ping
                    // ws.ping((err) => { 
                    //    if (err) this.logger.error(`Ping error for ${clientInfo.name}:`, err); 
                    // }); 
                }
            } else {
                // Clean up clients that are no longer open but somehow still in the map
                 this.logger.warn(`Found non-open WebSocket during heartbeat check for ${clientInfo.name}. Removing.`, 'connection');
                 this.stateManager.removeClient(ws); 
            }
        });
    }

    // --- Master State Broadcast --- 
    startMasterStateBroadcast() {
         this.stopMasterStateBroadcast(); // Clear existing
         this.logger.info(`Starting periodic master state broadcast every ${MASTER_STATE_SYNC_INTERVAL}ms`, 'sync');
         this.masterBroadcastTimerId = setInterval(() => {
             if (this.stateManager.masterState.isPlaying && this.stateManager.connectedClients.size > 0) {
                 this.broadcastState();
             }
         }, MASTER_STATE_SYNC_INTERVAL);
         this.masterBroadcastTimerId.unref();
    }

    stopMasterStateBroadcast() {
         if (this.masterBroadcastTimerId) {
             clearInterval(this.masterBroadcastTimerId);
             this.masterBroadcastTimerId = null;
             this.logger.info('Stopped periodic master state broadcast', 'sync');
         }
    }
    
    // --- Shutdown --- 
    shutdown() {
         this.logger.warn('Initiating WebSocketServer shutdown.', 'shutdown');
         this.stopHeartbeatChecks();
         this.stopMasterStateBroadcast();
         // Close all client connections gracefully
         this.wss.clients.forEach(ws => {
             ws.close(1001, 'Server shutting down'); // 1001 = Going Away
         });
         // Close the server itself
         this.wss.close();
    }
}

module.exports = WebSocketServer; 