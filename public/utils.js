class LogManager {
    constructor(options = {}) {
        this.summaryInterval = options.summaryInterval || 5 * 60 * 1000; // 5 minutes in milliseconds
        this.logLevel = options.logLevel || 'info'; // 'debug', 'info', 'warn', 'error'
        this.logQueue = [];
        this.eventCounts = {
            debug: 0,
            info: 0,
            warn: 0,
            error: 0,
            connection: 0,
            playback: 0,
            auth: 0
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
        
        // Always output errors immediately
        if (level === 'error') {
            console.error(`[ERROR] ${message}`, data || '');
        }
        
        // Track counts for summary
        this.eventCounts[level]++;
        if (category) {
            this.eventCounts[category] = (this.eventCounts[category] || 0) + 1;
        }
        
        // Store the log
        this.logQueue.push({
            timestamp: new Date(),
            level,
            message,
            category,
            data
        });
        
        // Output critical or high-priority logs immediately
        if (level === 'error' || (category && ['auth', 'connection'].includes(category))) {
            this._directOutput(level, message, data);
        }
    }
    
    _directOutput(level, message, data) {
        const prefix = level.toUpperCase();
        if (data) {
            console[level === 'error' ? 'error' : 'log'](`[${prefix}] ${message}`, data);
        } else {
            console[level === 'error' ? 'error' : 'log'](`[${prefix}] ${message}`);
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
        this.summaryTimer = setInterval(() => this.outputSummary(), this.summaryInterval);
    }
    
    stopSummaryTimer() {
        if (this.summaryTimer) {
            clearInterval(this.summaryTimer);
        }
    }
    
    outputSummary() {
        const totalEvents = Object.values(this.eventCounts).reduce((sum, count) => sum + count, 0);
        if (totalEvents === 0) {
            return; // Skip empty summaries
        }
        
        console.log('\n===== CLIENT LOG SUMMARY =====');
        console.log(`Time: ${new Date().toISOString()}`);
        console.log(`Total events in last ${this.summaryInterval/60000} minutes: ${totalEvents}`);
        console.log('Event counts by level:');
        
        for (const [level, count] of Object.entries(this.eventCounts)) {
            if (['debug', 'info', 'warn', 'error'].includes(level)) {
                console.log(`  - ${level.toUpperCase()}: ${count}`);
            }
        }
        
        console.log('Event counts by category:');
        for (const [category, count] of Object.entries(this.eventCounts)) {
            if (!['debug', 'info', 'warn', 'error'].includes(category) && count > 0) {
                console.log(`  - ${category}: ${count}`);
            }
        }
        
        // Output recent errors if any
        const recentErrors = this.logQueue
            .filter(log => log.level === 'error')
            .slice(-3);
            
        if (recentErrors.length > 0) {
            console.log('\nMost recent errors:');
            recentErrors.forEach(error => {
                console.log(`  - ${error.timestamp.toISOString()}: ${error.message}`);
            });
        }
        
        console.log('=============================\n');
        
        // Reset counters for next interval
        for (const key in this.eventCounts) {
            this.eventCounts[key] = 0;
        }
        
        // Clear log queue except for errors (keep last 20)
        const keptErrors = this.logQueue
            .filter(log => log.level === 'error')
            .slice(-20);
            
        this.logQueue = keptErrors;
    }
}

// Format time (seconds) to mm:ss or mm:ss.d with decimal precision
function formatTime(seconds, showDecimals = false) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) {
        seconds = 0;
    }
    seconds = Math.max(0, seconds);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    if (showDecimals) {
        // Show one decimal place for smoother visual updates
        return `${minutes}:${Math.floor(secs).toString().padStart(2, '0')}.${Math.floor((secs % 1) * 10)}`;
    } else {
        return `${minutes}:${Math.floor(secs).toString().padStart(2, '0')}`;
    }
} 