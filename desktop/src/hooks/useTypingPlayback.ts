/**
 * useTypingPlayback — character-by-character typing animation with optional
 * keystroke injection into the currently focused external application.
 *
 * Smart inject mode:
 *   1. Reads active window title → detects coding platform vs text field
 *   2. Auto-extracts code-only blocks if on a coding platform
 *   3. Reads editor content via Ctrl+A→Ctrl+C→clipboard to find already-typed offset
 *   4. Moves cursor to end (Ctrl+End) then types only the remaining text
 */

import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const SERVER_URL = "https://ai.zoommate.in";

interface ScreenContext {
  platform:      string;
  language:      string;
  already_typed: string;
  is_coding:     boolean;
  has_error:     boolean;
  error_message: string;
  problem_text:  string;
  question_type: string;
}

async function getScreenContext(): Promise<ScreenContext | null> {
  try {
    const base64 = await invoke<string>("capture_screen");
    if (!base64) return null;
    const res = await fetch(`${SERVER_URL}/api/screen-context`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: `data:image/png;base64,${base64}` }),
    });
    if (!res.ok) return null;
    return await res.json() as ScreenContext;
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlaybackStatus =
  | "idle"
  | "countdown"
  | "reading"
  | "typing"
  | "paused"
  | "complete"
  | "failed";

// ── Human typing timing ───────────────────────────────────────────────────────

/** Returns a delay in ms that mimics natural human keystroke cadence. */
function humanCharDelay(ch: string, prevCh: string): number {
  // Base: 65–160 ms (avg ~112 ms ≈ 70 WPM)
  const base = 65 + Math.random() * 95;

  // After sentence-ending punctuation — brief pause to "think"
  if (".,;:!?".includes(prevCh)) return base + 100 + Math.random() * 180;

  // Symbols / brackets are slower (hand has to reach)
  if (/[{}()[\]<>/\\|@#$%^&*=+~`]/.test(ch)) return base + 25 + Math.random() * 50;

  // Consecutive lowercase letters feel like a burst (muscle memory)
  if (/[a-z]/.test(ch) && /[a-z]/.test(prevCh)) return base * 0.75;

  // Digits slightly slower
  if (/[0-9]/.test(ch)) return base + 18;

  return base;
}

function humanNewlineDelay(): number {
  // 2–4 s — thinking pause before next line
  return 2000 + Math.random() * 2000;
}

function humanIndentDelay(): number {
  return 12 + Math.random() * 14; // 12–26 ms per space (rapid indent)
}

// ── Adjacent keys on QWERTY ───────────────────────────────────────────────────
const NEAR_KEY: Record<string, string> = {
  a:"s", s:"d", d:"f", f:"g", g:"h", h:"j", j:"k", k:"l",
  q:"w", w:"e", e:"r", r:"t", t:"y", y:"u", u:"i", i:"o", o:"p",
  z:"x", x:"c", c:"v", v:"b", b:"n", n:"m",
};

// ── Punctuation swap map ──────────────────────────────────────────────────────
const PUNCT_SWAP: Record<string, string> = {
  ":": ";", ".": ",", ",": ".", "(": "[", ")": "]",
  "[": "(", "]": ")", "=": "-", "+": "=",
};

/**
 * Decide what human mistake (if any) to make for this character.
 * Returns the string that was accidentally typed, or null for no mistake.
 */
function pickMistake(ch: string): string | null {
  const r = Math.random();
  // Punctuation swap (high chance on : and .)
  if (PUNCT_SWAP[ch] && r < 0.20) return PUNCT_SWAP[ch];
  // Adjacent key substitution on letters
  if (/[a-z]/.test(ch) && NEAR_KEY[ch] && r < 0.10) return NEAR_KEY[ch];
  // Double-letter (type the same letter twice)
  if (/[a-z]/.test(ch) && r < 0.10) return ch + ch;
  // Extra adjacent key appended after correct char
  if (/[a-z]/.test(ch) && NEAR_KEY[ch] && r < 0.025) return ch + NEAR_KEY[ch];
  return null;
}

// ── Coding platform detection ─────────────────────────────────────────────────

const CODING_PLATFORMS = [
  "leetcode", "hackerrank", "coderbyte", "codeforces", "hackerearth",
  "geeksforgeeks", "topcoder", "codechef", "atcoder", "replit",
  "codesandbox", "stackblitz", "visual studio code", "vscode",
  "pycharm", "intellij", "sublime text", "notepad++", "vim", "neovim",
];

function isCodingPlatform(title: string): boolean {
  const lower = title.toLowerCase();
  return CODING_PLATFORMS.some((k) => lower.includes(k));
}

/** Remove common leading whitespace from all non-empty lines (like Python's textwrap.dedent). */
function dedent(code: string): string {
  const lines = code.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1].length ?? 0));
  if (minIndent === 0) return code;
  return lines.map((l) => l.slice(minIndent)).join("\n");
}

/** Extract only fenced code blocks from an answer. Returns full text if no blocks found. */
function extractCodeOnly(answer: string): string {
  const blocks: string[] = [];
  const regex = /```(?:\w*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(answer)) !== null) {
    const code = dedent(m[1].trimEnd());
    if (code) blocks.push(code);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : answer;
}

/**
 * Find how many chars of `answer` are already present in `existing`.
 * Returns the number of chars to skip at the start of `answer`.
 *
 * Strategy 1 — suffix match: cursor is at end, sequential typing (most common).
 * Strategy 2 — substring match: cursor moved to middle, find prefix of answer
 *              anywhere in the editor so we can resume from the right position.
 */
function findTypedOffset(existing: string, answer: string): number {
  if (!existing.trim()) return 0;
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
  const e = norm(existing);
  const a = norm(answer);
  const maxCheck = Math.min(e.length, a.length);

  // Strategy 1: suffix match (cursor at end)
  for (let len = maxCheck; len > 10; len--) {
    if (e.endsWith(a.slice(0, len))) return len;
  }

  // Strategy 2: substring match (cursor moved, find where we are in the code)
  const cap = Math.min(maxCheck, 400);
  for (let len = cap; len > 20; len -= 4) {
    if (e.includes(a.slice(0, len))) return len;
  }

  return 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTypingPlayback() {
  const [status,      setStatus]      = useState<PlaybackStatus>("idle");
  const [countdown,   setCountdown]   = useState(3);
  const [displayed,   setDisplayed]   = useState("");
  const [progress,    setProgress]    = useState(0);
  const [detectedCtx, setDetectedCtx] = useState("");

  const pausedRef         = useRef(false);
  const cancelRef         = useRef(false);
  const injectRef         = useRef(false);   // is inject mode active
  const resyncRef         = useRef(false);   // re-read editor on next resume
  const abortCountdownRef = useRef(false);   // set by pause() to abort resume countdown
  const targetTitleRef    = useRef("");      // window title we're typing into
  const clickCooldown     = useRef(0);       // timestamp: ignore mouse clicks until this time

  // ── Controls ───────────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    abortCountdownRef.current = true;  // abort any running resume countdown
    pausedRef.current = true;
    setStatus("paused");
  }, []);

  const resume = useCallback(async () => {
    if (injectRef.current) {
      // 5s countdown — user places cursor, we'll capture screen to find offset
      abortCountdownRef.current = false;
      setDetectedCtx("Place cursor in editor — capturing screen after countdown…");
      setStatus("countdown");
      for (let i = 5; i >= 1; i--) {
        if (cancelRef.current)         { setStatus("idle");   return; }
        if (abortCountdownRef.current) { setStatus("paused"); return; } // Pause clicked → abort
        setCountdown(i);
        await sleep(1000);
      }
      if (cancelRef.current)         { setStatus("idle");   return; }
      if (abortCountdownRef.current) { setStatus("paused"); return; }
      setCountdown(0);
      // After countdown: trigger resync — captures screen to find what's already typed
      resyncRef.current = true;
    }
    // Ignore mouse clicks for 5s after Resume to avoid the button click re-pausing
    clickCooldown.current = Date.now() + 5000;
    invoke("check_mouse_click").catch(() => {});
    pausedRef.current = false;  // wake up the type loop AFTER countdown finishes
    setStatus("typing");
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    pausedRef.current = false;
    resyncRef.current = false;
    abortCountdownRef.current = false;
    setStatus("idle");
    setDisplayed("");
    setProgress(0);
    setCountdown(3);
    setDetectedCtx("");
  }, []);

  // ── Main start ─────────────────────────────────────────────────────────────

  const start = useCallback(async (
    text:     string,
    inject:   boolean,
    codeOnly: boolean,
  ) => {
    if (!text.trim()) return;

    cancelRef.current  = false;
    pausedRef.current  = false;
    resyncRef.current  = false;
    injectRef.current  = inject;
    targetTitleRef.current = "";
    setDisplayed("");
    setProgress(0);
    setDetectedCtx("");

    // ── Countdown (3 s) ──────────────────────────────────────────────────────
    setStatus("countdown");
    for (let i = 3; i >= 1; i--) {
      if (cancelRef.current) { setStatus("idle"); return; }
      setCountdown(i);
      await sleep(1000);
    }
    if (cancelRef.current) { setStatus("idle"); return; }
    setCountdown(0);

    // ── Smart inject: detect context, read editor, find offset ───────────────
    // Normalize Windows line endings so \r doesn't get injected as Enter
    let textToType = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Manual code-only always wins
    if (codeOnly) {
      textToType = extractCodeOnly(text);
      if (textToType !== text) setDetectedCtx("Code only mode → skipping prose");
    }

    if (inject) {
      setStatus("reading");

      // ── Hybrid: screenshot → GPT-4o mini for context ─────────────────────
      const ctx = await getScreenContext();

      if (ctx) {
        const platformLabel = ctx.platform !== "unknown" ? ctx.platform : null;

        // Auto code-only if screen is a coding platform and user hasn't forced it
        if (!codeOnly && ctx.is_coding) {
          const extracted = extractCodeOnly(text);
          if (extracted !== text) {
            textToType = extracted;
            setDetectedCtx(platformLabel
              ? `${platformLabel} detected · code only`
              : `Code editor detected · code only`);
          } else {
            setDetectedCtx(platformLabel ? `${platformLabel} detected` : `Code editor detected`);
          }
        } else if (platformLabel) {
          setDetectedCtx(platformLabel);
        }

        // Use already_typed from vision to find offset (most accurate)
        if (ctx.already_typed.trim()) {
          const offset = findTypedOffset(ctx.already_typed, textToType);
          if (offset > 0) {
            textToType = textToType.slice(offset);
            setDetectedCtx((prev) => `${prev || "Screen read"} · resuming from char ${offset}`);
          }
        }
      } else {
        // ── Fallback: window title + clipboard ────────────────────────────
        if (!codeOnly) {
          const winTitle = await invoke<string>("get_active_window_title").catch(() => "");
          if (isCodingPlatform(winTitle)) {
            const extracted = extractCodeOnly(text);
            if (extracted !== text) {
              textToType = extracted;
              setDetectedCtx(`Code editor detected · code only`);
            }
          }
        }
        // Clipboard read for offset
        await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+a" });
        await sleep(120);
        await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+c" });
        await sleep(350);
        const existing = await invoke<string>("read_clipboard").catch(() => "");
        const offset   = findTypedOffset(existing, textToType);
        if (offset > 0) {
          textToType = textToType.slice(offset);
          setDetectedCtx((prev) => prev ? `${prev} · resuming from char ${offset}` : `Resuming from char ${offset}`);
        }
      }

      // Save editor HWND and title for focus restoration and focus-loss detection
      await invoke<void>("save_target_window").catch(() => {});
      targetTitleRef.current = await invoke<string>("get_active_window_title").catch(() => "");

      // Move cursor to end before typing
      await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+end" });
      await sleep(100);

      if (cancelRef.current) { setStatus("idle"); return; }
    }

    // Drain any stale mouse-click state and set 5s cooldown before we start typing
    if (inject) {
      await invoke("check_mouse_click").catch(() => {});
      clickCooldown.current = Date.now() + 5000;
    }

    setStatus("typing");

    // ── Type loop ────────────────────────────────────────────────────────────
    const chars = [...textToType];
    let buf = "";
    let prevCh = "";
    // How many leading spaces on the next line Monaco auto-indent already placed
    let autoSkip = 0;

    // Helper: hide overlay → screenshot → show overlay → find offset → Ctrl+End
    const resyncPosition = async (currentIndex: number): Promise<number> => {
      // Save editor window HWND before hiding overlay (editor has focus now)
      await invoke<void>("save_target_window").catch(() => {});
      // Hide overlay so the screenshot shows the actual editor, not our window
      await invoke<void>("hide_overlay").catch(() => {});
      await sleep(200);

      const ctx2 = await getScreenContext().catch(() => null);
      let existingText = ctx2?.already_typed ?? "";

      // Fallback: clipboard read (Ctrl+A → Ctrl+C)
      if (!existingText) {
        await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+a" });
        await sleep(120);
        await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+c" });
        await sleep(350);
        existingText = await invoke<string>("read_clipboard").catch(() => "");
      }

      // Show overlay WITHOUT stealing focus
      await invoke<void>("show_overlay_no_focus").catch(() => {});
      await sleep(80);
      // Restore focus to the editor so keystrokes keep going there
      await invoke<void>("refocus_target_window").catch(() => {});
      await sleep(80);
      // Extend click cooldown so the resync itself doesn't immediately re-pause
      clickCooldown.current = Date.now() + 5000;
      await invoke("check_mouse_click").catch(() => {});

      const remaining = chars.slice(currentIndex).join("");
      const skip = findTypedOffset(existingText, remaining);
      if (skip > 0) {
        const skipCodePoints = [...remaining.slice(0, skip)].length;
        buf += remaining.slice(0, skip);
        setDisplayed(buf);
        await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+end" });
        await sleep(100);
        return currentIndex + skipCodePoints;
      }
      await invoke<void>("inject_keystroke", { charCode: 0, special: "ctrl+end" });
      await sleep(100);
      return currentIndex;
    };

    try {
      for (let i = 0; i < chars.length; i++) {
        if (cancelRef.current) break;

        // ── Auto-pause on any mouse click (cursor repositioned) ────────────
        if (inject && !pausedRef.current && Date.now() > clickCooldown.current) {
          const clicked = await invoke<boolean>("check_mouse_click").catch(() => false);
          if (clicked) {
            pausedRef.current = true;
            resyncRef.current = true;
            setStatus("paused");
            setDetectedCtx("Cursor moved — click Resume to continue from new position");
          }
        }

        // ── Also check window focus every 20 chars ──────────────────────────
        if (inject && i % 20 === 0 && targetTitleRef.current && !pausedRef.current) {
          const currentTitle = await invoke<string>("get_active_window_title").catch(() => "");
          const isOurApp = currentTitle.toLowerCase().includes("zoommate");
          if (!isOurApp && currentTitle !== targetTitleRef.current) {
            pausedRef.current = true;
            resyncRef.current = true;
            setStatus("paused");
            setDetectedCtx("Focus moved away — click back in editor, then Resume");
          }
        }

        // ── Pause polling ──────────────────────────────────────────────────
        while (pausedRef.current) {
          await sleep(60);
          if (cancelRef.current) break;
        }
        if (cancelRef.current) break;

        // ── Smart resume: re-sync position after pause ─────────────────────
        if (inject && resyncRef.current) {
          resyncRef.current = false;
          setDetectedCtx("Re-syncing editor position…");
          i = await resyncPosition(i);
          targetTitleRef.current = await invoke<string>("get_active_window_title").catch(() => targetTitleRef.current);
          setDetectedCtx("");
          if (cancelRef.current) break;
        }

        const ch = chars[i];

        // ── Pause between words (after space) ────────────────────────────
        if (ch === " " && prevCh !== " " && prevCh !== "\n") {
          // Always pause 1–4s between words, weighted toward shorter pauses
          const roll = Math.random();
          const wordPause =
            roll < 0.40 ? 1000 + Math.random() * 500   // 40%: 1.0–1.5s
          : roll < 0.70 ? 1500 + Math.random() * 500   // 30%: 1.5–2.0s
          : roll < 0.88 ? 2000 + Math.random() * 1000  // 18%: 2.0–3.0s
          :               3000 + Math.random() * 1000; // 12%: 3.0–4.0s
          await sleep(wordPause);
          if (cancelRef.current) break;
        }

        // ── Human mistake simulation ──────────────────────────────────────
        const mistake = pickMistake(ch);
        if (mistake) {
          // Type the mistake character(s)
          let mp = prevCh;
          for (const mc of mistake) {
            buf += mc;
            setDisplayed(buf);
            if (inject) await invoke<void>("inject_keystroke", { charCode: mc.codePointAt(0)!, special: null });
            await sleep(humanCharDelay(mc, mp));
            mp = mc;
            if (cancelRef.current) break;
          }
          if (cancelRef.current) break;
          // In inject mode: press Escape to dismiss any autocomplete popup before backspacing
          if (inject) {
            await invoke<void>("inject_keystroke", { charCode: 0, special: "escape" });
            await sleep(40);
          }
          // Pause — "wait, that's wrong"
          await sleep(90 + Math.random() * 220);
          if (cancelRef.current) break;
          // Backspace each mistake character
          for (let b = 0; b < mistake.length; b++) {
            buf = buf.slice(0, -1);
            setDisplayed(buf);
            if (inject) await invoke<void>("inject_keystroke", { charCode: 0, special: "backspace" });
            await sleep(45 + Math.random() * 55);
            if (cancelRef.current) break;
          }
          if (cancelRef.current) break;
          // Short pause then type correct char
          await sleep(30 + Math.random() * 70);
        }

        // ── Type the correct character ───────────────────────────────────────
        if (ch === "\n") {
          autoSkip = 0;
          buf += ch;
          setDisplayed(buf);
          if (inject) {
            await invoke<void>("inject_keystroke", { charCode: 0, special: "enter" });
            await sleep(80); // wait for editor auto-indent to fire

            // Count spaces the next line actually needs
            let nextNeed = 0;
            for (let k = i + 1; k < chars.length && chars[k] === " "; k++) nextNeed++;

            // Clear whatever auto-indent the editor added (works for any editor/indent size):
            // Home → Shift+End selects all auto-indent spaces, Delete removes them
            await invoke<void>("inject_keystroke", { charCode: 0, special: "home" });
            await sleep(15);
            await invoke<void>("inject_keystroke", { charCode: 0, special: "shift+end" });
            await sleep(15);
            await invoke<void>("inject_keystroke", { charCode: 0, special: "delete" });
            await sleep(15);

            // Type our exact indentation quickly (fast looks natural for indent)
            for (let s = 0; s < nextNeed; s++) {
              buf += " ";
              await invoke<void>("inject_keystroke", { charCode: 32, special: null });
              await sleep(humanIndentDelay());
            }
            setDisplayed(buf);
            autoSkip = nextNeed; // skip these space chars in the main loop

            await sleep(humanNewlineDelay() - 80);

          } else {
            await sleep(humanNewlineDelay());
            let indentSpaces = 0;
            for (let k = i + 1; k < chars.length && (chars[k] === " " || chars[k] === "\t"); k++) indentSpaces++;
            if (indentSpaces > 0) await sleep(humanIndentDelay() * Math.min(indentSpaces, 4));
          }

        } else if (ch === " " && inject && autoSkip > 0) {
          // Already injected in the newline handler above — just update display
          autoSkip--;

        } else if (ch === "\t") {
          autoSkip = 0;
          buf += ch;
          setDisplayed(buf);
          if (inject) await invoke<void>("inject_keystroke", { charCode: 0, special: "tab" });
          await sleep(humanIndentDelay());

        } else {
          autoSkip = 0;
          buf += ch;
          setDisplayed(buf);
          if (inject) await invoke<void>("inject_keystroke", { charCode: ch.codePointAt(0)!, special: null });
          await sleep(humanCharDelay(ch, prevCh));
        }

        prevCh = ch;

        setProgress(Math.round(((i + 1) / chars.length) * 100));
      }

      if (!cancelRef.current) {
        setStatus("complete");
        setProgress(100);
      } else {
        setStatus("idle");
      }
    } catch (err) {
      console.error("[TypingPlayback] error:", err);
      setStatus("failed");
    }
  }, []);

  return { status, countdown, displayed, progress, detectedCtx, start, pause, resume, cancel };
}
