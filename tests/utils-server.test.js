const LogManager = require('../lib/utils-server');

describe('LogManager', () => {
  let logger;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Reset logger and spies before each test
    logger = new LogManager({ queueLimit: 5, summaryInterval: 0 }); // Disable summary timer for most tests

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); // Mock implementation to prevent actual logging during tests
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original console methods after each test
    jest.restoreAllMocks();
    logger.stopSummaryTimer(); // Ensure timers are stopped
  });

  it('should initialize with default options', () => {
    const defaultLogger = new LogManager();
    expect(defaultLogger.logLevel).toBe('info');
    expect(defaultLogger.queueLimit).toBe(100);
    expect(defaultLogger.summaryInterval).toBe(300000); // 5 minutes
    expect(defaultLogger.logQueue).toEqual([]);
    expect(defaultLogger.eventCounts).toEqual({ debug: 0, info: 0, warn: 0, error: 0 });
  });

  it('should initialize with custom options', () => {
    const customLogger = new LogManager({ logLevel: 'debug', queueLimit: 10 });
    expect(customLogger.logLevel).toBe('debug');
    expect(customLogger.queueLimit).toBe(10);
  });

  it('should log info messages correctly', () => {
    logger.info('Test info message', 'TEST');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] [TEST] Test info message'));
    expect(logger.logQueue.length).toBe(1);
    expect(logger.logQueue[0]).toMatchObject({ level: 'info', message: 'Test info message', category: 'TEST' });
    expect(logger.eventCounts.info).toBe(1);
    expect(logger.eventCounts.TEST).toBe(1);
  });

  it('should log warn messages correctly', () => {
    logger.warn('Test warning message', 'WARN_CAT');
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] [WARN_CAT] Test warning message'));
    expect(logger.logQueue.length).toBe(1);
    expect(logger.logQueue[0]).toMatchObject({ level: 'warn', message: 'Test warning message', category: 'WARN_CAT' });
    expect(logger.eventCounts.warn).toBe(1);
    expect(logger.eventCounts.WARN_CAT).toBe(1);
  });

  it('should log error messages correctly', () => {
    const errorData = new Error('Something went wrong');
    logger.error('Test error message', 'ERR_CAT', errorData);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    // Check if the error message and the data (error stack trace) are logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR] [ERR_CAT] Test error message'),
      expect.stringContaining(errorData.stack) // Check if stack trace is logged
    );
    expect(logger.logQueue.length).toBe(1);
    expect(logger.logQueue[0]).toMatchObject({ level: 'error', message: 'Test error message', category: 'ERR_CAT', data: errorData });
    expect(logger.eventCounts.error).toBe(1);
    expect(logger.eventCounts.ERR_CAT).toBe(1);
  });
  
  it('should handle logging without category', () => {
    logger.info('Info without category');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] Info without category'));
    expect(logger.logQueue.length).toBe(1);
    expect(logger.logQueue[0]).toMatchObject({ level: 'info', message: 'Info without category', category: null });
    expect(logger.eventCounts.info).toBe(1);
  });

  it('should respect logLevel setting (e.g., ignore debug when level is info)', () => {
    // Default level is 'info'
    logger.debug('This should not be logged');
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(logger.logQueue.length).toBe(0);
    expect(logger.eventCounts.debug).toBe(0);
  });

  it('should log debug messages when logLevel is debug', () => {
    const debugLogger = new LogManager({ logLevel: 'debug' });
    debugLogger.debug('This should be logged', 'DEBUG_TEST');
    // Debug messages use console.log
    expect(consoleLogSpy).toHaveBeenCalledTimes(1); 
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] [DEBUG_TEST] This should be logged'));
    expect(debugLogger.logQueue.length).toBe(1);
    expect(debugLogger.eventCounts.debug).toBe(1);
    expect(debugLogger.eventCounts.DEBUG_TEST).toBe(1);
  });
  
  // TODO: Add tests for queue limit behavior
  // TODO: Add tests for summary timer and outputSummary function
}); 