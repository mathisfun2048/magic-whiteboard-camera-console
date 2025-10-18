import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Peer } from 'peerjs';
import StreamDisplay from './components/CameraView';
import type { ConnectionStatus } from './types';

// --- QR Code Component ---
const QRCodeDisplay: React.FC<{ value: string }> = ({ value }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isQrLibLoaded, setIsQrLibLoaded] = useState(typeof window.QRCode !== 'undefined');

  // Effect to check for the QR code library loading
  useEffect(() => {
    if (isQrLibLoaded) {
      return;
    }

    const interval = setInterval(() => {
      if (typeof window.QRCode !== 'undefined') {
        setIsQrLibLoaded(true);
        clearInterval(interval);
      }
    }, 100);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, [isQrLibLoaded]);

  // Effect to generate the QR code once the library and value are ready
  useEffect(() => {
    if (canvasRef.current && value && isQrLibLoaded) {
      window.QRCode.toCanvas(canvasRef.current, value, { width: 256, margin: 1 }, (error) => {
        if (error) console.error("QRCode generation failed:", error);
      });
    }
  }, [value, isQrLibLoaded]);

  // Render a placeholder while the library is loading
  if (!isQrLibLoaded) {
    return (
      <div 
        className="w-[256px] h-[256px] bg-gray-700 flex items-center justify-center rounded-lg animate-pulse"
        aria-label="Loading QR Code"
      >
        <p className="text-white text-sm">Loading QR Code...</p>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="rounded-lg w-[256px] h-[256px]" />;
};


// --- Caster (Phone) Component ---
const CasterView: React.FC<{ consoleId: string | null }> = ({ consoleId }) => {
  const [status, setStatus] = useState<ConnectionStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const peerRef = useRef<Peer | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!consoleId) {
      setError("Invalid URL. Please scan a QR code from the console.");
      setStatus('error');
      return;
    }

    const peer = new window.Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      console.log('Caster PeerJS opened');
      getStream(facingMode); // Trigger camera access
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setError('Connection error. Please refresh and try again.');
      setStatus('error');
    });

    return () => {
      peer.destroy();
      localStream?.getTracks().forEach(track => track.stop());
    };
  }, [consoleId]); // Only run on mount

  useEffect(() => {
    if (localStream && peerRef.current?.open && consoleId) {
        setStatus('connecting');
        console.log(`Calling console: ${consoleId}`);
        const call = peerRef.current.call(consoleId, localStream);

        call.on('stream', () => { // The console should not stream back, but we handle it.
            // This is unexpected, but we can log it.
            console.log('Received stream from console unexpectedly.');
        });
        
        call.on('close', () => {
            setStatus('waiting');
            setError('Connection closed by console.');
        });
        
        call.on('error', (err) => {
            console.error('Call error:', err);
            setError(`Call failed: ${err.message}`);
            setStatus('error');
        });

        // We can assume streaming once the call is made
        setStatus('streaming');
    }
  }, [localStream, consoleId]); // Run when stream is ready


  const getStream = async (mode: 'user' | 'environment') => {
    try {
      // Stop previous stream before getting a new one
      localStream?.getTracks().forEach(track => track.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });
      setLocalStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('getUserMedia error:', err);
      setError('Could not access camera. Please check permissions and refresh.');
      setStatus('error');
    }
  };

  const switchCamera = () => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    getStream(newMode);
  };

  const getStatusMessage = () => {
    if (error) return `Error: ${error}`;
    switch (status) {
      case 'initializing': return 'Initializing Camera...';
      case 'connecting': return 'Connecting to Console...';
      case 'streaming': return 'Streaming';
      case 'waiting': return 'Disconnected. Waiting for console.';
      default: return 'Starting...';
    }
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white">
      <video ref={videoRef} muted autoPlay playsInline className="w-full h-full object-cover"></video>
      <div className="absolute top-0 left-0 right-0 p-4 bg-black bg-opacity-60 text-center">
         <p className={`text-lg font-bold ${status === 'streaming' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
          {getStatusMessage()}
        </p>
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-center">
        <button
          onClick={switchCamera}
          className="p-4 bg-gray-700 bg-opacity-70 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Switch Camera"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 20h5v-5M20 4h-5v5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-4-4-4 4M9 5l4 4 4-4" />
          </svg>
        </button>
      </div>
    </div>
  );
};

// --- Console Connection Manager Component ---
const ConnectionManager: React.FC<{ label: string }> = ({ label }) => {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('initializing');
  const [error, setError] = useState<string | null>(null);

  const connectionUrl = useMemo(() => {
    if (!peerId) return null;
    const url = new URL(window.location.href);
    url.search = `?caster=true&consoleId=${peerId}`;
    return url.toString();
  }, [peerId]);

  useEffect(() => {
    const p = new window.Peer();
    setPeer(p);
    setStatus('initializing');

    p.on('open', id => {
      setPeerId(id);
      setStatus('waiting');
    });

    p.on('call', call => {
      setStatus('connecting');
      console.log(`Incoming call from ${call.peer}`);
      // Answer the call, sending no stream of our own.
      call.answer(); 
      call.on('stream', remoteStream => {
        setStream(remoteStream);
        setStatus('streaming');
      });
      call.on('close', () => {
        setStream(null);
        setStatus('waiting');
      });
      call.on('error', err => {
        console.error('Call error:', err);
        setError('Connection with camera failed.');
        setStatus('error');
      });
    });
    
    p.on('error', err => {
      console.error(`PeerJS error for ${label}:`, err);
      setError('A connection error occurred. Try refreshing.');
      setStatus('error');
    });

    return () => p.destroy();
  }, [label]);


  if (status === 'streaming' && stream) {
    return <StreamDisplay stream={stream} label={label} />;
  }

  return (
    <StreamDisplay stream={null} label={label}>
      <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center text-center p-4 backdrop-blur-sm space-y-4">
        {status === 'waiting' && connectionUrl ? (
          <>
            <h4 className="text-lg font-semibold text-white">Scan to Connect Camera</h4>
            <div className="p-2 bg-white rounded-lg shadow-2xl">
              <QRCodeDisplay value={connectionUrl} />
            </div>
            <p className="text-sm text-gray-400 max-w-xs">Open your phone's camera and point it here to connect.</p>
          </>
        ) : status === 'initializing' ? (
          <p className="text-lg font-semibold text-white">Initializing...</p>
        ) : status === 'connecting' ? (
          <p className="text-lg font-semibold text-white">Camera is connecting...</p>
        ) : (
          <p className="text-lg font-semibold text-red-400">{error || "An unknown error occurred."}</p>
        )}
      </div>
    </StreamDisplay>
  );
};

// --- Console (Laptop) Component ---
const ConsoleView: React.FC = () => {
  return (
     <div className="w-full max-w-7xl flex flex-col items-center">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full px-4 md:px-0">
          <ConnectionManager label="Camera 1 (Left)" />
          <ConnectionManager label="Camera 2 (Right)" />
        </div>
     </div>
  );
};

// --- Main App Component (Router) ---
const App: React.FC = () => {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isCaster = urlParams.get('caster') === 'true';
  const consoleId = urlParams.get('consoleId');

  const renderContent = () => {
    if (isCaster) {
      return <CasterView consoleId={consoleId} />;
    }
    return <ConsoleView />;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4 md:p-8 font-sans">
      {!isCaster && (
        <header className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white">
              Magic Whiteboard <span className="text-indigo-400">Camera Console</span>
            </h1>
            <p className="mt-2 text-lg text-gray-400">Dual camera P2P streaming for computer vision projects.</p>
        </header>
      )}
      <main className="w-full flex-grow flex flex-col items-center justify-center">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;