// Spark game rules. The server owns all state; clients only send intents.
const COLORS = ['sun', 'leaf', 'wave', 'ember'];
const HAND_SIZE = 7;
const MAX_PLAYERS = 4;

let nextCardId = 1;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck() {
  const deck = [];
  const add = (color, value) => deck.push({ id: nextCardId++, color, value });
  for (const c of COLORS) {
    add(c, '0');
    for (let n = 1; n <= 9; n++) { add(c, String(n)); add(c, String(n)); }
    for (const v of ['skip', 'draw2', 'gift']) { add(c, v); add(c, v); }
  }
  for (let i = 0; i < 4; i++) { add('wild', 'wild'); add('wild', 'wild4'); }
  return shuffle(deck);
}

function cardPoints(card) {
  if (/^\d$/.test(card.value)) return Number(card.value);
  return card.color === 'wild' ? 50 : 20;
}

function label(card) {
  const names = { skip: 'Skip', draw2: '+2', gift: 'Gift', wild: 'Wild', wild4: 'Wild +4' };
  const v = names[card.value] || card.value;
  return card.color === 'wild' ? v : `${card.color} ${v}`;
}

class GameError extends Error {}

class Room {
  constructor(code) {
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby'; // lobby | play | gift | roundOver
    this.deck = [];
    this.discard = [];
    this.color = null;
    this.turn = 0;
    this.drawnId = null;
    this.round = 0;
    this.winner = null;
    this.log = [];
    this.lastActive = Date.now();
  }

  say(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  player(id) {
    const p = this.players.find(p => p.id === id);
    if (!p) throw new GameError('You are not in this room');
    return p;
  }

  addPlayer(id, name) {
    const existing = this.players.find(p => p.id === id);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = name;
      return existing;
    }
    if (this.phase !== 'lobby') throw new GameError('This game has already started');
    if (this.players.length >= MAX_PLAYERS) throw new GameError('This room is full');
    const p = { id, name, hand: [], score: 0, connected: true, saidLast: false, vulnerable: false };
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    this.say(`${name} joined`);
    return p;
  }

  disconnect(id) {
    const p = this.players.find(p => p.id === id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.players = this.players.filter(x => x.id !== id);
      this.say(`${p.name} left`);
      if (this.hostId === id) this.hostId = this.players[0]?.id || null;
    } else {
      p.connected = false;
    }
  }

  start(byId) {
    if (byId !== this.hostId) throw new GameError('Only the host can start');
    if (this.phase !== 'lobby' && this.phase !== 'roundOver') throw new GameError('A round is in progress');
    if (this.players.length < 2) throw new GameError('Need at least 2 players');

    this.deck = buildDeck();
    this.discard = [];
    for (const p of this.players) {
      p.hand = this.deck.splice(0, HAND_SIZE);
      p.saidLast = false;
      p.vulnerable = false;
    }
    // Never start on a wild.
    while (this.deck[0].color === 'wild') this.deck.push(this.deck.shift());
    const first = this.deck.shift();
    this.discard.push(first);
    this.color = first.color;
    this.turn = this.round % this.players.length;
    this.round++;
    this.drawnId = null;
    this.winner = null;
    this.phase = 'play';
    this.say(`Round ${this.round} begins — ${this.current().name} goes first`);
  }

  current() { return this.players[this.turn]; }
  next(k = 1) { return this.players[(this.turn + k) % this.players.length]; }
  top() { return this.discard[this.discard.length - 1]; }

  canPlay(card) {
    return card.color === 'wild' || card.color === this.color || card.value === this.top().value;
  }

  requireTurn(id, phase = 'play') {
    if (this.phase !== phase) throw new GameError(phase === 'gift' ? 'Not gifting right now' : 'Not playing right now');
    if (this.current().id !== id) throw new GameError("It's not your turn");
    return this.current();
  }

  takeFromHand(p, cardId) {
    const i = p.hand.findIndex(c => c.id === cardId);
    if (i < 0) throw new GameError("You don't have that card");
    return p.hand.splice(i, 1)[0];
  }

  handChanged(p) {
    if (p.hand.length > 1) p.vulnerable = false;
    if (p.hand.length > 2) p.saidLast = false;
  }

  give(p, n) {
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) {
        const top = this.discard.pop();
        this.deck = shuffle(this.discard);
        this.discard = [top];
        if (this.deck.length) this.say('Pile reshuffled');
      }
      if (this.deck.length === 0) break;
      p.hand.push(this.deck.shift());
    }
    this.handChanged(p);
  }

  advance(k) {
    this.turn = (this.turn + k) % this.players.length;
    this.drawnId = null;
  }

  afterShrink(p) {
    if (p.hand.length === 0) { this.endRound(p); return true; }
    if (p.hand.length === 1) p.vulnerable = !p.saidLast;
    return false;
  }

  play(id, cardId, color) {
    const p = this.requireTurn(id);
    if (this.drawnId !== null && cardId !== this.drawnId) throw new GameError('You can only play the card you just drew');
    const card = p.hand.find(c => c.id === cardId);
    if (!card) throw new GameError("You don't have that card");
    if (!this.canPlay(card)) throw new GameError("That card doesn't match");
    if (card.color === 'wild' && !COLORS.includes(color)) throw new GameError('Pick a color');

    this.takeFromHand(p, cardId);
    this.discard.push(card);
    this.color = card.color === 'wild' ? color : card.color;
    this.drawnId = null;
    this.say(`${p.name} played ${label(card)}${card.color === 'wild' ? ` → ${color}` : ''}`);
    if (this.afterShrink(p)) return;

    switch (card.value) {
      case 'skip':
        this.say(`${this.next().name} is skipped`);
        this.advance(2);
        break;
      case 'draw2':
        this.give(this.next(), 2);
        this.say(`${this.next().name} draws 2 and is skipped`);
        this.advance(2);
        break;
      case 'wild4':
        this.give(this.next(), 4);
        this.say(`${this.next().name} draws 4 and is skipped`);
        this.advance(2);
        break;
      case 'gift':
        this.phase = 'gift';
        break;
      default:
        this.advance(1);
    }
  }

  gift(id, cardId) {
    const p = this.requireTurn(id, 'gift');
    const card = this.takeFromHand(p, cardId);
    const to = this.next();
    to.hand.push(card);
    this.handChanged(to);
    this.say(`${p.name} gifted a card to ${to.name}`);
    this.phase = 'play';
    if (this.afterShrink(p)) return;
    this.advance(1);
  }

  draw(id) {
    const p = this.requireTurn(id);
    if (this.drawnId !== null) throw new GameError('You already drew — play it or pass');
    this.give(p, 1);
    const card = p.hand[p.hand.length - 1];
    if (card && this.canPlay(card)) {
      this.drawnId = card.id;
      this.say(`${p.name} drew a card`);
    } else {
      this.say(`${p.name} drew and passed`);
      this.advance(1);
    }
  }

  pass(id) {
    const p = this.requireTurn(id);
    if (this.drawnId === null) throw new GameError('Draw a card first');
    this.say(`${p.name} passed`);
    this.advance(1);
  }

  sayLast(id) {
    const p = this.player(id);
    if (this.phase !== 'play' && this.phase !== 'gift') return;
    if (p.hand.length > 2) throw new GameError('You have too many cards to call that');
    p.saidLast = true;
    if (p.vulnerable) { p.vulnerable = false; }
    this.say(`${p.name}: "Last card!"`);
  }

  catchPlayer(byId, targetId) {
    const by = this.player(byId);
    const t = this.player(targetId);
    if (by === t || !t.vulnerable || t.hand.length !== 1) throw new GameError('Too late!');
    t.vulnerable = false;
    this.give(t, 2);
    this.say(`${by.name} caught ${t.name} — +2 cards!`);
  }

  endRound(w) {
    const pts = this.players.filter(p => p !== w).reduce((s, p) => s + p.hand.reduce((a, c) => a + cardPoints(c), 0), 0);
    w.score += pts;
    this.winner = { id: w.id, name: w.name, points: pts };
    this.phase = 'roundOver';
    this.drawnId = null;
    this.say(`${w.name} wins the round (+${pts})`);
  }

  viewFor(id) {
    const me = this.players.find(p => p.id === id);
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      you: id,
      hand: me ? me.hand : [],
      players: this.players.map(p => ({
        id: p.id, name: p.name, count: p.hand.length, score: p.score,
        connected: p.connected, vulnerable: p.vulnerable, saidLast: p.saidLast,
        hand: this.phase === 'roundOver' ? p.hand : undefined,
      })),
      top: this.discard.length ? this.top() : null,
      color: this.color,
      turnId: this.phase === 'play' || this.phase === 'gift' ? this.current().id : null,
      drawnId: this.current()?.id === id ? this.drawnId : null,
      deckCount: this.deck.length,
      round: this.round,
      winner: this.winner,
      log: this.log.slice(-12),
    };
  }
}

module.exports = { Room, GameError, COLORS };
