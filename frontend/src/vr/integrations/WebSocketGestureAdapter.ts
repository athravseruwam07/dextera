import type { VrGestureEvent } from "../types/gesture";

export type GestureAdapter = {
  name: string;
  connect: (onEvent: (event: VrGestureEvent) => void) => () => void;
};

export function createWebSocketGestureAdapter(url: string, patientId?: string): GestureAdapter {
  return {
    name: "websocket",
    connect(onEvent: (event: VrGestureEvent) => void) {
      const socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        if (patientId) {
          socket.send(JSON.stringify({ type: "subscribe", patientId }));
        }
      });

      socket.addEventListener("message", (message) => {
        const payload = JSON.parse(message.data);
        const event = payload.type === "gesture:event" ? payload.event : payload;
        if (!event?.gesture) return;
        onEvent(event);
      });

      return () => socket.close();
    }
  };
}
