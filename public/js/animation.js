/**
 * Bingo Antigravity Physics Animation
 * Creates floating 3D-styled balls that interact with mouse and gravity.
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('liquid-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;

    // Physics Configuration
    const BALL_COUNT = 15;
    const GRAVITY = 0; // Zero gravity for "float" effect
    const FRICTION = 0.98;
    const MOUSE_REPULSION = 200; // Pixel radius
    const MOUSE_FORCE = 0.5;

    // Palette
    const colors = [
        { main: '#8b5cf6', highlight: '#a78bfa', shadow: '#7c3aed' }, // Violet
        { main: '#ec4899', highlight: '#f472b6', shadow: '#db2777' }, // Pink
        { main: '#06b6d4', highlight: '#22d3ee', shadow: '#0891b2' }, // Cyan
        { main: '#f59e0b', highlight: '#fbbf24', shadow: '#d97706' }, // Amber
        { main: '#10b981', highlight: '#34d399', shadow: '#059669' }  // Emerald
    ];

    let balls = [];
    let mouse = { x: -1000, y: -1000 };

    function resize() {
        width = canvas.width = canvas.parentElement.offsetWidth;
        height = canvas.height = canvas.parentElement.offsetHeight;
        initBalls(); // Re-init on resize to prevent out of bounds
    }

    class Ball {
        constructor() {
            this.r = Math.random() * 30 + 20; // Radius 20-50
            this.x = Math.random() * (width - this.r * 2) + this.r;
            this.y = Math.random() * (height - this.r * 2) + this.r;
            this.vx = (Math.random() - 0.5) * 2; // Random velocity
            this.vy = (Math.random() - 0.5) * 2;

            // Visuals
            this.color = colors[Math.floor(Math.random() * colors.length)];
            this.number = Math.floor(Math.random() * 75) + 1;
        }

        update() {
            // Mouse Interaction (Antigravity/Repulsion)
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < MOUSE_REPULSION) {
                const angle = Math.atan2(dy, dx);
                const force = (MOUSE_REPULSION - dist) / MOUSE_REPULSION;
                this.vx += Math.cos(angle) * force * MOUSE_FORCE;
                this.vy += Math.sin(angle) * force * MOUSE_FORCE;
            }

            // Dynamics
            this.x += this.vx;
            this.y += this.vy;
            this.vx *= FRICTION;
            this.vy *= FRICTION;

            // Keep moving slightly (ambient float)
            this.vx += (Math.random() - 0.5) * 0.05;
            this.vy += (Math.random() - 0.5) * 0.05;

            // Walls (Bounce)
            if (this.x + this.r > width) { this.x = width - this.r; this.vx *= -0.8; }
            if (this.x - this.r < 0) { this.x = this.r; this.vx *= -0.8; }
            if (this.y + this.r > height) { this.y = height - this.r; this.vy *= -0.8; }
            if (this.y - this.r < 0) { this.y = this.r; this.vy *= -0.8; }
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);

            // 3D Gradient
            const grad = ctx.createRadialGradient(
                this.x - this.r * 0.3, this.y - this.r * 0.3, this.r * 0.1,
                this.x, this.y, this.r
            );
            grad.addColorStop(0, this.color.highlight);
            grad.addColorStop(0.5, this.color.main);
            grad.addColorStop(1, this.color.shadow);

            ctx.fillStyle = grad;
            ctx.fill();

            // Shadow (fake ambient occlusion)
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;

            // Number Text
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = `bold ${this.r}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'transparent'; // Reset shadow for text
            ctx.fillText(this.number, this.x, this.y + this.r * 0.1);
        }
    }

    function initBalls() {
        balls = [];
        for (let i = 0; i < BALL_COUNT; i++) {
            balls.push(new Ball());
        }
    }

    function collision() {
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                let b1 = balls[i];
                let b2 = balls[j];
                let dx = b2.x - b1.x;
                let dy = b2.y - b1.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let minDist = b1.r + b2.r;

                if (dist < minDist) {
                    // Simple elastic collision response
                    let angle = Math.atan2(dy, dx);
                    let tx = b1.x + Math.cos(angle) * minDist;
                    let ty = b1.y + Math.sin(angle) * minDist;

                    let ax = (tx - b2.x) * 0.05; // Spring constant
                    let ay = (ty - b2.y) * 0.05;

                    b1.vx -= ax;
                    b1.vy -= ay;
                    b2.vx += ax;
                    b2.vy += ay;
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        balls.forEach(ball => {
            ball.update();
            ball.draw();
        });

        collision(); // Ball-to-ball collision

        requestAnimationFrame(animate);
    }

    // Interactions
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });

    // Tap/Touch for mobile
    window.addEventListener('touchmove', e => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.touches[0].clientX - rect.left;
        mouse.y = e.touches[0].clientY - rect.top;
    });

    // Start
    resize();
    initBalls();
    animate();
});
