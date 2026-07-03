require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { OAuth2Client } = require("google-auth-library");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, sparse: true },
    name: String,
    username: { type: String, unique: true, index: true },
    avatarUrl: String,
    mobile: String,
    theme: { type: String, default: "green" },
    mode: { type: String, default: "dark" },
    wallpaper: String,
  },
  { timestamps: true }
);

const conversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastMessageAt: Date,
    lastMessageText: String,
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: String,
    sticker: String,
    attachment: {
      url: String,
      type: String,
      name: String,
      size: Number,
    },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Conversation = mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);

let mongoConnection;

async function connectMongo(req, res, next) {
  try {
    if (!mongoConnection) {
      mongoConnection = mongoose.connect(process.env.MONGODB_URI);
    }
    await mongoConnection;
    next();
  } catch (error) {
    res.status(500).json({ error: "Database connection failed" });
  }
}

app.use("/api", connectMongo);

function sign(user) {
  return jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

async function makeUsername(seed) {
  const base = String(seed || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 14) || "user";
  for (let i = 0; i < 20; i += 1) {
    const suffix = i === 0 ? Math.floor(1000 + Math.random() * 9000) : Math.floor(10000 + Math.random() * 90000);
    const username = `${base}${suffix}`;
    if (!(await User.exists({ username }))) return username;
  }
  return `user${Date.now()}`;
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    mobile: user.mobile,
    theme: user.theme,
    mode: user.mode,
    wallpaper: user.wallpaper,
  };
}

app.get("/api/config", (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || "" });
});

app.post("/api/auth/google", async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(400).json({ error: "Google Client ID is not configured yet" });
  const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  let user = await User.findOne({ googleId: payload.sub });
  if (!user) {
    user = await User.create({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.picture,
      username: await makeUsername(payload.email?.split("@")[0] || payload.name),
    });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post("/api/auth/dev", async (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();
  const name = req.body.name || "Test User";
  const email = req.body.email || `test${Date.now()}@local.dev`;
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({ email, name, username: await makeUsername(name), avatarUrl: "" });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get("/api/me", auth, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json({ user: publicUser(user) });
});

app.patch("/api/me", auth, async (req, res) => {
  const updates = {};
  ["name", "mobile", "theme", "mode", "wallpaper", "avatarUrl"].forEach((key) => {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  });
  if (req.body.username) {
    const username = req.body.username.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "").slice(0, 24);
    if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
    const taken = await User.exists({ username, _id: { $ne: req.userId } });
    if (taken) return res.status(409).json({ error: "Username is already taken" });
    updates.username = username;
  }
  const user = await User.findByIdAndUpdate(req.userId, updates, { new: true });
  res.json({ user: publicUser(user) });
});

app.get("/api/users/search", auth, async (req, res) => {
  const q = String(req.query.q || "").replace(/^@/, "").trim();
  if (q.length < 2) return res.json({ users: [] });
  const users = await User.find({ username: new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), _id: { $ne: req.userId } }).limit(20);
  res.json({ users: users.map(publicUser) });
});

app.get("/api/conversations", auth, async (req, res) => {
  const conversations = await Conversation.find({ participants: req.userId })
    .populate("participants")
    .sort({ lastMessageAt: -1, updatedAt: -1 });
  res.json({
    conversations: conversations.map((chat) => ({
      id: chat._id,
      participants: chat.participants.map(publicUser),
      pinned: chat.pinnedBy.some((id) => id.toString() === req.userId),
      lastMessageAt: chat.lastMessageAt,
      lastMessageText: chat.lastMessageText,
    })),
  });
});

app.post("/api/conversations", auth, async (req, res) => {
  const otherId = req.body.userId;
  let chat = await Conversation.findOne({ participants: { $all: [req.userId, otherId], $size: 2 } });
  if (!chat) chat = await Conversation.create({ participants: [req.userId, otherId] });
  await chat.populate("participants");
  res.json({ conversation: { id: chat._id, participants: chat.participants.map(publicUser) } });
});

app.patch("/api/conversations/:id/pin", auth, async (req, res) => {
  const chat = await Conversation.findOne({ _id: req.params.id, participants: req.userId });
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const hasPin = chat.pinnedBy.some((id) => id.toString() === req.userId);
  chat.pinnedBy = hasPin ? chat.pinnedBy.filter((id) => id.toString() !== req.userId) : [...chat.pinnedBy, req.userId];
  await chat.save();
  res.json({ pinned: !hasPin });
});

app.get("/api/conversations/:id/messages", auth, async (req, res) => {
  const chat = await Conversation.findOne({ _id: req.params.id, participants: req.userId });
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const messages = await Message.find({ conversation: chat._id }).populate("sender").sort({ createdAt: 1 }).limit(200);
  res.json({ messages: messages.map(formatMessage) });
});

app.post("/api/conversations/:id/messages", auth, async (req, res) => {
  const chat = await Conversation.findOne({ _id: req.params.id, participants: req.userId });
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const message = await Message.create({
    conversation: chat._id,
    sender: req.userId,
    text: req.body.text || "",
    sticker: req.body.sticker || "",
    attachment: req.body.attachment || undefined,
  });
  chat.lastMessageAt = new Date();
  chat.lastMessageText = req.body.text || req.body.sticker || req.body.attachment?.name || "Attachment";
  await chat.save();
  await message.populate("sender");
  if (app.locals.io) app.locals.io.to(chat._id.toString()).emit("message:new", formatMessage(message));
  res.json({ message: formatMessage(message) });
});

app.post("/api/upload", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUrl, { resource_type: "auto", folder: "chatsite" });
  res.json({ url: result.secure_url, type: req.file.mimetype, name: req.file.originalname, size: req.file.size });
});

function formatMessage(message) {
  return {
    id: message._id,
    conversation: message.conversation,
    sender: publicUser(message.sender),
    text: message.text,
    sticker: message.sticker,
    attachment: message.attachment,
    createdAt: message.createdAt,
  };
}

module.exports = { app, Conversation, jwt, JWT_SECRET };
