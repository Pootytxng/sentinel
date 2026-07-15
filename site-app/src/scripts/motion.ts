// Site motion init — Lenis smooth scroll + IntersectionObserver reveals.
// SITE respects prefers-reduced-motion (WCAG); the app-side "motion overrides OS
// reduce-motion" law is APP-ONLY and does not apply here.
import Lenis from "lenis";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduced) {
  const lenis = new Lenis({ lerp: 0.12 });
  const raf = (time: number) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
} else {
  // Reduced motion: content is never hidden (the .reveal opacity rule is inside a
  // no-preference media query), so nothing to do.
}
