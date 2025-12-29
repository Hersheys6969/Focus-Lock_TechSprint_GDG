let intervalId = null;
let timeLeft = 0;

self.onmessage = (e) => {
  const { command, value } = e.data;

  if (command === 'START') {
    // Only start if not already running
    if (!intervalId) {
        timeLeft = value;
        intervalId = setInterval(() => {
          timeLeft--;
          self.postMessage({ type: 'TICK', timeLeft });
          
          if (timeLeft <= 0) {
            clearInterval(intervalId);
            intervalId = null;
            self.postMessage({ type: 'DONE' });
          }
        }, 1000);
    }
  } else if (command === 'PAUSE') {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
  } else if (command === 'RESET_TIME') {
      // Just update the internal value without starting
      timeLeft = value;
  }
};