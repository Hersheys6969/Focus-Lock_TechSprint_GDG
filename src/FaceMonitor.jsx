import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { FaceLandmarker, HandLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

const lerp = (start, end, factor) => start + (end - start) * factor;

const FaceMonitor = forwardRef(({ onFocusChange, onHandGesture, onCalibrationStep, sensitivity, gazeDotRef }, ref) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  
  const faceLandmarkerRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const requestRef = useRef(null);

  const sensitivityRef = useRef(sensitivity);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);

  const calibStep = useRef(0); 
  const safeZone = useRef({ minX: -0.15, maxX: 0.15, minY: -0.15, maxY: 0.15 });
  const centerOffset = useRef({ x: 0, y: 0 });
  const captureCalibrationPoint = useRef(false);
  const tempCalibData = useRef({ minX: 100, maxX: -100, minY: 100, maxY: -100 });
  const lastValidGaze = useRef({ x: 0, y: 0 });
  const smoothGaze = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({
    startCalibration: () => {
      calibStep.current = 1;
      onCalibrationStep(1); 
      tempCalibData.current = { minX: 100, maxX: -100, minY: 100, maxY: -100 };
      centerOffset.current = { x: 0, y: 0 };
    },
    confirmCalibrationPoint: () => { captureCalibrationPoint.current = true; }
  }));

  useEffect(() => {
    const setup = async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        outputFaceBlendshapes: true, runningMode: "VIDEO", numFaces: 1
      });

      handLandmarkerRef.current = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numHands: 2
      });

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.addEventListener("loadeddata", () => {
          setLoading(false);
          const ctx = canvasRef.current.getContext("2d");
          const drawingUtils = new DrawingUtils(ctx);
          predictWebcam(drawingUtils);
        });
      }
    };

    const predictWebcam = (drawingUtils) => {
      if (!videoRef.current || !canvasRef.current || !faceLandmarkerRef.current || !handLandmarkerRef.current) return;

      let startTimeMs = performance.now();
      const faceResults = faceLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
      const handResults = handLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);

      const ctx = canvasRef.current.getContext("2d");
      if (canvasRef.current.width !== videoRef.current.videoWidth) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
      }
      const width = canvasRef.current.width;
      const height = canvasRef.current.height;
      
      ctx.clearRect(0, 0, width, height);

      // --- BORDERS ---
      ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
      ctx.lineWidth = 4;
      const cornerSize = 40;
      ctx.beginPath();
      ctx.moveTo(10, cornerSize); ctx.lineTo(10, 10); ctx.lineTo(cornerSize, 10);
      ctx.moveTo(width - 10, cornerSize); ctx.lineTo(width - 10, 10); ctx.lineTo(width - cornerSize, 10);
      ctx.moveTo(10, height - cornerSize); ctx.lineTo(10, height - 10); ctx.lineTo(cornerSize, height - 10);
      ctx.moveTo(width - 10, height - cornerSize); ctx.lineTo(width - 10, height - 10); ctx.lineTo(width - cornerSize, height - 10);
      ctx.stroke();

      // --- HAND LOGIC ---
      if (handResults.landmarks.length > 0) {
        onHandGesture(true);
        for (const landmarks of handResults.landmarks) {
          drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00FFFF", lineWidth: 3 });
          drawingUtils.drawLandmarks(landmarks, { color: "#0088FF", lineWidth: 1, radius: 3 });
        }
      } else {
        onHandGesture(false);
      }

      // --- FACE LOGIC ---
      if (faceResults.faceLandmarks.length > 0) {
        const landmarks = faceResults.faceLandmarks[0];
        const blendshapes = faceResults.faceBlendshapes[0].categories;

        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#00FF0030", lineWidth: 0.5 });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#00FF00", lineWidth: 2 });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#00FF00", lineWidth: 2 });

        const getScore = (name) => blendshapes.find(s => s.categoryName === name)?.score || 0;
        const blinkScore = getScore("eyeBlinkLeft") + getScore("eyeBlinkRight");
        const isBlinking = blinkScore > 0.8;

        let lookLeft = getScore("eyeLookInRight") + getScore("eyeLookOutLeft"); 
        let lookRight = getScore("eyeLookInLeft") + getScore("eyeLookOutRight");
        let lookUp = getScore("eyeLookUpLeft") + getScore("eyeLookUpRight");
        let lookDown = getScore("eyeLookDownLeft") + getScore("eyeLookDownRight");

        let targetGazeX = (lookRight - lookLeft) - centerOffset.current.x;
        let targetGazeY = (lookDown - lookUp) - centerOffset.current.y;

        smoothGaze.current.x = lerp(smoothGaze.current.x, targetGazeX, 0.2);
        smoothGaze.current.y = lerp(smoothGaze.current.y, targetGazeY, 0.2);
        
        if (isBlinking) smoothGaze.current = { ...lastValidGaze.current };
        else lastValidGaze.current = { ...smoothGaze.current };

        const gazeX = smoothGaze.current.x;
        const gazeY = smoothGaze.current.y;

        const leftIris = landmarks[468];
        const rightIris = landmarks[473];
        if (leftIris && rightIris) {
            const scale = 80; 
            ctx.strokeStyle = isBlinking ? "yellow" : "#ff00ff"; 
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(leftIris.x * width, leftIris.y * height); ctx.lineTo((leftIris.x * width) + (gazeX * scale), (leftIris.y * height) + (gazeY * scale)); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightIris.x * width, rightIris.y * height); ctx.lineTo((rightIris.x * width) + (gazeX * scale), (rightIris.y * height) + (gazeY * scale)); ctx.stroke();
        }

        // --- CALIBRATION ---
        if (calibStep.current > 0 && captureCalibrationPoint.current) {
            if (calibStep.current === 5) {
                centerOffset.current.x += gazeX;
                centerOffset.current.y += gazeY;
                safeZone.current = { ...tempCalibData.current };
                calibStep.current = 0;
                onCalibrationStep(0); 
                alert("System Calibrated! Center Locked.");
            } else {
                tempCalibData.current.minX = Math.min(tempCalibData.current.minX, gazeX);
                tempCalibData.current.maxX = Math.max(tempCalibData.current.maxX, gazeX);
                tempCalibData.current.minY = Math.min(tempCalibData.current.minY, gazeY);
                tempCalibData.current.maxY = Math.max(tempCalibData.current.maxY, gazeY);
                calibStep.current += 1;
                onCalibrationStep(calibStep.current);
            }
            captureCalibrationPoint.current = false;
        }

        // --- FOCUS LOGIC (SUPER FORGIVING UPDATE) ---
        const currentSensitivity = sensitivityRef.current;
        
        // OLD: 0.05 + (...) * 0.002
        // NEW: 0.12 (Base Buffer) + (...) * 0.005 (Huge Multiplier)
        const tolerance = 0.12 + ((100 - currentSensitivity) * 0.005); 
        
        const minX = safeZone.current.minX - tolerance;
        const maxX = safeZone.current.maxX + tolerance;
        const minY = safeZone.current.minY - tolerance;
        const maxY = safeZone.current.maxY + tolerance;

        const isFocused = isBlinking || (gazeX >= minX && gazeX <= maxX && gazeY >= minY && gazeY <= maxY);
        onFocusChange(isFocused);

        if (gazeDotRef && gazeDotRef.current) {
             const hudSize = 150;
             const xPx = (gazeX + 0.5) * hudSize; 
             const yPx = (gazeY + 0.5) * hudSize;
             gazeDotRef.current.style.transform = `translate(${xPx}px, ${yPx}px)`;
        }
      }

      requestRef.current = requestAnimationFrame(() => predictWebcam(drawingUtils));
    };

    setup();
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#050505' }}>
      {loading && <div className="loading-text">INITIALIZING AI SYSTEMS...</div>}
      <video ref={videoRef} autoPlay playsInline muted style={{ opacity: 0, position: 'absolute' }} />
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
});

export default FaceMonitor;