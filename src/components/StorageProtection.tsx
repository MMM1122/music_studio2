import { useEffect, useState } from "react";

/** Status reads never prompt. Only the explicit button requests persistence. */
export function StorageProtection() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const available =
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.persist === "function";
  useEffect(() => {
    let cancelled = false;
    if (typeof navigator === "undefined" || !navigator.storage) return;
    const storage = navigator.storage;
    if (storage.persisted)
      void storage
        .persisted()
        .then((value) => {
          if (!cancelled) setPersistent(value);
        })
        .catch(() => {
          if (!cancelled)
            setMessage("Storage protection status is unavailable.");
        });
    if (storage.estimate)
      void storage
        .estimate()
        .then((estimate) => {
          if (!cancelled) {
            setUsage(estimate.usage ?? null);
            setQuota(estimate.quota ?? null);
          }
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  async function request() {
    if (!available) return;
    setBusy(true);
    try {
      const granted = await navigator.storage.persist();
      setPersistent(granted);
      setMessage(
        granted
          ? "Persistent storage was granted. Keep downloaded backups as well."
          : "The browser did not grant persistence. Your project still saves locally; keep a complete backup.",
      );
    } catch {
      setMessage(
        "The browser could not grant storage protection. Keep a complete backup of your session.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Local storage protection">
      <h4>Local storage</h4>
      <p className="library-footnote">
        {persistent === true
          ? "Persistence is enabled for this browser."
          : available
            ? "Ask this browser to protect saved sessions from automatic storage cleanup."
            : "This browser does not expose persistent storage controls."}{" "}
        Clearing site data yourself still removes local projects.
      </p>
      {usage !== null && (
        <p className="library-footnote">
          Estimated use: {(usage / 1024 / 1024).toFixed(1)} MB
          {quota !== null
            ? ` of ${(quota / 1024 / 1024).toFixed(0)} MB available to this site`
            : ""}
          .
        </p>
      )}
      <button
        className="button small"
        disabled={!available || busy || persistent === true}
        onClick={() => void request()}
      >
        {busy
          ? "Requesting…"
          : persistent
            ? "Storage protection enabled"
            : "Protect local storage"}
      </button>
      <p className="library-footnote" role="status">
        {message}
      </p>
    </section>
  );
}
