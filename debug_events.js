// Debug script to test events loading
// Run this in the Electron app's developer console

console.log('🔍 DEBUGGING EVENTS LOADING');

// Test 1: Check if electronAPI is available
console.log('1. electronAPI available:', !!window.electronAPI);
if (window.electronAPI) {
    console.log('   Available methods:', Object.keys(window.electronAPI));
}

// Test 2: Check auth status
console.log('2. Checking auth status...');
window.electronAPI.checkAuthStatus().then(result => {
    console.log('   Auth status result:', result);
    console.log('   Salesforce authenticated:', result.salesforce);
    console.log('   Slack authenticated:', result.slack);
    console.log('   Both authenticated:', result.salesforce && result.slack);
}).catch(error => {
    console.error('   Auth status error:', error);
});

// Test 3: Check events section visibility
console.log('3. Checking events section...');
const eventsSection = document.getElementById('events-section');
console.log('   Events section exists:', !!eventsSection);
if (eventsSection) {
    console.log('   Has hidden class:', eventsSection.classList.contains('hidden'));
    console.log('   Display style:', eventsSection.style.display);
    console.log('   Computed display:', getComputedStyle(eventsSection).display);
}

// Test 4: Check events loading elements
const eventsLoading = document.getElementById('events-loading');
const eventsContainer = document.getElementById('events-container');
const eventsError = document.getElementById('events-error');

console.log('4. Events UI elements:');
console.log('   Loading element exists:', !!eventsLoading);
console.log('   Container element exists:', !!eventsContainer);
console.log('   Error element exists:', !!eventsError);

if (eventsLoading) console.log('   Loading display:', getComputedStyle(eventsLoading).display);
if (eventsContainer) console.log('   Container display:', getComputedStyle(eventsContainer).display);
if (eventsError) console.log('   Error display:', getComputedStyle(eventsError).display);

// Test 5: Try to call getUserEvents directly
console.log('5. Testing getUserEvents directly...');
window.electronAPI.getUserEvents().then(result => {
    console.log('   getUserEvents result:', result);
    console.log('   Success:', result.success);
    console.log('   Events count:', result.events ? result.events.length : 'No events array');
    console.log('   Error:', result.error);
    
    if (result.events && result.events.length > 0) {
        console.log('   First event:', result.events[0]);
        console.log('   Event keys:', Object.keys(result.events[0]));
    }
}).catch(error => {
    console.error('   getUserEvents error:', error);
});

// Test 6: Check if loadUserEvents function exists
console.log('6. loadUserEvents function exists:', typeof loadUserEvents);

// Test 7: Try calling loadUserEvents if it exists
if (typeof loadUserEvents === 'function') {
    console.log('7. Calling loadUserEvents...');
    try {
        loadUserEvents();
    } catch (error) {
        console.error('   loadUserEvents error:', error);
    }
} else {
    console.log('7. loadUserEvents function not available in global scope');
}

console.log('🔍 DEBUG COMPLETE - Check the results above');
