/*
 * Animated backdrop for the title screen: a moonlit sea at night with your
 * battleship riding the swell, a sweeping searchlight, and enemy gunfire
 * flashing on the horizon. Drawn on a canvas; one still frame when the
 * player prefers reduced motion.
 */
const TitleScene = (() => {
    let canvas, ctx, width, height;
    let frame = null;
    let stars = [];
    let smoke = [];
    let flashes = [];
    let nextFlash = 0;
    let lastSmoke = 0;
    let colors = {};
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function token(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function rgba(hex, alpha) {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    function init(el) {
        canvas = el;
        ctx = canvas.getContext('2d');
        colors = {
            skyTop: token('--sky-top'),
            skyLow: token('--sky-low'),
            moon: token('--moon'),
            seaFar: token('--sea-far'),
            waves: [token('--wave-far'), token('--wave-mid'), token('--wave-near')],
            hull: token('--hull-dark'),
            lamp: token('--lamp'),
            flash: token('--blast-mid'),
            smoke: token('--smoke-puff')
        };
        resize();
        window.addEventListener('resize', resize);
        if (reducedMotion.matches) {
            draw(4000);
        } else {
            const loop = t => {
                draw(t);
                frame = requestAnimationFrame(loop);
            };
            frame = requestAnimationFrame(loop);
        }
    }

    function stop() {
        cancelAnimationFrame(frame);
        frame = null;
        window.removeEventListener('resize', resize);
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = canvas.clientWidth;
        height = canvas.clientHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const horizon = height * 0.6;
        const count = Math.round((width * horizon) / 5000);
        stars = Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * horizon * 0.92,
            r: 0.4 + Math.random() * 1.1,
            phase: Math.random() * Math.PI * 2,
            speed: 0.0008 + Math.random() * 0.002
        }));
        if (reducedMotion.matches) draw(4000);
    }

    /* ---------- layout helpers ---------- */

    const horizonY = () => height * 0.6;
    const shipX = () => width * (width < 700 ? 0.5 : 0.36);
    const shipLength = () => Math.max(200, Math.min(width * 0.38, 520));

    // Three swell layers, far to near.
    const WAVES = [
        { depth: 0.16, amp: 3, len: 70, speed: 0.00035 },
        { depth: 0.42, amp: 7, len: 120, speed: 0.0005 },
        { depth: 0.78, amp: 13, len: 190, speed: 0.0007 }
    ];

    function waveY(i, x, t) {
        const w = WAVES[i];
        const base = horizonY() + (height - horizonY()) * w.depth;
        return base
            + w.amp * Math.sin(x / w.len + t * w.speed + i)
            + w.amp * 0.45 * Math.sin(x / (w.len * 0.43) - t * w.speed * 1.4 + i * 2);
    }

    /* ---------- drawing ---------- */

    function draw(t) {
        const horizon = horizonY();
        // A low moon beside the title on wide screens; up in the corner on narrow ones.
        const wide = width >= 700;
        const moon = {
            x: width * (wide ? 0.87 : 0.86),
            y: height * (wide ? 0.44 : 0.065),
            r: Math.max(16, Math.min(width, height) * 0.045)
        };

        // Sky
        const sky = ctx.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, colors.skyTop);
        sky.addColorStop(1, colors.skyLow);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, horizon + 1);

        for (const s of stars) {
            ctx.fillStyle = rgba(colors.moon, 0.35 + 0.35 * Math.sin(t * s.speed + s.phase));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Moon and its halo
        const halo = ctx.createRadialGradient(moon.x, moon.y, moon.r * 0.8, moon.x, moon.y, moon.r * 6);
        halo.addColorStop(0, rgba(colors.moon, 0.22));
        halo.addColorStop(1, rgba(colors.moon, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, width, horizon);
        const disc = ctx.createRadialGradient(moon.x - moon.r * 0.3, moon.y - moon.r * 0.3, moon.r * 0.1, moon.x, moon.y, moon.r);
        disc.addColorStop(0, colors.moon);
        disc.addColorStop(1, rgba(colors.moon, 0.85));
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
        ctx.fill();

        const ship = shipPose(t);
        drawSearchlight(ship, t);
        drawEnemyFleet(t, horizon);

        // Sea
        const sea = ctx.createLinearGradient(0, horizon, 0, height);
        sea.addColorStop(0, colors.seaFar);
        sea.addColorStop(1, colors.waves[2]);
        ctx.fillStyle = sea;
        ctx.fillRect(0, horizon, width, height - horizon);

        // Moonlight glittering on the water
        for (let y = horizon + 2; y < height; y += 4) {
            const k = (y - horizon) / (height - horizon);
            const spread = moon.r * (0.6 + k * 3);
            const jitter = Math.sin(y * 0.35 + t * 0.003) * spread * 0.5;
            ctx.fillStyle = rgba(colors.moon, 0.32 * (1 - k) * (0.5 + 0.5 * Math.sin(y * 1.7 + t * 0.006)));
            ctx.fillRect(moon.x - spread / 2 + jitter, y, spread * (0.4 + 0.6 * Math.abs(Math.sin(y + t * 0.002))), 1.4);
        }

        drawWave(0, t);
        drawShip(ship, t);
        drawSmoke(ship, t);
        drawWave(1, t);
        drawWave(2, t);
    }

    function drawWave(i, t) {
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, waveY(i, x, t));
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fillStyle = colors.waves[i];
        ctx.fill();
        // Faint moonlit crests
        ctx.beginPath();
        for (let x = 0; x <= width + 8; x += 8) {
            const y = waveY(i, x, t);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(colors.moon, 0.05 + i * 0.03);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // The ship rides on the middle swell, pitching with its slope.
    function shipPose(t) {
        const x = shipX();
        const L = shipLength();
        const y = waveY(1, x, t) + L * 0.012;
        const slope = (waveY(1, x + L * 0.3, t) - waveY(1, x - L * 0.3, t)) / (L * 0.6);
        return { x, y, L, u: L / 100, angle: Math.atan(slope) * 0.7 };
    }

    // Converts a point on the ship (in hull units) to screen coordinates.
    function onShip(ship, px, py) {
        const cos = Math.cos(ship.angle);
        const sin = Math.sin(ship.angle);
        const x = px * ship.u;
        const y = py * ship.u;
        return [ship.x + x * cos - y * sin, ship.y + x * sin + y * cos];
    }

    function drawShip(ship, t) {
        const { u } = ship;
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.angle);
        ctx.scale(u, u);
        ctx.fillStyle = colors.hull;
        ctx.strokeStyle = colors.hull;

        const poly = points => {
            ctx.beginPath();
            points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fill();
        };
        // Hull with a raked bow
        poly([[-50, -6], [38, -6], [52, -9.5], [45, 1], [-47, 1], [-50, -3]]);
        // Superstructure, bridge and funnel
        poly([[-18, -6], [-18, -11], [12, -11], [12, -6]]);
        poly([[-7, -11], [-7, -16], [7, -16], [7, -11]]);
        poly([[-3, -16], [-3, -19.5], [4, -19.5], [4, -16]]);
        poly([[-17, -11], [-15.5, -19], [-10, -19], [-10.5, -11]]);
        // Turrets: one aft, two forward (the second fires over the first)
        poly([[-38, -6], [-37, -9], [-29, -9], [-28, -6]]);
        poly([[17, -6], [18, -9], [25, -9], [26, -6]]);
        poly([[27, -8], [28, -11], [35, -11], [36, -8]]);
        ctx.lineCap = 'round';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-37, -7.6); ctx.lineTo(-46, -8.6);
        ctx.moveTo(25, -7.6); ctx.lineTo(33, -8.2);
        ctx.moveTo(35, -9.6); ctx.lineTo(45, -10.6);
        // Mast and yard
        ctx.moveTo(0.5, -19.5); ctx.lineTo(0.5, -31);
        ctx.moveTo(-4, -27.5); ctx.lineTo(5, -27.5);
        ctx.stroke();

        // Lit portholes and bridge windows
        ctx.fillStyle = rgba(colors.lamp, 0.85);
        for (let x = -42; x <= 34; x += 5) {
            if ((x * 7) % 3 !== 0) ctx.fillRect(x, -3.4, 1.2, 0.9);
        }
        for (let x = -5.5; x <= 5; x += 2.2) ctx.fillRect(x, -14.6, 1.2, 1.1);

        // Masthead light, blinking
        if (Math.floor(t / 900) % 2 === 0) {
            ctx.fillStyle = colors.moon;
            ctx.beginPath();
            ctx.arc(0.5, -31.5, 0.9, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawSearchlight(ship, t) {
        const [x, y] = onShip(ship, 0.5, -17.5);
        const angle = -Math.PI / 2 + 0.6 * Math.sin(t / 3600) - 0.25;
        const spread = 0.05;
        const reach = height * 1.2;
        const beam = ctx.createLinearGradient(x, y, x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
        beam.addColorStop(0, rgba(colors.moon, 0.2));
        beam.addColorStop(1, rgba(colors.moon, 0));
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle - spread) * reach, y + Math.sin(angle - spread) * reach);
        ctx.lineTo(x + Math.cos(angle + spread) * reach, y + Math.sin(angle + spread) * reach);
        ctx.closePath();
        ctx.fill();
    }

    // Small enemy silhouettes on the horizon, with gun flashes now and then.
    function drawEnemyFleet(t, horizon) {
        const size = Math.max(26, Math.min(width * 0.05, 56));
        const spots = [0.64, 0.73, 0.88].map(f => width * f);
        if (!reducedMotion.matches && t > nextFlash) {
            flashes.push({ x: spots[Math.floor(Math.random() * spots.length)], born: t });
            nextFlash = t + 1800 + Math.random() * 3200;
        }
        flashes = flashes.filter(f => t - f.born < 700);
        for (const f of flashes) {
            const k = 1 - (t - f.born) / 700;
            const glow = ctx.createRadialGradient(f.x, horizon - size * 0.15, 0, f.x, horizon - size * 0.15, size * 2.2);
            glow.addColorStop(0, rgba(colors.flash, 0.75 * k));
            glow.addColorStop(1, rgba(colors.flash, 0));
            ctx.fillStyle = glow;
            ctx.fillRect(f.x - size * 2.5, horizon - size * 2.5, size * 5, size * 2.5);
        }
        ctx.fillStyle = colors.hull;
        for (const x of spots) {
            const s = size / 100;
            ctx.beginPath();
            ctx.moveTo(x - 50 * s, horizon);
            ctx.lineTo(x - 48 * s, horizon - 7 * s);
            ctx.lineTo(x - 12 * s, horizon - 7 * s);
            ctx.lineTo(x - 8 * s, horizon - 20 * s);
            ctx.lineTo(x + 6 * s, horizon - 20 * s);
            ctx.lineTo(x + 9 * s, horizon - 7 * s);
            ctx.lineTo(x + 50 * s, horizon - 8 * s);
            ctx.lineTo(x + 44 * s, horizon);
            ctx.closePath();
            ctx.fill();
        }
    }

    function drawSmoke(ship, t) {
        if (!reducedMotion.matches && t - lastSmoke > 260) {
            const [x, y] = onShip(ship, -12.8, -19.5);
            smoke.push({ x, y, born: t, drift: 0.6 + Math.random() * 0.5 });
            lastSmoke = t;
        }
        smoke = smoke.filter(p => t - p.born < 5000);
        for (const p of smoke) {
            const age = (t - p.born) / 5000;
            const r = ship.u * (1.5 + age * 9);
            ctx.fillStyle = rgba(colors.smoke, 0.28 * (1 - age));
            ctx.beginPath();
            ctx.arc(p.x - age * ship.L * 0.45 * p.drift, p.y - age * ship.L * 0.16, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    return { init, stop };
})();
