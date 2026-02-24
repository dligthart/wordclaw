document.addEventListener('DOMContentLoaded', () => {
    // Basic Intersection Observer for scroll animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optional: stop observing once animated
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Select all elements that need formatting
    const animatedElements = document.querySelectorAll('.fade-in-up');

    // Add elements to observer
    animatedElements.forEach(el => {
        observer.observe(el);
    });

    // Optional: Add a subtle parallax effect to the background on mouse move
    const body = document.querySelector('body');
    const bg = document.querySelector('.glow-bg');

    if (bg && window.matchMedia("(min-width: 768px)").matches) {
        body.addEventListener('mousemove', (e) => {
            const mouseX = e.clientX / window.innerWidth - 0.5;
            const mouseY = e.clientY / window.innerHeight - 0.5;

            // Move background slightly opposite to mouse
            bg.style.transform = `translate(${mouseX * -20}px, ${mouseY * -20}px)`;
        });
    }
});
