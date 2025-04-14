// --- HLS Playback ---

// Initialize HLS playback for a stream
function initHLSPlayback(streamName) {
    logger.debug(`[HLS Init] Starting for stream: ${streamName}`, 'playback');
    try {
        // Clean up any existing HLS player
        if (hlsPlayer) {
            logger.debug('[HLS Init] Destroying previous Hls instance.', 'playback');
            hlsPlayer.destroy();
            hlsPlayer = null;
        }

        const streamPath = streamName.substring(4); // Remove 'hls:' prefix
        const manifestUrl = `/video/${streamPath}/master.m3u8`;
        logger.debug(`[HLS Init] Manifest URL: ${manifestUrl}`, 'playback');

        if (Hls.isSupported()) {
            logger.debug('[HLS Init] HLS.js is supported. Creating new Hls instance.', 'playback');
            hlsPlayer = new Hls({
                enableWorker: true,
                lowLatencyMode: true // Enable low latency mode
                // Add other HLS config as needed, e.g., fragLoadingTimeOut
            });

            // Attach error handler EARLY
            hlsPlayer.on(Hls.Events.ERROR, handleHLSError);

            logger.debug('[HLS Init] Loading HLS source...', 'playback');
            hlsPlayer.loadSource(manifestUrl);
            logger.debug('[HLS Init] Attaching HLS to video element...', 'playback');
            hlsPlayer.attachMedia(videoPlayer);

            hlsPlayer.on(Hls.Events.MANIFEST_PARSED, function() {
                logger.info('HLS manifest parsed successfully.', 'playback');
                setStatusMessage('HLS stream loaded');
                // Potentially trigger initial sync/play if needed after manifest parse
            });

        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            logger.info('[HLS Init] Using native HLS support.', 'playback');
            videoPlayer.src = manifestUrl;
            // Native playback needs event listeners for ready state
            videoPlayer.addEventListener('loadedmetadata', () => {
                logger.info('Native HLS metadata loaded.', 'playback');
                setStatusMessage('HLS stream loaded');
            });
            videoPlayer.addEventListener('error', handleNativeHLSError);

        } else {
            logger.error('HLS playback not supported in this browser', 'playback');
            setStatusMessage('HLS playback not supported in this browser', true);
        }
    } catch (err) {
        logger.error(`[HLS Init] CRITICAL ERROR during HLS initialization: ${err.message}`, 'playback', err);
        setStatusMessage('Critical error initializing video playback.', true);
        // Attempt to close the connection somewhat gracefully on critical client error
        if (ws && ws.readyState === WebSocket.OPEN) {
             logger.warn('[HLS Init] Closing WebSocket due to critical HLS init error.', 'connection');
             ws.close(1011, "Client HLS Initialization Error");
        }
    }
}

// HLS.js Error Handler
function handleHLSError(event, data) {
    logger.error('[HLS Error] Event:', 'playback', { event, data });
    if (data.fatal) {
        logger.error('Fatal HLS error detected. Type: ' + data.type, 'playback');
        setStatusMessage('HLS playback error. Trying to recover...', true);
        switch(data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
                logger.warn('HLS Network Error. Attempting startLoad() recovery', 'playback');
                try { if (hlsPlayer) hlsPlayer.startLoad(); } catch (e) { logger.error('Error calling startLoad() on recovery', 'playback', e); }
                break;
            case Hls.ErrorTypes.MEDIA_ERROR:
                logger.warn('HLS Media Error. Attempting recoverMediaError() recovery', 'playback');
                 try { if (hlsPlayer) hlsPlayer.recoverMediaError(); } catch (e) { logger.error('Error calling recoverMediaError() on recovery', 'playback', e); }
                break;
            default:
                logger.error('Unrecoverable HLS error. Destroying player.', 'playback');
                 try { if (hlsPlayer) hlsPlayer.destroy(); } catch (e) { logger.error('Error calling destroy() after unrecoverable HLS error', 'playback', e); }
                hlsPlayer = null; // Ensure reference is cleared
                setStatusMessage('Cannot recover from HLS error. Please refresh.', true);
                // Consider attempting full reconnect or notifying user more explicitly
                break;
        }
    } else {
         logger.warn('Non-fatal HLS error occurred. Type: ' + data.type, 'playback', data);
    }
}

// Native HLS Error handler
function handleNativeHLSError(event) {
    const error = event.target.error;
    logger.error('Native HLS playback error:', 'playback', { code: error.code, message: error.message });
    setStatusMessage(`Video playback error: ${error.message || 'Unknown error'}`, true);
    // Consider attempting reconnection or showing a more specific error message
}

// --- Synchronization Logic ---

// Handle synchronization state from server message
function handleSyncState(message) {
    if (isAdjusting) {
        logger.debug('Skipping sync message while adjusting.', 'playback');
        return; // Prevent recursive adjustments
    }

    // Validate required fields with proper type checking
    const newVideo = typeof message.currentVideo === 'string' ? message.currentVideo : null;
    const isPlaying = typeof message.isPlaying === 'boolean' ? message.isPlaying : false;

    // Update our master state tracking
    if (!masterState) {
        masterState = { isPlaying: isPlaying, currentVideo: newVideo };
        logger.info('Initialized master state tracking', 'playback', masterState);
    } else {
        masterState.isPlaying = isPlaying;
        masterState.currentVideo = newVideo;
    }

    // Ensure targetTime is a valid number
    let serverTime = 0;
    if (message.targetTime !== undefined && message.targetTime !== null) {
        serverTime = typeof message.targetTime === 'number' ? message.targetTime : parseFloat(message.targetTime);
        if (isNaN(serverTime)) {
            logger.warn('Invalid server time received in sync message, defaulting to 0', 'playback', message.targetTime);
            serverTime = 0;
        }
    } else {
        logger.warn('No target time provided in sync message, defaulting to 0', 'playback');
    }

    // Update server time display for admins (ui.js)
    if (userRole === 'admin') {
        updateServerTimeDisplay(serverTime);
    }

    // Update server playback rate if provided
    if (message.playbackRate !== undefined && message.playbackRate !== null) {
        const newRate = typeof message.playbackRate === 'number' ?
            message.playbackRate : parseFloat(message.playbackRate);

        if (!isNaN(newRate) && newRate !== serverPlaybackRate) {
            logger.info(`Server playback rate changed: ${serverPlaybackRate.toFixed(2)} -> ${newRate.toFixed(2)}`, 'playback');
            serverPlaybackRate = newRate;
        }
    }

    // Update UI overlay based on play state (ui.js)
    updatePausedOverlay(isPlaying);

    // Check if video needs to be loaded or changed
    if (newVideo && newVideo.startsWith('hls:') && newVideo !== currentVideo) {
        logger.info(`Sync: Changing video source to ${newVideo}`, 'playback');
        currentVideo = newVideo;
        initHLSPlayback(currentVideo);
        setStatusMessage(`Loading video: ${currentVideo.substring(4)}`);

        // Update dropdown selection to match server state (ui.js)
        updateVideoListSelection(currentVideo);

        // Video is loading, sync time/state once ready
        waitForVideoReady(() => synchronizeVideo(serverTime, isPlaying));

    } else if (!newVideo && currentVideo) {
        // Server indicates no video selected
        logger.info('Sync: No video selected by server. Unloading current video.', 'playback');
        if (hlsPlayer) hlsPlayer.destroy();
        videoPlayer.src = '';
        videoPlayer.removeAttribute('src'); // Ensure src is fully removed
        currentVideo = null;
        updateVideoListSelection(null); // Deselect in dropdown (ui.js)
        // Reset time display and slider (ui.js)
        resetTimeDisplay();

    } else if (newVideo && newVideo === currentVideo) {
        // Video source is the same, just sync time/play state
        // Ensure video element is ready before synchronizing
        waitForVideoReady(() => synchronizeVideo(serverTime, isPlaying));
    } else {
         logger.debug('Sync: No video change needed or no video selected.', 'playback');
         // If no video is selected and none was playing, ensure player is stopped
         if (!newVideo && !currentVideo && !videoPlayer.paused) {
             videoPlayer.pause();
             resetTimeDisplay();
         }
    }
}

// Wait for video to be ready (metadata loaded) before executing callback
function waitForVideoReady(callback) {
    if (videoPlayer.readyState >= 1 || (hlsPlayer && hlsPlayer.media === videoPlayer && hlsPlayer.streamController?.state === 'IDLE')) {
        // Ready or HLS finished loading initial segments
        logger.debug('Video ready, executing callback immediately.', 'playback');
        callback();
    } else {
        // Video not ready, wait for HLS manifest/loadedmetadata or native canplay
        logger.info('Video not ready, deferring action until loaded.', 'playback');
        const readyHandler = () => {
            logger.info('Video ready event fired, executing deferred action.', 'playback');
            // Clean up listeners
            videoPlayer.removeEventListener('loadedmetadata', readyHandler);
            videoPlayer.removeEventListener('canplay', readyHandler);
            if (hlsPlayer) hlsPlayer.off(Hls.Events.MANIFEST_PARSED, readyHandler);
            // Execute the original callback
            callback();
        };

        // Listen to appropriate events
        if (hlsPlayer) {
            // For HLS.js, manifest parsed is a good indicator
            hlsPlayer.once(Hls.Events.MANIFEST_PARSED, readyHandler);
        } else {
            // For native HLS or direct files, use loadedmetadata or canplay
            videoPlayer.addEventListener('loadedmetadata', readyHandler, { once: true });
            videoPlayer.addEventListener('canplay', readyHandler, { once: true });
        }

        // Add a timeout fallback in case events don't fire
        setTimeout(() => {
             if (videoPlayer.readyState < 1) { // Check again if still not ready
                 logger.warn('Video ready event timeout reached, attempting action anyway.', 'playback');
                 readyHandler(); // Try executing anyway
             }
        }, 5000); // 5 second timeout
    }
}

// Enhanced synchronization logic
function synchronizeVideo(targetTime, isPlaying) {
    if (isAdjusting) return; // Second check for safety
    isAdjusting = true;

    logger.debug(`Synchronizing video: targetTime=${targetTime.toFixed(2)}, isPlaying=${isPlaying}`, 'playback');

    // Validate inputs
    if (targetTime === undefined || targetTime === null || isNaN(targetTime)) {
        logger.warn('Invalid target time in synchronizeVideo, using 0.', 'playback', targetTime);
        targetTime = 0;
    }

    // Safety check for video player
    if (!videoPlayer || videoPlayer.readyState < 1) {
        logger.warn('Video not ready for synchronization attempt.', 'playback');
        isAdjusting = false;
        return;
    }

    const currentTime = videoPlayer.currentTime || 0;
    const timeDiff = currentTime - targetTime;
    const absTimeDiff = Math.abs(timeDiff);
    const direction = timeDiff > 0 ? 'ahead' : 'behind';

    // --- Time Synchronization ---
    if (absTimeDiff > syncThresholdJump) {
        // Very large desync - jump directly
        logger.info(`Large desync (${timeDiff.toFixed(2)}s), jumping to ${targetTime.toFixed(2)}s`, 'playback');
        videoPlayer.currentTime = targetTime;
        videoPlayer.playbackRate = serverPlaybackRate; // Reset rate after jump
    } else {
        // --- Playback Rate Adjustment (only if not jumping) ---
        let targetRate = serverPlaybackRate; // Default to server rate
        let adjustmentReason = "In sync";

        if (absTimeDiff > syncThresholdLarge) {
            // Large desync (3.1 to 7.0 seconds) - adjust rate (5.1% to 10%)
            const maxAdjust = 0.10; const minAdjust = 0.051;
            const range = syncThresholdJump - syncThresholdLarge;
            const normalizedDiff = Math.min(absTimeDiff - syncThresholdLarge, range);
            const rateAdjust = minAdjust + (normalizedDiff / range) * (maxAdjust - minAdjust);
            targetRate = serverPlaybackRate * (1 + (direction === 'behind' ? rateAdjust : -rateAdjust));
            adjustmentReason = `Large desync: ${timeDiff.toFixed(2)}s -> ${(rateAdjust * 100).toFixed(1)}% adjust`;
        } else if (absTimeDiff > syncThresholdModerate) {
            // Moderate desync (1.6 to 3.0 seconds) - adjust rate (2.1% to 5%)
            const maxAdjust = 0.05; const minAdjust = 0.021;
            const range = syncThresholdLarge - syncThresholdModerate;
            const normalizedDiff = Math.min(absTimeDiff - syncThresholdModerate, range);
            const rateAdjust = minAdjust + (normalizedDiff / range) * (maxAdjust - minAdjust);
            targetRate = serverPlaybackRate * (1 + (direction === 'behind' ? rateAdjust : -rateAdjust));
            adjustmentReason = `Moderate desync: ${timeDiff.toFixed(2)}s -> ${(rateAdjust * 100).toFixed(1)}% adjust`;
        } else if (absTimeDiff > syncThresholdSmall) {
            // Small desync (0.5 to 1.5 seconds) - adjust rate (0.1% to 2%)
            const maxAdjust = 0.02; const minAdjust = 0.001;
            const range = syncThresholdModerate - syncThresholdSmall;
            const normalizedDiff = Math.min(absTimeDiff - syncThresholdSmall, range);
            const rateAdjust = minAdjust + (normalizedDiff / range) * (maxAdjust - minAdjust);
            targetRate = serverPlaybackRate * (1 + (direction === 'behind' ? rateAdjust : -rateAdjust));
            adjustmentReason = `Small desync: ${timeDiff.toFixed(2)}s -> ${(rateAdjust * 100).toFixed(1)}% adjust`;
        }

        // Apply the target playback rate
        if (videoPlayer.playbackRate !== targetRate) {
            // Clamp targetRate to reasonable bounds (e.g., 0.5x to 2x server rate)
            const minRate = Math.max(0.5, serverPlaybackRate * 0.5);
            const maxRate = Math.min(2.0, serverPlaybackRate * 2.0);
            targetRate = Math.max(minRate, Math.min(maxRate, targetRate));

            logger.info(`${adjustmentReason}. Server rate: ${serverPlaybackRate.toFixed(2)}x. Client rate: ${targetRate.toFixed(4)}x`, 'playback');
            videoPlayer.playbackRate = targetRate;
        }
    }

    // --- Play/Pause State Synchronization ---
    if (isPlaying && videoPlayer.paused) {
        logger.info('Server playing, client paused. Attempting play...', 'playback');
        // Try autoplay with fallback
        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(handleAutoplayError);
        }
    } else if (!isPlaying && !videoPlayer.paused) {
        logger.info('Server paused, client playing. Pausing client.', 'playback');
        videoPlayer.pause();
    }

    // --- Cleanup ---
    setTimeout(() => {
        isAdjusting = false;
    }, 150); // Slightly longer delay to allow state to settle

    updateTimeDisplay(); // Update UI immediately (ui.js)
}

// Handle autoplay errors
function handleAutoplayError(err) {
    logger.warn(`Autoplay failed: ${err.name} - ${err.message}`, 'playback');
    if (err.name === 'NotAllowedError') {
        // Try muted autoplay as fallback
        if (!videoPlayer.muted) {
            logger.info('Attempting muted autoplay as fallback', 'playback');
            videoPlayer.muted = true;
            videoPlayer.play().then(() => {
                logger.info('Muted autoplay successful. Showing unmute prompt.', 'playback');
                showAutoplayFallbackOverlay(true); // Show overlay with unmute focus (ui.js)
            }).catch(mutedErr => {
                logger.error('Muted autoplay also failed:', mutedErr, 'playback');
                showAutoplayFallbackOverlay(false); // Show overlay with play focus (ui.js)
            });
        } else {
            // Already muted and still failed, show manual play overlay
            logger.error('Autoplay failed even when muted.', 'playback');
            showAutoplayFallbackOverlay(false); // Show overlay with play focus (ui.js)
        }
    } else {
        // Other playback error (e.g., network, media format)
        logger.error('Playback error during play attempt:', err, 'playback');
        setStatusMessage(`Playback error: ${err.message}`, true);
    }
}

// Handle click on the manual play/unmute button in the overlay
function handleManualPlay() {
    logger.info('Manual play/unmute button clicked.', 'playback');
    hideAutoplayFallbackOverlay(); // (ui.js)

    // Try to play again after user interaction
    if (videoPlayer && masterState?.isPlaying) {
        videoPlayer.muted = false; // Ensure it's not muted
        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
             playPromise.then(() => {
                 logger.info('Playback started successfully after user interaction', 'playback');
                 setStatusMessage('Playback started');
             }).catch(err => {
                 // If it still fails, log and notify but don't show overlay again
                 logger.error('Playback still failed after user interaction:', err, 'playback');
                 setStatusMessage('Playback failed - please try refreshing', true);
             });
        }
    }

    // Request a fresh sync from server just in case
    requestSync(); // (websocket.js)
}

// --- Client Time Updates ---

// Start sending client time updates periodically
function startClientTimeUpdates() {
    stopClientTimeUpdates(); // Clear any existing interval
    logger.info(`Starting client time updates every ${CLIENT_TIME_UPDATE_INTERVAL / 1000}s`, 'playback');

    // Send an initial update immediately if connected
    if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
        sendTimeUpdate();
    }

    // Set up interval for regular updates
    clientTimeUpdateIntervalId = setInterval(sendTimeUpdate, CLIENT_TIME_UPDATE_INTERVAL);
}

// Function to send current time to server
function sendTimeUpdate() {
    // Only send if connected, authenticated, and video element exists and is ready
    if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated && videoPlayer && videoPlayer.readyState > 0) {
        const currentTime = videoPlayer.currentTime || 0;
        const playbackRate = videoPlayer.playbackRate || 1.0;
        const isPlaying = !videoPlayer.paused;

        sendControlMessage('clientTimeUpdate', {
            clientTime: currentTime,
            playbackRate: playbackRate, // Send current playback rate
            isPlaying: isPlaying,     // Send current playing state
            name: userName // Send name with time updates
        });
        // logger.debug(`Sent time update: ${currentTime.toFixed(2)}s, Rate: ${playbackRate.toFixed(2)}x, Playing: ${isPlaying}`, 'playback');
    } else {
        // logger.debug('Skipping time update (not connected/ready).', 'playback');
    }
}

// Stop sending client time updates
function stopClientTimeUpdates() {
    if (clientTimeUpdateIntervalId) {
        logger.info('Stopping client time updates.', 'playback');
        clearInterval(clientTimeUpdateIntervalId);
        clientTimeUpdateIntervalId = null;
    }
}

// --- Playback Controls & Event Handlers ---

// Initialize admin playback controls (called after auth success)
function initializePlaybackControls() {
    if (userRole === 'admin') {
        logger.info('Initializing admin playback controls', 'playback');

        // Remove any existing event listeners first to prevent duplicates
        // Cloning the node is a robust way to do this
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
        playBtn = newPlayBtn; // Update reference

        const newPauseBtn = pauseBtn.cloneNode(true);
        pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);
        pauseBtn = newPauseBtn; // Update reference

        // Add event listeners to the new elements
        playBtn.addEventListener('click', handlePlayButtonClick);
        pauseBtn.addEventListener('click', handlePauseButtonClick);

        // Add listeners for seek and video change (these might already be added in DOMContentLoaded, double-check)
        seekSlider.addEventListener('input', handleSeekInput);
        seekSlider.addEventListener('change', handleSeekChange);
        videoList.addEventListener('change', handleVideoSelectionChange);
    }
}

// Handle Play button click (Admin only)
function handlePlayButtonClick() {
    if (userRole !== 'admin') return;
    logger.info('Admin clicked Play button', 'playback');
    sendControlMessage('play');
}

// Handle Pause button click (Admin only)
function handlePauseButtonClick() {
    if (userRole !== 'admin') return;
    logger.info('Admin clicked Pause button', 'playback');
    sendControlMessage('pause');
}

// Handle seek slider input (dragging) (Admin only)
function handleSeekInput() {
    if (userRole !== 'admin') return;
    isManuallyChangingTime = true;
    // Update time display while dragging (ui.js)
    updateTimeDisplayOnSeek(seekSlider.value);
}

// Handle seek slider change (release) (Admin only)
function handleSeekChange() {
    if (userRole !== 'admin') return;
    if (videoPlayer.duration) {
        const seekTime = (seekSlider.value / 100) * videoPlayer.duration;
        logger.info(`Admin seeking to ${seekTime.toFixed(2)}s`, 'playback');
        sendControlMessage('seek', { time: seekTime });
    }
    isManuallyChangingTime = false;
    // Request sync after seek for immediate feedback
    requestSync();
}

// Handle video selection change (Admin only)
function handleVideoSelectionChange() {
    if (userRole !== 'admin') return;
    const selectedHLSStream = videoList.value; // This should be the "hls:streamName"
    if (selectedHLSStream && selectedHLSStream !== currentVideo) {
        logger.info(`Admin changed video selection to: ${selectedHLSStream}`, 'playback');
        sendControlMessage('changeVideo', { video: selectedHLSStream });
        // Server will respond with syncState, which triggers loading
        setStatusMessage(`Requesting video change to ${selectedHLSStream.substring(4)}...`);
    }
}

// --- Viewer Control Prevention ---

// Function to prevent non-admin users from using native controls
function preventViewerControls(event) {
    // Allow if user is admin, or if the event is triggered by our sync logic
    if (userRole === 'admin' || isAdjusting) {
        return true;
    }

    // Prevent specific actions for viewers
    const preventedActions = ['play', 'pause', 'seeking', 'seeked', 'volumechange'];
    if (preventedActions.includes(event.type)) {
         logger.debug(`Prevented viewer action: ${event.type}`, 'playback');
         event.preventDefault(); // Stop the default action

        // For seek events, try to revert the time immediately
        if ((event.type === 'seeking' || event.type === 'seeked') && masterState?.currentVideo && lastServerTimeUpdate > 0) {
            // Estimate the correct server time and revert
            const elapsedSeconds = (Date.now() - lastServerTimeUpdate) / 1000;
            const estimatedServerTime = lastServerTime + (masterState.isPlaying ? (elapsedSeconds * serverPlaybackRate) : 0);
            if (!isNaN(estimatedServerTime) && Math.abs(videoPlayer.currentTime - estimatedServerTime) > 0.5) { // Only revert if significantly different
                videoPlayer.currentTime = estimatedServerTime;
                logger.debug(`Reverted viewer seek attempt to estimated server time: ${estimatedServerTime.toFixed(2)}s`, 'playback');
            }
        }
        // For play/pause, the next syncState will correct it, but we can force a resync
        else if (event.type === 'play' || event.type === 'pause'){
            requestSync();
        }
        return false;
    }

    return true; // Allow other events
}

// Add event listeners to prevent viewer controls
function addViewerControlPreventionListeners() {
    logger.debug('Adding viewer control prevention listeners', 'playback');
    videoPlayer.addEventListener('play', preventViewerControls, true); // Use capture phase
    videoPlayer.addEventListener('pause', preventViewerControls, true);
    videoPlayer.addEventListener('seeking', preventViewerControls, true);
    videoPlayer.addEventListener('seeked', preventViewerControls, true);
    // Optionally prevent volume changes too, if desired
    // videoPlayer.addEventListener('volumechange', preventViewerControls, true);
} 