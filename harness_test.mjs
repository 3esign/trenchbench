const ws = new WebSocket('wss://pumpportal.fun/api/data');

ws.onopen = function open() {
  console.log('Connected to PumpPortal WebSocket');
  
  // Subscribing to new token creation events
  let payload = {
      method: "subscribeNewToken", 
  }
  ws.send(JSON.stringify(payload));
  
  // Let's also subscribe to trades. PumpPortal allows subscribing to all trades with an empty keys array or something?
  // Actually, wait, let's just use subscribeNewToken for this test to see the data format.
  
  setTimeout(() => {
    console.log('\n--- Test Complete, closing connection ---');
    ws.close();
    process.exit(0);
  }, 10000);
};

ws.onmessage = function message(event) {
  const parsed = JSON.parse(event.data);
  console.log('\n[NEW TOKEN DATA RECEIVED]:');
  console.log(JSON.stringify(parsed, null, 2));
};

ws.onerror = console.error;
