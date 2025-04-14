// --- Cookie Management ---

// Set a cookie with name, value and expiration days
function setCookie(name, value, days = 7, path = '/') {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=${path};SameSite=Strict`;
    logger.debug(`Cookie set: ${name} (expires in ${days} days)`);
}

// Delete a cookie by name
function deleteCookie(name, path = '/') {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path};SameSite=Strict`;
    logger.debug(`Cookie deleted: ${name}`);
}

// Get a cookie by name
function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

// --- Session Validation ---

// Try to validate session and auto-login
async function validateSession() {
    const sessionToken = getCookie('session_token');
    logger.debug('Validating session, token exists:', !!sessionToken, 'auth');

    if (!sessionToken) {
        logger.info('No session token found, skipping auto-login.', 'auth');
        return false;
    }

    try {
        logger.info('Attempting to validate session token with server...', 'auth');
        const response = await fetch('/api/validate-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            },
            body: JSON.stringify({ token: sessionToken })
        });

        if (!response.ok) {
            logger.warn('Session validation API call failed:', response.status, 'auth');
            // Clear invalid session cookie
            deleteCookie('session_token');
            return false;
        }

        const data = await response.json();

        if (data.valid) {
            logger.info('Session is valid, initiating WebSocket connection with token.', 'auth');
            // Connect WebSocket using the validated token (connectWebSocket is in websocket.js)
            connectWebSocket(null, data.name || getCookie('userName'), sessionToken);
            return true;
        } else {
            logger.warn('Server returned invalid session:', data.error || 'Unknown reason', 'auth');
            deleteCookie('session_token');
            return false;
        }
    } catch (error) {
        logger.error('Error during session validation API call:', error, 'auth');
        return false;
    }
}

// --- Authentication Handlers ---

// Handle successful authentication from WebSocket message
function handleAuthSuccess(message) {
    logger.info(`[Auth Success] Role: ${message.role}, Name: ${message.name}`, 'auth', message);
    isAuthenticated = true;
    userRole = message.role;
    userName = message.name || getCookie('userName') || `User_${Date.now().toString().slice(-4)}`; // Assign name if needed
    sessionToken = message.token;

    logger.debug(`[Auth Success] Updating UI and storing session.`, 'auth');
    roleText.textContent = `${userName} (${userRole})`;
    authContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    authError.textContent = '';
    statusIcon.style.backgroundColor = '#2ecc71'; // Green status icon

    // Store session token in cookie
    if (sessionToken) {
        setCookie('session_token', sessionToken, 7);
    }
     // Store username in cookie if not already set by user input during this session
     if (userName && !getCookie('userName')) {
        setCookie('userName', userName, 7); // Store for 7 days
     }

    // Request initial state after successful auth
    logger.debug('[Auth Success] Requesting initial sync state.', 'auth');
    sendControlMessage('requestSync'); // Request full state from server

    if (userRole === 'admin') {
        adminControls.classList.remove('hidden');
        requestViewerList(); // Request viewer list only for admin (ui.js)
        startSmoothTimeUpdates(); // Start smooth server time display (ui.js)
        startSmoothViewerTimeUpdates(); // Start smooth viewer list updates (ui.js)
        initializePlaybackControls(); // Setup admin controls (playback.js)
    } else {
        // Ensure admin controls are hidden for viewers
        adminControls.classList.add('hidden');
    }

    // Reset reconnection attempts on successful authentication
    resetReconnectionAttempts(); // This function needs to be defined in websocket.js
    startClientTimeUpdates(); // Start sending client time (playback.js)
}

// Handle authentication failure from WebSocket message
function handleAuthFailure(message) {
    logger.warn('Authentication failed: ' + (message.message || 'Invalid credentials'), 'auth');
    authError.textContent = message.message || 'Invalid password or username';

    // Clear potentially invalid session data
    sessionToken = null;
    deleteCookie('session_token');

    // Show login form again
    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden');

    // Optionally close the WebSocket connection if it's still open
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1008, "Authentication Failed");
    }
}

// Handle logout action
function logout() {
    logger.info('User initiated logout', 'auth');
    // Pause video playback before disconnecting
    if (videoPlayer) {
        videoPlayer.pause();
    }

    // Stop sending time updates
    stopClientTimeUpdates(); // (playback.js)
    stopSmoothTimeUpdates(); // (ui.js)
    stopSmoothViewerTimeUpdates(); // (ui.js)

    // Close WebSocket connection
    if (ws && ws.readyState !== WebSocket.CLOSED) {
        logger.debug('Closing WebSocket during logout.', 'connection');
        ws.close(1000, "User Logout"); // Normal closure
    }

    // Clear session data
    sessionToken = null;
    deleteCookie('session_token');
    userRole = null;
    isAuthenticated = false;
    userName = ''; // Clear username

    // Reset UI
    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden');
    adminControls.classList.add('hidden'); // Ensure admin controls are hidden
    passwordInput.value = '';
    // usernameInput.value = ''; // Optional: clear username field
    roleText.textContent = 'Not Connected';
    statusIcon.style.backgroundColor = '#e74c3c'; // Red status icon
    setStatusMessage('You have been logged out');
}

// --- Event Handlers ---

// Handle the submission of the login form
function handleAuthFormSubmit(event) {
    event.preventDefault();
    const password = passwordInput.value;
    const name = usernameInput.value.trim();
    authError.textContent = ''; // Clear previous errors

    if (!password) {
        authError.textContent = 'Please enter a password';
        return;
    }

    if (!name) {
        authError.textContent = 'Please enter your name';
        return;
    }

    logger.info(`Attempting login for user: ${name}`, 'auth');
    // Store username temporarily in global state
    userName = name;
    // Store in cookie immediately so it persists if connection succeeds
    setCookie('userName', name, 7);
    // Initiate WebSocket connection for password auth (websocket.js)
    connectWebSocket(password, name, null);
}

// Handler for the logout button click
function handleLogout() {
    logout();
} 