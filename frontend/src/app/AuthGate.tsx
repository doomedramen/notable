import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const UNAUTHORIZED_EVENT = "notable:unauthorized";

/** Patches window.fetch so a 401 from any /api/* call (other than
    /api/login) re-locks the app, even if the session expires mid-use. */
export function installAuthInterceptor() {
  const original = window.fetch;
  window.fetch = async (...args) => {
    const res = await original(...args);
    if (res.status === 401) {
      const input = args[0];
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.pathname
            : input.url;
      if (url.startsWith("/api/") && !url.startsWith("/api/login")) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
    }
    return res;
  };
}

/** Gates the app behind a password prompt when --auth-password is set.
    No-ops (renders children immediately) when auth is disabled, since
    every /api/* request then succeeds. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "ok" | "locked">("checking");

  useEffect(() => {
    fetch("/api/notes")
      .then((res) => setStatus(res.status === 401 ? "locked" : "ok"))
      .catch(() => setStatus("ok"));

    const onUnauthorized = () => setStatus("locked");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (status === "checking") return null;
  // Reload on success so plugins, sync, and the index all (re)initialize
  // with the now-authenticated session — they may have failed pre-login.
  if (status === "locked") {
    return <LoginScreen onSuccess={() => window.location.reload()} />;
  }
  return children;
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error();
      onSuccess();
    } catch {
      setError("Incorrect password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-background p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-md border border-border bg-surface p-5 shadow-dialog"
      >
        <h1 className="text-[15px] font-semibold">Notable</h1>
        <p className="mt-1 text-sm text-muted">
          Enter the password to continue.
        </p>
        <Input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="mt-3"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          className="mt-3 w-full"
          disabled={busy || !password}
        >
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
