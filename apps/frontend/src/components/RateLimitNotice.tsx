import { useEffect, useState, useSyncExternalStore } from 'react';
import { Clock3 } from 'lucide-react';
import { allowManualReadRetry, getRateState, subscribeRate } from '../live/readCoordinator';
import { g4 } from '../i18n/g4';
export function RateLimitNotice({ retry }: { retry?: () => void }) {
  const rate = useSyncExternalStore(subscribeRate, getRateState, getRateState);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setNow(Date.now()); if (!rate.limited) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [rate]);
  if (!rate.limited) return null;
  const seconds = rate.until === null ? null : Math.max(0, Math.ceil((rate.until - now) / 1000));
  return <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status" data-testid="rate-limit-notice">
    <p className="flex items-center gap-2 font-bold"><Clock3 size={18}/>{g4.rateTitle}</p>
    <p className="mt-2 text-sm">{seconds === null ? g4.unknown : seconds > 0 ? g4.countdown(seconds) : g4.restoring}</p>
    <p className="mt-1 text-xs">{g4.preserved}</p>
    {rate.requestId && <p className="mt-1 break-all font-mono text-xs">Request-ID: {rate.requestId}</p>}
    {((rate.manual && seconds === null) || seconds === 0) && <button className="btn-secondary mt-3" onClick={() => { allowManualReadRetry(); if (retry) retry(); else window.dispatchEvent(new Event('uapm-read-retry')); }}>{g4.retry}</button>}
  </div>;
}
