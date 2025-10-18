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