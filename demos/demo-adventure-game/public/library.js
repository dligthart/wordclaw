const storyListEl = document.getElementById('story-list');
const loadingEl = document.getElementById('loading');
const libraryContainer = document.getElementById('library-container');

const storyModal = document.getElementById('story-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalHero = document.getElementById('modal-hero');
const modalTitle = document.getElementById('modal-title');
const modalAuthor = document.getElementById('modal-author');
const modalScore = document.getElementById('modal-score');
const modalContent = document.getElementById('modal-content');

window.addEventListener('DOMContentLoaded', loadStories);

closeModalBtn.addEventListener('click', () => {
    storyModal.classList.add('hidden');
});

// Close modal on backdrop click
storyModal.addEventListener('click', (e) => {
    if (e.target === storyModal) {
        storyModal.classList.add('hidden');
    }
});

async function loadStories() {
    setLoading(true);
    try {
        const res = await fetch('/api/stories');
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        storyListEl.innerHTML = '';
        if (data.stories.length === 0) {
            storyListEl.innerHTML = '<p style="color:var(--text-muted); text-align:center; grid-column: 1/-1; padding: 3rem 0;">The archives are empty. Go play a game and publish your story!</p>';
            return;
        }

        data.stories.forEach(storyData => {
            const story = storyData.data;
            const card = document.createElement('div');
            card.className = 'story-card';
            const isDeath = story.cause_of_death && story.cause_of_death === "Succumbed to their injuries";

            card.innerHTML = `
                ${story.hero_image_url
                    ? `<img class="story-card-image" src="${story.hero_image_url}" alt="${story.title || 'Story'}" />`
                    : `<div class="story-card-image-placeholder">📜</div>`
                }
                <div class="story-card-body">
                    <h3>${story.title || 'Untitled'}</h3>
                    <p class="card-author">By ${story.author || 'Anonymous'}</p>
                    <p class="card-score" style="color:${isDeath ? '#ef4444' : 'var(--score)'}">Score: ${story.final_score || 0}</p>
                    ${story.character_class ? `<p class="card-class">Class: ${story.character_class}</p>` : ''}
                    ${story.cause_of_death ? `<p class="card-fate" style="color:${isDeath ? '#ef4444' : '#10b981'}">${story.cause_of_death}</p>` : ''}
                    <p class="card-date">${new Date(storyData.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
            `;
            card.addEventListener('click', () => showStory(story));
            storyListEl.appendChild(card);
        });
    } catch (e) {
        storyListEl.innerHTML = `<p style="color:var(--health); text-align:center; grid-column:1/-1;">Failed to load stories: ${e.message}</p>`;
    } finally {
        setLoading(false);
    }
}

function showStory(story) {

    // Hero image
    if (story.finale_image_url) {
        modalHero.innerHTML = `<img src="${story.finale_image_url}" alt="Finale" />`;
        modalHero.style.display = 'block';
    } else {
        modalHero.innerHTML = '';
        modalHero.style.display = 'none';
    }

    modalTitle.innerText = story.title || 'Untitled';
    modalAuthor.innerText = `By ${story.author || 'Anonymous'}`;
    modalScore.innerText = `Score: ${story.final_score || 0}`;

    // Render chapters as cards with inline images
    modalContent.innerHTML = formatStoryAsCards(story.full_text, story.scene_images || []);

    // Achievements
    const achievementsEl = document.getElementById('modal-achievements');
    achievementsEl.innerHTML = '';
    if (story.achievements && story.achievements.length > 0) {
        story.achievements.forEach(ach => {
            const badge = document.createElement('span');
            badge.className = 'achievement-badge';
            badge.textContent = `🏆 ${ach}`;
            achievementsEl.appendChild(badge);
        });
    }

    // Inventory
    const inventoryEl = document.getElementById('modal-inventory');
    inventoryEl.innerHTML = '';
    if (story.inventory && story.inventory.length > 0) {
        story.inventory.forEach(item => {
            const pill = document.createElement('span');
            pill.className = 'inventory-pill';
            pill.textContent = `🎒 ${item}`;
            inventoryEl.appendChild(pill);
        });
    }

    storyModal.classList.remove('hidden');
    storyModal.scrollTop = 0;
}

function setLoading(isLoading) {
    if (isLoading) {
        libraryContainer.classList.add('fade-out');
        loadingEl.classList.remove('hidden');
    } else {
        libraryContainer.classList.remove('fade-out');
        loadingEl.classList.add('hidden');
    }
}

/**
 * Converts the raw story text (with **Title** headers and --- dividers)
 * into chapter cards, each paired with its corresponding scene image.
 *
 * Scene images are matched 1:1 with story sections.
 * The first scene image maps to the first chapter, etc.
 */
function formatStoryAsCards(rawText, sceneImages) {
    if (!rawText) return '<p class="story-empty">No content found for this archive.</p>';

    // Normalize line endings
    let text = rawText.replace(/\r\n/g, '\n').replace(/<br\s*\/?>/gi, '\n');

    // Split on --- dividers
    const sections = text.split(/\n*\s*---\s*\n*/);

    let htmlParts = [];

    sections.forEach((section, i) => {
        const trimmed = section.trim();
        if (!trimmed) return;

        // Check if section starts with **Title**
        const titleMatch = trimmed.match(/^\*\*([^*]+)\*\*\s*\n([\s\S]*)$/);
        const title = titleMatch ? titleMatch[1].trim() : null;
        const body = titleMatch ? titleMatch[2].trim() : trimmed;

        // Get matching scene image (offset by 0 — first image = first section)
        const imageUrl = sceneImages[i] || null;

        // Build paragraphs from the body text
        const paragraphs = body.split(/\n\n+/).filter(p => p.trim());
        const proseHtml = paragraphs.map(p => `<p>${p.replace(/\n/g, ' ').trim()}</p>`).join('\n');

        // Build the chapter card
        const chapterNum = i + 1;
        const hasImage = imageUrl !== null;

        htmlParts.push(`
            <div class="chapter-card ${hasImage ? '' : 'chapter-card--no-image'}">
                ${hasImage ? `
                <div class="chapter-image-pane">
                    <img src="${imageUrl}" alt="Chapter ${chapterNum}" class="chapter-image" />
                    <span class="chapter-badge">Chapter ${chapterNum}</span>
                </div>
                ` : ''}
                <div class="chapter-text-pane">
                    ${title ? `<h4 class="chapter-title">${hasImage ? '' : `<span class="chapter-num">Ch. ${chapterNum}</span> `}${title}</h4>` : ''}
                    <div class="chapter-prose">${proseHtml}</div>
                </div>
            </div>
        `);
    });

    return htmlParts.join('\n');
}


