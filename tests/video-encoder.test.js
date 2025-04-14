const path = require('path');
const videoEncoder = require('../tools/video-encoder');

// --- Mocks ---

// Mock fs and fs/promises
const mockFs = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
};
const mockFsPromises = {
  rm: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
};
jest.mock('fs', () => mockFs);
jest.mock('fs/promises', () => mockFsPromises);

// Mock fluent-ffmpeg
const mockFfmpegInstance = {
  outputOptions: jest.fn().mockReturnThis(),
  output: jest.fn().mockReturnThis(),
  on: jest.fn().mockImplementation(function(event, callback) {
    // Store callbacks to be triggered later by run()
    this._callbacks = this._callbacks || {};
    this._callbacks[event] = callback;
    return this;
  }),
  run: jest.fn().mockImplementation(function() {
    // Simulate successful completion by default
    if (this._callbacks && this._callbacks.end) {
      // Use setImmediate to allow the promise chain to settle
      setImmediate(this._callbacks.end);
    }
  }),
  // Helper to simulate an error during run()
  _simulateError: jest.fn().mockImplementation(function(errorMessage = 'FFmpeg error') {
     this.run.mockImplementationOnce(function() {
        if (this._callbacks && this._callbacks.error) {
             setImmediate(() => this._callbacks.error(new Error(errorMessage)));
        }
     });
  })
};
// The main module export is a function that returns the instance
jest.mock('fluent-ffmpeg', () => jest.fn(() => mockFfmpegInstance));

// --- Test Suite ---

describe('video-encoder', () => {

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Default mock implementations
    mockFs.existsSync.mockReturnValue(true); // Assume files/dirs exist by default
    mockFsPromises.rm.mockResolvedValue(undefined);
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockFsPromises.unlink.mockResolvedValue(undefined);

    // Reset ffmpeg mock instance state if necessary (callbacks are stored on it)
    delete mockFfmpegInstance._callbacks; // Clear stored callbacks
    mockFfmpegInstance.run.mockImplementation(function() { // Restore default run behavior
        if (this._callbacks && this._callbacks.end) {
             setImmediate(this._callbacks.end);
        }
    });
  });

  describe('createHLSStream', () => {
    const inputFile = '/path/to/dummy/video.mp4';
    const outputName = 'Dummy Video Stream';
    const sanitizedName = 'Dummy_Video_Stream';
    const videoDir = path.resolve(__dirname, '..', 'videos'); // Calculate expected path
    const processedDir = path.join(videoDir, 'processed');
    const streamBaseDir = path.join(processedDir, sanitizedName);
    const masterPlaylistPath = path.join(streamBaseDir, 'master.m3u8');

    it('should throw an error if input file does not exist', async () => {
      mockFs.existsSync.mockImplementation((p) => p !== inputFile); // Mock input file as not existing

      await expect(videoEncoder.createHLSStream(inputFile, outputName))
        .rejects
        .toThrow(`Input file does not exist: ${inputFile}`);

      expect(mockFs.existsSync).toHaveBeenCalledWith(inputFile);
    });

    it('should create HLS stream successfully (happy path)', async () => {
      mockFs.existsSync.mockImplementation((p) => {
          // Assume streamBaseDir does *not* exist initially, but input file does
          if (p === streamBaseDir) return false;
          if (p.startsWith(path.join(streamBaseDir, '360p'))) return false; // Rendition dirs don't exist
          if (p.startsWith(path.join(streamBaseDir, '720p'))) return false;
          if (p.startsWith(path.join(streamBaseDir, '1080p'))) return false;
          if (p.includes('intermediate.mp4')) return false; // Temp file doesn't exist
          return true; // Assume input file exists
      });

      const result = await videoEncoder.createHLSStream(inputFile, outputName);

      expect(result).toBe(masterPlaylistPath);

      // Check directory operations
      expect(mockFs.existsSync).toHaveBeenCalledWith(inputFile);
      expect(mockFs.existsSync).toHaveBeenCalledWith(streamBaseDir); // Checked for cleanup
      expect(mockFsPromises.rm).not.toHaveBeenCalled(); // Should not be called if dir doesn't exist
      expect(mockFsPromises.mkdir).toHaveBeenCalledWith(streamBaseDir, { recursive: true });

      // Check rendition directory creation (sync)
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join(streamBaseDir, '360p'), { recursive: true });
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join(streamBaseDir, '720p'), { recursive: true });
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join(streamBaseDir, '1080p'), { recursive: true });

      // Check ffmpeg calls (intermediate MP4 and HLS conversion for each rendition)
      // Expect 3 intermediate MP4 calls + 3 HLS conversion calls = 6 total
      expect(require('fluent-ffmpeg')).toHaveBeenCalledTimes(6);
      expect(mockFfmpegInstance.outputOptions).toHaveBeenCalledTimes(6);
      expect(mockFfmpegInstance.output).toHaveBeenCalledTimes(6);
      expect(mockFfmpegInstance.on).toHaveBeenCalledTimes(6 * 3); // start, end, error for each
      expect(mockFfmpegInstance.run).toHaveBeenCalledTimes(6);
      
      // Check temp file deletion
      expect(mockFsPromises.unlink).toHaveBeenCalledTimes(3); // One per rendition
      expect(mockFsPromises.unlink).toHaveBeenCalledWith(path.join(streamBaseDir, '360p', 'intermediate.mp4'));

      // Check master playlist write
      expect(mockFsPromises.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFsPromises.writeFile).toHaveBeenCalledWith(
        masterPlaylistPath,
        expect.stringContaining('#EXTM3U')
      );
    });

    it('should clean up existing HLS directory before starting', async () => {
        mockFs.existsSync.mockImplementation((p) => p === inputFile || p === streamBaseDir); // Input and existing HLS dir exist

        await videoEncoder.createHLSStream(inputFile, outputName);

        expect(mockFs.existsSync).toHaveBeenCalledWith(streamBaseDir);
        expect(mockFsPromises.rm).toHaveBeenCalledWith(streamBaseDir, { recursive: true, force: true });
        expect(mockFsPromises.mkdir).toHaveBeenCalledWith(streamBaseDir, { recursive: true }); // Should be recreated
    });

    it('should clean up HLS directory if ffmpeg intermediate MP4 encoding fails', async () => {
        // Simulate error on the first ffmpeg run (intermediate MP4 for 360p)
        mockFfmpegInstance._simulateError('GPU encoding failed');

        await expect(videoEncoder.createHLSStream(inputFile, outputName))
            .rejects
            .toThrow('GPU encoding failed');

        // Check cleanup was attempted
        expect(mockFs.existsSync).toHaveBeenCalledWith(streamBaseDir);
        expect(mockFsPromises.rm).toHaveBeenCalledWith(streamBaseDir, { recursive: true, force: true });
    });
    
    it('should clean up HLS directory if ffmpeg HLS conversion fails', async () => {
        // Simulate error only on the HLS conversion step of the first rendition
        const ffmpegMock = require('fluent-ffmpeg');
        ffmpegMock.mockImplementationOnce(() => ({ // First call (intermediate MP4) - Succeeds
             ...mockFfmpegInstance,
             run: jest.fn().mockImplementation(function() { if(this._callbacks.end) setImmediate(this._callbacks.end); })
        }));
        ffmpegMock.mockImplementationOnce(() => ({ // Second call (HLS conversion) - Fails
            ...mockFfmpegInstance,
            run: jest.fn().mockImplementation(function() { if(this._callbacks.error) setImmediate(() => this._callbacks.error(new Error('HLS conversion failed'))); })
        }));
        // Subsequent calls won't happen, but reset the mock for safety
        ffmpegMock.mockImplementation(() => mockFfmpegInstance);

        await expect(videoEncoder.createHLSStream(inputFile, outputName))
            .rejects
            .toThrow('HLS conversion failed');

        // Check cleanup was attempted
        expect(mockFs.existsSync).toHaveBeenCalledWith(streamBaseDir);
        expect(mockFsPromises.rm).toHaveBeenCalledWith(streamBaseDir, { recursive: true, force: true });
    });

    // TODO: Add tests for createThumbnail function
    // TODO: Add tests for encodeToMP4 function (if used)
  });
}); 