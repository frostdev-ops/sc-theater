// DOM Elements
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const passwordForm = document.getElementById('password-form');
const passwordInput = document.getElementById('password');
const authError = document.getElementById('auth-error');
// const roleRadios = document.getElementsByName('role'); // Removed
const roleText = document.getElementById('role-text');
const statusIcon = document.getElementById('status-icon');
const statusMessage = document.getElementById('status-message');
const videoPlayer = document.getElementById('video-player');
const adminControls = document.getElementById('admin-controls');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const seekSlider = document.getElementById('seek-slider');
const timeDisplay = document.getElementById('time-display');
const videoList = document.getElementById('video-list');
const videoContainer = document.querySelector('.video-container');
// Add reference to theater mode button
const theaterModeBtn = document.getElementById('theater-mode-btn');

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
const CLIENT_TIME_UPDATE_INTERVAL = 5000; // Send time every 5 seconds

// Format time (seconds) to mm:ss
function formatTime(seconds) {
    seconds = Math.max(0, seconds);
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Initialize HLS playback for a stream
function initHLSPlayback(streamName) {
    // Clean up any existing HLS player
    if (hlsPlayer) {
        hlsPlayer.destroy();
        hlsPlayer = null;
    }
    
    const streamPath = streamName.substring(4); // Remove 'hls:' prefix
    const manifestUrl = `/video/${streamPath}/master.m3u8`;
    
    if (Hls.isSupported()) {
        hlsPlayer = new Hls({
            enableWorker: true,
            lowLatencyMode: true
        });
        
        hlsPlayer.loadSource(manifestUrl);
        hlsPlayer.attachMedia(videoPlayer);
        
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, function() {
            console.log('HLS manifest loaded');
            setStatusMessage('HLS stream loaded');
        });
        
        hlsPlayer.on(Hls.Events.ERROR, function(event, data) {
            if (data.fatal) {
                console.error('Fatal HLS error:', data);
                setStatusMessage('HLS playback error. Trying to recover...', true);
                switch(data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        hlsPlayer.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hlsPlayer.recoverMediaError();
                        break;
                    default:
                        // Cannot recover
                        hlsPlayer.destroy();
                        setStatusMessage('Cannot recover from HLS error', true);
                        break;
                }
            }
        });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        videoPlayer.src = manifestUrl;
    } else {
        setStatusMessage('HLS playback not supported in this browser', true);
    }
}

// Update time display
function updateTimeDisplay() {
    if (videoPlayer && videoPlayer.duration) {
        timeDisplay.textContent = `${formatTime(videoPlayer.currentTime)} / ${formatTime(videoPlayer.duration)}`;
        if (!isManuallyChangingTime) {
            seekSlider.value = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        }
    }
}

// Set status message
function setStatusMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.style.color = isError ? '#e74c3c' : '#555';
    
    // Clear message after 5 seconds
    setTimeout(() => {
        if (statusMessage.textContent === message) {
            statusMessage.textContent = '';
        }
    }, 5000);
}

// Connect to WebSocket server
function connectWebSocket(password) { // Removed role parameter
    // Get the current hostname and correct port
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connection established');
        // Send authentication message
        ws.send(JSON.stringify({
            type: 'auth',
            password: password
        }));
        setStatusMessage('Connecting...');
    };
    
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Received:', message);
            
            switch (message.type) {
                case 'auth_success':
                    handleAuthSuccess(message);
                    break;
                case 'auth_fail':
                    handleAuthFailure(message);
                    break;
                case 'syncState':
                    handleSyncState(message);
                    break;
                case 'videoList':
                    handleVideoList(message);
                    break;
                case 'error':
                    setStatusMessage(`Error: ${message.message}`, true);
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    };
    
    ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        setStatusMessage('Disconnected from server. Refresh to reconnect.', true);
        statusIcon.style.backgroundColor = '#e74c3c';
        stopClientTimeUpdates(); // Stop sending updates
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatusMessage('Connection error. Please try again.', true);
    };
}

// Handle successful authentication
function handleAuthSuccess(message) {
    userRole = message.role;
    isAuthenticated = true;
    
    // Update UI
    authContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    roleText.textContent = userRole;
    
    // Show admin controls if applicable
    if (userRole === 'admin') {
        adminControls.classList.remove('hidden');
    }
    
    setStatusMessage(`Successfully connected as ${userRole}`);

    // Start sending client time updates periodically
    startClientTimeUpdates();
}

// Handle authentication failure
function handleAuthFailure(message) {
    console.error('Authentication failed:', message.message);
    authError.textContent = message.message || 'Invalid password';
    ws.close();
}

// Handle video list from server
function handleVideoList(message) {
    // Clear existing options in the main video list dropdown
    videoList.innerHTML = '';
    // sourceVideoSelect.innerHTML = ''; // Keep source select empty for now

    // Add options for each HLS stream
    message.videos.forEach(hlsStreamIdentifier => { // e.g., "hls:my_video_stream"
        // Main video list dropdown (for playback)
        const option = document.createElement('option');
        option.value = hlsStreamIdentifier;

        // Display friendly name: remove 'hls:' prefix
        const streamName = hlsStreamIdentifier.startsWith('hls:') ? hlsStreamIdentifier.substring(4) : hlsStreamIdentifier;
        option.textContent = `${streamName} (HLS)`;

        videoList.appendChild(option);

        // We are not populating sourceVideoSelect here anymore as it requires source files list
    });

    // Select current video if available in the new list
    if (currentVideo && message.videos.includes(currentVideo)) {
        videoList.value = currentVideo;
    } else if (message.videos.length > 0) {
        // Otherwise select the first video from the HLS list
        videoList.value = message.videos[0];
        // If no video was selected previously, set it now
        if (!currentVideo) {
            currentVideo = message.videos[0];
            // Potentially trigger initial load if needed, though syncState should handle it
            // handleSyncState({ currentVideo: currentVideo, targetTime: 0, isPlaying: false });
        }
    }

    setStatusMessage('HLS Video list updated');
}

// Handle synchronization state from server
function handleSyncState(message) {
    if (isAdjusting) return; // Prevent recursive adjustments

    const newVideo = message.currentVideo; // Expected format: "hls:streamName"
    const isPlaying = message.isPlaying;

    // Add/Remove paused state class for overlay
    if (videoContainer) {
        if (isPlaying) {
            videoContainer.classList.remove('paused-state');
        } else {
            videoContainer.classList.add('paused-state');
        }
    }

    // Check if video needs to be loaded or changed
    if (newVideo && newVideo.startsWith('hls:') && newVideo !== currentVideo) {
        console.log(`Sync: Changing video source to ${newVideo}`);
        currentVideo = newVideo;
        initHLSPlayback(currentVideo);
        setStatusMessage(`Loading video: ${currentVideo.substring(4)}`);
        // Sync time/play state *after* HLS is ready (initHLSPlayback handles this via events)
        // We might need to defer the synchronizeVideo call until HLS manifest is parsed.
        // Let's add a flag or check readyState in initHLSPlayback/synchronizeVideo

         // Update dropdown selection to match server state
         if (videoList.value !== currentVideo) {
            videoList.value = currentVideo;
        }

    } else if (!newVideo && currentVideo) {
        // Server indicates no video selected
        console.log('Sync: No video selected by server.');
        if (hlsPlayer) hlsPlayer.destroy();
        videoPlayer.src = '';
        currentVideo = null;
        videoList.value = ''; // Deselect in dropdown
    } else {
        // Video source is the same, just sync time/play state
        // Ensure video element is ready (HLS might still be loading)
        if (videoPlayer.readyState >= 1 || (hlsPlayer && hlsPlayer.media === videoPlayer)) { // Check if HLS is attached
            synchronizeVideo(message.targetTime, message.isPlaying);
        } else {
            // Video not ready, wait for HLS manifest or native canplay
            console.log('Sync: Video not ready, deferring time sync.');
            const readyHandler = () => {
                 console.log('Sync: Video ready, applying state.');
                 synchronizeVideo(message.targetTime, message.isPlaying);
                 videoPlayer.removeEventListener('canplay', readyHandler);
                 if (hlsPlayer) hlsPlayer.off(Hls.Events.MANIFEST_PARSED, readyHandler);
            };
            videoPlayer.addEventListener('canplay', readyHandler);
            if (hlsPlayer) hlsPlayer.on(Hls.Events.MANIFEST_PARSED, readyHandler);
        }
    }
}

// Enhanced synchronization logic
function synchronizeVideo(targetTime, isPlaying) {
    isAdjusting = true;
    
    // Also update overlay based on synchronized state
    if (videoContainer) {
        if (isPlaying) {
            videoContainer.classList.remove('paused-state');
        } else {
            videoContainer.classList.add('paused-state');
        }
    }

    const currentTime = videoPlayer.currentTime;
    const timeDiff = Math.abs(currentTime - targetTime);
    const direction = currentTime < targetTime ? 'behind' : 'ahead';
    
    // Update play/pause state to match server
    if (isPlaying && videoPlayer.paused) {
        videoPlayer.play().catch(err => {
            console.error('Error while trying to play:', err);
            setStatusMessage('Autoplay failed - browser restrictions', true);
        });
    } else if (!isPlaying && !videoPlayer.paused) {
        videoPlayer.pause();
    }
    
    // Time synchronization with new thresholds and more subtle adjustments
    if (timeDiff > syncThresholdJump) {
        // Very large desync (> 10 seconds) - jump directly to target time
        console.log(`Very large desync detected (${timeDiff.toFixed(2)}s). Jumping to server time.`);
        videoPlayer.currentTime = targetTime;
        videoPlayer.playbackRate = 1.0;
    } else if (timeDiff > syncThresholdLarge) {
        // Large desync (3.1 to 7.0 seconds) - adjust playback rate (5.1% to 10%)
        // Scale the adjustment within range based on actual desync amount
        const maxAdjust = 0.10; // 10%
        const minAdjust = 0.051; // 5.1%
        const range = syncThresholdJump - syncThresholdLarge;
        const normalizedDiff = Math.min(timeDiff - syncThresholdLarge, range);
        const rateAdjust = minAdjust + (normalizedDiff / range) * (maxAdjust - minAdjust);
        
        if (direction === 'behind') {
            // Too slow - speed up
            videoPlayer.playbackRate = 1 + rateAdjust;
        } else {
            // Too fast - slow down
            videoPlayer.playbackRate = 1 - rateAdjust;
        }
        console.log(`Large desync: ${timeDiff.toFixed(2)}s ${direction}. Adjusting rate to ${videoPlayer.playbackRate.toFixed(4)} (${(rateAdjust * 100).toFixed(2)}%)`);
    } else if (timeDiff > syncThresholdModerate) {
        // Moderate desync (1.6 to 3.0 seconds) - adjust playback rate (2.1% to 5%)
        // Scale the adjustment within range based on actual desync amount
        const maxAdjust = 0.05; // 5%
        const minAdjust = 0.021; // 2.1%
        const range = syncThresholdLarge - syncThresholdModerate;
        const normalizedDiff = Math.min(timeDiff - syncThresholdModerate, range);
        const rateAdjust = minAdjust + (normalizedDiff / range) * (maxAdjust - minAdjust);
        
        if (direction === 'behind') {
            // Too slow - speed up
            videoPlayer.playbackRate = 1 + rateAdjust;
        } else {
            // Too fast - slow down
            videoPlayer.playbackRate = 1 - rateAdjust;
        }
        console.log(`Moderate desync: ${timeDiff.toFixed(2)}s ${direction}. Adjusting rate to ${videoPlayer.playbackRate.toFixed(4)} (${(rateAdjust * 100).toFixed(2)}%)`);
    } else if (timeDiff > syncThresholdSmall) {
        // Small desync (0.5 to 1.5 seconds) - adjust playback rate (0.1% to 2%)
        // Scale the adjustment within range based on actual desync amount
        const maxAdjust = 0.02; // 2%
        const minAdjust = 0.001; // 0.1%
        const range = syncThresholdModerate - syncThresholdSmall;
        const normalizedDiff = Math.min(timeDiff - syncThresholdSmall, range);
        const rateAdjust = minAdjust + (normalizedDiff / range) * (maxAdjust - minAdjust);
        
        if (direction === 'behind') {
            // Too slow - speed up
            videoPlayer.playbackRate = 1 + rateAdjust;
        } else {
            // Too fast - slow down
            videoPlayer.playbackRate = 1 - rateAdjust;
        }
        console.log(`Small desync: ${timeDiff.toFixed(2)}s ${direction}. Adjusting rate to ${videoPlayer.playbackRate.toFixed(4)} (${(rateAdjust * 100).toFixed(2)}%)`);
    } else {
        // In sync (< 0.5 seconds) - reset to normal speed
        videoPlayer.playbackRate = 1.0;
    }
    
    setTimeout(() => {
        isAdjusting = false;
    }, 100); // Small delay to prevent rapid adjustments
    
    updateTimeDisplay();
}

// Send control message to server
function sendControlMessage(type, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isAuthenticated) {
        setStatusMessage('Not connected to server', true);
        return false;
    }
    
    const message = { type, ...data };
    ws.send(JSON.stringify(message));
    return true;
}

// Start sending client time updates
function startClientTimeUpdates() {
    stopClientTimeUpdates(); // Clear any existing interval
    console.log(`Starting client time updates every ${CLIENT_TIME_UPDATE_INTERVAL / 1000}s`);
    clientTimeUpdateIntervalId = setInterval(() => {
        // Only send if connected, authenticated, and video is ready to provide time
        if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated && videoPlayer && videoPlayer.readyState > 0 && !isNaN(videoPlayer.currentTime)) {
            sendControlMessage('clientTimeUpdate', { clientTime: videoPlayer.currentTime });
        }
    }, CLIENT_TIME_UPDATE_INTERVAL);
}

// Stop sending client time updates
function stopClientTimeUpdates() {
    if (clientTimeUpdateIntervalId) {
        console.log('Stopping client time updates.');
        clearInterval(clientTimeUpdateIntervalId);
        clientTimeUpdateIntervalId = null;
    }
}

// Event Listeners
passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = passwordInput.value;
    // const role = getSelectedRole(); // Removed role selection
    
    if (!password) {
        authError.textContent = 'Please enter a password';
        return;
    }
    
    authError.textContent = '';
    connectWebSocket(password); // Removed role argument
});

// Video time update event
videoPlayer.addEventListener('timeupdate', () => {
    updateTimeDisplay();
});

// Only admin can manually control the video
if (userRole === 'admin') {
    // Custom play button
    playBtn.addEventListener('click', () => {
        if (sendControlMessage('play')) {
            setStatusMessage('Play command sent');
        }
    });
    
    // Custom pause button
    pauseBtn.addEventListener('click', () => {
        if (sendControlMessage('pause')) {
            setStatusMessage('Pause command sent');
        }
    });
    
    // Seek slider
    seekSlider.addEventListener('input', () => {
        isManuallyChangingTime = true;
        const seekPercent = seekSlider.value / 100;
        if (videoPlayer.duration) {
            const seekTime = videoPlayer.duration * seekPercent;
            timeDisplay.textContent = `${formatTime(seekTime)} / ${formatTime(videoPlayer.duration)}`;
        }
    });
    
    seekSlider.addEventListener('change', () => {
        const seekPercent = seekSlider.value / 100;
        if (videoPlayer.duration) {
            const seekTime = videoPlayer.duration * seekPercent;
            if (sendControlMessage('seek', { time: seekTime })) {
                setStatusMessage(`Seeking to ${formatTime(seekTime)}`);
            }
        }
        isManuallyChangingTime = false;
    });
    
    // Video selection
    videoList.addEventListener('change', () => {
        const selectedVideo = videoList.value; // Value is "hls:streamName"
        if (selectedVideo) {
            // Send the hls: identifier directly
            if (sendControlMessage('changeVideo', { video: selectedVideo })) {
                setStatusMessage(`Requesting change to: ${selectedVideo.substring(4)}`);
            }
        }
    });
}

// Prevent viewers from directly controlling playback via native controls
function preventViewerControls(event) {
    if (userRole === 'viewer') {
        console.log('Viewer action prevented:', event.type);
        event.preventDefault(); // Stop the default action
        // Optionally show a message
        setStatusMessage('Viewers cannot control playback');
        // Resync state immediately to correct any temporary UI flicker
        if(ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'requestSync' })); // Assuming server handles this
        }
        return false;
    }
    return true;
}

// Apply prevention listeners
videoPlayer.addEventListener('play', preventViewerControls);
videoPlayer.addEventListener('pause', (event) => {
    // Allow pause if it's triggered by the sync logic (not directly by user)
    if (!isAdjusting) {
        preventViewerControls(event);
    }
});
videoPlayer.addEventListener('seeking', preventViewerControls);
videoPlayer.addEventListener('seeked', preventViewerControls);
// We might need to intercept 'volumechange' as well if needed
// videoPlayer.addEventListener('volumechange', preventViewerControls);

// Initial setup on load
window.addEventListener('DOMContentLoaded', () => {
    // Initialize UI
    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden');
    videoPlayer.volume = 0.5; // Set default volume
    
    // Password form submit listener
    passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const password = passwordInput.value;
        // const role = getSelectedRole(); // Removed role selection
        authError.textContent = '';
        
        if (!password) {
            authError.textContent = 'Please enter a password';
            return;
        }
        
        try {
            connectWebSocket(password); // Removed role argument
        } catch (error) {
            console.error('Connection error:', error);
            authError.textContent = 'Failed to connect to server';
        }
    });
    
    // Video player time update
    videoPlayer.addEventListener('timeupdate', updateTimeDisplay);
    
    // Seek slider input
    seekSlider.addEventListener('input', () => {
        isManuallyChangingTime = true;
        // Update time display while dragging
        const seekTime = (seekSlider.value / 100) * videoPlayer.duration;
        timeDisplay.textContent = `${formatTime(seekTime)} / ${formatTime(videoPlayer.duration)}`;
    });
    
    // Seek slider change
    seekSlider.addEventListener('change', () => {
        // Only admins can seek
        if (userRole === 'admin') {
            const seekTime = (seekSlider.value / 100) * videoPlayer.duration;
            sendControlMessage('seek', { time: seekTime });
        }
        isManuallyChangingTime = false;
    });
    
    // Play button
    playBtn.addEventListener('click', () => {
        if (userRole === 'admin') {
            sendControlMessage('play');
        }
    });
    
    // Pause button
    pauseBtn.addEventListener('click', () => {
        if (userRole === 'admin') {
            sendControlMessage('pause');
        }
    });
    
    // Video selection change
    videoList.addEventListener('change', () => {
        // Only admins can change video
        if (userRole === 'admin') {
            const selectedHLSStream = videoList.value; // This should be the "hls:streamName"
            if (selectedHLSStream) {
                sendControlMessage('changeVideo', { video: selectedHLSStream });
            }
        }
    });
});

// Add listener for theater mode button
theaterModeBtn.addEventListener('click', () => {
    document.body.classList.toggle('theater-mode');
    // Optionally save state to localStorage if persistence is desired
});
