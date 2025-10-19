// Optimized loader for OpenCV.js with lazy loading support
let cvLoadPromise: Promise<void> | null = null;
let isOpenCVLoading = false;

export function loadOpenCV(src: string = 'https://docs.opencv.org/4.x/opencv.js'): Promise<void> {
  // Quick check if already loaded
  if (typeof window !== 'undefined' && (window as any).cv?.ready) {
    return Promise.resolve();
  }

  // Return existing promise if already loading
  if (cvLoadPromise) return cvLoadPromise;

  // Prevent duplicate loading attempts
  if (isOpenCVLoading) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if ((window as any).cv?.ready) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  isOpenCVLoading = true;
  
  cvLoadPromise = new Promise<void>((resolve, reject) => {
    try {
      // Check if script already exists
      const existing = document.querySelector('script[data-opencv]') as HTMLScriptElement | null;
      if (existing) {
        const waitForReady = () => {
          const cv: any = (window as any).cv;
          if (cv && (cv['onRuntimeInitialized'] || cv['ready'])) {
            if (!cv['ready']) {
              cv.onRuntimeInitialized = () => {
                cv['ready'] = true;
                isOpenCVLoading = false;
                resolve();
              };
            } else {
              isOpenCVLoading = false;
              resolve();
            }
          } else {
            setTimeout(waitForReady, 50);
          }
        };
        waitForReady();
        return;
      }

      // Lazy load OpenCV.js only when needed
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-opencv', 'true');
      
      // Add loading timeout
      const loadTimeout = setTimeout(() => {
        isOpenCVLoading = false;
        reject(new Error('OpenCV.js loading timeout'));
      }, 30000); // 30 second timeout
      
      script.onload = () => {
        clearTimeout(loadTimeout);
        const cv: any = (window as any).cv;
        if (!cv) {
          isOpenCVLoading = false;
          reject(new Error('OpenCV.js loaded but window.cv is undefined'));
          return;
        }
        if (cv['ready']) {
          isOpenCVLoading = false;
          resolve();
          return;
        }
        cv.onRuntimeInitialized = () => {
          cv['ready'] = true;
          isOpenCVLoading = false;
          resolve();
        };
      };
      
      script.onerror = () => {
        clearTimeout(loadTimeout);
        isOpenCVLoading = false;
        reject(new Error('Failed to load OpenCV.js'));
      };
      
      document.head.appendChild(script);
    } catch (err) {
      isOpenCVLoading = false;
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
