const loadingEl = document.getElementById('loading');
const leaderboardBody = document.getElementById('leaderboard-body');
const emptyMessage = document.getElementById('empty-message');

window.addEventListener('DOMContentLoaded', loadLeaderboard);

async function loadLeaderboard() {
    setLoading(true);
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const entries = data.entries || [];

        if (entries.length === 0) {
            emptyMessage.classList.remove('hidden');
            return;
        }

        leaderboardBody.innerHTML = '';
        entries.forEach(entry => {
            const row = document.createElement('tr');
            const survived = entry.cause_of_death !== 'Succumbed to their injuries';
            const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';

            row.innerHTML = `
                <td class="col-rank ${rankClass}">
                    ${entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank}
                </td>
                <td class="col-hero">
                    ${entry.hero_image_url
                    ? `<img src="${entry.hero_image_url}" alt="${entry.player_name}" class="lb-avatar" />`
                    : `<div class="lb-avatar-placeholder">👤</div>`
                }
                </td>
                <td class="col-name">${entry.player_name}</td>
                <td class="col-class">${entry.character_class}</td>
                <td class="col-score">${entry.score}</td>
                <td class="col-fate" style="color: ${survived ? '#10b981' : '#ef4444'}">
                    ${survived ? '🏆 Survived' : '💀 Fallen'}
                </td>
                <td class="col-achievements">
                    ${(entry.achievements || []).slice(0, 3).map(a => `<span class="lb-badge">${a}</span>`).join(' ')}
                </td>
            `;
            leaderboardBody.appendChild(row);
        });
    } catch (e) {
        leaderboardBody.innerHTML = `<tr><td colspan="7" style="color:var(--health); text-align:center; padding:2rem;">Failed to load leaderboard: ${e.message}</td></tr>`;
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        loadingEl.classList.remove('hidden');
    } else {
        loadingEl.classList.add('hidden');
    }
}
