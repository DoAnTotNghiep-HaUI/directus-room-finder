import { defineEndpoint } from "@directus/extensions-sdk";
import { Server } from "socket.io";
import Busboy from "busboy";
export default defineEndpoint((router, { services, database, getSchema }) => {
  const { ItemsService, FilesService } = services;
  let io = null;

  router.use(async (req, res, next) => {
    if (!io) {
      const httpServer = req.socket?.server;
      if (httpServer) {
        io = new Server(httpServer, {
          path: "/chat-socket",
          cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["Content-Type"],
            credentials: true,
          },
        });

        io.on("connection", (socket) => {
          console.log(`✅ Socket connected: ${socket.id}`);
          socket.on("authenticate", (userId) => {
            socket.userId = userId;
            console.log(`User ${userId} authenticated`);
          });
          socket.on("join", async (conversationId) => {
            try {
              await socket.join(`conversation_${conversationId}`);
              console.log(`✅ Joined conversation: ${conversationId}`);
            } catch (error) {
              console.error(`❌ Error joining conversation: ${error.message}`);
            }
          });
          socket.on("leave_conversation", (conversationId) => {
            socket.leave(conversationId);
          });
          socket.on("send_message", async (msgData, callback) => {
            const {
              conversation,
              sender,
              receiver,
              content,
              type = "text",
              attachments = [],
            } = msgData;

            const schema = await getSchema();

            const messageService = new ItemsService("message", {
              schema,
              knex: database,
            });

            const conversationService = new ItemsService("conversation", {
              schema,
              knex: database,
            });
            console.log("attachments", attachments);
            const newMsg = await messageService.createOne({
              conversation,
              sender,
              receiver,
              content,
              type: attachments.length > 0 ? "file" : "text",
              status: "sent",
              attachments: attachments,
            });

            await conversationService.updateOne(conversation, {
              last_message: newMsg.id,
              last_message_time: newMsg.created_at,
              unread_count: database.raw("unread_count + 1"),
            });

            io?.to(`conversation_${conversation}`).emit("new_message", newMsg);
            callback({ success: true, message: newMsg });
          });

          socket.on("update_status", async ({ messageId, status }) => {
            const schema = await getSchema(); // FIX: await getSchema()

            const messageService = new ItemsService("message", {
              schema,
              knex: database,
            });

            await messageService.updateOne(messageId, { status });

            socket.broadcast.emit("message_status_updated", {
              messageId,
              status,
            });
          });

          socket.on("disconnect", () => {
            console.log(`❌ Socket disconnected: ${socket.id}`);
          });
        });

        console.log("✅ Socket.IO initialized on chat-socket");
      }
    }
    next();
  });

  router.get("/", (req, res) => {
    res.json({ status: "Socket.IO Endpoint Ready aa" });
  });

  return router;
});
