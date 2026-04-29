const WebSocket = require("ws");

function createRealtimeServer(server) {
  const wss = new WebSocket.Server({ server, path: "/ws" });
  const clients = new Map();

  wss.on("connection", (socket) => {
    clients.set(socket, { patientIds: new Set(), sessionIds: new Set() });

    socket.on("message", (buffer) => {
      let message;
      try {
        message = JSON.parse(buffer.toString());
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON message" }));
        return;
      }

      if (message.type === "subscribe") {
        const subscriptions = clients.get(socket);
        if (message.patientId) subscriptions.patientIds.add(message.patientId);
        if (message.sessionId) subscriptions.sessionIds.add(message.sessionId);
        socket.send(JSON.stringify({ type: "subscribed", patientId: message.patientId, sessionId: message.sessionId }));
        return;
      }

      socket.send(JSON.stringify({ type: "error", error: "Unsupported message type" }));
    });

    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  function broadcastGesture(event) {
    const payload = JSON.stringify({ type: "gesture:event", event });

    for (const [socket, subscriptions] of clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;

      const patientMatch = subscriptions.patientIds.has(event.patientId);
      const sessionMatch = event.sessionId && subscriptions.sessionIds.has(event.sessionId);
      const noFilters = subscriptions.patientIds.size === 0 && subscriptions.sessionIds.size === 0;

      if (patientMatch || sessionMatch || noFilters) {
        socket.send(payload);
      }
    }
  }

  return { wss, broadcastGesture };
}

module.exports = { createRealtimeServer };
