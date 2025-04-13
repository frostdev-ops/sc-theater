const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs').promises; // Use async fs
const fsSync = require('fs'); // Sync fs for checks

// Set the path to the FFmpeg binary
// ffmpeg.setFfmpegPath(ffmpegStatic); // Commented out to use system FFmpeg

const videoDir = path.join(__dirname, '..', 'videos');
const processedDir = path.join(videoDir, 'processed'); // Outputs go here

// Ensure processed directory exists
if (!fsSync.existsSync(processedDir)) {
    fsSync.mkdirSync(processedDir, { recursive: true });
}

/**
 * Encode a video file to MP4 format with specified settings
 * @param {String} inputFile - Path to the input video file (relative to videoDir)
 * @param {String} outputName - Desired output filename (without extension)
 * @param {Object} options - Encoding options
 * @param {Number} options.videoBitrate - Video bitrate in kbps (default: 1000)
 * @param {Number} options.audioBitrate - Audio bitrate in kbps (default: 128)
 * @param {String} options.resolution - Output resolution (default: '1280x720')
 * @param {Number} options.fps - Frames per second (default: 30)
 * @returns {Promise} - Resolves with output path on success, rejects with error on failure
 */
async function encodeToMP4(inputFile, outputName, options = {}) {
    const defaults = {
        videoBitrate: 1000,
        audioBitrate: 128,
        resolution: '1280x720',
        fps: 30
    };

    const settings = { ...defaults, ...options };
    
    const inputFilePath = path.join(videoDir, inputFile);
    if (!fsSync.existsSync(inputFilePath)) {
        return Promise.reject(new Error(`Input file does not exist: ${inputFilePath}`));
    }

    const sanitizedName = outputName.replace(/\.[^/.]+$/, "").replace(/[^\w-]/g, "_");
    const outputFile = path.join(processedDir, `${sanitizedName}.mp4`);

    console.log(`Starting MP4 encoding for ${inputFile} to ${outputFile}`);

    return new Promise((resolve, reject) => {
        ffmpeg(inputFilePath)
            .outputOptions([
                `-b:v ${settings.videoBitrate}k`,
                `-b:a ${settings.audioBitrate}k`,
                `-r ${settings.fps}`,
                `-s ${settings.resolution}`,
                '-c:v libx264',
                '-preset medium',
                '-profile:v main',
                '-crf 23',
                '-c:a aac',
                '-movflags +faststart',
                '-pix_fmt yuv420p'
            ])
            .on('start', (commandLine) => {
                console.log(`FFmpeg process started (MP4): ${commandLine}`);
            })
            .on('progress', (progress) => {
                // Basic progress reporting
                 if (progress.percent && progress.percent > 0) {
                    console.log(`MP4 Encoding Progress (${inputFile}): ${Math.round(progress.percent)}%`);
                 } else if (progress.timemark) {
                     console.log(`MP4 Encoding Progress (${inputFile}): TimeMark ${progress.timemark}`);
                 }
            })
            .on('end', () => {
                console.log(`MP4 Encoding complete: ${outputFile}`);
                resolve(outputFile);
            })
            .on('error', (err) => {
                console.error(`Error encoding MP4 video (${inputFile}): ${err.message}`);
                reject(err);
            })
            .save(outputFile);
    });
}

/**
 * Convert a video file to an adaptive streaming format (HLS) with multiple renditions.
 * @param {String} inputFile - Path to the input video file (relative to videoDir).
 * @param {String} outputName - Desired base name for the HLS stream.
 * @returns {Promise<String>} - Resolves with the path to the master playlist on success.
 */
async function createHLSStream(inputFile, outputName) {
    const inputFilePath = path.join(videoDir, inputFile);
    if (!fsSync.existsSync(inputFilePath)) {
        throw new Error(`Input file does not exist: ${inputFilePath}`);
    }

    const sanitizedName = outputName.replace(/[^\w-]/g, "_");
    const streamBaseDir = path.join(processedDir, sanitizedName);
    const masterPlaylistPath = path.join(streamBaseDir, 'master.m3u8');

    // Clean existing directory if it exists
    if (fsSync.existsSync(streamBaseDir)) {
        console.log(`Removing existing HLS directory: ${streamBaseDir}`);
        await fs.rm(streamBaseDir, { recursive: true, force: true });
    }
    await fs.mkdir(streamBaseDir, { recursive: true });

    console.log(`Starting ABR HLS encoding for ${inputFile} to ${streamBaseDir}`);

    // Define Renditions (adjust as needed)
    const renditions = [
        { resolution: '640x360', vBitrate: '800k', aBitrate: '96k', name: '360p' },
        { resolution: '1280x720', vBitrate: '1800k', aBitrate: '128k', name: '720p' },
        { resolution: '1920x1080', vBitrate: '4000k', aBitrate: '128k', name: '1080p' }
    ];

    let masterPlaylistContent = '#EXTM3U\n#EXT-X-VERSION:3\n';

    // Process each rendition sequentially with simplified approach
    try {
        for (const rendition of renditions) { // Loop through all renditions
            const outputDir = path.join(streamBaseDir, rendition.name);
            if (!fsSync.existsSync(outputDir)) {
                fsSync.mkdirSync(outputDir, { recursive: true });
            }
            
            // First try simpler intermediate encoding to mp4
            console.log(`Creating intermediate MP4 for ${rendition.name} quality using GPU...`);
            const tempMp4Path = path.join(outputDir, 'intermediate.mp4');
            
            // Step 1: Create a simple mp4 file first using GPU
            await new Promise((resolve, reject) => {
                ffmpeg(inputFilePath)
                    .outputOptions([
                        // Add format filter to convert 10-bit input to 8-bit for nvenc
                        `-vf scale=${rendition.resolution}:force_original_aspect_ratio=decrease,format=pix_fmts=yuv420p`,
                        `-c:v h264_nvenc`, // Use NVIDIA GPU encoder
                        `-preset fast`,    // Use NVENC preset (p1-p7, default: p5)
                        `-b:v ${rendition.vBitrate}`, // Target video bitrate
                        `-c:a aac`,
                        `-b:a ${rendition.aBitrate}`,
                        `-ac 2`,
                        `-strict -2`, // Needed for AAC experimental codec
                        `-loglevel verbose` // More detailed logging
                    ])
                    .output(tempMp4Path)
                    .on('start', (commandLine) => {
                        console.log(`FFmpeg intermediate MP4 command (GPU): ${commandLine}`);
                    })
                    .on('stderr', (stderrLine) => {
                        console.log(`FFmpeg stderr: ${stderrLine}`);
                    })
                    .on('end', () => {
                        console.log(`Created intermediate MP4 for ${rendition.name} using GPU`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`Error creating intermediate MP4 with GPU: ${err.message}`);
                        reject(err);
                    })
                    .run();
            });
            
            // Step 2: Convert the MP4 to HLS
            console.log(`Converting MP4 to HLS for ${rendition.name}...`);
            const segmentFilename = path.join(outputDir, 'segment_%03d.ts');
            const playlistFilename = path.join(outputDir, 'playlist.m3u8');
            
            await new Promise((resolve, reject) => {
                ffmpeg(tempMp4Path)
                    .outputOptions([
                        `-c:v copy`, // Just copy the video (no re-encoding)
                        `-c:a copy`, // Just copy the audio (no re-encoding)
                        `-f hls`,
                        `-hls_time 10`,
                        `-hls_playlist_type vod`,
                        `-hls_list_size 0`,
                        `-hls_segment_filename ${segmentFilename}`, 
                        `-loglevel verbose` // More detailed logging
                    ])
                    .output(playlistFilename)
                    .on('start', (commandLine) => {
                        console.log(`FFmpeg HLS command: ${commandLine}`);
                    })
                    .on('stderr', (stderrLine) => {
                        console.log(`FFmpeg stderr: ${stderrLine}`);
                    })
                    .on('end', () => {
                        console.log(`Created HLS for ${rendition.name}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`Error creating HLS: ${err.message}`);
                        reject(err);
                    })
                    .run();
            });
            
            // Add to master playlist
            const bandwidth = parseInt(rendition.vBitrate) * 1000 + parseInt(rendition.aBitrate) * 1000;
            masterPlaylistContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${rendition.resolution},NAME="${rendition.name}"\n${rendition.name}/playlist.m3u8\n`;
            
            // Try to remove the temporary MP4 file if it exists (after successful HLS creation for this rendition)
            try {
                if (fsSync.existsSync(tempMp4Path)) {
                    await fs.unlink(tempMp4Path);
                    console.log(`Removed temporary MP4 file: ${tempMp4Path}`);
                }
            } catch (unlinkErr) {
                console.warn(`Warning: Could not remove temporary MP4 file: ${unlinkErr.message}`);
            }
        } // End of loop for renditions
        
        // Write the master playlist file after all renditions are processed
        await fs.writeFile(masterPlaylistPath, masterPlaylistContent);
        console.log(`ABR HLS Encoding complete for ${inputFile}. Master Playlist: ${masterPlaylistPath}`);
                
        return masterPlaylistPath;
    } catch (err) {
        console.error(`Error in HLS encoding process: ${err.message}`);
        // Attempt to clean up the stream base directory on failure
        if (fsSync.existsSync(streamBaseDir)) {
            console.log(`Cleaning up failed HLS directory: ${streamBaseDir}`);
            await fs.rm(streamBaseDir, { recursive: true, force: true }).catch(cleanupErr => {
                console.error(`Error during cleanup: ${cleanupErr.message}`);
            });
        }
        throw err;
    }
}

/**
 * Create a thumbnail from a video at the specified time
 * @param {String} inputFile - Path to the input video file (relative to videoDir)
 * @param {String} outputName - Base HLS stream name (used for directory)
 * @param {Number} timeInSeconds - Time position to extract thumbnail (default: 1s)
 * @returns {Promise} - Resolves with thumbnail path on success
 */
async function createThumbnail(inputFile, outputName, timeInSeconds = 1) {
    const inputFilePath = path.join(videoDir, inputFile);
     if (!fsSync.existsSync(inputFilePath)) {
        return Promise.reject(new Error(`Input file does not exist: ${inputFilePath}`));
    }

    const sanitizedName = outputName.replace(/[^\w-]/g, "_");
    // Output thumbnail to the main HLS stream directory
    const outputDir = path.join(processedDir, sanitizedName);
    const outputFile = path.join(outputDir, `${sanitizedName}_thumb.jpg`);

    // Ensure the main stream output directory exists
    if (!fsSync.existsSync(outputDir)) {
        // If this runs before HLS, the dir might not exist yet
        await fs.mkdir(outputDir, { recursive: true });
    }

    console.log(`Creating thumbnail for ${inputFile} at ${outputFile}`);

    return new Promise((resolve, reject) => {
        ffmpeg(inputFilePath)
            .screenshots({
                timestamps: [timeInSeconds],
                filename: path.basename(outputFile),
                folder: outputDir,
                size: '320x180'
            })
            .on('end', () => {
                console.log(`Thumbnail created: ${outputFile}`);
                resolve(outputFile);
            })
            .on('error', (err) => {
                console.error(`Error creating thumbnail for ${inputFile}: ${err.message}`);
                reject(err);
            });
    });
}

module.exports = {
    encodeToMP4,
    createHLSStream,
    createThumbnail
}; 