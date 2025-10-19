// Lightweight loader for OpenCV.js. Ensures window.cv is initialized before use.
let cvLoadPromise: Promise<void> | null = null;

export function loadOpenCV(src: string = 'https://docs.opencv.org/4.x/opencv.js'): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).cv && (window as any).cv['ready']) {
    return Promise.resolve();
  }

  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise<void>((resolve, reject) => {
    try {
      const existing = document.querySelector('script[data-opencv]') as HTMLScriptElement | null;
      if (existing) {
        const waitForReady = () => {
          const cv: any = (window as any).cv;
          if (cv && (cv['onRuntimeInitialized'] || cv['ready'])) {
            if (!cv['ready']) {
              cv.onRuntimeInitialized = () => {
                cv['ready'] = true;
                resolve();
              };
            } else {
              resolve();
            }
          } else {
            setTimeout(waitForReady, 50);
          }
        };
        waitForReady();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-opencv', 'true');
      script.onload = () => {
        const cv: any = (window as any).cv;
        if (!cv) {
          reject(new Error('OpenCV.js loaded but window.cv is undefined'));
          return;
        }
        if (cv['ready']) {
          resolve();
          return;
        }
        cv.onRuntimeInitialized = () => {
          cv['ready'] = true;
          resolve();
        };
      };
      script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
      document.head.appendChild(script);
    } catch (err) {
      reject(err as Error);
    }
  });

  return cvLoadPromise;
}

export async function ensureArucoAvailable(): Promise<boolean> {
  await loadOpenCV();
  const cv: any = (window as any).cv;
  return !!(cv && cv.aruco);
}
