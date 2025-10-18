import type Peer from 'peerjs';

// This lets us use `window.Peer` without TypeScript errors.
declare global {
  interface Window {
    Peer: typeof Peer;
    QRCode: {
      toCanvas(
        canvas: HTMLCanvasElement,
        text: string,
        options: object,
        callback: (error: any) => void
      ): void;
    };
  }
}

export type ConnectionStatus = 'initializing' | 'waiting' | 'connecting' | 'streaming' | 'error';