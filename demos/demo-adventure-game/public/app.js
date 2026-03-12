let sessionId = null;

const healthEl = document.getElementById('health');
const scoreEl = document.getElementById('score');
const titleEl = document.getElementById('story-title');
const textEl = document.getElementById('story-text');
const themeContainer = document.getElementById('themes-container');
const themeCardsEl = document.getElementById('theme-cards');
const choicesContainer = document.getElementById('choices-container');
const storyContainer = document.getElementById('story-container');
const loadingEl = document.getElementById('loading');
const publishContainer = document.getElementById('publish-container');
const deathReasonEl = document.getElementById('death-reason');
const authorInput = document.getElementById('author-name');
const publishBtn = document.getElementById('publish-btn');
const publishStatus = document.getElementById('publish-status');

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
                themeContainer.classList.add('hidden');
                storyContainer.classList.remove('hidden');
                startGame(theme.title);
            });
            themeCardsEl.appendChild(card);
        });
    } catch (e) {
        themeCardsEl.innerHTML = `<p style="color:var(--health);">Failed to load themes: ${e.message}</p>`;
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        themeContainer.classList.add('fade-out');
        storyContainer.classList.add('fade-out');
        loadingEl.classList.remove('hidden');
    } else {
        themeContainer.classList.remove('fade-out');
        storyContainer.classList.remove('fade-out');
        loadingEl.classList.add('hidden');
    }
}

function updateStats(newHealth, newScore) {
    const oldHealth = parseInt(healthEl.innerText) || 100;
    const oldScore = parseInt(scoreEl.innerText.split(' / ')[0]) || 0;

    healthEl.innerText = newHealth;
    scoreEl.innerText = `${newScore} / 100`;

    // Animate diffs
    if (newHealth < oldHealth) {
        healthEl.classList.remove('health-down');
        void healthEl.offsetWidth; // trigger reflow
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
    titleEl.innerText = node.title;
    textEl.innerText = node.narrative_text;

    choicesContainer.innerHTML = '';
    if (node.available_choices && node.available_choices.length > 0) {
        node.available_choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.innerHTML = `<span>${choice}</span> <span>→</span>`;
            btn.addEventListener('click', () => makeChoice(choice));
            choicesContainer.appendChild(btn);
        });
    }
}

function showEndGame(isDeath, reason) {
    choicesContainer.innerHTML = '';
    publishContainer.classList.remove('hidden');

    if (isDeath) {
        deathReasonEl.classList.remove('hidden');
        deathReasonEl.innerText = reason || "You have perished.";
    } else {
        deathReasonEl.classList.remove('hidden');
        deathReasonEl.innerText = "🏆 Victory! You survived the adventure and claimed your ultimate destiny.";
        deathReasonEl.style.color = "var(--score)";
    }
}

async function startGame(themeString) {
    setLoading(true);
    try {
        const res = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: themeString })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        sessionId = data.sessionId;
        updateStats(data.health, data.score);
        renderNode(data.node);
    } catch (e) {
        textEl.innerText = "Error starting game: " + e.message;
        choicesContainer.innerHTML = '<button class="primary-btn" onclick="location.reload()">Refresh to Try Again</button>';
    } finally {
        setLoading(false);
    }
}

async function makeChoice(choice) {
    if (!sessionId) return;
    setLoading(true);

    try {
        const res = await fetch('/api/choose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, choice })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        if (data.node) {
            renderNode(data.node);
            updateStats(data.health, data.score);
        }

        if (data.death) {
            showEndGame(true, data.reason);
        } else if (!data.node.available_choices || data.node.available_choices.length === 0) {
            // End of story naturally
            showEndGame(false);
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
