import React, { useEffect, useRef, useState } from 'react';
import { loadOpenCV, ensureArucoAvailable } from '../lib/opencvLoader';

interface WhiteboardDisplayProps {
  stream1: MediaStream | null;
  stream2: MediaStream | null;
}

// Utility to create an ImageData from cv.Mat RGBA
function matToImageData(mat: any): ImageData {
  const img = new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
  return img;
}

const WhiteboardDisplay: React.FC<WhiteboardDisplayProps> = ({ stream1, stream2 }) => {
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const whiteboardCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [status, setStatus] = useState<string>('Initializing...');
  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);
  const [drawingPoints, setDrawingPoints] = useState<Array<{x: number, y: number}>>([]);
  
  // Calibration state
  const transformMatrix1Ref = useRef<any | null>(null);
  const transformMatrix2Ref = useRef<any | null>(null);
  const lastDrawPoint1Ref = useRef<{x: number, y: number} | null>(null);
  const lastDrawPoint2Ref = useRef<{x: number, y: number} | null>(null);
  const positionHistory1Ref = useRef<Array<{x: number, y: number}>>([]);
  const positionHistory2Ref = useRef<Array<{x: number, y: number}>>([]);
  
  // Canvas dimensions
  const canvasWidth = 1920;
  const canvasHeight = 1080;
  const markerSize = 200;
  const margin = 40;
  
  useEffect(() => {
    let stop = false;
    let cleanupCV: (() => void) | null = null;

    const run = async () => {
      try {
        setStatus('Loading OpenCV...');
        await loadOpenCV();
        
        const hasAruco = await ensureArucoAvailable();
        if (!hasAruco) {
          setStatus('ERROR: ArUco module not available');
          return;
        }
        
        const cv: any = (window as any).cv;
        
        // Setup videos
        if (videoRef1.current && stream1) {
          videoRef1.current.srcObject = stream1;
          await videoRef1.current.play().catch(() => {});
        }
        if (videoRef2.current && stream2) {
          videoRef2.current.srcObject = stream2;
          await videoRef2.current.play().catch(() => {});
        }
        
        // Setup whiteboard canvas
        const whiteboardCanvas = whiteboardCanvasRef.current!;
        const whiteboardCtx = whiteboardCanvas.getContext('2d')!;
        whiteboardCanvas.width = canvasWidth;
        whiteboardCanvas.height = canvasHeight;
        
        // Initialize whiteboard with white background
        whiteboardCtx.fillStyle = 'rgb(255, 255, 255)';
        whiteboardCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // Draw ArUco fiducials on whiteboard corners
        try {
          const dict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
          const fiducialPositions = [
            { id: 0, x: margin, y: margin },
            { id: 1, x: canvasWidth - margin - markerSize, y: margin },
            { id: 2, x: canvasWidth - margin - markerSize, y: canvasHeight - margin - markerSize },
            { id: 3, x: margin, y: canvasHeight - margin - markerSize }
          ];
          
          for (const pos of fiducialPositions) {
            const marker = new cv.Mat();
            cv.aruco.drawMarker(dict, pos.id, markerSize, marker, 1);
            const markerRGBA = new cv.Mat();
            cv.cvtColor(marker, markerRGBA, cv.COLOR_GRAY2RGBA);
            const imgData = matToImageData(markerRGBA);
            
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = markerSize;
            tmpCanvas.height = markerSize;
            const tmpCtx = tmpCanvas.getContext('2d')!;
            tmpCtx.putImageData(imgData, 0, 0);
            whiteboardCtx.drawImage(tmpCanvas, pos.x, pos.y);
            
            markerRGBA.delete();
            marker.delete();
          }
        } catch (e) {
          console.error('Failed to draw ArUco markers:', e);
        }
        
        // Create processing canvases for each camera
        const processCanvas1 = document.createElement('canvas');
        const processCanvas2 = document.createElement('canvas');
        processCanvas1.width = 1280;
        processCanvas1.height = 720;
        processCanvas2.width = 1280;
        processCanvas2.height = 720;
        const processCtx1 = processCanvas1.getContext('2d', { willReadFrequently: true })!;
        const processCtx2 = processCanvas2.getContext('2d', { willReadFrequently: true })!;
        
        // Mat allocations for camera 1
        const rgba1 = new cv.Mat(720, 1280, cv.CV_8UC4);
        const bgr1 = new cv.Mat(720, 1280, cv.CV_8UC3);
        const gray1 = new cv.Mat();
        const hsv1 = new cv.Mat();
        const mask1 = new cv.Mat();
        
        // Mat allocations for camera 2
        const rgba2 = new cv.Mat(720, 1280, cv.CV_8UC4);
        const bgr2 = new cv.Mat(720, 1280, cv.CV_8UC3);
        const gray2 = new cv.Mat();
        const hsv2 = new cv.Mat();
        const mask2 = new cv.Mat();
        
        const kernel = cv.Mat.ones(7, 7, cv.CV_8U);
        
        // ArUco detection setup
        const arucoDict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
        const detectorParams = new cv.aruco.DetectorParameters();
        
        // Green color range for HSV
        const lowerScalar = new cv.Scalar(40, 40, 0, 0);
        const upperScalar = new cv.Scalar(80, 255, 255, 255);
        
        const getDestMarkerCenters = (): Array<{x: number, y: number}> => {
          const offset = Math.floor(markerSize / 2);
          return [
            { x: margin + offset, y: margin + offset },
            { x: canvasWidth - margin - offset, y: margin + offset },
            { x: canvasWidth - margin - offset, y: canvasHeight - margin - offset },
            { x: margin + offset, y: canvasHeight - margin - offset }
          ];
        };
        
        const computeTransform = (srcPts: Array<{x: number, y: number}>) => {
          const dstPts = getDestMarkerCenters();
          const src = cv.matFromArray(4, 1, cv.CV_32FC2, srcPts.flatMap(p => [p.x, p.y]));
          const dst = cv.matFromArray(4, 1, cv.CV_32FC2, dstPts.flatMap(p => [p.x, p.y]));
          const M = cv.getPerspectiveTransform(src, dst);
          src.delete();
          dst.delete();
          return M;
        };
        
        const transformPoint = (M: any | null, p: {x: number, y: number}) => {
          if (!M) return null;
          const src = cv.matFromArray(1, 1, cv.CV_32FC2, [p.x, p.y]);
          const dst = new cv.Mat();
          cv.perspectiveTransform(src, dst, M);
          const out = { x: Math.round(dst.data32F[0]), y: Math.round(dst.data32F[1]) };
          src.delete();
          dst.delete();
          return out;
        };
        
        const smoothAppend = (history: Array<{x: number, y: number}>, p: {x: number, y: number} | null) => {
          if (!p) return { history: [], smoothed: null };
          const hist = history.slice();
          hist.push(p);
          if (hist.length > 5) hist.shift();
          const avgX = Math.round(hist.reduce((s, v) => s + v.x, 0) / hist.length);
          const avgY = Math.round(hist.reduce((s, v) => s + v.y, 0) / hist.length);
          return { history: hist, smoothed: { x: avgX, y: avgY } };
        };
        
        const detectFiducials = (grayMat: any): Array<{x: number, y: number}> | null => {
          const corners = new cv.MatVector();
          const ids = new cv.Mat();
          const rejected = new cv.MatVector();
          
          try {
            cv.aruco.detectMarkers(grayMat, arucoDict, corners, ids, detectorParams, rejected);
          } catch (e) {
            corners.delete();
            ids.delete();
            rejected.delete();
            return null;
          }
          
          if (ids.empty()) {
            corners.delete();
            ids.delete();
            rejected.delete();
            return null;
          }
          
          const centers: Array<{x: number, y: number}> = [];
          for (let i = 0; i < ids.rows; i++) {
            const id = ids.intAt(i, 0);
            if (id >= 0 && id <= 3) {
              const c = corners.get(i);
              const x = (c.doubleAt(0, 0) + c.doubleAt(0, 2) + c.doubleAt(0, 4) + c.doubleAt(0, 6)) / 4.0;
              const y = (c.doubleAt(0, 1) + c.doubleAt(0, 3) + c.doubleAt(0, 5) + c.doubleAt(0, 7)) / 4.0;
              centers[id] = { x: Math.round(x), y: Math.round(y) };
              c.delete();
            }
          }
          
          corners.delete();
          ids.delete();
          rejected.delete();
          
          // Check if all 4 markers detected
          if (centers.length === 4 && centers[0] && centers[1] && centers[2] && centers[3]) {
            return centers;
          }
          
          return null;
        };
        
        const detectGreen = (hsvMat: any, maskMat: any): {x: number, y: number} | null => {
          cv.inRange(hsvMat, lowerScalar, upperScalar, maskMat);
          cv.morphologyEx(maskMat, maskMat, cv.MORPH_OPEN, kernel);
          cv.morphologyEx(maskMat, maskMat, cv.MORPH_CLOSE, kernel);
          cv.erode(maskMat, maskMat, kernel);
          
          const contours = new cv.MatVector();
          const hierarchy = new cv.Mat();
          cv.findContours(maskMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          
          let greenPos: {x: number, y: number} | null = null;
          if (contours.size() > 0) {
            let largestIdx = -1;
            let largestArea = 0;
            for (let i = 0; i < contours.size(); i++) {
              const cnt = contours.get(i);
              const area = cv.contourArea(cnt);
              if (area > largestArea) {
                largestArea = area;
                largestIdx = i;
              }
              cnt.delete();
            }
            
            if (largestIdx >= 0 && largestArea >= 150) {
              const cnt = contours.get(largestIdx);
              const rect = cv.boundingRect(cnt);
              greenPos = { x: rect.x + Math.floor(rect.width / 2), y: rect.y + Math.floor(rect.height / 2) };
              cnt.delete();
            }
          }
          
          contours.delete();
          hierarchy.delete();
          return greenPos;
        };
        
        const processFrame = () => {
          if (stop) return;
          
          let needsCalibration = !transformMatrix1Ref.current || !transformMatrix2Ref.current;
          
          // Process Camera 1
          const v1 = videoRef1.current;
          if (v1 && v1.readyState >= 2 && stream1) {
            processCtx1.drawImage(v1, 0, 0, 1280, 720);
            const imageData1 = processCtx1.getImageData(0, 0, 1280, 720);
            rgba1.data.set(imageData1.data);
            cv.cvtColor(rgba1, bgr1, cv.COLOR_RGBA2BGR);
            
            // Try calibration if needed
            if (needsCalibration) {
              cv.cvtColor(bgr1, gray1, cv.COLOR_BGR2GRAY);
              const centers = detectFiducials(gray1);
              if (centers) {
                const M = computeTransform(centers);
                if (transformMatrix1Ref.current) transformMatrix1Ref.current.delete();
                transformMatrix1Ref.current = M;
              }
            }
            
            // Detect green
            cv.cvtColor(bgr1, hsv1, cv.COLOR_BGR2HSV);
            const greenPos1 = detectGreen(hsv1, mask1);
            
            if (greenPos1) {
              const result = smoothAppend(positionHistory1Ref.current, greenPos1);
              positionHistory1Ref.current = result.history;
              
              if (result.smoothed && transformMatrix1Ref.current) {
                const mapped = transformPoint(transformMatrix1Ref.current, result.smoothed);
                if (mapped) {
                  const clamped = {
                    x: Math.max(0, Math.min(canvasWidth - 1, mapped.x)),
                    y: Math.max(0, Math.min(canvasHeight - 1, mapped.y))
                  };
                  
                  // Draw line from last point
                  if (lastDrawPoint1Ref.current) {
                    whiteboardCtx.save();
                    whiteboardCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)'; // Blue for camera 1
                    whiteboardCtx.lineWidth = 5;
                    whiteboardCtx.lineCap = 'round';
                    whiteboardCtx.lineJoin = 'round';
                    whiteboardCtx.beginPath();
                    whiteboardCtx.moveTo(lastDrawPoint1Ref.current.x, lastDrawPoint1Ref.current.y);
                    whiteboardCtx.lineTo(clamped.x, clamped.y);
                    whiteboardCtx.stroke();
                    whiteboardCtx.restore();
                  }
                  lastDrawPoint1Ref.current = clamped;
                }
              }
            } else {
              positionHistory1Ref.current = [];
              lastDrawPoint1Ref.current = null;
            }
          }
          
          // Process Camera 2
          const v2 = videoRef2.current;
          if (v2 && v2.readyState >= 2 && stream2) {
            processCtx2.drawImage(v2, 0, 0, 1280, 720);
            const imageData2 = processCtx2.getImageData(0, 0, 1280, 720);
            rgba2.data.set(imageData2.data);
            cv.cvtColor(rgba2, bgr2, cv.COLOR_RGBA2BGR);
            
            // Try calibration if needed
            if (needsCalibration) {
              cv.cvtColor(bgr2, gray2, cv.COLOR_BGR2GRAY);
              const centers = detectFiducials(gray2);
              if (centers) {
                const M = computeTransform(centers);
                if (transformMatrix2Ref.current) transformMatrix2Ref.current.delete();
                transformMatrix2Ref.current = M;
              }
            }
            
            // Detect green
            cv.cvtColor(bgr2, hsv2, cv.COLOR_BGR2HSV);
            const greenPos2 = detectGreen(hsv2, mask2);
            
            if (greenPos2) {
              const result = smoothAppend(positionHistory2Ref.current, greenPos2);
              positionHistory2Ref.current = result.history;
              
              if (result.smoothed && transformMatrix2Ref.current) {
                const mapped = transformPoint(transformMatrix2Ref.current, result.smoothed);
                if (mapped) {
                  const clamped = {
                    x: Math.max(0, Math.min(canvasWidth - 1, mapped.x)),
                    y: Math.max(0, Math.min(canvasHeight - 1, mapped.y))
                  };
                  
                  // Draw line from last point
                  if (lastDrawPoint2Ref.current) {
                    whiteboardCtx.save();
                    whiteboardCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red for camera 2
                    whiteboardCtx.lineWidth = 5;
                    whiteboardCtx.lineCap = 'round';
                    whiteboardCtx.lineJoin = 'round';
                    whiteboardCtx.beginPath();
                    whiteboardCtx.moveTo(lastDrawPoint2Ref.current.x, lastDrawPoint2Ref.current.y);
                    whiteboardCtx.lineTo(clamped.x, clamped.y);
                    whiteboardCtx.stroke();
                    whiteboardCtx.restore();
                  }
                  lastDrawPoint2Ref.current = clamped;
                }
              }
            } else {
              positionHistory2Ref.current = [];
              lastDrawPoint2Ref.current = null;
            }
          }
          
          // Update calibration status
          const nowCalibrated = !!transformMatrix1Ref.current && !!transformMatrix2Ref.current;
          if (nowCalibrated !== isCalibrated) {
            setIsCalibrated(nowCalibrated);
            if (nowCalibrated) {
              setStatus('✅ Calibrated! Drawing enabled. Use green objects to draw.');
            } else {
              setStatus('📷 Point both cameras at the whiteboard to calibrate...');
            }
          }
          
          requestAnimationFrame(processFrame);
        };
        
        setStatus('📷 Point both cameras at the whiteboard to calibrate...');
        processFrame();
        
        cleanupCV = () => {
          rgba1.delete(); bgr1.delete(); gray1.delete(); hsv1.delete(); mask1.delete();
          rgba2.delete(); bgr2.delete(); gray2.delete(); hsv2.delete(); mask2.delete();
          kernel.delete();
          if (transformMatrix1Ref.current) {
            try { transformMatrix1Ref.current.delete(); } catch {}
            transformMatrix1Ref.current = null;
          }
          if (transformMatrix2Ref.current) {
            try { transformMatrix2Ref.current.delete(); } catch {}
            transformMatrix2Ref.current = null;
          }
        };
      } catch (e) {
        console.error('WhiteboardDisplay error:', e);
        setStatus('❌ Failed to initialize. Please refresh.');
      }
    };
    
    run();
    
    return () => {
      stop = true;
      if (cleanupCV) cleanupCV();
      try {
        videoRef1.current?.pause();
        videoRef2.current?.pause();
      } catch {}
    };
  }, [stream1, stream2]);
  
  const handleClear = () => {
    if (!whiteboardCanvasRef.current) return;
    const ctx = whiteboardCanvasRef.current.getContext('2d')!;
    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Redraw fiducials
    const cv: any = (window as any).cv;
    if (cv && cv.aruco) {
      try {
        const dict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
        const fiducialPositions = [
          { id: 0, x: margin, y: margin },
          { id: 1, x: canvasWidth - margin - markerSize, y: margin },
          { id: 2, x: canvasWidth - margin - markerSize, y: canvasHeight - margin - markerSize },
          { id: 3, x: margin, y: canvasHeight - margin - markerSize }
        ];
        
        for (const pos of fiducialPositions) {
          const marker = new cv.Mat();
          cv.aruco.drawMarker(dict, pos.id, markerSize, marker, 1);
          const markerRGBA = new cv.Mat();
          cv.cvtColor(marker, markerRGBA, cv.COLOR_GRAY2RGBA);
          const imgData = matToImageData(markerRGBA);
          
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = markerSize;
          tmpCanvas.height = markerSize;
          const tmpCtx = tmpCanvas.getContext('2d')!;
          tmpCtx.putImageData(imgData, 0, 0);
          ctx.drawImage(tmpCanvas, pos.x, pos.y);
          
          markerRGBA.delete();
          marker.delete();
        }
      } catch (e) {
        console.error('Failed to redraw markers:', e);
      }
    }
    
    lastDrawPoint1Ref.current = null;
    lastDrawPoint2Ref.current = null;
  };
  
  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      {/* Hidden video elements for processing */}
      <video ref={videoRef1} muted playsInline className="hidden" />
      <video ref={videoRef2} muted playsInline className="hidden" />
      
      {/* Status bar */}
      <div className="bg-gray-800 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold">Magic Whiteboard</h2>
          <div className={`px-3 py-1 rounded text-sm font-semibold ${isCalibrated ? 'bg-green-600' : 'bg-yellow-600'}`}>
            {isCalibrated ? '✓ Calibrated' : '○ Calibrating...'}
          </div>
          <span className="text-sm text-gray-300">{status}</span>
        </div>
        <button
          onClick={handleClear}
          className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded transition-colors"
        >
          Clear Board
        </button>
      </div>
      
      {/* Whiteboard canvas */}
      <div className="flex-1 flex items-center justify-center bg-gray-900 p-4">
        <canvas
          ref={whiteboardCanvasRef}
          className="max-w-full max-h-full shadow-2xl"
          style={{ aspectRatio: `${canvasWidth}/${canvasHeight}` }}
        />
      </div>
      
      {/* Instructions */}
      <div className="bg-gray-800 text-gray-300 px-6 py-2 text-sm text-center">
        Point both cameras at the whiteboard to calibrate. Use green objects to draw. Camera 1 = Blue, Camera 2 = Red
      </div>
    </div>
  );
};

export default WhiteboardDisplay;
