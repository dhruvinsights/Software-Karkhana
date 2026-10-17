import React from 'react';
import { FactoryState } from '../../store/factoryStore';
import { ProductIdeaLab } from './ProductIdeaLab';

interface IdeaValidationViewProps {
  state: FactoryState;
}

export const IdeaValidationView: React.FC<IdeaValidationViewProps> = ({ state }) => {
  return (
    <div className="animate-fade-in pb-12">
      <ProductIdeaLab state={state} />
    </div>
  );
};
