import { io as ioClient, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const url = (import.meta as any).env?.VITE_SOCKET_URL || window.location.origin;
  socket = ioClient(url, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    withCredentials: true,
  });
  socket.on("connect", () => {
    console.log("[socket.io] connect", socket?.id);
  });
  socket.on("connect_error", (err) => {
    console.log("[socket.io] connect_error", err?.message || err);
  });
  socket.on("disconnect", (reason) => {
    console.log("[socket.io] disconnect", reason);
  });
  return socket;
}
