/**
 * Single polling loop behind every page.
 *
 * The system state is derived from what the API reports, with one addition the
 * server cannot make: if the request itself fails we are in `dberror` — the
 * API can't tell us its database is unreachable when we never reached the API.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfig,
  getMetrics,
  getNetwork,
  getSeries,
  getValidatorDetail,
  getEndpoints,
  getValidatorSet,
  getValidators,
  updateValidatorIdentity,
  type Config,
  type EndpointList,
  type Metrics,
  type Network,
  type Series,
  type SystemState,
  type Validator,
  type ValidatorDetail,
  type ValidatorSet,
} from "./api";

const REFRESH_MS = 10_000;
const SLOW_REFRESH_MS = 30_000;

export type Dashboard = {
  net: Network | null;
  validators: Validator[];
  set: ValidatorSet | null;
  metrics: Metrics | null;
  series: Series | null;
  config: Config | null;
  endpoints: EndpointList | null;
  detail: ValidatorDetail | null;
  /** Effective state. */
  state: SystemState;
  bootstrap: boolean;
  error: string | null;
  lastUpdated: Date | null;
  /** Seconds since the last successful poll — drives the "Updated Ns ago". */
  agoSeconds: number;
  refresh: () => void;
  setEndpoints: (e: EndpointList) => void;
  /** Optimistically apply a local identity edit (label / watched). */
  patchValidator: (address: string, patch: { label?: string | null; watched?: boolean }) => void;
};

export function useDashboard(opts: {
  live: boolean;
  selected: string | null;
  window: number;
  /** Metrics horizon in hours (24 | 168 | 720). */
  metricsHours: number;
}): Dashboard {
  const { live, selected, window: win, metricsHours } = opts;

  const [net, setNet] = useState<Network | null>(null);
  const [validators, setValidators] = useState<Validator[]>([]);
  const [set, setSet] = useState<ValidatorSet | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointList | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [detail, setDetail] = useState<ValidatorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [agoSeconds, setAgoSeconds] = useState(0);
  const [tick, setTick] = useState(0);

  const booted = useRef(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  /**
   * Apply a local identity edit: PATCH the API, then fold the result into the
   * cached lists so the star/label appears without waiting for the slow loop.
   * On failure the pre-edit values are restored immediately — a bare refresh()
   * would only re-apply the optimistic edit's stale state on the next poll.
   */
  const patchValidator = useCallback(
    (address: string, patch: { label?: string | null; watched?: boolean }) => {
      let before: { label?: string | null; watched?: boolean } | null = null;
      setValidators((vs) =>
        vs.map((v) => {
          if (v.address !== address) return v;
          before = { label: v.label, watched: v.watched };
          return { ...v, ...patch };
        }),
      );
      updateValidatorIdentity(address, patch).catch(() => {
        if (before) {
          setValidators((vs) => vs.map((v) => (v.address === address ? { ...v, ...before } : v)));
        }
      });
    },
    [],
  );

  // Fast loop: the numbers that change every block.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [n, v, s] = await Promise.all([getNetwork(), getValidators(), getSeries(60, 60)]);
        if (cancelled) return;
        setNet(n);
        setValidators(v.validators);
        setSeries(s);
        setError(null);
        setLastUpdated(new Date());
        setAgoSeconds(0);
        booted.current = true;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void run();
    if (!live) return () => { cancelled = true; };
    const id = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live, tick]);

  // Slow loop: aggregates that don't need block cadence. The metrics horizon
  // is a dependency so switching ranges refetches immediately.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const results = await Promise.allSettled([
        getValidatorSet(),
        getMetrics(metricsHours),
        getEndpoints(),
      ]);
      if (cancelled) return;
      if (results[0].status === "fulfilled") setSet(results[0].value);
      if (results[1].status === "fulfilled") setMetrics(results[1].value);
      if (results[2].status === "fulfilled") setEndpoints(results[2].value);
    };
    void run();
    if (!live) return () => { cancelled = true; };
    const id = setInterval(run, SLOW_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live, tick, metricsHours]);

  // Config is static for the process lifetime.
  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => !cancelled && setConfig(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Selected validator's signing slots, refetched when the window changes.
  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDetail(null);
      return;
    }
    getValidatorDetail(selected, win)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null));
    return () => {
      cancelled = true;
    };
  }, [selected, win, live, tick]);

  // "Updated Ns ago" ticks independently of the fetch loop.
  useEffect(() => {
    const id = setInterval(() => setAgoSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const derived: SystemState = error
    ? "dberror"
    : !booted.current || !net
      ? "loading"
      : net.status;

  return {
    net,
    validators,
    set,
    metrics,
    series,
    config,
    endpoints,
    detail,
    state: derived,
    bootstrap: net?.vset_bootstrap ?? false,
    error,
    lastUpdated,
    agoSeconds,
    refresh,
    setEndpoints,
    patchValidator,
  };
}
