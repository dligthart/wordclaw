import '@testing-library/jest-dom/vitest';

// Polyfill Web Animations API for jsdom (used by Svelte transitions)
if (typeof Element !== 'undefined') {
    if (!Element.prototype.animate) {
        Element.prototype.animate = function () {
            return {
                cancel: () => {},
                finish: () => {},
                pause: () => {},
                play: () => {},
                reverse: () => {},
                onfinish: null,
                oncancel: null,
                finished: Promise.resolve(),
                currentTime: 0,
                playbackRate: 1,
                playState: 'finished',
                effect: null,
                timeline: null,
                id: '',
                startTime: null,
                persist: () => {},
                commitStyles: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false,
                updatePlaybackRate: () => {},
                replaceState: () => {},
            } as unknown as Animation;
        };
    }
    if (!Element.prototype.getAnimations) {
        Element.prototype.getAnimations = function () {
            return [];
        };
    }
}
