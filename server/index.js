const http = require("http");
const { Server } = require("socket.io");
const { app, Conversation, jwt, JWT_SECRET } = require("./app");

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 5174;
app.locals.io = io;

io.use((socket, next) => {
  try {
    socket.userId = jwt.verify(socket.handshake.auth.token, JWT_SECRET).id;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.on("conversation:join", async (conversationId) => {
    const chat = await Conversation.findOne({ _id: conversationId, participants: socket.userId });
    if (chat) socket.join(conversationId);
  });
});

server.listen(PORT, () => console.log(`Chat app running on http://127.0.0.1:${PORT}`));
