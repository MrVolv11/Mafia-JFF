//let ws = new WebSocket('ws://192.168.0.163:3000');
let protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
let host = window.location.host;
let ws = new WebSocket(`${protocol}://${host}`);
let playerId = localStorage.getItem('playerId') || Math.random().toString(36).substring(2, 15);
localStorage.setItem('playerId', playerId);
let playerName = null;
let isHost = false;
let gameState = null;
let timerInterval = null;
let currentView = 'join';
let currentModalPlayerId = null;


ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'init', playerId }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'init') {
    gameState = data.gameState;
    isHost = data.role === 'host';
    playerName = data.playerName || null;
    updateUI();
  } else if (data.type === 'update') {
    gameState = data.state;
    isHost = gameState.host === playerId;
    updateUI();
  } else if (data.type === 'reset') {
    playerName = null;
    isHost = false;
    gameState = null;
    currentView = 'join';
    clearInterval(timerInterval);
    timerInterval = null;
    updateUI();
  } else if (data.type === 'error') {
    const errorMessageDiv = document.getElementById('error-message');
    errorMessageDiv.innerHTML = `
      ${data.message}
      <button onclick="document.getElementById('error-message').style.display='none'">OK</button>
    `;
    errorMessageDiv.style.display = 'flex';
  } else if (data.type === 'startTimer') {
    gameState.voting = {
      ...gameState.voting,
      serverTime: data.serverTime,
      endTime: data.serverTime + gameState.voting.duration
    };
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
    updateUI();
  }
};

function joinGame() {
  if (isHost) return;
  const nameInput = document.getElementById('player-name');
  playerName = nameInput.value.trim();
  if (playerName) {
    ws.send(JSON.stringify({ type: 'join', playerId, name: playerName }));
  }
}

function hostGame() {
  ws.send(JSON.stringify({ type: 'host', playerId }));
}

function assignRoles() {
  if (!gameState || gameState.started || playerId !== gameState.host) return;
  const roles = gameState.roles.map(role => {
    const inputElement = document.getElementById(`role-count-${role.name}`);
    const count = role.choose === 'bool'
      ? (inputElement && inputElement.checked ? 1 : 0)
      : (inputElement ? parseInt(inputElement.value) || 0 : 0);
    return {
      name: role.name,
      count,
      description: role.description,
      alignment: role.alignment,
      choose: role.choose || 'number'
    };
  });
  const manuallyAssignedRoles = Object.keys(gameState.players)
    .filter(id => gameState.players[id].role && gameState.players[id].role !== 'Brak' && gameState.players[id].manuallyAssigned)
    .map(id => ({
      playerId: id,
      role: gameState.players[id].role,
      additionalRole: gameState.players[id].additionalRole || null
    }));
  ws.send(JSON.stringify({
    type: 'assignRoles',
    playerId,
    roles,
    manuallyAssignedRoles
  }));
}

function startGame() {
  ws.send(JSON.stringify({ type: 'start', playerId }));
}

function startVoting() {
  if (!gameState || !gameState.started || playerId !== gameState.host) return;
  const minutes = parseInt(document.getElementById('vote-minutes')?.value) || 0;
  const seconds = parseInt(document.getElementById('vote-seconds')?.value) || 0;
  const duration = (minutes * 60 + seconds) * 1000;
  if (duration <= 0) {
    alert('Podaj prawidłowy czas głosowania!');
    return;
  }
  ws.send(JSON.stringify({ type: 'startVoting', playerId, duration }));
}

function castVote(targetId) {
  if (!gameState || !gameState.voting || !gameState.players[playerId]?.alive || gameState.voting.showResults) return;
  ws.send(JSON.stringify({ type: 'castVote', playerId, targetId }));
}

function endVoting() {
  if (playerId !== gameState.host) return;
  ws.send(JSON.stringify({ type: 'endVoting', playerId }));
}

function finishVoting() {
  if (playerId !== gameState.host) return;
  ws.send(JSON.stringify({ type: 'finishVoting', playerId }));
}

function killPlayer(targetId) {
  if (!gameState || playerId !== gameState.host || !gameState.players[targetId]?.alive) return;
  ws.send(JSON.stringify({ type: 'kill', playerId, targetId }));
  closePlayerActionsModal();
}

function revivePlayer(targetId) {
  if (!gameState || playerId !== gameState.host || gameState.players[targetId]?.alive) return;
  ws.send(JSON.stringify({ type: 'revive', playerId, targetId }));
  closePlayerActionsModal();
}

function changeRole(targetId, newRole) {
  if (!gameState || playerId !== gameState.host) return;
  ws.send(JSON.stringify({ type: 'changeRole', playerId, targetId, newRole: newRole || 'Brak' }));
  closePlayerActionsModal();
}

function changeAdditionalRole(targetId, newAdditionalRole) {
  if (!gameState || playerId !== gameState.host) return;
  ws.send(JSON.stringify({ type: 'changeAdditionalRole', playerId, targetId, newAdditionalRole }));
  closePlayerActionsModal();
}

function resetGame() {
  ws.send(JSON.stringify({ type: 'reset', playerId }));
}

function saveRoles() {
  if (!gameState || gameState.started || playerId !== gameState.host) return;
  const roles = gameState.roles.map(role => {
    const inputElement = document.getElementById(`role-count-${role.name}`);
    const count = role.choose === 'bool'
      ? (inputElement && inputElement.checked ? 1 : 0)
      : (inputElement ? parseInt(inputElement.value) || 0 : 0);
    return {
      name: role.name,
      count,
      description: role.description,
      alignment: role.alignment,
      choose: role.choose || 'number'
    };
  });
  ws.send(JSON.stringify({ type: 'updateRoles', playerId, roles }));
}

function openRandomEvents() {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  currentView = 'random-events-view';
  document.getElementById('host-controls').style.display = 'none';
  document.getElementById('random-events-view').style.display = 'block';
  loadEventsList();
  updateHostEventMessage();
}

function drawRandomEvent() {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  ws.send(JSON.stringify({ type: 'drawEvent', playerId }));
}

function selectEvent(eventName) {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  if (eventName) {
    ws.send(JSON.stringify({ type: 'selectEvent', playerId, eventName }));
  }
}

function loadEventsList() {
  const eventsList = document.getElementById('events-list');
  if (!eventsList || !gameState?.events) return;
  eventsList.innerHTML = '<option value="">Wybierz wydarzenie</option>' + 
    gameState.events.map(event => `<option value="${event.name}">${event.name}</option>`).join('');
}

function clearEventMessage() {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  ws.send(JSON.stringify({ type: 'clearEvent', playerId }));
}

function backToHost() {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  currentView = 'host-controls';
  document.getElementById('random-events-view').style.display = 'none';
  document.getElementById('host-controls').style.display = 'block';
  document.getElementById('host-event-message').innerHTML = '';
}

function openDiceRoll() {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  currentView = 'dice-roll-view';
  document.getElementById('host-controls').style.display = 'none';
  document.getElementById('dice-roll-view').style.display = 'block';
  document.getElementById('dice-result').innerHTML = '';
}

function rollDice() {
  if (!gameState || playerId !== gameState.host || currentView !== 'dice-roll-view') return;
  const result = Math.floor(Math.random() * 6) + 1;
  document.getElementById('dice-result').innerHTML = `Wynik rzutu: ${result}`;
}

function backToHostFromDice() {
  if (!gameState || playerId !== gameState.host || !gameState.started) return;
  currentView = 'host-controls';
  document.getElementById('dice-roll-view').style.display = 'none';
  document.getElementById('host-controls').style.display = 'block';
  document.getElementById('dice-result').innerHTML = '';
}

function setupCardInteraction() {
  const card = document.getElementById('role-card');
  card.onmousedown = (e) => {
    e.preventDefault();
    if (!card.classList.contains('disabled')) showRole();
  };
  card.onmouseup = (e) => {
    e.preventDefault();
    if (!card.classList.contains('disabled')) hideRole();
  };
  card.ontouchstart = (e) => {
    e.preventDefault();
    if (!card.classList.contains('disabled')) showRole();
  };
  card.ontouchend = (e) => {
    e.preventDefault();
    if (!card.classList.contains('disabled')) hideRole();
  };
}

function showRole() {
  const card = document.getElementById('role-card');
  const roleInfo = document.getElementById('role-info');
  if (!gameState || !gameState.started || !playerName || !gameState.players[playerId]) {
    roleInfo.innerHTML = 'Brak roli lub gry!';
    roleInfo.style.display = 'block';
    card.classList.add('flipped');
    return;
  }
  if (!gameState.players[playerId].alive) {
    roleInfo.innerHTML = 'Jesteś martwy!';
    roleInfo.style.display = 'block';
    card.classList.add('flipped');
    return;
  }
  const role = gameState.players[playerId].role || 'Mieszkaniec';
  const additionalRole = gameState.players[playerId].additionalRole;
  const roleData = gameState.roles.find(r => r.name === role) || { description: 'Zwykły mieszkaniec bez zdolności.' };
  let text = `<div><strong>Rola: ${role}</strong><br><span>${roleData.description}</span></div>`;
  if (additionalRole) {
    const additionalRoleData = gameState.additionalRoles.find(r => r.name === additionalRole) || { description: 'Brak opisu.' };
    text += `<div><strong>Dodatkowa rola: ${additionalRole}</strong><br><span>${additionalRoleData.description}</span></div>`;
  }
  roleInfo.innerHTML = text;
  roleInfo.style.display = 'block';
  card.classList.add('flipped');
}

function hideRole() {
  const card = document.getElementById('role-card');
  card.classList.remove('flipped');
}

function toggleRolesMenu() {
  if (!gameState || !gameState.started) return;
  const rolesMenu = document.getElementById('roles-menu');
  rolesMenu.style.display = rolesMenu.style.display === 'block' ? 'none' : 'block';
}

function openPlayerActionsModal(playerId) {
  if (!gameState || !isHost || !gameState.players[playerId]) return;
  currentModalPlayerId = playerId;
  const player = gameState.players[playerId];
  const modal = document.getElementById('player-actions-modal');
  const modalPlayerName = document.getElementById('modal-player-name');
  const modalPlayerInfo = document.getElementById('modal-player-info');
  const modalMainRole = document.getElementById('modal-main-role');
  const modalAdditionalRole = document.getElementById('modal-additional-role');
  const modalKillButton = document.getElementById('modal-kill-button');
  const modalReviveButton = document.getElementById('modal-revive-button');
  modalPlayerName.innerHTML = `<span class="player-name">${player.name}</span>`;
  modalPlayerInfo.innerHTML = `
    <div>Gracz: <span class="player-name">${player.name}</span></div>
    <div>Rola: ${player.role || 'Brak'}</div>
    <div>Dodatkowa rola: ${player.additionalRole || 'Brak'}</div>
    <div>Stan: ${player.alive ? 'Żywy' : 'Martwy'}</div>
    <div>Połączony: ${player.connected ? 'Tak' : 'Nie'}</div>
  `;
  modalMainRole.innerHTML = `
    <option value="">Zmień rolę</option>
    ${gameState.roles.map(role => `<option value="${role.name}" ${player.role === role.name ? 'selected' : ''}>${role.name}</option>`).join('')}
    <option value="Mieszkaniec" ${player.role === 'Mieszkaniec' ? 'selected' : ''}>Mieszkaniec</option>
    <option value="Brak" ${player.role === 'Brak' || !player.role ? 'selected' : ''}>Brak</option>
  `;
  modalAdditionalRole.innerHTML = `
    <option value="">${player.additionalRole ? 'Usuń' : 'Wybierz'}</option>
    ${gameState.additionalRoles.map(role => `<option value="${role.name}" ${player.additionalRole === role.name ? 'selected' : ''}>${role.name}</option>`).join('')}
  `;
  modalKillButton.disabled = !player.alive;
  modalReviveButton.disabled = player.alive;
  modalMainRole.onchange = () => changeRole(playerId, modalMainRole.value);
  modalAdditionalRole.onchange = () => changeAdditionalRole(playerId, modalAdditionalRole.value);
  modalKillButton.onclick = () => killPlayer(playerId);
  modalReviveButton.onclick = () => revivePlayer(playerId);
  modal.style.display = 'flex';
}

function closePlayerActionsModal() {
  document.getElementById('player-actions-modal').style.display = 'none';
  currentModalPlayerId = null;
}

function updatePlayerEventMessage() {
  const playerEventMessage = document.getElementById('player-event-message');
  if (gameState?.currentEvent && currentView !== 'random-events-view') {
    const { name, description } = gameState.currentEvent;
    const text = `<div><strong>${name}</strong><br><span>${description.replace(/(Gracz \w+)/g, '<span class="player-name">$1</span>')}</span></div>`;
    playerEventMessage.innerHTML = text;
    playerEventMessage.style.display = 'block';
  } else {
    playerEventMessage.innerHTML = '';
    playerEventMessage.style.display = 'none';
  }
}

function updateHostEventMessage() {
  const hostEventMessage = document.getElementById('host-event-message');
  const randomEventMessage = document.getElementById('random-event-message');
  if (gameState?.currentEvent && isHost) {
    const { name, description } = gameState.currentEvent;
    const text = `<div><strong>${name}</strong><br><span>${description.replace(/(Gracz \w+)/g, '<span class="player-name">$1</span>')}</span></div>`;
    if (currentView === 'random-events-view') {
      randomEventMessage.innerHTML = text;
      randomEventMessage.style.display = 'block';
      hostEventMessage.innerHTML = '';
      hostEventMessage.style.display = 'none';
    } else {
      hostEventMessage.innerHTML = text;
      hostEventMessage.style.display = 'block';
      randomEventMessage.innerHTML = '';
      randomEventMessage.style.display = 'none';
    }
  } else {
    hostEventMessage.innerHTML = '';
    hostEventMessage.style.display = 'none';
    randomEventMessage.innerHTML = '';
    randomEventMessage.style.display = 'none';
  }
}

function getPlayerRowClass(player) {
  if (!player.alive) return 'dead';
  if (!player.role && !player.additionalRole) return '';
  const mainRoleAlignment = player.role === 'Mieszkaniec'
    ? 'good'
    : gameState.roles.find(r => r.name === player.role)?.alignment || 'good';
  const additionalRoleAlignment = player.additionalRole
    ? gameState.additionalRoles.find(r => r.name === player.additionalRole)?.alignment
    : null;
  if (mainRoleAlignment === 'bad') return 'bad';
  if (additionalRoleAlignment === 'bad' && mainRoleAlignment === 'good') return 'mixed';
  return mainRoleAlignment === 'good' ? 'good' : 'bad';
}

function updatePlayerCount() {
  const playerCountDiv = document.getElementById('player-count');
  if (gameState && !gameState.started && isHost) {
    const playerCount = Object.keys(gameState.players).length;
    playerCountDiv.textContent = `Graczy: ${playerCount}`;
  } else {
    playerCountDiv.textContent = '';
  }
}

function updateAliveDeadCount() {
  const aliveDeadCountDiv = document.getElementById('alive-dead-count');
  if (gameState && gameState.started) {
    const aliveCount = Object.values(gameState.players).filter(p => p.alive).length;
    const deadCount = Object.values(gameState.players).filter(p => !p.alive).length;
    aliveDeadCountDiv.textContent = `Żywi: ${aliveCount} | Martwi: ${deadCount}`;
  } else {
    aliveDeadCountDiv.textContent = '';
  }
}

function updateTimer() {
  if (!gameState?.voting || !gameState.voting.endTime) {
    clearInterval(timerInterval);
    timerInterval = null;
    return;
  }
  const votingTimer = document.getElementById('voting-timer');
  const timeLeft = Math.max(0, Math.floor((gameState.voting.endTime - Date.now()) / 1000));
  if (timeLeft <= 0 && !gameState.voting.showResults) {
    if (isHost) {
      endVoting();
    }
    votingTimer.innerHTML = 'Głosowanie zakończone';
    clearInterval(timerInterval);
    timerInterval = null;
  } else if (!gameState.voting.showResults) {
    votingTimer.innerHTML = `Pozostały czas: ${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`;
  }
}

function updateUI() {
  const container = document.querySelector('.container');
  const joinSection = document.getElementById('join-section');
  const hostButton = document.getElementById('host-button');
  const hostControls = document.getElementById('host-controls');
  const playerView = document.getElementById('player-view');
  const playerList = document.getElementById('player-list');
  const hostPlayersGrid = document.getElementById('host-players-grid');
  const rolesList = document.getElementById('roles-list');
  const additionalRolesList = document.getElementById('additional-roles-list');
  const lobbyTitle = document.getElementById('lobby-title');
  const playersTitle = document.getElementById('players-title');
  const hostActions = document.getElementById('host-actions');
  const votingView = document.getElementById('voting-view');
  const votingList = document.getElementById('voting-list');
  const votingTimer = document.getElementById('voting-timer');
  const endVotingButton = document.getElementById('end-voting-button');
  const finishVotingButton = document.getElementById('finish-voting-button');
  const voteControls = document.getElementById('vote-controls');
  const randomEventsView = document.getElementById('random-events-view');
  const diceRollView = document.getElementById('dice-roll-view');
  const rolesMenuButton = document.getElementById('roles-menu-button');
  const roleCard = document.getElementById('role-card');

  if (currentView !== 'random-events-view' && currentView !== 'dice-roll-view') {
    container.style.display = 'block';
    playerView.classList.remove('active');
    joinSection.style.display = 'none';
    hostButton.style.display = 'none';
    hostControls.style.display = 'none';
    playerView.style.display = 'none';
    playerList.style.display = 'none';
    lobbyTitle.style.display = 'none';
    playersTitle.style.display = 'none';
    if (hostActions) hostActions.style.display = 'none';
    if (votingView) votingView.style.display = 'none';
    if (voteControls) voteControls.style.display = 'none';
    if (randomEventsView) randomEventsView.style.display = 'none';
    if (diceRollView) diceRollView.style.display = 'none';
    rolesMenuButton.style.display = 'none';
  }

  if (!gameState) {
    currentView = 'join';
    container.style.display = 'block';
    joinSection.style.display = 'flex';
    hostButton.style.display = 'block';
    lobbyTitle.style.display = 'block';
    playerList.innerHTML = '';
    updatePlayerCount();
    updateAliveDeadCount();
    updatePlayerEventMessage();
    updateHostEventMessage();
    return;
  }

  if (gameState.voting) {
    currentView = 'voting';
    container.style.display = 'block';
    votingView.style.display = 'block';
    if (gameState.voting.showResults) {
      clearInterval(timerInterval);
      timerInterval = null;
      votingTimer.innerHTML = 'Wyniki głosowania';
    } else {
      const timeLeft = gameState.voting.endTime
        ? Math.max(0, Math.floor((gameState.voting.endTime - Date.now()) / 1000))
        : Math.floor(gameState.voting.duration / 1000);
      votingTimer.innerHTML = `Pozostały czas: ${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`;
    }

    const voteCounts = {};
    Object.keys(gameState.players).forEach(id => {
      if (gameState.players[id].alive) {
        voteCounts[id] = Object.values(gameState.voting.votes).filter(voteId => voteId === id).length;
      }
    });
    const maxVotes = Math.max(...Object.values(voteCounts));
    const playersWithMaxVotes = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);
    const isTied = playersWithMaxVotes.length > 1;

    votingList.innerHTML = Object.keys(gameState.players)
      .filter(id => gameState.players[id].alive)
      .map(id => {
        const player = gameState.players[id];
        const voted = gameState.voting.votes[playerId] === id;
        const voteCount = voteCounts[id] || 0;
        let resultClass = '';
        if (gameState.voting.showResults) {
          if (voteCount === maxVotes && !isTied) {
            resultClass = 'max-votes';
          } else if (voteCount === maxVotes && isTied) {
            resultClass = 'tied';
          } else {
            resultClass = 'results';
          }
        }
        return `
          <li class="${voted && !gameState.voting.showResults ? 'voted' : ''} ${resultClass}" 
              onclick="castVote('${id}')" 
              ${gameState.voting.showResults || !gameState.players[playerId]?.alive ? 'style="cursor: not-allowed;"' : ''}>
            <span class="player-name">${player.name}</span>${gameState.voting.showResults ? ` (${voteCount} głosów)` : ''}
          </li>
        `;
      })
      .join('');
    endVotingButton.style.display = isHost && !gameState.voting.showResults ? 'block' : 'none';
    finishVotingButton.style.display = isHost && gameState.voting.showResults ? 'block' : 'none';
  } else if (isHost && currentView !== 'random-events-view' && currentView !== 'dice-roll-view') {
    currentView = 'host-controls';
    container.style.display = 'block';
    hostControls.style.display = 'block';
    hostActions.style.display = gameState.started ? 'none' : 'block';
    voteControls.style.display = gameState.started ? 'block' : 'none';
    document.getElementById('random-events-button').style.display = gameState.started ? 'inline-block' : 'none';
    document.getElementById('dice-roll-button').style.display = gameState.started ? 'inline-block' : 'none';
    document.getElementById('start-button').disabled = gameState.started;
    document.getElementById('assign-roles-button').disabled = gameState.started;
    if (!gameState.started) {
      document.getElementById('roles-config').innerHTML = gameState.roles
        .map(role => `
          <label>
            ${role.name}:
            ${
              role.choose === 'bool'
                ? `<input type="checkbox" id="role-count-${role.name}" ${role.count === 1 ? 'checked' : ''}>`
                : `<input type="number" id="role-count-${role.name}" value="${role.count}" min="0">`
            }
          </label>
        `)
        .join('');
    } else {
      document.getElementById('roles-config').innerHTML = '';
    }
    hostPlayersGrid.innerHTML = Object.keys(gameState.players).length
      ? Object.keys(gameState.players)
          .map(id => {
            const player = gameState.players[id];
            const rowClass = getPlayerRowClass(player);
            const additionalRoleText = player.additionalRole ? `, ${player.additionalRole}` : '';
            return `
              <div class="player-cell ${rowClass} ${player.connected ? '' : 'offline'}" onclick="openPlayerActionsModal('${id}')">
                <span class="player-name">${player.name}</span>${player.connected ? '' : ' (Offline)'}: ${player.role || 'Brak'}${additionalRoleText}
              </div>
            `;
          })
          .join('')
      : '<div>Brak graczy</div>';
  } else if (!playerName && !gameState.started) {
    currentView = 'join';
    container.style.display = 'block';
    joinSection.style.display = 'flex';
    hostButton.style.display = gameState.host ? 'none' : 'block';
    lobbyTitle.style.display = 'block';
    playersTitle.style.display = 'block';
    playerList.style.display = 'block';
    playerList.innerHTML = Object.keys(gameState.players).length
      ? Object.keys(gameState.players)
          .map(id => `<li><span class="player-name">${gameState.players[id].name}</span>${gameState.players[id].connected ? '' : ' (Offline)'}</li>`)
          .join('')
      : '';
  } else if (playerName && !gameState.started) {
    currentView = 'lobby';
    container.style.display = 'block';
    lobbyTitle.style.display = 'block';
    playersTitle.style.display = 'block';
    playerList.style.display = 'block';
    playerList.innerHTML = Object.keys(gameState.players).length
      ? Object.keys(gameState.players)
          .map(id => `<li><span class="player-name">${gameState.players[id].name}</span>${gameState.players[id].connected ? '' : ' (Offline)'}</li>`)
          .join('')
      : '';
  } else if (gameState.started && playerName) {
    currentView = 'player-view';
    container.style.display = 'none';
    playerView.style.display = 'block';
    playerView.classList.add('active');
    rolesMenuButton.style.display = 'block';
    if (!gameState.players[playerId]?.alive) {
      roleCard.classList.add('disabled');
      document.getElementById('role-info').innerHTML = 'Jesteś martwy!';
      document.getElementById('role-info').style.display = 'block';
      document.getElementById('roles-menu').style.display = 'none';
    } else {
      roleCard.classList.remove('disabled');
      document.getElementById('role-info').style.display = 'none';
    }
    rolesList.innerHTML = gameState.roles
      .map(role => `<li><strong>${role.name}</strong>: ${role.description}</li>`)
      .join('');
    additionalRolesList.innerHTML = gameState.additionalRoles
      .map(role => `<li><strong>${role.name}</strong>: ${role.description}</li>`)
      .join('');
  }

  updatePlayerCount();
  updateAliveDeadCount();
  updatePlayerEventMessage();
  updateHostEventMessage();
}

document.addEventListener('DOMContentLoaded', () => {
  setupCardInteraction();
});