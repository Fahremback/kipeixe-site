const header = document.querySelector('[data-header]');
const year = document.querySelector('[data-year]');
const revealItems = document.querySelectorAll('.reveal-on-scroll');
const experience = document.querySelector('.experience');

if (year) {
  year.textContent = new Date().getFullYear();
}

const syncHeader = () => {
  if (!header) return;
  header.classList.toggle('is-scrolled', window.scrollY > 28);
};

syncHeader();
window.addEventListener('scroll', syncHeader, { passive: true });

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.16 }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (experience && !reducedMotion) {
  const updateParallax = () => {
    const rect = experience.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    if (rect.bottom < 0 || rect.top > viewport) return;
    const progress = (viewport - rect.top) / (viewport + rect.height);
    const offset = (progress - 0.5) * 54;
    experience.style.setProperty('--parallax', `${offset.toFixed(1)}px`);
  };

  updateParallax();
  window.addEventListener('scroll', updateParallax, { passive: true });
}
