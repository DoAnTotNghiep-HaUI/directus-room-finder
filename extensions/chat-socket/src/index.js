import { defineEndpoint } from "@directus/extensions-sdk";
import { Server } from "socket.io";
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
            socket.join(`user_${userId}`);
            console.log(`User ${userId} authenticated`);
          });
          socket.on("join", async (conversationId) => {
            try {
              await socket.join(`conversation_${conversationId}`);
              await markMessagesAsRead(conversationId, socket.userId);

              // Phát messages_read để phía NGƯỜI GỬI cập nhật "đã đọc"
              io?.to(`conversation_${conversationId}`).emit("messages_read", {
                conversationId,
                userId: socket.userId, // người vừa đọc
              });

              console.log(`✅ Joined conversation: ${conversationId}`);
            } catch (error) {
              console.error(`❌ Error joining conversation: ${error.message}`);
            }
          });
          socket.on("leave_conversation", (conversationId) => {
            socket.leave(`conversation_${conversationId}`);
          });
          socket.on("send_message", async (msgData, callback) => {
            const trx = await database.transaction();
            try {
              const {
                conversation,
                sender,
                receiver,
                content,
                type,
                attachments = [],
                client_temp_id,
              } = msgData;

              const schema = await getSchema();

              const messageService = new ItemsService("message", {
                schema,
                knex: trx,
              });

              const conversationService = new ItemsService("conversation", {
                schema,
                knex: trx,
              });

              // Tạo message
              const newMsgId = await messageService.createOne({
                conversation,
                sender,
                receiver,
                content,
                type: attachments.length > 0 ? "file" : type || "text",
                status: "sent",
                attachments, // mảng file id
                date_created: new Date().toISOString(),
              });

              // Lấy đầy đủ data để emit
              const newMessageData = await messageService.readOne(newMsgId, {
                fields: ["*", "attachments.*"],
              });

              // Lấy unread_count hiện tại từ DB để cộng chính xác
              const existingConv = await conversationService.readOne(
                conversation
              );

              const nextUnread =
                receiver !== sender
                  ? (existingConv.unread_count || 0) + 1
                  : existingConv.unread_count || 0;

              await conversationService.updateOne(conversation, {
                last_message: newMsgId,
                last_message_time: newMessageData.date_created,
                unread_count: nextUnread,
              });

              // Phát conversation_updated cho cả 2 bên
              const updatedConv = await new ItemsService("conversation", {
                schema,
                knex: trx, // ← Đọc trong transaction
              }).readOne(conversation, {
                fields: [
                  "*",
                  "last_message.*",
                  "participants.*",
                  "participants.directus_users_id.*",
                  "participants.directus_users_id.avatar.*",
                ],
              });

              await trx.commit();

              // Payload phát đi kèm client_temp_id (không lưu DB)
              const payload = { ...newMessageData, client_temp_id };

              // Phát message đầy đủ tới room hội thoại & room người nhận
              io?.to(`conversation_${conversation}`).emit(
                "new_message",
                payload
              );
              io?.to(`user_${receiver}`).emit(
                "conversation_updated",
                updatedConv
              );
              io?.to(`user_${sender}`).emit(
                "conversation_updated",
                updatedConv
              );
              io?.to(`conversation_${conversation}`).emit(
                "conversation_updated",
                updatedConv
              );
              callback?.({ success: true, message: payload });
            } catch (error) {
              await trx.rollback();
              console.error("Error in send_message:", error);
              callback?.({ success: false, error: error.message });
            }
          });

          socket.on("mark_as_read", async (conversationId) => {
            try {
              await markMessagesAsRead(conversationId, socket.userId);
              socket
                .to(`conversation_${conversationId}`)
                .emit("messages_read", {
                  conversationId,
                  userId: socket.userId,
                });
            } catch (error) {
              console.error("Error marking messages as read:", error);
            }
          });

          socket.on("update_status", async ({ messageId, status }) => {
            try {
              const schema = await getSchema();
              const messageService = new ItemsService("message", {
                schema,
                knex: database,
              });

              await messageService.updateOne(messageId, { status });
              socket.broadcast.emit("message_status_updated", {
                messageId,
                status,
              });
            } catch (error) {
              console.error("Error updating message status:", error);
            }
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
  async function markMessagesAsRead(conversationId, userId) {
    const schema = await getSchema();
    const trx = await database.transaction();

    try {
      const conversationService = new ItemsService("conversation", {
        schema,
        knex: trx,
      });

      const messageService = new ItemsService("message", {
        schema,
        knex: trx,
      });

      // Cập nhật trạng thái tin nhắn thành "read"
      await messageService.updateByQuery(
        {
          filter: {
            conversation: { _eq: conversationId },
            receiver: { _eq: userId },
            status: { _eq: "sent" },
          },
        },
        {
          status: "read",
        }
      );

      // Reset unread_count về 0 cho conversation này
      await conversationService.updateOne(conversationId, {
        unread_count: 0,
      });

      // Lấy conversation đã cập nhật và gửi thông báo
      const freshConversationService = new ItemsService("conversation", {
        schema,
        knex: database,
      });
      const updatedConversation = await freshConversationService.readOne(
        conversationId,
        {
          fields: [
            "*",
            "last_message.*",
            "participants.*",
            "participants.directus_users_id.*",
            "participants.directus_users_id.avatar.*",
          ],
        }
      );
      await trx.commit();
      io?.to(`user_${userId}`).emit(
        "conversation_updated",
        updatedConversation
      );
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  router.get("/", (req, res) => {
    res.json({ status: "Socket.IO Endpoint Ready aa" });
  });

  return router;
});
