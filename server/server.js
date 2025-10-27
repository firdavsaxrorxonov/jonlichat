const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

let users = new Map();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", ({ name }) => {
    users.set(socket.id, { name });
    io.emit("online-count", users.size);
    console.log(`${name} joined. Online: ${users.size}`);
  });

  socket.on("leave", () => {
    users.delete(socket.id);
    io.emit("online-count", users.size);
  });

  socket.on("disconnect", () => {
    users.delete(socket.id);
    io.emit("online-count", users.size);
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log("✅ Server running on port", PORT));
