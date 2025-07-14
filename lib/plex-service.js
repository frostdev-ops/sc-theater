const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const querystring = require('querystring');

/**
 * Enhanced Service for interacting with Plex Media Server with rich browsing capabilities
 */
class PlexService {
    constructor(logger, options = {}) {
        this.logger = logger;
        this.plexUrl = options.plexUrl || process.env.PLEX_URL;
        this.plexToken = options.plexToken || process.env.PLEX_TOKEN;
        this.plexClientId = options.plexClientId || 'ShadowCompanyTheater';
        this.plexClientName = options.plexClientName || 'Shadow Company Theater';
        this.plexClientVersion = options.plexClientVersion || '2.0.0';
        this.enabled = !!this.plexUrl && !!this.plexToken;
        
        // Enhanced caching system
        this.cache = {
            libraries: null,
            libraryContent: new Map(),  // Map of library ID to content
            metadata: new Map(),        // Map of rating key to metadata
            collections: null,          // Collections
            recentlyAdded: null,        // Recently added items
            onDeck: null,               // Continue watching items
            genres: new Map(),          // Map of library ID to genres
            search: new Map(),          // Map of search query to results
            timestamps: new Map()       // Map of cache key to timestamp
        };
        
        // Cache expiration times in milliseconds
        this.cacheExpiry = {
            libraries: 3600000,        // 1 hour
            libraryContent: 900000,    // 15 minutes
            metadata: 3600000,         // 1 hour
            collections: 1800000,      // 30 minutes
            recentlyAdded: 300000,     // 5 minutes
            onDeck: 300000,            // 5 minutes
            genres: 86400000,          // 24 hours
            search: 300000             // 5 minutes
        };
        
        if (this.enabled) {
            this.logger.info(`Enhanced PlexService initialized. Plex server: ${this.plexUrl}`, 'plex');
        } else {
            this.logger.warn('PlexService initialized, but Plex URL or token is missing. Plex integration is disabled.', 'plex');
        }
    }

    /**
     * Check if Plex integration is enabled and configured
     * @returns {boolean} Whether Plex integration is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Check if a cache entry is still valid
     * @param {string} cacheType - Type of cache to check
     * @param {string} key - Cache key
     * @returns {boolean} - Whether the cache is valid
     */
    isCacheValid(cacheType, key) {
        if (!this.cache.timestamps.has(`${cacheType}_${key}`)) {
            return false;
        }

        const timestamp = this.cache.timestamps.get(`${cacheType}_${key}`);
        const age = Date.now() - timestamp;
        return age < this.cacheExpiry[cacheType];
    }

    /**
     * Set a cache entry with timestamp
     * @param {string} cacheType - Type of cache
     * @param {string} key - Cache key
     * @param {any} data - Data to cache
     */
    setCache(cacheType, key, data) {
        if (cacheType === 'libraries' || cacheType === 'collections' || 
            cacheType === 'recentlyAdded' || cacheType === 'onDeck') {
            this.cache[cacheType] = data;
        } else {
            this.cache[cacheType].set(key, data);
        }
        
        // Set the timestamp
        this.cache.timestamps.set(`${cacheType}_${key}`, Date.now());
    }

    /**
     * Make an authenticated request to the Plex API with enhanced error handling
     * @param {string} endpoint - API endpoint to call
     * @param {Object} options - Options for the request
     * @returns {Promise<Object>} API response
     */
    async makeRequest(endpoint, options = {}) {
        if (!this.enabled) {
            throw new Error('Plex integration is not enabled or configured');
        }

        const { params = {}, method = 'GET', data = null, timeout = 10000, formatResponse = true } = options;

        try {
            // Ensure endpoint starts with a slash
            const formattedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            const url = `${this.plexUrl}${formattedEndpoint}`;
            
            this.logger.debug(`Making Plex API ${method} request: ${url}`, 'plex', { params });
            
            // Create proper Plex API headers
            const headers = {
                'Accept': 'application/json',
                'X-Plex-Token': this.plexToken,
                'X-Plex-Client-Identifier': this.plexClientId,
                'X-Plex-Device': this.plexClientId,
                'X-Plex-Device-Name': this.plexClientName,
                'X-Plex-Platform': 'Web',
                'X-Plex-Product': this.plexClientName,
                'X-Plex-Version': this.plexClientVersion
            };
            
            // Enhanced axios configuration with support for different methods
            const config = {
                method: method.toLowerCase(),
                url,
                params,
                headers,
                timeout,
                validateStatus: status => status < 500, // Consider 4xx as valid response for error handling
                ...(data && { data })
            };
            
            // Execute the request
            const response = await axios(config);
            
            // Handle 4xx errors that weren't caught by axios
            if (response.status >= 400) {
                this.logger.error(`Plex API error response: ${response.status} for ${endpoint}`, 'plex', response.data);
                throw new Error(`Plex API returned error: ${response.status}`);
            }
            
            // Format response if needed
            if (formatResponse && response.data && response.data.MediaContainer) {
                return response.data.MediaContainer;
            }
            
            return response.data;
        } catch (error) {
            if (error.response) {
                // The request was made and the server responded with a status code outside 2xx range
                const errorDetails = {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    url: error.response.config.url,
                    method: error.response.config.method.toUpperCase(),
                    data: error.response.data
                };
                
                this.logger.error(`Plex API request failed with status ${error.response.status}: ${endpoint}`, 'plex', errorDetails);
                throw new Error(`Plex API error: ${error.response.status} ${error.response.statusText}`);
            } else if (error.request) {
                // The request was made but no response was received (timeout, network error)
                const requestDetails = {
                    url: error.config.url,
                    method: error.config.method.toUpperCase(),
                    timeout: error.config.timeout
                };
                
                this.logger.error(`Plex API request timed out or received no response: ${endpoint}`, 'plex', requestDetails);
                throw new Error('Plex server not responding. Check if your Plex server is online and accessible.');
            } else {
                // Something happened in setting up the request
                this.logger.error(`Plex API request setup error: ${endpoint}`, error, 'plex');
                throw new Error(`Plex API request failed: ${error.message}`);
            }
        }
    }

    /**
     * Get a list of libraries from the Plex server with enhanced details
     * @returns {Promise<Array>} List of libraries with rich metadata
     */
    async getLibraries() {
        try {
            // Check cache first
            if (this.cache.libraries && this.isCacheValid('libraries', 'all')) {
                this.logger.debug('Using cached libraries list', 'plex');
                return this.cache.libraries;
            }

            const container = await this.makeRequest('/library/sections', { formatResponse: true });
            
            if (!container || !container.Directory) {
                this.logger.warn('No libraries found in Plex server response', 'plex');
                return [];
            }

            // Extract more detailed library information
            const libraries = container.Directory.map(dir => ({
                id: dir.key,
                uuid: dir.uuid,
                title: dir.title,
                type: dir.type,
                agent: dir.agent,
                scanner: dir.scanner,
                language: dir.language,
                count: dir.count || 0,
                location: dir.Location ? dir.Location[0]?.path : null,
                refreshing: !!dir.refreshing,
                thumb: dir.thumb,
                art: dir.art,
                updatedAt: dir.updatedAt,
                createdAt: dir.createdAt,
                scannedAt: dir.scannedAt,
                contentChangedAt: dir.contentChangedAt
            }));

            // Cache the libraries
            this.setCache('libraries', 'all', libraries);
            this.logger.info(`Retrieved ${libraries.length} libraries from Plex server`, 'plex');
            
            return libraries;
        } catch (error) {
            this.logger.error('Failed to fetch Plex libraries:', error, 'plex');
            // Return empty array but don't cache the failure
            return [];
        }
    }

    /**
     * Get content from a specific Plex library with rich metadata
     * @param {string} libraryId - Library ID
     * @param {Object} options - Options for sorting and filtering
     * @returns {Promise<Array>} Library content with rich metadata
     */
    async getLibraryContent(libraryId, options = {}) {
        const { sort = 'titleSort:asc', limit = 0, offset = 0, includeCollections = false } = options;
        
        try {
            // Generate a unique cache key based on parameters
            const cacheKey = `${libraryId}_${sort}_${limit}_${offset}_${includeCollections}`;
            
            // Check cache first
            if (this.cache.libraryContent.has(cacheKey) && this.isCacheValid('libraryContent', cacheKey)) {
                this.logger.debug(`Using cached content for library ${libraryId} with params: ${cacheKey}`, 'plex');
                return this.cache.libraryContent.get(cacheKey);
            }

            // Build query parameters
            const params = {
                sort,
                includeCollections: includeCollections ? 1 : 0
            };
            
            // Only add these if they're non-zero
            if (limit > 0) params.limit = limit;
            if (offset > 0) params.offset = offset;
            
            const container = await this.makeRequest(`/library/sections/${libraryId}/all`, { params });
            
            if (!container || !container.Metadata) {
                this.logger.warn(`No content found in Plex library ${libraryId}`, 'plex');
                return [];
            }

            // Process rich metadata for each item
            const content = container.Metadata.map(item => this.processMetadata(item));

            // Cache the results
            this.setCache('libraryContent', cacheKey, content);
            
            this.logger.info(`Retrieved ${content.length} items from Plex library ${libraryId}`, 'plex');
            return content;
        } catch (error) {
            this.logger.error(`Failed to fetch Plex library content for library ${libraryId}:`, error, 'plex');
            return [];
        }
    }
    
    /**
     * Get recently added content across all libraries or from a specific library
     * @param {string} [libraryId] - Optional library ID to filter by
     * @param {number} [limit=20] - Maximum number of items to retrieve
     * @returns {Promise<Array>} Recently added content
     */
    async getRecentlyAdded(libraryId, limit = 20) {
        try {
            const cacheKey = libraryId ? `library_${libraryId}_${limit}` : `all_${limit}`;
            
            // Check cache first
            if (libraryId === undefined && this.cache.recentlyAdded && 
                this.isCacheValid('recentlyAdded', cacheKey)) {
                return this.cache.recentlyAdded;
            }
            
            // Build the endpoint
            let endpoint = '/library/recentlyAdded';
            const params = { limit };
            
            if (libraryId) {
                endpoint = `/library/sections/${libraryId}/recentlyAdded`;
            }
            
            const container = await this.makeRequest(endpoint, { params });
            
            if (!container || !container.Metadata) {
                return [];
            }
            
            // Process each item
            const recentItems = container.Metadata.map(item => this.processMetadata(item));
            
            // Cache the results
            if (libraryId === undefined) {
                this.setCache('recentlyAdded', cacheKey, recentItems);
            }
            
            return recentItems;
        } catch (error) {
            this.logger.error('Failed to fetch recently added content:', error, 'plex');
            return [];
        }
    }
    
    /**
     * Get "On Deck" content (items that are in progress) across all libraries
     * @param {string} [libraryId] - Optional library ID to filter by
     * @param {number} [limit=20] - Maximum number of items to retrieve
     * @returns {Promise<Array>} On Deck content
     */
    async getOnDeck(libraryId, limit = 20) {
        try {
            const cacheKey = libraryId ? `library_${libraryId}_${limit}` : `all_${limit}`;
            
            // Check cache first
            if (libraryId === undefined && this.cache.onDeck && 
                this.isCacheValid('onDeck', cacheKey)) {
                return this.cache.onDeck;
            }
            
            // Build the endpoint
            let endpoint = '/library/onDeck';
            const params = { limit };
            
            if (libraryId) {
                endpoint = `/library/sections/${libraryId}/onDeck`;
            }
            
            const container = await this.makeRequest(endpoint, { params });
            
            if (!container || !container.Metadata) {
                return [];
            }
            
            // Process each item
            const onDeckItems = container.Metadata.map(item => this.processMetadata(item));
            
            // Cache the results
            if (libraryId === undefined) {
                this.setCache('onDeck', cacheKey, onDeckItems);
            }
            
            return onDeckItems;
        } catch (error) {
            this.logger.error('Failed to fetch on deck content:', error, 'plex');
            return [];
        }
    }

    /**
     * Process Plex metadata into a standardized, rich format
     * @param {Object} item - Raw metadata item from Plex API
     * @returns {Object} Processed metadata
     */
    processMetadata(item) {
        if (!item) return null;

        // Basic metadata available for most items
        const processed = {
            // Essential identification
            id: item.ratingKey,
            guid: item.guid,
            type: item.type,
            title: item.title,
            originalTitle: item.originalTitle,
            sortTitle: item.titleSort,
            
            // Media details
            summary: item.summary,
            year: item.year,
            duration: item.duration,
            addedAt: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : null,
            updatedAt: item.updatedAt ? new Date(item.updatedAt * 1000).toISOString() : null,
            
            // Images (we'll use these to construct full URLs later)
            thumb: item.thumb,
            art: item.art,
            banner: item.banner,
            
            // Library information
            librarySectionID: item.librarySectionID,
            librarySectionTitle: item.librarySectionTitle,
            
            // Rating information
            rating: item.rating,
            audienceRating: item.audienceRating,
            contentRating: item.contentRating,
            
            // Additional metadata that might not be available for all types
            tagline: item.tagline || null,
            studio: item.studio || null,
            releaseDate: item.originallyAvailableAt || null
        };
        
        // Add media playback information if available
        if (item.Media && item.Media.length > 0) {
            const media = item.Media[0];
            processed.mediaInfo = {
                bitrate: media.bitrate,
                width: media.width,
                height: media.height,
                aspectRatio: media.aspectRatio,
                audioChannels: media.audioChannels,
                audioCodec: media.audioCodec,
                videoCodec: media.videoCodec,
                videoResolution: media.videoResolution,
                container: media.container,
                videoFrameRate: media.videoFrameRate,
                duration: media.duration
            };
            
            // Get file path and size if available
            if (media.Part && media.Part.length > 0) {
                const part = media.Part[0];
                processed.file = {
                    path: part.file,
                    size: part.size,
                    container: part.container,
                    duration: part.duration
                };
            }
        }
        
        // Add TV show specific fields
        if (item.type === 'show') {
            processed.childCount = item.childCount;  // Number of seasons
            processed.leafCount = item.leafCount;    // Number of episodes
        } else if (item.type === 'season') {
            processed.parentTitle = item.parentTitle; // Show title
            processed.parentRatingKey = item.parentRatingKey; // Show ID
            processed.index = item.index;            // Season number
            processed.leafCount = item.leafCount;    // Number of episodes
        } else if (item.type === 'episode') {
            processed.grandparentTitle = item.grandparentTitle; // Show title
            processed.parentTitle = item.parentTitle;          // Season title
            processed.grandparentRatingKey = item.grandparentRatingKey; // Show ID
            processed.parentRatingKey = item.parentRatingKey;          // Season ID
            processed.index = item.index;                      // Episode number
            processed.parentIndex = item.parentIndex;          // Season number
        }
        
        // Add collection information if available
        if (item.Collection) {
            processed.collections = item.Collection.map(collection => ({
                id: collection.id,
                tag: collection.tag
            }));
        }
        
        // Add genre information if available
        if (item.Genre) {
            processed.genres = item.Genre.map(genre => ({
                id: genre.id,
                tag: genre.tag
            }));
        }
        
        // Add director information if available
        if (item.Director) {
            processed.directors = item.Director.map(director => ({
                id: director.id,
                tag: director.tag,
                thumb: director.thumb
            }));
        }
        
        // Add actor information if available
        if (item.Role) {
            processed.actors = item.Role.map(role => ({
                id: role.id,
                tag: role.tag,
                role: role.role,
                thumb: role.thumb
            }));
        }
        
        // Add writer information if available
        if (item.Writer) {
            processed.writers = item.Writer.map(writer => ({
                id: writer.id,
                tag: writer.tag
            }));
        }
        
        // Add playback information if available
        if (item.viewCount !== undefined) {
            processed.playback = {
                viewCount: item.viewCount,
                lastViewedAt: item.lastViewedAt ? new Date(item.lastViewedAt * 1000).toISOString() : null,
                viewOffset: item.viewOffset || 0,
                playProgress: item.viewOffset && item.duration ? item.viewOffset / item.duration : 0
            };
        }
        
        return processed;
    }

    /**
     * Search across all Plex libraries or within a specific library
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results categorized by type
     */
    async search(query, options = {}) {
        const { libraryId, limit = 50, offset = 0 } = options;
        
        if (!query || query.trim() === '') {
            return {
                movies: [],
                shows: [],
                seasons: [],
                episodes: [],
                artists: [],
                albums: [],
                tracks: [],
                collections: [],
                total: 0
            };
        }
        
        try {
            // Generate cache key based on search parameters
            const cacheKey = `${query}_${libraryId || 'all'}_${limit}_${offset}`;
            
            // Check cache first
            if (this.cache.search.has(cacheKey) && this.isCacheValid('search', cacheKey)) {
                return this.cache.search.get(cacheKey);
            }
            
            // Prepare the search endpoint and parameters
            let endpoint = '/library/search';
            const params = { query };
            
            // Add library ID if specified
            if (libraryId) {
                endpoint = `/library/sections/${libraryId}/search`;
            }
            
            // Add pagination if specified
            if (limit > 0) params.limit = limit;
            if (offset > 0) params.offset = offset;
            
            const container = await this.makeRequest(endpoint, { params });
            
            if (!container || !container.Metadata) {
                return {
                    movies: [],
                    shows: [],
                    seasons: [],
                    episodes: [],
                    artists: [],
                    albums: [],
                    tracks: [],
                    collections: [],
                    total: 0
                };
            }
            
            // Process the search results and categorize by type
            const results = {
                movies: [],
                shows: [],
                seasons: [],
                episodes: [],
                artists: [],
                albums: [],
                tracks: [],
                collections: [],
                total: container.size || container.Metadata.length
            };
            
            // Process and categorize each item
            for (const item of container.Metadata) {
                const processed = this.processMetadata(item);
                
                switch (processed.type) {
                    case 'movie':
                        results.movies.push(processed);
                        break;
                    case 'show':
                        results.shows.push(processed);
                        break;
                    case 'season':
                        results.seasons.push(processed);
                        break;
                    case 'episode':
                        results.episodes.push(processed);
                        break;
                    case 'artist':
                        results.artists.push(processed);
                        break;
                    case 'album':
                        results.albums.push(processed);
                        break;
                    case 'track':
                        results.tracks.push(processed);
                        break;
                    case 'collection':
                        results.collections.push(processed);
                        break;
                }
            }
            
            // Cache the search results
            this.setCache('search', cacheKey, results);
            
            this.logger.info(`Search for "${query}" returned ${results.total} results`, 'plex');
            return results;
        } catch (error) {
            this.logger.error(`Search failed for query "${query}":`, error, 'plex');
            return {
                movies: [],
                shows: [],
                seasons: [],
                episodes: [],
                artists: [],
                albums: [],
                tracks: [],
                collections: [],
                total: 0
            };
        }
    }

    /**
     * Get detailed metadata for a specific item by its rating key
     * @param {string} ratingKey - Plex rating key
     * @returns {Promise<Object>} Detailed item metadata
     */
    async getMetadata(ratingKey) {
        try {
            // Check cache first
            if (this.cache.metadata.has(ratingKey) && this.isCacheValid('metadata', ratingKey)) {
                return this.cache.metadata.get(ratingKey);
            }
            
            const container = await this.makeRequest(`/library/metadata/${ratingKey}`);
            
            if (!container || !container.Metadata || container.Metadata.length === 0) {
                throw new Error(`No metadata found for item with rating key ${ratingKey}`);
            }
            
            // Process the metadata
            const metadata = this.processMetadata(container.Metadata[0]);
            
            // Cache the result
            this.setCache('metadata', ratingKey, metadata);
            
            return metadata;
        } catch (error) {
            this.logger.error(`Failed to fetch metadata for item ${ratingKey}:`, error, 'plex');
            throw error;
        }
    }

    /**
     * Get all videos from all movie and TV show libraries with enhanced metadata
     * @param {Object} options - Options for filtering and sorting
     * @returns {Promise<Array>} Combined list of all videos with rich metadata
     */
    async getAllVideos(options = {}) {
        const { sortBy = 'title', sortDir = 'asc', filterType = null } = options;
        
        try {
            const libraries = await this.getLibraries();
            
            // Filter libraries by type if requested
            const filteredLibraries = filterType 
                ? libraries.filter(lib => lib.type === filterType)
                : libraries.filter(lib => ['movie', 'show', 'artist'].includes(lib.type));
            
            if (filteredLibraries.length === 0) {
                this.logger.warn(`No compatible Plex libraries found ${filterType ? `of type ${filterType}` : ''}`, 'plex');
                return [];
            }
            
            // Get content from all libraries in parallel
            const libraryPromises = filteredLibraries.map(lib => 
                this.getLibraryContent(lib.id).then(content => {
                    // Add library information to each item
                    return content.map(item => ({
                        ...item,
                        library: lib.title,
                        libraryType: lib.type
                    }));
                }).catch(error => {
                    this.logger.error(`Failed to fetch content from Plex library ${lib.title}:`, error, 'plex');
                    return [];
                })
            );
            
            const libraryContents = await Promise.all(libraryPromises);
            let allVideos = libraryContents.flat();
            
            // Apply sorting
            allVideos = this.sortContent(allVideos, sortBy, sortDir);
            
            this.logger.info(`Retrieved a total of ${allVideos.length} videos from ${filteredLibraries.length} libraries in Plex`, 'plex');
            return allVideos;
        } catch (error) {
            this.logger.error('Failed to fetch all Plex videos:', error, 'plex');
            return [];
        }
    }

    /**
     * Sort content based on specified criteria
     * @param {Array} content - Content items to sort
     * @param {string} sortBy - Field to sort by
     * @param {string} sortDir - Sort direction ('asc' or 'desc')
     * @returns {Array} Sorted content
     */
    sortContent(content, sortBy = 'title', sortDir = 'asc') {
        if (!content || !Array.isArray(content) || content.length === 0) {
            return [];
        }
        
        const sortedContent = [...content];
        
        // Define sort functions for different fields
        const sortFunctions = {
            title: (a, b) => {
                // Use sortTitle if available, otherwise title
                const aTitle = a.sortTitle || a.title || '';
                const bTitle = b.sortTitle || b.title || '';
                return aTitle.localeCompare(bTitle);
            },
            releaseDate: (a, b) => {
                const aDate = a.releaseDate || a.year || 0;
                const bDate = b.releaseDate || b.year || 0;
                return aDate - bDate;
            },
            addedAt: (a, b) => {
                const aDate = a.addedAt ? new Date(a.addedAt).getTime() : 0;
                const bDate = b.addedAt ? new Date(b.addedAt).getTime() : 0;
                return aDate - bDate;
            },
            duration: (a, b) => {
                return (a.duration || 0) - (b.duration || 0);
            },
            rating: (a, b) => {
                return (a.rating || 0) - (b.rating || 0);
            },
            viewCount: (a, b) => {
                const aCount = a.playback ? a.playback.viewCount || 0 : 0;
                const bCount = b.playback ? b.playback.viewCount || 0 : 0;
                return aCount - bCount;
            },
            lastViewed: (a, b) => {
                const aDate = a.playback && a.playback.lastViewedAt ? 
                              new Date(a.playback.lastViewedAt).getTime() : 0;
                const bDate = b.playback && b.playback.lastViewedAt ? 
                              new Date(b.playback.lastViewedAt).getTime() : 0;
                return aDate - bDate;
            }
        };
        
        // Use the appropriate sort function
        const sortFunction = sortFunctions[sortBy] || sortFunctions.title;
        
        // Sort the content
        sortedContent.sort(sortFunction);
        
        // Reverse if descending order
        if (sortDir.toLowerCase() === 'desc') {
            sortedContent.reverse();
        }
        
        return sortedContent;
    }

    /**
     * Generate a full image URL from a Plex thumb path
     * @param {string} thumbPath - Plex thumbnail path
     * @param {Object} options - Image options
     * @returns {string} Full image URL
     */
    getImageUrl(thumbPath, options = {}) {
        if (!thumbPath) return null;
        
        const { width = 320, height = 240, minSize = true, upscale = false } = options;
        
        // Check if it's already a full URL
        if (thumbPath.startsWith('http')) {
            return thumbPath;
        }
        
        // Build the URL parameters
        const params = [];
        
        if (width > 0) params.push(`width=${width}`);
        if (height > 0) params.push(`height=${height}`);
        if (minSize) params.push('minSize=1');
        if (upscale) params.push('upscale=1');
        
        // Add authentication token
        params.push(`X-Plex-Token=${this.plexToken}`);
        
        // Ensure the thumb path starts with a slash
        const path = thumbPath.startsWith('/') ? thumbPath : `/${thumbPath}`;
        
        return `${this.plexUrl}/photo/:/transcode${path}?${params.join('&')}`;
    }

    /**
     * Get advanced streaming options for a Plex media item
     * @param {string} itemId - Plex rating key
     * @param {Object} options - Streaming options
     * @returns {Object} Various streaming URLs and formats
     */
    async getStreamingOptions(itemId) {
        try {
            // Get detailed metadata first to check media type
            const metadata = await this.getMetadata(itemId);
            
            if (!metadata) {
                throw new Error(`No metadata found for item ${itemId}`);
            }
            
            // Build streaming options
            const streamingOptions = {
                // Direct file streaming (original quality)
                directPlay: this.getDirectPlayUrl(itemId),
                
                // HLS streaming options
                hls: this.getHlsUrl(itemId),
                
                // Progressive MP4 streaming options for browser compatibility
                mp4: this.getMp4Url(itemId),
                
                // Media info from metadata
                mediaInfo: metadata.mediaInfo || null,
                
                // Type of media
                mediaType: metadata.type,
                
                // Content title for display
                title: metadata.title
            };
            
            return streamingOptions;
        } catch (error) {
            this.logger.error(`Failed to get streaming options for item ${itemId}:`, error, 'plex');
            throw error;
        }
    }
    
    /**
     * Get a direct play URL for a Plex media item
     * @param {string} itemId - Plex rating key
     * @returns {string} Direct play URL
     */
    getDirectPlayUrl(itemId) {
        const url = `${this.plexUrl}/library/metadata/${itemId}/file?X-Plex-Token=${this.plexToken}`;
        this.logger.debug(`Generated Plex direct play URL for item ${itemId}`, 'plex');
        return url;
    }
    
    /**
     * Get an HLS streaming URL for a Plex media item
     * @param {string} itemId - Plex rating key
     * @param {Object} options - Transcoding options
     * @returns {string} HLS URL
     */
    getHlsUrl(itemId, options = {}) {
        const { 
            quality = 'original', // original, 1080p, 720p, 480p, etc.
            audioBoost = 100,    // 100 = normal
            subtitles = 'none',  // none, auto, burn, sidecar
            directPlay = true,  // Try direct play first
            directStream = true // Try direct stream if direct play fails
        } = options;
        
        // Build the base URL
        const baseUrl = `${this.plexUrl}/video/:/transcode/universal/start.m3u8`;
        
        // Build the parameters
        const params = {
            'X-Plex-Token': this.plexToken,
            'X-Plex-Platform': 'Web',
            'X-Plex-Device': this.plexClientId,
            'X-Plex-Device-Name': this.plexClientName,
            'path': `/library/metadata/${itemId}`,
            'mediaIndex': '0',
            'partIndex': '0',
            'protocol': 'hls',
            'fastSeek': '1',
            'directPlay': directPlay ? '1' : '0',
            'directStream': directStream ? '1' : '0',
            'subtitleSize': '100',
            'audioBoost': audioBoost.toString(),
            'location': 'lan'
        };
        
        // Add quality settings if not original
        if (quality !== 'original') {
            // Quality presets
            const qualitySettings = {
                '1080p': { maxWidth: 1920, maxHeight: 1080, videoBitrate: 12000 },
                '720p': { maxWidth: 1280, maxHeight: 720, videoBitrate: 4000 },
                '480p': { maxWidth: 854, maxHeight: 480, videoBitrate: 1500 },
                '360p': { maxWidth: 640, maxHeight: 360, videoBitrate: 720 },
                '240p': { maxWidth: 432, maxHeight: 240, videoBitrate: 365 }
            };
            
            // Apply quality settings
            const settings = qualitySettings[quality] || qualitySettings['720p'];
            
            params.maxVideoBitrate = settings.videoBitrate.toString();
            params.videoQuality = '100';
            params.videoResolution = `${settings.maxWidth}x${settings.maxHeight}`;
            params.maxWidth = settings.maxWidth.toString();
            params.maxHeight = settings.maxHeight.toString();
        }
        
        // Add subtitle settings
        if (subtitles !== 'none') {
            params.subtitles = subtitles === 'burn' ? 'burn' : 'auto';
            params.advancedSubtitles = subtitles === 'sidecar' ? '1' : '0';
        }
        
        // Build the final URL
        const queryString = Object.entries(params)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        
        const url = `${baseUrl}?${queryString}`;
        this.logger.debug(`Generated Plex HLS URL for item ${itemId} with quality ${quality}`, 'plex');
        
        return url;
    }
    
    /**
     * Get a progressive MP4 URL for a Plex media item
     * @param {string} itemId - Plex rating key
     * @param {Object} options - Options for MP4 generation
     * @returns {string} MP4 URL
     */
    getMp4Url(itemId, options = {}) {
        const { quality = 'original', audioBoost = 100 } = options;
        
        // Base URL for MP4 conversion
        const baseUrl = `${this.plexUrl}/video/:/transcode/universal/start.mp4`;
        
        // Basic parameters
        const params = {
            'X-Plex-Token': this.plexToken,
            'path': `/library/metadata/${itemId}`,
            'mediaIndex': '0',
            'partIndex': '0',
            'videoQuality': '100',
            'audioBoost': audioBoost.toString()
        };
        
        // Add quality settings if not original
        if (quality !== 'original') {
            // Quality presets
            const qualitySettings = {
                '1080p': { maxWidth: 1920, maxHeight: 1080, videoBitrate: 12000 },
                '720p': { maxWidth: 1280, maxHeight: 720, videoBitrate: 4000 },
                '480p': { maxWidth: 854, maxHeight: 480, videoBitrate: 1500 },
                '360p': { maxWidth: 640, maxHeight: 360, videoBitrate: 720 },
            };
            
            // Apply quality settings
            const settings = qualitySettings[quality] || qualitySettings['720p'];
            
            params.maxVideoBitrate = settings.videoBitrate.toString();
            params.videoResolution = `${settings.maxWidth}x${settings.maxHeight}`;
        }
        
        // Build the final URL
        const queryString = Object.entries(params)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        
        const url = `${baseUrl}?${queryString}`;
        this.logger.debug(`Generated Plex MP4 URL for item ${itemId} with quality ${quality}`, 'plex');
        
        return url;
    }

    /**
     * Refresh the cached content for a library
     * @param {string} libraryId - Library ID to refresh
     */
    async refreshLibraryCache(libraryId) {
        // Find all cache keys that match this library and remove them
        for (const key of this.cache.libraryContent.keys()) {
            if (key.startsWith(`${libraryId}_`)) {
                this.cache.libraryContent.delete(key);
                this.cache.timestamps.delete(`libraryContent_${key}`);
            }
        }
        
        // Refetch the content
        await this.getLibraryContent(libraryId);
        this.logger.info(`Refreshed cache for Plex library ${libraryId}`, 'plex');
    }

    /**
     * Clear all cached content
     */
    clearCache() {
        // Clear all cache objects
        this.cache.libraries = null;
        this.cache.libraryContent.clear();
        this.cache.metadata.clear();
        this.cache.collections = null;
        this.cache.recentlyAdded = null;
        this.cache.onDeck = null;
        this.cache.genres.clear();
        this.cache.search.clear();
        this.cache.timestamps.clear();
        
        this.logger.info('Cleared all Plex cache', 'plex');
    }

    /**
     * Check if an ID is a valid Plex item ID
     * @param {string} id - ID to check
     * @returns {boolean} Whether the ID is valid
     */
    isValidPlexId(id) {
        // Plex IDs are typically numeric
        return /^\d+$/.test(id);
    }

    /**
     * Validate a Plex content identifier in the format "plex:<id>" or "plex:<id>:<title>"
     * @param {string} plexReference - Content reference to validate
     * @returns {boolean} Whether the reference is valid
     */
    isValidPlexReference(plexReference) {
        if (!plexReference || typeof plexReference !== 'string') {
            return false;
        }
        
        if (!plexReference.startsWith('plex:')) {
            return false;
        }
        
        // Extract ID from formats like "plex:12345" or "plex:12345:Movie Title"
        const parts = plexReference.split(':');
        if (parts.length < 2) {
            return false;
        }
        
        // Validate the ID part (should be numeric)
        return this.isValidPlexId(parts[1]);
    }
    
    /**
     * Extract the Plex item ID from a reference string
     * @param {string} plexReference - Plex reference like "plex:12345" or "plex:12345:Movie Title"
     * @returns {string|null} Extracted ID or null if invalid
     */
    extractPlexId(plexReference) {
        if (!this.isValidPlexReference(plexReference)) {
            return null;
        }
        
        const parts = plexReference.split(':');
        return parts[1]; // The ID is always the second part
    }
    
    /**
     * Get genres for a specific library
     * @param {string} libraryId - Library ID
     * @returns {Promise<Array>} List of genres in the library
     */
    async getGenres(libraryId) {
        try {
            // Check cache first
            if (this.cache.genres.has(libraryId) && this.isCacheValid('genres', libraryId)) {
                return this.cache.genres.get(libraryId);
            }
            
            const container = await this.makeRequest(`/library/sections/${libraryId}/genre`);
            
            if (!container || !container.Directory) {
                return [];
            }
            
            const genres = container.Directory.map(genre => ({
                id: genre.key,
                title: genre.title,
                count: genre.count || 0,
                thumb: genre.thumb
            }));
            
            // Cache the results
            this.setCache('genres', libraryId, genres);
            
            return genres;
        } catch (error) {
            this.logger.error(`Failed to fetch genres for library ${libraryId}:`, error, 'plex');
            return [];
        }
    }
    
    /**
     * Get items in a library filtered by genre
     * @param {string} libraryId - Library ID
     * @param {string} genreId - Genre ID
     * @param {Object} options - Additional options
     * @returns {Promise<Array>} Filtered items
     */
    async getItemsByGenre(libraryId, genreId, options = {}) {
        try {
            const { sort = 'titleSort:asc', limit = 0, offset = 0 } = options;
            
            // Generate a unique cache key
            const cacheKey = `${libraryId}_genre_${genreId}_${sort}_${limit}_${offset}`;
            
            // Check cache first
            if (this.cache.libraryContent.has(cacheKey) && this.isCacheValid('libraryContent', cacheKey)) {
                return this.cache.libraryContent.get(cacheKey);
            }
            
            // Build query parameters
            const params = { genre: genreId, sort };
            if (limit > 0) params.limit = limit;
            if (offset > 0) params.offset = offset;
            
            const container = await this.makeRequest(`/library/sections/${libraryId}/all`, { params });
            
            if (!container || !container.Metadata) {
                return [];
            }
            
            // Process the items
            const items = container.Metadata.map(item => this.processMetadata(item));
            
            // Cache the results
            this.setCache('libraryContent', cacheKey, items);
            
            return items;
        } catch (error) {
            this.logger.error(`Failed to fetch items by genre ${genreId} for library ${libraryId}:`, error, 'plex');
            return [];
        }
    }
    
    /**
     * Get collections in a library
     * @param {string} libraryId - Library ID
     * @returns {Promise<Array>} List of collections
     */
    async getCollections(libraryId) {
        try {
            const container = await this.makeRequest(`/library/sections/${libraryId}/collections`);
            
            if (!container || !container.Metadata) {
                return [];
            }
            
            // Process each collection
            const collections = container.Metadata.map(collection => ({
                id: collection.ratingKey,
                title: collection.title,
                summary: collection.summary,
                thumb: collection.thumb,
                art: collection.art,
                childCount: collection.childCount || 0,
                addedAt: collection.addedAt ? new Date(collection.addedAt * 1000).toISOString() : null
            }));
            
            return collections;
        } catch (error) {
            this.logger.error(`Failed to fetch collections for library ${libraryId}:`, error, 'plex');
            return [];
        }
    }
    
    /**
     * Legacy method to maintain backward compatibility with existing code
     * @param {string} itemId - Plex item ID
     * @returns {string} Direct file URL
     */
    getStreamUrl(itemId) {
        return this.getDirectPlayUrl(itemId);
    }
    
    /**
     * Legacy method to maintain backward compatibility with existing code
     * @param {string} itemId - Plex item ID
     * @returns {string} Transcoded URL
     */
    getTranscodeUrl(itemId) {
        return this.getHlsUrl(itemId, { quality: '720p', directPlay: false });
    }
}

module.exports = PlexService;
