const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Game constants
const GRID_SIZE = 25;
const GAME_SPEED = 100; // ms

// Game state
const gameState = {
  players: {},
  food: generateFood(),
  gridSize: GRID_SIZE,
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
});

// WebSocket setup
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const playerId = generateId();
  console.log(`Player ${playerId} connected`);
  
  // Initialize player
  gameState.players[playerId] = {
    id: playerId,
    name: `Player ${Object.keys(gameState.players).length + 1}`,
    snake: [getRandomPosition()],
    direction: getRandomDirection(),
    nextDirection: null,
    score: 0,
    color: getRandomColor(),
    alive: true
  };

  // Send initial game state
  ws.send(JSON.stringify({
    type: 'init',
    playerId,
    gameState: sanitizeGameState(playerId)
  }));

  // Broadcast new player
  broadcastPlayerUpdate();

  // Start game if not running
  if (!gameState.gameInterval) {
    startGameLoop();
  }

  // Handle messages
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'directionChange' && gameState.players[playerId]) {
      gameState.players[playerId].nextDirection = data.direction;
    }
    if (data.type === 'setName' && gameState.players[playerId]) {
      gameState.players[playerId].name = data.name.substring(0, 15);
      broadcastPlayerUpdate();
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected`);
    delete gameState.players[playerId];
    broadcastPlayerUpdate();
    
    if (Object.keys(gameState.players).length === 0) {
      stopGameLoop();
    }
  });
});

// Game functions
function startGameLoop() {
  gameState.gameInterval = setInterval(updateGame, GAME_SPEED);
  console.log('Game started');
}

function stopGameLoop() {
  clearInterval(gameState.gameInterval);
  gameState.gameInterval = null;
  console.log('Game stopped');
}

function updateGame() {
  // Update directions
  Object.values(gameState.players).forEach(player => {
    if (player.nextDirection && player.alive) {
      player.direction = player.nextDirection;
      player.nextDirection = null;
    }
  });

  // Move snakes
  Object.values(gameState.players).forEach(movePlayer);

  // Check collisions
  checkCollisions();

  // Broadcast state
  broadcast({
    type: 'gameUpdate',
    gameState: sanitizeGameState()
  });
}

function movePlayer(player) {
  if (!player.alive) return;

  const head = {...player.snake[0]};
  
  // Move head
  switch (player.direction) {
    case 'up': head.y -= 1; break;
    case 'down': head.y += 1; break;
    case 'left': head.x -= 1; break;
    case 'right': head.x += 1; break;
  }
  
  // Wrap around
  head.x = (head.x + GRID_SIZE) % GRID_SIZE;
  head.y = (head.y + GRID_SIZE) % GRID_SIZE;
  
  player.snake.unshift(head);
  
  // Check food
  if (head.x === gameState.food.x && head.y === gameState.food.y) {
    player.score += 10;
    gameState.food = generateFood();
  } else {
    player.snake.pop();
  }
}

function checkCollisions() {
  const allSegments = [];
  Object.values(gameState.players).forEach(player => {
    if (player.alive) {
      player.snake.forEach((segment, i) => {
        allSegments.push({...segment, playerId: player.id, isHead: i === 0});
      });
    }
  });

  Object.values(gameState.players).forEach(player => {
    if (!player.alive) return;
    
    const head = player.snake[0];
    const collision = allSegments.find(s => 
      s.x === head.x && s.y === head.y && 
      (s.playerId !== player.id || s.isHead === false)
    );

    if (collision) {
      player.alive = false;
      player.snake.forEach(segment => {
        allSegments.push({...segment, isDead: true});
      });
    }
  });
}

function broadcastPlayerUpdate() {
  broadcast({
    type: 'playersUpdate',
    players: Object.values(gameState.players).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      color: p.color,
      alive: p.alive
    }))
  });
}

function sanitizeGameState(excludePlayerId) {
  return {
    food: gameState.food,
    players: Object.entries(gameState.players).reduce((acc, [id, player]) => {
      if (id !== excludePlayerId) {
        acc[id] = {
          snake: player.snake,
          color: player.color,
          alive: player.alive
        };
      }
      return acc;
    }, {})
  };
}

function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Helper functions
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function getRandomPosition() {
  return {
    x: Math.floor(Math.random() * GRID_SIZE),
    y: Math.floor(Math.random() * GRID_SIZE)
  };
}

function generateFood() {
  let food;
  do {
    food = getRandomPosition();
  } while (Object.values(gameState.players).some(player => 
    player.snake.some(segment => segment.x === food.x && segment.y === food.y)
  ));
  return food;
}

function getRandomDirection() {
  const directions = ['up', 'down', 'left', 'right'];
  return directions[Math.floor(Math.random() * directions.length)];
}

function getRandomColor() {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFBE0B', 
    '#FB5607', '#8338EC', '#3A86FF', '#FF006E'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}