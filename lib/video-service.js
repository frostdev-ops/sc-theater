const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // Sync version for specific checks like initial stat

class VideoService {
    constructor(logger, options) {
        this.logger = logger;
        this.videoEncoder = options.videoEncoder; // Dependency injection
        // Use absolute path to videos directory
        this.videoDir = path.resolve(path.join(__dirname, '..', 'videos')); // Use absolute path
        this.logger.info(`Video directory: ${this.videoDir}`, 'video');
        this.processedDir = path.join(this.videoDir, 'processed');
        this.encodingQueue = new Set(); // Keep track of files currently being encoded
        this.hlsStreams = []; // Cache the list of available HLS streams

        if (!this.videoEncoder) {
            this.logger.error('videoEncoder dependency was not provided to VideoService!', 'video');
            throw new Error('Missing videoEncoder dependency');
        }
        this.logger.info('VideoService initialized.', 'video');
    }

    // --- Video Listing ---
    async refreshVideoList() {
        this.logger.debug('Refreshing HLS stream list...', 'video');
        try {
            await fs.mkdir(this.processedDir, { recursive: true });
            const entries = await fs.readdir(this.processedDir, { withFileTypes: true });
            let currentStreams = [];

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const streamDir = path.join(this.processedDir, entry.name);
                    try {
                        // Check if master.m3u8 exists and is readable
                        await fs.access(path.join(streamDir, 'master.m3u8'), fs.constants.R_OK);
                        currentStreams.push(`hls:${entry.name}`);
                    } catch (err) {
                        // Ignore directories without a readable master playlist
                         this.logger.warn(`Directory ${entry.name} in processed/ does not contain a readable master.m3u8, skipping.`, 'video');
                    }
                }
            }
            this.hlsStreams = currentStreams;
            this.logger.info(`Refreshed HLS stream list. Found: ${this.hlsStreams.join(', ') || 'None'}`, 'video');
            return this.hlsStreams;
        } catch (err) {
            this.logger.error(`Error refreshing video list from ${this.processedDir}:`, err, 'video');
            this.hlsStreams = []; // Reset on error
            return [];
        }
    }

    async getVideoList() {
        // Return cached list if available, otherwise refresh
        if (this.hlsStreams.length > 0) {
            return this.hlsStreams;
        }
        return await this.refreshVideoList();
    }

    // --- Filename Validation ---
    isValidVideoFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return false;
        }
        if (filename.startsWith('hls:')) {
            const dirName = filename.substring(4);
            // Basic check for valid directory characters (alphanumeric, underscore, hyphen)
            // Avoid path traversal characters
            return dirName && /^[a-zA-Z0-9_-]+$/.test(dirName) && !dirName.includes('..');
        }
        this.logger.warn(`isValidVideoFilename rejected non-HLS reference: ${filename}`, 'video');
        return false;
    }

    // --- HLS Segment Serving ---
    handleHlsRequest(req, res) {
        const streamNameWithSubPath = req.params[0]
            ? `${req.params.streamName}/${req.params[0]}`
            : req.params.streamName;
        this.logger.debug(`Handling HLS request: ${streamNameWithSubPath}`, 'hls');

        // Validate stream name and subpath components separately for safety
        const parts = streamNameWithSubPath.split('/').filter(p => p);
        if (parts.length === 0 || parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part.includes('..'))) {
            this.logger.warn(`Invalid characters or path traversal attempt in HLS request: ${streamNameWithSubPath}`, 'hls');
            return res.status(400).send('Invalid request path');
        }

        const requestedPath = path.join(this.processedDir, ...parts);

        // Final security check: Ensure the resolved path is within the processed directory
        const normalizedPath = path.normalize(requestedPath);
        if (!normalizedPath.startsWith(this.processedDir)) {
            this.logger.error(`Path traversal attempt detected: ${streamNameWithSubPath} resolved to ${normalizedPath}`, 'hls');
            return res.status(403).send('Access denied');
        }

        // Check if file exists using sync stat for quick check before async stream
        try {
            const stats = fsSync.statSync(normalizedPath);
            if (!stats.isFile()) {
                this.logger.warn(`HLS request target is not a file: ${normalizedPath}`, 'hls');
                return res.status(404).send('Not Found');
            }

            // Determine content type
            let contentType = 'application/octet-stream'; // Default
            const ext = path.extname(normalizedPath).toLowerCase();
            if (ext === '.m3u8') {
                contentType = 'application/vnd.apple.mpegurl';
            } else if (ext === '.ts') {
                contentType = 'video/mp2t';
            }

            // Serve the file (Range requests not typically needed/used for HLS segments/playlists)
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stats.size,
                'Cache-Control': 'public, max-age=3600' // Cache segments and playlists
            });

            const fileStream = fsSync.createReadStream(normalizedPath);
            fileStream.pipe(res);

            fileStream.on('error', (streamErr) => {
                this.logger.error(`Error streaming HLS file ${normalizedPath}:`, streamErr, 'hls');
                if (!res.headersSent) {
                    res.status(500).send('Error streaming file');
                } else {
                    res.end();
                }
            });

        } catch (err) {
            if (err.code === 'ENOENT') {
                this.logger.warn(`HLS file not found: ${normalizedPath}`, 'hls');
                return res.status(404).send('Not Found');
            } else {
                this.logger.error(`Error accessing HLS file ${normalizedPath}:`, err, 'hls');
                return res.status(500).send('Server error');
            }
        }
    }

    // --- Video Scanning and Encoding ---
    async scanAndEncodeVideos() {
        this.logger.info('Scanning for unprocessed videos...', 'video');
        const allowedInputExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.wmv']; // Add more if needed

        try {
            await fs.mkdir(this.processedDir, { recursive: true });
            const entries = await fs.readdir(this.videoDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile()) {
                    const inputFile = entry.name;
                    const inputExt = path.extname(inputFile).toLowerCase();
                    const fullInputPath = path.join(this.videoDir, inputFile);

                    if (allowedInputExtensions.includes(inputExt)) {
                        if (this.encodingQueue.has(inputFile)) {
                            this.logger.debug(`Skipping ${inputFile}, already in encoding queue.`, 'video');
                            continue;
                        }

                        const outputName = path.basename(inputFile, inputExt).replace(/[^\w-]+/g, '_'); // Sanitize
                        const outputDir = path.join(this.processedDir, outputName);
                        const masterPlaylistPath = path.join(outputDir, 'master.m3u8');

                        try {
                            await fs.access(masterPlaylistPath);
                            // logger.debug(`HLS stream already exists for ${inputFile}`);
                        } catch (err) {
                            // HLS does not exist, needs encoding
                            this.logger.info(`Found unprocessed video: ${inputFile}. Adding to encoding queue.`, 'video');
                            this.encodingQueue.add(inputFile);

                            // Start encoding (don't wait)
                            this._encodeVideo(fullInputPath, outputName, inputFile);
                        }
                    }
                }
            }
        } catch (err) {
            this.logger.error('Error scanning videos directory:', err, 'video');
        }
        this.logger.info('Video scan complete.', 'video');
        // Initial list refresh after scan
        await this.refreshVideoList();
    }

    async _encodeVideo(fullInputPath, outputName, originalFilename) {
        try {
            const masterPlaylistPath = await this.videoEncoder.createHLSStream(fullInputPath, outputName);
            this.logger.info(`Successfully created HLS stream for ${originalFilename}. Playlist: ${masterPlaylistPath}`, 'video');

             // Optionally create thumbnail
            // try {
            //     await this.videoEncoder.createThumbnail(fullInputPath, outputName, 1);
            //     this.logger.info(`Successfully created thumbnail for ${outputName}`, 'video');
            // } catch (thumbErr) {
            //     this.logger.error(`Failed to create thumbnail for ${outputName}:`, thumbErr, 'video');
            // }

            // Refresh video list after successful encoding
            await this.refreshVideoList();
            // TODO: Notify admins via WebSocket?

        } catch (encodeErr) {
            this.logger.error(`Error creating HLS stream for ${originalFilename}:`, 'video', encodeErr);
        } finally {
            this.encodingQueue.delete(originalFilename); // Remove from queue
        }
    }

    startVideoScan(intervalMinutes = 15) {
         // Stop existing timer first
         if (this.scanIntervalId) clearInterval(this.scanIntervalId);

         const intervalMs = intervalMinutes * 60 * 1000;
         this.logger.info(`Starting periodic video scan every ${intervalMinutes} minutes.`, 'video');
         // Run scan once immediately on startup
         this.scanAndEncodeVideos().catch(err => this.logger.error('Error during initial video scan:', err, 'video'));
         // Schedule periodic scans
         this.scanIntervalId = setInterval(() => {
             this.scanAndEncodeVideos().catch(err => this.logger.error('Error during periodic video scan:', err, 'video'));
         }, intervalMs);
         this.scanIntervalId.unref(); // Allow Node to exit
    }

    stopVideoScan() {
        if (this.scanIntervalId) {
            this.logger.info('Stopping periodic video scan.', 'video');
            clearInterval(this.scanIntervalId);
            this.scanIntervalId = null;
        }
    }

    // --- Router for HTTP requests ---
    getRouter() {
        const express = require('express');
        const router = express.Router();

        // Route for HLS segments/playlists
        // Matches /video/streamName/anything.m3u8 or /video/streamName/anything.ts
        router.get('/:streamName/*', this.handleHlsRequest.bind(this));

        // Add other video-related routes here if needed
        // e.g., router.get('/list', this.handleListRequest.bind(this));

        return router;
    }
}

module.exports = VideoService; 