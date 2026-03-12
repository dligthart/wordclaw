const storyListEl = document.getElementById('story-list');
const loadingEl = document.getElementById('loading');
const libraryContainer = document.getElementById('library-container');

const storyModal = document.getElementById('story-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalTitle = document.getElementById('modal-title');
const modalAuthor = document.getElementById('modal-author');
const modalScore = document.getElementById('modal-score');
const modalContent = document.getElementById('modal-content');

window.addEventListener('DOMContentLoaded', loadStories);

closeModalBtn.addEventListener('click', () => {
    storyModal.classList.add('hidden');
});

async function loadStories() {
    setLoading(true);
    try {
        const res = await fetch('/api/stories');
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        storyListEl.innerHTML = '';
        if (data.stories.length === 0) {
            storyListEl.innerHTML = '<p style="color:var(--text-muted);">The archives are empty. Go play a game and publish your story!</p>';
            return;
        }

        data.stories.forEach(storyData => {
            const story = storyData.data; // WordClaw item data is inside the 'data' field
            const card = document.createElement('div');
            card.className = 'theme-card';
            const isDeath = story.cause_of_death && story.cause_of_death === "Succumbed to their injuries";
            card.innerHTML = `
                ${story.hero_image_url ? `<img src="${story.hero_image_url}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 8px 8px 0 0; margin: -1.5rem -1.5rem 1rem -1.5rem; width: calc(100% + 3rem); max-width: none;" />` : ''}
                <h3>${story.title || 'Untitled'}</h3>
                <p>By ${story.author || 'Anonymous'} | Score: <span style="color:${isDeath ? '#ef4444' : 'var(--score)'}; font-weight:bold;">${story.final_score || 0}</span></p>
                ${story.character_class ? `<p style="font-size:0.9rem; color:var(--text-muted);">Class: ${story.character_class}</p>` : ''}
                ${story.cause_of_death ? `<p style="font-size:0.9rem; color: ${isDeath ? '#ef4444' : '#10b981'};">Fate: ${story.cause_of_death}</p>` : ''}
                <p style="font-size:0.8rem; margin-top:0.5rem;">Published: ${new Date(storyData.created_at).toLocaleString()}</p>
            `;
            card.addEventListener('click', () => {
                showStory(story);
            });
            storyListEl.appendChild(card);
        });
    } catch (e) {
        storyListEl.innerHTML = `<p style="color:var(--health);">Failed to load stories: ${e.message}</p>`;
    } finally {
        setLoading(false);
    }
}

function showStory(story) {
    modalTitle.innerText = story.title || 'Untitled';
    modalAuthor.innerText = `By ${story.author || 'Anonymous'}`;
    modalScore.innerText = `Final Score: ${story.final_score || 0}`;

    modalContent.innerHTML = `
        ${story.finale_image_url ? `<img src="${story.finale_image_url}" style="width: 100%; max-height: 400px; object-fit: cover; border-radius: 8px; margin-bottom: 1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />` : ''}
        <p style="white-space: pre-wrap; font-size: 0.95rem; color: var(--text-base);">${story.full_text || 'No content found for this archive.'}</p>
    `;
    storyModal.classList.remove('hidden');
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
