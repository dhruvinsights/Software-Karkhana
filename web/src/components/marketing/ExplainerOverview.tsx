import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { BORDER } from './demoKit';

const SRC = '/video/karkhana-explainer.mp4';
const POSTER = '/video/karkhana-explainer-poster.jpg';

/** The three-minute explainer, playing on its own beside a short overview. */
export const ExplainerOverview: React.FC<{ container: string }> = ({ container }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // Autoplay (muted, as browsers require) while the video is on screen; pause when it scrolls away.
  useEffect(() => {
    const v = ref.current;
    if (!v || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => { /* autoplay blocked: the poster and controls stay */ });
        else v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const toggleSound = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) void v.play().catch(() => {});
  };

  return (
    <section id="overview-section" className={`${container} pb-24 relative z-20`}>
      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-10 lg:gap-14 items-center">
        <div className="relative">
          <div aria-hidden className="absolute -inset-3 sm:-inset-4 rounded-[28px] border border-white/15 [mask-image:linear-gradient(135deg,#000_30%,transparent_55%,#000_80%)]" />
          <div className={`relative overflow-hidden rounded-[22px] border ${BORDER} bg-black shadow-[0_40px_120px_-30px_rgba(7,91,255,0.55)]`}>
            <video
              ref={ref}
              className="block w-full aspect-video object-contain bg-black"
              src={SRC}
              poster={POSTER}
              muted
              loop
              playsInline
              autoPlay
              preload="metadata"
              aria-label="Software Karkhana in three minutes"
            />
            <button
              type="button"
              onClick={toggleSound}
              aria-label={muted ? 'Turn sound on' : 'Mute'}
              className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 w-11 h-11 rounded-full border-2 border-white/80 bg-black/45 backdrop-blur flex items-center justify-center text-white hover:bg-black/65 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight bg-gradient-to-r from-[#5B8FFF] via-[#9b7bff] to-[#4fd1c5] bg-clip-text text-transparent w-fit">
            Overview
          </h2>
          <p className="text-base sm:text-lg text-slate-300 leading-relaxed">
            Software Karkhana is a governed AI software factory. Agents do the typing; people keep the decisions.
          </p>
          <p className="text-base text-slate-400 leading-relaxed">
            Product, design, architecture, engineering, QA and security work from one project graph, so the context behind a story travels with it from the first idea to the release.
          </p>
          <p className="text-base text-slate-400 leading-relaxed">
            Every agent run comes back with evidence: real test results and a diff, not a promise. A named person signs each gate, and every decision lands on a hash-chained ledger anyone can verify.
          </p>
          <p className="text-base text-slate-400 leading-relaxed">
            The video walks through it in three minutes. Turn the sound on for the narration, then try any of the demos below.
          </p>
        </div>
      </div>
    </section>
  );
};
