import express from 'express';
import { ChatController } from '../../controllers/chatController';

export function createChatRouter(controller: ChatController): express.Router {
  const router = express.Router();

  router.post('/chat', controller.chat.bind(controller));

  return router;
}
