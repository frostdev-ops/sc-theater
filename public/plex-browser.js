// Plex Browser UI Component
// Allows administrators to browse Plex libraries and select content

let plexLibraries = [];
let currentLibraryContent = [];
let plexBrowserVisible = false;

// DOM References
const plexBrowserContainer = document.createElement('div');
plexBrowserContainer.className = 'plex-browser hidden';
plexBrowserContainer.innerHTML = `
    <div class="plex-browser-header">
        <h3>Plex Libraries</h3>
        <button id="plex-browser-close" class="btn-close">×</button>
    </div>
    <div class="plex-content">
        <div class="plex-libraries">
            <h4>Libraries</h4>
            <ul id="plex-libraries-list"></ul>
        </div>
        <div class="plex-items">
            <h4>Content</h4>
            <div id="plex-content-list"></div>
        </div>
    </div>
`;

// Initialize Plex Browser
function initPlexBrowser() {
    // Append the browser to the main app container
    const appContainer = document.getElementById('app-container');
    appContainer.appendChild(plexBrowserContainer);
    
    // Get references to elements
    const closeButton = document.getElementById('plex-browser-close');
    closeButton.addEventListener('click', hidePlexBrowser);
    
    // Add button to admin controls to open Plex browser
    const videoSelect = document.querySelector('.video-select');
    if (videoSelect && userRole === 'admin') {
        const plexButton = document.createElement('button');
        plexButton.id = 'browse-plex-btn';
        plexButton.textContent = 'Browse Plex';
        plexButton.className = 'plex-btn';
        plexButton.addEventListener('click', showPlexBrowser);
        videoSelect.appendChild(plexButton);
    }
    
    // Add styles for Plex browser
    const style = document.createElement('style');
    style.textContent = `
        .plex-browser {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 900px;
            height: 70%;
            background-color: #1f1f1f;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            flex-direction: column;
        }
        
        .plex-browser-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-bottom: 1px solid #333;
        }
        
        .plex-browser-header h3 {
            margin: 0;
            color: #e5a00d;
        }
        
        .btn-close {
            background: none;
            border: none;
            color: #ccc;
            font-size: 24px;
            cursor: pointer;
        }
        
        .plex-content {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        
        .plex-libraries {
            width: 250px;
            padding: 15px;
            border-right: 1px solid #333;
            overflow-y: auto;
        }
        
        .plex-items {
            flex: 1;
            padding: 15px;
            overflow-y: auto;
        }
        
        .plex-libraries ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .plex-libraries li {
            padding: 8px 10px;
            cursor: pointer;
            border-radius: 4px;
            margin-bottom: 5px;
        }
        
        .plex-libraries li:hover {
            background-color: #333;
        }
        
        .plex-libraries li.active {
            background-color: #e5a00d;
            color: #000;
        }
        
        .plex-item {
            display: flex;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
            cursor: pointer;
            background-color: #2a2a2a;
        }
        
        .plex-item:hover {
            background-color: #333;
        }
        
        .plex-item-info {
            margin-left: 15px;
        }
        
        .plex-item-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .plex-item-meta {
            font-size: 12px;
            color: #aaa;
        }
        
        .plex-item-summary {
            font-size: 11px;
            color: #888;
            margin-top: 5px;
            line-height: 1.3;
        }
        
        .plex-play-btn {
            background-color: #e5a00d;
            color: #000;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .plex-play-btn:hover {
            background-color: #f6b01e;
        }
        
        .plex-item-buttons {
            margin-left: auto;
            display: flex;
            align-items: center;
        }
        
        li.error {
            color: #ff6b6b;
            padding: 10px;
            background-color: rgba(255, 0, 0, 0.1);
            border-radius: 4px;
            line-height: 1.4;
        }
        
        .plex-btn {
            margin-left: 10px;
            background-color: #e5a00d;
            color: #000;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .hidden {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
    
    // Fetch Plex libraries on init (but only if admin)
    if (userRole === 'admin') {
        fetchPlexLibraries();
    }
}

// Show Plex browser
function showPlexBrowser() {
    plexBrowserContainer.classList.remove('hidden');
    plexBrowserVisible = true;
    
    // Refresh libraries if needed
    if (plexLibraries.length === 0) {
        fetchPlexLibraries();
    }
}

// Hide Plex browser
function hidePlexBrowser() {
    plexBrowserContainer.classList.add('hidden');
    plexBrowserVisible = false;
}

// Fetch Plex libraries
async function fetchPlexLibraries() {
    try {
        // Display loading state in UI
        const librariesList = document.getElementById('plex-libraries-list');
        if (librariesList) {
            librariesList.innerHTML = '<li class="loading">Loading Plex libraries...</li>';
        }
        
        showStatusMessage('Loading Plex libraries...');
        
        // Add timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        try {
            const response = await fetch('/video/plex/libraries', {
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache' // Prevent caching issues
                }
            });
            
            clearTimeout(timeoutId); // Clear the timeout
            
            if (!response.ok) {
                // Handle specific error codes
                if (response.status === 404) {
                    throw new Error('Plex API endpoint not found. Check server configuration.');
                } else if (response.status === 500) {
                    throw new Error('Plex server error. Check your Plex connection.');
                } else {
                    throw new Error(`Failed to fetch Plex libraries: ${response.status}`);
                }
            }
            
            const libraries = await response.json();
            plexLibraries = libraries;
            
            // Handle case of empty libraries array
            if (!libraries || libraries.length === 0) {
                if (librariesList) {
                    librariesList.innerHTML = '<li class="error">No Plex libraries found. Check your Plex server configuration.</li>';
                }
                showStatusMessage('No Plex libraries found', true);
                return;
            }
        } catch (innerError) {
            // Handle fetch errors
            console.error('Error fetching Plex libraries:', innerError);
            if (librariesList) {
                librariesList.innerHTML = `<li class="error">Error loading Plex libraries: ${innerError.message}</li>`;
            }
            showStatusMessage(`Error loading Plex libraries: ${innerError.message}`, true);
            return;
        }
        
        // Sort libraries alphabetically
        libraries.sort((a, b) => a.title.localeCompare(b.title));
        
        renderPlexLibraries(libraries);
        showStatusMessage(`Loaded ${libraries.length} Plex libraries`);
        
        // If we have libraries, load the first one automatically
        if (libraries.length > 0) {
            loadLibraryContent(libraries[0].id);
        }
    } catch (error) {
        logger.error('Error fetching Plex libraries:', 'plex', error);
        showStatusMessage(`Error: ${error.message}`, true);
        
        // Show failure message in the browser UI too
        const librariesList = document.getElementById('plex-libraries-list');
        if (librariesList) {
            librariesList.innerHTML = `<li class="error">Failed to connect to Plex<br>${error.message}</li>`;
        }
    }
}

// Render Plex libraries list
function renderPlexLibraries(libraries) {
    const librariesList = document.getElementById('plex-libraries-list');
    if (!librariesList) return;
    
    librariesList.innerHTML = '';
    
    if (libraries.length === 0) {
        librariesList.innerHTML = '<li>No libraries found</li>';
        return;
    }
    
    libraries.forEach(library => {
        const li = document.createElement('li');
        li.textContent = `${library.title} (${library.count})`;
        li.dataset.libraryId = library.id;
        li.addEventListener('click', () => loadLibraryContent(library.id));
        librariesList.appendChild(li);
    });
}

// Load content from a specific library
async function loadLibraryContent(libraryId) {
    try {
        // Update active library
        const libraryItems = document.querySelectorAll('#plex-libraries-list li');
        libraryItems.forEach(item => item.classList.remove('active'));
        document.querySelector(`#plex-libraries-list li[data-library-id="${libraryId}"]`).classList.add('active');
        
        showStatusMessage('Loading library content...');
        
        const response = await fetch(`/video/plex/libraries/${libraryId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch library content: ${response.status}`);
        }
        
        const content = await response.json();
        currentLibraryContent = content;
        
        renderLibraryContent(content);
        showStatusMessage('Library content loaded');
    } catch (error) {
        logger.error(`Error fetching content for library ${libraryId}:`, 'plex', error);
        showStatusMessage('Error loading library content', true);
    }
}

// Render content from a library
function renderLibraryContent(content) {
    const contentList = document.getElementById('plex-content-list');
    if (!contentList) return;
    
    contentList.innerHTML = '';
    
    if (content.length === 0) {
        contentList.innerHTML = '<div class="plex-empty">No content found in this library</div>';
        return;
    }
    
    // Sort content alphabetically by title
    content.sort((a, b) => a.title.localeCompare(b.title));
    
    content.forEach(item => {
        const itemElement = document.createElement('div');
        itemElement.className = 'plex-item';
        itemElement.dataset.plexId = item.id;
        itemElement.dataset.plexTitle = item.title;
        
        // Create a more detailed display with additional info
        let metaInfo = [];
        if (item.year) metaInfo.push(item.year);
        if (item.type) metaInfo.push(item.type.charAt(0).toUpperCase() + item.type.slice(1));
        if (item.duration) metaInfo.push(formatTime(item.duration / 1000));
        
        // Use placeholders for thumbnails to improve load times
        // We'll use a data attribute for the real URL and load it with JS
        const thumbPlaceholder = './default-thumbnail.png';
        const actualThumbUrl = item.thumb ? `/video/plex/${item.id}/thumb` : './default-thumbnail.png';
        
        itemElement.innerHTML = `
            <div class="plex-item-thumb">
                <img src="${thumbPlaceholder}" data-src="${actualThumbUrl}" alt="${item.title}" width="80" height="45">
            </div>
            <div class="plex-item-info">
                <div class="plex-item-title">${item.title}</div>
                <div class="plex-item-meta">
                    ${metaInfo.join(' • ')}
                </div>
                ${item.summary ? '<div class="plex-item-summary">' + item.summary.substring(0, 100) + (item.summary.length > 100 ? '...' : '') + '</div>' : ''}
            </div>
            <div class="plex-item-buttons">
                <button class="plex-play-btn">Play</button>
            </div>
        `;
        
        // Find the play button and attach click event
        const playButton = itemElement.querySelector('.plex-play-btn');
        playButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the parent click event
            selectPlexContent(item.id, item.title);
        });
        
        // Make the entire item clickable too
        itemElement.addEventListener('click', () => selectPlexContent(item.id, item.title));
        contentList.appendChild(itemElement);
    });
    
    // Lazy load images after rendering
    const lazyImages = contentList.querySelectorAll('img[data-src]');
    lazyImages.forEach(img => {
        // Load thumbnail with a small delay to improve perceived performance
        setTimeout(() => {
            img.src = img.dataset.src;
        }, 100 + Math.random() * 400); // Staggered loading
    });
}

// Select a Plex content item
function selectPlexContent(itemId, title) {
    if (confirm(`Do you want to play "${title}" for all viewers?`)) {
        // Format with title: plex:ID:TITLE
        const safeTitle = title.replace(/:/g, '_'); // Ensure no colons in title
        const plexReference = `plex:${itemId}:${safeTitle}`;
        hidePlexBrowser();
        
        // Change video using WebSocket message (same as regular video change)
        sendMessage({
            type: 'changeVideo',
            video: plexReference
        });
        
        showStatusMessage(`Loading ${title}...`);
    }
}

// Helper function to show status message
function showStatusMessage(message, isError = false) {
    if (typeof setStatusMessage === 'function') {
        setStatusMessage(message, isError);
    } else {
        console.log(message);
    }
}

// Listen for auth events to initialize the browser (in case this script loads before auth)
document.addEventListener('authenticated', () => {
    if (userRole === 'admin') {
        initPlexBrowser();
    }
});

// Initialize if DOM is already loaded and user is authenticated
if (document.readyState === 'complete' && userRole === 'admin') {
    initPlexBrowser();
}
