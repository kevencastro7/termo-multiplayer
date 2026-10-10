import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, MatchView, ServerToClientEvents, TileStatus } from '../../shared/types';

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
  const [name, setName] = useState(() => localStorage.getItem('termo-name') ?? '');
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase().slice(0, 5) ?? '');
  const [draft, setDraft] = useState('');
  const [activeTile, setActiveTile] = useState(0);
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState(300);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
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
    const onState = (state: MatchView) => { setMatch(state); setResuming(false); setRemaining(Math.ceil(state.remainingMs / 1000)); setNotice(''); };
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
          setMatch(null);
          setRoomCode(session.code);
          setResuming(false);
          setNotice(result.error);
          return;
        }
        if (result.state) {
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
    socket.on('match:state', onState); socket.on('match:error', onError); socket.on('match:notice', onError);
    const onVisibility = () => { if (document.visibilityState === 'visible' && !socket.connected) socket.connect(); else if (document.visibilityState === 'visible') resumeRoom(); };
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('connect_error', onConnectError);
    document.addEventListener('visibilitychange', onVisibility);
    setConnected(socket.connected);
    if (socket.connected) resumeRoom();
    else socket.connect();
    return () => { document.removeEventListener('visibilitychange', onVisibility); socket.off('match:state', onState); socket.off('match:error', onError); socket.off('match:notice', onError); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error', onConnectError); socket.disconnect(); };
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
    socket.timeout(5000).emit('room:create', { name: persistName() }, (timeoutError, result) => {
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

  const keyStatuses = useMemo(() => {
    const map = new Map<string, TileStatus>();
    for (const guess of match?.guesses ?? []) [...guess.word].forEach((letter, i) => {
      const current = map.get(letter); const status = guess.result[i];
      if (!current || KEY_RANK[status] > KEY_RANK[current]) map.set(letter, status);
    });
    return map;
  }, [match?.guesses]);

  const formattedTime = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const finished = match?.phase === 'finished';

  if (!match && resuming) return <main className="landing"><div className="landing-card"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></div><p className="intro">Reconectando à sua sala…</p>{notice && <div className="toast" role="status">{notice}</div>}</div></main>;
  if (!match) return <main className="landing"><div className="landing-card">
    <div className="landing-brand-row"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span><span className={`connection-status ${connected ? 'is-connected' : ''}`}><i/>{connected ? 'CONECTADO' : 'CONECTANDO'}</span></div>{themeToggle}</div>
    <p className="eyebrow">PALAVRAS EM BOA COMPANHIA</p><h1>Uma palavra.<br/><span>Todo mundo junto.</span></h1>
    <p className="intro">Descubra a palavra secreta antes do tempo acabar. Seis tentativas, uma disputa entre amigos.</p>
    <label className="field-label" htmlFor="player-name">COMO PODEMOS TE CHAMAR?</label>
    <input id="player-name" className="text-input" maxLength={18} placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} />
    <button className="primary-button" onClick={createRoom}>Criar uma sala <span>↗</span></button>
    <div className="divider"><span>ou entre com um código</span></div>
    <div className="join-row"><input className="text-input code-input" aria-label="Código da sala" maxLength={5} placeholder="CÓDIGO" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') joinRoom(); }} /><button className="secondary-button" onClick={joinRoom} disabled={roomCode.length !== 5}>Entrar</button></div>
    <p className="landing-foot"><span>◷</span> 5 minutos <i/> <span>⌁</span> Até 6 tentativas</p>
    {notice && <div className="toast" role="status">{notice}</div>}
  </div><div className="landing-stamp">FEITO PARA<br/>JOGAR JUNTO <span>✳</span></div></main>;

  if (match.phase === 'lobby') {
    const isHost = match.players.find((p) => p.id === match.me)?.isHost;
    return <main className="lobby-page"><header className="topbar"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></div><div className="topbar-actions">{themeToggle}<button className="quiet-button" onClick={leave}>Sair da sala</button></div></header><section className="lobby-card"><div className="lobby-icon">✳</div><p className="eyebrow">SALA DE JOGO</p><h1>Chame a turma.</h1><p className="intro">{isHost ? 'Quando todo mundo estiver pronto, comece a próxima rodada.' : 'Aguardando o anfitrião começar a próxima rodada.'}</p><button className="room-code" onClick={copyInvite} aria-label="Copiar convite"><span>{match.code}</span><small>{copied ? 'COPIADO ✓' : 'TOQUE PARA COPIAR ↗'}</small></button><h2>Na sala <span>{match.players.length}</span></h2><div className="player-list">{match.players.map((p, i) => <div className="player-row" key={p.id}><span className={`avatar avatar-${i % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><span>{p.name}{p.id === match.me && <small> · você</small>}</span>{p.isHost && <span className="host-tag">ANFITRIÃO</span>}</div>)}</div>{isHost ? <button className="primary-button" onClick={() => socket.emit('match:start')}>Começar partida <span>↗</span></button> : <div className="waiting-note"><span className="live-dot"/> Aguardando o anfitrião…</div>}<p className="lobby-note">Até 12 jogadores · partidas de 5 minutos</p></section>{notice && <div className="toast">{notice}</div>}</main>;
  }

  const me = match.players.find((p) => p.id === match.me);
  const waitingNextRound = match.phase === 'playing' && me?.status === 'waiting';
  const canPlay = !finished && !waitingNextRound && me?.status === 'playing';
  if (waitingNextRound) return <main className="lobby-page"><header className="topbar"><div className="brand"><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></div><div className="topbar-actions">{themeToggle}<button className="quiet-button" onClick={leave}>Sair da sala</button></div></header><section className="lobby-card waiting-card"><div className="lobby-icon">◷</div><p className="eyebrow">RODADA EM ANDAMENTO</p><h1>Você chegou!</h1><p className="intro">Aguarde esta rodada terminar. Você entrará na sala e poderá jogar na próxima.</p><div className="waiting-room-code">SALA <b>{match.code}</b></div><div className="waiting-note"><span className="live-dot"/> Próxima rodada em breve</div></section>{notice && <div className="toast">{notice}</div>}</main>;
  return <main className="game-page"><header className="topbar game-topbar"><button className="brand brand-button" onClick={leave}><span className="brand-mark">T</span><span>TERMO<span className="brand-dot">.</span></span></button><div className={`timer ${remaining <= 30 ? 'timer-urgent' : ''}`}><span>◷</span>{formattedTime}</div><div className="topbar-actions">{themeToggle}<button className="quiet-button share-button" onClick={copyInvite}>{copied ? 'Copiado ✓' : 'Convidar ↗'}</button></div></header>
    <div className="game-layout"><section className="board-column"><div className="match-heading"><span className="live-dot"/> SALA <b>{match.code}</b><span className="heading-sep">·</span> <span>{match.players.length} jogadores</span></div>
      <div className="board" role="group" aria-label="Tabuleiro de seis tentativas">{Array.from({ length: 6 }, (_, row) => {
        const guess = match.guesses[row]; const activeRow = !guess && canPlay && row === match.guesses.length;
        const revealedGuess = guess?.revealedWord ?? guess?.word;
        const letters = guess ? [...(revealedGuess ?? guess.word)] : activeRow ? [...draft.padEnd(5, ' ')] : [];
        return <div className={`board-row ${activeRow ? 'active-row' : ''}`} key={row}>{Array.from({ length: 5 }, (_, col) => {
          const letter = letters[col] === ' ' ? '' : letters[col] ?? '';
          const status = guess?.result[col]; const isActive = activeRow && col === activeTile;
          return <button type="button" aria-label={`Tentativa ${row + 1}, letra ${col + 1}${letter ? `: ${letter}` : ', vazia'}`} aria-pressed={!!isActive} className={`tile ${status ? `tile-${status}` : ''} ${letter && !status ? 'tile-filled' : ''} ${isActive ? 'tile-selected' : ''}`} key={col} onClick={() => { if (activeRow) setActiveTile(col); }}>{letter}</button>;
        })}</div>;
      })}</div>
      {canPlay ? <section className="keyboard" aria-label="Teclado virtual">{LETTER_ROWS.map((row, ri) => <div className="key-row" key={row}>{[...row].map((letter) => <button key={letter} className={`key ${keyStatuses.has(letter) ? `key-${keyStatuses.get(letter)}` : ''}`} onClick={() => { vibrateForVirtualKey(); setLetter(letter); }}>{letter}</button>)}{ri === 1 && <button className="key key-action key-delete" aria-label="Apagar" onClick={() => { vibrateForVirtualKey(); backspace(); }}>⌫</button>}{ri === 2 && <button className="key key-action" onClick={() => { vibrateForVirtualKey(); submitGuess(); }}>↵</button>}</div>)}</section> : <div className="board-spacer"/>}
      <div className="board-caption">{finished ? `A palavra era ${match.solution}` : canPlay ? 'TOQUE EM UMA CASA PARA ESCOLHER ONDE DIGITAR' : 'SUA PARTIDA FOI CONCLUÍDA'}</div>
    </section><aside className="players-panel"><div className="panel-heading"><div><p className="eyebrow">AO VIVO</p><h2>Na disputa <span>{match.players.length}</span></h2></div><span className="signal">●</span></div>
      <div className="opponent-list">{match.players.map((p, i) => <div className={`opponent-row ${p.id === match.me ? 'is-me' : ''}`} key={p.id}><span className={`avatar avatar-${i % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><div className="opponent-info"><b>{p.name}{p.id === match.me && <small> (você)</small>}</b><span>{p.status === 'won' ? 'Palavra descoberta!' : p.status === 'lost' ? 'Tentativas encerradas' : p.attempts === 0 ? 'Pensando...' : `${p.attempts} de 6 tentativas`}</span></div><div className={`attempt-count ${p.status === 'won' ? 'count-won' : ''}`}>{p.status === 'won' ? '✓' : `${p.attempts}/6`}</div></div>)}</div>
      {finished && match.ranking && <div className="ranking"><p className="eyebrow">RESULTADO FINAL</p><h3>Placar da rodada</h3>{match.ranking.map((p, i) => <div className="rank-row" key={p.id}><strong>{String(i + 1).padStart(2, '0')}</strong><span>{p.name}</span><small>{p.status === 'won' ? `${p.guessesUsed} ${p.guessesUsed === 1 ? 'tentativa' : 'tentativas'} · ${((p.elapsedMs ?? 0) / 1000).toFixed(1)}s` : `Não resolveu · ${p.attempts}/6`}</small></div>)}</div>}
      {finished && <button className="primary-button play-again" onClick={returnToLobby}>Voltar ao lobby <span>↗</span></button>}
    </aside></div>
    {notice && <div className="toast" role="status">{notice}</div>}
  </main>;
}