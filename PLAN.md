# Project Plan: Synced Video Player

This document outlines the development plan for the synchronized video player application.

## Core Concept Revision
- Users are prompted for a password upon visiting the page.
- Entering the **Admin password** grants control over video playback (play, pause, seek) and selection.
- Entering the **Viewer password** allows passive watching of the synchronized stream.
- Incorrect passwords deny access.
- Passwords should be configurable (e.g., via environment variables).

## Phases

1.  **Project Initialization & Setup**
    *   Initialize Node.js project (`npm init`).
    *   Install necessary dependencies (Express, ws).
    *   Set up basic project structure (directories for client-side code, server file, video storage).
    *   Create initial documentation (`README.md`, `PLAN.md`, `TASK.md`).
    *   **Define Password Configuration:** Decide on mechanism (e.g., environment variables `ADMIN_PASSWORD`, `VIEWER_PASSWORD`).

2.  **Backend Development**
    *   Create an Express server (`server.js`) to serve static files (HTML, CSS, JS).
    *   Implement endpoint for serving video files (handling range requests).
    *   Implement a WebSocket server using the `ws` library.
    *   **Authentication:**
        *   Implement logic to handle password submission (likely via an initial WebSocket message or a simple POST request before WS connection).
        *   Validate submitted passwords against configured Admin/Viewer passwords.
        *   Assign a role (admin/viewer) to the WebSocket connection upon successful authentication.
    *   Manage connected clients (add/remove authenticated clients, track their roles).
    *   Define WebSocket message structure (play, pause, seek, change_video, sync_state, request_video_list, video_list). Include sender's role or validate on server.
    *   Implement server-side logic for master playback state (video source, time, playing/paused).
    *   **Admin Check:** Ensure only messages from clients authenticated as 'admin' can trigger state changes (play, pause, seek, change_video).
    *   Implement logic to list available video files (from `videos/` directory).
    *   Implement WebSocket message handling for the admin to request/receive the video list.
    *   Implement broadcasting logic to send state updates to all authenticated 'viewer' and 'admin' clients.

3.  **Frontend Development**
    *   Create the main HTML page (`index.html`) with a password prompt mechanism (e.g., a simple form shown initially).
    *   Include the HTML5 `<video>` element (initially hidden or disabled until authenticated).
    *   Add basic CSS (`style.css`) for layout, styling, and the password prompt.
    *   Implement client-side JavaScript (`client.js`).
    *   **Authentication Flow:**
        *   Handle password form submission.
        *   Send password to the server for validation.
        *   Upon successful authentication response, establish WebSocket connection.
        *   Receive role (admin/viewer) from the server.
    *   **Admin UI (if role is 'admin'):**
        *   Show video controls (play, pause, seek bar).
        *   Show video selection UI (request and display list from server).
        *   Send control/selection commands (play, pause, seek, change_video) via WebSocket.
    *   **Viewer UI (if role is 'viewer'):**
        *   Hide/disable video controls.
        *   Show the video player.
    *   Hide password prompt and show appropriate UI after authentication.

4.  **Synchronization Logic Implementation**
    *   Implement client-side logic (for authenticated users) to receive state updates (`sync_state` message containing target `currentTime`, `isPlaying`, `currentVideoSrc`) from the server.
    *   Update local video player state (play/pause) and `src` based on server messages.
    *   **Advanced Sync Algorithm:**
        *   Maintain adequate client-side buffer (HTML5 video element default behavior helps).
        *   Continuously compare local `video.currentTime` to the latest received server `currentTime`.
        *   Define a synchronization threshold (e.g., `syncThreshold = 3` seconds).
        *   Define a maximum adjustment rate (e.g., `rateAdjust = 0.05` for 5%).
        *   If `localTime < serverTime - syncThreshold`, set `video.playbackRate = 1 + rateAdjust`.
        *   If `localTime > serverTime + syncThreshold`, set `video.playbackRate = 1 - rateAdjust`.
        *   If within threshold (`|localTime - serverTime| <= syncThreshold`), set `video.playbackRate = 1.0`.
        *   Consider adding a larger threshold check (e.g., 15 seconds) to trigger a direct `video.currentTime` seek if desync is significant, before applying rate adjustments.
    *   Handle latency and network jitter gracefully through buffering and gradual rate adjustment.
    *   Ensure new clients sync correctly upon connection/authentication.

5.  **Testing & Refinement**
    *   Test password validation.
    *   Test admin controls and viewer restrictions.
    *   Test video switching.
    *   **Test Synchronization Robustness:** Use tools (like browser devtools network throttling) to simulate varying network conditions and verify smooth playback rate adjustments and resyncing.
    *   Test with multiple authenticated clients under different simulated network conditions.
    *   Test edge cases (authentication failures, disconnects, rapid admin actions).
    *   Tune `syncThreshold` and `rateAdjust` values for optimal performance.

6.  **Documentation & Cleanup**
    *   Update `README.md` explaining password setup and usage.
    *   Add comments explaining the sync logic, especially the rate adjustment.
    *   Clean code.

7.  **(Optional) Deployment**
    *   Prepare for deployment, ensuring password configuration is handled securely.
    *   Deploy. 