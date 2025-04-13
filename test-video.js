const fs = require('fs');
const path = require('path');
const http = require('http');

// Test configuration
const SERVER_URL = 'http://localhost:4000';

// Ensure videos directory exists
const videoDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videoDir)) {
    console.log(`Creating videos directory: ${videoDir}`);
    fs.mkdirSync(videoDir, { recursive: true });
}

// Create a sample video if none exists
async function createSampleVideo() {
    const samplePath = path.join(videoDir, 'sample.mp4');
    
    if (fs.existsSync(samplePath)) {
        console.log('Sample video already exists');
        return samplePath;
    }
    
    console.log('Creating sample video file for testing...');
    
    // For testing, we'll actually just copy a small test file
    // In a real scenario, you'd need a real video file
    try {
        // Create a simple binary file that looks like an MP4 header
        // NOTE: This won't be a valid MP4 but will test the routes
        const fakeHeader = Buffer.from([
            0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ftyp
            0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00, // isom
            0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32, // iso2
            0x6D, 0x70, 0x34, 0x31, 0x00, 0x00, 0x00, 0x01  // mp41
        ]);
        
        // Add some fake data
        const data = Buffer.alloc(1024 * 10); // 10KB of zeros
        data.fill(0xFF);
        
        const fullData = Buffer.concat([fakeHeader, data]);
        fs.writeFileSync(samplePath, fullData);
        console.log(`Created test video at: ${samplePath} (${fullData.length} bytes)`);
        return samplePath;
    } catch (err) {
        console.error('Failed to create sample video file:', err);
        process.exit(1);
    }
}

// Test basic video endpoint
async function testVideoEndpoint(videoFileName) {
    console.log(`\nTESTING: GET /video/${videoFileName}`);
    
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            hostname: 'localhost',
            port: 4000,
            path: `/video/${videoFileName}`,
            headers: {}
        };
        
        const req = http.request(options, (res) => {
            console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
            console.log('Headers:', res.headers);
            
            let data = [];
            res.on('data', (chunk) => {
                data.push(chunk);
            });
            
            res.on('end', () => {
                const totalBytes = data.reduce((acc, chunk) => acc + chunk.length, 0);
                console.log(`Received ${totalBytes} bytes of video data`);
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    dataLength: totalBytes
                });
            });
        });
        
        req.on('error', (error) => {
            console.error('Request error:', error);
            reject(error);
        });
        
        req.end();
    });
}

// Test range request
async function testRangeRequest(videoFileName, start, end) {
    console.log(`\nTESTING: Range request for /video/${videoFileName} (bytes=${start}-${end})`);
    
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            hostname: 'localhost',
            port: 4000,
            path: `/video/${videoFileName}`,
            headers: {
                'Range': `bytes=${start}-${end}`
            }
        };
        
        const req = http.request(options, (res) => {
            console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
            console.log('Headers:', res.headers);
            
            let data = [];
            res.on('data', (chunk) => {
                data.push(chunk);
            });
            
            res.on('end', () => {
                const totalBytes = data.reduce((acc, chunk) => acc + chunk.length, 0);
                console.log(`Received ${totalBytes} bytes of video data`);
                
                const expectedBytes = (end - start) + 1;
                console.log(`Expected bytes: ${expectedBytes}, Actual bytes: ${totalBytes}`);
                
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    dataLength: totalBytes,
                    expectedLength: expectedBytes,
                    success: totalBytes === expectedBytes && res.statusCode === 206
                });
            });
        });
        
        req.on('error', (error) => {
            console.error('Request error:', error);
            reject(error);
        });
        
        req.end();
    });
}

// Test invalid range
async function testInvalidRange(videoFileName) {
    console.log(`\nTESTING: Invalid range request for /video/${videoFileName}`);
    
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            hostname: 'localhost',
            port: 4000,
            path: `/video/${videoFileName}`,
            headers: {
                'Range': 'bytes=9999999999-9999999999'
            }
        };
        
        const req = http.request(options, (res) => {
            console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
            console.log('Headers:', res.headers);
            
            let data = [];
            res.on('data', (chunk) => {
                data.push(chunk);
            });
            
            res.on('end', () => {
                const body = Buffer.concat(data).toString();
                console.log(`Response body: ${body}`);
                
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: body,
                    success: res.statusCode === 416
                });
            });
        });
        
        req.on('error', (error) => {
            console.error('Request error:', error);
            reject(error);
        });
        
        req.end();
    });
}

// Run all tests
async function runTests() {
    try {
        // Create a sample video if needed
        const videoFile = await createSampleVideo();
        const filename = path.basename(videoFile);
        
        // Run tests
        console.log('\n=== Running Video Endpoint Tests ===\n');
        
        // Test 1: Basic video request
        const basicTest = await testVideoEndpoint(filename);
        
        // Test 2: Range request for first 100 bytes
        const rangeTest = await testRangeRequest(filename, 0, 99);
        
        // Test 3: Range request for middle section
        const middleRangeTest = await testRangeRequest(filename, 100, 199);
        
        // Test 4: Invalid range request
        const invalidRangeTest = await testInvalidRange(filename);
        
        // Test 5: Invalid filename
        try {
            await testVideoEndpoint('../server.js');
            console.log('ERROR: Path traversal test FAILED - should not be able to access server.js');
        } catch (err) {
            console.log('Path traversal test passed - could not access server.js');
        }
        
        console.log('\n=== Test Results Summary ===');
        console.log('Basic video request:', basicTest.status === 200 ? 'PASSED' : 'FAILED');
        console.log('Range request (first 100 bytes):', rangeTest.success ? 'PASSED' : 'FAILED');
        console.log('Range request (middle section):', middleRangeTest.success ? 'PASSED' : 'FAILED');
        console.log('Invalid range request:', invalidRangeTest.success ? 'PASSED' : 'FAILED');
        
    } catch (err) {
        console.error('Test failed:', err);
    }
}

// Run all tests
runTests(); 