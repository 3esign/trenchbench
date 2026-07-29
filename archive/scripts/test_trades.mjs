const ws = new WebSocket('wss://pumpportal.fun/api/data');

ws.onopen = function open() {
  console.log('Connected to PumpPortal WebSocket for Trades');
  
  // Subscribing to ALL trades to see what the data structure is
  let payload = {
      method: "subscribeTokenTrade"
  }
  ws.send(JSON.stringify(payload));
  
  setTimeout(() => {
    console.log('\n--- Trade Test Complete ---');
    ws.close();
    process.exit(0);
  }, 5000); // just 5 seconds
};

ws.onmessage = function message(event) {
  const parsed = JSON.parse(event.data);
  // Only print one or two trades to keep output small
  console.log('\n[TRADE DATA RECEIVED]:');
  console.log(JSON.stringify(parsed, null, 2));
};

ws.onerror = console.error;
