// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

app.use(express.static('public'));

let gameState = {
  host: null,
  players: {},
  started: false,
  voting: null,
  currentEvent: null,
  events: []
};

let rolesData;
let additionalRolesData;
let randomEventsData;
try {
  rolesData = JSON.parse(fs.readFileSync('roles.json')).roles;
  additionalRolesData = JSON.parse(fs.readFileSync('additional_roles.json')).additional_roles;
  randomEventsData = JSON.parse(fs.readFileSync('random_events.json'));
  gameState.events = randomEventsData;
} catch (error) {
  console.error('Błąd podczas odczytu JSON:', error.message);
  process.exit(1);
}

function getRandomPlayer(players) {
  const alivePlayers = Object.keys(players).filter(id => players[id].alive);
  if (alivePlayers.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * alivePlayers.length);
  return players[alivePlayers[randomIndex]].name;
}

function replacePlayerInDescription(description, players) {
  if (description.includes('{gracz}')) {
    const randomPlayer = getRandomPlayer(players);
    return description.replace('{gracz}', randomPlayer || 'Nikt');
  }
  return description;
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      const playerId = data.playerId;

      if (data.type === 'init') {
        if (playerId === gameState.host) {
          ws.send(JSON.stringify({
            type: 'init',
            role: 'host',
            gameState
          }));
        } else if (gameState.players[playerId]) {
          gameState.players[playerId].ws = ws;
          gameState.players[playerId].connected = true;
          ws.send(JSON.stringify({
            type: 'init',
            role: 'player',
            playerName: gameState.players[playerId].name,
            gameState
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'init',
            role: 'new',
            gameState
          }));
        }
        broadcastGameState();
      }

      switch (data.type) {
        case 'join':
          if (gameState.started) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Gra już się rozpoczęła. Nie można dołączyć.'
            }));
            break;
          }
          if (!gameState.players[playerId] && playerId !== gameState.host) {
            gameState.players[playerId] = {
              name: data.name,
              role: null,
              additionalRole: null,
              alive: true,
              ws,
              connected: true,
              manuallyAssigned: false
            };
            broadcastGameState();
          }
          break;

        case 'host':
          if (!gameState.host) {
            gameState.host = playerId;
            delete gameState.players[playerId];
            broadcastGameState();
          }
          break;

        case 'assignRoles':
          if (playerId === gameState.host && !gameState.started) {
            if (data.roles) {
              rolesData = data.roles.map(role => ({
                name: role.name,
                count: parseInt(role.count) || 0,
                description: role.description,
                alignment: role.alignment,
                choose: role.choose || 'number'
              }));
              try {
                fs.writeFileSync('roles.json', JSON.stringify({ roles: rolesData }, null, 2));
              } catch (error) {
                console.error('Błąd podczas zapisu roles.json:', error.message);
              }
            }
            assignRoles(data.manuallyAssignedRoles || []);
            broadcastGameState();
          }
          break;

        case 'start':
          if (playerId === gameState.host && !gameState.started) {
            gameState.started = true;
            broadcastGameState();
          }
          break;

        case 'startVoting':
          if (playerId === gameState.host && gameState.started && !gameState.voting) {
            gameState.voting = {
              duration: data.duration,
              endTime: null,
              serverTime: null,
              votes: {},
              showResults: false
            };
            setTimeout(() => {
              gameState.voting.serverTime = Date.now();
              gameState.voting.endTime = gameState.voting.serverTime + data.duration;
              broadcastGameState();
              broadcastTimerStart(gameState.voting.serverTime);
            }, 1000);
            broadcastGameState();
          }
          break;

        case 'castVote':
          if (gameState.voting && !gameState.voting.showResults && gameState.players[playerId]?.alive && gameState.players[data.targetId]?.alive) {
            gameState.voting.votes[playerId] = data.targetId;
            broadcastGameState();
          }
          break;

        case 'endVoting':
          if (playerId === gameState.host && gameState.voting) {
            gameState.voting.showResults = true;
            broadcastGameState();
          }
          break;

        case 'finishVoting':
          if (playerId === gameState.host && gameState.voting) {
            gameState.voting = null;
            broadcastGameState();
          }
          break;

        case 'kill':
          if (playerId === gameState.host && gameState.players[data.targetId]) {
            gameState.players[data.targetId].alive = false;
            broadcastGameState();
          }
          break;

        case 'revive':
          if (playerId === gameState.host && gameState.players[data.targetId]) {
            gameState.players[data.targetId].alive = true;
            broadcastGameState();
          }
          break;

        case 'changeRole':
          if (playerId === gameState.host && gameState.players[data.targetId]) {
            gameState.players[data.targetId].role = data.newRole || null;
            gameState.players[data.targetId].manuallyAssigned = data.newRole && data.newRole !== 'Brak';
            broadcastGameState();
          }
          break;

        case 'changeAdditionalRole':
          if (playerId === gameState.host && gameState.players[data.targetId]) {
            gameState.players[data.targetId].additionalRole = data.newAdditionalRole || null;
            broadcastGameState();
          }
          break;

        case 'updateRoles':
          if (playerId === gameState.host && !gameState.started) {
            try {
              rolesData = data.roles.map(role => ({
                name: role.name,
                count: parseInt(role.count) || 0,
                description: role.description,
                alignment: role.alignment,
                choose: role.choose || 'number'
              }));
              fs.writeFileSync('roles.json', JSON.stringify({ roles: rolesData }, null, 2));
              broadcastGameState();
            } catch (error) {
              console.error('Błąd podczas zapisu roles.json:', error.message);
            }
          }
          break;

        case 'drawEvent':
          if (playerId === gameState.host) {
            const randomIndex = Math.floor(Math.random() * randomEventsData.length);
            const event = randomEventsData[randomIndex];
            const description = replacePlayerInDescription(event.description, gameState.players);
            gameState.currentEvent = { name: event.name, description };
            broadcastGameState();
          }
          break;

        case 'selectEvent':
          if (playerId === gameState.host && data.eventName) {
            const event = randomEventsData.find(e => e.name === data.eventName);
            if (event) {
              const description = replacePlayerInDescription(event.description, gameState.players);
              gameState.currentEvent = { name: event.name, description };
              broadcastGameState();
            }
          }
          break;

        case 'clearEvent':
          if (playerId === gameState.host) {
            gameState.currentEvent = null;
            broadcastGameState();
          }
          break;

        case 'reset':
          if (playerId === gameState.host) {
            resetGame();
            broadcastReset();
          }
          break;

        default:
          if (data.type !== 'init') {
            console.warn('Nieznany typ wiadomości:', data.type);
          }
      }
    } catch (error) {
      console.error('Błąd podczas przetwarzania wiadomości:', error.message);
    }
  });

  ws.on('close', () => {
    Object.values(gameState.players).forEach(player => {
      if (player.ws === ws) {
        player.connected = false;
      }
    });
    broadcastGameState();
  });
});

function assignRoles(manuallyAssignedRoles) {
  // Resetuj role i manuallyAssigned dla wszystkich graczy
  Object.keys(gameState.players).forEach(playerId => {
    gameState.players[playerId].role = null;
    gameState.players[playerId].additionalRole = null;
    gameState.players[playerId].manuallyAssigned = false;
  });

  // Przydziel ręczne role
  manuallyAssignedRoles.forEach(assignment => {
    if (gameState.players[assignment.playerId]) {
      gameState.players[assignment.playerId].role = assignment.role;
      gameState.players[assignment.playerId].additionalRole = assignment.additionalRole;
      gameState.players[assignment.playerId].manuallyAssigned = true;
    }
  });

  // Znajdź rolę "Mafia" i jej count
  const mafiaRole = rolesData.find(role => role.name === 'Mafia');
  const mafiaCount = mafiaRole ? parseInt(mafiaRole.count) || 0 : 0;
  const manuallyAssignedMafia = manuallyAssignedRoles.filter(assignment => assignment.role === 'Mafia').length;
  let remainingMafiaToAssign = Math.max(0, mafiaCount - manuallyAssignedMafia);

  // Przydziel Mafię losowym graczom
  let availablePlayerIds = Object.keys(gameState.players).filter(id => !gameState.players[id].manuallyAssigned);
  availablePlayerIds = availablePlayerIds.sort(() => Math.random() - 0.5);

  // Sprawdź, czy mamy dość graczy
  if (remainingMafiaToAssign > availablePlayerIds.length) {
    remainingMafiaToAssign = availablePlayerIds.length;
  }

  // Przydziel Mafię
  for (let i = 0; i < remainingMafiaToAssign; i++) {
    const playerId = availablePlayerIds.shift();
    gameState.players[playerId].role = 'Mafia';
    gameState.players[playerId].manuallyAssigned = false;
  }

  // Zbierz pozostałe role (bez "Mafia")
  const otherRoles = [];
  rolesData.forEach((role) => {
    if (role.name !== 'Mafia' && role.count > 0) {
      for (let i = 0; i < role.count; i++) {
        otherRoles.push(role.name);
      }
    }
  });

  // Przemieszaj pozostałe role
  const shuffledOtherRoles = otherRoles.sort(() => Math.random() - 0.5);

  // Przydziel pozostałe role graczom bez roli
  availablePlayerIds.forEach((playerId, index) => {
    gameState.players[playerId].role = shuffledOtherRoles[index] || 'Mieszkaniec';
    gameState.players[playerId].additionalRole = null;
    gameState.players[playerId].manuallyAssigned = false;
  });
}

function resetGame() {
  gameState = {
    host: null,
    players: {},
    started: false,
    voting: null,
    currentEvent: null,
    events: randomEventsData
  };
}

function broadcastGameState() {
  const state = {
    host: gameState.host,
    players: Object.keys(gameState.players).reduce((acc, playerId) => {
      acc[playerId] = {
        name: gameState.players[playerId].name,
        role: gameState.players[playerId].role,
        additionalRole: gameState.players[playerId].additionalRole,
        alive: gameState.players[playerId].alive,
        connected: gameState.players[playerId].connected
      };
      return acc;
    }, {}),
    started: gameState.started,
    roles: rolesData,
    additionalRoles: additionalRolesData,
    voting: gameState.voting,
    currentEvent: gameState.currentEvent,
    events: gameState.events
  };

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', state }));
    }
  });
}

function broadcastTimerStart(serverTime) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'startTimer', serverTime }));
    }
  });
}

function broadcastReset() {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'reset' }));
    }
  });
  broadcastGameState();
}

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});