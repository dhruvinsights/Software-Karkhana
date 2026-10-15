import React, { useState, useEffect } from 'react';
import { Layers, ArrowRight, Menu, X } from 'lucide-react';
import { SpecularButton } from '../reactbits/SpecularButton';

interface MarketingNavbarProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  onExploreDemo: () => void;
}

export const MarketingNavbar: React.FC<MarketingNavbarProps> = ({
  onGetStarted,
  onSignIn,
  onExploreDemo,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        scrolled
          ? 'bg-[#050609]/90 backdrop-blur-md border-b border-white/10 py-3.5'
          : 'bg-transparent py-5'
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="flex items-center justify-between">
          {/* Brand Name - Clean Minimalist Text Only, No Icon */}
          <div
            className="flex items-center cursor-pointer group"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <span className="text-base font-semibold tracking-tight text-[#f7f8fc] group-hover:text-[#075bff] transition-colors">
              Software Karkhana
            </span>
          </div>

          {/* Clean Unboxed Text Navigation */}
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <button
              onClick={() => scrollTo('preview-stage')}
              className="text-[#a7acb8] hover:text-[#f7f8fc] transition-colors"
            >
              Factory Platform
            </button>
            <button
              onClick={() => scrollTo('services-section')}
              className="text-[#a7acb8] hover:text-[#f7f8fc] transition-colors"
            >
              Disciplines
            </button>
            <button
              onClick={() => scrollTo('testimonial-section')}
              className="text-[#a7acb8] hover:text-[#f7f8fc] transition-colors"
            >
              Architecture Proof
            </button>
            <button
              onClick={() => scrollTo('pricing-section')}
              className="text-[#a7acb8] hover:text-[#f7f8fc] transition-colors"
            >
              Editions
            </button>
          </nav>

          {/* Right Action CTAs */}
          <div className="hidden md:flex items-center gap-4">
            <button
              onClick={onExploreDemo}
              className="text-sm text-[#a7acb8] hover:text-white transition-colors"
            >
              Live Demo
            </button>
            <button
              onClick={onSignIn}
              className="text-sm text-[#a7acb8] hover:text-white transition-colors"
            >
              Sign In
            </button>
            <SpecularButton
              size="sm"
              radius={14}
              tint="#075bff"
              tintOpacity={0.25}
              lineColor="#ffffff"
              baseColor="#075bff"
              intensity={1.1}
              glow={1.1}
              followMouse
              proximity={200}
              onClick={onGetStarted}
            >
              Create Workspace
            </SpecularButton>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-[#a7acb8] hover:text-white"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-3 p-4 bg-[#111216] rounded-2xl border border-white/10 space-y-3 text-sm shadow-2xl">
            <button
              onClick={() => scrollTo('preview-stage')}
              className="block w-full text-left text-[#f7f8fc] py-1"
            >
              Factory Platform
            </button>
            <button
              onClick={() => scrollTo('services-section')}
              className="block w-full text-left text-[#f7f8fc] py-1"
            >
              Disciplines
            </button>
            <button
              onClick={() => scrollTo('pricing-section')}
              className="block w-full text-left text-[#f7f8fc] py-1"
            >
              Editions
            </button>
            <div className="pt-2 border-t border-white/10 flex flex-col gap-2">
              <button
                onClick={onExploreDemo}
                className="w-full text-left py-1 text-[#a7acb8]"
              >
                Live Demo
              </button>
              <button
                onClick={onGetStarted}
                className="w-full py-2 bg-[#075bff] text-white font-medium text-xs rounded-full text-center"
              >
                Create Workspace
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
