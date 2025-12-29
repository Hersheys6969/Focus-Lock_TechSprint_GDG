import { useState, useEffect, useRef } from 'react';
import FaceMonitor from './FaceMonitor';
import './App.css';

function App() {
  // --- STATE ---
  const [isFocused, setIsFocused] = useState(false);
  
  // Timer State
  const [sessionLength, setSessionLength] = useState(25 * 60); // Store the "Set" time
  const [timeLeft, setTimeLeft] = useState(25 * 60);           // Store the "Current" time
  
  const [isActive, setIsActive] = useState(false);
  const [isHandPaused, setIsHandPaused] = useState(false);
  const [calibStep, setCalibStep] = useState(0); 
  const [sensitivity, setSensitivity] = useState(50); 
  const [isMuted, setIsMuted] = useState(false);

  // --- REFS ---
  const faceMonitorRef = useRef(null);
  const audioRef = useRef(null);
  const prevFocusRef = useRef(true);
  const timerWorker = useRef(null);
  const lastSoundTime = useRef(0);
  const gazeDotRef = useRef(null);

  // --- TIMER FUNCTIONS ---
  
  const adjustTime = (minutes) => {
    if (!isActive) {
      // Update BOTH the session length and the current countdown
      setSessionLength(prev => {
        const newLen = Math.max(60, prev + (minutes * 60));
        setTimeLeft(newLen); // Sync current time
        return newLen;
      });
    }
  };
  
  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(sessionLength); // Revert to the user's set time
    // Tell worker to update its internal state
    if (timerWorker.current) {
        timerWorker.current.postMessage({ command: 'PAUSE' });
        timerWorker.current.postMessage({ command: 'RESET_TIME', value: sessionLength });
    }
  };

  const toggleTimer = () => setIsActive(!isActive);

  // --- EFFECTS ---

  // 1. Worker Initialization
  useEffect(() => {
    timerWorker.current = new Worker(new URL('./timerWorker.js', import.meta.url));
    timerWorker.current.onmessage = (e) => {
      if (e.data.type === 'TICK') setTimeLeft(e.data.timeLeft);
      if (e.data.type === 'DONE') {
          setIsActive(false);
          alert("SESSION COMPLETE! GREAT JOB.");
      }
    };
    return () => timerWorker.current.terminate();
  }, []);

  // 2. Timer Logic (THE FIX IS HERE)
  useEffect(() => {
    if (isHandPaused) {
      if (isActive) timerWorker.current.postMessage({ command: 'PAUSE' });
      return; 
    }
    
    // Only send START if we are fully ready
    if (isActive && isFocused && calibStep === 0) {
      // We pass 'timeLeft' so it resumes from where it left off.
      // Crucially, 'timeLeft' is NOT in the dependency array below.
      timerWorker.current.postMessage({ command: 'START', value: timeLeft });
    } else {
      timerWorker.current.postMessage({ command: 'PAUSE' });
    }

    // 3. Sound Logic
    if (isActive && prevFocusRef.current && !isFocused && !isHandPaused && calibStep === 0) {
      const now = Date.now();
      if (now - lastSoundTime.current > 3000 && !isMuted) { 
          if (audioRef.current) {
             audioRef.current.currentTime = 0;
             audioRef.current.play().catch(() => {});
             lastSoundTime.current = now; 
          }
      }
    }
    prevFocusRef.current = isFocused;

    // FIX: Dependency Array does NOT contain 'timeLeft'
    // This prevents the loop that was breaking your timer.
  }, [isActive, isFocused, isHandPaused, calibStep, isMuted]); 

  // --- UI HELPERS ---

  const startCalibration = () => faceMonitorRef.current?.startCalibration();
  const nextCalibPoint = () => faceMonitorRef.current?.confirmCalibrationPoint();

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const getCalibText = () => {
      if (calibStep === 1) return "Look at TOP LEFT corner";
      if (calibStep === 2) return "Look at TOP RIGHT corner";
      if (calibStep === 3) return "Look at BOTTOM LEFT corner";
      if (calibStep === 4) return "Look at BOTTOM RIGHT corner";
      if (calibStep === 5) return "Look at CENTER of screen";
      return "";
  };

  return (
    <div className="app-container">
      <audio ref={audioRef} src={`${import.meta.env.BASE_URL}alert.mp3`} preload="auto" />

      {/* Sidebar */}
      <div className={`controls-panel ${isHandPaused ? 'hand-paused' : (!isFocused && isActive ? 'distracted' : 'focused')}`}>
        <h1 className="glitch-text">FOCUS_LOCK</h1>
        
        <p className="app-desc">
            An AI-powered productivity tool that uses gaze tracking to ensure you stay focused on your work.
        </p>
        
        <div className="status-badge">
          {calibStep > 0 ? "⚠️ CALIB" : (isHandPaused ? "✋ PAUSED" : (isFocused ? "🟢 FOCUSED" : "🔴 DISTRACTED"))}
        </div>

        <div className="timer-controls">
            <button className="mini-btn" onClick={() => adjustTime(-5)} disabled={isActive}>-5</button>
            <div className="timer-display">{formatTime(timeLeft)}</div>
            <button className="mini-btn" onClick={() => adjustTime(5)} disabled={isActive}>+5</button>
        </div>

        <div className="button-grid">
            <button onClick={toggleTimer} className={isActive ? "btn-danger" : "btn-primary"}>
                {isActive ? "PAUSE SESSION" : "START SESSION"}
            </button>
            <button onClick={resetTimer} className="btn-secondary">RESET TIMER</button>
            <button onClick={startCalibration} className="btn-secondary" disabled={calibStep > 0}>
                {calibStep > 0 ? "..." : "CALIBRATE"}
            </button>
        </div>

        <div style={{marginTop: '15px', width: '100%'}}>
            <label style={{fontSize: '0.9rem', color: '#0f0', display:'flex', justifyContent:'space-between'}}>
                SENSITIVITY <span>{sensitivity}%</span>
            </label>
            <input type="range" min="0" max="100" value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} style={{width: '100%', marginTop: '5px', accentColor: '#0f0'}} />
            
            <div className="checkbox-wrapper">
                <input type="checkbox" id="muteCheck" checked={isMuted} onChange={(e) => setIsMuted(e.target.checked)} />
                <label htmlFor="muteCheck">Disable Alert Sound</label>
            </div>
        </div>

        <div className="instructions-panel">
            <h3>:: SYSTEM GUIDE ::</h3>
            <ol>
                <li>Allow Camera Access.</li>
                <li><strong>Calibrate</strong> using the 5-point system.</li>
                <li>Set Timer & Sensitivity.</li>
                <li><strong>Raise Hand</strong> (Palm) to Pause Timer.</li>
                <li>Pull this tab into a separate window!</li>
            </ol>
        </div>
      </div>

      <div className="monitor-wrapper">
        <FaceMonitor 
            ref={faceMonitorRef}
            sensitivity={sensitivity}
            onFocusChange={setIsFocused} 
            onHandGesture={setIsHandPaused}
            onCalibrationStep={setCalibStep}
            gazeDotRef={gazeDotRef} 
        />
        
        {calibStep === 0 && (
          <div className="hud-overlay">
            <div className="gaze-tracker-box">
               <div className="gaze-label">GAZE TRACKER</div>
               <div className="safe-zone-box"></div> 
               <div ref={gazeDotRef} className={`gaze-dot ${isFocused ? 'dot-green' : 'dot-red'}`}></div>
            </div>
          </div>
        )}

        {calibStep > 0 && (
            <div className="calibration-overlay">
                <h1>{getCalibText()}</h1>
                <button onClick={nextCalibPoint}>CAPTURE</button>
            </div>
        )}
      </div>
    </div>
  );
}

export default App;