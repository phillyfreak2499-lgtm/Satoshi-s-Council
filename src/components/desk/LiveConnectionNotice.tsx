import { useEffect, useState } from "react";
import { connectionNotice } from "@/lib/desk/connection-state";
import { retryLiveConnection, type DeskFrame } from "@/lib/desk/engine";

/** One quiet status strip across Guided, Pro and Gallery; absent on a healthy desk. */
export function LiveConnectionNotice({ frame }: { frame: DeskFrame }) {
  const [clock, setClock] = useState({ now: 0, online: true });
  useEffect(() => {
    const update = () => setClock({ now: Date.now(), online: navigator.onLine });
    update();
    const timer = window.setInterval(update, 1000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const notice = connectionNotice(frame, clock.now, clock.online);
  if (!notice) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-wait/40 bg-wait/10 px-3 py-2 text-ui text-wait" data-connection-notice>
      <p role="status" aria-live="polite" className="min-w-0 flex-1">
        <strong>{notice.title}.</strong> {notice.detail}
      </p>
      <button type="button" className="btn btn-secondary btn-sm min-h-11" onClick={retryLiveConnection} disabled={!clock.online}>
        Retry now
      </button>
    </div>
  );
}
