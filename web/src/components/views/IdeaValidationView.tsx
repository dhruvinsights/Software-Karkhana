import React from 'react';
import { FactoryState } from '../../store/factoryStore';
import { ProductIdeaLab } from './ProductIdeaLab';

interface IdeaValidationViewProps {
  state: FactoryState;
}

export const IdeaValidationView: React.FC<IdeaValidationViewProps> = ({ state }) => {
  return (
    <div className="max-w-[1700px] mx-auto animate-fade-in pb-12">
      <ProductIdeaLab state={state} />
    </div>
  );
};
