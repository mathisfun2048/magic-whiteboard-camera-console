import type Peer from 'peerjs';

// This lets us use `window.Peer` without TypeScript errors.
declare global {
  interface Window {
    Peer: typeof Peer;
  }
}

export type ConnectionStatus = 'idle' | 'connecting' | 'streaming' | 'error';
