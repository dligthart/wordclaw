const storyListEl = document.getElementById('story-list');
const loadingEl = document.getElementById('loading');
const libraryContainer = document.getElementById('library-container');

const storyModal = document.getElementById('story-modal');
const closeModalBtn = document.getElementById('close-modal');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const modalHero = document.getElementById('modal-hero');
const modalTitle = document.getElementById('modal-title');
const modalAuthor = document.getElementById('modal-author');
const modalScore = document.getElementById('modal-score');
const modalContent = document.getElementById('modal-content');

let currentStory = null;

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
    currentStory = story;

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

// =====================
// PDF GENERATION
// =====================

downloadPdfBtn.addEventListener('click', () => {
    if (!currentStory) return;
    generatePDF(currentStory);
});

async function generatePDF(story) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    downloadPdfBtn.disabled = true;
    downloadPdfBtn.textContent = '⏳ Generating...';

    try {
        // ---- Title Page ----
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        const titleLines = doc.splitTextToSize(story.title || 'Untitled', contentWidth);
        y = 60;
        doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
        y += titleLines.length * 12 + 10;

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(14);
        doc.text(`By ${story.author || 'Anonymous'}`, pageWidth / 2, y, { align: 'center' });
        y += 10;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        doc.text(`Score: ${story.final_score || 0}`, pageWidth / 2, y, { align: 'center' });
        y += 8;

        if (story.character_class) {
            doc.text(`Class: ${story.character_class}`, pageWidth / 2, y, { align: 'center' });
            y += 8;
        }

        if (story.cause_of_death) {
            doc.text(story.cause_of_death, pageWidth / 2, y, { align: 'center' });
        }

        // Hero image on title page
        if (story.finale_image_url || story.hero_image_url) {
            try {
                const heroUrl = story.finale_image_url || story.hero_image_url;
                const imgData = await fetchImageAsBase64(heroUrl);
                if (imgData) {
                    const imgWidth = 80;
                    const imgHeight = 80;
                    y += 15;
                    doc.addImage(imgData, 'WEBP', (pageWidth - imgWidth) / 2, y, imgWidth, imgHeight);
                }
            } catch (e) {
                console.warn('Failed to add hero image to PDF:', e);
            }
        }

        // ---- Chapters ----
        const rawText = story.full_text || '';
        const text = rawText.replace(/\r\n/g, '\n').replace(/<br\s*\/?>/gi, '\n');
        const sections = text.split(/\n*\s*---\s*\n*/);
        const sceneImages = story.scene_images || [];

        for (let i = 0; i < sections.length; i++) {
            const trimmed = sections[i].trim();
            if (!trimmed) continue;

            // New page for each chapter
            doc.addPage();
            y = margin;

            const titleMatch = trimmed.match(/^\*\*([^*]+)\*\*\s*\n([\s\S]*)$/);
            const chapterTitle = titleMatch ? titleMatch[1].trim() : `Chapter ${i + 1}`;
            const chapterBody = titleMatch ? titleMatch[2].trim() : trimmed;

            // Chapter number label
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(150);
            doc.text(`Chapter ${i + 1}`, margin, y);
            y += 6;

            // Chapter title
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(0);
            const chTitleLines = doc.splitTextToSize(chapterTitle, contentWidth);
            doc.text(chTitleLines, margin, y);
            y += chTitleLines.length * 8 + 4;

            // Divider line
            doc.setDrawColor(200);
            doc.setLineWidth(0.3);
            doc.line(margin, y, pageWidth - margin, y);
            y += 8;

            // Scene image
            const imgUrl = sceneImages[i];
            if (imgUrl) {
                try {
                    const imgData = await fetchImageAsBase64(imgUrl);
                    if (imgData) {
                        const imgWidth = contentWidth;
                        const imgHeight = contentWidth * 0.6; // 5:3 aspect
                        if (y + imgHeight > pageHeight - margin) {
                            doc.addPage();
                            y = margin;
                        }
                        doc.addImage(imgData, 'WEBP', margin, y, imgWidth, imgHeight);
                        y += imgHeight + 6;
                    }
                } catch (e) {
                    console.warn(`Failed to add scene image ${i} to PDF:`, e);
                }
            }

            // Chapter prose text
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(11);
            doc.setTextColor(40);
            const bodyLines = doc.splitTextToSize(chapterBody.replace(/\n/g, ' '), contentWidth);

            for (const line of bodyLines) {
                if (y + 6 > pageHeight - margin) {
                    doc.addPage();
                    y = margin;
                }
                doc.text(line, margin, y);
                y += 5.5;
            }
        }

        // ---- Achievements page ----
        if (story.achievements && story.achievements.length > 0) {
            doc.addPage();
            y = margin;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(0);
            doc.text('Achievements', margin, y);
            y += 12;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(12);
            story.achievements.forEach(ach => {
                doc.text(`🏆 ${ach}`, margin, y);
                y += 8;
            });
        }

        // Save the PDF
        const filename = (story.title || 'adventure').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        doc.save(`${filename}.pdf`);
    } catch (e) {
        console.error('PDF generation failed:', e);
        alert('Failed to generate PDF: ' + e.message);
    } finally {
        downloadPdfBtn.disabled = false;
        downloadPdfBtn.textContent = '📄 PDF';
    }
}

/**
 * Fetches an image URL and returns it as a base64 data URL
 * for embedding in the PDF.
 */
async function fetchImageAsBase64(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Failed to fetch image:', url, e);
        return null;
    }
}
