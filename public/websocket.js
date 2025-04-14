// --- WebSocket Connection & Reconnection ---

// Constants for reconnection
const MAX_RECONNECT_ATTEMPTS = 8;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
let reconnectAttempts = 0;
let connectionTimeout = null;

// Connect to WebSocket server
function connectWebSocket(password, name, token) {
    // Get the current hostname and correct port
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port}`;
    logger.info(`Attempting to connect WebSocket to: ${wsUrl}`, 'connection');

    // Store name in global state if provided during initial password auth
    if (name) {
        userName = name; // Update global userName
    }

    // Close any existing connection first
    if (ws) {
        try {
            logger.warn('Closing existing WebSocket connection before reconnecting.', 'connection');
            ws.close(1000, "Initiating new connection");
        } catch (e) {
            logger.error('Error closing existing WebSocket:', e, 'connection');
        }
        ws = null;
    }

    // Clear any existing connection timeout
    if (connectionTimeout) {
         clearTimeout(connectionTimeout);
         connectionTimeout = null;
    }

    // Create new WebSocket connection
    try {
        ws = new WebSocket(wsUrl);
    } catch (error) {
        logger.error('Failed to create WebSocket object:', error, 'connection');
        setStatusMessage('Failed to initialize connection. Refresh required.', true);
        // Optionally trigger a retry or show login again
        handleConnectionError();
        return;
    }

    // Set a connection timeout
    connectionTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            logger.error('WebSocket connection attempt timed out after 10 seconds', 'connection');
            try {
                ws.close(1001, "Connection Timeout"); // Going Away
            } catch (e) { /* Ignore close errors here */ }
            handleConnectionError(); // Use centralized error handler
        }
    }, 10000); // 10 second timeout

    // Assign event handlers
    ws.onopen = handleWebSocketOpen(password, name, token);
    ws.onmessage = handleWebSocketMessage;
    ws.onclose = handleWebSocketClose;
    ws.onerror = handleWebSocketError;
}

// Handle WebSocket opening and sending initial auth
function handleWebSocketOpen(password, name, token) {
    return () => {
        clearTimeout(connectionTimeout); // Clear connection timeout on successful open
        connectionTimeout = null;
        logger.info('WebSocket connection established successfully.', 'connection');
        setStatusMessage('Connected. Authenticating...');
        statusIcon.style.backgroundColor = '#f39c12'; // Yellow for authenticating

        // Wait a very short moment before sending auth, helps some environments
        setTimeout(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                logger.error(`WebSocket not open when trying to send auth. State: ${ws ? ws.readyState : 'null'}`, 'connection');
                setStatusMessage('Connection state error. Please retry.', true);
                handleConnectionError(); // Treat as error
                return;
            }

            // Send authentication message
            let authMessage;
            if (token) {
                logger.info(`Attempting authentication with TOKEN: ${token.substring(0, 8)}...`, 'auth');
                authMessage = { type: 'auth', token };
            } else {
                logger.info(`Attempting authentication with PASSWORD for user: ${name}`, 'auth');
                authMessage = { type: 'auth', password, name }; // name comes from connectWebSocket call
            }

            try {
                logger.debug('Sending auth message:', authMessage, 'auth');
                ws.send(JSON.stringify(authMessage));
            } catch (error) {
                 logger.error('Error sending auth message:', error, 'websocket');
                 setStatusMessage('Failed to send authentication.', true);
                 // Consider closing the connection or retrying
                 handleConnectionError();
            }
        }, 50); // Small delay
    };
}

// Handle incoming WebSocket messages and dispatch to handlers
function handleWebSocketMessage(event) {
    try {
        const messageData = event.data;
        let message;

        // logger.debug('[WebSocket Message] Received raw data:', 'websocket', messageData);

        try {
            message = JSON.parse(messageData);
        } catch (parseError) {
            logger.error('Error parsing WebSocket message JSON:', parseError.message, 'websocket', { rawData: messageData });
            return; // Skip processing malformed message
        }

        // logger.debug('[WebSocket Message] Parsed message:', 'websocket', message);

        // Basic message validation
        if (!message || typeof message.type !== 'string') {
            logger.warn('Received WebSocket message with missing or invalid type', 'websocket', message);
            return;
        }

        // Dispatch based on message type
        switch (message.type) {
            case 'auth_success':
                handleAuthSuccess(message); // (auth.js)
                break;
            case 'auth_fail':
                handleAuthFailure(message); // (auth.js)
                break;
            case 'syncState':
                handleSyncState(message); // (playback.js)
                break;
            case 'videoList':
                handleVideoList(message); // (ui.js)
                break;
            case 'viewerList':
                handleViewerList(message); // (ui.js)
                break;
            case 'error': // Generic server-sent error
                logger.error('Server reported error:', message.message || 'Unknown server error', 'websocket');
                showNotification(`Server Error: ${message.message || 'Unknown'}`, 'error'); // (ui.js)
                break;
            case 'pong': // Handle pong if implementing ping/pong
                 // logger.debug('Received pong from server.', 'websocket');
                 // Reset ping timeout logic here if needed
                 break;
            default:
                logger.warn('Received unknown WebSocket message type:', message.type, 'websocket', message);
        }
    } catch (err) {
        // Catch errors during message processing itself
        logger.error('Critical error processing WebSocket message:', err, 'websocket', { rawData: event?.data });
        // Avoid throwing further errors, just log
    }
}

// Handle WebSocket closure
function handleWebSocketClose(event) {
    logger.warn(`WebSocket connection closed. Code: ${event.code}, Reason: "${event.reason || 'No reason provided'}", Clean: ${event.wasClean}`, 'connection');
    clearTimeout(connectionTimeout); // Clear any pending connection timeout
    connectionTimeout = null;
    ws = null; // Clear the ws variable

    // Stop client-side activities that rely on the connection
    stopClientTimeUpdates(); // (playback.js)
    stopSmoothTimeUpdates(); // (ui.js)
    stopSmoothViewerTimeUpdates(); // (ui.js)

    // Decide whether to attempt reconnection
    // Don't reconnect if closure was clean (e.g., logout, server shutdown intent)
    // or if auth failed explicitly (code 1008 often used)
    // Reconnect on abnormal closures (e.g., 1006)
    if (isAuthenticated && event.code !== 1000 && event.code !== 1008) {
        logger.info('Connection lost unexpectedly. Attempting to reconnect...', 'connection');
        setStatusMessage('Connection lost. Attempting to reconnect...', true);
        statusIcon.style.backgroundColor = '#f39c12'; // Yellow for reconnecting
        reconnectWebSocket();
    } else if (event.code === 1008) { // Auth failed or invalid session
        logger.warn('Connection closed due to auth failure. Resetting UI.', 'auth');
        // UI reset should be handled by handleAuthFailure or logout
        // Ensure UI is in logged-out state
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
        adminControls.classList.add('hidden');
        statusIcon.style.backgroundColor = '#e74c3c'; // Red
        isAuthenticated = false; // Ensure state is updated
        userRole = null;
        sessionToken = null;
    } else {
        // Normal closure or deliberate disconnect
        logger.info('WebSocket connection closed normally or deliberately.', 'connection');
        setStatusMessage('Disconnected from server.', false);
        statusIcon.style.backgroundColor = '#e74c3c'; // Red for disconnected
        // Reset UI to disconnected state if not already handled by logout
        if (isAuthenticated) {
            logout(); // Ensure full logout state if disconnect happens while authenticated
        }
    }
}

// Handle WebSocket errors (usually connection errors)
function handleWebSocketError(error) {
    logger.error('WebSocket Error Occurred:', 'connection', error);
    clearTimeout(connectionTimeout); // Clear connection timeout on error
    connectionTimeout = null;

    // Check if the error occurred during connection attempt
    // readyState is CONNECTING (0) or CLOSED (3) after a failed attempt
    if (!ws || ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSED) {
        handleConnectionError();
    } else {
        // Error on an established connection (less common, often precedes close)
        setStatusMessage('WebSocket communication error.', true);
        // The onclose handler will likely trigger next for reconnection logic
    }
}

// Centralized handler for connection failures (timeout, error, immediate failure)
function handleConnectionError() {
     logger.warn('Handling connection error.', 'connection');
     // Try to close the WebSocket if it exists and isn't already closed
     if (ws && ws.readyState !== WebSocket.CLOSED) {
         try { ws.close(1001); } catch(e) { /* ignore */ }
     }
     ws = null;

     setStatusMessage('Connection failed. Trying to reconnect...', true);
     statusIcon.style.backgroundColor = '#f39c12'; // Yellow

     // Only attempt reconnect if previously authenticated or if token exists
     if (isAuthenticated || getCookie('session_token')) {
         reconnectWebSocket();
     } else {
         // No session, user needs to log in manually
         logger.info('Connection failed and no session token. Showing login.', 'auth');
         authContainer.classList.remove('hidden');
         appContainer.classList.add('hidden');
         adminControls.classList.add('hidden');
         setStatusMessage('Connection failed. Please log in.', true);
         statusIcon.style.backgroundColor = '#e74c3c'; // Red
     }
}

// Attempt reconnection with exponential backoff
function reconnectWebSocket() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        logger.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping attempts.`, 'connection');
        setStatusMessage('Could not reconnect to server. Please refresh the page.', true);
        statusIcon.style.backgroundColor = '#e74c3c'; // Red
        // Force logout state if stuck trying to reconnect
        logout();
        return;
    }

    // Calculate delay with exponential backoff and jitter
    const jitter = Math.random() * 0.5 + 0.75; // Random value between 0.75 and 1.25
    const delay = Math.min(30000, INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts)) * jitter; // Cap delay at 30s
    const delaySeconds = Math.round(delay / 1000);

    reconnectAttempts++;
    logger.info(`Attempting reconnect #${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delaySeconds} seconds...`, 'connection');
    setStatusMessage(`Reconnecting in ${delaySeconds}s... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, true);
    statusIcon.style.backgroundColor = '#f39c12'; // Yellow

    setTimeout(() => {
        logger.info(`Executing reconnect attempt #${reconnectAttempts}`, 'connection');
        // Try to reconnect using the last known session token if available
        const lastToken = getCookie('session_token');
        const lastUsername = getCookie('userName');

        if (lastToken) {
            connectWebSocket(null, lastUsername, lastToken);
        } else {
            // If no token, we shouldn't be in this reconnect loop, but handle defensively
            logger.error('Reconnect attempt without session token. Stopping.', 'connection');
            authContainer.classList.remove('hidden');
            appContainer.classList.add('hidden');
            setStatusMessage('Connection lost. Please log in again.', true);
             statusIcon.style.backgroundColor = '#e74c3c'; // Red
        }
    }, delay);
}

// Reset reconnection attempts (called on successful auth)
function resetReconnectionAttempts() {
    if (reconnectAttempts > 0) {
        logger.info('Connection successful, resetting reconnection attempts.', 'connection');
        reconnectAttempts = 0;
    }
}

// --- Sending Messages ---

// Send control message to server
function sendControlMessage(type, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        logger.warn(`Cannot send message: WebSocket not open or not initialized. State: ${ws ? ws.readyState : 'null'}`, 'websocket');
        // Avoid showing error for routine things like time updates if disconnected
        if (type !== 'clientTimeUpdate') {
            setStatusMessage('Not connected to server', true);
        }
        return false;
    }

    if (!isAuthenticated && type !== 'auth') {
        logger.warn(`Cannot send message type "${type}": Not authenticated.`, 'websocket');
        return false;
    }

    try {
        const message = { type, ...data };
        // Avoid logging every single time update message
        // if (type !== 'clientTimeUpdate') {
        //     logger.debug(`Sending WebSocket message: Type=${type}`, 'websocket', message);
        // }
        ws.send(JSON.stringify(message));
        return true;
    } catch (error) {
        logger.error(`Error sending WebSocket message: ${error.message}`, 'websocket', { type, data });
        setStatusMessage('Failed to send message to server', true);
        // Consider closing the connection if sending fails repeatedly
        return false;
    }
}

// Request a sync state update from the server
function requestSync() {
    logger.debug('Requesting sync state from server.', 'websocket');
    sendControlMessage('requestSync');
} 