const crypto = require('crypto');

class AuthManager {
    constructor(logger, config) {
        this.logger = logger;
        this.adminPassword = config.ADMIN_PASSWORD;
        this.viewerPassword = config.VIEWER_PASSWORD;
        this.sessionExpiry = config.SESSION_EXPIRY;
        this.activeSessions = new Map(); // Map<token, { role: string, name: string, expiry: number }>
        this.cleanupIntervalId = null;

        if (!this.adminPassword || !this.viewerPassword) {
            this.logger.error('Admin and Viewer passwords must be provided in config!', 'auth');
            throw new Error('Missing required passwords for AuthManager');
        }
    }

    // --- Password Validation ---
    validatePassword(password) {
        if (password === this.adminPassword) {
            return 'admin';
        } else if (password === this.viewerPassword) {
            return 'viewer';
        } else {
            return null;
        }
    }

    // --- Session Management ---
    generateSessionToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    createSession(role, name) {
        const token = this.generateSessionToken();
        const expiry = Date.now() + this.sessionExpiry;
        const sessionData = { role, name, expiry };
        this.activeSessions.set(token, sessionData);
        this.logger.info(`Created new session for ${name} (${role}). Token: ${token.substring(0, 8)}... Expires: ${new Date(expiry).toISOString()}`, 'auth');
        return token;
    }

    validateSession(token) {
        if (!token || !this.activeSessions.has(token)) {
            return null;
        }

        const session = this.activeSessions.get(token);
        const now = Date.now();

        if (session.expiry < now) {
            this.logger.info(`Session token ${token.substring(0, 8)}... expired for ${session.name}. Removing.`, 'auth');
            this.activeSessions.delete(token);
            return null;
        }

        // Optional: Refresh expiry on validation?
        // session.expiry = now + this.sessionExpiry;
        // this.activeSessions.set(token, session);

        return session; // Return { role, name, expiry }
    }

    invalidateSession(token) {
        if (this.activeSessions.has(token)) {
            const session = this.activeSessions.get(token);
             this.logger.info(`Invalidating session token ${token.substring(0, 8)}... for ${session.name}.`, 'auth');
             this.activeSessions.delete(token);
             return true;
        }
        return false;
    }

    // --- Session Cleanup ---
    cleanupExpiredSessions() {
        const now = Date.now();
        let expiredCount = 0;

        for (const [token, session] of this.activeSessions.entries()) {
            if (session.expiry < now) {
                this.activeSessions.delete(token);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            this.logger.info(`Cleaned up ${expiredCount} expired sessions. Active sessions: ${this.activeSessions.size}`, 'auth');
        }
    }

    startSessionCleanup(intervalMinutes = 60) {
        this.stopSessionCleanup(); // Ensure no duplicate intervals
        const intervalMs = intervalMinutes * 60 * 1000;
        this.logger.info(`Starting periodic session cleanup every ${intervalMinutes} minutes.`, 'auth');
        // Run once immediately
        this.cleanupExpiredSessions(); 
        // Schedule periodic cleanup
        this.cleanupIntervalId = setInterval(() => this.cleanupExpiredSessions(), intervalMs);
        // Allow Node.js to exit even if this timer is running
        this.cleanupIntervalId.unref(); 
    }

    stopSessionCleanup() {
        if (this.cleanupIntervalId) {
            this.logger.info('Stopping periodic session cleanup.', 'auth');
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }
    }

    // --- API Route Handling ---
    handleValidateSessionRequest(req, res) {
        this.logger.debug('Handling /api/validate-session request', 'auth');
        
        if (!req.body || typeof req.body !== 'object') {
            this.logger.warn('Invalid request body format for session validation', 'auth');
            return res.status(400).json({ valid: false, error: 'Invalid request format' });
        }
        
        const { token } = req.body;
        
        if (!token) {
            this.logger.warn('No token provided in validation request', 'auth');
            return res.status(400).json({ valid: false, error: 'No token provided' });
        }
        
        this.logger.debug(`Validating session token from API: ${token.substring(0, 8)}...`, 'auth');
        const session = this.validateSession(token);
    
        if (session) {
            this.logger.info(`API: Valid session found for user: ${session.name} (${session.role})`, 'auth');
            // Return session info without sensitive data like expiry
            res.status(200).json({
                valid: true,
                role: session.role,
                name: session.name
            });
        } else {
            this.logger.warn('API: Session validation failed - token invalid or expired', 'auth');
            res.status(401).json({ 
                valid: false, 
                error: 'Invalid or expired session'
            });
        }
    }

    // Method to potentially return an Express router if more auth routes are needed
    getRouter() {
        const express = require('express');
        const router = express.Router();
        
        // Bind the handler method to this instance
        router.post('/validate-session', this.handleValidateSessionRequest.bind(this));
        
        // Add other auth-related routes here if needed
        // e.g., router.post('/login', this.handleLoginRequest.bind(this));
        // e.g., router.post('/logout', this.handleLogoutRequest.bind(this));

        return router;
    }
}

module.exports = AuthManager; 