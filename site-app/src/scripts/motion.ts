// Site motion layer — Lenis smooth scroll + staggered IO reveals + magnetic CTAs.
// SITE respects prefers-reduced-motion (WCAG); the app-side "motion overrides OS
// reduce-motion" law is APP-ONLY and does not apply here. Reveals never hide content
// when reduced or when JS fails — .reveal only dims inside a no-preference media query.
import Lenis from "lenis";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduced) {
  const lenis = new Lenis({ lerp: 0.12 });
  const raf = (time: number) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  // Scroll reveals — stagger comes from each element's inline --d delay.
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

  // Magnetic CTAs — a small (≤4px) rAF-lerped pull toward the cursor. Vanilla on
  // purpose: ~25 lines beats shipping GSAP for one effect (zero-third-party budget).
  const PULL = 4;
  document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let frame = 0;
    const tick = () => {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) {
        el.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
        frame = requestAnimationFrame(tick);
      } else if (tx === 0 && ty === 0) {
        el.style.transform = "";
        frame = 0;
      } else {
        el.style.transform = `translate(${tx}px, ${ty}px)`;
        frame = 0;
      }
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    el.addEventListener("mousemove", (ev) => {
      const r = el.getBoundingClientRect();
      tx = ((ev.clientX - r.left) / r.width - 0.5) * 2 * PULL;
      ty = ((ev.clientY - r.top) / r.height - 0.5) * 2 * PULL;
      kick();
    });
    el.addEventListener("mouseleave", () => {
      tx = 0;
      ty = 0;
      kick();
    });
  });
}
