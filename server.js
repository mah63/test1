const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Middleware
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
let currentColor = 'red';

wss.on('connection', (ws) => {
    // Send current color to new client
    ws.send(JSON.stringify({ type: 'color', color: currentColor }));
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'toggle') {
            // Toggle color
            currentColor = currentColor === 'red' ? 'green' : 'red';
            
            // Broadcast to all clients
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ 
                        type: 'color', 
                        color: currentColor 
                    }));
                }
            });
        }
    });
});