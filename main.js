// Shared behavior: mobile nav, footer year, reveal-on-scroll
document.addEventListener("DOMContentLoaded", () => {
  // Mobile navigation toggle
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => links.classList.remove("open"))
    );
  }

  // Footer year
  document.querySelectorAll(".year").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Reveal on scroll
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("visible"));
  }

  // Nav analog clock + water bar + fish
  const hourHand = document.querySelector(".nav-clock .hand-hour");
  const minuteHand = document.querySelector(".nav-clock .hand-minute");
  const secondHand = document.querySelector(".nav-clock .hand-second");
  const waterFill = document.getElementById("water-fill");
  const fish = document.getElementById("fish");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function updateClock() {
    const d = new Date();
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    const min = d.getMinutes() + sec / 60;
    const hr = (d.getHours() % 12) + min / 60;
    if (secondHand) secondHand.style.transform = "rotate(" + sec * 6 + "deg)";
    if (minuteHand) minuteHand.style.transform = "rotate(" + min * 6 + "deg)";
    if (hourHand) hourHand.style.transform = "rotate(" + hr * 30 + "deg)";
  }

  if (reduceMotion) {
    // Clock still works, but ticks once a second; water/fish are hidden by CSS
    updateClock();
    setInterval(updateClock, 1000);
    return;
  }

  // Fish looks toward the cursor and jumps on click
  let mouseX = window.innerWidth / 2;
  let mouseY = 0;
  let jumpStart = -1;
  if (fish) {
    document.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });
    document.addEventListener("click", () => {
      jumpStart = performance.now();
    });
  }

  function frame(now) {
    updateClock();

    // Water level: fill for 60s, drain for 60s, loop
    const cycle = (Date.now() / 1000) % 120;
    const level = cycle < 60 ? cycle / 60 : 1 - (cycle - 60) / 60;
    if (waterFill) waterFill.style.width = level * 100 + "%";

    if (fish) {
      const fx = 8 + level * (window.innerWidth - 48); // swim with the water edge
      const bob = Math.sin(now / 700) * 3;

      let jump = 0;
      if (jumpStart > 0) {
        const p = (now - jumpStart) / 450;
        if (p < 1) jump = Math.sin(Math.PI * p) * 26;
        else jumpStart = -1;
      }

      // Face and tilt toward the cursor (emoji faces left by default)
      const fishY = window.innerHeight - 20;
      const dx = mouseX - fx;
      const dy = mouseY - fishY;
      const flip = dx >= 0 ? -1 : 1;
      const angleDeg = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
      const tilt = Math.max(-22, Math.min(22, -angleDeg * 0.45));

      fish.style.transform =
        "translate(" + fx + "px, " + (bob - jump) + "px) scaleX(" + flip + ") rotate(" + tilt + "deg)";
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
