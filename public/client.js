// DOM Elements
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const passwordForm = document.getElementById('password-form');
const passwordInput = document.getElementById('password');
const usernameInput = document.getElementById('username');
const authError = document.getElementById('auth-error');
// const roleRadios = document.getElementsByName('role'); // Removed
const roleText = document.getElementById('role-text');
const statusIcon = document.getElementById('status-icon');
const statusMessage = document.getElementById('status-message');
const videoPlayer = document.getElementById('video-player');
const adminControls = document.getElementById('admin-controls');
let playBtn = document.getElementById('play-btn');
let pauseBtn = document.getElementById('pause-btn');
const seekSlider = document.getElementById('seek-slider');
const timeDisplay = document.getElementById('time-display');
const videoList = document.getElementById('video-list');
const videoContainer = document.querySelector('.video-container');
// Add reference to theater mode button
const theaterModeBtn = document.getElementById('theater-mode-btn');
// New elements for viewer tracking
const viewerCount = document.getElementById('viewer-count');
const viewersList = document.getElementById('viewers-list');
const serverTimeDisplay = document.getElementById('server-time-display');
const logoutBtn = document.getElementById('logout-btn');

// Add to the DOM Elements section at the top
const autoplayFallbackOverlay = document.createElement('div');
autoplayFallbackOverlay.className = 'autoplay-fallback-overlay hidden';
autoplayFallbackOverlay.innerHTML = `
    <div class="autoplay-fallback-content">
        <h3>Autoplay Blocked</h3>
        <p>Your browser has blocked automatic playback.</p>
        <button id="manual-play-btn" class="btn">Click to Play</button>
    </div>
`;
document.body.appendChild(autoplayFallbackOverlay);
const manualPlayBtn = document.getElementById('manual-play-btn');

// Add this CSS to complement the overlay
// We'll add it inline since we're not editing the CSS file directly
const style = document.createElement('style');
style.textContent = `
    .autoplay-fallback-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
    }
    .autoplay-fallback-overlay.hidden {
        display: none;
    }
    .autoplay-fallback-content {
        background-color: #2c3e50;
        padding: 2rem;
        border-radius: 8px;
        max-width: 90%;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
    }
    #manual-play-btn {
        margin-top: 1rem;
        padding: 0.75rem 1.5rem;
        background-color: #3498db;
        border: none;
        color: white;
        font-weight: bold;
        border-radius: 4px;
        cursor: pointer;
    }
    #manual-play-btn:hover {
        background-color: #2980b9;
    }
`;
document.head.appendChild(style);

// Application State
let ws = null;
let userRole = null;
let isAuthenticated = false;
let currentVideo = null;
let syncThresholdSmall = 0.5; // Small desync threshold (0.5 to 1.5 seconds)
let syncThresholdModerate = 1.6; // Moderate desync threshold (1.6 to 3.0 seconds)
let syncThresholdLarge = 3.1; // Large desync threshold (3.1 to 7.0 seconds)
let syncThresholdJump = 10.0; // Very large desync threshold (over 10 seconds - just jump)
let isAdjusting = false; // Flag to prevent recursive sync
let isManuallyChangingTime = false; // Flag to prevent sync during manual seek
let hlsPlayer = null; // For HLS playback
let clientTimeUpdateIntervalId = null; // Timer for sending client time
const CLIENT_TIME_UPDATE_INTERVAL = 1000; // Send time every 1 second (changed from 5000ms)
let serverPlaybackRate = 1.0; // Track server's playback rate
let userName = ''; // Store the user's name
let connectedViewers = []; // Store data about connected viewers
let sessionToken = null; // Store session token
let masterState = null; // Track server state

// Add global variables for smooth time tracking
let lastServerTimeUpdate = 0;
let lastServerTime = 0;
let isAnimationFrameActive = false;
let viewerTimeEstimates = new Map(); // Maps viewer IPs to their estimated time data
let viewerListAnimationId = null; // Store the requestAnimationFrame ID
let currentViewerIps = new Set(); // Track current IPs to detect changes

// Remove LogManager class
// class LogManager { ... } // REMOVED (moved to utils.js)

// Create global logger instance for client
// REMOVE instantiation here, it will be created after utils.js is loaded
// const logger = new LogManager(); // REMOVED

// Remove formatTime function
// function formatTime(seconds, showDecimals = false) { ... } // REMOVED (moved to utils.js)

// Remove cookie functions
// function setCookie(name, value, days = 7, path = '/') { ... } // REMOVED (moved to auth.js)
// function deleteCookie(name, path = '/') { ... } // REMOVED (moved to auth.js)
// function getCookie(name) { ... } // REMOVED (moved to auth.js)

// Remove validateSession function
// async function validateSession() { ... } // REMOVED (moved to auth.js)

// Remove handleAuthSuccess function
// function handleAuthSuccess(message) { ... } // REMOVED (moved to auth.js)

// Remove handleAuthFailure function
// function handleAuthFailure(message) { ... } // REMOVED (moved to auth.js)

// Remove logout function
// function logout() { ... } // REMOVED (moved to auth.js)

// Remove connectWebSocket function
// function connectWebSocket(password, name, token) { ... } // REMOVED (moved to websocket.js)

// Remove sendControlMessage function
// function sendControlMessage(type, data = {}) { ... } // REMOVED (moved to websocket.js)

// Remove startClientTimeUpdates function
// function startClientTimeUpdates() { ... } // REMOVED (moved to playback.js / TBD)

// Remove sendTimeUpdate function
// function sendTimeUpdate() { ... } // REMOVED (moved to playback.js / TBD)

// Remove stopClientTimeUpdates function
// function stopClientTimeUpdates() { ... } // REMOVED (moved to playback.js / TBD)

// Remove requestViewerList function
// function requestViewerList() { ... } // REMOVED (moved to ui.js / TBD)

// Event Listeners
// Remove passwordForm submit listener
// passwordForm.addEventListener('submit', (e) => { ... }); // REMOVED (moved to auth.js)

// Video time update event
// videoPlayer.addEventListener('timeupdate', () => { ... }); // REMOVED (handled in DOMContentLoaded)

// Only admin can manually control the video
// Remove admin control listeners (play/pause/seek/video selection)
// if (userRole === 'admin') { ... } // REMOVED (partially moved to playback.js/ui.js)

// Prevent viewers from directly controlling playback via native controls
// Remove preventViewerControls function
// function preventViewerControls(event) { ... } // REMOVED (moved to playback.js)

// Remove prevention listeners
// videoPlayer.addEventListener('play', preventViewerControls); ... // REMOVED

// Initial setup on load
window.addEventListener('DOMContentLoaded', async () => {
    window.logger = new LogManager(); // Make logger global

    logger.info('DOM fully loaded and parsed.');
    
    // Add favicon link to prevent 404 errors
    const faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    faviconLink.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎬</text></svg>';
    document.head.appendChild(faviconLink);
    
    // Hide both containers initially
    authContainer.classList.add('hidden');
    appContainer.classList.add('hidden');
    
    // Show a loading state
    document.body.classList.add('loading');
    
    // Try to auto-login with session token (uses functions from auth.js)
        const autoLoginSuccessful = await validateSession();
        
    logger.debug('Auto-login result:', autoLoginSuccessful);
        
        if (!autoLoginSuccessful) {
            // Show auth form if no valid session
            authContainer.classList.remove('hidden');
        // Add listener for auth form submit (uses functions from auth.js)
        passwordForm.addEventListener('submit', handleAuthFormSubmit);
    } else {
        // If auto-login succeeded, ws connection is already initiated
        // UI updates (showing app container etc.) are handled in handleAuthSuccess (auth.js)
    }

        // Remove loading state
        document.body.classList.remove('loading');
    
    // Set default video volume
    videoPlayer.volume = 0.5;
    
    // Add Logout button listener (uses function from auth.js)
    logoutBtn.addEventListener('click', handleLogout);

    // Add Video player time update listener (calls function from ui.js)
    videoPlayer.addEventListener('timeupdate', updateTimeDisplay);

    // Add Seek slider listeners (uses functions from playback.js & ui.js)
    seekSlider.addEventListener('input', handleSeekInput);
    seekSlider.addEventListener('change', handleSeekChange);

    // Add Video selection change listener (uses functions from playback.js)
    videoList.addEventListener('change', handleVideoSelectionChange);

    // Add Prevention listeners (uses function from playback.js)
    addViewerControlPreventionListeners();

    // Add listener for manual play/unmute button (uses function from playback.js)
    manualPlayBtn.addEventListener('click', handleManualPlay);

    // Add listener for theater mode button (uses function from ui.js)
    theaterModeBtn.addEventListener('click', toggleTheaterMode);

    // Initialize smooth time updates (starts loop from ui.js)
    // Note: This will only start updating *player* time initially.
    // Server time and viewer times start updating after admin auth.
    startSmoothTimeUpdates();
    
    // Add cleanup for smooth updates when the page is hidden/unloaded
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            logger.debug('Page hidden, stopping smooth updates.', 'ui');
            stopSmoothTimeUpdates();
            stopSmoothViewerTimeUpdates(); // Also stop viewer updates if running
        } else {
            logger.debug('Page visible, restarting smooth updates.', 'ui');
            startSmoothTimeUpdates();
            if (userRole === 'admin') {
                startSmoothViewerTimeUpdates(); // Restart viewer updates only if admin
                 }
            }
        });

    logger.info('Client-side initialization complete.');
});

// Remove theater mode button listener (handled in DOMContentLoaded)
// theaterModeBtn.addEventListener('click', () => { ... });

// Remove functions moved to ui.js
// function showNotification(message, type = 'info') { ... }
// function updateViewersTimeEstimates() { ... }
// function redrawViewerTable() { ... }
// function startSmoothViewerTimeUpdates() { ... }
// function stopSmoothViewerTimeUpdates() { ... }

// Handle viewer list update
// function handleViewerList(message) { ... } // REMOVED (moved to ui.js)

// Handle video list from server
// function handleVideoList(message) { ... } // REMOVED (moved to ui.js)

// Handle synchronization state from server
// function handleSyncState(message) { ... } // REMOVED (moved to playback.js)

// Enhanced synchronization logic
// function synchronizeVideo(targetTime, isPlaying) { ... } // REMOVED (moved to playback.js)
