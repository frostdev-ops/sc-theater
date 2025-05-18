const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Summary interval (ms): default 5 seconds, override via env var LOG_SUMMARY_INTERVAL
const LOG_SUMMARY_INTERVAL = process.env.LOG_SUMMARY_INTERVAL
    ? Number(process.env.LOG_SUMMARY_INTERVAL)
    : 5000;

// LogManager for consolidated logging
class LogManager {
    constructor(options = {}) {
        this.summaryInterval = options.summaryInterval || LOG_SUMMARY_INTERVAL;
        this.logLevel = options.logLevel || LOG_LEVEL;
        this.logQueue = [];
        this.eventCounts = {
            debug: 0,
            info: 0,
            warn: 0,
            error: 0,
            auth: 0,
            connection: 0,
            videoRequest: 0,
            stateChange: 0,
            websocket: 0, // Added for websocket specific logs
            hls: 0,       // Added for HLS related logs
            sync: 0,      // Added for sync related logs
            admin: 0      // Added for admin actions
        };
        
        this.levelPriority = {
            'debug': 0,
            'info': 1,
            'warn': 2,
            'error': 3
        };
        
        // Start the summary timer
        this.startSummaryTimer();
    }
    
    log(level, message, category = null, data = null) {
        // Only process logs at or above the configured level
        if (this.levelPriority[level] < this.levelPriority[this.logLevel]) {
            return;
        }
        
        const timestamp = new Date();
        // Always output errors immediately to console.error
        if (level === 'error') {
            const catLabel = typeof category === 'string' ? `[${category.toUpperCase()}] ` : '';
            console.error(`[${timestamp.toISOString()}] [ERROR] ${catLabel}${message}`, data || '');
        }
        
        // Track counts for summary
        this.eventCounts[level]++;
        if (category && this.eventCounts.hasOwnProperty(category)) {
            this.eventCounts[category]++;
        }
        
        // Store the log
        this.logQueue.push({
            timestamp,
            level,
            message,
            category,
            data
        });
        
        // Output critical or high-priority logs immediately
        // Adjust which categories/levels trigger immediate console output if needed
        if (level === 'warn' || level === 'error' || (category && ['auth', 'stateChange', 'connection'].includes(category))) {
            this._directOutput(timestamp, level, message, category, data);
        }
    }
    
    _directOutput(timestamp, level, message, category, data) {
        const levelPrefix = level.toUpperCase();
        const categoryPrefix = (typeof category === 'string') ? `[${category.toUpperCase()}] ` : '';
        const logFunc = level === 'error' ? console.error :
                        level === 'warn' ? console.warn :
                        level === 'info' ? console.info : console.log; // Use console.info for info, log for debug
                        
        if (data) {
            logFunc(`[${timestamp.toISOString()}] [${levelPrefix}] ${categoryPrefix}${message}`, data);
        } else {
            logFunc(`[${timestamp.toISOString()}] [${levelPrefix}] ${categoryPrefix}${message}`);
        }
    }
    
    debug(message, category = null, data = null) {
        this.log('debug', message, category, data);
    }
    
    info(message, category = null, data = null) {
        this.log('info', message, category, data);
    }
    
    warn(message, category = null, data = null) {
        this.log('warn', message, category, data);
    }
    
    error(message, category = null, data = null) {
        this.log('error', message, category, data);
    }
    
    startSummaryTimer() {
        // Clear existing timer just in case
        if (this.summaryTimer) clearInterval(this.summaryTimer);
        
        this.summaryTimer = setInterval(() => this.outputSummary(), this.summaryInterval);
        // Prevent Node.js from waiting for this timer to exit
        this.summaryTimer.unref(); 
        console.log(`[${new Date().toISOString()}] [INFO] Log summary interval started (${this.summaryInterval / 1000} seconds).`);
    }
    
    stopSummaryTimer() {
        if (this.summaryTimer) {
            clearInterval(this.summaryTimer);
            this.summaryTimer = null;
            console.log(`[${new Date().toISOString()}] [INFO] Log summary interval stopped.`);
        }
    }
    
    outputSummary() {
        const totalEvents = Object.values(this.eventCounts).reduce((sum, count) => sum + count, 0);
        if (totalEvents === 0) {
            // console.log(`[${new Date().toISOString()}] [DEBUG] Log Summary: No events in the last interval.`);
            return; // Skip empty summaries
        }
        
        console.log('\n===== SERVER LOG SUMMARY =====');
        console.log(`Time: ${new Date().toISOString()}`);
        console.log(`Total events in last ${this.summaryInterval / 1000} seconds: ${totalEvents}`);
        
        console.log('\nEvent counts by level:');
        for (const [level, count] of Object.entries(this.eventCounts)) {
            if (['debug', 'info', 'warn', 'error'].includes(level)) {
                console.log(`  - ${level.toUpperCase()}: ${count}`);
            }
        }
        
        console.log('\nEvent counts by category:');
        for (const [category, count] of Object.entries(this.eventCounts)) {
            if (!['debug', 'info', 'warn', 'error'].includes(category) && count > 0) {
                console.log(`  - ${category}: ${count}`);
            }
        }
        
        // Output recent errors if any
        const recentErrors = this.logQueue
            .filter(log => log.level === 'error')
            .slice(-5); // Show last 5 errors in summary
            
        if (recentErrors.length > 0) {
            console.log('\nMost recent errors:');
            recentErrors.forEach(error => {
                console.log(`  - ${error.timestamp.toISOString()}: ${error.category ? `[${error.category.toUpperCase()}] ` : ''}${error.message}`);
            });
        }
        
        console.log('============================\n');
        
        // Reset counters for next interval
        for (const key in this.eventCounts) {
            this.eventCounts[key] = 0;
        }
        
        // Trim log queue to keep memory usage down, keep last 100 entries total
        if (this.logQueue.length > 100) {
            this.logQueue = this.logQueue.slice(-100);
        }
    }
}

// Export the LogManager class
module.exports = LogManager; 