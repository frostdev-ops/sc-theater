# Plex Integration for Shadow Company Theater

This document explains how to set up and use the Plex streaming integration with Shadow Company Theater.

## Features

- Stream content directly from your Plex Media Server
- Browse Plex libraries and select content (admin only)
- Full synchronization of Plex playback across all viewers
- Seamless integration with existing HLS functionality

## Setup Instructions

### 1. Configuration

Edit the `.env` file in the project root and add the following variables:

```
# Plex Integration
PLEX_URL=http://your-plex-server:32400  # Your Plex server URL (including port)
PLEX_TOKEN=your_plex_token              # Your Plex authentication token
```

#### How to obtain your Plex token:

1. Log in to your Plex account in a web browser
2. Play any video in your library
3. While the video is playing, right-click and select "Inspect" or "Inspect Element"
4. Navigate to the Network tab
5. Look for requests to your Plex server and find the `X-Plex-Token` parameter in the request URL
6. Copy this token value to your `.env` file

### 2. Starting the Server

Start the Shadow Company Theater server as usual:

```
npm start
```

The server will automatically detect your Plex configuration and enable the integration.

## Usage

### For Admins

1. Log in as an admin
2. In the video selection controls, you'll see a new "Browse Plex" button
3. Click this button to open the Plex browser dialog
4. Select a library from the left panel
5. Browse the content in the right panel
6. Click on any item to select it for playback
7. The video will start streaming to all connected viewers, with full synchronization

### For Viewers

Viewers will automatically see and play Plex content when an admin selects it. All synchronization features work the same as with HLS videos.

## Technical Implementation

- Plex content is streamed via a redirect to the original Plex URL (requires viewers to have access to the Plex server)
- Video IDs are prefixed with "plex:" to distinguish them from HLS content
- All synchronization is handled by the existing WebSocket infrastructure
- The Plex API is called through a dedicated PlexService class

## Troubleshooting

- If Plex content doesn't appear, check that your Plex server is accessible from the client's network
- Ensure your Plex token is valid and has not expired
- Check the server logs for any API errors when accessing Plex content

## Security Considerations

- Your Plex token provides access to your entire Plex server - keep it secure
- Consider using a managed user token with limited access instead of your main account token
- The server does not store any Plex credentials beyond what's in the .env file
