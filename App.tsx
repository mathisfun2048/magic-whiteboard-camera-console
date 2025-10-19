import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Peer } from 'peerjs';
import StreamDisplay from './components/CameraView';
import WhiteboardCV from './components/WhiteboardCV';
import WhiteboardDisplay from './components/WhiteboardDisplay';
import type { ConnectionStatus } from './types';

// --- QR Code Component ---
const QRCodeDisplay: React.FC<{ value: string }> = ({ value }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isQrLibLoaded, setIsQrLibLoaded] = useState(typeof window.QRCode !== 'undefined');
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  useEffect(() => {
    if (isQrLibLoaded) return;
    const timeoutId = setTimeout(() => {
      if (typeof window.QRCode === 'undefined') setLoadTimedOut(true);
    }, 5000);
    const intervalId = setInterval(() => {
      if (typeof window.QRCode !== 'undefined') {
        setIsQrLibLoaded(true);
        clearInterval(intervalId);
        clearTimeout(timeoutId);
      }
    }, 100);
    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [isQrLibLoaded]);

  useEffect(() => {
    if (canvasRef.current && value && isQrLibLoaded) {
      window.QRCode.toCanvas(canvasRef.current, value, { width: 192, margin: 1 }, (error) => {
        if (error) console.error("QRCode generation failed:", error);
      });
    }
  }, [value, isQrLibLoaded]);

  if (loadTimedOut) {
    return (
      <div className="w-48 h-48 bg-red-900/50 border border-red-700 flex flex-col items-center justify-center rounded-lg p-4 text-center">
        <p className="font-semibold text-red-300">QR Code Failed</p>
        <p className="text-xs text-red-400 mt-2">Check network and ad-blockers, then refresh.</p>
      </div>
    );
  }

  if (!isQrLibLoaded) {
    return <div className="w-48 h-48 bg-gray-700 rounded-lg animate-pulse" aria-label="Loading QR Code"></div>;
  }

  return <canvas ref={canvasRef} className="rounded-lg w-48 h-48" />;
};


// --- Caster (Phone) Component ---
const CasterView: React.FC<{ initialConsoleId: string | null }> = ({ initialConsoleId }) => {
  const [consoleId, setConsoleId] = useState<string | null>(initialConsoleId);
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const peerRef = useRef<Peer | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!consoleId) {
      setStatus('waiting'); // Ready to get user input
      return;
    }

    const peer = new window.Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      console.log('Caster PeerJS opened');
      getStream(facingMode);
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
  }, [consoleId]);

  useEffect(() => {
    if (localStream && peerRef.current?.open && consoleId) {
        setStatus('connecting');
        const call = peerRef.current.call(consoleId, localStream);
        if (!call) {
            setError('Could not connect to the console. Check the code.');
            setStatus('error');
            return;
        }
        call.on('stream', () => console.log('Received stream from console unexpectedly.'));
        call.on('close', () => { setStatus('waiting'); setError('Connection closed by console.'); });
        call.on('error', (err) => { console.error('Call error:', err); setError(`Call failed: ${err.message}`); setStatus('error'); });
        setStatus('streaming');
    }
  }, [localStream]);

  const getStream = async (mode: 'user' | 'environment') => {
    try {
      localStream?.getTracks().forEach(track => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode } }, audio: false });
      setLocalStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
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

  const handleConnect = () => {
    if (inputValue.trim()) {
      setConsoleId(inputValue.trim().toLowerCase());
    }
  };

  if (!consoleId) {
    return (
      <div className="w-full max-w-md mx-auto text-center">
        <h2 className="text-3xl font-bold text-white mb-4">Connect to Console</h2>
        <p className="text-gray-400 mb-6">Enter the connection code displayed on the console screen.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
            placeholder="e.g. calm-star-78"
            className="flex-grow bg-gray-800 border border-gray-600 text-white text-lg rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
            autoCapitalize="none"
          />
          <button onClick={handleConnect} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg transition-colors duration-300">
            Connect
          </button>
        </div>
      </div>
    );
  }

  const getStatusMessage = () => {
    if (error) return `Error: ${error}`;
    switch (status) {
      case 'initializing': return 'Initializing Camera...';
      case 'connecting': return `Connecting to ${consoleId}...`;
      case 'streaming': return `Streaming to ${consoleId}`;
      case 'waiting': return 'Disconnected.';
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
        <button onClick={switchCamera} className="p-4 bg-gray-700 bg-opacity-70 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-white" aria-label="Switch Camera">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 16 16">
            <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
            <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.5A5.002 5.002 0 0 0 8 3zM3.5 12A5.002 5.002 0 0 0 8 13c1.552 0 2.94-.707-3.857-1.818a.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.5A5.002 5.002 0 0 0 8 13z"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

// --- Words for memorable ID generation ---
const ADJECTIVES = ['agile', 'bright', 'calm', 'desert', 'eager', 'fancy', 'giant', 'happy', 'icy', 'jolly', 'keen', 'lucky', 'magic', 'noble', 'ocean', 'proud', 'quick', 'regal', 'shiny', 'tidal', 'urban', 'vast', 'wild', 'young', 'zesty'];
const NOUNS = ['river', 'stone', 'star', 'comet', 'forest', 'planet', 'ocean', 'desert', 'meadow', 'island', 'volcano', 'glacier', 'canyon', 'valley', 'plateau', 'geyser', 'nebula', 'galaxy', 'quasar', 'cluster', 'lagoon', 'summit', 'delta', 'fjord', 'reef'];

const generateReadableId = () => {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 90) + 10;
    return `${adj}-${noun}-${num}`;
}

// --- Console Connection Manager Component ---
const ConnectionManager: React.FC<{ 
  label: string, 
  enableCV?: boolean,
  onStreamChange?: (stream: MediaStream | null) => void
}> = ({ label, enableCV = false, onStreamChange }) => {
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
    const initializePeer = () => {
        const id = generateReadableId();
        const p = new window.Peer(id);
        
        p.on('open', openId => {
          setPeerId(openId);
          setStatus('waiting');
          setError(null);
        });
        
        p.on('call', call => {
            setStatus('connecting');
            call.answer(); 
            call.on('stream', remoteStream => { 
              setStream(remoteStream); 
              setStatus('streaming');
              if (onStreamChange) onStreamChange(remoteStream);
            });
            call.on('close', () => { 
              setStream(null); 
              setStatus('waiting');
              if (onStreamChange) onStreamChange(null);
            });
            call.on('error', err => { 
              console.error('Call error:', err); 
              setError('Connection with camera failed.'); 
              setStatus('error');
              if (onStreamChange) onStreamChange(null);
            });
        });

        p.on('error', err => {
            if (err.type === 'unavailable-id') {
                console.warn(`Peer ID ${id} is unavailable. Retrying...`);
                p.destroy();
                setTimeout(initializePeer, 100); // Retry after a short delay
            } else {
                console.error(`PeerJS error for ${label}:`, err);
                setError('A connection error occurred. Try refreshing.');
                setStatus('error');
            }
        });

        setPeer(p);
    };

    initializePeer();
    return () => peer?.destroy();
  }, [label]);


  if (status === 'streaming' && stream) {
    if (enableCV) {
      return <WhiteboardCV stream={stream} label={label} />;
    }
    return <StreamDisplay stream={stream} label={label} />;
  }

  return (
    <StreamDisplay stream={null} label={label}>
      <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center text-center p-4 backdrop-blur-sm space-y-4">
        {status === 'waiting' && peerId && connectionUrl ? (
          <>
            <h4 className="text-lg font-semibold text-white">Enter code on phone:</h4>
            <p className="font-mono tracking-widest text-3xl md:text-4xl text-indigo-300 bg-gray-900/50 px-4 py-2 rounded-lg">{peerId}</p>
            <p className="text-sm text-gray-400">or scan</p>
            <div className="p-2 bg-white rounded-lg shadow-2xl">
              <QRCodeDisplay value={connectionUrl} />
            </div>
          </>
        ) : status === 'initializing' ? (
          <p className="text-lg font-semibold text-white">Generating Code...</p>
        ) : status === 'connecting' ? (
          <p className="text-lg font-semibold text-white">Camera connecting...</p>
        ) : (
          <p className="text-lg font-semibold text-red-400">{error || "An unknown error occurred."}</p>
        )}
      </div>
    </StreamDisplay>
  );
};

// --- Console (Laptop) Component ---
const ConsoleView: React.FC = () => {
  const [stream1, setStream1] = useState<MediaStream | null>(null);
  const [stream2, setStream2] = useState<MediaStream | null>(null);
  
  // Show whiteboard when both cameras are connected
  const showWhiteboard = stream1 !== null && stream2 !== null;
  
  if (showWhiteboard) {
    return <WhiteboardDisplay stream1={stream1} stream2={stream2} />;
  }
  
  return (
     <div className="w-full max-w-7xl flex flex-col items-center">
        <header className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white">
              Magic Whiteboard <span className="text-indigo-400">Camera Console</span>
            </h1>
            <p className="mt-2 text-lg text-gray-400">Dual camera P2P streaming for computer vision projects.</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full px-4 md:px-0">
          <ConnectionManager label="Camera 1 (Left)" onStreamChange={setStream1} />
          <ConnectionManager label="Camera 2 (Right)" onStreamChange={setStream2} />
        </div>
     </div>
  );
};

// --- Landing Page Component ---
const LandingPage: React.FC<{ onSelectRole: (role: 'console' | 'caster') => void }> = ({ onSelectRole }) => {
    return (
        <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white">
              Magic Whiteboard <span className="text-indigo-400">Camera Console</span>
            </h1>
            <p className="mt-2 text-lg text-gray-400 mb-12">Dual camera P2P streaming for computer vision projects.</p>
            <div className="flex flex-col md:flex-row gap-4 justify-center">
                <button
                    onClick={() => onSelectRole('console')}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-8 rounded-lg text-xl transition-transform transform hover:scale-105"
                >
                    🖥️ Setup Console Display
                </button>
                <button
                    onClick={() => onSelectRole('caster')}
                    className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-lg text-xl transition-transform transform hover:scale-105"
                >
                    📱 Connect Phone Camera
                </button>
            </div>
        </div>
    );
};

// --- Main App Component (Router) ---
const App: React.FC = () => {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isCasterFromUrl = urlParams.get('caster') === 'true';
  const consoleIdFromUrl = urlParams.get('consoleId');

  const initialMode = isCasterFromUrl ? 'caster' : 'landing';
  const [mode, setMode] = useState<'landing' | 'console' | 'caster'>(initialMode);

  const renderContent = () => {
    if (mode === 'caster') {
      return <CasterView initialConsoleId={consoleIdFromUrl} />;
    }
    if (mode === 'console') {
      return <ConsoleView />;
    }
    return <LandingPage onSelectRole={setMode} />;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4 md:p-8 font-sans">
      <main className="w-full flex-grow flex flex-col items-center justify-center">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
