# Project Tasks

## Phase 1: Project Initialization & Setup (Completed)

- [x] Initialize Node.js project (`npm init -y`)
- [x] Install dependencies (`npm install express ws`)
- [x] Create basic directory structure:
  - `public/` (for client-side HTML, CSS, JS)
  - `public/index.html`
  - `public/style.css`
  - `public/client.js`
  - `videos/` (for storing video files)
  - `server.js`
- [x] Place a sample video file in the `videos/` directory (e.g., `videos/sample.mp4`)
- [x] Add `.gitignore` file (e.g., include `node_modules/`, maybe `videos/`)
- [x] Decide on password configuration method (e.g., environment variables `ADMIN_PASSWORD`, `VIEWER_PASSWORD`)

## Phase 2: Backend Development (`server.js`)

- [x] Create basic Express server structure. (2024-07-28)
- [x] Serve static files from `public/` directory. (2024-07-28)
- [x] Implement video serving endpoint (`/video/:filename`) handling range requests. (2024-07-28)
- [x] Implement WebSocket server (`ws`) setup. (2024-07-28)
- [x] **Authentication:**
    - [x] Implement password validation logic (check against `ADMIN_PASSWORD`, `VIEWER_PASSWORD`). (2024-07-28)
    - [x] Determine method for receiving password (e.g., initial WS message). (2024-07-28)
    - [x] Assign role (`admin`/`viewer`) to authenticated WebSocket connections. (2024-07-28)
- [x] Manage connected clients list (add/remove authenticated clients, store roles). (2024-07-28)
- [x] Define WebSocket message types/structure (e.g., `auth`, `play`, `pause`, `seek`, `changeVideo`, `requestVideoList`, `videoList`, `syncState`, `error`). (2024-07-28)
- [x] Implement master playback state storage (current video, time, playing/paused status). (2024-07-28)
- [x] Implement handler for `play` message (admin only). (2024-07-28)
- [x] Implement handler for `pause` message (admin only). (2024-07-28)
- [x] Implement handler for `seek` message (admin only). (2024-07-28)
- [x] Implement handler for `changeVideo` message (admin only). (2024-07-28)
- [x] Implement logic to read available video filenames from `videos/` directory. (2024-07-28)
- [x] Implement handler for `requestVideoList` message (admin only). (2024-07-28)
- [x] Send `videoList` message to admin upon request. (2024-07-28)
- [x] Implement broadcasting function to send `syncState` to all clients. (2024-07-28)
- [x] Broadcast state updates periodically and/or upon admin actions. (2024-07-28)
- [x] Handle WebSocket connection errors and client disconnections gracefully (remove from list). (2024-07-28)

## Phase 3: Frontend Development (`public/`)

- [x] **HTML (`index.html`):** (2024-07-28)
    - [x] Create password prompt form (initially visible).
    - [x] Create main application container (initially hidden).
    - [x] Add `<video>` element.
    - [x] Add admin controls container (play/pause button, seek bar, video list dropdown/buttons).
    - [x] Add viewer status indicator (e.g., "Connected as Viewer").
- [x] **CSS (`style.css`):** (2024-07-28)
    - [x] Basic styling for layout.
    - [x] Styling for password prompt.
    - [x] Styling to show/hide elements based on state (prompt, admin UI, viewer UI).
- [x] **JavaScript (`client.js`):** (2024-07-28)
    - [x] **Authentication:**
        - [x] Add event listener to password form.
        - [x] Implement function to send password to server (e.g., via initial WS message).
        - [x] Handle authentication response (success/failure).
        - [x] Store received role (`admin`/`viewer`).
        - [x] Establish persistent WebSocket connection upon success.
        - [x] Show/hide UI elements based on role and auth status.
    - [x] **WebSocket Handling:**
        - [x] Implement WebSocket message listener.
        - [x] Handle `syncState` messages (update video player, see Phase 4).
        - [x] Handle `videoList` messages (populate admin UI).
        - [x] Handle `error` messages from server.
    - [x] **Admin UI Logic (if role is 'admin'):**
        - [x] Add event listeners for play/pause button.
        - [x] Add event listener for seek bar changes (consider debouncing).
        - [x] Add event listener for video selection changes.
        - [x] Send corresponding messages (`play`, `pause`, `seek`, `changeVideo`) to server via WebSocket.
        - [x] Request video list from server on load (`requestVideoList`).
    - [x] **Video Element Handling:**
        - [x] Get reference to `<video>` element.
        - [x] Update `video.src` based on server messages.

## Phase 4: Synchronization Logic Implementation (`client.js`)

- [x] Implement function to handle received `syncState` data (targetTime, isPlaying, videoSrc). (2024-07-28)
- [x] Update video `src` if changed. (2024-07-28)
- [x] Set video `paused` state based on `isPlaying`. (2024-07-28)
- [x] **Advanced Sync Algorithm:** (2024-07-28)
    - [x] Get local `video.currentTime`.
    - [x] Define `syncThreshold` and `rateAdjust` constants.
    - [x] Compare local time to server's target time.
    - [x] Adjust `video.playbackRate` slightly (e.g., 1.05 or 0.95) if outside `syncThreshold`.
    - [x] Reset `video.playbackRate` to 1.0 if within `syncThreshold`.
    - [x] (Optional) Implement large desync jump (`video.currentTime = serverTime`) if difference exceeds a larger threshold.
- [x] Call sync handling function regularly (e.g., using `setInterval` or on `timeupdate` events, being mindful of performance). (2024-07-28)
- [x] Ensure initial state is synced correctly upon connection. (2024-07-28)

## Phase 5: Testing & Refinement

- [ ] Test password validation (admin/viewer/incorrect).
- [ ] Test admin controls trigger state changes and broadcasts.
- [ ] Test viewers receive updates and cannot control playback.
- [ ] Test video switching for all clients.
- [ ] Test synchronization with multiple clients (different browsers/tabs).
- [ ] Test with network throttling (devtools) to verify rate adjustments.
- [ ] Test edge cases (admin disconnects, viewer disconnects, rapid clicks).
- [ ] Tune `syncThreshold` and `rateAdjust` values.

## Phase 6: Documentation & Cleanup

- [ ] Update `README.md` with setup instructions (env variables) and usage.
- [ ] Add code comments, especially for auth and sync logic.
- [ ] Refactor and clean up code.

## Phase 7: Video Encoding with FFmpeg

- [x] Install FFmpeg dependencies (`fluent-ffmpeg`, `ffmpeg-static`). (2024-07-29)
- [x] Create video encoding module with support for MP4 encoding, HLS stream creation, and thumbnail generation. (2024-07-29)
- [x] Implement server API routes for video encoding operations. (2024-07-29)
- [x] Update video listing functionality to recognize HLS streams. (2024-07-29)
- [x] Update video serving endpoint to properly handle HLS playlists and segments. (2024-07-29)
- [x] Add client-side support for HLS.js to play HLS streams. (2024-07-29)
- [x] Add encoding UI controls for admin users. (2024-07-29)
- [x] Add security to encoding endpoints (admin authentication). (2024-07-29)
- [ ] Test encoding with various video formats and quality settings.
- [ ] Add progress tracking for encoding jobs.

## Phase 7.5: Auto-Encoding & MKV Support (2024-07-29)

- [ ] Update video discovery logic to include `.mkv` files.
- [ ] Ensure `video-encoder.js` (`createHLSStream`) handles `.mkv` input and outputs to a dedicated `videos/processed/` directory.
- [ ] Implement automatic HLS encoding on server startup:
    - [ ] Scan `videos/` for unprocessed `.mp4` and `.mkv` files (files without a corresponding HLS folder in `videos/processed/`).
    - [ ] Trigger `createHLSStream` for each unprocessed file.
- [ ] Modify `getVideoList()` to primarily list HLS streams from `videos/processed/`.
- [ ] Update `/video/:filename` endpoint to correctly serve HLS segments from `videos/processed/`.
- [ ] Update client-side (`client.js`) to correctly use HLS stream paths from the updated video list.
- [ ] (Decision) Update or remove manual encoding API routes (`/api/encode`, `/api/create-hls`) - currently keeping, but ensuring output goes to `videos/processed/`.
- [ ] Test auto-encoding with `.mp4` and `.mkv` files.
- [ ] Test playback of auto-encoded HLS streams.

## Phase 7.7: Adaptive Bitrate Streaming (ABR) (2024-07-29)

- [x] Modify `video-encoder.js` (`createHLSStream`) to encode multiple renditions (e.g., 480p, 720p, 1080p) with varying bitrates.
- [x] Ensure `createHLSStream` generates a master M3U8 playlist (`master.m3u8`) referencing the individual rendition playlists.
- [x] Update storage structure within `videos/processed/` to accommodate multiple renditions (e.g., `videos/processed/<streamName>/<resolution>/`).
- [x] Update `server.js` (`scanAndEncodeVideos`) to correctly call the new ABR encoding process.
- [ ] Verify `hls.js` on the client automatically handles ABR playback using the new master playlist.
- [ ] Test ABR encoding with various source files.
- [ ] Note: ABR significantly increases encoding time and disk space.

## Phase 7.8: Adaptive Sync Frequency (2024-07-29)

- [x] Modify server-side state (`server.js`) to track per-client sync status (e.g., last drift, current sync interval).
- [x] Replace global periodic sync timer with per-client `setTimeout` logic (`scheduleNextSync`).
- [x] Implement server-side logic to adjust individual client sync intervals based on reported drift.
- [x] Add `clientTimeUpdate` WebSocket message handler on the server.
- [x] Modify client (`client.js`) to periodically send `clientTimeUpdate` messages with current video time.
- [ ] Test adaptive sync logic with simulated client drift.

## Phase 8: (Optional) Deployment

- [ ] Choose hosting platform.
- [ ] Configure environment variables securely.
- [ ] Deploy application. 