import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SignOut } from '@phosphor-icons/react';
import { useGet, type Nav } from '../api';
import { useAuth, type Role } from '../auth';
import { ErrorBox, Loading } from '../components/common';
import { NavIcon } from './icons';
import Home from '../pages/Home';
import Ideas from '../pages/Ideas';
import Approvals from '../pages/Approvals';
import Work from '../pages/Work';
import Reviews from '../pages/Reviews';
import Portfolio from '../pages/Portfolio';
import Learnings from '../pages/Learnings';
import Ledger from '../pages/Ledger';
import System from '../pages/System';
import ProjectPage from '../pages/ProjectPage';

export const ROLE_LABEL: Record<Role, string> = { pm: 'Project manager', director: 'Director', developer: 'Developer', lead: 'Tech lead' };

const ROUTES: Record<string, JSX.Element> = {
  '/home': <Home />, '/ideas': <Ideas />, '/approvals': <Approvals />, '/work': <Work />,
  '/reviews': <Reviews />, '/portfolio': <Portfolio />, '/learnings': <Learnings />,
  '/ledger': <Ledger />, '/system': <System />,
};

// The sidebar and the route table are both built from /api/nav, so a role can
// neither see nor open a page the server did not grant it.
export default function Shell() {
  const { me, logout, config } = useAuth();
  const { data: nav, error } = useGet<Nav>(['nav', me?.id], '/api/nav');
  const loc = useLocation();
  if (error) return <div className="wrap"><ErrorBox error={error} /></div>;
  if (!nav) return <div className="wrap"><Loading /></div>;
  const allowed = new Set(nav.pages.map((p) => p.path));
  const home = nav.pages[0]?.path ?? '/home';
  const top = '/' + loc.pathname.split('/')[1];

  return (
    <div className="app">
      <aside className="rail">
        <NavLink to={home} className="brand"><span className="mark">K</span><span><b>Karkhana</b><small>{config?.runner} runner</small></span></NavLink>
        <nav className="nav" aria-label="Primary">
          {nav.pages.map((p) => <NavLink key={p.path} to={p.path}><NavIcon name={p.icon} />{p.label}</NavLink>)}
        </nav>
        <div className="who">
          <b>{me?.display_name}</b>
          <span className="pill outline" style={{ alignSelf: 'flex-start' }}>{me && ROLE_LABEL[me.role]}</span>
          <span className="muted sm mono" style={{ overflowWrap: 'anywhere' }}>{me?.email}</span>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={logout}><SignOut size={14} />Sign out</button>
        </div>
      </aside>
      <main className="canvas">
        <div className="wrap">
          <Routes>
            {nav.pages.map((p) => <Route key={p.path} path={p.path} element={ROUTES[p.path]} />)}
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="*" element={<Navigate to={allowed.has(top) ? top : home} replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
