import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, GameMode, MatchView, RoomSummary, ServerToClientEvents, TileStatus } from '../../shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const LETTER_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_RANK: Record<TileStatus, number> = { absent: 1, present: 2, correct: 3 };
const SESSION_KEY = 'termo-room-session';
interface RoomSession { playerId: string; resumeToken: string; code: string }

function readRoomSession(): RoomSession | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    const legacy = saved ? null : sessionStorage.getItem(SESSION_KEY);
    const value = saved ?? legacy;
    if (!value) return null;
    const session = JSON.parse(value) as RoomSession;
    if (!session.playerId || !session.resumeToken || !session.code) return null;
    if (legacy) localStorage.setItem(SESSION_KEY, legacy);
    return session;
  } catch { return null; }
}

export function App() {
  const socket = useMemo<GameSocket>(() => io({ autoConnect: false }), []);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('termo-theme') === 'light' ? 'light' : 'dark',
  );
  const [match, setMatch] = useState<MatchView | null>(null);
  const matchRef = useRef<MatchView | null>(match);
  const [name, setName] = useState(() => localStorage.getItem('termo-name') ?? '');
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase().slice(0, 5) ?? '');
  const [draft, setDraft] = useState('');
  const [activeTile, setActiveTile] = useState(0);
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState(180);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [gameMode, setGameMode] = useState<GameMode>('TERMO');
  const [durationMinutes, setDurationMinutes] = useState(3);
  const modeDefaultDuration: Record<GameMode, number> = { TERMO: 3, DUETO: 4, QUARTETO: 5 };
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [resuming, setResuming] = useState(Boolean(readRoomSession()));
  const sessionRef = useRef<RoomSession | null>(readRoomSession());
  const resumeInFlight = useRef(false);
  const draftRef = useRef(draft);
  const nameRef = useRef(name);
  draftRef.current = draft; nameRef.current = name;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('termo-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151a17' : '#f5f4ef');
  }, [theme]);

  const themeToggle = <button
    type="button"
    className="theme-toggle"
    onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
    aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
    title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
  ><span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span><span>{theme === 'dark' ? 'Claro' : 'Escuro'}</span></button>;

  useEffect(() => {
    const onState = (state: MatchView) => {
      const previousPhase = matchRef.current?.phase;
      if ((previousPhase === 'playing' && state.phase === 'finished') || (previousPhase === 'finished' && state.phase === 'lobby')) {
        setDraft(''); draftRef.current = ''; setActiveTile(0);
      }
      matchRef.current = state;
      setMatch(state); setResuming(false); setRemaining(Math.ceil(state.remainingMs / 1000)); setNotice('');
    };
    const onRoomsState = (availableRooms: RoomSummary[]) => setRooms(availableRooms);
    const onError = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2800); };
    const resumeRoom = () => {
      const session = sessionRef.current;
      if (!session || !socket.connected || resumeInFlight.current) return;
      resumeInFlight.current = true;
      setResuming(true);
      socket.timeout(5000).emit('room:resume', { playerId: session.playerId, resumeToken: session.resumeToken }, (timeoutError, result) => {
        resumeInFlight.current = false;
        if (timeoutError) {
          setNotice('Reconectando à sala…');
          if (socket.connected) window.setTimeout(resumeRoom, 1000);
          return;
        }
        if (result.error) {
          sessionRef.current = null;
          localStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(SESSION_KEY);
          matchRef.current = null;
          setMatch(null);
          setRoomCode(session.code);
          setResuming(false);
          setNotice(result.error);
          return;
        }
        if (result.state) {
          const previousPhase = matchRef.current?.phase;
          if ((previousPhase === 'playing' && result.state.phase === 'finished') || (previousPhase === 'finished' && result.state.phase === 'lobby')) {
            setDraft(''); draftRef.current = ''; setActiveTile(0);
          }
          matchRef.current = result.state;
          setMatch(result.state);
          setRemaining(Math.ceil(result.state.remainingMs / 1000));
          setResuming(false);
          setNotice('');
        }
      });
    };
    const onConnect = () => { setConnected(true); if (sessionRef.current) resumeRoom(); else setNotice(''); };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      if (sessionRef.current) setNotice('Conexão perdida. Tentando voltar à sala…');
      else if (reason === 'io server disconnect') setNotice('Conexão encerrada pelo servidor.');
    };
    const onConnectError = () => { setConnected(false); };
    const requestRooms = () => { if (socket.connected) socket.emit('rooms:list', setRooms); };
    socket.on('match:state', onState); socket.on('match:error', onError); socket.on('match:notice', onError); socket.on('rooms:state', onRoomsState);
    socket.on('connect', requestRooms);
    const onVisibility = () => { if (document.visibilityState === 'visible' && !socket.connected) socket.connect(); else if (document.visibilityState === 'visible') resumeRoom(); };
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('connect_error', onConnectError);
    document.addEventListener('visibilitychange', onVisibility);
    setConnected(socket.connected);
    if (socket.connected) { resumeRoom(); requestRooms(); }
    else socket.connect();
    return () => { document.removeEventListener('visibilitychange', onVisibility); socket.off('rooms:state', onRoomsState); socket.off('connect', requestRooms); socket.off('match:state', onState); socket.off('match:error', onError); socket.off('match:notice', onError); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error', onConnectError); socket.disconnect(); };
  }, [socket]);

  useEffect(() => {
    if (!match || match.phase !== 'playing' || !match.endsAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((match.endsAt! - Date.now()) / 1000)));
    update(); const id = window.setInterval(update, 250); return () => window.clearInterval(id);
  }, [match?.phase, match?.endsAt]);

  useEffect(() => {
    if (!match) return;

    let active = true;
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      if (!active || document.visibilityState !== 'visible' || wakeLock) return;
      try {
        const lock = await navigator.wakeLock?.request('screen');
        if (!lock) return;
        if (!active) {
          await lock.release();
          return;
        }
        wakeLock = lock;
        lock.addEventListener('release', () => { wakeLock = null; }, { once: true });
      } catch {
        // Wake Lock is optional and may be denied by the browser or device.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void requestWakeLock();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (wakeLock && !wakeLock.released) void wakeLock.release();
      wakeLock = null;
    };
  }, [match !== null]);

  const persistName = () => { const value = name.trim() || 'Jogador'; setName(value); localStorage.setItem('termo-name', value); return value; };
  const createRoom = () => {
    if (!socket.connected) { setNotice('Conectando ao servidor… tente novamente em alguns segundos.'); socket.connect(); return; }
    socket.timeout(5000).emit('room:create', { name: persistName(), gameMode, durationMinutes }, (timeoutError, result) => {
      if (timeoutError) setNotice('O servidor não respondeu. Confira se npm run dev está rodando.');
      else if (result.error) setNotice(result.error);
    else if (result.code && result.playerId && result.resumeToken) {
      const session = { code: result.code, playerId: result.playerId, resumeToken: result.resumeToken };
      sessionRef.current = session; localStorage.setItem(SESSION_KEY, JSON.stringify(session)); setRoomCode(result.code);
    }
    });
  };
  const joinRoom = () => {
    if (!socket.connected) { setNotice('Sem conexão com o servidor. Confira se npm run dev está rodando.'); socket.connect(); return; }
    socket.timeout(5000).emit('room:join', { code: roomCode, name: persistName() }, (timeoutError, result) => {
      if (timeoutError) setNotice('O servidor não respondeu. Tente novamente.');
      else if (result.error) setNotice(result.error);
      else if (result.playerId && result.resumeToken) {
        const session = { code: roomCode, playerId: result.playerId, resumeToken: result.resumeToken };
        sessionRef.current = session; localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
    });
  };

  const setLetter = useCallback((letter: string) => {
    if (!match || match.phase !== 'playing') return;
    const next = [...draftRef.current.padEnd(5, ' ')];
    const index = Math.min(activeTile, 4);
    next[index] = letter.toLocaleUpperCase('pt-BR');
    const value = next.join('').trimEnd(); setDraft(value); draftRef.current = value;
    let nextIndex = index + 1;
    while (nextIndex < 5 && next[nextIndex] !== ' ') nextIndex++;
    setActiveTile(Math.min(nextIndex, 4));
  }, [activeTile, match]);

  const backspace = useCallback(() => {
    if (!match || match.phase !== 'playing') return;
    const next = [...draftRef.current.padEnd(5, ' ')];
    const selected = Math.min(activeTile, 4);
    let index = selected;
    while (index >= 0 && next[index] === ' ') index--;
    if (index < 0) {
      setActiveTile(Math.max(0, selected - 1));
      return;
    }
    next[index] = ' ';
    const value = next.join('').trimEnd();
    setDraft(value); draftRef.current = value; setActiveTile(index);
  }, [activeTile, match]);

  const submitGuess = useCallback(() => {
    if (!match || match.phase !== 'playing') return;
    if ([...draftRef.current].length !== 5) { setNotice('Preencha as cinco letras.'); return; }
    socket.emit('guess:submit', { word: draftRef.current }); setDraft(''); draftRef.current = ''; setActiveTile(0);
  }, [match, socket]);

  const vibrateForVirtualKey = () => {
    if ('vibrate' in navigator) navigator.vibrate(10);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !match || match.phase !== 'playing') return;
      if (/^[a-zA-ZÀ-ÖØ-öø-ÿ]$/u.test(event.key)) { event.preventDefault(); setLetter(event.key); }
      else if (event.key === 'Backspace') { event.preventDefault(); backspace(); }
      else if (event.key === 'Enter') { event.preventDefault(); submitGuess(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [backspace, match, setLetter, submitGuess]);

  const leave = () => { socket.emit('room:leave'); sessionRef.current = null; localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); setResuming(false); setMatch(null); setDraft(''); setRoomCode(''); window.history.replaceState(null, '', '/'); };
  const returnToLobby = () => { setDraft(''); setActiveTile(0); socket.emit('room:return-lobby'); };
  const copyInvite = async () => {
    if (!match) return;
    const link = `${location.origin}/?room=${match.code}`;
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setNotice(`Compartilhe o código ${match.code}`); }
  };

  const boardCount = match?.gameMode === 'QUARTETO' ? 4 : match?.gameMode === 'DUETO' ? 2 : 1;
  const solvedBoards = Array.from({ length: boardCount }, (_, boardIndex) => boardCount > 1 && (match?.guesses ?? []).some((guess) => guess.results?.[boardIndex]?.every((tile) => tile === 'correct')));
  const keyStatuses = useMemo(() => {
    if (match?.gameMode === 'DUETO') {
      const maps = [new Map<string, TileStatus>(), new Map<string, TileStatus>()];
      for (const guess of match.guesses) {
        const resultSets = guess.results ?? [guess.result];
        for (let boardIndex = 0; boardIndex < 2; boardIndex++) {
          const map = maps[boardIndex];
          if (solvedBoards[boardIndex]) {
            for (const letter of guess.word) map.set(letter, 'absent');
            continue;
          }
          for (const [index, letter] of [...guess.word].entries()) {
            const status = resultSets[boardIndex]?.[index];
            const current = map.get(letter);
            if (status && (!current || KEY_RANK[status] > KEY_RANK[current])) map.set(letter, status);
          }
        }
      }
      return maps;
    }
    const map = new Map<string, TileStatus>();
    for (const guess of match?.guesses ?? []) {
      const resultSets = guess.results ?? [guess.result];
      for (const result of resultSets) [...guess.word].forEach((letter, i) => {
        const status = result?.[i];
        const current = map.get(letter);
        if (status && (!current || KEY_RANK[status] > KEY_RANK[current])) map.set(letter, status);
      });
    }
    return map;
  }, [match?.gameMode, match?.guesses, solvedBoards[0], solvedBoards[1]]);

  const formattedTime = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const finished = match?.phase === 'finished';
  const guessLimit = match?.gameMode === 'QUARTETO' ? 9 : match?.gameMode === 'DUETO' ? 7 : 6;

  if (!match && resuming) return <main className="landing"><div className="landing-card"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></div><p className="intro">Reconectando à sua sala…</p>{notice && <div className="toast" role="status">{notice}</div>}</div></main>;
  if (!match) return <main className="landing"><div className="landing-card landing-card-home">
    <div className="landing-brand-row"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span><span className={`connection-status ${connected ? 'is-connected' : ''}`}><i/>{connected ? 'CONECTADO' : 'CONECTANDO'}</span></div>{themeToggle}</div>
    <p className="eyebrow">PALAVRAS EM BOA COMPANHIA</p><h1>Uma palavra.<br/><span>Todo mundo junto.</span></h1>
    <p className="intro">{gameMode === 'QUARTETO' ? 'Descubra quatro palavras com até nove tentativas compartilhadas' : gameMode === 'DUETO' ? 'Descubra duas palavras com até sete tentativas compartilhadas' : 'Descubra a palavra secreta em até seis tentativas'} antes do tempo acabar.</p>
    <label className="field-label" htmlFor="player-name">COMO PODEMOS TE CHAMAR?</label>
    <input id="player-name" className="text-input" maxLength={18} placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} />
    <div className="landing-create-controls">
      <button className="primary-button landing-create-button" onClick={createRoom}>Criar sala <span>↗</span></button>
      <button type="button" className="room-settings-toggle" aria-label="Configurar sala" aria-expanded={roomSettingsOpen} aria-controls="room-settings" onClick={() => setRoomSettingsOpen((open) => !open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="M19 13.5a7 7 0 0 0 0-3l2-1.2-2-3.4-2.2 1a7 7 0 0 0-2.6-1.5L14 3h-4l-.3 2.4A7 7 0 0 0 7 7L4.8 6l-2 3.4 2 1.2a7 7 0 0 0 0 3l-2 1.2 2 3.4L7 17a7 7 0 0 0 2.7 1.5L10 21h4l.3-2.5a7 7 0 0 0 2.5-1.5l2.2 1 2-3.4-2-1.1Z"/></svg>
      </button>
    </div>
    {roomSettingsOpen && <section className="room-settings" id="room-settings" aria-label="Configurações da sala">
      <label className="room-setting"><span>Modo de jogo</span><select value={gameMode} onChange={(event) => { const mode = event.target.value as GameMode; setGameMode(mode); setDurationMinutes(modeDefaultDuration[mode]); }}><option value="TERMO">TERMO</option><option value="DUETO">DUETO</option><option value="QUARTETO">QUARTETO</option></select></label>
      <label className="room-setting"><span>Tempo da rodada</span><select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((minutes) => <option key={minutes} value={minutes}>{minutes} {minutes === 1 ? 'minuto' : 'minutos'}</option>)}</select></label>
    </section>}
    <div className="divider"><span>ou entre com um código</span></div>
    <div className="join-row"><input className="text-input code-input" aria-label="Código da sala" maxLength={5} placeholder="CÓDIGO" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') joinRoom(); }} /><button className="secondary-button" onClick={joinRoom} disabled={roomCode.length !== 5}>Entrar</button></div>
    <section className="available-rooms" aria-label="Salas disponíveis">
      <div className="available-rooms-heading"><h2>Salas abertas</h2><span>{rooms.length}</span></div>
      {rooms.length === 0 ? <p className="rooms-empty">Nenhuma sala por aqui ainda. Crie a primeira!</p> : <div className="available-room-list">{rooms.map((room) => {
        const full = room.playerCount >= room.capacity;
        const status = room.phase === 'lobby' ? 'No lobby' : room.phase === 'playing' ? 'Em partida' : 'Rodada encerrada';
        return <button type="button" className="available-room" key={room.code} onClick={() => { setRoomCode(room.code); if (socket.connected) socket.timeout(5000).emit('room:join', { code: room.code, name: persistName() }, (timeoutError, result) => { if (timeoutError) setNotice('O servidor não respondeu. Tente novamente.'); else if (result.error) setNotice(result.error); else if (result.playerId && result.resumeToken) { const session = { code: room.code, playerId: result.playerId, resumeToken: result.resumeToken }; sessionRef.current = session; localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } }); else socket.connect(); }}>
          <span className="available-room-code">{room.code}</span><span className="available-room-meta"><span>{room.gameMode} · {room.durationMinutes} {room.durationMinutes === 1 ? 'minuto' : 'minutos'}</span><span>{status} · {room.playerCount}/{room.capacity} jogadores</span></span><span className="available-room-action">{full ? 'Cheia' : 'Entrar ↗'}</span>
        </button>;
      })}</div>}
    </section>
    <p className="landing-foot"><span>◷</span> {durationMinutes} {durationMinutes === 1 ? 'minuto' : 'minutos'} <i/> <span>⌁</span> Até 6 tentativas</p>
    {notice && <div className="toast" role="status">{notice}</div>}
  </div><div className="landing-stamp">FEITO PARA<br/>JOGAR JUNTO <span>✳</span></div></main>;

  if (match.phase === 'lobby') {
    const isHost = match.players.find((p) => p.id === match.me)?.isHost;
    return <main className="lobby-page"><header className="topbar"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></div><div className="topbar-actions">{themeToggle}<button className="quiet-button" onClick={leave}>Sair da sala</button></div></header><section className="lobby-card"><div className="lobby-icon">✳</div><p className="eyebrow">SALA DE JOGO</p><h1>Chame a turma.</h1><p className="intro">{isHost ? 'Quando todo mundo estiver pronto, comece a próxima rodada.' : 'Aguardando o anfitrião começar a próxima rodada.'}</p><button className="room-code" onClick={copyInvite} aria-label="Copiar convite"><span>{match.code}</span><small>{copied ? 'COPIADO ✓' : 'TOQUE PARA COPIAR ↗'}</small></button><div className="lobby-settings">{isHost ? <><label className="room-setting"><span>Modo de jogo</span><select value={match.gameMode} onChange={(event) => { const mode = event.target.value as GameMode; socket.emit('room:update-settings', { gameMode: mode, durationMinutes: modeDefaultDuration[mode] }); }}><option value="TERMO">TERMO</option><option value="DUETO">DUETO</option><option value="QUARTETO">QUARTETO</option></select></label><label className="room-setting"><span>Tempo da rodada</span><select value={match.durationMinutes} onChange={(event) => socket.emit('room:update-settings', { gameMode: match.gameMode, durationMinutes: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => { const minutes = index + 1; return <option key={minutes} value={minutes}>{minutes} {minutes === 1 ? 'minuto' : 'minutos'}</option>; })}</select></label></> : <p><b>{match.gameMode}</b> · partidas de {match.durationMinutes} {match.durationMinutes === 1 ? 'minuto' : 'minutos'}</p>}</div><h2>Na sala <span>{match.players.length}</span></h2><div className="player-list">{match.players.map((p, i) => <div className="player-row" key={p.id}><span className={`avatar avatar-${i % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><span>{p.name}{p.id === match.me && <small> · você</small>}</span>{p.isHost && <span className="host-tag">ANFITRIÃO</span>}</div>)}</div>{isHost ? <button className="primary-button" onClick={() => socket.emit('match:start')}>Começar partida <span>↗</span></button> : <div className="waiting-note"><span className="live-dot"/> Aguardando o anfitrião…</div>}<p className="lobby-note">Até 12 jogadores · {match.gameMode === 'QUARTETO' ? 'até 9' : match.gameMode === 'DUETO' ? 'até 7' : 'até 6'} tentativas</p></section>{notice && <div className="toast">{notice}</div>}</main>;
  }

  const me = match.players.find((p) => p.id === match.me);
  const waitingNextRound = match.phase === 'playing' && me?.status === 'waiting';
  const canPlay = !finished && !waitingNextRound && me?.status === 'playing';
  const winner = match.ranking?.find((player) => player.status === 'won');
  if (waitingNextRound) return <main className="lobby-page"><header className="topbar"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></div><div className="topbar-actions">{themeToggle}<button className="quiet-button" onClick={leave}>Sair da sala</button></div></header><section className="lobby-card waiting-card"><div className="lobby-icon">◷</div><p className="eyebrow">RODADA EM ANDAMENTO</p><h1>Você chegou!</h1><p className="intro">Aguarde esta rodada terminar. Você entrará na sala e poderá jogar na próxima.</p><div className="waiting-room-code">SALA <b>{match.code}</b></div><div className="waiting-note"><span className="live-dot"/> Próxima rodada em breve</div></section>{notice && <div className="toast">{notice}</div>}</main>;
  return <main className="game-page"><header className="topbar game-topbar"><button className="brand brand-button" onClick={leave}><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></button><div className={`timer ${remaining <= 30 ? 'timer-urgent' : ''}`}><span>◷</span>{formattedTime}</div><div className="topbar-actions">{themeToggle}<button className="quiet-button share-button" onClick={copyInvite}>{copied ? 'Copiado ✓' : 'Convidar ↗'}</button>{canPlay && <button type="button" className="quiet-button give-up-button" onClick={() => { if (window.confirm('Tem certeza de que deseja desistir desta partida?')) { setDraft(''); socket.emit('match:give-up'); } }}>Desistir</button>}</div></header>
    <div className={`game-layout ${finished ? 'game-layout-finished' : ''}`}><section className="board-column"><div className="match-heading"><span className="live-dot"/> SALA <b>{match.code}</b><span className="heading-sep">·</span> <span>{match.players.length} jogadores</span></div>
      <div className={`boards ${boardCount === 2 ? 'boards-dueto' : boardCount === 4 ? 'boards-quarteto' : ''}`}>{Array.from({ length: boardCount }, (_, boardIndex) => <section className={`board-column ${solvedBoards[boardIndex] ? 'board-solved' : ''}`} key={boardIndex}>
        {boardCount > 1 && <h2 className="dueto-board-label">PALAVRA {boardIndex + 1}{solvedBoards[boardIndex] && <span> ✓</span>}</h2>}
        <div className="board" role="group" aria-label={`Tabuleiro ${boardIndex + 1}, até ${guessLimit} tentativas`}>{Array.from({ length: guessLimit }, (_, row) => {
          const guess = match.guesses[row];
          const results = guess ? (guess.results ?? [guess.result]) : undefined;
          const result = results?.[boardIndex];
          const boardSolvedAtRow = !!result?.every((tile) => tile === 'correct');
          const activeRow = !guess && canPlay && !solvedBoards[boardIndex] && row === match.guesses.length;
          const revealedGuess = guess?.revealedWord ?? guess?.word;
          const letters = guess && result ? [...(revealedGuess ?? guess.word)] : activeRow ? [...draft.padEnd(5, ' ')] : [];
          return <div className={`board-row ${activeRow ? 'active-row' : ''} ${boardSolvedAtRow ? 'board-row-solved' : ''}`} key={row}>{Array.from({ length: 5 }, (_, col) => {
            const letter = letters[col] === ' ' ? '' : letters[col] ?? '';
            const status = result?.[col]; const isActive = activeRow && col === activeTile;
            return <button type="button" aria-label={`Palavra ${boardIndex + 1}, tentativa ${row + 1}, letra ${col + 1}${letter ? `: ${letter}` : ', vazia'}`} aria-pressed={!!isActive} className={`tile ${status ? `tile-${status}` : ''} ${letter && !status ? 'tile-filled' : ''} ${isActive ? 'tile-selected' : ''}`} key={col} onClick={() => { if (activeRow) setActiveTile(col); }}>{letter}</button>;
          })}</div>;
        })}</div>
      </section>)}</div>
      {canPlay ? <section className={`keyboard ${match.gameMode === 'DUETO' ? 'keyboard-dueto' : ''}`} aria-label="Teclado virtual">{LETTER_ROWS.map((row, ri) => <div className="key-row" key={row}>{[...row].map((letter) => {
        if (match.gameMode === 'DUETO') {
          const statuses = keyStatuses as [Map<string, TileStatus>, Map<string, TileStatus>];
          const first = statuses[0].get(letter); const second = statuses[1].get(letter);
          const firstClass = solvedBoards[0] ? (first ? 'absent' : 'neutral') : first ?? 'neutral';
          const secondClass = solvedBoards[1] ? (second ? 'absent' : 'neutral') : second ?? 'neutral';
          return <button key={letter} className={`key key-split key-left-${firstClass} key-right-${secondClass}`} onClick={() => { vibrateForVirtualKey(); setLetter(letter); }}>{letter}</button>;
        }
        const status = (keyStatuses as Map<string, TileStatus>).get(letter);
        return <button key={letter} className={`key ${status ? `key-${status}` : ''}`} onClick={() => { vibrateForVirtualKey(); setLetter(letter); }}>{letter}</button>;
      })}{ri === 1 && <button className="key key-action key-delete" aria-label="Apagar" onClick={() => { vibrateForVirtualKey(); backspace(); }}>⌫</button>}{ri === 2 && <button className="key key-action" onClick={() => { vibrateForVirtualKey(); submitGuess(); }}>↵</button>}</div>)}</section> : <div className="board-spacer"/>}
      <div className="board-caption">{finished ? `A palavra era ${match.solutions?.join(' · ') ?? match.solution}` : canPlay ? boardCount > 1 && solvedBoards.some(Boolean) ? 'PALAVRAS RESOLVIDAS FICAM BLOQUEADAS — CONTINUE NAS OUTRAS' : 'TOQUE EM UMA CASA PARA ESCOLHER ONDE DIGITAR' : 'SUA PARTIDA FOI CONCLUÍDA'}</div>
    </section><aside className={`players-panel ${finished ? 'results-panel' : ''}`}>
      {finished ? <>
        {winner ? <div className="winner-celebration"><span className="fireworks" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/></span><span className="winner-trophy" aria-hidden="true">🏆</span><p className="eyebrow">CAMPEÃO DA RODADA</p><h1>{winner.name}</h1><p className="winner-score">{winner.guessesUsed ?? winner.attempts} {(winner.guessesUsed ?? winner.attempts) === 1 ? 'tentativa' : 'tentativas'} · {((winner.elapsedMs ?? 0) / 1000).toFixed(1)}s</p></div> : <div className="winner-celebration no-winner"><p className="eyebrow">FIM DE JOGO</p><h1>Ninguém descobriu</h1></div>}
        <div className="ranking"><p className="eyebrow">RESULTADO FINAL</p><h2>Placar da rodada</h2><div className="final-ranking">{(match.ranking ?? []).map((player) => <div className={`final-rank-row ${player.status === 'won' ? 'final-rank-finished' : 'final-rank-unfinished'} ${player.rank === 1 ? 'final-rank-winner' : ''}`} key={player.id}><strong>{player.rank ? String(player.rank).padStart(2, '0') : '—'}</strong><span>{player.name}{player.id === match.me && <small> (você)</small>}</span><small>{player.status === 'won' ? `${player.guessesUsed ?? player.attempts} ${(player.guessesUsed ?? player.attempts) === 1 ? 'tentativa' : 'tentativas'} · ${((player.elapsedMs ?? 0) / 1000).toFixed(1)}s` : `Não terminou · ${player.attempts}/${guessLimit}`}</small>{player.rank === 1 && <span className="winner-row-trophy" aria-label="Vencedor">🏆</span>}</div>)}</div></div>
        <p className="revealed-solutions">{boardCount > 1 ? 'Palavras: ' : 'A palavra era: '}{match.solutions?.join(' · ') ?? match.solution}</p>
        <button className="primary-button play-again" onClick={returnToLobby}>Voltar ao lobby <span>↗</span></button>
      </> : <><div className="panel-heading"><div><p className="eyebrow">AO VIVO</p><h2>Na disputa <span>{match.players.length}</span></h2></div><span className="signal">●</span></div>
        <div className="opponent-list">{match.players.map((p, i) => <div className={`opponent-row ${p.id === match.me ? 'is-me' : ''}`} key={p.id}><span className={`avatar avatar-${i % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><div className="opponent-info"><b>{p.name}{p.id === match.me && <small> (você)</small>}</b><span>{p.status === 'won' ? `${p.guessesUsed ?? p.attempts} ${((p.guessesUsed ?? p.attempts) === 1) ? 'tentativa' : 'tentativas'} · ${((p.elapsedMs ?? 0) / 1000).toFixed(1)}s` : p.status === 'lost' ? 'Não terminou' : p.attempts === 0 ? 'Pensando...' : `${p.attempts} de ${guessLimit} tentativas`}</span></div><div className={`attempt-count ${p.status === 'won' ? 'count-won' : ''}`}>{p.rank ? `${p.rank}º` : p.status === 'won' ? '✓' : `${p.attempts}/${guessLimit}`}</div></div>)}</div>
      </>}
    </aside></div>
    {notice && <div className="toast" role="status">{notice}</div>}
  </main>;
}