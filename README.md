# Shadow Company Theater

A web application that allows an admin to control synchronized video playback across multiple viewer clients. Perfect for team briefings, training sessions, or collaborative viewing experiences.

## Overview

Shadow Company Theater provides a centralized platform where a designated administrator can control video playback for multiple viewers simultaneously. This ensures everyone watches the same content at the same time, with perfect synchronization across all connected devices regardless of network conditions or device types.

## Features

- Synchronized video playback across multiple devices
- Admin/viewer role-based access control
- Admin controls for play, pause, seek, and video selection
- Real-time synchronization via WebSockets
- Video streaming with support for range requests
- Responsive design that works on desktops, tablets, and mobile devices
- Session persistence for seamless viewing experience
- Support for multiple video formats (MP4, WebM, Ogg)

## Setup

### Prerequisites

- Node.js (v12 or newer)
- npm

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/shadow-company-theater.git
   cd shadow-company-theater
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `videos` directory in the project root (if it doesn't exist)
   ```bash
   mkdir -p videos
   ```
4. Place video files (MP4, WebM, Ogg) in the `videos` directory

### Configuration

You can configure the application using environment variables. The simplest way is to create a `.env` file in the project root:

```
# .env file
ADMIN_PASSWORD=your_admin_password
VIEWER_PASSWORD=your_viewer_password
PORT=4000
```

Alternatively, you can set environment variables manually:

```bash
# Linux/Mac
export ADMIN_PASSWORD=your_admin_password
export VIEWER_PASSWORD=your_viewer_password

# Windows (Command Prompt)
set ADMIN_PASSWORD=your_admin_password
set VIEWER_PASSWORD=your_viewer_password

# Windows (PowerShell)
$env:ADMIN_PASSWORD="your_admin_password"
$env:VIEWER_PASSWORD="your_viewer_password"
```

### Running the Server

```bash
node server.js
```

The server will be available at http://localhost:4000

## Testing

### Backend Testing

Two test scripts are provided to test the server functionality:

#### WebSocket Communication Test

Test the WebSocket communication including authentication and admin commands:

```bash
node test-client.js
```

This will open an interactive CLI that allows you to:
1. Connect to the WebSocket server
2. Authenticate as admin or viewer
3. Send various commands (play, pause, seek, change video)
4. View server responses

#### Video Streaming Test

Test the video streaming endpoint including range requests:

```bash
node test-video.js
```

This script will:
1. Create a sample video file (if needed)
2. Test basic video requests
3. Test range requests (partial content)
4. Test invalid range handling
5. Test path traversal protection

Note: The test script automatically creates a dummy `sample.mp4` file in the videos directory if one doesn't exist. This is only for testing purposes and is not a real video file.

## Usage

1. Open the application in a browser: http://localhost:4000
2. Enter admin or viewer password as appropriate
3. Admin users will see playback controls and a video selection list
4. Viewer users will only see the synchronized video player
5. All connected clients will stay in sync with the admin's playback

### Admin Features

- Play/pause video for all connected clients
- Seek to specific timestamps
- Select different videos from the library
- See the number of connected viewers
- Send announcements to all viewers

### Viewer Features

- Watch videos in sync with the admin and other viewers
- See current playback status (playing/paused)
- View video title and timestamp information

## Project Structure

- `server.js` - Main server implementation (Express + WebSocket)
- `public/` - Client-side web application files
  - `index.html` - Main HTML page
  - `style.css` - CSS styling
  - `client.js` - Client-side JavaScript
- `videos/` - Directory for video files
- `test-client.js` - WebSocket testing utility
- `test-video.js` - Video endpoint testing utility

## Technical Implementation

Shadow Company Theater uses a combination of technologies:
- Express.js for the HTTP server and static file serving
- WebSockets for real-time communication between server and clients
- HTML5 Video API for playback control
- Browser localStorage for session persistence
- Range requests for efficient video streaming

## Security Notes

- Always set strong passwords for both admin and viewer roles
- The application doesn't use HTTPS by default - consider adding SSL/TLS for production use
- For public deployment, consider adding rate limiting and additional authentication methods
- Video files are served directly - ensure proper access controls are in place

## Troubleshooting

- If videos aren't loading, check that they exist in the `videos` directory and have the correct permissions
- For WebSocket connection issues, verify there are no firewalls blocking the connection
- If synchronization seems off, check for clock drift between devices

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 