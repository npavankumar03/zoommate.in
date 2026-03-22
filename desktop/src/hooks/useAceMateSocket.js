import { useEffect, useRef, useState, useCallback } from "react";
const SERVER_URL = "wss://ai.zoommate.in";
const DEFAULT_STATE = {
    question: "",
    answer: "",
    isStreaming: false,
    isAwaitingFirstChunk: false,
    isPaused: false,
    statusLabel: "READY",
    transcript: "",
    meetingId: null,
};
export function useAceMateSocket(token) {
    const [state, setState] = useState(DEFAULT_STATE);
    const [connected, setConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimer = useRef(null);
    const connect = useCallback(() => {
        if (!token)
            return;
        if (wsRef.current?.readyState === WebSocket.OPEN)
            return;
        const ws = new WebSocket(`${SERVER_URL}/ws?token=${token}`);
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
            setConnected(false);
            reconnectTimer.current = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                switch (msg.type) {
                    case "transcript":
                        setState((prev) => ({ ...prev, transcript: msg.text || "" }));
                        break;
                    case "question":
                        setState((prev) => ({
                            ...prev,
                            question: msg.text || "",
                            isAwaitingFirstChunk: true,
                            answer: "",
                            statusLabel: "THINKING",
                        }));
                        break;
                    case "answer_chunk":
                        setState((prev) => ({
                            ...prev,
                            answer: prev.answer + (msg.text || ""),
                            isStreaming: true,
                            isAwaitingFirstChunk: false,
                            statusLabel: "ANSWERING",
                        }));
                        break;
                    case "answer_done":
                        setState((prev) => ({ ...prev, isStreaming: false, statusLabel: "READY" }));
                        break;
                    case "paused":
                        setState((prev) => ({ ...prev, isPaused: true, statusLabel: "PAUSED" }));
                        break;
                    case "resumed":
                        setState((prev) => ({ ...prev, isPaused: false, statusLabel: "READY" }));
                        break;
                }
            }
            catch { }
        };
    }, [token]);
    const send = useCallback((type, payload) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type, ...payload }));
        }
    }, []);
    const requestAnswer = useCallback(() => send("request_answer"), [send]);
    const togglePause = useCallback(() => send(state.isPaused ? "resume" : "pause"), [send, state.isPaused]);
    const retry = useCallback(() => send("retry"), [send]);
    const sendFollowUp = useCallback((text) => send("followup", { text }), [send]);
    useEffect(() => {
        connect();
        return () => {
            if (reconnectTimer.current)
                clearTimeout(reconnectTimer.current);
            wsRef.current?.close();
        };
    }, [connect]);
    return { state, connected, requestAnswer, togglePause, retry, sendFollowUp };
}
