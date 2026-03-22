import { useState, useEffect } from "react";
import { bridge, type User } from "../lib/bridge";

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // Listen for the OAuth callback emitted by Rust
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    bridge.onOAuthCallback(async (payload) => {
      if (!payload.success || !payload.token) {
        setLoading(false);
        setError(payload.error || "Sign-in failed. Please try again.");
        return;
      }

      try {
        // Exchange the one-time token for a session cookie (WebView2 cookie jar)
        const user = await bridge.exchangeToken(payload.token);
        setLoading(false);
        onLogin(user);
      } catch (err: any) {
        setLoading(false);
        setError(err?.message || "Session creation failed. Please try again.");
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [onLogin]);

  const handleSignIn = () => {
    setError("");
    setLoading(true);
    bridge.startOAuth().catch((e: any) => {
      setLoading(false);
      setError(e?.message || "Failed to start sign-in.");
    });
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(8,8,18,0.88)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      padding: 16,
    }}>
      {/* Compact pill — HuddleMate style */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        background: "rgba(240,240,245,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 50,
        padding: "6px 8px 6px 16px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        width: "100%",
        maxWidth: 380,
      }}>
        <span style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#1a1a2e",
          whiteSpace: "nowrap",
          marginRight: 10,
        }}>
          Zoommate
        </span>

        <div style={{ width: 1, height: 20, background: "rgba(0,0,0,0.12)", marginRight: 10 }} />

        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "7px 16px",
            background: loading ? "rgba(99,102,241,0.7)" : "#4f46e5",
            border: "none",
            borderRadius: 50,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            transition: "background 0.15s",
          }}
        >
          {loading ? (
            <>
              <span style={{ display: "inline-flex", gap: 3 }}>
                {[0, 100, 200].map((d) => (
                  <span
                    key={d}
                    style={{
                      width: 4, height: 4,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.8)",
                      animation: `pulse 0.8s ${d}ms infinite`,
                    }}
                  />
                ))}
              </span>
              Opening browser…
            </>
          ) : (
            <>
              Sign in to continue
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.85 }}>
                <path d="M2 10L10 2M10 2H5M10 2V7" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </>
          )}
        </button>
      </div>

      {error && (
        <p style={{
          marginTop: 10,
          fontSize: 11,
          color: "#ef4444",
          background: "rgba(239,68,68,0.1)",
          borderRadius: 8,
          padding: "6px 12px",
          maxWidth: 380,
          textAlign: "center",
        }}>
          {error}
        </p>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
