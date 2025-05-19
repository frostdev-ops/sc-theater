// --- UI Update Functions ---

// Update time display (player time / duration)
function updateTimeDisplay() {
    if (!videoPlayer) return;

    const currentTime = videoPlayer.currentTime || 0;
    const duration = videoPlayer.duration || 0;

    if (duration > 0 && !isNaN(duration)) {
        // Update text display
        timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

        // Update seek slider if not being manually dragged
        if (!isManuallyChangingTime && seekSlider) {
            const percent = (currentTime / duration) * 100;
            if (!isNaN(percent)) {
                seekSlider.value = percent;
            }
        }
    } else {
        // Handle cases with no duration (e.g., live stream or error)
        timeDisplay.textContent = `${formatTime(currentTime)} / --:--`;
        if (!isManuallyChangingTime && seekSlider) {
            seekSlider.value = 0;
        }
    }
}

// Reset time display and slider when video is unloaded
function resetTimeDisplay() {
    timeDisplay.textContent = '0:00 / --:--';
    if (seekSlider) {
        seekSlider.value = 0;
    }
    if (serverTimeDisplay) {
         serverTimeDisplay.textContent = 'Server Time: --:--';
    }
}

// Update time display specifically when admin is dragging the seek slider
function updateTimeDisplayOnSeek(sliderValue) {
    if (!videoPlayer || !videoPlayer.duration || isNaN(videoPlayer.duration)) return;
    const seekTime = (sliderValue / 100) * videoPlayer.duration;
    timeDisplay.textContent = `${formatTime(seekTime)} / ${formatTime(videoPlayer.duration)}`;
}

// Update server time display (for admin)
function updateServerTimeDisplay(serverTime) {
    if (!serverTimeDisplay || userRole !== 'admin') return;

    // Save the time and timestamp for interpolation
    lastServerTime = serverTime;
    lastServerTimeUpdate = Date.now();

    // Display immediately (will be smoothed by animation frame)
    serverTimeDisplay.textContent = `Server Time: ${formatTime(serverTime)}`;

    // Ensure animation frame is running for smooth updates
    startSmoothTimeUpdates();
}

// Update all time displays smoothly using requestAnimationFrame
function updateTimeDisplays() {
    if (!isAnimationFrameActive) return;

    const now = Date.now();

    // --- Smooth Server Time Update (Admin Only) ---
    if (serverTimeDisplay && lastServerTimeUpdate > 0 && userRole === 'admin') {
        const elapsedSeconds = (now - lastServerTimeUpdate) / 1000;
        // Only advance time if master state indicates playing
        const estimatedServerTime = masterState?.isPlaying
            ? lastServerTime + (elapsedSeconds * serverPlaybackRate)
            : lastServerTime;

        // Update display using the estimated time
        serverTimeDisplay.textContent = `Server Time: ${formatTime(estimatedServerTime)}`;
    }

    // --- Smooth Player Time Update ---
    if (videoPlayer && videoPlayer.readyState > 0 && timeDisplay && !isManuallyChangingTime) {
        updateTimeDisplay(); // This already handles slider updates
    }

    // --- Smooth Viewer Time Estimates (Admin Only) ---
    // This is handled by updateViewersTimeEstimates called by startSmoothViewerTimeUpdates
    // We don't call it directly here to avoid redundant updates

    // Continue the animation loop
    requestAnimationFrame(updateTimeDisplays);
}

// Start the smooth time update animation frame
function startSmoothTimeUpdates() {
    if (!isAnimationFrameActive) {
        isAnimationFrameActive = true;
        logger.debug('Starting smooth time update loop.', 'ui');
        requestAnimationFrame(updateTimeDisplays);
    }
}

// Stop the smooth time update animation
function stopSmoothTimeUpdates() {
    if (isAnimationFrameActive) {
        isAnimationFrameActive = false;
        logger.debug('Stopping smooth time update loop.', 'ui');
        // No need to cancel AnimationFrame explicitly, the check at the start handles it
    }
}

// Set status message at the top
function setStatusMessage(message, isError = false) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.style.color = isError ? '#e74c3c' : '#555';
    logger.debug(`Status message set: "${message}" (Error: ${isError})`, 'ui');

    // Clear message after 5 seconds
    setTimeout(() => {
        if (statusMessage.textContent === message) {
            statusMessage.textContent = '';
        }
    }, 5000);
}

// Show notification to user (currently uses setStatusMessage)
function showNotification(message, type = 'info') {
    logger.info(`Notification: "${message}" (Type: ${type})`, 'ui');
    // Use setStatusMessage for now, could be expanded later
    setStatusMessage(message, type === 'error');
}

// --- Autoplay Fallback Overlay ---

// Show the overlay prompting user interaction for autoplay
function showAutoplayFallbackOverlay(isMuted = false) {
    if (!autoplayFallbackOverlay) return;
    logger.warn('Autoplay blocked, showing fallback overlay.', 'playback');
    const title = autoplayFallbackOverlay.querySelector('h3');
    const text = autoplayFallbackOverlay.querySelector('p');
    const button = autoplayFallbackOverlay.querySelector('#manual-play-btn');

    if (isMuted) {
        title.textContent = 'Video Muted';
        text.textContent = 'Autoplay started muted due to browser restrictions.';
        button.textContent = 'Click to Unmute';
    } else {
        title.textContent = 'Autoplay Blocked';
        text.textContent = 'Your browser blocked automatic playback.';
        button.textContent = 'Click to Play';
    }

    autoplayFallbackOverlay.classList.remove('hidden');
}

// Hide the autoplay fallback overlay
function hideAutoplayFallbackOverlay() {
    if (autoplayFallbackOverlay) {
        autoplayFallbackOverlay.classList.add('hidden');
    }
}

// Add/Remove paused state class for overlay
function updatePausedOverlay(isPlaying) {
    if (videoContainer) {
        if (isPlaying) {
            videoContainer.classList.remove('paused-state');
        } else {
            videoContainer.classList.add('paused-state');
        }
    }
}

// --- Video List Handling ---

// Handle video list update from server message
function handleVideoList(message) {
    if (!videoList) return;
    logger.info('Received updated video list from server.', 'ui', message.videos);

    const availableVideos = message.videos || [];
    const previouslySelected = videoList.value;

    // Clear existing options
    videoList.innerHTML = '';

    // Add options for each HLS stream
    availableVideos.forEach(hlsStreamIdentifier => { // e.g., "hls:my_video_stream"
        const option = document.createElement('option');
        option.value = hlsStreamIdentifier;

        // Display friendly name: remove 'hls:' prefix
        const streamName = hlsStreamIdentifier.startsWith('hls:') ? hlsStreamIdentifier.substring(4) : hlsStreamIdentifier;
        option.textContent = `${streamName} (HLS)`;
        videoList.appendChild(option);
    });

    // Try to re-select the current video or the previously selected one
    if (currentVideo && availableVideos.includes(currentVideo)) {
        videoList.value = currentVideo;
    } else if (previouslySelected && availableVideos.includes(previouslySelected)) {
        videoList.value = previouslySelected;
    } else if (availableVideos.length > 0) {
        // Otherwise select the first video from the new list
        videoList.value = availableVideos[0];
        // If no video was selected previously, maybe update the currentVideo state? (Handled by syncState)
    } else {
        // No videos available
        videoList.value = '';
    }

    setStatusMessage('Video list updated');
}

// Update the video list dropdown selection (e.g., when sync changes video)
function updateVideoListSelection(videoIdentifier) {
    if (videoList && videoList.value !== videoIdentifier) {
         logger.debug(`Updating video list selection to: ${videoIdentifier}`, 'ui');
         videoList.value = videoIdentifier || ''; // Use empty string if null/undefined
    }
}

// --- Viewer List Handling (Admin Only) ---

// Handle viewer list update from server message
function handleViewerList(message) {
    if (userRole !== 'admin') return;

    const newViewers = message.viewers || [];
    logger.debug(`Received viewer list update with ${newViewers.length} viewers.`, 'admin');

    const previousViewerIps = new Set(currentViewerIps); // Copy previous IPs
    currentViewerIps.clear(); // Reset current IPs for this update
    let viewersChanged = false;

    // Update time estimates and check for joins/leaves
    newViewers.forEach(viewer => {
        const viewerIp = viewer.ip;
        currentViewerIps.add(viewerIp); // Add to current set

        if (!previousViewerIps.has(viewerIp)) {
            viewersChanged = true; // New viewer joined
            logger.info(`Viewer joined: ${viewer.name || 'Anonymous'} (${viewerIp})`, 'admin');
        }

        // Always update the estimate data for the viewer
        const timestamp = Date.now();
        const isPlaying = viewer.isPlaying !== undefined ? viewer.isPlaying : masterState?.isPlaying || false;
        let estimatedPlaybackRate = serverPlaybackRate; // Start with server rate

        // Use viewer's reported rate if available and reasonable
        if (viewer.playbackRate !== undefined && viewer.playbackRate !== null && viewer.playbackRate > 0.1 && viewer.playbackRate < 5) {
             estimatedPlaybackRate = viewer.playbackRate;
        }

        // Update or add the viewer's estimate in the map
        viewerTimeEstimates.set(viewerIp, {
            lastReportedTime: viewer.currentTime !== undefined && viewer.currentTime !== null ? viewer.currentTime : 0,
            timestamp: timestamp, // Time we received the data
            playbackRate: estimatedPlaybackRate,
            isPlaying: isPlaying,
            drift: viewer.drift, // Store the latest server-calculated drift
            name: viewer.name || 'Anonymous',
            role: viewer.role || 'viewer' // Store role
        });
    });

    // Check if any viewers left
    previousViewerIps.forEach(ip => {
        if (!currentViewerIps.has(ip)) {
            viewersChanged = true;
            viewerTimeEstimates.delete(ip); // Remove estimate for disconnected viewer
            logger.info(`Viewer left: (${ip})`, 'admin');
        }
    });

    // Update global connectedViewers array (consider if needed, map might be sufficient)
    // connectedViewers = newViewers; // This might be redundant if we always use the map

    // Redraw table structure ONLY if the set of viewers changed
    if (viewersChanged) {
        redrawViewerTable(); // This redraws structure and calls updateViewersTimeEstimates
    } else {
        // If only data changed (no joins/leaves), just update the existing table cells
        updateViewersTimeEstimates();
    }

    // Update viewer count display
    updateViewerCount();
}

// Redraws the entire viewer list table structure (called when viewers join/leave)
function redrawViewerTable() {
    if (!viewersList || userRole !== 'admin') return;

    logger.debug("Redrawing viewer table structure.", "admin");
    viewersList.innerHTML = ''; // Clear existing table content

    // Get current viewers from the estimates map keys
    const currentViewers = Array.from(viewerTimeEstimates.entries());

    currentViewers.forEach(([ip, viewerData]) => {
        const row = document.createElement('tr');
        if (viewerData.role === 'admin') {
            row.classList.add('admin-row');
        }

        // Name Cell
        const nameCell = document.createElement('td');
        nameCell.textContent = viewerData.name;
        nameCell.setAttribute('data-viewer-name-ip', ip);
        row.appendChild(nameCell);

        // IP Cell (Masked) - Masking should happen here ideally
        const ipCell = document.createElement('td');
        const maskedIp = ip.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.xxx');
        ipCell.textContent = maskedIp;
        ipCell.setAttribute('data-viewer-ip-ip', ip);
        row.appendChild(ipCell);

        // Time Cell (with data attribute for updates)
        const timeCell = document.createElement('td');
        timeCell.textContent = '--:--'; // Placeholder, will be updated
        timeCell.setAttribute('data-viewer-time-ip', ip); // Add identifier
        row.appendChild(timeCell);

        // Status Cell (with data attribute for updates)
        const statusCell = document.createElement('td');
        statusCell.textContent = 'Calculating...'; // Placeholder
        statusCell.setAttribute('data-viewer-status-ip', ip); // Add identifier
        row.appendChild(statusCell);

        viewersList.appendChild(row);
    });

    // Immediately update times/status after redrawing structure
    updateViewersTimeEstimates();
}

// Update the times and status in the existing viewer list table cells
function updateViewersTimeEstimates() {
    if (!viewersList || userRole !== 'admin' || document.hidden) return; // Skip if tab not visible

    const now = Date.now();

    // Iterate through the estimates map
    viewerTimeEstimates.forEach((estimate, ip) => {
        const timeCell = viewersList.querySelector(`td[data-viewer-time-ip="${ip}"]`);
        const statusCell = viewersList.querySelector(`td[data-viewer-status-ip="${ip}"]`);

        if (!timeCell || !statusCell) return; // Skip if row elements not found

        // --- Time Update ---
        let estimatedTime = estimate.lastReportedTime;
        // Advance time only if master state and viewer state indicate playing
        if (masterState?.isPlaying && estimate.isPlaying) {
            const elapsedSeconds = (now - estimate.timestamp) / 1000;
            estimatedTime += elapsedSeconds * estimate.playbackRate;
        }
        // Ensure estimated time doesn't exceed video duration if known
        if (videoPlayer.duration && !isNaN(videoPlayer.duration) && estimatedTime > videoPlayer.duration) {
             estimatedTime = videoPlayer.duration;
        }
        timeCell.textContent = formatTime(estimatedTime);

        // --- Status Update ---
        let statusText = 'Unknown';
        let statusClass = '';

        // Use server-provided drift if available and recent (e.g., < 5s old)
        if (estimate.drift !== undefined && estimate.drift !== null && (now - estimate.timestamp < 5000)) {
            const drift = estimate.drift;
            const absDrift = Math.abs(drift);

            if (absDrift < syncThresholdModerate) { // Use moderate threshold for "in sync" visual
                statusText = 'In sync';
                statusClass = 'status-synced';
            } else {
                const driftRounded = Math.round(absDrift * 10) / 10;
                const direction = drift < 0 ? 'behind' : 'ahead';
                statusText = `${driftRounded.toFixed(1)}s ${direction}`;
                statusClass = 'status-desynced';
            }
        }
        // Fallback: Estimate drift based on local calculation if drift data is old/missing
        else if (lastServerTimeUpdate > 0 && videoPlayer.duration && !isNaN(videoPlayer.duration)) {
            // Estimate server's current time
            const elapsedServerSeconds = (now - lastServerTimeUpdate) / 1000;
            let estimatedServerTime = lastServerTime + (masterState?.isPlaying ? (elapsedServerSeconds * serverPlaybackRate) : 0);
            estimatedServerTime = Math.max(0, Math.min(estimatedServerTime, videoPlayer.duration));

            const estimatedDrift = estimatedTime - estimatedServerTime;
            const absDrift = Math.abs(estimatedDrift);

            if (absDrift < syncThresholdModerate) { // Use moderate threshold for "in sync" visual
                statusText = 'In sync (est.)';
                statusClass = 'status-synced';
            } else {
                const driftRounded = Math.round(absDrift * 10) / 10;
                const direction = estimatedDrift < 0 ? 'behind' : 'ahead';
                statusText = `${driftRounded.toFixed(1)}s ${direction} (est.)`;
                statusClass = 'status-desynced';
            }
        }

        statusCell.textContent = statusText;
        statusCell.className = statusClass; // Apply class (clears others)
        // Re-apply data attribute just in case className setting removed it (unlikely but safe)
        statusCell.setAttribute('data-viewer-status-ip', ip);
    });
}

// Update the viewer count display (Admin only)
function updateViewerCount() {
    if (!viewerCount || userRole !== 'admin') return;
    
    // Count all connected users including admin
    // Get all viewers from the estimates map
    const allViewersCount = Array.from(viewerTimeEstimates.values()).length;
    
    // Update the counter display with animation
    const currentCount = parseInt(viewerCount.textContent || '0');
    if (currentCount !== allViewersCount) {
        // Add a subtle animation effect
        const countContainer = document.getElementById('viewer-count-container');
        if (countContainer) {
            countContainer.classList.add('pulse-animation');
            setTimeout(() => {
                countContainer.classList.remove('pulse-animation');
            }, 1000);
        }
        
        // Update the count
        viewerCount.textContent = allViewersCount.toString();
        
        // Log for debugging
        logger.debug(`Updated viewer count to ${allViewersCount} (includes admin)`, 'admin');
    }
}

// Start the smooth viewer time update loop (Admin only)
function startSmoothViewerTimeUpdates() {
    if (userRole !== 'admin' || viewerListAnimationId !== null) return;

    logger.info("Starting smooth viewer time updates loop.", "admin");
    function animationStep() {
        updateViewersTimeEstimates(); // Update the times/status in the existing table
        viewerListAnimationId = requestAnimationFrame(animationStep);
    }
    viewerListAnimationId = requestAnimationFrame(animationStep);
}

// Stop the smooth viewer time update loop
function stopSmoothViewerTimeUpdates() {
    if (viewerListAnimationId !== null) {
        cancelAnimationFrame(viewerListAnimationId);
        viewerListAnimationId = null;
        logger.info("Stopped smooth viewer time updates loop.", "admin");
    }
}

// Request the viewer list from server (admin only)
function requestViewerList() {
    if (userRole !== 'admin') return;
    logger.info('Requesting initial viewer list.', 'admin');
    sendControlMessage('requestViewerList'); // (websocket.js)
}

// --- Theater Mode ---

// Toggle theater mode class on body
function toggleTheaterMode() {
    document.body.classList.toggle('theater-mode');
    logger.debug(`Theater mode toggled: ${document.body.classList.contains('theater-mode')}`, 'ui');
    // Optionally save state to localStorage if persistence is desired
    // localStorage.setItem('theaterMode', document.body.classList.contains('theater-mode'));
}

// Initialize theater mode based on saved state (call on load)
/* function initTheaterMode() {
    if (localStorage.getItem('theaterMode') === 'true') {
        document.body.classList.add('theater-mode');
    }
} */ 