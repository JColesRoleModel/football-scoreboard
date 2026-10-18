// Twinkling starfield on a fixed canvas. Draws a single still frame when the user prefers reduced motion.

export function startStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let stars = [];
  let w = 0, h = 0, dpr = 1, raf = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    // Use the tallest the viewport gets, so mobile URL bars showing/hiding don't reshuffle the stars.
    h = Math.max(window.innerHeight, window.screen?.height || 0);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((w * h) / 2600);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() < 0.08 ? 1.3 + Math.random() * 0.8 : 0.4 + Math.random() * 0.8,
      base: 0.25 + Math.random() * 0.6,
      speed: 0.4 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.3 ? 200 : Math.random() < 0.5 ? 265 : 0,
    }));
    draw(performance.now());
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    const s = t / 1000;
    for (const st of stars) {
      const a = reduce.matches ? st.base : st.base * (0.55 + 0.45 * Math.sin(s * st.speed + st.phase));
      ctx.fillStyle = st.hue ? `hsla(${st.hue}, 90%, 85%, ${a})` : `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
      if (st.r > 1.3) {
        ctx.fillStyle = `rgba(200, 190, 255, ${a * 0.12})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ~30fps is plenty for twinkling and saves battery on phones.
  let last = 0;
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (t - last < 33) return;
    last = t;
    draw(t);
  }

  function run() {
    cancelAnimationFrame(raf);
    if (!reduce.matches && !document.hidden) raf = requestAnimationFrame(loop);
    else draw(performance.now());
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    if (window.innerWidth === w && window.innerHeight <= h) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  document.addEventListener('visibilitychange', run);
  reduce.addEventListener?.('change', run);
  resize();
  run();
}
