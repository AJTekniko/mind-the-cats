/**
 * "Don't Touch The Cats" — a tiny survival minigame with Korean word typing.
 *
 * Cats drift around the page; if one intersects the pointer, the site explodes.
 * Players must type Korean words (romanized) to eliminate cats before they collide
 * with the cursor.
 * Physics run on a fixed timestep with swept collision so behaviour stays fair
 * regardless of frame rate, and all timing is measured against an "active time"
 * clock that excludes paused, hidden, exploding and game-over intervals.
 */
(() => {
	"use strict";

	const CONFIG = {
		step: 1 / 120, // seconds per physics substep
		maxFrame: 0.1, // clamp of accumulated frame time to avoid teleporting
		catRadius: 34,
		pointerRadius: 12,
		baseSpeed: 170, // px/second at t=0
		speedRamp: 11, // extra px/second for every second survived
		maxSpeed: 620,
		graceSeconds: 1.5,
		spawnEvery: 9, // active seconds between new cats
		maxCats: 7,
		safeSpawnFromPointer: 260,
		safeSpawnFromCat: 120,
		spawnIntroSeconds: 0.9, // cats cannot kill you while fading in
		particleCount: 90,
	};

	const STATE = {
		IDLE: "idle",
		GRACE: "grace",
		RUNNING: "running",
		PAUSED: "paused",
		EXPLODING: "exploding",
		GAME_OVER: "gameover",
	};

	const wordPairs = [
		{ language1: "gage 가게", language2: 'store' },
		{ language1: "gada 가다", language2: 'to go' },
		{ language1: "galeuchida 가르치다", language2: 'to teach' },
		{ language1: "gabang 가방", language2: 'bag' },
		{ language1: "gabyeobda 가볍다", language2: 'to be light' },
		{ language1: "gasu 가수", language2: 'singer' },
		{ language1: "gajog 가족", language2: 'family' },
		{ language1: "gamgi 감기", language2: 'a cold' },
		{ language1: "gamja 감자", language2: 'potato' },
		{ language1: "gae 개", language2: 'dog' },
		{ language1: "geosil 거실", language2: 'living room' },
		{ language1: "geoul 거울", language2: 'mirror' },
		{ language1: "geojismal 거짓말", language2: 'a lie' },
		{ language1: "geongang 건강", language2: 'health' },
		{ language1: "geonneoda 건너다", language2: 'to cross' },
		{ language1: "geodda 걷다", language2: 'to walk' },
		{ language1: "geom-eunsaeg 검은색", language2: 'black' },
		{ language1: "gyeoul 겨울", language2: 'winter' },
		{ language1: "gyeolhon 결혼", language2: 'marriage' },
		{ language1: "gyeongchal 경찰", language2: 'police' },
		{ language1: "gyehoeg 계획", language2: 'plan' },
		{ language1: "gogi 고기", language2: 'meat' },
		{ language1: "goleuda 고르다", language2: 'to pick' },
		{ language1: "goyang-i 고양이", language2: 'cat' },
		{ language1: "gong-won 공원", language2: 'park' },
		{ language1: "gongchaeg 공책", language2: 'notebook' },
		{ language1: "gonghang 공항", language2: 'airport' },
		{ language1: "gwail 과일", language2: 'fruit' },
		{ language1: "gyosil 교실", language2: 'classroom' },
		{ language1: "guleum 구름", language2: 'cloud' }
	];

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

	const dom = {
		shakeRoot: document.getElementById("shakeRoot"),
		catLayer: document.getElementById("catLayer"),
		canvas: document.getElementById("particles"),
		timer: document.getElementById("timer"),
		best: document.getElementById("best"),
		catCount: document.getElementById("catCount"),
		banner: document.getElementById("banner"),
		hint: document.getElementById("hint"),
		overlay: document.getElementById("overlay"),
		finalTime: document.getElementById("finalTime"),
		finalBest: document.getElementById("finalBest"),
		restart: document.getElementById("restart"),
		debris: Array.from(document.querySelectorAll("[data-debris]")),
		bgMusic: document.getElementById("bgMusic"),
		buzzerSound: document.getElementById("buzzerSound"),
		gameOverSound: document.getElementById("gameOverSound"),
		musicToggle: document.getElementById("musicToggle"),
		wordStatus: document.getElementById("wordStatus"),
		statusKorean: document.getElementById("statusKorean"),
		statusWord: document.getElementById("statusWord"),
		statusTranslation: document.getElementById("statusTranslation"),
		statusProgress: document.getElementById("statusProgress"),
	};

	const ctx = dom.canvas.getContext("2d");

	// Audio sources from tgai repository
	const AUDIO_URLS = {
		bgMusic: "https://raw.githubusercontent.com/AJTekniko/mind-the-cats/main/files/bg-music.mp3",
		buzzer: "https://raw.githubusercontent.com/AJTekniko/mind-the-cats/main/files/buzzer.ogg",
		gameOver: "https://raw.githubusercontent.com/AJTekniko/mind-the-cats/main/files/boom.ogg",
	};

	let isMusicPlaying = false;
	let musicStarted = false;

	/** Reads the stored best time, tolerating unavailable or corrupt storage. */
	function loadBest() {
		try {
			const raw = Number(window.localStorage.getItem("cat-game-best-ms"));
			return Number.isFinite(raw) && raw >= 0 ? raw : 0;
		} catch {
			return 0;
		}
	}

	/** Persists the best time, silently ignoring storage failures. */
	function saveBest(ms) {
		try {
			window.localStorage.setItem("cat-game-best-ms", String(Math.round(ms)));
		} catch {
			/* storage unavailable (private mode, blocked cookies) — play on */
		}
	}

	const game = {
		state: STATE.IDLE,
		activeTime: 0, // seconds of gameplay, excluding pauses
		bestMs: loadBest(),
		cats: [],
		particles: [],
		nextSpawnAt: CONFIG.spawnEvery,
		lastFrame: 0,
		accumulator: 0,
		rafId: 0,
		timeouts: new Set(),
		wordList: [...wordPairs],
		currentInput: "",
		activeCat: null, // The cat being typed for (oldest one matching first letter)
	};

	const pointer = {
		x: -9999,
		y: -9999,
		active: false, // inside the window and known
		armed: false, // actually dangerous right now
		isTouch: false,
	};

	/** Initialize audio elements */
	function initAudio() {
		dom.bgMusic.src = AUDIO_URLS.bgMusic;
		dom.bgMusic.volume = 0.3;
		dom.buzzerSound.src = AUDIO_URLS.buzzer;
		dom.buzzerSound.volume = 0.5;
		dom.gameOverSound.src = AUDIO_URLS.gameOver;
		dom.gameOverSound.volume = 0.5;
	}

	/** Start music on first user interaction */
	function startMusic() {
		if (!musicStarted) {
			musicStarted = true;
			isMusicPlaying = true;
			dom.musicToggle.textContent = "🔊";
			dom.bgMusic.currentTime = 0;
			dom.bgMusic.play().catch(() => {
				/* audio play may fail in some contexts */
			});
		}
	}

	/** Toggle background music */
	function toggleMusic() {
		if (isMusicPlaying) {
			dom.bgMusic.pause();
			dom.musicToggle.textContent = "🔇";
			isMusicPlaying = false;
		} else {
			dom.bgMusic.play().catch(() => {
				/* audio play may fail in some contexts */
			});
			dom.musicToggle.textContent = "🔊";
			isMusicPlaying = true;
		}
	}

	/** Play buzzer sound for incorrect input */
	function playBuzzer() {
		dom.buzzerSound.currentTime = 0;
		dom.buzzerSound.play().catch(() => {
			/* audio play may fail in some contexts */
		});
	}

	/** Play game over sound */
	function playGameOverSound() {
		dom.gameOverSound.currentTime = 0;
		dom.gameOverSound.play().catch(() => {
			/* audio play may fail in some contexts */
		});
	}

	/** Speak Korean word using Web Speech API */
	function speakKorean(koreanText) {
		if (!window.speechSynthesis) return;
		
		// Cancel any ongoing speech
		window.speechSynthesis.cancel();
		
		const utterance = new SpeechSynthesisUtterance(koreanText);
		utterance.lang = 'ko-KR';
		utterance.rate = 0.9;
		utterance.pitch = 1;
		
		window.speechSynthesis.speak(utterance);
	}

	/** Normalize text for matching: remove accents, normalize apostrophes, lowercase */
	function normalizeForMatching(text) {
		return text
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
			.replace(/[''`]/g, "'"); // Normalize apostrophes
	}

	/** Extract just the Latin script part and Korean characters from language1 */
	function parseWord(language1) {
		const parts = language1.split(/\s+/);
		const latinWord = parts[0] || "";
		const koreanChars = parts.slice(1).join(" ") || "";
		return { latin: latinWord, korean: koreanChars };
	}

	/** Get random unused word and remove it from the pool */
	function getRandomWord() {
		if (game.wordList.length === 0) {
			game.wordList = [...wordPairs];
		}
		const index = Math.floor(Math.random() * game.wordList.length);
		const word = game.wordList[index];
		game.wordList.splice(index, 1);
		return word;
	}

	/** Registers a timeout so every pending callback can be cancelled on reset. */
	function later(fn, ms) {
		const id = window.setTimeout(() => {
			game.timeouts.delete(id);
			fn();
		}, ms);
		game.timeouts.add(id);
		return id;
	}

	function clearTimeouts() {
		for (const id of game.timeouts) window.clearTimeout(id);
		game.timeouts.clear();
	}

	function formatSeconds(ms) {
		return (ms / 1000).toFixed(2);
	}

	function showBanner(text) {
		dom.banner.textContent = text;
		dom.banner.classList.toggle("visible", Boolean(text));
	}

	const CAT_SVG = `
<svg class="cat-inner" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g class="cat-body">
    <path d="M50 92c-16 0-30-9-30-26 0-8 3-15 3-15l-6-24c-.5-2 1.6-3.6 3.4-2.5L38 32a44 44 0 0 1 24 0l17.6-7.5c1.8-1.1 3.9.5 3.4 2.5l-6 24s3 7 3 15c0 17-14 26-30 26Z" fill="#ffd6ec" stroke="#3b21[...]
    <path d="M22 18c-2-3-4-7-8-9-2-1-4-1-4 2s1 6 3 8c2 2 5 2 8 2M78 18c2-3 4-7 8-9 2-1 4-1 4 2s-1 6-3 8c-2 2-5 2-8 2" fill="#ffd6ec" stroke="#3b2154" stroke-width="1.5"/>
    <circle cx="38" cy="52" r="6" fill="#3b2154"/>
    <circle cx="62" cy="52" r="6" fill="#3b2154"/>
    <circle cx="40" cy="50" r="2" fill="#fff"/>
    <circle cx="64" cy="50" r="2" fill="#fff"/>
    <path d="M50 62c-3 0-5 2-5 4s2 4 5 4 5-2 5-4-2-4-5-4Z" fill="#ff7bb5"/>
    <path d="M22 60h16M22 68h16M62 60h16M62 68h16" stroke="#3b2154" stroke-width="3" stroke-linecap="round"/>
  </g>
</svg>`;

	/** Creates a cat at a position that is fair for the player, then tracks it. */
	function spawnCat() {
		if (game.cats.length >= CONFIG.maxCats) return;

		const spot = findSafeSpawn();
		const angle = Math.random() * Math.PI * 2;
		const el = document.createElement("div");
		el.className = "cat spawning";
		el.innerHTML = CAT_SVG;

		const wordPair = getRandomWord();
		const { latin: latinWord, korean: koreanChars } = parseWord(wordPair.language1);

		// Create word label
		const label = document.createElement("div");
		label.className = "cat-label";
		label.innerHTML = `
			<div class="cat-word">
				<span class="latin-word">${latinWord}</span>
				<span class="korean-chars">${koreanChars}</span>
			</div>
			<div class="cat-translation">${wordPair.language2}</div>
		`;
		el.appendChild(label);

		dom.catLayer.appendChild(el);

		const cat = {
			x: spot.x,
			y: spot.y,
			dirX: Math.cos(angle),
			dirY: Math.sin(angle),
			wobble: Math.random() * Math.PI * 2,
			bornAt: game.activeTime,
			el,
			inner: el.querySelector(".cat-inner"),
			wordLabel: label,
			latinWord: latinWord,
			koreanChars: koreanChars,
			normalizedWord: normalizeForMatching(latinWord),
			translation: wordPair.language2,
			spawnOrder: game.cats.length, // Track spawn order
		};
		game.cats.push(cat);
		later(() => el.classList.remove("spawning"), CONFIG.spawnIntroSeconds * 1000);
		renderCat(cat);
		dom.catCount.textContent = String(game.cats.length);
	}

	/** Picks a spawn point away from the pointer and from other cats. */
	function findSafeSpawn() {
		const pad = CONFIG.catRadius + 10;
		let best = null;
		let bestScore = -Infinity;

		for (let i = 0; i < 40; i += 1) {
			const x = pad + Math.random() * (window.innerWidth - pad * 2);
			const y = pad + Math.random() * (window.innerHeight - pad * 2);
			let score = pointer.active ? Math.hypot(x - pointer.x, y - pointer.y) : Infinity;
			for (const cat of game.cats) {
				score = Math.min(score, Math.hypot(x - cat.x, y - cat.y) * 2);
			}
			if (
				score > bestScore ||
				(!pointer.active && score >= CONFIG.safeSpawnFromCat)
			) {
				bestScore = score;
				best = { x, y };
			}
			if (
				score >= CONFIG.safeSpawnFromPointer &&
				score >= CONFIG.safeSpawnFromCat
			) {
				return { x, y };
			}
		}
		return best || { x: window.innerWidth / 2, y: 80 };
	}

	function currentSpeed() {
		return Math.min(
			CONFIG.maxSpeed,
			CONFIG.baseSpeed + game.activeTime * CONFIG.speedRamp
		);
	}

	/**
	 * Advances one fixed substep: moves cats, reflects them off the viewport
	 * edges with overshoot correction, and reports a swept pointer collision.
	 */
	function stepPhysics(dt) {
		const speed = currentSpeed() * (reduceMotion.matches ? 0.75 : 1);
		const minX = CONFIG.catRadius;
		const minY = CONFIG.catRadius;
		const maxX = Math.max(minX, window.innerWidth - CONFIG.catRadius);
		const maxY = Math.max(minY, window.innerHeight - CONFIG.catRadius);
		let hit = false;

		for (const cat of game.cats) {
			const prevX = cat.x;
			const prevY = cat.y;
			let nextX = cat.x + cat.dirX * speed * dt;
			let nextY = cat.y + cat.dirY * speed * dt;

			// Reflect repeatedly so a big step cannot escape the viewport.
			for (let i = 0; i < 4; i += 1) {
				if (nextX < minX) {
					nextX = minX + (minX - nextX);
					cat.dirX = Math.abs(cat.dirX);
				} else if (nextX > maxX) {
					nextX = maxX - (nextX - maxX);
					cat.dirX = -Math.abs(cat.dirX);
				} else if (nextY < minY) {
					nextY = minY + (minY - nextY);
					cat.dirY = Math.abs(cat.dirY);
				} else if (nextY > maxY) {
					nextY = maxY - (nextY - maxY);
					cat.dirY = -Math.abs(cat.dirY);
				} else {
					break;
				}
			}

			cat.x = clamp(nextX, minX, maxX);
			cat.y = clamp(nextY, minY, maxY);
			cat.wobble += dt * 6;

			const grown = game.activeTime - cat.bornAt >= CONFIG.spawnIntroSeconds;
			if (
				!hit &&
				grown &&
				pointer.armed &&
				game.state === STATE.RUNNING &&
				segmentDistance(prevX, prevY, cat.x, cat.y, pointer.x, pointer.y) <=
					CONFIG.catRadius + CONFIG.pointerRadius
			) {
				hit = true;
			}
		}
		return hit;
	}

	function clamp(value, min, max) {
		return value < min ? min : value > max ? max : value;
	}

	/**
	 * True when a cat is close enough to the pointer that ending the grace
	 * period would be an unavoidable loss; also steers those cats away.
	 */
	function pointerIsCrowded() {
		if (!pointer.armed) return false;
		const danger = (CONFIG.catRadius + CONFIG.pointerRadius) * 2.5;
		let crowded = false;
		for (const cat of game.cats) {
			const dx = cat.x - pointer.x;
			const dy = cat.y - pointer.y;
			const dist = Math.hypot(dx, dy) || 1;
			if (dist <= danger) {
				crowded = true;
				cat.dirX = dx / dist;
				cat.dirY = dy / dist;
			}
		}
		return crowded;
	}

	/** Shortest distance from point (px,py) to the segment (ax,ay)-(bx,by). */
	function segmentDistance(ax, ay, bx, by, px, py) {
		const dx = bx - ax;
		const dy = by - ay;
		const lengthSq = dx * dx + dy * dy;
		if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
		let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
		t = clamp(t, 0, 1);
		return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
	}

	/** Writes a cat's logical position to the DOM; decoration stays on the inner node. */
	function renderCat(cat) {
		const size = CONFIG.catRadius * 2;
		cat.el.style.width = `${size}px`;
		cat.el.style.height = `${size}px`;
		cat.el.style.transform = `translate(${cat.x - CONFIG.catRadius}px, ${
			cat.y - CONFIG.catRadius
		}px)`;
		if (!reduceMotion.matches) {
			const tilt = Math.sin(cat.wobble) * 8 + cat.dirX * 6;
			cat.inner.style.transform = `rotate(${tilt}deg)`;
		}
	}

	function updateHud() {
		dom.timer.textContent = formatSeconds(game.activeTime * 1000);
		dom.best.textContent = formatSeconds(game.bestMs);
		dom.catCount.textContent = String(game.cats.length);
	}

	/** Update word status display at bottom-left */
	function updateWordStatus() {
		if (!game.activeCat) {
			dom.wordStatus.classList.remove("visible");
			return;
		}

		dom.wordStatus.classList.add("visible");
		dom.statusKorean.textContent = game.activeCat.koreanChars;
		
		const normalizedInput = normalizeForMatching(game.currentInput);
		const progress = (normalizedInput.length / game.activeCat.normalizedWord.length) * 100;
		
		// Create word with progress highlighting
		const latinWord = game.activeCat.latinWord;
		const typed = latinWord.substring(0, normalizedInput.length);
		const remaining = latinWord.substring(normalizedInput.length);
		
		dom.statusWord.innerHTML = `
			<span class="status-word-highlighted" style="--progress: ${progress}%">${latinWord}</span>
		`;
		
		dom.statusTranslation.textContent = game.activeCat.translation;
		dom.statusProgress.textContent = `${Math.round(progress)}% — Type to continue`;
	}

	/** Update word highlighting based on current input */
	function updateWordHighlighting() {
		const normalizedInput = normalizeForMatching(game.currentInput);

		if (normalizedInput.length === 0) {
			// Clear all highlighting
			for (const cat of game.cats) {
				const latinWordElement = cat.wordLabel.querySelector(".latin-word");
				if (latinWordElement) {
					latinWordElement.classList.remove("matching");
					latinWordElement.style.setProperty("--progress", "0%");
				}
			}
			game.activeCat = null;
			updateWordStatus();
		} else {
			// Find the first (oldest spawn) cat whose word matches the current input prefix
			let firstMatching = null;
			for (const cat of game.cats) {
				if (cat.normalizedWord.startsWith(normalizedInput)) {
					if (!firstMatching || cat.spawnOrder < firstMatching.spawnOrder) {
						firstMatching = cat;
					}
				}
			}

			// Update all cats' highlighting
			for (const cat of game.cats) {
				const latinWordElement = cat.wordLabel.querySelector(".latin-word");
				if (!latinWordElement) continue;

				if (cat === firstMatching) {
					// This is the active cat for typing
					game.activeCat = cat;
					latinWordElement.classList.add("matching");
					const progress = (normalizedInput.length / cat.normalizedWord.length) * 100;
					latinWordElement.style.setProperty("--progress", `${progress}%`);
				} else {
					latinWordElement.classList.remove("matching");
					latinWordElement.style.setProperty("--progress", "0%");
				}
			}
			
			updateWordStatus();
		}
	}

	/** Remove a cat when word is correctly typed */
	function removeCatByWord(cat) {
		cat.el.classList.add("disappearing");
		later(() => {
			if (cat.el.parentNode) {
				cat.el.remove();
			}
			game.cats = game.cats.filter((c) => c !== cat);
			dom.catCount.textContent = String(game.cats.length);
		}, CONFIG.spawnIntroSeconds * 1000);
	}

	/** Check for typed word matches and remove cats */
	function checkWordMatch() {
		if (!game.activeCat) return false;

		const normalizedInput = normalizeForMatching(game.currentInput);
		if (game.activeCat.normalizedWord === normalizedInput && normalizedInput.length > 0) {
			const completedCat = game.activeCat;
			
			// Speak the Korean word
			speakKorean(completedCat.koreanChars);
			
			removeCatByWord(completedCat);
			game.currentInput = "";
			game.activeCat = null;
			updateWordHighlighting();
			showBanner(`✓ ${completedCat.latinWord}`);
			later(() => showBanner(""), 1600);
			updateWordStatus();
			return true;
		}
		return false;
	}

	function loop(timestamp) {
		game.rafId = window.requestAnimationFrame(loop);

		if (!game.lastFrame) game.lastFrame = timestamp;
		const delta = Math.min((timestamp - game.lastFrame) / 1000, CONFIG.maxFrame);
		game.lastFrame = timestamp;

		if (game.state === STATE.GRACE || game.state === STATE.RUNNING) {
			game.accumulator += delta;
			while (game.accumulator >= CONFIG.step) {
				game.accumulator -= CONFIG.step;
				game.activeTime += CONFIG.step;

				if (
					game.state === STATE.GRACE &&
					game.activeTime >= graceTarget
				) {
					if (pointerIsCrowded()) {
						// Don't drop the shield while a cat is already on top of
						// the cursor; shoo it away and hold grace a moment longer.
						graceTarget = game.activeTime + 0.4;
					} else {
						game.state = STATE.RUNNING;
						showBanner("");
					}
				}

				const hit = stepPhysics(CONFIG.step);
				if (hit) {
					explode();
					break;
				}

				if (
					game.state === STATE.RUNNING &&
					game.activeTime >= game.nextSpawnAt
				) {
					game.nextSpawnAt += CONFIG.spawnEvery;
					spawnCat();
					showBanner("A new cat has entered the chat 🐈");
					later(() => showBanner(""), 1600);
				}
			}
			for (const cat of game.cats) renderCat(cat);
			updateHud();
		}

		drawParticles(delta);
	}

	/* ---------------------------------------------------------------- *
	 * Explosion + particles
	 * ---------------------------------------------------------------- */

	/** Ends the run: throws the page content, bursts particles, shows the overlay. */
	function explode() {
		if (game.state === STATE.EXPLODING || game.state === STATE.GAME_OVER) return;
		game.state = STATE.EXPLODING;
		showBanner("");

		// Stop music on game over
		if (dom.bgMusic && isMusicPlaying) {
			dom.bgMusic.pause();
			isMusicPlaying = false;
			dom.musicToggle.textContent = "🔇";
		}

		// Play game over sound
		playGameOverSound();

		const finalMs = game.activeTime * 1000;
		if (finalMs > game.bestMs) {
			game.bestMs = finalMs;
			saveBest(finalMs);
		}

		if (!reduceMotion.matches) {
			dom.shakeRoot.classList.add("shaking");
			for (const piece of dom.debris) {
				piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 900}px`);
				piece.style.setProperty("--dy", `${(Math.random() - 0.4) * 900}px`);
				piece.style.setProperty("--dr", `${(Math.random() - 0.5) * 120}deg`);
				piece.style.setProperty("--ds", `${0.4 + Math.random() * 0.4}`);
			}
		}
		for (const piece of dom.debris) piece.classList.add("debris");

		burstParticles(pointer.x, pointer.y);
		for (const cat of game.cats) cat.el.style.opacity = "0";

		later(() => {
			game.state = STATE.GAME_OVER;
			dom.finalTime.textContent = formatSeconds(finalMs);
			dom.finalBest.textContent = formatSeconds(game.bestMs);
			dom.overlay.hidden = false;
			dom.restart.focus();
			updateHud();
		}, 850);
	}

	/** Emits a short-lived canvas particle burst at the collision point. */
	function burstParticles(x, y) {
		const count = reduceMotion.matches
			? Math.round(CONFIG.particleCount / 4)
			: CONFIG.particleCount;
		const colors = ["#ffb3d9", "#7ee7ff", "#fff3a3", "#ff7bb5", "#ffffff"];
		for (let i = 0; i < count; i += 1) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 120 + Math.random() * 520;
			game.particles.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 0.8 + Math.random() * 0.8,
				age: 0,
				size: 2 + Math.random() * 5,
				color: colors[i % colors.length],
			});
		}
	}

	/** Integrates and paints particles; a no-op once the list drains. */
	function drawParticles(delta) {
		if (!game.particles.length) {
			ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
			return;
		}
		ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
		const alive = [];
		for (const p of game.particles) {
			p.age += delta;
			if (p.age >= p.life) continue;
			p.vy += 900 * delta;
			p.x += p.vx * delta;
			p.y += p.vy * delta;
			ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			ctx.fill();
			alive.push(p);
		}
		ctx.globalAlpha = 1;
		game.particles = alive;
	}

	/* ---------------------------------------------------------------- *
	 * Lifecycle
	 * ---------------------------------------------------------------- */

	/** Tears down a finished round and arms a fresh one. */
	function resetGame() {
		clearTimeouts();
		for (const cat of game.cats) cat.el.remove();
		game.cats = [];
		game.particles = [];
		game.currentInput = "";
		game.activeCat = null;
		ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

		dom.shakeRoot.classList.remove("shaking");
		for (const piece of dom.debris) {
			piece.classList.remove("debris");
			piece.style.removeProperty("--dx");
			piece.style.removeProperty("--dy");
			piece.style.removeProperty("--dr");
			piece.style.removeProperty("--ds");
		}
		dom.overlay.hidden = true;
		dom.wordStatus.classList.remove("visible");

		game.activeTime = 0;
		game.accumulator = 0;
		game.nextSpawnAt = CONFIG.spawnEvery;
		game.lastFrame = 0;
		game.wordList = [...wordPairs];
		updateHud();

		// Restart background music
		if (musicStarted) {
			isMusicPlaying = true;
			dom.musicToggle.textContent = "🔊";
			dom.bgMusic.currentTime = 0;
			dom.bgMusic.play().catch(() => {
				/* audio play may fail in some contexts */
			});
		}

		spawnCat();
		startRound();
	}

	/** Enters the grace period if the pointer is ready, otherwise waits for it. */
	function startRound() {
		graceTarget = game.activeTime + CONFIG.graceSeconds;
		if (pointer.active) {
			game.state = STATE.GRACE;
			showBanner("Get ready…");
			dom.hint.textContent = "Type Korean words to remove the cats!";
		} else {
			game.state = STATE.IDLE;
			showBanner(
				pointer.isTouch ? "Touch and drag to play." : "Move your mouse to start."
			);
		}
	}

	/** Resumes play after the pointer returns, with a fresh grace window. */
	function resumeFromPause() {
		if (game.state !== STATE.PAUSED && game.state !== STATE.IDLE) return;
		game.state = STATE.GRACE;
		game.accumulator = 0;
		game.lastFrame = 0;
		graceTarget = game.activeTime + CONFIG.graceSeconds;
		// Never let a spawn land during the resume grace window.
		game.nextSpawnAt = Math.max(game.nextSpawnAt, graceTarget);
		dom.hint.textContent = "Type Korean words to remove the cats!";
		showBanner("Get ready…");
	}

	let graceTarget = CONFIG.graceSeconds;

	function pauseGame(reason) {
		if (game.state !== STATE.RUNNING && game.state !== STATE.GRACE) return;
		game.state = STATE.PAUSED;
		showBanner(reason);
	}

	function resizeCanvas() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		dom.canvas.width = Math.round(window.innerWidth * dpr);
		dom.canvas.height = Math.round(window.innerHeight * dpr);
		dom.canvas.style.width = `${window.innerWidth}px`;
		dom.canvas.style.height = `${window.innerHeight}px`;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		for (const cat of game.cats) {
			cat.x = clamp(cat.x, CONFIG.catRadius, window.innerWidth - CONFIG.catRadius);
			cat.y = clamp(cat.y, CONFIG.catRadius, window.innerHeight - CONFIG.catRadius);
			renderCat(cat);
		}
	}

	/* ---------------------------------------------------------------- *
	 * Input
	 * ---------------------------------------------------------------- */

	window.addEventListener(
		"pointermove",
		(event) => {
			pointer.x = event.clientX;
			pointer.y = event.clientY;
			pointer.isTouch = event.pointerType !== "mouse";
			pointer.active = true;
			// A finger is only dangerous while it is pressed against the screen.
			pointer.armed = pointer.isTouch ? event.pressure > 0 || event.buttons > 0 : true;
			if (game.state === STATE.IDLE || game.state === STATE.PAUSED) {
				startMusic();
				resumeFromPause();
			}
		},
		{ passive: true }
	);

	window.addEventListener("pointerdown", (event) => {
		pointer.x = event.clientX;
		pointer.y = event.clientY;
		pointer.isTouch = event.pointerType !== "mouse";
		pointer.active = true;
		pointer.armed = true;
		if (game.state === STATE.IDLE || game.state === STATE.PAUSED) {
			startMusic();
			resumeFromPause();
		}
	});

	for (const type of ["pointerup", "pointercancel"]) {
		window.addEventListener(type, () => {
			if (pointer.isTouch) {
				pointer.armed = false;
				pauseGame("Touch and drag to keep playing.");
			}
		});
	}

	document.addEventListener("pointerleave", () => {
		pointer.active = false;
		pointer.armed = false;
		pauseGame("Paused — bring your cursor back.");
	});

	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			pauseGame("Paused.");
		} else {
			game.lastFrame = 0;
		}
	});

	window.addEventListener("resize", resizeCanvas);
	window.addEventListener("blur", () => pauseGame("Paused."));

	// Keyboard input for typing words
	document.addEventListener("keydown", (event) => {
		// Start music on first keystroke
		startMusic();

		if (game.state !== STATE.RUNNING && game.state !== STATE.GRACE) return;

		const key = event.key;

		if (key === "Backspace") {
			event.preventDefault();
			game.currentInput = game.currentInput.slice(0, -1);
			updateWordHighlighting();
		} else if (key.length === 1 && /^[a-zA-Z'-]$/.test(key)) {
			event.preventDefault();
			
			// Check if this character can be part of any active cat's word
			const possibleChar = normalizeForMatching(key);
			const testInput = normalizeForMatching(game.currentInput + key);
			
			let foundMatch = false;
			
			// Check if the new input still matches a word's prefix
			for (const cat of game.cats) {
				if (cat.normalizedWord.startsWith(testInput)) {
					foundMatch = true;
					break;
				}
			}
			
			if (foundMatch) {
				game.currentInput += key;
				checkWordMatch();
				updateWordHighlighting();
			} else {
				// Invalid character for current word(s)
				playBuzzer();
			}
		}
	});

	dom.restart.addEventListener("click", () => {
		pointer.armed = !pointer.isTouch && pointer.active;
		resetGame();
	});

	dom.musicToggle.addEventListener("click", toggleMusic);

	/* ---------------------------------------------------------------- *
	 * Boot
	 * ---------------------------------------------------------------- */

	initAudio();
	resizeCanvas();
	updateHud();

	spawnCat();
	startRound();
	game.rafId = window.requestAnimationFrame(loop);
})();
