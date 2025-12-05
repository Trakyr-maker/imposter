const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Spiel-Datenstrukturen
const lobbies = new Map();
const playerSockets = new Map(); // socketId -> playerInfo

// Wort-Kategorien
const WORD_CATEGORIES = {
  tiere: ['Elefant', 'Giraffe', 'Delfin', 'Schmetterling', 'Adler', 'Löwe', 'Pinguin', 'Krokodil', 'Tiger', 'Panda'],
  objekte: ['Buch', 'Lampe', 'Schirm', 'Brille', 'Telefon', 'Gitarre', 'Kamera', 'Uhr', 'Stuhl', 'Tisch'],
  orte: ['Strand', 'Bibliothek', 'Restaurant', 'Museum', 'Flughafen', 'Park', 'Kino', 'Bahnhof', 'Schule', 'Krankenhaus'],
  aktivitaeten: ['Tanzen', 'Schwimmen', 'Kochen', 'Malen', 'Singen', 'Lesen', 'Joggen', 'Klettern', 'Schlafen', 'Wandern'],
  essen: ['Pizza', 'Sushi', 'Schokolade', 'Erdbeere', 'Kaffee', 'Pasta', 'Burger', 'Salat', 'Kuchen', 'Eis']
};

// Hilfsfunktionen
function generateLobbyCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomWord(category, customWords = null) {
  if (customWords && customWords.length > 0) {
    return customWords[Math.floor(Math.random() * customWords.length)];
  }
  const words = WORD_CATEGORIES[category] || WORD_CATEGORIES.tiere;
  return words[Math.floor(Math.random() * words.length)];
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Hilfsfunktion: Lobby-Objekt für Socket.io-Übertragung vorbereiten
function sanitizeLobby(lobby) {
  const { turnTimer, ...cleanLobby } = lobby;
  return cleanLobby;
}

// Static Files
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io Events
io.on('connection', (socket) => {
  console.log(`Neue Verbindung: ${socket.id}`);

  // Lobby erstellen
  socket.on('create-lobby', ({ playerName, settings }) => {
    const lobbyCode = generateLobbyCode();
    const player = {
      id: socket.id,
      name: playerName,
      isHost: true,
      ready: true,
      score: 0,
      totalPoints: 0
    };

    const lobby = {
      code: lobbyCode,
      host: socket.id,
      players: [player],
      status: 'waiting', // waiting, playing, voting, results
      settings: settings || {
        wordMode: 'random',
        customWords: [],
        category: 'tiere'
      },
      gameState: null,
      matchCount: 0
    };

    lobbies.set(lobbyCode, lobby);
    playerSockets.set(socket.id, { lobbyCode, playerName });
    socket.join(lobbyCode);

    socket.emit('lobby-created', { lobbyCode, lobby: sanitizeLobby(lobby) });
    console.log(`Lobby ${lobbyCode} erstellt von ${playerName}`);
  });

  // Lobby beitreten
  socket.on('join-lobby', ({ playerName, lobbyCode }) => {
    const lobby = lobbies.get(lobbyCode);

    if (!lobby) {
      socket.emit('error', { message: 'Lobby nicht gefunden' });
      return;
    }

    if (lobby.players.length >= 10) {
      socket.emit('error', { message: 'Lobby ist voll' });
      return;
    }

    // Wenn Spiel läuft, als Spectator joinen
    const isSpectator = lobby.status !== 'waiting';

    const player = {
      id: socket.id,
      name: playerName,
      isHost: false,
      ready: true,
      score: 0,
      totalPoints: 0,
      isSpectator: isSpectator
    };

    lobby.players.push(player);
    playerSockets.set(socket.id, { lobbyCode, playerName });
    socket.join(lobbyCode);

    // Erst dem joiner mitteilen, dann allen anderen
    socket.emit('lobby-joined', { lobby: sanitizeLobby(lobby), isSpectator });
    io.to(lobbyCode).emit('lobby-updated', { lobby: sanitizeLobby(lobby) });
    
    if (isSpectator) {
      io.to(lobbyCode).emit('player-joined-spectator', { playerName });
    }
    
    console.log(`${playerName} ist Lobby ${lobbyCode} beigetreten${isSpectator ? ' (Spectator)' : ''}`);
  });

  // Settings aktualisieren (nur Host)
  socket.on('update-settings', ({ lobbyCode, settings }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.host !== socket.id) return;

    lobby.settings = settings;
    io.to(lobbyCode).emit('lobby-updated', { lobby: sanitizeLobby(lobby) });
  });

  // Spiel starten
  socket.on('start-game', ({ lobbyCode }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.host !== socket.id) return;

    if (lobby.players.length < 3) {
      socket.emit('error', { message: 'Mindestens 3 Spieler erforderlich' });
      return;
    }

    // Wort auswählen
    let selectedWord;
    if (lobby.settings.wordMode === 'custom' && lobby.settings.customWords.length > 0) {
      selectedWord = getRandomWord(null, lobby.settings.customWords);
    } else {
      selectedWord = getRandomWord(lobby.settings.category);
    }

    // Nur aktive Spieler (keine Spectators)
    const activePlayers = lobby.players.filter(p => !p.isSpectator);

    // Imposter zufällig wählen
    const imposterIndex = Math.floor(Math.random() * activePlayers.length);
    const imposter = activePlayers[imposterIndex];

    // Spielerreihenfolge mischen
    const playerOrder = shuffleArray(activePlayers.map(p => p.id));

    lobby.gameState = {
      word: selectedWord,
      imposter: imposter.id,
      currentPlayerIndex: 0,
      playerOrder: playerOrder,
      round: 1,
      submissions: [],
      votes: {},
      voteResults: {},
      eliminated: [],
      phase: 'playing',
      turnStartTime: Date.now(),
      turnTimeLimit: 60000 // 60 Sekunden
    };

    lobby.status = 'playing';

    // Jedem Spieler seine Rolle mitteilen
    lobby.players.forEach(player => {
      if (player.isSpectator) {
        io.to(player.id).emit('game-started', {
          lobby: sanitizeLobby(lobby),
          role: 'spectator',
          word: null
        });
      } else {
        const isImposter = player.id === imposter.id;
        io.to(player.id).emit('game-started', {
          lobby: sanitizeLobby(lobby),
          role: isImposter ? 'imposter' : 'player',
          word: isImposter ? null : selectedWord
        });
      }
    });

    console.log(`Spiel in Lobby ${lobbyCode} gestartet. Imposter: ${imposter.name}, Wort: ${selectedWord}`);
    
    // Timer für automatisches Skip starten
    startTurnTimer(lobby, lobbyCode);
  });

  // Timer für Spielerzug
  function startTurnTimer(lobby, lobbyCode) {
    if (lobby.turnTimer) {
      clearTimeout(lobby.turnTimer);
    }

    lobby.turnTimer = setTimeout(() => {
      const gameState = lobby.gameState;
      if (!gameState || lobby.status !== 'playing') return;

      const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
      const currentPlayer = lobby.players.find(p => p.id === currentPlayerId);
      
      // Automatisch leeres Wort einreichen
      const submission = {
        playerId: currentPlayerId,
        playerName: currentPlayer ? currentPlayer.name : 'Unbekannt',
        word: '[Übersprungen]',
        round: gameState.round
      };

      gameState.submissions.push(submission);

      // Prüfen ob Runde zu Ende
      const roundSubmissions = gameState.submissions.filter(s => s.round === gameState.round);
      const isRoundComplete = roundSubmissions.length === gameState.playerOrder.length;

      if (isRoundComplete) {
        gameState.round++;
        gameState.currentPlayerIndex = 0;

        if (gameState.round > 2) {
          gameState.phase = 'voting';
          lobby.status = 'voting';
        }
      } else {
        gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.playerOrder.length;
      }

      gameState.turnStartTime = Date.now();

      io.to(lobbyCode).emit('game-updated', { lobby: sanitizeLobby(lobby) });
      
      // Nächsten Timer starten wenn Spiel weitergeht
      if (lobby.status === 'playing') {
        startTurnTimer(lobby, lobbyCode);
      }

      console.log(`Timer abgelaufen für ${currentPlayer ? currentPlayer.name : 'Unbekannt'} - Automatisch übersprungen`);
    }, lobby.gameState.turnTimeLimit);
  }

  // Wort einreichen
  socket.on('submit-word', ({ lobbyCode, word }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.status !== 'playing') return;

    const gameState = lobby.gameState;
    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];

    if (currentPlayerId !== socket.id) {
      socket.emit('error', { message: 'Du bist nicht dran!' });
      return;
    }

    // Timer stoppen
    if (lobby.turnTimer) {
      clearTimeout(lobby.turnTimer);
      lobby.turnTimer = null;
    }

    const player = lobby.players.find(p => p.id === socket.id);
    
    // Prüfen ob das Wort bereits in dieser Runde verwendet wurde
    const currentRoundSubmissions = gameState.submissions.filter(s => s.round === gameState.round);
    const isDuplicate = currentRoundSubmissions.some(s => 
      s.word.toLowerCase() === word.trim().toLowerCase()
    );
    
    if (isDuplicate) {
      socket.emit('error', { message: `Das Wort "${word.trim()}" wurde bereits in dieser Runde verwendet!` });
      return;
    }
    
    // Prüfen ob Imposter das richtige Wort eingegeben hat
    const isImposter = socket.id === gameState.imposter;
    if (isImposter && word.trim().toLowerCase() === gameState.word.toLowerCase()) {
      // Imposter hat das Wort erraten während des Spiels - nur Imposter +2
      player.score = (player.score || 0) + 2;
      player.totalPoints = (player.totalPoints || 0) + 2;
      
      endMatch(lobby, lobbyCode, 'imposter', `🎭 Der Imposter ${player.name} hat das Wort "${gameState.word}" erraten! Imposter: +2 Punkte`);
      return;
    }
    
    // Prüfen ob normaler Spieler versehentlich das gesuchte Wort eingegeben hat
    if (!isImposter && word.trim().toLowerCase() === gameState.word.toLowerCase()) {
      // Spieler hat das Wort offenbart - Punktabzug und Runde endet
      player.score = (player.score || 0) - 1;
      player.totalPoints = (player.totalPoints || 0) - 1;
      
      // Runde wird als "offenbart" markiert
      gameState.wordRevealed = true;
      gameState.revealedBy = player.name;
      lobby.status = 'word-revealed';
      
      io.to(lobbyCode).emit('word-revealed', {
        lobby: sanitizeLobby(lobby),
        playerName: player.name,
        word: gameState.word,
        newScore: player.score
      });
      
      console.log(`${player.name} hat das gesuchte Wort "${gameState.word}" offenbart! -1 Punkt`);
      return;
    }
    
    const submission = {
      playerId: socket.id,
      playerName: player.name,
      word: word.trim(),
      round: gameState.round
    };

    gameState.submissions.push(submission);

    // Prüfen ob Runde zu Ende
    const roundSubmissions = gameState.submissions.filter(s => s.round === gameState.round);
    const isRoundComplete = roundSubmissions.length === gameState.playerOrder.length;

    if (isRoundComplete) {
      gameState.round++;
      gameState.currentPlayerIndex = 0;

      // Nach min. 2 Runden -> Voting-Phase
      if (gameState.round > 2) {
        gameState.phase = 'voting';
        lobby.status = 'voting';
      }
    } else {
      gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.playerOrder.length;
    }

    gameState.turnStartTime = Date.now();

    io.to(lobbyCode).emit('game-updated', { lobby: sanitizeLobby(lobby) });
    
    // Nächsten Timer starten wenn Spiel weitergeht
    if (lobby.status === 'playing') {
      startTurnTimer(lobby, lobbyCode);
    }
    
    console.log(`${player.name} hat "${word}" eingereicht (Runde ${submission.round})`);
  });

  // Nach Wort-Offenbarung weiterspielen
  socket.on('continue-after-reveal', ({ lobbyCode }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.host !== socket.id || lobby.status !== 'word-revealed') return;

    const gameState = lobby.gameState;
    
    // Runde beenden und neue Runde starten
    gameState.round++;
    gameState.currentPlayerIndex = 0;
    gameState.wordRevealed = false;
    gameState.revealedBy = null;
    gameState.votes = {};
    gameState.voteResults = {};
    gameState.turnStartTime = Date.now();

    // Nach Runde 2 -> Voting, sonst weiterspielen
    if (gameState.round > 2) {
      gameState.phase = 'voting';
      lobby.status = 'voting';
      io.to(lobbyCode).emit('game-updated', { lobby: sanitizeLobby(lobby) });
    } else {
      lobby.status = 'playing';
      gameState.phase = 'playing';
      io.to(lobbyCode).emit('game-updated', { lobby: sanitizeLobby(lobby) });
      startTurnTimer(lobby, lobbyCode);
    }

    console.log(`Spiel fortsetzt nach Wort-Offenbarung in Lobby ${lobbyCode}, Runde ${gameState.round}`);
  });

  // Vote abgeben
  socket.on('submit-vote', ({ lobbyCode, target }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.status !== 'voting') return;

    const player = lobby.players.find(p => p.id === socket.id);
    
    // Spectators dürfen nicht voten
    if (player && player.isSpectator) {
      socket.emit('error', { message: 'Zuschauer können nicht voten!' });
      return;
    }

    const gameState = lobby.gameState;
    gameState.votes[socket.id] = target;

    // Prüfen ob alle gevotet haben (nur aktive Spieler)
    const activePlayers = lobby.players.filter(p => !p.isSpectator);
    if (Object.keys(gameState.votes).length === activePlayers.length) {
      // Alle haben gevotet - Ergebnisse berechnen
      const voteCounts = {};
      let continueVotes = 0;

      Object.values(gameState.votes).forEach(vote => {
        if (vote === 'CONTINUE') {
          continueVotes++;
        } else {
          voteCounts[vote] = (voteCounts[vote] || 0) + 1;
        }
      });

      // Ergebnisse speichern für Anzeige
      gameState.voteResults = { ...voteCounts, CONTINUE: continueVotes };
      
      io.to(lobbyCode).emit('voting-complete', { lobby: sanitizeLobby(lobby), voteResults: gameState.voteResults });
      
      // Host kann jetzt auswerten
      console.log(`Voting abgeschlossen in Lobby ${lobbyCode}:`, gameState.voteResults);
    } else {
      // Nur Vote-Count update ohne Details
      io.to(lobbyCode).emit('vote-count-updated', { 
        voteCount: Object.keys(gameState.votes).length,
        totalVoters: activePlayers.length
      });
    }
  });

  // Votes auswerten (nur Host)
  socket.on('evaluate-votes', ({ lobbyCode }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.host !== socket.id || lobby.status !== 'voting') return;

    evaluateVotes(lobby, lobbyCode);
  });

  // Votes auswerten
  function evaluateVotes(lobby, lobbyCode) {
    const gameState = lobby.gameState;
    const voteCounts = {};
    let continueVotes = 0;

    Object.values(gameState.votes).forEach(vote => {
      if (vote === 'CONTINUE') {
        continueVotes++;
      } else {
        voteCounts[vote] = (voteCounts[vote] || 0) + 1;
      }
    });

    const maxVotes = Math.max(...Object.values(voteCounts), 0);
    const votedPlayerId = Object.keys(voteCounts).find(id => voteCounts[id] === maxVotes);

    // Nach Runde 3 (also in Runde 4) darf nicht mehr weitergespielt werden
    if (continueVotes > maxVotes && gameState.round <= 3) {
      // Weiterspielen
      gameState.phase = 'playing';
      gameState.votes = {};
      gameState.voteResults = {};
      gameState.currentPlayerIndex = 0;
      gameState.turnStartTime = Date.now();
      lobby.status = 'playing';
      
      io.to(lobbyCode).emit('game-updated', { lobby: sanitizeLobby(lobby) });
      startTurnTimer(lobby, lobbyCode);
      
      console.log(`Runde ${gameState.round} wird weitergespielt in Lobby ${lobbyCode}`);
    } else if (votedPlayerId) {
      // Spieler wurde gevotet
      const votedPlayer = lobby.players.find(p => p.id === votedPlayerId);
      const isImposter = votedPlayerId === gameState.imposter;

      if (isImposter) {
        // Imposter gefunden - letzte Chance für Wort-Raten
        gameState.phase = 'imposter-guess';
        lobby.status = 'imposter-guess';
        io.to(lobbyCode).emit('imposter-revealed', {
          lobby: sanitizeLobby(lobby),
          imposterName: votedPlayer.name,
          needsGuess: true
        });
      } else {
        // Falscher Spieler - Imposter gewinnt
        endMatch(lobby, lobbyCode, 'imposter', `${votedPlayer.name} war nicht der Imposter! Der Imposter ${lobby.players.find(p => p.id === gameState.imposter).name} hat gewonnen!`);
      }
    } else {
      // Keine klare Mehrheit oder nach Runde 4 und CONTINUE gewählt - Unentschieden
      endMatch(lobby, lobbyCode, 'draw', `Keine Entscheidung getroffen! Unentschieden!`);
    }
  }

  // Imposter Rateversuchen
  socket.on('imposter-guess', ({ lobbyCode, guess }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.status !== 'imposter-guess') return;

    const gameState = lobby.gameState;
    if (socket.id !== gameState.imposter) return;

    const isCorrect = guess.toLowerCase().trim() === gameState.word.toLowerCase().trim();

    if (isCorrect) {
      // Imposter hat das Wort erraten - bekommt +2 Punkte, Spieler bekommen +1
      const imposterPlayer = lobby.players.find(p => p.id === gameState.imposter);
      if (imposterPlayer) {
        imposterPlayer.score = (imposterPlayer.score || 0) + 2;
        imposterPlayer.totalPoints = (imposterPlayer.totalPoints || 0) + 2;
      }
      
      // Alle anderen Spieler bekommen +1 Punkt (haben Imposter gefunden)
      lobby.players.forEach(player => {
        if (player.id !== gameState.imposter && !player.isSpectator) {
          player.score = (player.score || 0) + 1;
          player.totalPoints = (player.totalPoints || 0) + 1;
        }
      });
      
      endMatch(lobby, lobbyCode, 'imposter', `Der Imposter hat das Wort "${gameState.word}" erraten! Imposter: +2 Punkte, Spieler: +1 Punkt`);
    } else {
      // Imposter hat falsch geraten - Spieler bekommen +2 Punkte
      lobby.players.forEach(player => {
        if (player.id !== gameState.imposter && !player.isSpectator) {
          player.score = (player.score || 0) + 2;
          player.totalPoints = (player.totalPoints || 0) + 2;
        }
      });
      
      endMatch(lobby, lobbyCode, 'players', `Der Imposter hat falsch geraten! Das Wort war "${gameState.word}". Spieler bekommen +2 Punkte!`);
    }
  });

  // Match beenden
  function endMatch(lobby, lobbyCode, winner, message) {
    lobby.matchCount++;
    lobby.status = 'results';
    
    const isFinal = lobby.matchCount >= 5;

    // Rating-Tracking initialisieren
    if (!lobby.gameState.ratings) {
      lobby.gameState.ratings = {};
    }

    io.to(lobbyCode).emit('match-ended', {
      lobby: sanitizeLobby(lobby),
      winner,
      message,
      isFinal,
      matchCount: lobby.matchCount,
      imposter: lobby.gameState.imposter
    });

    console.log(`Match in Lobby ${lobbyCode} beendet: ${winner} - ${message}`);
  }

  // Punkte vergeben
  socket.on('rate-player', ({ lobbyCode, targetPlayerId, points }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || !lobby.gameState) return;

    // Imposter darf nicht bewerten
    if (socket.id === lobby.gameState.imposter) {
      socket.emit('error', { message: 'Der Imposter darf keine Punkte vergeben!' });
      return;
    }

    // Prüfen ob bereits bewertet
    if (!lobby.gameState.ratings) {
      lobby.gameState.ratings = {};
    }
    
    if (!lobby.gameState.ratings[socket.id]) {
      lobby.gameState.ratings[socket.id] = {};
    }

    if (lobby.gameState.ratings[socket.id][targetPlayerId]) {
      socket.emit('error', { message: 'Du hast diesen Spieler bereits bewertet!' });
      return;
    }

    // Bewertung speichern
    lobby.gameState.ratings[socket.id][targetPlayerId] = points;

    const targetPlayer = lobby.players.find(p => p.id === targetPlayerId);
    if (targetPlayer) {
      targetPlayer.totalPoints = (targetPlayer.totalPoints || 0) + points;
      io.to(lobbyCode).emit('lobby-updated', { lobby: sanitizeLobby(lobby) });
      io.to(lobbyCode).emit('rating-updated', { 
        targetPlayerName: targetPlayer.name,
        points: points,
        newTotal: targetPlayer.totalPoints
      });
    }
  });

  // Nächstes Match
  socket.on('next-match', ({ lobbyCode }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || lobby.host !== socket.id) return;

    // Timer clearen falls noch aktiv
    if (lobby.turnTimer) {
      clearTimeout(lobby.turnTimer);
      lobby.turnTimer = null;
    }

    lobby.status = 'waiting';
    lobby.gameState = null;
    
    // Scores und Spectators zurücksetzen
    lobby.players.forEach(p => {
      p.score = 0;
      p.isSpectator = false;
    });

    io.to(lobbyCode).emit('lobby-updated', { lobby: sanitizeLobby(lobby) });
    // Explizit Screen-Wechsel triggern
    io.to(lobbyCode).emit('return-to-lobby', {});
    console.log(`Zurück zur Lobby ${lobbyCode} - Nächstes Match`);
  });

  // Lobby verlassen
  socket.on('leave-lobby', ({ lobbyCode }) => {
    handlePlayerDisconnect(socket, lobbyCode);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const playerInfo = playerSockets.get(socket.id);
    if (playerInfo) {
      handlePlayerDisconnect(socket, playerInfo.lobbyCode);
    }
    console.log(`Verbindung getrennt: ${socket.id}`);
  });

  function handlePlayerDisconnect(socket, lobbyCode) {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;

    const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    const player = lobby.players[playerIndex];
    const wasHost = lobby.host === socket.id;

    lobby.players.splice(playerIndex, 1);
    playerSockets.delete(socket.id);
    socket.leave(lobbyCode);

    if (lobby.players.length === 0) {
      // Timer clearen
      if (lobby.turnTimer) {
        clearTimeout(lobby.turnTimer);
      }
      // Lobby löschen wenn leer
      lobbies.delete(lobbyCode);
      console.log(`Lobby ${lobbyCode} gelöscht (leer)`);
    } else {
      // Neuen Host bestimmen wenn alter Host gegangen ist
      if (wasHost) {
        // Ersten nicht-Spectator als Host wählen
        const newHost = lobby.players.find(p => !p.isSpectator) || lobby.players[0];
        lobby.host = newHost.id;
        newHost.isHost = true;
        
        // Allen Spielern mitteilen
        io.to(lobbyCode).emit('new-host', { 
          newHostName: newHost.name,
          newHostId: newHost.id
        });
      }

      io.to(lobbyCode).emit('lobby-updated', { lobby: sanitizeLobby(lobby) });
      io.to(lobbyCode).emit('player-left', { playerName: player.name });
      console.log(`${player.name} hat Lobby ${lobbyCode} verlassen${wasHost ? ' (war Host, neuer Host: ' + lobby.players.find(p => p.id === lobby.host)?.name + ')' : ''}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`🎮 Imposter Game Server läuft auf Port ${PORT}`);
  console.log(`🌐 Öffne http://localhost:${PORT} im Browser`);
});
