'use client';

import React, { useEffect, useRef } from 'react';

export default function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    let targetX = width / 2;
    let targetY = height / 2;
    let currentX = width / 2;
    let currentY = height / 2;

    const handleMouseMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    
    window.addEventListener('resize', resize);
    resize();

    // Create particles
    const particles = Array.from({ length: 80 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
    }));

    const render = () => {
      // Smooth out mouse position
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;

      // Update glow ref position without React state
      if (glowRef.current) {
        glowRef.current.style.background = `radial-gradient(1000px circle at ${currentX}px ${currentY}px, rgba(124, 58, 237, 0.12), transparent 50%)`;
      }

      ctx.clearRect(0, 0, width, height);
      
      const dx = targetX - width / 2;
      const dy = targetY - height / 2;

      particles.forEach((p) => {
        // Move particle
        p.x += p.speedX;
        p.y += p.speedY;

        // Wrap around
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        // Mouse parallax effect
        const parallaxX = p.x - dx * 0.03 * (p.size / 2);
        const parallaxY = p.y - dy * 0.03 * (p.size / 2);

        ctx.beginPath();
        ctx.arc(parallaxX, parallaxY, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      {/* Interactive glowing background blob */}
      <div 
        ref={glowRef}
        className="absolute top-0 left-0 w-full h-full opacity-60 mix-blend-screen transition-opacity duration-1000"
      />
      {/* Base gradient matching the designs */}
      <div 
        className="absolute top-0 left-0 w-full h-full opacity-50 mix-blend-screen"
        style={{
          background: 'radial-gradient(1200px circle at 50% 50%, rgba(88, 28, 135, 0.4), transparent 60%)'
        }}
      />
    </div>
  );
}
