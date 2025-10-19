import React, { useEffect, useRef, useState } from 'react';
import { loadOpenCV, ensureArucoAvailable } from '../lib/opencvLoader';

interface WhiteboardCVProps {
  stream: MediaStream;
  label?: string;
}

// Utility to create an ImageData from cv.Mat RGBA
function matToImageData(mat: any): ImageData {
  const img = new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
  return img;
}

const WhiteboardCV: React.FC<WhiteboardCVProps> = ({ stream, label = 'Camera View' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewCanvasRef = useRef<HTMLCanvasElement>(null); // Camera View with overlays
  const drawCanvasRef = useRef<HTMLCanvasElement>(null); // Drawing Canvas (Project This)

  const [status, setStatus] = useState<string>('Loading OpenCV...');
  const [drawingEnabled, setDrawingEnabled] = useState<boolean>(false);
  const [minArea, setMinArea] = useState<number>(150);

  // Calibration and smoothing state
  const transformMatrixRef = useRef<any | null>(null);
  const lastDrawPointRef = useRef<{x:number, y:number} | null>(null);
  const positionHistoryRef = useRef<Array<{x:number, y:number}>>([]);

  // Canvas and marker props
  const canvasHeight = 720;
  const canvasWidth = 1280;
  const markerSize = 200;
  const margin = 40;

  const [arucoReady, setArucoReady] = useState<boolean>(false);

  useEffect(() => {
    let stop = false;
    let cleanupCV: (() => void) | null = null;

    const run = async () => {
      try {
        await loadOpenCV();
        setStatus('Initializing OpenCV...');
        const hasAruco = await ensureArucoAvailable();
        setArucoReady(hasAruco);

        const cv: any = (window as any).cv;

        // Setup video
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Prepare output canvases
        const viewCanvas = viewCanvasRef.current!;
        const viewCtx = viewCanvas.getContext('2d', { willReadFrequently: true })!;
        viewCanvas.width = canvasWidth;
        viewCanvas.height = canvasHeight;

        const drawCanvas = drawCanvasRef.current!;
        const drawCtx = drawCanvas.getContext('2d')!;
        drawCanvas.width = canvasWidth;
        drawCanvas.height = canvasHeight;

        // Initialize drawing canvas background (light gray)
        drawCtx.fillStyle = 'rgb(230,230,230)';
        drawCtx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Draw ArUco fiducials on drawing canvas corners
        if (hasAruco) {
          try {
            const dict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
            for (let id = 0; id < 4; id++) {
              const marker = new cv.Mat();
              cv.aruco.drawMarker(dict, id, markerSize, marker, 1);
              const markerRGBA = new cv.Mat();
              cv.cvtColor(marker, markerRGBA, cv.COLOR_GRAY2RGBA);
              const imgData = matToImageData(markerRGBA);
              const x = id === 0 ? margin : id === 1 ? (canvasWidth - margin - markerSize) : id === 2 ? (canvasWidth - margin - markerSize) : margin;
              const y = id === 0 ? margin : id === 1 ? margin : id === 2 ? (canvasHeight - margin - markerSize) : (canvasHeight - margin - markerSize);
              // Put onto canvas
              const tmpCanvas = document.createElement('canvas');
              tmpCanvas.width = markerSize; tmpCanvas.height = markerSize;
              const tmpCtx = tmpCanvas.getContext('2d')!;
              tmpCtx.putImageData(imgData, 0, 0);
              drawCtx.drawImage(tmpCanvas, x, y);
              markerRGBA.delete();
              marker.delete();
            }
          } catch (e) {
            console.warn('Failed to draw ArUco markers on canvas:', e);
          }
        }

        // Mat allocations
        const rgba = new cv.Mat(canvasHeight, canvasWidth, cv.CV_8UC4);
        const bgr = new cv.Mat(canvasHeight, canvasWidth, cv.CV_8UC3);
        const gray = new cv.Mat();
        const hsv = new cv.Mat();
        const mask = new cv.Mat();
        const kernel = cv.Mat.ones(7, 7, cv.CV_8U);

        // For aruco detection
        const arucoDict = hasAruco ? cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X_4_50 || cv.aruco.DICT_4X4_50) : null;
        const detectorParams = hasAruco ? new cv.aruco.DetectorParameters() : null;

        const smoothAppend = (p: {x:number, y:number} | null) => {
          if (!p) { positionHistoryRef.current = []; return null; }
          const hist = positionHistoryRef.current.slice();
          hist.push(p);
          if (hist.length > 5) hist.shift();
          positionHistoryRef.current = hist;
          const avgX = Math.round(hist.reduce((s, v) => s + v.x, 0) / hist.length);
          const avgY = Math.round(hist.reduce((s, v) => s + v.y, 0) / hist.length);
          return { x: avgX, y: avgY };
        };

        const getDestMarkerCenters = (): Array<{x:number, y:number}> => {
          const offset = Math.floor(markerSize / 2);
          return [
            { x: margin + offset, y: margin + offset },
            { x: canvasWidth - margin - offset, y: margin + offset },
            { x: canvasWidth - margin - offset, y: canvasHeight - margin - offset },
            { x: margin + offset, y: canvasHeight - margin - offset },
          ];
        };

        const computeTransform = (srcPts: Array<{x:number, y:number}>) => {
          const dstPts = getDestMarkerCenters();
          const src = cv.matFromArray(4, 1, cv.CV_32FC2, srcPts.flatMap(p => [p.x, p.y]));
          const dst = cv.matFromArray(4, 1, cv.CV_32FC2, dstPts.flatMap(p => [p.x, p.y]));
          const M = cv.getPerspectiveTransform(src, dst);
          src.delete(); dst.delete();
          return M;
        };

        const transformPoint = (M: any | null, p: {x:number, y:number}) => {
          if (!M) return p;
          const src = cv.matFromArray(1, 1, cv.CV_32FC2, [p.x, p.y]);
          const dst = new cv.Mat();
          cv.perspectiveTransform(src, dst, M);
          const out = { x: Math.round(dst.data32F[0]), y: Math.round(dst.data32F[1]) };
          src.delete(); dst.delete();
          return out;
        };

        const greenLower = new cv.Mat(1, 1, cv.CV_8UC3, new Uint8Array([40,40,0])); // Not used directly
        greenLower.delete();
        const lowerScalar = new cv.Scalar(40, 40, 0, 0);
        const upperScalar = new cv.Scalar(80, 255, 255, 255);

        const readFrame = () => {
          if (stop) return;
          // Draw current video frame to view canvas background
          const v = videoRef.current!;
          if (v.readyState >= 2) {
            viewCtx.drawImage(v, 0, 0, canvasWidth, canvasHeight);

            // Read pixels into cv.Mat
            const imageData = viewCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            rgba.data.set(imageData.data);

            cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR);

            // --- ArUco detection ---
            let fiducialCenters: Array<{x:number, y:number}> | null = null;
            if (hasAruco && cv.aruco.detectMarkers) {
              cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
              const corners = new cv.MatVector();
              const ids = new cv.Mat();
              const rejected = new cv.MatVector();
              try {
                cv.aruco.detectMarkers(gray, arucoDict, corners, ids, detectorParams, rejected);
              } catch (e) {
                // Some builds may have different signatures; ignore errors
              }

              if (!ids.empty()) {
                // Draw detected markers on view canvas overlay
                for (let i = 0; i < ids.rows; i++) {
                  const id = ids.intAt(i, 0);
                  if (id >= 0 && id <= 3) {
                    const c = corners.get(i);
                    // Compute center as mean of 4 X,Y points
                    const x = (c.doubleAt(0,0) + c.doubleAt(0,2) + c.doubleAt(0,4) + c.doubleAt(0,6)) / 4.0;
                    const y = (c.doubleAt(0,1) + c.doubleAt(0,3) + c.doubleAt(0,5) + c.doubleAt(0,7)) / 4.0;
                    if (!fiducialCenters) fiducialCenters = [];
                    fiducialCenters[id] = { x: Math.round(x), y: Math.round(y) };
                    c.delete();
                  }
                }
                // draw ids text
                viewCtx.fillStyle = 'lime';
                viewCtx.font = '16px sans-serif';
                viewCtx.fillText(`Detected IDs: ${Array.from({length: ids.rows}, (_,i)=> ids.intAt(i,0)).join(', ')}`, 30, 80);
              } else {
                viewCtx.fillStyle = 'red';
                viewCtx.font = '16px sans-serif';
                viewCtx.fillText('No markers detected', 30, 80);
              }
              corners.delete(); ids.delete(); rejected.delete();
            }

            // --- Green detection ---
            cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);
            cv.inRange(hsv, lowerScalar, upperScalar, mask);
            // Morph noise reduction
            cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
            cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
            cv.erode(mask, mask, kernel);

            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let greenPos: {x:number, y:number} | null = null;
            if (contours.size() > 0) {
              let largestIdx = -1; let largestArea = 0;
              for (let i = 0; i < contours.size(); i++) {
                const cnt = contours.get(i);
                const area = cv.contourArea(cnt);
                if (area > largestArea) { largestArea = area; largestIdx = i; }
                cnt.delete();
              }
              if (largestIdx >= 0 && largestArea >= minArea) {
                const cnt = contours.get(largestIdx);
                const rect = cv.boundingRect(cnt);
                greenPos = { x: rect.x + Math.floor(rect.width/2), y: rect.y + Math.floor(rect.height/2) };
              } else {
                positionHistoryRef.current = [];
              }
            } else {
              positionHistoryRef.current = [];
            }
            contours.delete(); hierarchy.delete();

            const smoothed = smoothAppend(greenPos);

            // Draw overlays on view canvas
            if (smoothed) {
              // draw circle
              viewCtx.strokeStyle = 'lime';
              viewCtx.fillStyle = 'lime';
              viewCtx.beginPath();
              viewCtx.arc(smoothed.x, smoothed.y, 10, 0, Math.PI*2);
              viewCtx.stroke();
              viewCtx.beginPath();
              viewCtx.arc(smoothed.x, smoothed.y, 3, 0, Math.PI*2);
              viewCtx.fill();

              // If calibrated, map to canvas and draw cursor + line
              const M = transformMatrixRef.current;
              if (M) {
                const mapped = transformPoint(M, smoothed);
                const clamped = { x: Math.max(0, Math.min(canvasWidth-1, mapped.x)), y: Math.max(0, Math.min(canvasHeight-1, mapped.y)) };
                const cursorColor = drawingEnabled ? 'red' : 'orange';
                // cursor on drawing canvas copy
                drawCtx.save();
                drawCtx.strokeStyle = cursorColor;
                drawCtx.fillStyle = cursorColor;
                drawCtx.beginPath();
                drawCtx.arc(clamped.x, clamped.y, 8, 0, Math.PI*2);
                drawCtx.stroke();
                drawCtx.beginPath();
                drawCtx.arc(clamped.x, clamped.y, 3, 0, Math.PI*2);
                drawCtx.fill();
                drawCtx.restore();

                if (drawingEnabled) {
                  const last = lastDrawPointRef.current;
                  if (last) {
                    drawCtx.save();
                    drawCtx.strokeStyle = 'black';
                    drawCtx.lineWidth = 3;
                    drawCtx.beginPath();
                    drawCtx.moveTo(last.x, last.y);
                    drawCtx.lineTo(clamped.x, clamped.y);
                    drawCtx.stroke();
                    drawCtx.restore();
                  }
                  lastDrawPointRef.current = clamped;
                } else {
                  lastDrawPointRef.current = null;
                }
              } else {
                lastDrawPointRef.current = null;
              }
            } else {
              lastDrawPointRef.current = null;
            }

            // Status text
            const calibrated = !!transformMatrixRef.current;
            viewCtx.font = '20px sans-serif';
            viewCtx.fillStyle = calibrated ? 'lime' : 'red';
            viewCtx.fillText(calibrated ? 'CALIBRATED' : "NOT CALIBRATED (press 'c')", 30, 120);
            viewCtx.fillStyle = drawingEnabled ? 'yellow' : 'gray';
            viewCtx.fillText(`DRAWING: ${drawingEnabled ? 'ON' : 'OFF'}`, 30, 160);

            if (smoothed) {
              viewCtx.fillStyle = 'white';
              viewCtx.font = '16px monospace';
              viewCtx.fillText(`Pos: (${smoothed.x}, ${smoothed.y})`, 30, 200);
            }

            // schedule next
          }
          requestAnimationFrame(readFrame);
        };

        // Key handlers
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'd') {
            setDrawingEnabled(d => !d);
            lastDrawPointRef.current = null;
          } else if (e.key === 'c') {
            // try to detect fiducials this frame; recompute from last seen tops
            // Run a one-off detection from current view pixels
            const imageData = viewCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            rgba.data.set(imageData.data);
            cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR);
            if (hasAruco && cv.aruco.detectMarkers) {
              cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
              const corners = new cv.MatVector();
              const ids = new cv.Mat();
              const rejected = new cv.MatVector();
              try { cv.aruco.detectMarkers(gray, arucoDict, corners, ids, detectorParams, rejected); } catch {}
              if (!ids.empty()) {
                const centers: Array<{x:number, y:number}> = [] as any;
                for (let i = 0; i < ids.rows; i++) {
                  const id = ids.intAt(i, 0);
                  if (id >= 0 && id <= 3) {
                    const c = corners.get(i);
                    const x = (c.doubleAt(0,0) + c.doubleAt(0,2) + c.doubleAt(0,4) + c.doubleAt(0,6)) / 4.0;
                    const y = (c.doubleAt(0,1) + c.doubleAt(0,3) + c.doubleAt(0,5) + c.doubleAt(0,7)) / 4.0;
                    centers[id] = { x: Math.round(x), y: Math.round(y) };
                    c.delete();
                  }
                }
                if (centers.length === 4 && centers[0] && centers[1] && centers[2] && centers[3]) {
                  const M = computeTransform(centers as any);
                  if (transformMatrixRef.current) transformMatrixRef.current.delete();
                  transformMatrixRef.current = M;
                  setStatus('Perspective transform calibrated!');
                } else {
                  setStatus('Fiducials not detected — ensure all 4 are visible.');
                }
              } else {
                setStatus('Fiducials not detected — ensure all 4 are visible.');
              }
              corners.delete(); ids.delete(); rejected.delete();
            } else {
              setStatus('ArUco module unavailable in current OpenCV.js build.');
            }
          } else if (e.key === 'r') {
            // Reset drawing canvas
            drawCtx.fillStyle = 'rgb(230,230,230)';
            drawCtx.fillRect(0, 0, canvasWidth, canvasHeight);
            // re-draw fiducials
            if (arucoReady) {
              try {
                const dict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
                for (let id = 0; id < 4; id++) {
                  const marker = new cv.Mat();
                  cv.aruco.drawMarker(dict, id, markerSize, marker, 1);
                  const markerRGBA = new cv.Mat();
                  cv.cvtColor(marker, markerRGBA, cv.COLOR_GRAY2RGBA);
                  const imgData = matToImageData(markerRGBA);
                  const x = id === 0 ? margin : id === 1 ? (canvasWidth - margin - markerSize) : id === 2 ? (canvasWidth - margin - markerSize) : margin;
                  const y = id === 0 ? margin : id === 1 ? margin : id === 2 ? (canvasHeight - margin - markerSize) : (canvasHeight - margin - markerSize);
                  const tmpCanvas = document.createElement('canvas');
                  tmpCanvas.width = markerSize; tmpCanvas.height = markerSize;
                  const tmpCtx = tmpCanvas.getContext('2d')!;
                  tmpCtx.putImageData(imgData, 0, 0);
                  drawCtx.drawImage(tmpCanvas, x, y);
                  markerRGBA.delete();
                  marker.delete();
                }
              } catch {}
            }
            lastDrawPointRef.current = null;
          } else if (e.key === '+' || e.key === '=') {
            setMinArea(m => m + 50);
            setStatus(prev => `Min area: ${minArea + 50} (less sensitive)`);
          } else if (e.key === '-' || e.key === '_') {
            setMinArea(m => Math.max(100, m - 50));
            setStatus(prev => `Min area: ${Math.max(100, minArea - 50)} (more sensitive)`);
          }
        };
        window.addEventListener('keydown', onKey);

        setStatus("✅ Ready! Press 'c' to calibrate, 'd' to toggle drawing, 'r' to reset.");
        readFrame();

        cleanupCV = () => {
          window.removeEventListener('keydown', onKey);
          rgba.delete(); bgr.delete(); gray.delete(); hsv.delete(); mask.delete(); kernel.delete();
          if (transformMatrixRef.current) { try { transformMatrixRef.current.delete(); } catch {} transformMatrixRef.current = null; }
        };
      } catch (e) {
        console.error(e);
        setStatus('Failed to initialize OpenCV.');
      }
    };

    run();

    return () => {
      stop = true;
      if (cleanupCV) cleanupCV();
      try { videoRef.current?.pause(); } catch {}
      const tracks = (videoRef.current?.srcObject as MediaStream | null)?.getTracks();
      tracks?.forEach(t => t.stop());
    };
  }, [stream]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg w-full flex flex-col">
      <h3 className="bg-gray-700 text-white font-bold text-center py-2 px-4 select-none">{label} + Whiteboard CV</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-2 bg-black">
        <div className="relative">
          <canvas ref={viewCanvasRef} className="w-full h-full" style={{ aspectRatio: '16/9' }} />
          <video ref={videoRef} muted playsInline className="hidden" />
          <div className="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-1 rounded">{status}{arucoReady ? '' : ' (ArUco may be unavailable)'}
          </div>
        </div>
        <div className="relative">
          <canvas ref={drawCanvasRef} className="w-full h-full" style={{ aspectRatio: '16/9' }} />
          <div className="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-1 rounded">Drawing Canvas (Project This)</div>
        </div>
      </div>
      <div className="p-2 text-xs text-gray-300 bg-gray-900 flex flex-wrap gap-4">
        <span>c: calibrate</span>
        <span>d: toggle drawing</span>
        <span>r: reset canvas</span>
        <span>+/-: sensitivity</span>
      </div>
    </div>
  );
};

export default WhiteboardCV;
