const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", waiting: waitingQueue.length, active: activeRooms.size }));
    return;
  }
  res.writeHead(200);
  res.end("Chat server running");
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const waitingQueue = [];
const activeRooms = new Map(); // socketId -> { room, partner }

function findMatch(socket) {
  while (waitingQueue.length > 0) {
    const partner = waitingQueue.shift();
    if (partner.connected && partner.id !== socket.id) {
      const room = `room_${socket.id}_${partner.id}`;
      socket.join(room);
      partner.join(room);
      activeRooms.set(socket.id, { room, partner: partner.id });
      activeRooms.set(partner.id, { room, partner: socket.id });
      socket.emit("matched", { room });
      partner.emit("matched", { room });
      return true;
    }
  }
  waitingQueue.push(socket);
  socket.emit("waiting");
  return false;
}

function disconnectPair(socket) {
  const info = activeRooms.get(socket.id);
  if (!info) return;
  const partnerSocket = io.sockets.sockets.get(info.partner);
  socket.leave(info.room);
  activeRooms.delete(socket.id);
  if (partnerSocket) {
    partnerSocket.leave(info.room);
    activeRooms.delete(info.partner);
    partnerSocket.emit("partner-disconnected");
  }
}

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("find-match", () => {
    // Remove from any existing pair first
    disconnectPair(socket);
    // Remove from waiting queue if already there
    const idx = waitingQueue.indexOf(socket);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    findMatch(socket);
  });

  socket.on("send-message", (msg) => {
    const info = activeRooms.get(socket.id);
    if (info) {
      socket.to(info.room).emit("receive-message", {
        text: msg.text,
        time: new Date().toISOString(),
      });
    }
  });

  socket.on("skip", () => {
    disconnectPair(socket);
    findMatch(socket);
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
    const idx = waitingQueue.indexOf(socket);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    disconnectPair(socket);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
