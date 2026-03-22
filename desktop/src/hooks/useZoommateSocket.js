/**
 * useZoommateSocket — Socket.IO + Azure STT hook for the desktop overlay.
 *
 * Server event reference (from answerStreamer.ts / socket.ts):
 *   SERVER → CLIENT
 *     "response_start"  { meetingId, requestId, displayQuestion }
 *     "answer"          { meetingId, requestId, delta }        ← streaming chunk
 *     "response_end"    { meetingId, requestId, cancelled?, error? }
 *     "answer_cached"   { meetingId, answer, question }
 *     "orchestrate_result" { meetingId, decision }
 *     "joined"          { meetingId }
 *
 *   CLIENT → SERVER
 *     "join_meeting"      { meetingId }
 *     "recognizing_item"  { meetingId, text }      ← interim STT
 *     "recognized_item"   { meetingId, text, ts }  ← final STT
 *     "question"          { meetingId, mode, audioMode } ← request answer
 *     "barge_in"          { meetingId }            ← cancel current stream
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { bridge } from "../lib/bridge";
const SERVER_URL = "https://ai.zoommate.in";
const DEFAULT = {
    transcript: "",
    finalTranscript: "",
    question: "",
    answer: "",
    isStreaming: false,
    isAwaitingFirstChunk: false,
    isPaused: false,
    statusLabel: "READY",
    sttError: "",
    connected: false,
};
// ── Hook ───────────────────────────────────────────────────────────────────────
export function useZoommateSocket(meetingId) {
    const [state, setState] = useState(DEFAULT);
    const socketRef = useRef(null);
    const recognizerRef = useRef(null);
    const pausedRef = useRef(false); // shadow of isPaused for closures
    // ── Socket.IO connection ───────────────────────────────────────────────────
    useEffect(() => {
        if (!meetingId)
            return;
        const socket = io(SERVER_URL, {
            withCredentials: true, // sends session cookie → auth
            transports: ["websocket"],
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000,
        });
        socketRef.current = socket;
        socket.on("connect", () => {
            setState((s) => ({ ...s, connected: true }));
            socket.emit("join_meeting", { meetingId });
        });
        socket.on("disconnect", () => {
            setState((s) => ({ ...s, connected: false }));
        });
        socket.on("joined", () => {
            // Successfully joined the room — STT will start separately
        });
        // ── Answer streaming ───────────────────────────────────────────────────
        socket.on("response_start", ({ displayQuestion }) => {
            setState((s) => ({
                ...s,
                question: displayQuestion || s.finalTranscript || s.transcript,
                answer: "",
                isAwaitingFirstChunk: true,
                isStreaming: false,
                statusLabel: "THINKING",
            }));
        });
        socket.on("answer", ({ delta }) => {
            setState((s) => ({
                ...s,
                answer: s.answer + (delta || ""),
                isStreaming: true,
                isAwaitingFirstChunk: false,
                statusLabel: "ANSWERING",
            }));
        });
        socket.on("response_end", ({ error, cancelled }) => {
            setState((s) => ({
                ...s,
                isStreaming: false,
                isAwaitingFirstChunk: false,
                statusLabel: "READY",
                ...(error && !cancelled ? { answer: s.answer || `Error: ${error}` } : {}),
            }));
        });
        // Cached answer (deduplication hit)
        socket.on("answer_cached", ({ answer, question }) => {
            setState((s) => ({
                ...s,
                question: question || s.question,
                answer: answer || "",
                isStreaming: false,
                isAwaitingFirstChunk: false,
                statusLabel: "READY",
            }));
        });
        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [meetingId]);
    // ── Azure STT ──────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!meetingId)
            return;
        let recognizer = null;
        let destroyed = false;
        (async () => {
            try {
                const { token, region } = await bridge.getAzureToken();
                if (destroyed)
                    return;
                const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
                speechConfig.speechRecognitionLanguage = "en-US";
                speechConfig.outputFormat = SpeechSDK.OutputFormat.Simple;
                // Extra tech vocab hints for better recognition accuracy
                const phraseList = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer // initialised below
                );
                const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
                recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
                recognizerRef.current = recognizer;
                // Rebuild phrase list now that recognizer exists
                const pl = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
                pl.addPhrases([
                    "React", "TypeScript", "Python", "Kubernetes", "Docker",
                    "PostgreSQL", "MongoDB", "Redis", "GraphQL", "microservices",
                    "system design", "LLM", "RAG", "vector database",
                ]);
                // Interim results → show in transcript, send to server
                recognizer.recognizing = (_s, e) => {
                    if (pausedRef.current)
                        return;
                    const text = e.result.text;
                    if (!text)
                        return;
                    setState((s) => ({ ...s, transcript: text, sttError: "" }));
                    socketRef.current?.emit("recognizing_item", { meetingId, text });
                };
                // Final results → commit, send to server
                recognizer.recognized = (_s, e) => {
                    if (pausedRef.current)
                        return;
                    if (e.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech)
                        return;
                    const text = e.result.text.trim();
                    if (!text)
                        return;
                    setState((s) => ({
                        ...s,
                        finalTranscript: text,
                        transcript: text,
                        sttError: "",
                    }));
                    socketRef.current?.emit("recognized_item", { meetingId, text, ts: Date.now() });
                };
                recognizer.canceled = (_s, e) => {
                    if (e.reason === SpeechSDK.CancellationReason.Error) {
                        setState((s) => ({ ...s, sttError: `STT error: ${e.errorDetails}` }));
                    }
                };
                recognizer.startContinuousRecognitionAsync(() => setState((s) => ({ ...s, sttError: "" })), (err) => setState((s) => ({ ...s, sttError: `Mic error: ${err}` })));
            }
            catch (err) {
                if (!destroyed) {
                    setState((s) => ({ ...s, sttError: err?.message || "Failed to start microphone" }));
                }
            }
        })();
        return () => {
            destroyed = true;
            recognizerRef.current?.stopContinuousRecognitionAsync(() => {
                recognizerRef.current?.close();
                recognizerRef.current = null;
            }, () => {
                recognizerRef.current?.close();
                recognizerRef.current = null;
            });
        };
    }, [meetingId]);
    // ── Actions ────────────────────────────────────────────────────────────────
    const requestAnswer = useCallback(() => {
        socketRef.current?.emit("question", {
            meetingId,
            mode: "enter",
            audioMode: "mic",
        });
        setState((s) => ({ ...s, isAwaitingFirstChunk: true, statusLabel: "THINKING" }));
    }, [meetingId]);
    const sendFollowUp = useCallback((text) => {
        socketRef.current?.emit("question", {
            meetingId,
            mode: "enter",
            audioMode: "mic",
            overrideQuestion: text,
        });
        setState((s) => ({ ...s, isAwaitingFirstChunk: true, statusLabel: "THINKING" }));
    }, [meetingId]);
    const cancelStream = useCallback(() => {
        socketRef.current?.emit("barge_in", { meetingId });
        setState((s) => ({ ...s, isStreaming: false, isAwaitingFirstChunk: false, statusLabel: "READY" }));
    }, [meetingId]);
    const togglePause = useCallback(() => {
        pausedRef.current = !pausedRef.current;
        setState((s) => ({
            ...s,
            isPaused: pausedRef.current,
            statusLabel: pausedRef.current ? "PAUSED" : "READY",
        }));
    }, []);
    const retry = useCallback(() => {
        if (state.answer) {
            // Retry with the last transcript
            requestAnswer();
        }
    }, [state.answer, requestAnswer]);
    return {
        state: { ...state, isPaused: pausedRef.current },
        requestAnswer,
        sendFollowUp,
        cancelStream,
        togglePause,
        retry,
    };
}
