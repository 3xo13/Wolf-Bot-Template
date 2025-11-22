import { createServer } from 'http';
import { Server } from 'socket.io';
import { WOLF } from 'wolf.js';
const client = new WOLF();
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);
  const loginRes = await client.login({
    token: 'WE-4da5dce4-0081-4bb7-8810-b850ffe2d981',
    host: '92.112.136.200',
    port: '6144'
  });

  const res = await client.channel.list();
  console.log('🚀 ~ loginRes:', loginRes);
  console.log('🚀 ~ res:', res);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    client.logout();
  });

  socket.on('message', (data) => {
    console.log('Received message:', data);
    socket.emit('message', { echo: data });
  });

  socket.onAny((event, ...args) => {
    console.log('Event received:', event, args);
  });
});

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
