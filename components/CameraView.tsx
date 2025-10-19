/*

import React, { useRef, useEffect } from 'react';

interface StreamDisplayProps {
  stream: MediaStream | null;
  label: string;
  children?: React.ReactNode; // For overlays
}

const StreamDisplay: React.FC<StreamDisplayProps> = ({ stream, label, children }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(err => console.error("Video play failed:", err));
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg w-full aspect-video flex flex-col">
      <h3 className="bg-gray-700 text-white font-bold text-center py-2 px-4 select-none">{label}</h3>
      <div className="relative flex-grow w-full bg-black">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {!stream && children}
      </div>
    </div>
  );
};

export default StreamDisplay;
*/

import React, { useRef, useEffect } from 'react';

interface StreamDisplayProps {
  stream: MediaStream | null;
  label: string;
  children?: React.ReactNode;
}

const StreamDisplay: React.FC<StreamDisplayProps> = ({ stream, label, children }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Setup video stream
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(err => console.error("Video play failed:", err));
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  // Setup WebSocket and frame streaming
  useEffect(() => {
    // Connect to Python
    const ws = new WebSocket('ws://localhost:8765');
    wsRef.current = ws;
    ws.onopen = () => console.log('✅ Connected to Python');
    ws.onerror = (e) => console.error('WebSocket error:', e);
    
    const video = videoRef.current;
    if (!video) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    let animationId: number;
    
    const sendFrame = () => {
      if (ws.readyState === WebSocket.OPEN && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        
        canvas.toBlob(blob => {
          blob?.arrayBuffer().then(buffer => ws.send(buffer));
        }, 'image/jpeg', 0.8);
      }
      animationId = requestAnimationFrame(sendFrame);
    };
    
    video.addEventListener('loadedmetadata', sendFrame);
    
    return () => {
      cancelAnimationFrame(animationId);
      video.removeEventListener('loadedmetadata', sendFrame);
      ws.close();
    };
  }, []);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg w-full aspect-video flex flex-col">
      <h3 className="bg-gray-700 text-white font-bold text-center py-2 px-4 select-none">{label}</h3>
      <div className="relative flex-grow w-full bg-black">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {!stream && children}
      </div>
    </div>
  );
};

export default StreamDisplay;