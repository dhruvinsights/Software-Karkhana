import React, { useEffect, useState } from 'react';
import { factoryStore } from '../../store/factoryStore';
import { ProjectDesignPanel } from './ProjectDesignPanel';
import { StitchStudioPanel } from './StitchStudioPanel';

/**
 * The designer's dashboard for one project: the design spec (contracts, screens, approval)
 * and the Google Stitch studio. Stitch lives only here; the panel renders nothing unless the
 * server confirms the viewer holds the project's design station.
 */
export const DesignerDashboardView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [stations, setStations] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    setStations(null);
    fetch(`/api/projects/${projectId}/access`, { headers: { Authorization: `Bearer ${factoryStore.getState().token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => alive && setStations(a?.stations ?? []))
      .catch(() => alive && setStations([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  return (
    <div className="space-y-10">
      <ProjectDesignPanel projectId={projectId} canDesign={!!stations?.includes('design')} />
      <StitchStudioPanel projectId={projectId} />
    </div>
  );
};
