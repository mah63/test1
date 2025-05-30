const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Game state
const gameState = {
  players: {},
  food: { x: 0, y: 0 },
  gridSize: 20,
  gameInterval: null
};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Route to serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  // Generate initial food
  generateFood();
});

// WebSocket setup
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substr(2, 9);
  console.log(`Player ${playerId} connected`);
  
  // Initialize player
  gameState.players[playerId] = {
    id: playerId,
    name: `Player ${Object.keys(gameState.players).length + 1}`,
    snake: [{x: 5, y: 5}],
    direction: 'right',
    score: 0,
    color: getRandomColor()
  };

  // Send initial game state to new player
  ws.send(JSON.stringify({
    type: 'init',
    playerId,
    gameState
  }));

  // Broadcast new player to others
  broadcast({
    type: 'playerJoined',
    player: gameState.players[playerId]
  });

  // Start game loop if not already running
  if (!gameState.gameInterval && Object.keys(gameState.players).length > 0) {
    startGameLoop();
  }

  // Handle messages from client
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'directionChange') {
      gameState.players[playerId].direction = data.direction;
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected`);
    delete gameState.players[playerId];
    broadcast({
      type: 'playerLeft',
      playerId
    });
    
    // Stop game if no players left
    if (Object.keys(gameState.players).length === 0) {
      clearInterval(gameState.gameInterval);
      gameState.gameInterval = null;
    }
  });
});

// Helper functions
function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function startGameLoop() {
  gameState.gameInterval = setInterval(() => {
    // Move all snakes
    Object.values(gameState.players).forEach(player => {
      moveSnake(player);
    });
    
    // Check for collisions
    checkCollisions();
    
    // Broadcast updated game state
    broadcast({
      type: 'gameUpdate',
      gameState
    });
  }, 100); // 10 FPS
}

function moveSnake(player) {
  const head = {...player.snake[0]};
  
  // Move head based on direction
  switch (player.direction) {
    case 'up': head.y -= 1; break;
    case 'down': head.y += 1; break;
    case 'left': head.x -= 1; break;
    case 'right': head.x += 1; break;
  }
  
  // Wrap around grid
  if (head.x >= gameState.gridSize) head.x = 0;
  if (head.x < 0) head.x = gameState.gridSize - 1;
  if (head.y >= gameState.gridSize) head.y = 0;
  if (head.y < 0) head.y = gameState.gridSize - 1;
  
  // Add new head
  player.snake.unshift(head);
  
  // Check if snake ate food
  if (head.x === gameState.food.x && head.y === gameState.food.y) {
    player.score += 10;
    generateFood();
  } else {
    // Remove tail if no food eaten
    player.snake.pop();
  }
}

function checkCollisions() {
  // Check for collisions between snakes
  Object.values(gameState.players).forEach(player => {
    const head = player.snake[0];
    
    // Check collision with self
    for (let i = 1; i < player.snake.length; i++) {
      if (head.x === player.snake[i].x && head.y === player.snake[i].y) {
        resetPlayer(player);
      }
    }
    
    // Check collision with other snakes
    Object.values(gameState.players).forEach(otherPlayer => {
      if (player.id !== otherPlayer.id) {
        otherPlayer.snake.forEach(segment => {
          if (head.x === segment.x && head.y === segment.y) {
            resetPlayer(player);
          }
        });
      }
    });
  });
}

function resetPlayer(player) {
  player.snake = [{x: 5, y: 5}];
  player.direction = 'right';
  player.score = Math.max(0, player.score - 5);
}

function generateFood() {
  gameState.food = {
    x: Math.floor(Math.random() * gameState.gridSize),
    y: Math.floor(Math.random() * gameState.gridSize)
  };
}

function getRandomColor() {
  const colors = ['#FF5252', '#4CAF50', '#2196F3', '#FFC107', '#9C27B0'];
  return colors[Math.floor(Math.random() * colors.length)];
}