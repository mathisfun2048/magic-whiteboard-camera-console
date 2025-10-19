// Optimized loader for OpenCV.js with lazy loading support
let cvLoadPromise: Promise<void> | null = null;
let isOpenCVLoading = false;

// List of OpenCV.js builds with ArUco support (tried in order)
const OPENCV_URLS = [
  // Huggingface hosted build with contrib modules (includes ArUco)
  'https://huggingface.co/spaces/radames/opencv-js-demo/resolve/main/opencv.js',
  // Alternative build from jsDelivr
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/opencv.js',
  // Fallback to standard build (may not have ArUco)
  'https://docs.opencv.org/4.5.2/opencv.js',
];

export function loadOpenCV(src?: string): Promise<void> {
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
      // Try URLs in order until one works and has ArUco support
      const urlsToTry = src ? [src] : OPENCV_URLS;
      let currentUrlIndex = 0;
      
      const tryLoadUrl = (url: string) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.defer = true;
        script.setAttribute('data-opencv', 'true');
        
        // Add loading timeout
        const loadTimeout = setTimeout(() => {
          console.warn(`OpenCV.js loading timeout for ${url}`);
          script.remove();
          // Try next URL if available
          currentUrlIndex++;
          if (currentUrlIndex < urlsToTry.length) {
            console.log(`Trying fallback URL: ${urlsToTry[currentUrlIndex]}`);
            tryLoadUrl(urlsToTry[currentUrlIndex]);
          } else {
            isOpenCVLoading = false;
            reject(new Error('OpenCV.js loading timeout - all URLs failed'));
          }
        }, 30000); // 30 second timeout
        
        script.onload = () => {
          clearTimeout(loadTimeout);
          const cv: any = (window as any).cv;
          if (!cv) {
            console.warn(`OpenCV.js loaded from ${url} but window.cv is undefined`);
            script.remove();
            // Try next URL
            currentUrlIndex++;
            if (currentUrlIndex < urlsToTry.length) {
              console.log(`Trying fallback URL: ${urlsToTry[currentUrlIndex]}`);
              tryLoadUrl(urlsToTry[currentUrlIndex]);
            } else {
              isOpenCVLoading = false;
              reject(new Error('OpenCV.js loaded but window.cv is undefined - all URLs failed'));
            }
            return;
          }
          if (cv['ready']) {
            // Check for ArUco immediately if already ready
            if (cv.aruco) {
              console.log(`✅ OpenCV.js with ArUco loaded from ${url}`);
              isOpenCVLoading = false;
              resolve();
            } else {
              console.warn(`OpenCV.js from ${url} loaded but no ArUco support`);
              script.remove();
              // Try next URL
              currentUrlIndex++;
              if (currentUrlIndex < urlsToTry.length) {
                console.log(`Trying fallback URL: ${urlsToTry[currentUrlIndex]}`);
                tryLoadUrl(urlsToTry[currentUrlIndex]);
              } else {
                // Accept the build even without ArUco as last resort
                console.warn('No OpenCV.js build with ArUco found, using last loaded build');
                isOpenCVLoading = false;
                resolve();
              }
            }
            return;
          }
          cv.onRuntimeInitialized = () => {
            cv['ready'] = true;
            // Check for ArUco after initialization
            if (cv.aruco) {
              console.log(`✅ OpenCV.js with ArUco loaded from ${url}`);
              isOpenCVLoading = false;
              resolve();
            } else {
              console.warn(`OpenCV.js from ${url} initialized but no ArUco support`);
              script.remove();
              delete (window as any).cv;
              // Try next URL
              currentUrlIndex++;
              if (currentUrlIndex < urlsToTry.length) {
                console.log(`Trying fallback URL: ${urlsToTry[currentUrlIndex]}`);
                tryLoadUrl(urlsToTry[currentUrlIndex]);
              } else {
                // Accept the build even without ArUco as last resort
                console.warn('No OpenCV.js build with ArUco found, loading completed anyway');
                isOpenCVLoading = false;
                resolve();
              }
            }
          };
        };
        
        script.onerror = () => {
          clearTimeout(loadTimeout);
          console.warn(`Failed to load OpenCV.js from ${url}`);
          script.remove();
          // Try next URL
          currentUrlIndex++;
          if (currentUrlIndex < urlsToTry.length) {
            console.log(`Trying fallback URL: ${urlsToTry[currentUrlIndex]}`);
            tryLoadUrl(urlsToTry[currentUrlIndex]);
          } else {
            isOpenCVLoading = false;
            reject(new Error('Failed to load OpenCV.js from all URLs'));
          }
        };
        
        document.head.appendChild(script);
      };
      
      // Start loading from first URL
      tryLoadUrl(urlsToTry[0]);
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
