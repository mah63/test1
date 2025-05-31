const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Game constants
const GRID_SIZE = 25;
const GAME_SPEED = 100; // Faster game speed for smoother updates
const FOOD_SCORE = 1;

// Game state
const gameState = {
  players: {},
  food: null,
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
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    threshold: 1024,
    concurrencyLimit: 10
  }
});

// Connection handling
wss.on('connection', (ws) => {
  const playerId = generateId();
  console.log(`Player ${playerId} connected`);
  
  // Initialize player
  gameState.players[playerId] = {
    id: playerId,
    name: `Player ${Object.keys(gameState.players).length + 1}`,
    snake: [getRandomPosition()],
    direction: getRandomDirection(),
    pendingDirection: null,
    score: 0,
    color: getRandomColor(),
    alive: true,
    ws: ws // Store WebSocket reference
  };

  // Send initial game state
  sendToPlayer(playerId, {
    type: 'init',
    playerId,
    gameState: getClientGameState(playerId)
  });

  // Broadcast new player to others
  broadcastPlayersUpdate();

  // Start game if not running
  if (!gameState.gameInterval) {
    startGameLoop();
  }

  // Message handling
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'directionChange' && gameState.players[playerId]) {
        // Prevent 180-degree turns
        const currentDirection = gameState.players[playerId].direction;
        if (
          !(currentDirection === 'up' && data.direction === 'down') &&
          !(currentDirection === 'down' && data.direction === 'up') &&
          !(currentDirection === 'left' && data.direction === 'right') &&
          !(currentDirection === 'right' && data.direction === 'left')
        ) {
          gameState.players[playerId].pendingDirection = data.direction;
        }
      }
      else if (data.type === 'setName' && gameState.players[playerId]) {
        gameState.players[playerId].name = data.name.substring(0, 15);
        broadcastPlayersUpdate();
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // Connection cleanup
  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected`);
    if (gameState.players[playerId]) {
      delete gameState.players[playerId];
      broadcastPlayersUpdate();
      
      if (Object.keys(gameState.players).length === 0) {
        stopGameLoop();
      }
    }
  });

  // Error handling
  ws.on('error', (error) => {
    console.error(`WebSocket error for player ${playerId}:`, error);
  });
});

// Game loop functions
function startGameLoop() {
  gameState.gameInterval = setInterval(() => {
    try {
      updateGame();
      broadcastGameState();
    } catch (err) {
      console.error('Game loop error:', err);
    }
  }, GAME_SPEED);
  console.log('Game started');
}

function stopGameLoop() {
  if (gameState.gameInterval) {
    clearInterval(gameState.gameInterval);
    gameState.gameInterval = null;
    console.log('Game stopped');
  }
}

function updateGame() {
  // Update directions from pending inputs
  Object.values(gameState.players).forEach(player => {
    if (player.pendingDirection && player.alive) {
      player.direction = player.pendingDirection;
      player.pendingDirection = null;
    }
  });

  // Move all players
  Object.values(gameState.players).forEach(movePlayer);

  // Check for collisions
  checkCollisions();

  // Check if need to generate new food
  if (!gameState.food || Math.random() < 0.02) {
    gameState.food = generateFood();
  }
}

function movePlayer(player) {
  if (!player.alive) return;

  const head = {...player.snake[0]};
  
  // Move head based on direction
  switch (player.direction) {
    case 'up': head.y -= 1; break;
    case 'down': head.y += 1; break;
    case 'left': head.x -= 1; break;
    case 'right': head.x += 1; break;
  }
  
  // Wrap around grid edges
  head.x = (head.x + GRID_SIZE) % GRID_SIZE;
  head.y = (head.y + GRID_SIZE) % GRID_SIZE;
  
  // Add new head
  player.snake.unshift(head);
  
  // Check if ate food
  if (gameState.food && head.x === gameState.food.x && head.y === gameState.food.y) {
    player.score += FOOD_SCORE;
    gameState.food = generateFood();

    // Send updated score to the player immediately
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: 'scoreUpdate',
        score: player.score
      }));
    }

    // Broadcast updated scores to all clients
    broadcastPlayersUpdate();

  } else {
    // Remove tail if no food eaten
    player.snake.pop();
  }
}

function checkCollisions() {
  const allSegments = [];
  
  // Collect all snake segments
  Object.values(gameState.players).forEach(player => {
    if (player.alive) {
      player.snake.forEach((segment, i) => {
        allSegments.push({
          x: segment.x,
          y: segment.y,
          playerId: player.id,
          isHead: i === 0
        });
      });
    }
  });

  // Check each player for collisions
  Object.values(gameState.players).forEach(player => {
    if (!player.alive) return;
    
    const head = player.snake[0];
    const collision = allSegments.find(segment => 
      segment.x === head.x && 
      segment.y === head.y &&
      (segment.playerId !== player.id || !segment.isHead) // Allow overlapping with own head
    );

    if (collision) {
      player.alive = false;
      // Notify the player who died
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify({
          type: 'gameOver',
          score: player.score
        }));
      }
    }
  });
}

// Communication functions
function broadcastGameState() {
  const gameUpdate = {
    type: 'gameUpdate',
    gameState: getClientGameState()
  };
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(gameUpdate));
      } catch (err) {
        console.error('Error sending game update:', err);
      }
    }
  });
}

function broadcastPlayersUpdate() {
  const playersUpdate = {
    type: 'playersUpdate',
    players: Object.values(gameState.players).map(player => ({
      id: player.id,
      name: player.name,
      score: player.score,
      color: player.color,
      alive: player.alive
    }))
  };
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(playersUpdate));
      } catch (err) {
        console.error('Error sending players update:', err);
      }
    }
  });
}

function sendToPlayer(playerId, message) {
  const player = gameState.players[playerId];
  if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
    try {
      player.ws.send(JSON.stringify(message));
    } catch (err) {
      console.error(`Error sending to player ${playerId}:`, err);
    }
  }
}

function getClientGameState(excludePlayerId) {
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
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    food = getRandomPosition();
    attempts++;
    
    // Check if position is free
    const positionOccupied = Object.values(gameState.players).some(player =>
      player.snake.some(segment => segment.x === food.x && segment.y === food.y)
    );
    
    if (!positionOccupied || attempts >= maxAttempts) {
      break;
    }
  } while (true);
  
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