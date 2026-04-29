import { useCallback, useEffect, useState, type RefObject } from "react";

function getFullscreenElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? d.mozFullScreenElement ?? d.msFullscreenElement ?? null;
}

function fullscreenApiEnabled(): boolean {
  const d = document as Document & {
    webkitFullscreenEnabled?: boolean;
    mozFullScreenEnabled?: boolean;
    msFullscreenEnabled?: boolean;
  };
  if (typeof document === "undefined") return false;
  if (document.fullscreenEnabled !== undefined) return document.fullscreenEnabled;
  if (d.webkitFullscreenEnabled !== undefined) return d.webkitFullscreenEnabled;
  if (d.mozFullScreenEnabled !== undefined) return d.mozFullScreenEnabled;
  if (d.msFullscreenEnabled !== undefined) return d.msFullscreenEnabled;
  /** Assume available if we have request methods (older browsers) */
  return typeof HTMLElement !== "undefined" && "requestFullscreen" in HTMLElement.prototype;
}

async function requestElFullscreen(el: Element): Promise<void> {
  const node = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  if (typeof node.requestFullscreen === "function") {
    await node.requestFullscreen();
    return;
  }
  if (typeof node.webkitRequestFullscreen === "function") {
    await Promise.resolve(node.webkitRequestFullscreen());
    return;
  }
  if (typeof node.msRequestFullscreen === "function") {
    await Promise.resolve(node.msRequestFullscreen());
    return;
  }
  throw new Error("Fullscreen request not supported");
}

async function exitDocumentFullscreen(): Promise<void> {
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    mozCancelFullScreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };
  if (typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }
  if (typeof d.webkitExitFullscreen === "function") {
    await Promise.resolve(d.webkitExitFullscreen());
    return;
  }
  if (typeof d.mozCancelFullScreen === "function") {
    await Promise.resolve(d.mozCancelFullScreen());
    return;
  }
  if (typeof d.msExitFullscreen === "function") {
    await Promise.resolve(d.msExitFullscreen());
    return;
  }
}

/**
 * Fullscreen API helper: requestFullscreen on a container, synced via fullscreenchange + vendor events.
 */
export function useFullscreen(containerRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported] = useState(() =>
    typeof document !== "undefined" ? fullscreenApiEnabled() && typeof HTMLElement.prototype !== "undefined" : false
  );

  const syncState = useCallback(() => {
    const active = getFullscreenElement();
    const node = containerRef.current;
    setIsFullscreen(Boolean(node && active === node));
  }, [containerRef]);

  useEffect(() => {
    syncState();
  }, [syncState]);

  useEffect(() => {
    const onChange = () => syncState();
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange as EventListener);
    document.addEventListener("mozfullscreenchange", onChange as EventListener);
    document.addEventListener("MSFullscreenChange", onChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange as EventListener);
      document.removeEventListener("mozfullscreenchange", onChange as EventListener);
      document.removeEventListener("MSFullscreenChange", onChange as EventListener);
    };
  }, [syncState]);

  useEffect(() => {
    return () => {
      const node = containerRef.current;
      if (node && getFullscreenElement() === node) {
        void exitDocumentFullscreen().catch(() => {});
      }
    };
  }, [containerRef]);

  const enterFullscreen = useCallback(
    async (target?: HTMLElement | null) => {
      const el = target ?? containerRef.current;
      if (!el || !fullscreenApiEnabled()) return false;
      try {
        await requestElFullscreen(el);
        syncState();
        return getFullscreenElement() === el;
      } catch {
        syncState();
        return false;
      }
    },
    [containerRef, syncState]
  );

  const exitFullscreen = useCallback(async () => {
    if (!getFullscreenElement()) return;
    try {
      await exitDocumentFullscreen();
    } catch {
      /* host may deny */
    }
    syncState();
  }, [syncState]);

  const toggleFullscreen = useCallback(async () => {
    const node = containerRef.current;
    if (getFullscreenElement() === node) await exitFullscreen();
    else await enterFullscreen();
  }, [containerRef, enterFullscreen, exitFullscreen]);

  return { isFullscreen, isSupported, enterFullscreen, exitFullscreen, toggleFullscreen };
}
