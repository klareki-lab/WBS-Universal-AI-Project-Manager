import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectPlan } from '../components/ProjectPlan';
import { StatusBadge } from '../components/UI';
import type { PlanVersion } from '../api/types';
describe('basic accessible UI interactions',()=>{
  it('shows the operational job status as text',()=>{render(<StatusBadge status="failed"/>);expect(screen.getByText('Fehlgeschlagen')).toBeInTheDocument();});
  it('activates a plan task edit button through keyboard-accessible controls',async()=>{
    const plan:PlanVersion={id:'v1',projectId:'p1',version:1,status:'draft',createdAt:'',source:'demo-template',warnings:[],phases:[{id:'phase',title:'Planung',description:'',order:0}],tasks:[{id:'task',phaseId:'phase',title:'Datenschutz prüfen',description:'',priority:'high',status:'todo',estimateDays:2,dependsOn:[]}]};
    const callback=vi.fn();render(<MemoryRouter><ProjectPlan plan={plan} onEdit={callback}/></MemoryRouter>);
    const button=screen.getByRole('button',{name:'Aufgabe bearbeiten: Datenschutz prüfen'});
    button.focus();await userEvent.keyboard('{Enter}');expect(callback).toHaveBeenCalledWith(plan.tasks[0]);
  });
});
