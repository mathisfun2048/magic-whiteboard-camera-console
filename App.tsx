import React, { useState, useEffect, useRef } from 'react';
import type { Peer } from 'peerjs';
import StreamDisplay from './components/CameraView';
import type { ConnectionStatus } from './types';

// --- Caster (Phone) Component ---
const CasterView: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [peerId, setPeerId] = useState<string | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const peer = new window.Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('Caster PeerJS ID:', id);
      setPeerId(id);
      setStatus('idle');
      getStream(facingMode);
    });

    peer.on('call', call => {
      setStatus('streaming');
      console.log('Receiving call, answering with stream');
      if (localStream) {
        call.answer(localStream);
      }
      call.on('close', () => {
        setStatus('idle');
      });
      call.on('error', (err) => {
        setError(`Call error: ${err.message}`);
        setStatus('error');
      });
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
  }, [localStream]); // Re-attach listener if stream changes

  const getStream = async (mode: 'user' | 'environment') => {
    try {
      localStream?.getTracks().forEach(track => track.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: mode } },
        audio: false,
      });
      setLocalStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('getUserMedia error:', err);
      // Try again without exact
       try {
         const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: mode },
            audio: false,
         });
         setLocalStream(stream);
         if (videoRef.current) {
           videoRef.current.srcObject = stream;
         }
       } catch (e) {
          setError('Could not access camera. Please check permissions.');
          setStatus('error');
       }
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
      case 'connecting': return 'Initializing Peer...';
      case 'streaming': return 'Streaming';
      case 'idle': return 'Waiting for console to connect...';
      default: return 'Starting...';
    }
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white">
      <video ref={videoRef} muted autoPlay playsInline className="w-full h-full object-cover"></video>
      <div className="absolute top-0 left-0 right-0 p-4 bg-black bg-opacity-60 text-center space-y-2">
         <p className={`text-lg font-bold ${status === 'streaming' ? 'text-green-400' : 'text-yellow-400'}`}>
          {getStatusMessage()}
        </p>
        {peerId && status === 'idle' && (
          <div className="bg-gray-800 p-2 rounded-lg">
            <p className="text-sm text-gray-300">Your Camera ID:</p>
            <p className="text-lg font-mono tracking-wider break-all">{peerId}</p>
          </div>
        )}
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
  const [remotePeerId, setRemotePeerId] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Use a unique prefix to avoid ID collisions if both console pages are open
    const p = new window.Peer(`magic-whiteboard-console-${label.replace(/\s+/g, '')}-${Math.random().toString(36).substr(2, 9)}`);
    setPeer(p);

    p.on('open', id => setPeerId(id));
    
    p.on('error', err => {
      console.error(`PeerJS error for ${label}:`, err);
      setError('Connection failed. Check the ID and network.');
      setStatus('error');
    });

    return () => p.destroy();
  }, [label]);

  const handleConnect = () => {
    if (!peer || !remotePeerId.trim()) {
      setError('Please enter a valid camera ID.');
      return;
    }
    setError(null);
    setStatus('connecting');
    // Call the caster. We don't send a stream, we expect one back.
    const call = peer.call(remotePeerId.trim(), new MediaStream());

    call.on('stream', remoteStream => {
      setStream(remoteStream);
      setStatus('streaming');
    });

    call.on('close', () => {
      setStream(null);
      setStatus('idle');
    });

    call.on('error', err => {
      console.error('Call error:', err);
      setError('Failed to connect to camera. Please check the ID.');
      setStatus('error');
      // Reset after a moment
      setTimeout(() => {
        setStatus('idle');
        setError(null);
      }, 3000);
    });
  };

  if (status === 'streaming' && stream) {
    return <StreamDisplay stream={stream} label={label} />;
  }

  return (
    <StreamDisplay stream={null} label={label}>
      <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center text-center p-4 backdrop-blur-sm space-y-4">
        <h4 className="text-lg font-semibold text-white">Connect a Camera</h4>
        <div className="w-full max-w-xs">
          <label htmlFor={`remote-id-${label}`} className="sr-only">Enter Camera ID</label>
          <input
            type="text"
            id={`remote-id-${label}`}
            value={remotePeerId}
            onChange={e => setRemotePeerId(e.target.value)}
            placeholder="Enter Camera ID here"
            className="w-full bg-gray-700 border border-gray-600 text-white text-center rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={status === 'connecting'}
          />
        </div>
        <button
          onClick={handleConnect}
          disabled={status === 'connecting' || !remotePeerId}
          className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-wait transition-all"
        >
          {status === 'connecting' ? 'Connecting...' : 'Connect'}
        </button>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        {peerId && (
            <p className="mt-4 text-xs text-gray-500 break-all px-2">
                Console ID: {peerId}
            </p>
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


// --- Landing Page Component ---
const LandingView: React.FC<{ onSelectMode: (mode: 'console' | 'caster') => void }> = ({ onSelectMode }) => {
  return (
    <div className="text-center p-8 bg-gray-800 rounded-xl shadow-2xl max-w-2xl mx-auto">
      <h2 className="text-3xl font-bold mb-4 text-white">Choose Your Role</h2>
      <p className="text-gray-400 mb-8">
        Set up one device as the Console (your computer) and another as the Camera (your phone).
      </p>

      <div className="flex flex-col md:flex-row gap-6 justify-center">
        <button
          onClick={() => onSelectMode('console')}
          className="px-8 py-4 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 transition-transform transform hover:scale-105 text-lg"
        >
          Start Console
          <span className="block text-sm font-normal text-indigo-200">(On this Computer)</span>
        </button>
        <button
          onClick={() => onSelectMode('caster')}
          className="px-8 py-4 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-green-500 transition-transform transform hover:scale-105 text-lg"
        >
          Start Camera
          <span className="block text-sm font-normal text-green-200">(On Your Phone)</span>
        </button>
      </div>
       <div className="text-left bg-gray-900 p-4 rounded-lg space-y-3 mt-8 border border-gray-700">
          <p><span className="font-bold text-indigo-400">Step 1:</span> Open this webpage on both your computer and your phone.</p>
          <p><span className="font-bold text-indigo-400">Step 2:</span> Click "Start Console" on your computer.</p>
          <p><span className="font-bold text-indigo-400">Step 3:</span> Click "Start Camera" on your phone. It will show a Camera ID.</p>
          <p><span className="font-bold text-indigo-400">Step 4:</span> Type the phone's Camera ID into an input box on the computer and click "Connect".</p>
      </div>
    </div>
  );
};

// --- Main App Component (Router) ---
const App: React.FC = () => {
  const [mode, setMode] = useState<'landing' | 'console' | 'caster'>('landing');

  const renderContent = () => {
    switch(mode) {
      case 'console':
        return <ConsoleView />;
      case 'caster':
        return <CasterView />;
      case 'landing':
      default:
        return <LandingView onSelectMode={setMode} />;
    }
  };
  
  const isCasterMode = mode === 'caster';

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4 md:p-8 font-sans">
      {!isCasterMode && (
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
