// Debug script to test User ID extraction and JWT token flow
// Run this in the Electron app's developer console

console.log('🔍 DEBUGGING AUTH FLOW - USER ID & JWT');

// Test 1: Check stored tokens
console.log('1. Checking stored tokens...');
window.electronAPI.checkAuthStatus().then(result => {
    console.log('   Auth status:', result);
}).catch(error => {
    console.error('   Auth status error:', error);
});

// Test 2: Get raw token data (we'll need to add this to preload if not available)
console.log('2. Testing getUserEvents with detailed logging...');
window.electronAPI.getUserEvents().then(result => {
    console.log('   getUserEvents result:', result);
    console.log('   Success:', result.success);
    console.log('   Events count:', result.events ? result.events.length : 'No events');
    console.log('   Error:', result.error);
}).catch(error => {
    console.error('   getUserEvents error:', error);
});

// Test 3: Check if we can access the main process logs
console.log('3. Main process should show detailed logs for:');
console.log('   - Raw Salesforce identity URL');
console.log('   - Extracted User ID');
console.log('   - Flow URL and request body');
console.log('   - Flow response');
console.log('   - OAuth token retrieval for JWT');

// Test 4: Create a session to test JWT flow
console.log('4. Testing session creation (JWT flow)...');
window.electronAPI.connectWebSocket().then(wsResult => {
    if (wsResult.success) {
        console.log('   WebSocket connected, creating session...');
        return window.electronAPI.createSession();
    } else {
        throw new Error('WebSocket connection failed: ' + wsResult.error);
    }
}).then(sessionResult => {
    console.log('   Session creation result:', sessionResult);
    console.log('   Check main process logs for JWT token sending');
}).catch(error => {
    console.error('   Session creation error:', error);
});

console.log('🔍 Check the main process console (Electron app logs) for detailed auth flow information');
console.log('🔍 Look for these specific log messages:');
console.log('   - "Raw Salesforce identity URL:"');
console.log('   - "✅ Extracted User ID:"');
console.log('   - "📡 Flow URL:"');
console.log('   - "📦 Request body:"');
console.log('   - "Salesforce flow result:"');
console.log('   - "WebSocketManager: Getting OAuth token for AI features..."');
console.log('   - "WebSocketManager: OAuth token obtained, sending to Heroku..."');
console.log('   - "WebSocketManager: Sending OAuth token for AI features..."');
