
import { useState, useCallback } from 'react';

export const useCameras = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const initializeCameras = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      setError("Media devices API not supported on this browser.");
      return false;
    }

    try {
      // Temporarily get a stream to trigger the permission prompt.
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Stop the tracks immediately as we only needed to trigger the permission dialog.
      stream.getTracks().forEach(track => track.stop());

      // Now enumerate devices to get the full list with labels.
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
      
      if (videoDevices.length === 0) {
        setError("No video input devices found.");
        setDevices([]);
        return true; // Not a failure, but no devices.
      }

      setDevices(videoDevices);
      setError(null);
      return true;
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError("Camera permission was denied. Please allow camera access in your browser settings and refresh the page.");
        } else {
          setError(`An error occurred while accessing cameras: ${err.message}`);
        }
      } else {
        setError("An unknown error occurred while accessing cameras.");
      }
      return false;
    }
  }, []);

  return { devices, error, initializeCameras };
};
