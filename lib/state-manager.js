const WebSocket = require('ws');
// Constants for state management (consider moving to a shared config or passing in constructor)
const DEFAULT_SYNC_INTERVAL = 1000;
const MIN_SYNC_INTERVAL = 1000;
const MAX_SYNC_INTERVAL = 1000;
const DRIFT_THRESHOLD_LOW = 0.5;
const DRIFT_THRESHOLD_HIGH = 1.5;
const SYNC_INTERVAL_ADJUST_STEP = 1000;
const MIN_PLAYBACK_RATE = 0.9;
const MAX_PLAYBACK_RATE = 1.0;
const PLAYBACK_RATE_ADJUST_STEP = 0.01;
const RATE_ADJUSTMENT_INTERVAL = 1000;
const CLIENT_BEHIND_THRESHOLD = -1.0;
const MASTER_STATE_SYNC_INTERVAL = 5000; // How often to broadcast master state to everyone (ms)

class StateManager {
    constructor(logger, options = {}) {
        this.logger = logger;
        this.masterState = {
            currentVideo: null,
            currentTime: 0,
            isPlaying: false,
            lastUpdateTime: Date.now(),
            playbackRate: MAX_PLAYBACK_RATE // Start at normal speed
        };
        // Map<string, { id, ws, role, ip, name, token, lastDrift, lastReportedTime, isPlaying, playbackRate, currentSyncInterval, syncTimerId, missedHeartbeats }>
        this.connectedClients = new Map();
        this.rateAdjustTimerId = null;
        this.masterBroadcastTimerId = null;

        this.websocketServer = null; // Will be set later via dependency injection

        this.logger.info('StateManager initialized.', 'state');
    }

    // Dependency injection for WebSocketServer to avoid circular dependency
    setWebSocketServer(wssInstance) {
        this.websocketServer = wssInstance;
        this.logger.info('WebSocketServer instance injected into StateManager.', 'state');
    }

    // --- Client Management ---
    addClient(clientId, clientInfo) {
        const defaultClientState = {
            role: 'unknown',
            ip: 'unknown',
            name: 'Anonymous',
            token: null,
            lastDrift: 0,
            lastReportedTime: 0,
            isPlaying: false,
            playbackRate: 1.0,
            currentSyncInterval: DEFAULT_SYNC_INTERVAL,
            syncTimerId: null,
            missedHeartbeats: 0 // Initialize heartbeat counter
        };
        this.connectedClients.set(clientId, { ...defaultClientState, ...clientInfo });
        this.logger.info(`Client added: ${clientInfo.name} (${clientInfo.role}) from ${clientInfo.ip}. Total clients: ${this.connectedClients.size}`, 'state');

        // If this is the first client and master is playing, start adjustments
        if (this.connectedClients.size === 1 && this.masterState.isPlaying) {
            this.startRateAdjustment();
            if (this.websocketServer) this.websocketServer.startMasterStateBroadcast();
        }
    }

    getClient(clientId) {
        return this.connectedClients.get(clientId);
    }

    // New method to find client ID by WebSocket object
    getClientIdByWs(ws) {
        for (const [id, clientInfo] of this.connectedClients.entries()) {
            if (clientInfo.ws === ws) {
                return id;
            }
        }
        return null;
    }

    // getClient, but by WebSocket object. Sometimes we only have the ws object.
    getClientById(ws) {
        const clientId = this.getClientIdByWs(ws);
        if (clientId) {
            return this.getClient(clientId);
        }
        return null;
    }


    updateClientInfo(clientId, updates) {
        if (this.connectedClients.has(clientId)) {
            const currentInfo = this.connectedClients.get(clientId);
            this.connectedClients.set(clientId, { ...currentInfo, ...updates });
            return true;
        }
        return false;
    }

    removeClient(clientId) {
        const clientInfo = this.connectedClients.get(clientId);
        if (clientInfo) {
            if (clientInfo.syncTimerId) {
                clearTimeout(clientInfo.syncTimerId);
            }
            this.connectedClients.delete(clientId);
            this.logger.info(`Client removed: ${clientInfo.name} (${clientInfo.role}) from ${clientInfo.ip}. Total clients: ${this.connectedClients.size}`, 'state');

            // Stop adjustments if no clients are left
            if (this.connectedClients.size === 0) {
                this.stopRateAdjustment();
                if (this.websocketServer) this.websocketServer.stopMasterStateBroadcast();
                 // Optionally pause the master state if no clients are connected
                 // if (this.masterState.isPlaying) { ... }
            }
            return true;
        }
        return false;
    }

    getAllClientsInfo() {
        const clientsArray = [];
        this.connectedClients.forEach((info, clientId) => {
            if (info.ws.readyState === WebSocket.OPEN) { // Ensure socket is open
                 clientsArray.push({
                     id: clientId,
                     role: info.role,
                     name: info.name,
                     ip: info.ip,
                     currentTime: info.lastReportedTime,
                     drift: info.lastDrift,
                     isPlaying: info.isPlaying,
                     playbackRate: info.playbackRate
                 });
            }
        });
        return clientsArray;
    }

    // --- Master State Management ---
    getMasterState() {
        return {
            ...this.masterState,
            // Calculate effective time when state is requested
            targetTime: this.getEffectiveTime()
        };
    }

    setMasterState(newState) {
        const prevState = { ...this.masterState };
        const now = Date.now();
        let stateChanged = false;

        // Update current time before changing play state or video
        if (this.masterState.isPlaying && (newState.isPlaying === false || newState.currentVideo !== this.masterState.currentVideo)) {
             const effectiveTime = this.getEffectiveTime();
             if (this.masterState.currentTime !== effectiveTime) {
                 this.masterState.currentTime = effectiveTime;
                 stateChanged = true;
             }
        }

        // Apply specific updates
        if (newState.currentVideo !== undefined && newState.currentVideo !== this.masterState.currentVideo) {
            this.masterState.currentVideo = newState.currentVideo;
            this.masterState.currentTime = 0; // Reset time on video change
            this.masterState.isPlaying = false; // Start paused
            this.masterState.playbackRate = MAX_PLAYBACK_RATE; // Reset rate
            this.masterState.lastUpdateTime = now;
            stateChanged = true;
            this.logger.info(`Master state: Video changed to ${newState.currentVideo}`, 'state');
            // Stop adjustments when video changes
            this.stopRateAdjustment();
            if (this.websocketServer) this.websocketServer.stopMasterStateBroadcast();
        }
        if (newState.isPlaying !== undefined && newState.isPlaying !== this.masterState.isPlaying) {
            this.masterState.isPlaying = newState.isPlaying;
            this.masterState.lastUpdateTime = now; // Update time when play state changes
            stateChanged = true;
            this.logger.info(`Master state: Playing set to ${newState.isPlaying}`, 'state');
            if (newState.isPlaying) {
                this.startRateAdjustment();
                 if (this.websocketServer) this.websocketServer.startMasterStateBroadcast();
            } else {
                this.stopRateAdjustment();
                 if (this.websocketServer) this.websocketServer.stopMasterStateBroadcast();
                // Reset rate to normal when pausing
                if (this.masterState.playbackRate !== MAX_PLAYBACK_RATE) {
                    this.masterState.playbackRate = MAX_PLAYBACK_RATE;
                    this.logger.info('Master state: Reset playback rate to normal on pause.', 'state');
                }
            }
        }
        if (newState.seekTime !== undefined) {
            this.masterState.currentTime = Math.max(0, newState.seekTime);
            this.masterState.lastUpdateTime = now;
            stateChanged = true;
            this.logger.info(`Master state: Seek to ${newState.seekTime.toFixed(2)}s`, 'state');
        }

        // If any significant state changed, broadcast immediately
        if (stateChanged && this.websocketServer) {
            this.websocketServer.broadcastState();
        }

        return stateChanged;
    }

    // Calculate the effective current time based on master state
    getEffectiveTime() {
        let actualCurrentTime = this.masterState.currentTime;
        if (this.masterState.isPlaying) {
            const timeDiffSeconds = (Date.now() - this.masterState.lastUpdateTime) / 1000;
            actualCurrentTime += timeDiffSeconds * this.masterState.playbackRate;
        }
        // TODO: Check against video duration if available?
        return Math.max(0, actualCurrentTime);
    }

    // --- Playback Rate Adjustment ---
    adjustPlaybackRate() {
        if (!this.masterState.isPlaying || this.connectedClients.size === 0) {
            return; // Only adjust if playing and clients are connected
        }

        let clientsBehind = 0;
        let clientsAhead = 0;
        let totalClientsWithData = 0;

        this.connectedClients.forEach((clientInfo) => {
            if (clientInfo.lastDrift !== undefined && clientInfo.lastDrift !== null) {
                totalClientsWithData++;
                // Negative drift means client is behind server
                if (clientInfo.lastDrift < CLIENT_BEHIND_THRESHOLD) {
                    clientsBehind++;
                } else if (clientInfo.lastDrift > DRIFT_THRESHOLD_LOW) { // Consider slightly ahead as ahead
                    clientsAhead++;
                }
            }
        });

        if (totalClientsWithData === 0) {
            // No drift data, reset to normal rate if needed
            if (this.masterState.playbackRate < MAX_PLAYBACK_RATE) {
                this.masterState.playbackRate = MAX_PLAYBACK_RATE;
                this.logger.info('No client drift data. Resetting server playback rate to normal.', 'sync');
                this.masterState.lastUpdateTime = Date.now(); // Update time marker
                 if (this.websocketServer) this.websocketServer.broadcastState(); // Broadcast rate change
            }
            return;
        }

        const behindRatio = clientsBehind / totalClientsWithData;
        let rateChanged = false;

        // If a significant portion is behind, slow down
        if (behindRatio > 0.25 && this.masterState.playbackRate > MIN_PLAYBACK_RATE) {
            this.masterState.playbackRate = Math.max(MIN_PLAYBACK_RATE, this.masterState.playbackRate - PLAYBACK_RATE_ADJUST_STEP);
            this.logger.info(`${clientsBehind}/${totalClientsWithData} clients behind. Slowing server rate to ${this.masterState.playbackRate.toFixed(3)}x`, 'sync');
            rateChanged = true;
        }
        // If few are behind or more are ahead, speed up towards normal
        else if ((behindRatio < 0.1 || clientsAhead > clientsBehind) && this.masterState.playbackRate < MAX_PLAYBACK_RATE) {
            this.masterState.playbackRate = Math.min(MAX_PLAYBACK_RATE, this.masterState.playbackRate + PLAYBACK_RATE_ADJUST_STEP);
            this.logger.info(`Few clients behind (${behindRatio.toFixed(2)}). Increasing server rate to ${this.masterState.playbackRate.toFixed(3)}x`, 'sync');
            rateChanged = true;
        }

        if (rateChanged) {
            // Update time marker before broadcasting the new rate
            this.masterState.currentTime = this.getEffectiveTime();
            this.masterState.lastUpdateTime = Date.now();
            if (this.websocketServer) this.websocketServer.broadcastState();
        }
    }

    startRateAdjustment() {
        this.stopRateAdjustment(); // Stop any existing timer
        this.logger.info(`Starting playback rate adjustment checks every ${RATE_ADJUSTMENT_INTERVAL}ms`, 'sync');
        this.rateAdjustTimerId = setInterval(() => this.adjustPlaybackRate(), RATE_ADJUSTMENT_INTERVAL);
        this.rateAdjustTimerId.unref(); // Allow Node to exit
    }

    stopRateAdjustment() {
        if (this.rateAdjustTimerId) {
            clearInterval(this.rateAdjustTimerId);
            this.rateAdjustTimerId = null;
            this.logger.info('Stopped playback rate adjustment checks', 'sync');
        }
    }

     // --- Client Sync Interval Adjustment ---
     adjustClientSyncInterval(clientId, clientInfo) {
        if (!this.masterState.isPlaying || clientInfo.lastDrift === undefined || clientInfo.lastDrift === null) {
            return false; // No adjustment if paused or no drift data
        }

        const drift = clientInfo.lastDrift;
        let newInterval = clientInfo.currentSyncInterval;
        let intervalAdjusted = false;

        if (Math.abs(drift) > DRIFT_THRESHOLD_HIGH && clientInfo.currentSyncInterval > MIN_SYNC_INTERVAL) {
            // High drift, sync faster
            newInterval = Math.max(MIN_SYNC_INTERVAL, clientInfo.currentSyncInterval - SYNC_INTERVAL_ADJUST_STEP);
            intervalAdjusted = true;
        } else if (Math.abs(drift) < DRIFT_THRESHOLD_LOW && clientInfo.currentSyncInterval < MAX_SYNC_INTERVAL) {
            // Low drift, sync slower
            newInterval = Math.min(MAX_SYNC_INTERVAL, clientInfo.currentSyncInterval + SYNC_INTERVAL_ADJUST_STEP);
            intervalAdjusted = true;
        }

        if (intervalAdjusted && newInterval !== clientInfo.currentSyncInterval) {
            this.logger.debug(`Drift (${drift.toFixed(2)}s) for ${clientInfo.ip}. Adjusting sync interval to ${newInterval}ms.`, 'sync');
            this.updateClientInfo(clientId, { currentSyncInterval: newInterval });
            return true; // Interval was changed
        }
        return false; // Interval not changed
    }

}

module.exports = StateManager; 