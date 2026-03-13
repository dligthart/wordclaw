let sessionId = null;
let selectedTheme = null;
let selectedClass = null;
let selectedQuirk = null;

const healthEl = document.getElementById('health');
const healthBar = document.getElementById('health-bar');
const scoreEl = document.getElementById('score');
const titleEl = document.getElementById('story-title');
const textEl = document.getElementById('story-text');
const themeContainer = document.getElementById('themes-container');
const themeCardsEl = document.getElementById('theme-cards');

const characterContainer = document.getElementById('character-container');
const classGrid = document.getElementById('class-grid');
const quirkGrid = document.getElementById('quirk-grid');
const startAdventureBtn = document.getElementById('start-adventure-btn');
const inventoryDisplay = document.getElementById('inventory-display');
const inventoryPills = document.getElementById('inventory-pills');

const diceContainer = document.getElementById('dice-container');
const d20 = document.getElementById('d20');
const diceValue = document.getElementById('dice-value');
const dcValue = document.getElementById('dc-value');
const diceResultText = document.getElementById('dice-result-text');

const choicesContainer = document.getElementById('choices-container');
const storyContainer = document.getElementById('story-container');
const loadingEl = document.getElementById('loading');
const publishContainer = document.getElementById('publish-container');
const deathReasonEl = document.getElementById('death-reason');
const authorInput = document.getElementById('author-name');
const publishBtn = document.getElementById('publish-btn');
const publishStatus = document.getElementById('publish-status');

const saveTools = document.getElementById('save-tools');
const saveBtn = document.getElementById('save-btn');
const loadSessionInput = document.getElementById('load-session-input');
const loadSessionBtn = document.getElementById('load-session-btn');

const avatarImage = document.getElementById('avatar-image');
const sceneImage = document.getElementById('scene-image');
const finaleMural = document.getElementById('finale-mural');

const CLASSES = ['Warrior', 'Spellcaster', 'Cyber-Hacker', 'Scoundrel', 'Ranger'];
const QUIRKS = ['Optimistic', 'Clumsy', 'Ruthless', 'Charming', 'Paranoid'];

window.addEventListener('DOMContentLoaded', loadThemes);

async function loadThemes() {
    setLoading(true);
    try {
        const res = await fetch('/api/themes');
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        themeCardsEl.innerHTML = '';
        data.themes.forEach(theme => {
            const card = document.createElement('div');
            card.className = 'theme-card';
            card.innerHTML = `
                <h3>${theme.title}</h3>
                <p>${theme.description}</p>
            `;
            card.addEventListener('click', () => {
                selectedTheme = theme.title;
                themeContainer.classList.add('hidden');
                characterContainer.classList.remove('hidden');
                renderCharacterBuilder();
            });
            themeCardsEl.appendChild(card);
        });
    } catch (e) {
        themeCardsEl.innerHTML = `<p style="color:var(--health);">Failed to load themes: ${e.message}</p>`;
    } finally {
        setLoading(false);
    }
}

function renderCharacterBuilder() {
    classGrid.innerHTML = '';
    quirkGrid.innerHTML = '';

    CLASSES.forEach(c => {
        const btn = document.createElement('div');
        btn.className = 'class-card';
        btn.innerText = c;
        btn.onclick = () => {
            document.querySelectorAll('#class-grid .class-card').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
            selectedClass = c;
            checkCanStart();
        };
        classGrid.appendChild(btn);
    });

    QUIRKS.forEach(q => {
        const btn = document.createElement('div');
        btn.className = 'class-card';
        btn.innerText = q;
        btn.onclick = () => {
            document.querySelectorAll('#quirk-grid .class-card').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
            selectedQuirk = q;
            checkCanStart();
        };
        quirkGrid.appendChild(btn);
    });
}

function checkCanStart() {
    if (selectedClass && selectedQuirk) {
        startAdventureBtn.disabled = false;
    }
}

startAdventureBtn.addEventListener('click', () => {
    characterContainer.classList.add('hidden');

    // Clear initial placeholders so the loading overlay floats above a clean slate
    titleEl.innerText = '';
    textEl.innerText = '';
    choicesContainer.innerHTML = '';

    if (!sceneImage.classList.contains('hidden')) {
        sceneImage.classList.add('hidden');
    }

    storyContainer.classList.remove('hidden');
    startGame(selectedTheme, selectedClass, selectedQuirk);
});

function setLoading(isLoading) {
    if (isLoading) {
        themeContainer.classList.add('fade-out');
        characterContainer.classList.add('fade-out');
        storyContainer.classList.add('fade-out');
        loadingEl.classList.remove('hidden');
    } else {
        themeContainer.classList.remove('fade-out');
        characterContainer.classList.remove('fade-out');
        storyContainer.classList.remove('fade-out');
        loadingEl.classList.add('hidden');
    }
}

function updateStats(newHealth, newScore) {
    const oldHealth = parseInt(healthEl.innerText) || 100;
    const oldScore = parseInt(scoreEl.innerText.split(' / ')[0]) || 0;

    const clampedHealth = Math.max(0, Math.min(100, newHealth));
    healthEl.innerText = clampedHealth;
    scoreEl.innerText = `${newScore} / 100`;

    // Update health bar
    if (healthBar) {
        healthBar.style.width = clampedHealth + '%';
        healthBar.classList.remove('hp-high', 'hp-mid', 'hp-low', 'hp-critical');
        if (clampedHealth > 60) healthBar.classList.add('hp-high');
        else if (clampedHealth > 30) healthBar.classList.add('hp-mid');
        else if (clampedHealth > 0) healthBar.classList.add('hp-low');
        else healthBar.classList.add('hp-critical');
    }

    // Animate diffs
    if (newHealth < oldHealth) {
        healthEl.classList.remove('health-down');
        void healthEl.offsetWidth;
        healthEl.classList.add('health-down');
    } else if (newHealth > oldHealth) {
        healthEl.classList.remove('health-up');
        void healthEl.offsetWidth;
        healthEl.classList.add('health-up');
    }

    if (newScore > oldScore) {
        scoreEl.classList.remove('score-up');
        void scoreEl.offsetWidth;
        scoreEl.classList.add('score-up');
    }
}

function renderNode(node) {
    // Smooth scene transition
    storyContainer.classList.add('scene-exit');
    setTimeout(() => {
        titleEl.innerText = node.title;
        textEl.innerText = node.narrative_text;

        choicesContainer.innerHTML = '';
        if (node.available_choices && node.available_choices.length > 0) {
            node.available_choices.forEach(choice => {
                const isObj = typeof choice === 'object' && choice !== null;
                const text = isObj ? choice.text : choice;
                const isRisky = isObj ? choice.is_risky : false;
                const difficulty = isObj ? choice.difficulty : 0;

                const btn = document.createElement('button');
                btn.className = 'choice-btn';

                if (isRisky) {
                    btn.innerHTML = `<span>🎲 [DC ${difficulty}] ${text}</span> <span>→</span>`;
                    btn.addEventListener('click', () => performDiceRoll(text, difficulty));
                } else {
                    btn.innerHTML = `<span>${text}</span> <span>→</span>`;
                    btn.addEventListener('click', () => makeChoice(text));
                }
                choicesContainer.appendChild(btn);
            });
        }

        storyContainer.classList.remove('scene-exit');
        storyContainer.classList.add('scene-enter');
        setTimeout(() => storyContainer.classList.remove('scene-enter'), 400);
    }, 250);
}

function performDiceRoll(choiceText, difficulty) {
    diceContainer.classList.remove('hidden');
    diceResultText.classList.add('hidden');
    dcValue.innerText = difficulty;

    // Reset all states
    d20.className = 'd20-body';
    const particlesEl = document.getElementById('dice-particles');
    if (particlesEl) particlesEl.innerHTML = '';

    // Start rolling animation + number cycling
    d20.classList.add('rolling');
    diceValue.innerText = '?';

    // Rapidly cycle numbers during roll
    const cycleInterval = setInterval(() => {
        diceValue.innerText = Math.floor(Math.random() * 20) + 1;
    }, 80);

    setTimeout(() => {
        clearInterval(cycleInterval);
        d20.classList.remove('rolling');

        const result = Math.floor(Math.random() * 20) + 1;
        const isSuccess = result >= difficulty;
        const isCritSuccess = result === 20;
        const isCritFail = result === 1;

        // Determine label
        let resultLabel, resultClass;
        if (isCritSuccess) {
            resultLabel = 'CRITICAL SUCCESS!';
            resultClass = 'success-text crit-text';
        } else if (isCritFail) {
            resultLabel = 'CRITICAL FAILURE!';
            resultClass = 'failure-text crit-text';
        } else if (isSuccess) {
            resultLabel = 'SUCCESS!';
            resultClass = 'success-text';
        } else {
            resultLabel = 'FAILURE!';
            resultClass = 'failure-text';
        }

        // Show final number
        diceValue.innerText = result;

        // Dramatic land
        d20.classList.add('landed');
        d20.classList.add(isSuccess ? 'dice-success' : 'dice-failure');
        if (isCritSuccess || isCritFail) d20.classList.add('dice-crit');

        // Screen shake
        const stage = diceContainer.querySelector('.dice-stage');
        if (stage) {
            stage.classList.add('dice-shake');
            setTimeout(() => stage.classList.remove('dice-shake'), 500);
        }

        // Spawn particles
        if (particlesEl) {
            const color = isSuccess ? '#22c55e' : '#ef4444';
            const count = (isCritSuccess || isCritFail) ? 35 : 20;
            for (let i = 0; i < count; i++) {
                const p = document.createElement('div');
                p.className = 'dice-particle';
                const angle = (Math.PI * 2 * i) / count;
                const dist = 60 + Math.random() * (isCritSuccess || isCritFail ? 120 : 80);
                const tx = Math.cos(angle) * dist;
                const ty = Math.sin(angle) * dist;
                p.style.background = color;
                p.style.animation = `particleBurst 0.8s ease-out forwards`;
                p.style.setProperty('--tx', tx + 'px');
                p.style.setProperty('--ty', ty + 'px');
                p.style.transform = `translate(${tx}px, ${ty}px)`;
                p.style.width = (3 + Math.random() * 3) + 'px';
                p.style.height = p.style.width;
                particlesEl.appendChild(p);
            }
        }

        // Show result text after a beat
        setTimeout(() => {
            diceResultText.innerText = resultLabel;
            diceResultText.className = 'dice-result ' + resultClass;
            diceResultText.classList.remove('hidden');
        }, 400);

        // Advance the story
        setTimeout(() => {
            diceContainer.classList.add('hidden');
            d20.className = 'd20-body'; // reset
            makeChoice(choiceText, { result, difficulty });
        }, 2500);
    }, 1800);
}

function renderInventory(inventory) {
    if (!inventory || inventory.length === 0) {
        inventoryDisplay.classList.add('hidden');
        return;
    }
    inventoryDisplay.classList.remove('hidden');
    inventoryPills.innerHTML = '';
    inventory.forEach(item => {
        const pill = document.createElement('span');
        pill.className = 'inventory-pill';
        pill.innerText = item;
        inventoryPills.appendChild(pill);
    });
}

function showEndGame(isDeath, reason, finaleImageUrl, achievements) {
    choicesContainer.innerHTML = '';
    publishContainer.classList.remove('hidden');

    if (finaleImageUrl) {
        finaleMural.src = finaleImageUrl;
        finaleMural.classList.remove('hidden');
    }

    if (isDeath) {
        deathReasonEl.classList.remove('hidden');
        deathReasonEl.innerText = reason || "You have perished.";
    } else {
        deathReasonEl.classList.remove('hidden');
        deathReasonEl.innerText = "🏆 Victory! You survived the adventure and claimed your ultimate destiny.";
        deathReasonEl.style.color = "var(--score)";
    }

    // Display achievements
    if (achievements && achievements.length > 0) {
        const display = document.getElementById('achievements-display');
        const list = document.getElementById('achievements-list');
        if (display && list) {
            display.classList.remove('hidden');
            list.innerHTML = '';
            achievements.forEach(a => {
                const badge = document.createElement('span');
                badge.className = 'achievement-badge';
                badge.innerText = a;
                list.appendChild(badge);
            });
        }
    }
}

async function startGame(themeString, characterClass, quirk) {
    setLoading(true);
    try {
        const res = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: themeString, characterClass, quirk })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        sessionId = data.sessionId;
        saveTools.classList.remove('hidden');

        if (data.heroImageUrl) {
            avatarImage.src = data.heroImageUrl;
            avatarImage.classList.remove('hidden');
        }

        if (data.sceneImageUrl) {
            sceneImage.src = data.sceneImageUrl;
            sceneImage.classList.remove('hidden');
        }

        updateStats(data.health, data.score);
        renderNode(data.node);
        renderInventory(data.inventory);
    } catch (e) {
        textEl.innerText = "Error starting game: " + e.message;
        choicesContainer.innerHTML = '<button class="primary-btn" onclick="location.reload()">Refresh to Try Again</button>';
    } finally {
        setLoading(false);
    }
}

async function makeChoice(choiceText, rollObj = null) {
    if (!sessionId) return;
    setLoading(true);

    try {
        const payload = { sessionId, choice: choiceText };
        if (rollObj) {
            payload.rollEvent = rollObj;
        }

        const res = await fetch('/api/choose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        if (data.node) {
            renderNode(data.node);
            updateStats(data.health, data.score);
            renderInventory(data.inventory);
        }

        if (data.sceneImageUrl) {
            sceneImage.src = data.sceneImageUrl;
            sceneImage.classList.remove('hidden');
        }

        if (data.death) {
            sceneImage.classList.add('hidden');
            showEndGame(true, data.reason, data.finaleImageUrl, data.achievements);
        } else if (!data.node.available_choices || data.node.available_choices.length === 0) {
            sceneImage.classList.add('hidden');
            showEndGame(false, null, data.finaleImageUrl, data.achievements);
        }

    } catch (e) {
        alert("Action failed: " + e.message);
    } finally {
        setLoading(false);
    }
}

publishBtn.addEventListener('click', async () => {
    if (!sessionId) return;
    const author = authorInput.value.trim();

    publishBtn.disabled = true;
    publishBtn.innerText = "Publishing...";

    try {
        const res = await fetch('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, author })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        publishStatus.innerText = "✨ " + data.message;
        publishBtn.style.display = 'none';
        authorInput.style.display = 'none';

    } catch (e) {
        publishBtn.disabled = false;
        publishBtn.innerText = "Publish Story to WordClaw";
        publishStatus.style.color = 'red';
        publishStatus.innerText = "Error: " + e.message;
    }
});

saveBtn.addEventListener('click', async () => {
    if (!sessionId) return;
    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;
    try {
        const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        alert(`Game Saved! Your Session ID is: ${sessionId}\n\nWrite this down to resume later.`);
    } catch (e) {
        alert("Save failed: " + e.message);
    } finally {
        saveBtn.innerText = "Save Game";
        saveBtn.disabled = false;
    }
});

loadSessionBtn.addEventListener('click', async () => {
    const id = loadSessionInput.value.trim();
    if (!id) return;
    setLoading(true);
    try {
        const res = await fetch('/api/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: id })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        sessionId = id;
        themeContainer.classList.add('hidden');
        characterContainer.classList.add('hidden');
        storyContainer.classList.remove('hidden');
        saveTools.classList.remove('hidden');

        if (data.heroImageUrl) {
            avatarImage.src = data.heroImageUrl;
            avatarImage.classList.remove('hidden');
        } else {
            avatarImage.classList.add('hidden');
        }

        if (data.sceneImageUrl) {
            sceneImage.src = data.sceneImageUrl;
            sceneImage.classList.remove('hidden');
        } else {
            sceneImage.classList.add('hidden');
        }

        updateStats(data.health, data.score);
        renderNode(data.node);
        renderInventory(data.inventory);
    } catch (e) {
        alert("Load failed: " + e.message);
    } finally {
        setLoading(false);
    }
});
